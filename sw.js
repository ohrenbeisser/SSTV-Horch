// Service Worker: legt die App beim ersten Besuch komplett in den Cache, danach läuft sie auch ohne Netz.
// Bei JEDER Änderung an einer Datei VERSION hochzählen, sonst klebt die alte Fassung fest. Und neue Dateien in DATEIEN eintragen,
// ein Test schaut nach.
const VERSION = 'sstv-85';
const DATEIEN = [
  './', 'index.html', 'app.js', 'install.js', 'theme.css', 'basis.css', 'farben.css', 'manifest.webmanifest',
  ...['empfangen', 'senden', 'galerie', 'codierung', 'labor', 'einstellungen', 'hilfe', 'ueber', 'rapportinfo', 'logbuch', 'websdr'].map((n) => `views/${n}.js`),
  'help/hilfe.de.md', 'help/hilfe.en.md', 'help/websdr.de.md', 'help/websdr.en.md', 'help/bilder/empfangen-live.png', 'help/bilder/senden-bild.png', 'help/bilder/einstellungen-station.png', 'help/bilder/empfangen-fertig.png', 'help/bilder/rapport-info.png', 'help/bilder/senden-editor.png', 'help/bilder/senden-abspielen.png', 'help/bilder/galerie-raster.png', 'help/bilder/galerie-detail.png', 'help/bilder/websdr.png', 'help/bilder/labor.png', 'help/bilder/codierung.png',
  'lang/de.json', 'lang/en.json',
  'icons/logo.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png',
  'fonts/roboto-latin-400-normal.woff2', 'fonts/roboto-latin-ext-400-normal.woff2',
  'fonts/roboto-latin-500-normal.woff2', 'fonts/roboto-latin-ext-500-normal.woff2', 'fonts/roboto-latin-700-normal.woff2',
  'fonts/MontserratAlt1-Medium.woff2', 'fonts/roboto-mono-latin-400-normal.woff2', 'fonts/roboto-mono-latin-500-normal.woff2',
  ...[
    'abtasten', 'adif', 'archiv', 'audiogeraete', 'dialogkopf', 'ausschnitt', 'bild', 'blind', 'color', 'constants', 'decoder', 'demod', 'encoder', 'fft', 'freqtrack', 'frequenzmessung', 'fskid', 'galerie', 'galeriefilter', 'i18n', 'installieren', 'kamera', 'komposition', 'labor-worker', 'lehrdaten', 'live', 'live-worker', 'logbuch', 'aufnahme-worklet', 'beschaeftigt', 'markdown', 'modes',
    'nav', 'rapport', 'schriften', 'schublade', 'sendelinie', 'settings', 'station', 'stoerung', 'sync', 'version', 'vis', 'vorlagen', 'wav', 'zeit', 'zip',
  ].map((n) => `src/${n}.js`),
];

// Beim Installieren holt jede Datei frisch vom Server und nicht aus dem HTTP-Cache des Browsers (cache: 'reload'). Sonst könnte eine neue
// Fassung alte Dateien in den neuen Cache übernehmen, wenn der Server lange Ablaufzeiten schickt.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(DATEIEN.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Cache zuerst, sonst Netz. Nur gleiche Herkunft.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r || fetch(e.request)));
});
