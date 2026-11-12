/**
 * Was Knopf, Feld und Auswahl gemeinsam rechnen (WI-0120 A8): die Sperre mit ihrem Satz, `aria-describedby` aus mehreren
 * Quellen und die Teilung der durchgereichten Attribute auf Hülle und Bedienelement.
 */

/**
 * Gesperrt heißt bei den Bausteinen: Es gibt einen Satz, warum (Guide §7 „Gesperrt heißt: ein Satz, nicht bloß ein toter
 * Knopf“, §24 „Gesperrte Zustände“). `undefined` ist frei; jeder Text, auch ein leerer, sperrt. Sichtbar wird der Satz nur,
 * wenn er etwas sagt; ein leerer ist ein Fehler des Aufrufers, sperrt aber trotzdem, statt still freizugeben.
 */
export function sperre(gesperrt: string | undefined): { gesperrt: boolean; grund: string | undefined } {
    if (gesperrt === undefined) return { gesperrt: false, grund: undefined };
    const grund = gesperrt.trim();
    return { gesperrt: true, grund: grund === "" ? undefined : grund };
}

/**
 * `aria-describedby` aus mehreren Quellen: was der Aufrufer mitgibt und was der Baustein beiträgt, etwa den Satz, warum er
 * gesperrt ist. 🪤 Ein gesetztes `:aria-describedby` des Bausteins überschriebe das des Aufrufers sonst still; hier wird
 * verbunden, doppelte Kennungen fallen weg, und ohne Kennung bleibt das Attribut weg.
 */
export function beschriebenVon(...teile: readonly unknown[]): string | undefined {
    const kennungen = teile
        .filter((teil): teil is string => typeof teil === "string")
        .flatMap((teil) => teil.split(/\s+/))
        .filter((kennung) => kennung !== "");
    return kennungen.length === 0 ? undefined : [...new Set(kennungen)].join(" ");
}

/**
 * Teilt die durchgereichten Attribute: `class` und `style` gehören der Hülle (dort setzt der Aufrufer Breite und Lage, und
 * nur die einzelne Wurzel trägt seine Stilkennung, damit sein `scoped`-Stil greift), alles andere dem Bedienelement darin
 * (`id`, `name`, `autocomplete`, `aria-*`, Ereignisse).
 */
export function teileAttrs(attrs: Readonly<Record<string, unknown>>): {
    huelle: { class: unknown; style: unknown };
    element: Record<string, unknown>;
} {
    const element: Record<string, unknown> = {};
    for (const [name, wert] of Object.entries(attrs)) {
        if (name !== "class" && name !== "style") element[name] = wert;
    }
    return { huelle: { class: attrs["class"], style: attrs["style"] }, element };
}
