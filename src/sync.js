// Zeilentakt: Sync-Impulse einsammeln und daraus ein Zeilenmodell t(k) = t0 + k * P schätzen.
// Erst eine Hough-Suche über Phase und Takt (die lässt sich von Rauschimpulsen und fehlenden Syncs nicht beirren), dann eine
// Ausgleichsgerade durch die Treffer. Nebenbei fällt der Taktfehler der Soundkarte ab: P / Nennwert - 1. Das ist der Schräglauf.

import { F_SYNC, F_BLACK } from './constants.js';

/**
 * Sammelt Sync-Kandidaten zwischen tFrom und tTo: Läufe unter der Mitte zwischen 1200 und 1500 Hz (plus Versatz), deren Dauer zum Impuls passt.
 * Die Frequenz wird vorher über ein kurzes Fenster (35 % der Impulsdauer, höchstens 1,5 ms, im Raster von 0,5 ms) gemittelt, das unterdrückt Rauschen;
 * die Flanken bleiben dabei symmetrisch, die Impulsmitte also unverfälscht.
 * Gibt aufsteigende Beginnzeiten (s) zurück. Ein viel längerer Lauf (Stoppbit direkt vor der ersten Zeile) zählt über seine steigende Flanke.
 */
export function collectSyncs(track, tFrom, tTo, syncMs, offsetHz = 0, { ohneAnfangslauf = false, gitter = tFrom } = {}) {
  // gitter: Bezugspunkt des 0,5-ms-Rasters. Eine Fortsetzung nimmt den Anfang der ersten Suche, dann liegen die Abtastpunkte genau gleich
  // ohneAnfangslauf: Beginnt die Suche mitten in einem Lauf unter der Schwelle, zählt er nicht (Fortsetzung einer früheren Suche, siehe decodeImage)
  // offsetHz: Zahl oder Funktion der Zeit (für einen wandernden Versatz); die Schwelle folgt dem Versatz
  const offAt = typeof offsetHz === 'function' ? offsetHz : () => offsetHz;
  let thr = (F_SYNC + F_BLACK) / 2 + offAt(tFrom);
  const sync = syncMs / 1000;
  const step = 0.0005;
  const half = Math.min(0.0015, Math.max(step, 0.35 * sync)) / 2; // höchstens 1,5 ms: breitere Fenster verschieben die Mitte bei hellen Nachbarpixeln
  const out = [];
  let prevT = null, prevF = NaN, runStart = null, erster = true;
  const cross = (ta, fa, tb, fb) => {
    const fr = fa === fb ? 0.5 : (thr - fa) / (fb - fa);
    return ta + fr * (tb - ta);
  };
  // Zeitpunkte als gitter + i·step (nicht aufsummiert): gleiche Punkte, egal wo die Suche einsteigt
  for (let i = Math.ceil((tFrom - gitter) / step - 1e-9), t = gitter + i * step; t <= tTo; i++, t = gitter + i * step) {
    thr = (F_SYNC + F_BLACK) / 2 + offAt(t);
    const f = track.mean(t - half, t + half);
    if (Number.isNaN(f)) { prevT = null; runStart = null; continue; }
    const below = f < thr;
    if (prevT === null) { runStart = below && !(erster && ohneAnfangslauf) ? -Infinity : null; erster = false; }
    else {
      const belowPrev = prevF < thr;
      if (below && !belowPrev) runStart = cross(prevT, prevF, t, f);
      else if (!below && belowPrev && runStart !== null) {
        const tRise = cross(prevT, prevF, t, f);
        const dur = tRise - runStart;
        if (dur >= 0.6 * sync && dur <= 1.5 * sync) out.push((runStart + tRise) / 2 - sync / 2);
        else if (dur > 1.5 * sync) out.push(tRise - sync); // auch unendlich: Lauf begann vor dem Suchbereich
        runStart = null;
      }
    }
    prevT = t; prevF = f;
  }
  return out;
}

/**
 * Schätzt t0 und P aus Kandidaten. tRef: grobe Zeit der ersten Zeile, pNom: Nennperiode (s), lines: Anzahl Sendezeilen.
 * Gesucht wird über ppmMitte ± maxPpm (Vorgabe 0 ± 2500 ppm); mit Vorwissen über den Takt reicht ein enges Fenster.
 * Rückgabe { t0, P, inliers, ppm, hits } oder null, wenn kein Takt erkennbar ist (weniger als minInliers Treffer).
 * hits: aufsteigende Zeilennummern k (t0 + k*P), zu denen ein Sync-Kandidat passt.
 */
export function fitLineModel(cands, tRef, pNom, lines, { maxPpm = 2500, ppmMitte = 0, stepPpm = 4, binS = 0.0005, minInliers = 6 } = {}) {
  // Der Kandidatenbereich hängt nicht vom Suchfenster ab: Mit und ohne Vorwissen zählen dieselben Impulse, also dieselben Treffer
  const rand = Math.max(2500, Math.abs(ppmMitte) + maxPpm);
  const c = cands.filter((t) => t > tRef - 0.15 && t < tRef + (lines + 2) * pNom * (1 + rand * 1e-6));
  if (c.length < minInliers) return null;
  let best = { score: -1, ppm: 0, phase: 0 };
  // Ein Histogramm für alle Taktschritte (gut 1200 Stück), groß genug für den längsten; spart ebenso viele Speicheranforderungen je Aufruf,
  // und der Live-Decoder ruft das jede Sekunde auf
  const hist = new Int32Array(Math.ceil((pNom * (1 + (Math.abs(ppmMitte) + maxPpm) * 1e-6)) / binS) + 3);
  for (let ppm = ppmMitte - maxPpm; ppm <= ppmMitte + maxPpm; ppm += stepPpm) {
    const P = pNom * (1 + ppm * 1e-6);
    const nb = Math.ceil(P / binS) + 2;
    hist.fill(0, 0, nb);
    for (let j = 0; j < c.length; j++) {
      const x = (c[j] - tRef) / P;
      const r = (x - Math.floor(x)) * P; // Phase in [0, P)
      hist[Math.floor(r / binS)]++;
    }
    // Fenster von drei Klassen (±0,75 ms)
    for (let b = 0; b < nb - 2; b++) {
      const s = hist[b] + hist[b + 1] + hist[b + 2];
      if (s > best.score) best = { score: s, ppm, phase: (b + 1.5) * binS };
    }
  }
  if (best.score < minInliers) return null;
  // Ausgleichsgerade über die Treffer in der Nähe des besten Modells
  let P = pNom * (1 + best.ppm * 1e-6);
  let t0 = tRef + best.phase; // Zeit einer Zeile modulo P
  let tol = 0.0012;
  let inl = [];
  for (let iter = 0; iter < 5; iter++) {
    inl = [];
    for (const t of c) {
      const k = Math.round((t - t0) / P);
      if (k < -2 || k > lines + 2) continue;
      if (Math.abs(t - (t0 + k * P)) <= tol) inl.push([k, t]);
    }
    if (inl.length < minInliers) return null;
    const n = inl.length;
    let sk = 0, st = 0, skk = 0, skt = 0;
    for (const [k, t] of inl) { sk += k; st += t; skk += k * k; skt += k * t; }
    const den = n * skk - sk * sk;
    if (Math.abs(den) < 1e-9) return null;
    P = (n * skt - sk * st) / den;
    t0 = (st - P * sk) / n;
    tol = 0.0008;
  }
  // t0 auf Zeile 0 beziehen: kleinste Zeilennummer im Bereich [0, ...) wählen, so dass t0 nahe tRef liegt
  const shift = Math.round((tRef - t0) / P);
  t0 += shift * P;
  const hits = inl.map(([k]) => k - shift).sort((a, b) => a - b);
  return { t0, P, inliers: inl.length, ppm: (P / pNom - 1) * 1e6, hits };
}
