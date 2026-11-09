// Installation der PWA. Der Browser zeigt den Dialog nur nach einem Tipp; Chrome meldet die Möglichkeit mit beforeinstallprompt
// (Safari auf iOS kennt das nicht, da bleibt nur die Anleitung von Hand). Das Ereignis kann kurz nach dem Laden kommen, deshalb
// fangen wir es schon beim Einlesen des Moduls ab. Die Entscheidungen selbst stehen in src/installieren.js.
import { einstellung, setzeEinstellung } from './src/settings.js';
import { istInstalliert, istIos, zeigeHinweis, karteZustand } from './src/installieren.js';

let angebot = null;
let neuInstalliert = false;
const hoerer = new Set();
const melde = () => hoerer.forEach((f) => f());
window.addEventListener('beforeinstallprompt', (ev) => { ev.preventDefault(); angebot = ev; melde(); });
window.addEventListener('appinstalled', () => { angebot = null; neuInstalliert = true; melde(); });

const laeuftInstalliert = () => istInstalliert({
  standalone: ['standalone', 'minimal-ui', 'fullscreen'].some((m) => window.matchMedia?.(`(display-mode: ${m})`).matches),
  iosStandalone: navigator.standalone === true,
});

export const beiInstallAenderung = (fn) => { hoerer.add(fn); return () => hoerer.delete(fn); };

export const installZustand = () => karteZustand({
  installiert: laeuftInstalliert(),
  neu: neuInstalliert,
  installierbar: !!angebot,
  ios: istIos(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
  sicher: window.isSecureContext,
});

/** Soll der Hinweis jetzt erscheinen? Genau einmal, ab dem dritten Start (siehe src/installieren.js). */
export function pruefeInstallHinweis({ mikLaeuft = false, qsoAktiv = false } = {}) {
  const ja = zeigeHinweis({
    starts: einstellung('starts'), gezeigt: einstellung('installHinweis') === 'gezeigt',
    installiert: laeuftInstalliert(), installierbar: !!angebot, mikLaeuft, qsoAktiv,
  });
  if (ja) setzeEinstellung('installHinweis', 'gezeigt');
  return ja;
}

export async function installieren() {
  if (!angebot) return;
  const a = angebot;
  angebot = null; // das Angebot gilt nur für einen Aufruf
  try {
    await a.prompt();
    const wahl = await a.userChoice;
    if (wahl?.outcome === 'accepted') neuInstalliert = true;
  } catch { /* abgebrochen oder vom Browser abgelehnt */ }
  melde();
}
