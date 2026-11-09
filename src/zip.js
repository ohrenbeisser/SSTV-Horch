// ZIP ohne Kompression (nur „store“), selbst gestrickt, damit wir keine Bibliothek brauchen (D13). Läuft in Node und im Browser.
// Schreiben: lokale Köpfe, Zentralverzeichnis, Endsatz; Namen als UTF-8 (Flag 0x0800). Kein ZIP64, also nichts über 4 GB.
// Lesen: über das Zentralverzeichnis, nur unkomprimierte Einträge (genau die schreibt diese App), CRC-32 wird geprüft.

const TABELLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();

export function crc32(daten) {
  let c = 0xffffffff;
  for (let i = 0; i < daten.length; i++) c = TABELLE[(c ^ daten[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const dosZeit = (d) => (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
const dosDatum = (d) => (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();

/** dateien: [{ name, daten (Uint8Array) }] -> Uint8Array (ZIP). */
export function schreibeZip(dateien, zeit = new Date()) {
  const enc = new TextEncoder();
  const eintraege = dateien.map((d) => ({ name: enc.encode(d.name), daten: d.daten, crc: crc32(d.daten) }));
  let groesse = 22;
  for (const e of eintraege) groesse += 30 + e.name.length + e.daten.length + 46 + e.name.length;
  const out = new Uint8Array(groesse);
  const v = new DataView(out.buffer);
  let o = 0;
  for (const e of eintraege) {
    e.offset = o;
    v.setUint32(o, 0x04034b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 0x0800, true); v.setUint16(o + 8, 0, true);
    v.setUint16(o + 10, dosZeit(zeit), true); v.setUint16(o + 12, dosDatum(zeit), true);
    v.setUint32(o + 14, e.crc, true); v.setUint32(o + 18, e.daten.length, true); v.setUint32(o + 22, e.daten.length, true);
    v.setUint16(o + 26, e.name.length, true); v.setUint16(o + 28, 0, true);
    out.set(e.name, o + 30); out.set(e.daten, o + 30 + e.name.length);
    o += 30 + e.name.length + e.daten.length;
  }
  const cdStart = o;
  for (const e of eintraege) {
    v.setUint32(o, 0x02014b50, true); v.setUint16(o + 4, 20, true); v.setUint16(o + 6, 20, true); v.setUint16(o + 8, 0x0800, true); v.setUint16(o + 10, 0, true);
    v.setUint16(o + 12, dosZeit(zeit), true); v.setUint16(o + 14, dosDatum(zeit), true);
    v.setUint32(o + 16, e.crc, true); v.setUint32(o + 20, e.daten.length, true); v.setUint32(o + 24, e.daten.length, true);
    v.setUint16(o + 28, e.name.length, true); v.setUint16(o + 30, 0, true); v.setUint16(o + 32, 0, true);
    v.setUint16(o + 34, 0, true); v.setUint16(o + 36, 0, true); v.setUint32(o + 38, 0, true); v.setUint32(o + 42, e.offset, true);
    out.set(e.name, o + 46);
    o += 46 + e.name.length;
  }
  v.setUint32(o, 0x06054b50, true); v.setUint16(o + 4, 0, true); v.setUint16(o + 6, 0, true);
  v.setUint16(o + 8, eintraege.length, true); v.setUint16(o + 10, eintraege.length, true);
  v.setUint32(o + 12, o - cdStart, true); v.setUint32(o + 16, cdStart, true); v.setUint16(o + 20, 0, true);
  return out;
}

/** ZIP lesen -> [{ name, daten }]. Wirft bei Nicht-ZIP, komprimierten Einträgen und falscher CRC-32. */
export function leseZip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let ende = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { ende = i; break; }
  }
  if (ende < 0) throw new Error('Keine ZIP-Datei');
  const n = v.getUint16(ende + 10, true);
  let o = v.getUint32(ende + 16, true);
  const dec = new TextDecoder();
  const aus = [];
  for (let k = 0; k < n; k++) {
    if (o + 46 > bytes.length || v.getUint32(o, true) !== 0x02014b50) throw new Error('Keine ZIP-Datei (Zentralverzeichnis beschädigt)');
    const verfahren = v.getUint16(o + 10, true);
    const crc = v.getUint32(o + 16, true), csize = v.getUint32(o + 20, true);
    const nl = v.getUint16(o + 28, true), el = v.getUint16(o + 30, true), cl = v.getUint16(o + 32, true);
    const lokal = v.getUint32(o + 42, true);
    const name = dec.decode(bytes.subarray(o + 46, o + 46 + nl));
    if (verfahren !== 0) throw new Error(`Eintrag ${name} ist komprimiert (nur unkomprimierte ZIP-Dateien dieser App werden gelesen)`);
    if (lokal + 30 > bytes.length || v.getUint32(lokal, true) !== 0x04034b50) throw new Error('Keine ZIP-Datei (lokaler Kopf beschädigt)');
    const start = lokal + 30 + v.getUint16(lokal + 26, true) + v.getUint16(lokal + 28, true);
    const daten = bytes.slice(start, start + csize);
    if (daten.length !== csize || crc32(daten) !== crc) throw new Error(`CRC-Fehler in ${name}`);
    aus.push({ name, daten });
    o += 46 + nl + el + cl;
  }
  return aus;
}
