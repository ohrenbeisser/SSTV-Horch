// Die Bereiche der App und die Regeln fürs Menü (ohne Browser, daher testbar). Verdrahtet wird in app.js.
// Alles liegt im Hamburger-Menü (D18). Die Reihenfolge hier ist die im Menü, Gruppen werden durch Trenner getrennt.

export const BEREICHE = [
  { id: 'empfangen', icon: 'mic', gruppe: 1 },
  { id: 'senden', icon: 'campaign', gruppe: 1 },
  { id: 'galerie', icon: 'image', gruppe: 1 },
  { id: 'codierung', icon: 'code', gruppe: 2 },
  { id: 'labor', icon: 'science', gruppe: 2 },
  { id: 'websdr', icon: 'radio', gruppe: 2 },
  { id: 'einstellungen', icon: 'settings', gruppe: 3 },
  { id: 'hilfe', icon: 'help', gruppe: 3 },
  { id: 'ueber', icon: 'info', gruppe: 3 },
];
export const STANDARD = 'empfangen';
export const ids = () => BEREICHE.map((b) => b.id);

/** Bereich aus dem Hash (`#/senden`); unbekannt oder leer ergibt den Standardbereich. */
export function bereichAusHash(hash) {
  const id = String(hash ?? '').replace(/^#\/?/, '').split(/[/?]/)[0];
  return ids().includes(id) ? id : STANDARD;
}
