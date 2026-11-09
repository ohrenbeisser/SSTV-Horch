// AudioWorklet: Das Mikrofon liefert 128er-Blöckchen, das ist für jede Nachricht viel zu klein. Hier werden 4096 Proben gesammelt
// und dann am Stück an den Hauptthread geschickt (der Puffer wird übergeben, nicht kopiert).
class Aufnahme extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
  }
  process(inputs) {
    const x = inputs[0] && inputs[0][0];
    if (!x) return true;
    for (let i = 0; i < x.length; i++) {
      this.buf[this.n++] = x[i];
      if (this.n === this.buf.length) {
        this.port.postMessage(this.buf, [this.buf.buffer]);
        this.buf = new Float32Array(4096);
        this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor('sstv-aufnahme', Aufnahme);
