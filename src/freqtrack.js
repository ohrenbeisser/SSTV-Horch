// Frequenzspur: die Momentanfrequenz als gleichmäßige Reihe mit Summentabelle. Damit kostet der Mittelwert über ein beliebiges
// Zeitstück (ein Pixel, ein VIS-Bit) immer gleich wenig, egal wie lang. Wächst beim Anhängen mit (Live-Betrieb).
// Probe i liegt bei t0 + i/rate und steht für das Intervall [i-0,5; i+0,5) in Indexeinheiten.
//
// Warum ausgerechnet der einfache Mittelwert? Er entspricht dem Phasenzuwachs über das Fenster und bleibt auch bei Rauschen unverzerrt.
// In E2 an der ISS-Aufnahme von 2009 ausprobiert: Das amplitudengewichtete Mittel zieht zur Bandmitte (1200 Hz wurde zu 1298 Hz), der
// Median verzerrt auch (Rauschen ist schief verteilt). Also: Finger weg, Mittelwert bleibt.

export class FreqTrack {
  constructor(rate, t0 = 0) {
    this.rate = rate;
    this.t0 = t0;
    this.n = 0;
    this.f = new Float32Array(1 << 16);
    this.cum = new Float64Array((1 << 16) + 1);
  }
  append(freq) {
    const add = freq.length;
    if (this.n + add > this.f.length) {
      let cap = this.f.length;
      while (cap < this.n + add) cap *= 2;
      const f = new Float32Array(cap); f.set(this.f.subarray(0, this.n)); this.f = f;
      const c = new Float64Array(cap + 1); c.set(this.cum.subarray(0, this.n + 1)); this.cum = c;
    }
    for (let i = 0; i < add; i++) {
      this.f[this.n] = freq[i];
      this.cum[this.n + 1] = this.cum[this.n] + freq[i];
      this.n++;
    }
  }
  /** Verwirft alle Proben vor der Zeit t (Speicher im Dauerbetrieb begrenzen). Zeiten bleiben absolut, t0 rückt vor. */
  discardBefore(t) {
    const k = Math.min(this.n, Math.floor(this.indexOf(t)));
    if (k <= 0) return;
    const rest = this.n - k;
    const base = this.cum[k];
    this.f.copyWithin(0, k, this.n);
    for (let i = 0; i <= rest; i++) this.cum[i] = this.cum[k + i] - base;
    this.n = rest;
    this.t0 += k / this.rate;
  }
  /** Ende des letzten Intervalls in Sekunden. */
  get endTime() { return this.t0 + (this.n - 0.5) / this.rate; }
  indexOf(t) { return (t - this.t0) * this.rate; }
  timeOf(i) { return this.t0 + i / this.rate; }
  _integral(x) {
    const u = x + 0.5;
    if (u <= 0) return 0;
    if (u >= this.n) return this.cum[this.n];
    const k = Math.floor(u);
    return this.cum[k] + (u - k) * this.f[k];
  }
  /** Mittlere Frequenz über [ta, tb] in Sekunden; NaN, wenn der Abschnitt außerhalb der Daten liegt. */
  mean(ta, tb) {
    let xa = this.indexOf(ta), xb = this.indexOf(tb);
    if (xb < -0.5 || xa > this.n - 0.5) return NaN;
    xa = Math.max(xa, -0.5); xb = Math.min(xb, this.n - 0.5);
    if (xb - xa < 1e-9) return this.at(ta);
    return (this._integral(xb) - this._integral(xa)) / (xb - xa);
  }
  /**
   * n gleich breite Fenster ab ts (Breite per): out[x] = mean(ts + x·per, ts + (x+1)·per), mit genau denselben Rändern und NaN-Regeln.
   * Nachbarpixel teilen sich ihre Grenze, deshalb wird jede Grenze nur einmal integriert statt zweimal: halbe Arbeit beim Abtasten einer Zeile.
   */
  meanRow(ts, per, n, out) {
    const lo = -0.5, hi = this.n - 0.5;
    let xa = this.indexOf(ts);
    let ca = Math.min(Math.max(xa, lo), hi), ia = this._integral(ca);
    for (let x = 0; x < n; x++) {
      const xb = this.indexOf(ts + (x + 1) * per);
      const cb = Math.min(Math.max(xb, lo), hi), ib = this._integral(cb);
      if (xb < lo || xa > hi) out[x] = NaN;
      else if (cb - ca < 1e-9) out[x] = this.at(ts + x * per);
      else out[x] = (ib - ia) / (cb - ca);
      xa = xb; ca = cb; ia = ib;
    }
    return out;
  }
  /** Frequenz zur Zeit t (linear zwischen Proben). */
  at(t) {
    const x = this.indexOf(t);
    if (x < 0 || x > this.n - 1) return NaN;
    const k = Math.floor(x), fr = x - k;
    return fr === 0 || k + 1 >= this.n ? this.f[k] : this.f[k] * (1 - fr) + this.f[k + 1] * fr;
  }
}
