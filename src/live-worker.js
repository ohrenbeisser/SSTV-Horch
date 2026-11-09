// Web Worker für den Live-Decoder (src/live.js). Das Rechnen läuft hier, damit die Oberfläche nicht ruckelt, während ein Bild reinkommt.
// Rein: { type: 'init', fs, updateS, farbraum, blind }, { type: 'audio', samples }, { type: 'ende' }.
// Raus: { type: 'start' | 'bild' | 'verworfen' | 'kennung', modeId, ... } wie beim LiveDecoder, nach 'ende' noch { type: 'fertig' }.
import { LiveDecoder } from './live.js';

let live = null;

function senden(ereignisse) {
  for (const { mode, ...rest } of ereignisse) {
    const transfer = rest.image ? [rest.image.data.buffer] : [];
    postMessage({ ...rest, modeId: mode?.id }, transfer);
  }
}

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') live = new LiveDecoder(m.fs, { updateS: m.updateS ?? 1, farbraum: m.farbraum, blind: m.blind !== false });
  else if (m.type === 'audio' && live) senden(live.push(m.samples));
  else if (m.type === 'ende' && live) { senden(live.finish()); postMessage({ type: 'fertig' }); live = null; }
};
