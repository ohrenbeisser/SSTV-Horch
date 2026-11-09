// Messkram fürs Labor (ohne DOM, in Node getestet): Pegel, stärkster Ton im Spektrum und die Taktabweichung zweier Geräte über einen
// Referenzton.

import { fft } from './fft.js';
import { FmDemod } from './demod.js';

const dB = (x) => (x > 1e-6 ? 20 * Math.log10(x) : -120);

/** Spitzenwert, Effektivwert (linear und in dBFS) und Zahl der Proben nahe Vollaussteuerung (|x| >= 0,99). */
export function pegel(samples) {
  let peak = 0, summe = 0, clips = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 0.99) clips++;
    summe += samples[i] * samples[i];
  }
  const rms = samples.length ? Math.sqrt(summe / samples.length) : 0;
  return { peak, rms, clips, peakDb: dB(peak), rmsDb: dB(rms) };
}

/**
 * Stärkster Ton im Band [vonHz, bisHz] aus den letzten 2^k Proben (höchstens 65536): Hann-Fenster, FFT, Parabel durch die drei
 * Pegel um den Spitzenbin (in dB) für die Feinschätzung. Gibt { hz, db, rauschDb, abstandDb } zurück; rauschDb ist der Median
 * im Band ohne die Umgebung der Spitze, abstandDb der Abstand der Spitze dazu (klein = kein klarer Ton).
 */
export function schaetzeSpitze(samples, fs, vonHz, bisHz) {
  let N = 1; while (N * 2 <= Math.min(samples.length, 65536)) N *= 2;
  if (N < 1024) return { hz: NaN, db: -120, rauschDb: -120, abstandDb: 0 };
  const re = new Float64Array(N), im = new Float64Array(N);
  const off = samples.length - N;
  for (let i = 0; i < N; i++) re[i] = samples[off + i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  fft(re, im);
  const bin = fs / N;
  const k0 = Math.max(2, Math.floor(vonHz / bin)), k1 = Math.min(N / 2 - 2, Math.ceil(bisHz / bin));
  const mag = new Float64Array(k1 + 2);
  for (let k = k0 - 1; k <= k1 + 1; k++) mag[k] = dB(Math.hypot(re[k], im[k]) / N);
  let kp = k0;
  for (let k = k0; k <= k1; k++) if (mag[k] > mag[kp]) kp = k;
  const a = mag[kp - 1], b = mag[kp], c = mag[kp + 1];
  const nenner = a - 2 * b + c;
  const delta = nenner < -1e-9 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / nenner)) : 0;
  const rest = [];
  for (let k = k0; k <= k1; k++) if (Math.abs(k - kp) > 8) rest.push(mag[k]);
  rest.sort((x, y) => x - y);
  const rauschDb = rest.length ? rest[rest.length >> 1] : -120;
  return { hz: (kp + delta) * bin, db: b, rauschDb, abstandDb: b - rauschDb };
}

/**
 * Taktabweichung aus einem Referenzton: Liegt auf dem Sender ein Ton von genau mitteHz (Proben des Senders), hört ihn ein Empfänger
 * mit anderer Uhr bei mitteHz * (1 + Unterschied der Uhren). Der Mittelwert der Momentanfrequenz (Frequenzspur des Demodulators, Mitte
 * mitteHz) über [vonS, bisS] ist der Phasenzuwachs je Zeit und damit auch bei viel Rauschen unverzerrt.
 * Gibt { hz (mittlere Frequenz), ppm (Abweichung der Uhren, positiv = Sender schneller), streuung (Hz, Standardabweichung der Sekundenmittel) }.
 */
export function taktMessung(track, vonS, bisS, mitteHz = 1900) {
  const hz = track.mean(vonS, bisS);
  const blocks = [];
  for (let t = vonS; t + 1 <= bisS + 1e-9; t += 1) { const m = track.mean(t, t + 1); if (!Number.isNaN(m)) blocks.push(m); }
  const mittel = blocks.reduce((x, y) => x + y, 0) / (blocks.length || 1);
  const streuung = blocks.length > 1 ? Math.sqrt(blocks.reduce((x, y) => x + (y - mittel) ** 2, 0) / (blocks.length - 1)) : 0;
  return { hz, ppm: ((hz - mitteHz) / mitteHz) * 1e6, streuung };
}

/**
 * Signalabstand aus dem Spektrum eines AnalyserNode (getByteFrequencyData, Bytes 0..255 zwischen minDb und maxDb) im Band vonHz bis bisHz.
 * Gemessen wird die Leistung im ganzen Band gegen das Grundrauschen: Ein SSTV-Signal wechselt alle 0,27 ms die Frequenz und verschmiert
 * seine Energie über das Band, eine Spitze gibt es nicht. Die Leistung (Summe über die Bins) bleibt aber erhalten. Das Grundrauschen
 * (Median der Bins, gemeint als Dichte je Bin) kommt aus bodenDb, sonst aus diesem Frame ohne die Umgebung der Spitze. Mit Bild im Band
 * gehört der Wert aus einer Pause hinein, siehe die Ansicht „Empfangen“. Das Ergebnis ist der Rauschabstand im bandHz-breiten Band, wie
 * ihn der Rauschsimulator im Labor angibt: Der Median von Rauschen liegt 1,6 dB unter dem Mittelwert, und Signal- und Rauschsumme haben
 * dieselbe Skala (Parseval), das Verhältnis braucht also keine Fensterkorrektur, nur die Umrechnung der Bandbreite.
 * Dazu rauschDbfs: der Effektivwert des Grundrauschens im Band in dBFS (0 dBFS = Vollaussteuerung). Bei weißem Rauschen der Stärke σ steckt
 * im Band der Anteil (Bandbreite / halbe Abtastrate) der Leistung, und ein Bin des Blackman-Spektrums (FFT-Länge N, Fensterleistung 0,3974·N)
 * zeigt σ²·0,3974/N. Gibt { peakDb, bodenDb (Median dieses Frames), snrDb, rauschDbfs } zurück.
 */
export function signalabstand(daten, fs, minDb, maxDb, { bodenDb = null, vonHz = 1000, bisHz = 2500, bandHz = 2400 } = {}) {
  const bin = fs / (2 * daten.length);
  const k0 = Math.max(1, Math.floor(vonHz / bin)), k1 = Math.min(daten.length - 2, Math.ceil(bisHz / bin));
  const db = (b) => minDb + (b / 255) * (maxDb - minDb);
  let kp = k0;
  for (let k = k0; k <= k1; k++) if (daten[k] > daten[kp]) kp = k;
  const rest = [];
  for (let k = k0; k <= k1; k++) if (Math.abs(k - kp) > 8) rest.push(daten[k]);
  rest.sort((x, y) => x - y);
  const peakDb = db(daten[kp]);
  const eigenDb = rest.length ? db(rest[rest.length >> 1]) : minDb;
  const boden = bodenDb ?? eigenDb;
  const medianZuMittel = -10 * Math.log10(Math.LN2); // +1,6 dB
  const bins = k1 - k0 + 1;
  let summe = 0;
  for (let k = k0; k <= k1; k++) summe += 10 ** (db(daten[k]) / 10);
  const rauschSumme = bins * 10 ** ((boden + medianZuMittel) / 10);
  const nutz = Math.max(summe - rauschSumme, rauschSumme * 0.01); // nie negativ: ein Frame darf leiser sein als der Schätzwert
  const snrDb = 10 * Math.log10(nutz / rauschSumme) + 10 * Math.log10((bins * bin) / bandHz);
  const N = 2 * daten.length;
  const rauschDbfs = boden + medianZuMittel + 10 * Math.log10(N / 0.3974) + 10 * Math.log10((bins * bin) / (fs / 2));
  return { peakDb, bodenDb: eigenDb, snrDb, rauschDbfs };
}

/**
 * Pegelklasse zur Spitze (0 bis 1, Vollaussteuerung = 1): zuleise unter 0,03 (−30 dBFS), gut bis 0,5 (−6 dBFS), hoch bis 0,97
 * (noch ohne Abschneiden, aber wenig Reserve), zulaut darüber. Dieselben Grenzen nennt der Labor-Text (gut: etwa −20 bis −6 dBFS).
 */
export const pegelArt = (spitze) => (spitze > 0.97 ? 'zulaut' : spitze > 0.5 ? 'hoch' : spitze < 0.03 ? 'zuleise' : 'gut');

/** Stufe zum Rauschabstand (dB im 2400-Hz-Band): sehrgut, gut, koernig (Bild wird körnig), schwach (Sync hält gerade noch), kein. */
export const bewerteSnr = (db) => (db >= 30 ? 'sehrgut' : db >= 20 ? 'gut' : db >= 12 ? 'koernig' : db >= 6 ? 'schwach' : 'kein');

/**
 * Abtastrate, mit der der Encoder rechnen soll, damit ein Gerät mit ungenauer Uhr den richtigen Ton ausgibt.
 * ppm ist der Wert aus der Taktmessung im Labor: Misst dieses Gerät den Referenzton zu hoch (+ppm), läuft seine Uhr zu langsam,
 * und was es sendet, klingt entsprechend zu tief. Also wird mit der etwas niedrigeren Rate gerechnet, das hebt alle Töne an und
 * dehnt die Zeiten passend. Abgespielt und gepuffert wird weiterhin mit der Nennrate.
 */
export const senderate = (fs, ppm) => fs * (1 - ppm * 1e-6);

/**
 * Taktmessung für den Dauerbetrieb: Rechnet dasselbe wie taktMessung (Mittel ab Sekunde 2, Streuung der Sekundenmittel), hält aber nicht
 * die ganze Frequenzspur fest. Fertige Sekunden wandern in eine Summe, die Spur wird laufend gekürzt. Ohne das wären es bei 12 kHz Spurtakt
 * rund 140 KB je Sekunde, nach zehn Minuten also gut 80 MB. Auf dem Handy ist das kein Spaß.
 */
export class Taktmesser {
  constructor(fs, { mitteHz = 1900, vorlaufS = 2 } = {}) {
    this.demod = new FmDemod(fs);
    this.mitteHz = mitteHz;
    this.start = this.demod.track.t0; // Beginn der Spur, für die Dauer
    this.block = this.start + vorlaufS; // Beginn der nächsten vollen Sekunde
    this.bloecke = []; // Mittel je voller Sekunde
    this.summe = 0; // Frequenz mal Zeit über alle vollen Sekunden
  }

  /** Audio-Stück anhängen. */
  push(x) {
    const tr = this.demod.track;
    this.demod.push(x);
    while (tr.endTime >= this.block + 1) {
      const m = tr.mean(this.block, this.block + 1);
      if (!Number.isNaN(m)) { this.bloecke.push(m); this.summe += m; }
      this.block += 1;
    }
    tr.discardBefore(this.block - 1); // eine Sekunde Reserve bleibt stehen
  }

  /** { hz, ppm, streuung, dauer (s seit Beginn), n (volle Sekunden) }; vor dem Vorlauf ist hz NaN. */
  ergebnis() {
    const tr = this.demod.track;
    const rest = Math.max(0, tr.endTime - this.block);
    const restMittel = rest > 1e-6 ? tr.mean(this.block, tr.endTime) : 0;
    const n = this.bloecke.length;
    const zeit = n + rest;
    const hz = zeit > 0 ? (this.summe + (Number.isNaN(restMittel) ? 0 : restMittel * rest)) / zeit : NaN;
    const mittel = n ? this.summe / n : 0;
    const streuung = n > 1 ? Math.sqrt(this.bloecke.reduce((a, y) => a + (y - mittel) ** 2, 0) / (n - 1)) : 0;
    return { hz, ppm: ((hz - this.mitteHz) / this.mitteHz) * 1e6, streuung, dauer: tr.endTime - this.start, n };
  }
}
