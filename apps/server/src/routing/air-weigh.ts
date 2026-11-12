import type { TravelModel } from "@avesmaps3d/shared";
import { airFieldRule } from "./air-field.ts";
import { airTerrain } from "./air-obstacles.ts";
import { polishWay } from "./air-polish.ts";
import {
    airFieldFrame,
    flyOverField,
    mountainAirFlight,
    roundedDisplay,
    STRAIGHT_FLIGHT,
    type AirDetour,
    type AirFlight,
} from "./air-way.ts";
import type { AirPoint, AirWay } from "./air-route.ts";
import { chordAbove, type TerrainHeights } from "./relief.ts";
import { lineLength } from "./router.ts";
import { anteil, werte } from "./einstellungen.ts";
import { flightTrack, type FlightAir } from "./water-profile.ts";

/**
 * Der Flug sucht den Weg mit der kürzesten Zeit samt Zuschlag über der Reisehöhe (WI-0051 F4, Betreiber 2026-10-04:
 * „ich will, dass die lieber um hohe berge herumfliegen als einfach drüber“; F4b, Betreiber 2026-10-04 zum Dreistein:
 * „F4b A - wie das höhenfeld in A* oder?“). Fliegen über der Reisehöhe kostet Zeit (`flightSurcharge`, `airSurcharge`).
 * Statt Wege um Gelände über festen Schwellen zu vergleichen (F4: 3.000 und 1.500 Schritt), sucht EINE Suche über einem
 * Kostenfeld (`air-field.ts`, `flyOverField`) den günstigsten Weg: Jede Zelle kostet ihre Länge und was das Fliegen dort
 * über der Reisehöhe kostet. So entsteht auch der lokale Weg um EINEN Gipfel, den kein Schwellenweg kannte.
 *
 * - **Kandidaten.** Der Weg der Höchstflughöhe (F2: die Luftlinie, solange sie kein Gelände über `ceiling − Mindestabstand`
 *   berührt, sonst der Weg um dieses Gelände, `air-way.ts`) und der Weg der Suche über dem Kostenfeld (dort bleibt Gelände
 *   über 4.800 Schritt gesperrt wie in F2). Gewählt wird EXAKT, an der eigenen Bahn jedes Wegs (`flightTrack`: Länge ×
 *   Schritt je Karteneinheit plus Zuschlag, beides Strecke); das Kostenfeld ist nur die Näherung, nach der gesucht wird.
 * - **Feilen** (`air-polish.ts`): Der Sieger und die Wege der Suche, die ihm nahekamen, werden an der exakten Bahn
 *   nachgezogen: Ecken entfernen, einfügen und verschieben. Das Feld kennt die Bahn nur in vier Richtungen und je Zelle;
 *   das Feilen bringt die Ecken dorthin, wo die wirkliche Bahn am billigsten ist.
 * - **Der günstigere gewinnt.** Bei gleichen Kosten der Weg der Höchstflughöhe, ein gefeilter Weg nur, wenn er strikt
 *   billiger ist: Die Wahl ist nie langsamer als der Weg der Höchstflughöhe, also nie langsamer als die Luftlinie, wo sie
 *   frei ist. Länge und Zuschlag sind beide Strecke, die Wahl hängt also nicht am Tempo des Flugmittels, wohl aber an seiner
 *   Reisehöhe (Bahn, Standardflughöhe, Nenner des Haltens).
 * - **Nur suchen, was sich lohnen kann.** Kostet der Weg der Höchstflughöhe weniger als `WEIGH_MIN_HOURS` Zuschlag (die
 *   Zeit, unter der die Anzeige schweigt), gibt es nichts zu holen. Sonst gewinnt nur ein Weg, der kürzer ist als die
 *   Gesamtkosten des ersten und höchstens `WEIGH_DETOUR` länger als die Luftlinie (ein Umweg über die Hälfte ist keine
 *   Reise um den Berg mehr). Das Raster überdeckt die Ellipse dieser Länge (`airFieldFrame`), erst die enge
 *   (`WEIGH_DETOUR_NEAR`), und nur bei einem Weg nahe ihrem Rand die weite.
 * - **Kein Weg über Gelände über 4.800 Schritt**, wo der Flug nicht muss: Die Suche sperrt die Zellen, die Sehnen des Wegs
 *   prüft `crossings` exakt, und gefeilt wird nur ein Weg ohne solche Sehne (`allowedFor`).
 * - **Dieselbe Etappe** (gleiche Lage, gleiche Richtung) wird je Anfrage einmal gewogen; aufbewahrt wird nur die fertige
 *   Linie, die Felder der Suche sind nach ihr frei. Deterministisch: Das Ergebnis hängt nur von der Etappe ab, nicht von
 *   der Reihenfolge; keine Uhr, keine Zufallszahl.
 * - **Das Budget** (`ROUTE_FLIGHT_SEARCH_LIMIT`): Eine Etappe sucht, wenn ihre Luftlinie Gelände über der
 *   Höchstflughöhe − Mindestabstand berührt oder `WEIGH_MIN_HOURS` Zuschlag kostet. Das ist billig zu prüfen und liegt vor
 *   jeder Suche. `WEIGH_WORK_BUDGET` begrenzt die Arbeit einer Anfrage (Zellen der Raster und Proben des Feilens).
 * - **Die gezeichnete Linie** rundet ihre Ecken (`roundedDisplay`), solange die Sehne kein Gelände berührt, das mehr als
 *   den Mindestabstand höher liegt als der höchste Boden unter dem Weg: Eine Rundung führt nie höher hinauf als der Weg.
 */

/** Ein Weg ist höchstens so viel länger als die Luftlinie (Anteil), sonst kommt er nicht mehr in Frage. */
export const WEIGH_DETOUR = 0.5;
/**
 * Die Suche läuft zuerst in einem Raster über allen Wegen bis so viel (Anteil) über der Luftlinie; gemessen sind Umwege der
 * Zufallsflüge höchstens 20 % (WI-0051 F4b), und das enge Raster hat nicht einmal die Hälfte der Zellen. Liegt der Weg
 * näher als `WEIGH_NEAR_EDGE` an dessen Rand, wird einmal im weiten Raster (`WEIGH_DETOUR`) gesucht.
 */
export const WEIGH_DETOUR_NEAR = 0.25;
/** Anteil der Umweglänge des engen Rasters, ab dem der gefundene Weg als „am Rand“ gilt. */
export const WEIGH_NEAR_EDGE = 0.8;
/** Ein Weg der Suche, der nicht mehr als so viel (Faktor) teurer ist als der Sieger, wird mit gefeilt: Das Feilen kann ihn noch drehen. */
export const WEIGH_NEAR_COST = 1.15;
/**
 * Auf Gelände ohne Domain-Modell (Gebirgsraster und Kegel, nur noch in Tests) tastet `chordAbove` die Sehne ab; die Grenze
 * der Sehnenprüfung liegt dort um so viele Schritt niedriger (ein Hang von 1 : 1 verliert zwischen zwei Proben 94 Schritt).
 */
const SAMPLED_MARGIN = 100;
/**
 * Das Raster einer Abwägung hat höchstens so viele Zellen (rund 4,6 MB mit Boden, Bahn und Suchfeldern); darüber wird die
 * Zelle doppelt so breit. Gemessen (200 Zufallsflüge, Hexenbesen): 400.000 Zellen 0,9431 der Reisezeit von F4, 200.000
 * 0,9439, 60.000 0,9476 - bei 65, 46 und 37 ms je Etappe.
 */
export const WEIGH_CELL_LIMIT = 200_000;
/**
 * So viele Arbeitseinheiten leistet die Abwägung je Anfrage höchstens: je Etappe die Zellen ihres Rasters (Gelände lesen,
 * Kostenfeld rechnen, suchen) und je Bewertung des Feilens die Proben der Bahn. Eine Einheit sind rund 0,4 Mikrosekunden.
 * Danach bleiben die späteren Etappen bei dem Weg der Höchstflughöhe: eine Obergrenze für die Rechenzeit einer Anfrage mit
 * vielen langen Etappen, unabhängig von Uhr und Last.
 */
export const WEIGH_WORK_BUDGET = 1_500_000;
/** Die Schrittweiten des Feilens in Zellen des Rasters, grob zuerst (`air-polish.ts`). */
export const WEIGH_POLISH_RADII: readonly number[] = [3, 1.5, 0.75];
/** So viele Durchgänge über alle Ecken je Schrittweite höchstens. */
export const WEIGH_POLISH_PASSES = 2;
/** So viele Bewertungen feilt eine Etappe höchstens; unter `WEIGH_POLISH_MIN` übrigem Budget bleibt der Weg, wie er ist. */
export const WEIGH_POLISH_EVALUATIONS = 150;
export const WEIGH_POLISH_MIN = 12;
/**
 * Erst ab so viel Zuschlag in Stunden auf dem Weg der Höchstflughöhe lohnt eine Suche: darunter schweigt die Anzeige
 * (`EXTRA_HOURS_SHOWN` der Oberfläche, 3 Minuten), und ein Umweg holte nichts, was jemand läse.
 */
export const WEIGH_MIN_HOURS = 0.05;

type Point = [number, number];

/** Der gewählte Weg einer Etappe. */
interface Choice {
    line: Point[];
    /** Bis zu dieser Höhe in Schritt darf die gezeichnete Linie Ecken schneiden (siehe oben). */
    round: number;
    /** Länge in Schritt plus Zuschlag in Schritt. */
    cost: number;
    /** Der Zuschlag allein, in Schritt. */
    extra: number;
    /** Wo der Weg herkommt: der Weg der Höchstflughöhe oder die Suche über dem Kostenfeld. */
    source: "base" | "field";
}

/** Sind zwei Linien dieselbe? */
function sameLine(a: readonly Point[], b: readonly Point[]): boolean {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
        const p = a[index] as Point;
        const q = b[index] as Point;
        if (p[0] !== q[0] || p[1] !== q[1]) return false;
    }
    return true;
}

/** Was eine Beobachtung einer Abwägung meldet (Messung und Tests): die Suche über dem Kostenfeld und die Obergrenze der Länge. */
export interface WeighSearch {
    detour: AirDetour;
    /** Länger als so viele Karteneinheiten kann ein Weg nicht mehr gewinnen. */
    bound: number;
}

/** Wer der Abwägung zusieht (Messung und Tests); beides ist freiwillig. */
export interface WeighObserver {
    /** Jede Suche über dem Kostenfeld. */
    search?: (search: WeighSearch) => void;
    /** Der gewählte Weg einer Etappe: sein Ursprung, Zuschlag und Kosten in Schritt. */
    chosen?: (choice: {
        source: "base" | "field";
        extra: number;
        cost: number;
        /** Wie viele Suchen diese Etappe gemacht hat (0 bis 2: das enge Raster, nach Bedarf das weite). */
        searched: number;
        /** Wie viele Bewertungen das Feilen gerechnet hat. */
        polished: number;
        /** Zellen der Raster, die diese Etappe gearbeitet hat. */
        work: number;
        /** Das Budget der Anfrage reichte nicht: Es blieb bei dem Weg der Höchstflughöhe. */
        skipped: boolean;
    }) => void;
}

/** Was ein Aufrufer an der Abwägung verstellen darf; der Dienst nimmt immer die Vorgaben (Messung und Tests ändern sie). */
export interface WeighOptions {
    /** Wer zusieht. */
    observer?: WeighObserver;
    /** Das Budget der Anfrage in Arbeitseinheiten; Vorgabe `WEIGH_WORK_BUDGET`. */
    budget?: number;
}

/**
 * Der Flug einer Anfrage mit Abwägung (F4, F4b): `air` ist das Flugmittel, `model` das Reisemodell (Mindestabstand,
 * Faktoren, Standardflughöhe). Ohne Höhenmodell die Luftlinie.
 */
export function weighedAirFlight(
    heights: TerrainHeights | null | undefined,
    air: FlightAir,
    model: TravelModel,
    options: WeighOptions = {},
): AirFlight {
    /**
     * 🪤 EINMAL je Anfrage gelesen, nicht je Kandidat (WI-0153): Die Schleifen unten laufen über Zellen und Proben.
     * `anteil()` teilt die vier Prozentwerte des Registers durch hundert; hier stehen Anteile wie bisher.
     */
    const w = werte();
    const umweg = anteil("weighDetour");
    const umwegNah = anteil("weighDetourNear");
    const amRand = anteil("weighNearEdge");
    const { observer, budget = w.weighWorkBudget } = options;
    if (!heights) return STRAIGHT_FLIGHT;
    const terrain = airTerrain(heights);
    const clearance = model.flug.wert.mindestabstandSchritt;
    const baseLimit = air.ceilingSchritt - clearance;
    const base = mountainAirFlight(terrain, baseLimit);
    const rule = airFieldRule(air, model);
    // Der Zuschlag, ab dem eine Suche lohnt, in Schritt Strecke: Stunden mal Meilen je Stunde mal 1.000 Schritt je Meile.
    const minExtra = w.weighMinHours * air.speedMph * 1000;
    const keyOf = (from: AirPoint, to: AirPoint): string => `${from.x}:${from.y}\u0000${to.x}:${to.y}`;

    const choiceOf = (line: Point[], source: Choice["source"]): Choice => {
        const track = flightTrack(line, heights, air, model);
        const extra = track ? track.surcharge.climbSchritt + track.surcharge.holdSchritt : 0;
        const highest = track ? Math.max(...track.samples.height) : 0;
        return {
            line,
            round: Math.min(baseLimit, highest + clearance),
            extra,
            cost: lineLength(line) * w.schrittPerUnit + extra,
            source,
        };
    };

    // Der Zuschlag der Luftlinie je Etappe: Er entscheidet mit, ob die Etappe überhaupt sucht.
    const straightExtras = new Map<string, number>();
    const searches = (from: AirPoint, to: AirPoint): boolean => {
        if (base.searches(from, to)) return true;
        const key = keyOf(from, to);
        let extra = straightExtras.get(key);
        if (extra === undefined) {
            extra = choiceOf(
                [
                    [from.x, from.y],
                    [to.x, to.y],
                ],
                "base",
            ).extra;
            straightExtras.set(key, extra);
        }
        return extra >= minExtra;
    };

    /** Die Kosten eines Wegs, exakt an seiner eigenen Bahn: Länge plus Zuschlag, in Schritt. */
    const costOf = (line: readonly Point[]): number => {
        const track = flightTrack(line, heights, air, model);
        return (
            lineLength(line as Point[]) * w.schrittPerUnit +
            (track ? track.surcharge.climbSchritt + track.surcharge.holdSchritt : 0)
        );
    };
    /** Was ein Weg zu gelten hat: nicht über dem Umweg-Deckel und keine Sehne über Gelände über der Höchstflughöhe. */
    /**
     * Berührt die Sehne Gelände über der Höchstflughöhe minus Mindestabstand? Im Domain-Modell exakt (`chordAbove` prüft jede
     * bilineare Zelle); ohne es tastet `chordAbove` alle 0,0625 E ab, und ein steiler Gipfel zwischen zwei Proben bliebe
     * unentdeckt (gefunden am erzeugten Gelände: 0,02 Schritt über der Grenze auf einer Sehne des gefeilten Wegs). Dort gilt
     * die Grenze um die Höhe, die zwischen zwei Proben verloren gehen kann.
     */
    const aboveLimit = (from: { x: number; y: number }, to: { x: number; y: number }): boolean =>
        chordAbove(heights, from, to, heights.domain ? baseLimit : baseLimit - SAMPLED_MARGIN);
    const crossings = (line: readonly Point[]): number => {
        let count = 0;
        for (let k = 0; k + 1 < line.length; k += 1) {
            const [x0, y0] = line[k] as Point;
            const [x1, y1] = line[k + 1] as Point;
            if (aboveLimit({ x: x0, y: y0 }, { x: x1, y: y1 })) count += 1;
        }
        return count;
    };
    const allowedFor =
        (direct: number) =>
        (trial: readonly Point[], first: number): boolean => {
            if (lineLength(trial as Point[]) >= direct * (1 + umweg)) return false;
            for (let k = first; k <= first + 1 && k + 1 < trial.length; k += 1) {
                const [x0, y0] = trial[k] as Point;
                const [x1, y1] = trial[k + 1] as Point;
                if (aboveLimit({ x: x0, y: y0 }, { x: x1, y: y1 })) return false;
            }
            return true;
        };

    const choices = new Map<string, Choice>();
    // Was die Abwägung dieser Anfrage schon an Arbeit geleistet hat (`WEIGH_WORK_BUDGET`).
    let spent = 0;
    const choose = (from: AirPoint, to: AirPoint): Choice => {
        const key = keyOf(from, to);
        const known = choices.get(key);
        if (known) return known;
        // Der Weg der Höchstflughöhe liefert nie `null` (er quert die Sperre, wenn er muss).
        let best = choiceOf(
            base.way(from, to) ?? [
                [from.x, from.y],
                [to.x, to.y],
            ],
            "base",
        );
        const direct = Math.hypot(to.x - from.x, to.y - from.y);
        // Ein Weg über Gelände über der Höchstflughöhe gilt nur, wo der Flug muss (Start oder Ziel im Hochgebirge): Der Weg der
        // Suche quert nicht mehr Sehnen davon als der der Höchstflughöhe (sie sperrt Zellen, die Sehnen prüft erst hier).
        const baseCrossings = crossings(best.line);
        let searched = 0;
        let polished = 0;
        let work = 0;
        let skipped = false;
        let cell = 0;
        // Die Wege der Suche, die nicht gewonnen haben, aber nahe dran waren: Das Feilen kann sie noch drehen.
        const near: Choice[] = [];
        if (best.extra >= minExtra) {
            // Die Suche läuft in einem Raster über der Ellipse aller Wege bis zur Länge `bound`: Länger kann ein Weg nicht
            // gewinnen (der Zuschlag ist nie negativ), und länger als der Umweg-Deckel gilt nicht. Erst das enge Raster; liegt
            // der gefundene Weg nahe an seinem Rand, einmal im weiten (`WEIGH_DETOUR`).
            for (const detour of [umwegNah, umweg]) {
                const bound = Math.min(best.cost / w.schrittPerUnit, direct * (1 + detour));
                if (!(bound > direct)) break;
                const frame = airFieldFrame(terrain, from, to, bound, w.weighCellLimit);
                if (!frame) break;
                // Die Arbeit dieser Etappe in Zellen. Reicht das Budget der Anfrage dafür nicht mehr, bleibt es bei dem Weg
                // der Höchstflughöhe (die Zeit rechnet auch dann ehrlich).
                const cells = frame.cols * frame.rows;
                if (spent + cells > budget) {
                    skipped = true;
                    break;
                }
                spent += cells;
                work += cells;
                cell = frame.cell;
                const found = flyOverField(terrain, frame, baseLimit, rule, from, to);
                searched += 1;
                observer?.search?.({ detour: found, bound });
                if (
                    found.distance < bound &&
                    !sameLine(found.points, best.line) &&
                    crossings(found.points) <= baseCrossings
                ) {
                    const candidate = choiceOf(found.points, "field");
                    if (candidate.cost < best.cost) {
                        near.push(best);
                        best = candidate;
                    } else if (candidate.cost < best.cost * w.weighNearCost) near.push(candidate);
                }
                // Weit vom Rand des Rasters: Ein weiteres brächte nichts.
                if (found.distance < direct * (1 + detour * amRand)) break;
            }
        }
        // Feilen: Die Knicke des Wegs werden an der exakten Bahn nachgezogen, die des Siegers und der Beinahe-Sieger.
        if (searched > 0) {
            const allowed = allowedFor(direct);
            const polishing = (choice: Choice): boolean => crossings(choice.line) === 0;
            for (const start of [best, ...near]) {
                if (!polishing(start)) continue;
                const samples = Math.min(1600, Math.max(32, Math.ceil(lineLength(start.line) / 0.25) + 1));
                const room = Math.min(w.weighPolishEvaluations, Math.floor((budget - spent) / samples));
                if (room < w.weighPolishMin) break;
                const result = polishWay(
                    start.line,
                    costOf,
                    allowed,
                    {
                        radii: WEIGH_POLISH_RADII.map((radius) => radius * cell),
                        passes: w.weighPolishPasses,
                        maxEvaluations: room,
                    },
                    start.cost,
                );
                spent += result.evaluations * samples;
                polished += result.evaluations;
                if (result.cost < best.cost - 1e-9) best = choiceOf(result.line, start.source);
            }
        }
        choices.set(key, best);
        observer?.chosen?.({
            source: best.source,
            extra: best.extra,
            cost: best.cost,
            searched,
            polished,
            work,
            skipped,
        });
        return best;
    };

    const way: AirWay = (from, to) => choose(from, to).line;
    const display = (points: Point[], from?: AirPoint, to?: AirPoint): Point[] =>
        roundedDisplay(terrain, from && to ? choose(from, to).round : baseLimit)(points);
    return { way, searches, display };
}
