import { MercatorCoordinate } from "maplibre-gl";
import {
    AVENTURIA,
    AVENTURIA_FLIGHT_CARTOGRAPHY,
    AVENTURIA_TRAVEL_MODEL,
    DESIGN_CANON,
    flightAltitude,
    toRenderLngLat,
} from "@avesmaps3d/shared";
import {
    FLIGHT_COLOUR,
    isFlightSegment,
    segmentShape,
    type RouteLayerData,
    type RouteLineColour,
} from "./route-layers";

/**
 * Die Flugbahn im Raum als Rechnung, ohne Browser (WI-0051 F3): welche Abschnitte fliegen, wo ihre Proben
 * liegen, wie hoch die Bahn über jeder Probe steht. Gezeichnet wird sie in `flight-arcs.ts`; der Pfeil des
 * Playmodes fliegt auf genau diesem Profil mit (`flightPointAt`).
 *
 * Betreiber 2026-09-28: „kannst du dann den 3D flug mit einer schwebenden 3D kurve darstellen? ähnlich wie
 * die kraftlinien? wie ein flugzeug dass aufsteigt, seine höhe einnimmt, kurven zum ausweichen (gebirge)
 * einschlägt) und dann wieder ins ziel sinkt“. Zum Entwurf `f3-echt2` wörtlich „A“: die Bahn im echten
 * Höhenmaßstab, nach der Regel „zuerst steigt das flugmittel auf die durchschnittliche flughöhe, erst wenn
 * hindernisse kommen, steigt das fluggerät bis 1000% an. wenn es dann nicht ausweichen kann, weicht es aus“.
 * Das ersetzt den bildschirmbezogenen Bogen „B + C“ des ersten Entwurfs.
 *
 * - **Form:** Die Proben liegen in gleichen Abständen auf der Form, die auch flach gezeichnet wird
 *   (`segmentShape`), samt der gerundeten Ecken des Wegs um die Gebirge.
 * - **Bedarf je Probe:** min(Obergrenze, max(Reisehöhe, Boden + Mindestabstand)), alles in Schritt über dem
 *   Meer. Die Obergrenze je Probe ist min(Höchstflughöhe über dem Meer, Boden + höchste Höhe über Grund)
 *   (Betreiber 2026-10-04: 10 × Reisehöhe über Grund, 5.000 Schritt über dem Meer). Reisehöhe und beide Grenzen
 *   kommen aus der Antwort (`air`), der Mindestabstand aus dem Reisemodell. Außerhalb der Gebirge ist der Boden 0.
 *   Ausgewichen ist schon: Den Weg um Gebirge über 4.800 Schritt rechnet F2.
 * - **Höhe halten:** Der Bedarf gilt als Höchstwert über ± `haltenEinheiten`, damit das Flugmittel über nahe
 *   beieinander liegenden Graten nicht in jedes Tal sinkt.
 * - **Steigen und Sinken** mit `steigung` (1 : 4): die obere Hülle des Bedarfs mit dieser Steigung, am Start vom
 *   Boden auf, am Ziel auf den Boden. Nie unter dem Boden.
 * - **Maßstab 1 : 1 wie das Gelände** (`MERCATOR_PER_SCHRITT`), mal der Überhöhung, die gerade gilt: Beim Neigen
 *   wächst die Bahn genau mit den Bergen. Nichts ist bildschirmbezogen. Die Bodenhöhen tastet `flight-arcs.ts`
 *   einmal je Route und Geländewechsel ab, ohne Überhöhung.
 */

const TAFEL = AVENTURIA_FLIGHT_CARTOGRAPHY;
const BAHN = TAFEL.bahn;
const space = AVENTURIA.coordinateSpace;

/** Eine Meile sind 1.000 Schritt (1 Schritt = 1 m, 1 Meile = 1 km, wie im Reisemodell). */
const SCHRITT_JE_MEILE = 1000;

/** Mercator-Einheiten je Karteneinheit, über die Projektion der Karte gemessen (heute 1 / 1024). */
export const MERCATOR_PER_UNIT = ((): number => {
    const [ax, ay] = mercator(0, 0);
    const [bx, by] = mercator(1, 0);
    return Math.hypot(bx - ax, by - ay);
})();

/**
 * Mercator-z je Schritt Höhe, maßstabsgetreu wie das Gelände: Eine Karteneinheit sind `milesPerUnit` Meilen,
 * und die Höhenkacheln tragen Schritt samt dem Ausgleich der Breite (WI-0049 S1), den MapLibre mit
 * Überhöhung 1 genau so hoch zeichnet. Heute 1 / (1024 · 3000).
 */
export const MERCATOR_PER_SCHRITT = MERCATOR_PER_UNIT / (space.distance.milesPerUnit * SCHRITT_JE_MEILE);

/** Ein Flugabschnitt, abgetastet in gleichen Abständen entlang seiner gezeichneten Form. */
export interface FlightTrack {
    /** Die Etappe, zu der er gehört. */
    stage: number;
    /** Die Nummer des Abschnitts in der Route (`RouteSegment.index`): Daran findet der Pfeil seine Bahn. */
    segment: number;
    /** Die Proben in Mercator (0..1), erster und letzter Punkt auf den Wegpunkten. */
    x: Float64Array;
    y: Float64Array;
    /** Dieselben Proben als Länge und Breite, für die Höhenabfrage. */
    lng: Float64Array;
    lat: Float64Array;
    /** Länge der Form in Mercator-Einheiten. */
    length: number;
    /**
     * Reisehöhe, höchste Höhe über Grund, Höchstflughöhe über dem Meer und Mindestabstand als Mercator-z ohne
     * Überhöhung.
     */
    cruise: number;
    reach: number;
    ceiling: number;
    clearance: number;
    /** Die Farbe im Kanon: die des Flugs oder Gold für die gewählte Etappe. */
    colour: RouteLineColour | "routeSelected";
    /** Deckkraft: veraltet gedimmt wie die übrige Route. */
    alpha: number;
    /** Bodenhöhe je Probe ohne Überhöhung, als Mercator-z; 0, solange nichts abgetastet ist. */
    ground: Float32Array;
}

/**
 * Das Höhenprofil der Bahn je Probe, in Mercator-z samt Überhöhung, nach der Regel oben: Bedarf, Höhe halten,
 * obere Hülle mit der Steigung, Rampen an Start und Ziel, nie unter dem Boden. Die eine Rechnung für Bahn und
 * Pfeil.
 */
export function flightProfile(
    track: Pick<FlightTrack, "ground" | "length" | "cruise" | "reach" | "ceiling" | "clearance">,
    exaggeration: number,
    out: Float32Array = new Float32Array(track.ground.length),
): Float32Array {
    // Die Regel selbst steht in `shared` (`flightAltitude`): dieselbe Rechnung zeichnet die rote Linie im Höhenprofil.
    const hoehe = flightAltitude({
        ground: track.ground,
        length: track.length,
        cruise: track.cruise,
        ceiling: track.ceiling,
        reach: track.reach,
        clearance: track.clearance,
        hold: BAHN.haltenEinheiten * MERCATOR_PER_UNIT,
        slope: BAHN.steigung,
    });
    if (hoehe.length < 2) {
        out.fill((hoehe[0] ?? 0) * exaggeration);
        return out;
    }
    for (let k = 0; k < hoehe.length; k += 1) out[k] = (hoehe[k] as number) * exaggeration;
    return out;
}

/** Ein Punkt der Karte als Mercator (0..1). */
function mercator(x: number, y: number): [number, number] {
    const lngLat = toRenderLngLat(space, { x, y });
    const m = MercatorCoordinate.fromLngLat(lngLat);
    return [m.x, m.y];
}

/**
 * Wie viele Proben jeder Abschnitt bekommt: nach seinem Anteil an der Länge aller Flugabschnitte von
 * `jeRouteHoechstens`, zwischen `jeAbschnittMindestens` und `jeAbschnittHoechstens`.
 */
export function sampleCounts(lengths: readonly number[]): number[] {
    const { jeAbschnittMindestens: wenigstens, jeAbschnittHoechstens: hoechstens, jeRouteHoechstens } = TAFEL.proben;
    const gesamt = lengths.reduce((a, b) => a + b, 0);
    return lengths.map((laenge) => {
        const anteil = gesamt > 0 ? Math.floor((jeRouteHoechstens * laenge) / gesamt) : wenigstens;
        return Math.min(hoechstens, Math.max(wenigstens, anteil));
    });
}

/** Tastet einen Zug in `count` gleichen Abständen ab, erster und letzter Punkt eingeschlossen. */
export function resampleEvenly(
    points: readonly [number, number][],
    count: number,
): { x: Float64Array; y: Float64Array; length: number } {
    const lauf = [0];
    for (let i = 1; i < points.length; i += 1) {
        const [ax, ay] = points[i - 1] as [number, number];
        const [bx, by] = points[i] as [number, number];
        lauf.push((lauf[i - 1] as number) + Math.hypot(bx - ax, by - ay));
    }
    const length = lauf[lauf.length - 1] ?? 0;
    const x = new Float64Array(count);
    const y = new Float64Array(count);
    let stueck = 1;
    for (let k = 0; k < count; k += 1) {
        const s = count > 1 ? (length * k) / (count - 1) : 0;
        while (stueck < points.length - 1 && (lauf[stueck] as number) < s) stueck += 1;
        const [ax, ay] = points[Math.max(0, stueck - 1)] as [number, number];
        const [bx, by] = (points[Math.min(stueck, points.length - 1)] ?? points[0]) as [number, number];
        const von = lauf[stueck - 1] ?? 0;
        const spanne = (lauf[stueck] ?? von) - von;
        const f = spanne > 0 ? Math.min(1, Math.max(0, (s - von) / spanne)) : 0;
        x[k] = ax + (bx - ax) * f;
        y[k] = ay + (by - ay) * f;
    }
    return { x, y, length };
}

/**
 * Die Flugabschnitte der Route, abgetastet: nur Abschnitte der Wegart „Flug“, mit der Farbe und Deckkraft,
 * die auch ihre Linie hätte (Gold für die gewählte Etappe, veraltet gedimmt). Die Bodenhöhen stehen noch
 * auf 0.
 */
export function buildFlightTracks(data: RouteLayerData): FlightTrack[] {
    const route = data.route;
    if (!route?.found) return [];
    const stageOf = new Map<number, number>();
    for (const stage of route.stages) {
        for (let index = 0; index < stage.segment_count; index += 1)
            stageOf.set(stage.segment_start + index, stage.index);
    }
    const formen = route.segments.filter(isFlightSegment).map((segment) => {
        const punkte = segmentShape(segment).map((point) => mercator(point.x, point.y));
        let laenge = 0;
        for (let i = 1; i < punkte.length; i += 1) {
            const [ax, ay] = punkte[i - 1] as [number, number];
            const [bx, by] = punkte[i] as [number, number];
            laenge += Math.hypot(bx - ax, by - ay);
        }
        return { segment, punkte, laenge };
    });
    const anzahl = sampleCounts(formen.map((form) => form.laenge));
    // Reisehöhe und beide Höchstgrenzen aus der Antwort, der Mindestabstand aus dem Reisemodell (F2: 200 Schritt).
    const cruise = (route.air?.altitude_schritt ?? 0) * MERCATOR_PER_SCHRITT;
    const reach = (route.air?.max_above_ground_schritt ?? Number.POSITIVE_INFINITY) * MERCATOR_PER_SCHRITT;
    const ceiling = (route.air?.ceiling_schritt ?? Number.POSITIVE_INFINITY) * MERCATOR_PER_SCHRITT;
    const clearance = AVENTURIA_TRAVEL_MODEL.flug.wert.mindestabstandSchritt * MERCATOR_PER_SCHRITT;
    const farbe = FLIGHT_COLOUR;
    return formen.map(({ segment, punkte }, nummer): FlightTrack => {
        const stage = stageOf.get(segment.index) ?? 0;
        const selected = !data.stale && data.selectedStage === stage;
        const { x, y, length } = resampleEvenly(punkte, anzahl[nummer] as number);
        const lng = new Float64Array(x.length);
        const lat = new Float64Array(x.length);
        for (let k = 0; k < x.length; k += 1) {
            const lngLat = new MercatorCoordinate(x[k] as number, y[k] as number).toLngLat();
            lng[k] = lngLat.lng;
            lat[k] = lngLat.lat;
        }
        return {
            stage,
            segment: segment.index,
            x,
            y,
            lng,
            lat,
            length,
            cruise,
            reach,
            ceiling,
            clearance,
            colour: selected ? "routeSelected" : farbe,
            alpha: data.stale ? DESIGN_CANON.route.staleFactor : 1,
            ground: new Float32Array(x.length),
        };
    });
}

/**
 * Tastet die Bodenhöhen einer Bahn ab. `elevation` liefert wie `map.queryTerrainElevation` Meter samt
 * Überhöhung; bei Überhöhung 0 bleibt, was da ist.
 *
 * @returns den höchsten Boden unter der Bahn in Schritt, oder 0.
 */
export function sampleFlightGround(
    track: FlightTrack,
    elevation: (lngLat: { lng: number; lat: number }) => number | null,
    exaggeration: number,
): number {
    if (!(exaggeration > 0)) return 0;
    let hoechster = 0;
    for (let k = 0; k < track.ground.length; k += 1) {
        const lngLat = { lng: track.lng[k] as number, lat: track.lat[k] as number };
        const meter = (elevation(lngLat) ?? 0) / exaggeration;
        const z = meter === 0 ? 0 : MercatorCoordinate.fromLngLat(lngLat, meter).z;
        track.ground[k] = z;
        hoechster = Math.max(hoechster, z / MERCATOR_PER_SCHRITT);
    }
    return hoechster;
}

/**
 * Die Lote eines Abschnitts: in Halbierungen, `teileHoechstens` Teile, jedes mit der Stufe, ab der es
 * steht (1 die Mitte, 2 die Viertel und so fort).
 */
export function lotSteps(teile: number = TAFEL.zeichnung.lote.teileHoechstens): { anteil: number; stufe: number }[] {
    const tiefe = Math.round(Math.log2(teile));
    const lote: { anteil: number; stufe: number }[] = [];
    for (let j = 1; j < teile; j += 1) {
        let nullen = 0;
        while (((j >> nullen) & 1) === 0) nullen += 1;
        lote.push({ anteil: j / teile, stufe: tiefe - nullen });
    }
    return lote;
}

/**
 * Wie deutlich ein Lot der Stufe `stufe` steht, wenn der Abschnitt `laengePx` Pixel lang ist: voll, sobald
 * es `abstandPx` von seinen Nachbarn hat, darunter bis zum halben Abstand ausgeblendet. Beim Zoomen blendet
 * so die nächste Teilung ein, keines springt.
 */
export function lotAlpha(stufe: number, laengePx: number, abstandPx: number = TAFEL.zeichnung.lote.abstandPx): number {
    if (!(laengePx > 0)) return 0;
    return Math.min(1, Math.max(0, Math.log2(laengePx / abstandPx) - stufe + 1));
}

/**
 * Die Bahn an der Stelle `along` (0 bis 1 der Länge) ihres Abschnitts: Mercator samt Höhe aus `profile`,
 * zwischen zwei Proben linear. Der Pfeil des Playmodes fliegt so auf genau der Bahn, die gezeichnet ist
 * (Betreiber 2026-09-28: „er soll in der luft mitfliegen“) - keine zweite Rechnung, keine Höhenabfrage.
 */
export function flightPointAt(
    track: Pick<FlightTrack, "x" | "y">,
    profile: Float32Array,
    along: number,
): { x: number; y: number; z: number } {
    const letzte = Math.min(track.x.length, profile.length) - 1;
    if (letzte < 1) return { x: track.x[0] ?? 0, y: track.y[0] ?? 0, z: profile[0] ?? 0 };
    const u = Math.min(1, Math.max(0, Number.isFinite(along) ? along : 0)) * letzte;
    const k = Math.min(Math.floor(u), letzte - 1);
    const f = u - k;
    const mix = (werte: ArrayLike<number>): number =>
        (werte[k] as number) + ((werte[k + 1] as number) - (werte[k] as number)) * f;
    return { x: mix(track.x), y: mix(track.y), z: mix(profile) };
}

/**
 * Ein Punkt in Mercator samt Höhe mit MapLibres Hauptmatrix auf den Bildschirm, in CSS-Pixeln einer Fläche
 * von `width` × `height`. Hinter der Kamera: keiner.
 */
export function projectToScreen(
    matrix: ArrayLike<number>,
    point: { x: number; y: number; z: number },
    width: number,
    height: number,
): { x: number; y: number } | undefined {
    const m = (i: number): number => matrix[i] ?? 0;
    const { x, y, z } = point;
    const w = m(3) * x + m(7) * y + m(11) * z + m(15);
    if (!(w > 0)) return undefined;
    const nx = (m(0) * x + m(4) * y + m(8) * z + m(12)) / w;
    const ny = (m(1) * x + m(5) * y + m(9) * z + m(13)) / w;
    return { x: ((nx + 1) / 2) * width, y: ((1 - ny) / 2) * height };
}
