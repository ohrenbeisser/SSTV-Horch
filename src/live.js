// Live-Decoder: nimmt Audio in beliebigen Stücken und spuckt Ereignisse aus (Bild wächst, Bild fertig, Bild verworfen, Rufzeichen).
// Ablauf: auf ein VIS lauern -> Bildaufbau (die bisher empfangene Spur wird etwa einmal je Sekunde komplett neu decodiert; klingt
// verschwenderisch, kostet bei einem vollen Bild aber nur 50 bis 120 ms und hält den Code schön einfach) -> nach der letzten Zeile
// noch kurz auf die FSK-ID warten, ohne das Bild aufzuhalten -> wieder lauern.
// Der Speicher bleibt im Rahmen: Beim Lauern wird die Spur bis auf wenige Sekunden weggeworfen.
// Bilder ohne VIS (Anfang verpasst, VIS im Rauschen verloren): Beim Lauern wird zusätzlich alle paar Sekunden der Takt der Sync-Impulse
// untersucht (src/blind.js). Dafür bleibt beim Lauern bis zu eine knappe Minute Spur stehen (rund 6 MB). Schnelle Modi sind nach ein paar
// Sekunden erkannt, langsame (Scottie DX, PD180) brauchen 20 bis 25 Sekunden. Weil die Spur noch da ist, fehlen die ersten Zeilen
// trotzdem nicht: Es wird rückwärts bis zum ersten Impuls des Zuges gesucht. Wo ein Bild in Wirklichkeit anfing, weiß man ohne VIS nicht,
// die erste gehörte Zeile gilt als Bildanfang (E3, Befund 2).

import { FmDemod } from './demod.js';
import { findVis } from './vis.js';
import { decodeImage } from './decoder.js';
import { linesPerPacket, packetMs } from './modes.js';
import { decodeFskId, fskDauer } from './fskid.js';
import { detectTrains } from './blind.js';

const BEHALTEN_S = 4; // so viel Spur bleibt in der Suche stehen (Leitton + VIS dauern etwa 1,3 s)
const MIN_ZEILEN_PRUEFUNG = 20; // ab dieser Zeilenzahl wird ein Bild mit zu wenigen Sync-Treffern verworfen
const MIN_QUALITAET = 0.15;
const BLIND_ALLE_S = 3; // so oft wird beim Lauern nach einem Impulszug gesucht
const BLIND_MIN_S = 4; // erst ab so viel Spur lohnt sich die Suche
const BLIND_BEHALTEN_S = 48; // so viel Spur bleibt beim Lauern stehen, mehr als das längste Suchfenster
const BLIND_MIN_TREFFER = 24; // Sync-Treffer, die ein Zug mindestens haben muss (gegen Zufallstreffer im Rauschen)
// Suchfenster je Zeilendauer: ungefähr 40 Zeilen, damit auch langsame Modi ihre 24 Treffer unterbringen. Die Gruppen laufen getrennt,
// aber jeweils über alle Modi, damit der Abstand zum zweitbesten Modus (Fehlerschutz in blind.js) erhalten bleibt.
const BLIND_GRUPPEN = [{ bisP: 0.3, fensterS: 12 }, { bisP: 0.6, fensterS: 24 }, { bisP: Infinity, fensterS: 45 }];
const gruppeVon = (mode) => BLIND_GRUPPEN.find((g) => packetMs(mode) / 1000 < g.bisP);
const STUMM_MIN_S = 3; // ein ohne Kennung gestartetes Bild gilt als zu Ende, wenn so lange (mindestens 6 Zeilen) kein Sync mehr kommt
const KENNUNG_WARTEN_S = fskDauer('X'.repeat(9)) + 1.5; // so lange nach dem Bildende wird auf eine Rufzeichenkennung gewartet (längste Kennung plus Reserve)

export class LiveDecoder {
  /** opts: { updateS (Abstand der Bildaktualisierungen in Sekunden Audio, Vorgabe 1), searchS (Abstand der VIS-Suche, 0,5), demod,
   *  farbraum ('studio' | 'voll', siehe decodeImage) }. */
  constructor(fs, { updateS = 1, searchS = 0.5, demod, farbraum = 'studio', blind = true } = {}) {
    this.farbraum = farbraum;
    this.blind = blind; // Bilder ohne VIS über den Zeilentakt erkennen
    this.blindFrom = 0; // Impulse davor gehören zu schon erledigten Bildern
    this.letzteBlind = -Infinity;
    this.fs = fs;
    this.demod = new FmDemod(fs, demod);
    this.track = this.demod.track;
    this.updateS = updateS;
    this.searchS = searchS;
    this.zustand = 'suche';
    this.searchFrom = 0;
    this.lastWork = 0; // Spurende beim letzten Suchlauf bzw. Bildupdate
    this.cur = null;
    this.kennung = null; // wartet auf eine FSK-ID: { ab, bis, t, letzte }
    this.events = [];
  }

  /** Audio-Stück verarbeiten. Gibt die neuen Ereignisse zurück:
   *  { type: 'start', mode, vis, offsetHz, t }, { type: 'bild', mode, image, validLines, quality, final: false|true, t },
   *  { type: 'verworfen', mode, t }, { type: 'kennung', call, checksumOk, t } (FSK-ID nach einem vollständigen Bild).
   *  Bilder ohne VIS tragen blind: true (vis: null). 'bild' enthält offsetHz, den zuletzt gemessenen Frequenzversatz. */
  push(samples) {
    this.demod.push(samples);
    this.events = [];
    const tr = this.track;
    this._kennung(tr);
    if (this.zustand === 'suche') this._suche(tr);
    // Nach einem Fund kann sofort der Bildaufbau beginnen (zum Beispiel bei schnell eingespielten Dateien)
    if (this.zustand === 'bild') this._bild(tr);
    return this.events;
  }

  /** Dateiende oder Stopp: angefangenes Bild abschließen (Teilbild). */
  finish() {
    this.events = [];
    if (this.zustand === 'suche' && this.blind) this._blind(this.track, true); // das Dateiende zählt als letzte Gelegenheit
    if (this.zustand === 'bild') this._abschluss(true);
    this._kennung(this.track, true);
    return this.events;
  }

  _suche(tr) {
    if (tr.endTime - this.lastWork < this.searchS) return;
    this.lastWork = tr.endTime;
    const v = findVis(tr, this.searchFrom);
    if (!v) {
      this.searchFrom = Math.max(this.searchFrom, tr.endTime - BEHALTEN_S);
      tr.discardBefore(this._behalteAb(this.searchFrom));
      if (this.blind) this._blind(tr);
      return;
    }
    if (!v.mode || !v.parityOk) { this.searchFrom = v.imageStart; return; }
    this.zustand = 'bild';
    this.cur = { vis: v, mode: v.mode, packets: v.mode.height / linesPerPacket(v.mode), P: packetMs(v.mode) / 1000 };
    this.lastWork = -Infinity;
    this.events.push({ type: 'start', mode: v.mode, vis: v.vis, offsetHz: v.offsetHz, t: v.t });
  }

  /**
   * Sucht beim Lauern einen Zug von Sync-Impulsen, der gerade läuft. Dessen Modus und Takt stehen dann ohne VIS fest. Der erste Impuls
   * des Zuges gilt als Bildanfang. Ein Zug, der schon wieder zu Ende ist (letzter Impuls vor mehr als ein paar Zeilen), zählt nicht.
   */
  _blind(tr, sofort = false) {
    if (!sofort && tr.endTime - this.letzteBlind < BLIND_ALLE_S) return;
    this.letzteBlind = tr.endTime;
    const von = Math.max(tr.t0, this.blindFrom), bis = tr.endTime;
    if (bis - von < BLIND_MIN_S) return;
    for (const g of BLIND_GRUPPEN) {
      const zuege = detectTrains(tr, { from: von, to: bis, windowS: g.fensterS, hopS: g.fensterS / 2, minInliers: BLIND_MIN_TREFFER });
      for (const z of zuege) {
        if (gruppeVon(z.mode) !== g) continue;
        const letzte = z.t0 + z.kLast * z.P;
        if (letzte < bis - Math.max(STUMM_MIN_S, 6 * z.P)) continue; // schon vorbei
        const syncTime = z.t0 + z.kFirst * z.P;
        const vis = { vis: null, parityOk: true, mode: z.mode, offsetHz: 0, err: 0, imageStart: syncTime - 0.01, syncTime, t: syncTime };
        this.zustand = 'bild';
        this.cur = { vis, mode: z.mode, packets: z.mode.height / linesPerPacket(z.mode), P: z.P, blind: true, letzteSync: letzte, ppm: z.ppm };
        this.lastWork = -Infinity;
        this.events.push({ type: 'start', mode: z.mode, vis: null, offsetHz: 0, t: syncTime, blind: true });
        return;
      }
    }
  }

  _bild(tr) {
    const c = this.cur;
    const ende = c.vis.syncTime + (c.packets + 1.5) * c.P * 1.003;
    const fertig = tr.endTime >= ende;
    if (!fertig && tr.endTime - this.lastWork < this.updateS) return;
    this.lastWork = tr.endTime;
    const r = this._decode();
    const gelaufen = Math.floor((tr.endTime - c.vis.syncTime) / c.P);
    if (gelaufen >= MIN_ZEILEN_PRUEFUNG && r.found < MIN_QUALITAET * Math.min(gelaufen, c.packets)) {
      this.events.push({ type: 'verworfen', mode: c.mode, t: c.vis.t, blind: !!c.blind });
      this._zurueckZurSuche(c.vis.imageStart);
      return;
    }
    // Ohne VIS ist unklar, wo das Bild aufhört (man kann mittendrin eingestiegen sein): Kommt längere Zeit kein Sync mehr, ist es zu Ende
    if (c.blind && r.model?.hits?.length) c.letzteSync = Math.max(c.letzteSync, r.model.t0 + Math.max(...r.model.hits) * r.model.P);
    const stumm = !!c.blind && tr.endTime - c.letzteSync > Math.max(STUMM_MIN_S, 6 * c.P);
    if (fertig || stumm) { this._abschluss(false); return; } // Endbild: _abschluss rechnet voll
    this.events.push({ type: 'bild', mode: c.mode, image: r.image, validLines: r.validLines, quality: r.quality, final: false, t: c.vis.t, blind: !!c.blind, offsetHz: this._versatz(r) });
  }

  /**
   * Bild decodieren. Zwischenstände (voll = false) arbeiten inkrementell: Takt nur eng um den letzten Wert suchen, Sync-Impulse aus dem Speicher
   * und nur dahinter weitersuchen, fertige Zeilen übernehmen und nur die letzten vier Pakete neu abtasten. Das Endbild (voll = true) wird wie
   * bisher komplett gerechnet, mit dem endgültigen Takt für alle Zeilen. Bei PD240 sinkt so die Arbeit je Sekunde gegen Bildende auf einen Bruchteil.
   */
  _decode(voll = false) {
    const c = this.cur;
    const lpp = linesPerPacket(c.mode);
    const r = decodeImage(this.track, c.mode, {
      syncTime: c.vis.syncTime, offsetHz: c.vis.offsetHz, farbraum: this.farbraum, ppmHinweis: c.ppm ?? null,
      ...(voll ? {} : { syncCache: (c.syncCache ??= {}), wiederverwenden: c.vorher ? { data: c.vorher.data, bisZeile: Math.max(0, c.vorher.validLines - 4 * lpp) } : null }),
    });
    if (r.model) c.ppm = r.model.ppm; // der Takt ändert sich von Sekunde zu Sekunde kaum: nächstes Mal nur eng darum suchen
    // Eigene Kopie: Das Bild des Ereignisses geht im Worker per Übergabe an die Oberfläche und ist danach hier leer
    if (!voll) c.vorher = { data: new Uint8ClampedArray(r.image.data), validLines: r.validLines };
    return r;
  }

  _abschluss(teilbild, r = null) {
    const c = this.cur;
    r ??= this._decode(true);
    this.events.push({ type: 'bild', mode: c.mode, image: r.image, validLines: r.validLines, quality: r.quality, final: true, partial: r.validLines < c.mode.height, t: c.vis.t, blind: !!c.blind, offsetHz: this._versatz(r) });
    if (!teilbild && r.validLines >= c.mode.height) {
      const bildEnde = c.vis.syncTime + c.packets * c.P;
      this.kennung = { ab: bildEnde - 0.5, bis: bildEnde + KENNUNG_WARTEN_S, t: c.vis.t, zuletzt: -Infinity };
    }
    this._zurueckZurSuche(Math.max(c.vis.imageStart, this.track.endTime - (teilbild ? 0 : 1)));
  }

  _zurueckZurSuche(ab) {
    this.zustand = 'suche';
    this.cur = null;
    this.searchFrom = ab;
    this.blindFrom = ab; // alles davor ist erledigt, sonst fände die Blindsuche das gerade fertige Bild gleich noch mal
    this.lastWork = this.track.endTime;
    this.track.discardBefore(this._behalteAb(Math.max(ab, this.track.endTime - BEHALTEN_S)));
  }

  /** Frequenzversatz an der zuletzt decodierten Zeile (aus den Sync-Impulsen), vor der ersten Zeile der Wert vom Start. */
  _versatz(r) {
    const c = this.cur;
    if (!r.validLines) return c.vis.offsetHz;
    const k = Math.min(r.offsets.length - 1, Math.max(0, Math.floor(r.validLines / linesPerPacket(c.mode)) - 1));
    return r.offsets[k];
  }

  /** Bis wohin die Spur beim Verwerfen stehen bleiben muss: für die erwartete Kennung und für die Blindsuche. */
  _behalteAb(t) {
    let ab = t;
    if (this.kennung) ab = Math.min(ab, this.kennung.ab);
    if (this.blind) ab = Math.min(ab, Math.max(this.blindFrom, this.track.endTime - BLIND_BEHALTEN_S));
    return ab;
  }

  /** Sucht (höchstens alle searchS) die FSK-ID; meldet sie, sobald sie vollständig und mit gültiger Prüfsumme da ist, sonst am Ende der Wartezeit. */
  _kennung(tr, ende = false) {
    const k = this.kennung;
    if (!k) return;
    const abgelaufen = ende || tr.endTime >= k.bis;
    if (!abgelaufen && tr.endTime - k.zuletzt < this.searchS) return;
    k.zuletzt = tr.endTime;
    const r = decodeFskId(tr, k.ab);
    if (r && (r.checksumOk || abgelaufen)) { this.events.push({ type: 'kennung', call: r.call, checksumOk: r.checksumOk, t: k.t }); this.kennung = null; return; }
    if (abgelaufen) this.kennung = null;
  }
}
