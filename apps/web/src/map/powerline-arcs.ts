import { MercatorCoordinate } from "maplibre-gl";
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA_POWERLINE_CARTOGRAPHY,
    AVENTURIA_ZOOM_BANDS,
    DESIGN_CANON,
    WEB_MERCATOR_HALF_WORLD,
    powerlineArcHeight,
    powerlineArcLift,
    powerlineCurveSteps,
    rgbaColour,
    type MapPoint,
    type PowerlineGlow,
    type PowerlineNetwork,
    type RenderProjection,
} from "@avesmaps3d/shared";
import { leyKnotenRadiusBei } from "./place-layers";
import { LEY_NODE_SOURCE_ID, LEY_NODE_SOURCE_LAYER, POWERLINE_LABEL_LAYER_ID } from "./powerline-layers";
import { styleTakesChanges } from "./style-ready";

/**
 * Die Kraftlinien als wabernde Stränge und, geneigt, als Bögen am Himmel (WI-0025 Stufe 2).
 *
 * Betreiber 2026-09-23: „gehen animierte "magische" stränge? … kannst du aus ihnen 3D-kurven machen,
 * die erst hoch und dann wieder runter gehen? … im 3d modus kannst du ihren namen aufrichten und auf
 * der kurve entlang laufen lassen“. Am Entwurf: „die höhe der bögen leicht reduzieren“, „bögen sollen
 * animiert sein“.
 *
 * ⭐ Flach ist das Bild Legacys: drei Stränge je Linie, jeder in Aura, Mitte und Kern, die mit Legacys
 * Formel wabern (`createPowerlineStrandLatLngs`, 30 Bilder je Sekunde). Mit der Neigung steigen sie
 * als Bögen auf, jedes Stück von Knoten zu Knoten, und landen an Orten, Labels und Kraftlinienpunkten
 * (Betreiber 2026-09-26: „dort landen, wie bei knoten“). Die Namen stehen dann aufrecht am Bogen.
 *
 * ⭐ Neben Legacys Strängen laufen feine Fäden unterschiedlicher Stärke, und alle laufen rund durch ihre
 * Stützpunkte (Betreiber 2026-10-11: „mehr leuchtende Fäden unterschiedlicher Stärke …, ihnen mehr Punkte
 * und vielleicht sogar Glättung geben“). Legacy verbindet die Stützpunkte gerade; hier verbindet sie eine
 * Catmull-Rom-Kurve, die genau durch sie geht. Was jeder Faden zieht, steht in `arcThreads`.
 *
 * 🔴 Ein eigener MapLibre-Custom-Layer mit WebGL2, KEINE neue Abhängigkeit. Die Strangformel läuft im
 * Vertex-Shader; die CPU rechnet nur die Namen neu, und nur wenn sich die Kamera bewegt. Jede Linie liegt
 * EINMAL im Puffer; jeder Faden ist eine Instanz davon, und die drei Leuchtlagen mischt der Fragment-Shader
 * in einem Zug (dasselbe Bild wie drei Züge übereinander, ein Drittel der Ecken).
 *
 * 🔴 Farben, Breiten, Stellschrauben und Höhen kommen aus der Tafel
 * (`config/map-cartography/aventuria-powerlines.json`). Kein Farbliteral in dieser Datei.
 *
 * 🔴 Auf dem Gelände (WI-0049) stehen die Bögen auf der Höhe ihrer Endpunkte: Ein Nodix auf einem
 * Gipfel trägt seine Bögen dort oben, nicht am Fuß des Berges. Zwischen den Füßen wird gemischt.
 *
 * 🪤 Ein Custom Layer steht nicht im Stil-JSON. `setStyle` mit `diff` lässt ihn stehen, ein volles
 * Neuladen wirft ihn hinaus; deshalb prüft `installPowerlineArcs` nach JEDEM `styledata`, ob er da ist.
 */

export const POWERLINE_ARCS_LAYER_ID = "powerline-boegen";

const TAFEL = AVENTURIA_POWERLINE_CARTOGRAPHY;
const STRAENGE = TAFEL.straenge;
const FAEDEN = TAFEL.faeden;
const BOEGEN = TAFEL.boegen;
/** Legacys Stränge und die Fäden: so viele Instanzen zeichnet jede Linie. */
export const THREADS_PER_LINE = STRAENGE.anzahl + FAEDEN.anzahl;
/** Weniger Proben je Segment bekommt keine Linie: Mit einer läge sie wieder gerade zwischen den Stützpunkten. */
const PROBEN_MINDESTENS = 2;
/**
 * Die Stufen der Unterteilung: 1, 2, 4 … bis `straenge.verfeinerung` mal so viele Proben wie in der gröbsten. Je Bild bekommt jede
 * Linie die gröbste Stufe, in der ein gerades Stück auf dem Bildschirm höchstens `straenge.kantePx` lang ist (`arcLevels`).
 */
export const ARC_LEVELS: readonly number[] = Array.from(
    { length: Math.round(Math.log2(STRAENGE.verfeinerung)) + 1 },
    (_, stufe) => 2 ** stufe,
);
/**
 * Floats je Ecke: Bodenpunkt, davor, danach (je 2), t mit Nachbarn (3), Seite, Sehne (2), Segmente,
 * Laufweg mit Nachbarn (3), Länge des Stücks, Nummer der Linie (für ihre Bodenhöhe und ihre Fäden).
 */
const FLOATS = 18;
/** Breite der Texturen je Linie (Bodenhöhen, Fäden), in Texeln. */
const BODEN_BREITE = 1024;
/** Texel je Faden in der Fadentextur: Breite, Leuchtkraft, Ausschlag, Versatz | Phase, Rauschen, Spreizung, Phase des Bündels. */
const TEXEL_JE_FADEN = 2;

/** Eine Linie, vorbereitet für Stränge und Namen; alle Längen in Mercator-Einheiten (0..1). */
export interface ArcLine {
    /** `powerline.public_id` des Segments: der Anker, mit dem ein Klick den Subject öffnet. */
    id: string;
    name: string;
    labelVisible: boolean;
    points: [number, number][];
    /** Laufweg bis zu jedem Stützpunkt. */
    run: number[];
    length: number;
    /** Richtung der Sehne vom ersten zum letzten Punkt, Einheitsvektor. */
    chord: [number, number];
    /** Stützpunktzahl der Stränge (`straenge.segmente` gerade, bis 24 gebogen). */
    segments: number;
    /**
     * Wie stark ihre Stränge rauschen: ihre Länge in Karteneinheiten durch die `bezugslaenge` der Tafel. Wellen und Abstand der
     * Fäden wachsen damit mit der Linie, und jede Linie hat dasselbe Rauschen im Verhältnis zu ihrer Länge.
     */
    noise: number;
    /**
     * Proben je Segment, durch die die geglättete Kurve gezeichnet wird: `straenge.proben` bei der Bezugslänge, sonst im Verhältnis
     * der Länge, mindestens zwei. Jede Linie hat so dieselbe Punktdichte; eine lange zeigt nah dran keine Ecken, die eine kurze nicht
     * auch zeigte.
     */
    probes: number;
    /**
     * Wie weit die Fäden um die Mitte des Bündels auseinanderlaufen, als Vielfaches von Legacys Versätzen: `faecherbreite` für jede
     * Linie ab der Bezugslänge, darunter im Verhältnis ihres Rauschens. Betreiber 2026-10-11: „jetzt auch den spread gleich breit
     * machen“. Das Bündel als Ganzes schwingt
     * weiter mit der Länge (`noise`), seine Breite bleibt; nur kurze Linien werden schmaler, damit sie ruhig bleiben.
     */
    spread: number;
    /** Die Phase der Mitte des Bündels, aus der Kennung der Linie: Nicht jede Linie biegt sich an denselben Stellen. */
    phase: number;
}

export interface ArcGeometry {
    lines: ArcLine[];
    /** Mercator-Einheiten je Karteneinheit: Legacys Strangversätze stehen in Karteneinheiten. */
    unit: number;
    vertices: Float32Array;
    /**
     * Die Dreiecke aller Linien, je Stufe der Unterteilung einmal (`ARC_LEVELS`), Stufe für Stufe hintereinander; jeder Strang und
     * jeder Faden ist eine Instanz davon. Die Ecken liegen in der feinsten Stufe vor, eine gröbere überspringt Proben.
     */
    indices: Uint32Array;
    /**
     * Wo die Dreiecke jeder Linie in jeder Stufe im Indexpuffer stehen (`ranges[linie][stufe]`, Index und Anzahl). In einer Stufe
     * folgen die Linien in ihrer Reihenfolge aufeinander: Nachbarn derselben Stufe zeichnet ein Zug.
     */
    ranges: { start: number; count: number }[][];
    /**
     * Je Linie und Faden zwei Texel: Breite, Leuchtkraft, Ausschlag, Versatz des Fadens (`arcThreads`) | seine Phase, dazu Rauschen,
     * Spreizung und Phase des Bündels seiner Linie.
     */
    threads: Float32Array;
}

/** Ein Strang oder Faden einer Linie: was der Shader je Linie und Faden liest. */
export interface ArcThread {
    /** Anteil der Breite der Leuchtlagen. */
    breite: number;
    /** Anteil ihrer Deckkraft. */
    licht: number;
    /** Wie weit die Welle ausschlägt (Legacys `normalScales`). */
    ausschlag: number;
    /** Abstand von der Bahn vor dem Ausschlag, in Karteneinheiten (Legacys `waveOffsets`). */
    versatz: number;
    phase: number;
}

/** FNV-1a über die Kennung: der Keim einer Linie, auf jedem Rechner und in jedem Lauf derselbe. */
function keim(text: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Aus einem Keim eine feste Folge von Zahlen in [0, 1) (mulberry32). */
function folge(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function zwischen([von, bis]: readonly [number, number], anteil: number): number {
    return von + (bis - von) * anteil;
}

/**
 * Die Stränge und Fäden EINER Linie, in Zeichenreihenfolge: zuerst Legacys Stränge in voller Stärke, mit Legacys Ausschlag,
 * Versatz und Phase; dann die Fäden. Ein Faden zieht aus der Kennung seiner Linie (Segment, `powerline.public_id`) seine Stärke,
 * die Breite und Leuchtkraft zusammen setzt, dann Ausschlag, Versatz und Phase, je aus dem Bereich der Tafel. Eine Regel für alle
 * Linien; dieselbe Linie sieht nach jedem Laden gleich aus.
 */
export function arcThreads(id: string): ArcThread[] {
    const jeStrang = (werte: readonly number[], k: number): number => werte[k] ?? werte[werte.length - 1] ?? 0;
    const straenge = Array.from({ length: STRAENGE.anzahl }, (_, k) => ({
        breite: 1,
        licht: 1,
        ausschlag: jeStrang(STRAENGE.normalScales, k),
        versatz: jeStrang(STRAENGE.waveOffsets, k),
        phase: k * STRAENGE.phaseStep,
    }));
    const zufall = folge(keim(id));
    const faeden = Array.from({ length: FAEDEN.anzahl }, () => {
        const staerke = zufall();
        return {
            breite: zwischen(FAEDEN.breite, staerke),
            licht: zwischen(FAEDEN.leuchtkraft, staerke),
            ausschlag: zwischen(FAEDEN.ausschlag, zufall()),
            versatz: zwischen(FAEDEN.versatz, zufall()),
            phase: zufall() * 2 * Math.PI,
        };
    });
    return [...straenge, ...faeden];
}

function mercator(projection: RenderProjection, point: MapPoint): [number, number] {
    const render = projection.toRender(point);
    const welt = 2 * WEB_MERCATOR_HALF_WORLD;
    return [render.x / welt + 0.5, 0.5 - render.y / welt];
}

/** Der Punkt der Bahn beim Anteil `t` (nach Stützpunkten, wie Legacys Formel) und sein Laufweg. */
function aufDerBahn(line: ArcLine, t: number): [number, number, number] {
    const letzte = line.points.length - 1;
    const u = Math.min(Math.max(t, 0), 1) * letzte;
    const j = Math.min(Math.floor(u), letzte - 1);
    const f = u - j;
    const p = line.points[j] as [number, number];
    const q = line.points[j + 1] as [number, number];
    const rp = line.run[j] as number;
    const rq = line.run[j + 1] as number;
    return [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f, rp + (rq - rp) * f];
}

/**
 * Die Kraftlinien, die an diesem Knoten enden, je Linie EINMAL: Anker ist die kleinste Kennung ihrer Abschnitte gleichen Namens (wie
 * der Editor gruppiert; ein Abschnitt ohne Namen ist eine Linie für sich), nach Namen geordnet (EDIT-0003 T39).
 */
export function linienAmKnoten(netz: PowerlineNetwork, knoten: string): { anker: string; name: string }[] {
    const anker = new Map<string, string>();
    for (const linie of netz.lines) {
        // Ein Abschnitt ohne Namen ist eine Linie für sich (wie der Editor gruppiert).
        const gruppe = linie.name.trim() === "" ? `#${linie.id}` : linie.name;
        const bisher = anker.get(gruppe);
        if (bisher === undefined || linie.id < bisher) anker.set(gruppe, linie.id);
    }
    const hier = new Map<string, { anker: string; name: string }>();
    for (const linie of netz.lines) {
        if (linie.from.id !== knoten && linie.to.id !== knoten) continue;
        const gruppe = linie.name.trim() === "" ? `#${linie.id}` : linie.name;
        hier.set(gruppe, { anker: anker.get(gruppe) ?? linie.id, name: linie.name });
    }
    return [...hier.values()].sort((a, b) => a.name.localeCompare(b.name, "de") || (a.anker < b.anker ? -1 : 1));
}

/**
 * Die Geometrie aller Linien, ohne Browser prüfbar.
 *
 * Je Linie und Probe zwei Ecken (links und rechts des Bandes). Jede Ecke trägt ihren Bodenpunkt, die
 * Nachbarn davor und danach (für die Bandbreite auf dem Bildschirm), den Anteil `t`, den Laufweg und was
 * der Shader über die Linie wissen muss. Welcher Strang oder Faden sie ist, sagt erst die Instanz.
 */
/**
 * Die Enden gegenüber einem Knoten (WI-0205 K5, „Kraftlinienpunkt verschieben“): je Abschnitt, der an ihm endet, der andere Endpunkt
 * seiner gezeichneten Bahn, in Kartenkoordinaten. Die Vorschau beim Verschieben zieht von dort eine Strecke zum Punkt.
 */
export function gegenueberAmKnoten(netz: PowerlineNetwork, knoten: string): { x: number; y: number }[] {
    return netz.lines.flatMap((linie) => {
        const ende = linie.from.id === knoten ? linie.path.at(-1) : linie.to.id === knoten ? linie.path[0] : undefined;
        return ende === undefined ? [] : [{ x: ende[0], y: ende[1] }];
    });
}

export function buildArcGeometry(network: PowerlineNetwork, projection: RenderProjection): ArcGeometry {
    const nullpunkt = mercator(projection, { x: 0, y: 0 });
    const einsWeiter = mercator(projection, { x: 1, y: 0 });
    const unit = Math.hypot(einsWeiter[0] - nullpunkt[0], einsWeiter[1] - nullpunkt[1]);

    const lines: ArcLine[] = network.lines.map((entry) => {
        const points = entry.path.map(([x, y]) => mercator(projection, { x, y }));
        const run = [0];
        for (let j = 1; j < points.length; j += 1) {
            const p = points[j - 1] as [number, number];
            const q = points[j] as [number, number];
            run.push((run[j - 1] as number) + Math.hypot(q[0] - p[0], q[1] - p[1]));
        }
        const a = points[0] as [number, number];
        const b = points[points.length - 1] as [number, number];
        const sehne = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const length = run[run.length - 1] as number;
        const noise = length / unit / STRAENGE.bezugslaenge;
        return {
            id: entry.id,
            name: entry.name,
            labelVisible: entry.labelVisible,
            points,
            run,
            length,
            chord: [(b[0] - a[0]) / sehne, (b[1] - a[1]) / sehne],
            segments: powerlineCurveSteps(entry.curve ?? 0, STRAENGE.segmente),
            noise,
            probes: Math.max(PROBEN_MINDESTENS, Math.round(STRAENGE.proben * noise)),
            spread: STRAENGE.faecherbreite * Math.min(noise, 1),
            phase: folge(keim(`${entry.id}:buendel`))() * 2 * Math.PI,
        };
    });

    // Die Ecken in der feinsten Stufe: je Linie und Probe zwei, die Nachbarn eine feine Probe davor und danach (die Richtung
    // des Bandes stimmt so in jeder Stufe).
    const feinst = ARC_LEVELS[ARC_LEVELS.length - 1] as number;
    const fein = lines.map((line) => line.segments * line.probes * feinst);
    const vertices = new Float32Array(fein.reduce((summe, n) => summe + (n + 1) * 2 * FLOATS, 0));
    const anfaenge: number[] = [];
    let stelle = 0;
    for (const [nummer, line] of lines.entries()) {
        const proben = fein[nummer] as number;
        anfaenge.push(stelle / FLOATS);
        for (let k = 0; k <= proben; k += 1) {
            const t = k / proben;
            const tDavor = Math.max(0, k - 1) / proben;
            const tDanach = Math.min(proben, k + 1) / proben;
            const g = aufDerBahn(line, t);
            const gDavor = aufDerBahn(line, tDavor);
            const gDanach = aufDerBahn(line, tDanach);
            for (const seite of [-1, 1]) {
                vertices.set(
                    [
                        ...[g[0], g[1], gDavor[0], gDavor[1], gDanach[0], gDanach[1]],
                        ...[t, tDavor, tDanach, seite, line.chord[0], line.chord[1], line.segments],
                        ...[g[2], gDavor[2], gDanach[2], line.length, nummer],
                    ],
                    stelle,
                );
                stelle += FLOATS;
            }
        }
    }

    // Die Dreiecke je Stufe: Stufe f verbindet jede (feinst / f)-te Probe.
    const ranges: ArcGeometry["ranges"] = lines.map(() => []);
    const dreiecke = new Uint32Array(
        ARC_LEVELS.reduce(
            (summe, f) => summe + lines.reduce((s, line) => s + line.segments * line.probes * f * 6, 0),
            0,
        ),
    );
    let index = 0;
    for (const [stufe, f] of ARC_LEVELS.entries()) {
        const schritt = feinst / f;
        for (const [nummer, line] of lines.entries()) {
            const stuecke = line.segments * line.probes * f;
            const anfang = anfaenge[nummer] as number;
            (ranges[nummer] as { start: number; count: number }[])[stufe] = { start: index, count: stuecke * 6 };
            for (let j = 0; j < stuecke; j += 1) {
                const a = anfang + 2 * j * schritt;
                const b = a + 2 * schritt;
                dreiecke.set([a, a + 1, b, a + 1, b + 1, b], index);
                index += 6;
            }
        }
    }

    const threads = new Float32Array(lines.length * THREADS_PER_LINE * TEXEL_JE_FADEN * 4);
    for (const [nummer, line] of lines.entries()) {
        for (const [faden, f] of arcThreads(line.id).entries()) {
            const stelle = (nummer * THREADS_PER_LINE + faden) * TEXEL_JE_FADEN * 4;
            threads.set(
                [f.breite, f.licht, f.ausschlag, f.versatz, f.phase, line.noise, line.spread, line.phase],
                stelle,
            );
        }
    }
    return { lines, unit, vertices, indices: dreiecke, ranges, threads };
}

/** Ein Mercator-Punkt (0..1) als Länge und Breite. */
function lngLatOf(point: [number, number]): { lng: number; lat: number } {
    return {
        lng: point[0] * 360 - 180,
        lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * point[1]))) * 180) / Math.PI,
    };
}

/**
 * Die Bodenhöhe jeder Linie an Anfang und Ende, in Mercator-Einheiten wie die Bögen (WI-0049).
 *
 * `elevation` ist MapLibres `queryTerrainElevation`: Meter samt der Überhöhung, die gerade gilt, also
 * auch während die Gebirge beim Kippen wachsen. Ohne Gelände (`null`) steht alles auf 0.
 */
export function groundHeights(
    geometry: Pick<ArcGeometry, "lines">,
    elevation: (lngLat: { lng: number; lat: number }) => number | null,
): Float32Array<ArrayBuffer> {
    const boden = new Float32Array(geometry.lines.length * 2);
    for (const [nummer, line] of geometry.lines.entries()) {
        const enden = [line.points[0], line.points[line.points.length - 1]];
        for (const [seite, punkt] of enden.entries()) {
            if (!punkt) {
                continue;
            }
            const lngLat = lngLatOf(punkt);
            const meter = elevation(lngLat) ?? 0;
            boden[nummer * 2 + seite] = meter === 0 ? 0 : MercatorCoordinate.fromLngLat(lngLat, meter).z;
        }
    }
    return boden;
}

/** Wie hoch der Bogen über dem Punkt mit Laufweg `s` steht, in Mercator-Einheiten. */
export function arcHeightMercator(line: ArcLine, s: number, proPx: number, lift: number): number {
    const hoehePx = powerlineArcHeight(
        { share: BOEGEN.anteil, maxPx: BOEGEN.hoechstensPx },
        line.length / proPx,
        s / proPx,
    );
    return hoehePx * proPx * lift;
}

// ---------------------------------------------------------------------------------------------
// Das Bild, auf das sich Klick, Zeigen und Unterteilung beziehen

/**
 * Wie die Karte im letzten Bild stand: genau das, was die Bögen brauchen, um sich auf den Bildschirm zu legen. Die Matrix ist die
 * des Bildes, das der Mensch sieht (`render`); ein Bogen im Raum liegt nicht mehr auf der Bahn am Boden, also trifft ihn nur, wer
 * ihn dort sucht, wo er gezeichnet ist.
 */
export interface ArcFrame {
    /** Die Hauptmatrix des Bildes: Mercator-Einheiten in den Bildraum. */
    matrix: ArrayLike<number>;
    /** Die Größe der Karte in Bildpunkten (CSS-Pixel). */
    width: number;
    height: number;
    /** Mercator-Einheiten je Bildpunkt bei diesem Zoom. */
    proPx: number;
    /** Wie weit die Bögen aufgestiegen sind, 0 bis 1 (`powerlineArcLift`). */
    lift: number;
    /** Die Bodenhöhen je Linie, Anfang und Ende (`groundHeights`); ohne Angabe steht alles auf 0. */
    boden?: ArrayLike<number> | undefined;
    /** Die Zeit des Bildes in Sekunden, wie der Shader sie bekam (`u_time`): Danach stehen die Stränge. Ohne Angabe 0. */
    time?: number | undefined;
    /** Die Stufe der Unterteilung je Linie in diesem Bild (`arcLevels`); ohne Angabe die gröbste. */
    levels?: ArrayLike<number> | undefined;
}

/** Eine Linie unter dem Zeiger: ihr Segment (`id`), ihr Name und wie weit sie vom Zeiger entfernt ist (Bildpunkte). */
export interface ArcHit {
    id: string;
    name: string;
    distance: number;
}

/** Der Abstand des Punkts `p` von der Strecke `a`–`b`, in Bildpunkten. */
function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
    const dx = bx - ax;
    const dy = by - ay;
    const quadrat = dx * dx + dy * dy;
    const anteil = quadrat === 0 ? 0 : Math.min(Math.max(((px - ax) * dx + (py - ay) * dy) / quadrat, 0), 1);
    return Math.hypot(px - (ax + anteil * dx), py - (ay + anteil * dy));
}

/** Ein Punkt im Bildraum als Bildpunkt der Karte (CSS-Pixel), oder nichts, wenn er hinter der Kamera liegt. */
function aufDemBild(frame: ArcFrame, x: number, y: number, z: number): [number, number] | undefined {
    const p = projiziere(frame.matrix, x, y, z);
    return p[2] > 0 ? [((p[0] + 1) / 2) * frame.width, ((1 - p[1]) / 2) * frame.height] : undefined;
}

// ---------------------------------------------------------------------------------------------
// Wo die Stränge gerade stehen: der Zwilling des Shaders

/**
 * 🔴 ZWILLING von `welle` im Vertex-Shader (`STRANG_VS`), Zeile für Zeile: Legacys Strangformel je Stützpunkt, quer (x) und längs
 * (y) in Karteneinheiten. Klick und Zeigen rechnen damit, wo die Fäden gezeichnet sind (Betreiber 2026-10-11, zum Streifen, der
 * die Linie trifft: „ja den streifen kannst anpassen“). Wer eine der beiden Rechnungen ändert, ändert die andere mit.
 */
function welleTs(i: number, ph: number, v: number, a: number, n: number, zeit: number): [number, number] {
    const k = Math.min(Math.max(i, 0), n);
    const env = Math.sin((Math.PI * k) / n);
    const normalWave = Math.sin(k * 0.62 + ph) * env * 4.5;
    const tangentWave = Math.sin(k * 1.17 + ph) * env * 0.8;
    const tremorWave =
        Math.sin(
            zeit * STRAENGE.tremorNormalSpeed +
                k * STRAENGE.tremorNormalFrequency +
                ph * STRAENGE.tremorPhaseMultiplier,
        ) *
        env *
        STRAENGE.tremorNormalAmplitude;
    const tremorTangent =
        Math.sin(zeit * STRAENGE.tremorTangentSpeed + k * STRAENGE.tremorTangentFrequency + ph) *
        env *
        STRAENGE.tremorTangentAmplitude;
    const stoerung =
        (Math.sin(k * 2.6 + zeit * STRAENGE.interferenceSpeed + ph * 3.3) +
            0.6 * Math.sin(k * 4.1 - zeit * STRAENGE.interferenceSpeed * 1.7 + ph)) *
        env *
        STRAENGE.interferenceAmplitude;
    return [(normalWave + tremorWave + stoerung + v * env) * a, tangentWave + tremorTangent];
}

/** 🔴 ZWILLING von `kurve` im Vertex-Shader: Catmull-Rom durch vier Stützpunkte. */
function kurveTs(p0: [number, number], p1: [number, number], p2: [number, number], p3: [number, number], u: number) {
    const achse = (c: 0 | 1): number =>
        0.5 *
        (2 * p1[c] +
            (p2[c] - p0[c]) * u +
            (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * u * u +
            (3 * (p1[c] - p2[c]) + p3[c] - p0[c]) * u * u * u);
    return [achse(0), achse(1)] as [number, number];
}

/**
 * Die Bahn EINES Strangs oder Fadens: zu jedem Anteil `t` der Punkt, wie ihn der Shader zeichnet (Mercator, samt Höhe des Bogens
 * und Boden). Die Wellen an den Stützpunkten werden einmal gerechnet, dazwischen nur die Kurve.
 */
export function arcThreadPath(
    line: ArcLine,
    nummer: number,
    faden: ArcThread,
    frame: ArcFrame,
    unit: number,
): (t: number) => [number, number, number] {
    const n = line.segments;
    const zeit = frame.time ?? 0;
    const mitte = STRAENGE.normalScales[0] ?? 0;
    // Stützpunkte -1 bis n + 1: der Faden selbst (W, Z) und die Mitte seines Bündels (WM, ZM), wie im Shader.
    const stuetzen = (ph: number, v: number, a: number): [number, number][] =>
        Array.from({ length: n + 3 }, (_, j) => welleTs(j - 1, ph, v, a, n, zeit));
    const W = stuetzen(faden.phase, faden.versatz, faden.ausschlag);
    const Z = stuetzen(faden.phase + 0.9, 0, faden.ausschlag);
    const WM = stuetzen(line.phase, 0, mitte);
    const ZM = stuetzen(line.phase + 0.9, 0, mitte);
    const fussAnfang = frame.boden?.[nummer * 2] ?? 0;
    const fussEnde = frame.boden?.[nummer * 2 + 1] ?? 0;
    const quer: [number, number] = [line.chord[1], -line.chord[0]];
    return (t) => {
        const i0 = Math.min(Math.floor(t * n + 1e-4), n - 1);
        const u = t * n - i0;
        const vier = (werte: [number, number][]) =>
            kurveTs(werte[i0] ?? [0, 0], werte[i0 + 1] ?? [0, 0], werte[i0 + 2] ?? [0, 0], werte[i0 + 3] ?? [0, 0], u);
        const [wx, wy] = vier(W);
        const [mx, my] = vier(WM);
        const [zx] = vier(Z);
        const [zmx] = vier(ZM);
        const r = line.noise;
        const s = line.spread;
        const quer0 = wx * s + mx * (r - s);
        const laengs = wy * s + my * (r - s);
        const auf = zx * s + zmx * (r - s);
        const g = aufDerBahn(line, t);
        const unten = fussAnfang + (fussEnde - fussAnfang) * (line.length > 0 ? g[2] / line.length : 0);
        return [
            g[0] + (quer[0] * quer0 + line.chord[0] * laengs) * unit,
            g[1] + (quer[1] * quer0 + line.chord[1] * laengs) * unit,
            unten + arcHeightMercator(line, g[2], frame.proPx, frame.lift) + auf * unit * frame.lift,
        ];
    };
}

// ---------------------------------------------------------------------------------------------
// Grob: wo steht eine Linie auf dem Bildschirm, und wie weit reichen ihre Stränge?

/** Proben je Linie, an denen `arcLevels` und `arcHits` grob prüfen, wo sie auf dem Bildschirm steht. */
const SICHTPROBEN = 8;
/** So weit reicht das breiteste Band (der Schein der Auswahl) über die Mitte des Strangs hinaus, in Bildpunkten. */
const BANDRAND_PX = 16;

/**
 * Wie weit ein Strang höchstens neben der Bahn seiner Linie liegt, in Karteneinheiten: die Mitte des Bündels mal Rauschen, die
 * Fäden um sie herum mal Spreizung, alles aus Legacys Formel mit den größten Werten der Tafel, dazu ein Viertel für das
 * Überschwingen der Kurve.
 */
function ausschlagGrenze(line: ArcLine): number {
    const welle = 4.5 + STRAENGE.tremorNormalAmplitude + STRAENGE.interferenceAmplitude * 1.6;
    const mitte = (STRAENGE.normalScales[0] ?? 0) * welle;
    const versatz = Math.max(...STRAENGE.waveOffsets.map(Math.abs), ...FAEDEN.versatz.map(Math.abs));
    const faden = Math.max(...STRAENGE.normalScales, FAEDEN.ausschlag[1]) * (welle + versatz);
    const laengs = 0.8 + STRAENGE.tremorTangentAmplitude;
    return 1.25 * (line.noise * (mitte + laengs) + line.spread * (faden + mitte + laengs));
}

/** Eine grobe Probe der Bahn auf dem Bildschirm: wo sie steht und wie weit die Stränge dort höchstens danebenliegen (Bildpunkte). */
interface Sichtprobe {
    bild: [number, number];
    randPx: number;
}

/**
 * Die Linie an `SICHTPROBEN + 1` Stellen ihrer Bahn, dort, wo ihr Bogen steht, mit dem größten Ausschlag der Stränge
 * (`ausschlagGrenze`) als Rand in Bildpunkten. `undefined` für eine Probe, die (samt Rand) hinter der Kamera liegt.
 */
function sichtproben(line: ArcLine, nummer: number, frame: ArcFrame, unit: number): (Sichtprobe | undefined)[] {
    const fussAnfang = frame.boden?.[nummer * 2] ?? 0;
    const fussEnde = frame.boden?.[nummer * 2 + 1] ?? 0;
    const grenze = ausschlagGrenze(line) * unit;
    return Array.from({ length: SICHTPROBEN + 1 }, (_, k) => {
        const g = aufDerBahn(line, k / SICHTPROBEN);
        const z =
            fussAnfang +
            (fussEnde - fussAnfang) * (line.length > 0 ? g[2] / line.length : 0) +
            arcHeightMercator(line, g[2], frame.proPx, frame.lift);
        const bild = aufDemBild(frame, g[0], g[1], z);
        const daneben = [
            aufDemBild(frame, g[0] + grenze, g[1], z),
            aufDemBild(frame, g[0], g[1] + grenze, z),
            aufDemBild(frame, g[0], g[1], z + grenze),
        ];
        if (!bild || daneben.some((q) => !q)) {
            return undefined;
        }
        const randPx = Math.max(
            ...daneben.map((q) =>
                Math.hypot((q as [number, number])[0] - bild[0], (q as [number, number])[1] - bild[1]),
            ),
        );
        return { bild, randPx: randPx + BANDRAND_PX };
    });
}

/**
 * Was ein Bild über die Linien weiß, einmal gerechnet: die groben Proben (`sichtproben`) und, sobald ein Klick sie braucht, die Fäden
 * einer Linie im Bild. Zeigen und Klicken fragen viele Punkte im selben Bild ab (ein Browsertest tastet ein Raster mit Tausenden ab);
 * ohne den Merker legte jede Abfrage alle Linien neu auf den Bildschirm. Der Schlüssel ist die Matrix des Bildes: Jedes Bild bringt
 * eine neue mit, und gilt sie mit anderen Werten, wird neu gerechnet.
 */
interface BildMerker {
    frame: ArcFrame;
    geometry: Pick<ArcGeometry, "lines" | "unit">;
    grob: (Sichtprobe | undefined)[][];
    faeden: Map<number, FadenImBild[]>;
}

/** Ein Faden im Bild: seine Punkte (hinter der Kamera leer) und je `KISTE` Punkte das Rechteck, das sie umschließt. */
interface FadenImBild {
    punkte: ([number, number] | undefined)[];
    kisten: { von: number; bis: number; x0: number; y0: number; x1: number; y1: number }[];
}
/** So viele Punkte fasst eine Kiste: Der Klick misst nur in Kisten, die nah genug am Zeiger liegen. */
const KISTE = 16;
const bildMerker = new WeakMap<object, BildMerker>();

function merkerFuer(geometry: Pick<ArcGeometry, "lines" | "unit">, frame: ArcFrame): BildMerker {
    const schluessel = frame.matrix as object;
    const alt = bildMerker.get(schluessel);
    const gleich = (a: ArcFrame, b: ArcFrame): boolean =>
        a.width === b.width && a.height === b.height && a.proPx === b.proPx && a.lift === b.lift && a.boden === b.boden;
    if (
        alt &&
        alt.geometry.lines === geometry.lines &&
        alt.geometry.unit === geometry.unit &&
        gleich(alt.frame, frame)
    ) {
        // Die Fäden hängen dazu an Zeit und Stufen: wechseln die, gelten nur die groben Proben weiter.
        if (alt.frame.time !== frame.time || alt.frame.levels !== frame.levels) {
            alt.faeden = new Map();
            alt.frame = frame;
        }
        return alt;
    }
    const neu: BildMerker = {
        frame,
        geometry,
        grob: geometry.lines.map((line, nummer) => sichtproben(line, nummer, frame, geometry.unit)),
        faeden: new Map(),
    };
    bildMerker.set(schluessel, neu);
    return neu;
}

/** Die Fäden der Linie `nummer` im Bild, so dicht abgetastet, wie das Bild sie zeichnet, mit ihren Kisten. */
function faedenImBild(merker: BildMerker, nummer: number): FadenImBild[] {
    const vorhanden = merker.faeden.get(nummer);
    if (vorhanden) {
        return vorhanden;
    }
    const { frame, geometry } = merker;
    const line = geometry.lines[nummer] as ArcLine;
    const stufe = Math.max(0, frame.levels?.[nummer] ?? 0);
    const proben = Math.max(1, line.segments * line.probes * (ARC_LEVELS[stufe] ?? 1));
    const faeden = arcThreads(line.id).map((faden) => {
        const bahn = arcThreadPath(line, nummer, faden, frame, geometry.unit);
        const punkte = Array.from({ length: proben + 1 }, (_, k) => aufDemBild(frame, ...bahn(k / proben)));
        const kisten: FadenImBild["kisten"] = [];
        // Eine Kiste überlappt die nächste um einen Punkt, damit keine Strecke zwischen zwei Kisten fehlt.
        for (let von = 0; von < punkte.length - 1; von += KISTE) {
            const bis = Math.min(von + KISTE, punkte.length - 1);
            const drin = punkte.slice(von, bis + 1).filter((p): p is [number, number] => p !== undefined);
            if (drin.length > 0) {
                kisten.push({
                    von,
                    bis,
                    x0: Math.min(...drin.map((p) => p[0])),
                    y0: Math.min(...drin.map((p) => p[1])),
                    x1: Math.max(...drin.map((p) => p[0])),
                    y1: Math.max(...drin.map((p) => p[1])),
                });
            }
        }
        return { punkte, kisten };
    });
    merker.faeden.set(nummer, faeden);
    return faeden;
}

// ---------------------------------------------------------------------------------------------
// Treffer: welche Linie liegt unter dem Zeiger?

/**
 * Alle Linien, die der Zeiger auf höchstens `reach` Bildpunkte trifft, die nächste zuerst (dann nach Name und Kennung).
 *
 * 🔴 Gerechnet wird, wo die Stränge GEZEICHNET sind: jeder Strang und Faden mit seiner Welle zur Zeit des letzten Bildes
 * (`arcThreadPath`), auf dem Boden plus der Höhe des Bogens, durch dieselbe Matrix wie im Shader, so dicht abgetastet wie gezeichnet.
 * Getroffen ist eine Linie, wenn der Zeiger nah genug an einem ihrer Fäden liegt. Seit die Bündel langer Linien weit schwingen
 * (Rauschen nach Länge), lägen sie sonst oft neben dem Streifen um die Bahn, und Legacys unsichtbare Trefferlinie träfe ins Leere.
 * Grob vorab (`sichtproben`): Liegt der Zeiger samt dem größten Ausschlag weiter weg als `reach`, wird die Linie nicht abgetastet.
 */
export function arcHits(
    geometry: Pick<ArcGeometry, "lines" | "unit">,
    frame: ArcFrame,
    point: { x: number; y: number },
    reach: number,
): ArcHit[] {
    const hits: ArcHit[] = [];
    const merker = merkerFuer(geometry, frame);
    for (const [nummer, line] of geometry.lines.entries()) {
        const grob = merker.grob[nummer] as (Sichtprobe | undefined)[];
        let moeglich = grob.some((probe) => !probe);
        for (let k = 1; k < grob.length && !moeglich; k += 1) {
            const a = grob[k - 1] as Sichtprobe;
            const b = grob[k] as Sichtprobe;
            const abstand = segmentDistance(point.x, point.y, a.bild[0], a.bild[1], b.bild[0], b.bild[1]);
            moeglich = abstand - Math.max(a.randPx, b.randPx) <= reach;
        }
        if (!moeglich) {
            continue;
        }
        let nah = Number.POSITIVE_INFINITY;
        for (const { punkte, kisten } of faedenImBild(merker, nummer)) {
            for (const kiste of kisten) {
                // Liegt die Kiste weiter weg als `reach` (oder als der schon gefundene Faden), kann keiner ihrer Punkte näher sein.
                const dx = Math.max(kiste.x0 - point.x, 0, point.x - kiste.x1);
                const dy = Math.max(kiste.y0 - point.y, 0, point.y - kiste.y1);
                if (Math.hypot(dx, dy) > Math.min(reach, nah)) {
                    continue;
                }
                let vorher: [number, number] | undefined;
                for (let k = kiste.von; k <= kiste.bis; k += 1) {
                    const bild = punkte[k];
                    if (!bild) {
                        // Hinter der Kamera: dieses Stück der Linie ist nicht zu sehen.
                        vorher = undefined;
                        continue;
                    }
                    const abstand = vorher
                        ? segmentDistance(point.x, point.y, vorher[0], vorher[1], bild[0], bild[1])
                        : Math.hypot(point.x - bild[0], point.y - bild[1]);
                    nah = Math.min(nah, abstand);
                    vorher = bild;
                }
            }
        }
        if (nah <= reach) {
            hits.push({ id: line.id, name: line.name, distance: nah });
        }
    }
    return hits.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------------------------------------
// Unterteilung je Bild: feiner, wo es nah ist; gar nicht, wo nichts zu sehen ist

/**
 * Je Linie die Stufe der Unterteilung für dieses Bild (Index in `ARC_LEVELS`), `-1` für eine Linie, von der nichts zu sehen ist.
 *
 * Betreiber 2026-10-11: „mehr unterteilungen wären doch nett beim näheren hinzoomen“, „mehr glättung mein ich“. Jede Linie wird an
 * `SICHTPROBEN` Stellen dort projiziert, wo ihr Bogen gezeichnet ist (`sichtproben`); das längste Stück auf dem Bildschirm sagt, wie
 * lang ihre geraden Stücke in der gröbsten Stufe sind, und die Stufe wird so fein, dass keines länger als `straenge.kantePx` ist.
 * Liegen alle Proben samt dem größten Ausschlag der Stränge jenseits desselben Bildrands, wird die Linie nicht gezeichnet. Steht
 * eine Probe hinter der Kamera, wird nichts weggelassen.
 */
export function arcLevels(geometry: Pick<ArcGeometry, "lines" | "unit">, frame: ArcFrame): Int8Array<ArrayBuffer> {
    const stufen = new Int8Array(geometry.lines.length);
    const merker = merkerFuer(geometry, frame);
    for (const [nummer, line] of geometry.lines.entries()) {
        const proben = merker.grob[nummer] as (Sichtprobe | undefined)[];
        const sicher = proben.every((probe) => probe !== undefined);
        const jenseits = (seite: (probe: Sichtprobe) => boolean): boolean =>
            sicher && proben.every((probe) => seite(probe as Sichtprobe));
        if (
            jenseits((p) => p.bild[0] + p.randPx < 0) ||
            jenseits((p) => p.bild[0] - p.randPx > frame.width) ||
            jenseits((p) => p.bild[1] + p.randPx < 0) ||
            jenseits((p) => p.bild[1] - p.randPx > frame.height)
        ) {
            stufen[nummer] = -1;
            continue;
        }
        let laengstes = 0;
        for (let k = 1; k < proben.length; k += 1) {
            const a = proben[k - 1];
            const b = proben[k];
            if (a && b) {
                laengstes = Math.max(laengstes, Math.hypot(b.bild[0] - a.bild[0], b.bild[1] - a.bild[1]));
            }
        }
        // Ein Stück zwischen zwei Sichtproben enthält so viele gerade Stücke der gröbsten Stufe.
        const grob = (laengstes * SICHTPROBEN) / (line.segments * line.probes);
        let stufe = 0;
        while (stufe < ARC_LEVELS.length - 1 && grob / (ARC_LEVELS[stufe] as number) > STRAENGE.kantePx) {
            stufe += 1;
        }
        stufen[nummer] = stufe;
    }
    return stufen;
}

/**
 * Die Züge für ein Bild: je Stufe die Dreiecke der Linien, die sie bekommen; Nachbarn derselben Stufe liegen im Indexpuffer
 * hintereinander und werden ein Zug. `nur` beschränkt auf diese Linien (die gewählte), `ohne` lässt sie aus.
 */
export function arcDraws(
    geometry: Pick<ArcGeometry, "ranges">,
    stufen: ArrayLike<number>,
    { nur, ohne }: { nur?: ReadonlySet<number>; ohne?: ReadonlySet<number> } = {},
): { start: number; count: number }[] {
    const zuege: { start: number; count: number }[] = [];
    for (const [stufe] of ARC_LEVELS.entries()) {
        let zug: { start: number; count: number } | undefined;
        for (const [nummer, bereiche] of geometry.ranges.entries()) {
            const bereich = bereiche[stufe];
            if (stufen[nummer] !== stufe || !bereich || (nur && !nur.has(nummer)) || ohne?.has(nummer)) {
                continue;
            }
            if (zug && zug.start + zug.count === bereich.start) {
                zug.count += bereich.count;
            } else {
                zug = { start: bereich.start, count: bereich.count };
                zuege.push(zug);
            }
        }
    }
    return zuege;
}

// ---------------------------------------------------------------------------------------------
// Hervorhebung der gewählten Linie

/**
 * Die gewählte Linie glüht gelb-orange und hell (Betreiber 2026-10-11: „viel geiler wär, wenn die streifen bei einem klick
 * gelb-orange und hell glühen würden“). Legacy hebt nur heller hervor, ohne Farbwechsel (`.powerline--kurve-aktiv`); das galt hier
 * bis dahin auch. Ihre Stränge und Fäden zeichnet sie in den Lagen `auswahl` der Tafel statt in `glow`, nicht zusätzlich: Sonst
 * schiene das Rosa durch die Glut.
 */
interface Leuchtlage {
    breite: number;
    rgb: [number, number, number];
    alpha: number;
}

function leuchtlagen(lagen: readonly PowerlineGlow[]): Leuchtlage[] {
    return lagen.map((lage) => ({ breite: lage.widthPx, rgb: anteile(lage.color), alpha: lage.alpha * lage.opacity }));
}

/** Die Leuchtlagen der Tafel, von unten nach oben: Aura, Mitte, Kern. */
const LEUCHTLAGEN = leuchtlagen(TAFEL.glow);
/** Die Glut der gewählten Linie, von unten nach oben: Schein, Aura, Mitte, Kern. */
const HERVORHEBUNG = leuchtlagen(TAFEL.auswahl);

/** Lagen als Uniforms des Fragment-Shaders: Farben vormultipliziert, Breiten in px, dazu die breiteste für das Band. */
function lagenUniforms(lagen: readonly Leuchtlage[]): {
    farben: Float32Array;
    breiten: Float32Array;
    breiteste: number;
} {
    return {
        farben: Float32Array.from(lagen.flatMap(({ rgb: [r, g, b], alpha: a }) => [r * a, g * a, b * a, a])),
        breiten: Float32Array.from(lagen.map((lage) => lage.breite)),
        breiteste: Math.max(0, ...lagen.map((lage) => lage.breite)),
    };
}

// ---------------------------------------------------------------------------------------------
// Shader

/** So viele Leuchtlagen mischt der Fragment-Shader höchstens: die Tafel oder die Hervorhebung, je nachdem, wer mehr hat. */
const LAGEN_HOECHSTENS = Math.max(TAFEL.glow.length, HERVORHEBUNG.length);

const STRANG_VS = `#version 300 es
precision highp float;
precision highp int;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_time;
uniform float u_lift;
uniform float u_unit;
uniform float u_width;      // die breiteste Lage, in px: so breit wird das Band
uniform float u_ratio;
uniform float u_proPx;
uniform float u_share;
uniform float u_cap;
uniform vec4 u_tremor;      // Normal-, Tangentamplitude, Normal-, Tangenttempo
uniform vec3 u_tremorFreq;  // Normal-, Tangentfrequenz, Phasenfaktor
uniform vec2 u_interference; // Amplitude, Tempo
uniform float u_mitteAusschlag; // der Ausschlag der Mitte eines Bündels: Legacys erster Strang
uniform sampler2D u_boden;   // je Linie Bodenhöhe an Anfang und Ende (WI-0049)
uniform sampler2D u_faeden;  // je Linie und Faden: Breite, Leuchtkraft, Ausschlag, Versatz | Phase (arcThreads)
const int BODEN_BREITE = ${String(BODEN_BREITE)};
const int FAEDEN_JE_LINIE = ${String(THREADS_PER_LINE)};
const int TEXEL_JE_FADEN = ${String(TEXEL_JE_FADEN)};
in vec2 a_g; in vec2 a_gp; in vec2 a_gn;
in vec3 a_t;
in float a_side;
in vec2 a_chord;
in float a_segments;
in vec3 a_s;
in float a_length;
in float a_line;
out float v_across;
out float v_faktor;
out float v_licht;
const float PI = 3.14159265;

// Was der Faden dieser Instanz gezogen hat.
float phase;
float ausschlag;
float versatz;
// Die Linie: wie stark sie rauscht (ArcLine.noise), wie weit ihre Fäden auseinanderlaufen (ArcLine.spread)
// und die Phase der Mitte ihres Bündels (ArcLine.phase).
float rauschen;
float spreizung;
float buendelPhase;
// Die vier Stützpunkte um die Ecke, quer und längs (W) und aufwärts (Z), ab Stützpunkt I0 - 1: der Faden selbst
// und die Mitte des Bündels (WM, ZM), die für alle Fäden der Linie dieselbe ist.
vec2 W[4];
vec2 Z[4];
vec2 WM[4];
vec2 ZM[4];
float I0;

// Legacys createPowerlineStrandLatLngs (avesmaps@770c80e), je Stützpunkt i: Versatz quer (x) und längs (y)
// in Karteneinheiten. Die Zahlen OHNE Namen stehen in Legacy im Code, die übrigen in der Tafel. Vor dem Anfang
// und hinter dem Ende gilt der Endpunkt: Dort ist die Hüllkurve 0, der Strang landet im Knoten.
vec2 welle(float i, float ph, float v, float a) {
    float k = clamp(i, 0.0, a_segments);
    float env = sin(PI * k / a_segments);
    float normalWave = sin(k * 0.62 + ph) * env * 4.5;
    float tangentWave = sin(k * 1.17 + ph) * env * 0.8;
    float tremorWave = sin(u_time * u_tremor.z + k * u_tremorFreq.x + ph * u_tremorFreq.z) * env * u_tremor.x;
    float tremorTangent = sin(u_time * u_tremor.w + k * u_tremorFreq.y + ph) * env * u_tremor.y;
    float stoerung = (sin(k * 2.6 + u_time * u_interference.y + ph * 3.3)
        + 0.6 * sin(k * 4.1 - u_time * u_interference.y * 1.7 + ph)) * env * u_interference.x;
    return vec2((normalWave + tremorWave + stoerung + v * env) * a, tangentWave + tremorTangent);
}

// Die Kurve durch die Stützpunkte (Catmull-Rom): geht genau durch Legacys Punkte, aber rund statt geknickt.
vec2 kurve(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float u) {
    return 0.5 * (2.0 * p1 + (p2 - p0) * u + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * u * u
        + (3.0 * (p1 - p2) + p3 - p0) * u * u * u);
}

// Dieselbe Rechnung wie powerlineArcHeight in @avesmaps3d/shared, in Mercator-Einheiten.
float hoehe(float s) {
    float lang = max(a_length, 1e-12);
    float anteil = clamp(s / lang, 0.0, 1.0);
    float roh = u_share * (lang / u_proPx) * sin(PI * anteil);
    return u_cap * tanh(roh / u_cap) * u_proPx;
}

// Der Boden unter dem Punkt mit Laufweg s: zwischen den Höhen der beiden Füße gemischt.
float boden(float s) {
    int i = int(a_line + 0.5) * 2;
    float anfang = texelFetch(u_boden, ivec2(i % BODEN_BREITE, i / BODEN_BREITE), 0).r;
    float ende = texelFetch(u_boden, ivec2((i + 1) % BODEN_BREITE, (i + 1) / BODEN_BREITE), 0).r;
    return mix(anfang, ende, clamp(s / max(a_length, 1e-12), 0.0, 1.0));
}

vec4 faden(int texel) {
    int i = (int(a_line + 0.5) * FAEDEN_JE_LINIE + gl_InstanceID) * TEXEL_JE_FADEN + texel;
    return texelFetch(u_faeden, ivec2(i % BODEN_BREITE, i / BODEN_BREITE), 0);
}

// Der Punkt des Strangs beim Anteil t. Die Nachbarn der Ecke rechnen mit denselben vier Stützpunkten
// (eine Probe über das Segment hinaus ist die Kurve noch glatt): Sie geben nur die Richtung des Bandes.
// Die Mitte des Bündels schwingt mit der Länge der Linie (rauschen): Jede Linie rauscht im selben Verhältnis.
// Um sie herum laufen die Fäden so weit auseinander wie bei der Bezugslinie (spreizung), gleich breit für jede
// Linie ab der Bezugslänge: rauschen * Mitte + spreizung * (Faden - Mitte).
vec3 strang(vec2 g, float t, float s) {
    float u = t * a_segments - I0;
    vec2 w = kurve(W[0], W[1], W[2], W[3], u) * spreizung + kurve(WM[0], WM[1], WM[2], WM[3], u) * (rauschen - spreizung);
    // Aufwärts wabern die Stränge mit derselben Formel, um eine Phase versetzt: das gibt es erst im Bogen.
    vec2 wz = kurve(Z[0], Z[1], Z[2], Z[3], u) * spreizung + kurve(ZM[0], ZM[1], ZM[2], ZM[3], u) * (rauschen - spreizung);
    vec2 quer = vec2(a_chord.y, -a_chord.x);
    vec2 xy = g + (quer * w.x + a_chord * w.y) * u_unit;
    float z = boden(s) + (hoehe(s) + wz.x * u_unit) * u_lift;
    return vec3(xy, z);
}

void main() {
    vec4 f = faden(0);
    if (f.x <= 0.0 || f.y <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    ausschlag = f.z;
    versatz = f.w;
    vec4 f1 = faden(1);
    phase = f1.x;
    rauschen = f1.y;
    spreizung = f1.z;
    buendelPhase = f1.w;
    // Das Segment der Ecke; die letzte Ecke gehört an das Ende des letzten Segments.
    I0 = min(floor(a_t.x * a_segments + 1e-4), a_segments - 1.0);
    for (int k = 0; k < 4; k += 1) {
        float i = I0 - 1.0 + float(k);
        W[k] = welle(i, phase, versatz, ausschlag);
        Z[k] = welle(i, phase + 0.9, 0.0, ausschlag);
        WM[k] = welle(i, buendelPhase, 0.0, u_mitteAusschlag);
        ZM[k] = welle(i, buendelPhase + 0.9, 0.0, u_mitteAusschlag);
    }
    vec4 c = u_matrix * vec4(strang(a_g, a_t.x, a_s.x), 1.0);
    vec4 cDavor = u_matrix * vec4(strang(a_gp, a_t.y, a_s.y), 1.0);
    vec4 cDanach = u_matrix * vec4(strang(a_gn, a_t.z, a_s.z), 1.0);
    if (c.w <= 0.0 || cDavor.w <= 0.0 || cDanach.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec2 halb = u_viewport * 0.5;
    vec2 richtung = cDanach.xy / cDanach.w * halb - cDavor.xy / cDavor.w * halb;
    richtung = length(richtung) < 1e-6 ? vec2(1.0, 0.0) : normalize(richtung);
    vec2 normale = vec2(-richtung.y, richtung.x);
    float breite = u_width * 0.5 * u_ratio * f.x + 0.75;
    c.xy += normale * a_side * breite / halb * c.w;
    v_across = a_side * breite;
    v_faktor = u_ratio * f.x;
    v_licht = f.y;
    gl_Position = c;
}`;

/**
 * Alle Leuchtlagen in einem Zug: von unten nach oben übereinander gemischt, wie es drei Züge mit
 * vormultipliziertem Alpha täten. Jede Lage deckt ihre eigene Breite, mal der Stärke des Fadens.
 */
const STRANG_FS = `#version 300 es
precision highp float;
precision highp int;
uniform int u_lagen;
uniform vec4 u_farben[${String(LAGEN_HOECHSTENS)}];    // vormultipliziert
uniform float u_breiten[${String(LAGEN_HOECHSTENS)}];  // in px
in float v_across;
in float v_faktor;
in float v_licht;
out vec4 farbe;
void main() {
    float abstand = abs(v_across);
    vec4 summe = vec4(0.0);
    for (int k = 0; k < ${String(LAGEN_HOECHSTENS)}; k += 1) {
        if (k >= u_lagen) {
            break;
        }
        float halb = u_breiten[k] * 0.5 * v_faktor + 0.75;
        vec4 lage = u_farben[k] * (clamp(halb - abstand, 0.0, 1.0) * v_licht);
        summe = lage + summe * (1.0 - lage.a);
    }
    farbe = summe;
}`;

const NAME_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
in vec3 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
    v_uv = a_uv;
    gl_Position = u_matrix * vec4(a_pos, 1.0);
}`;

const NAME_FS = `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
uniform float u_alpha;
in vec2 v_uv;
out vec4 farbe;
void main() {
    farbe = texture(u_atlas, v_uv) * u_alpha;
}`;

function programm(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
    const shader = (typ: number, quelle: string): WebGLShader => {
        const s = gl.createShader(typ);
        if (!s) {
            throw new Error("Kraftlinienbögen: kein Shader");
        }
        gl.shaderSource(s, quelle);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(`Kraftlinienbögen: Shader - ${gl.getShaderInfoLog(s) ?? "unbekannt"}`);
        }
        return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`Kraftlinienbögen: Programm - ${gl.getProgramInfoLog(p) ?? "unbekannt"}`);
    }
    return p;
}

/** Hexfarbe in drei Anteile 0..1. */
function anteile(hex: string): [number, number, number] {
    const kanal = (start: number): number => Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return [kanal(1), kanal(3), kanal(5)];
}

/** Ein Punkt mit der Hauptmatrix in den Bildraum: x, y in -1..1, dazu w (hinter der Kamera ≤ 0). */
function projiziere(m: ArrayLike<number>, x: number, y: number, z: number): [number, number, number] {
    const w = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0);
    return [
        ((m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0)) / w,
        ((m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0)) / w,
        w,
    ];
}

// ---------------------------------------------------------------------------------------------
// Die aufrechten Namen

/** Jeder Name einmal im Atlas, Regale untereinander; doppelt so groß gemalt wie gezeigt. */
interface Atlas {
    canvas: HTMLCanvasElement;
    plaetze: Map<string, { x: number; y: number; w: number; h: number }>;
}

const ATLAS_MASSSTAB = 2;
const ATLAS_BREITE = 2048;

function baueAtlas(namen: string[]): Atlas {
    const canvas = globalThis.document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
        throw new Error("Kraftlinienbögen: kein 2D-Kontext für die Namen");
    }
    const px = BOEGEN.namePx * ATLAS_MASSSTAB;
    const schrift = `${String(px)}px ${DESIGN_CANON.typography.fontFamily}`;
    const zeile = Math.ceil(px * 1.45);
    const rand = Math.ceil(px * 0.2);
    ctx.font = schrift;
    const plaetze = new Map<string, { x: number; y: number; w: number; h: number }>();
    let x = 0;
    let y = 0;
    for (const name of namen) {
        const w = Math.ceil(ctx.measureText(name).width) + 2 * rand;
        if (x + w > ATLAS_BREITE) {
            x = 0;
            y += zeile;
        }
        plaetze.set(name, { x, y, w, h: zeile });
        x += w;
    }
    canvas.width = ATLAS_BREITE;
    canvas.height = Math.max(64, y + zeile);
    // Nach dem Setzen der Größe ist der Kontext zurückgesetzt.
    ctx.font = schrift;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const label = TAFEL.label;
    for (const [name, platz] of plaetze) {
        ctx.strokeStyle = rgbaColour(label.haloColor, label.haloAlpha);
        ctx.lineWidth = px * (label.haloWidthRatio + label.haloBlurRatio) * 2;
        ctx.strokeText(name, platz.x + rand, platz.y + zeile / 2);
        ctx.fillStyle = rgbaColour(label.color, label.alpha);
        ctx.fillText(name, platz.x + rand, platz.y + zeile / 2);
    }
    return { canvas, plaetze };
}

/**
 * Die Bänder der aufrechten Namen: je Name ein Streifen entlang des Bogens, aufrecht, in Leserichtung.
 * Er steht in der Mitte des Stücks und wiederholt sich alle `nameWiederholungPx`, wie die flachen.
 */
export function uprightNameStrips(
    geometry: ArcGeometry,
    atlas: { width: number; height: number; plaetze: Atlas["plaetze"] },
    matrix: ArrayLike<number>,
    proPx: number,
    lift: number,
    boden?: Float32Array,
): { vertices: Float32Array; count: number } {
    const aus: number[] = [];
    let anzahl = 0;
    const PROBEN = 64;
    const SCHNITTE = 32;
    for (const [nummer, line] of geometry.lines.entries()) {
        const platz = line.labelVisible ? atlas.plaetze.get(line.name) : undefined;
        const fussAnfang = boden?.[nummer * 2] ?? 0;
        const fussEnde = boden?.[nummer * 2 + 1] ?? 0;
        if (!platz) {
            continue;
        }
        const bogen: [number, number, number][] = [];
        const lauf: number[] = [0];
        for (let k = 0; k <= PROBEN; k += 1) {
            const g = aufDerBahn(line, k / PROBEN);
            // Wie im Shader nach dem Laufweg gemischt, damit Name und Strang übereinander liegen.
            const unten = fussAnfang + (fussEnde - fussAnfang) * (line.length > 0 ? g[2] / line.length : 0);
            const p: [number, number, number] = [g[0], g[1], unten + arcHeightMercator(line, g[2], proPx, lift)];
            const vorher = bogen[k - 1];
            if (vorher) {
                lauf.push((lauf[k - 1] as number) + Math.hypot(p[0] - vorher[0], p[1] - vorher[1], p[2] - vorher[2]));
            }
            bogen.push(p);
        }
        const laenge = lauf[PROBEN] as number;
        const breite = (platz.w / ATLAS_MASSSTAB) * proPx;
        if (breite > laenge * 0.9) {
            continue;
        }
        const an = (s: number): { p: [number, number, number]; t: [number, number, number] } => {
            let k = 1;
            while (k < PROBEN && (lauf[k] as number) < s) {
                k += 1;
            }
            const a = bogen[k - 1] as [number, number, number];
            const b = bogen[k] as [number, number, number];
            const la = lauf[k - 1] as number;
            const lb = lauf[k] as number;
            const f = lb > la ? (s - la) / (lb - la) : 0;
            const d: [number, number, number] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            const dl = Math.hypot(d[0], d[1], d[2]) || 1;
            return {
                p: [a[0] + d[0] * f, a[1] + d[1] * f, a[2] + d[2] * f],
                t: [d[0] / dl, d[1] / dl, d[2] / dl],
            };
        };
        // Die Mitte des Stücks, dann in beide Richtungen im Abstand der Wiederholung, solange es passt.
        const abstand = BOEGEN.nameWiederholungPx * proPx;
        const mitten: number[] = [laenge / 2];
        for (let s = laenge / 2 + abstand; s + breite / 2 < laenge * 0.95; s += abstand) {
            mitten.push(s, laenge - s);
        }
        for (const mitte of mitten) {
            const links = projiziere(matrix, ...an(mitte - breite / 4).p);
            const rechts = projiziere(matrix, ...an(mitte + breite / 4).p);
            if (links[2] <= 0 || rechts[2] <= 0 || Math.abs(links[0]) > 1.3 || Math.abs(links[1]) > 1.3) {
                continue;
            }
            // Leserichtung: von links nach rechts auf dem Bildschirm, sonst stünde der Name kopf.
            const richtung = rechts[0] >= links[0] ? 1 : -1;
            const unten = BOEGEN.nameAbstandPx * proPx;
            const oben = (BOEGEN.nameAbstandPx + platz.h / ATLAS_MASSSTAB) * proPx;
            let vorher: number[][] | undefined;
            for (let j = 0; j <= SCHNITTE; j += 1) {
                const anteil = j / SCHNITTE;
                const { p, t } = an(mitte + richtung * (anteil - 0.5) * breite);
                const lauf3: [number, number, number] = [t[0] * richtung, t[1] * richtung, t[2] * richtung];
                // Aufrecht: die Senkrechte, ohne den Anteil in Laufrichtung.
                const hoch = lauf3[2];
                let o: [number, number, number] = [-hoch * lauf3[0], -hoch * lauf3[1], 1 - hoch * lauf3[2]];
                const ol = Math.hypot(o[0], o[1], o[2]) || 1;
                o = [o[0] / ol, o[1] / ol, o[2] / ol];
                const u = (platz.x + anteil * platz.w) / atlas.width;
                const unterKante = [
                    p[0] + o[0] * unten,
                    p[1] + o[1] * unten,
                    p[2] + o[2] * unten,
                    u,
                    (platz.y + platz.h) / atlas.height,
                ];
                const oberKante = [
                    p[0] + o[0] * oben,
                    p[1] + o[1] * oben,
                    p[2] + o[2] * oben,
                    u,
                    platz.y / atlas.height,
                ];
                if (vorher) {
                    const [vu, vo] = vorher as [number[], number[]];
                    aus.push(...vu, ...vo, ...unterKante, ...vo, ...oberKante, ...unterKante);
                }
                vorher = [unterKante, oberKante];
            }
            anzahl += 1;
        }
    }
    return { vertices: new Float32Array(aus), count: anzahl };
}

// ---------------------------------------------------------------------------------------------
// Die Knoten als glühende Punkte

/**
 * Die Knoten der Kraftlinien-Ansicht als glühende, wabernde Punkte (Betreiber 2026-10-11: „die nodices sind diese hellroten
 * scheiben. kannst du daraus auch - wie die kraftlinien - glühende punkte machen (vielleicht "waber" der glow?)“): je Knoten ein
 * Quadrat, das sich zum Bildschirm dreht; der Fragment-Shader malt Kern, Mitte und Schein in den Farben der Leuchtlagen (`glow`),
 * einen gewählten in denen der Auswahl (`auswahl`). Der Schein wabert rund um den Knoten (`leyKnoten.wabern`), der ganze Knoten
 * schwillt an und ab (`leyKnoten.puls`), jeder in seiner Phase. Die Größe ist die der Knotenebenen (`leyKnotenRadiusBei`).
 */
export const POWERLINE_NODES_LAYER_ID = "nodix-gluehen";

const LEY = TAFEL.leyKnoten;
/** Die Klassen, deren Knotenradius der Shader je Bild bekommt; ihr Index steht an jedem Knoten. */
const KNOTEN_KLASSEN: readonly string[] = Object.keys(AVENTURIA_ZOOM_BANDS.marker);
/** Floats je Knoten im Instanzpuffer: Lage (3), Klasse, Phase, gewählt. */
const KNOTEN_FLOATS = 6;

/** Ein Knoten der Kraftlinien-Ansicht: ein Nodix-Ort, ein Nodix-Label oder ein Kraftlinienpunkt (`ley_node_render`). */
export interface ArcNode {
    id: string;
    /** `place`, `label` oder `nodix` (Kraftlinienpunkt). */
    kind: string;
    /** Index in `KNOTEN_KLASSEN`: seine Größe. */
    klasse: number;
    /** Lage in Mercator (0..1). */
    x: number;
    y: number;
    lng: number;
    lat: number;
    /** Seine Phase des Waberns, aus der Kennung: auf jedem Rechner und nach jedem Laden dieselbe. */
    phase: number;
}

/**
 * Die Knoten aus den Kacheln der Knotenquelle, je Kennung einmal (eine Kachelgrenze oder zwei Zoomstufen liefern denselben Knoten
 * mehrfach). Unbekannte Klassen bekommen die kleinste Größe.
 */
export function arcNodes(
    features: readonly { properties: Record<string, unknown>; geometry: { type: string; coordinates?: unknown } }[],
): ArcNode[] {
    const knoten = new Map<string, ArcNode>();
    const klein = Math.max(0, KNOTEN_KLASSEN.indexOf("dorf"));
    for (const feature of features) {
        const id = String(feature.properties["public_id"] ?? "");
        const koordinaten = feature.geometry.coordinates;
        if (!id || knoten.has(id) || feature.geometry.type !== "Point" || !Array.isArray(koordinaten)) {
            continue;
        }
        const [lng, lat] = koordinaten as [number, number];
        const m = MercatorCoordinate.fromLngLat({ lng, lat });
        const klasse = KNOTEN_KLASSEN.indexOf(String(feature.properties["subtype"] ?? ""));
        knoten.set(id, {
            id,
            kind: String(feature.properties["node_kind"] ?? "place"),
            klasse: klasse < 0 ? klein : klasse,
            x: m.x,
            y: m.y,
            lng,
            lat,
            phase: folge(keim(`${id}:knoten`))() * 2 * Math.PI,
        });
    }
    return [...knoten.values()];
}

const KNOTEN_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_radien[${String(Math.max(1, KNOTEN_KLASSEN.length))}];
uniform float u_schein;   // die Weite des Scheins in px, ohne Wabern
uniform float u_rand;     // so viel weiter darf er wabern und schwellen
in vec2 a_ecke;
in vec3 a_lage;
in float a_klasse;
in float a_phase;
in float a_gewaehlt;
out vec2 v_px;
out float v_r;
out float v_phase;
out float v_gewaehlt;
void main() {
    float r = u_radien[int(a_klasse + 0.5)] * u_ratio;
    float aussen = (r + u_schein * u_ratio) * u_rand;
    vec4 c = u_matrix * vec4(a_lage, 1.0);
    if (c.w <= 0.0 || r <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    c.xy += a_ecke * aussen / (u_viewport * 0.5) * c.w;
    gl_Position = c;
    v_px = a_ecke * aussen;
    v_r = r;
    v_phase = a_phase;
    v_gewaehlt = a_gewaehlt;
}`;

const KNOTEN_FS = `#version 300 es
precision highp float;
uniform float u_time;
uniform float u_ratio;
uniform float u_schein;
uniform float u_deckkraft;
uniform float u_wabern;
uniform float u_puls;
uniform vec3 u_farben[3];   // Schein, Mitte, Kern
uniform vec3 u_glut[3];     // dasselbe, gewählt
in vec2 v_px;
in float v_r;
in float v_phase;
in float v_gewaehlt;
out vec4 farbe;
void main() {
    float d = length(v_px);
    float winkel = atan(v_px.y, v_px.x);
    // Der Schein wabert rund um den Knoten, drei Wellen in verschiedener Richtung und eigener Phase.
    float welle = 0.5 * sin(3.0 * winkel + u_time * 1.3 + v_phase)
        + 0.3 * sin(5.0 * winkel - u_time * 2.1 + 2.3 * v_phase)
        + 0.2 * sin(2.0 * winkel + u_time * 0.7 - v_phase);
    float puls = 1.0 + u_puls * sin(u_time * 1.7 + 1.9 * v_phase);
    float schein = u_schein * u_ratio * (1.0 + u_wabern * welle) * puls;
    float r = v_r * puls;
    // Schein: von der Mitte weich nach außen, am Rand des Scheins ganz aus.
    float aussen = max(d - 0.5 * r, 0.0) / max(0.5 * r + schein, 1.0);
    float a = u_deckkraft * exp(-1.7 * aussen) * (1.0 - smoothstep(0.7, 1.0, aussen));
    float m = 1.0 - smoothstep(0.75 * r, 1.05 * r, d);
    float k = 1.0 - smoothstep(0.3 * r, 0.55 * r, d);
    bool gewaehlt = v_gewaehlt > 0.5;
    vec3 fs = gewaehlt ? u_glut[0] : u_farben[0];
    vec3 fm = gewaehlt ? u_glut[1] : u_farben[1];
    vec3 fk = gewaehlt ? u_glut[2] : u_farben[2];
    vec4 summe = vec4(fs * a, a);
    summe = vec4(fm, 1.0) * (m * 0.95) + summe * (1.0 - m * 0.95);
    summe = vec4(fk, 1.0) * k + summe * (1.0 - k);
    farbe = summe;
}`;

// ---------------------------------------------------------------------------------------------
// Der Layer und sein Einhängen

export interface PowerlineArcsOptions {
    projection: RenderProjection;
    /** Ist die Kraftlinien-Ansicht an? */
    active: () => boolean;
    /** Vor diesem Layer einhängen (die Knoten), wenn es ihn gibt. */
    beforeId: string;
    /** Die Bögen zeichnen (true) oder haben aufgegeben (false); dann bleiben die flachen Lagen. */
    onReady: (ready: boolean) => void;
    fetchNetwork?: (revision?: number) => Promise<PowerlineNetwork>;
}

export interface PowerlineArcsState {
    active: boolean;
    ready: boolean;
    failed: boolean;
    lines: number;
    lift: number;
    animating: boolean;
    time: number;
    uprightNames: number;
    flatNamesVisible: boolean | undefined;
    /** Linienenden, die über dem Meeresspiegel auf dem Gelände stehen (WI-0049). */
    groundedEnds: number;
    /** Wie viele Segmente gerade hervorgehoben leuchten (die gewählte Kraftlinie, WI-0063 P8). */
    highlighted: number;
    /** Stränge und Fäden je Linie (`THREADS_PER_LINE`). */
    threads: number;
    /** Wie viele Linien das letzte Bild gezeichnet hat; die übrigen lagen außerhalb (`arcLevels`). */
    drawnLines: number;
    /** Die feinste Unterteilung im letzten Bild, als Vielfaches der gröbsten (`ARC_LEVELS`). */
    finestLevel: number;
    /** Wie viele Knoten als glühende Punkte gezeichnet werden (aus den geladenen Kacheln der Knotenquelle). */
    nodes: number;
    /** Der gewählte Knoten, wenn er unter den gezeichneten ist. */
    highlightedNode: string | undefined;
}

export interface PowerlineArcsController {
    remove(): void;
    state(): PowerlineArcsState;
    /**
     * Die Linien unter dem Punkt (Bildpunkte der Karte), wie die Bögen im letzten Bild gezeichnet sind: die nächste zuerst.
     * `undefined`, solange sie nicht gezeichnet sind (kein Bild, andere Ansicht, Rückfall auf die flachen Lagen); dann gelten
     * die Kacheln (`POWERLINE_HIT_LAYER_ID`).
     */
    hit(point: { x: number; y: number }, reach: number): ArcHit[] | undefined;
    /** Die Linien mit diesen Namen leuchten heller (die gewählte Kraftlinie ist die Gruppe ihrer Segmente); leer nimmt es weg. */
    highlight(names: readonly string[]): void;
    /**
     * Nach einer Kartenoperation (neue Revision): das Netz neu laden und die Bögen neu einhängen (WI-0205 K5). Ein Ort mit Nodix, ein
     * Kraftlinienpunkt oder ein Bogen hat sich bewegt; bis die Antwort da ist, bleiben die alten Bögen stehen.
     */
    neuLaden(revision: number): void;
    /**
     * Die Kraftlinien, die an diesem Knoten (Ort, Beschriftung, Kraftlinienpunkt) enden, je Linie EINMAL mit ihrem Anker (kleinste
     * Kennung ihrer Abschnitte gleichen Namens, wie der Editor) und Namen, nach Namen geordnet (EDIT-0003 T39: „Kraftlinie entfernen ›“
     * mit Auswahl). Leer, solange das Netz nicht geladen ist.
     */
    linienAm(knoten: string): { anker: string; name: string }[];
    /** Die Enden gegenüber diesem Knoten, je Abschnitt an ihm (Kartenkoordinaten, `gegenueberAmKnoten`); leer ohne Netz. */
    gegenueberAm(knoten: string): { x: number; y: number }[];
    /** Der Knoten mit dieser Kennung (ein gewählter Nodix-Ort) glüht in der Auswahl; `undefined` nimmt es weg. */
    highlightNode(id: string | undefined): void;
}

/** Das Netz; mit der Kartenrevision eine eigene Adresse, die der Server dauerhaft zwischenspeichern lässt (WI-0205 K5). */
async function ladeNetz(revision?: number): Promise<PowerlineNetwork> {
    const antwort = await fetch(revision === undefined ? "/api/powerlines" : `/api/powerlines?r=${String(revision)}`);
    if (!antwort.ok) {
        throw new Error(`/api/powerlines antwortet ${String(antwort.status)}`);
    }
    return (await antwort.json()) as PowerlineNetwork;
}

export function installPowerlineArcs(map: MapLibreMap, options: PowerlineArcsOptions): PowerlineArcsController {
    const bewegungReduziert = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    const holeNetz = options.fetchNetwork ?? ladeNetz;
    let geometrie: ArcGeometry | undefined;
    /** Das zuletzt geladene Netz: Es sagt, welche Linien an einem Knoten enden (`linienAm`). */
    let netzStand: PowerlineNetwork | undefined;
    let laden: Promise<void> | undefined;
    let gescheitert = false;
    let bereit = false;
    let lift = 0;
    let zeit = 0;
    let aufrecht = 0;
    let namenVeraltet = true;
    /**
     * Die Bodenhöhen neu lesen, sobald das Gelände sich ändert: neue Höhenkacheln, ein neues Gelände
     * oder eine andere Überhöhung. 💣 Nicht in jedem Bild - 350 Abfragen je Bild kosteten beim Drehen
     * die Hälfte der Bildrate (35 statt 60 Bilder je Sekunde, gemessen).
     */
    let bodenVeraltet = true;
    let bodenUeberhoehung = 0;
    let gelandeteEnden = 0;
    let bild = 0;
    let letztesBild = 0;
    const start = globalThis.performance.now();
    /** Das letzte gezeichnete Bild, woran Klick und Zeigen rechnen (`hit`); leer, bis die Bögen einmal gezeichnet sind. */
    let letzteMatrix: Float32Array | undefined;
    let letztesProPx = 0;
    let letzterBoden: Float32Array | undefined;
    /** Die Namen der hervorgehobenen Linien und die Nummern ihrer Segmente in der Geometrie. */
    let markierteNamen: ReadonlySet<string> = new Set();
    let markierteNummern: ReadonlySet<number> = new Set();
    let markierteFuer: ArcGeometry | undefined;
    /** Die Stufe der Unterteilung je Linie im letzten Bild (`arcLevels`), `-1` für nicht gezeichnet. */
    let stufen = new Int8Array(0);

    const liftJetzt = (): number => powerlineArcLift(map.getPitch(), BOEGEN.vollAbNeigung);
    const ruhig = (): boolean => bewegungReduziert?.matches === true;

    const flacheNamen = (): void => {
        if (!bereit || !map.getLayer(POWERLINE_LABEL_LAYER_ID)) {
            return;
        }
        const soll = liftJetzt() > 0.5 ? "none" : "visible";
        if ((map.getLayoutProperty(POWERLINE_LABEL_LAYER_ID, "visibility") ?? "visible") !== soll) {
            map.setLayoutProperty(POWERLINE_LABEL_LAYER_ID, "visibility", soll);
        }
    };

    /** Die Segmente der hervorgehobenen Linien; neu gelesen, wenn die Namen oder die Geometrie wechseln. */
    const markierteLinien = (): ReadonlySet<number> => {
        if (!geometrie || markierteNamen.size === 0) {
            return new Set();
        }
        if (markierteFuer !== geometrie) {
            markierteFuer = geometrie;
            markierteNummern = new Set(
                geometrie.lines.flatMap((line, nummer) => (markierteNamen.has(line.name) ? [nummer] : [])),
            );
        }
        return markierteNummern;
    };

    const layer = (daten: ArcGeometry): CustomLayerInterface => {
        let strangProgramm: WebGLProgram | undefined;
        let namenProgramm: WebGLProgram | undefined;
        let strangVao: WebGLVertexArrayObject | undefined;
        let namenVao: WebGLVertexArrayObject | undefined;
        let namenPuffer: WebGLBuffer | undefined;
        let namenEcken = 0;
        let atlasTextur: WebGLTexture | undefined;
        let bodenTextur: WebGLTexture | undefined;
        let fadenTextur: WebGLTexture | undefined;
        let boden = new Float32Array(daten.lines.length * 2);
        let atlas: Atlas | undefined;
        let indexPuffer: WebGLBuffer | undefined;
        const grund = lagenUniforms(LEUCHTLAGEN);
        const heller = lagenUniforms(HERVORHEBUNG);
        const ladeBoden = (gl: WebGL2RenderingContext, werte: Float32Array): void => {
            const zeilen = Math.max(1, Math.ceil(werte.length / BODEN_BREITE));
            const voll = new Float32Array(BODEN_BREITE * zeilen);
            voll.set(werte);
            gl.bindTexture(gl.TEXTURE_2D, bodenTextur ?? null);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BODEN_BREITE, zeilen, gl.RED, gl.FLOAT, voll);
        };
        const ort = new Map<string, WebGLUniformLocation | null>();
        const u = (gl: WebGL2RenderingContext, p: WebGLProgram, name: string): WebGLUniformLocation | null => {
            const schluessel = `${p === strangProgramm ? "s" : "n"}:${name}`;
            if (!ort.has(schluessel)) {
                ort.set(schluessel, gl.getUniformLocation(p, name));
            }
            return ort.get(schluessel) ?? null;
        };

        return {
            id: POWERLINE_ARCS_LAYER_ID,
            type: "custom",
            renderingMode: "3d",
            onAdd(_map, gl) {
                strangProgramm = programm(gl, STRANG_VS, STRANG_FS);
                namenProgramm = programm(gl, NAME_VS, NAME_FS);

                strangVao = gl.createVertexArray();
                gl.bindVertexArray(strangVao);
                const ecken = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, ecken);
                gl.bufferData(gl.ARRAY_BUFFER, daten.vertices, gl.STATIC_DRAW);
                const merkmal = (name: string, groesse: number, versatz: number): void => {
                    const stelle = gl.getAttribLocation(strangProgramm as WebGLProgram, name);
                    if (stelle < 0) {
                        return;
                    }
                    gl.enableVertexAttribArray(stelle);
                    gl.vertexAttribPointer(stelle, groesse, gl.FLOAT, false, FLOATS * 4, versatz * 4);
                };
                merkmal("a_g", 2, 0);
                merkmal("a_gp", 2, 2);
                merkmal("a_gn", 2, 4);
                merkmal("a_t", 3, 6);
                merkmal("a_side", 1, 9);
                merkmal("a_chord", 2, 10);
                merkmal("a_segments", 1, 12);
                merkmal("a_s", 3, 13);
                merkmal("a_length", 1, 16);
                merkmal("a_line", 1, 17);
                indexPuffer = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexPuffer);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, daten.indices, gl.STATIC_DRAW);
                gl.bindVertexArray(null);

                namenVao = gl.createVertexArray();
                gl.bindVertexArray(namenVao);
                namenPuffer = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, namenPuffer);
                const lage = gl.getAttribLocation(namenProgramm, "a_pos");
                gl.enableVertexAttribArray(lage);
                gl.vertexAttribPointer(lage, 3, gl.FLOAT, false, 20, 0);
                const uv = gl.getAttribLocation(namenProgramm, "a_uv");
                gl.enableVertexAttribArray(uv);
                gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12);
                gl.bindVertexArray(null);

                atlas = baueAtlas([...new Set(daten.lines.filter((l) => l.labelVisible).map((l) => l.name))]);
                atlasTextur = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, atlasTextur);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl.generateMipmap(gl.TEXTURE_2D);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

                // Die Bodenhöhen: eine Zeile je BODEN_BREITE Werte, ohne Filter gelesen.
                bodenTextur = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, bodenTextur);
                const zeilen = Math.max(1, Math.ceil(boden.length / BODEN_BREITE));
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BODEN_BREITE, zeilen, 0, gl.RED, gl.FLOAT, null);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                ladeBoden(gl, boden);

                // Die Fäden je Linie (`arcThreads`): vier Werte je Texel, ebenso ohne Filter gelesen.
                fadenTextur = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, fadenTextur);
                const fadenZeilen = Math.max(1, Math.ceil(daten.threads.length / 4 / BODEN_BREITE));
                const faeden = new Float32Array(BODEN_BREITE * fadenZeilen * 4);
                faeden.set(daten.threads);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, BODEN_BREITE, fadenZeilen, 0, gl.RGBA, gl.FLOAT, faeden);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

                // Legacys Bildtakt: nur alle `frameIntervalMs` ein neues Bild, und bei „Bewegung
                // reduzieren“ keines. Im Hintergrund-Tab ruht requestAnimationFrame von selbst.
                const takt = (jetzt: number): void => {
                    bild = globalThis.requestAnimationFrame(takt);
                    if (!ruhig() && jetzt - letztesBild >= STRAENGE.frameIntervalMs) {
                        letztesBild = jetzt;
                        map.triggerRepaint();
                    }
                };
                bild = globalThis.requestAnimationFrame(takt);
            },
            onRemove(_map, gl) {
                globalThis.cancelAnimationFrame(bild);
                if (strangProgramm) gl.deleteProgram(strangProgramm);
                if (namenProgramm) gl.deleteProgram(namenProgramm);
                if (atlasTextur) gl.deleteTexture(atlasTextur);
                if (bodenTextur) gl.deleteTexture(bodenTextur);
                if (fadenTextur) gl.deleteTexture(fadenTextur);
                if (indexPuffer) gl.deleteBuffer(indexPuffer);
                aufrecht = 0;
                // Ein neuer Layer kennt noch kein Bild: Bis er das erste zeichnet, gelten für den Klick die Kacheln.
                letzteMatrix = undefined;
            },
            render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
                if (!strangProgramm || !namenProgramm || !strangVao || !namenVao) {
                    return;
                }
                const matrix = Float32Array.from(args.defaultProjectionData.mainMatrix);
                lift = liftJetzt();
                zeit = ruhig() ? 0 : (globalThis.performance.now() - start) / 1000;
                const proPx = 1 / (512 * 2 ** map.getZoom());
                // Das Gelände ändert sich auch ohne Kamerabewegung: Kacheln kommen an, Gebirge wachsen.
                const ueberhoehung =
                    (map as unknown as { terrain: { exaggeration: number } | null }).terrain?.exaggeration ?? 0;
                if (bodenVeraltet || ueberhoehung !== bodenUeberhoehung) {
                    bodenVeraltet = false;
                    bodenUeberhoehung = ueberhoehung;
                    const neu = groundHeights(daten, (lngLat) => map.queryTerrainElevation(lngLat));
                    if (neu.some((wert, i) => wert !== boden[i])) {
                        boden = neu;
                        gelandeteEnden = boden.filter((wert) => wert > 0).length;
                        ladeBoden(gl, boden);
                        namenVeraltet = true;
                    }
                }

                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);

                const p = strangProgramm;
                gl.useProgram(p);
                gl.bindVertexArray(strangVao);
                gl.uniformMatrix4fv(u(gl, p, "u_matrix"), false, matrix);
                gl.uniform2f(u(gl, p, "u_viewport"), gl.drawingBufferWidth, gl.drawingBufferHeight);
                gl.uniform1f(u(gl, p, "u_time"), zeit);
                gl.uniform1f(u(gl, p, "u_lift"), lift);
                gl.uniform1f(u(gl, p, "u_unit"), daten.unit);
                gl.uniform1f(u(gl, p, "u_ratio"), globalThis.devicePixelRatio || 1);
                gl.uniform1f(u(gl, p, "u_proPx"), proPx);
                gl.uniform1f(u(gl, p, "u_share"), BOEGEN.anteil);
                gl.uniform1f(u(gl, p, "u_cap"), BOEGEN.hoechstensPx);
                gl.uniform4f(
                    u(gl, p, "u_tremor"),
                    STRAENGE.tremorNormalAmplitude,
                    STRAENGE.tremorTangentAmplitude,
                    STRAENGE.tremorNormalSpeed,
                    STRAENGE.tremorTangentSpeed,
                );
                gl.uniform3f(
                    u(gl, p, "u_tremorFreq"),
                    STRAENGE.tremorNormalFrequency,
                    STRAENGE.tremorTangentFrequency,
                    STRAENGE.tremorPhaseMultiplier,
                );
                gl.uniform2f(u(gl, p, "u_interference"), STRAENGE.interferenceAmplitude, STRAENGE.interferenceSpeed);
                gl.uniform1f(u(gl, p, "u_mitteAusschlag"), STRAENGE.normalScales[0] ?? 0);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, bodenTextur ?? null);
                gl.uniform1i(u(gl, p, "u_boden"), 0);
                gl.activeTexture(gl.TEXTURE1);
                gl.bindTexture(gl.TEXTURE_2D, fadenTextur ?? null);
                gl.uniform1i(u(gl, p, "u_faeden"), 1);
                const lagen = (werte: ReturnType<typeof lagenUniforms>): void => {
                    gl.uniform1f(u(gl, p, "u_width"), werte.breiteste);
                    gl.uniform1i(u(gl, p, "u_lagen"), werte.breiten.length);
                    gl.uniform4fv(u(gl, p, "u_farben"), werte.farben);
                    gl.uniform1fv(u(gl, p, "u_breiten"), werte.breiten);
                };
                // Je Linie die Stufe der Unterteilung für dieses Bild; was nicht zu sehen ist, wird nicht gezeichnet.
                const leinwand = map.getCanvas();
                stufen = arcLevels(daten, {
                    matrix,
                    width: leinwand.clientWidth,
                    height: leinwand.clientHeight,
                    proPx,
                    lift,
                    boden,
                });
                const zeichne = (zuege: { start: number; count: number }[]): void => {
                    for (const zug of zuege) {
                        gl.drawElementsInstanced(
                            gl.TRIANGLES,
                            zug.count,
                            gl.UNSIGNED_INT,
                            zug.start * 4,
                            THREADS_PER_LINE,
                        );
                    }
                };
                // Je Strang und Faden eine Instanz, jede mit allen Lagen, wie Legacys Ebenenstapel (Aura, Mitte, Kern je Strang).
                // Die gewählte Linie in ihrer Glut statt in Rosa: nur ihre Dreiecke, mit allen Fäden, und zuletzt, also obenauf.
                const markiert = markierteLinien();
                lagen(grund);
                zeichne(arcDraws(daten, stufen, { ohne: markiert }));
                if (markiert.size > 0) {
                    lagen(heller);
                    zeichne(arcDraws(daten, stufen, { nur: markiert }));
                }
                gl.bindVertexArray(null);
                gl.activeTexture(gl.TEXTURE0);
                // Das Bild, das der Mensch sieht: Darauf rechnen Klick und Zeigen (`hit`).
                letzteMatrix = matrix;
                letztesProPx = proPx;
                letzterBoden = boden;

                // Die aufrechten Namen erst, wenn die Bögen stehen; flach stehen die Namen der Kacheln.
                if (!atlas || lift <= 0.02) {
                    aufrecht = 0;
                    return;
                }
                if (namenVeraltet) {
                    const baender = uprightNameStrips(
                        daten,
                        { width: atlas.canvas.width, height: atlas.canvas.height, plaetze: atlas.plaetze },
                        matrix,
                        proPx,
                        lift,
                        boden,
                    );
                    gl.bindBuffer(gl.ARRAY_BUFFER, namenPuffer ?? null);
                    gl.bufferData(gl.ARRAY_BUFFER, baender.vertices, gl.DYNAMIC_DRAW);
                    namenEcken = baender.vertices.length / 5;
                    aufrecht = baender.count;
                    namenVeraltet = false;
                }
                if (namenEcken === 0) {
                    return;
                }
                const n = namenProgramm;
                gl.useProgram(n);
                gl.bindVertexArray(namenVao);
                gl.uniformMatrix4fv(u(gl, n, "u_matrix"), false, matrix);
                gl.activeTexture(gl.TEXTURE0);
                gl.bindTexture(gl.TEXTURE_2D, atlasTextur ?? null);
                gl.uniform1i(u(gl, n, "u_atlas"), 0);
                const sanft = Math.min(Math.max((lift - 0.3) / 0.4, 0), 1);
                gl.uniform1f(u(gl, n, "u_alpha"), sanft * sanft * (3 - 2 * sanft));
                gl.drawArrays(gl.TRIANGLES, 0, namenEcken);
                gl.bindVertexArray(null);
            },
        };
    };

    // --- Die Knoten als glühende Punkte -----------------------------------------------------------
    /** Die Knoten aus der Knotenquelle; neu gelesen, sobald ihre Kacheln sich ändern. */
    let knoten: ArcNode[] = [];
    let knotenVeraltet = true;
    let knotenBodenVeraltet = true;
    let knotenUeberhoehung = 0;
    let markierterKnoten: string | undefined;
    /** Zählt jede Änderung an Knoten, Boden oder Auswahl: Daran sieht der Layer, ob er neu hochladen muss. */
    let knotenStand = 0;
    let knotenDaten = new Float32Array(0);

    const knotenLesen = (): void => {
        knotenVeraltet = false;
        if (!map.getSource(LEY_NODE_SOURCE_ID)) {
            knoten = [];
        } else {
            knoten = arcNodes(map.querySourceFeatures(LEY_NODE_SOURCE_ID, { sourceLayer: LEY_NODE_SOURCE_LAYER }));
        }
        knotenBodenVeraltet = true;
    };
    /** Lage, Klasse, Phase und Auswahl je Knoten für den Instanzpuffer; der Boden wie bei den Linienenden (WI-0049). */
    const knotenPacken = (): void => {
        const daten = new Float32Array(knoten.length * KNOTEN_FLOATS);
        for (const [i, k] of knoten.entries()) {
            const meter = map.queryTerrainElevation({ lng: k.lng, lat: k.lat }) ?? 0;
            const z = meter === 0 ? 0 : MercatorCoordinate.fromLngLat({ lng: k.lng, lat: k.lat }, meter).z;
            daten.set([k.x, k.y, z, k.klasse, k.phase, k.id === markierterKnoten ? 1 : 0], i * KNOTEN_FLOATS);
        }
        knotenDaten = daten;
        knotenStand += 1;
    };
    /** Schein, Mitte und Kern eines Knotens aus Lagen der Tafel: die unterste, die vorletzte und die oberste (min. eine Lage). */
    const farben = (lagen: readonly PowerlineGlow[]): Float32Array =>
        Float32Array.from(
            [lagen[0], lagen[lagen.length - 2] ?? lagen[0], lagen[lagen.length - 1]]
                .filter((lage): lage is PowerlineGlow => lage !== undefined)
                .flatMap((lage) => anteile(lage.color)),
        );
    const knotenFarben = farben(TAFEL.glow);
    const knotenGlut = farben(TAFEL.auswahl);

    const knotenLayer = (): CustomLayerInterface => {
        let programmK: WebGLProgram | undefined;
        let vao: WebGLVertexArrayObject | undefined;
        let instanzen: WebGLBuffer | undefined;
        let ecken: WebGLBuffer | undefined;
        let hochgeladen = -1;
        const ort = new Map<string, WebGLUniformLocation | null>();
        const uk = (gl: WebGL2RenderingContext, name: string): WebGLUniformLocation | null => {
            if (!ort.has(name)) {
                ort.set(name, gl.getUniformLocation(programmK as WebGLProgram, name));
            }
            return ort.get(name) ?? null;
        };
        return {
            id: POWERLINE_NODES_LAYER_ID,
            type: "custom",
            renderingMode: "3d",
            onAdd(_map, gl) {
                programmK = programm(gl, KNOTEN_VS, KNOTEN_FS);
                vao = gl.createVertexArray();
                gl.bindVertexArray(vao);
                ecken = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, ecken);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
                const ecke = gl.getAttribLocation(programmK, "a_ecke");
                gl.enableVertexAttribArray(ecke);
                gl.vertexAttribPointer(ecke, 2, gl.FLOAT, false, 8, 0);
                instanzen = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, instanzen);
                const merkmal = (name: string, groesse: number, versatz: number): void => {
                    const stelle = gl.getAttribLocation(programmK as WebGLProgram, name);
                    if (stelle < 0) {
                        return;
                    }
                    gl.enableVertexAttribArray(stelle);
                    gl.vertexAttribPointer(stelle, groesse, gl.FLOAT, false, KNOTEN_FLOATS * 4, versatz * 4);
                    gl.vertexAttribDivisor(stelle, 1);
                };
                merkmal("a_lage", 3, 0);
                merkmal("a_klasse", 1, 3);
                merkmal("a_phase", 1, 4);
                merkmal("a_gewaehlt", 1, 5);
                gl.bindVertexArray(null);
                knotenVeraltet = true;
            },
            onRemove(_map, gl) {
                if (programmK) gl.deleteProgram(programmK);
                if (instanzen) gl.deleteBuffer(instanzen);
                if (ecken) gl.deleteBuffer(ecken);
            },
            render(gl: WebGL2RenderingContext, args: CustomRenderMethodInput) {
                if (!programmK || !vao) {
                    return;
                }
                if (knotenVeraltet) {
                    knotenLesen();
                }
                const ueberhoehung =
                    (map as unknown as { terrain: { exaggeration: number } | null }).terrain?.exaggeration ?? 0;
                if (knotenBodenVeraltet || ueberhoehung !== knotenUeberhoehung) {
                    knotenBodenVeraltet = false;
                    knotenUeberhoehung = ueberhoehung;
                    knotenPacken();
                }
                if (hochgeladen !== knotenStand) {
                    gl.bindBuffer(gl.ARRAY_BUFFER, instanzen ?? null);
                    gl.bufferData(gl.ARRAY_BUFFER, knotenDaten, gl.DYNAMIC_DRAW);
                    hochgeladen = knotenStand;
                }
                if (knoten.length === 0) {
                    return;
                }
                gl.enable(gl.BLEND);
                gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
                gl.disable(gl.DEPTH_TEST);
                gl.depthMask(false);
                gl.useProgram(programmK);
                gl.bindVertexArray(vao);
                const zoom = map.getZoom();
                gl.uniformMatrix4fv(
                    uk(gl, "u_matrix"),
                    false,
                    Float32Array.from(args.defaultProjectionData.mainMatrix),
                );
                gl.uniform2f(uk(gl, "u_viewport"), gl.drawingBufferWidth, gl.drawingBufferHeight);
                gl.uniform1f(uk(gl, "u_ratio"), globalThis.devicePixelRatio || 1);
                gl.uniform1fv(
                    uk(gl, "u_radien"),
                    Float32Array.from(KNOTEN_KLASSEN.map((klasse) => leyKnotenRadiusBei(klasse, zoom))),
                );
                gl.uniform1f(uk(gl, "u_schein"), LEY.glowPx);
                gl.uniform1f(uk(gl, "u_rand"), (1 + LEY.wabern) * (1 + LEY.puls));
                gl.uniform1f(uk(gl, "u_time"), zeit);
                gl.uniform1f(uk(gl, "u_deckkraft"), LEY.glowOpacity);
                gl.uniform1f(uk(gl, "u_wabern"), LEY.wabern);
                gl.uniform1f(uk(gl, "u_puls"), LEY.puls);
                gl.uniform3fv(uk(gl, "u_farben"), knotenFarben);
                gl.uniform3fv(uk(gl, "u_glut"), knotenGlut);
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, knoten.length);
                gl.bindVertexArray(null);
            },
        };
    };

    /** Vor dem ersten Namen eines Knotens: über Bögen und Ortsmarke, unter den Namen. Ohne Namen zuoberst. */
    const knotenVor = (): string | undefined =>
        map.getLayersOrder().find((id) => id.startsWith("nodix-label") || id.startsWith("place-active-label"));

    const einhaengen = (): void => {
        // 🪤 Mitten in einem Stilwechsel nimmt MapLibre keinen Layer an (`style-ready.ts`). Das ist kein Scheitern:
        // Das Ende des Ladens feuert `styledata`, dann gleicht `abgleichen` noch einmal ab.
        if (!geometrie || map.getLayer(POWERLINE_ARCS_LAYER_ID) || !styleTakesChanges(map)) {
            return;
        }
        try {
            map.addLayer(layer(geometrie), map.getLayer(options.beforeId) ? options.beforeId : undefined);
            // Nach `neuLaden` steht die Ebene der Knoten noch (nur die Bögen gehen neu): kein zweites Mal einhängen.
            if (!map.getLayer(POWERLINE_NODES_LAYER_ID)) map.addLayer(knotenLayer(), knotenVor());
        } catch (error) {
            gescheitert = true;
            console.error("Kraftlinienbögen: Layer nicht eingehängt", error);
            options.onReady(false);
            return;
        }
        namenVeraltet = true;
        if (!bereit) {
            bereit = true;
            options.onReady(true);
        }
    };

    const abgleichen = (): void => {
        const soll = options.active() && !gescheitert;
        const da = map.getLayer(POWERLINE_ARCS_LAYER_ID) !== undefined;
        if (!soll) {
            if (da) {
                map.removeLayer(POWERLINE_ARCS_LAYER_ID);
            }
            if (map.getLayer(POWERLINE_NODES_LAYER_ID)) {
                map.removeLayer(POWERLINE_NODES_LAYER_ID);
            }
            return;
        }
        if (!geometrie) {
            // Die Schrift der aufrechten Namen muss geladen sein, bevor der Atlas sie malt. Fehlt sie,
            // malt der Browser mit der Ersatzschrift - kein Grund, die Bögen aufzugeben.
            const schrift = `${String(BOEGEN.namePx * ATLAS_MASSSTAB)}px ${DESIGN_CANON.typography.fontFamily}`;
            laden ??= Promise.all([holeNetz(), globalThis.document?.fonts?.load(schrift).catch(() => [])])
                .then(([netz]) => {
                    netzStand = netz;
                    geometrie = buildArcGeometry(netz, options.projection);
                    abgleichen();
                })
                .catch((error: unknown) => {
                    gescheitert = true;
                    console.error("Kraftlinienbögen: Netz nicht geladen, die Linien bleiben flach", error);
                    options.onReady(false);
                });
            return;
        }
        if (!da) {
            einhaengen();
        } else if (map.getLayer(options.beforeId)) {
            // Nach einem Stilwechsel kann der Layer anderswo stehen: direkt unter den Knoten gehört er hin.
            const reihe = map.getLayersOrder();
            if (reihe.indexOf(POWERLINE_ARCS_LAYER_ID) + 1 !== reihe.indexOf(options.beforeId)) {
                map.moveLayer(POWERLINE_ARCS_LAYER_ID, options.beforeId);
            }
        }
        // Die glühenden Knoten: direkt unter dem ersten Namen eines Knotens. Ein neuer Stil bringt neue Kacheln der Knoten.
        knotenVeraltet = true;
        if (map.getLayer(POWERLINE_ARCS_LAYER_ID) && !map.getLayer(POWERLINE_NODES_LAYER_ID)) {
            map.addLayer(knotenLayer(), knotenVor());
        } else if (map.getLayer(POWERLINE_NODES_LAYER_ID)) {
            const vor = knotenVor();
            const reihe = map.getLayersOrder();
            const soll = vor === undefined ? reihe.length - 1 : reihe.indexOf(vor) - 1;
            if (reihe.indexOf(POWERLINE_NODES_LAYER_ID) !== soll) {
                map.moveLayer(POWERLINE_NODES_LAYER_ID, vor);
            }
        }
        flacheNamen();
    };

    const bewegt = (): void => {
        namenVeraltet = true;
    };
    const geneigt = (): void => {
        namenVeraltet = true;
        flacheNamen();
    };
    const gelaendeNeu = (): void => {
        bodenVeraltet = true;
        knotenBodenVeraltet = true;
    };
    const hoehenKachel = (event: { sourceId?: string; tile?: unknown }): void => {
        if (event.tile !== undefined && event.sourceId === map.getTerrain()?.source) {
            bodenVeraltet = true;
            knotenBodenVeraltet = true;
        }
        // Neue Kacheln der Knoten: die Knoten neu lesen.
        if (event.sourceId === LEY_NODE_SOURCE_ID) {
            knotenVeraltet = true;
        }
    };
    map.on("styledata", abgleichen);
    map.on("terrain", gelaendeNeu);
    map.on("sourcedata", hoehenKachel);
    map.on("move", bewegt);
    map.on("resize", bewegt);
    map.on("pitch", geneigt);
    abgleichen();

    let neuStand = 0;
    const neuLaden = (revision: number): void => {
        // Noch nie geladen: Das erste Laden holt ohnehin den neuen Stand.
        if (!geometrie || revision <= neuStand) return;
        neuStand = revision;
        holeNetz(revision)
            .then((netz) => {
                if (revision !== neuStand) return;
                netzStand = netz;
                geometrie = buildArcGeometry(netz, options.projection);
                markierteFuer = undefined;
                if (map.getLayer(POWERLINE_ARCS_LAYER_ID)) map.removeLayer(POWERLINE_ARCS_LAYER_ID);
                abgleichen();
            })
            .catch((error: unknown) =>
                console.error("Kraftlinienbögen: Netz nicht neu geladen, die alten Bögen bleiben", error),
            );
    };

    const linienAm = (knoten: string) => (netzStand === undefined ? [] : linienAmKnoten(netzStand, knoten));
    const gegenueberAm = (knoten: string) => (netzStand === undefined ? [] : gegenueberAmKnoten(netzStand, knoten));

    return {
        neuLaden,
        linienAm,
        gegenueberAm,
        remove() {
            map.off("styledata", abgleichen);
            map.off("move", bewegt);
            map.off("resize", bewegt);
            map.off("pitch", geneigt);
            map.off("terrain", gelaendeNeu);
            map.off("sourcedata", hoehenKachel);
            if (map.getLayer(POWERLINE_ARCS_LAYER_ID)) {
                map.removeLayer(POWERLINE_ARCS_LAYER_ID);
            }
            if (map.getLayer(POWERLINE_NODES_LAYER_ID)) {
                map.removeLayer(POWERLINE_NODES_LAYER_ID);
            }
        },
        state() {
            const flach = map.getLayer(POWERLINE_LABEL_LAYER_ID)
                ? (map.getLayoutProperty(POWERLINE_LABEL_LAYER_ID, "visibility") ?? "visible") === "visible"
                : undefined;
            return {
                active: map.getLayer(POWERLINE_ARCS_LAYER_ID) !== undefined,
                ready: bereit,
                failed: gescheitert,
                lines: geometrie?.lines.length ?? 0,
                lift: liftJetzt(),
                animating: bereit && !ruhig(),
                time: zeit,
                uprightNames: aufrecht,
                flatNamesVisible: flach,
                groundedEnds: gelandeteEnden,
                highlighted: markierteLinien().size,
                drawnLines: stufen.filter((stufe) => stufe >= 0).length,
                finestLevel: ARC_LEVELS[Math.max(0, ...stufen)] ?? 1,
                threads: THREADS_PER_LINE,
                nodes: map.getLayer(POWERLINE_NODES_LAYER_ID) ? knoten.length : 0,
                highlightedNode: knoten.some((k) => k.id === markierterKnoten) ? markierterKnoten : undefined,
            };
        },
        hit(point, reach) {
            // Nur, wo die Bögen gezeichnet sind und ein Bild gesehen haben: sonst weiß dieser Weg nichts, und die Kacheln gelten.
            if (!geometrie || !letzteMatrix || !map.getLayer(POWERLINE_ARCS_LAYER_ID)) {
                return undefined;
            }
            const leinwand = map.getCanvas();
            return arcHits(
                geometrie,
                {
                    matrix: letzteMatrix,
                    width: leinwand.clientWidth,
                    height: leinwand.clientHeight,
                    proPx: letztesProPx,
                    // Neigung, Zeit und Stufen des letzten Bildes, nicht die von jetzt: Gesehen ist das, was gezeichnet wurde.
                    lift,
                    boden: letzterBoden,
                    time: zeit,
                    levels: stufen,
                },
                point,
                reach,
            );
        },
        highlight(names) {
            const neu = new Set(names);
            if (neu.size === markierteNamen.size && [...neu].every((name) => markierteNamen.has(name))) {
                return;
            }
            markierteNamen = neu;
            markierteFuer = undefined;
            map.triggerRepaint();
        },
        highlightNode(id) {
            if (id === markierterKnoten) {
                return;
            }
            markierterKnoten = id;
            knotenBodenVeraltet = true;
            map.triggerRepaint();
        },
    };
}
