// Filter für die Galerie (ohne DOM, in Node getestet): Suchtext (Rufzeichen oder Modusname), Modus und Zeitraum.
import { datumText } from './zeit.js';

export const ZEITRAEUME = ['alle', 'heute', '7', '30'];
const TAG_MS = 86400000;

/** Sortierte Liste der Modus-Ids, die in der Galerie vorkommen (für die Auswahl). */
export const modiVorhanden = (liste) => [...new Set(liste.map((e) => e.modeId))].sort();

/**
 * Einträge filtern. vorgaben: { text, modus ('' = alle), zeitraum ('alle' | 'heute' | '7' | '30') }.
 * optionen: { jetzt (ms), zeitmodus ('lokal' | 'utc', für „heute“), modusName (Id -> Anzeigename) }.
 */
export function filtere(liste, { text = '', modus = '', zeitraum = 'alle' } = {}, { jetzt = Date.now(), zeitmodus = 'lokal', modusName = (id) => id } = {}) {
  const suche = String(text).trim().toLowerCase();
  const heute = datumText(jetzt, zeitmodus);
  return liste.filter((e) => {
    if (modus && e.modeId !== modus) return false;
    if (suche && !(`${e.call ?? ''} ${modusName(e.modeId)} ${e.modeId}`.toLowerCase().includes(suche))) return false;
    if (zeitraum === 'heute') return datumText(e.t, zeitmodus) === heute;
    if (zeitraum === '7' || zeitraum === '30') return e.t >= jetzt - Number(zeitraum) * TAG_MS;
    return true;
  });
}
