// Rapportvorschlag für den RSV-Rapport (ohne DOM, in Node getestet). R = Lesbarkeit, S = Signalstärke, V = Bildqualität.
// Die App kann R und V aus dem empfangenen Bild abschätzen. S nicht: Die Feldstärke an der Antenne kennt nur das S-Meter des Funkgeräts,
// die App sieht bloß den Ton, der hinten rauskommt. Deshalb ist es ein Vorschlag, nie ein Messwert, und die Oberfläche lässt ihn änderbar.
//
// Die Stufen und ihre Beschreibungen stehen im Artikel „SSTV – Fernsehen im Schneckentempo“ (R und V 1 bis 5, S 1 bis 9, Schreibweise
// dreistellig, zum Beispiel 595). Die Grenzen unten sind keine Normwerte, sondern an simulierten Empfängen festgelegt
// (Rauschabstand 6 bis 40 dB, Modus Robot 36, Martin M2, PD120): Dort steigt das Bildrauschen gleichmäßig mit sinkendem Rauschabstand.

/** Obergrenzen des Bildrauschens (Standardabweichung auf der Skala 0 bis 255) für die Stufen 5, 4, 3 und 2; darüber ist es Stufe 1. */
export const V_GRENZEN = [1.5, 4, 10, 22];
// Schrift ist kontrastreich und groß, sie übersteht mehr Rauschen als feine Bilddetails: Für R sind die Grenzen weiter.
export const R_GRENZEN = [4, 10, 20, 30];

const stufe = (sigma, grenzen) => {
  for (let i = 0; i < grenzen.length; i++) if (sigma < grenzen[i]) return 5 - i;
  return 1;
};
export const stufeV = (sigma) => stufe(sigma, V_GRENZEN);
export const stufeR = (sigma) => stufe(sigma, R_GRENZEN);

/**
 * Bildrauschen als Standardabweichung (Skala 0 bis 255) aus der zweiten Differenz entlang der Zeile (Luma). Weißes Rauschen hat dort
 * die Varianz 6·σ², und der Median der Beträge ist unempfindlich gegen die wenigen harten Kanten eines Bildes. Nicht decodierte
 * (durchsichtige) Pixel zählen nicht. Ein Foto mit feiner Struktur liefert schon ohne Rauschen etwas Grundrauschen: dann bewertet
 * der Vorschlag eher zu streng.
 */
export function rauschSigma(image, zeilen = image.height) {
  const { width: w, data } = image;
  const hist = new Uint32Array(1021); // Beträge in halben Stufen
  let n = 0;
  const luma = (k) => 0.299 * data[k] + 0.587 * data[k + 1] + 0.114 * data[k + 2];
  for (let y = 0; y < Math.min(zeilen, image.height); y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      if (data[i + 3] === 0 || data[i - 1] === 0 || data[i + 7] === 0) continue;
      const d = Math.abs(luma(i - 4) - 2 * luma(i) + luma(i + 4));
      hist[Math.min(1020, Math.round(d * 2))]++;
      n++;
    }
  }
  if (!n) return 0;
  let summe = 0, median = 0;
  for (let k = 0; k < hist.length; k++) { summe += hist[k]; if (summe >= n / 2) { median = k / 2; break; } }
  return median / (0.6745 * Math.sqrt(6));
}

/**
 * Rapportvorschlag zu einem decodierten Bild: { r, v, sigma } oder null, wenn zu wenig Bild da ist (unter 20 Zeilen).
 * result: { image, validLines, quality } wie aus dem Decoder. quality ist der Anteil der Zeilen mit Sync-Treffer: Fehlen viele, hat das Bild
 * Lücken und Versatz, die das Rauschmaß nicht sieht, deshalb deckelt sie beide Stufen.
 */
export function rapportVorschlag({ image, validLines, quality }) {
  if (!image || validLines < 20) return null;
  const sigma = rauschSigma(image, validLines);
  const deckel = quality < 0.5 ? 2 : quality < 0.8 ? 3 : quality < 0.95 ? 4 : 5;
  return { r: Math.min(stufeR(sigma), deckel), v: Math.min(stufeV(sigma), deckel), sigma };
}

/** RSV-Schreibweise mit Fragezeichen für das, was die App nicht kennt (S, solange es niemand eingetragen hat). */
export const rapportMitS = (r, v, s = '?') => `${r}${s}${v}`;

/** Rapport als Text für die Anzeige: Fragezeichen für fehlende Teile, leer, wenn gar nichts eingetragen ist. */
export const rapportText = (r, s, v) => (r || s || v ? `${r || '?'}${s || '?'}${v || '?'}` : '');
/** S ist beim Empfang mit 9 vorbelegt (die App kann S nicht messen, 9 ist der übliche Ausgangswert und lässt sich ändern). */
export const S_VORGABE = 9;
