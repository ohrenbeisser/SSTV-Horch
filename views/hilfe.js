// Anleitung aus help/hilfe.<Sprache>.md. Bei englischer Oberfläche die englische Fassung, klappt das nicht, eben die deutsche.
// Oben steht ein aufklappbares Inhaltsverzeichnis. Die Sprünge laufen über scrollIntoView und nicht über Anker im Hash (#abschnitt),
// denn der Hash gehört dem Routing der App (#/hilfe). Davor warten sie auf die Bilder, sonst verrutscht das Ziel.
import { renderMarkdown } from '../src/markdown.js';
import { aktuelleSprache } from '../src/i18n.js';

async function lade(sprache) {
  const r = await fetch(new URL(`../help/hilfe.${sprache}.md`, import.meta.url));
  if (!r.ok) throw new Error(String(r.status));
  return r.text();
}

export default async function mount(wurzel, { t }) {
  const md = document.createElement('div');
  md.className = 'md';
  wurzel.append(md);
  let text;
  try { text = await lade(aktuelleSprache()); } catch { try { text = await lade('de'); } catch { md.textContent = t('help.failed'); return; } }
  const { html, toc } = renderMarkdown(text, { bildBasis: 'help/' }); // der Leser maskiert alles und erzeugt nur eigene Tags
  md.innerHTML = html;

  const kapitel = toc.filter((h) => h.level === 2);
  if (kapitel.length > 3) {
    const d = document.createElement('details'); d.className = 'akk hilfe-inhalt';
    const sum = document.createElement('summary'); sum.textContent = t('help.toc');
    const liste = document.createElement('ol'); liste.className = 'hilfe-toc';
    for (const h of kapitel) {
      const li = document.createElement('li'); const a = document.createElement('a');
      a.textContent = h.text; a.href = `#/hilfe`;
      a.addEventListener('click', async (e) => {
        e.preventDefault();
        d.open = false;
        // Erst alle Bilder fertig laden: Ohne bekannte Höhe verschiebt sich die Seite unter dem Sprung, und er landet zu weit oben
        await Promise.all([...md.querySelectorAll('img')].map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
        md.querySelector(`[id="${h.id}"]`)?.scrollIntoView({ block: 'start' });
      });
      li.append(a); liste.append(li);
    }
    d.append(sum, liste);
    wurzel.insertBefore(d, md);
  }
}
