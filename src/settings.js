// Einstellungen im localStorage. Verweigert der Browser den Zugriff (privates Fenster, gesperrte Daten), gelten eben die Vorgaben.
const VORGABEN = { lang: '', theme: 'auto', starts: 0, installHinweis: '', eingangDb: 0, call: '', locator: '', sendeModus: 'robot36', sendePegel: 60, fskId: 'an', galerieAuto: 'an', helligkeit: 'studio', ohneVis: 'an', rohSpeichern: 'aus', textVorlagen: '[]', taktPpm: 0, calKopf: 'aus', textSchrift: 'roboto', zeitanzeige: 'lokal', audioEingang: '', audioAusgang: '' };
const PRAEFIX = 'sstv_';
const hoerer = new Set();
const werte = { ...VORGABEN };

function lies(k) { try { return localStorage.getItem(PRAEFIX + k); } catch { return null; } }
function schreibe(k, v) { try { localStorage.setItem(PRAEFIX + k, String(v)); } catch { /* egal */ } }

for (const k of Object.keys(VORGABEN)) {
  const roh = lies(k);
  if (roh === null) continue;
  werte[k] = typeof VORGABEN[k] === 'number' ? Number(roh) || VORGABEN[k] : roh;
}

export const einstellung = (k) => werte[k];

export function setzeEinstellung(k, v) {
  if (!(k in VORGABEN)) throw new Error(`unbekannte Einstellung ${k}`);
  if (werte[k] === v) return;
  werte[k] = v;
  schreibe(k, v);
  for (const h of hoerer) h(k, v);
}

export const beiAenderung = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };
