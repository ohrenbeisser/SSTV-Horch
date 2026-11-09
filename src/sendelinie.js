// Wo im Bild ist die Sendung gerade? Für die Linie, die beim Senden über die Vorschau läuft (ohne DOM, in Node getestet).
// Der Encoder sendet erst den Vorspann (Kalibrierkopf, Leitton, VIS), dann das Bild Zeile für Zeile in gleichmäßigem Takt, zuletzt eine
// eventuelle Rufzeichenkennung. Bei PD kommen zwei Bildzeilen in einem Paket, der Anteil über die Bilddauer stimmt trotzdem.

import { imageSeconds, preambleSeconds } from './modes.js';

/**
 * t: Sekunden seit dem Start der Wiedergabe. Gibt { phase: 'vorspann' | 'bild' | 'ende', anteil (0 bis 1 der Bildhöhe), zeile (1 bis Höhe,
 * 0 im Vorspann) } zurück. Nach dem Bild (Kennung, Nachlauf) steht die Linie ganz unten.
 */
export function sendePosition(mode, t, { calHeader = false } = {}) {
  const vor = preambleSeconds({ calHeader }), bild = imageSeconds(mode);
  if (t < vor) return { phase: 'vorspann', anteil: 0, zeile: 0 };
  if (t >= vor + bild) return { phase: 'ende', anteil: 1, zeile: mode.height };
  const anteil = (t - vor) / bild;
  return { phase: 'bild', anteil, zeile: Math.min(mode.height, Math.floor(anteil * mode.height) + 1) };
}
