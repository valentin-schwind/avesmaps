import { canonColour, DESIGN_CANON } from "@avesmaps3d/shared";

/**
 * Die Farben der gewählten Vorkommen (WI-0257 S5, Vali 2026-10-30: „die jeweiligen regionen mit den icons für ausgewählte vorkommen sollten sich farblich
 * unterscheiden (erstell ein großes farbset)“). EINE Tafel im Kanon (`colour.mapVorkommen1` …, Herleitung und Messung in `$mapVorkommenComment`): Die Karte
 * liest sie als Wert, die Oberfläche als CSS-Variable aus `canon.css` (`--color-map-vorkommen1` …). Ein „Platz“ ist die Nummer der Farbe, ab 1.
 */

/** Die Farben in der Reihenfolge ihrer Plätze, so viele, wie der Kanon führt. */
export const VORKOMMEN_FARBEN: readonly string[] = (() => {
    const farben: string[] = [];
    for (let platz = 1; DESIGN_CANON.colour[`mapVorkommen${String(platz)}`] !== undefined; platz++) {
        farben.push(canonColour(`mapVorkommen${String(platz)}`));
    }
    return farben;
})();

/** Die Farbe eines Platzes als Wert für die Karte (`#rrggbb`). Ein Platz jenseits der Tafel nimmt die Farbe seines Rests (nur zur Sicherheit; `freierPlatz` vergibt keinen). */
export function vorkommenFarbe(platz: number): string {
    const anzahl = VORKOMMEN_FARBEN.length;
    return VORKOMMEN_FARBEN[(((platz - 1) % anzahl) + anzahl) % anzahl] as string;
}

/** Dieselbe Farbe für die Oberfläche: die Variable aus `canon.css`. */
export function vorkommenFarbeCss(platz: number): string {
    return `var(--color-map-vorkommen${String(platz)})`;
}

/**
 * Der Platz für ein neu gewähltes Vorkommen: der erste freie. Eine Farbe bleibt an ihrem Vorkommen, solange es gewählt ist; wird eines entfernt, wechselt
 * keines der anderen seine Farbe, und die frei gewordene ist die nächste. Sind alle belegt (mehr als 16 gewählt), der am seltensten belegte, bei
 * Gleichstand der kleinste: Dann tragen zwei Vorkommen dieselbe Farbe, und ihre Namen auf der Karte unterscheiden sie.
 */
export function freierPlatz(belegt: Iterable<number>, anzahl: number = VORKOMMEN_FARBEN.length): number {
    const zahl = new Map<number, number>();
    for (const platz of belegt) zahl.set(platz, (zahl.get(platz) ?? 0) + 1);
    let bester = 1;
    for (let platz = 1; platz <= anzahl; platz++) {
        const n = zahl.get(platz) ?? 0;
        if (n === 0) return platz;
        if (n < (zahl.get(bester) ?? 0)) bester = platz;
    }
    return bester;
}
