// Einstellungen: eigene Station (Rufzeichen, Locator, Standardtext), Empfang, Audiogeräte, Darstellung und Sprache, Installation.
import { installZustand, beiInstallAenderung, installieren } from '../install.js';
import { pruefeLocator, pruefeRufzeichen, locatorAusPosition } from '../src/station.js';
import { normalisiereZeitmodus } from '../src/zeit.js';
import { geraeteListe, ausgangWaehlbar, listeGeraete, entsperreGeraetenamen } from '../src/audiogeraete.js';

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

// Akkordeon (D61): Es ist immer nur ein Abschnitt offen. Unter der Überschrift steht zugeklappt eine Kurzzeile mit dem aktuellen Stand.
// Der zuletzt geöffnete Abschnitt wird auf diesem Gerät gemerkt (localStorage, nur als Bequemlichkeit).
const MERKEN = 'sstv-einst-offen';
const gemerkt = () => { try { return localStorage.getItem(MERKEN); } catch { return null; } };
const merke = (id) => { try { localStorage.setItem(MERKEN, id); } catch { /* ohne Speicher bleibt es beim Standard */ } };

/** Gibt den Inhaltsbereich zurück; details (das Element für die Seite) und zeigeKurz() hängen daran. kurz: () => Text oder ''. */
function karte(id, titelSchluessel, t, kurz = null) {
  const d = el('details', 'akk'); d.dataset.abschnitt = id;
  const sum = el('summary');
  const text = el('span', 'akk-text');
  const kurzZeile = el('span', 'akk-kurz');
  text.append(el('span', 'akk-titel', t(titelSchluessel)), kurzZeile);
  sum.append(text);
  const inhalt = el('div', 'akk-inhalt');
  d.append(sum, inhalt);
  inhalt.details = d;
  inhalt.zeigeKurz = () => { kurzZeile.textContent = kurz ? kurz() : ''; kurzZeile.hidden = !kurzZeile.textContent; };
  inhalt.zeigeKurz();
  return inhalt;
}

/** Auswahlfeld (select) mit Beschriftung. optionen: [[wert, text], ...] */
function auswahlFeld(beschriftung, optionen, aktuell, beiWahl, hinweis = '') {
  const box = el('div', 'feldgruppe');
  const l = el('label', 'feld');
  const s = el('select');
  for (const [wert, text] of optionen) { const o = el('option', '', text); o.value = wert; s.append(o); }
  s.value = aktuell;
  s.addEventListener('change', () => beiWahl(s.value));
  l.append(el('span', '', beschriftung), s);
  box.append(l);
  if (hinweis) box.append(el('p', 'hint body-sm', hinweis));
  box.select = s;
  return box;
}

/** Textfeld mit Beschriftung, Hinweis und Warnzeile. pruefe(text) -> { ok, wert }. Gespeichert wird beim Tippen, die Schreibweise beim Verlassen. */
function textFeld({ beschriftung, wert, hinweis, warnung, pruefe, speichere, optionen = {}, knopf = null, falt = null }) {
  const box = el('div', 'feldgruppe');
  const l = el('label', 'feld');
  const i = el('input'); i.type = 'text'; i.value = wert; i.autocomplete = 'off'; i.spellcheck = false;
  if (optionen.grossbuchstaben) i.autocapitalize = 'characters';
  if (optionen.anzeigeGross) i.classList.add('gross'); // nur die Anzeige, gespeichert wird ohnehin groß
  if (optionen.maxlaenge) i.maxLength = optionen.maxlaenge;
  l.append(el('span', '', beschriftung), i);
  const info = falt ? falt.absatz : el('p', 'hint body-sm', hinweis);
  const meldung = el('p', 'status body-sm'); meldung.setAttribute('role', 'status'); meldung.setAttribute('aria-live', 'polite');
  const warn = el('div', 'warnband'); warn.setAttribute('role', 'status');
  const pruefen = () => { const r = pruefe ? pruefe(i.value) : { ok: true, wert: i.value }; warn.textContent = r.ok ? '' : warnung; return r; };
  i.addEventListener('input', () => { const r = pruefen(); speichere(pruefe ? r.wert : i.value); });
  i.addEventListener('change', () => { const r = pruefen(); if (r.ok && pruefe) { i.value = r.wert; speichere(r.wert); } });
  pruefen();
  if (knopf || falt) {
    const zeile = el('div', 'feld-zeile');
    const b = knopf ? el('button', 'btn tonal', knopf.text) : null;
    if (b) { b.type = 'button'; if (knopf.titel) b.title = b.ariaLabel = knopf.titel; }
    if (b) b.addEventListener('click', () => knopf.beiKlick({
      setze: (neu) => { i.value = neu; const r = pruefen(); speichere(pruefe ? r.wert : neu); },
      melde: (text) => { meldung.textContent = text; },
      sperre: (an) => { b.disabled = an; },
    }));
    zeile.append(l); if (b) zeile.append(b); if (falt) zeile.append(falt.knopf);
    box.append(zeile);
  } else box.append(l);
  box.append(info, meldung, warn);
  return box;
}

export default function mount(wurzel, { t, einstellung, setzeEinstellung, symbol }) {
  /** Langer Hinweis hinter einem (i): Der Absatz ist zu, der Knopf klappt ihn auf und zu. Spart Platz, besonders am Handy. */
  const faltHinweis = (text) => {
    const absatz = el('p', 'hint body-sm', text); absatz.hidden = true;
    const knopf = el('button', 'icon-btn'); knopf.type = 'button'; knopf.append(symbol('info'));
    knopf.setAttribute('aria-label', t('settings.hinweis.knopf')); knopf.title = t('settings.hinweis.knopf'); knopf.setAttribute('aria-expanded', 'false');
    knopf.addEventListener('click', () => { absatz.hidden = !absatz.hidden; knopf.setAttribute('aria-expanded', String(!absatz.hidden)); });
    return { absatz, knopf };
  };
  /** Schalter mit (i) in einer Zeile, der Hinweis klappt darunter auf. */
  const schalterMitHinweis = (schalter, text) => {
    const h = faltHinweis(text); const zeile = el('div', 'schalter-zeile'); zeile.append(schalter, h.knopf);
    return [zeile, h.absatz];
  };

  // Locator aus der aktuellen Position des Geräts. Die Position wird nur für die Rechnung benutzt, gespeichert wird nur der Locator.
  const ausStandort = ({ setze, melde, sperre }) => {
    if (!navigator.geolocation) { melde(t('settings.locator.fehler.0')); return; }
    melde(t('settings.locator.suche')); sperre(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        sperre(false);
        try {
          const loc = locatorAusPosition(pos.coords.latitude, pos.coords.longitude, 6);
          setze(loc);
          melde(t('settings.locator.fertig', { loc, genau: Math.round(pos.coords.accuracy) }));
        } catch (err) { melde(t('settings.locator.fehler.2')); }
      },
      (err) => { sperre(false); melde(t(`settings.locator.fehler.${[1, 2, 3].includes(err.code) ? err.code : 2}`)); },
      { enableHighAccuracy: false, timeout: 20000, maximumAge: 120000 },
    );
  };

  const station = karte('station', 'settings.station', t, () => [einstellung('call'), einstellung('locator')].filter(Boolean).join(' · ') || t('settings.kurz.leer'));
  station.append(
    textFeld({ beschriftung: t('settings.call'), wert: einstellung('call'), hinweis: t('settings.call.hinweis'), warnung: t('settings.call.warn'),
      pruefe: pruefeRufzeichen, speichere: (v) => setzeEinstellung('call', v), optionen: { grossbuchstaben: true, anzeigeGross: true, maxlaenge: 12 } }),
    textFeld({ beschriftung: t('settings.locator'), wert: einstellung('locator'), hinweis: t('settings.locator.hinweis'), warnung: t('settings.locator.warn'),
      pruefe: pruefeLocator, speichere: (v) => setzeEinstellung('locator', v), optionen: { grossbuchstaben: true, maxlaenge: 8 },
      knopf: { text: t('settings.locator.standort'), titel: t('settings.locator.standort.lang'), beiKlick: ausStandort } }),
  );

  const empfang = karte('empfang', 'settings.empfang', t, () => t('settings.kurz.empfang', { a: t(einstellung('galerieAuto') === 'an' ? 'settings.kurz.an' : 'settings.kurz.aus'), v: t(einstellung('ohneVis') !== 'aus' ? 'settings.kurz.an' : 'settings.kurz.aus') }));
  const auto = el('input'); auto.type = 'checkbox'; auto.checked = einstellung('galerieAuto') === 'an';
  auto.addEventListener('change', () => setzeEinstellung('galerieAuto', auto.checked ? 'an' : 'aus'));
  const autoFeld = el('label', 'schalter'); autoFeld.append(auto, document.createTextNode(t('settings.autospeichern')));
  empfang.append(autoFeld, el('p', 'hint body-sm', t('settings.autospeichern.hinweis')));
  const blindSchalter = el('input'); blindSchalter.type = 'checkbox'; blindSchalter.checked = einstellung('ohneVis') !== 'aus';
  blindSchalter.addEventListener('change', () => setzeEinstellung('ohneVis', blindSchalter.checked ? 'an' : 'aus'));
  const blindFeld = el('label', 'schalter'); blindFeld.append(blindSchalter, document.createTextNode(t('settings.ohnevis')));
  empfang.append(...schalterMitHinweis(blindFeld, t('settings.ohnevis.hinweis')));
  const rohSchalter = el('input'); rohSchalter.type = 'checkbox'; rohSchalter.checked = einstellung('rohSpeichern') === 'an';
  rohSchalter.addEventListener('change', () => setzeEinstellung('rohSpeichern', rohSchalter.checked ? 'an' : 'aus'));
  const rohFeld = el('label', 'schalter'); rohFeld.append(rohSchalter, document.createTextNode(t('settings.roh')));
  empfang.append(...schalterMitHinweis(rohFeld, t('settings.roh.hinweis')));
  const hell = el('input'); hell.type = 'checkbox'; hell.checked = einstellung('helligkeit') === 'kompatibel';
  hell.addEventListener('change', () => setzeEinstellung('helligkeit', hell.checked ? 'kompatibel' : 'studio'));
  const hellFeld = el('label', 'schalter'); hellFeld.append(hell, document.createTextNode(t('settings.helligkeit')));
  empfang.append(...schalterMitHinweis(hellFeld, t('settings.helligkeit.hinweis')));

  const senden = karte('senden', 'settings.senden', t, () => t('settings.kurz.senden', { n: einstellung('taktPpm') || 0 }));
  senden.append(textFeld({
    falt: faltHinweis(t('settings.taktppm.hinweis')), beschriftung: t('settings.taktppm'), wert: String(einstellung('taktPpm') || 0), hinweis: t('settings.taktppm.hinweis'), warnung: t('settings.taktppm.warnung'),
    pruefe: (v) => { const s = String(v).trim().replace('−', '-'); if (s === '') return { ok: true, wert: '0' }; const n = Number(s); return { ok: Number.isInteger(n) && Math.abs(n) <= 2000, wert: s }; },
    speichere: (v) => { const n = Number(String(v).replace('−', '-')); if (Number.isInteger(n) && Math.abs(n) <= 2000) setzeEinstellung('taktPpm', n); },
  }));

  const darst = karte('darstellung', 'settings.darstellung', t, () => [{ '': t('settings.language.auto'), de: 'Deutsch', en: 'English' }[einstellung('lang') ?? ''] ?? '', t(`settings.theme.${einstellung('theme') ?? 'auto'}`), t(`settings.zeit.${normalisiereZeitmodus(einstellung('zeitanzeige'))}`)].filter(Boolean).join(' · '));
  darst.append(
    auswahlFeld(t('settings.language'), [['', t('settings.language.auto')], ['de', 'Deutsch'], ['en', 'English']], einstellung('lang'), (w) => setzeEinstellung('lang', w)),
    auswahlFeld(t('settings.theme'), ['auto', 'light', 'dark'].map((w) => [w, t(`settings.theme.${w}`)]), einstellung('theme'), (w) => setzeEinstellung('theme', w)),
    auswahlFeld(t('settings.zeit'), [['lokal', t('settings.zeit.lokal')], ['utc', t('settings.zeit.utc')]], normalisiereZeitmodus(einstellung('zeitanzeige')), (w) => setzeEinstellung('zeitanzeige', w), t('settings.zeit.hinweis')),
  );

  // ---- Audiogeräte: Eingang und Ausgang wählen (leer = Standardgerät des Systems)
  let eingang; // wird unten gesetzt; die Kurzzeile braucht es erst danach
  const audio = karte('audio', 'settings.audio', t, () => t('settings.kurz.audio', { geraet: eingang?.select.selectedOptions[0]?.text || t('settings.audio.standard') }));
  eingang = auswahlFeld(t('settings.audio.eingang'), [['', t('settings.audio.standard')]], '', (w) => setzeEinstellung('audioEingang', w));
  const ausgang = auswahlFeld(t('settings.audio.ausgang'), [['', t('settings.audio.standard')]], '', (w) => setzeEinstellung('audioAusgang', w));
  const freigabe = el('div', 'feldgruppe');
  const freigabeText = el('p', 'hint body-sm', t('settings.audio.entsperren.hinweis'));
  const freigabeKnopf = el('button', 'btn tonal', t('settings.audio.entsperren')); freigabeKnopf.type = 'button';
  const freigabeFehler = el('div', 'warnband'); freigabeFehler.setAttribute('role', 'alert');
  const freigabeAkt = el('div', 'aktionen'); freigabeAkt.append(freigabeKnopf);
  freigabe.append(freigabeText, freigabeAkt, freigabeFehler);
  const ausgangNein = el('p', 'hint body-sm', t('settings.audio.ausgang.nein')); ausgangNein.hidden = ausgangWaehlbar();
  audio.append(eingang, ausgang, ausgangNein, freigabe, el('p', 'hint body-sm', t('settings.audio.hinweis')));
  const fuelle = (select, liste, gespeichert) => {
    select.replaceChildren();
    const standard = el('option', '', t('settings.audio.standard')); standard.value = ''; select.append(standard);
    for (const g of liste) { const o = el('option', '', g.label); o.value = g.id; select.append(o); }
    if (gespeichert && !liste.some((g) => g.id === gespeichert)) { const o = el('option', '', t('settings.audio.fehlt')); o.value = gespeichert; select.append(o); }
    select.value = gespeichert;
  };
  const aktualisiereGeraete = async () => {
    let geraete = [];
    try { geraete = await listeGeraete(); } catch { /* ohne Zugriff bleibt die Liste leer */ }
    const ein = geraeteListe(geraete, 'audioinput', t('settings.audio.mikro'));
    const aus = geraeteListe(geraete, 'audiooutput', t('settings.audio.ausgabe'));
    fuelle(eingang.select, ein, einstellung('audioEingang'));
    fuelle(ausgang.select, aus, einstellung('audioAusgang'));
    ausgang.select.disabled = !ausgangWaehlbar();
    audio.zeigeKurz();
    freigabe.hidden = ein.length > 0 && !ein.some((g) => g.ohneName); // Namen erscheinen erst nach der Mikrofonerlaubnis
  };
  freigabeKnopf.addEventListener('click', async () => {
    freigabeFehler.textContent = '';
    try { await entsperreGeraetenamen(); } catch (err) { freigabeFehler.textContent = t('settings.audio.entsperren.fehler', { grund: err.message || err.name }); }
    aktualisiereGeraete();
  });
  navigator.mediaDevices?.addEventListener?.('devicechange', aktualisiereGeraete);
  aktualisiereGeraete();

  const inst = karte('install', 'install.title', t);
  const text = el('p', 'hint');
  const knopf = el('button', 'btn tonal', t('install.button'));
  knopf.type = 'button';
  knopf.addEventListener('click', installieren);
  const aktionen = el('div', 'aktionen'); aktionen.append(knopf);
  inst.append(text, aktionen);
  const zeichne = () => { const z = installZustand(); text.textContent = t(`install.state.${z}`); knopf.hidden = z !== 'knopf'; aktionen.hidden = z !== 'knopf'; };
  zeichne();
  const ab = beiInstallAenderung(zeichne);

  const alle = [station, empfang, senden, audio, darst, inst];
  wurzel.append(...alle.map((a) => a.details));
  // Nur ein Abschnitt gleichzeitig offen; beim ersten Besuch „Meine Station“, danach der zuletzt benutzte
  const start = alle.find((a) => a.details.dataset.abschnitt === gemerkt()) ?? station;
  start.details.open = true;
  for (const a of alle) {
    a.details.addEventListener('toggle', () => {
      if (!a.details.open) return;
      merke(a.details.dataset.abschnitt);
      for (const b of alle) if (b !== a) b.details.open = false;
    });
  }
  // Kurzzeilen nachziehen, sobald sich ein Wert ändert (die Eingabefelder speichern vor dem Hochsprudeln des Ereignisses)
  const kurzNeu = () => { for (const a of alle) a.zeigeKurz(); };
  wurzel.addEventListener('input', kurzNeu); wurzel.addEventListener('change', kurzNeu);
  return { unmount() { ab(); navigator.mediaDevices?.removeEventListener?.('devicechange', aktualisiereGeraete); } };
}
