/**
 * Die Regeln der Mehrfachauswahl (`avm-mehrfachauswahl.vue`, WI-0308), ohne Vue: eine Wahl an oder aus, die leere Wahl (`undefined`) leert
 * alles. Die neue Wahl steht immer in der Folge der Optionen, jeder Wert höchstens einmal, ein unbekannter Wert fällt weg.
 */
export function mehrfachWahl(
    optionen: readonly { wert: string }[],
    alt: readonly string[],
    wert: string | undefined,
    an: boolean,
): string[] {
    if (wert === undefined) return an ? [] : [...alt];
    const neu = new Set(alt);
    if (an) neu.add(wert);
    else neu.delete(wert);
    return optionen.map((option) => option.wert).filter((w) => neu.has(w));
}
