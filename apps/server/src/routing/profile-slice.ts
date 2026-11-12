import { NO_HEIGHT, NO_SLOPE, PAIR_FLOATS, SAMPLE_HEADER, SAMPLE_POINT, type SlopeSums } from "./slope.ts";
import type { Station } from "./topology.ts";

/**
 * Das Höhenprofil eines Wegstücks zwischen zwei Stellen der gespeicherten Linie (WI-0132 Release N).
 *
 * Bis Release N begann und endete jedes Stück an einem Stützpunkt, also an der Grenze zweier Paare von
 * `terrain_path_profile`. Ein T-Stoß auf einem Segment teilt den Weg jetzt auch MITTEN in einem Paar. Dann gilt:
 *
 * - **Abtastschritte** (S5c, die Grundlage jeder Familie, der Eichung und der Kurve) werden genau geteilt: Ein Schritt, der
 *   ganz im Stück liegt, geht unverändert hinein; einer, den die Teilung schneidet, geht mit seinem Anteil hinein, gerade
 *   zwischen seinen beiden Abtastpunkten (so ist das Profil gerechnet, `profileLine`). Steigung, Strecke und Mehrweg über
 *   alle Stücke eines Weges bleiben damit genau die des ganzen Weges.
 * - **Summen eines Paars** (nur für Profile von vor S5c ohne Abtastwerte): Anstieg, Abstieg und steile Anteile nach dem
 *   Anteil der Strecke, höchster Punkt und steilster Schritt vom ganzen Paar. Eine Näherung, nur für alte Profile.
 *
 * 🔴 Ein Stück, das an Stützpunkten beginnt und endet, bekommt bitgleich dieselben Werte wie bisher
 * (`sumPairs`/`pairSteps`); nur geteilte Paare rechnen anders.
 */

export interface ProfileInput {
    pairs: Float32Array;
    /** Die Abtastwerte und wo jedes Paar in ihnen beginnt; fehlen vor S5c. */
    samples: { values: Float32Array; offsets: Int32Array } | null;
    /** Die Länge jedes Paars in Schritt, aus der gespeicherten Linie. */
    lengths: ArrayLike<number>;
}

/** Keine Abtastschritte: von allen Stücken ohne Höhe geteilt. */
const NO_STEPS = new Float64Array(0);

/** Das Profil des Stücks von `from` bis `to` (Stellen auf der gespeicherten Linie, `from` vor `to`). */
export function sliceProfile(profile: ProfileInput, from: Station, to: Station): SlopeSums {
    const { pairs, samples, lengths } = profile;
    const sums: SlopeSums = { ...NO_SLOPE };
    const steps: number[] = [];
    const total = Math.floor(pairs.length / PAIR_FLOATS);
    const last = to.t > 0 ? to.pair : to.pair - 1;
    let begin = 0;
    for (let pair = Math.max(0, from.pair); pair <= last && pair < total; pair += 1) {
        const lo = pair === from.pair ? from.t : 0;
        const hi = pair === to.pair ? to.t : 1;
        const share = hi - lo;
        if (!(share > 0)) continue;
        const o = pair * PAIR_FLOATS;
        const highest = pairs[o + 4] ?? NO_HEIGHT;
        if (highest !== NO_HEIGHT) {
            sums.known = true;
            sums.up += (pairs[o] ?? 0) * share;
            sums.down += (pairs[o + 1] ?? 0) * share;
            sums.steepUp += (pairs[o + 2] ?? 0) * share;
            sums.steepDown += (pairs[o + 3] ?? 0) * share;
            sums.highest = Math.max(sums.highest, highest);
            sums.steepestUp = Math.max(sums.steepestUp, pairs[o + 5] ?? 0);
            sums.steepestDown = Math.max(sums.steepestDown, pairs[o + 6] ?? 0);
        }
        if (samples) pushSteps(steps, samples, pair, lo, hi, begin);
        begin += share === 1 ? (lengths[pair] ?? 0) : share * (lengths[pair] ?? 0);
    }
    if (samples) sums.steps = steps.length > 0 ? Float64Array.from(steps) : NO_STEPS;
    return sums;
}

/**
 * Die Schritte des Paars `pair` im Anteil `lo` bis `hi`, Lage in Schritt ab dem Anfang des Stücks (`begin` ist, was davor
 * liegt). Aufbau je Schritt wie `pairSteps`: Anstieg, Strecke, 1 im Gebirge, Höhe am Anfang, Lage.
 */
function pushSteps(
    steps: number[],
    samples: NonNullable<ProfileInput["samples"]>,
    pair: number,
    lo: number,
    hi: number,
    begin: number,
): void {
    const o = samples.offsets[pair];
    if (o === undefined) return;
    const values = samples.values;
    const n = values[o] as number;
    const run = values[o + 1] as number;
    if (!(n > 1)) return;
    // Ein Paar der Länge 0 (doppelter Stützpunkt) hat `run` 0: Alle seine Schritte liegen dann ganz im Stück.
    const length = (n - 1) * run;
    const from = lo * length;
    const to = hi * length;
    for (let k = 1; k < n; k += 1) {
        const at = o + SAMPLE_HEADER + SAMPLE_POINT * k;
        const a = values[at - SAMPLE_POINT] as number;
        const b = values[at] as number;
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        const mountain = values[at - SAMPLE_POINT + 1] === 1 && values[at + 1] === 1 ? 1 : 0;
        const start = (k - 1) * run;
        const end = k * run;
        if (start >= from && end <= to) {
            // Ganz im Stück: unverändert (bitgleich mit `pairSteps` für ungeteilte Paare).
            steps.push(b - a, run, mountain, a, begin + start - from);
            continue;
        }
        const x0 = Math.max(start, from);
        const x1 = Math.min(end, to);
        if (!(x1 > x0)) continue;
        const u0 = (x0 - start) / run;
        const u1 = (x1 - start) / run;
        steps.push((b - a) * (u1 - u0), run * (u1 - u0), mountain, a + (b - a) * u0, begin + x0 - from);
    }
}
