// Die festen Größen des SSTV-Signals: Welche Frequenz bedeutet was, wie lang ist ein VIS-Bit, wie sieht die FSK-ID aus.
// Quellen: Artikel „SSTV – Fernsehen im Schneckentempo“, slowrx (vis.c, video.c), QSSTV (sstvtx.cpp), gegen die Referenzimplementierungen geprüft.
// Goldene Regel: Diese Zahlen stehen nur hier. Wer irgendwo im Code „1200“ von Hand reintippt, hat verloren.

export const F_SYNC = 1200; // Hz, Zeilensync, VIS-Start/Stopp
export const F_BLACK = 1500; // Hz, Schwarz, auch Porch/Separator
export const F_WHITE = 2300; // Hz, Weiß
export const F_LEADER = 1900; // Hz, Leitton und Chroma-Porch (Robot)
export const F_VIS_1 = 1100; // Hz, VIS-Bit 1
export const F_VIS_0 = 1300; // Hz, VIS-Bit 0
export const F_SPAN = F_WHITE - F_BLACK; // 800 Hz Helligkeitshub

export const VIS_BIT_MS = 30; // je Bit, 33,3 Baud
export const LEADER_MS = 300; // Leitton vor und nach dem 1200-Hz-Break
export const BREAK_MS = 10; // Break zwischen den Leittönen

// Kalibrierkopf, den QSSTV vor dem Leitton sendet (8 x 100 ms). Für den Empfang nicht nötig, für die Verträglichkeit mit
// anderen Programmen aber üblich. In der App abschaltbar.
export const CAL_HEADER = [
  [100, 1900], [100, 1500], [100, 1900], [100, 1500],
  [100, 2300], [100, 1500], [100, 2300], [100, 1500],
];

// FSK-Rufzeichenkennung am Bildende (Referenz: QSSTV, txfunctions.cpp sendFSKID/sendFSKChar von DL3YAP und visfskid.cpp, Commit 31c323c).
// Ablauf: 300 ms 1500 Hz, 100 ms 2100 Hz, 22 ms 1900 Hz (Start), dann je Zeichen 6 Bit (niederwertiges zuerst, je 22 ms,
// 1 = 1900 Hz, 0 = 2100 Hz). Zeichen: Start 0x2A, Rufzeichen (ASCII minus 0x20, großgeschrieben), Ende 0x01, Prüfsumme (XOR der
// Rufzeichenzeichen, 6 Bit), danach 100 ms 1900 Hz. Der Empfänger von QSSTV verwirft Kennungen über 9 Zeichen.
export const FSK_HEAD_1500_MS = 300;
export const FSK_HEAD_2100_MS = 100;
export const FSK_BIT_MS = 22;
export const F_FSK_1 = 1900;
export const F_FSK_0 = 2100;
export const FSK_START = 0x2a;
export const FSK_END = 0x01;
export const FSK_TAIL_MS = 100;
export const FSK_MAX_CHARS = 9;
