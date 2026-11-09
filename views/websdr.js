// Bereich „WebSDR (Beta)“ (D63): Liste fremder Empfänger im Netz, Links in neuem Tab, dazu der Knopf, der den Ton eines Browser-Tabs
// als Quelle in „Empfangen“ übernimmt. Das Bild entsteht in „Empfangen“, diese Seite bereitet nur die Quelle vor.
import { tabStart, tabMoeglich, aktuelleQuelle, letzterFehler } from './empfangen.js';
import { aktuelleSprache } from '../src/i18n.js';
import { renderMarkdown } from '../src/markdown.js';

// Eigene Auswahl, Stand siehe LISTE_STAND. Texte zu Standort und Empfang in lang/ unter websdr.s.<id>.ort und .band.
// Links einzeln auf Erreichbarkeit geprüft. Twente läuft nur über http: Als eigene Seite im neuen Tab ist das in Ordnung, einbetten ginge nicht.
export const LISTE_STAND = '2026-11-09';
export const SERVER = [
  { id: 'twente', name: 'Twente', url: 'http://websdr.ewi.utwente.nl:8901/' },
  { id: 'graz', name: 'TU Graz', url: 'https://websdr.iks.tugraz.at/' },
  { id: 'utah', name: 'Northern Utah', url: 'https://www.sdrutah.org/' },
  { id: 'goonhilly', name: 'Goonhilly', url: 'https://vhf-goonhilly.batc.org.uk/' },
];

// Der lange Text zu den Frequenzen steht in help/websdr.<Sprache>.md; bei englischer Oberfläche die englische Fassung, sonst die deutsche
async function ladeText(sprache) {
  const r = await fetch(new URL(`../help/websdr.${sprache}.md`, import.meta.url));
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

export default function mount(wurzel, { t, symbol, einstellung }) {
  // ---- Quelle übernehmen: gleich unter der Beschreibung, der Knopf ist voll gefärbt und ohne Tab-Audio abgeschaltet (mit kurzem Grund darunter)
  const quelle = el('div', 'card quelle-karte');
  const knopf = el('button', 'btn filled'); knopf.type = 'button';
  const meldung = el('p', 'hint body-sm'); meldung.setAttribute('role', 'status');
  const zeichne = () => {
    const laeuft = aktuelleQuelle() === 'tab';
    const kann = tabMoeglich();
    knopf.textContent = t(laeuft ? 'websdr.tab.zuEmpfangen' : 'websdr.tab.knopf');
    knopf.disabled = !kann && !laeuft;
    if (laeuft) meldung.textContent = t('websdr.tab.laeuft');
    else if (!kann) meldung.textContent = t('websdr.tab.nicht');
    meldung.hidden = !meldung.textContent;
  };
  knopf.addEventListener('click', async () => {
    if (aktuelleQuelle() !== 'tab') {
      meldung.textContent = ''; meldung.hidden = true;
      knopf.disabled = true; // Doppeltipp, solange der Auswahldialog offen ist
      await tabStart(t, einstellung);
      knopf.disabled = false;
      if (aktuelleQuelle() !== 'tab') { meldung.textContent = letzterFehler() || t('websdr.tab.fehler', { grund: '?' }); meldung.hidden = false; zeichne(); return; }
    }
    location.hash = '#/empfangen';
  });
  quelle.append(knopf, meldung);
  zeichne();

  const intro = el('p', 'hint', t('websdr.intro'));

  // ---- Aufklappbare Abschnitte (wie in den Einstellungen): Ablauf und Frequenzen, beim ersten Besuch zu
  const akkordeon = (titel, ...inhalt) => {
    const d = el('details', 'akk'); const sum = el('summary');
    const text = el('span', 'akk-text'); text.append(el('span', 'akk-titel', titel)); sum.append(text);
    const kasten = el('div', 'akk-inhalt'); kasten.append(...inhalt);
    d.append(sum, kasten);
    return d;
  };
  const liste = el('ol');
  for (let i = 1; i <= 4; i++) liste.append(el('li', '', t(`websdr.schritt${i}`)));
  const freqText = el('div', 'md');
  (async () => {
    let text;
    try { text = await ladeText(aktuelleSprache()); } catch { try { text = await ladeText('de'); } catch { freqText.textContent = t('help.failed'); return; } }
    freqText.innerHTML = renderMarkdown(text).html; // der Leser maskiert alles und erzeugt nur eigene Tags
  })();
  const gruppe = el('div', 'akk-gruppe');
  gruppe.append(akkordeon(t('websdr.schritte.titel'), liste), akkordeon(t('websdr.freq.titel'), freqText));

  // ---- Server als Tabelle: Name, Standort, Knopf zum Server (neuer Tab) und Info-Knopf mit den Einzelheiten in einem gemeinsamen Dialog
  const kopf = el('div', 'card');
  const stand = new Intl.DateTimeFormat(aktuelleSprache(), { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${LISTE_STAND}T00:00:00Z`));
  kopf.append(el('h2', 'title-md', t('websdr.server.titel')), el('p', 'hint', t('websdr.server.hinweis')), el('p', 'hint body-sm', t('websdr.stand', { datum: stand })));

  const dialog = el('dialog', 'info-dialog');
  const dTitel = el('h2', 'title-md'); const dListe = el('dl', 'tabelle');
  const zu = el('button', 'btn tonal', t('websdr.info.schliessen')); zu.type = 'button';
  const akt = el('div', 'aktionen'); akt.append(zu);
  dialog.append(dTitel, dListe, akt);
  zu.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); }); // Tipp neben den Inhalt
  const zeigeInfo = (s) => {
    dialog.setAttribute('aria-label', s.name);
    dTitel.textContent = s.name;
    dListe.replaceChildren();
    const zeile = (k, v) => dListe.append(el('dt', '', t(k)), el('dd', '', v));
    zeile('websdr.server.ort', t(`websdr.s.${s.id}.ort`));
    zeile('websdr.server.band', t(`websdr.s.${s.id}.band`));
    zeile('websdr.server.adresse', s.url);
    dialog.showModal(); dialog.scrollTop = 0;
  };

  const tabelle = el('table', 'servertabelle');
  const kopfZeile = el('tr');
  const th = (text, nurLeser) => { const e = el('th', nurLeser ? 'nur-sr' : '', text); e.scope = 'col'; return e; };
  kopfZeile.append(th(t('websdr.tab.server')), th(t('websdr.server.ort')), th(t('websdr.tab.link'), true), th(t('websdr.tab.info'), true));
  const thead = el('thead'); thead.append(kopfZeile);
  const tbody = el('tbody');
  for (const s of SERVER) {
    const tr = el('tr');
    const link = el('a', 'icon-btn'); link.href = s.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', t('websdr.server.oeffnen', { name: s.name })); link.title = link.getAttribute('aria-label');
    link.append(symbol('open_in_new'));
    const info = el('button', 'icon-btn'); info.type = 'button';
    info.setAttribute('aria-label', t('websdr.server.info', { name: s.name })); info.title = info.getAttribute('aria-label');
    info.append(symbol('info'));
    info.addEventListener('click', () => zeigeInfo(s));
    const td = (...kinder) => { const e = el('td'); e.append(...kinder); return e; };
    const tdIkon = (k) => { const e = td(k); e.className = 'ikon'; return e; };
    tr.append(td(s.name), td(t(`websdr.s.${s.id}.ort`)), tdIkon(link), tdIkon(info));
    tbody.append(tr);
  }
  tabelle.append(thead, tbody);
  kopf.append(tabelle, dialog);

  wurzel.append(intro, quelle, gruppe, kopf);
  return { unmount() { /* nichts: Der Empfang gehört zu „Empfangen“ und läuft weiter */ } };
}
