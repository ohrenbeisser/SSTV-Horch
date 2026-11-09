// Bereich „Senden“: Bild laden, im Rahmen des Modus zurechtschieben (Ziehen und Zoom), Textfelder draufziehen, abspielen oder als
// WAV sichern. Auch hier lebt die Sitzung am Modul, ein Bereichswechsel kostet weder Bild noch Texte.
import { MODES, MODE_IDS, imageSeconds, preambleSeconds } from '../src/modes.js';
import { neueAnsicht, zoomeUm, verschiebe, ZOOM_MAX, ersetzePlatzhalter } from '../src/ausschnitt.js';
import { zeichne, rendereBild, TEXTFARBEN, BALKENFARBEN } from '../src/komposition.js';
import { encodeImage } from '../src/encoder.js';
import { encodeWav } from '../src/wav.js';
import { saeubereRufzeichen, fskDauer } from '../src/fskid.js';
import { SCHRIFTEN, STANDARD_SCHRIFT, ladeSchriften } from '../src/schriften.js';
import { setzeEinstellung as speichereEinstellung, einstellung } from '../src/settings.js';
import { datumText, uhrText, dateiStempel, dauerText as sekunden } from '../src/zeit.js';
import { setzeAusgang } from '../src/audiogeraete.js';
import { zahl } from '../src/i18n.js';
import { rapportInfo } from './rapportinfo.js';
import { setzeBeschaeftigt } from '../src/beschaeftigt.js';
import { sendePosition } from '../src/sendelinie.js';
import { leseVorlagen, speichereVorlage, loescheVorlage, texteAusVorlage, MAX_VORLAGEN, MAX_NAME } from '../src/vorlagen.js';
import { pruefeKamera } from '../src/kamera.js';
import { senderate } from '../src/frequenzmessung.js';
import { preambleSeconds as vorspannSekunden } from '../src/modes.js';

// Schnellwahl für neue Textfelder (Reihenfolge der Knöpfe). „text“ legt ein leeres Feld an (D62), die anderen fertige Texte mit Platzhaltern.
const SCHNELLWAHL = [
  ['text', null],
  ['call', '{call}'],
  ['cq', 'CQ CQ de {call}\n{loc}'],
  ['qso', '{gegen} de {call}\nUR RSV {rapport}'], // SSTV-Rapport ist dreistellig (RSV), nicht RST (Artikel)
  ['loc', '{loc}'],
  ['datum', '{datum}  {zeit}'],
];
const PLATZHALTER = ['call', 'loc', 'gegen', 'rapport', 'datum', 'zeit']; // zum Einfügen im Editor
// Der Encoder erzeugt mit Spitzenwert 0,8 (Reserve für Endstufe und ALC); der Pegelregler (10 bis 100 %) senkt das nur weiter ab.

const S = {
  modus: null, quelle: null, ansicht: null, balken: 'schwarz', texte: [], gewaehlt: null, naechsteId: 1, geloescht: null, kamera: null,
  angaben: { gegen: '', rapport: '595' }, fehler: '', status: '', fortschritt: 0, wiedergabe: null, rechnet: false, vorlagenOffen: false, ui: null,
};

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const modus = () => MODES[S.modus];
const gesamtSekunden = (m) => preambleSeconds() + imageSeconds(m);

/** Übergibt ein Bild (zum Beispiel aus der Galerie) als Quelle; modeId wählt den passenden Modus vor. */
export async function setzeQuelle(blob, modeId) {
  const bmp = await createImageBitmap(blob);
  S.quelle?.close?.();
  S.quelle = bmp;
  S.ansicht = null; // mount() richtet das Bild neu ein
  if (modeId && MODES[modeId]) { S.modus = modeId; speichereEinstellung('sendeModus', modeId); }
  S.fehler = '';
}

/**
 * Antwort auf ein empfangenes Bild vorbereiten (aus der Galerie): Gegenstelle eintragen, Modus übernehmen und, falls noch kein Text
 * da ist, einen QSO-Text anlegen. Ein Bild wird nicht mitgegeben, das sucht man sich selbst aus.
 */
export function bereiteAntwortVor(call, modeId, rapport = null) {
  S.angaben.gegen = String(call ?? '').toUpperCase();
  if (rapport) S.angaben.rapport = rapport; // Vorschlag aus dem Empfang, S (das ?) trägt man selbst ein
  if (modeId && MODES[modeId]) { S.modus = modeId; speichereEinstellung('sendeModus', modeId); }
  S.ansicht = null;
  if (!S.texte.some((x) => /\{gegen\}/.test(x.text))) {
    const schrift = einstellung('textSchrift');
    S.texte.push({ id: S.naechsteId++, text: '{gegen} de {call}\nUR RSV {rapport}', x: 0.5, y: 0.88, size: 0.1, farbe: 'weiss', kontur: true, schrift: SCHRIFTEN[schrift] ? schrift : STANDARD_SCHRIFT });
  }
  S.fehler = '';
}

export default function mount(wurzel, { t, symbol, einstellung, setzeEinstellung }) {
  S.modus ??= MODES[einstellung('sendeModus')] ? einstellung('sendeModus') : 'robot36';
  const werte = () => ({
    call: einstellung('call') || 'CALL', loc: einstellung('locator') || 'LOC', locator: einstellung('locator') || 'LOC', gegen: S.angaben.gegen || 'DX', rapport: S.angaben.rapport || '595',
    datum: datumText(Date.now(), einstellung('zeitanzeige')), zeit: uhrText(Date.now(), einstellung('zeitanzeige')),
  });
  const rahmen = () => { const m = modus(); return [m.width, m.height]; };
  const ansichtNeu = (art = S.ansicht?.modus ?? 'fill') => {
    if (!S.quelle) { S.ansicht = null; return; }
    const [rw, rh] = rahmen();
    S.ansicht = neueAnsicht(S.quelle.width, S.quelle.height, rw, rh, art);
  };
  if (S.quelle && !S.ansicht) ansichtNeu();

  // ---------------------------------------------------------------- Modus und Quelle
  const kModus = el('div', 'card');
  kModus.append(el('h2', 'title-md', t('senden.modus')));
  const auswahl = el('select');
  for (const id of MODE_IDS) {
    const m = MODES[id];
    const o = el('option', '', `${m.name} · ${m.width}×${m.height} · ${sekunden(gesamtSekunden(m))}`);
    o.value = id; auswahl.append(o);
  }
  auswahl.value = S.modus;
  const feldModus = el('label', 'feld'); feldModus.append(el('span', '', t('senden.modus.waehle')), auswahl);
  kModus.append(feldModus);

  const kQuelle = el('div', 'card');
  kQuelle.append(el('h2', 'title-md', t('senden.bild')));
  const eingabeDatei = el('input'); eingabeDatei.type = 'file'; eingabeDatei.accept = 'image/*'; eingabeDatei.hidden = true;
  const eingabeKamera = el('input'); eingabeKamera.type = 'file'; eingabeKamera.accept = 'image/*'; eingabeKamera.setAttribute('capture', 'environment'); eingabeKamera.hidden = true;
  const knopfDatei = el('button', 'btn tonal'); knopfDatei.type = 'button';
  knopfDatei.append(symbol('image'), document.createTextNode(t('senden.datei')));
  const knopfKamera = el('button', 'btn tonal'); knopfKamera.type = 'button';
  knopfKamera.append(symbol('photo_camera'), document.createTextNode(t('senden.kamera')));
  knopfKamera.hidden = S.kamera !== true; // erst zeigen, wenn eine Kamera erkannt ist (Handy oder Tablet)
  const aktQuelle = el('div', 'aktionen'); aktQuelle.append(knopfDatei, knopfKamera, eingabeDatei, eingabeKamera);
  kQuelle.append(aktQuelle);

  // ---------------------------------------------------------------- Vorschau (bleibt beim Scrollen oben stehen) und Bildausschnitt
  const vorschau = el('div', 'vorschau');
  const leinwand = el('canvas', 'sende-canvas');
  leinwand.setAttribute('role', 'img'); leinwand.setAttribute('aria-label', t('senden.editor'));
  leinwand.tabIndex = 0;
  // Die Linie läuft beim Senden über die Vorschau und zeigt die Zeile, die gerade übertragen wird
  const leinwandBox = el('div', 'leinwand-rahmen');
  const linie = el('div', 'sende-linie'); linie.setAttribute('aria-hidden', 'true');
  leinwandBox.append(leinwand, linie);
  vorschau.append(leinwandBox);

  const kEditor = el('div', 'card editor');
  kEditor.append(el('h2', 'title-md', t('senden.ausschnitt')));
  const hinweis = el('p', 'hint', '');
  const zoomFeld = el('label', 'regler'); const zoomText = el('span', 'label-lg');
  const zoom = el('input'); zoom.type = 'range'; zoom.min = '1'; zoom.max = String(ZOOM_MAX); zoom.step = '0.05'; zoom.value = '1';
  zoomFeld.append(zoomText, zoom);
  const fuellen = el('div', 'segmente');
  const bFuellen = el('button', '', t('senden.fuellen')); bFuellen.type = 'button';
  const bEinpassen = el('button', '', t('senden.einpassen')); bEinpassen.type = 'button';
  fuellen.append(bFuellen, bEinpassen);
  const balkenBox = el('div', 'farbwahl');
  const balkenKnoepfe = {};
  for (const k of Object.keys(BALKENFARBEN)) {
    const b = el('button', 'farbe'); b.type = 'button'; b.style.background = BALKENFARBEN[k]; b.setAttribute('aria-label', t(`senden.farbe.${k}`)); b.title = t(`senden.farbe.${k}`);
    b.addEventListener('click', () => { S.balken = k; ui.zeichneAlles(); });
    balkenKnoepfe[k] = b; balkenBox.append(b);
  }
  const balkenZeile = el('div', 'zeile'); balkenZeile.append(el('span', 'hint', t('senden.balken')), balkenBox);
  // Füllen/Einpassen und Zoom stehen in einer Zeile und brechen erst bei schmaler Breite um
  const ausschnittZeile = el('div', 'ausschnitt-zeile'); ausschnittZeile.append(fuellen, zoomFeld);
  kEditor.append(hinweis, ausschnittZeile, balkenZeile);

  // ---------------------------------------------------------------- Beschriftung: Liste der Texte, Editor unter der gewählten Zeile
  const kText = el('div', 'card');
  kText.append(el('h2', 'title-md', t('senden.texte')), el('p', 'hint', t('senden.texte.hilfe')));

  // Angaben, die in die Texte eingesetzt werden: erscheinen nur, wenn ein Text sie braucht
  const angaben = el('div', 'angaben-bedarf');
  angaben.append(el('p', 'label-lg', t('senden.angaben.titel')));
  const feld = (schluessel, wert, bei) => {
    const l = el('label', 'feld'); l.append(el('span', '', t(`senden.angabe.${schluessel}`)));
    const i = el('input'); i.type = 'text'; i.value = wert; i.autocomplete = 'off'; i.autocapitalize = 'characters'; i.addEventListener('input', () => { bei(i.value.trim()); ui.zeichneBild(); ui.zeichneTexte(false); });
    l.append(i); return l;
  };
  const gegenFeld = feld('gegen', S.angaben.gegen, (x) => { S.angaben.gegen = x.toUpperCase(); });
  const rapportEingabe = feld('rapport', S.angaben.rapport, (x) => { S.angaben.rapport = x; });
  const rapportFeld = el('div', 'feld-zeile'); rapportFeld.append(rapportEingabe, rapportInfo({ t, symbol }));
  const rapportS = el('p', 'hint body-sm', t('senden.rapport.s'));
  const stationInfo = el('p', 'hint body-sm');
  const stationAendern = el('button', 'btn text'); stationAendern.type = 'button'; stationAendern.textContent = t('senden.station.aendern');
  stationAendern.addEventListener('click', () => { location.hash = '#/einstellungen'; });
  const stationBox = el('div'); stationBox.append(stationInfo, stationAendern);
  angaben.append(gegenFeld, rapportFeld, rapportS, stationBox);

  const liste = el('ul', 'textliste');
  const leerText = el('p', 'hint', t('senden.texte.leer'));
  const hinzuLabel = el('p', 'label-lg', t('senden.hinzu'));
  const chips = el('div', 'chips');
  const undo = el('p', 'status'); undo.hidden = true; undo.setAttribute('role', 'status');
  // Vorlagen: Anordnung, Größe, Farbe und Schrift aller Texte unter einem Namen, mit den Platzhaltern (gespeichert in den Einstellungen)
  const vorlagen = el('details', 'vorlagen'); // Akkordeon: aufklappbar, der Zustand bleibt beim Bereichswechsel stehen
  const vKopf = el('summary');
  const vInhalt = el('div', 'vorlagen-inhalt');
  vorlagen.open = S.vorlagenOffen === true;
  vorlagen.addEventListener('toggle', () => { S.vorlagenOffen = vorlagen.open; });
  const vAuswahl = el('select');
  const vAuswahlFeld = el('label', 'feld'); vAuswahlFeld.append(el('span', '', t('senden.vorlage.gespeichert')), vAuswahl);
  const bLaden = el('button', 'btn tonal', t('senden.vorlage.laden')); bLaden.type = 'button';
  const bVorlageWeg = el('button', 'btn', t('senden.vorlage.loeschen')); bVorlageWeg.type = 'button';
  const vZeile1 = el('div', 'feld-zeile'); vZeile1.append(vAuswahlFeld, bLaden, bVorlageWeg);
  const vName = el('input'); vName.type = 'text'; vName.maxLength = MAX_NAME; vName.autocomplete = 'off';
  const vNameFeld = el('label', 'feld'); vNameFeld.append(el('span', '', t('senden.vorlage.name')), vName);
  const bVorlageSpeichern = el('button', 'btn tonal', t('senden.vorlage.speichern')); bVorlageSpeichern.type = 'button';
  const vZeile2 = el('div', 'feld-zeile'); vZeile2.append(vNameFeld, bVorlageSpeichern);
  const vStatus = el('p', 'status body-sm'); vStatus.setAttribute('role', 'status');
  vInhalt.append(el('p', 'hint body-sm', t('senden.vorlage.hinweis')), vZeile1, vZeile2, vStatus);
  vorlagen.append(vKopf, vInhalt);
  kText.append(angaben, el('p', 'label-lg liste-titel', t('senden.texte.liste')), liste, leerText, undo, hinzuLabel, chips, vorlagen);

  // ---------------------------------------------------------------- Senden
  const kSenden = el('div', 'card');
  kSenden.append(el('h2', 'title-md', t('senden.senden')));
  const pegel = el('input'); pegel.type = 'range'; pegel.min = '10'; pegel.max = '100'; pegel.step = '5'; pegel.value = String(einstellung('sendePegel'));
  const pegelText = el('span', 'label-lg');
  const pegelFeld = el('label', 'regler'); pegelFeld.append(pegelText, pegel);
  const pegelHinweis = el('p', 'hint body-sm', t('senden.pegel.hinweis'));
  const knopfSpiel = el('button', 'btn filled'); knopfSpiel.type = 'button';
  const knopfWav = el('button', 'btn'); knopfWav.type = 'button'; knopfWav.append(symbol('download'), document.createTextNode(t('senden.wav')));
  const fsk = el('input'); fsk.type = 'checkbox'; fsk.checked = einstellung('fskId') === 'an';
  const fskFeld = el('label', 'schalter'); fskFeld.append(fsk, document.createTextNode(t('senden.fsk')));
  const fskInfo = el('p', 'hint body-sm');
  const cal = el('input'); cal.type = 'checkbox'; cal.checked = einstellung('calKopf') === 'an';
  const calFeld = el('label', 'schalter'); calFeld.append(cal, document.createTextNode(t('senden.cal')));
  const calInfo = el('p', 'hint body-sm', t('senden.cal.info', { dauer: zahl(vorspannSekunden({ calHeader: true }) - vorspannSekunden(), 1) }));
  const taktInfo = el('p', 'hint body-sm');
  const aktSenden = el('div', 'aktionen'); aktSenden.append(knopfSpiel, knopfWav);
  const statusZeile = el('p', 'status'); statusZeile.setAttribute('role', 'status'); statusZeile.setAttribute('aria-live', 'polite');
  const balken = el('div', 'pegel-balken'); const fuell = el('div', 'pegel-fuell'); balken.append(fuell);
  const fehlerBand = el('div', 'warnband'); fehlerBand.setAttribute('role', 'alert');
  kSenden.append(pegelFeld, pegelHinweis, fskFeld, fskInfo, calFeld, calInfo, taktInfo, aktSenden, statusZeile, balken, fehlerBand);

  wurzel.append(kModus, kQuelle, vorschau, kEditor, kText, kSenden);

  // ---------------------------------------------------------------- Zeichnen
  const gewaehlt = () => S.texte.find((x) => x.id === S.gewaehlt) ?? null;
  let umrisse = [];
  const ctx = leinwand.getContext('2d');
  const anpassen = () => {
    const [rw, rh] = rahmen();
    // Breite so wählen, dass die Vorschau höchstens etwa ein Drittel der Fensterhöhe belegt (sie bleibt beim Scrollen stehen)
    const verfuegbar = (vorschau.clientWidth || 320) - 32;
    const maxHoehe = Math.min(480, Math.max(200, Math.round(window.innerHeight * 0.34)));
    leinwand.style.width = `${Math.max(160, Math.min(verfuegbar, Math.floor((maxHoehe * rw) / rh)))}px`;
    const breite = Math.max(160, Math.round(leinwand.clientWidth * Math.min(2, window.devicePixelRatio || 1)));
    if (leinwand.width !== breite || leinwand.height !== Math.round((breite * rh) / rw)) { leinwand.width = breite; leinwand.height = Math.round((breite * rh) / rw); }
    leinwand.style.aspectRatio = `${rw} / ${rh}`;
  };

  const ui = {
    zeichneBild() {
      anpassen();
      const W = leinwand.width, H = leinwand.height;
      umrisse = zeichne(ctx, W, H, S.quelle, S.ansicht ?? { modus: 'fill', zoom: 1, dx: 0, dy: 0 }, S.balken, S.texte, werte());
      const x = gewaehlt();
      const u = x && umrisse.find((o) => o.id === x.id);
      if (u) { // Auswahlrahmen nur im Editor
        ctx.save(); ctx.strokeStyle = '#c0001a'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
        ctx.strokeRect(u.x - 6, u.y - 4, u.w + 12, u.h + 8); ctx.restore();
      }
      hinweis.textContent = t(S.quelle ? 'senden.hinweis.bild' : 'senden.hinweis');
    },
    zeichneEditor() {
      const a = S.ansicht;
      zoom.disabled = !a; bFuellen.disabled = bEinpassen.disabled = !S.quelle;
      zoom.value = String(a ? a.zoom : 1);
      zoomText.textContent = `${t('senden.zoom')}: ${a ? a.zoom.toFixed(1) : '1.0'}×`;
      bFuellen.setAttribute('aria-pressed', String(!a || a.modus === 'fill'));
      bEinpassen.setAttribute('aria-pressed', String(!!a && a.modus === 'fit'));
      balkenZeile.hidden = !a || a.modus !== 'fit';
      for (const k of Object.keys(balkenKnoepfe)) balkenKnoepfe[k].setAttribute('aria-pressed', String(S.balken === k));
    },
    zeichneTexte(strukturell = true) { if (strukturell) baueListe(); else aktualisiereAngaben(); },
    zeichneSenden() {
      const spielt = !!S.wiedergabe;
      pegelText.textContent = `${t('senden.pegel')}: ${pegel.value} %`;
      knopfSpiel.replaceChildren(...(spielt ? [] : [symbol('campaign')]), document.createTextNode(t(spielt ? 'senden.stopp' : 'senden.abspielen')));
      const kenn = saeubereRufzeichen(einstellung('call'));
      fskInfo.textContent = !fsk.checked ? '' : kenn ? t('senden.fsk.info', { call: kenn, dauer: fskDauer(kenn).toFixed(1) }) : t('senden.fsk.leer');
      const ppm = Number(einstellung('taktPpm')) || 0;
      taktInfo.hidden = ppm === 0;
      taktInfo.textContent = ppm === 0 ? '' : t('senden.takt.info', { ppm: `${ppm > 0 ? '+' : ''}${ppm}` });
      knopfSpiel.disabled = !S.quelle || S.rechnet; // während der Berechnung gesperrt, sonst laufen bei einem Doppeltipp zwei Wiedergaben
      knopfWav.disabled = !S.quelle || spielt || S.rechnet;
      statusZeile.textContent = S.status;
      fuell.style.width = `${Math.round(S.fortschritt * 100)}%`;
      balken.hidden = !spielt;
      fehlerBand.textContent = S.fehler;
    },
    zeichneAlles() { ui.zeichneBild(); ui.zeichneEditor(); ui.zeichneTexte(); ui.zeichneSenden(); },
  };

  // ---------------------------------------------------------------- Ereignisse: Bild laden, Modus, Ansicht
  async function ladeBild(datei) {
    S.fehler = '';
    try {
      const bmp = await createImageBitmap(datei); // beachtet die EXIF-Drehung
      S.quelle?.close?.();
      S.quelle = bmp;
      ansichtNeu('fill');
    } catch (e) { S.fehler = t('senden.fehler.bild', { grund: e.message }); }
    ui.zeichneAlles();
  }
  if (S.kamera === null) pruefeKamera().then((ok) => { S.kamera = ok; knopfKamera.hidden = !ok; });
  knopfDatei.addEventListener('click', () => eingabeDatei.click());
  knopfKamera.addEventListener('click', () => eingabeKamera.click());
  for (const e of [eingabeDatei, eingabeKamera]) e.addEventListener('change', () => { const f = e.files[0]; e.value = ''; if (f) ladeBild(f); });

  auswahl.addEventListener('change', () => { S.modus = auswahl.value; setzeEinstellung('sendeModus', S.modus); ansichtNeu(); ui.zeichneAlles(); });
  bFuellen.addEventListener('click', () => { ansichtNeu('fill'); ui.zeichneAlles(); });
  bEinpassen.addEventListener('click', () => { ansichtNeu('fit'); ui.zeichneAlles(); });
  zoom.addEventListener('input', () => {
    if (!S.ansicht) return;
    const [rw, rh] = rahmen();
    S.ansicht = zoomeUm(S.ansicht, Number(zoom.value), 0.5, rh / rw / 2, S.quelle.width, S.quelle.height, rw, rh);
    ui.zeichneBild(); ui.zeichneEditor();
  });

  // ---------------------------------------------------------------- Ereignisse: Zeigen auf der Leinwand
  const zeiger = new Map();
  let ziehText = null, letzterAbstand = 0;
  const lokal = (e) => { const r = leinwand.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width) * leinwand.width, y: ((e.clientY - r.top) / r.height) * leinwand.height }; };
  const treffer = (p) => { for (let i = umrisse.length - 1; i >= 0; i--) { const u = umrisse[i]; if (p.x >= u.x - 12 && p.x <= u.x + u.w + 12 && p.y >= u.y - 12 && p.y <= u.y + u.h + 12) return u.id; } return null; };
  leinwand.addEventListener('pointerdown', (e) => {
    leinwand.setPointerCapture(e.pointerId);
    const p = lokal(e);
    zeiger.set(e.pointerId, p);
    if (zeiger.size === 1) {
      const id = treffer(p);
      ziehText = id;
      if (id !== null && id !== S.gewaehlt) { S.gewaehlt = id; ui.zeichneTexte(); } // ein Tipp daneben lässt die Auswahl und den Editor stehen
      ui.zeichneBild();
    } else if (zeiger.size === 2) {
      ziehText = null;
      const [a, b] = [...zeiger.values()];
      letzterAbstand = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });
  leinwand.addEventListener('pointermove', (e) => {
    if (!zeiger.has(e.pointerId)) return;
    const alt = zeiger.get(e.pointerId), p = lokal(e);
    zeiger.set(e.pointerId, p);
    const W = leinwand.width, H = leinwand.height;
    if (ziehText !== null) {
      const x = S.texte.find((q) => q.id === ziehText);
      if (x) { x.x = Math.min(1, Math.max(0, x.x + (p.x - alt.x) / W)); x.y = Math.min(1, Math.max(0, x.y + (p.y - alt.y) / H)); ui.zeichneBild(); }
    } else if (S.ansicht) {
      const [rw, rh] = rahmen();
      if (zeiger.size === 1) S.ansicht = verschiebe(S.ansicht, (p.x - alt.x) / W, (p.y - alt.y) / W, S.quelle.width, S.quelle.height, rw, rh);
      else if (zeiger.size === 2) {
        const [a, b] = [...zeiger.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (letzterAbstand > 0) S.ansicht = zoomeUm(S.ansicht, S.ansicht.zoom * (d / letzterAbstand), ((a.x + b.x) / 2) / W, ((a.y + b.y) / 2) / W, S.quelle.width, S.quelle.height, rw, rh);
        letzterAbstand = d;
      }
      ui.zeichneBild(); ui.zeichneEditor();
    }
  });
  const loslassen = (e) => { zeiger.delete(e.pointerId); if (zeiger.size < 2) letzterAbstand = 0; if (zeiger.size === 0) ziehText = null; };
  leinwand.addEventListener('pointerup', loslassen);
  leinwand.addEventListener('pointercancel', loslassen);
  leinwand.addEventListener('wheel', (e) => {
    if (!S.ansicht) return;
    e.preventDefault();
    const p = lokal(e), [rw, rh] = rahmen();
    S.ansicht = zoomeUm(S.ansicht, S.ansicht.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), p.x / leinwand.width, p.y / leinwand.width, S.quelle.width, S.quelle.height, rw, rh);
    ui.zeichneBild(); ui.zeichneEditor();
  }, { passive: false });
  // Tastatur: Pfeile verschieben das gewählte Textfeld (sonst das Bild), + und − zoomen
  leinwand.addEventListener('keydown', (e) => {
    const schritt = e.shiftKey ? 0.05 : 0.01;
    const d = { ArrowLeft: [-schritt, 0], ArrowRight: [schritt, 0], ArrowUp: [0, -schritt], ArrowDown: [0, schritt] }[e.key];
    const x = gewaehlt();
    if (d && x) { x.x = Math.min(1, Math.max(0, x.x + d[0])); x.y = Math.min(1, Math.max(0, x.y + d[1])); }
    else if (d && S.ansicht) { const [rw, rh] = rahmen(); S.ansicht = verschiebe(S.ansicht, -d[0], -d[1], S.quelle.width, S.quelle.height, rw, rh); }
    else return;
    e.preventDefault(); ui.zeichneBild(); ui.zeichneEditor();
  });

  // ---------------------------------------------------------------- Beschriftung: Liste, Editor, Schnellwahl
  // Neue Felder landen dort, wo noch keins liegt: erst unten, dann oben, dann Mitte (statt alle übereinander)
  const freieHoehe = () => {
    for (const y of [0.88, 0.12, 0.5, 0.7, 0.3]) if (!S.texte.some((x) => Math.abs(x.y - y) < 0.14)) return y;
    return 0.88;
  };
  const aufgeloest = (x) => ersetzePlatzhalter(x.text, werte());
  const kurz = (x) => { const z = aufgeloest(x).split('\n'); return (z[0].trim() || t('senden.text.leerzeile')) + (z.length > 1 ? ' …' : ''); };

  function neuerText(text) {
    const zuletzt = einstellung('textSchrift');
    const x = { id: S.naechsteId++, text, x: 0.5, y: freieHoehe(), size: 0.1, farbe: 'weiss', kontur: true, schrift: SCHRIFTEN[zuletzt] ? zuletzt : STANDARD_SCHRIFT };
    S.texte.push(x); S.gewaehlt = x.id; S.geloescht = null;
    ui.zeichneBild(); baueListe(true);
    return x;
  }

  function aktualisiereAngaben() {
    const alle = S.texte.map((x) => x.text).join('\n');
    const gegen = /\{gegen\}/.test(alle), rapport = /\{rapport\}/.test(alle), station = /\{(call|loc|locator)\}/.test(alle);
    gegenFeld.hidden = !gegen; rapportFeld.hidden = !rapport; stationBox.hidden = !station;
    rapportS.hidden = !rapport || !S.angaben.rapport.includes('?'); // solange ein ? drinsteht, wird er mitgesendet
    angaben.hidden = !(gegen || rapport || station);
    const c = einstellung('call'), l = einstellung('locator');
    stationInfo.textContent = c || l ? t('senden.station.info', { call: c || '–', loc: l || '–' }) : t('senden.station.leer');
    for (const z of liste.querySelectorAll('[data-vorschau]')) { const x = S.texte.find((q) => q.id === Number(z.dataset.vorschau)); if (x) z.textContent = kurz(x); }
    for (const z of liste.querySelectorAll('[data-aufbild]')) { const x = S.texte.find((q) => q.id === Number(z.dataset.aufbild)); if (x) z.textContent = t('senden.text.vorschau', { text: aufgeloest(x).replace(/\n/g, ' / ') }); }
  }

  function baueEditor(x) {
    const box = el('div', 'text-editor');
    const ta = el('textarea'); ta.rows = 2; ta.value = x.text; ta.setAttribute('aria-label', t('senden.text.inhalt'));
    const vorschauZeile = el('p', 'hint body-sm'); vorschauZeile.dataset.aufbild = String(x.id);
    ta.addEventListener('input', () => { x.text = ta.value; ui.zeichneBild(); aktualisiereAngaben(); });
    const platz = el('div', 'chips klein');
    platz.append(el('span', 'hint body-sm', t('senden.text.platzhalter')));
    for (const k of PLATZHALTER) {
      const b = el('button', 'chip mono'); b.type = 'button'; b.textContent = `{${k}}`; b.title = t(`senden.platz.${k}`);
      b.addEventListener('click', () => {
        const von = ta.selectionStart ?? ta.value.length, bis = ta.selectionEnd ?? ta.value.length;
        ta.setRangeText(`{${k}}`, von, bis, 'end'); ta.focus(); ta.dispatchEvent(new Event('input'));
      });
      platz.append(b);
    }
    const schrift = el('select');
    for (const k of Object.keys(SCHRIFTEN)) { const o = el('option', '', t(`senden.schrift.${k}`)); o.value = k; o.style.fontFamily = SCHRIFTEN[k].css; schrift.append(o); }
    schrift.value = SCHRIFTEN[x.schrift] ? x.schrift : STANDARD_SCHRIFT;
    schrift.addEventListener('change', () => { x.schrift = schrift.value; setzeEinstellung('textSchrift', schrift.value); ui.zeichneBild(); });
    const schriftFeld = el('label', 'feld'); schriftFeld.append(el('span', '', t('senden.text.schrift')), schrift);
    const groesse = el('input'); groesse.type = 'range'; groesse.min = '0.04'; groesse.max = '0.3'; groesse.step = '0.005'; groesse.value = String(x.size);
    groesse.addEventListener('input', () => { x.size = Number(groesse.value); ui.zeichneBild(); });
    const groesseFeld = el('label', 'regler'); groesseFeld.append(el('span', 'label-lg', t('senden.text.groesse')), groesse);
    const farbBox = el('div', 'farbwahl'); const farbKnoepfe = {};
    for (const k of Object.keys(TEXTFARBEN)) {
      const b = el('button', 'farbe'); b.type = 'button'; b.style.background = TEXTFARBEN[k]; b.setAttribute('aria-label', t(`senden.farbe.${k}`)); b.title = t(`senden.farbe.${k}`);
      b.setAttribute('aria-pressed', String(x.farbe === k));
      b.addEventListener('click', () => { x.farbe = k; for (const [n, kn] of Object.entries(farbKnoepfe)) kn.setAttribute('aria-pressed', String(n === k)); ui.zeichneBild(); });
      farbKnoepfe[k] = b; farbBox.append(b);
    }
    const kontur = el('input'); kontur.type = 'checkbox'; kontur.checked = x.kontur;
    kontur.addEventListener('change', () => { x.kontur = kontur.checked; ui.zeichneBild(); });
    const konturFeld = el('label', 'schalter'); konturFeld.append(kontur, document.createTextNode(t('senden.text.kontur')));
    const farbZeile = el('div', 'zeile'); farbZeile.append(el('span', 'hint', t('senden.text.farbe')), farbBox, konturFeld);
    const fertig = el('button', 'btn tonal'); fertig.type = 'button'; fertig.textContent = t('senden.text.fertig');
    fertig.addEventListener('click', () => { S.gewaehlt = null; ui.zeichneBild(); baueListe(); });
    const loesch = el('button', 'btn'); loesch.type = 'button'; loesch.append(symbol('delete'), document.createTextNode(t('senden.text.loeschen')));
    loesch.addEventListener('click', () => loescheText(x));
    const akt = el('div', 'aktionen'); akt.append(fertig, loesch);
    box.append(ta, vorschauZeile, platz, schriftFeld, el('p', 'hint body-sm', t('senden.schrift.hinweis')), groesseFeld, farbZeile, akt);
    return { box, ta };
  }

  function baueListe(fokus = false) {
    liste.replaceChildren();
    S.texte.forEach((x, i) => {
      const offen = x.id === S.gewaehlt;
      const li = el('li', 'textzeile'); li.dataset.offen = String(offen);
      const kopf = el('div', 'textzeile-kopf');
      const auf = el('button', 'textzeile-auf'); auf.type = 'button'; auf.setAttribute('aria-expanded', String(offen));
      const nr = el('span', 'textnr', String(i + 1));
      const vorsch = el('span', 'textvorschau', kurz(x)); vorsch.dataset.vorschau = String(x.id);
      auf.append(nr, vorsch);
      auf.addEventListener('click', () => { S.gewaehlt = offen ? null : x.id; ui.zeichneBild(); baueListe(!offen); });
      const weg = el('button', 'icon-btn'); weg.type = 'button'; weg.setAttribute('aria-label', t('senden.text.loeschen')); weg.title = t('senden.text.loeschen'); weg.append(symbol('delete'));
      weg.addEventListener('click', () => loescheText(x));
      kopf.append(auf, weg); li.append(kopf);
      if (offen) { const e = baueEditor(x); li.append(e.box); if (fokus) { setTimeout(() => { li.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); e.ta.focus(); }, 0); } }
      liste.append(li);
    });
    leerText.hidden = S.texte.length > 0;
    undo.hidden = !S.geloescht;
    aktualisiereAngaben();
  }

  // ---------------------------------------------------------------- Vorlagen speichern, laden, löschen
  let vTimer = 0;
  const holeVorlagen = () => leseVorlagen(einstellung('textVorlagen'));
  const speichereListe = (l) => setzeEinstellung('textVorlagen', JSON.stringify(l));
  /** Meldung unter den Vorlagen, optional mit „Rückgängig“; verschwindet nach 10 Sekunden. */
  function meldeVorlage(text, zurueck = null) {
    vStatus.replaceChildren(document.createTextNode(text));
    if (zurueck) {
      const b = el('button', 'btn text', t('senden.text.rueckgaengig')); b.type = 'button';
      b.addEventListener('click', () => { zurueck(); vStatus.textContent = ''; });
      vStatus.append(document.createTextNode(' '), b);
    }
    clearTimeout(vTimer); vTimer = setTimeout(() => { vStatus.textContent = ''; }, 10000);
  }
  function zeichneVorlagen(wahl = vAuswahl.value) {
    const l = holeVorlagen();
    vAuswahl.replaceChildren();
    if (!l.length) { const o = el('option', '', t('senden.vorlage.keine')); o.value = ''; vAuswahl.append(o); }
    for (const v of l) { const o = el('option', '', `${v.name} (${v.texte.length})`); o.value = v.name; vAuswahl.append(o); }
    if (l.some((v) => v.name === wahl)) vAuswahl.value = wahl;
    vAuswahl.disabled = bLaden.disabled = bVorlageWeg.disabled = !l.length;
    vKopf.textContent = `${t('senden.vorlage.titel')} (${l.length})`;
  }
  vAuswahl.addEventListener('change', () => { vName.value = vAuswahl.value; }); // den Namen gleich zum Überschreiben anbieten
  bLaden.addEventListener('click', () => {
    const v = holeVorlagen().find((x) => x.name === vAuswahl.value);
    if (!v) return;
    const alt = { texte: S.texte, gewaehlt: S.gewaehlt };
    S.texte = texteAusVorlage(v, S.naechsteId); S.naechsteId += S.texte.length; S.gewaehlt = null; S.geloescht = null;
    ui.zeichneBild(); baueListe();
    meldeVorlage(t('senden.vorlage.geladen', { name: v.name }), () => { S.texte = alt.texte; S.gewaehlt = alt.gewaehlt; ui.zeichneBild(); baueListe(); });
  });
  bVorlageSpeichern.addEventListener('click', () => {
    const name = vName.value.trim();
    const l = holeVorlagen();
    if (!name) { meldeVorlage(t('senden.vorlage.fehler.name')); return; }
    if (!S.texte.length) { meldeVorlage(t('senden.vorlage.fehler.leer')); return; }
    if (l.length >= MAX_VORLAGEN && !l.some((v) => v.name.toLowerCase() === name.toLowerCase())) { meldeVorlage(t('senden.vorlage.fehler.voll', { n: MAX_VORLAGEN })); return; }
    const neu = speichereVorlage(l, name, S.texte);
    speichereListe(neu);
    zeichneVorlagen(neu.find((v) => v.name.toLowerCase() === name.toLowerCase())?.name);
    meldeVorlage(t('senden.vorlage.gespeichert.ok', { name }), () => { speichereListe(l); zeichneVorlagen(); });
  });
  bVorlageWeg.addEventListener('click', () => {
    const name = vAuswahl.value, l = holeVorlagen();
    if (!name) return;
    speichereListe(loescheVorlage(l, name));
    zeichneVorlagen();
    meldeVorlage(t('senden.vorlage.geloescht', { name }), () => { speichereListe(l); zeichneVorlagen(name); });
  });

  let undoTimer = 0;
  function loescheText(x) {
    const index = S.texte.indexOf(x);
    S.texte = S.texte.filter((q) => q !== x);
    if (S.gewaehlt === x.id) S.gewaehlt = null;
    S.geloescht = { x, index };
    undo.replaceChildren(document.createTextNode(`${t('senden.text.geloescht')} `));
    const zurueck = el('button', 'btn text'); zurueck.type = 'button'; zurueck.textContent = t('senden.text.rueckgaengig');
    zurueck.addEventListener('click', () => {
      if (!S.geloescht) return;
      S.texte.splice(Math.min(S.geloescht.index, S.texte.length), 0, S.geloescht.x);
      S.gewaehlt = S.geloescht.x.id; S.geloescht = null; clearTimeout(undoTimer);
      ui.zeichneBild(); baueListe(true);
    });
    undo.append(zurueck);
    clearTimeout(undoTimer); undoTimer = setTimeout(() => { S.geloescht = null; undo.hidden = true; }, 10000);
    ui.zeichneBild(); baueListe();
  }

  for (const [k, text] of SCHNELLWAHL) {
    const b = el('button', 'chip'); b.type = 'button'; b.textContent = t(`senden.chip.${k}`);
    b.addEventListener('click', () => neuerText(text ?? ''));
    chips.append(b);
  }

  // ---------------------------------------------------------------- Ereignisse: Senden
  cal.addEventListener('change', () => { setzeEinstellung('calKopf', cal.checked ? 'an' : 'aus'); ui.zeichneSenden(); });
  fsk.addEventListener('change', () => { setzeEinstellung('fskId', fsk.checked ? 'an' : 'aus'); ui.zeichneSenden(); });
  pegel.addEventListener('input', () => {
    setzeEinstellung('sendePegel', Number(pegel.value));
    if (S.wiedergabe) S.wiedergabe.gain.gain.value = Number(pegel.value) / 100;
    ui.zeichneSenden();
  });
  const erzeuge = (mitKorrektur = false) => {
    const m = modus();
    const bild = rendereBild(S.quelle, S.ansicht, S.balken, S.texte, werte(), m);
    // Taktkorrektur dieses Geräts (Labor, Einstellungen): gerechnet wird mit etwas anderer Rate, abgespielt mit 48000 (siehe senderate).
    // Nur beim direkten Abspielen: Eine WAV-Datei kann auf einem anderen Gerät laufen, dann wäre die Korrektur falsch.
    const rate = senderate(48000, mitKorrektur ? Number(einstellung('taktPpm')) || 0 : 0);
    return encodeImage(bild, m, { sampleRate: rate, amplitude: 0.8, calHeader: cal.checked, fskId: fsk.checked ? saeubereRufzeichen(einstellung('call')) : '' });
  };
  const warte = async () => { await new Promise((r) => setTimeout(r, 30)); await ladeSchriften(); }; // erst die Statusmeldung zeichnen lassen, dann sicher sein, dass die Schriften geladen sind

  async function abspielen() {
    if (S.rechnet || S.wiedergabe) return;
    S.fehler = ''; S.rechnet = true;
    S.status = t('senden.status.berechne'); S.fortschritt = 0; ui.zeichneSenden();
    await warte();
    let ac = null;
    try {
      const enc = erzeuge(true);
      ac = new AudioContext({ sampleRate: 48000 });
      await setzeAusgang(ac, einstellung('audioAusgang')); // gewählter Lautsprecher oder Soundkarte (siehe Einstellungen)
      const puffer = ac.createBuffer(1, enc.samples.length, 48000);
      puffer.copyToChannel(enc.samples, 0);
      const quelle = ac.createBufferSource(); quelle.buffer = puffer;
      const gain = ac.createGain(); gain.gain.value = Number(pegel.value) / 100;
      quelle.connect(gain).connect(ac.destination);
      const dauer = enc.durationS;
      const w = { ac, quelle, gain, dauer, timer: 0, wake: null, modus: modus(), cal: cal.checked, t0: 0 };
      S.wiedergabe = w; setzeBeschaeftigt('wiedergabe', true);
      quelle.onended = () => beende(w, true);
      await ac.resume();
      w.t0 = ac.currentTime; // die Uhr des Audiokontexts läuft schon, die Wiedergabe beginnt jetzt
      quelle.start();
      S.ui?.laufLinie();
      navigator.wakeLock?.request('screen').then((l) => { w.wake = l; }).catch(() => {});
      w.timer = setInterval(() => {
        const s = Math.min(dauer, Math.max(0, ac.currentTime - w.t0));
        S.fortschritt = s / dauer;
        const pos = sendePosition(w.modus, s, { calHeader: w.cal });
        S.status = t('senden.status.laeuft', { vergangen: sekunden(s), rest: sekunden(Math.max(0, dauer - s)) })
          + (pos.phase === 'bild' ? ` ${t('senden.status.zeile', { zeile: pos.zeile, hoehe: w.modus.height })}` : '');
        S.ui?.zeichneSenden(); // S.ui, nicht ui: nach einem Bereichswechsel gehört die Anzeige der neuen Ansicht
      }, 250);
      S.status = t('senden.status.laeuft', { vergangen: '0:00', rest: sekunden(dauer) });
    } catch (e) { ac?.close().catch(() => {}); S.wiedergabe = null; setzeBeschaeftigt('wiedergabe', false); S.status = ''; S.fehler = t('senden.fehler.audio', { grund: e.message }); }
    S.rechnet = false;
    S.ui?.zeichneSenden();
  }
  function beende(w, fertig) {
    if (S.wiedergabe !== w) return;
    clearInterval(w.timer);
    try { w.quelle.onended = null; w.quelle.stop(); } catch { /* schon beendet */ }
    w.ac.close().catch(() => {});
    w.wake?.release().catch(() => {});
    S.wiedergabe = null; S.fortschritt = 0; setzeBeschaeftigt('wiedergabe', false);
    S.status = t(fertig ? 'senden.status.fertig' : 'senden.status.abgebrochen');
    if (S.ui) S.ui.zeichneSenden();
  }
  knopfSpiel.addEventListener('click', () => (S.wiedergabe ? beende(S.wiedergabe, false) : abspielen()));
  knopfWav.addEventListener('click', async () => {
    if (S.rechnet) return;
    S.fehler = ''; S.rechnet = true;
    S.status = t('senden.status.berechne'); ui.zeichneSenden();
    await warte();
    try {
      const enc = erzeuge();
      const faktor = Number(pegel.value) / 100;
      const x = new Float32Array(enc.samples.length);
      for (let i = 0; i < x.length; i++) x[i] = enc.samples[i] * faktor;
      const blob = new Blob([encodeWav(x, 48000)], { type: 'audio/wav' });
      const a = el('a'); a.href = URL.createObjectURL(blob);
      a.download = `sstv_${S.modus}_${dateiStempel(Date.now(), einstellung('zeitanzeige'))}.wav`;
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      S.status = t('senden.status.wav', { dauer: sekunden(enc.durationS) });
    } catch (e) { S.status = ''; S.fehler = t('senden.fehler.audio', { grund: e.message }); }
    S.rechnet = false;
    S.ui?.zeichneSenden();
  });

  zeichneVorlagen(); vName.value = vAuswahl.value;
  // Linie per Animationsbild nachführen (sauberer als alle 250 ms); gehört zu dieser Ansicht und hört auf, wenn sie abgebaut wird
  let rafId = 0;
  ui.laufLinie = () => {
    cancelAnimationFrame(rafId);
    const w = S.wiedergabe;
    if (!w) { linie.style.display = 'none'; return; }
    const schritt = () => {
      if (S.ui !== ui || S.wiedergabe !== w) { if (S.ui === ui) linie.style.display = 'none'; return; }
      // Hörbar ist, was schon durch die Ausgabe ist: die Ausgabeverzögerung (falls der Browser sie nennt) abziehen
      const s = Math.max(0, w.ac.currentTime - w.t0 - (w.ac.outputLatency || 0));
      const pos = sendePosition(w.modus, s, { calHeader: w.cal });
      if (pos.phase === 'bild') {
        linie.style.display = 'block';
        linie.style.transform = `translateY(${Math.round(pos.anteil * leinwand.clientHeight)}px)`;
      } else linie.style.display = 'none';
      rafId = requestAnimationFrame(schritt);
    };
    rafId = requestAnimationFrame(schritt);
  };
  S.ui = ui;
  ui.laufLinie(); // läuft schon eine Wiedergabe (Bereich zwischendurch gewechselt), geht die Linie hier weiter
  ladeSchriften().then(() => { if (S.ui === ui) ui.zeichneBild(); }); // nach dem Laden der Schriften neu zeichnen
  const beobachter = new ResizeObserver(() => ui.zeichneBild());
  beobachter.observe(vorschau);
  const beiFenster = () => ui.zeichneBild();
  window.addEventListener('resize', beiFenster);
  ui.zeichneAlles();
  return { unmount() { beobachter.disconnect(); window.removeEventListener('resize', beiFenster); clearTimeout(undoTimer); clearTimeout(vTimer); cancelAnimationFrame(rafId); S.ui = null; } };
}
