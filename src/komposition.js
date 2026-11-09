// Das Sendebild zusammenbauen (Browser): Quellbild im Rahmen (Füllen oder Einpassen, Zoom, Lage) plus Textfelder obendrauf.
// Editor und fertiges Bild benutzen dasselbe Zeichnen. Das fertige Bild wird in mehrfacher Auflösung gemalt und mit dem
// Flächenfilter (src/bild.js) auf Modusgröße eingedampft, das glättet Schrift und Kanten.

import { bildGroesse, ersetzePlatzhalter } from './ausschnitt.js';
import { skaliere } from './bild.js';
import { schriftCss } from './schriften.js';

export const TEXTFARBEN = { weiss: '#ffffff', gelb: '#ffe600', rot: '#ff2a2a', schwarz: '#000000' };
export const BALKENFARBEN = { schwarz: '#000000', grau: '#808080', weiss: '#ffffff' };
const ZEILENHOEHE = 1.15;

/**
 * Zeichnet auf ctx (Größe W × H). texte: [{ id, text, x, y, size, farbe, kontur, schrift }] mit Mitte (x, y) in Anteilen von Breite und Höhe und
 * size als Anteil der Höhe. Gibt die Umrisse der Textfelder in Pixeln zurück: [{ id, x, y, w, h }] (für Treffer und Auswahlrahmen).
 */
export function zeichne(ctx, W, H, quelle, ansicht, balken, texte, werte) {
  ctx.save();
  ctx.fillStyle = BALKENFARBEN[balken] ?? '#000';
  ctx.fillRect(0, 0, W, H);
  if (quelle) {
    const sw = quelle.width, sh = quelle.height;
    const g = bildGroesse(ansicht, sw, sh, W, H);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(quelle, ansicht.dx * W, ansicht.dy * W, g.w * W, g.h * W);
  }
  const umrisse = [];
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const t of texte) {
    const px = Math.max(4, t.size * H);
    ctx.font = schriftCss(t.schrift, px);
    const zeilen = ersetzePlatzhalter(t.text, werte).split('\n');
    const hoehe = zeilen.length * px * ZEILENHOEHE;
    let breite = 0;
    for (const z of zeilen) breite = Math.max(breite, ctx.measureText(z).width);
    const cx = t.x * W, cy = t.y * H;
    const y0 = cy - hoehe / 2 + (px * ZEILENHOEHE) / 2;
    zeilen.forEach((z, i) => {
      const y = y0 + i * px * ZEILENHOEHE;
      if (t.kontur) {
        ctx.lineWidth = px * 0.16;
        ctx.strokeStyle = t.farbe === 'schwarz' ? '#ffffff' : '#000000';
        ctx.strokeText(z, cx, y);
      }
      ctx.fillStyle = TEXTFARBEN[t.farbe] ?? '#fff';
      ctx.fillText(z, cx, y);
    });
    umrisse.push({ id: t.id, x: cx - breite / 2, y: cy - hoehe / 2, w: breite, h: hoehe });
  }
  ctx.restore();
  return umrisse;
}

/** Fertiges Sendebild in Modusgröße ({ width, height, data } RGBA). */
export function rendereBild(quelle, ansicht, balken, texte, werte, mode) {
  const k = Math.max(1, Math.round(1280 / mode.width));
  const c = document.createElement('canvas');
  c.width = mode.width * k; c.height = mode.height * k;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  zeichne(ctx, c.width, c.height, quelle, ansicht, balken, texte, werte);
  const gross = ctx.getImageData(0, 0, c.width, c.height);
  return skaliere({ width: c.width, height: c.height, data: gross.data }, mode.width, mode.height, 'stretch');
}
