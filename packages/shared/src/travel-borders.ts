/**
 * Die Landesgrenzen einer Reise (WI-0065 U1; Legacy `js/routing/route-costs.js`, avesmaps@00b3d7d, Zeile 168-230).
 * Der Zoll ist der größte einzelne Posten der Reisekosten (Median 25 % der Summe), deshalb ist die Zählung ein
 * **1:1-Port** von Legacys Regel und kein eigener Entwurf: dieselbe Abtastung, dieselben Läufe, dieselbe Schwelle.
 * Ein Paritätstest führt Legacys Originalfunktion aus dem Discovery-Mirror aus (`travel-borders-legacy.test.ts`).
 *
 * Was gilt (Legacy, `WI-0065` Abschnitt „Legacy-Evidenz“):
 *
 * - Abgetastet wird je Linienstück in Schritten von `abtastschritt` Karteneinheiten (0,4 = 1,2 Meilen); je Punkt
 *   gewinnt das **erste** Gebiet der Liste, das ihn enthält. Löcher zählen als außen.
 * - Gezählt werden **Lauflängen**, nicht Geometrieschnitte: Ein Lauf unter `mindestLaufMeilen` (5) ist kein
 *   Aufenthalt. Er wird in den **Vorlauf** geschluckt, danach verschmelzen gleiche Nachbarn.
 * - Ein Übertritt ist ein Wechsel zwischen **zwei benannten** Gebieten. Ein Wechsel von oder zu „kein Gebiet“
 *   (offene See, Wildnis, Lücken) ist keiner; Start- und Zielgebiet zählen nicht.
 * - Alle Wegarten gehen in die Zählung, ohne Filter (Land, Fluss, See).
 * - Ohne Gebiete gibt es **kein Ergebnis** (`null`), nicht die Zahl 0: „nicht ermittelbar“ ist nie 0 (K1).
 *
 * ⚠️ **Legacy-Eigenheiten, 1:1 übernommen:**
 *
 * - *Die Asymmetrie von Start und Ziel:* Ein kurzer **erster** Lauf bleibt stehen, weil noch kein Vorlauf da ist;
 *   ein kurzer **letzter** wird geschluckt. Hin- und Rückweg derselben Linie zählen deshalb verschieden (an den
 *   196 Beispielreisen bei 9 um eine Grenze).
 * - *Der Schlüssel eines Laufs ist der Name*, nicht die Kennung: Zwei Gebiete gleichen Namens sind für die
 *   Zählung dasselbe Gebiet, und ein Gebiet mit leerem Namen ist „kein Gebiet“.
 * - *Der letzte Punkt der Linie wird nicht abgetastet* (die Abtastung läuft von 0 bis vor 1).
 *
 * 💡 Abweichung nur im Inneren, nicht im Ergebnis: **eine Hüllbox je Teilpolygon** statt je Gebiet (gemessen 32 s
 * gegen 1,0 s für 196 Reisen; die Hüllbox des ganzen Reiches deckt den Kontinent und sortiert nichts aus). Ein
 * Punkt liegt in einem Polygon nur, wenn er in dessen Hüllbox liegt; das Ergebnis ist deshalb dasselbe.
 */

import { routeDomain } from "./travel-model.ts";

/** Ein Punkt in Karteneinheiten (`aventuria-v1`). */
export type BorderPoint = readonly [number, number];
/** Ein geschlossener Ring, wie GeoJSON ihn führt (erster Punkt gleich letztem). */
export type BorderRing = readonly BorderPoint[];

/** Ein Teilpolygon eines Gebiets: `rings[0]` ist der Außenring, jeder weitere ein Loch. */
export interface BorderPart {
    /** Hüllbox des Außenrings: `[minX, minY, maxX, maxY]`. Pflicht: Sie hält die Zählung schnell. */
    readonly bbox: readonly [number, number, number, number];
    readonly rings: readonly BorderRing[];
}

/** Ein Gebiet, in dem Zoll erhoben wird (bei uns: eine Wurzel des Bandes 0, Legacy: `!parent_public_id`). */
export interface BorderTerritory {
    readonly id: string;
    readonly name: string;
    /** Der Kurzname für die Anzeige (Legacy `short_name`); fehlt er, gilt der Name (`shortNameOf`). Er zählt nie für die Zählung. */
    readonly shortName?: string;
    readonly parts: readonly BorderPart[];
}

/** Die Zählregel, aus dem Reisemodell (`reisekosten.grenzuebertritt.wert`). */
export interface BorderRule {
    /** Läufe unter dieser Länge in Meilen sind kein Aufenthalt (Legacy 5). */
    readonly mindestLaufMeilen: number;
    /** Schrittweite der Abtastung in Karteneinheiten (Legacy 0,4). */
    readonly abtastschritt: number;
}

/**
 * Was die Zählung von einem Abschnitt der Route liest: seine Linie in Fahrtrichtung. `subtype` (die Wegart, `Seeweg`)
 * braucht nur der Hafenzoll-Hinweis; die Zählung selbst kennt keine Wegart (Legacy).
 */
export interface BorderSegment {
    readonly geometry: { readonly coordinates: readonly BorderPoint[] };
    readonly subtype?: string;
}

/** Ein Übertritt: von welchem Gebiet in welches, und wo (der erste Abtastpunkt im neuen Gebiet). */
export interface BorderCrossing {
    from: { id: string; name: string; shortName: string };
    to: { id: string; name: string; shortName: string };
    x: number;
    y: number;
}

export interface BorderCount {
    /** Die Zahl der Landesgrenzen: die Länge von `crossings`. */
    count: number;
    /** Die Übertritte in Reihenfolge der Reise. */
    crossings: BorderCrossing[];
    /**
     * WI-0065 Z1 (A+): Ein Schiffsstück verbindet zwei verschiedene Reiche - die Reise fährt zu Schiff von einem
     * Reich ins andere. Das ist keine Landesgrenze und kostet nichts (Legacy: offene See trägt keinen Zoll), aber die
     * Quelle nennt Hafenzoll „nicht beziffert“; der Hinweis hält die Lücke sichtbar, ohne eine Zahl zu erfinden.
     * `false`, wenn kein Abschnitt seine Wegart nennt.
     */
    harbourTollUnknown: boolean;
}

/**
 * Ein Gebiet aus GeoJSON in die Form der Zählung (Legacy `avesmapsTravelCostPrepareTerritory`): flache Ringlisten
 * und je Teilpolygon eine Hüllbox. `null`, wenn die Geometrie kein Polygon ist oder keinen brauchbaren Ring hat.
 * Ein Ring mit weniger als vier Punkten ist kein Ring (Legacy); fehlt einem Teilpolygon der Außenring, entfällt
 * das ganze Teilpolygon (Legacy hätte ein Loch zum Außenring befördert, eine Entartung, die es hier nicht gibt).
 */
export function prepareBorderTerritory(input: {
    id: string;
    name: string;
    shortName?: string | null | undefined;
    geometry: { type: string; coordinates: unknown } | null | undefined;
}): BorderTerritory | null {
    const geometry = input.geometry;
    if (geometry?.type !== "Polygon" && geometry?.type !== "MultiPolygon") return null;
    const polygons: unknown = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons)) return null;

    const parts: BorderPart[] = [];
    for (const polygon of polygons as unknown[]) {
        if (!Array.isArray(polygon)) continue;
        const rings: BorderRing[] = [];
        let bbox: [number, number, number, number] | null = null;
        for (const [ringIndex, ring] of (polygon as unknown[]).entries()) {
            if (!Array.isArray(ring) || ring.length < 4) {
                // Der Außenring zählt nicht: kein Teilpolygon.
                if (ringIndex === 0) break;
                continue;
            }
            rings.push(ring as BorderRing);
            if (ringIndex === 0) {
                let minX = Infinity;
                let minY = Infinity;
                let maxX = -Infinity;
                let maxY = -Infinity;
                for (const point of ring as number[][]) {
                    const x = point[0] as number;
                    const y = point[1] as number;
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
                bbox = [minX, minY, maxX, maxY];
            }
        }
        if (bbox !== null && rings.length > 0) parts.push({ bbox, rings });
    }
    if (parts.length === 0) return null;
    const shortName = input.shortName?.trim();
    return { id: input.id, name: input.name, ...(shortName ? { shortName } : {}), parts };
}

/** Der Kurzname eines Gebiets für die Anzeige: sein `shortName`, sonst der Name. */
export function shortNameOf(territory: Pick<BorderTerritory, "name" | "shortName">): string {
    return territory.shortName || territory.name;
}

/** Strahlensatz-Punkttest, Löcher zählen als außen (Legacy `avesmapsTravelCostRingContains`). */
function ringContains(ring: BorderRing, x: number, y: number): boolean {
    let inside = false;
    // Mit Indizes statt Entpacken: Der Punkttest läuft je Abtastpunkt und Ring, hunderttausendfach je Reise.
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const pointI = ring[i] as BorderPoint;
        const pointJ = ring[j] as BorderPoint;
        const xi = pointI[0];
        const yi = pointI[1];
        const xj = pointJ[0];
        const yj = pointJ[1];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

/** Ein Teilpolygon mit seiner Hüllbox als Zahlen, zur Prüfung je Abtastpunkt. */
interface FlatPart {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    rings: readonly BorderRing[];
    territory: BorderTerritory;
}

function partContains(part: FlatPart, x: number, y: number): boolean {
    if (x < part.minX || x > part.maxX || y < part.minY || y > part.maxY) return false;
    const rings = part.rings;
    if (!ringContains(rings[0] as BorderRing, x, y)) return false;
    // Im Loch: außen.
    for (let index = 1; index < rings.length; index += 1) {
        if (ringContains(rings[index] as BorderRing, x, y)) return false;
    }
    return true;
}

/**
 * Das Gebiet an einem Punkt: das ERSTE der Liste, das ihn enthält (Löcher zählen als außen); `null` außerhalb aller.
 * Dieselbe Frage, die die Zählung je Abtastpunkt stellt; hier für einzelne Punkte (Proben, Prüfer).
 */
export function territoryAtPoint(
    territories: readonly BorderTerritory[],
    x: number,
    y: number,
): BorderTerritory | null {
    for (const territory of territories) {
        for (const part of territory.parts) {
            if (part.rings.length === 0) continue;
            const [minX, minY, maxX, maxY] = part.bbox;
            if (partContains({ minX, minY, maxX, maxY, rings: part.rings, territory }, x, y)) return territory;
        }
    }
    return null;
}

/** Ein zusammenhängender Aufenthalt in einem Gebiet, gezählt in Meilen. Der Schlüssel ist der Name (Legacy). */
interface Run {
    name: string;
    /** Das Gebiet, das den ersten Abtastpunkt des Laufs enthielt; `null` bei „kein Gebiet“. */
    territory: BorderTerritory | null;
    miles: number;
    /** Der erste Abtastpunkt des Laufs. */
    x: number;
    y: number;
}

/**
 * Die Zahl der Landesgrenzen einer Reise und wo sie liegen; `null`, wenn sie nicht zu ermitteln ist: ohne
 * Gebiete (Legacy: „die Antwort bleibt offen, sie wird nicht zu 0“) und ohne Abschnitte.
 *
 * `segments` sind die Abschnitte der Route mit ihrer Linie in FAHRTRICHTUNG (`RouteSegment.geometry`), nicht der
 * Zeichenlinie `display`; `territories` in Legacys Reihenfolge (`sort_order`, `name`): Bei Überlappung gewinnt das
 * erste. `milesPerUnit` ist die Meilenzahl je Karteneinheit des Reisemodells.
 */
export function countBorderCrossings(
    segments: readonly BorderSegment[],
    territories: readonly BorderTerritory[],
    milesPerUnit: number,
    rule: BorderRule,
): BorderCount | null {
    if (segments.length === 0 || territories.length === 0) return null;
    // Ohne diese Grenzen liefe die Abtastung endlos (Schritt 0) oder gar nicht.
    if (!(rule.abtastschritt > 0) || !(rule.mindestLaufMeilen >= 0) || !(milesPerUnit > 0)) {
        throw new RangeError("Grenzzählung: Abtastschritt und Meilen je Einheit müssen positiv sein");
    }

    // Die Teilpolygone in der Reihenfolge der Gebiete: das erste, das den Punkt enthält, entscheidet - dasselbe wie
    // „das erste Gebiet, das ihn enthält“, ohne je Punkt über die Gebiete zu gehen.
    const parts: FlatPart[] = [];
    for (const territory of territories) {
        for (const part of territory.parts) {
            const [minX, minY, maxX, maxY] = part.bbox;
            // Ein Teil ohne Außenring trifft nie.
            if (part.rings.length > 0) parts.push({ minX, minY, maxX, maxY, rings: part.rings, territory });
        }
    }
    const territoryAt = (x: number, y: number): BorderTerritory | null => {
        for (const part of parts) {
            if (partContains(part, x, y)) return part.territory;
        }
        return null;
    };
    const harbourTollUnknown = seaRunsConnectRealms(segments, territoryAt);

    const runs: Run[] = [];
    for (const segment of segments) {
        const coordinates = segment.geometry.coordinates;
        if (coordinates.length < 2) continue;
        for (let index = 0; index < coordinates.length - 1; index += 1) {
            const [x0, y0] = coordinates[index] as BorderPoint;
            const [x1, y1] = coordinates[index + 1] as BorderPoint;
            const span = Math.hypot(x1 - x0, y1 - y0);
            const steps = Math.max(1, Math.round(span / rule.abtastschritt));
            const stepMiles = (span / steps) * milesPerUnit;
            for (let step = 0; step < steps; step += 1) {
                const ratio = step / steps;
                const x = x0 + (x1 - x0) * ratio;
                const y = y0 + (y1 - y0) * ratio;
                const hit = territoryAt(x, y);
                const name = hit ? hit.name : "";
                const last = runs[runs.length - 1];
                if (last !== undefined && last.name === name) {
                    last.miles += stepMiles;
                } else {
                    runs.push({ name, territory: hit, miles: stepMiles, x, y });
                }
            }
        }
    }

    // Rauschläufe in den Vorlauf schlucken, danach gleiche Nachbarn erneut verschmelzen.
    const merged: Run[] = [];
    for (const run of runs) {
        const last = merged[merged.length - 1];
        if (run.miles < rule.mindestLaufMeilen && last !== undefined) {
            last.miles += run.miles;
            continue;
        }
        if (last !== undefined && last.name === run.name) {
            last.miles += run.miles;
            continue;
        }
        merged.push({ ...run });
    }
    const collapsed: Run[] = [];
    for (const run of merged) {
        const last = collapsed[collapsed.length - 1];
        if (last !== undefined && last.name === run.name) {
            last.miles += run.miles;
            continue;
        }
        collapsed.push(run);
    }

    // Offene See trägt keinen Zoll: ein Wechsel VON oder ZU „kein Gebiet“ ist kein Übertritt.
    const crossings: BorderCrossing[] = [];
    for (let index = 1; index < collapsed.length; index += 1) {
        const before = collapsed[index - 1] as Run;
        const after = collapsed[index] as Run;
        if (after.name && before.name && before.territory !== null && after.territory !== null) {
            crossings.push({
                from: {
                    id: before.territory.id,
                    name: before.territory.name,
                    shortName: shortNameOf(before.territory),
                },
                to: { id: after.territory.id, name: after.territory.name, shortName: shortNameOf(after.territory) },
                x: after.x,
                y: after.y,
            });
        }
    }
    return { count: crossings.length, crossings, harbourTollUnknown };
}

/**
 * Verbindet ein Schiffsstück zwei verschiedene Reiche (WI-0065 Z1)? Ein Schiffsstück ist eine Folge aufeinanderfolgender
 * See-Abschnitte (`routeDomain(subtype) === "sea"`): bei der freien Seefahrt einer, über Seewege mehrere. Gefragt wird
 * das Gebiet am Anfang und am Ende des Stücks (dieselben Gebiete und derselbe Punkttest wie die Zählung); zwei
 * verschiedene benannte Reiche heißen Ja. Ein Ende im Wasser ohne Gebiet zählt nicht.
 */
function seaRunsConnectRealms(
    segments: readonly BorderSegment[],
    territoryAt: (x: number, y: number) => BorderTerritory | null,
): boolean {
    let start: BorderPoint | null = null;
    let end: BorderPoint | null = null;
    const connects = (): boolean => {
        if (start === null || end === null) return false;
        const from = territoryAt(start[0], start[1]);
        const to = territoryAt(end[0], end[1]);
        return from !== null && to !== null && from.name !== "" && to.name !== "" && from.name !== to.name;
    };
    for (const segment of segments) {
        const coordinates = segment.geometry.coordinates;
        if (segment.subtype !== undefined && routeDomain(segment.subtype) === "sea" && coordinates.length > 0) {
            start ??= coordinates[0] as BorderPoint;
            end = coordinates[coordinates.length - 1] as BorderPoint;
            continue;
        }
        if (connects()) return true;
        start = null;
        end = null;
    }
    return connects();
}
