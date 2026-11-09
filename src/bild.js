// Bildhilfen ohne DOM (laufen in Node und im Browser). Ein Bild ist hier { width, height, data } mit RGBA in 8 Bit, also genau wie ImageData.

/**
 * Skaliert ein Bild durch Flächenmittelung (Kasten-Filter, gut beim Verkleinern).
 * fit: 'stretch' = ganzes Bild auf Zielgröße, 'cover' = Seitenverhältnis erhalten, mittig zuschneiden.
 */
export function skaliere(img, width, height, fit = 'cover') {
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (fit === 'cover') {
    const ziel = width / height;
    if (img.width / img.height > ziel) { sw = img.height * ziel; sx = (img.width - sw) / 2; }
    else { sh = img.width / ziel; sy = (img.height - sh) / 2; }
  }
  // erst waagerecht, dann senkrecht
  const tmp = new Float32Array(width * img.height * 4);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < width; x++) {
      const a = sx + (x * sw) / width, b = sx + ((x + 1) * sw) / width;
      accumulate(img.data, y * img.width * 4, 4, a, b, img.width, tmp, (y * width + x) * 4, 1);
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  const col = new Float32Array(4);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const a = sy + (y * sh) / height, b = sy + ((y + 1) * sh) / height;
      col.fill(0);
      accumulate(tmp, x * 4, width * 4, a, b, img.height, col, 0, 1);
      for (let c = 0; c < 4; c++) out[(y * width + x) * 4 + c] = Math.round(col[c]);
    }
  }
  return { width, height, data: out };
}

// Mittelt Quellwerte im Intervall [a, b) (in Quellpixeln) mit Flächengewichten.
function accumulate(src, base, stride, a, b, limit, dst, dstOff) {
  const i0 = Math.max(0, Math.floor(a)), i1 = Math.min(limit - 1, Math.ceil(b) - 1);
  let wsum = 0;
  const acc = [0, 0, 0, 0];
  for (let i = i0; i <= i1; i++) {
    const w = Math.min(b, i + 1) - Math.max(a, i);
    if (w <= 0) continue;
    wsum += w;
    for (let c = 0; c < 4; c++) acc[c] += src[base + i * stride + c] * w;
  }
  for (let c = 0; c < 4; c++) dst[dstOff + c] = wsum ? acc[c] / wsum : 0;
}
