// Der Rauschsimulator im Labor: Signal absichtlich kaputt machen (Rauschen, Versatz, Taktfehler) und hinterher nachzählen, wie viel
// vom Bild übrig ist. Ohne DOM, in Node getestet.

import { buildTimeline, Synth } from './encoder.js';

/** Weißes Gaussrauschen mit Standardabweichung sigma (deterministisch, mulberry32 und Box-Muller). */
export function rauschen(samples, sigma, seed = 12345) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Float32Array(samples.length);
  for (let i = 0; i < out.length; i += 2) {
    const u = Math.max(rnd(), 1e-12), v = rnd();
    const r = Math.sqrt(-2 * Math.log(u)) * sigma;
    out[i] = samples[i] + r * Math.cos(2 * Math.PI * v);
    if (i + 1 < out.length) out[i + 1] = samples[i + 1] + r * Math.sin(2 * Math.PI * v);
  }
  return out;
}

/**
 * Standardabweichung des weißen Rauschens, bei der das Verhältnis von Signalleistung zu Rauschleistung im Band (Vorgabe 2400 Hz, etwa
 * der SSTV-Kanal) genau snrDb beträgt. Das Rauschen verteilt sich gleichmäßig über 0 bis fs/2.
 */
export function sigmaFuerSnr(snrDb, signalRms, fs, bandHz = 2400) {
  return Math.sqrt(((signalRms * signalRms) / 10 ** (snrDb / 10)) * (fs / 2 / bandHz));
}

/**
 * Bild -> Signal mit Störungen. offsetHz: Abstimmfehler (alle Töne verschoben), clockPpm: Taktfehler (Sender läuft mit fs*(1+ppm), das Signal
 * wird als fs gelesen), snrDb: Rauschabstand im 2400-Hz-Band (null = ohne Rauschen), fskId optional.
 */
export function kodiereGestoert(img, mode, { fs = 48000, snrDb = null, offsetHz = 0, clockPpm = 0, fskId = '', amplitude = 0.8, seed = 12345 } = {}) {
  const tl = buildTimeline(img, mode, { fskId });
  if (offsetHz) for (let i = 0; i < tl.n; i++) tl.freq[i] += offsetHz;
  const synth = new Synth(tl, fs * (1 + clockPpm * 1e-6), { amplitude });
  const samples = new Float32Array(synth.total);
  synth.render(samples);
  if (snrDb === null) return samples;
  let s = 0; for (let i = 0; i < samples.length; i++) s += samples[i] * samples[i];
  return rauschen(samples, sigmaFuerSnr(snrDb, Math.sqrt(s / samples.length), fs), seed);
}

/** Mittlerer absoluter Fehler (R, G, B, Skala 0 bis 255) zweier gleich großer Bilder; durchsichtige Pixel (nicht decodierte Zeilen) zählen 128. */
export function mittlererFehler(a, b) {
  let s = 0;
  const n = a.width * a.height;
  for (let i = 0; i < n; i++) {
    const j = i * 4;
    if (a.data[j + 3] === 0) { s += 128; continue; }
    s += (Math.abs(a.data[j] - b.data[j]) + Math.abs(a.data[j + 1] - b.data[j + 1]) + Math.abs(a.data[j + 2] - b.data[j + 2])) / 3;
  }
  return s / n;
}

/** Aus den Ergebnissen von decodeRecording das brauchbarste Bild (höchste Qualität, dann meiste Zeilen) oder null. */
export function besterTreffer(results) {
  let best = null;
  for (const r of results) {
    if (!r.image) continue;
    if (!best || r.quality > best.quality || (r.quality === best.quality && r.validLines > best.validLines)) best = r;
  }
  return best;
}
