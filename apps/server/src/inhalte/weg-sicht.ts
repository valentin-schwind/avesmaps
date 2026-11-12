import type { InhalteVerwendungState } from "@avesmaps3d/shared";

/**
 * Die Sicht auf EINE Quelle über die Abschnitte einer Straße (WI-0254 §12): Die Verknüpfungen hängen technisch je Abschnitt (`path_source`, Legacy führt sie so), aber ein Weg ist in den Quellen und im
 * Wiki ein Ganzes (Betreiber 2026-10-28). Diese Rechnung steht an einer Stelle, weil drei Wege dieselbe Sicht brauchen: das Lesen der Quellen eines Wegs (`traeger-quellen-lesen.ts`), das Lesen der
 * Wege einer Quelle (`quellen-wege.ts`) und das Schreiben, das `vorher` genau an dieser Sicht misst (`traeger-quellen-weg.ts`). Ohne Datenbank, ohne Vertrag.
 */

/** Die Zeile einer Quelle an einem Abschnitt, so viel die Zusammenfassung braucht. `carrier_id` ist die öffentliche Kennung des Abschnitts. */
export interface WegZeile {
    carrier_id: string;
    state: string;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
}

/** Eine Quelle über die Abschnitte einer Straße zusammengefasst. */
export interface WegSicht<Z extends WegZeile> {
    /** Aktiv, wenn ein Abschnitt sie aktiv trägt, sonst gelöst, wenn einer sie gelöst hat, sonst unterdrückt. */
    state: InhalteVerwendungState;
    /** Die Abschnitte, die sie aktiv tragen, entlang der Straße. */
    aktiv: Z[];
    /** Die Zeilen, die den Wert bestimmen: die aktiven, sonst alle, entlang der Straße. */
    massgebend: Z[];
    /** Die erste davon: Ihre Angaben stehen für die Straße. */
    erste: Z;
}

/**
 * Die Zeilen EINER Quelle über die Abschnitte einer Straße, zusammengefasst: ihre Angaben sind die des ersten Abschnitts entlang der Straße, der sie aktiv trägt (sonst des ersten, der sie
 * überhaupt führt); `folge` ist die Folge der Abschnitte entlang der Straße (Kennung → Platz). Der Schreibweg misst `vorher` an genau dieser Sicht: Was die Oberfläche las, ist, was gilt.
 */
export function fasseWegQuelleZusammen<Z extends WegZeile>(
    teil: readonly Z[],
    folge: ReadonlyMap<string, number>,
): WegSicht<Z> {
    const entlang = (a: Z, b: Z): number => (folge.get(a.carrier_id) ?? 0) - (folge.get(b.carrier_id) ?? 0);
    const aktiv = teil.filter((zeile) => zeile.state === "active").sort(entlang);
    const massgebend = aktiv.length > 0 ? aktiv : [...teil].sort(entlang);
    const state: InhalteVerwendungState =
        aktiv.length > 0 ? "active" : teil.some((zeile) => zeile.state === "retired") ? "retired" : "suppressed";
    return { state, aktiv, massgebend, erste: massgebend[0]! };
}
