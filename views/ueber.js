// Bereich „Über“: Kopf mit Logo und Zweck, Daten zur App, verwendete Komponenten, Danksagung, Datenschutz, Haftung (Aufbau wie FT8-Horch).
import { VERSION, STAND } from '../src/version.js';
import { aktuelleSprache } from '../src/i18n.js';

// Komponenten von Dritten: Name, Urheber, Lizenz mit Link, Verwendung (Text in lang/ unter about.comp.<id>)
const KOMPONENTEN = [
  { id: 'roboto', name: 'Roboto, Roboto Mono', von: 'The Roboto Project Authors', lizenz: 'SIL OFL 1.1', url: 'https://openfontlicense.org' },
  { id: 'montserrat', name: 'Montserrat Alt1', von: 'The Montserrat Project Authors', lizenz: 'SIL OFL 1.1', url: 'https://openfontlicense.org' },
  { id: 'symbols', name: 'Material Symbols', von: 'Google', lizenz: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
];
const LINK_LIZENZ = 'https://www.gnu.org/licenses/gpl-3.0.html';
const LINK_SEITE = 'https://ohrenbeisser.de';
const LINK_ARTIKEL = 'https://ohrenbeisser.de/sstv-fernsehen-im-schneckentempo/';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const link = (text, href) => { const a = el('a', '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };

export default function mount(wurzel, { t }) {
  // Kopf: Logo, Name, Zweck, Daten
  const kopf = el('div', 'card ueber-kopf');
  const logo = el('div', 'ueber-logo'); const img = el('img'); img.src = 'icons/logo.svg'; img.alt = t('app.name'); img.width = 96; img.height = 96; logo.append(img);
  const app = el('div', 'messblock');
  const zeile = (k, wert) => { const d = el('div', 'messzeile'); const w = el('span'); w.append(wert); d.append(el('span', '', k), w); app.append(d); return w; };
  const stand = new Intl.DateTimeFormat(aktuelleSprache(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${STAND}T00:00:00Z`));
  zeile(t('about.version'), VERSION);
  zeile(t('about.stand'), stand);
  zeile(t('about.license'), link('GPL-3.0-or-later', LINK_LIZENZ));
  zeile(t('about.authorLabel'), t('about.authorValue'));
  zeile(t('about.website'), link('ohrenbeisser.de', LINK_SEITE));
  zeile(t('about.articleLabel'), link(t('about.articleName'), LINK_ARTIKEL));
  // Geladene Fassung der Dateien (Name des Caches im Service Worker): zeigt, ob nach einer Änderung die neue Fassung läuft
  try { window.caches?.keys().then((n) => { const c = n.find((x) => x.startsWith('sstv-')); if (c) zeile(t('about.cache'), c); }).catch(() => {}); } catch { /* ohne Cache keine Anzeige */ }
  kopf.append(logo, el('h3', 'title-lg', t('app.name')), el('p', 'hint', t('about.purpose')), app);

  // Komponenten
  const komp = el('div', 'card');
  komp.append(el('h3', 'title-md', t('about.components')), el('p', 'hint body-sm', t('about.componentsNote')));
  const liste = el('div', 'messblock');
  for (const k of KOMPONENTEN) {
    const d = el('div', 'komponente');
    const kk = el('div', 'komp-kopf'); kk.append(el('strong', '', k.name), link(k.lizenz, k.url));
    d.append(kk, el('div', 'hint body-sm', `${k.von}. ${t(`about.comp.${k.id}`)}`));
    liste.append(d);
  }
  komp.append(liste);

  const karte = (titel, ...absaetze) => { const c = el('div', 'card'); c.append(el('h3', 'title-md', t(titel))); for (const a of absaetze) c.append(el('p', '', t(a))); return c; };
  wurzel.append(kopf, komp,
    karte('about.thanks', 'about.thanks1', 'about.thanks2'),
    karte('about.privacy', 'about.privacyText'),
    karte('about.liability', 'about.liability1', 'about.liability2'));
}
