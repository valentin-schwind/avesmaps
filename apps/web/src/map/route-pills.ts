import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import { canonColour, DESIGN_CANON } from "@avesmaps3d/shared";
import { MEASURE_LINE_LAYER_ID } from "../measure/measure-layers";
import { offroadShapes, ROUTE_HIT_LAYER_ID, type RouteLayerData } from "./route-layers";
import { onStyleData } from "./style-ready";

/**
 * Querfeldein als Kette von Pillen - eine eigene WebGL2-Ebene, die jede Pille in jedem Bild neu legt
 * und rechnet (Betreiber 2026-09-24: erst „die pillenenden sollten halt kreisrund und nicht gedetscht
 * aussehen“, dann an den Bildern in fester Größe: „noch etwas gedetscht … dafür aber korrekte abstände -
 * die kurz ploppen wenn der zoom wechselt“).
 *
 * - 🔴 **Gerechnet, nicht gemalt.** Jede Pille ist eine Kapsel aus ihrem Abstandsfeld, über ein
 *   Gerätepixel geglättet wie MapLibres Linienkappen: kreisrunde Enden in der Breite der Linie, bei jedem
 *   Bildschirmfaktor. Ein vorgezeichnetes Bild skaliert und dreht MapLibre ohne Mipmaps; bei 150 % las
 *   es sich gedrückt.
 * - 🔴 **In jedem Bild gelegt.** Der Abstand ist bei jedem Zoom `Strich + Lücke` Pixel, und die Pillen
 *   fließen mit, statt nach dem Zoom umzuspringen. Ein Strichmuster (`line-dasharray`) streckte MapLibre
 *   zwischen zwei Zoomstufen mit der Kachel, Bilder an festen Orten sprangen nach jedem Zoom.
 * - **Das Muster hängt an der Mitte des Stücks** (`placePills`): Dort steht immer eine Pille, die anderen
 *   im festen Abstand davon. Wächst das Stück, blendet an den Enden eine neue ein - keine springt.
 * - **Flach (2D) in Bildschirmpixeln gelegt, geneigt (3D) im Raum** (Betreiber 2026-09-27 am Blatt
 *   `wi-0049-querfeldein-raum.png`: „im 3D modus will ich C gern mal live sehen, im 2D modus A“).
 *   - Im Raum liegt jede Pille flach auf dem Gelände: vorn größer, hinten kleiner, hinter Bergen verdeckt,
 *     wie die Route auf Wegen. Ihr Umriss bleibt die Kapsel aus dem Abstandsfeld; quer zum Blick
 *     staucht die Perspektive die runden Enden.
 *   - Maß und Abstand gelten in der Bildmitte. Senkrecht von oben sind beide Arten gleich, deshalb
 *     springt beim Neigen nichts.
 *   - 🔴 Die Bodenhöhen tastet die Ebene einmal je Stück ab (`groundTrack`) und rechnet sie ohne
 *     Überhöhung; neu nur bei `terrain` und neuen Höhenkacheln, nie je Bild - bei den Kraftlinienbögen
 *     kostete das 35 statt 60 Bilder je Sekunde.
 *
 * 🪤 Ein Custom Layer steht nicht im Stil-JSON (wie die Kraftlinienbögen). `installRoutePills` prüft
 * nach jedem `styledata`, ob er da ist, und hängt ihn direkt über die Trefferfläche der Route - dorthin,
 * wo die Route ihre Linien hat, unter Ortsmarken und Namen.
 */

export const ROUTE_PILLS_LAYER_ID = "route-offroad-pills";

const route = DESIGN_CANON.route;
const [DASH, GAP] = route.offroadDash;
/** Von Pillenmitte zu Pillenmitte, in Pixeln. */
export const PILL_PERIOD = DASH + GAP;

/** Ab dieser Neigung liegen die Pillen im Raum - dieselbe Grenze wie die Pille „2D | 3D“. */
export const PILLS_IN_SPACE_FROM_PITCH = 0.5;
/** So viele Pixel hebt die Ebene die Pillen für den Tiefentest an, damit sie am Hang nicht einsinken. */
const LIFT_PX = 8;
/** Stücke längs einer Pille im Raum, jedes auf seiner eigenen Geländehöhe. */
const PILL_SEGMENTS = 8;
/** Höchstens so viele Abtastpunkte je Stück, und nicht dichter als ein Viertel Höhenpixel (z 3, 512). */
const TRACK_SAMPLES = 2048;
const TRACK_MIN_STEP = 1 / (512 * 2 ** 3 * 4);

export interface ScreenPoint {
    x: number;
    y: number;
}

/** Eine gelegte Pille: Mitte in Bildschirmpixeln, Richtung als Einheitsvektor, Deckkraft 0 bis 1. */
export interface Pill {
    x: number;
    y: number;
    dx: number;
    dy: number;
    alpha: number;
}

/** Eine Pille samt Laufweg ihrer Mitte auf dem Stück. */
interface LaidPill {
    pill: Pill;
    at: number;
}

function layPills(points: readonly ScreenPoint[], period: number): LaidPill[] {
    if (points.length < 2) return [];
    const lengths = [0];
    for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1] as ScreenPoint;
        const b = points[index] as ScreenPoint;
        lengths.push((lengths[index - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    const total = lengths[lengths.length - 1] as number;
    if (!(total > 0)) return [];
    const middle = total / 2;
    const reach = Math.max(0, Math.ceil((middle - period / 4) / period));
    const laid: LaidPill[] = [];
    let step = 1;
    for (let k = -reach; k <= reach; k += 1) {
        const room = middle - Math.abs(k) * period;
        const alpha = k === 0 ? 1 : Math.min(1, Math.max(0, (room - period / 4) / (period / 4)));
        if (alpha <= 0) continue;
        const at = middle + k * period;
        while (step < lengths.length - 1 && (lengths[step] as number) < at) step += 1;
        const a = points[step - 1] as ScreenPoint;
        const b = points[step] as ScreenPoint;
        const from = lengths[step - 1] as number;
        const span = (lengths[step] as number) - from;
        const t = span > 0 ? (at - from) / span : 0;
        laid.push({
            pill: {
                x: a.x + (b.x - a.x) * t,
                y: a.y + (b.y - a.y) * t,
                dx: span > 0 ? (b.x - a.x) / span : 1,
                dy: span > 0 ? (b.y - a.y) / span : 0,
                alpha,
            },
            at,
        });
    }
    return laid;
}

/**
 * Die Pillen eines Stücks, gelegt auf seine Linie in Bildschirmpixeln: eine in der Mitte, die übrigen im
 * Abstand `period` davon. Bis zum Ende des Stücks braucht eine Pille ein halbes `period`; zwischen einem
 * Viertel und einem halben blendet sie ein. Die Mitte steht immer - auch ein sehr kurzes Stück hat seine
 * Pille und verschwindet beim Herauszoomen nicht. Im Raum dasselbe in Mercator-Einheiten.
 */
export function placePills(points: readonly ScreenPoint[], period: number = PILL_PERIOD): Pill[] {
    return layPills(points, period).map(({ pill }) => pill);
}

/**
 * Ein Stück im Raum: dicht abgetastet in Mercator-Einheiten, mit Laufweg und der Bodenhöhe ohne
 * Überhöhung je Punkt (`base`, Mercator-z; 0, solange nichts abgetastet ist).
 */
export interface GroundTrack {
    points: ScreenPoint[];
    lengths: number[];
    lngLat: [number, number][];
    base: Float32Array;
}

/** Tastet ein Stück dicht ab, damit die Pillen den Höhen zwischen den Stützpunkten folgen. */
export function groundTrack(coordinates: readonly (readonly number[])[]): GroundTrack {
    const corners = coordinates.map(([lng = 0, lat = 0]) => ({
        lng,
        lat,
        at: MercatorCoordinate.fromLngLat({ lng, lat }),
    }));
    let total = 0;
    for (let index = 1; index < corners.length; index += 1) {
        const a = (corners[index - 1] as (typeof corners)[number]).at;
        const b = (corners[index] as (typeof corners)[number]).at;
        total += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const step = Math.max(TRACK_MIN_STEP, total / TRACK_SAMPLES);
    const points: ScreenPoint[] = [];
    const lengths: number[] = [];
    const lngLat: [number, number][] = [];
    const add = (x: number, y: number, lng: number, lat: number): void => {
        const last = points[points.length - 1];
        lengths.push(last ? (lengths[lengths.length - 1] as number) + Math.hypot(x - last.x, y - last.y) : 0);
        points.push({ x, y });
        lngLat.push([lng, lat]);
    };
    for (let index = 0; index < corners.length; index += 1) {
        const b = corners[index] as (typeof corners)[number];
        const a = corners[index - 1];
        if (a) {
            const pieces = Math.max(1, Math.ceil(Math.hypot(b.at.x - a.at.x, b.at.y - a.at.y) / step));
            for (let piece = 1; piece < pieces; piece += 1) {
                const t = piece / pieces;
                add(
                    a.at.x + (b.at.x - a.at.x) * t,
                    a.at.y + (b.at.y - a.at.y) * t,
                    a.lng + (b.lng - a.lng) * t,
                    a.lat + (b.lat - a.lat) * t,
                );
            }
        }
        add(b.at.x, b.at.y, b.lng, b.lat);
    }
    return { points, lengths, lngLat, base: new Float32Array(points.length) };
}

/**
 * Die Bodenhöhe je Punkt ohne Überhöhung. `elevation` liefert wie `map.queryTerrainElevation` Meter samt
 * Überhöhung; bei Überhöhung 0 bleibt, was da ist.
 */
export function sampleGround(
    track: GroundTrack,
    elevation: (lngLat: { lng: number; lat: number }) => number | null,
    exaggeration: number,
): void {
    if (!(exaggeration > 0)) return;
    for (const [index, [lng, lat]] of track.lngLat.entries()) {
        const meters = (elevation({ lng, lat }) ?? 0) / exaggeration;
        track.base[index] = meters === 0 ? 0 : MercatorCoordinate.fromLngLat({ lng, lat }, meters).z;
    }
}

/** Bodenhöhe ohne Überhöhung an Laufweg `at`, zwischen den Abtastpunkten linear. */
export function groundAt(track: GroundTrack, at: number): number {
    const { lengths, base } = track;
    const last = lengths.length - 1;
    if (last < 1 || at <= 0) return base[0] ?? 0;
    if (at >= (lengths[last] as number)) return base[last] ?? 0;
    let low = 0;
    let high = last;
    while (high - low > 1) {
        const mid = (low + high) >> 1;
        if ((lengths[mid] as number) <= at) low = mid;
        else high = mid;
    }
    const from = lengths[low] as number;
    const span = (lengths[high] as number) - from;
    const t = span > 0 ? (at - from) / span : 0;
    return (base[low] as number) + ((base[high] as number) - (base[low] as number)) * t;
}

const VS = `#version 300 es
precision highp float;
in vec2 a_corner;
in vec2 a_center;
in vec2 a_dir;
in vec4 a_colour;
uniform vec2 u_viewport;
uniform float u_ratio;
out vec2 v_local;
out vec4 v_colour;
void main() {
    vec2 across = vec2(-a_dir.y, a_dir.x);
    vec2 p = a_center + (a_dir * a_corner.x + across * a_corner.y) * u_ratio;
    gl_Position = vec4(p.x / u_viewport.x * 2.0 - 1.0, 1.0 - p.y / u_viewport.y * 2.0, 0.0, 1.0);
    v_local = a_corner;
    v_colour = a_colour;
}`;

// Im Raum: gezeichnet am Boden, aber mit der Tiefe des angehobenen Punkts - so sinkt die Pille am Hang
// nicht ein, und ein Berg davor verdeckt sie trotzdem.
const VS_SPACE = `#version 300 es
precision highp float;
in vec3 a_pos;
in vec2 a_local;
in vec4 a_colour;
uniform mat4 u_matrix;
uniform float u_lift;
out vec2 v_local;
out vec4 v_colour;
void main() {
    vec4 ground = u_matrix * vec4(a_pos, 1.0);
    vec4 lifted = u_matrix * vec4(a_pos.xy, a_pos.z + u_lift, 1.0);
    gl_Position = vec4(ground.xy / ground.w * lifted.w, lifted.z, lifted.w);
    v_local = a_local;
    v_colour = a_colour;
}`;

// Kapsel: Abstand zur Strecke des geraden Stücks, Kern und Saum je über ein Gerätepixel geglättet. Im Raum
// (u_aa 0) misst die Ableitung, wie groß ein Gerätepixel auf der Pille gerade ist.
const FS = `#version 300 es
precision highp float;
in vec2 v_local;
in vec4 v_colour;
uniform float u_half;
uniform float u_core;
uniform float u_outer;
uniform float u_aa;
uniform vec3 u_halo;
out vec4 colour;
void main() {
    float d = length(vec2(max(abs(v_local.x) - u_half, 0.0), v_local.y));
    float aa = u_aa > 0.0 ? u_aa : max(length(vec2(dFdx(d), dFdy(d))), 1e-4);
    float outer = clamp((u_outer - d) / aa + 0.5, 0.0, 1.0);
    float core = clamp((u_core - d) / aa + 0.5, 0.0, 1.0);
    float a = outer * v_colour.a;
    colour = vec4(mix(u_halo, v_colour.rgb, core) * a, a);
}`;

/** Floats je Ecke: Ecke (2), Mitte in Gerätepixeln (2), Richtung (2), Farbe mit Deckkraft (4). */
const FLOATS = 10;
/** Floats je Ecke im Raum: Ort in Mercator (3), Lage auf der Pille in Pixeln (2), Farbe mit Deckkraft (4). */
const FLOATS_SPACE = 9;
const CORNERS: readonly [number, number][] = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, -1],
    [1, 1],
    [-1, 1],
];

const rgb = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
];

function program(gl: WebGL2RenderingContext, vertex: string): WebGLProgram {
    const shader = (type: number, source: string): WebGLShader => {
        const created = gl.createShader(type);
        if (!created) throw new Error("Pillen: kein Shader");
        gl.shaderSource(created, source);
        gl.compileShader(created);
        if (!gl.getShaderParameter(created, gl.COMPILE_STATUS)) {
            throw new Error(`Pillen: Shader übersetzt nicht: ${gl.getShaderInfoLog(created) ?? ""}`);
        }
        return created;
    };
    const linked = gl.createProgram();
    gl.attachShader(linked, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(linked, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(linked);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
        throw new Error(`Pillen: Programm bindet nicht: ${gl.getProgramInfoLog(linked) ?? ""}`);
    }
    return linked;
}

interface Shape {
    coordinates: [number, number][];
    colour: [number, number, number];
    alpha: number;
    /** Im Raum: das dicht abgetastete Stück samt Bodenhöhen, erst beim ersten geneigten Bild gebaut. */
    track?: GroundTrack;
}

/** Die Maße einer Pille in CSS-Pixeln: gerades Stück, Lücke, Saum. */
export interface PillShape {
    dash: number;
    gap: number;
    halo: number;
}

export interface RoutePillsController {
    /** Die Pillen des letzten Bildes, in CSS-Pixeln - für Browsertests. */
    drawn(): readonly Pill[];
    /** Wie das letzte Bild gelegt war: flach am Bildschirm oder geneigt im Raum - für Browsertests. */
    mode(): "screen" | "space";
    /** Nur für Entwürfe: die Maße vorübergehend ändern, bis zum Neuladen. Die Tafel bleibt die Quelle. */
    tune(shape: Partial<PillShape>): void;
    remove(): void;
}

interface Attribute {
    name: string;
    size: number;
    offset: number;
}

/**
 * Hängt die Pillen an die Karte. `data` liefert die Route, wie der Planer sie gerade zeigt; ändert sie
 * sich, liest die Ebene beim nächsten Bild die neuen Stücke.
 */
export function installRoutePills(map: MapLibreMap, data: () => RouteLayerData): RoutePillsController {
    const measure: PillShape = { dash: DASH, gap: GAP, halo: route.haloWidth };
    let lastData: RouteLayerData | undefined;
    let shapes: Shape[] = [];
    let drawn: Pill[] = [];
    let lastMode: "screen" | "space" = "screen";
    /** Die Pillen des letzten geneigten Bildes in Mercator; `drawn()` projiziert sie erst auf Nachfrage. */
    let spaced: Pill[] = [];
    let groundStale = true;

    const readShapes = (current: RouteLayerData): Shape[] =>
        offroadShapes(current).map((shape) => ({
            coordinates: shape.coordinates as [number, number][],
            colour: rgb(canonColour(shape.selected ? "routeSelected" : "route")),
            // Gewählt voll deckend (Legacy), veraltet gedimmt wie die übrige Route (Guide §17.10).
            alpha: shape.selected ? 1 : route.offroadOpacity * (shape.stale ? route.staleFactor : 1),
        }));

    const exaggeration = (): number =>
        (map as unknown as { terrain: { exaggeration: number } | null }).terrain?.exaggeration ?? 0;

    const layer = (): CustomLayerInterface => {
        let flat: WebGLProgram | undefined;
        let space: WebGLProgram | undefined;
        let flatVao: WebGLVertexArrayObject | null = null;
        let spaceVao: WebGLVertexArrayObject | null = null;
        let flatBuffer: WebGLBuffer | null = null;
        let spaceBuffer: WebGLBuffer | null = null;
        const uniforms = new Map<string, WebGLUniformLocation | null>();
        const u = (gl: WebGL2RenderingContext, linked: WebGLProgram, name: string): WebGLUniformLocation | null => {
            const key = `${linked === flat ? "f" : "s"}:${name}`;
            if (!uniforms.has(key)) uniforms.set(key, gl.getUniformLocation(linked, name));
            return uniforms.get(key) ?? null;
        };
        const vertexArray = (
            gl: WebGL2RenderingContext,
            linked: WebGLProgram,
            floats: number,
            attributes: readonly Attribute[],
        ): { vao: WebGLVertexArrayObject; buffer: WebGLBuffer } => {
            const vao = gl.createVertexArray();
            const buffer = gl.createBuffer();
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            for (const { name, size, offset } of attributes) {
                const at = gl.getAttribLocation(linked, name);
                if (at < 0) continue;
                gl.enableVertexAttribArray(at);
                gl.vertexAttribPointer(at, size, gl.FLOAT, false, floats * 4, offset * 4);
            }
            gl.bindVertexArray(null);
            return { vao, buffer };
        };
        /** Die Maße, die beide Arten teilen: gerades Stück, Kern und Saum in CSS-Pixeln. */
        const shapeUniforms = (gl: WebGL2RenderingContext, linked: WebGLProgram, aa: number): void => {
            const core = route.width / 2;
            gl.uniform1f(u(gl, linked, "u_half"), measure.dash / 2);
            gl.uniform1f(u(gl, linked, "u_core"), core);
            gl.uniform1f(u(gl, linked, "u_outer"), core + measure.halo);
            gl.uniform1f(u(gl, linked, "u_aa"), aa);
            gl.uniform3f(u(gl, linked, "u_halo"), ...rgb(canonColour("routeHalo")));
        };

        const renderFlat = (gl: WebGL2RenderingContext): void => {
            if (!flat) return;
            const canvas = map.getCanvas();
            const ratio = canvas.clientWidth > 0 ? gl.drawingBufferWidth / canvas.clientWidth : 1;
            const placed: { pill: Pill; shape: Shape }[] = [];
            for (const shape of shapes) {
                const points = shape.coordinates.map((position) => map.project(position));
                for (const pill of placePills(points, measure.dash + measure.gap)) placed.push({ pill, shape });
            }
            drawn = placed.map(({ pill }) => pill);
            if (placed.length === 0) return;

            const half = measure.dash / 2;
            const outer = route.width / 2 + measure.halo;
            const aa = 1 / ratio;
            const margin = 1 + aa;
            const vertices = new Float32Array(placed.length * CORNERS.length * FLOATS);
            let at = 0;
            for (const { pill, shape } of placed) {
                for (const [sx, sy] of CORNERS) {
                    vertices[at] = sx * (half + outer + margin);
                    vertices[at + 1] = sy * (outer + margin);
                    vertices[at + 2] = pill.x * ratio;
                    vertices[at + 3] = pill.y * ratio;
                    vertices[at + 4] = pill.dx;
                    vertices[at + 5] = pill.dy;
                    vertices[at + 6] = shape.colour[0];
                    vertices[at + 7] = shape.colour[1];
                    vertices[at + 8] = shape.colour[2];
                    vertices[at + 9] = shape.alpha * pill.alpha;
                    at += FLOATS;
                }
            }

            gl.useProgram(flat);
            gl.bindVertexArray(flatVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, flatBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
            gl.uniform2f(u(gl, flat, "u_viewport"), gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.uniform1f(u(gl, flat, "u_ratio"), ratio);
            shapeUniforms(gl, flat, aa);
            gl.disable(gl.DEPTH_TEST);
            gl.drawArrays(gl.TRIANGLES, 0, placed.length * CORNERS.length);
        };

        const renderSpace = (gl: WebGL2RenderingContext, matrix: ArrayLike<number>): void => {
            if (!space) return;
            const grown = exaggeration();
            // Ohne Überhöhung ist nichts abzulesen; die Abtastung bleibt offen, bis das Gelände wächst.
            if (groundStale && grown > 0) {
                groundStale = false;
                for (const shape of shapes) {
                    shape.track ??= groundTrack(shape.coordinates);
                    sampleGround(shape.track, (lngLat) => map.queryTerrainElevation(lngLat), grown);
                }
            }
            // Mercator-Einheiten je CSS-Pixel in der Bildmitte: dort misst die Pille, was sie flach misst.
            const unit = 1 / (512 * 2 ** map.getZoom());
            const half = measure.dash / 2;
            const outer = route.width / 2 + measure.halo;
            const margin = 1.5;
            const reachX = half + outer + margin;
            const reachY = outer + margin;
            const vertices: number[] = [];
            spaced = [];
            for (const shape of shapes) {
                const track = (shape.track ??= groundTrack(shape.coordinates));
                for (const { pill, at } of layPills(track.points, (measure.dash + measure.gap) * unit)) {
                    const alpha = shape.alpha * pill.alpha;
                    spaced.push(pill);
                    const acrossX = -pill.dy * reachY * unit;
                    const acrossY = pill.dx * reachY * unit;
                    let previous: number[] | undefined;
                    for (let piece = 0; piece <= PILL_SEGMENTS; piece += 1) {
                        const along = -reachX + (2 * reachX * piece) / PILL_SEGMENTS;
                        const x = pill.x + pill.dx * along * unit;
                        const y = pill.y + pill.dy * along * unit;
                        const z = groundAt(track, at + along * unit) * grown;
                        const row = [
                            x - acrossX,
                            y - acrossY,
                            z,
                            along,
                            -reachY,
                            x + acrossX,
                            y + acrossY,
                            z,
                            along,
                            reachY,
                        ];
                        if (previous) {
                            for (const [source, side] of [
                                [previous, 0],
                                [row, 0],
                                [row, 1],
                                [previous, 0],
                                [row, 1],
                                [previous, 1],
                            ] as const) {
                                const o = side * 5;
                                vertices.push(source[o] as number, source[o + 1] as number, source[o + 2] as number);
                                vertices.push(source[o + 3] as number, source[o + 4] as number);
                                vertices.push(shape.colour[0], shape.colour[1], shape.colour[2], alpha);
                            }
                        }
                        previous = row;
                    }
                }
            }
            if (vertices.length === 0) return;

            gl.useProgram(space);
            gl.bindVertexArray(spaceVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, spaceBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW);
            gl.uniformMatrix4fv(u(gl, space, "u_matrix"), false, Float32Array.from(matrix));
            gl.uniform1f(u(gl, space, "u_lift"), LIFT_PX * unit);
            shapeUniforms(gl, space, 0);
            // Den Tiefentest stellt MapLibre für 3D-Ebenen; die Pillen schreiben selbst keine Tiefe.
            gl.depthMask(false);
            gl.drawArrays(gl.TRIANGLES, 0, vertices.length / FLOATS_SPACE);
        };

        return {
            id: ROUTE_PILLS_LAYER_ID,
            type: "custom",
            renderingMode: "3d",
            onAdd(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                flat = program(gl2, VS);
                space = program(gl2, VS_SPACE);
                ({ vao: flatVao, buffer: flatBuffer } = vertexArray(gl2, flat, FLOATS, [
                    { name: "a_corner", size: 2, offset: 0 },
                    { name: "a_center", size: 2, offset: 2 },
                    { name: "a_dir", size: 2, offset: 4 },
                    { name: "a_colour", size: 4, offset: 6 },
                ]));
                ({ vao: spaceVao, buffer: spaceBuffer } = vertexArray(gl2, space, FLOATS_SPACE, [
                    { name: "a_pos", size: 3, offset: 0 },
                    { name: "a_local", size: 2, offset: 3 },
                    { name: "a_colour", size: 4, offset: 5 },
                ]));
            },
            onRemove(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                for (const linked of [flat, space]) if (linked) gl2.deleteProgram(linked);
                for (const buffer of [flatBuffer, spaceBuffer]) if (buffer) gl2.deleteBuffer(buffer);
                for (const vao of [flatVao, spaceVao]) if (vao) gl2.deleteVertexArray(vao);
                flat = undefined;
                space = undefined;
                uniforms.clear();
            },
            render(gl, args) {
                const gl2 = gl as WebGL2RenderingContext;
                const current = data();
                if (current !== lastData) {
                    lastData = current;
                    shapes = readShapes(current);
                    groundStale = true;
                }
                drawn = [];
                spaced = [];
                lastMode = map.getPitch() > PILLS_IN_SPACE_FROM_PITCH ? "space" : "screen";
                if (shapes.length === 0) return;
                gl2.enable(gl2.BLEND);
                gl2.blendFunc(gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
                if (lastMode === "space") renderSpace(gl2, args.defaultProjectionData.mainMatrix);
                else renderFlat(gl2);
                gl2.bindVertexArray(null);
            },
        };
    };

    /**
     * Direkt über der Messlinie, sonst über der Trefferfläche der Route - also unter dem, was danach im Stil kommt.
     *
     * 🪤 **Warum über der Messlinie und nicht unter ihr.** Eine eigene Ebene kann MapLibre nicht in die Zwischenbilder des
     * Geländes legen; sie zerschneidet den Stapel. Hing sie zwischen `route-hit` und `measure-line`, hielt das Gelände je
     * Kachel ZWEI vollständige Texturensätze - einen für alles bis zur Route, einen für die eine gestrichelte Linie darüber,
     * die ohne Messung leer ist. Gemessen am 2026-10-12, Fenstermaße iPhone 15: 8 statt 4 Zwischenbilder, also doppelt so
     * viel Speicher (`DRAPE_MB` in `terrain/terrain.ts`). Über der Messlinie verankert bleibt es ein Stapel.
     *
     * Die Messlinie liegt damit unter den Offroad-Punkten und der Flugbahn statt darüber. Legacys Reihenfolge
     * (`measure/measure-layers.ts`: über der Route, unter den Ortsmarken) bleibt gewahrt - beides kam erst mit uns dazu.
     */
    const reconcile = (): void => {
        if (!map.getLayer(ROUTE_HIT_LAYER_ID)) return;
        const anker = map.getLayer(MEASURE_LINE_LAYER_ID) ? MEASURE_LINE_LAYER_ID : ROUTE_HIT_LAYER_ID;
        const order = map.getLayersOrder();
        const next = order[order.indexOf(anker) + 1];
        if (!map.getLayer(ROUTE_PILLS_LAYER_ID)) {
            map.addLayer(layer(), next);
        } else if (next !== ROUTE_PILLS_LAYER_ID) {
            map.moveLayer(ROUTE_PILLS_LAYER_ID, next);
        }
    };
    const terrainChanged = (): void => {
        groundStale = true;
    };
    const heightTile = (event: { sourceId?: string; tile?: unknown }): void => {
        if (event.tile !== undefined && event.sourceId === map.getTerrain()?.source) groundStale = true;
    };
    const stopReconcile = onStyleData(map, reconcile);
    map.on("terrain", terrainChanged);
    map.on("sourcedata", heightTile);

    return {
        drawn: () => {
            if (lastMode === "screen") return drawn;
            return spaced.map(({ x, y, dx, dy, alpha }) => {
                const unit = 1 / (512 * 2 ** map.getZoom());
                const centre = map.project(new MercatorCoordinate(x, y).toLngLat());
                const ahead = map.project(new MercatorCoordinate(x + dx * unit, y + dy * unit).toLngLat());
                const length = Math.hypot(ahead.x - centre.x, ahead.y - centre.y);
                return {
                    x: centre.x,
                    y: centre.y,
                    dx: length > 0 ? (ahead.x - centre.x) / length : 1,
                    dy: length > 0 ? (ahead.y - centre.y) / length : 0,
                    alpha,
                };
            });
        },
        mode: () => lastMode,
        tune: (shape) => {
            Object.assign(measure, shape);
            map.triggerRepaint();
        },
        remove: () => {
            stopReconcile();
            map.off("terrain", terrainChanged);
            map.off("sourcedata", heightTile);
            if (map.getLayer(ROUTE_PILLS_LAYER_ID)) map.removeLayer(ROUTE_PILLS_LAYER_ID);
        },
    };
}
