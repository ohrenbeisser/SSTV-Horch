// Logbuch (D60): Karte mit Liste, Export als ADIF und CSV und der Dialog zum Eintragen und Ändern eines QSO.
// Wird vom Bereich Galerie eingebunden. Aus dem Bildbetrachter heraus füllt „Ins Log übernehmen“ den Dialog mit Rufzeichen, Modus, Zeit
// und dem Rapport vor, den die App aus dem Bild ableitet (das ist der Rapport, den man der Gegenstelle gibt, also „gesendet“).
import { MODES } from '../src/modes.js';
import { saeubereRufzeichen } from '../src/fskid.js';
import { pruefeLocator, pruefeRufzeichen } from '../src/station.js';
import { BAENDER, bandAusFrequenz, erzeugeAdif, erzeugeCsv } from '../src/adif.js';
import { liste, speichere, loesche, beiAenderung } from '../src/logbuch.js';
import { dateiStempel } from '../src/zeit.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const laden = (text, name, typ) => {
  const a = el('a'); a.href = URL.createObjectURL(new Blob([text], { type: typ })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

/** Gibt { karte, bearbeite(vorlage), abmelden } zurück. vorlage: Eintrag oder Vorbelegung ohne id. */
export function erzeugeLogbuch({ t, symbol, einstellung, modusName, zeit }) {
  let eintraege = [];

  // ---------------------------------------------------------------- Karte
  const karte = el('div', 'card');
  const titel = el('h2', 'title-md');
  const intro = el('p', 'hint body-sm', t('log.hinweis'));
  const knopfNeu = el('button', 'btn tonal', t('log.neu')); knopfNeu.type = 'button';
  const knopfAdif = el('button', 'btn', t('log.adif')); knopfAdif.type = 'button';
  const knopfCsv = el('button', 'btn', t('log.csv')); knopfCsv.type = 'button';
  const aktionen = el('div', 'aktionen'); aktionen.append(knopfNeu, knopfAdif, knopfCsv);
  const leer = el('p', 'hint', t('log.leer'));
  const ul = el('ul', 'log-liste');
  karte.append(titel, intro, aktionen, leer, ul);

  const exportDaten = () => eintraege.map((q) => ({ ...q, modusName: modusName(q.modeId) }));
  const dateiname = (endung) => `SSTV-Horch_Log_${dateiStempel(Date.now(), 'utc')}.${endung}`;
  knopfAdif.addEventListener('click', () => laden(erzeugeAdif(exportDaten()), dateiname('adi'), 'text/plain'));
  // BOM, damit Excel die Datei als UTF-8 öffnet
  knopfCsv.addEventListener('click', () => laden(`﻿${erzeugeCsv(exportDaten())}`, dateiname('csv'), 'text/csv;charset=utf-8'));

  function zeichne() {
    titel.textContent = t('log.titel', { n: eintraege.length });
    leer.hidden = eintraege.length > 0;
    knopfAdif.disabled = knopfCsv.disabled = eintraege.length === 0;
    ul.replaceChildren(...eintraege.map((q) => {
      const li = el('li');
      const b = el('button', 'log-zeile'); b.type = 'button';
      const rst = q.rstGesendet || q.rstEmpfangen ? `${q.rstGesendet || '–'} / ${q.rstEmpfangen || '–'}` : '';
      b.append(el('span', 'mono log-call', q.call), el('span', 'log-info', [zeit(q.t), modusName(q.modeId), q.band, rst].filter(Boolean).join(' · ')));
      b.setAttribute('aria-label', t('log.bearbeiten.aria', { call: q.call }));
      b.addEventListener('click', () => bearbeite(q));
      li.append(b); return li;
    }));
  }
  const lade = async () => { try { eintraege = await liste(); } catch { eintraege = []; } zeichne(); };
  const abmelden = beiAenderung(lade);
  lade();

  // ---------------------------------------------------------------- Dialog
  const dialog = el('dialog', 'info-dialog log-dialog');
  dialog.setAttribute('aria-label', t('log.dialog'));
  const feld = (beschriftung, eingabe) => { const l = el('label', 'feld'); l.append(el('span', '', beschriftung), eingabe); return l; };
  const eingabe = (typ, extra = {}) => { const i = el('input'); i.type = typ; Object.assign(i, extra); return i; };
  const fCall = eingabe('text', { maxLength: 12, autocomplete: 'off', spellcheck: false }); fCall.autocapitalize = 'characters';
  const fDatum = eingabe('date');
  const fZeit = eingabe('time', { step: 1 });
  const fModus = el('select');
  for (const id of Object.keys(MODES)) { const o = el('option', '', modusName(id)); o.value = id; fModus.append(o); }
  const fGes = eingabe('text', { maxLength: 3, autocomplete: 'off' });
  const fEmp = eingabe('text', { maxLength: 3, autocomplete: 'off' });
  const fBand = el('select');
  { const o = el('option', '', '–'); o.value = ''; fBand.append(o); for (const b of BAENDER) { const x = el('option', '', b); x.value = b; fBand.append(x); } }
  const fFreq = eingabe('text', { maxLength: 9, inputMode: 'decimal', autocomplete: 'off' });
  const fName = eingabe('text', { maxLength: 40, autocomplete: 'off' });
  const fLoc = eingabe('text', { maxLength: 8, autocomplete: 'off', spellcheck: false }); fLoc.autocapitalize = 'characters';
  const fNotiz = eingabe('text', { maxLength: 200, autocomplete: 'off' });
  const warn = el('div', 'warnband'); warn.setAttribute('role', 'alert');
  const bSpeichern = el('button', 'btn filled', t('log.speichern')); bSpeichern.type = 'button';
  const bLoeschen = el('button', 'btn text gefahr', t('log.loeschen')); bLoeschen.type = 'button';
  const bAbbrechen = el('button', 'btn text', t('log.abbrechen')); bAbbrechen.type = 'button';
  const akt = el('div', 'aktionen'); akt.append(bLoeschen, bAbbrechen, bSpeichern);
  const reihe = (...k) => { const r = el('div', 'reihe'); r.append(...k); return r; };
  dialog.append(
    el('h2', 'title-md', t('log.dialog')),
    feld(t('log.f.call'), fCall),
    reihe(feld(t('log.f.datum'), fDatum), feld(t('log.f.zeit'), fZeit)),
    feld(t('log.f.modus'), fModus),
    reihe(feld(t('log.f.rstges'), fGes), feld(t('log.f.rstemp'), fEmp)),
    reihe(feld(t('log.f.band'), fBand), feld(t('log.f.freq'), fFreq)),
    reihe(feld(t('log.f.name'), fName), feld(t('log.f.locator'), fLoc)),
    feld(t('log.f.notiz'), fNotiz),
    warn, akt,
  );
  // Zwischenablage für den geöffneten Eintrag
  let offen = null, loeschSicher = false;
  const zeigeLoeschen = () => { bLoeschen.textContent = t(loeschSicher ? 'log.loeschen.sicher' : 'log.loeschen'); };

  fFreq.addEventListener('change', () => { const b = bandAusFrequenz(fFreq.value); if (b) fBand.value = b; });
  fCall.addEventListener('change', () => { fCall.value = saeubereRufzeichen(fCall.value); });

  /** Dialog öffnen. vorlage mit id: Eintrag ändern. Ohne id: neuer Eintrag mit den Werten der Vorlage. */
  function bearbeite(vorlage = {}) {
    offen = vorlage; loeschSicher = false; zeigeLoeschen(); warn.textContent = '';
    const iso = new Date(vorlage.t ?? Date.now()).toISOString();
    fCall.value = vorlage.call ?? ''; fDatum.value = iso.slice(0, 10); fZeit.value = iso.slice(11, 19);
    fModus.value = MODES[vorlage.modeId] ? vorlage.modeId : Object.keys(MODES)[0];
    fGes.value = vorlage.rstGesendet ?? ''; fEmp.value = vorlage.rstEmpfangen ?? '';
    fBand.value = vorlage.band ?? ''; fFreq.value = vorlage.freq ?? '';
    fName.value = vorlage.name ?? ''; fLoc.value = vorlage.locator ?? ''; fNotiz.value = vorlage.notiz ?? '';
    bLoeschen.hidden = vorlage.id === undefined;
    if (!dialog.open) dialog.showModal();
  }

  bAbbrechen.addEventListener('click', () => dialog.close());
  bLoeschen.addEventListener('click', async () => {
    if (offen?.id === undefined) return;
    if (!loeschSicher) { loeschSicher = true; zeigeLoeschen(); return; } // zweiter Tipp bestätigt
    try { await loesche(offen.id); dialog.close(); } catch (e) { warn.textContent = t('log.fehler', { grund: e.message }); }
  });
  bSpeichern.addEventListener('click', async () => {
    const call = pruefeRufzeichen(fCall.value);
    if (!call.wert || !call.ok) { warn.textContent = t('log.fehler.call'); fCall.focus(); return; }
    const loc = pruefeLocator(fLoc.value);
    if (!loc.ok) { warn.textContent = t('log.fehler.locator'); fLoc.focus(); return; }
    const ms = Date.parse(`${fDatum.value}T${fZeit.value.length === 5 ? `${fZeit.value}:00` : fZeit.value}Z`);
    if (!Number.isFinite(ms)) { warn.textContent = t('log.fehler.zeit'); return; }
    const q = {
      ...(offen?.id !== undefined ? { id: offen.id } : {}),
      t: ms, call: call.wert, modeId: fModus.value,
      rstGesendet: fGes.value.trim(), rstEmpfangen: fEmp.value.trim(),
      band: fBand.value, freq: fFreq.value.trim().replace(',', '.'), name: fName.value.trim(), locator: loc.wert, notiz: fNotiz.value.trim(),
      meinCall: offen?.meinCall ?? einstellung('call') ?? '', meinLocator: offen?.meinLocator ?? einstellung('locator') ?? '',
      ...(offen?.bildId !== undefined ? { bildId: offen.bildId } : {}),
    };
    try { await speichere(q); dialog.close(); } catch (e) { warn.textContent = t('log.fehler', { grund: e.message }); }
  });
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); });
  knopfNeu.addEventListener('click', () => bearbeite({}));

  return { karte, dialog, bearbeite, abmelden };
}
