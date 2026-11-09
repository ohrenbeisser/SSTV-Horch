// Daten für die Karten der Codierung (ohne DOM, in Node getestet). Alles kommt aus der Modustabelle, den Konstanten und dem Encoder.
// So kann die Anzeige gar nicht von dem abweichen, was die App wirklich sendet (D23). Keine Lehrbuchzahlen von Hand.

import { layout, packetMs, visWithParity } from './modes.js';
import { F_SYNC, F_BLACK, F_WHITE, F_LEADER, F_VIS_0, F_VIS_1, VIS_BIT_MS, LEADER_MS, BREAK_MS } from './constants.js';
import { valueToFreq } from './color.js';
import { encodeImage, Timeline, addPreamble, Synth } from './encoder.js';
import { preambleSeconds } from './modes.js';

export const wertZuHz = valueToFreq;

/**
 * Teile der Sendezeile in Reihenfolge: { art: 'sync'|'porch'|'sep'|'scan', kanal (nur scan), startMs, ms,
 *   hz (feste Frequenz), hzListe (Robot-Separator: [gerade, ungerade]), hzBereich (scan: [1500, 2300]) }.
 * Zeit 0 ist der Beginn des Sync-Impulses; bei Scottie liegen Grün und Blau davor (negative Zeit).
 */
export function zeilenTeile(mode) {
  return layout(mode).map((p) => ({
    art: p.kind,
    kanal: p.ch,
    startMs: p.startMs,
    ms: p.ms,
    ...(p.kind === 'scan' ? { hzBereich: [F_BLACK, F_WHITE] } : p.sepFreqByParity ? { hzListe: [...p.sepFreqByParity] } : { hz: p.freq }),
  }));
}

/** Beginn und Ende der Sendezeile (ms, relativ zum Sync). */
export function zeilenFenster(mode) {
  const t = zeilenTeile(mode);
  const letzter = t[t.length - 1];
  return { vonMs: t[0].startMs, bisMs: letzter.startMs + letzter.ms };
}

/** Was wird zur Zeit ms (relativ zum Sync) gesendet? { teil, pixel, pixelAnzahl, pixelUs } (Pixel nur im Scan-Teil). */
export function inZeile(mode, ms) {
  const teile = zeilenTeile(mode);
  const f = zeilenFenster(mode);
  const t = Math.min(Math.max(ms, f.vonMs), f.bisMs - 1e-9);
  const teil = teile.find((p) => t >= p.startMs && t < p.startMs + p.ms) ?? teile[teile.length - 1];
  if (teil.art !== 'scan') return { teil };
  const pixel = Math.min(mode.width - 1, Math.floor(((t - teil.startMs) / teil.ms) * mode.width + 1e-9));
  return { teil, pixel, pixelAnzahl: mode.width, pixelUs: (teil.ms / mode.width) * 1000 };
}

/**
 * VIS-Kennung des Modus: Zahl, Datenbits (niederwertiges zuerst, wie gesendet), gerade Parität, binäre Schreibweise (höchstwertiges
 * zuerst, wie im Artikel) und die Folge aller Töne { name, ms, hz, bit? } mit Gesamtdauer.
 */
export function visDaten(mode) {
  const code = visWithParity(mode.vis);
  const datenbits = Array.from({ length: 7 }, (_, b) => (code >> b) & 1);
  const paritaet = (code >> 7) & 1;
  const bitHz = (b) => (b ? F_VIS_1 : F_VIS_0);
  const schritte = [
    { name: 'leitton1', ms: LEADER_MS, hz: F_LEADER },
    { name: 'break', ms: BREAK_MS, hz: F_SYNC },
    { name: 'leitton2', ms: LEADER_MS, hz: F_LEADER },
    { name: 'start', ms: VIS_BIT_MS, hz: F_SYNC },
    ...datenbits.map((bit, i) => ({ name: 'bit', nr: i, bit, ms: VIS_BIT_MS, hz: bitHz(bit) })),
    { name: 'paritaet', bit: paritaet, ms: VIS_BIT_MS, hz: bitHz(paritaet) },
    { name: 'stopp', ms: VIS_BIT_MS, hz: F_SYNC },
  ];
  return {
    vis: mode.vis,
    datenbits,
    paritaet,
    binaer: (mode.vis & 0x7f).toString(2).padStart(7, '0'),
    schritte,
    gesamtMs: schritte.reduce((a, s) => a + s.ms, 0),
  };
}

/** Wertebereich der Töne je Farbraum: RGB 0..255 oder YCrCb im Studiobereich (Y 16..235, D19). */
export function farbraumInfo(mode) {
  const ycc = mode.family === 'robot36' || mode.family === 'robot72' || mode.family === 'pd';
  return ycc
    ? { art: 'ycc', schwarzWert: 16, weissWert: 235, schwarzHz: valueToFreq(16), weissHz: valueToFreq(235) }
    : { art: 'rgb', schwarzWert: 0, weissWert: 255, schwarzHz: valueToFreq(0), weissHz: valueToFreq(255) };
}

// ------------------------------------------------------------------ Hörproben (Float32Array, mono)

const HOERPROBE_PEGEL = 0.5;

/** Sinuston mit weichem Ein- und Ausblenden (10 ms). */
export function tonSamples(freq, sekunden, fs = 48000) {
  const n = Math.round(sekunden * fs);
  const x = new Float32Array(n);
  const rampe = Math.min(Math.round(0.01 * fs), n >> 1);
  for (let i = 0; i < n; i++) {
    let g = 1;
    if (i < rampe) g = 0.5 - 0.5 * Math.cos((Math.PI * i) / rampe);
    else if (i >= n - rampe) g = 0.5 - 0.5 * Math.cos((Math.PI * (n - 1 - i)) / rampe);
    x[i] = HOERPROBE_PEGEL * g * Math.sin((2 * Math.PI * freq * i) / fs);
  }
  return x;
}

/** Der Vorspann mit der VIS-Kennung des Modus (so wie ihn der Encoder sendet). */
export function hoerprobeVis(mode, fs = 48000) {
  const tl = new Timeline();
  addPreamble(tl, mode);
  const synth = new Synth(tl, fs, { amplitude: HOERPROBE_PEGEL });
  const x = new Float32Array(synth.total);
  synth.render(x);
  return x;
}

const verlaufCache = new Map();

/** Zwei Sendezeilen des Modus mit einem Grauverlauf von Schwarz nach Weiß über die Zeilenbreite (hörbar als steigender Ton je Kanal). */
export function hoerprobeZeile(mode, fs = 48000) {
  const schluessel = `${mode.id}|${fs}`;
  if (!verlaufCache.has(schluessel)) {
    const w = mode.width, h = mode.height;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = Math.round((x / (w - 1)) * 255); data[i + 3] = 255; }
    const { samples } = encodeImage({ width: w, height: h, data }, mode, { sampleRate: fs, amplitude: HOERPROBE_PEGEL });
    const von = Math.round(preambleSeconds() * fs);
    verlaufCache.set(schluessel, samples.slice(von, von + Math.round(2 * packetMs(mode) / 1000 * fs)));
  }
  return verlaufCache.get(schluessel);
}
