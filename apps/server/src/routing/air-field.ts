import { AVENTURIA_FLIGHT_CARTOGRAPHY, airSurchargeRule, type TravelModel } from "@avesmaps3d/shared";
import type { AirFrame } from "./air-obstacles.ts";
import { werte } from "./einstellungen.ts";
import type { FlightAir } from "./water-profile.ts";

/**
 * Das Kostenfeld des Flugs (WI-0051 F4b, Betreiber 2026-10-04: „F4b A - wie das höhenfeld in A* oder?“): Statt Wege um
 * Gelände über einer Schwelle zu vergleichen, sucht der Flug EINEN Weg über einem Raster, in dem jede Zelle sagt, was
 * es kostet, dort zu fliegen. Der Weg ist dann der günstigste nach der Zeit samt Zuschlag über der Reisehöhe (F4), nicht
 * der kürzeste um etwas herum. Wie das Höhenfeld des Gangs querfeldein: Der Preis eines Schritts hängt an den beiden
 * Zellen, zwischen denen er läuft.
 *
 * Das Feld ist die Näherung der EXAKTEN Rechnung, die der Dienst am Ende am gefundenen Weg anstellt
 * (`flightTrack`, `flightAltitude`, `flightSurcharge`); gewählt wird nach dieser, nicht nach dem Feld. Je Zelle gibt es:
 *
 * - **Das Höchste** der Zelle: was Gelände in ihr erreicht (`heightCells`), also eine obere Grenze des Bodens an jeder
 *   Stelle in ihr (bilinear gelesen reicht jede Stützstelle einen Rasterschritt über ihre Zelle hinaus). Daraus kommt der
 *   Bedarf der Bahn, denn ein Grat in der Zelle hebt sie. Nach dem Bau des Felds wird es nicht mehr gebraucht.
 * - **Den Boden in der Mitte** (`centreHeights`): der Boden, den ein Flug durch die Zelle im Mittel unter sich hat; an ihm
 *   misst der Überstand. Mit dem Höchsten allein schätzte das Feld den Überstand auf rauem Gelände oft um mehrere hundert Schritt zu klein
 *   (Boden und Bahn lägen beide oben).
 * - **Die Bahn** der Zelle, getrennt für vier Achsen (Ost-West, Nord-Süd und die beiden Diagonalen): die Höhe, auf der
 *   die Bahn nach der Regel von `flightAltitude` liegt, wenn der Flug auf dieser Gitterachse durch die Zelle läuft.
 *   Bedarf je Zelle ist min(Obergrenze, max(Reisehöhe, Boden + Mindestabstand)); gehalten über `hold` je Seite und mit
 *   `slope` auf- und abwärts, in beide Richtungen der Achse, gedeckelt auf die Obergrenze und nie unter dem Boden. Das ist
 *   die Rechnung der Bahn, Zelle für Zelle auf einer Geraden; sie ist für einen Lauf längs der Achse dieselbe wie die der
 *   Bahn, nur an den Zellen statt alle 0,25 E.
 *
 * 🪤 **Warum je Achse und nicht eine Hülle über alle Richtungen.** Die Bahn sieht nur das Gelände UNTER sich (und ±2 E
 * davor und dahinter, auf der eigenen Linie). Wer neben einem Gipfel durch ein Tal fliegt, hat ihn nicht darunter und
 * zahlt nichts. Eine Hülle über alle Richtungen (Kegel um jeden Gipfel) kostete jede Zelle im Umkreis von 6 E um einen
 * Gipfel von 3.500 Schritt, auch das Tal daneben: Der Weg „daneben durchs Tal“ wäre gerade der teuerste. Je Achse sieht
 * die Zelle nur die Zellen auf ihrer Geraden.
 *
 * 🪤 **Was das Feld nicht kennt:** die Rampen am Start (Aufstieg vom Boden) und am Ziel (Abstieg auf den Boden) der Etappe
 * (die Bahn liegt dort unter der Hülle, das Feld rechnet die Hülle, es überschätzt also dort leicht), die Richtungen
 * zwischen den Achsen (sie nehmen die nächste Achse, höchstens 22,5° daneben) und die Zellmitte statt der echten Stelle.
 * Kein Schaden für die Wahl: Sie liegt beim Dienst, am exakten Zuschlag des Wegs.
 */

/** Die vier Achsen des Gitters: Ost-West, Nord-Süd, Südwest-Nordost, Südost-Nordwest. */
export const AXES: readonly (readonly [number, number])[] = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
];

/**
 * Die Achse zu jeder der acht Nachbarrichtungen der Suche, in der Reihenfolge von `NEIGHBOURS` in `air-search.ts`:
 * (1,0) (-1,0) (0,1) (0,-1) (1,1) (-1,1) (1,-1) (-1,-1).
 */
export const AXIS_OF_DIRECTION: readonly number[] = [0, 0, 1, 1, 2, 3, 3, 2];

/** Die Werte der Rechnung: aus dem Flugmittel, dem Reisemodell und der Flugkartografie (`bahn`), nichts Neues. */
export interface AirFieldRule {
    /** Reisehöhe in Schritt (über Grund, aber die Bahn nimmt sie als Mindesthöhe über dem Meer, `flightAltitude`). */
    cruise: number;
    /** Höchstflughöhe über dem Meer. */
    ceiling: number;
    /** Höchste Höhe über dem Boden darunter (10 × Reisehöhe). */
    reach: number;
    /** Mindestabstand zum Boden. */
    clearance: number;
    /** Halten: Fenster je Seite in Schritt (`bahn.haltenEinheiten`). */
    hold: number;
    /** Steigen und Sinken: Höhe je Länge (`bahn.steigung`). */
    slope: number;
    /** Die Standardflughöhe über Grund: Der Bezug der Kosten (`airStandardHeight`). */
    standard: number;
    /** Der Nenner des Haltens: die größte Höhe über Grund. */
    scale: number;
    /** Strecke je Schritt Steigen über die Standardflughöhe. */
    climbFactor: number;
    /** Zuschlag auf die Strecke je Überstand / `scale`. */
    holdFactor: number;
    /**
     * Schritt je Karteneinheit, wie ihn dieser Datenstand rechnet (`schrittPerUnit`, WI-0214). Einmal beim Bau der Regel
     * gelesen, nicht je Zelle: `stepExtra` und `turnExtra` laufen je Schritt der Suche.
     */
    schritt: number;
}

/** Die Rechnung des Felds für ein Flugmittel: dieselben Werte wie `flightTrack`. */
export function airFieldRule(air: FlightAir, model: TravelModel): AirFieldRule {
    const bahn = AVENTURIA_FLIGHT_CARTOGRAPHY.bahn;
    const surcharge = airSurchargeRule(model, air.altitudeSchritt);
    const schritt = werte().schrittPerUnit;
    return {
        cruise: air.altitudeSchritt,
        ceiling: air.ceilingSchritt,
        reach: air.maxAboveGroundSchritt,
        clearance: model.flug.wert.mindestabstandSchritt,
        hold: bahn.haltenEinheiten * schritt,
        slope: bahn.steigung,
        ...surcharge,
        schritt,
    };
}

/** Das Kostenfeld über einem Raster: der Boden in der Mitte jeder Zelle und die Bahn je Zelle und Achse (ganze Schritt über dem Meer). */
export interface AirCostField {
    rule: AirFieldRule;
    /** Der Boden in der Mitte jeder Zelle (`centreHeights`), in Schritt. */
    ground: Float32Array;
    /** Die Bahn je Zelle für jede Achse von `AXES`, in ganzen Schritt über dem Meer. */
    altitude: readonly [Uint16Array, Uint16Array, Uint16Array, Uint16Array];
}

/**
 * Das Kostenfeld über einem Raster: `source` ist das Höchste je Zelle (`heightCells` mit Grenze 0, der Bedarf der Bahn), `ground`
 * der Boden in den Zellmitten (`centreHeights`, der Überstand und die Obergrenze). Für jede der vier Achsen werden alle
 * Geraden des Rasters durchlaufen und auf jeder die Bahn nach `flightAltitude` gerechnet.
 */
export function buildCostField(
    frame: AirFrame,
    source: Float32Array,
    ground: Float32Array,
    rule: AirFieldRule,
): AirCostField {
    const { cols, rows, cell } = frame;
    const altitude = AXES.map(() => new Uint16Array(cols * rows)) as unknown as AirCostField["altitude"];
    const longest = Math.max(cols, rows);
    const need = new Float64Array(longest);
    const forward = new Float64Array(longest);
    const backward = new Float64Array(longest);
    AXES.forEach(([dc, dr], axis) => {
        const out = altitude[axis] as Uint16Array;
        // Der Abstand zweier Zellen auf dieser Achse in Schritt, das Fenster des Haltens und das Gefälle je Zelle.
        const step = cell * (dc !== 0 && dr !== 0 ? Math.SQRT2 : 1) * rule.schritt;
        const hold = Math.max(1, Math.round(rule.hold / step));
        const drop = rule.slope * step;
        const line = (start: number, count: number, stride: number): void => {
            for (let k = 0, at = start; k < count; k += 1, at += stride) {
                const g = source[at] as number;
                const cap = Math.min(rule.ceiling, g + rule.reach);
                need[k] = Math.min(cap, Math.max(rule.cruise, g + rule.clearance));
            }
            // Die obere Hülle mit dem Gefälle, von beiden Seiten.
            forward[0] = need[0] as number;
            for (let k = 1; k < count; k += 1) {
                forward[k] = Math.max(need[k] as number, (forward[k - 1] as number) - drop);
            }
            backward[count - 1] = need[count - 1] as number;
            for (let k = count - 2; k >= 0; k -= 1) {
                backward[k] = Math.max(need[k] as number, (backward[k + 1] as number) - drop);
            }
            for (let k = 0, at = start; k < count; k += 1, at += stride) {
                // Der Bedarf gilt über `hold` Zellen je Seite ohne Abzug; was weiter weg ist, sinkt mit dem Gefälle ab dem Rand
                // des Fensters: die Hülle von `hold` Zellen zurück, die vorwärts-, und `hold` Zellen voraus, die rückwärts gerechnet ist.
                let top = need[k] as number;
                for (let j = Math.max(0, k - hold + 1); j <= Math.min(count - 1, k + hold - 1); j += 1) {
                    if ((need[j] as number) > top) top = need[j] as number;
                }
                if (k - hold >= 0 && (forward[k - hold] as number) > top) top = forward[k - hold] as number;
                if (k + hold <= count - 1 && (backward[k + hold] as number) > top) top = backward[k + hold] as number;
                const g = ground[at] as number;
                const cap = Math.min(rule.ceiling, g + rule.reach);
                // Die Obergrenze gewinnt, nur der Boden selbst steht darüber.
                out[at] = Math.min(65_535, Math.round(Math.max(Math.min(top, cap), g)));
            }
        };
        if (dc === 1 && dr === 0) {
            for (let row = 0; row < rows; row += 1) line(row * cols, cols, 1);
        } else if (dc === 0) {
            for (let column = 0; column < cols; column += 1) line(column, rows, cols);
        } else if (dr === 1) {
            for (let column = 0; column < cols; column += 1) line(column, Math.min(cols - column, rows), cols + 1);
            for (let row = 1; row < rows; row += 1) line(row * cols, Math.min(cols, rows - row), cols + 1);
        } else {
            for (let column = 0; column < cols; column += 1) {
                line((rows - 1) * cols + column, Math.min(cols - column, rows), 1 - cols);
            }
            for (let row = 0; row < rows - 1; row += 1) line(row * cols, Math.min(cols, row + 1), 1 - cols);
        }
    });
    return { rule, ground, altitude };
}

/** Die Achse, die einer Richtung am nächsten liegt (bis 22,5° daneben). */
export function axisOf(dx: number, dy: number): number {
    const angle = Math.atan2(Math.abs(dy), dx >= 0 ? dx : -dx) * (dx * dy < 0 ? -1 : 1);
    // Winkel gegen die x-Achse in Achtelkreisen: 0 Ost-West, ±1 diagonal, 2 Nord-Süd.
    const octant = Math.round(angle / (Math.PI / 4));
    if (octant === 0) return 0;
    if (octant === 1) return 2;
    if (octant === -1) return 3;
    return 1;
}

/**
 * Der Preis eines Schritts von Zelle `from` zu Zelle `to` auf `axis`, in Karteneinheiten Strecke (zusätzlich zur
 * Länge `length` des Schritts): Halten über der Standardflughöhe plus Steigen darüber, wie `flightSurcharge`.
 */
export function stepExtra(field: AirCostField, axis: number, from: number, to: number, length: number): number {
    const { rule } = field;
    const altitude = field.altitude[axis] as Uint16Array;
    const before = Math.max(0, (altitude[from] as number) - (field.ground[from] as number) - rule.standard);
    const after = Math.max(0, (altitude[to] as number) - (field.ground[to] as number) - rule.standard);
    const rise = (altitude[to] as number) - (altitude[from] as number);
    return (
        (length * (before + after) * 0.5 * rule.holdFactor) / rule.scale +
        (Math.max(0, Math.min(rise, after - before)) * rule.climbFactor) / rule.schritt
    );
}

/**
 * Was eine Ecke kostet, an der der Flug von der Achse `from` auf die Achse `to` wechselt, in Karteneinheiten Strecke: Die Bahn
 * steht in der Zelle auf der neuen Achse anders als auf der alten, und das Steigen vom alten Stand auf den neuen zählt wie
 * jedes Steigen über der Standardflughöhe (`min(Zuwachs der Bahn, Zuwachs des Überstands)`). Ohne diese Kosten wäre jede Ecke
 * eine neue Hülle zum Nulltarif.
 */
export function turnExtra(field: AirCostField, from: number, to: number, index: number): number {
    const { rule } = field;
    const before = field.altitude[from] as Uint16Array;
    const after = field.altitude[to] as Uint16Array;
    const ground = field.ground[index] as number;
    const overBefore = Math.max(0, (before[index] as number) - ground - rule.standard);
    const overAfter = Math.max(0, (after[index] as number) - ground - rule.standard);
    const rise = (after[index] as number) - (before[index] as number);
    return (Math.max(0, Math.min(rise, overAfter - overBefore)) * rule.climbFactor) / rule.schritt;
}
