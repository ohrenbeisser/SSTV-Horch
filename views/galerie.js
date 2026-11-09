// Bereich „Galerie“: empfangene Bilder (auch Teilbilder) aus IndexedDB, mit Metadaten, Speichern, Teilen, Weitergabe an Senden,
// Löschen (einzeln und im Rudel), Sicherung und Wiederherstellung als ZIP, Speicheranzeige und die Bitte um dauerhaften Speicher (D7, D13).
import { MODES } from '../src/modes.js';
import { saeubereRufzeichen } from '../src/fskid.js';
import { liste, loesche, importiere, speicherInfo, dauerhaftAnfordern, ergaenze, verschobenesPng, verschiebeEintrag, beiAenderung as beiGalerieAenderung } from '../src/galerie.js';
import { filtere, modiVorhanden, ZEITRAEUME } from '../src/galeriefilter.js';
import { baueArchiv, leseArchiv, leseLogbuch, dateiname } from '../src/archiv.js';
import { aktuelleSprache, zahl } from '../src/i18n.js';
import { zeitAnzeige, dateiStempel, normalisiereZeitmodus } from '../src/zeit.js';
import { rapportMitS, rapportText } from '../src/rapport.js';
import { rapportInfo, rapportFelder } from './rapportinfo.js';
import { erzeugeLogbuch } from './logbuch.js';
import { liste as logListe, importiere as logImportiere } from '../src/logbuch.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const mb = (b) => (b < 1048576 ? `${zahl(b / 1024, 0)} KB` : `${zahl(b / 1048576, b < 10485760 ? 1 : 0)} MB`);
const gb = (b) => (b >= 1073741824 ? `${zahl(b / 1073741824, 1)} GB` : mb(b));

const FILTER = { text: '', modus: '', zeitraum: 'alle' }; // bleibt beim Wechsel des Bereichs stehen
const filterAktiv = () => !!(FILTER.text.trim() || FILTER.modus || FILTER.zeitraum !== 'alle');

function laden(blob, name) {
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export default function mount(wurzel, { t, symbol, einstellung, setzeEinstellung }) {
  let eintraege = [];
  let auswahlModus = false;
  const gewaehlt = new Set();
  const urls = new Map(); // id -> Objekt-URL der Vorschau; bleibt über Neuzeichnen hinweg, sonst entsteht bei jedem Antippen alles neu
  let loeschBestaetigt = false;
  let meldung = '';
  const zeitmodus = () => normalisiereZeitmodus(einstellung('zeitanzeige'));
  const zeit = (ms) => zeitAnzeige(ms, zeitmodus(), aktuelleSprache());
  const modusName = (id) => MODES[id]?.name ?? id;

  // ---------------------------------------------------------------- Kopf: Aktionen
  const leiste = el('div', 'aktionen');
  const knopfAuswahl = el('button', 'btn tonal'); knopfAuswahl.type = 'button';
  const knopfZip = el('button', 'btn'); knopfZip.type = 'button';
  const knopfEinlesen = el('button', 'btn'); knopfEinlesen.type = 'button';
  const eingabeZip = el('input'); eingabeZip.type = 'file'; eingabeZip.accept = '.zip,application/zip'; eingabeZip.hidden = true;
  leiste.append(knopfAuswahl, knopfZip, knopfEinlesen, eingabeZip);
  const meldungBand = el('p', 'status'); meldungBand.setAttribute('role', 'status'); meldungBand.setAttribute('aria-live', 'polite');
  const fehlerBand = el('div', 'warnband'); fehlerBand.setAttribute('role', 'alert');

  // Leiste der Auswahl
  const auswahlLeiste = el('div', 'auswahlleiste');
  const auswahlText = el('span', 'label-lg');
  const knopfAlle = el('button', 'btn text'); knopfAlle.type = 'button';
  const knopfLoeschen = el('button', 'btn'); knopfLoeschen.type = 'button';
  auswahlLeiste.append(auswahlText, knopfAlle, knopfLoeschen);

  // Filter: Suchtext (Rufzeichen oder Modus), Modus, Zeitraum
  const filterBox = el('div', 'filterleiste');
  const fText = el('input'); fText.type = 'search'; fText.autocomplete = 'off'; fText.value = FILTER.text;
  const fTextFeld = el('label', 'feld'); fTextFeld.append(el('span', '', t('galerie.filter.suche')), fText);
  const fModus = el('select');
  const fModusFeld = el('label', 'feld'); fModusFeld.append(el('span', '', t('galerie.filter.modus')), fModus);
  const fZeit = el('select');
  for (const z of ZEITRAEUME) { const o = el('option', '', t(`galerie.filter.z.${z}`)); o.value = z; fZeit.append(o); }
  fZeit.value = FILTER.zeitraum;
  const fZeitFeld = el('label', 'feld'); fZeitFeld.append(el('span', '', t('galerie.filter.zeitraum')), fZeit);
  const fZurueck = el('button', 'btn text', t('galerie.filter.zurueck')); fZurueck.type = 'button';
  const fAnzahl = el('p', 'hint body-sm filter-anzahl');
  filterBox.append(fTextFeld, fModusFeld, fZeitFeld, fZurueck);

  const raster = el('div', 'kachelraster');
  const leer = el('p', 'hint', t('galerie.leer'));
  const keineTreffer = el('p', 'hint', t('galerie.filter.leer'));

  // ---------------------------------------------------------------- Logbuch (D60)
  const log = erzeugeLogbuch({ t, symbol, einstellung, modusName, zeit });

  // ---------------------------------------------------------------- Speicher
  const kSpeicher = el('div', 'card');
  kSpeicher.append(el('h2', 'title-md', t('galerie.speicher')));
  const speicherText = el('p');
  const dauerText = el('p', 'hint body-sm');
  const knopfDauer = el('button', 'btn tonal'); knopfDauer.type = 'button'; knopfDauer.textContent = t('galerie.dauerhaft');
  const aktSpeicher = el('div', 'aktionen'); aktSpeicher.append(knopfDauer);
  kSpeicher.append(speicherText, dauerText, aktSpeicher, el('p', 'hint body-sm', t('galerie.auto.hinweis')));

  // ---------------------------------------------------------------- Detailansicht
  const dialog = el('dialog', 'galerie-dialog');
  dialog.setAttribute('aria-label', t('galerie.detail'));
  const dBild = el('img', 'galerie-gross'); dBild.alt = '';
  const dInfo = el('dl', 'tabelle');
  const dKnopf = (text, icon, klasse = 'btn') => { const b = el('button', klasse); b.type = 'button'; if (icon) b.append(symbol(icon)); b.append(document.createTextNode(text)); return b; };
  const bAntwort = dKnopf('', 'campaign', 'btn filled gd-haupt'); // Hauptaktion, nur mit Rufzeichen
  const bSenden = dKnopf(t('galerie.senden.kurz'), 'image');
  const bSpeichern = dKnopf(t('galerie.png.kurz'), 'download');
  const bRoh = dKnopf(t('galerie.roh.kurz'), 'download');
  // Weitere Aktionen im Menü: Teilen und Löschen (Löschen mit zweitem Tipp zur Bestätigung)
  const bMenue = el('button', 'icon-btn gd-menue-knopf'); bMenue.type = 'button'; bMenue.append(symbol('more_vert'));
  bMenue.setAttribute('aria-label', t('galerie.menue')); bMenue.title = t('galerie.menue'); bMenue.setAttribute('aria-haspopup', 'menu'); bMenue.setAttribute('aria-expanded', 'false');
  const menue = el('div', 'gd-menue'); menue.setAttribute('role', 'menu'); menue.hidden = true;
  const mEintrag = (icon) => { const b = el('button', 'gd-menue-eintrag'); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.append(symbol(icon)); b.append(el('span')); return b; };
  const bLog = mEintrag('check'); bLog.lastChild.textContent = t('galerie.log');
  const bTeilen = mEintrag('upload'); bTeilen.lastChild.textContent = t('galerie.teilen');
  const bLoeschen = mEintrag('delete'); bLoeschen.classList.add('gefahr');
  menue.append(bLog, bTeilen, bLoeschen);
  const dAkt = el('div', 'gd-aktionen');
  const dZweite = el('div', 'gd-zweite');
  const menueBox = el('div', 'gd-menue-box'); menueBox.append(bMenue, menue);
  dZweite.append(bSenden, bSpeichern, bRoh, menueBox);
  dAkt.append(bAntwort, dZweite);
  const setzeMenue = (auf) => { menue.hidden = !auf; bMenue.setAttribute('aria-expanded', String(auf)); };

  // Bildanfang verschieben (nur Bilder ohne VIS: Dort ist der Anfang nur geschätzt). Positiv schiebt das Bild nach unten, die Zeilen oben bleiben leer.
  const vBox = el('div', 'verschieben');
  vBox.append(el('h3', 'label-lg', t('galerie.versch.titel')), el('p', 'hint body-sm', t('galerie.versch.hinweis')));
  const vRegler = el('input'); vRegler.type = 'range'; vRegler.step = '1'; vRegler.setAttribute('aria-label', t('galerie.versch.titel'));
  const vWert = el('span', 'mono versch-wert');
  const schritt = (text, d) => { const b = el('button', 'btn text', text); b.type = 'button'; b.addEventListener('click', () => { vRegler.value = String(Math.max(Number(vRegler.min), Math.min(Number(vRegler.max), Number(vRegler.value) + d))); vRegler.dispatchEvent(new Event('input')); }); return b; };
  const vZeile = el('div', 'versch-zeile'); vZeile.append(schritt('−10', -10), schritt('−1', -1), vRegler, schritt('+1', 1), schritt('+10', 10), vWert);
  const bAnwenden = el('button', 'btn tonal', t('galerie.versch.anwenden')); bAnwenden.type = 'button';
  const bUnverschoben = el('button', 'btn text', t('galerie.versch.zurueck')); bUnverschoben.type = 'button';
  const vAkt = el('div', 'aktionen'); vAkt.append(bAnwenden, bUnverschoben);
  const vMeldung = el('p', 'status body-sm'); vMeldung.setAttribute('role', 'status');
  vBox.append(vZeile, vAkt, vMeldung);
  // Kopfzeile, Rufzeichen und Rapport stehen immer da, die technischen Angaben sind zugeklappt
  const dKopf = el('p', 'gd-kopf');
  const dAngaben = el('div', 'gd-angaben'); // Rufzeichen und Rapport als Text, „Bearbeiten“ öffnet die Eingabefelder
  const rapportKnopf = rapportInfo({ t, symbol }); // einmal gebaut: Ein offener Dialog darf beim Neuzeichnen nicht neu entstehen
  const dDetails = el('details', 'akk'); dDetails.append(el('summary', '', t('galerie.info.technik')), dInfo);
  const gdBild = el('div', 'gd-bild'); gdBild.append(dBild, vBox);
  const gdSeite = el('div', 'gd-seite'); gdSeite.append(dKopf, dAngaben, dDetails, dAkt);
  const gdRaster = el('div', 'gd-raster'); gdRaster.append(gdBild, gdSeite);
  dialog.append(gdRaster);
  let offen = null; // geöffneter Eintrag
  let dUrl = null;

  wurzel.append(leiste, meldungBand, fehlerBand, filterBox, fAnzahl, auswahlLeiste, raster, leer, keineTreffer, log.karte, kSpeicher, dialog, log.dialog);

  // ---------------------------------------------------------------- Zeichnen
  const modusAnzeige = (id) => modusName(id);
  const sichtbar = () => filtere(eintraege, FILTER, { zeitmodus: zeitmodus(), modusName: modusAnzeige });
  const aufraeumen = () => { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); };
  const vorschauUrl = (e) => {
    let u = urls.get(e.id);
    if (!u) { u = URL.createObjectURL(e.vorschau); urls.set(e.id, u); }
    return u;
  };
  // Nur die URLs gelöschter Bilder freigeben, der Rest wird weiterverwendet
  const raeumeVerwaiste = () => { const da = new Set(eintraege.map((e) => e.id)); for (const [id, u] of urls) if (!da.has(id)) { URL.revokeObjectURL(u); urls.delete(id); } };

  function zeichneRaster() {
    raeumeVerwaiste();
    raster.replaceChildren();
    const zeige = sichtbar();
    for (const e of zeige) {
      const k = el('button', 'kachel'); k.type = 'button';
      k.setAttribute('aria-pressed', String(gewaehlt.has(e.id)));
      const img = el('img'); img.src = vorschauUrl(e); img.alt = ''; img.loading = 'lazy';
      const teil = e.partial ? t('galerie.teil', { zeilen: e.validLines, hoehe: e.height }) : `${Math.round(e.quality * 100)} %`;
      const beschr = el('span', 'kachel-text');
      beschr.append(el('strong', '', modusName(e.modeId)), document.createTextNode(` · ${zeit(e.t)}`), el('br'), document.createTextNode(teil));
      if (e.partial) k.classList.add('teilbild');
      k.append(img, beschr);
      if (gewaehlt.has(e.id)) k.append(symbol('check'));
      k.addEventListener('click', () => (auswahlModus ? wechsleAuswahl(e.id) : oeffneDetail(e)));
      raster.append(k);
    }
    leer.hidden = eintraege.length > 0;
    keineTreffer.hidden = !(eintraege.length > 0 && zeige.length === 0);
    filterBox.hidden = fAnzahl.hidden = eintraege.length === 0;
    fAnzahl.textContent = filterAktiv() ? t('galerie.filter.anzahl', { n: zeige.length, m: eintraege.length }) : '';
    fZurueck.hidden = !filterAktiv();
  }

  // Modusliste des Filters aus den vorhandenen Bildern; eine Wahl, die es nicht mehr gibt, fällt weg
  function fuelleModusFilter() {
    const da = modiVorhanden(eintraege);
    if (FILTER.modus && !da.includes(FILTER.modus)) FILTER.modus = '';
    fModus.replaceChildren();
    const alle = el('option', '', t('galerie.filter.alle')); alle.value = ''; fModus.append(alle);
    for (const id of da) { const o = el('option', '', modusName(id)); o.value = id; fModus.append(o); }
    fModus.value = FILTER.modus;
  }

  function zeichneLeiste() {
    knopfAuswahl.replaceChildren(document.createTextNode(t(auswahlModus ? 'galerie.auswahl.ende' : 'galerie.auswahl')));
    knopfAuswahl.disabled = eintraege.length === 0;
    knopfZip.replaceChildren(symbol('download'), document.createTextNode(t(auswahlModus && gewaehlt.size ? 'galerie.zip.auswahl' : 'galerie.zip.alle')));
    knopfZip.disabled = eintraege.length === 0;
    knopfEinlesen.replaceChildren(symbol('upload'), document.createTextNode(t('galerie.einlesen')));
    auswahlLeiste.hidden = !auswahlModus;
    auswahlText.textContent = t('galerie.gewaehlt', { n: gewaehlt.size });
    knopfAlle.textContent = t(gewaehlt.size === sichtbar().length ? 'galerie.keine' : 'galerie.alle');
    knopfLoeschen.replaceChildren(symbol('delete'), document.createTextNode(loeschBestaetigt ? t('galerie.loeschen.sicher', { n: gewaehlt.size }) : t('galerie.loeschen')));
    knopfLoeschen.disabled = gewaehlt.size === 0;
    meldungBand.textContent = meldung;
  }

  async function zeichneSpeicher() {
    const s = await speicherInfo();
    const summe = eintraege.reduce((a, e) => a + (e.bytes ?? 0), 0);
    speicherText.textContent = s.nutzung !== null && s.kontingent
      ? t('galerie.speicher.info', { n: eintraege.length, bilder: mb(summe), nutzung: mb(s.nutzung), kontingent: gb(s.kontingent) })
      : t('galerie.speicher.kurz', { n: eintraege.length, bilder: mb(summe) });
    dauerText.textContent = s.dauerhaft === null ? t('galerie.dauerhaft.unbekannt') : t(s.dauerhaft ? 'galerie.dauerhaft.ja' : 'galerie.dauerhaft.nein');
    knopfDauer.hidden = s.dauerhaft !== false;
  }

  async function aktualisiere() {
    try {
      eintraege = await liste();
      for (const id of [...gewaehlt]) if (!eintraege.some((e) => e.id === id)) gewaehlt.delete(id);
      fuelleModusFilter();
      fehlerBand.textContent = '';
    } catch (e) { fehlerBand.textContent = t('galerie.fehler', { grund: e.message }); eintraege = []; }
    zeichneRaster(); zeichneLeiste(); zeichneSpeicher();
  }

  function wechsleAuswahl(id) {
    if (gewaehlt.has(id)) gewaehlt.delete(id); else gewaehlt.add(id);
    loeschBestaetigt = false;
    zeichneRaster(); zeichneLeiste();
  }

  // ---------------------------------------------------------------- Detail
  let detailLoeschen = false;
  function zeichneDetailKnoepfe() {
    bLoeschen.lastChild.textContent = detailLoeschen ? t('galerie.loeschen.sicher1') : t('galerie.loeschen');
  }
  const wavName = (e) => dateiname(e, zeitmodus()).replace(/\.png$/, '_roh.wav');
  let vTimer = 0;
  // Vorschau der Verschiebung im Bild des Dialogs; immer vom Original aus gerechnet
  function zeigeVerschiebung() {
    vWert.textContent = t('galerie.versch.wert', { n: `${Number(vRegler.value) > 0 ? '+' : ''}${vRegler.value}` });
    bAnwenden.disabled = Number(vRegler.value) === (offen?.verschiebung ?? 0);
    clearTimeout(vTimer);
    vTimer = setTimeout(async () => {
      if (!offen) return;
      const wert = Number(vRegler.value), basis = offen.pngOriginal ?? offen.png;
      const blob = wert === 0 ? basis : (await verschobenesPng(basis, wert)).png;
      if (!offen || Number(vRegler.value) !== wert) return; // inzwischen weitergeschoben oder geschlossen
      if (dUrl) URL.revokeObjectURL(dUrl);
      dUrl = URL.createObjectURL(blob);
      dBild.src = dUrl;
    }, 60);
  }

  /** „Antworten an …“ gibt es, sobald ein Rufzeichen da ist (aus der FSK-ID oder von Hand). */
  function zeigeAntwortKnopf(e) {
    bAntwort.hidden = !e.call;
    if (e.call) bAntwort.replaceChildren(symbol('campaign'), document.createTextNode(t('galerie.antworten', { call: e.call })));
    bSenden.classList.toggle('filled', !e.call); // ohne Rufzeichen ist „Zum Senden“ die Hauptaktion
    bSenden.classList.toggle('gd-haupt', !e.call);
  }

  /**
   * Rufzeichen und Rapport: als Text, mit „Bearbeiten“ daneben. Im Bearbeiten-Modus Eingabefeld für das Rufzeichen (Großbuchstaben, nur
   * Zeichen, die auch die FSK-ID kennt) und Auswahl für R, S und V, mit „Speichern“ und „Abbrechen“.
   */
  function zeigeAngaben(e, bearbeiten) {
    const zeile = (...kinder) => { const z = el('div', 'gd-zeile'); z.append(...kinder); return z; };
    if (!bearbeiten) {
      const herkunft = e.call ? el('span', 'hint body-sm', t(e.callManuell ? 'galerie.info.call.hand' : 'galerie.info.call.fsk')) : '';
      const bBearbeiten = el('button', 'btn text'); bBearbeiten.type = 'button';
      bBearbeiten.append(symbol('edit'), document.createTextNode(t('galerie.edit.knopf')));
      bBearbeiten.addEventListener('click', () => zeigeAngaben(e, true));
      dAngaben.replaceChildren(
        zeile(el('span', 'label-lg', t('galerie.info.call')), el('span', 'mono gd-wert', e.call || '–'), herkunft),
        zeile(el('span', 'label-lg', t('galerie.info.rapport')), el('span', 'mono gd-wert', rapportText(e.rapportR, e.rapportS, e.rapportV) || '–'), rapportKnopf),
        bBearbeiten,
      );
      return;
    }
    const feld = el('input', 'call-feld'); feld.type = 'text'; feld.maxLength = 20; feld.value = e.call ?? '';
    feld.placeholder = t('galerie.info.call.leer'); feld.autocapitalize = 'characters'; feld.spellcheck = false;
    feld.setAttribute('aria-label', t('galerie.info.call'));
    const rf = rapportFelder({ t });
    rf.setze(e.rapportR, e.rapportS, e.rapportV);
    const bSpeichern = el('button', 'btn tonal', t('galerie.edit.speichern')); bSpeichern.type = 'button';
    const bAbbrechen = el('button', 'btn text', t('galerie.edit.abbrechen')); bAbbrechen.type = 'button';
    const akt = el('div', 'aktionen'); akt.append(bSpeichern, bAbbrechen);
    bAbbrechen.addEventListener('click', () => zeigeAngaben(e, false));
    feld.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); bSpeichern.click(); } }); // Eingabetaste speichert
    bSpeichern.addEventListener('click', async () => {
      const neu = saeubereRufzeichen(feld.value);
      const { r, s: sw, v } = rf.werte();
      const callManuell = neu ? (neu !== (e.call ?? '') ? true : e.callManuell) : undefined; // geändert: von Hand; unverändert: Herkunft bleibt
      try {
        await ergaenze(e.id, { call: neu || undefined, callManuell, rapportR: r ?? undefined, rapportS: sw ?? undefined, rapportV: v ?? undefined });
        e.call = neu || undefined; e.callManuell = callManuell;
        e.rapportR = r ?? undefined; e.rapportS = sw ?? undefined; e.rapportV = v ?? undefined;
        zeigeAntwortKnopf(e);
        zeigeAngaben(e, false);
      } catch (err) { fehlerBand.textContent = t('galerie.fehler', { grund: err.message }); }
    });
    dAngaben.replaceChildren(
      zeile(el('span', 'label-lg', t('galerie.info.call')), feld),
      zeile(el('span', 'label-lg', t('galerie.info.rapport')), rf.box, rapportKnopf),
      akt,
    );
    feld.focus();
  }

  /** Inhalt des Detaildialogs zu einem Eintrag setzen (ohne den Dialog zu öffnen). */
  function fuelleDetail(e) {
    offen = e; detailLoeschen = false; setzeMenue(false); dDetails.open = false;
    if (dUrl) URL.revokeObjectURL(dUrl);
    dUrl = URL.createObjectURL(e.png);
    dBild.src = dUrl;
    dBild.alt = t('galerie.bild.alt', { modus: modusName(e.modeId), zeit: zeit(e.t) });
    dInfo.replaceChildren();
    const zeile = (k, v) => { dInfo.append(el('dt', '', t(k)), el('dd', '', v)); };
    dKopf.textContent = [modusName(e.modeId), zeit(e.t), t('galerie.info.sync', { p: Math.round(e.quality * 100) }) + (e.partial ? t('galerie.info.teilbild') : '')].join(' · ');
    dKopf.title = t('galerie.info.qualitaet');
    zeile('galerie.info.modus', `${modusName(e.modeId)}${e.vis !== undefined && e.vis !== null ? ` (VIS ${e.vis})` : e.blind ? ` (${t('galerie.info.ohnevis')})` : ''}`);
    zeile('galerie.info.zeilen', t('galerie.info.zeilen.wert', { zeilen: e.validLines, hoehe: e.height, teil: e.partial ? t('galerie.info.teilbild') : '' }));
    if (e.verschiebung) zeile('galerie.info.verschoben', t('galerie.info.verschoben.wert', { n: `${e.verschiebung > 0 ? '+' : ''}${e.verschiebung}` }));
    zeigeAngaben(e, false);
    if (e.roh) zeile('galerie.info.roh', `${mb(e.roh.size)}, 12 kHz`);
    zeile('galerie.info.quelle', t(`galerie.quelle.${e.quelle}`));
    zeile('galerie.info.groesse', `${e.width ?? '?'} × ${e.height} px, ${zahl((e.bytes ?? e.png.size) / 1024, 0)} KB`);
    bTeilen.hidden = !(navigator.canShare && navigator.canShare({ files: [new File([e.png], dateiname(e, zeitmodus()), { type: 'image/png' })] }));
    zeigeAntwortKnopf(e);
    bRoh.hidden = !e.roh;
    vBox.hidden = !e.blind;
    if (e.blind) { // Regler reicht über die halbe Bildhöhe in beide Richtungen
      const grenze = Math.round(e.height / 2);
      vRegler.min = String(-grenze); vRegler.max = String(grenze);
      vRegler.value = String(e.verschiebung ?? 0);
      vWert.textContent = t('galerie.versch.wert', { n: `${(e.verschiebung ?? 0) > 0 ? '+' : ''}${e.verschiebung ?? 0}` });
      bAnwenden.disabled = true; bUnverschoben.hidden = !e.verschiebung; vMeldung.textContent = '';
    }
    zeichneDetailKnoepfe();
  }
  function oeffneDetail(e) { fuelleDetail(e); dialog.showModal(); }
  const schliesseDetail = () => { if (dialog.open) dialog.close(); };
  dialog.addEventListener('close', () => { clearTimeout(vTimer); if (dUrl) { URL.revokeObjectURL(dUrl); dUrl = null; } dBild.removeAttribute('src'); offen = null; });
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) schliesseDetail(); }); // Tipp neben den Inhalt
  bMenue.addEventListener('click', (ev) => { ev.stopPropagation(); setzeMenue(menue.hidden); if (!menue.hidden) bTeilen.hidden ? bLoeschen.focus() : bTeilen.focus(); });
  dialog.addEventListener('click', (ev) => { if (!menue.hidden && !menue.contains(ev.target)) setzeMenue(false); });
  dialog.addEventListener('cancel', (ev) => { if (!menue.hidden) { ev.preventDefault(); setzeMenue(false); bMenue.focus(); } }); // Escape schließt zuerst das Menü
  bSpeichern.addEventListener('click', () => { if (offen) laden(offen.png, dateiname(offen, zeitmodus())); });
  bRoh.addEventListener('click', () => { if (offen?.roh) laden(offen.roh, wavName(offen)); });
  vRegler.addEventListener('input', zeigeVerschiebung);
  const wendeAn = async (n) => {
    if (!offen) return;
    vMeldung.textContent = '';
    try {
      const neu = await verschiebeEintrag(offen.id, n);
      fuelleDetail(neu);
      vMeldung.textContent = t('galerie.versch.gespeichert');
    } catch (err) { fehlerBand.textContent = t('galerie.fehler', { grund: err.message }); }
  };
  bAnwenden.addEventListener('click', () => wendeAn(Number(vRegler.value)));
  bUnverschoben.addEventListener('click', () => wendeAn(0));
  bTeilen.addEventListener('click', async () => {
    if (!offen) return;
    setzeMenue(false);
    try { await navigator.share({ files: [new File([offen.png], dateiname(offen, zeitmodus()), { type: 'image/png' })], title: t('app.name') }); } catch { /* abgebrochen */ }
  });
  bLog.addEventListener('click', () => {
    if (!offen) return;
    // Der Rapport aus dem Bild ist der, den man der Gegenstelle gibt („gesendet“); S nur, wenn eingetragen
    const rst = offen.rapportR && offen.rapportV && offen.rapportS ? rapportMitS(offen.rapportR, offen.rapportV, offen.rapportS) : '';
    const vorlage = { t: offen.t, call: offen.call, modeId: offen.modeId, rstGesendet: rst, bildId: offen.id };
    setzeMenue(false); schliesseDetail();
    log.bearbeite(vorlage);
  });
  bSenden.addEventListener('click', async () => {
    if (!offen) return;
    try {
      const senden = await import('./senden.js');
      await senden.setzeQuelle(offen.png, offen.modeId);
      schliesseDetail();
      location.hash = '#/senden';
    } catch (e) { fehlerBand.textContent = t('galerie.fehler', { grund: e.message }); schliesseDetail(); }
  });
  bAntwort.addEventListener('click', async () => {
    if (!offen?.call) return;
    try {
      const senden = await import('./senden.js');
      senden.bereiteAntwortVor(offen.call, offen.modeId, offen.rapportR && offen.rapportV ? rapportMitS(offen.rapportR, offen.rapportV, offen.rapportS ?? '?') : null);
      schliesseDetail();
      location.hash = '#/senden';
    } catch (e) { fehlerBand.textContent = t('galerie.fehler', { grund: e.message }); schliesseDetail(); }
  });
  bLoeschen.addEventListener('click', async () => {
    if (!offen) return;
    if (!detailLoeschen) { detailLoeschen = true; zeichneDetailKnoepfe(); return; } // zweiter Tipp bestätigt
    const id = offen.id;
    schliesseDetail();
    try { await loesche([id]); } catch (err) { fehlerBand.textContent = t('galerie.fehler', { grund: err.message }); }
  });

  // ---------------------------------------------------------------- Aktionen
  knopfAuswahl.addEventListener('click', () => { auswahlModus = !auswahlModus; gewaehlt.clear(); loeschBestaetigt = false; zeichneRaster(); zeichneLeiste(); });
  knopfAlle.addEventListener('click', () => {
    const zeige = sichtbar(); // „Alle“ meint die gerade angezeigten
    if (gewaehlt.size === zeige.length) gewaehlt.clear(); else for (const e of zeige) gewaehlt.add(e.id);
    loeschBestaetigt = false; zeichneRaster(); zeichneLeiste();
  });
  knopfLoeschen.addEventListener('click', async () => {
    if (!gewaehlt.size) return;
    if (!loeschBestaetigt) { loeschBestaetigt = true; zeichneLeiste(); return; }
    const n = gewaehlt.size;
    loeschBestaetigt = false;
    try { await loesche([...gewaehlt]); } catch (err) { fehlerBand.textContent = t('galerie.fehler', { grund: err.message }); return; }
    gewaehlt.clear();
    meldung = t('galerie.geloescht', { n });
    zeichneLeiste();
  });

  // Änderung des Filters: Auswahl auf das Sichtbare beschränken, damit „N gewählt“ und Löschen nichts Verstecktes treffen
  const filterGeaendert = () => {
    const zeige = new Set(sichtbar().map((e) => e.id));
    for (const id of [...gewaehlt]) if (!zeige.has(id)) gewaehlt.delete(id);
    loeschBestaetigt = false;
    zeichneRaster(); zeichneLeiste();
  };
  fText.addEventListener('input', () => { FILTER.text = fText.value; filterGeaendert(); });
  fModus.addEventListener('change', () => { FILTER.modus = fModus.value; filterGeaendert(); });
  fZeit.addEventListener('change', () => { FILTER.zeitraum = fZeit.value; filterGeaendert(); });
  fZurueck.addEventListener('click', () => { FILTER.text = ''; FILTER.modus = ''; FILTER.zeitraum = 'alle'; fText.value = ''; fModus.value = ''; fZeit.value = 'alle'; filterGeaendert(); });

  knopfZip.addEventListener('click', async () => {
    fehlerBand.textContent = ''; meldung = t('galerie.zip.baue'); zeichneLeiste();
    try {
      const wahl = auswahlModus && gewaehlt.size ? eintraege.filter((e) => gewaehlt.has(e.id)) : eintraege;
      const teile = [];
      for (const e of wahl) teile.push({ meta: e, png: new Uint8Array(await e.png.arrayBuffer()), ...(e.roh ? { roh: new Uint8Array(await e.roh.arrayBuffer()) } : {}) });
      // Das Logbuch gehört zur vollständigen Sicherung, nicht zur Sicherung einer Bildauswahl
      const qsos = wahl === eintraege ? await logListe() : [];
      const zip = baueArchiv(teile, zeitmodus(), qsos);
      laden(new Blob([zip], { type: 'application/zip' }), `sstv-galerie_${dateiStempel(Date.now(), zeitmodus())}.zip`);
      meldung = t(qsos.length ? 'galerie.zip.fertig.log' : 'galerie.zip.fertig', { n: wahl.length, q: qsos.length, groesse: mb(zip.length) });
    } catch (e) { meldung = ''; fehlerBand.textContent = t('galerie.fehler', { grund: e.message }); }
    zeichneLeiste();
  });
  knopfEinlesen.addEventListener('click', () => eingabeZip.click());
  eingabeZip.addEventListener('change', async () => {
    const f = eingabeZip.files[0]; eingabeZip.value = '';
    if (!f) return;
    fehlerBand.textContent = '';
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const eintr = leseArchiv(bytes);
      const qsos = leseLogbuch(bytes);
      const neu = await importiere(eintr);
      const neuQ = qsos.length ? await logImportiere(qsos) : 0;
      meldung = t(qsos.length ? 'galerie.eingelesen.log' : 'galerie.eingelesen', { neu, uebersprungen: eintr.length - neu, q: neuQ, qUebersprungen: qsos.length - neuQ });
    } catch (e) { meldung = ''; fehlerBand.textContent = t('galerie.fehler.zip', { grund: e.message }); }
    zeichneLeiste();
  });
  knopfDauer.addEventListener('click', async () => {
    const ok = await dauerhaftAnfordern();
    meldung = t(ok ? 'galerie.dauerhaft.gewaehrt' : 'galerie.dauerhaft.abgelehnt');
    zeichneLeiste(); zeichneSpeicher();
  });

  const ab = beiGalerieAenderung(aktualisiere);
  aktualisiere();
  return { unmount() { ab(); log.abmelden(); aufraeumen(); if (dUrl) URL.revokeObjectURL(dUrl); if (dialog.open) dialog.close(); } };
}
