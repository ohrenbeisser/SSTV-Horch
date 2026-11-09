// Bereich „Labor“: die Werkbank (D26 bis D28). Eine Karte je Werkzeug, Mikrofon und Testton teilen sich eine Karte.
//  - Pegeltest: Spitze, Effektivwert, Übersteuerungen, Grundrauschen, Abstand zum Testton
//  - Tonkorrektur (Abstimmhilfe): stärkster Ton gegen einen Sollton, Abweichung in Hz
//  - Taktabweichung: Gerät A spielt den Referenzton, Gerät B misst die mittlere Frequenz, ppm = Unterschied der Uhren
//  - Rauschsimulator: Testbild mit Rauschen, Versatz und Taktfehler kodieren, decodieren, vergleichen (im Web Worker)
import { MODES, MODE_IDS, imageSeconds, preambleSeconds } from '../src/modes.js';
import { pegel, schaetzeSpitze, Taktmesser, pegelArt } from '../src/frequenzmessung.js';
import { zahl } from '../src/i18n.js';
import { oeffneMikrofon, setzeAusgang } from '../src/audiogeraete.js';

const FS = 48000;
const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };
const vorz = (x, st = 1) => { const r = Number(x.toFixed(st)) || 0; return `${r > 0 ? '+' : ''}${zahl(r, st)}`; }; // kein „−0“
const SOLLTOENE = [['leitton', 1900], ['sync', 1200], ['schwarz', 1500], ['weiss', 2300], ['vis1', 1100], ['vis0', 1300]];

/** Testbild in Modusgröße: Farbbalken, Grauverlauf, Ellipse und Schrift. */
function zeichneTestbild(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#202020'; x.fillRect(0, 0, w, h);
  const balken = ['#ffffff', '#ffff00', '#00ffff', '#00ff00', '#ff00ff', '#ff0000', '#0000ff', '#000000'];
  balken.forEach((f, i) => { x.fillStyle = f; x.fillRect((i * w) / 8, 0, w / 8 + 1, h * 0.3); });
  const g = x.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#000'); g.addColorStop(1, '#fff');
  x.fillStyle = g; x.fillRect(0, h * 0.3, w, h * 0.15);
  x.fillStyle = '#c0001a'; x.beginPath(); x.ellipse(w * 0.5, h * 0.7, w * 0.3, h * 0.2, 0, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.font = `700 ${Math.round(h * 0.12)}px Roboto, Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText('SSTV-Horch', w * 0.5, h * 0.7);
  x.strokeStyle = '#fff'; x.lineWidth = Math.max(1, h / 120); x.strokeRect(0.5, 0.5, w - 1, h - 1);
  return x.getImageData(0, 0, w, h);
}

export default function mount(wurzel, { t, symbol, einstellung, setzeEinstellung }) {
  const M = { ctx: null, stream: null, node: null, gain: null, ring: new Float32Array(65536), rn: 0, rmsListe: [], spitze: 0, clips: 0, takt: null };
  const T = { ctx: null, osc: null }; // Testton
  let zuletzt = { pegel: null, spitze: null }; // letzte Messwerte für die Karten
  let simWorker = null, simId = 0, eigenesBild = null;
  let timerUi = 0;

  const absatz = (text, klasse) => el('p', klasse ?? '', text);
  const karte = (titel, text) => { const k = el('div', 'card'); k.append(el('h2', 'title-md', t(titel))); if (text) k.append(absatz(t(text))); return k; };
  const knopf = (klasse, schluessel, icon) => { const b = el('button', klasse); b.type = 'button'; if (icon) b.append(symbol(icon)); b.append(document.createTextNode(t(schluessel))); return b; };
  const regler = (min, max, step, wert) => { const i = el('input'); i.type = 'range'; i.min = String(min); i.max = String(max); i.step = String(step); i.value = String(wert); return i; };
  const reglerFeld = (input) => { const l = el('label', 'regler'); const s = el('span', 'label-lg'); l.append(s, input); return [l, s]; };

  const einleitung = absatz(t('labor.einleitung'));

  // ---------------------------------------------------------------- Karte Audio (Mikrofon und Testton)
  const kAudio = karte('labor.audio.titel', 'labor.audio.text');
  const bMic = knopf('btn filled', 'labor.mic.start', 'mic'); const bTon = knopf('btn tonal', 'labor.ton.start', 'campaign');
  const aAkt = el('div', 'aktionen'); aAkt.append(bMic, bTon);
  const eingang = regler(-20, 30, 1, einstellung('eingangDb')); const [eingangFeld, eingangText] = reglerFeld(eingang);
  const tonPegel = regler(5, 80, 5, 30); const [tonPegelFeld, tonPegelText] = reglerFeld(tonPegel);
  const audioStatus = absatz('', 'status'); audioStatus.setAttribute('role', 'status');
  const audioFehler = el('div', 'warnband'); audioFehler.setAttribute('role', 'alert');
  kAudio.append(aAkt, eingangFeld, tonPegelFeld, absatz(t('labor.ton.hinweis'), 'hint body-sm'), audioStatus, audioFehler);

  // ---------------------------------------------------------------- Karte Pegeltest
  const kPegel = karte('labor.pegel.titel', 'labor.pegel.text');
  const pBalken = el('div', 'pegel-balken'); const pFuell = el('div', 'pegel-fuell'); pBalken.append(pFuell);
  const pWerte = el('dl', 'werteliste'); const pHinweis = absatz('', 'hint');
  const pReset = knopf('btn text', 'labor.pegel.reset'); const pAkt = el('div', 'aktionen'); pAkt.append(pReset);
  kPegel.append(pBalken, pWerte, pHinweis, pAkt);

  // ---------------------------------------------------------------- Karte Tonkorrektur
  const kTon = karte('labor.abst.titel', 'labor.abst.text');
  const soll = el('select');
  for (const [k, hz] of SOLLTOENE) { const o = el('option', '', t(`labor.soll.${k}`, { hz })); o.value = String(hz); soll.append(o); }
  const sollFeld = el('label', 'feld'); sollFeld.append(el('span', '', t('labor.abst.soll')), soll);
  const aMesser = el('div', 'abst-messer'); aMesser.setAttribute('aria-hidden', 'true');
  const aMarke = el('div', 'abst-marke'); aMesser.append(el('div', 'abst-mitte'), aMarke);
  const aSkala = el('div', 'abst-skala mono'); aSkala.append(el('span', '', '−50'), el('span', '', '0'), el('span', '', '+50 Hz'));
  const aWert = el('p', 'abst-wert title-lg'); aWert.setAttribute('aria-live', 'polite');
  const aText = absatz('', 'hint');
  kTon.append(sollFeld, aWert, aMesser, aSkala, aText);

  // ---------------------------------------------------------------- Karte Taktabweichung
  const kTakt = karte('labor.takt.titel', 'labor.takt.text');
  kTakt.append(absatz(t('labor.takt.ablauf')));
  const bTakt = knopf('btn tonal', 'labor.takt.start'); const tAkt = el('div', 'aktionen'); tAkt.append(bTakt);
  const tWert = absatz('', 'abst-wert title-lg'); tWert.setAttribute('aria-live', 'polite');
  const tText = absatz('', 'hint');
  const bUebernehmen = knopf('btn', 'labor.takt.uebernehmen'); bUebernehmen.hidden = true;
  const uAkt = el('div', 'aktionen'); uAkt.append(bUebernehmen);
  const uText = absatz('', 'status'); uText.setAttribute('role', 'status');
  kTakt.append(tAkt, tWert, tText, uAkt, uText, absatz(t('labor.takt.uebernehmen.hinweis'), 'hint body-sm'), absatz(t('labor.takt.grenzen'), 'hint body-sm'));

  // ---------------------------------------------------------------- Karte Rauschsimulator
  const kSim = karte('labor.sim.titel', 'labor.sim.text');
  const simModus = el('select');
  for (const id of MODE_IDS) { const o = el('option', '', `${MODES[id].name} · ${zahl(imageSeconds(MODES[id]) + preambleSeconds(), 0)} s`); o.value = id; simModus.append(o); }
  simModus.value = 'robot36';
  const simModusFeld = el('label', 'feld'); simModusFeld.append(el('span', '', t('labor.sim.modus')), simModus);
  const snr = regler(-5, 40, 1, 20); const [snrFeld, snrText] = reglerFeld(snr);
  const versatz = regler(-150, 150, 5, 0); const [versatzFeld, versatzText] = reglerFeld(versatz);
  const takt = regler(-1500, 1500, 50, 0); const [taktFeld, taktText] = reglerFeld(takt);
  const eigenDatei = el('input'); eigenDatei.type = 'file'; eigenDatei.accept = 'image/*'; eigenDatei.hidden = true;
  const bEigen = knopf('btn', 'labor.sim.eigen', 'image'); const bTest = knopf('btn text', 'labor.sim.testbild');
  const bSim = knopf('btn filled', 'labor.sim.start'); const bAlle = knopf('btn tonal', 'labor.sim.alle');
  const sAkt = el('div', 'aktionen'); sAkt.append(bSim, bAlle, bEigen, bTest, eigenDatei);
  const sStatus = absatz('', 'status'); sStatus.setAttribute('role', 'status'); sStatus.setAttribute('aria-live', 'polite');
  const bilder = el('div', 'sim-bilder');
  const cOrig = el('canvas'); const cErg = el('canvas');
  const figO = el('figure'); figO.append(cOrig, el('figcaption', 'hint body-sm', t('labor.sim.original')));
  const figE = el('figure'); const figEText = el('figcaption', 'hint body-sm', t('labor.sim.ergebnis')); figE.append(cErg, figEText);
  bilder.append(figO, figE);
  const sWerte = el('dl', 'werteliste');
  const vergleich = el('table', 'teiletabelle'); vergleich.hidden = true;
  kSim.append(simModusFeld, snrFeld, versatzFeld, taktFeld, sAkt, sStatus, bilder, sWerte, vergleich, absatz(t('labor.sim.rueck'), 'hint body-sm'));

  wurzel.append(einleitung, kAudio, kPegel, kTon, kTakt, kSim);

  // ---------------------------------------------------------------- Mikrofon und Testton
  const meldeAudio = (schluessel, args) => { audioStatus.textContent = schluessel ? t(schluessel, args) : ''; };
  let micStartet = false; // ein zweiter Tipp, während der Browser noch nach der Erlaubnis fragt, darf kein zweites Mikrofon öffnen
  async function micStart() {
    if (micStartet) return;
    micStartet = true;
    audioFehler.textContent = '';
    if (!navigator.mediaDevices?.getUserMedia) { audioFehler.textContent = t('empfangen.fehler.https'); return; }
    try {
      const mik = await oeffneMikrofon(einstellung('audioEingang'));
      M.stream = mik.stream;
      if (mik.abweichung) audioFehler.textContent = t('empfangen.hinweis.geraet');
      M.ctx = new AudioContext({ sampleRate: FS, latencyHint: 'interactive' });
      await M.ctx.audioWorklet.addModule(new URL('../src/aufnahme-worklet.js', import.meta.url));
      const quelle = M.ctx.createMediaStreamSource(M.stream);
      M.gain = M.ctx.createGain(); M.gain.gain.value = 10 ** (Number(eingang.value) / 20);
      M.node = new AudioWorkletNode(M.ctx, 'sstv-aufnahme');
      const stumm = M.ctx.createGain(); stumm.gain.value = 0;
      quelle.connect(M.gain); M.gain.connect(M.node); M.node.connect(stumm).connect(M.ctx.destination);
      M.rn = 0; M.rmsListe = []; M.spitze = 0; M.clips = 0;
      M.node.port.onmessage = (e) => beiChunk(e.data);
      meldeAudio('labor.mic.laeuft');
      timerUi = setInterval(messeSpektrum, 250);
    } catch (e) { micStopp(); audioFehler.textContent = t('empfangen.fehler.mic', { grund: e.message || e.name }); }
    micStartet = false;
    zeichneAudio();
  }
  function micStopp() {
    clearInterval(timerUi); timerUi = 0;
    M.stream?.getTracks().forEach((x) => x.stop());
    M.ctx?.close().catch(() => {});
    M.ctx = M.stream = M.node = M.gain = null; M.takt = null;
    zuletzt = { pegel: null, spitze: null };
    meldeAudio(''); zeichneAudio(); zeichnePegel(); zeichneAbstimmung(); zeichneTakt();
  }
  function beiChunk(x) {
    const p = pegel(x);
    zuletzt.pegel = p;
    M.spitze = Math.max(M.spitze, p.peak); M.clips += p.clips;
    M.rmsListe.push(p.rmsDb); if (M.rmsListe.length > 120) M.rmsListe.shift(); // etwa 10 s
    // Ring der letzten 65536 Proben
    if (x.length >= M.ring.length) M.ring.set(x.subarray(x.length - M.ring.length));
    else { M.ring.copyWithin(0, x.length); M.ring.set(x, M.ring.length - x.length); }
    M.rn = Math.min(M.ring.length, M.rn + x.length);
    if (M.takt) M.takt.push(x);
    zeichnePegel();
  }
  function messeSpektrum() {
    if (!M.ctx || M.rn < 32768) return;
    zuletzt.spitze = schaetzeSpitze(M.ring.subarray(M.ring.length - M.rn), FS, Number(soll.value) - 150, Number(soll.value) + 150);
    zuletzt.breit = schaetzeSpitze(M.ring.subarray(M.ring.length - M.rn), FS, 1000, 2500);
    zeichneAbstimmung(); zeichneTakt();
  }

  async function tonStart() {
    audioFehler.textContent = '';
    try {
      T.ctx = new AudioContext({ sampleRate: FS });
      await setzeAusgang(T.ctx, einstellung('audioAusgang'));
      const osc = T.ctx.createOscillator(); osc.type = 'sine'; osc.frequency.value = 1900; // exakt 1900 Hz auf der Uhr des Geräts
      const g = T.ctx.createGain(); g.gain.value = Number(tonPegel.value) / 100; T.gain = g;
      osc.connect(g).connect(T.ctx.destination);
      T.osc = osc;
      // osc festhalten: Wer schneller auf Stopp drückt, als resume() fertig ist, hat T.osc schon auf null gesetzt
      T.ctx.resume().then(() => { if (T.osc === osc) osc.start(); }).catch(() => {});
    } catch (e) { tonStopp(); audioFehler.textContent = t('senden.fehler.audio', { grund: e.message }); }
    zeichneAudio();
  }
  function tonStopp() { try { T.osc?.stop(); } catch { /* egal */ } T.ctx?.close().catch(() => {}); T.ctx = T.osc = T.gain = null; zeichneAudio(); }

  // ---------------------------------------------------------------- Zeichnen
  function zeichneAudio() {
    bMic.replaceChildren(...(M.ctx ? [] : [symbol('mic')]), document.createTextNode(t(M.ctx ? 'labor.mic.stopp' : 'labor.mic.start')));
    bTon.replaceChildren(...(T.ctx ? [] : [symbol('campaign')]), document.createTextNode(t(T.ctx ? 'labor.ton.stopp' : 'labor.ton.start')));
    const v = Number(eingang.value);
    eingangText.textContent = `${t('empfangen.verstaerkung')}: ${v > 0 ? '+' : ''}${v} dB`;
    tonPegelText.textContent = `${t('labor.ton.pegel')}: ${tonPegel.value} %`;
  }

  function zeichnePegel() {
    pWerte.replaceChildren();
    const p = zuletzt.pegel;
    if (!M.ctx || !p) { pFuell.style.width = '0'; pBalken.dataset.art = ''; pHinweis.textContent = t('labor.pegel.aus'); return; }
    const db = M.spitze > 0 ? 20 * Math.log10(M.spitze) : -120;
    const jetzt = p.peakDb;
    pFuell.style.width = `${Math.max(0, Math.min(100, ((jetzt + 60) / 60) * 100))}%`;
    const art = pegelArt(M.spitze);
    pBalken.dataset.art = art;
    const grund = M.rmsListe.length ? Math.min(...M.rmsListe) : -120;
    const zeile = (k, v) => pWerte.append(el('dt', '', t(k)), el('dd', 'mono', v));
    zeile('labor.pegel.spitze', `${zahl(jetzt, 0)} dBFS`);
    zeile('labor.pegel.halten', `${zahl(db, 0)} dBFS`);
    zeile('labor.pegel.rms', `${zahl(p.rmsDb, 0)} dBFS`);
    zeile('labor.pegel.clips', String(M.clips));
    // Der leiseste Moment ist nur dann das Grundrauschen, wenn kein Dauerton im Band liegt; mit Testton zeigt die Zeile stattdessen den Abstand
    const b = zuletzt.breit;
    const dauerton = b && b.abstandDb > 25;
    if (!dauerton) zeile('labor.pegel.grund', `${zahl(grund, 0)} dBFS`);
    else if (T.ctx) zeile('labor.pegel.abstand', `${zahl(b.abstandDb, 0)} dB`);
    pHinweis.textContent = t(`labor.pegel.hinweis.${art}`);
  }

  function zeichneAbstimmung() {
    const s = zuletzt.spitze;
    const sollHz = Number(soll.value);
    if (!M.ctx || !s || !(s.abstandDb > 12)) {
      aWert.textContent = t(M.ctx ? 'labor.abst.keinton' : 'labor.abst.aus');
      aMarke.style.left = '50%'; aMarke.dataset.art = ''; aText.textContent = '';
      return;
    }
    const abw = s.hz - sollHz;
    aWert.textContent = `${zahl(s.hz, 1)} Hz (${vorz(abw)} Hz)`;
    aMarke.style.left = `${50 + (Math.max(-50, Math.min(50, abw)) / 100) * 100}%`;
    const gut = Math.abs(abw) <= 5;
    aMarke.dataset.art = gut ? 'gut' : 'weg';
    aText.textContent = gut ? t('labor.abst.gut') : t(abw > 0 ? 'labor.abst.zuhoch' : 'labor.abst.zutief', { hz: zahl(Math.abs(abw), 0) });
  }

  function zeichneTakt() {
    bTakt.replaceChildren(document.createTextNode(t(M.takt ? 'labor.takt.stopp' : 'labor.takt.start')));
    bUebernehmen.hidden = true; M.taktPpm = null;
    if (!M.ctx) { tWert.textContent = ''; tText.textContent = t('labor.takt.aus'); return; }
    if (!M.takt) { tWert.textContent = ''; tText.textContent = t('labor.takt.bereit'); return; }
    const m = M.takt.ergebnis();
    const dauer = m.dauer;
    const ton = zuletzt.spitze && Math.abs(zuletzt.spitze.hz - 1900) < 40 && zuletzt.spitze.abstandDb > 20;
    if (!ton && dauer < 8) { tWert.textContent = ''; tText.textContent = t('labor.takt.keinton'); return; }
    if (dauer < 10) { tWert.textContent = ''; tText.textContent = t('labor.takt.misst', { s: zahl(10 - dauer, 0) }); return; }
    const n = Math.max(1, m.n);
    const unsicher = (m.streuung / Math.sqrt(n) / 1900) * 1e6;
    tWert.textContent = `${vorz(m.ppm, 0)} ppm`;
    M.taktPpm = Math.round(m.ppm); bUebernehmen.hidden = !ton; // nur mit klarem 1900-Hz-Ton ein Wert, den man übernehmen sollte
    tText.textContent = t('labor.takt.ergebnis', { s: zahl(dauer, 0), hz: zahl(m.hz, 3), plusminus: zahl(Math.max(1, unsicher), 0), streu: zahl(m.streuung, 2), deutung: t(Math.abs(m.ppm) < 20 ? 'labor.takt.deutung.klein' : Math.abs(m.ppm) < 200 ? 'labor.takt.deutung.normal' : 'labor.takt.deutung.gross') });
    if (!ton) tText.textContent += ` ${t('labor.takt.ton.weg')}`;
  }

  // ---------------------------------------------------------------- Rauschsimulator
  const modeSim = () => MODES[simModus.value];
  function holeBild(mode) {
    const c = document.createElement('canvas'); c.width = mode.width; c.height = mode.height;
    if (!eigenesBild) return zeichneTestbild(mode.width, mode.height);
    const x = c.getContext('2d', { willReadFrequently: true });
    const ziel = mode.width / mode.height, quelle = eigenesBild.width / eigenesBild.height;
    let sw = eigenesBild.width, sh = eigenesBild.height, sx = 0, sy = 0;
    if (quelle > ziel) { sw = sh * ziel; sx = (eigenesBild.width - sw) / 2; } else { sh = sw / ziel; sy = (eigenesBild.height - sh) / 2; }
    x.imageSmoothingQuality = 'high';
    x.drawImage(eigenesBild, sx, sy, sw, sh, 0, 0, mode.width, mode.height);
    return x.getImageData(0, 0, mode.width, mode.height);
  }
  const zeigeBild = (canvas, img) => { canvas.width = img.width; canvas.height = img.height; canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0); };
  const snrWert = () => (Number(snr.value) >= 40 ? null : Number(snr.value));
  function zeichneSimRegler() {
    snrText.textContent = `${t('labor.sim.snr')}: ${snrWert() === null ? t('labor.sim.ohne') : `${snr.value} dB`}`;
    versatzText.textContent = `${t('labor.sim.versatz')}: ${vorz(Number(versatz.value), 0)} Hz`;
    taktText.textContent = `${t('labor.sim.takt')}: ${vorz(Number(takt.value), 0)} ppm`;
    bEigen.hidden = false; bTest.hidden = !eigenesBild;
  }
  function rechne(modeId, bild) {
    return new Promise((ok, fehler) => {
      simWorker ??= new Worker(new URL('../src/labor-worker.js', import.meta.url), { type: 'module' });
      const id = ++simId;
      simWorker.onmessage = (e) => { if (e.data.id !== id) return; if (e.data.fehler) fehler(new Error(e.data.fehler)); else ok(e.data.ergebnis); };
      simWorker.onerror = (e) => fehler(new Error(e.message || 'Worker'));
      const kopie = new Uint8ClampedArray(bild.data);
      simWorker.postMessage({ id, modeId, image: { width: bild.width, height: bild.height, data: kopie }, snrDb: snrWert(), offsetHz: Number(versatz.value), clockPpm: Number(takt.value) }, [kopie.buffer]);
    });
  }
  const sperre = (an) => { for (const b of [bSim, bAlle, bEigen, bTest]) b.disabled = an; };
  function zeigeErgebnis(mode, e) {
    sWerte.replaceChildren();
    const z = (k, v) => sWerte.append(el('dt', '', t(k)), el('dd', 'mono', v));
    if (!e.image) {
      z('labor.sim.w.erkannt', e.erkannt ? MODES[e.erkannt].name : t('labor.sim.nichts'));
      sStatus.textContent = t(e.erkannt ? 'labor.sim.falsch' : 'labor.sim.verloren');
      cErg.getContext('2d').clearRect(0, 0, cErg.width, cErg.height);
      return;
    }
    zeigeBild(cErg, e.image);
    z('labor.sim.w.erkannt', `${MODES[e.erkannt].name}${e.vis !== null && e.vis !== undefined ? ` (VIS ${e.vis})` : ` ${t('labor.sim.ohnevis')}`}`);
    z('labor.sim.w.zeilen', `${e.validLines} / ${mode.height}`);
    z('labor.sim.w.fehler', `${zahl(e.fehler, 1)} / 255`);
    z('labor.sim.w.qualitaet', `${Math.round(e.quality * 100)} %`);
    if (e.offsetHz !== null && e.offsetHz !== undefined) z('labor.sim.w.versatz', `${vorz(e.offsetHz, 1)} Hz`);
    if (e.ppm !== null && e.ppm !== undefined) z('labor.sim.w.ppm', `${vorz(e.ppm, 0)} ppm`);
    z('labor.sim.w.rechnen', `${zahl(e.rechenMs / 1000, 1)} s`);
    sStatus.textContent = t('labor.sim.fertig', { s: zahl(e.dauerS, 0) });
  }
  async function simuliere() {
    vergleich.hidden = true; bilder.hidden = false; sperre(true);
    const mode = modeSim(); const bild = holeBild(mode);
    zeigeBild(cOrig, bild);
    sStatus.textContent = t('labor.sim.rechnet', { modus: mode.name });
    try { zeigeErgebnis(mode, await rechne(mode.id, bild)); } catch (e) { sStatus.textContent = t('labor.sim.fehler', { grund: e.message }); }
    sperre(false);
  }
  async function vergleicheAlle() {
    sperre(true); sWerte.replaceChildren(); bilder.hidden = true; vergleich.hidden = false; vergleich.replaceChildren();
    const kopf = el('tr'); for (const k of ['modus', 'dauer', 'fehler', 'qualitaet', 'ergebnis']) kopf.append(el('th', '', t(`labor.sim.v.${k}`)));
    const th = el('thead'); th.append(kopf); const tb = el('tbody'); vergleich.append(th, tb);
    for (const id of MODE_IDS) {
      const mode = MODES[id];
      sStatus.textContent = t('labor.sim.rechnet', { modus: mode.name });
      const r = el('tr'); let e;
      try { e = await rechne(id, holeBild(mode)); } catch (err) { e = { image: null, erkannt: null, quality: 0 }; }
      const ok = e.image && e.fehler < 25;
      r.append(el('td', '', mode.name), el('td', 'mono', `${zahl(imageSeconds(mode) + preambleSeconds(), 0)} s`), el('td', 'mono', e.image ? `${zahl(e.fehler, 1)}` : '–'), el('td', 'mono', `${Math.round((e.quality ?? 0) * 100)} %`),
        el('td', '', t(ok ? 'labor.sim.v.gut' : e.image ? 'labor.sim.v.maessig' : 'labor.sim.v.verloren')));
      tb.append(r);
    }
    sStatus.textContent = t('labor.sim.vergleich.fertig', { snr: snrWert() === null ? t('labor.sim.ohne') : `${snr.value} dB`, versatz: vorz(Number(versatz.value), 0), takt: vorz(Number(takt.value), 0) });
    sperre(false);
  }

  // ---------------------------------------------------------------- Ereignisse
  bMic.addEventListener('click', () => (M.ctx ? micStopp() : micStart()));
  bTon.addEventListener('click', () => (T.ctx ? tonStopp() : tonStart()));
  eingang.addEventListener('input', () => { setzeEinstellung('eingangDb', Number(eingang.value)); if (M.gain) M.gain.gain.value = 10 ** (Number(eingang.value) / 20); zeichneAudio(); });
  tonPegel.addEventListener('input', () => { if (T.gain) T.gain.gain.value = Number(tonPegel.value) / 100; zeichneAudio(); });
  pReset.addEventListener('click', () => { M.spitze = 0; M.clips = 0; M.rmsListe = []; zeichnePegel(); });
  soll.addEventListener('change', () => { zuletzt.spitze = null; zeichneAbstimmung(); });
  bUebernehmen.addEventListener('click', () => {
    if (M.taktPpm === null || M.taktPpm === undefined) return;
    setzeEinstellung('taktPpm', Math.max(-2000, Math.min(2000, M.taktPpm)));
    uText.textContent = t('labor.takt.uebernommen', { ppm: vorz(Number(einstellung('taktPpm')), 0) });
  });
  bTakt.addEventListener('click', () => {
    if (!M.ctx) return;
    M.takt = M.takt ? null : new Taktmesser(M.ctx.sampleRate);
    zeichneTakt();
  });
  for (const r of [snr, versatz, takt]) r.addEventListener('input', zeichneSimRegler);
  bSim.addEventListener('click', simuliere);
  bAlle.addEventListener('click', vergleicheAlle);
  bEigen.addEventListener('click', () => eigenDatei.click());
  eigenDatei.addEventListener('change', async () => {
    const f = eigenDatei.files[0]; eigenDatei.value = '';
    if (!f) return;
    try { eigenesBild?.close?.(); eigenesBild = await createImageBitmap(f); } catch (e) { sStatus.textContent = t('senden.fehler.bild', { grund: e.message }); return; }
    zeichneSimRegler(); zeigeBild(cOrig, holeBild(modeSim()));
  });
  bTest.addEventListener('click', () => { eigenesBild?.close?.(); eigenesBild = null; zeichneSimRegler(); zeigeBild(cOrig, holeBild(modeSim())); });
  simModus.addEventListener('change', () => { zeigeBild(cOrig, holeBild(modeSim())); vergleich.hidden = true; bilder.hidden = false; });

  zeichneAudio(); zeichnePegel(); zeichneAbstimmung(); zeichneTakt(); zeichneSimRegler();
  zeigeBild(cOrig, holeBild(modeSim()));
  return { unmount() { micStopp(); tonStopp(); simWorker?.terminate(); eigenesBild?.close?.(); } };
}
