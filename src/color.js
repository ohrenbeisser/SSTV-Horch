// Farben und Frequenzen. Robot 36 und PD schicken YCrCb im Studiobereich nach BT.601 (Y 16..235, Cr/Cb 16..240, Mitte 128),
// Martin und Scottie schicken schlicht RGB. Formeln aus der Robot-/PD-Spezifikation (so auch bei MMSSTV und QSSTV beschrieben),
// Rückweg wie in robot36 (ColorConverter.java). slowrx und pySSTV nehmen dagegen Y direkt als Helligkeit, deshalb gibt es
// yccToRgbVoll für die Einstellung „kompatible Helligkeit“ (D19, D35).

import { F_BLACK, F_SPAN } from './constants.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** RGB (0..255) -> [Y, Cr (R-Y), Cb (B-Y)] im Studiobereich, als Fließkommazahlen. */
export function rgbToYcc(r, g, b) {
  const y = 16 + 0.003906 * (65.738 * r + 129.057 * g + 25.064 * b);
  const cr = 128 + 0.003906 * (112.439 * r - 94.154 * g - 18.285 * b);
  const cb = 128 + 0.003906 * (-37.945 * r - 74.494 * g + 112.439 * b);
  return [y, cr, cb];
}

/** [Y, Cr, Cb] im Studiobereich -> RGB (0..255, begrenzt, nicht gerundet). */
export function yccToRgb(y, cr, cb) {
  const yy = 1.164383 * (y - 16);
  return [
    clamp255(yy + 1.596027 * (cr - 128)),
    clamp255(yy - 0.812968 * (cr - 128) - 0.391762 * (cb - 128)),
    clamp255(yy + 2.017232 * (cb - 128)),
  ];
}

/**
 * Kompatible Helligkeit: Y wird wie in slowrx direkt als Helligkeit genommen (Vollbereich). Schwarz des Senders
 * (Y = 16) erscheint dann als Grau 16 und das Bild flauer, entspricht aber der Anzeige jener Decoder.
 */
export function yccToRgbVoll(y, cr, cb) {
  // Koeffizienten und Mitte (127,5) wie in slowrx, video.c, Fall YUV (GPL, Quellenangabe hier)
  return [
    clamp255(y + 1.40 * (cr - 127.5)),
    clamp255(y - 0.71 * cr - 0.33 * cb + 132.6),
    clamp255(y + 1.78 * (cb - 127.5)),
  ];
}

/** Wie yccToRgb, schreibt aber direkt ins RGBA-Feld ab Index i (kein neues Feld je Pixel; Uint8ClampedArray begrenzt und rundet selbst). */
export function yccInRgba(data, i, y, cr, cb) {
  const yy = 1.164383 * (y - 16);
  data[i] = yy + 1.596027 * (cr - 128);
  data[i + 1] = yy - 0.812968 * (cr - 128) - 0.391762 * (cb - 128);
  data[i + 2] = yy + 2.017232 * (cb - 128);
}

/** Wie yccToRgbVoll, direkt ins RGBA-Feld. */
export function yccVollInRgba(data, i, y, cr, cb) {
  data[i] = y + 1.40 * (cr - 127.5);
  data[i + 1] = y - 0.71 * cr - 0.33 * cb + 132.6;
  data[i + 2] = y + 1.78 * (cb - 127.5);
}

/** Wert 0..255 (begrenzt) -> Frequenz: 0 = 1500 Hz (Schwarz), 255 = 2300 Hz (Weiß). */
export function valueToFreq(v) {
  return F_BLACK + (F_SPAN * clamp255(v)) / 255;
}

/** Frequenz -> Wert 0..255 (nicht begrenzt, damit Abweichungen sichtbar bleiben). */
export function freqToValue(f) {
  return ((f - F_BLACK) * 255) / F_SPAN;
}
