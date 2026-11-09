// Eigene Stationsdaten prüfen (ohne DOM, in Node getestet). Die Prüfung meckert nur, sie verbietet nichts.

/** Maidenhead-Locator mit 4, 6 oder 8 Zeichen (AA00, AA00aa, AA00aa00). Gibt { ok, wert } zurück, wert in üblicher Schreibweise. */
export function pruefeLocator(text) {
  const s = String(text ?? '').trim();
  if (s === '') return { ok: true, wert: '' };
  const m = /^([A-R]{2})(\d{2})(?:([A-X]{2})(?:(\d{2}))?)?$/i.exec(s);
  if (!m) return { ok: false, wert: s.toUpperCase() };
  return { ok: true, wert: m[1].toUpperCase() + m[2] + (m[3] ? m[3].toLowerCase() : '') + (m[4] ?? '') };
}

/** Rufzeichen: Buchstaben, Ziffern und Schrägstrich, 3 bis 12 Zeichen. Gibt { ok, wert } zurück, wert in Großbuchstaben. */
export function pruefeRufzeichen(text) {
  const s = String(text ?? '').trim().toUpperCase();
  if (s === '') return { ok: true, wert: '' };
  return { ok: /^[A-Z0-9]+(\/[A-Z0-9]+)*$/.test(s) && s.length >= 3 && s.length <= 12, wert: s };
}

/**
 * Maidenhead-Locator aus Breite und Länge (Grad, Süd und West negativ), mit 4, 6 oder 8 Zeichen. Wirft bei ungültiger Position.
 * Feld (20° × 10°), Quadrat (2° × 1°), Unterquadrat (5′ × 2,5′), erweitertes Quadrat (30″ × 15″).
 */
export function locatorAusPosition(breite, laenge, zeichen = 6) {
  if (!Number.isFinite(breite) || !Number.isFinite(laenge)) throw new Error('Keine gültige Position');
  const lon = Math.min(360 - 1e-9, Math.max(0, laenge + 180));
  const lat = Math.min(180 - 1e-9, Math.max(0, breite + 90));
  const buchstabe = (i, gross) => String.fromCharCode((gross ? 65 : 97) + i);
  let a = lon, b = lat;
  let s = buchstabe(Math.floor(a / 20), true) + buchstabe(Math.floor(b / 10), true);
  a %= 20; b %= 10;
  s += `${Math.floor(a / 2)}${Math.floor(b / 1)}`;
  a %= 2; b %= 1;
  if (zeichen >= 6) {
    s += buchstabe(Math.floor(a / (2 / 24)), false) + buchstabe(Math.floor(b / (1 / 24)), false);
    a %= 2 / 24; b %= 1 / 24;
  }
  if (zeichen >= 8) s += `${Math.floor(a / (2 / 240))}${Math.floor(b / (1 / 240))}`;
  return s;
}
