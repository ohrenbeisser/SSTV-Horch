// FFT, Radix 2, in place. Für reelle und komplexe Reihen, die Länge muss eine Zweierpotenz sein. Schlicht, aber für das Labor reicht's.

export function fft(re, im) {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0 || im.length !== n) throw new Error('Länge muss eine Zweierpotenz sein');
  for (let i = 1, j = 0; i < n; i++) { // Bitumkehr
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const w = (-2 * Math.PI) / len, wr = Math.cos(w), wi = Math.sin(w);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}
