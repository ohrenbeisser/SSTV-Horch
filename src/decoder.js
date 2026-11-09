// Der Bilddecoder, er arbeitet auf der Frequenzspur.
// Zeilentakt: aus allen Sync-Impulsen geschätzt (src/sync.js, Hough plus Regression). Das bügelt Taktfehler der Soundkarte aus, das
// Bild steht gerade statt schief. Frequenzversatz: je Zeile am 1200-Hz-Sync gemessen und über die Nachbarzeilen geglättet, folgt also
// auch einem wandernden Versatz. Pixel: zeitlich nach der Modustabelle abgetastet, Wert = Mittel der Frequenz über die Pixeldauer.
// Fehlt das VIS, rät src/blind.js den Modus aus dem Takt der Sync-Impulse.

import { layout, linesPerPacket, packetMs } from './modes.js';
import { yccInRgba, yccVollInRgba, freqToValue } from './color.js';
import { F_SYNC, F_BLACK, F_WHITE } from './constants.js';
import { demodulate } from './demod.js';
import { findAllVis } from './vis.js';
import { collectSyncs, fitLineModel } from './sync.js';
import { detectTrains, splitTrain } from './blind.js';

const END_GUARD_MS = 0.9; // siehe scan() in decodeImage
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Decodiert ein Bild.
 * opts: { syncTime (s, grobe Zeit des ersten Sync-Impulses), offsetHz (Anfangswert), align: 'model'|'nominal', periodMs,
 *         model: { t0, P } (Zeilenmodell von außen, zum Beispiel aus der Blindsuche), validPackets (Anzahl gültiger Sendezeilen),
 *         trackOffset (Versatz je Zeile am Sync messen, Vorgabe an),
 *         farbraum: 'studio' (Vorgabe, Y 16..235 nach Spezifikation) | 'voll' (kompatible Helligkeit wie slowrx, nur Robot 36 und PD),
 *         ppmHinweis: Taktfehler aus einem früheren Durchgang (Live-Betrieb), dann wird nur ±60 ppm darum gesucht, mit voller Suche als Rückfall,
 *         syncCache: Objekt, in dem die gefundenen Sync-Impulse zwischen Aufrufen auf wachsender Spur liegen bleiben (nur hinter dem letzten wird gesucht),
 *         wiederverwenden: { data, bisZeile }: Bildzeilen vor bisZeile aus data übernehmen statt neu abzutasten (Live-Zwischenstände) }.
 * 'model' schätzt Beginn und Periode aus den Sync-Impulsen, 'nominal' nimmt syncTime und periodMs als gegeben.
 * Gibt { image, syncTimes, found, model, validLines, quality, offsets } zurück. Nicht decodierte Zeilen haben Alpha 0.
 *  validLines: Bildzeilen mit Daten (Teilbild, wenn kleiner als die Bildhöhe). quality: Anteil der Sendezeilen mit Sync-Treffer (0 bis 1).
 */
export function decodeImage(track, mode, { syncTime, offsetHz = 0, align = 'model', periodMs = packetMs(mode), model: given = null,
  validPackets = null, trackOffset = true, farbraum = 'studio', ppmHinweis = null, syncCache = null, wiederverwenden = null } = {}) {
  const ycc = farbraum === 'voll' ? yccVollInRgba : yccInRgba;
  const parts = layout(mode);
  const lpp = linesPerPacket(mode);
  const w = mode.width, h = mode.height;
  const Pnom = periodMs / 1000;
  const packets = h / lpp;

  let model = given;
  // Taktsuche: mit Vorwissen (Live: Takt aus der Sekunde davor) nur ein enges Fenster, das spart gut 95 % der Schritte; findet das nichts, volle Suche
  const passe = (c) => (ppmHinweis !== null && fitLineModel(c, syncTime, Pnom, packets, { ppmMitte: ppmHinweis, maxPpm: 60 })) || fitLineModel(c, syncTime, Pnom, packets);
  // Sync-Impulse: mit Zwischenspeicher nur hinter dem letzten fertigen Impuls weitersuchen (zwei Sync-Längen Abstand, dort liegt Bildinhalt über der
  // Schwelle). Die Spur davor ändert sich nicht mehr, ihre Impulse auch nicht.
  const sammle = (von, bis) => {
    const z = syncCache;
    if (!z) return collectSyncs(track, von, bis, mode.syncMs, offsetHz);
    const s = mode.syncMs / 1000;
    if (z.von !== von || z.off !== offsetHz || z.syncMs !== mode.syncMs || !z.c) {
      Object.assign(z, { von, off: offsetHz, syncMs: mode.syncMs, c: collectSyncs(track, von, bis, mode.syncMs, offsetHz), ende: track.endTime });
      return z.c;
    }
    // Impulse dicht am damaligen Spurende wurden mit halbem Glättungsfenster gemessen: die nicht behalten, sondern neu suchen
    const behalten = z.c.filter((t) => t + 2 * s + 0.002 < z.ende);
    z.c = behalten.length // nichts Sicheres übrig: von vorn, sonst fehlte womöglich der erste Impuls gleich nach dem VIS
      ? behalten.concat(collectSyncs(track, behalten[behalten.length - 1] + 2 * s, bis, mode.syncMs, offsetHz, { ohneAnfangslauf: true, gitter: von }))
      : collectSyncs(track, von, bis, mode.syncMs, offsetHz);
    z.ende = track.endTime;
    return z.c;
  };
  if (!model && align === 'model') {
    const tEnd = syncTime + (packets + 2) * Pnom * 1.003;
    model = passe(sammle(syncTime - 0.1, tEnd));
    // Wandert der Versatz (zum Beispiel SSB-Empfang ohne Nachführung), verlieren die Schwellen der Sync-Suche am Anfangswert Impulse.
    // Dann Versatz an den Treffern messen, als Gerade über die Zeit anpassen und die Kandidaten mit mitlaufender Schwelle neu sammeln.
    if (model && trackOffset && model.hits.length >= 12) {
      const s = mode.syncMs / 1000;
      const pts = [];
      for (const k of model.hits) {
        const t = model.t0 + k * model.P;
        const f = track.mean(t + 0.3 * s, t + 0.7 * s);
        if (!Number.isNaN(f) && Math.abs(f - F_SYNC - offsetHz) < 250) pts.push([t, f - F_SYNC]);
      }
      if (pts.length >= 12) {
        const n = pts.length;
        let st = 0, sf = 0, stt = 0, stf = 0;
        for (const [t, f] of pts) { st += t; sf += f; stt += t * t; stf += t * f; }
        const den = n * stt - st * st;
        const b = Math.abs(den) > 1e-9 ? (n * stf - st * sf) / den : 0;
        const a = (sf - b * st) / n;
        const spanS = pts[n - 1][0] - pts[0][0];
        if (Math.abs(b) * (packets * Pnom) > 30 || Math.abs(b) * spanS > 30) {
          const model2 = passe(collectSyncs(track, syncTime - 0.1, tEnd, mode.syncMs, (t) => a + b * t));
          if (model2 && model2.inliers > model.inliers) model = model2;
        }
      }
    }
  }
  const t0 = model ? model.t0 : syncTime;
  const P = model ? model.P : Pnom;
  const hits = model?.hits ? new Set(model.hits) : null;

  // Wie viele Sendezeilen enthalten Daten? Ende der Aufnahme und (beim Zeilenmodell) letzte Zeile mit Sync-Treffer begrenzen.
  let valid = validPackets ?? packets;
  if (validPackets === null) {
    while (valid > 0 && t0 + (valid - 1) * P + P * 0.5 > track.endTime) valid--;
    if (hits && hits.size) {
      const last = Math.max(...hits);
      if (last < packets - 4) valid = Math.min(valid, last + 3);
    }
  }
  valid = Math.max(0, Math.min(packets, valid));

  const syncTimes = [];
  for (let k = 0; k < packets; k++) syncTimes.push(t0 + k * P);

  // Versatz je Zeile: Mittel über den Kern des Sync-Impulses, gleitender Median über ±5 Zeilen
  const offsets = new Float64Array(packets).fill(offsetHz);
  if (trackOffset) {
    const raw = new Float64Array(packets).fill(NaN);
    const s = mode.syncMs / 1000;
    for (let k = 0; k < valid; k++) {
      if (hits && !hits.has(k)) continue;
      const f = track.mean(syncTimes[k] + 0.3 * s, syncTimes[k] + 0.7 * s);
      if (!Number.isNaN(f) && Math.abs(f - F_SYNC - offsetHz) < 250) raw[k] = f - F_SYNC;
    }
    for (let k = 0; k < packets; k++) {
      const v = [];
      for (let j = Math.max(0, k - 5); j <= Math.min(packets - 1, k + 5); j++) if (!Number.isNaN(raw[j])) v.push(raw[j]);
      if (v.length >= 3) { v.sort((a, b) => a - b); offsets[k] = v[v.length >> 1]; }
    }
  }

  // lineEnd: Der Abschnitt ist der letzte der Zeile, danach folgt gleich der 1200-Hz-Sync der nächsten (Robot 36: Chroma, PD: Y1, Scottie: Blau).
  // Der Tiefpass des Demodulators verschmiert den Sprung auf 1200 Hz etwa 0,9 ms in die letzten Pixel (Robot 36 zeigte dort grüne
  // Randstreifen). Diese Pixel übernehmen deshalb den Wert des letzten ungestörten Pixels.
  const scan = (ts, ms, off, lineEnd = false) => {
    const row = new Float32Array(w);
    const per = ms / 1000 / w;
    track.meanRow(ts, per, w, row); // erst die mittleren Frequenzen aller Pixel, dann in Werte umrechnen
    let last = 0;
    for (let x = 0; x < w; x++) {
      const f = row[x];
      row[x] = Number.isNaN(f) ? last : clamp(freqToValue(f - off));
      last = row[x];
    }
    if (lineEnd) {
      const n = Math.min(w - 2, Math.ceil(END_GUARD_MS / 1000 / per));
      row.fill(row[w - n - 1], w - n);
    }
    return row;
  };

  // Ebenen: RGB-Modi liefern R, G, B; YCrCb-Modi Y (und Chroma, je nach Modus)
  const planes = { R: [], G: [], B: [], Y: [], Cr: [], Cb: [] };
  // Übernommene Zeilen: abgetastet wird erst ein Paket vor der ersten neuen Zeile (Robot 36 braucht die Farbe der Zeile davor)
  const bisZeile = wiederverwenden ? Math.min(wiederverwenden.bisZeile, valid * lpp) : 0;
  const kStart = Math.max(0, Math.floor(bisZeile / lpp) - 1);
  for (let k = kStart; k < valid; k++) {
    const tSync = syncTimes[k], off = offsets[k];
    const yRow = k * lpp;
    if (mode.family === 'martin' || mode.family === 'scottie' || mode.family === 'wraase') {
      // lineEnd: Scottie (Blau) und Wraase (Blau) hängen direkt vor dem nächsten Sync, Martin hat noch einen Trenner dazwischen
      for (const p of parts) if (p.kind === 'scan') planes[p.ch][yRow] = scan(tSync + p.startMs / 1000, p.ms, off, mode.family !== 'martin' && p.ch === 'B');
    } else if (mode.family === 'robot72') {
      for (const p of parts) {
        if (p.kind !== 'scan') continue;
        // Jeder der drei Kanäle endet vor einem Frequenzsprung (Y auf den 1500-Hz-Trenner, R-Y auf den 2300-Hz-Trenner, B-Y auf den Sync). Anders als bei
        // Robot 36, wo sich der Sprung über gerade und ungerade Zeilen mittelt, steht er hier in jeder Zeile gleich: alle Ränder schützen.
        const row = scan(tSync + p.startMs / 1000, p.ms, off, true);
        if (p.ch === 'Y') planes.Y[yRow] = row; else if (p.ch === 'RY') planes.Cr[yRow] = row; else planes.Cb[yRow] = row;
      }
    } else if (mode.family === 'robot36') {
      // Separator 1500 Hz: folgende Chromazeile ist R-Y, 2300 Hz: B-Y
      const sep = parts.find((q) => q.kind === 'sep');
      const fSep = track.mean(tSync + (sep.startMs + 0.6) / 1000, tSync + (sep.startMs + sep.ms - 0.6) / 1000) - off;
      const chroma = fSep > (F_BLACK + F_WHITE) / 2 ? planes.Cb : planes.Cr;
      for (const p of parts) {
        if (p.kind !== 'scan') continue;
        const row = scan(tSync + p.startMs / 1000, p.ms, off, p.ch !== 'Y');
        if (p.ch === 'Y') planes.Y[yRow] = row; else chroma[yRow] = row;
      }
    } else if (mode.family === 'pd') {
      for (const p of parts) {
        if (p.kind !== 'scan') continue;
        const row = scan(tSync + p.startMs / 1000, p.ms, off, p.ch === 'Y1');
        if (p.ch === 'Y0') planes.Y[yRow] = row;
        else if (p.ch === 'Y1') planes.Y[yRow + 1] = row;
        else if (p.ch === 'RY') { planes.Cr[yRow] = row; planes.Cr[yRow + 1] = row; }
        else planes.Cb[yRow] = planes.Cb[yRow + 1] = row;
      }
    }
  }

  const data = new Uint8ClampedArray(w * h * 4);
  const grey = new Float32Array(w).fill(128);
  const nearest = (arr, y) => { // nächstliegende vorhandene Zeile (für Chroma mit Lücken)
    for (let d = 0; d < h; d++) {
      if (arr[y - d]) return arr[y - d];
      if (arr[y + d]) return arr[y + d];
    }
    return grey;
  };
  const validLines = valid * lpp;
  if (bisZeile > 0) data.set(wiederverwenden.data.subarray(0, bisZeile * w * 4));
  for (let y = bisZeile; y < validLines; y++) {
    let r, g, b;
    if (mode.family === 'martin' || mode.family === 'scottie' || mode.family === 'wraase') {
      r = planes.R[y]; g = planes.G[y]; b = planes.B[y];
    }
    const Y = planes.Y[y];
    // Robot 36: R-Y liegt auf geraden, B-Y auf ungeraden Zeilen und gilt für diese und die folgende Zeile
    let cr, cb;
    if (mode.family === 'robot36') {
      cr = y % 2 === 0 ? planes.Cr[y] : (planes.Cr[y - 1] ?? nearest(planes.Cr, y));
      cb = y % 2 === 1 ? planes.Cb[y] : (planes.Cb[y - 1] ?? nearest(planes.Cb, y));
      cr ??= nearest(planes.Cr, y); cb ??= nearest(planes.Cb, y);
    } else if (mode.family === 'pd' || mode.family === 'robot72') { cr = planes.Cr[y]; cb = planes.Cb[y]; }
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (r) { data[i] = r[x]; data[i + 1] = g[x]; data[i + 2] = b[x]; }
      else if (Y) ycc(data, i, Y[x], cr ? cr[x] : 128, cb ? cb[x] : 128);
      data[i + 3] = 255;
    }
  }
  const found = model ? (model.hits ? model.hits.filter((k) => k >= 0 && k < packets).length : (model.inliers ?? 0)) : 0;
  return { image: { width: w, height: h, data }, syncTimes, found, model, validLines, quality: Math.min(1, found / packets), offsets };
}

/**
 * Ganze Aufnahme: demodulieren, alle VIS suchen und decodieren, danach in den übrigen Abschnitten Bilder ohne VIS aus dem Takt der
 * Sync-Impulse suchen (opts.blind = false schaltet das ab).
 * Gibt { track, results } zurück; je Bild { vis, mode, offsetHz, t (Beginn des Startbits bzw. der ersten Zeile), image, validLines,
 * quality, found, syncTimes, model, blind (true ohne VIS), suspect (Qualität unter 15 %) }. Unbekannte Modi liefern kein Bild.
 */
export function decodeRecording(samples, fs, opts = {}) {
  const track = demodulate(samples, fs, opts.demod);
  const out = [];
  const exclude = [];
  for (const v of findAllVis(track)) {
    if (!v.mode || !v.parityOk) { out.push({ ...v, image: null, blind: false }); continue; }
    const r = decodeImage(track, v.mode, { syncTime: v.syncTime, offsetHz: v.offsetHz, ...opts.image });
    const packets = v.mode.height / linesPerPacket(v.mode);
    const end = (r.model ? r.model.t0 + packets * r.model.P : v.syncTime + packets * packetMs(v.mode) / 1000) + 1;
    exclude.push([v.t - 1.2, end]);
    out.push({ ...v, ...r, blind: false, suspect: r.quality < 0.15 });
  }
  if (opts.blind !== false) {
    for (const train of detectTrains(track, { exclude, ...opts.detect })) {
      for (const seg of splitTrain(train)) {
        const r = decodeImage(track, train.mode, { model: { t0: seg.t0, P: seg.P }, validPackets: seg.lines, ...opts.image });
        out.push({ vis: null, parityOk: null, mode: train.mode, offsetHz: null, t: seg.t0, ...r, found: seg.lines,
          quality: Math.min(1, seg.lines / (train.mode.height / linesPerPacket(train.mode))), blind: true, ppm: train.ppm, suspect: false });
      }
    }
  }
  out.sort((a, b) => a.t - b.t);
  return { track, results: out };
}
