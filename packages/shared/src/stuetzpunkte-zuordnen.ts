/**
 * Welcher alte Stützpunkt einer Wegkurve ist welcher neue? (WI-0259 §2: „Höhe wandert mit“; Vali 2026-10-30 im klickbaren Entwurf: Die Höhe
 * gehört dem Stützpunkt. Verschoben geht sie mit, gelöscht fällt sie weg, ein eingefügter Punkt hat keine eigene.)
 *
 * Eigene Höhen an Flüssen hängen nur an der Lage (`terrain_water_height`, `WASSER_LAGE_E`); der Wegeditor schreibt eine neue Kurve ohne
 * Kennungen der Stützpunkte. Diese Rechnung erkennt aus alter und neuer Folge, welcher Punkt verschoben wurde. Rein, ohne Datenbank.
 *
 * - **Gleiche Lage bleibt** (`gleich`, vorgegeben die Toleranz der Höhen: `gleicheLage`, 1e-4): ein Punkt, der nach dem Runden auf fünf
 *   Stellen noch an seiner Stelle liegt, hat sich nicht bewegt.
 * - **Gleiche Länge:** ein Punkt mit geänderter Lage am selben Index ist verschoben.
 * - **Andere Länge:** Ausrichtung über die längste gemeinsame Teilfolge gleicher Lagen (gemeinsamer Anfang und Ende zuerst). In einer
 *   Lücke zwischen zwei ausgerichteten Punkten mit gleich vielen alten und neuen Punkten gelten diese paarweise als verschoben; sonst
 *   sind die alten Punkte der Lücke gelöscht und die neuen eingefügt (Einfügen und Löschen im selben Schritt sind kein Verschieben).
 * - **Nie verschoben, was noch da ist:** Liegt die alte Lage eines Paares noch bei irgendeinem neuen Punkt (eine Kurve, die sich umkehrt
 *   oder auf sich zurückläuft), ist der alte Punkt geblieben; die Höhe an dieser Lage hängt weiter an einem Stützpunkt.
 */
import { gleicheLage } from "./gebirge/rueckennetz/wasser.ts";

export interface Stuetzpunkt {
    readonly x: number;
    readonly y: number;
}

/** Ein verschobener Stützpunkt: Index in der alten und in der neuen Folge, alte und neue Lage. */
export interface StuetzpunktVerschoben {
    readonly alt: number;
    readonly neu: number;
    readonly von: Stuetzpunkt;
    readonly nach: Stuetzpunkt;
}

export interface StuetzpunktZuordnung {
    /** Alte Punkte, die an ihrer Lage geblieben sind (`neu`: der neue Punkt dort), nach altem Index. */
    readonly bleibt: readonly { readonly alt: number; readonly neu: number }[];
    /** Verschobene Punkte, nach altem Index. */
    readonly verschoben: readonly StuetzpunktVerschoben[];
    /** Alte Indizes ohne Entsprechung: gelöscht. */
    readonly geloescht: readonly number[];
    /** Neue Indizes ohne Entsprechung: eingefügt. */
    readonly eingefuegt: readonly number[];
}

/** So viele Zellen darf die Tafel der längsten gemeinsamen Teilfolge haben; darüber richtet die Rechnung nichts aus (nichts wandert). */
const LCS_ZELLEN_MAX = 16_000_000;

type Gleich = (a: Stuetzpunkt, b: Stuetzpunkt) => boolean;

/** Die ausgerichteten Paare `[alt, neu]` gleicher Lage, aufsteigend in beiden Folgen. */
function ausrichten(alt: readonly Stuetzpunkt[], neu: readonly Stuetzpunkt[], gleich: Gleich): [number, number][] {
    const n = alt.length;
    const m = neu.length;
    if (n === m) return alt.flatMap((p, i) => (gleich(p, neu[i]!) ? [[i, i] as [number, number]] : []));
    // Gemeinsamer Anfang und Ende: Meist ändert eine Bearbeitung wenige Punkte, dann bleibt für die Tafel fast nichts.
    let anfang = 0;
    while (anfang < n && anfang < m && gleich(alt[anfang]!, neu[anfang]!)) anfang++;
    let ende = 0;
    while (ende < n - anfang && ende < m - anfang && gleich(alt[n - 1 - ende]!, neu[m - 1 - ende]!)) ende++;
    const paare: [number, number][] = [];
    for (let i = 0; i < anfang; i++) paare.push([i, i]);
    const a = n - anfang - ende;
    const b = m - anfang - ende;
    if (a > 0 && b > 0 && a * b <= LCS_ZELLEN_MAX) {
        // l[i][j]: die längste gemeinsame Teilfolge ab alt[anfang + i] und neu[anfang + j].
        const breite = b + 1;
        const l = new Uint16Array((a + 1) * breite);
        for (let i = a - 1; i >= 0; i--)
            for (let j = b - 1; j >= 0; j--)
                l[i * breite + j] = gleich(alt[anfang + i]!, neu[anfang + j]!)
                    ? l[(i + 1) * breite + j + 1]! + 1
                    : Math.max(l[(i + 1) * breite + j]!, l[i * breite + j + 1]!);
        let i = 0;
        let j = 0;
        while (i < a && j < b) {
            if (gleich(alt[anfang + i]!, neu[anfang + j]!) && l[i * breite + j] === l[(i + 1) * breite + j + 1]! + 1) {
                paare.push([anfang + i, anfang + j]);
                i++;
                j++;
            } else if (l[(i + 1) * breite + j]! >= l[i * breite + j + 1]!) i++;
            else j++;
        }
    }
    for (let k = 0; k < ende; k++) paare.push([n - ende + k, m - ende + k]);
    return paare;
}

/**
 * Ordnet die Stützpunkte einer neuen Kurve denen der alten zu. `gleich` entscheidet, ob zwei Lagen dieselbe Stelle sind (vorgegeben
 * `gleicheLage`, die Toleranz, mit der eine Höhe an ihrem Stützpunkt hängt).
 */
export function stuetzpunkteZuordnen(
    alt: readonly Stuetzpunkt[],
    neu: readonly Stuetzpunkt[],
    gleich: Gleich = gleicheLage,
): StuetzpunktZuordnung {
    const anker = ausrichten(alt, neu, gleich);
    const bleibt: { alt: number; neu: number }[] = [];
    const verschoben: StuetzpunktVerschoben[] = [];
    const geloescht: number[] = [];
    const eingefuegt: number[] = [];

    /** Die Lücke `[a0, a1)` der alten gegen `[b0, b1)` der neuen Folge. */
    const luecke = (a0: number, a1: number, b0: number, b1: number): void => {
        if (a1 - a0 !== b1 - b0) {
            for (let i = a0; i < a1; i++) geloescht.push(i);
            for (let j = b0; j < b1; j++) eingefuegt.push(j);
            return;
        }
        for (let k = 0; k < a1 - a0; k++) {
            const i = a0 + k;
            const j = b0 + k;
            const p = alt[i]!;
            const q = neu[j]!;
            if (gleich(p, q)) {
                bleibt.push({ alt: i, neu: j });
                continue;
            }
            // Noch da, wenn die alte Lage bei irgendeinem neuen Punkt liegt: Der Punkt ist nicht gewandert.
            const dort = neu.findIndex((r) => gleich(p, r));
            if (dort >= 0) {
                bleibt.push({ alt: i, neu: dort });
                eingefuegt.push(j);
            } else verschoben.push({ alt: i, neu: j, von: { x: p.x, y: p.y }, nach: { x: q.x, y: q.y } });
        }
    };

    let a0 = 0;
    let b0 = 0;
    for (const [i, j] of anker) {
        luecke(a0, i, b0, j);
        bleibt.push({ alt: i, neu: j });
        a0 = i + 1;
        b0 = j + 1;
    }
    luecke(a0, alt.length, b0, neu.length);

    return {
        bleibt: bleibt.sort((p, q) => p.alt - q.alt),
        verschoben: verschoben.sort((p, q) => p.alt - q.alt),
        geloescht: geloescht.sort((p, q) => p - q),
        eingefuegt: eingefuegt.sort((p, q) => p - q),
    };
}
