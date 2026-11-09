### Kurzwelle: die Treffpunkte

Auf Kurzwelle gibt es **Aktivitätszentren** (Bandplan der IARU Region 1, Europa). Das ist kein reservierter Kanal, sondern ein vereinbarter Treffpunkt: Hier hörst du zuerst hinein, und hier startet man ein CQ-Bild. Unterhalb von 10 MHz wird im unteren Seitenband (**LSB**) gearbeitet, darüber im oberen (**USB**).

| Band | Frequenz | Wann und wie weit |
|---|---|---|
| 80 m | 3,735 MHz LSB | abends und nachts, regional; tagsüber gedämpft |
| 40 m | 7,165 MHz LSB | tagsüber, kontinental (etwa Flensburg bis Toskana) |
| 20 m | 14,230 MHz USB | rund um die Uhr, weltweit (DX) |
| 15 m | 21,340 MHz USB | tagsüber bei guter Sonnenaktivität, Weitverkehr |
| 10 m | 28,680 MHz USB | Sporadic-E im Sommer, im Winter oft lange still |

Für 17 m und 12 m nennt der Bandplan kein Aktivitätszentrum für Bildbetriebsarten.

### Ausweichen und Anstand

- Nach dem Erstkontakt weicht man auf eine freie Frequenz im SSB-Bereich aus, mindestens ±3 kHz entfernt (QSY).
- Ausweichfrequenzen auf 20 m: 14,227 und 14,233 MHz. Auf 15 m ein Raster neben dem Zentrum: 21,334, 21,337, 21,340, 21,343 und 21,346 MHz.
- Wer senden will, fragt vorher, ob die Frequenz belegt ist, nötigenfalls zweimal.
- **Tote Zone:** Eine Station in einigen hundert Kilometern Entfernung kann unhörbar sein, obwohl sie sendet. Stille heißt nicht, dass nichts los ist.

### UKW und darüber

| Band | Frequenz | Hinweis |
|---|---|---|
| 2 m | 144,500 MHz | Zentrum für Bildbetriebsarten, SSB oder FM, lokal meist FM |
| 70 cm | 433,400 MHz | SSTV in FM (AFSK); 432,500 MHz ist laut aktuellem Bandplan APRS |
| 23 cm | 1296,500 MHz | Fax-Frequenz; Bildfunk dort eher Experimentierfeld |

### Raumstation ISS (ARISS)

Zu angekündigten Aktionen sendet die ISS SSTV-Bilder. Auf einem WebSDR, das 70 cm abdeckt (zum Beispiel Goonhilly), kannst du die Überflüge mithören.

| Angabe | Wert |
|---|---|
| Frequenz | **437,550 MHz FM** (2026); bis 2025 war es 145,800 MHz FM |
| Rufzeichen | RS0ISS, aus dem russischen Servicemodul Swesda |
| Modus | meist Robot 36 Color, 2025 zeitweise PD120 |
| Rhythmus | Robot 36: ein Bild (36 s), dann etwa 2 Minuten Pause; PD120 (2025): 2 Minuten senden, 2 Minuten Pause |
| Überflug | etwa 10 Minuten Zeitfenster, meist zwei bis drei Bilder |
| Doppler | 70 cm: etwa ±10 kHz; 2 m: etwa ±3,5 bis ±5 kHz |
| Termine | auf der ARISS-Webseite; ohne Aktion bleibt es still |

Der Doppler verschiebt das Signal beim Überflug: höher beim Aufgang, tiefer zum Untergang. Mit einem breiten FM-Filter geht es auf 2 m oft ohne Nachstimmen, auf 70 cm stimmst du während des Überflugs nach. Bei FM schadet das dem Bild weniger als bei SSB.

### Welcher Modus wo

- **Kurzwelle allgemein:** Martin M1 gilt laut SSTV-Handbook als beliebtester Modus. Martin M2 hilft bei unruhigen Bändern, Scottie DX bei Fernverbindungen (rund viereinhalb Minuten je Bild), Scottie S2 bei schnellen Übertragungen.
- **Robot 36 und Robot 72** sind auf Kurzwelle wegen Abstimmfehlern anfällig (die „Rosa-Grün-Falle“). Zeigt „Empfangen“ einen Versatz Δf von mehr als etwa 40 Hz, stimm am WebSDR nach.
- **2 m FM:** Robot 36 spielt hier seine Stärke aus, weil kein SSB-Abstimmfehler auftritt.
- **ISS:** Robot 36, 2025 zeitweise PD120.

### Relais

Die meisten SSTV-Relais liegen auf 10 m. Klassisch aktiviert man sie mit einem 1750-Hz-Tonruf, das Relais antwortet mit Morse-K, danach bleiben etwa 10 Sekunden zum Start. Frequenzen und Betrieb ändern sich, prüfe vorher den aktuellen Stand.

### Gut zu wissen

- Zum Mithören an einem WebSDR brauchst du keine Amateurfunkgenehmigung. Zum Senden schon.
- Die Angaben folgen dem Bandplan der IARU Region 1 und dem Artikel [SSTV – Fernsehen im Schneckentempo](https://ohrenbeisser.de/sstv-fernsehen-im-schneckentempo/). Bandpläne ändern sich, schau im Zweifel in die aktuelle Fassung.
