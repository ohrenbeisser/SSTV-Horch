// Zeitangaben in Ortszeit oder UTC (ohne DOM, in Node getestet). Die Einstellung „zeitanzeige“ ist 'lokal' oder 'utc'.

const z = (n) => String(n).padStart(2, '0');

export const normalisiereZeitmodus = (modus) => (modus === 'utc' ? 'utc' : 'lokal');

function teile(ms, modus) {
  const d = new Date(ms);
  return normalisiereZeitmodus(modus) === 'utc'
    ? { j: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, t: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }
    : { j: d.getFullYear(), mo: d.getMonth() + 1, t: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() };
}

/** Für Dateinamen: JJJJMMTT-HHMMSS. */
export function dateiStempel(ms, modus = 'lokal') {
  const x = teile(ms, modus);
  return `${x.j}${z(x.mo)}${z(x.t)}-${z(x.h)}${z(x.mi)}${z(x.s)}`;
}

/** JJJJ-MM-TT (Platzhalter {datum}). */
export function datumText(ms, modus = 'lokal') {
  const x = teile(ms, modus);
  return `${x.j}-${z(x.mo)}-${z(x.t)}`;
}

/** HH:MM, bei UTC mit dem Zusatz „ UTC“ (Platzhalter {zeit}). */
export function uhrText(ms, modus = 'lokal') {
  const x = teile(ms, modus);
  return `${z(x.h)}:${z(x.mi)}${normalisiereZeitmodus(modus) === 'utc' ? ' UTC' : ''}`;
}

/** Datum und Uhrzeit für die Anzeige in der Sprache des Nutzers, bei UTC mit dem Zusatz „ UTC“. */
export function zeitAnzeige(ms, modus = 'lokal', sprache = 'de') {
  const utc = normalisiereZeitmodus(modus) === 'utc';
  return new Date(ms).toLocaleString(sprache, { dateStyle: 'short', timeStyle: 'short', ...(utc ? { timeZone: 'UTC' } : {}) }) + (utc ? ' UTC' : '');
}

/** Dauer als M:SS. Erst runden, dann zerlegen, sonst kommt bei 119,6 s „1:60“ raus. */
export function dauerText(sekunden) {
  const s = Math.max(0, Math.round(sekunden));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
