# SSTV-Horch

SSTV-App (Slow Scan Television, Bildfunk im Audiobereich) als PWA: Bilder codieren und decodieren, mit Mikrofon, WAV-Datei oder dem Ton eines Browser-Tabs. HTML, CSS und Vanilla JS mit ES-Modulen, kein Framework, kein Build-Schritt. Oberfläche Deutsch und Englisch. Schwesterprojekt von [FT8-Horch](https://ohrenbeisser.de/app/FT8-horch/).

**Live ausprobieren:** https://ohrenbeisser.de/app/sstv-horch/

## Was die App kann

- **Empfangen:** Live-Decoder mit Wasserfall, Pegelanzeige, Rauschabstand und Frequenzversatz. Erkennt den Modus an der VIS-Kennung, ohne VIS am Zeilentakt. Liest die FSK-Kennung (Rufzeichen) und schlägt einen Rapport (RSV) vor, R, S und V sind als Auswahl änderbar. Quellen: Mikrofon, WAV-Datei, Ton eines Browser-Tabs (WebSDR).
- **Senden:** Bild wählen oder mit der Kamera aufnehmen, zuschneiden, Texte einfügen (Rufzeichen, CQ, QSO, Platzhalter), abspielen oder als WAV speichern, optional mit FSK-Kennung und Kalibrierkopf.
- **Galerie:** Empfangene Bilder in der IndexedDB des Browsers, mit Filter, Rufzeichen und Rapport, ZIP-Sicherung, Logbuch mit ADIF- und CSV-Export.
- **Codierung:** Drei interaktive Karten mit Hörproben erklären Zeilenaufbau, Frequenz und Helligkeit und die VIS-Kennung.
- **Labor:** Pegeltest, Abstimmhilfe, Taktmessung über zwei Geräte, Rauschsimulator mit Modusvergleich.
- **WebSDR (Beta):** Liste fremder Empfänger im Netz und die Übernahme ihres Tons als Quelle.

Modi: Robot 36 und 72, Martin M1 und M2, Scottie S1, S2 und DX, PD90, PD120, PD160, PD180, PD240, Wraase SC2-180.

Zielgeräte sind Android mit Chrome und Linux-PC, nebenbei Windows und Mac. iOS ist nicht vorgesehen. Die Tab-Quelle gibt es nur in Chrome und Edge am Computer. Alles läuft im Browser auf deinem Gerät, nichts wird hochgeladen.

Eine ausführliche Anleitung (Deutsch und Englisch) steht in der App unter **Hilfe** und im Ordner `help/`.

## Selbst ausführen

Es gibt keinen Build-Schritt. Der Ordner lässt sich mit jedem statischen Webserver ausliefern, zum Beispiel:

```
python3 -m http.server 8080
```

und dann `http://localhost:8080/` öffnen. Das Mikrofon verlangt eine sichere Verbindung: `localhost` zählt dazu, sonst braucht es HTTPS. Alle Pfade sind relativ, die App läuft auch in einem Unterordner. Der Service Worker (`sw.js`) legt die Dateien für den Offline-Betrieb in den Cache. Ändert man eine Datei, muss `VERSION` in `sw.js` erhöht und die Dateiliste dort gepflegt werden.

Alle Modusparameter stehen in `src/modes.js`, Encoder und Decoder lesen dieselbe Tabelle.

## Quellen

- Fachartikel des Autors: [SSTV – Fernsehen im Schneckentempo](https://ohrenbeisser.de/sstv-fernsehen-im-schneckentempo/)
- Referenzen für Modustabellen und Gegenproben: QSSTV und slowrx

## Lizenz

GPL-3.0-or-later, siehe `LICENSE`. Die Schriften (Roboto, Roboto Mono, Montserrat Alt1, SIL OFL 1.1) und die Symbole (Material Symbols, Apache 2.0) haben eigene Lizenzen, die Dateien liegen in `fonts/` und `icons/`.
