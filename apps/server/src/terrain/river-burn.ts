import type { StoredRaster } from "./dem-tiles.ts";
import { valleyGrade, valleyHeight, valleyReach, type RiverValley } from "./river-valley.ts";
import { DEFAULT_CONE, type ConeRule, type FreePeak } from "./peak-cone.ts";
import {
    buffersOf,
    conesAt,
    demHeight,
    EPS,
    fieldOf,
    lowerAt,
    lowerDemAt,
    rasterHeight,
    RISE_TOLERANCE,
    sampleRuns,
    setzeAt,
    touchesField,
    type Field,
    type FieldRaster,
    type RiverAnchor,
} from "./river-field.ts";
import { pointInGeometry } from "@avesmaps3d/shared";
import {
    hebeEinlaeufe,
    lakeCellsOf,
    lakePointsOf,
    lakeSurfaces,
    lakeTops,
    levelLakes,
    type LakeCells,
} from "./river-lakes.ts";
import {
    buildRiverNetwork,
    type DirectionSource,
    type RiverLake,
    type RiverNetwork,
    type RiverRow,
    type RiverRun,
    RIVER_STEP,
} from "./river-network.ts";

export { RISE_TOLERANCE, type RiverAnchor } from "./river-field.ts";

/**
 * Flüsse ins Höhenmodell einbrennen (WI-0049 S6). Betreiber 2026-09-28: „kann man die flussrichtung von
 * bächen und flüssen bei der erosion berücksichtigen? im moment gibt es stellen wo flüsse bergauf fließen“.
 *
 * 🔴 Die Regel:
 * - **Das Bett fällt in Fließrichtung nie:** Bett(s) = min(Gelände(s), Bett(s − ds)), über Knoten,
 *   T-Stöße und Seen hinweg (`river-network.ts`). Ein Riegel wird durchbrochen, statt oberhalb
 *   aufzufüllen; ein Lauf, der das Gebirge verlässt und wieder hineinläuft, trägt sein Bett weiter.
 * - **Domain-Tal:** `context.riverValley` steuert weiche Flussflanken mit begrenzter maximaler Profilsteigung.
 *   Sohle und äußerer Übergang sind horizontal; Seeufer behalten die bisherige Form. Ohne diese Option
 *   bleibt der historische Seed-Pfad bytegleich. Mit `riverValley.gebirge` (WI-0249, nur Fassung 19) wird die
 *   Flanke steiler, je höher das Land am Fluss liegt (`valleyGrade`): Ein Tal unter einem hohen Massiv bleibt
 *   schmal, statt mit der Tiefe des Einschnitts kilometerweit breit zu werden.
 * - **Historischer Graben:** Wo das Bett um D unter dem Gelände am Fluss liegt, sinkt das Gelände daneben um
 *   D − (Abstand − Sohle) · Flanke, nie tiefer als die Talfläche Bett + (Abstand − Sohle) · Flanke.
 *   Die Flanke ist die Kegelsteigung der freien Gipfel (30 %, K2); ein tieferer Einschnitt wird damit von
 *   selbst breiter. Die Sohle ist eine Rasterzelle breit: schmaler kann das Raster (0,25 E) sie nicht
 *   tragen, und das bilineare Lesen am Fluss sähe sonst die Hänge.
 * - **Seen** (Betreiber 2026-09-28: „wenn ein see auf der höhe eines flusses ist, muss der see an dieser
 *   höhe sein“): Der Spiegel ist das Bett am Abfluss, bei mehreren der tiefste; dort liegt es auf dem
 *   tiefsten Punkt des Sees (`bedsOf`). Nur nach unten: Ein Zufluss unter dem Spiegel zieht den See herab,
 *   und alles flussab folgt. Im Gebirge wird die Seefläche auf den Spiegel gebracht, per min, mit derselben
 *   Flanke am Ufer. Seen ohne Fluss bleiben, wie sie sind.
 * - **Genau:** Danach wird so lange nachgeschnitten, bis kein Lauf an einem Abtastpunkt (alle 1/32 E) mehr
 *   als `RISE_TOLERANCE` über einer früheren Stelle liegt, gelesen wie das Routing (Raster) und wie die
 *   Karte in 3D (Höhenkacheln z3). Nachgeschnitten werden nur die Zellen unter einem Punkt, der steigt, auf
 *   die ganze Zahl unter seinem Bett. Das Ergebnis ist ein Fixpunkt: zweimal einbrennen ist einmal.
 *
 * Geschnitten werden nur die Gebirgsraster (`terrain_raster`), in Schritt; außerhalb eines Gebirges ist
 * das Gelände 0 und bleibt es. 🔴 **Die Gipfel im Gebirge bleiben stehen** (`lockedCells`); ein Lauf, der
 * deshalb an einem Gipfel steigt, steht in `peakRises`. 🪤 **Die Kegel der freien Gipfel schneidet diese
 * Regel nicht:** Sie stehen nicht als Raster in der Datenbank, sondern werden aus `terrain_peak` gerechnet,
 * von den Kacheln wie vom Routing. Ein Lauf, den ein Kegel anhebt, steht in `coneRises`.
 *
 * Legacy V12 zieht Täler nur innerhalb eines Gebirges ab, höchstens 400 Schritt tief und nie unter ein
 * Viertel der Höhe (`valleys.ts`); die Talachse ist eine Zelle breit. Das bleibt unverändert, gebrannt wird
 * danach auf die gespeicherten Raster.
 */

/** Steigt mit jeder Änderung an der Regel; geht in den Fingerabdruck. */
export const RIVER_BURN_VERSION = "1";
/** Die Flanke: Steigung der Grabenwand, wie die Kegel der freien Gipfel (Betreiber 2026-09-27, K2). */
export const FLANK_GRADE = (() => {
    if (DEFAULT_CONE.kind !== "steigung") throw new Error("Historical river burn requires a grade cone");
    return DEFAULT_CONE.steigung;
})();
/** Halbe Breite der Sohle in Karteneinheiten: eine Rasterzelle. */
export const FLOOR_HALF_WIDTH = 0.25;
/** Ab dieser Tiefe (Schritt) gilt ein Einschnitt als Befund. */
export const DEEP_CUT = 1000;
const SCHRITT_PER_UNIT = 3000;
const FLANK = FLANK_GRADE * SCHRITT_PER_UNIT;

/**
 * So weit (Karteneinheiten) reicht der Graben um eine Strecke: die halbe Sohle plus die Tiefe des Einschnitts durch
 * die Flanke. Eine Quelle für `trench` und für die Gruppen des Einbrennens (`burn-groups.ts`): Deren Grenze
 * muss genau so weit reichen wie der Graben, sonst schneidet ein Lauf in ein Raster, das nicht zu seiner Gruppe gehört.
 */
export function trenchReach(floor: number, deepest: number): number {
    return floor + deepest / FLANK;
}
/** Höchstens so viele Runden Nachschneiden; jede senkt ganze Schritt, das Ende ist also sicher. */
const MAX_ROUNDS = 400;
/** So viele Abtastpunkte (0,375 E) geht das Nachschneiden nach einer Senkung zurück. */
const WALK_BACK = 12;

/**
 * Der tiefste Zufluss je See, gemessen am Gelände auf dem letzten Stück vor dem See: Das tiefste Gelände der Punkte, die
 * höchstens `reach` Karteneinheiten flussauf von der Mündung liegen. `Infinity` für einen See ohne Zufluss.
 */
function mouthLevels(
    network: RiverNetwork,
    near: readonly boolean[],
    heights: readonly Float64Array[],
    reach: number,
): Float64Array {
    const levels = new Float64Array(network.lakes.length).fill(Infinity);
    const span = Math.max(1, Math.ceil(reach / RIVER_STEP));
    network.runs.forEach((run, r) => {
        if (!near[r]) return;
        const h = heights[r] as Float64Array;
        const entries: { lake: number; at: number }[] = [];
        for (let i = 0; i < run.lake.length; i += 1) {
            const l = run.lake[i] as number;
            if (l >= 0 && (i === 0 || run.lake[i - 1] !== l)) entries.push({ lake: l, at: i });
        }
        if (run.endLake >= 0 && (run.lake[run.lake.length - 1] as number) < 0)
            entries.push({ lake: run.endLake, at: run.lake.length });
        for (const { lake, at } of entries) {
            let low = Infinity;
            for (let j = at - 1; j >= 0 && (run.lake[j] as number) < 0 && at - j <= span; j -= 1)
                low = Math.min(low, h[j] as number);
            levels[lake] = Math.min(levels[lake] as number, low);
        }
    });
    return levels;
}

/** Eine eigene Höhe an einem Fluss oder See (WI-0249, `WasserHoehe` der Topographie): Lage und Höhe in Schritt. */
export interface WasserPunkt {
    x: number;
    y: number;
    h: number;
}

/** Ein Stützpunkt trifft einen Abtastpunkt (die Abtastung nimmt jeden Stützpunkt mit, `RIVER_STEP`): Lage bis auf Rundung. */
const PIN_LAGE = 1e-4;

/**
 * Die eigenen Höhen je Abtastpunkt (WI-0249; Vali wählte A, 2026-10-26; nur Fassung 19): je Lauf die Punkte, die einen gesetzten Stützpunkt
 * treffen, und zwischen zwei solchen im selben Lauf linear über die Strecke; sonst NaN, und dort gilt die Regel „Flüsse fallen“. Punkte in einem
 * See zählen nicht (dort gilt der See). `null` für einen Lauf ohne eigene Höhe; ohne Punkte `undefined` (alles wie zuvor).
 */
export function gepinnteLaeufe(
    network: RiverNetwork,
    punkte: readonly WasserPunkt[] | undefined,
): (Float64Array | null)[] | undefined {
    if (!punkte?.length) return undefined;
    let irgendeiner = false;
    const aus = network.runs.map((run) => {
        const marken: { i: number; h: number }[] = [];
        for (let i = 0; i < run.xs.length; i += 1) {
            if ((run.lake[i] as number) >= 0) continue;
            const x = run.xs[i] as number;
            const y = run.ys[i] as number;
            const treffer = punkte.find((q) => Math.abs(q.x - x) <= PIN_LAGE && Math.abs(q.y - y) <= PIN_LAGE);
            if (treffer && marken.at(-1)?.i !== i) marken.push({ i, h: treffer.h });
        }
        if (marken.length === 0) return null;
        irgendeiner = true;
        const werte = new Float64Array(run.xs.length).fill(Number.NaN);
        for (const m of marken) werte[m.i] = m.h;
        for (let m = 1; m < marken.length; m += 1) {
            const a = marken[m - 1]!;
            const b = marken[m]!;
            let laenge = 0;
            const strecke = [0];
            for (let i = a.i + 1; i <= b.i; i += 1) {
                laenge += Math.hypot(
                    (run.xs[i] as number) - (run.xs[i - 1] as number),
                    (run.ys[i] as number) - (run.ys[i - 1] as number),
                );
                strecke.push(laenge);
            }
            for (let i = a.i + 1; i < b.i; i += 1) {
                if ((run.lake[i] as number) >= 0) continue;
                werte[i] = a.h + ((b.h - a.h) * (strecke[i - a.i] as number)) / Math.max(1e-12, laenge);
            }
        }
        return werte;
    });
    return irgendeiner ? aus : undefined;
}

/** Je See des Netzes ein eigener Spiegel (WI-0249), sonst NaN: der erste gesetzte See-Punkt in seiner Fläche. */
export function eigeneSpiegel(
    network: RiverNetwork,
    seen: readonly WasserPunkt[] | undefined,
): Float64Array | undefined {
    if (!seen?.length) return undefined;
    const aus = Float64Array.from(network.lakes, (lake) => {
        const treffer = seen.find((punkt) => pointInGeometry([punkt.x, punkt.y], lake.geometry));
        return treffer === undefined ? Number.NaN : treffer.h;
    });
    return aus.some((h) => !Number.isNaN(h)) ? aus : undefined;
}

const gepinnt = (pins: (Float64Array | null)[] | undefined, r: number, i: number): number => {
    const werte = pins?.[r];
    return werte ? (werte[i] as number) : Number.NaN;
};

/**
 * Die Abtastpunkte nahe einer eigenen Höhe (WI-0249): Sie lesen bilinear schon die gesetzten Zellen des Punkts (die Höhenkacheln noch einmal auf
 * ihrem eigenen Gitter), ihr Anstieg zu ihr und ihr Abfall von ihr ist gewollt. Je Lauf 1, wo bis `reichweite` E flussab oder flussauf ein
 * gesetzter Punkt liegt; `null` ohne eigene Höhen im Lauf.
 */
function nahePins(
    network: RiverNetwork,
    pins: (Float64Array | null)[] | undefined,
    reichweite: number,
): (Uint8Array | null)[] | undefined {
    if (!pins) return undefined;
    return network.runs.map((run, r) => {
        const werte = pins[r];
        if (!werte) return null;
        const aus = new Uint8Array(werte.length);
        const schritt = (i: number): number =>
            Math.hypot(
                (run.xs[i + 1] as number) - (run.xs[i] as number),
                (run.ys[i + 1] as number) - (run.ys[i] as number),
            );
        let bis = Infinity;
        for (let i = werte.length - 1; i >= 0; i -= 1) {
            if (!Number.isNaN(werte[i] as number)) bis = 0;
            else if (i + 1 < werte.length) bis += schritt(i);
            if (bis <= reichweite) aus[i] = 1;
        }
        let seit = Infinity;
        for (let i = 0; i < werte.length; i += 1) {
            if (!Number.isNaN(werte[i] as number)) seit = 0;
            else if (i > 0) seit += schritt(i - 1);
            if (seit <= reichweite) aus[i] = 1;
        }
        return aus;
    });
}

/** So weit reicht ein gesetzter Punkt in die Lesungen: Raster und Höhenkacheln lesen je bilinear, also bis zwei Zellen; dazu eine Sicherheit. */
const pinReichweite = (field: Field): number => 3 * Math.max(...field.rasters.map((r) => r.cell), 0);

const downCache = new WeakMap<RiverNetwork, Int32Array[]>();

/**
 * Je Punkt eines Laufs der See, in den der Fluss von hier an mündet oder den er als Nächstes durchfließt (−1: keiner).
 * Für feste Seen: Ein Zufluss liegt nie unter dem Spiegel seines Sees.
 */
function downLakes(network: RiverNetwork): Int32Array[] {
    const known = downCache.get(network);
    if (known) return known;
    const lists = network.runs.map((run) => {
        const down = new Int32Array(run.lake.length).fill(-1);
        let next = run.endLake;
        for (let i = run.lake.length - 1; i >= 0; i -= 1) {
            const l = run.lake[i] as number;
            if (l >= 0) next = l;
            down[i] = next;
        }
        return down;
    });
    downCache.set(network, lists);
    return lists;
}

interface Beds {
    beds: Float64Array[];
    /** Der Spiegel je See; `Infinity` für einen See ohne Zu- und Abfluss mit Höhe. */
    levels: Float64Array;
    inflows: number[];
    outflows: number[];
}

/**
 * Das Bett je Abtastpunkt: das laufende Minimum in Fließrichtung, über das Netz fortgetragen. Weil alles nur
 * fällt, endet die Schleife auch in Kreisen.
 *
 * Der Spiegel eines Sees ist das Bett an seinem Abfluss. Dort, wo der Abfluss den See verlässt, liegt er auf
 * dem tiefsten Punkt des Sees (`surfaces`; V12 legt Seen im Gebirge eben auf ihr tiefstes Gelände, außerhalb
 * ist er 0). 🪤 Nicht das Gelände am ersten Punkt nach dem See: Das frisst der Graben des Abflusses von unten
 * an, und der See sank Runde um Runde (See-139 von 1.013 auf 601 Schritt). Nur nach unten: Ein tieferer
 * Zufluss zieht den Spiegel herab, und alles flussab folgt.
 */
function bedsOf(
    network: RiverNetwork,
    heights: readonly Float64Array[],
    surfaces: Float64Array,
    into: Float64Array[] = buffersOf(network),
    fixed = false,
    /** Eigene Höhen (WI-0249, `gepinnteLaeufe`): Dort ist das Bett genau sie, und flussab geht es von ihr weiter. */
    pins?: (Float64Array | null)[],
): Beds {
    const { runs, lakes } = network;
    const beds = into;
    for (const bed of beds) bed.fill(Infinity);
    const node = new Float64Array(network.nodes).fill(Infinity);
    const inflow = new Float64Array(lakes.length).fill(Infinity);
    const inflows = lakes.map(() => 0);
    const outflows = lakes.map(() => 0);
    const inject = runs.map(() => new Map<number, number>());
    runs.forEach((run) => {
        if (run.startLake >= 0 && (run.lake[0] as number) < 0)
            outflows[run.startLake] = (outflows[run.startLake] as number) + 1;
        for (let i = 1; i < run.xs.length; i += 1) {
            const before = run.lake[i - 1] as number;
            const here = run.lake[i] as number;
            if (before >= 0 && here !== before) outflows[before] = (outflows[before] as number) + 1;
            if (here >= 0 && here !== before) inflows[here] = (inflows[here] as number) + 1;
        }
        if (run.endLake >= 0 && (run.lake[run.lake.length - 1] as number) < 0) {
            inflows[run.endLake] = (inflows[run.endLake] as number) + 1;
        }
    });
    // Feste Seen (Domain): Der Spiegel ist der des Sees selbst; ein Zufluss zieht ihn nicht herab.
    const level = (l: number): number =>
        fixed ? (surfaces[l] as number) : Math.min(surfaces[l] as number, inflow[l] as number);
    const down = downLakes(network);

    for (let pass = 0; pass < 10_000; pass += 1) {
        let changed = false;
        for (const r of network.order) {
            const run = runs[r] as RiverRun;
            const h = heights[r] as Float64Array;
            const bed = beds[r] as Float64Array;
            let prev = Infinity;
            if (run.startNode >= 0) prev = Math.min(prev, node[run.startNode] as number);
            if (run.startLake >= 0) prev = Math.min(prev, level(run.startLake));
            if (run.leavesRun >= 0)
                prev = Math.min(prev, (beds[run.leavesRun] as Float64Array)[run.leavesAt] as number);
            const injected = inject[r] as Map<number, number>;
            for (let i = 0; i < bed.length; i += 1) {
                const l = run.lake[i] as number;
                let value: number;
                if (l >= 0) {
                    if (!fixed && (i === 0 || run.lake[i - 1] !== l) && prev < (inflow[l] as number)) {
                        inflow[l] = prev;
                        changed = true;
                    }
                    value = level(l);
                    if (!Number.isFinite(value)) value = Math.min(prev, h[i] as number);
                } else if (!Number.isNaN(gepinnt(pins, r, i))) {
                    // Eine eigene Höhe (WI-0249): Die Regel „Flüsse fallen“ gilt hier nicht.
                    value = gepinnt(pins, r, i);
                } else {
                    value = Math.min(h[i] as number, prev, injected.get(i) ?? Infinity);
                    // Feste Seen: Das Bett eines Zuflusses liegt nie unter dem Spiegel des Sees, in den er mündet. Ein Fluss,
                    // dessen Gelände vor dem See unter den Spiegel fällt, wird dort nicht tiefer eingeschnitten (er stiege
                    // sonst als Schlucht bis ans Ufer), und der Anstieg bleibt als Befund stehen. Mit `einlauf` (Fassung 19)
                    // hebt `hebeEinlaeufe` eine flache Mulde im Einlauf auf den Spiegel; eine tiefere bleibt Befund.
                    if (fixed) {
                        const lake = (down[r] as Int32Array)[i] as number;
                        if (lake >= 0) value = Math.max(value, level(lake));
                    }
                }
                if (value < (bed[i] as number) - 1e-9) {
                    bed[i] = value;
                    changed = true;
                }
                prev = bed[i] as number;
            }
            const mouth = bed[bed.length - 1] as number;
            if (run.endNode >= 0 && mouth < (node[run.endNode] as number)) {
                node[run.endNode] = mouth;
                changed = true;
            }
            if (!fixed && run.endLake >= 0 && mouth < (inflow[run.endLake] as number)) {
                inflow[run.endLake] = mouth;
                changed = true;
            }
            if (run.joinsRun >= 0) {
                const target = inject[run.joinsRun] as Map<number, number>;
                if (mouth < (target.get(run.joinsAt) ?? Infinity)) {
                    target.set(run.joinsAt, mouth);
                    changed = true;
                }
            }
        }
        if (!changed) break;
    }
    return { beds, levels: Float64Array.from(lakes.map((_, l) => level(l))), inflows, outflows };
}

/**
 * Wie ein Lauf in Fließrichtung steigt, ohne die Punkte im See: die Summe aller Anstiege von Punkt zu Punkt
 * und das Höchste, um das eine Stelle über einer früheren liegt.
 */
export function riseOf(lake: Int32Array, heights: Float64Array, fixed = false): { sum: number; above: number } {
    let sum = 0;
    let above = 0;
    let prev: number | null = null;
    let low = Infinity;
    for (let i = 0; i < heights.length; i += 1) {
        if ((lake[i] as number) >= 0) {
            prev = null;
            // Feste Seen: Hinter dem See beginnt der Lauf auf dem Spiegel neu.
            if (fixed) low = Infinity;
            continue;
        }
        const h = heights[i] as number;
        if (prev !== null && h > prev) sum += h - prev;
        above = Math.max(above, h - low);
        low = Math.min(low, h);
        prev = h;
    }
    return { sum, above };
}

/**
 * Eine Runde Nachschneiden: flussab in der Reihenfolge des Netzes, mit frisch gelesenen Höhen. Was an einer
 * Stelle gesenkt wird, zählt sofort für die nächste, auch über Knoten, T-Stöße und Seen in derselben Runde;
 * `beds` (vom Beginn der Runde) trägt, was ein Kreis im Netz von hinten bringt. Gibt die gesenkten Zellen.
 *
 * 🪤 Geprüft wird mit beiden Lesern: den Rastern (Routing, Wegprofile) und den Höhenkacheln (3D, Relief).
 * Die Kacheln lesen die Raster ein zweites Mal bilinear, auf ihrem eigenen Gitter; genau dort, wo Raster
 * allein schon fielen, stiegen 205 Läufe in den Kacheln noch um bis zu 100 Schritt.
 */
function walk(
    field: Field,
    network: RiverNetwork,
    near: readonly boolean[],
    beds: readonly Float64Array[],
    levels: Float64Array,
    walked: Float64Array[],
    scratch: Float64Array,
    fixed = false,
    /** Eigene Höhen (WI-0249): Dort wird nichts gesenkt, der Lauf geht mit ihr weiter (die Zellen sind gesetzt und gesperrt). */
    pins?: (Float64Array | null)[],
): number {
    const { runs } = network;
    const vor = nahePins(network, pins, pinReichweite(field));
    const node = new Float64Array(network.nodes).fill(Infinity);
    const inflow = new Float64Array(levels.length).fill(Infinity);
    const inject = runs.map(() => new Map<number, number>());
    for (const out of walked) out.fill(Infinity);
    const level = (l: number): number =>
        fixed ? (levels[l] as number) : Math.min(levels[l] as number, inflow[l] as number);
    const down = downLakes(network);
    let changed = 0;
    for (const r of network.order) {
        const run = runs[r] as RiverRun;
        const bed = beds[r] as Float64Array;
        const out = walked[r] as Float64Array;
        // Das tiefste bisher in den Kacheln; es beginnt je Lauf neu (ein Knoten ist für beide Läufe derselbe Punkt).
        const outDem = scratch;
        let low = Infinity;
        if (run.startNode >= 0) low = Math.min(low, node[run.startNode] as number);
        if (run.startLake >= 0) low = Math.min(low, level(run.startLake));
        if (run.leavesRun >= 0) low = Math.min(low, (walked[run.leavesRun] as Float64Array)[run.leavesAt] as number);
        const injected = inject[r] as Map<number, number>;
        const start = low;
        const startDem = run.startLake >= 0 ? level(run.startLake) : Infinity;
        let lowDem = startDem;
        for (let i = 0; i < bed.length;) {
            const l = run.lake[i] as number;
            if (l >= 0) {
                if (i === 0 || run.lake[i - 1] !== l) inflow[l] = Math.min(inflow[l] as number, low);
                // Ein fester See setzt den Lauf auf seinen Spiegel zurück (er ist die Quelle des Abflusses); ein
                // gezogener See reicht den tiefsten Zufluss weiter.
                low = fixed ? level(l) : Math.min(low, level(l));
                lowDem = fixed ? level(l) : Math.min(lowDem, level(l));
                out[i] = low;
                outDem[i] = lowDem;
                i += 1;
                continue;
            }
            const pin = gepinnt(pins, r, i);
            if (!Number.isNaN(pin)) {
                low = pin;
                lowDem = pin;
                out[i] = pin;
                outDem[i] = pin;
                i += 1;
                continue;
            }
            // Nahe einer eigenen Höhe: nicht senken (die Lesung steigt zu ihr an oder fällt von ihr ab, gewollt); der Lauf geht mit der Lesung weiter.
            if (vor?.[r]?.[i] === 1) {
                const x = run.xs[i] as number;
                const y = run.ys[i] as number;
                low = rasterHeight(field, x, y);
                lowDem = demHeight(field, x, y);
                out[i] = low;
                outDem[i] = lowDem;
                i += 1;
                continue;
            }
            // Feste Seen: Nie tiefer als der Spiegel des Sees, in den der Fluss mündet (siehe `bedsOf`).
            const lake = (down[r] as Int32Array)[i] as number;
            const floor = fixed && lake >= 0 ? level(lake) : -Infinity;
            const limit = Math.max(floor, Math.min(low, bed[i] as number, injected.get(i) ?? Infinity));
            const limitDem = Math.max(floor, lowDem);
            if (!near[r]) {
                low = Math.min(limit, 0);
                out[i] = low;
                i += 1;
                continue;
            }
            const x = run.xs[i] as number;
            const y = run.ys[i] as number;
            const here = rasterHeight(field, x, y);
            const shown = demHeight(field, x, y);
            let lowered = 0;
            if (here > limit + RISE_TOLERANCE) lowered += lowerAt(field, x, y, limit);
            if (shown > limitDem + RISE_TOLERANCE) lowered += lowerDemAt(field, x, y, limitDem);
            if (lowered > 0) {
                changed += lowered;
                // Die Senkung zieht Punkte kurz flussauf, die dieselben Zellen lesen, mit herab: dort noch einmal.
                const back = Math.max(0, i - WALK_BACK);
                low = back > 0 ? (out[back - 1] as number) : start;
                lowDem = back > 0 ? (outDem[back - 1] as number) : startDem;
                i = back;
                continue;
            }
            low = Math.max(Math.min(limit, here), floor);
            lowDem = Math.max(Math.min(lowDem, shown), floor);
            out[i] = low;
            outDem[i] = lowDem;
            i += 1;
        }
        if (run.endNode >= 0) node[run.endNode] = Math.min(node[run.endNode] as number, low);
        if (run.endLake >= 0) inflow[run.endLake] = Math.min(inflow[run.endLake] as number, low);
        if (run.joinsRun >= 0) {
            const target = inject[run.joinsRun] as Map<number, number>;
            target.set(run.joinsAt, Math.min(target.get(run.joinsAt) ?? Infinity, low));
        }
    }
    return changed;
}

/** Eine Strecke mit Bett: Gelände und Bett an beiden Enden, dazu die halbe Breite der Sohle. */
interface BedSegment {
    ax: number;
    ay: number;
    bx: number;
    by: number;
    terrain0: number;
    terrain1: number;
    bed0: number;
    bed1: number;
    floor: number;
}

/**
 * Die Strecken, um die ein Graben entsteht: jede Strecke eines Laufs, deren Bett unter dem Gelände liegt,
 * und das Ufer jedes Sees im Gebirge, dessen Spiegel unter seiner Fläche liegt (`tops`: die höchste Seezelle).
 * Das Ufer hat keine Sohle: Der See selbst ist sie.
 */
function bedSegments(
    network: RiverNetwork,
    heights: readonly Float64Array[],
    beds: readonly Float64Array[],
    levels: Float64Array,
    tops: Float64Array,
    fixed = false,
): BedSegment[] {
    const segments: BedSegment[] = [];
    network.runs.forEach((run, index) => {
        const h = heights[index] as Float64Array;
        const bed = beds[index] as Float64Array;
        for (let i = 1; i < run.xs.length; i += 1) {
            if ((run.lake[i - 1] as number) >= 0 || (run.lake[i] as number) >= 0) continue;
            // Nur Strecken mit Einschnitt: Das sind wenige, ein Objekt je Strecke kostete 160 MB.
            const cut = Math.max((h[i - 1] as number) - (bed[i - 1] as number), (h[i] as number) - (bed[i] as number));
            if (!(cut > RISE_TOLERANCE)) continue;
            segments.push({
                ax: run.xs[i - 1] as number,
                ay: run.ys[i - 1] as number,
                bx: run.xs[i] as number,
                by: run.ys[i] as number,
                terrain0: h[i - 1] as number,
                terrain1: h[i] as number,
                bed0: bed[i - 1] as number,
                bed1: bed[i] as number,
                floor: FLOOR_HALF_WIDTH,
            });
        }
    });
    network.lakes.forEach((lake, l) => {
        // Feste Seen liegen auf ihrem Ufer: Es gibt kein Ufer, das bis zum Spiegel herabgeschnitten werden müsste.
        if (fixed) return;
        const level = levels[l] as number;
        const top = tops[l] as number;
        if (!(top - level > RISE_TOLERANCE)) return;
        const rings = lake.geometry.type === "Polygon" ? [lake.geometry.coordinates] : lake.geometry.coordinates;
        for (const ring of (rings as number[][][][]).flat()) {
            for (let k = 1; k < ring.length; k += 1) {
                const [ax, ay] = ring[k - 1] as [number, number];
                const [bx, by] = ring[k] as [number, number];
                segments.push({ ax, ay, bx, by, terrain0: top, terrain1: top, bed0: level, bed1: level, floor: 0 });
            }
        }
    });
    return segments;
}

/**
 * Der Graben um jede Strecke, deren Bett unter dem Gelände liegt. Jede Zelle nimmt den tiefsten Vorschlag;
 * gelesen wird der Stand vor dem Graben.
 */
function trench(field: Field, segments: readonly BedSegment[], riverValley?: RiverValley): void {
    // Nur für Raster, die ein Graben berührt; die übrigen brauchen keine Kopie.
    const work: (Float32Array | undefined)[] = field.rasters.map(() => undefined);
    for (const { ax, ay, bx, by, terrain0, terrain1, bed0, bed1, floor } of segments) {
        const deepest = Math.max(terrain0 - bed0, terrain1 - bed1);
        if (!(deepest > RISE_TOLERANCE)) continue;
        // Lake shore segments have no floor; preserve their established handling.
        const valley = floor > 0 ? riverValley : undefined;
        // Im Gebirge (WI-0249) ist die Flanke dort am sanftesten, wo das Gelände am Fluss am niedrigsten ist: Das gibt die größte Reichweite.
        const reach = valley
            ? valleyReach(floor, deepest, valleyGrade(valley, Math.min(terrain0, terrain1)))
            : trenchReach(floor, deepest);
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        field.rasters.forEach((r, ri) => {
            if (r.readOnly) return;
            if (
                r.originX > Math.max(ax, bx) + reach ||
                r.maxX < Math.min(ax, bx) - reach ||
                r.originY > Math.max(ay, by) + reach ||
                r.maxY < Math.min(ay, by) - reach
            ) {
                return;
            }
            const next = work[ri] ?? Float32Array.from(r.samples);
            work[ri] = next;
            const i0 = Math.max(0, Math.ceil((Math.min(ax, bx) - reach - r.originX) / r.cell));
            const i1 = Math.min(r.width - 1, Math.floor((Math.max(ax, bx) + reach - r.originX) / r.cell));
            const j0 = Math.max(0, Math.ceil((Math.min(ay, by) - reach - r.originY) / r.cell));
            const j1 = Math.min(r.height - 1, Math.floor((Math.max(ay, by) + reach - r.originY) / r.cell));
            for (let j = j0; j <= j1; j += 1) {
                const py = r.originY + j * r.cell;
                for (let ci = i0; ci <= i1; ci += 1) {
                    const k = j * r.width + ci;
                    const old = r.samples[k] as number;
                    if (old === 0 || r.locked.has(k)) continue;
                    // Fußpunkt auf der Strecke (wie `footOf`, ohne ein Objekt je Zelle).
                    const px = r.originX + ci * r.cell;
                    const t = len2 > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
                    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
                    if (d > reach) continue;
                    // Über dem Gelände am Fluss sinkt die Zelle um den Einschnitt, zur Flanke hin weniger; darunter
                    // nur bis auf die Talfläche. So entsteht kein Loch unter dem Bett.
                    const terrain = terrain0 + (terrain1 - terrain0) * t;
                    const bed = bed0 + (bed1 - bed0) * t;
                    const rise = Math.max(0, d - floor) * FLANK;
                    const proposal = valley
                        ? valleyHeight(old, terrain, bed, d, floor, valleyGrade(valley, terrain))
                        : old >= terrain
                          ? old - Math.max(0, terrain - bed - rise)
                          : Math.min(old, bed + rise);
                    if (proposal < (next[k] as number)) next[k] = proposal;
                }
            }
        });
    }
    field.rasters.forEach((r, ri) => {
        const next = work[ri];
        if (!next) return;
        for (let k = 0; k < next.length; k += 1) {
            const value = Math.max(0, Math.round(next[k] as number));
            if (value < (r.samples[k] as number)) r.samples[k] = value;
        }
    });
}

export interface RiverFinding {
    id: string;
    name: string;
    value: number;
}

export interface LakeFinding {
    id: string;
    name: string;
    level: number;
    inflows: number;
    outflows: number;
    /** Wie tief die Seefläche im Gebirge höchstens abgesenkt wurde (Schritt). */
    lowered: number;
}

/**
 * Wie die Läufe steigen, vor und nach dem Einbrennen: wie viele irgendwo mehr als `RISE_TOLERANCE` über eine
 * frühere Stelle, die Summe aller Anstiege von Punkt zu Punkt und das Höchste, um das danach eine Stelle über
 * einer früheren liegt (Schritt).
 */
export interface RiseStats {
    risingBefore: number;
    risingAfter: number;
    riseBefore: number;
    riseAfter: number;
    aboveAfter: number;
}

export interface RiverBurnReport {
    runs: number;
    /** Läufe mit Höhe aus einem Gebirgsraster. */
    withHeight: number;
    /** Gelesen wie Routing und Wegprofile (Raster). */
    rasters: RiseStats;
    /** Gelesen wie die Karte in 3D (Höhenkacheln z3), ohne freie Gipfel. */
    tiles: RiseStats;
    rounds: number;
    /** Nachschneiden bis zum Fixpunkt beendet (sonst nach `MAX_ROUNDS` abgebrochen). */
    converged: boolean;
    changedCells: number;
    /** Tiefster Einschnitt (Schritt) über alle Läufe. */
    deepest: number;
    directions: Record<DirectionSource, number>;
    /** Läufe ohne Richtung in den Daten, und wie sie ausgerichtet wurden. */
    undirected: (RiverFinding & { how: DirectionSource })[];
    /** Läufe, deren Fließrichtung laut Daten bergauf zeigt: Gelände an der Mündung minus an der Quelle. */
    uphill: (RiverFinding & { source: number; mouth: number; how: DirectionSource })[];
    /** Läufe, die tiefer als `DEEP_CUT` geschnitten werden: der tiefste Einschnitt. */
    deepCuts: RiverFinding[];
    /** Läufe, die ein freier Gipfelkegel nach dem Einbrennen noch anhebt: der größte Anstieg. */
    coneRises: RiverFinding[];
    /** Läufe, die an einem Gipfel im Gebirge noch steigen, weil seine Zellen gesperrt sind (`ANCHOR_REACH`). */
    peakRises: RiverFinding[];
    /** Läufe, die sonst noch steigen; leer, sonst ist das Einbrennen nicht fertig geworden. */
    unresolved: RiverFinding[];
    lakes: LakeFinding[];
}

export interface RiverBurnInput {
    rivers: readonly RiverRow[];
    lakes: readonly RiverLake[];
}

/** Was außer den Flüssen zählt: freie Gipfel (Richtung b, Bericht) und die Gipfel im Gebirge (gesperrt). */
export interface RiverBurnContext {
    /** Domain-only morphology; omitted for byte-identical historical seed processing. */
    riverValley?: RiverValley;
    /** Höhen als Randbedingung lesen, aber nicht schneiden (Kontinentalsockel unter bestehenden Bergen). */
    readOnlyRasters?: ReadonlySet<StoredRaster>;
    peaks?: readonly FreePeak[];
    rule?: ConeRule;
    anchors?: readonly RiverAnchor[];
    /**
     * Wie ein See zu seinen Flüssen steht. `pulled` (Vorgabe, der historische Pfad): Ein Zufluss unter dem Spiegel zieht
     * den See herab (Betreiber 2026-09-28: „wenn ein see auf der höhe eines flusses ist, muss der see an dieser höhe sein“).
     * `fixed` (Domain, Betreiber 2026-10-04: Seen liegen auf ihrem Ufer): Der Spiegel ist der des Sees selbst, nämlich
     * der Median seiner Zellen; ein Zufluss aus tieferem Gelände zieht ihn nicht herab, der Abfluss und alles flussab
     * beginnen auf dem Spiegel, und das Ufer wird nicht bis zum Spiegel herabgeschnitten.
     */
    lakes?: "pulled" | "fixed";
    /** Zellen des ersten Rasters, die nie sinken (Seezellen der festen Seen): zusätzlich zu den Gipfelkernen. */
    protectedCells?: ReadonlySet<number>;
    /**
     * Feste Seen, Betreiber 2026-10-04 („der tiefste zufluss bestimmt die seehöhe“): Der tiefste Zufluss senkt den See
     * einmal auf sein Gelände an der Mündung, danach sind die Seezellen gesperrt. `reach` ist, wie weit flussauf von der
     * Mündung (Karteneinheiten) das Gelände des Zuflusses zählt. Nicht das tiefste Bett irgendwo flussauf (die Regel vor
     * Generator 18): Das zog den Neunaugensee wegen eines Gipfels 9 E flussauf auf 54 Schritt. Ohne die Angabe zieht kein Zufluss.
     */
    lakePull?: { reach: number };
    /**
     * Eigene Höhen an Stützpunkten der Flüsse (WI-0249, 0230; Vali wählte A, 2026-10-26; nur Fassung 19): Dort und zwischen zwei von ihnen im selben
     * Lauf trägt der Fluss genau diese Höhe (`gepinnteLaeufe`), die Zellen werden gesetzt und gesperrt, und „Flüsse fallen“ gilt dort nicht.
     * Ohne die Angabe Zeichen für Zeichen wie zuvor.
     */
    flussPunkte?: readonly WasserPunkt[];
    /** Eigene Seespiegel (WI-0249): Ein solcher See wird nicht vom tiefsten Zufluss gezogen (`lakePull`). */
    seeSpiegel?: readonly WasserPunkt[];
    /**
     * Feste Seen (WI-0249 P7; nur Fassung 19, `generator.lakes.inletDepth`): Steht das Nachschneiden, steigt die Rinne jedes Zuflusses, die im
     * Einlauf bis `tiefe` Schritt unter dem Spiegel liegt, auf den Spiegel (`hebeEinlaeufe`). Ohne die Angabe Zeichen für Zeichen wie zuvor.
     */
    einlauf?: { tiefe: number };
}

/**
 * So nah an einem Gipfel im Gebirge liest ein Lauf dessen gesperrte Zellen noch mit (Raster und Kacheln je
 * bilinear): Ein Anstieg dort ist ein Befund, kein Fehler des Einbrennens.
 */
export const ANCHOR_REACH = 0.75;

/**
 * Was nach dem Einbrennen noch steigt, gelesen wie Routing (Raster, gegen das Bett über das Netz) und wie die
 * Karte (Höhenkacheln, gegen die frühere Stelle im Lauf): je Lauf der größte Überstand über `RISE_TOLERANCE`,
 * getrennt nach Stellen an einem gesperrten Gipfel und allen übrigen.
 */
function remainingRises(
    field: Field,
    network: RiverNetwork,
    near: readonly boolean[],
    points: readonly (Float64Array | null)[],
    anchors: readonly RiverAnchor[],
    fixed = false,
    /** Eigene Höhen (WI-0249): Ein Anstieg an ihnen ist gewollt, kein Befund; der Lauf geht mit ihnen weiter. */
    pins?: (Float64Array | null)[],
): { rising: RiverFinding[]; atPeaks: RiverFinding[] } {
    const heights = sampleRuns(field, network, near, buffersOf(network));
    const shown = sampleRuns(field, network, near, buffersOf(network), true);
    const { beds, levels } = bedsOf(
        network,
        heights,
        lakeSurfaces(field, points, fixed),
        buffersOf(network),
        fixed,
        pins,
    );
    const vor = nahePins(network, pins, pinReichweite(field));
    const atAnchor = (x: number, y: number): boolean =>
        anchors.some((a) => Math.abs(a.x - x) <= ANCHOR_REACH && Math.abs(a.y - y) <= ANCHOR_REACH);
    const rising: RiverFinding[] = [];
    const atPeaks: RiverFinding[] = [];
    network.runs.forEach((run, r) => {
        if (!near[r]) return;
        const h = heights[r] as Float64Array;
        const d = shown[r] as Float64Array;
        const bed = beds[r] as Float64Array;
        let worst = 0;
        let worstAtPeak = 0;
        let low = run.startLake >= 0 ? (levels[run.startLake] as number) : Infinity;
        for (let i = 0; i < h.length; i += 1) {
            const l = run.lake[i] as number;
            if (l >= 0) {
                low = fixed ? (levels[l] as number) : Math.min(low, levels[l] as number);
                continue;
            }
            if (!Number.isNaN(gepinnt(pins, r, i)) || vor?.[r]?.[i] === 1) {
                low = d[i] as number;
                continue;
            }
            const excess = Math.max((h[i] as number) - (bed[i] as number), (d[i] as number) - low);
            low = Math.min(low, d[i] as number);
            // Use the same numerical precision as lowerAt: bilinear weights can turn 1 into 1 + 4e-16.
            if (!(excess > RISE_TOLERANCE + EPS)) continue;
            if (atAnchor(run.xs[i] as number, run.ys[i] as number)) worstAtPeak = Math.max(worstAtPeak, excess);
            else worst = Math.max(worst, excess);
        }
        if (worst > 0) rising.push({ id: run.row.id, name: run.row.name, value: worst });
        if (worstAtPeak > 0) atPeaks.push({ id: run.row.id, name: run.row.name, value: worstAtPeak });
    });
    const byValue = (a: RiverFinding, b: RiverFinding): number => b.value - a.value;
    return { rising: rising.sort(byValue), atPeaks: atPeaks.sort(byValue) };
}

/**
 * Die Prüfung für `verify:terrain-dem`: Läufe, die im gespeicherten Gelände irgendwo mehr als
 * `RISE_TOLERANCE` steigen, außer an einem gesperrten Gipfel (`remainingRises`). Nach `burnRivers` ist sie leer.
 */
export function risingRivers(
    rasters: readonly StoredRaster[],
    input: RiverBurnInput,
    context: RiverBurnContext = {},
): { rising: RiverFinding[]; atPeaks: RiverFinding[] } {
    const peaks = context.peaks ?? [];
    const rule = context.rule ?? DEFAULT_CONE;
    const anchors = context.anchors ?? [];
    const field = fieldOf(
        rasters.map((r) => ({ ...r, samples: Uint16Array.from(r.samples) })),
        anchors,
    );
    const terrainAt = (x: number, y: number): number => Math.max(rasterHeight(field, x, y), conesAt(peaks, rule, x, y));
    const network = buildRiverNetwork(input.rivers, input.lakes, terrainAt);
    const near = network.runs.map((run) => touchesField(field, run));
    return remainingRises(
        field,
        network,
        near,
        lakePointsOf(field, network.lakes),
        anchors,
        context.lakes === "fixed",
        gepinnteLaeufe(network, context.flussPunkte),
    );
}

/**
 * Brennt die Flüsse in die Raster ein, an Ort und Stelle (`samples` wird überschrieben). Die Raster sind
 * die gespeicherten Gebirge (Zeile 0 im Süden, außerhalb 0); die freien Gipfel dienen nur der Richtung (b)
 * und dem Bericht, die Gipfel im Gebirge bleiben stehen (`lockedCells`).
 */
export function burnRivers(
    rasters: readonly StoredRaster[],
    input: RiverBurnInput,
    context: RiverBurnContext = {},
): RiverBurnReport {
    if (context.riverValley && !(Number.isFinite(context.riverValley.flankGrade) && context.riverValley.flankGrade > 0))
        throw new RangeError("Invalid river valley flank grade");
    const gebirge = context.riverValley?.gebirge;
    if (gebirge && !(Number.isFinite(gebirge.grade) && gebirge.grade > 0 && gebirge.to > gebirge.from))
        throw new RangeError("Invalid river valley mountain grade");
    const peaks = context.peaks ?? [];
    const rule = context.rule ?? DEFAULT_CONE;
    const anchors = context.anchors ?? [];
    const fixed = context.lakes === "fixed";
    const field = fieldOf(rasters, anchors, context.readOnlyRasters);
    const terrainAt = (x: number, y: number): number => Math.max(rasterHeight(field, x, y), conesAt(peaks, rule, x, y));
    const network = buildRiverNetwork(input.rivers, input.lakes, terrainAt);
    const near = network.runs.map((run) => touchesField(field, run));
    const cells = lakeCellsOf(field, network.lakes);
    const before = field.rasters.map((r) => Uint16Array.from(r.samples));
    // Bergauf laut Daten, gemessen im ungeschnittenen Gelände.
    const uphill: RiverBurnReport["uphill"] = [];
    for (const run of network.runs) {
        if (run.how !== "daten" && run.how !== "geerbt") continue;
        const n = run.xs.length - 1;
        const source = terrainAt(run.xs[0] as number, run.ys[0] as number);
        const mouth = terrainAt(run.xs[n] as number, run.ys[n] as number);
        if (mouth > source + 1) {
            uphill.push({ id: run.row.id, name: run.row.name, value: mouth - source, source, mouth, how: run.how });
        }
    }

    // Einmal der Graben aus dem ungeschnittenen Gelände, dann genau nachschneiden bis zum Fixpunkt.
    const points = lakePointsOf(field, network.lakes);
    // Eigene Höhen an Flüssen (WI-0249): vor allem anderen setzen und sperren; ohne sie bleibt alles, wie es war.
    const pins = gepinnteLaeufe(network, context.flussPunkte);
    if (pins)
        network.runs.forEach((run, r) => {
            const werte = pins[r];
            if (!werte || !near[r]) return;
            for (let i = 0; i < werte.length; i += 1)
                if (!Number.isNaN(werte[i] as number))
                    setzeAt(field, run.xs[i] as number, run.ys[i] as number, werte[i] as number);
        });
    const spiegel = eigeneSpiegel(network, context.seeSpiegel);
    const heights0 = sampleRuns(field, network, near, buffersOf(network));
    const shown0 = sampleRuns(field, network, near, buffersOf(network), true);
    if (fixed && context.lakePull) {
        const surfaces = lakeSurfaces(field, points, true);
        const inflow = mouthLevels(network, near, heights0, context.lakePull.reach);
        levelLakes(
            field,
            cells,
            // Ein See mit eigenem Spiegel (WI-0249) wird nicht vom Zufluss gezogen.
            Float64Array.from(surfaces, (s, l) =>
                spiegel && !Number.isNaN(spiegel[l] as number) ? s : Math.min(s, inflow[l] as number),
            ),
        );
    }
    const firstRaster = field.rasters[0];
    if (context.protectedCells && firstRaster) for (const k of context.protectedCells) firstRaster.locked.add(k);
    const first = bedsOf(network, heights0, lakeSurfaces(field, points, fixed), buffersOf(network), fixed, pins);
    // Der tiefste Einschnitt je Lauf, gegen das ungeschnittene Gelände.
    const deepest = network.runs.map((run, r) => {
        const h0 = heights0[r] as Float64Array;
        const b0 = first.beds[r] as Float64Array;
        let cut = 0;
        for (let i = 0; i < h0.length; i += 1) {
            if ((run.lake[i] as number) < 0) cut = Math.max(cut, (h0[i] as number) - (b0[i] as number));
        }
        return cut;
    });
    trench(
        field,
        bedSegments(network, heights0, first.beds, first.levels, lakeTops(field, cells), fixed),
        context.riverValley,
    );
    // Feste Seen behalten ihren Spiegel; ihre Zellen sind gesperrt.
    if (!fixed) levelLakes(field, cells, first.levels);
    // Die Felder der Runden werden wiederverwendet: Der Speicher hängt so nicht an der Zahl der Runden.
    const heights = buffersOf(network);
    const bedBuffers = first.beds;
    const walked = buffersOf(network);
    const scratch = new Float64Array(Math.max(1, ...network.runs.map((run) => run.xs.length)));
    let rounds = 0;
    // Einläufe fester Seen (WI-0249 P7, nur Fassung 19): einmal, sobald das Nachschneiden steht. Erst dann liegt der Einlauf ganz auf dem
    // Spiegel: Einen Riegel zwischen Mulde und See hat das Nachschneiden bis auf ihn durchbrochen. Danach schneidet die nächste Runde nach,
    // was die gehobenen Zellen verlangen; ein zweites Heben gibt es nicht, so kann kein Lauf gegen einen anderen kreisen. Gelesen wird so
    // weit wie an eigenen Höhen (`pinReichweite`): Keine Lesung des Einlaufs, Raster oder Kachel, sieht danach eine Zelle unter dem Spiegel.
    let einlauf = fixed ? context.einlauf : undefined;
    for (; rounds < MAX_ROUNDS; rounds += 1) {
        sampleRuns(field, network, near, heights);
        const { beds, levels } = bedsOf(network, heights, lakeSurfaces(field, points, fixed), bedBuffers, fixed, pins);
        let changed =
            (fixed ? 0 : levelLakes(field, cells, levels)) +
            walk(field, network, near, beds, levels, walked, scratch, fixed, pins);
        if (changed === 0 && einlauf) {
            // An und nahe eigenen Höhen endet der Einlauf; dort gilt die gesetzte Höhe.
            const vor = nahePins(network, pins, pinReichweite(field));
            const frei = (r: number, i: number): boolean => Number.isNaN(gepinnt(pins, r, i)) && vor?.[r]?.[i] !== 1;
            changed = hebeEinlaeufe(field, network, near, levels, einlauf.tiefe, pinReichweite(field), frei);
            einlauf = undefined;
        }
        if (changed === 0) break;
    }

    // Bericht.
    const remaining = remainingRises(field, network, near, points, anchors, fixed, pins);
    sampleRuns(field, network, near, heights);
    const shown = sampleRuns(field, network, near, walked, true);
    const last = bedsOf(network, heights, lakeSurfaces(field, points, fixed), bedBuffers, fixed, pins);
    const report: RiverBurnReport = {
        unresolved: remaining.rising,
        peakRises: remaining.atPeaks,
        runs: network.runs.length,
        withHeight: 0,
        rasters: { risingBefore: 0, risingAfter: 0, riseBefore: 0, riseAfter: 0, aboveAfter: 0 },
        tiles: { risingBefore: 0, risingAfter: 0, riseBefore: 0, riseAfter: 0, aboveAfter: 0 },
        rounds,
        converged: rounds < MAX_ROUNDS,
        changedCells: 0,
        deepest: 0,
        directions: { daten: 0, geerbt: 0, gelaende: 0, kueste: 0, vorgabe: 0 },
        undirected: [],
        uphill,
        deepCuts: [],
        coneRises: [],
        lakes: [],
    };
    field.rasters.forEach((r, ri) => {
        const old = before[ri] as Uint16Array;
        for (let k = 0; k < old.length; k += 1) if (r.samples[k] !== old[k]) report.changedCells += 1;
    });
    network.runs.forEach((run, r) => {
        const row = run.row;
        report.directions[run.how] += 1;
        if (row.direction === null) report.undirected.push({ id: row.id, name: row.name, value: 0, how: run.how });
        if (!near[r]) return;
        if ((heights0[r] as Float64Array).some((h) => h > 0)) report.withHeight += 1;
        for (const [stats, before0, after] of [
            [report.rasters, heights0, heights],
            [report.tiles, shown0, shown],
        ] as const) {
            const riseBefore = riseOf(run.lake, before0[r] as Float64Array, fixed);
            const riseAfter = riseOf(run.lake, after[r] as Float64Array, fixed);
            if (riseBefore.above > RISE_TOLERANCE + EPS) stats.risingBefore += 1;
            if (riseAfter.above > RISE_TOLERANCE + EPS) stats.risingAfter += 1;
            stats.riseBefore += riseBefore.sum;
            stats.riseAfter += riseAfter.sum;
            stats.aboveAfter = Math.max(stats.aboveAfter, riseAfter.above);
        }
        const cut = deepest[r] as number;
        report.deepest = Math.max(report.deepest, cut);
        if (cut > DEEP_CUT) report.deepCuts.push({ id: row.id, name: row.name, value: cut });
    });
    // Kegel: Liest ein Lauf nach dem Einbrennen samt freien Gipfeln irgendwo höher als davor?
    network.runs.forEach((run) => {
        let low = Infinity;
        let worst = 0;
        for (let i = 0; i < run.xs.length; i += 1) {
            if ((run.lake[i] as number) >= 0) continue;
            const x = run.xs[i] as number;
            const y = run.ys[i] as number;
            const cone = conesAt(peaks, rule, x, y);
            const here = Math.max(rasterHeight(field, x, y), cone);
            if (cone > 0 && here > low) worst = Math.max(worst, here - low);
            low = Math.min(low, here);
        }
        if (worst > RISE_TOLERANCE + EPS) report.coneRises.push({ id: run.row.id, name: run.row.name, value: worst });
    });
    network.lakes.forEach((lake, l) => {
        let lowered = 0;
        for (const { raster, cells: ks } of cells[l] as LakeCells[]) {
            const now = (field.rasters[raster] as FieldRaster).samples;
            const old = before[raster] as Uint16Array;
            for (const k of ks) lowered = Math.max(lowered, (old[k] as number) - (now[k] as number));
        }
        report.lakes.push({
            id: lake.id,
            name: lake.name,
            level: last.levels[l] as number,
            inflows: last.inflows[l] as number,
            outflows: last.outflows[l] as number,
            lowered,
        });
    });
    const byValue = (a: RiverFinding, b: RiverFinding): number => b.value - a.value;
    report.uphill.sort(byValue);
    report.deepCuts.sort(byValue);
    report.coneRises.sort(byValue);
    return report;
}
