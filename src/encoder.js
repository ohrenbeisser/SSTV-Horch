// Der Encoder: Bild + Modus -> Fahrplan aus Tönen (Frequenz und Dauer) -> Audio ohne Phasensprünge.
// Der Fahrplan (Timeline) weiß nichts von Abtastraten. So lassen sich Aufbau und Ton getrennt prüfen, und die Codierungs-Karten
// können sich dieselben Daten abholen, statt sich eigene auszudenken.

import { F_SYNC, F_LEADER, F_VIS_1, F_VIS_0, VIS_BIT_MS, LEADER_MS, BREAK_MS, CAL_HEADER } from './constants.js';
import { MODES, layout, linesPerPacket, visWithParity } from './modes.js';
import { rgbToYcc, valueToFreq } from './color.js';
import { FSK_HEAD_1500_MS, FSK_HEAD_2100_MS, FSK_BIT_MS, FSK_TAIL_MS, F_FSK_1, F_FSK_0, F_BLACK } from './constants.js';
import { fskSymbols } from './fskid.js';

/** Zeitplan: Töne mit fester Frequenz hintereinander. endMs[i] ist das Ende von Ton i (absolut, daher keine Rundungsdrift). */
export class Timeline {
  constructor(capacity = 1 << 16) {
    this.n = 0;
    this.endMs = new Float64Array(capacity);
    this.freq = new Float32Array(capacity);
    this.totalMs = 0;
  }
  add(ms, freq) {
    if (this.n === this.endMs.length) {
      const e = new Float64Array(this.n * 2); e.set(this.endMs); this.endMs = e;
      const f = new Float32Array(this.n * 2); f.set(this.freq); this.freq = f;
    }
    this.totalMs += ms;
    this.endMs[this.n] = this.totalMs;
    this.freq[this.n] = freq;
    this.n++;
  }
}

/** Vorspann: optionaler Kalibrierkopf, Leitton, Break, Leitton, VIS (Start, 7 Bit LSB zuerst, gerade Parität, Stopp). */
export function addPreamble(tl, mode, { calHeader = false } = {}) {
  if (calHeader) for (const [ms, f] of CAL_HEADER) tl.add(ms, f);
  tl.add(LEADER_MS, F_LEADER);
  tl.add(BREAK_MS, F_SYNC);
  tl.add(LEADER_MS, F_LEADER);
  tl.add(VIS_BIT_MS, F_SYNC); // Startbit
  const code = visWithParity(mode.vis);
  for (let b = 0; b < 8; b++) tl.add(VIS_BIT_MS, (code >> b) & 1 ? F_VIS_1 : F_VIS_0);
  tl.add(VIS_BIT_MS, F_SYNC); // Stoppbit
}

function checkImage(img, mode) {
  if (img.width !== mode.width || img.height !== mode.height) {
    throw new Error(`${mode.name} braucht ${mode.width}×${mode.height} Pixel, das Bild hat ${img.width}×${img.height}`);
  }
}

// Zeile y, Kanal c (0 R, 1 G, 2 B) als Wert 0..255 je Pixel
const rgbRow = (img, y, c) => {
  const row = new Float32Array(img.width);
  for (let x = 0; x < img.width; x++) row[x] = img.data[(y * img.width + x) * 4 + c];
  return row;
};

// YCrCb des ganzen Bildes (Studiobereich)
function toYcc(img) {
  const n = img.width * img.height;
  const Y = new Float32Array(n), Cr = new Float32Array(n), Cb = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [y, cr, cb] = rgbToYcc(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
    Y[i] = y; Cr[i] = cr; Cb[i] = cb;
  }
  return { Y, Cr, Cb };
}

const rowOf = (plane, w, y) => plane.subarray(y * w, (y + 1) * w);
const avgRows = (plane, w, y0, y1) => {
  const out = new Float32Array(w);
  const a = rowOf(plane, w, y0), b = rowOf(plane, w, y1);
  for (let x = 0; x < w; x++) out[x] = (a[x] + b[x]) / 2;
  return out;
};

function addScan(tl, ms, values) {
  const per = ms / values.length;
  for (let x = 0; x < values.length; x++) tl.add(per, valueToFreq(values[x]));
}

/** Bildteil des Zeitplans. Das Bild muss genau die Modusgröße haben (RGBA). */
export function addImage(tl, img, mode) {
  checkImage(img, mode);
  const w = mode.width, h = mode.height;
  const parts = layout(mode);

  if (mode.family === 'martin' || mode.family === 'scottie' || mode.family === 'wraase') { // RGB, Reihenfolge je nach Layout
    const chIndex = { R: 0, G: 1, B: 2 };
    for (let y = 0; y < h; y++) {
      for (const p of parts) {
        if (p.kind === 'scan') addScan(tl, p.ms, rgbRow(img, y, chIndex[p.ch]));
        else tl.add(p.ms, p.freq);
      }
    }
  } else if (mode.family === 'robot36') {
    const { Y, Cr, Cb } = toYcc(img);
    for (let y = 0; y < h; y++) {
      // Chroma gilt für zwei Bildzeilen: gerade Zeile R-Y, ungerade B-Y, jeweils Mittel aus eigener und folgender Zeile
      const y2 = Math.min(y + 1, h - 1);
      for (const p of parts) {
        if (p.kind === 'scan' && p.ch === 'Y') addScan(tl, p.ms, rowOf(Y, w, y));
        else if (p.kind === 'scan') addScan(tl, p.ms, avgRows(y % 2 === 0 ? Cr : Cb, w, y, y2));
        else tl.add(p.ms, p.sepFreqByParity ? p.sepFreqByParity[y % 2] : p.freq);
      }
    }
  } else if (mode.family === 'robot72') {
    // Jede Zeile trägt ihr eigenes Y, R-Y und B-Y (keine Mittelung über zwei Zeilen wie bei Robot 36)
    const { Y, Cr, Cb } = toYcc(img);
    for (let y = 0; y < h; y++) {
      for (const p of parts) {
        if (p.kind !== 'scan') { tl.add(p.ms, p.freq); continue; }
        addScan(tl, p.ms, rowOf(p.ch === 'Y' ? Y : p.ch === 'RY' ? Cr : Cb, w, y));
      }
    }
  } else if (mode.family === 'pd') {
    const { Y, Cr, Cb } = toYcc(img);
    for (let y = 0; y < h; y += linesPerPacket(mode)) {
      for (const p of parts) {
        if (p.kind !== 'scan') { tl.add(p.ms, p.freq); continue; }
        if (p.ch === 'Y0') addScan(tl, p.ms, rowOf(Y, w, y));
        else if (p.ch === 'RY') addScan(tl, p.ms, avgRows(Cr, w, y, y + 1));
        else if (p.ch === 'BY') addScan(tl, p.ms, avgRows(Cb, w, y, y + 1));
        else addScan(tl, p.ms, rowOf(Y, w, y + 1));
      }
    }
  } else throw new Error(`Unbekannte Modusfamilie: ${mode.family}`);
}

/** Ganzer Zeitplan: Vorspann + Bild. mode: Modus-Objekt oder Id. */
export function buildTimeline(img, mode, opts = {}) {
  const m = typeof mode === 'string' ? MODES[mode] : mode;
  if (!m) throw new Error(`Unbekannter Modus: ${mode}`);
  const tl = new Timeline();
  addPreamble(tl, m, opts);
  addImage(tl, img, m);
  if (opts.fskId) addFskId(tl, opts.fskId);
  return tl;
}

/** FSK-Rufzeichenkennung hinter dem Bild (Aufbau siehe src/constants.js). Ohne brauchbares Rufzeichen geschieht nichts. */
export function addFskId(tl, rufzeichen) {
  const symbole = fskSymbols(rufzeichen);
  if (!symbole.length) return;
  tl.add(FSK_HEAD_1500_MS, F_BLACK);
  tl.add(FSK_HEAD_2100_MS, F_FSK_0);
  tl.add(FSK_BIT_MS, F_FSK_1);
  for (const s of symbole) for (let i = 0; i < 6; i++) tl.add(FSK_BIT_MS, (s >> i) & 1 ? F_FSK_1 : F_FSK_0);
  tl.add(FSK_TAIL_MS, F_FSK_1);
}

// Sinustabelle für den Synthesizer: 4096 Stützstellen, linear interpoliert. Größter Fehler etwa 3·10⁻⁷ (weit unter 16 Bit), aber ein Mehrfaches
// schneller als Math.sin je Probe. Der Phasenakkumulator bleibt wie er ist, nur der Sinus kommt aus der Tabelle.
const TAB_N = 4096;
const SIN_TAB = Float64Array.from({ length: TAB_N + 1 }, (_, i) => Math.sin((2 * Math.PI * i) / TAB_N));
const TAB_SKALA = TAB_N / (2 * Math.PI);

/**
 * Erzeugt aus dem Zeitplan phasenstetiges Audio. Der Phasenakkumulator läuft ohne Sprünge durch alle Töne;
 * Ein- und Ausblenden (rampMs) vermeidet Knacken am Anfang und Ende.
 */
export class Synth {
  constructor(tl, sampleRate, { amplitude = 0.8, rampMs = 5 } = {}) {
    this.tl = tl;
    this.fs = sampleRate;
    this.amp = amplitude;
    this.total = Math.round((tl.totalMs * sampleRate) / 1000);
    this.ramp = Math.round((rampMs * sampleRate) / 1000);
    this.pos = 0;
    this.idx = 0;
    this.phase = 0;
    this.nextBound = Math.round((tl.endMs[0] * sampleRate) / 1000);
  }
  get done() { return this.pos >= this.total; }
  /** Schreibt bis zu out.length Samples, gibt die Anzahl zurück. */
  render(out) {
    const { tl, fs } = this;
    const twoPiOverFs = (2 * Math.PI) / fs;
    let i = 0;
    while (i < out.length && this.pos < this.total) {
      while (this.pos >= this.nextBound && this.idx < tl.n - 1) {
        this.idx++;
        this.nextBound = Math.round((tl.endMs[this.idx] * fs) / 1000);
      }
      this.phase += twoPiOverFs * tl.freq[this.idx];
      if (this.phase > 2 * Math.PI) this.phase -= 2 * Math.PI;
      let g = this.amp;
      if (this.pos < this.ramp) g *= this.pos / this.ramp;
      else if (this.total - this.pos <= this.ramp) g *= (this.total - this.pos) / this.ramp;
      const u = this.phase * TAB_SKALA, k = u | 0;
      out[i++] = (SIN_TAB[k] + (u - k) * (SIN_TAB[k + 1] - SIN_TAB[k])) * g;
      this.pos++;
    }
    return i;
  }
}

/** Alles in einem: Bild -> { samples (Float32Array), sampleRate, durationS, timeline }. */
export function encodeImage(img, mode, { sampleRate = 48000, amplitude = 0.8, calHeader = false, fskId = '' } = {}) {
  const tl = buildTimeline(img, mode, { calHeader, fskId });
  const synth = new Synth(tl, sampleRate, { amplitude });
  const samples = new Float32Array(synth.total);
  synth.render(samples);
  return { samples, sampleRate, durationS: tl.totalMs / 1000, timeline: tl };
}
