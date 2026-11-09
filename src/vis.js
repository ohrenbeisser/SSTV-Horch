// VIS-Erkennung auf der Frequenzspur. Das VIS ist die Visitenkarte vor dem Bild: Leitton (1900 Hz, 300 ms), Break (1200 Hz, 10 ms),
// noch ein Leitton, Startbit, 7 Datenbits, Parität, Stoppbit.
// Vorgehen: erst grob nach Stellen mit viel Leitton suchen, dann den VIS-Block mit einer Schablone vergleichen (Mittelwert je
// Zeitschlitz gegen die Sollfrequenzen, kein Median, siehe Decoder-Regel). Das hält einiges an Rauschen aus. Den Frequenzversatz
// liest es an den Leittönen ab und zieht ihn überall ab.

import { modeByVis, layout } from './modes.js';
import { F_SYNC, F_LEADER, F_VIS_1, F_VIS_0, VIS_BIT_MS, LEADER_MS, BREAK_MS } from './constants.js';

const BLOCK = 0.005; // s, Raster der Grobsuche
const SLOT = VIS_BIT_MS / 1000;
const LEADER = LEADER_MS / 1000;
const BREAK = BREAK_MS / 1000;

/**
 * Sucht ab Zeit `from` (s) das nächste vollständige VIS. Gibt null oder
 * { vis, parityOk, mode, offsetHz, err, imageStart, syncTime, t } zurück.
 *  t: Beginn des Startbits. imageStart: Ende des Stoppbits = Beginn der ersten Bildzeile.
 *  syncTime: erwarteter Beginn des ersten Sync-Impulses (bei Scottie später als der Zeilenbeginn).
 *  err: mittlere Abweichung der VIS-Schlitze von den Sollfrequenzen in Hz (klein = sicher).
 */
export function findVis(track, from = 0, { maxErr = 70 } = {}) {
  const t0 = Math.max(from, track.t0);
  const nBlocks = Math.floor((track.endTime - t0) / BLOCK);
  if (nBlocks < 130) return null;
  // Blockmittel und Zählsumme der Blöcke nahe 1900 Hz
  const inb = new Uint8Array(nBlocks);
  for (let i = 0; i < nBlocks; i++) {
    const a = track.mean(t0 + i * BLOCK, t0 + (i + 1) * BLOCK);
    inb[i] = Math.abs(a - F_LEADER) < 250 ? 1 : 0;
  }
  const cum = new Int32Array(nBlocks + 1);
  for (let i = 0; i < nBlocks; i++) cum[i + 1] = cum[i] + inb[i];
  const W = 60; // 0,3 s: mindestens ein Leitton
  let i = 0;
  while (i + W <= nBlocks) {
    if (cum[i + W] - cum[i] < 0.7 * W) { i++; continue; }
    // zusammenhängender Bereich passender Fenster
    let j = i;
    while (j + 1 + W <= nBlocks && cum[j + 1 + W] - cum[j + 1] >= 0.7 * W) j++;
    // Der Startbit-Beginn liegt am Ende des Leittons: im Bereich [i*B + 0,25 s, (j+W)*B + 0,06 s]
    const lo = t0 + i * BLOCK + 0.25, hi = t0 + (j + W) * BLOCK + 0.06;
    const r = bestTemplate(track, lo, hi, maxErr);
    if (r) return r;
    i = j + 1;
  }
  return null;
}

/** Alle VIS-Treffer der Spur nacheinander. */
export function findAllVis(track, from = 0, opts) {
  const out = [];
  let t = from;
  for (;;) {
    const v = findVis(track, t, opts);
    if (!v) break;
    out.push(v);
    t = v.imageStart;
  }
  return out;
}

function bestTemplate(track, lo, hi, maxErr) {
  let best = null;
  for (let ts = lo; ts <= hi; ts += 0.0025) {
    const r = score(track, ts);
    if (r && (best === null || r.err < best.err)) best = r;
  }
  if (!best || best.err > maxErr) return null;
  // Feinsuche um den besten Wert
  for (let ts = best.t - 0.003; ts <= best.t + 0.003; ts += 0.00025) {
    const r = score(track, ts);
    if (r && r.err < best.err) best = r;
  }
  if (best.err > maxErr) return null;
  const mode = modeByVis(best.vis);
  const imageStart = best.t + 10 * SLOT;
  return { ...best, mode, imageStart, syncTime: mode ? imageStart - layout(mode)[0].startMs / 1000 : null };
}

// Bewertet die Hypothese „Startbit beginnt bei ts“. Verlangt einen Leitton in den 280 ms davor; der erste Leitton samt Break
// wird nur zur Verfeinerung des Versatzes genutzt (manche Aufnahmen haben einen anderen Vorspann).
function score(track, ts) {
  const l2 = track.mean(ts - LEADER + 0.02, ts - 0.02);
  if (!(Math.abs(l2 - F_LEADER) < 130)) return null;
  let off = l2 - F_LEADER;
  const l1 = track.mean(ts - LEADER - BREAK - LEADER + 0.02, ts - LEADER - BREAK - 0.02);
  if (Math.abs(l1 - F_LEADER) < 130 && Math.abs(l1 - l2) < 60) off = (l1 + l2) / 2 - F_LEADER;
  let err = 0, code = 0, ones = 0;
  const slot = (k) => track.mean(ts + k * SLOT + 0.006, ts + (k + 1) * SLOT - 0.006);
  err += Math.abs(slot(0) - (F_SYNC + off));
  for (let b = 0; b < 8; b++) {
    const f = slot(1 + b);
    const d1 = Math.abs(f - (F_VIS_1 + off)), d0 = Math.abs(f - (F_VIS_0 + off));
    err += Math.min(d1, d0);
    if (d1 < d0) { ones++; if (b < 7) code |= 1 << b; }
  }
  err += Math.abs(slot(9) - (F_SYNC + off));
  if (Number.isNaN(err)) return null;
  return { vis: code, parityOk: ones % 2 === 0, offsetHz: off, err: err / 10, t: ts };
}
