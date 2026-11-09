// Logbuch in IndexedDB (nur Browser, D60), eigene Datenbank neben der Galerie, damit deren Version unberührt bleibt.
// Je QSO ein Eintrag: { id, t (ms, UTC), call, modeId, rstGesendet, rstEmpfangen, band, freq (MHz, Text), name, locator, notiz,
//   meinCall, meinLocator (Stand beim Eintragen), bildId (Galerie-Eintrag, aus dem der Eintrag entstand, falls einer) }.

const DB = 'sstv-horch-log';
const STORE = 'qsos';
const hoerer = new Set();
let dbVersprechen = null;

function oeffne() {
  dbVersprechen ??= new Promise((ok, fehler) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('t', 't'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbVersprechen = null; fehler(r.error); };
  });
  return dbVersprechen;
}
const abwarten = (req) => new Promise((ok, fehler) => { req.onsuccess = () => ok(req.result); req.onerror = () => fehler(req.error); });
const store = async (art) => (await oeffne()).transaction(STORE, art).objectStore(STORE);
const melde = () => { for (const h of hoerer) h(); };

export const beiAenderung = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

/** Alle Einträge, neueste zuerst. */
export async function liste() {
  const alle = await abwarten((await store('readonly')).getAll());
  return alle.sort((a, b) => b.t - a.t);
}

/** Legt an (ohne id) oder überschreibt (mit id). Gibt die id zurück. */
export async function speichere(q) {
  const id = await abwarten((await store('readwrite')).put(q));
  melde();
  return id;
}

export async function loesche(id) {
  await abwarten((await store('readwrite')).delete(id));
  melde();
}

/** Liest Einträge einer Sicherung ein; schon vorhandene (gleiche Zeit, Rufzeichen und Modus) werden übersprungen. Gibt die Zahl der neuen zurück. */
export async function importiere(qsos) {
  const schluessel = (q) => `${q.t}|${q.call}|${q.modeId}`;
  const vorhanden = new Set((await liste()).map(schluessel));
  let neu = 0;
  for (const q of qsos) {
    if (vorhanden.has(schluessel(q))) continue;
    await abwarten((await store('readwrite')).put(q));
    vorhanden.add(schluessel(q));
    neu++;
  }
  if (neu) melde();
  return neu;
}
