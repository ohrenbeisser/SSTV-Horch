// FSK-Rufzeichenkennung nach dem Bild, Vorbild QSSTV (Aufbau siehe src/constants.js): Symbole bauen, Dauer ausrechnen und die
// Kennung aus einer Frequenzspur wieder rauslesen.

import {
  FSK_HEAD_1500_MS, FSK_HEAD_2100_MS, FSK_BIT_MS, FSK_TAIL_MS, FSK_START, FSK_END, FSK_MAX_CHARS, F_FSK_1, F_FSK_0, F_BLACK,
} from './constants.js';

/** Rufzeichen für die Kennung: Großbuchstaben, nur Zeichen mit 6-Bit-Code (ASCII 0x20 bis 0x5F), höchstens 9 Zeichen. */
export function saeubereRufzeichen(text) {
  return [...String(text).toUpperCase()]
    .filter((c) => { const k = c.charCodeAt(0); return k >= 0x20 && k <= 0x5f; })
    .join('').trim().slice(0, FSK_MAX_CHARS);
}

/** Symbole (je 6 Bit): Start, Zeichen, Ende, Prüfsumme. Leer, wenn kein Rufzeichen übrig bleibt. */
export function fskSymbols(rufzeichen) {
  const call = saeubereRufzeichen(rufzeichen);
  if (!call) return [];
  const zeichen = [...call].map((c) => c.charCodeAt(0) - 0x20);
  const summe = zeichen.reduce((a, b) => a ^ b, 0) & 0x3f;
  return [FSK_START, ...zeichen, FSK_END, summe];
}

/** Dauer der Kennung in Sekunden (0 ohne Rufzeichen). */
export function fskDauer(rufzeichen) {
  const n = fskSymbols(rufzeichen).length;
  if (!n) return 0;
  return (FSK_HEAD_1500_MS + FSK_HEAD_2100_MS + FSK_BIT_MS + n * 6 * FSK_BIT_MS + FSK_TAIL_MS) / 1000;
}

/**
 * Sucht ab Zeit `from` (s) eine Kennung in der Frequenzspur. Gibt null oder { call, checksumOk, t, offsetHz } zurück.
 * Verfahren: 300 ms Ton bei 1500 Hz finden, sein Ende (Sprung auf 2100 Hz) bestimmen, daraus das Bitraster ableiten, je Bit den
 * mittleren Teil des Schlitzes gegen die Mitte zwischen 1900 und 2100 Hz (um den gemessenen Versatz verschoben) entscheiden.
 */
export function decodeFskId(track, from = 0) {
  const bit = FSK_BIT_MS / 1000, kopf1 = FSK_HEAD_1500_MS / 1000, kopf2 = FSK_HEAD_2100_MS / 1000;
  const ende = track.endTime;
  for (let t = Math.max(from, track.t0); t + kopf1 + kopf2 + 0.2 < ende; t += 0.01) {
    const m = track.mean(t, t + 0.25);
    if (!(Math.abs(m - F_BLACK) < 80)) continue;
    // Ende des 1500-Hz-Tons: erster 1-ms-Block, der deutlich über 1500 Hz liegt
    let te = null;
    for (let u = t + 0.25; u < t + kopf1 + 0.12; u += 0.001) {
      if (track.mean(u, u + 0.001) > m + 300) { te = u + 0.0005; break; }
    }
    if (te === null) continue;
    const offsetHz = track.mean(t + 0.05, t + 0.2) - F_BLACK;
    const f2 = track.mean(te + 0.015, te + kopf2 - 0.015);
    if (!(Math.abs(f2 - (2100 + offsetHz)) < 90)) continue;
    const start = te + kopf2 + bit; // erstes Symbol beginnt nach dem 22-ms-Starton bei 1900 Hz
    const schwelle = (F_FSK_1 + F_FSK_0) / 2 + offsetHz;
    const symbole = [];
    let ok = true;
    for (let k = 0; k < FSK_MAX_CHARS + 4 && ok; k++) {
      let v = 0;
      for (let i = 0; i < 6; i++) {
        const a = start + (k * 6 + i) * bit;
        const f = track.mean(a + 0.25 * bit, a + 0.75 * bit);
        if (Number.isNaN(f)) { ok = false; break; }
        if (f < schwelle) v |= 1 << i; // 1 = 1900 Hz (niedriger), 0 = 2100 Hz
      }
      if (!ok) break;
      symbole.push(v);
      if (symbole.length >= 2 && symbole[symbole.length - 1 - 1] === FSK_END && symbole[0] === FSK_START) break; // Prüfsumme gelesen
    }
    if (symbole[0] !== FSK_START) continue;
    const iEnde = symbole.indexOf(FSK_END, 1);
    if (iEnde < 2 || iEnde + 1 >= symbole.length) continue;
    const zeichen = symbole.slice(1, iEnde);
    const summe = zeichen.reduce((a, b) => a ^ b, 0) & 0x3f;
    return { call: zeichen.map((z) => String.fromCharCode(z + 0x20)).join(''), checksumOk: summe === symbole[iEnde + 1], t: te - kopf1, offsetHz };
  }
  return null;
}
