### Shortwave: the meeting points

On shortwave there are **centres of activity** (IARU Region 1 band plan, Europe). They are not reserved channels but agreed meeting points: you listen here first, and a CQ picture is started here. Below 10 MHz people use the lower sideband (**LSB**), above it the upper sideband (**USB**).

| Band | Frequency | When and how far |
|---|---|---|
| 80 m | 3.735 MHz LSB | evening and night, regional; damped in daytime |
| 40 m | 7.165 MHz LSB | daytime, continental (roughly Flensburg to Tuscany) |
| 20 m | 14.230 MHz USB | around the clock, worldwide (DX) |
| 15 m | 21.340 MHz USB | daytime with good solar activity, long distance |
| 10 m | 28.680 MHz USB | sporadic E in summer, often quiet for long in winter |

For 17 m and 12 m the band plan names no centre of activity for picture modes.

### Moving away and manners

- After the first contact people move to a free frequency in the SSB segment, at least ±3 kHz away (QSY).
- Alternative frequencies on 20 m: 14.227 and 14.233 MHz. On 15 m a grid beside the centre: 21.334, 21.337, 21.340, 21.343 and 21.346 MHz.
- Whoever wants to transmit asks first whether the frequency is in use, twice if need be.
- **Skip zone:** A station a few hundred kilometres away can be inaudible although it transmits. Silence does not mean nothing is going on.

### VHF and above

| Band | Frequency | Note |
|---|---|---|
| 2 m | 144.500 MHz | centre for picture modes, SSB or FM, locally mostly FM |
| 70 cm | 433.400 MHz | SSTV in FM (AFSK); 432.500 MHz is APRS in the current band plan |
| 23 cm | 1296.500 MHz | fax frequency; picture modes there are more of an experiment |

### The space station ISS (ARISS)

During announced events the ISS sends SSTV pictures. On a WebSDR that covers 70 cm (for example Goonhilly) you can listen in on the passes.

| Item | Detail |
|---|---|
| Frequency | **437.550 MHz FM** (2026); until 2025 it was 145.800 MHz FM |
| Callsign | RS0ISS, from the Russian Zvezda service module |
| Mode | mostly Robot 36 Color, PD120 at times in 2025 |
| Rhythm | Robot 36: one picture (36 s), then about 2 minutes pause; PD120 (2025): 2 minutes sending, 2 minutes pause |
| Pass | about 10 minutes window, usually two to three pictures |
| Doppler | 70 cm: about ±10 kHz; 2 m: about ±3.5 to ±5 kHz |
| Dates | on the ARISS website; without an event it stays quiet |

Doppler shifts the signal during the pass: higher on rise, lower on set. With a wide FM filter 2 m often works without retuning, on 70 cm you retune during the pass. With FM this hurts the picture less than with SSB.

### Which mode where

- **Shortwave in general:** According to the SSTV Handbook Martin M1 is the most popular mode. Martin M2 helps on unsettled bands, Scottie DX on long distances (about four and a half minutes per picture), Scottie S2 for fast transmissions.
- **Robot 36 and Robot 72** are prone to tuning errors on shortwave (the “pink-green trap”). If “Receive” shows an offset Δf of more than about 40 Hz, retune at the WebSDR.
- **2 m FM:** Robot 36 shows its strength here because there is no SSB tuning error.
- **ISS:** Robot 36, PD120 at times in 2025.

### Repeaters

Most SSTV repeaters are on 10 m. Classically you activate one with a 1750 Hz tone burst, the repeater answers with a Morse K, then you have about 10 seconds to start. Frequencies and operation change, so check the current state first.

### Good to know

- To listen in on a WebSDR you need no amateur radio licence. To transmit you do.
- The details follow the IARU Region 1 band plan and the article [SSTV – Fernsehen im Schneckentempo](https://ohrenbeisser.de/sstv-fernsehen-im-schneckentempo/) (in German). Band plans change, so check the current version when in doubt.
