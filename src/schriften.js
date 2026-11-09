// Schriften für die Textfelder auf dem Sendebild. Roboto, Roboto Mono und Montserrat Alt1 liegen in fonts/ und sind in theme.css
// eingebunden, laufen also auch offline und sehen überall gleich aus. Die Systemschriften sehen je nach Gerät ein bisschen anders aus.
// Standard ist Roboto fett: klare, kräftige Striche ohne Serifen, bleibt auch bei 320 × 240 Bildpunkten mit Kontur lesbar.

export const STANDARD_SCHRIFT = 'roboto';

export const SCHRIFTEN = {
  roboto: { name: 'Roboto', gewicht: 700, lokal: 'Roboto', css: '"Roboto", "Helvetica Neue", Arial, sans-serif' },
  robotomono: { name: 'Roboto Mono', gewicht: 500, lokal: 'Roboto Mono', css: '"Roboto Mono", "Courier New", monospace' },
  montserrat: { name: 'Montserrat Alt1', gewicht: 500, lokal: 'Montserrat Alt1', css: '"Montserrat Alt1", "Roboto", sans-serif' },
  sans: { name: 'sans', gewicht: 700, lokal: null, css: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  serif: { name: 'serif', gewicht: 700, lokal: null, css: 'Georgia, "Times New Roman", serif' },
  schreibmaschine: { name: 'schreibmaschine', gewicht: 700, lokal: null, css: '"Courier New", Courier, monospace' },
};

/** CSS-Angabe für ctx.font. Unbekannte Schlüssel fallen auf den Standard zurück. */
export function schriftCss(schluessel, px) {
  const s = SCHRIFTEN[schluessel] ?? SCHRIFTEN[STANDARD_SCHRIFT];
  return `${s.gewicht} ${px}px ${s.css}`;
}

/** Lädt die eingebundenen Schriften, damit sie im Canvas sofort zur Verfügung stehen (nur Browser). Fehler sind unkritisch. */
export function ladeSchriften() {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  return Promise.all(Object.values(SCHRIFTEN).filter((s) => s.lokal).map((s) => document.fonts.load(`${s.gewicht} 20px "${s.lokal}"`, 'AaÄäÖöÜüß0123'))).then(() => {}, () => {});
}
