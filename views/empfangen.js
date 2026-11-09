// Bereich „Empfangen“: Mikrofon oder WAV-Datei -> Live-Decoder im Worker -> Bild, dazu Wasserfall und Pegelanzeige.
// Die Sitzung hängt am Modul, nicht an der Ansicht: Wer kurz in die Galerie schaut, verpasst nichts. Beim Zurückkommen
// wird einfach neu gezeichnet.
import { MODES } from '../src/modes.js';
import { signalabstand, bewerteSnr, pegelArt } from '../src/frequenzmessung.js';
import { rapportVorschlag, rapportText, S_VORGABE } from '../src/rapport.js';
import { rapportInfo, rapportFelder } from './rapportinfo.js';
import { decodeWav } from '../src/wav.js';
import { speichere, ergaenze } from '../src/galerie.js';
import { Rohschreiber, zuWavBytes } from '../src/abtasten.js';
import { dateiStempel } from '../src/zeit.js';
import { oeffneMikrofon } from '../src/audiogeraete.js';
import { setzeBeschaeftigt } from '../src/beschaeftigt.js';

const F_VON = 1000, F_BIS = 2500; // Wasserfall: gezeigter Frequenzbereich in Hz
const MARKEN = [1200, 1500, 1900, 2300];
const WF_BREITE = 450, WF_HOEHE = 90;

const S = {
  worker: null, ctx: null, stream: null, node: null, analyser: null, quelle: null, // Quelle: null | 'mikrofon' | 'tab' (Ton eines Browser-Tabs, D63) | 'datei'
  pegelAnz: 0, gain: null, herkunft: 'mikrofon', vis: null, gespeichert: false, kennung: null, speicherung: null, startet: false, blind: false, versatz: null, snr: null, snrTakt: 0, rapport: null, rauschDb: null, rapportS: null, imBild: false, bodenAkt: undefined, bodenRing: [], bodenTakt: 0, boden: undefined, roh: null, rohTimer: 0,  letztes: null, status: { schluessel: 'empfangen.status.bereit', args: {} }, pegel: null, fehler: '', wake: null, ui: null, wfTimer: 0,
};

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

// ------------------------------------------------------------------ Sitzung
function holeWorker() {
  if (S.worker) return S.worker;
  S.worker = new Worker(new URL('../src/live-worker.js', import.meta.url), { type: 'module' });
  S.worker.onmessage = (e) => beiEreignis(e.data);
  S.worker.onerror = (e) => { S.fehler = e.message || 'Worker'; zeichneAlles(); };
  return S.worker;
}

const farbraumWahl = (einstellung) => (einstellung('helligkeit') === 'kompatibel' ? 'voll' : 'studio'); // gilt ab dem nächsten Start

/** Läuft ein Live-Eingang? Quelle ist das Mikrofon oder der Ton eines Browser-Tabs (WebSDR, D63); beide gehen durch dieselbe Kette. */
const imLive = () => S.quelle === 'mikrofon' || S.quelle === 'tab';
/** Quelle setzen und der App melden, ob etwas läuft (eine neue Fassung lädt die Seite dann erst später neu). */
function setzeQuelle(q) { S.quelle = q; setzeBeschaeftigt('empfang', q !== null); }

function setzeStatus(schluessel, args = {}) { S.status = { schluessel, args }; if (S.ui) S.ui.zeichneStatus(); }

function beiEreignis(m) {
  if (m.type === 'start') {
    schliesseRoh(); // eine noch laufende Aufnahme des vorigen Bildes zuerst abschließen, solange S.speicherung noch auf dessen Eintrag zeigt
    S.imBild = true; // das Bild füllt das Band: Das Grundrauschen darf jetzt nicht mehr nachgeführt werden
    if (S.roh) S.roh.beginne(m.t);
    S.letztes = null; S.rapportR = S.rapportS = S.rapportV = null; S.vis = m.vis; S.blind = !!m.blind; S.gespeichert = false; S.kennung = null; S.speicherung = null; S.versatz = m.offsetHz ?? null; S.rapport = null;
    if (S.ui) S.ui.zeichneSignal();
    setzeStatus('empfangen.status.empfang', { modus: MODES[m.modeId].name, zeile: 0, hoehe: MODES[m.modeId].height });
  } else if (m.type === 'bild') {
    S.letztes = m;
    if (m.final) { S.rapport = rapportVorschlag(m); S.imBild = false; if (S.rapport) { S.rapportR = S.rapport.r; S.rapportV = S.rapport.v; S.rapportS = S_VORGABE; } } // R und V aus dem Bild, S mit 9 vorbelegt; das alles vor dem Speichern, damit der Vorschlag mit in die Galerie wandert
    if (typeof m.offsetHz === 'number') { S.versatz = m.offsetHz; if (S.ui) S.ui.zeichneSignal(); }
    const mode = MODES[m.modeId];
    if (m.final) { try { speichereInGalerie(m, mode); } catch (err) { S.fehler = String(err.message ?? err); } } // Speicherfehler dürfen die Anzeige nie blockieren
    // Die Kennung folgt noch auf das Bild: Die Rohaufnahme läuft noch ein paar Sekunden weiter (bei einer Datei gibt es keine)
    if (m.final && S.roh) { clearTimeout(S.rohTimer); S.rohTimer = setTimeout(schliesseRoh, imLive() ? 4000 : 0); }
    if (m.final) setzeStatus(m.partial ? 'empfangen.status.teil' : 'empfangen.status.fertig', { modus: mode.name, zeilen: m.validLines, hoehe: mode.height });
    else setzeStatus('empfangen.status.empfang', { modus: mode.name, zeile: m.validLines, hoehe: mode.height });
    if (S.ui) S.ui.zeichneBild();
  } else if (m.type === 'kennung') {
    S.kennung = { call: m.call, ok: m.checksumOk };
    // Rufzeichen zum gespeicherten Bild nachtragen (nur mit gültiger Prüfsumme)
    if (m.checksumOk) S.speicherung?.then((satz) => satz && ergaenze(satz.id, { call: m.call })).catch(() => {});
    if (S.ui) S.ui.zeichneStatus();
  } else if (m.type === 'verworfen') {
    S.roh?.beende(); // Aufnahme eines verworfenen Treffers heben wir nicht auf
    S.imBild = false;
    S.letztes = null;
    setzeStatus('empfangen.status.verworfen', { modus: MODES[m.modeId].name });
    if (S.ui) S.ui.zeichneBild();
  } else if (m.type === 'fertig') {
    S.imBild = false;
    if (S.quelle === 'datei') { setzeQuelle(null); setzeStatus(S.letztes ? S.status.schluessel : 'empfangen.status.dateiende', S.status.args); zeichneAlles(); }
  }
}

// Fertige und abgebrochene Bilder landen automatisch in der Galerie (D7), solange das nicht abgeschaltet ist.
function speichereInGalerie(m, mode) {
  if (!S.einstellung || S.einstellung('galerieAuto') !== 'an') return;
  S.speicherung = speichere({ t: Date.now(), modeId: m.modeId, vis: S.vis, validLines: m.validLines, height: mode.height, width: mode.width, quality: m.quality, partial: !!m.partial, quelle: S.herkunft, ...(m.blind ? { blind: true } : {}), ...(S.rapport ? { rapportR: S.rapportR, rapportS: S.rapportS, rapportV: S.rapportV } : {}) }, m.image);
  S.speicherung
    .then(() => { S.gespeichert = true; if (S.ui) S.ui.zeichneStatus(); })
    .catch((err) => { S.speicherung = null; S.fehler = S.t('empfangen.fehler.galerie', { grund: err.message }); zeichneAlles(); });
}

/** Die laufende Rohaufnahme beenden und, wenn das Bild gespeichert ist, als WAV an den Galerie-Eintrag hängen. */
function schliesseRoh() {
  clearTimeout(S.rohTimer);
  const samples = S.roh?.beende();
  if (!samples || !S.speicherung) return;
  const blob = new Blob([zuWavBytes(samples, S.roh.rate)], { type: 'audio/wav' });
  S.speicherung.then((satz) => satz && ergaenze(satz.id, { roh: blob, bytes: (satz.bytes ?? 0) + blob.size })).catch(() => {});
}

function zeichneAlles() { if (S.ui) S.ui.zeichneAlles(); }

async function sperreBildschirm(an) {
  try {
    if (an && navigator.wakeLock && !S.wake) {
      S.wake = await navigator.wakeLock.request('screen');
      S.wake.addEventListener('release', () => { S.wake = null; });
    } else if (!an && S.wake) { await S.wake.release(); S.wake = null; }
  } catch { /* nicht überall erlaubt */ }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && imLive()) sperreBildschirm(true); });

const mikrofonStart = (t, eingangDb, einstellung) => eingangStart('mikrofon', () => oeffneMikrofon(einstellung('audioEingang')), t, eingangDb, einstellung);

/** Ton eines Browser-Tabs als Quelle (Seite „WebSDR“, D63). Chrome verlangt Video mit; die Videospur wird sofort gestoppt. Nur Desktop-Chrome und Edge. */
export const tabMoeglich = () => !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
export function tabStart(t, einstellung) {
  S.t = t; S.einstellung = einstellung;
  if (imLive()) mikrofonStopp(); // eine Quelle zur Zeit
  return eingangStart('tab', async () => {
    // Filter aus wie beim Mikrofon; suppressLocalAudioPlayback verhindert, dass man den Ton des Tabs doppelt hört
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true, selfBrowserSurface: 'exclude', systemAudio: 'exclude',
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
    });
    stream.getVideoTracks().forEach((tr) => { tr.stop(); stream.removeTrack(tr); });
    if (!stream.getAudioTracks().length) { stream.getTracks().forEach((tr) => tr.stop()); throw new Error(t('empfangen.fehler.tab.keinton')); }
    return { stream };
  }, t, Number(einstellung('eingangDb')) || 0, einstellung);
}

async function eingangStart(art, oeffne, t, eingangDb, einstellung) {
  if (S.startet) return; // Doppeltipp, während der Browser noch nach der Erlaubnis fragt: kein zweiter Eingang
  S.startet = true;
  S.fehler = '';
  if (!(art === 'tab' ? navigator.mediaDevices?.getDisplayMedia : navigator.mediaDevices?.getUserMedia)) { S.startet = false; S.fehler = t('empfangen.fehler.https'); zeichneAlles(); return; }
  try {
    const mik = await oeffne(); // Mikrofon: Filter aus (Echo-Cancellation, Rauschunterdrückung und AGC verfälschen die Töne), gewähltes Gerät, sonst Standard
    S.stream = mik.stream;
    if (mik.abweichung) S.fehler = t('empfangen.hinweis.geraet');
    S.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    await S.ctx.audioWorklet.addModule(new URL('../src/aufnahme-worklet.js', import.meta.url));
    const quelle = S.ctx.createMediaStreamSource(S.stream);
    S.node = new AudioWorkletNode(S.ctx, 'sstv-aufnahme');
    S.analyser = S.ctx.createAnalyser();
    S.analyser.fftSize = 4096;
    S.analyser.smoothingTimeConstant = 0.2;
    S.analyser.minDecibels = -120; S.analyser.maxDecibels = -20; // 120 dB nach unten: leises Rauschen eines guten Eingangs liegt um -105 dB je Frequenzstelle
    const stumm = S.ctx.createGain(); stumm.gain.value = 0; // der Worklet-Knoten muss am Ausgang hängen, damit er läuft
    S.gain = S.ctx.createGain(); // Eingangsverstärkung in der App; wirkt hinter dem Mikrofon, kann Übersteuerung davor nicht rückgängig machen
    S.gain.gain.value = 10 ** (eingangDb / 20);
    quelle.connect(S.gain); S.gain.connect(S.node); S.gain.connect(S.analyser); S.node.connect(stumm).connect(S.ctx.destination);
    const w = holeWorker();
    w.postMessage({ type: 'init', fs: S.ctx.sampleRate, updateS: 1, farbraum: farbraumWahl(einstellung), blind: einstellung('ohneVis') !== 'aus' });
    S.node.port.onmessage = (e) => {
      const x = e.data;
      let p = 0; for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > p) p = a; }
      S.pegel = p;
      S.pegelAnz = Math.max(p, S.pegelAnz * 0.8); // Spitzenwert mit langsamem Abklingen (ruhigere Anzeige)
      if (S.ui) S.ui.zeichnePegel();
      S.roh?.push(x); // vorher: Der Puffer geht gleich an den Worker und ist danach leer
      w.postMessage({ type: 'audio', samples: x }, [x.buffer]);
    };
    setzeQuelle(art); S.herkunft = art;
    if (art === 'tab') S.stream.getAudioTracks()[0].addEventListener('ended', () => { if (S.quelle === 'tab') mikrofonStopp(); }); // Teilen im Browser beendet
    S.letztes = null; S.versatz = null; S.snr = null; S.rapport = null; S.rauschDb = null; S.rapportR = S.rapportS = S.rapportV = null;
    S.roh = einstellung('rohSpeichern') === 'an' ? new Rohschreiber(S.ctx.sampleRate) : null; // Rohaufnahme der Bilder, nur wenn in den Einstellungen an
    setzeStatus(art === 'tab' ? 'empfangen.status.hoertTab' : 'empfangen.status.hoert');
    sperreBildschirm(true);
    startWasserfall();
  } catch (e) {
    mikrofonAufraeumen();
    S.fehler = t(art === 'tab' ? 'empfangen.fehler.tab' : 'empfangen.fehler.mic', { grund: e.message || e.name });
  }
  S.startet = false;
  zeichneAlles();
}

function mikrofonAufraeumen() {
  clearInterval(S.wfTimer); S.wfTimer = 0;
  S.stream?.getTracks().forEach((tr) => tr.stop());
  S.ctx?.close().catch(() => {});
  S.stream = S.ctx = S.node = S.analyser = S.gain = null;
  S.pegel = null; S.pegelAnz = 0; S.boden = S.bodenAkt = undefined; S.bodenRing = []; S.bodenTakt = 0; S.rauschDb = null; S.snr = null;
  sperreBildschirm(false);
}

function mikrofonStopp() {
  mikrofonAufraeumen();
  S.worker?.postMessage({ type: 'ende' }); // angefangenes Bild als Teilbild abschließen
  setzeQuelle(null);
  if (!S.letztes) setzeStatus('empfangen.status.bereit');
  zeichneAlles();
}

async function dateiLaden(datei, t) {
  S.fehler = '';
  if (imLive()) mikrofonStopp();
  try {
    const wav = decodeWav(new Uint8Array(await datei.arrayBuffer()));
    const w = holeWorker();
    w.postMessage({ type: 'init', fs: wav.sampleRate, updateS: 2, farbraum: farbraumWahl(S.einstellung), blind: S.einstellung('ohneVis') !== 'aus' });
    setzeQuelle('datei'); S.herkunft = 'datei';
    S.letztes = null; S.versatz = null; S.snr = null; S.rapport = null; S.rauschDb = null; S.rapportR = S.rapportS = S.rapportV = null; S.roh = null;
    setzeStatus('empfangen.status.datei', { name: datei.name });
    zeichneAlles();
    const schritt = Math.round(wav.sampleRate); // 1 s je Nachricht
    for (let i = 0; i < wav.samples.length; i += schritt) {
      const stueck = wav.samples.slice(i, i + schritt);
      w.postMessage({ type: 'audio', samples: stueck }, [stueck.buffer]);
    }
    w.postMessage({ type: 'ende' });
  } catch (e) {
    setzeQuelle(null);
    S.fehler = t('empfangen.fehler.wav', { grund: e.message });
    zeichneAlles();
  }
}

// ------------------------------------------------------------------ Wasserfall
// Farbleiter von dunkel (Rauschen) über Blau und Türkis nach Gelb und Weiß (laut). a läuft von 0 bis 1.
const WF_STUFEN = [[0, [8, 10, 24]], [0.25, [24, 48, 150]], [0.5, [0, 176, 190]], [0.75, [250, 220, 40]], [1, [255, 255, 255]]];
function farbe(a) {
  const x = Math.max(0, Math.min(1, a));
  for (let i = 1; i < WF_STUFEN.length; i++) {
    const [b, fb] = WF_STUFEN[i], [von, fv] = WF_STUFEN[i - 1];
    if (x <= b) { const u = (x - von) / (b - von); return fv.map((c, k) => Math.round(c + (fb[k] - c) * u)); }
  }
  return WF_STUFEN.at(-1)[1];
}

/**
 * Grundrauschen im Wasserfallband (Median der Bins, in Bytes des Analysators) nachführen. Das Rauschen ist das Minimum der letzten 90 Sekunden
 * (ein Wert je Sekunde), nicht der aktuelle Wert: Ein SSTV-Bild verteilt seine Energie über das ganze Band, der Median wäre dann Signal.
 * Während eines Bildes (S.imBild) kommen keine neuen Werte dazu, so bleibt das Rauschen von vor dem Bild stehen. Ändert man den
 * Eingangsregler, fängt die Messung neu an.
 */
function nachfuehrenBoden(daten, fs) {
  const bin = fs / (2 * daten.length);
  const k0 = Math.floor(F_VON / bin), k1 = Math.ceil(F_BIS / bin);
  const sortiert = Array.from(daten.subarray(k0, k1 + 1)).sort((p, q) => p - q);
  const median = sortiert[sortiert.length >> 1];
  S.bodenAkt = S.bodenAkt === undefined ? median : 0.9 * S.bodenAkt + 0.1 * median;
  if (!S.imBild && ++S.bodenTakt % 16 === 0) { S.bodenRing.push(S.bodenAkt); if (S.bodenRing.length > 90) S.bodenRing.shift(); }
  S.boden = S.bodenRing.length ? Math.min(S.bodenAkt, ...S.bodenRing) : S.bodenAkt;
}

function startWasserfall() {
  clearInterval(S.wfTimer);
  const daten = new Uint8Array(S.analyser.frequencyBinCount);
  S.wfTimer = setInterval(() => {
    if (!S.analyser || !S.ui) return;
    S.analyser.getByteFrequencyData(daten);
    const fs = S.ctx.sampleRate, min = S.analyser.minDecibels, max = S.analyser.maxDecibels;
    nachfuehrenBoden(daten, fs);
    S.ui.wasserfallZeile(daten, fs);
    // Rauschabstand gegen das Grundrauschen, geglättet (Zeitkonstante etwa eine halbe Sekunde), nur etwa viermal je Sekunde anzeigen
    const bodenDb = min + (S.boden / 255) * (max - min);
    const a = signalabstand(daten, fs, min, max, { bodenDb });
    S.snr = S.snr === null ? a.snrDb : 0.9 * S.snr + 0.1 * a.snrDb;
    S.rauschDb = a.rauschDbfs;
    if (++S.snrTakt % 4 === 0) S.ui.zeichneSignal();
  }, 60);
}

// ------------------------------------------------------------------ Oberfläche
export default function mount(wurzel, { t, symbol, einstellung, setzeEinstellung }) {
  S.t = t; S.einstellung = einstellung; // für Meldungen und Einstellungen außerhalb der Ansicht (die Sitzung läuft weiter)

  // ---- Knöpfe und Gain in einer Reihe. Die Knöpfe bleiben auch auf schmalen Anzeigen nebeneinander (sie kürzen dort ihren Text, siehe
  //      .kurz und .lang in theme.css), der Gain-Regler rutscht dann darunter (flex-wrap).
  const leiste = el('div', 'aktionen leiste');
  const knoepfe = el('div', 'knoepfe');
  // Mikrofon-Schalter wie bei FT8-Horch: links Mikrofon durchgestrichen (aus), rechts Mikrofon (an)
  const knopfMic = el('button', 'schalter mik'); knopfMic.type = 'button'; knopfMic.setAttribute('role', 'switch');
  knopfMic.setAttribute('aria-label', t('empfangen.mic.schalter')); knopfMic.title = t('empfangen.mic.schalter');
  const spur = el('span', 'schalter-spur'); spur.setAttribute('aria-hidden', 'true'); spur.append(el('span', 'schalter-knopf'));
  const symAus = symbol('mic_off'); symAus.classList.add('sym-aus'); const symAn = symbol('mic'); symAn.classList.add('sym-an');
  knopfMic.append(symAus, spur, symAn);
  const knopfDatei = el('button', 'btn tonal'); knopfDatei.type = 'button';
  const eingabe = el('input'); eingabe.type = 'file'; eingabe.accept = 'audio/wav,audio/x-wav,.wav'; eingabe.hidden = true;
  const knopfPng = el('button', 'btn'); knopfPng.type = 'button';
  knoepfe.append(knopfMic, knopfDatei, knopfPng);
  /** Symbol und Beschriftung in zwei Längen; der volle Name bleibt für Screenreader im aria-label. */
  const setzeKnopf = (b, icon, kurz, lang) => {
    b.replaceChildren(symbol(icon), el('span', 'lang', t(lang)), el('span', 'kurz', t(kurz)));
    b.setAttribute('aria-label', t(lang));
  };
  const reglerBox = el('label', 'gain-zeile');
  const reglerText = el('span', 'label-lg', t('empfangen.verstaerkung'));
  const regler = el('input'); regler.type = 'range'; regler.min = '-20'; regler.max = '30'; regler.step = '1';
  regler.value = String(einstellung('eingangDb'));
  const reglerWert = el('span', 'label-lg gain-wert');
  const zeigeRegler = () => { const v = Number(regler.value); reglerWert.textContent = `${v > 0 ? '+' : ''}${v} dB`; };
  zeigeRegler();
  reglerBox.append(reglerText, regler, reglerWert);
  leiste.append(knoepfe, reglerBox, eingabe);

  const status = el('p', 'status status-fest'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const fehler = el('div', 'warnband'); fehler.setAttribute('role', 'alert');

  // ---- Eine Karte für Pegel, Messwerte, Hinweise und Wasserfall. Alles ist immer da (ohne Mikrofon mit „–“ und dunklem Wasserfall), damit die
  //      Seite nicht springt. Die Hinweise teilen sich eine Fläche mit fester Mindesthöhe.
  const signalKarte = el('div', 'card signalkarte');
  const pegelBox = el('div', 'pegel');
  const pegelBalken = el('div', 'pegel-balken'); const pegelFuell = el('div', 'pegel-fuell'); pegelBalken.append(pegelFuell);
  const pegelText = el('span', 'pegel-text label-lg', '–');
  pegelBox.append(el('span', 'hint', t('empfangen.pegel')), pegelBalken, pegelText);

  // Messwerte als kleine Tabelle in einer Zeile: Grundrauschen, SNR (Signal-Rausch-Abstand), Δf (Frequenzversatz). Die vollen Namen stehen im Tooltip
  const tabelle = el('table', 'signaltabelle');
  const kopfZeile = el('tr'), wertZeile = el('tr');
  const spalte = (kurz, lang) => {
    const th = el('th', '', kurz); th.scope = 'col'; th.title = lang;
    const wert = el('span', 'mono', '–'), wertung = el('small');
    const td = el('td'); td.append(wert, wertung);
    kopfZeile.append(th); wertZeile.append(td);
    return { wert, wertung };
  };
  const zGrund = spalte(t('empfangen.tab.grund'), t('empfangen.grund')), zSnr = spalte('SNR', t('empfangen.signal')), zDf = spalte('Δf', t('empfangen.versatz'));
  const thead = el('thead'); thead.append(kopfZeile); const tbody = el('tbody'); tbody.append(wertZeile);
  tabelle.append(thead, tbody);

  // ---- Wasserfall (auch ohne Mikrofon zu sehen, dann dunkel)
  const wf = el('div', 'wasserfall');
  const wfCanvas = el('canvas'); wfCanvas.width = WF_BREITE; wfCanvas.height = WF_HOEHE;
  wfCanvas.setAttribute('aria-hidden', 'true');
  const marken = el('div', 'wf-marken');
  for (const f of MARKEN) {
    const m = el('span', 'mono', String(f));
    m.style.left = `${((f - F_VON) / (F_BIS - F_VON)) * 100}%`;
    marken.append(m);
  }
  wf.append(wfCanvas, marken);
  const wfCtx = wfCanvas.getContext('2d');
  const wfLoeschen = () => { wfCtx.fillStyle = '#10131a'; wfCtx.fillRect(0, 0, WF_BREITE, WF_HOEHE); };
  wfLoeschen();
  // Schleier: Solange das Mikrofon aus ist, liegt ein Weichzeichner mit Transparenz über der Karte (der Wasserfall ist dann ohnehin leer)
  const schleier = el('div', 'schleier'); schleier.setAttribute('aria-hidden', 'true');
  signalKarte.append(pegelBox, tabelle, wf, schleier);

  // ---- Bild
  const bildBox = el('div', 'bildbox');
  const canvas = el('canvas', 'bild');
  canvas.width = 320; canvas.height = 240;
  canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', t('empfangen.bild'));
  canvas.tabIndex = 0;
  const leer = el('p', 'hint leer', t('empfangen.leer'));
  bildBox.append(canvas, leer);

  // ---- Rapportvorschlag: R, S und V als Auswahl, nach dem Empfang vorbelegt (R und V aus dem Bild, S mit 9). Eigene Zeile mit festem Info-Knopf
  //      (der Dialog darf beim Neuzeichnen nicht neu entstehen)
  const rapportBox = el('dl', 'werteliste rapport-zeile');
  const felder = rapportFelder({ t, beiAenderung: ({ r, s, v }) => {
    S.rapportR = r; S.rapportS = s; S.rapportV = v;
    // Die Änderung auch beim gespeicherten Bild nachtragen
    S.speicherung?.then((satz) => satz && ergaenze(satz.id, { rapportR: r, rapportS: s, rapportV: v })).catch(() => {});
    ui.zeichneSignal();
  } });
  const rapportDd = el('dd'); rapportDd.append(felder.box, rapportInfo({ t, symbol }));
  rapportBox.append(el('dt', '', t('empfangen.rapport')), rapportDd);
  const rapportHinweis = el('p', 'hint body-sm rapport-hinweis');

  wurzel.append(leiste, status, fehler, signalKarte, bildBox, rapportBox, rapportHinweis);

  const ctx2d = canvas.getContext('2d');

  const ui = {
    zeichneStatus() {
      const fertig = S.status.schluessel.endsWith('fertig') || S.status.schluessel.endsWith('teil');
      const blind = S.blind && (fertig || S.status.schluessel.endsWith('empfang')) ? ` ${t('empfangen.status.blind')}` : '';
      const kennung = S.kennung && fertig ? ` ${t(S.kennung.ok ? 'empfangen.status.kennung' : 'empfangen.status.kennung.unsicher', { call: S.kennung.call })}` : '';
      status.textContent = t(S.status.schluessel, S.status.args) + (S.gespeichert && fertig ? ` ${t('empfangen.status.gespeichert')}` : '') + kennung + blind;
    },
    zeichneBild() {
      const m = S.letztes;
      leer.hidden = !!m;
      canvas.style.visibility = m ? 'visible' : 'hidden';
      if (m) {
        const { width, height, data } = m.image;
        if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
        ctx2d.putImageData(new ImageData(data, width, height), 0, 0);
      }
      knopfPng.disabled = !m;
    },
    zeichnePegel() {
      if (S.pegel === null) { // ohne Mikrofon: leerer Balken
        pegelFuell.style.width = '0'; pegelBalken.dataset.art = ''; pegelText.textContent = '–';
        return;
      }
      const p = S.pegelAnz;
      const db = 20 * Math.log10(Math.max(p, 1e-5));
      pegelFuell.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
      const art = pegelArt(p);
      pegelBalken.dataset.art = art;
      pegelText.textContent = `${Math.round(db)} dB, ${t(`empfangen.pegel.${art}`)}`; // Farbe (grün, gelb, rot) und Wort sagen dasselbe
    },
    zeichneSignal() {
      const mik = imLive();
      if (mik && S.rauschDb !== null) {
        const db = Math.round(S.rauschDb);
        const art = db < -70 ? 'leise' : db < -55 ? 'normal' : 'laut';
        zGrund.wert.textContent = `${db} dBFS`; zGrund.wertung.textContent = t(`empfangen.grund.${art}`);
      } else { zGrund.wert.textContent = '–'; zGrund.wertung.textContent = ''; }
      if (mik && S.snr !== null) {
        const stufe = bewerteSnr(S.snr);
        zSnr.wert.textContent = stufe === 'kein' ? '–' : `${Math.round(S.snr)} dB`; zSnr.wertung.textContent = t(`empfangen.signal.${stufe}`);
      } else { zSnr.wert.textContent = '–'; zSnr.wertung.textContent = ''; }
      if (S.versatz !== null && (S.quelle || S.letztes)) { // bleibt nach Dateiende oder Stopp als Wert des letzten Bildes stehen
        const v = Math.round(S.versatz);
        zDf.wert.textContent = `${v > 0 ? '+' : ''}${v} Hz`;
        zDf.wertung.textContent = Math.abs(v) > 40 ? t('empfangen.versatz.gross') : '';
      } else { zDf.wert.textContent = '–'; zDf.wertung.textContent = ''; }
      const rv = S.rapport;
      felder.sperre(!rv);
      felder.setze(S.rapportR, S.rapportS, S.rapportV);
      rapportHinweis.textContent = rv ? t('empfangen.rapport.hinweis', { rsv: rapportText(S.rapportR, S.rapportS, S.rapportV) }) : '';
    },
    wasserfallZeile(daten, fs) {
      wfCtx.drawImage(wfCanvas, 0, 1);
      const zeile = wfCtx.createImageData(WF_BREITE, 1);
      const bin = fs / (2 * daten.length);
      // Die Skala hängt am Grundrauschen (siehe nachfuehrenBoden), nicht am lautesten Wert: Rauschen bleibt dunkel, Töne darüber leuchten.
      // Der Bezug auf den lautesten Wert ließ jedes Rauschen ohne Signal als hell und bunt erscheinen. Bytes: 255 = 80 dB, also reichen
      // 150 Stufen etwa 47 dB über das Grundrauschen, das selbst knapp über Schwarz liegt.
      for (let x = 0; x < WF_BREITE; x++) {
        const f = F_VON + ((x + 0.5) / WF_BREITE) * (F_BIS - F_VON);
        const k = Math.round(f / bin);
        const [r, g, b] = farbe(((daten[k] ?? 0) - S.boden + 20) / 150);
        zeile.data[x * 4] = r; zeile.data[x * 4 + 1] = g; zeile.data[x * 4 + 2] = b; zeile.data[x * 4 + 3] = 255;
      }
      wfCtx.putImageData(zeile, 0, 0);
    },
    zeichneAlles() {
      const mik = imLive(), datei = S.quelle === 'datei';
      knopfMic.setAttribute('aria-checked', String(mik));
      const schalterText = t(S.quelle === 'tab' ? 'empfangen.mic.schalter.tab' : 'empfangen.mic.schalter'); // bei Tab-Ton: Der Schalter beendet den Tab-Empfang
      knopfMic.setAttribute('aria-label', schalterText); knopfMic.title = schalterText;
      knopfMic.disabled = datei;
      regler.disabled = !mik; // ohne Mikrofon wirkungslos; ausblenden würde die Seite springen lassen
      signalKarte.classList.toggle('inaktiv', !mik);
      setzeKnopf(knopfDatei, 'upload', 'empfangen.datei.kurz', 'empfangen.datei');
      knopfDatei.disabled = datei;
      setzeKnopf(knopfPng, 'download', 'empfangen.speichern.kurz', 'empfangen.speichern');
      fehler.textContent = S.fehler;
      if (!mik) wfLoeschen(); // ohne Mikrofon steht kein altes Bild im Wasserfall
      ui.zeichneSignal();
      ui.zeichnePegel();
      ui.zeichneStatus();
      ui.zeichneBild();
    },
  };

  knopfMic.addEventListener('click', () => (imLive() ? mikrofonStopp() : mikrofonStart(t, Number(regler.value), einstellung)));
  regler.addEventListener('input', () => {
    zeigeRegler();
    setzeEinstellung('eingangDb', Number(regler.value));
    if (S.gain) S.gain.gain.value = 10 ** (Number(regler.value) / 20);
    S.bodenRing = []; S.bodenTakt = 0; // anderer Pegel, andere Rauschwerte: neu messen
  });
  knopfDatei.addEventListener('click', () => eingabe.click());
  eingabe.addEventListener('change', () => { const f = eingabe.files[0]; eingabe.value = ''; if (f) dateiLaden(f, t); });
  knopfPng.addEventListener('click', () => {
    if (!S.letztes) return;
    const name = `sstv_${S.letztes.modeId}_${dateiStempel(Date.now(), einstellung('zeitanzeige'))}.png`;
    canvas.toBlob((blob) => {
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    }, 'image/png');
  });
  const vollbild = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (S.letztes) bildBox.requestFullscreen?.().catch(() => {});
  };
  bildBox.addEventListener('click', vollbild);
  canvas.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); vollbild(); } });

  S.ui = ui;
  ui.zeichneAlles();
  return { unmount() { if (document.fullscreenElement) document.exitFullscreen(); S.ui = null; } };
}

/** Für die Seite „WebSDR“: Welche Quelle läuft, und was hat der letzte Startversuch gemeldet? */
export const aktuelleQuelle = () => S.quelle;
export const letzterFehler = () => S.fehler;
