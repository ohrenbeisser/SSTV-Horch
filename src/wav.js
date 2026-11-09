// WAV rein, WAV raus. Lesen kann es PCM mit 8, 16, 24 und 32 Bit, Float32 und auch die „Extensible“-Variante, die Audacity und Co.
// gern schreiben. Mehrere Kanäle werden zu Mono gemischt. Geschrieben wird immer 16 Bit Mono, das frisst jedes Programm.

/** Float32-Samples (-1..1) als 16-Bit-PCM-WAV (Uint8Array), mono. */
export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE');
  txt(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  txt(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return new Uint8Array(buf);
}

/** WAV-Bytes -> { sampleRate, samples (Float32Array, mono, -1..1), channels }. Tolerant gegenüber falschen Längenangaben im Kopf. */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Keine WAV-Datei');
  let o = 12, fmt = null, data = null;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    let size = v.getUint32(o + 4, true);
    if (o + 8 + size > bytes.length) size = bytes.length - o - 8; // abgeschnittene Datei
    if (id === 'fmt ') {
      fmt = { format: v.getUint16(o + 8, true), channels: v.getUint16(o + 10, true), sampleRate: v.getUint32(o + 12, true), bits: v.getUint16(o + 22, true) };
      // WAVE_FORMAT_EXTENSIBLE (0xFFFE): das echte Format steckt in den ersten zwei Bytes der Unterformat-GUID (1 = PCM, 3 = Float)
      if (fmt.format === 0xfffe && size >= 40) fmt.format = v.getUint16(o + 8 + 24, true);
    } else if (id === 'data') { data = { start: o + 8, size }; break; }
    o += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('WAV ohne fmt- oder data-Block');
  const { format, channels, bits, sampleRate } = fmt;
  const bytesPer = bits / 8;
  const frames = Math.floor(data.size / (bytesPer * channels));
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const p = data.start + (i * channels + c) * bytesPer;
      let s;
      if (format === 3 && bits === 32) s = v.getFloat32(p, true);
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128;
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) s = ((v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getInt8(p + 2) << 16)) / 8388608);
      else if (bits === 32) s = v.getInt32(p, true) / 2147483648;
      else throw new Error(`Nicht unterstützte Bittiefe ${bits}`);
      sum += s;
    }
    out[i] = sum / channels;
  }
  return { sampleRate, samples: out, channels };
}
