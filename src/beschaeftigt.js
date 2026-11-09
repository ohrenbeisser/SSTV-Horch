// Merkt, ob die App gerade etwas tut, das ein Neuladen der Seite nicht verträgt (Empfang läuft, Wiedergabe läuft). Kommt eine neue Fassung
// aus dem Service Worker, lädt app.js die Seite erst neu, wenn nichts mehr läuft. Ohne Browser nutzbar und getestet.
const gruende = new Set();
const wartende = new Set();

/** Grund an- oder abmelden ('empfang', 'wiedergabe'); sobald keiner mehr da ist, laufen die wartenden Funktionen. */
export function setzeBeschaeftigt(grund, an) {
  if (an) gruende.add(grund); else gruende.delete(grund);
  if (!gruende.size) { const fs = [...wartende]; wartende.clear(); for (const f of fs) f(); }
}

export const istBeschaeftigt = () => gruende.size > 0;

/** fn sofort ausführen, wenn nichts läuft, sonst sobald nichts mehr läuft (höchstens einmal). */
export function wennFrei(fn) {
  if (!gruende.size) fn(); else wartende.add(fn);
}
