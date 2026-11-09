// Darf „Foto aufnehmen“ auftauchen? Der Knopf öffnet über ein Dateifeld mit capture die Kamera-App des Geräts. Dafür braucht die
// Seite keine Erlaubnis (deshalb fragen wir den Berechtigungsstatus gar nicht erst ab), aber eben eine Kamera. Auf dem PC öffnet
// capture nur den Dateidialog, da hat der Knopf nichts verloren. Eine eigene Kameravorschau ist nicht vorgesehen (D22).

/**
 * geraete: Liste von enumerateDevices() oder null, wenn der Browser sie nicht liefert. grobZeiger: Das Gerät wird mit dem Finger
 * bedient (Handy, Tablet). Gibt zurück, ob der Knopf gezeigt werden soll.
 */
export function kameraVerfuegbar({ geraete, grobZeiger }) {
  if (!grobZeiger) return false;
  if (geraete === null) return true; // keine Liste (zum Beispiel unsichere Verbindung): auf einem Touchgerät eine Kamera annehmen
  return geraete.some((g) => g.kind === 'videoinput');
}

/** Prüft im Browser. Fehler ergeben „nicht verfügbar“ nur dann, wenn die Liste gelesen wurde, sonst gilt die Annahme für Touchgeräte. */
export async function pruefeKamera() {
  const grobZeiger = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let geraete = null;
  if (navigator.mediaDevices?.enumerateDevices) {
    try { geraete = await navigator.mediaDevices.enumerateDevices(); } catch { geraete = null; }
  }
  return kameraVerfuegbar({ geraete, grobZeiger });
}
