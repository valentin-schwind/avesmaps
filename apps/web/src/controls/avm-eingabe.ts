/**
 * Was das Textfeld `AvmEingabe` rechnet, ohne Browser (WI-0120 A8): welche Art von `<input>` es ist und welche
 * `autocomplete`-Vorgabe gilt, wenn der Aufrufer keine mitgibt.
 */
export type EingabeArt = "text" | "passwort" | "suche" | "datum";

/**
 * Das `type` des Feldes. Ein Passwort, das angezeigt wird, ist Text; zurückgeschaltet wieder ein Passwort. Ein Datum ist das Datumsfeld
 * des Browsers (WI-0217, Neuigkeiten): Es liefert `JJJJ-MM-TT` und zeigt den Tag in der Schreibweise der Sprache.
 */
export function eingabeTyp(art: EingabeArt, passwortSichtbar: boolean): "text" | "password" | "search" | "date" {
    if (art === "passwort") return passwortSichtbar ? "text" : "password";
    if (art === "datum") return "date";
    return art === "suche" ? "search" : "text";
}

/**
 * Die Vorgabe für `autocomplete`, wo der Aufrufer nichts sagt. 🔴 Ein Passwortfeld ist zum Anmelden da und nimmt den
 * Passwortmanager mit (AUTH-0001 §6.4: „Einfügen und Passwortmanager sind erlaubt“); wer ein neues Passwort setzt, gibt
 * `new-password` selbst mit. Eine Suche merkt sich der Browser nicht. Ein Textfeld bekommt keine Vorgabe.
 */
export function autocompleteVorgabe(art: EingabeArt): string | undefined {
    if (art === "passwort") return "current-password";
    return art === "suche" ? "off" : undefined;
}
