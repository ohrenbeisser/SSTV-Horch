// Sicherung der Galerie als ZIP: je Bild eine PNG, dazu galerie.json mit den Metadaten und, wenn vorhanden, logbuch.json (D60). Ohne DOM, in Node testbar.
import { schreibeZip, leseZip } from './zip.js';
import { dateiStempel } from './zeit.js';

/** Dateiname eines Bildes, zum Beispiel sstv_robot36_20261105-090807.png (Teilbilder mit _teil), in Ortszeit oder UTC. */
export function dateiname(meta, zeitmodus = 'lokal') {
  return `sstv_${meta.modeId}_${dateiStempel(meta.t, zeitmodus)}${meta.partial ? '_teil' : ''}.png`;
}

const FELDER = ['t', 'modeId', 'vis', 'validLines', 'height', 'width', 'quality', 'partial', 'quelle', 'call', 'blind', 'rapportR', 'rapportV', 'rapportS', 'verschiebung'];
const LOGFELDER = ['t', 'call', 'modeId', 'rstGesendet', 'rstEmpfangen', 'band', 'freq', 'name', 'locator', 'notiz', 'meinCall', 'meinLocator']; // ohne id und bildId: beide gelten nur in dieser Datenbank
const reinMeta = (m) => Object.fromEntries(FELDER.filter((k) => m[k] !== undefined).map((k) => [k, m[k]]));

/**
 * eintraege: [{ meta, png (Uint8Array), roh (Uint8Array, optional: Rohaufnahme als WAV) }] -> ZIP (Uint8Array). Gleiche Namen werden mit -2, -3 …
 * unterscheidbar gemacht. Das unverschobene Original eines verschobenen Bildes (pngOriginal) kommt nicht mit ins Archiv.
 * logbuch: Logbuch-Einträge (src/logbuch.js), kommen als logbuch.json mit, wenn die Liste nicht leer ist.
 */
export function baueArchiv(eintraege, zeitmodus = 'lokal', logbuch = []) {
  const benutzt = new Map();
  const dateien = [];
  const liste = [];
  for (const e of eintraege) {
    let name = dateiname(e.meta, zeitmodus);
    const n = (benutzt.get(name) ?? 0) + 1;
    benutzt.set(name, n);
    if (n > 1) name = name.replace(/\.png$/, `-${n}.png`);
    dateien.push({ name: `bilder/${name}`, daten: e.png });
    const eintrag = { datei: `bilder/${name}`, ...reinMeta(e.meta) };
    if (e.roh) { eintrag.roh = `roh/${name.replace(/\.png$/, '.wav')}`; dateien.push({ name: eintrag.roh, daten: e.roh }); }
    liste.push(eintrag);
  }
  const json = new TextEncoder().encode(JSON.stringify({ app: 'SSTV-Horch', version: 1, bilder: liste }, null, 1));
  const logDateien = logbuch.length
    ? [{ name: 'logbuch.json', daten: new TextEncoder().encode(JSON.stringify({ app: 'SSTV-Horch', version: 1, qsos: logbuch.map((q) => Object.fromEntries(LOGFELDER.filter((k) => q[k] !== undefined).map((k) => [k, q[k]]))) }, null, 1)) }]
    : [];
  return schreibeZip([{ name: 'galerie.json', daten: json }, ...logDateien, ...dateien]);
}

/** ZIP einer früheren Sicherung -> [{ meta, png, roh (falls mitgesichert) }]. Wirft, wenn es kein Archiv dieser App ist. */
export function leseArchiv(bytes) {
  const eintraege = leseZip(bytes);
  const kopf = eintraege.find((e) => e.name === 'galerie.json');
  if (!kopf) throw new Error('Kein Archiv dieser App (galerie.json fehlt)');
  const info = JSON.parse(new TextDecoder().decode(kopf.daten));
  if (info.app !== 'SSTV-Horch' || !Array.isArray(info.bilder)) throw new Error('Kein Archiv dieser App (galerie.json unbekannt)');
  const aus = [];
  for (const b of info.bilder) {
    const png = eintraege.find((e) => e.name === b.datei);
    if (!png) continue;
    const { datei, roh: rohName, ...meta } = b;
    const roh = rohName ? eintraege.find((x) => x.name === rohName)?.daten : undefined;
    aus.push({ meta, png: png.daten, ...(roh ? { roh } : {}) });
  }
  return aus;
}

/** Logbuch-Einträge einer Sicherung (ohne id); leer, wenn die Sicherung keins enthält. */
export function leseLogbuch(bytes) {
  const datei = leseZip(bytes).find((e) => e.name === 'logbuch.json');
  if (!datei) return [];
  const info = JSON.parse(new TextDecoder().decode(datei.daten));
  if (info.app !== 'SSTV-Horch' || !Array.isArray(info.qsos)) return [];
  return info.qsos.filter((q) => q && Number.isFinite(q.t) && typeof q.call === 'string')
    .map((q) => Object.fromEntries(LOGFELDER.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])));
}
