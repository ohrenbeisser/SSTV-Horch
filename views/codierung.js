// Bereich „Codierung“: drei Karten zum Rumspielen (Zeilenaufbau, Frequenz und Helligkeit, VIS-Kennung) mit Hörproben (D23 bis D25).
// Alle Zahlen kommen aus Modustabelle und Encoder (src/lehrdaten.js), nichts ist von Hand eingetippt.
import { MODES, MODE_IDS, packetMs, linesPerPacket, imageSeconds, preambleSeconds } from '../src/modes.js';
import { zeilenTeile, zeilenFenster, inZeile, visDaten, wertZuHz, farbraumInfo, tonSamples, hoerprobeVis, hoerprobeZeile } from '../src/lehrdaten.js';
import { zahl } from '../src/i18n.js';
import { setzeAusgang } from '../src/audiogeraete.js';
import { F_SYNC, F_BLACK, F_WHITE, F_LEADER } from '../src/constants.js';

const FS = 48000;
const S = { modus: 'martin1', cursor: null, wert: 128, spielt: null, ausgang: '' };
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const ms = (v) => `${zahl(v, v < 10 ? 3 : v < 100 ? 2 : 1)} ms`;

// ------------------------------------------------------------------ Hörproben
function stoppe() {
  const s = S.spielt;
  if (!s) return;
  S.spielt = null;
  try { s.quelle.onended = null; s.quelle.stop(); } catch { /* schon beendet */ }
  s.ac.close().catch(() => {});
  s.knopf.setAttribute('aria-pressed', 'false');
  s.zeige();
}

async function spiele(samples, knopf, zeige) {
  const lief = S.spielt?.knopf === knopf;
  stoppe();
  if (lief) return; // zweiter Tipp auf denselben Knopf beendet nur
  const ac = new AudioContext({ sampleRate: FS });
  const puffer = ac.createBuffer(1, samples.length, FS);
  puffer.copyToChannel(samples, 0);
  const quelle = ac.createBufferSource();
  quelle.buffer = puffer;
  quelle.connect(ac.destination);
  // Gleich eintragen, noch vor den await: Tippt jemand schnell auf eine zweite Hörprobe, stoppt stoppe() diese hier sauber,
  // statt dass sie als Geist ohne Stoppknopf weiterdudelt
  const s = { ac, quelle, knopf, zeige };
  S.spielt = s;
  quelle.onended = () => { if (S.spielt === s) stoppe(); };
  await setzeAusgang(ac, S.ausgang);
  await ac.resume().catch(() => {});
  if (S.spielt !== s) return; // inzwischen gestoppt
  quelle.start();
  knopf.setAttribute('aria-pressed', 'true');
  zeige();
}

// ------------------------------------------------------------------ Ansicht
export default function mount(wurzel, { t, symbol, einstellung }) {
  S.ausgang = einstellung('audioAusgang');
  const knopfHoer = (schluessel, holeSamples) => {
    const b = el('button', 'btn tonal'); b.type = 'button';
    const zeige = () => { const an = S.spielt?.knopf === b; b.replaceChildren(...(an ? [] : [symbol('campaign')]), document.createTextNode(t(an ? 'codierung.stopp' : schluessel))); };
    b.addEventListener('click', () => spiele(holeSamples(), b, zeige));
    zeige();
    return b;
  };
  const mode = () => MODES[S.modus];
  const absatz = (text, klasse) => el('p', klasse ?? '', text);

  // ---------------------------------------------------------------- Einleitung und Modus
  const einleitung = absatz(t('codierung.einleitung'));
  const kModus = el('div', 'card');
  const auswahl = el('select');
  for (const id of MODE_IDS) { const o = el('option', '', MODES[id].name); o.value = id; auswahl.append(o); }
  auswahl.value = S.modus;
  const feldModus = el('label', 'feld'); feldModus.append(el('span', '', t('codierung.modus')), auswahl);
  kModus.append(feldModus, absatz(t('codierung.modus.hinweis'), 'hint body-sm'));

  // ---------------------------------------------------------------- Karte 1: Zeilenaufbau
  const kZeile = el('div', 'card');
  kZeile.append(el('h2', 'title-md', t('codierung.zeile.titel')), absatz(t('codierung.zeile.text')));
  const zFamilie = absatz('');
  const balkenBox = el('div', 'teilebalken-box');
  const balken = el('div', 'teilebalken'); balken.setAttribute('role', 'img');
  const marke = el('div', 'teilemarke'); marke.setAttribute('aria-hidden', 'true');
  balkenBox.append(balken, marke);
  const regler = el('input'); regler.type = 'range'; regler.min = '0'; regler.max = '1000'; regler.step = '1';
  regler.setAttribute('aria-label', t('codierung.zeile.regler'));
  const reglerFeld = el('label', 'regler'); reglerFeld.append(el('span', 'label-lg', t('codierung.zeile.regler')), regler);
  const zCursor = el('p', 'cursor-text'); zCursor.setAttribute('aria-live', 'polite');
  const tabelle = el('table', 'teiletabelle');
  const zFakten = absatz('', 'hint');
  const zRueck = absatz('');
  const zAkt = el('div', 'aktionen');
  zAkt.append(knopfHoer('codierung.hoer.zeile', () => hoerprobeZeile(mode(), FS)));
  kZeile.append(zFamilie, balkenBox, reglerFeld, zCursor, tabelle, zFakten, zAkt, el('h3', 'label-lg', t('codierung.rueck')), zRueck);

  // ---------------------------------------------------------------- Karte 2: Frequenz und Helligkeit
  const kFreq = el('div', 'card');
  kFreq.append(el('h2', 'title-md', t('codierung.freq.titel')), absatz(t('codierung.freq.text')));
  const fRegler = el('input'); fRegler.type = 'range'; fRegler.min = '0'; fRegler.max = '255'; fRegler.step = '1'; fRegler.value = String(S.wert);
  fRegler.setAttribute('aria-label', t('codierung.freq.regler'));
  const fReglerFeld = el('label', 'regler'); const fReglerText = el('span', 'label-lg'); fReglerFeld.append(fReglerText, fRegler);
  const farbfeld = el('div', 'farbfeld'); farbfeld.setAttribute('aria-hidden', 'true');
  const skala = el('div', 'tonskala'); skala.setAttribute('aria-hidden', 'true');
  const skalaVerlauf = el('div', 'tonskala-verlauf'); const skalaMarke = el('div', 'tonskala-marke');
  skala.append(skalaVerlauf, skalaMarke);
  const SK_VON = 1100, SK_BIS = 2400, pct = (hz) => `${((hz - SK_VON) / (SK_BIS - SK_VON)) * 100}%`;
  skalaVerlauf.style.left = pct(F_BLACK); skalaVerlauf.style.width = `${((F_WHITE - F_BLACK) / (SK_BIS - SK_VON)) * 100}%`;
  const skalaBeschriftung = el('div', 'tonskala-text mono');
  for (const [hz, schluessel] of [[F_SYNC, 'codierung.freq.sync'], [F_BLACK, 'codierung.freq.schwarz'], [F_LEADER, 'codierung.freq.leitton'], [F_WHITE, 'codierung.freq.weiss']]) {
    const s = el('span', '', `${hz}\n${t(schluessel)}`); s.style.left = pct(hz); skalaBeschriftung.append(s);
  }
  const fRaum = absatz('', 'hint');
  const fRueck = absatz(t('codierung.freq.rueck'));
  const fAkt = el('div', 'aktionen');
  fAkt.append(knopfHoer('codierung.hoer.ton', () => tonSamples(wertZuHz(S.wert), 1.2, FS)));
  kFreq.append(fReglerFeld, farbfeld, skala, skalaBeschriftung, fRaum, fAkt, el('h3', 'label-lg', t('codierung.rueck')), fRueck);

  // ---------------------------------------------------------------- Karte 3: VIS
  const kVis = el('div', 'card');
  kVis.append(el('h2', 'title-md', t('codierung.vis.titel')), absatz(t('codierung.vis.text')));
  const vFolge = el('ol', 'vis-folge');
  const vZahl = absatz(''); const vGesendet = absatz(''); const vDauer = absatz('', 'hint');
  const vRueck = absatz(t('codierung.vis.rueck'));
  const vAkt = el('div', 'aktionen');
  vAkt.append(knopfHoer('codierung.hoer.vis', () => hoerprobeVis(mode(), FS)));
  kVis.append(vFolge, vZahl, vGesendet, vDauer, vAkt, el('h3', 'label-lg', t('codierung.rueck')), vRueck);

  wurzel.append(einleitung, kModus, kZeile, kFreq, kVis);

  // ---------------------------------------------------------------- Zeichnen
  const kanalName = (k) => t(`codierung.kanal.${k}`);
  const hzText = (p) => (p.hzBereich ? `${p.hzBereich[0]} bis ${p.hzBereich[1]} Hz` : p.hzListe ? t('codierung.hz.liste', { a: p.hzListe[0], b: p.hzListe[1] }) : `${p.hz} Hz`);
  const teilName = (p) => (p.art === 'scan' ? kanalName(p.kanal) : t(`codierung.teil.${p.art}`));
  const zeitSteht = () => { const f = zeilenFenster(mode()); return S.cursor === null ? null : Math.min(f.bisMs, Math.max(f.vonMs, S.cursor)); };

  function setzeMarke() {
    const m = mode(), f = zeilenFenster(m);
    const c = zeitSteht();
    const teile = zeilenTeile(m);
    const i = teile.findIndex((p) => c >= p.startMs && c < p.startMs + p.ms);
    const seg = balken.children[i < 0 ? balken.children.length - 1 : i];
    if (!seg) return;
    const teil = teile[i < 0 ? teile.length - 1 : i];
    const anteil = Math.min(1, Math.max(0, (c - teil.startMs) / teil.ms));
    marke.style.left = `${seg.offsetLeft + anteil * seg.offsetWidth}px`;
    const z = inZeile(m, c);
    const rel = c;
    let text;
    if (z.teil.art === 'scan') text = t('codierung.cursor.scan', { ms: ms(rel), kanal: kanalName(z.teil.kanal), pixel: z.pixel + 1, n: z.pixelAnzahl, us: zahl(z.pixelUs, 0) });
    else text = t(`codierung.cursor.${z.teil.art}`, { ms: ms(rel), hz: z.teil.hzListe ? t('codierung.hz.liste', { a: z.teil.hzListe[0], b: z.teil.hzListe[1] }) : z.teil.hz });
    zCursor.textContent = text;
  }

  function zeichneZeile() {
    const m = mode(), f = zeilenFenster(m), teile = zeilenTeile(m);
    zFamilie.textContent = t(`codierung.zeile.${m.family}`);
    balken.replaceChildren();
    for (const p of teile) {
      const s = el('div', 'teil', p.art === 'sync' ? 'S' : p.art === 'scan' ? t(`codierung.kurz.${p.kanal}`) : '');
      s.dataset.art = p.art; if (p.kanal) s.dataset.kanal = p.kanal;
      s.style.flex = `${p.ms} 0 3px`;
      s.title = `${teilName(p)}: ${ms(p.ms)}`;
      balken.append(s);
    }
    balken.setAttribute('aria-label', t('codierung.zeile.balken', { modus: m.name, ms: ms(packetMs(m)) }));
    tabelle.replaceChildren();
    const kopf = el('tr'); for (const k of ['teil', 'dauer', 'freq']) kopf.append(el('th', '', t(`codierung.tabelle.${k}`)));
    const th = el('thead'); th.append(kopf);
    const tb = el('tbody');
    for (const p of teile) { const r = el('tr'); r.append(el('td', '', teilName(p)), el('td', 'mono', ms(p.ms)), el('td', 'mono', hzText(p))); tb.append(r); }
    tabelle.append(th, tb);
    const pakete = m.height / linesPerPacket(m);
    zFakten.textContent = t('codierung.zeile.fakten', { zeile: ms(packetMs(m)), pakete, zeilen: m.height, breite: m.width, bild: zahl(imageSeconds(m), 1), gesamt: zahl(imageSeconds(m) + preambleSeconds(), 1) });
    const scan = teile.find((p) => p.art === 'scan');
    zRueck.textContent = t('codierung.zeile.rueck', { pixel: zahl((scan.ms / m.width) * 1000, 0), breite: m.width });
    if (S.cursor === null || S.cursor < f.vonMs || S.cursor > f.bisMs) S.cursor = scan.startMs + scan.ms * 0.4;
    regler.value = String(Math.round(((S.cursor - f.vonMs) / (f.bisMs - f.vonMs)) * 1000));
    setzeMarke();
  }

  function zeichneFreq() {
    const hz = wertZuHz(S.wert);
    fReglerText.textContent = t('codierung.freq.regler.wert', { wert: S.wert, hz: zahl(hz, 1) });
    farbfeld.style.background = `rgb(${S.wert}, ${S.wert}, ${S.wert})`;
    skalaMarke.style.left = pct(hz);
    const r = farbraumInfo(mode());
    fRaum.textContent = r.art === 'rgb'
      ? t('codierung.freq.rgb', { modus: mode().name, schwarz: zahl(r.schwarzHz, 0), weiss: zahl(r.weissHz, 0) })
      : t('codierung.freq.ycc', { modus: mode().name, y1: r.schwarzWert, hz1: zahl(r.schwarzHz, 0), y2: r.weissWert, hz2: zahl(r.weissHz, 0) });
  }

  function zeichneVis() {
    const m = mode(), d = visDaten(m);
    vFolge.replaceChildren();
    for (const s of d.schritte) {
      const li = el('li', 'vis-schritt');
      li.dataset.art = s.name === 'bit' || s.name === 'paritaet' ? `bit${s.bit}` : s.name;
      const oben = s.name === 'bit' ? `b${s.nr}` : s.name === 'paritaet' ? 'P' : t(`codierung.vis.${s.name}`);
      li.append(el('span', 'vis-oben', oben), el('strong', 'vis-bit', s.bit !== undefined ? String(s.bit) : ''), el('span', 'vis-hz mono', `${s.hz} Hz`), el('span', 'vis-ms body-sm', `${zahl(s.ms, 0)} ms`));
      vFolge.append(li);
    }
    const einsen = d.datenbits.reduce((a, b) => a + b, 0) + d.paritaet;
    vZahl.textContent = t('codierung.vis.zahl', { modus: m.name, vis: d.vis, binaer: d.binaer });
    vGesendet.textContent = t('codierung.vis.gesendet', { bits: d.datenbits.join(' '), par: d.paritaet, einsen });
    vDauer.textContent = t('codierung.vis.dauer', { s: zahl(d.gesamtMs / 1000, 2) });
  }

  const alles = () => { zeichneZeile(); zeichneFreq(); zeichneVis(); };
  auswahl.addEventListener('change', () => { stoppe(); S.modus = auswahl.value; S.cursor = null; alles(); });
  regler.addEventListener('input', () => { const f = zeilenFenster(mode()); S.cursor = f.vonMs + (Number(regler.value) / 1000) * (f.bisMs - f.vonMs); setzeMarke(); });
  fRegler.addEventListener('input', () => { S.wert = Number(fRegler.value); zeichneFreq(); });
  alles();
  const beobachter = new ResizeObserver(() => setzeMarke());
  beobachter.observe(balken);
  return { unmount() { beobachter.disconnect(); stoppe(); } };
}
