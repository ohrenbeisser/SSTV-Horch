// Galerie in IndexedDB (nur Browser). Je Bild ein Eintrag mit PNG (Blob), kleiner Vorschau (JPEG-Blob) und Metadaten:
// { id, t (ms), modeId, vis, validLines, height, width, quality (0..1), partial, quelle ('mikrofon' | 'datei' | 'sicherung'),
//   call (Rufzeichen aus der FSK-ID, falls eins kam), blind (Modus ohne VIS aus dem Zeilentakt erkannt), rapportR und rapportV (Rapportvorschlag, src/rapport.js), rapportS (von Hand eingetragene Signalstärke),
//   roh (Blob: Rohaufnahme als WAV mit 12 kHz, nur wenn in den Einstellungen an), verschiebung und pngOriginal (Bildanfang von Hand verschoben, Original bleibt erhalten), png, vorschau, bytes }.
// Teilbilder haben partial = true, ihre fehlenden Zeilen sind im PNG durchsichtig. Eine feste Obergrenze gibt es nicht (D13),
// dafür wird der belegte Speicher angezeigt.

const DB = 'sstv-horch';
const STORE = 'bilder';
const VORSCHAU_BREITE = 240;
const hoerer = new Set();
let dbVersprechen = null;

function oeffne() {
  dbVersprechen ??= new Promise((ok, fehler) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('t', 't'); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { dbVersprechen = null; fehler(r.error); };
  });
  return dbVersprechen;
}

const abwarten = (req) => new Promise((ok, fehler) => { req.onsuccess = () => ok(req.result); req.onerror = () => fehler(req.error); });
const transaktion = async (art) => (await oeffne()).transaction(STORE, art).objectStore(STORE);
const melde = () => { for (const h of hoerer) h(); };

export const beiAenderung = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

const zuBlob = (canvas, typ, qualitaet) => new Promise((ok, fehler) => canvas.toBlob((b) => (b ? ok(b) : fehler(new Error('Bild lässt sich nicht kodieren'))), typ, qualitaet));

/** RGBA-Bild { width, height, data } -> PNG-Blob. */
export async function bildZuPng(bild) {
  const c = document.createElement('canvas');
  c.width = bild.width; c.height = bild.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height), 0, 0);
  return zuBlob(c, 'image/png');
}

/** Vorschau (JPEG) aus einer Bildquelle (Canvas oder ImageBitmap); durchsichtige Zeilen erscheinen grau. */
async function vorschauVon(quelle) {
  const c = document.createElement('canvas');
  c.width = VORSCHAU_BREITE; c.height = Math.max(1, Math.round((VORSCHAU_BREITE * quelle.height) / quelle.width));
  const x = c.getContext('2d');
  x.fillStyle = '#5a5a5a'; x.fillRect(0, 0, c.width, c.height);
  x.imageSmoothingQuality = 'high';
  x.drawImage(quelle, 0, 0, c.width, c.height);
  return zuBlob(c, 'image/jpeg', 0.8);
}

async function ablegen(meta, png, vorschau) {
  const satz = { ...meta, png, vorschau, bytes: png.size + vorschau.size + (meta.roh?.size ?? 0) };
  delete satz.id;
  try {
    const store = await transaktion('readwrite');
    satz.id = await abwarten(store.add(satz));
  } catch (e) {
    throw new Error(e?.name === 'QuotaExceededError' ? 'Der Speicherplatz des Browsers ist voll' : (e?.message ?? String(e)));
  }
  melde();
  return satz;
}

/** Speichert ein decodiertes Bild. meta: { t, modeId, vis, validLines, height, width, quality, partial, quelle }. */
export async function speichere(meta, bild) {
  const png = await bildZuPng(bild);
  const c = document.createElement('canvas');
  c.width = bild.width; c.height = bild.height;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(bild.data), bild.width, bild.height), 0, 0);
  return ablegen(meta, png, await vorschauVon(c));
}

/** Ergänzt einen vorhandenen Eintrag um Felder (zum Beispiel das Rufzeichen aus der FSK-ID, die erst nach dem Bild eintrifft). */
export async function ergaenze(id, felder) {
  const store = await transaktion('readwrite');
  const satz = await abwarten(store.get(id));
  if (!satz) return;
  await abwarten(store.put({ ...satz, ...felder }));
  melde();
}

/**
 * Das Bild um zeilen Zeilen nach unten schieben (negativ: nach oben), die frei werdenden Zeilen bleiben durchsichtig wie bei einem Teilbild.
 * Gebraucht für Bilder ohne VIS: Dort ist der Bildanfang nur geschätzt. basis ist ein PNG-Blob. Gibt { png (Blob), canvas } zurück.
 */
export async function verschobenesPng(basis, zeilen) {
  const bmp = await createImageBitmap(basis);
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  c.getContext('2d').drawImage(bmp, 0, zeilen);
  bmp.close?.();
  return { png: await zuBlob(c, 'image/png'), canvas: c };
}

/**
 * Verschiebung eines Eintrags festschreiben. Es wird immer vom Original aus gerechnet (das beim ersten Verschieben als pngOriginal zur Seite
 * gelegt wird), so verliert mehrfaches Probieren keine Zeilen. zeilen = 0 stellt das Original wieder her.
 */
export async function verschiebeEintrag(id, zeilen) {
  const store = await transaktion('readwrite');
  const alt = await abwarten(store.get(id));
  if (!alt) throw new Error('Eintrag nicht gefunden');
  const basis = alt.pngOriginal ?? alt.png;
  const neu = { ...alt };
  if (zeilen === 0) {
    neu.png = basis; delete neu.pngOriginal; delete neu.verschiebung;
    const bmp = await createImageBitmap(basis);
    neu.vorschau = await vorschauVon(bmp);
    bmp.close?.();
  } else {
    const v = await verschobenesPng(basis, zeilen);
    neu.png = v.png; neu.pngOriginal = basis; neu.verschiebung = zeilen;
    neu.vorschau = await vorschauVon(v.canvas);
  }
  neu.bytes = neu.png.size + neu.vorschau.size + (neu.roh?.size ?? 0) + (neu.pngOriginal?.size ?? 0);
  await abwarten((await transaktion('readwrite')).put(neu));
  melde();
  return neu;
}

/** Liest Bilder einer Sicherung ein ([{ meta, png (Uint8Array) }]); schon vorhandene (gleiche Zeit, Modus, Zeilen) werden übersprungen. */
export async function importiere(eintraege) {
  const vorhanden = new Set((await liste()).map((s) => `${s.t}|${s.modeId}|${s.validLines}`));
  let neu = 0;
  for (const e of eintraege) {
    const schluessel = `${e.meta.t}|${e.meta.modeId}|${e.meta.validLines}`;
    if (vorhanden.has(schluessel)) continue;
    const png = new Blob([e.png], { type: 'image/png' });
    const bmp = await createImageBitmap(png);
    const vorschau = await vorschauVon(bmp);
    const { width, height } = bmp;
    bmp.close?.();
    await ablegen({ ...e.meta, width: e.meta.width ?? width, height: e.meta.height ?? height, quelle: e.meta.quelle ?? 'sicherung', ...(e.roh ? { roh: new Blob([e.roh], { type: 'audio/wav' }) } : {}) }, png, vorschau);
    vorhanden.add(schluessel);
    neu++;
  }
  return neu;
}

/** Alle Einträge, neueste zuerst. */
export async function liste() {
  const alle = await abwarten((await transaktion('readonly')).getAll());
  return alle.sort((a, b) => b.t - a.t || b.id - a.id);
}

export async function hole(id) { return abwarten((await transaktion('readonly')).get(id)); }

export async function loesche(ids) {
  const store = await transaktion('readwrite');
  await Promise.all(ids.map((id) => abwarten(store.delete(id))));
  melde();
}

/** { nutzung, kontingent, dauerhaft } in Byte beziehungsweise Wahrheitswert; fehlende Angaben sind null. */
export async function speicherInfo() {
  const s = navigator.storage;
  let est = null;
  try { est = await s?.estimate?.(); } catch { /* nicht überall verfügbar */ }
  let dauerhaft = null;
  try { dauerhaft = (await s?.persisted?.()) ?? null; } catch { /* egal */ }
  return { nutzung: est?.usage ?? null, kontingent: est?.quota ?? null, dauerhaft };
}

/** Bittet den Browser, den Speicher nicht von selbst zu räumen. Gibt zurück, ob es gewährt wurde. */
export async function dauerhaftAnfordern() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}
