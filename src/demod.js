// FM-Demodulator: aus reellem Audio wird die Momentanfrequenz. Ablauf: mit der Bandmitte (1900 Hz) ins Basisband mischen,
// Tiefpass (Hann-gefensterter Sinc), auf etwa 12 kHz runtertakten, Frequenz aus dem Phasenschritt zweier Nachbarproben.
// Streamfähig: push() frisst Stücke beliebiger Größe, das Mikrofon liefert 4096er-Häppchen, eine WAV-Datei auch mal 64k am Stück.

import { FreqTrack } from './freqtrack.js';

export class FmDemod {
  /**
   * fs: Abtastrate des Audios. center: Mischfrequenz (Mitte des SSTV-Bandes). cutoff: Tiefpassgrenze in Hz.
   * decim: Teilerfaktor (Vorgabe so, dass etwa 12 kHz übrig bleiben).
   */
  constructor(fs, { center = 1900, cutoff = 1100, decim = null } = {}) {
    this.fs = fs;
    this.fc = center;
    this.D = decim ?? Math.max(1, Math.round(fs / 12000));
    let N = Math.round((3.1 * fs) / 1000); // Übergangsbereich etwa 1 kHz
    if (N % 2 === 0) N++;
    N = Math.max(N, 9);
    this.N = N;
    this.g = (N - 1) / 2; // Gruppenlaufzeit in Eingangsproben
    const h = new Float64Array(N);
    let sum = 0;
    for (let j = 0; j < N; j++) {
      const x = j - this.g;
      const sinc = x === 0 ? (2 * cutoff) / fs : Math.sin((2 * Math.PI * cutoff * x) / fs) / (Math.PI * x);
      h[j] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (N - 1)));
      sum += h[j];
    }
    for (let j = 0; j < N; j++) h[j] /= sum; // Gleichanteil 1
    this.h = h;
    this.histI = new Float64Array(N - 1);
    this.histQ = new Float64Array(N - 1);
    this.m = 0; // globaler Index der nächsten Eingangsprobe
    this.nextOut = 0; // globaler Index (Eingang) der nächsten Ausgabeprobe
    // Mischoszillator als Zeiger, der je Probe um w weitergedreht wird (zwei Multiplikationen statt Math.cos und Math.sin je Probe).
    // Am Ende jedes Stücks wird er auf Länge 1 gebracht, so sammelt sich kein Rundungsfehler an.
    const w = (2 * Math.PI * center) / fs;
    this.dc = Math.cos(w); this.ds = Math.sin(w);
    this.oc = 1; this.os = 0;
    this.prevI = 0;
    this.prevQ = 0;
    this.haveOut = false;
    this.rate = fs / this.D;
    // Ausgabeprobe k entspricht Eingangsindex k*D; sie bildet den Mittelwert über g Proben davor und danach (Laufzeit g), und die
    // Phasendifferenz zu k-1 gilt für die Mitte zwischen beiden: Zeit = (k*D - g - D/2)/fs.
    this.track = new FreqTrack(this.rate, (-this.g - this.D / 2) / fs);
  }

  /** Audio-Stück (Float32Array) verarbeiten. Gibt die Einzelfrequenzen der neuen Ausgabeproben zurück und hängt sie an this.track an. */
  push(x) {
    const { N, D, fc, h } = this;
    const H = N - 1;
    const len = x.length;
    const I = new Float64Array(H + len), Q = new Float64Array(H + len);
    I.set(this.histI); Q.set(this.histQ);
    const { dc, ds } = this;
    let oc = this.oc, os = this.os;
    for (let i = 0; i < len; i++) {
      I[H + i] = x[i] * oc;
      Q[H + i] = -x[i] * os;
      const c = oc * dc - os * ds;
      os = os * dc + oc * ds; oc = c;
    }
    const betrag = 1 / Math.hypot(oc, os);
    this.oc = oc * betrag; this.os = os * betrag;
    const base = this.m - H; // globaler Index von I[0]
    const end = this.m + len; // ausschließlich
    // Wie viele Ausgabeproben dieses Stück liefert, steht vorher fest: gleich ins fertige Feld schreiben statt sammeln und umkopieren
    const freq = new Float32Array(Math.max(0, Math.ceil((end - this.nextOut) / D)));
    let o = 0;
    const scale = this.rate / (2 * Math.PI);
    while (this.nextOut < end) {
      const p = this.nextOut - base; // lokaler Index der aktuellen Probe
      // Das Filter ist symmetrisch (h[j] = h[N-1-j]): Probenpaare erst addieren, dann einmal multiplizieren, das spart die Hälfte
      const g = (N - 1) >> 1;
      let yi = h[g] * I[p - g], yq = h[g] * Q[p - g];
      for (let j = 0; j < g; j++) {
        const a = p - j, b = p - (N - 1 - j);
        yi += h[j] * (I[a] + I[b]); yq += h[j] * (Q[a] + Q[b]);
      }
      let f = fc;
      if (this.haveOut) {
        const re = yi * this.prevI + yq * this.prevQ;
        const im = yq * this.prevI - yi * this.prevQ;
        f = fc + Math.atan2(im, re) * scale;
      }
      this.haveOut = true;
      this.prevI = yi; this.prevQ = yq;
      freq[o++] = f;
      this.nextOut += D;
    }
    // Verlauf für das nächste Stück
    this.histI.set(I.subarray(len, len + H)); this.histQ.set(Q.subarray(len, len + H));
    this.m = end;
    this.track.append(freq);
    return freq;
  }
}

/** Ganzes Audio auf einmal -> Frequenzspur. */
export function demodulate(samples, fs, opts) {
  const d = new FmDemod(fs, opts);
  const step = 1 << 16;
  for (let i = 0; i < samples.length; i += step) d.push(samples.subarray(i, Math.min(samples.length, i + step)));
  return d.track;
}
