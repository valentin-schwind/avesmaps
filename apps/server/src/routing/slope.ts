import {
    familyStepFactor,
    routeDomain,
    SLOPE_FAMILIES,
    slopeFamily,
    travelSpeed,
    type SlopeFamily,
    type TravelModel,
} from "@avesmaps3d/shared";

/**
 * Steigung im Routing (WI-0049 S5a/S5c, Gutachten MCS-026, Betreiber 2026-09-27: „alles ja“, zu S5c „alle
 * empfehlungen: go“).
 *
 * - **Drei Familien** (S5c, MCS-026 Punkt 2), zugeordnet im Reisemodell (`steigung.familien`):
 *   - FOOT, der Leistungskilometer (J+S): P = 1 + (Anstieg/100 + steiler Abstieg/150) je Meile, je
 *     Richtung, ohne Bonus bergab und ohne Deckel;
 *   - EQUID, Reit- und Lasttiere: p(s) = max(1, e^(3,5 · (|s + 0,05| − 0,05))) je Abtastschritt;
 *   - WHEEL, Wagen: 1 + 200 · s² bergauf, bergab 1 + 200 · max(0, −s − 1/30)².
 *   s ist die Steigung eines Abtastschritts in Fahrtrichtung. FOOT rechnet aus den Summen der Paare,
 *   EQUID und WHEEL aus den Abtastwerten selbst; fehlen die (Profil vor S5c), gehen sie wie FOOT.
 * - **Kehrenregel** (E1): EQUID und WHEEL gehen steiler als der Knick G* ihrer Formel in Kehren mit G*;
 *   darüber wächst der Faktor linear. G* ist, wo p(G) / G am kleinsten ist (`switchbackGrade`).
 * - **Wo die GA die Steigung schon enthält** (Gebirgspass 0,4): Die GA gibt den Mittelwert vor, die
 *   Steigung nur die Abweichung davon. Zeit ∝ P / μ_Pass, μ je Familie längengewichtet über beide
 *   Richtungen der Pässe mit bekannter Höhe. Ein Pass ohne Höhe bleibt genau bei der GA.
 * - **Übrige Landwege:** an der Straße geeicht, Zeit ∝ P / μ_Straße der Familie.
 * - **Sternregel auf dem Weg** (E3): Wo eine Wegart unter `sternregel.imGebirge` in einer Gebirgsfläche
 *   liegt, geht das Mittel mit Tempo, Steigung und Eichung seines Fußmittels (`StarWalk`), je
 *   Abtastschritt abgegrenzt.
 *
 * - **Außerhalb der Gebirgsflächen** (F5c, Betreiber 2026-10-04 „F5: C“; das revidiert ADR-0016 vom 2026-10-02): Jeder
 *   Abtastschritt kostet P / μ_aussen, μ_aussen je Wegart und Familie das längengewichtete Mittel von P über die Schritte
 *   dieser Wegart außerhalb der Gebirge (`calibrate`, `FamilyCalibration.outside`). Im Mittel bleibt das Tempo jeder Wegart,
 *   eine Ebene geht ein wenig schneller, ein Hang langsamer. Der Gebirgsteil (Pass 0,4, Sternregel, Straßeneichung)
 *   rechnet nach seiner eigenen Eichung.
 *
 * 🔴 Ohne Wegprofile gilt Faktor 1, also genau das Verhalten vor S5a (Koordination 2026-09-27).
 */

/** Floats je Stützpunktpaar in `terrain_path_profile.pairs`. */
export const PAIR_FLOATS = 7;
/** Hoechster Punkt eines Paars ohne jede Hoehe. */
export const NO_HEIGHT = -1;
/**
 * `terrain_path_profile.samples` je Paar: die Zahl n der Abtastpunkte (0, wenn das Paar keine Höhe hat)
 * und die Länge eines Abtastschritts in Schritt, danach je Punkt die Höhe (NaN ohne Höhe) und 1, wenn er
 * in einer Gebirgsfläche liegt, sonst 0.
 */
export const SAMPLE_HEADER = 2;
export const SAMPLE_POINT = 2;
/**
 * Je Abtastschritt in `SlopeSums.steps`: Anstieg, Strecke, 1 im Gebirge, die Höhe am Anfang und wo er
 * beginnt, in Schritt ab dem Anfang des Stücks in Punktreihenfolge (S5d).
 */
export const STEP_FLOATS = 5;
/** 1 Meile = 1.000 Schritt. */
const SCHRITT_PER_MILE = 1000;
/** 1 E = 3 Meilen = 3.000 Schritt (MCS-002); so rechnen auch die Wegprofile. */
export const SCHRITT_PER_UNIT = 3000;

// Die Formeln der Familien und die Kehrenregel stehen in `shared`: Router und Kurvenbild im ⓘ Transportmittel
// rechnen mit demselben Rechner (WI-0049, Legacy-Owner: „was die Kurve zeigt, ist das, was die Route rechnet“).
export { familyStepFactor, SLOPE_FAMILIES, slopeFamily, switchbackGrade } from "@avesmaps3d/shared";
export type { SlopeFamily } from "@avesmaps3d/shared";

/** Die Summen eines Wegstücks in gespeicherter Punktreihenfolge. */
export interface SlopeSums {
    up: number;
    down: number;
    steepUp: number;
    steepDown: number;
    /** Hat irgendein Abtastschritt eine Höhe? Sonst weiß das Stück nichts über Steigung. */
    known: boolean;
    /** Höchster Punkt in Schritt, `NO_HEIGHT` ohne Höhe. */
    highest: number;
    /** Steilste Steigung und steilstes Gefälle eines Abtastschritts (Verhältnis) in Punktreihenfolge. */
    steepestUp: number;
    steepestDown: number;
    /**
     * Die Abtastschritte mit Höhe an beiden Enden, je Schritt `STEP_FLOATS` Zahlen: Anstieg in
     * Punktreihenfolge und Strecke, beides in Schritt, 1, wenn beide Enden in einer Gebirgsfläche liegen,
     * dazu die Höhe am Anfang und die Lage im Stück (S5d). Null ohne Abtastwerte: Dann gehen alle Familien
     * wie FOOT, und keine Sternregel greift (S5c).
     */
    steps: Float64Array | null;
}

export const NO_SLOPE: SlopeSums = {
    up: 0,
    down: 0,
    steepUp: 0,
    steepDown: 0,
    known: false,
    highest: NO_HEIGHT,
    steepestUp: 0,
    steepestDown: 0,
    steps: null,
};

/** Die Paare `[start, start + count)` eines Profils zusammengezählt; fehlende Paare zählen nicht. */
export function sumPairs(pairs: Float32Array, start: number, count: number): SlopeSums {
    const sums = { ...NO_SLOPE };
    const total = Math.floor(pairs.length / PAIR_FLOATS);
    for (let pair = Math.max(0, start); pair < Math.min(total, start + count); pair += 1) {
        const o = pair * PAIR_FLOATS;
        const highest = pairs[o + 4] ?? NO_HEIGHT;
        if (highest === NO_HEIGHT) continue;
        sums.known = true;
        sums.up += pairs[o] ?? 0;
        sums.down += pairs[o + 1] ?? 0;
        sums.steepUp += pairs[o + 2] ?? 0;
        sums.steepDown += pairs[o + 3] ?? 0;
        sums.highest = Math.max(sums.highest, highest);
        sums.steepestUp = Math.max(sums.steepestUp, pairs[o + 5] ?? 0);
        sums.steepestDown = Math.max(sums.steepestDown, pairs[o + 6] ?? 0);
    }
    return sums;
}

/** Wo die Abtastwerte jedes Paars beginnen; null, wenn die Reihe nicht genau `pairCount` Paare trägt. */
export function sampleOffsets(samples: Float32Array, pairCount: number): Int32Array | null {
    const offsets = new Int32Array(pairCount);
    let o = 0;
    for (let pair = 0; pair < pairCount; pair += 1) {
        const n = samples[o];
        if (n === undefined || !Number.isInteger(n) || n < 0) return null;
        offsets[pair] = o;
        o += SAMPLE_HEADER + SAMPLE_POINT * n;
    }
    return o === samples.length ? offsets : null;
}

/** Keine Abtastschritte: von allen Stücken ohne Höhe geteilt (rund 7.000 leere Reihen kosteten 1,4 MB Heap). */
const NO_STEPS = new Float64Array(0);

/**
 * Die Abtastschritte der Paare `[start, start + count)`, die an beiden Enden eine Höhe haben. `lengths`
 * sind die Längen aller Paare des Weges in Schritt; aus ihnen folgt, wo ein Schritt im Stück liegt (ein
 * Paar ohne Höhe trägt seine Länge nicht selbst).
 */
export function pairSteps(
    samples: Float32Array,
    offsets: Int32Array,
    start: number,
    count: number,
    lengths: ArrayLike<number>,
): Float64Array {
    const steps: number[] = [];
    let begin = 0;
    for (let pair = Math.max(0, start); pair < Math.min(offsets.length, start + count); pair += 1) {
        const o = offsets[pair] as number;
        const n = samples[o] as number;
        const run = samples[o + 1] as number;
        for (let k = 1; k < n; k += 1) {
            const at = o + SAMPLE_HEADER + SAMPLE_POINT * k;
            const a = samples[at - SAMPLE_POINT] as number;
            const b = samples[at] as number;
            if (Number.isNaN(a) || Number.isNaN(b)) continue;
            const mountain = samples[at - SAMPLE_POINT + 1] === 1 && samples[at + 1] === 1 ? 1 : 0;
            steps.push(b - a, run, mountain, a, begin + (k - 1) * run);
        }
        begin += lengths[pair] ?? 0;
    }
    return steps.length > 0 ? Float64Array.from(steps) : NO_STEPS;
}

/** Die Höhen eines Stücks in Fahrtrichtung (S5d), in Schritt; `steepest` mit Vorzeichen (+ bergauf). */
export interface SlopeShape {
    ascent: number;
    descent: number;
    highest: number;
    steepest: number;
}

/** Die Steigung, deren Betrag größer ist; bei Gleichstand die erste. */
const steeper = (a: number, b: number): number => (Math.abs(b) > Math.abs(a) ? b : a);

/**
 * Der steilste Abschnitt über `window` Schritt in EINER zusammenhängenden Höhenlinie (S5d): die größte
 * mittlere Steigung zwischen zwei Stellen im Abstand `window`, mit Vorzeichen in Richtung der Lage. Zwischen
 * den Punkten gilt die Gerade; das Maximum liegt immer an einem Fenster, das an einem Punkt beginnt oder
 * endet. Eine Linie, die kürzer ist als das Fenster, zählt als Ganzes.
 */
export function steepestOver(positions: readonly number[], heights: readonly number[], window: number): number {
    const n = Math.min(positions.length, heights.length);
    if (n < 2) return 0;
    const first = positions[0] as number;
    const last = positions[n - 1] as number;
    const length = last - first;
    if (!(length > 0)) return 0;
    if (length <= window) return ((heights[n - 1] as number) - (heights[0] as number)) / length;
    const heightAt = (index: number, at: number): number => {
        const s0 = positions[index] as number;
        const s1 = positions[index + 1] as number;
        const h0 = heights[index] as number;
        const h1 = heights[index + 1] as number;
        return s1 > s0 ? h0 + ((h1 - h0) * (at - s0)) / (s1 - s0) : h1;
    };
    let best = 0;
    let j = 0;
    for (let i = 0; i < n; i += 1) {
        const end = (positions[i] as number) + window;
        if (end > last) break;
        while (j < n - 2 && (positions[j + 1] as number) < end) j += 1;
        best = steeper(best, (heightAt(j, end) - (heights[i] as number)) / window);
    }
    let k = n - 1;
    for (let i = n - 1; i >= 0; i -= 1) {
        const start = (positions[i] as number) - window;
        if (start < first) break;
        while (k > 1 && (positions[k - 1] as number) > start) k -= 1;
        best = steeper(best, ((heights[i] as number) - heightAt(k - 1, start)) / window);
    }
    return best;
}

/** Punkte näher als das (in Schritt) sind derselbe Punkt, etwa die Grenze zweier Paare. */
const SAME_POINT = 0.01;

/**
 * Sammelt eine Höhenlinie in Fahrtrichtung, Stück für Stück, und merkt sich ihren steilsten Abschnitt über
 * das Fenster (S5d). Ein Stück endet an einer Stelle ohne Höhe oder an einer Lücke (`close`).
 */
export class HeightLine {
    private readonly window: number;
    private positions: number[] = [];
    private heights: number[] = [];
    steepest = 0;

    constructor(window: number) {
        this.window = window;
    }

    /** Ein Punkt der Linie, Lage in Schritt; `null` ohne Höhe beendet das laufende Stück. */
    add(position: number, height: number | null): void {
        if (height === null) {
            this.close();
            return;
        }
        const last = this.positions[this.positions.length - 1];
        if (last !== undefined && position - last <= SAME_POINT) return;
        this.positions.push(position);
        this.heights.push(height);
    }

    /** Beendet das laufende Stück; das nächste hängt nicht an ihm. */
    close(): void {
        this.steepest = steeper(this.steepest, steepestOver(this.positions, this.heights, this.window));
        this.positions = [];
        this.heights = [];
    }
}

/**
 * Anstieg, Abstieg, höchster Punkt und steilster Abschnitt über `window` Schritt eines Wegstücks in
 * Fahrtrichtung (S5d). `span` (in Schritt ab dem Anfang des Stücks, Punktreihenfolge) wählt den Teil
 * eines geteilten Weges: Ein Schritt gehört dazu, wenn seine Mitte darin liegt. Null, wo keine Höhe
 * bekannt ist.
 */
export function slopeShape(
    sums: SlopeSums,
    forward: boolean,
    span: { from: number; to: number } | null = null,
    window = 750,
): SlopeShape | null {
    if (!sums.known) return null;
    const steps = sums.steps;
    if (steps === null) {
        // Profil von vor S5c: nur die Summen, und die gelten nur für das ganze Stück.
        if (span !== null) return null;
        const up = forward ? sums.steepestUp : sums.steepestDown;
        const down = forward ? sums.steepestDown : sums.steepestUp;
        return {
            ascent: forward ? sums.up : sums.down,
            descent: forward ? sums.down : sums.up,
            highest: sums.highest,
            steepest: down > up ? -down : up,
        };
    }
    const shape: SlopeShape = { ascent: 0, descent: 0, highest: -Infinity, steepest: 0 };
    // In Punktreihenfolge gesammelt; rückwärts ist derselbe Abschnitt der steilste, mit anderem Vorzeichen.
    const line = new HeightLine(window);
    let end = Number.NEGATIVE_INFINITY;
    let any = false;
    for (let index = 0; index + STEP_FLOATS <= steps.length; index += STEP_FLOATS) {
        const rise = steps[index] as number;
        const run = steps[index + 1] as number;
        const at = steps[index + 3] as number;
        const offset = steps[index + 4] as number;
        if (span !== null) {
            const middle = offset + run / 2;
            if (middle < span.from || middle >= span.to) continue;
        }
        any = true;
        const up = forward ? rise : -rise;
        if (up > 0) shape.ascent += up;
        else shape.descent -= up;
        shape.highest = Math.max(shape.highest, at, at + rise);
        if (Math.abs(offset - end) > 1) line.close();
        line.add(offset, at);
        line.add(offset + run, at + rise);
        end = offset + run;
    }
    line.close();
    shape.steepest = forward || line.steepest === 0 ? line.steepest : -line.steepest;
    return any ? shape : null;
}

/**
 * Der Leistungskilometer-Faktor einer Richtung. Vorwärts zählen Anstieg und steiler Abstieg, rückwärts
 * ist der Abstieg der Anstieg und der steile Anstieg der steile Abstieg. Nie unter 1.
 */
export function footFactor(sums: SlopeSums, miles: number, forward: boolean, model: TravelModel): number {
    if (!sums.known || !(miles > 0)) return 1;
    if (sums.steps !== null)
        return 1 + stepsExtra("FOOT", sums.steps, forward, model, true).extra / (miles * SCHRITT_PER_MILE);
    const rule = model.steigung.wert;
    const up = forward ? sums.up : sums.down;
    const steepDown = forward ? sums.steepDown : sums.steepUp;
    return 1 + (up / rule.anstiegSchrittJeMeile + steepDown / rule.steilerAbstiegSchrittJeMeile) / miles;
}

/**
 * Der Mehrweg der Schritte in Schritt, `run · (p − 1)` summiert, und ihre Strecke. `mountain` wählt nur die
 * Schritte in Gebirgsflächen (true) oder nur die übrigen (false); null nimmt alle.
 */
function stepsExtra(
    family: SlopeFamily,
    steps: Float64Array,
    forward: boolean,
    model: TravelModel,
    mountain: boolean | null = null,
): { extra: number; run: number } {
    let extra = 0;
    let run = 0;
    for (let index = 0; index + 2 < steps.length; index += STEP_FLOATS) {
        if (mountain !== null && (steps[index + 2] === 1) !== mountain) continue;
        const rise = steps[index] as number;
        const length = steps[index + 1] as number;
        if (!(length > 0)) continue;
        run += length;
        extra += length * (familyStepFactor(family, (forward ? rise : -rise) / length, model) - 1);
    }
    return { extra, run };
}

/** Der Mehrweg und die Strecke der Schritte in Gebirgsflächen und außerhalb, in einem Lauf (F5c). */
interface StepsSplit {
    mountain: { extra: number; run: number };
    outside: { extra: number; run: number };
}

/** Wie `stepsExtra`, aber beide Gruppen auf einmal: Ein Lauf über die Schritte statt zwei. */
function stepsSplit(family: SlopeFamily, steps: Float64Array, forward: boolean, model: TravelModel): StepsSplit {
    const split: StepsSplit = { mountain: { extra: 0, run: 0 }, outside: { extra: 0, run: 0 } };
    for (let index = 0; index + 2 < steps.length; index += STEP_FLOATS) {
        const rise = steps[index] as number;
        const length = steps[index + 1] as number;
        if (!(length > 0)) continue;
        const own = steps[index + 2] === 1 ? split.mountain : split.outside;
        own.run += length;
        own.extra += length * (familyStepFactor(family, (forward ? rise : -rise) / length, model) - 1);
    }
    return split;
}

/**
 * Der Faktor einer Richtung in der Familie: die Summe der Schritte, jeder mit seiner Steigung, über die
 * ganze Länge. Ein Schritt ohne Höhe zählt als eben.
 */
export function familyFactor(
    family: SlopeFamily,
    sums: SlopeSums,
    miles: number,
    forward: boolean,
    model: TravelModel,
): number {
    if (family === "FOOT" || sums.steps === null) return footFactor(sums, miles, forward, model);
    if (!sums.known || !(miles > 0)) return 1;
    return 1 + stepsExtra(family, sums.steps, forward, model, true).extra / (miles * SCHRITT_PER_MILE);
}

/** Die Eichung einer Familie: mittlerer Faktor je Bezugsgruppe, längengewichtet über beide Richtungen. */
export interface FamilyCalibration {
    /** μ der Eichwegart (Straße) über alle ihre Stücke; ohne Höhe zählt ein Stück mit 1. */
    street: number;
    /** μ je Wegart mit GA-Steigung (Gebirgspass) über die Stücke mit bekannter Höhe. */
    gaSlope: Record<string, number>;
    /**
     * F5c (Betreiber 2026-10-04 „F5: C“): μ je Landwegart über ihre Schritte AUSSERHALB der Gebirgsflächen, das
     * längengewichtete Mittel von P über beide Richtungen. Jede Wegart und Familie behält so im Mittel ihr Tempo; ohne
     * Eintrag (Wegart ohne Abtastschritte außerhalb) gilt dort Faktor 1.
     */
    outside: Record<string, number>;
}

/** Die Eichung je Familie: Jede trifft auf der Straße und auf dem Pass für sich im Mittel die GA. */
export type SlopeCalibration = Record<SlopeFamily, FamilyCalibration>;

/** Was die Eichung von einem Wegstück wissen muss. */
export interface CalibrationPiece {
    subtype: string;
    /** Länge in Karteneinheiten. */
    distance: number;
    sums: SlopeSums;
}

export function calibrate(pieces: Iterable<CalibrationPiece>, model: TravelModel): SlopeCalibration {
    const rule = model.steigung.wert;
    const miles = model.meilenJeKarteneinheit.wert;
    const sums = SLOPE_FAMILIES.map(() => ({
        streetLength: 0,
        streetWeighted: 0,
        ga: new Map<string, { length: number; weighted: number }>(),
        outside: new Map<string, { length: number; weighted: number }>(),
    }));
    for (const piece of pieces) {
        // F5c: jede Landwegart an ihren Schritten außerhalb der Gebirge, je Familie.
        if (piece.sums.steps !== null && routeDomain(piece.subtype) === "land") {
            const steps = piece.sums.steps;
            SLOPE_FAMILIES.forEach((family, index) => {
                const forward = stepsSplit(family, steps, true, model).outside;
                if (!(forward.run > 0)) return;
                const backward = stepsSplit(family, steps, false, model).outside;
                const own = (sums[index] as (typeof sums)[number]).outside;
                const entry = own.get(piece.subtype) ?? { length: 0, weighted: 0 };
                entry.length += 2 * forward.run;
                entry.weighted += 2 * forward.run + forward.extra + backward.extra;
                own.set(piece.subtype, entry);
            });
        }
        const length =
            piece.sums.steps !== null
                ? stepsExtra("FOOT", piece.sums.steps, true, model, true).run / SCHRITT_PER_MILE
                : piece.distance * miles;
        if (!(length > 0)) continue;
        const street = piece.subtype === rule.eichWegart;
        const ga = !street && rule.gaMitSteigung.includes(piece.subtype) && piece.sums.known;
        if (!street && !ga) continue;
        SLOPE_FAMILIES.forEach((family, index) => {
            const own = sums[index] as (typeof sums)[number];
            const both =
                familyFactor(family, piece.sums, length, true, model) +
                familyFactor(family, piece.sums, length, false, model);
            if (street) {
                own.streetLength += 2 * length;
                own.streetWeighted += length * both;
            } else {
                const entry = own.ga.get(piece.subtype) ?? { length: 0, weighted: 0 };
                entry.length += 2 * length;
                entry.weighted += length * both;
                own.ga.set(piece.subtype, entry);
            }
        });
    }
    const result = {} as SlopeCalibration;
    SLOPE_FAMILIES.forEach((family, index) => {
        const own = sums[index] as (typeof sums)[number];
        result[family] = {
            street: own.streetLength > 0 ? own.streetWeighted / own.streetLength : 1,
            gaSlope: Object.fromEntries(
                [...own.ga].map(([subtype, entry]) => [subtype, entry.weighted / entry.length]),
            ),
            outside: Object.fromEntries(
                [...own.outside].map(([subtype, entry]) => [subtype, entry.weighted / entry.length]),
            ),
        };
    });
    return result;
}

/**
 * Wie ein Mittel im Sterngelände eines Weges geht (GA S. 123, E3): mit Familie, Tempo und Eichung seines
 * Fußmittels. `ratio` ist Tempo des Mittels durch Tempo des Fußmittels auf dieser Wegart, bei einem geführten Tier durch
 * das langsamere Tempo, das es dort geführt hat (`sternregel.gefuehrt`, WI-0258 E5: Fußtempo mal tier / fuss).
 */
export interface StarWalk {
    family: SlopeFamily;
    ratio: number;
}

/**
 * Die Sternregel eines Mittels auf einer Wegart (`Querfeldein` für den Gang): null, wenn die Wegart in
 * Gebirgsflächen kein Sterngelände ist oder das Mittel dort nicht absteigt.
 */
export function starWalk(model: TravelModel, transport: string, subtype: string): StarWalk | null {
    const rule = model.steigung.wert.sternregel;
    const walker = rule.absteigen[transport];
    if (walker === undefined || !rule.imGebirge.includes(subtype)) return null;
    const own = travelSpeed(model, transport, subtype);
    const afoot = travelSpeed(model, walker, subtype);
    if (own === null || afoot === null) return null;
    // Geführt (WdE S. 161) ist das Tier im Gebirge langsamer als die Gruppe zu Fuß: Pfad 7 gegen 9, querfeldein 3 gegen 6.
    const led = rule.gefuehrt[subtype];
    const pace = led === undefined ? 1 : led.tier / led.fuss;
    return { family: slopeFamily(model, walker), ratio: own / (afoot * pace) };
}

/**
 * Um wie viel die Zeit eines Landwegstücks in dieser Richtung wächst, gemessen an der Zeit aus den
 * Tempi, für ein Reisemittel der Familie `family`. `calibration` null heißt: keine Wegprofile, alles wie
 * vor S5a. Mit `star` gehen die Abtastschritte in Gebirgsflächen zu Fuß (Sternregel); die übrigen wie sonst.
 * Abtastschritte außerhalb der Gebirgsflächen kosten seit F5c P / μ_aussen der Wegart (`FamilyCalibration.outside`).
 * `level`: jeder Abtastschritt eben (P = 1), sonst alles gleich, auch Eichung und Sternregel - die Bezugszeit
 * der Mehrzeit durch Steigung (S5d).
 */
export function slopeTimeFactor(
    subtype: string,
    distance: number,
    sums: SlopeSums,
    forward: boolean,
    model: TravelModel,
    calibration: SlopeCalibration | null,
    family: SlopeFamily = "FOOT",
    star: StarWalk | null = null,
    level = false,
): number {
    // Ein Boot steigt nicht (Owner Legacy 2026-07-30): Fluss und See bleiben, wie sie sind.
    if (calibration === null || routeDomain(subtype) !== "land") return 1;
    const rule = model.steigung.wert;
    const miles = distance * model.meilenJeKarteneinheit.wert;
    const ga = rule.gaMitSteigung.includes(subtype);
    const muOf = (own: SlopeFamily): number | undefined =>
        ga ? calibration[own].gaSlope[subtype] : calibration[own].street;
    const mu = muOf(family);
    if (sums.steps && miles > 0) {
        const { mountain, outside: open } = stepsSplit(family, sums.steps, forward, model);
        const length = miles * SCHRITT_PER_MILE;
        // F5c: Außerhalb der Gebirgsflächen kostet jeder Abtastschritt P / μ_aussen der Wegart in der eigenen Familie (keine
        // Sternregel dort), im Mittel genau das Tempo der Wegart; ein Stück ohne Eichung oder ohne Höhe zählt 1.
        const muOutside = calibration[family].outside[subtype];
        const known = muOutside === undefined ? open.run : (open.run + (level ? 0 : open.extra)) / muOutside;
        const outside = Math.max(0, length - mountain.run - open.run) + known;
        if (mountain.run === 0) return outside / length;
        if (star) {
            const walked = stepsExtra(star.family, sums.steps, forward, model, true);
            const muStar = muOf(star.family) ?? 1;
            return (outside + (star.ratio * (walked.run + (level ? 0 : walked.extra))) / muStar) / length;
        }
        return (outside + (mountain.run + (level ? 0 : mountain.extra)) / (mu ?? 1)) / length;
    }
    if (mu === undefined || (ga && !sums.known)) return 1;
    return (level ? 1 : familyFactor(family, sums, miles, forward, model)) / mu;
}
