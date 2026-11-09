// Die Modustabelle: reine Daten plus eine Funktion, die daraus den Zeilenaufbau baut. Encoder und Decoder lesen dieselbe Tabelle,
// damit beide garantiert dieselbe Sprache sprechen. Alle Zeiten in Millisekunden.
// Quellen: JL Barber N7CXI (2000) „Proposal for SSTV Mode Specifications“ und Dave Jones KB4YZ (1999), so wie in slowrx (modespec.c);
// gegengeprüft mit QSSTV (sstvparam.cpp) und robot36 (RGBModes.java, Decoder.java).

import { F_SYNC, F_BLACK, F_LEADER, F_WHITE } from './constants.js';

/**
 * Felder je Modus:
 *  family   'martin' | 'scottie' | 'robot36' | 'robot72' | 'pd' | 'wraase'
 *  vis      VIS-Code, 7 Datenbits (die gerade Parität kommt beim Senden dazu)
 *  width    Pixel je Bildzeile
 *  height   Bildzeilen
 *  syncMs   Länge des 1200-Hz-Syncs
 *  porchMs  Porch nach dem Sync (1500 Hz)
 *  sepMs    Separator zwischen Farbkanälen (1500 Hz); bei Robot 36 siehe unten
 *  scanMs   Dauer eines Farbkanals (eine Bildzeile, ganze Breite); bei Robot 36 und 72 lumaMs und chromaMs
 */
const ROH = {
  robot36: { id: 'robot36', name: 'Robot 36', family: 'robot36', vis: 8, width: 320, height: 240,
    syncMs: 9, porchMs: 3, lumaMs: 88, sepMs: 4.5, chromaPorchMs: 1.5, chromaMs: 44 },
  martin1: { id: 'martin1', name: 'Martin M1', family: 'martin', vis: 44, width: 320, height: 256,
    syncMs: 4.862, porchMs: 0.572, sepMs: 0.572, scanMs: 146.432 },
  martin2: { id: 'martin2', name: 'Martin M2', family: 'martin', vis: 40, width: 320, height: 256,
    syncMs: 4.862, porchMs: 0.572, sepMs: 0.572, scanMs: 73.216 },
  scottie1: { id: 'scottie1', name: 'Scottie S1', family: 'scottie', vis: 60, width: 320, height: 256,
    syncMs: 9, porchMs: 1.5, sepMs: 1.5, scanMs: 138.24 },
  scottie2: { id: 'scottie2', name: 'Scottie S2', family: 'scottie', vis: 56, width: 320, height: 256,
    syncMs: 9, porchMs: 1.5, sepMs: 1.5, scanMs: 88.064 },
  scottieDX: { id: 'scottieDX', name: 'Scottie DX', family: 'scottie', vis: 76, width: 320, height: 256,
    syncMs: 9, porchMs: 1.5, sepMs: 1.5, scanMs: 345.6 },
  pd120: { id: 'pd120', name: 'PD120', family: 'pd', vis: 95, width: 640, height: 496,
    syncMs: 20, porchMs: 2.08, scanMs: 121.6 },
  pd180: { id: 'pd180', name: 'PD180', family: 'pd', vis: 96, width: 640, height: 496,
    syncMs: 20, porchMs: 2.08, scanMs: 183.04 },
  // Weitere Modi. Quellen: slowrx (modespec.c: Zeilen, VIS), QSSTV (sstvparam.cpp: Bilddauer, VIS mit Parität,
  // sstvtx/moderobot2.cpp: Trennerfrequenzen) und robot36 (Robot_72_Color.java, RGBModes.java: Kanalaufteilung). Robot 72 steht in slowrx
  // mit drei gleich langen Kanälen (297,4 ms statt 300), das ist dort bekanntermaßen eine Näherung: hier gilt die Aufteilung der Spezifikation.
  robot72: { id: 'robot72', name: 'Robot 72', family: 'robot72', vis: 12, width: 320, height: 240,
    syncMs: 9, porchMs: 3, lumaMs: 138, sepMs: 4.5, chromaPorchMs: 1.5, chromaMs: 69 },
  pd90: { id: 'pd90', name: 'PD90', family: 'pd', vis: 99, width: 320, height: 256,
    syncMs: 20, porchMs: 2.08, scanMs: 170.24 },
  pd160: { id: 'pd160', name: 'PD160', family: 'pd', vis: 98, width: 512, height: 400,
    syncMs: 20, porchMs: 2.08, scanMs: 195.584 },
  pd240: { id: 'pd240', name: 'PD240', family: 'pd', vis: 97, width: 640, height: 496,
    syncMs: 20, porchMs: 2.08, scanMs: 244.48 },
  wraase180: { id: 'wraase180', name: 'Wraase SC2-180', family: 'wraase', vis: 55, width: 320, height: 256,
    syncMs: 5.5225, porchMs: 0.5, scanMs: 235 },
};

// Reihenfolge in der Oberfläche (Auswahllisten, Tabellen): nach Familie, innerhalb davon nach Dauer
const REIHENFOLGE = ['robot36', 'robot72', 'martin1', 'martin2', 'scottie1', 'scottie2', 'scottieDX', 'pd90', 'pd120', 'pd160', 'pd180', 'pd240', 'wraase180'];
if (Object.keys(ROH).length !== REIHENFOLGE.length || REIHENFOLGE.some((id) => !ROH[id])) throw new Error('REIHENFOLGE in src/modes.js passt nicht zur Modustabelle');
export const MODES = Object.fromEntries(REIHENFOLGE.map((id) => [id, ROH[id]]));
export const MODE_IDS = Object.keys(MODES);

/** VIS-Code mit gerader Parität im Bit 7, wie es QSSTV und die meisten Quellen schreiben (zum Beispiel 0xAC für Martin M1). */
export function visWithParity(vis) {
  let ones = 0;
  for (let v = vis & 0x7f; v; v >>= 1) ones += v & 1;
  return (vis & 0x7f) | ((ones & 1) << 7);
}

/** Modus anhand der 7 Datenbits des VIS finden, sonst null. */
export function modeByVis(vis) {
  return Object.values(MODES).find((m) => m.vis === (vis & 0x7f)) ?? null;
}

/**
 * Zeilenaufbau in Sendereihenfolge. Zeit 0 ist der Beginn des Sync-Impulses (so richtet sich der Decoder aus).
 * Teile vor dem Sync (Scottie: Grün und Blau) haben negative Startzeiten.
 * Ein „Paket“ ist eine Sendezeile: bei PD zwei Bildzeilen, sonst eine.
 *
 * Teil: { kind: 'sync'|'porch'|'sep'|'scan', startMs, ms, freq (feste Frequenz, nur nicht-scan), ch (Kanal, nur scan) }
 * Kanäle: 'G' 'B' 'R' (RGB-Modi); 'Y' 'C' (Robot 36: Chroma wechselt je Zeile); 'Y' 'RY' 'BY' (Robot 72); 'Y0' 'RY' 'BY' 'Y1' (PD).
 * Robot 36: sepFreq am Separator hängt von der Zeilennummer ab ([gerade, ungerade] = [1500, 2300] Hz), siehe sepFreqByParity.
 */
export function layout(mode) {
  const parts = [];
  let t = 0;
  const add = (kind, ms, extra = {}) => { parts.push({ kind, startMs: t, ms, ...extra }); t += ms; };

  switch (mode.family) {
    case 'martin': {
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      for (const ch of ['G', 'B', 'R']) {
        add('scan', mode.scanMs, { ch });
        add('sep', mode.sepMs, { freq: F_BLACK });
      }
      break;
    }
    case 'scottie': {
      // G und B liegen vor dem Sync: [sep][G][sep][B] [sync][porch][R]
      t = -(2 * mode.scanMs + 2 * mode.sepMs);
      add('sep', mode.sepMs, { freq: F_BLACK });
      add('scan', mode.scanMs, { ch: 'G' });
      add('sep', mode.sepMs, { freq: F_BLACK });
      add('scan', mode.scanMs, { ch: 'B' });
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      add('scan', mode.scanMs, { ch: 'R' });
      break;
    }
    case 'robot36': {
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      add('scan', mode.lumaMs, { ch: 'Y' });
      add('sep', mode.sepMs, { sepFreqByParity: [F_BLACK, F_WHITE] }); // gerade Zeile 1500 (folgt R-Y), ungerade 2300 (folgt B-Y)
      add('porch', mode.chromaPorchMs, { freq: F_LEADER });
      add('scan', mode.chromaMs, { ch: 'C' }); // C = R-Y (gerade Zeile) oder B-Y (ungerade Zeile)
      break;
    }
    case 'robot72': {
      // Wie Robot 36, aber jede Zeile trägt beide Farbdifferenzen: Y, dann R-Y (Trenner 1500 Hz), dann B-Y (Trenner 2300 Hz), je mit 1900-Hz-Porch
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      add('scan', mode.lumaMs, { ch: 'Y' });
      add('sep', mode.sepMs, { freq: F_BLACK });
      add('porch', mode.chromaPorchMs, { freq: F_LEADER });
      add('scan', mode.chromaMs, { ch: 'RY' });
      add('sep', mode.sepMs, { freq: F_WHITE });
      add('porch', mode.chromaPorchMs, { freq: F_LEADER });
      add('scan', mode.chromaMs, { ch: 'BY' });
      break;
    }
    case 'wraase': {
      // Sync, kurze Porch, dann Rot, Grün, Blau lückenlos hintereinander (kein Trenner)
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      for (const ch of ['R', 'G', 'B']) add('scan', mode.scanMs, { ch });
      break;
    }
    case 'pd': {
      add('sync', mode.syncMs, { freq: F_SYNC });
      add('porch', mode.porchMs, { freq: F_BLACK });
      for (const ch of ['Y0', 'RY', 'BY', 'Y1']) add('scan', mode.scanMs, { ch });
      break;
    }
    default:
      throw new Error(`Unbekannte Modusfamilie: ${mode.family}`);
  }
  return parts;
}

/** Bildzeilen je Sendezeile (PD: 2). */
export function linesPerPacket(mode) {
  return mode.family === 'pd' ? 2 : 1;
}

/** Dauer einer Sendezeile in ms (vom ersten bis zum letzten Teil, Scottie einschließlich der Teile vor dem Sync). */
export function packetMs(mode) {
  const p = layout(mode);
  const last = p[p.length - 1];
  return last.startMs + last.ms - p[0].startMs;
}

/** Sendedauer des Bildes in Sekunden (ohne Vorspann), ohne Rundung. */
export function imageSeconds(mode) {
  return (mode.height / linesPerPacket(mode)) * packetMs(mode) / 1000;
}

/** Dauer von Kalibrierkopf (optional), Leitton, Break, Leitton und VIS (Start, 8 Bit, Stopp) in Sekunden. */
export function preambleSeconds({ calHeader = false } = {}) {
  const base = (300 + 10 + 300 + 30 + 8 * 30 + 30) / 1000;
  return base + (calHeader ? 0.8 : 0);
}
