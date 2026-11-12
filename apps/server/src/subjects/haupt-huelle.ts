/** Eine Teilfläche für das Kameraziel: Fläche und Hülle in Kartenkoordinaten. */
export interface FlaechenTeil {
    flaeche: number;
    bbox: readonly [number, number, number, number];
}

/**
 * Die Hülle der größten Teilflächen, die zusammen mindestens `anteil` der Fläche tragen (Bauvorlage `hauptBBox`); `null` ohne Teilfläche.
 * Ferne Inseln und Splitter ziehen die Kamera so nicht weg (Sprachen WI-0261 S5b; Gegenden WI-0260, Bornland mit vier fernen Splittern).
 */
export function huelleDerHauptteile(
    teile: readonly FlaechenTeil[],
    anteil: number,
): [number, number, number, number] | null {
    const sortiert = [...teile].sort((a, b) => b.flaeche - a.flaeche);
    const gesamt = sortiert.reduce((summe, teil) => summe + Math.max(0, teil.flaeche), 0);
    let huelle: [number, number, number, number] | null = null;
    let summe = 0;
    for (const teil of sortiert) {
        const [x0, y0, x1, y1] = teil.bbox;
        huelle =
            huelle === null
                ? [x0, y0, x1, y1]
                : [Math.min(huelle[0], x0), Math.min(huelle[1], y0), Math.max(huelle[2], x1), Math.max(huelle[3], y1)];
        summe += Math.max(0, teil.flaeche);
        if (gesamt <= 0 || summe / gesamt >= anteil) break;
    }
    return huelle;
}
