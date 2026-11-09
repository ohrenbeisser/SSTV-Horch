// Das Gerüst der App: Kopfzeile mit Hamburger-Menü, Schublade mit allen Bereichen, Routing über den Hash (#/senden), Sprache,
// Hell/Dunkel und der Service Worker, der bei einer neuen Fassung einmal neu lädt.
// Die Bereiche selbst liegen in views/<id>.js und werden erst geladen, wenn jemand sie zum ersten Mal besucht.
import { t, erkenneSprache, ladeSprache, uebersetzeSeite } from './src/i18n.js';
import { einstellung, setzeEinstellung, beiAenderung } from './src/settings.js';
import { BEREICHE, bereichAusHash } from './src/nav.js';
import { initSchublade } from './src/schublade.js';
import './src/dialogkopf.js';
import { beiInstallAenderung, pruefeInstallHinweis, installieren } from './install.js';
import { wennFrei } from './src/beschaeftigt.js';

const $ = (id) => document.getElementById(id);
const schublade = $('schublade');

let aktuell = null;
let ansicht = null; // { unmount }

// ------------------------------------------------------------------ Darstellung
function setzeDarstellung() {
  const th = einstellung('theme');
  if (th === 'light' || th === 'dark') document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
}

// ------------------------------------------------------------------ Schublade
function symbol(id) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  u.setAttribute('href', `#i-${id}`);
  s.append(u);
  return s;
}

function eintrag(b) {
  const a = document.createElement('a');
  a.className = 'sch-eintrag';
  a.href = `#/${b.id}`;
  a.dataset.bereich = b.id;
  const span = document.createElement('span');
  span.textContent = t(`nav.${b.id}`);
  a.append(symbol(b.icon), span);
  if (b.id === aktuell) a.setAttribute('aria-current', 'page');
  return a;
}

function baueSchublade() {
  schublade.replaceChildren();
  const kopf = document.createElement('div');
  kopf.className = 'sch-kopf';
  const logo = document.createElement('img');
  logo.src = 'icons/logo.svg'; logo.alt = '';
  const txt = document.createElement('div');
  const name = document.createElement('div'); name.className = 'name'; name.textContent = t('app.name');
  const zusatz = document.createElement('div'); zusatz.className = 'zusatz body-sm'; zusatz.textContent = t('app.tagline');
  txt.append(name, zusatz);
  kopf.append(logo, txt);
  schublade.append(kopf);

  let gruppe = null;
  const letzteGruppe = BEREICHE[BEREICHE.length - 1].gruppe;
  for (const b of BEREICHE) {
    if (gruppe !== null && b.gruppe !== gruppe) {
      const tr = document.createElement('div'); tr.className = 'sch-trenner';
      if (b.gruppe === letzteGruppe) tr.classList.add('unten'); // letzte Gruppe (Einstellungen, Hilfe, Über) am unteren Rand
      schublade.append(tr);
    }
    gruppe = b.gruppe;
    schublade.append(eintrag(b));
  }
}

// Öffnen, Schließen, Fokusfalle und Escape der Schublade: src/schublade.js (gemeinsame Basis)
initSchublade();

// ------------------------------------------------------------------ Bereiche
async function zeige(id) {
  if (id === aktuell) return;
  ansicht?.unmount?.();
  ansicht = null; // sonst wird die alte Ansicht beim nächsten Wechsel noch mal abgebaut, wenn das Laden der neuen schiefgeht
  aktuell = id;
  baueSchublade();
  $('titel').textContent = t(`nav.${id}`);
  document.title = `${t('app.name')} – ${t(`nav.${id}`)}`;
  $('kopfAktion').replaceChildren();
  const wurzel = $('ansicht');
  wurzel.replaceChildren();
  const sektion = document.createElement('section');
  sektion.setAttribute('aria-labelledby', 'titel');
  wurzel.append(sektion);
  try {
    const modul = await import(`./views/${id}.js`);
    if (aktuell !== id) return; // inzwischen woanders
    const neu = (await modul.default(sektion, { t, einstellung, setzeEinstellung, beiAenderung, kopfAktion: $('kopfAktion'), symbol })) ?? null;
    if (aktuell !== id) { neu?.unmount?.(); return; } // beim Aufbauen (async) schon weitergewechselt: gleich wieder abbauen, sonst bliebe sie hängen
    ansicht = neu;
    uebersetzeSeite(sektion);
  } catch (e) {
    sektion.textContent = `${id}: ${e.message}`;
  }
  $('inhalt').scrollTop = 0;
}

const route = () => zeige(bereichAusHash(location.hash));
window.addEventListener('hashchange', route);

// Sprache oder Darstellung geändert: Texte neu aufbauen
beiAenderung(async (k, v) => {
  if (k === 'theme') setzeDarstellung();
  if (k === 'lang') {
    await ladeSprache(erkenneSprache(v));
    uebersetzeSeite(document);
    const id = aktuell; aktuell = null; // Bereich neu aufbauen
    await zeige(id);
  }
});

// ------------------------------------------------------------------ Start
async function start() {
  setzeDarstellung();
  await ladeSprache(erkenneSprache(einstellung('lang')));
  uebersetzeSeite(document);
  setzeEinstellung('starts', einstellung('starts') + 1);
  await route();

  const zeigeBand = () => { if (pruefeInstallHinweis()) $('installBand').hidden = false; };
  $('btnInstallHinweis').addEventListener('click', () => { $('installBand').hidden = true; installieren(); });
  $('btnInstallZu').addEventListener('click', () => { $('installBand').hidden = true; });
  beiInstallAenderung(zeigeBand);
  zeigeBand();

  // Service Worker: legt alle Dateien in den Cache (Offline). Kommt eine neue Fassung, lädt die App einmal neu.
  if ('serviceWorker' in navigator) {
    const hatteSteuerung = !!navigator.serviceWorker.controller;
    // Neu laden erst, wenn kein Empfang und keine Wiedergabe läuft, sonst bräche beides ab
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (hatteSteuerung) wennFrei(() => location.reload()); });
    navigator.serviceWorker.register('sw.js').catch(() => { /* ohne Service Worker kein Offline */ });
  }
}
start();
