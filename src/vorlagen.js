// Vorlagen für die Textfelder auf dem Sendebild (ohne DOM, in Node getestet): Anordnung, Größe, Farbe und Schrift mehrerer Texte unter einem
// Namen. Die Texte behalten ihre Platzhalter ({call}, {gegen} …), eine Vorlage passt also auch beim nächsten QSO. Gespeichert wird als JSON
// in der Einstellung 'textVorlagen' (localStorage).

import { TEXTFARBEN } from './komposition.js';
import { SCHRIFTEN, STANDARD_SCHRIFT } from './schriften.js';

export const MAX_VORLAGEN = 20;
export const MAX_NAME = 40;
const MAX_TEXT = 500;

const zwischen = (v, lo, hi, vorgabe) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : vorgabe);

/** Textfelder auf die gespeicherten Felder zurückführen, ohne Id, mit begrenzten Werten. */
export function bereinigeTexte(texte) {
  if (!Array.isArray(texte)) return [];
  return texte.filter((x) => x && typeof x.text === 'string').map((x) => ({
    text: x.text.slice(0, MAX_TEXT),
    x: zwischen(x.x, 0, 1, 0.5),
    y: zwischen(x.y, 0, 1, 0.5),
    size: zwischen(x.size, 0.04, 0.3, 0.1),
    farbe: x.farbe in TEXTFARBEN ? x.farbe : 'weiss',
    kontur: x.kontur !== false,
    schrift: x.schrift in SCHRIFTEN ? x.schrift : STANDARD_SCHRIFT,
  }));
}

/** Aus dem gespeicherten JSON eine saubere Liste [{ name, texte }] machen; Kaputtes fliegt raus. */
export function leseVorlagen(json) {
  let roh;
  try { roh = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(roh)) return [];
  const aus = [];
  for (const v of roh) {
    const name = typeof v?.name === 'string' ? v.name.trim().slice(0, MAX_NAME) : '';
    const texte = bereinigeTexte(v?.texte);
    if (name && texte.length) aus.push({ name, texte });
    if (aus.length >= MAX_VORLAGEN) break;
  }
  return aus;
}

const gleich = (a, b) => a.toLowerCase() === b.toLowerCase();

/** Neue Liste mit der Vorlage. Gleicher Name (Groß und Klein egal) ersetzt die alte an derselben Stelle. Wirft bei leerem Namen, ohne Texte und über der Obergrenze. */
export function speichereVorlage(liste, name, texte) {
  const n = String(name ?? '').trim().slice(0, MAX_NAME);
  if (!n) throw new Error('Name fehlt');
  const t = bereinigeTexte(texte);
  if (!t.length) throw new Error('Kein Text auf dem Bild');
  const i = liste.findIndex((v) => gleich(v.name, n));
  if (i >= 0) return liste.map((v, k) => (k === i ? { name: n, texte: t } : v));
  if (liste.length >= MAX_VORLAGEN) throw new Error(`Es sind höchstens ${MAX_VORLAGEN} Vorlagen möglich`);
  return [...liste, { name: n, texte: t }];
}

export const loescheVorlage = (liste, name) => liste.filter((v) => !gleich(v.name, name));

/** Textfelder zum Einfügen in die Sitzung: mit frischen Ids ab naechsteId. */
export const texteAusVorlage = (vorlage, naechsteId) => vorlage.texte.map((x, i) => ({ ...x, id: naechsteId + i }));
