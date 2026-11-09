// Wo liegt das Quellbild im Rahmen des Sendebildes? (ohne DOM, läuft in Node und im Browser)
// Der Rahmen ist 1 breit und rh/rw hoch, die Einheiten haben also nichts mit der Größe auf dem Bildschirm zu tun.
// Ansicht: { modus: 'fill' | 'fit', zoom (>= 1), dx, dy (linke obere Ecke des Bildes im Rahmen, in Rahmeneinheiten) }.
// Beim Füllen entsteht nie Leerraum, wo es noch Bild gäbe; beim Einpassen bleibt das Bild im Rahmen.

export const ZOOM_MAX = 8;

/** Maßstab (Rahmeneinheiten je Quellpixel) bei Zoom 1. */
export function grundMass(sw, sh, rw, rh, modus) {
  const a = 1 / sw, b = (rh / rw) / sh;
  return modus === 'fit' ? Math.min(a, b) : Math.max(a, b);
}

/** Größe des Bildes im Rahmen in Rahmeneinheiten. */
export function bildGroesse(ansicht, sw, sh, rw, rh) {
  const s = grundMass(sw, sh, rw, rh, ansicht.modus) * ansicht.zoom;
  return { w: sw * s, h: sh * s, s };
}

function klemmeAchse(d, groesse, rahmen) {
  if (groesse >= rahmen) return Math.min(0, Math.max(rahmen - groesse, d)); // Bild deckt den Rahmen: kein Leerraum
  return Math.min(rahmen - groesse, Math.max(0, d)); // Bild kleiner: bleibt im Rahmen
}

/** Begrenzt Zoom und Lage. */
export function klemme(ansicht, sw, sh, rw, rh) {
  const zoom = Math.min(ZOOM_MAX, Math.max(1, ansicht.zoom));
  const a = { ...ansicht, zoom };
  const g = bildGroesse(a, sw, sh, rw, rh);
  a.dx = klemmeAchse(ansicht.dx, g.w, 1);
  a.dy = klemmeAchse(ansicht.dy, g.h, rh / rw);
  return a;
}

/** Neue Ansicht: Zoom 1, mittig. */
export function neueAnsicht(sw, sh, rw, rh, modus = 'fill') {
  const g = bildGroesse({ modus, zoom: 1 }, sw, sh, rw, rh);
  return klemme({ modus, zoom: 1, dx: (1 - g.w) / 2, dy: (rh / rw - g.h) / 2 }, sw, sh, rw, rh);
}

/** Zoom ändern, der Punkt (fx, fy) im Rahmen (Rahmeneinheiten) bleibt dabei unter dem Finger. */
export function zoomeUm(ansicht, neuerZoom, fx, fy, sw, sh, rw, rh) {
  const alt = bildGroesse(ansicht, sw, sh, rw, rh);
  const zoom = Math.min(ZOOM_MAX, Math.max(1, neuerZoom));
  const neu = bildGroesse({ ...ansicht, zoom }, sw, sh, rw, rh);
  const px = (fx - ansicht.dx) / alt.s, py = (fy - ansicht.dy) / alt.s; // Quellpunkt unter dem Fokus
  return klemme({ ...ansicht, zoom, dx: fx - px * neu.s, dy: fy - py * neu.s }, sw, sh, rw, rh);
}

/** Verschieben um (ddx, ddy) Rahmeneinheiten. */
export function verschiebe(ansicht, ddx, ddy, sw, sh, rw, rh) {
  return klemme({ ...ansicht, dx: ansicht.dx + ddx, dy: ansicht.dy + ddy }, sw, sh, rw, rh);
}

/** Platzhalter in Vorlagentexten ersetzen: {call}, {gegen}, {rapport}, {locator}, {datum}. Unbekannte bleiben stehen. */
export function ersetzePlatzhalter(text, werte) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in werte ? String(werte[k]) : m));
}
