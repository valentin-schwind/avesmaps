/**
 * Die Regel der Freitextsuche jeder Liste (`avm-listenleiste.vue`; Betreiber 2026-10-11: „idealerweise ist auch immer eine suchmaske nach
 * freitext links von den beiden“), ohne Vue: Jedes Wort der Suche muss im Suchtext vorkommen, gleich in welcher Groß- und Kleinschreibung.
 * Eine leere Suche trifft alles. Worin gesucht wird, entscheidet die Liste.
 */
export function suchtreffer(suchtext: string, suche: string): boolean {
    const text = suchtext.toLocaleLowerCase("de");
    return suche
        .toLocaleLowerCase("de")
        .split(/\s+/)
        .filter((wort) => wort !== "")
        .every((wort) => text.includes(wort));
}

/** Was die Suche zeigt: ein Feld mit vollem Platzhalter, eines mit „Suchen …“ oder, wenn nicht einmal das passt, den Lupen-Knopf. */
export type SuchStufe = "voll" | "kurz" | "knopf";

/**
 * Die Stufe aus dem Platz (Koordination 2026-10-11 und 2026-10-12: „Ein Platzhalter wird nie abgeschnitten“, „Unterhalb einer
 * Mindestbreite wird die Suche ein Lupen-Knopf“): `frei` ist die Breite für Text im Feld, `voll` und `kurz` sind die Breiten der beiden
 * Platzhalter in der Schrift des Felds. Die Mindestbreite ist damit die, in der „Suchen …“ gerade noch ganz steht.
 */
export function suchStufe(frei: number, voll: number, kurz: number): SuchStufe {
    return voll <= frei ? "voll" : kurz <= frei ? "kurz" : "knopf";
}
