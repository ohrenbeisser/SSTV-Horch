// Web Worker für den Rauschsimulator: Bild kodieren, stören, decodieren und bewerten. Ein PD180 dauert ein paar Sekunden Rechenzeit,
// die soll die Oberfläche nicht merken.
// Rein: { id, modeId, image: { width, height, data }, snrDb, offsetHz, clockPpm }.
// Raus: { id, ergebnis: { image | null, erkannt (Modus-ID | null), vis, validLines, quality, fehler, offsetHz, ppm, dauerS, rechenMs } }.
import { MODES } from './modes.js';
import { decodeRecording } from './decoder.js';
import { kodiereGestoert, besterTreffer, mittlererFehler } from './stoerung.js';

self.onmessage = (e) => {
  const { id, modeId, image, snrDb, offsetHz, clockPpm } = e.data;
  const t0 = Date.now();
  try {
    const mode = MODES[modeId];
    const bild = { width: image.width, height: image.height, data: new Uint8ClampedArray(image.data) };
    const samples = kodiereGestoert(bild, mode, { fs: 48000, snrDb, offsetHz, clockPpm });
    const { results } = decodeRecording(samples, 48000);
    const r = besterTreffer(results);
    const ergebnis = r && r.mode.id === modeId
      ? { image: r.image, erkannt: r.mode.id, vis: r.vis, validLines: r.validLines, quality: r.quality, fehler: mittlererFehler(r.image, bild), offsetHz: r.offsetHz, ppm: r.blind ? r.ppm : r.model?.ppm ?? null }
      : { image: null, erkannt: r?.mode?.id ?? null, vis: r?.vis ?? null, validLines: r?.validLines ?? 0, quality: r?.quality ?? 0, fehler: null, offsetHz: null, ppm: null };
    ergebnis.dauerS = samples.length / 48000;
    ergebnis.rechenMs = Date.now() - t0;
    postMessage({ id, ergebnis }, ergebnis.image ? [ergebnis.image.data.buffer] : []);
  } catch (err) {
    postMessage({ id, fehler: String(err.message ?? err) });
  }
};
