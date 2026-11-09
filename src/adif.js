// ADIF-Export (3.1.4) und CSV für das SSTV-Logbuch (D60). Ohne DOM, in Node getestet.
// ADIF kennt für SSTV nur MODE=SSTV ohne Untermodi. Der genaue Modus (Robot 36, PD120 …) steht deshalb im eigenen Feld
// APP_SSTVHORCH_MODE und im Kommentar.

const PROGRAMM = 'SSTV-Horch';
const VERSION = '0.1';

// Nur druckbares ASCII, sonst bricht die Längenangabe je nach Programm (Zeichen oder Bytes)
const ascii = (s) => String(s).normalize('NFKD').replace(/ß/g, 'ss').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '?');

export function adifFeld(name, wert) {
  if (wert === null || wert === undefined || wert === '') return '';
  const w = ascii(wert);
  return `<${name}:${w.length}>${w}`;
}

const datum = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const zeit = (ms) => new Date(ms).toISOString().slice(11, 19).replace(/:/g, '');

/** Bänder zur Auswahl (Kurzwelle und UKW, auf denen SSTV üblich ist). */
export const BAENDER = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m', '70cm'];

// Bandgrenzen in MHz (Region 1)
const GRENZEN = [['160m', 1.8, 2], ['80m', 3.5, 3.8], ['60m', 5.06, 5.45], ['40m', 7, 7.2], ['30m', 10.1, 10.15], ['20m', 14, 14.35], ['17m', 18.068, 18.168],
  ['15m', 21, 21.45], ['12m', 24.89, 24.99], ['10m', 28, 29.7], ['6m', 50, 54], ['2m', 144, 146], ['70cm', 430, 440]];

/** Band zu einer Frequenz in MHz (Zahl oder Text mit Punkt oder Komma); leer, wenn keins passt. */
export function bandAusFrequenz(mhz) {
  const f = Number(String(mhz).replace(',', '.'));
  if (!Number.isFinite(f)) return '';
  return GRENZEN.find(([, von, bis]) => f >= von && f <= bis)?.[0] ?? '';
}

/**
 * Ein Logbuch-Eintrag { t (ms, UTC), call, modeId, modusName, rstGesendet, rstEmpfangen, band, freq (MHz), name, locator, notiz, meinCall, meinLocator }
 * als ADIF-Datensatz.
 */
export function eintragZuAdif(q) {
  const kommentar = ['SSTV', q.modusName ?? q.modeId, q.notiz].filter(Boolean).join('; ');
  const felder = [
    adifFeld('CALL', q.call),
    adifFeld('QSO_DATE', datum(q.t)),
    adifFeld('TIME_ON', zeit(q.t)),
    adifFeld('MODE', 'SSTV'),
    adifFeld('BAND', q.band),
    adifFeld('FREQ', q.freq),
    adifFeld('RST_SENT', q.rstGesendet),
    adifFeld('RST_RCVD', q.rstEmpfangen),
    adifFeld('NAME', q.name),
    adifFeld('GRIDSQUARE', q.locator),
    adifFeld('STATION_CALLSIGN', q.meinCall),
    adifFeld('MY_GRIDSQUARE', q.meinLocator),
    adifFeld('APP_SSTVHORCH_MODE', q.modusName ?? q.modeId),
    adifFeld('COMMENT', kommentar),
  ];
  return `${felder.filter(Boolean).join(' ')} <EOR>\n`;
}

export function erzeugeAdif(eintraege, { jetztMs = Date.now() } = {}) {
  const kopf = [
    'ADIF-Export der App SSTV-Horch',
    adifFeld('ADIF_VER', '3.1.4'),
    adifFeld('PROGRAMID', PROGRAMM),
    adifFeld('PROGRAMVERSION', VERSION),
    adifFeld('CREATED_TIMESTAMP', `${datum(jetztMs)} ${zeit(jetztMs)}`),
    '<EOH>',
  ].join('\n');
  return `${kopf}\n\n${eintraege.map(eintragZuAdif).join('')}`;
}

const SPALTEN = ['Datum', 'Zeit_UTC', 'Rufzeichen', 'Modus', 'RST_gesendet', 'RST_empfangen', 'Band', 'Frequenz_MHz', 'Name', 'Locator', 'Notiz'];
const zelle = (w) => { const s = String(w ?? ''); return /[;"\n\r,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** CSV mit Semikolon (öffnet in deutschem Excel und LibreOffice direkt), Zeit in UTC. */
export function erzeugeCsv(eintraege) {
  const zeilen = eintraege.map((q) => {
    const iso = new Date(q.t).toISOString();
    return [iso.slice(0, 10), iso.slice(11, 19), q.call, q.modusName ?? q.modeId, q.rstGesendet, q.rstEmpfangen, q.band, q.freq, q.name, q.locator, q.notiz].map(zelle).join(';');
  });
  return `${SPALTEN.join(';')}\n${zeilen.join('\n')}${zeilen.length ? '\n' : ''}`;
}
