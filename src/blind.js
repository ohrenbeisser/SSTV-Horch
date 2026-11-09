// Moduserkennung ohne VIS, also Raten mit System: Für jeden Modus wird in Zeitfenstern ein Zeilenmodell gesucht (src/sync.js).
// Der Modus mit deutlich den meisten Treffern gewinnt, dann wird der Impulszug in beide Richtungen weiterverfolgt.
// Damit klappen auch Aufnahmen, bei denen der Anfang fehlt oder das VIS im Rauschen abgesoffen ist.

import { MODES, packetMs, linesPerPacket } from './modes.js';
import { collectSyncs, fitLineModel } from './sync.js';

function nearestIndex(c, t) { // Index des Kandidaten, der t am nächsten liegt (c aufsteigend)
  let lo = 0, hi = c.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid] < t) lo = mid + 1; else hi = mid; }
  if (lo > 0 && Math.abs(c[lo - 1] - t) < Math.abs(c[lo] - t)) lo--;
  return lo;
}

function regress(pts) { // Gerade t = t0 + k*P durch Punkte [k, t]
  const n = pts.length;
  let sk = 0, st = 0, skk = 0, skt = 0;
  for (const [k, t] of pts) { sk += k; st += t; skk += k * k; skt += k * t; }
  const den = n * skk - sk * sk;
  const P = (n * skt - sk * st) / den;
  return { P, t0: (st - P * sk) / n };
}

// Zug von Impulsen über das Fenster hinaus in beide Richtungen verfolgen. Gibt alle Treffer [k, t] zurück.
function extend(c, model, tEnd, { tol = 0.0015, maxMiss = 6 } = {}) {
  const pts = new Map(model.hits.map((k) => [k, c[nearestIndex(c, model.t0 + k * model.P)]]));
  const walk = (dir, k0) => {
    let k = k0, misses = 0;
    const recent = () => {
      const arr = [...pts.entries()].filter(([kk]) => (dir > 0 ? kk <= k0 : kk >= k0)).sort((a, b) => dir * (b[0] - a[0])).slice(0, 40);
      return arr.length >= 6 ? regress(arr) : model;
    };
    let m = recent();
    for (let step = 0; ; step++) {
      k += dir;
      const pred = m.t0 + k * m.P;
      if (pred < c[0] - 1 || pred > Math.min(tEnd, c[c.length - 1]) + 1) break;
      const i = nearestIndex(c, pred);
      if (Math.abs(c[i] - pred) <= tol) { pts.set(k, c[i]); misses = 0; if (step % 4 === 0) m = recent(); }
      else if (++misses > maxMiss) break;
    }
  };
  walk(+1, Math.max(...model.hits));
  walk(-1, Math.min(...model.hits));
  return [...pts.entries()].sort((a, b) => a[0] - b[0]);
}

/**
 * Modi mit gleicher Sync-Länge, deren Zeilendauer ein ganzzahliges Vielfaches k ≥ 2 der Zeilendauer eines anderen ist (Robot 72 = 2 × Robot 36,
 * Scottie DX = 7 × Robot 36), lassen sich allein am Impulsabstand nicht trennen: Jeder Impuls des langsamen Modus passt auch ins Modell des schnellen.
 * Die Treffer verraten es aber. Ist der langsame Modus B der echte, trifft das Modell des schnellen A jeden Impuls, genauso oft wie B selbst. Ist A der
 * echte, trifft B nur jeden k-ten Impuls, A hat also etwa k-mal so viele Treffer. Der Entscheid fällt bei 0,6 · k (Mitte, auf der sicheren Seite beider
 * Fälle). Der Verlierer wird aus der Liste genommen, sonst würde der Abstand zum Zweitbesten (Fehlerschutz unten) beide verwerfen.
 */
function loeseHarmonische(res) {
  for (let i = 0; i < res.length; i++) {
    for (let j = 0; j < res.length; j++) {
      const a = res[i], b = res[j]; // a: schneller (kürzere Zeile), b: langsamer
      if (!a || !b || a === b || a.mode.syncMs !== b.mode.syncMs) continue;
      const pa = packetMs(a.mode), pb = packetMs(b.mode);
      const k = Math.round(pb / pa);
      if (k < 2 || Math.abs(pb / pa - k) > 0.003 * k) continue;
      const verlierer = a.f.inliers < 0.6 * k * b.f.inliers ? a : b;
      res.splice(res.indexOf(verlierer), 1);
      return loeseHarmonische(res); // Liste hat sich geändert: von vorn
    }
  }
}

/**
 * Sucht Züge von Sync-Impulsen und bestimmt jeweils den Modus.
 * Optionen: from, to (s), exclude: [[von, bis], ...] (Zeiten bereits decodierter Bilder), modes, windowS, hopS,
 * minInliers (Treffer mindestens), minFraction (Anteil der möglichen Zeilen im Fenster), minRatio (Abstand zum zweitbesten Modus).
 * Rückgabe Liste { mode, t0, P, ppm, kFirst, kLast, inliers, lines } nach Zeit sortiert; t0 gilt für Zeile k = 0,
 * die erste gefundene Zeile ist kFirst (Zeit t0 + kFirst*P).
 */
export function detectTrains(track, { from = 0, to = track.endTime, exclude = [], modes = Object.values(MODES), windowS = 60, hopS = 30,
  minInliers = 24, minFraction = 0.4, minRatio = 2.5 } = {}) {
  const classes = new Map(); // syncMs -> Kandidaten
  for (const m of modes) {
    if (classes.has(m.syncMs)) continue;
    const c = collectSyncs(track, from, to, m.syncMs, 0).filter((t) => !exclude.some(([a, b]) => t >= a && t <= b));
    classes.set(m.syncMs, c);
  }
  const trains = [];
  for (let round = 0; round < 12; round++) {
    let best = null;
    for (let s = from; s < to - 5; s += hopS) {
      const e = Math.min(s + windowS, to);
      const res = [];
      for (const m of modes) {
        const P = packetMs(m) / 1000;
        const c = classes.get(m.syncMs).filter((t) => t >= s && t < e);
        const lines = Math.floor((e - s) / P);
        if (c.length < minInliers || lines < 8) continue;
        const f = fitLineModel(c, s, P, lines);
        // Nur Modi, die ihr eigenes Anteilskriterium erfüllen, treten gegeneinander an. Sonst blockiert ein Modus mit kürzerer Zeile den
        // richtigen: Scottie DX (1,0503 s) ist genau das Siebenfache von Robot 36 (0,150 s), jeder DX-Impuls passt also auch in ein
        // Robot-36-Modell (jede siebte Zeile trifft) und hätte genauso viele Treffer, der Abstand zum Zweitbesten wäre 1.
        if (f && f.inliers >= minFraction * lines) res.push({ mode: m, f, lines });
      }
      loeseHarmonische(res);
      res.sort((a, b) => b.f.inliers - a.f.inliers);
      const top = res[0], second = res[1];
      if (!top || top.f.inliers < minInliers) continue;
      if (second && top.f.inliers < minRatio * second.f.inliers) continue;
      if (!best || top.f.inliers > best.f.inliers) best = top;
    }
    if (!best) break;
    const m = best.mode;
    const c = classes.get(m.syncMs);
    const pts = extend(c, best.f, to);
    const fit = regress(pts);
    const ks = pts.map(([k]) => k);
    const kFirst = ks[0], kLast = ks[ks.length - 1];
    trains.push({ mode: m, t0: fit.t0, P: fit.P, ppm: (fit.P / (packetMs(m) / 1000) - 1) * 1e6, kFirst, kLast, inliers: pts.length, lines: kLast - kFirst + 1 });
    // verbrauchte Kandidaten entfernen, damit der Zug nicht erneut gefunden wird
    const a = fit.t0 + kFirst * fit.P - fit.P, b = fit.t0 + kLast * fit.P + fit.P;
    for (const [key, arr] of classes) classes.set(key, arr.filter((t) => t < a || t > b));
  }
  return trains.sort((x, y) => x.t0 + x.kFirst * x.P - (y.t0 + y.kFirst * y.P));
}

/** Teilt einen Zug in Bilder zu je `packets` Sendezeilen; ein Rest unter 20 % wird verworfen. Gibt [{ t0 (Zeit der ersten Zeile), P, lines }]. */
export function splitTrain(train) {
  const packets = train.mode.height / linesPerPacket(train.mode);
  const out = [];
  for (let k = train.kFirst; k <= train.kLast; k += packets) {
    const lines = Math.min(packets, train.kLast - k + 1);
    if (lines < 0.2 * packets && out.length > 0) break;
    out.push({ t0: train.t0 + k * train.P, P: train.P, lines, firstK: k });
  }
  return out;
}
