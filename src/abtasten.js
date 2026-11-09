// Rohaufnahme des Mikrofons für die Galerie: Runtertakten (48 kHz auf 12 kHz, 16 Bit) und ein Schreiber, der mitten im Strom einen
// Abschnitt aufhebt. 12 kHz reichen locker, SSTV liegt unter 2,5 kHz, und die Aufnahme bleibt klein: Robot 36 etwa 0,9 MB, Scottie DX etwa
// 6,5 MB. Aus der WAV lässt sich das Bild später in „Empfangen“ (WAV-Datei laden) oder mit jedem anderen Programm neu decodieren.
// Ohne DOM, in Node getestet.

/** Streaming-Tiefpass (Hann-Sinc, Grenze 0,4 · Zielrate) mit Abwärtstakten. Gibt Int16 zurück. */
export class Dezimierer {
  constructor(fs, zielHz = 12000) {
    this.faktor = Math.max(1, Math.round(fs / zielHz));
    this.rate = fs / this.faktor;
    const N = 16 * this.faktor + 1;
    const grenze = (0.4 * this.rate) / fs; // Anteil der Eingangsrate
    this.h = new Float64Array(N);
    let summe = 0;
    for (let j = 0; j < N; j++) {
      const x = j - (N - 1) / 2;
      const sinc = x === 0 ? 2 * grenze : Math.sin(2 * Math.PI * grenze * x) / (Math.PI * x);
      this.h[j] = sinc * (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (N - 1)));
      summe += this.h[j];
    }
    for (let j = 0; j < N; j++) this.h[j] /= summe; // Gleichanteil 1
    this.N = N;
    this.verlauf = new Float32Array(N - 1); // letzte N-1 Eingangsproben des vorigen Stücks
    this.phase = 0; // wie viele Eingangsproben bis zur nächsten Ausgabeprobe fehlen
  }

  /** Audio-Stück (Float32, -1..1) rein, Int16 mit der Zielrate raus. */
  push(x) {
    const { N, h, faktor } = this;
    const gesamt = new Float32Array(N - 1 + x.length);
    gesamt.set(this.verlauf); gesamt.set(x, N - 1);
    const aus = [];
    for (let i = this.phase; i + N <= gesamt.length; i += faktor) {
      let s = 0;
      for (let j = 0; j < N; j++) s += h[j] * gesamt[i + j];
      aus.push(Math.max(-32768, Math.min(32767, Math.round(s * 32767))));
      this.phase = i + faktor - (gesamt.length - (N - 1)); // Start der nächsten Ausgabe relativ zum nächsten Stück
    }
    if (!aus.length) this.phase = Math.max(0, this.phase - x.length);
    this.verlauf.set(gesamt.subarray(gesamt.length - (N - 1)));
    return Int16Array.from(aus);
  }
}

/** Int16-Proben als 16-Bit-Mono-WAV (Uint8Array). */
export function zuWavBytes(samples, rate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, Math.round(rate), true); v.setUint32(28, Math.round(rate) * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, samples[i], true);
  return new Uint8Array(buf);
}

/**
 * Hält die letzten ringS Sekunden im Kreis vor (damit der Anfang eines Bildes noch da ist, wenn das „Start“-Ereignis kommt) und zeichnet
 * ab beginne() auf, bis beende() die Aufnahme als Int16Array herausgibt. Zeiten sind Sekunden seit der ersten Probe.
 */
export class Rohschreiber {
  constructor(fs, { ringS = 50, vorlaufS = 3 } = {}) {
    this.dez = new Dezimierer(fs);
    this.rate = this.dez.rate;
    this.vorlaufS = vorlaufS;
    this.ring = new Int16Array(Math.round(ringS * this.rate));
    this.n = 0; // Ausgabeproben insgesamt
    this.aktiv = null; // Liste von Int16Array-Stücken
  }

  /** Sekunden seit der ersten Probe, die schon verarbeitet sind. */
  get zeit() { return this.n / this.rate; }

  push(x) {
    const o = this.dez.push(x);
    if (!o.length) return;
    const L = this.ring.length;
    for (let i = 0; i < o.length; i++) this.ring[(this.n + i) % L] = o[i];
    this.n += o.length;
    if (this.aktiv) this.aktiv.push(o);
  }

  /** Aufnahme ab (t − Vorlauf) beginnen, soweit der Ring zurückreicht. Eine laufende Aufnahme wird verworfen. */
  beginne(t) {
    const L = this.ring.length;
    const von = Math.max(this.n - L, Math.floor((t - this.vorlaufS) * this.rate), 0);
    const anfang = new Int16Array(this.n - von);
    for (let i = 0; i < anfang.length; i++) anfang[i] = this.ring[(von + i) % L];
    this.aktiv = [anfang];
  }

  get laeuft() { return this.aktiv !== null; }

  /** Gibt die Aufnahme zurück (oder null, wenn keine lief) und hört auf. */
  beende() {
    if (!this.aktiv) return null;
    const teile = this.aktiv;
    this.aktiv = null;
    const out = new Int16Array(teile.reduce((s, q) => s + q.length, 0));
    let p = 0; for (const q of teile) { out.set(q, p); p += q.length; }
    return out;
  }
}
