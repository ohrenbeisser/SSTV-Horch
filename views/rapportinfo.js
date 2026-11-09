// Info-Knopf (i) mit Dialog zum RSV-Rapport: was R, S und V bedeuten, Beispiele und wie die App ihren Vorschlag rechnet.
// Die Stufentexte stammen sinngemäß aus dem Artikel „SSTV – Fernsehen im Schneckentempo“. Das Element wird einmal gebaut und weiterverwendet:
// Nimmt man einen offenen Dialog aus dem Dokument, ist er zu, deshalb darf die Ansicht ihn beim Neuzeichnen nicht neu anlegen.

const el = (tag, klasse, text) => { const e = document.createElement(tag); if (klasse) e.className = klasse; if (text !== undefined) e.textContent = text; return e; };

/** Gibt ein <span> mit dem Knopf und dem Dialog zurück. t und symbol kommen aus der Ansicht. */
export function rapportInfo({ t, symbol }) {
  const box = el('span', 'info-box');
  const knopf = el('button', 'icon-btn'); knopf.type = 'button';
  knopf.setAttribute('aria-label', t('rapport.info.knopf')); knopf.title = t('rapport.info.knopf');
  knopf.append(symbol('info'));

  const dialog = el('dialog', 'info-dialog');
  dialog.setAttribute('aria-label', t('rapport.info.titel'));
  const liste = (schluessel, stufen) => {
    const ul = el('ul', 'info-liste');
    for (const n of stufen) ul.append(el('li', '', t(`rapport.info.${schluessel}.${n}`)));
    return ul;
  };
  const zu = el('button', 'btn tonal', t('rapport.info.schliessen')); zu.type = 'button';
  const akt = el('div', 'aktionen'); akt.append(zu);
  dialog.append(
    el('h2', 'title-md', t('rapport.info.titel')),
    el('p', '', t('rapport.info.intro')),
    el('h3', 'label-lg', t('rapport.info.r.titel')), liste('r', [5, 4, 3, 2, 1]),
    el('h3', 'label-lg', t('rapport.info.s.titel')), el('p', '', t('rapport.info.s.text')),
    el('h3', 'label-lg', t('rapport.info.v.titel')), liste('v', [5, 4, 3, 2, 1]),
    el('p', '', t('rapport.info.beispiele')),
    el('h3', 'label-lg', t('rapport.info.vorschlag.titel')),
    el('p', '', t('rapport.info.vorschlag.text')),
    el('p', 'hint', t('rapport.info.grenzen')),
    akt,
  );
  // showModal fokussiert den ersten Knopf (Schließen, ganz unten) und scrollt dorthin: Zurück an den Anfang, damit die Überschrift zu sehen ist
  knopf.addEventListener('click', () => { dialog.showModal(); dialog.scrollTop = 0; });
  zu.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (ev) => { if (ev.target === dialog) dialog.close(); }); // Tipp neben den Inhalt
  box.append(knopf, dialog);
  return box;
}

/**
 * Drei Auswahlfelder R, S und V (R und V 1 bis 5, S 1 bis 9) in einem <span>. beiAenderung bekommt { r, s, v } (Zahl oder null).
 * setze(r, s, v) trägt Werte ein (null = „–“), sperre(true) schaltet die Felder ab. Das S-Feld ist beim Empfang mit 9 vorbelegt, siehe rapport.js.
 */
export function rapportFelder({ t, beiAenderung }) {
  const box = el('span', 'rapport-felder');
  const feld = (buchstabe, max, label) => {
    const s = el('select', 's-wahl'); s.setAttribute('aria-label', t(label));
    const leer = el('option', '', `${buchstabe}–`); leer.value = ''; s.append(leer);
    for (let n = 1; n <= max; n++) { const o = el('option', '', `${buchstabe}${n}`); o.value = String(n); s.append(o); }
    return s;
  };
  const r = feld('R', 5, 'empfangen.rapport.r'), s = feld('S', 9, 'empfangen.rapport.s'), v = feld('V', 5, 'empfangen.rapport.v'); // Reihenfolge wie im Rapport
  const werte = () => ({ r: Number(r.value) || null, s: Number(s.value) || null, v: Number(v.value) || null });
  for (const f of [r, s, v]) f.addEventListener('change', () => beiAenderung?.(werte()));
  box.append(r, s, v);
  return {
    box, werte,
    setze(rr, ss, vv) { r.value = rr ? String(rr) : ''; s.value = ss ? String(ss) : ''; v.value = vv ? String(vv) : ''; },
    sperre(an) { r.disabled = s.disabled = v.disabled = !!an; },
    fokus() { r.focus(); },
  };
}
