import { createHash } from "node:crypto";
import {
    AVENTURIA_CARTOGRAPHY,
    FACULTY_GLYPHIC_METRICS,
    VECTOR_TILE_MAX_ZOOM,
    bandForRenderZoom,
    labelFamily,
    renderZoomForBand,
    requiredRunLength,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { buildAxisGraph, longestPath, pathLength, resample, type Point, type Triangle } from "./chordal-axis.ts";
import {
    ausweichLauf,
    calmestWindow,
    labelFitsAngle,
    mapUnitsPerPixel,
    splitIntoInstances,
    zoomWhereInstancesFit,
} from "./run-geometry.ts";
import { calmToChord, fitCurve, fitParametricCurve } from "./curve-fit.ts";
import { acceptedCurveOutside } from "./curve-review.ts";
import { curveFootprint, mostlyInside, selectCoveredRunSets, runShares } from "./curve-placement.ts";

/**
 * Leitet die Schriftläufe der kurvenbeschrifteten Regionen ab (WI-0004, ADR-0007).
 *
 * Die schweren Schritte teilen sich: PostGIS vereinfacht, verdichtet und trianguliert — Legacy
 * musste den Delaunay von Hand schreiben, weil PHP keine Bibliothek hatte —, die Mittelachse, der
 * Polynomfit und die Aufteilung stehen in TypeScript.
 *
 * Nichts hiervon ist authoritative. Geht ein Lauf verloren, kostet das einen Aufruf dieses
 * Werkzeugs; geht er kaputt, kostet er nach Invariante I7 die Kurve und niemals den Namen.
 */

/**
 * Steigt, wenn sich Vereinfachung, Glättung, Aufteilung oder Fensterwahl ändern — und entwertet
 * alte Läufe. 4: Fenster je Zoomstufe (WI-0018). 5: geordnete Fits und innenbewusste
 * Zoomsätze bei nicht abgenommenen Außenbefunden (WI-0116). 6: ein einzelner Name, dem die ganze
 * Kurve zu kurz ist, bekommt einen entlang der Sehne verlängerten Lauf (Befund 2026-10-11). 7: jeder Einzellauf trägt den
 * Ausweichraum, ¼ Namenslänge an beiden Enden (`ausweichLauf`, Migration 0110).
 */
export const ALGORITHM_VERSION = "7";

/** Legacys Formwerte, in der Produktion durchgehend hartcodiert (MCS-008). */
const SIMPLIFY_TOLERANCE = 1.55;
const SEGMENT_SPACING = 0.3;
const MIN_PART_SHARE = 0.02;
const SAMPLES = 120;
const MAX_TURN_DEGREES = 30;
/** Mindestabstand zweier Instanzen desselben Namens, in Schriftgrößen. */
const MIN_GAP_EM = 2.0;

export interface RegionInput {
    regionId: number;
    regionPublicId: string;
    name: string;
    styleLabelId: number;
    labelText: string;
    labelSize: number;
    /**
     * Der Labeltyp (`map_label.subtype`) — er entscheidet über Versalien, wie im Stil und wie in
     * Legacy (Katalog V1). NICHT der Regionstyp: der fehlt bei 87 Beschriftungen.
     */
    labelType: string | null;
    /** Das Erscheinungsband des Namens. Die Sätze verteilen sich darin. */
    labelMinZoom: number;
    labelMaxZoom: number;
    curveMax: number;
    /** Grad des Polynomfits, 2..5 (`region.label_curve_degree`; leer heißt `POLY_DEGREE`, WI-0019). */
    curveDegree: number;
}

export interface DerivedRun {
    instance: number;
    instanceCount: number;
    runMinZoom: number;
    runMaxZoom: number;
    points: Point[];
}

export interface RegionResult {
    regionId: number;
    name: string;
    runs: DerivedRun[];
    fingerprint: string;
    /** Länge des längsten benutzten Kurvenzugs in Karteneinheiten. Null, wenn keine Kurve entstand. */
    curveLength: number;
    /** Belegte Namensbreite in Bildschirmpixeln, aus der Glyphenmetrik der Schriftart. */
    nameWidthPixels: number;
    /** Warum kein Lauf entstand. Leer heißt: es hat geklappt. */
    skipped?: string;
}

/** Was außer den Flächen in die Ableitung eingeht. Ändert sich eines davon, ist der Lauf veraltet. */
export interface FingerprintInputs {
    /** Die gemessene Namensbreite. Sie deckt Text, Größe, Versalien und Schriftmetrik zugleich. */
    nameWidthPixels: number;
    labelMinZoom: number;
    labelMaxZoom: number;
    curveMax: number;
    curveDegree: number;
    reviewedCurve?: boolean;
}

/**
 * Der Fingerabdruck über die aktiven Flächen einer Region und alles, was sonst in ihre Läufe eingeht.
 *
 * 💣 Eine Summe der Revisionen reicht nicht — 3 kollidiert mit 1+1+1 —, und auch Summe plus Anzahl
 * erkennt nicht, WELCHE Fläche getauscht wurde. Sortiert und einzeln gehasht erkennt der
 * Fingerabdruck beides, und über die Algorithmusversion zusätzlich eine geänderte Ableitung.
 *
 * 💣 Und bis WI-0019 standen hier NUR die Flächen. Wurde ein Name länger, galt die Region als
 * unverändert: der alte, kürzere Lauf blieb stehen, MapLibre ließ den längeren Namen still weg, und
 * das Punktlabel war wegen `has_curve_run` ausgeblendet — der Name verschwand ganz. Seitdem steht
 * hier jede Eingabe der Ableitung, auch der Grad, den ein Editor setzt.
 */
export function fingerprintOf(
    areas: readonly { publicId: string; revision: number | null }[],
    inputs: FingerprintInputs,
): string {
    const parts = [...areas]
        .sort((a, b) => a.publicId.localeCompare(b.publicId))
        .map((area) => `${area.publicId}:${String(area.revision ?? 0)}`);
    const settings = [
        inputs.nameWidthPixels,
        inputs.labelMinZoom,
        inputs.labelMaxZoom,
        inputs.curveMax,
        inputs.curveDegree,
        inputs.reviewedCurve ?? false,
    ].map(String);
    return createHash("sha256")
        .update(`${parts.join("\n")}|${settings.join("|")}|${ALGORITHM_VERSION}`)
        .digest("hex");
}

interface AreaRow {
    public_id: string;
    geometry_revision: number | null;
    area: number;
}

/**
 * Die vereinfachte Form, aus der Dreiecke und Innentest gemeinsam entstehen.
 *
 * 🪤 Beides MUSS dieselbe Geometrie sein. Testet man die Dreiecke des vereinfachten Randes gegen
 * die Originalfläche, fallen genau die Dreiecke heraus, die über eine wegvereinfachte Bucht laufen
 * — die Achse zerfällt dann in Inseln, und der längste Weg ist ein Stummel.
 */
export interface Shape {
    /** Die vereinfachte Fläche als WKT, Bezugsform für den Innentest. */
    polygon: string;
    /** Ihr verdichteter Rand, die Eingabe der Triangulierung. */
    points: Point[];
}

/**
 * Holt die vereinfachte Form einer Region aus PostGIS.
 *
 * Vereinfachen kommt vor dem Verdichten, obwohl es andersherum natürlicher klingt: eine
 * Vereinfachung nach dem Verdichten würde die eben erst gesetzten Stützpunkte wieder wegwerfen.
 * Eine Fläche mit 12448 Ecken ist ohne diesen Schritt nicht triangulierbar.
 */
export async function shapeOf(database: Queryable, areaPublicIds: readonly string[]): Promise<Shape | null> {
    const [row] = await database<{ polygon: string | null; ring: string | null }[]>`
        WITH simplified AS (
            SELECT ST_SimplifyPreserveTopology(
                       ST_UnaryUnion(ST_Collect(a.geom)),
                       ${SIMPLIFY_TOLERANCE}
                   ) AS geom
            FROM region_area a
            WHERE a.public_id = ANY(${areaPublicIds as unknown as string[]}::uuid[]) AND a.is_active
        )
        SELECT ST_AsText(geom) AS polygon,
               ST_AsText(ST_Segmentize(ST_Boundary(geom), ${SEGMENT_SPACING})) AS ring
        FROM simplified
    `;
    if (!row?.polygon || !row.ring) {
        return null;
    }
    const points: Point[] = [];
    const seen = new Set<string>();
    for (const match of row.ring.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) {
        const x = Number(match[1]);
        const y = Number(match[2]);
        const key = `${x.toFixed(4)},${y.toFixed(4)}`;
        if (!seen.has(key)) {
            seen.add(key);
            points.push({ x, y });
        }
    }
    return { polygon: row.polygon, points };
}

/** Trianguliert den verdichteten Rand. Delaunay liefert auch Dreiecke außerhalb — die siebt der Innentest. */
export async function trianglesOf(database: Queryable, shape: Shape): Promise<Triangle[]> {
    const { points } = shape;
    if (points.length < 4) {
        return [];
    }

    const wkt = `MULTIPOINT(${points.map((point) => `${String(point.x)} ${String(point.y)}`).join(",")})`;
    const [triangulated] = await database<{ wkt: string | null }[]>`
        SELECT ST_AsText(
                   ST_CollectionExtract(
                       ST_DelaunayTriangles(ST_GeomFromText(${wkt}, 0), 0, 0),
                       3
                   )
               ) AS wkt
    `;
    const text = triangulated?.wkt;
    if (!text) {
        return [];
    }

    const triangles: Triangle[] = [];
    for (const block of text.matchAll(/\(\(([^()]+)\)\)/g)) {
        const coordinates = (block[1] as string)
            .split(",")
            .map((pair) => pair.trim().split(/\s+/).map(Number))
            .filter((pair) => pair.length >= 2)
            .map((pair) => ({ x: pair[0] as number, y: pair[1] as number }));
        if (coordinates.length >= 4) {
            triangles.push([coordinates[0] as Point, coordinates[1] as Point, coordinates[2] as Point]);
        }
    }
    return triangles;
}

/**
 * Behält nur die Dreiecke, die innerhalb der Fläche liegen.
 *
 * Geprüft werden der Schwerpunkt **und** alle drei Kantenmitten, die dafür um fünf Prozent zum
 * Schwerpunkt gerückt werden: eine Randkantenmitte liegt exakt auf der Umrisslinie, und
 * `ST_Contains` wäre dort eine Münze. Legacy macht denselben Ruck, und sein Kommentar sagt offen,
 * dass fünf Prozent eine Bucht nicht hereinholen.
 */
export async function interiorTriangles(
    database: Queryable,
    triangles: readonly Triangle[],
    shape: Shape,
): Promise<Triangle[]> {
    if (triangles.length === 0) {
        return [];
    }
    const probes: string[] = [];
    for (const triangle of triangles) {
        const centre = {
            x: (triangle[0].x + triangle[1].x + triangle[2].x) / 3,
            y: (triangle[0].y + triangle[1].y + triangle[2].y) / 3,
        };
        const samples = [centre];
        for (let index = 0; index < 3; index += 1) {
            const a = triangle[index] as Point;
            const b = triangle[(index + 1) % 3] as Point;
            const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
            samples.push({
                x: middle.x + (centre.x - middle.x) * 0.05,
                y: middle.y + (centre.y - middle.y) * 0.05,
            });
        }
        probes.push(`MULTIPOINT(${samples.map((point) => `${String(point.x)} ${String(point.y)}`).join(",")})`);
    }

    // 🪤 Die Reihenfolge der Dreiecke entscheidet bei Gleichstand über die Achse (WI-0223: bei 130 von 183 erzeugten Kammlinien), und
    // die Kammlinie geht in den Fingerabdruck des Gebirges. Ohne ORDER BY verspräche SQL keine Reihenfolge.
    const kept = await database<{ index: number; inside: boolean }[]>`
        SELECT p.ordinality::int - 1 AS index,
               bool_and(ST_Contains(shape.geom, sample.geom)) AS inside
        FROM unnest(${probes}::text[]) WITH ORDINALITY AS p(wkt, ordinality)
        CROSS JOIN LATERAL (SELECT ST_GeomFromText(${shape.polygon}, 0) AS geom) shape
        CROSS JOIN LATERAL (
            SELECT (ST_Dump(ST_GeomFromText(p.wkt, 0))).geom AS geom
        ) sample
        GROUP BY p.ordinality
        ORDER BY p.ordinality
    `;
    return kept.filter((row) => row.inside).map((row) => triangles[row.index] as Triangle);
}

/**
 * Das ruhigste Fenster, beruhigt, und immer noch lang genug für seinen Namen.
 *
 * 💣 Die Beruhigung KÜRZT: sie mischt die Linie zu ihrer Sehne, und eine Sehne ist kürzer als ihr
 * Bogen. Wer danach nicht erneut misst, verliert Buchstaben genau dann, wenn die Kurve ruhig genug
 * geworden ist — Legacys Prototyp zeigte an dieser Stelle „CHWARZE SICHE" statt „SCHWARZE SICHEL".
 *
 * Statt das Ergebnis tangential zu verlängern (Legacys Weg, der die Kurve verlässt) wird hier das
 * AUSGANGSfenster größer geschnitten, bis nach dem Beruhigen genug übrig ist. Der Name bleibt damit
 * auf der abgeleiteten Kurve statt auf einer angesetzten Geraden.
 */
function calmedWindowOf(section: readonly Point[], needed: number, accept?: (points: Point[]) => boolean): Point[] {
    const original = accept ? calmedWindowOf(section, needed) : undefined;
    if (original && accept?.(original)) {
        return original;
    }
    let longest: Point[] = [];
    for (const factor of [1, 1.1, 1.25, 1.5, 2]) {
        const window = calmestWindow(
            section,
            Math.min(needed * factor, pathLength(section)),
            undefined,
            accept
                ? (candidate) => {
                      const calmed = calmToChord(candidate, MAX_TURN_DEGREES);
                      return pathLength(calmed) >= needed && accept(calmed);
                  }
                : undefined,
        );
        const calmed = calmToChord(window, MAX_TURN_DEGREES);
        if (pathLength(calmed) >= needed) {
            return calmed;
        }
        if (pathLength(calmed) > pathLength(longest)) {
            longest = calmed;
        }
    }
    // Reicht der Abschnitt auch ungekürzt nicht, kommt der längste Lauf zurück; beim einzelnen Namen
    // verlängert ihn `placeRuns` danach entlang der Sehne (`ausweichLauf`), bis er den Namen trägt (I7).
    return original ?? longest;
}

/**
 * Die Breite des Namens, SO WIE DIE KARTE IHN ZEICHNET.
 *
 * 💣 Hier stand die Breite in gewöhnlicher Schreibung und ohne Sperrung. Seit dem Designkanon
 * (WI-0014) stehen Gebirge, Inseln, Inselgruppen, Regionen und Kontinente aber in VERSALIEN, und
 * die Familie sperrt um 0,02 em — „DRACHENSTEINE" ist deutlich breiter als „Drachensteine". Die
 * Läufe waren zu kurz, und MapLibre verwarf die Namen STILL: gemessen 2026-09-23, Drachensteine,
 * Koschberge und Schwarze Sichel erschienen erst bei Schriftgröße 8. `verify:runs` war grün, weil
 * er dieselbe falsche Breite nachrechnete.
 */
export function displayedNameWidth(region: Pick<RegionInput, "labelText" | "labelSize" | "labelType">): number {
    const versalien =
        region.labelType !== null && AVENTURIA_CARTOGRAPHY.types[region.labelType]?.labelUppercase === true;
    return requiredRunLength(FACULTY_GLYPHIC_METRICS, versalien ? region.labelText.toUpperCase() : region.labelText, {
        size: region.labelSize,
        letterSpacing: labelFamily("landscape").letterSpacing,
    });
}

/**
 * Das oberste Band, für das Läufe entstehen: das Band des Namens, gedeckelt an der höchsten ausgelieferten Vektorkachel
 * (WI-0129). Darüber zeigt die Karte die Kachel dieser Stufe vergrößert (Überzoom, Betreiber 2026-10-10 E1 A); ein Lauf für
 * eine höhere Stufe würde nie abgefragt.
 *
 * 🔴 Fachliche Sichtbarkeit und Kachelstufe sind zwei Dinge. Legacys „bis 7“ steht im Ziel als 8 (E2 A), und der Name steht
 * auf Stufe 8 - aus den Läufen der Stufe 7. Ohne den Deckel kämen je Region Läufe für MapLibre 9 hinzu (am Bestand 123), die
 * Normalisierung leitete alle Regionen neu ab, und ein Lauf auf 9 könnte über den Innenanteil die Wahl der ganzen Region kippen.
 * Ableitung, Fingerabdruck und `verify:runs` lesen denselben Deckel.
 */
export function runCeilingBand(labelMaxZoom: number): number {
    return Math.min(labelMaxZoom, bandForRenderZoom(VECTOR_TILE_MAX_ZOOM));
}

/**
 * Die unterste Kachelstufe, für die Läufe entstehen (WI-0129 §17d, Betreiber 2026-10-11). Stufe n beginnt bei MapLibre n+1;
 * die unterste Stufe 0 hält bis zum kleinsten Zoom der Karte (am Telefon MapLibre 0,71, Kachel 0, Zoomanzeige 0) und beginnt
 * deshalb mit Kachel 0. Dieselbe Regel wie `zoomFromBand` im Stil. Der Fingerabdruck trägt die Untergrenze schon
 * (`labelMinZoom`); neu abgeleitet wird nur eine Region ab Stufe 0, und die gab es am 2026-10-11 nicht.
 */
export function runFloorZoom(labelMinZoom: number): number {
    return labelMinZoom <= 0 ? 0 : renderZoomForBand(labelMinZoom);
}

/** Leitet die Läufe einer Region ab. Gibt einen Grund zurück, statt still nichts zu tun. */
export async function deriveRegion(database: Database, region: RegionInput): Promise<RegionResult> {
    const areas = await database<AreaRow[]>`
        SELECT public_id::text, geometry_revision, ST_Area(geom) AS area
        FROM region_area
        WHERE region_id = ${region.regionId} AND is_active
        ORDER BY ST_Area(geom) DESC
    `;
    const nameWidthPixels = displayedNameWidth(region);
    // Was in die Ableitung eingeht, ist das GEDECKELTE Band: ein Maximum 8 rechnet wie 7 und entwertet keinen Lauf.
    const ceilingBand = runCeilingBand(region.labelMaxZoom);
    const fingerprint = fingerprintOf(
        areas.map((row) => ({ publicId: row.public_id, revision: row.geometry_revision })),
        {
            nameWidthPixels,
            labelMinZoom: region.labelMinZoom,
            labelMaxZoom: ceilingBand,
            curveMax: region.curveMax,
            curveDegree: region.curveDegree,
            reviewedCurve: acceptedCurveOutside(region.name, false),
        },
    );
    const base: RegionResult = {
        regionId: region.regionId,
        name: region.name,
        runs: [],
        fingerprint,
        curveLength: 0,
        nameWidthPixels,
    };

    if (areas.length === 0) {
        return { ...base, skipped: "keine aktive Flaeche" };
    }
    const invalid = await database<{ count: number }[]>`
        SELECT count(*)::int FROM region_area
        WHERE region_id = ${region.regionId} AND is_active AND NOT ST_IsValid(geom)
    `;
    if ((invalid[0]?.count ?? 0) > 0) {
        // I7: die Kurve entfaellt, der Name bleibt als Punktlabel stehen. Nicht repariert.
        return { ...base, skipped: "ungueltige Geometrie" };
    }

    // Die groesste Teilflaeche zaehlt immer, jede weitere ab zwei Prozent der Gesamtflaeche.
    const totalArea = areas.reduce((sum, row) => sum + row.area, 0);
    const parts = areas.filter((row, index) => index === 0 || row.area / totalArea >= MIN_PART_SHARE);
    const partIds = parts.map((row) => row.public_id);

    const shape = await shapeOf(database, partIds);
    if (!shape) {
        return { ...base, skipped: "keine vereinfachte Form" };
    }
    const inside = await interiorTriangles(database, await trianglesOf(database, shape), shape);
    if (inside.length < 2) {
        return { ...base, skipped: "zu wenige Innendreiecke" };
    }

    const axis = longestPath(buildAxisGraph(inside));
    if (axis.length < 2) {
        return { ...base, skipped: "keine Mittelachse" };
    }

    // 🪤 Hier wird NICHT beruhigt. Legacy beruhigt erst zur Laufzeit, und zwar genau das Stück, auf
    // dem der Name steht - nicht den ganzen Kurvenzug (MCS-008, schriftsetzung_zur_laufzeit).
    // Der Unterschied ist die halbe Karte: die Beruhigung mischt die Linie anteilig zu ihrer Sehne,
    // und die Sehne einer sichelförmigen Gesamtkurve läuft quer durch die Landschaft daneben.
    // Gemessen: beruhigt man vorher, liegen 69 von 122 Läufen außerhalb ihrer eigenen Fläche.
    const curve = fitCurve(resample(axis, SAMPLES), SAMPLES, region.curveDegree);
    const curveLength = pathLength(curve);

    // 🔴 `run_min_zoom` und `run_max_zoom` sind RENDERZOOM: die Kachelfunktion vergleicht sie mit
    // ihrem eigenen z, und `mapUnitsPerPixel` rechnet ebenfalls in Renderzoom. Das Band der Region
    // ist dagegen eine FACHLICHE Stufe (Legacys). Die Umrechnung steht deshalb EINMAL hier oben -
    // darunter kommt kein Bandwert mehr vor (WI-0015, MCS-016).
    //
    // 🪤 Genau daran ist der erste Anlauf gescheitert: ich hatte zwei der fünf Stellen umgerechnet
    // und drei stehen lassen. Die Läufe bekamen dadurch ein Loch in ihrem Band, und der Verifier
    // hat es gefunden - eine halbe Umrechnung ist schlechter als keine.
    const placement: Placement = {
        nameWidthPixels: base.nameWidthPixels,
        gapPixels: MIN_GAP_EM * region.labelSize,
        lowest: runFloorZoom(region.labelMinZoom),
        highest: renderZoomForBand(ceilingBand),
        wanted: Math.max(1, Math.min(3, region.curveMax)),
        labelSize: region.labelSize,
    };
    const runs = placeRuns(curve, placement);
    if (runs.length === 0) {
        return { ...base, curveLength, skipped: "kein Lauf passt" };
    }

    // Gute und ausdrücklich abgenommene Bögen bleiben koordinatengleich. Ein neuer Innenbefund
    // darf eine achsentreue Alternative wählen; scheitert sie, bleibt der bisherige Lauf samt Befund.
    if (!acceptedCurveOutside(region.name, false)) {
        const footprint = await curveFootprint(database, region.regionId);
        const shares = footprint.concave ? [] : await runShares(database, footprint, runs);
        if (!footprint.concave && shares.some((share) => share <= 0.5)) {
            const orderedCurve = fitParametricCurve(axis, SAMPLES, region.curveDegree);
            const insidePlacement = {
                ...placement,
                acceptWindow: (points: Point[]) => mostlyInside(footprint, points),
            };
            const ordered = placeRuns(orderedCurve, insidePlacement);
            const adjusted = placeRuns(curve, insidePlacement);
            const candidate = selectCoveredRunSets(
                runs,
                shares,
                [
                    { runs: ordered, shares: await runShares(database, footprint, ordered) },
                    { runs: adjusted, shares: await runShares(database, footprint, adjusted) },
                ],
                base.nameWidthPixels,
            );
            if (candidate) {
                const usedLengths = [];
                if (candidate.some((run) => ordered.includes(run))) {
                    usedLengths.push(pathLength(orderedCurve));
                }
                if (candidate.some((run) => runs.includes(run) || adjusted.includes(run))) {
                    usedLengths.push(curveLength);
                }
                return { ...base, curveLength: Math.max(...usedLengths), runs: candidate };
            }
        }
    }

    return { ...base, curveLength, runs };
}

/** MapLibres Knickprüfung unter einem Liniennamen: Fenster 3/5 der Schriftgröße, `text-max-angle` 45 Grad (Vorgabe). */
const MAPLIBRE_ANGLE_WINDOW_EM = 3 / 5;
const MAPLIBRE_MAX_ANGLE = Math.PI / 4;

/** Was die Platzierung braucht: Namensbreite und Lücke in Bildschirmpixeln, das Band in Renderzoom. */
export interface Placement {
    nameWidthPixels: number;
    gapPixels: number;
    lowest: number;
    highest: number;
    /** Gewünschte Zahl der Namensinstanzen, 1..3 (`label_curve_max`). */
    wanted: number;
    /** Schriftgröße in Pixeln: MapLibre prüft den Knick unter dem Namen in Stücken von 3/5 davon (`text-max-angle`). */
    labelSize: number;
    acceptWindow?: (points: Point[]) => boolean;
}

/**
 * Setzt die Namen auf die fertige Kurve: welche Instanzzahl auf welcher Stufe, und wo genau.
 *
 * Von oben nach unten: der höchste Satz, der passt, bekommt das obere Ende des Bandes; darunter
 * folgt der nächstkleinere. Der Satz mit EINER Instanz wird nicht geprüft und schließt nach unten
 * ab - Legacy nimmt einen einzelnen Namen ohne Passungsprüfung an, und I7 verlangt, dass ein zu
 * enger Platz niemals den Namen kostet: Reicht die Kurve nicht, wird sein Lauf verlängert (`ausweichLauf`).
 */
export function placeRuns(curve: readonly Point[], placement: Placement): DerivedRun[] {
    const { nameWidthPixels: nameWidth, gapPixels, lowest: untersteStufe, highest: obersteStufe, wanted } = placement;
    const curveLength = pathLength(curve);
    const runs: DerivedRun[] = [];
    let ceiling = obersteStufe;
    for (let count = wanted; count >= 1; count -= 1) {
        if (ceiling < untersteStufe) {
            break;
        }
        const fitsAt =
            count === 1 ? untersteStufe : zoomWhereInstancesFit(curveLength, count, nameWidth, gapPixels, obersteStufe);
        if (fitsAt === null) {
            continue;
        }
        const floor = Math.max(fitsAt, untersteStufe);
        if (floor > ceiling) {
            continue;
        }
        // Beruhigt wird erst das FENSTER: seine eigene Sehne liegt nah an ihm, deshalb glättet die
        // Mischung einen Knick heraus, statt das Stück quer durch die Gegend zu ziehen.
        const windowsAt = (zoom: number): Point[][] | null => {
            const pieces = splitIntoInstances(curve, count, gapPixels * mapUnitsPerPixel(zoom));
            const needed = nameWidth * mapUnitsPerPixel(zoom);
            // Der einzelne Name fällt nie aus (I7): Trägt sein Fenster ihn nicht, wird es entlang der Sehne verlängert, und so,
            // dass MapLibre ihn auch setzt (`text-max-angle`, Vorgabe 45 Grad). Dazu bekommt er den Ausweichraum (Migration 0110).
            const passt = (points: Point[]): boolean =>
                labelFitsAngle(
                    points,
                    needed,
                    MAPLIBRE_ANGLE_WINDOW_EM * placement.labelSize * mapUnitsPerPixel(zoom),
                    MAPLIBRE_MAX_ANGLE,
                    Number.POSITIVE_INFINITY,
                );
            return pieces.length === 0
                ? null
                : pieces.map((piece) => {
                      const window = calmedWindowOf(piece, needed, placement.acceptWindow);
                      return count === 1 ? ausweichLauf(window, needed, passt) : window;
                  });
        };
        const lowestWindows = windowsAt(floor);
        // 🪤 Die Passung entscheidet sich NACH dem Beruhigen, nicht davor. `zoomWhereInstancesFit`
        // rechnet mit der Bogenlänge; beruhigt bleibt davon weniger übrig. Trägt ein Stück seinen
        // Namen dann nicht mehr, wird die ganze Instanzzahl verworfen und für die kleinere neu
        // verteilt - nie eine einzelne Instanz weggelassen (Betreiberregel, MCS-008). Geprüft wird
        // auf `floor`: dort ist der Name im Kartenmaß am längsten, darüber passt er erst recht.
        //
        // Ausgenommen ist wieder der Satz mit EINER Instanz: er wird angenommen und, wo nötig,
        // verlängert, damit der Name nicht ausfällt (I7).
        if (
            lowestWindows === null ||
            (count > 1 && lowestWindows.some((window) => pathLength(window) < nameWidth * mapUnitsPerPixel(floor)))
        ) {
            continue;
        }
        // 💣 Das Fenster wird JE STUFE gewählt, nicht einmal für das ganze Band (WI-0018). Hier stand
        // „auf `floor` ist das Fenster am längsten, und was dort ruhig und innen liegt, bleibt es“ -
        // Farlornschwelle hat das widerlegt. Auf z3 war der Name länger als die ganze Kurve, also
        // wurde die GANZE Kurve zur Sehne beruhigt, und die Sehne lief über den Blauen See. Die
        // Kachel schnitt für jede höhere Stufe die Mitte dieses Laufs heraus: bei z5 stand der Name
        // 7,6 Einheiten neben der eigenen Kurve und zu 90 Prozent außerhalb der Fläche. Legacy
        // rechnet das Fenster bei jedem Zeichnen für den aktuellen Zoom (MCS-008) - genau das tut
        // diese Schleife, nur vorab.
        for (let zoom = floor; zoom <= ceiling; zoom += 1) {
            const windows = zoom === floor ? lowestWindows : (windowsAt(zoom) ?? lowestWindows);
            for (const [instance, points] of windows.entries()) {
                runs.push({ instance, instanceCount: count, runMinZoom: zoom, runMaxZoom: zoom, points });
            }
        }
        ceiling = floor - 1;
    }
    return runs;
}
