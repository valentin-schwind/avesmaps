import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA_FLIGHT_CARTOGRAPHY, canonColour, DESIGN_CANON } from "@avesmaps3d/shared";
import {
    buildFlightTracks,
    flightPointAt,
    flightProfile,
    MERCATOR_PER_SCHRITT,
    lotSteps,
    projectToScreen,
    sampleFlightGround,
    type FlightTrack,
} from "./flight-path";
import { ROUTE_FLIGHT_IN_SPACE, ROUTE_HIT_LAYER_ID, type RouteLayerData } from "./route-layers";
import { PILLS_IN_SPACE_FROM_PITCH, ROUTE_PILLS_LAYER_ID } from "./route-pills";
import { onStyleData } from "./style-ready";

/**
 * Die Flugbahn im Raum (WI-0051 F3): geneigt schwebt ein Flug als Bahn über der Karte, steigt am Start auf,
 * hält seine Höhe, fliegt die Kurven um die Gebirge und sinkt ins Ziel, im echten Höhenmaßstab wie das
 * Gelände. Die Rechnung steht in `flight-path.ts`, die Maße in `config/map-cartography/aventuria-flight.json`.
 *
 * Betreiber 2026-09-28: „kannst du dann den 3D flug mit einer schwebenden 3D kurve darstellen? ähnlich wie
 * die kraftlinien? …“; zu den Entwürfen „3. ja“, „nein keine pfeile aber ein rote flugbahn für fluggeräte“,
 * dann jeder Flug rot, und für die Höhe „A“ (echter Maßstab statt „B + C“).
 *
 * - **Nur geneigt** (ab derselben Neigung wie die Pillen im Raum). Flach bleibt der Flug die Linie der Route,
 *   und diese Ebene zeichnet nichts.
 * - **Geneigt tritt die Linie zurück:** Die Ebene setzt den globalen Zustand `ROUTE_FLIGHT_IN_SPACE`, und
 *   Saum und Linie lassen jeden Flugabschnitt aus. An ihrer Stelle zeichnet diese Ebene die Bodenspur,
 *   gestrichelt in der Farbe der Bahn. Die Trefferfläche bleibt: Eine Etappe wählt man weiter am Boden.
 * - **Gezeichnet, von unten nach oben:** Bodenspur, helle Lote in Halbierungen des Abschnitts, dann die Bahn
 *   im Stil der Route (weißer Saum, farbiger Kern, Breiten aus dem Kanon). Gold für die gewählte Etappe,
 *   veraltet gedimmt, rot (`FLIGHT_COLOUR`). Keine Pfeile, keine Bewegung.
 * - **Der Pfeil des Playmodes fliegt mit** (Betreiber 2026-09-28: „im playmode läuft der pfeil noch am boden
 *   entlang, er soll in der luft mitfliegen“): `heightAt` gibt ihm und der Folgekamera die Höhe, die dieses
 *   Bild gezeichnet hat - dasselbe Profil, keine zweite Rechnung, keine Höhenabfrage.
 * - **Tiefe mit dem Gelände:** `renderingMode: "3d"`; ein Berg vor der Bahn verdeckt sie. Wie die Pillen
 *   im Raum am Ort gezeichnet und mit der Tiefe des um `anhebenPx` angehobenen Punkts getestet, damit
 *   Bahnende und Spur am Hang nicht einsinken. Die Ebene schreibt selbst keine Tiefe.
 *
 * 🔴 **Bildrate:** Die Bodenhöhen fragt die Ebene einmal je Route und je Geländewechsel ab (neue
 * Höhenkacheln, `terrain`), ohne Überhöhung und frühestens alle `neuFruehestensMs`, nie in jedem Bild: Bei
 * den Kraftlinienbögen kosteten 350 Abfragen je Bild die Hälfte der Bildrate. Das Höhenprofil rechnet sie
 * nur neu, wenn sich die Überhöhung (beim Neigen) oder der Boden geändert haben, und lädt es als kleine
 * Textur hoch; Lage, Breite und Striche rechnet der Shader.
 *
 * 🪤 Ein Custom Layer steht nicht im Stil-JSON (wie Pillen und Kraftlinienbögen): `installFlightArcs` prüft
 * nach jedem `styledata`, ob er da ist, und hängt ihn direkt über die Pillen, sonst über die Trefferfläche
 * der Route. Ein volles Neuladen des Stils setzt auch den globalen Zustand zurück; er wird dann neu gesetzt.
 */

export const FLIGHT_ARCS_LAYER_ID = "route-flugbahn";

const TAFEL = AVENTURIA_FLIGHT_CARTOGRAPHY;
const ZEICHNUNG = TAFEL.zeichnung;
const route = DESIGN_CANON.route;
/** Breite der Textur mit den Höhen: je Probe Bahn (r) und Boden (g). */
const HOEHEN_BREITE = 1024;
/** Floats je Ecke der Bänder: Ort, davor, danach (je 2), Proben (3), Seite, Laufweg, Länge, Farbe (4). */
const FLOATS = 16;
/** Floats je Ecke der Lote: Ort (2), Probe, Ende, Seite, Stufe, Länge. */
const FLOATS_LOT = 7;

const HOEHEN = `
uniform highp sampler2D u_hoehen;
const int BREITE = ${String(HOEHEN_BREITE)};
// Bahn (x) und Boden (y) samt Überhöhung, Mercator-z.
vec2 hoehen(float probe) {
    int i = int(probe + 0.5);
    return texelFetch(u_hoehen, ivec2(i % BREITE, i / BREITE), 0).rg;
}`;

const BAND_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_width;
uniform float u_boden;
uniform float u_anheben;
${HOEHEN}
in vec2 a_pos; in vec2 a_prev; in vec2 a_next;
in vec3 a_probe;
in float a_side;
in float a_run;
in float a_length;
in vec4 a_colour;
out float v_across;
out float v_half;
out float v_run;
out float v_length;
out vec4 v_colour;
float z(float probe) {
    vec2 h = hoehen(probe);
    return mix(h.x, h.y, u_boden);
}
void main() {
    float hier = z(a_probe.x);
    vec4 c = u_matrix * vec4(a_pos, hier, 1.0);
    vec4 angehoben = u_matrix * vec4(a_pos, hier + u_anheben, 1.0);
    vec4 davor = u_matrix * vec4(a_prev, z(a_probe.y), 1.0);
    vec4 danach = u_matrix * vec4(a_next, z(a_probe.z), 1.0);
    if (c.w <= 0.0 || angehoben.w <= 0.0 || davor.w <= 0.0 || danach.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec2 halb = u_viewport * 0.5;
    vec2 richtung = danach.xy / danach.w * halb - davor.xy / davor.w * halb;
    richtung = length(richtung) < 1e-6 ? vec2(1.0, 0.0) : normalize(richtung);
    vec2 normale = vec2(-richtung.y, richtung.x);
    float breite = u_width * 0.5 * u_ratio + 0.75;
    vec2 ort = c.xy / c.w + normale * a_side * breite / halb;
    gl_Position = vec4(ort * angehoben.w, angehoben.z, angehoben.w);
    v_across = a_side * breite;
    v_half = breite;
    v_run = a_run;
    v_length = a_length;
    v_colour = a_colour;
}`;

// Durchgezogen (Bahn, Saum) oder gestrichelt (Bodenspur): jeder Strich eine Kapsel mit runden Enden, die
// Striche in der Mitte des Abschnitts verankert, ihr Maß in Pixeln der Bildmitte wie die Pillen im Raum.
const BAND_FS = `#version 300 es
precision highp float;
uniform vec3 u_saumFarbe;
uniform float u_saum;
uniform float u_deckkraft;
uniform float u_ratio;
uniform float u_proPx;
uniform float u_periodePx;
uniform float u_strichPx;
uniform float u_width;
in float v_across;
in float v_half;
in float v_run;
in float v_length;
in vec4 v_colour;
out vec4 farbe;
void main() {
    float deckung;
    if (u_periodePx > 0.0) {
        float u = (v_run - 0.5 * v_length) / (u_periodePx * u_proPx) + 0.5;
        float laengs = (fract(u) - 0.5) * u_periodePx * u_ratio;
        float kern = max(0.0, 0.5 * (u_strichPx - u_width) * u_ratio);
        float d = length(vec2(max(abs(laengs) - kern, 0.0), v_across));
        deckung = clamp(v_half - 0.25 - d, 0.0, 1.0);
    } else {
        deckung = clamp(v_half - abs(v_across), 0.0, 1.0);
    }
    vec3 ton = u_saum > 0.5 ? u_saumFarbe : v_colour.rgb;
    float a = v_colour.a * u_deckkraft * deckung;
    farbe = vec4(ton * a, a);
}`;

const LOT_VS = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec2 u_viewport;
uniform float u_ratio;
uniform float u_width;
uniform float u_anheben;
uniform float u_proPx;
uniform float u_abstandPx;
${HOEHEN}
in vec2 a_pos;
in float a_probe;
in float a_end;
in float a_side;
in float a_level;
in float a_length;
out float v_across;
out float v_half;
out float v_alpha;
void main() {
    vec2 h = hoehen(a_probe);
    vec4 unten = u_matrix * vec4(a_pos, h.y, 1.0);
    vec4 oben = u_matrix * vec4(a_pos, h.x, 1.0);
    float z = a_end > 0.5 ? h.x : h.y;
    vec4 c = a_end > 0.5 ? oben : unten;
    vec4 angehoben = u_matrix * vec4(a_pos, z + u_anheben, 1.0);
    if (unten.w <= 0.0 || oben.w <= 0.0 || angehoben.w <= 0.0) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vec2 halb = u_viewport * 0.5;
    vec2 richtung = oben.xy / oben.w * halb - unten.xy / unten.w * halb;
    richtung = length(richtung) < 1e-6 ? vec2(0.0, 1.0) : normalize(richtung);
    vec2 normale = vec2(-richtung.y, richtung.x);
    float breite = u_width * 0.5 * u_ratio + 0.75;
    vec2 ort = c.xy / c.w + normale * a_side * breite / halb;
    gl_Position = vec4(ort * angehoben.w, angehoben.z, angehoben.w);
    v_across = a_side * breite;
    v_half = breite;
    // Dieselbe Rechnung wie lotAlpha in flight-path.ts.
    float laengePx = a_length / u_proPx;
    v_alpha = laengePx > 0.0 ? clamp(log2(laengePx / u_abstandPx) - a_level + 1.0, 0.0, 1.0) : 0.0;
}`;

const LOT_FS = `#version 300 es
precision highp float;
uniform vec3 u_farbe;
uniform float u_deckkraft;
in float v_across;
in float v_half;
in float v_alpha;
out vec4 farbe;
void main() {
    float a = clamp(v_half - abs(v_across), 0.0, 1.0) * v_alpha * u_deckkraft;
    farbe = vec4(u_farbe * a, a);
}`;

function programm(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
    const shader = (typ: number, quelle: string): WebGLShader => {
        const s = gl.createShader(typ);
        if (!s) throw new Error("Flugbahn: kein Shader");
        gl.shaderSource(s, quelle);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            throw new Error(`Flugbahn: Shader - ${gl.getShaderInfoLog(s) ?? "unbekannt"}`);
        }
        return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(`Flugbahn: Programm - ${gl.getProgramInfoLog(p) ?? "unbekannt"}`);
    }
    return p;
}

/** Hexfarbe in drei Anteile 0..1. */
const rgb = (hex: string): [number, number, number] => [
    Number.parseInt(hex.slice(1, 3), 16) / 255,
    Number.parseInt(hex.slice(3, 5), 16) / 255,
    Number.parseInt(hex.slice(5, 7), 16) / 255,
];

/** Die Bänder und Lote aller Bahnen einer Route, ohne Browser prüfbar. */
export interface FlightGeometry {
    /** Erste Probe jeder Bahn in der Textur der Höhen. */
    offsets: number[];
    samples: number;
    bands: Float32Array;
    bandIndices: Uint32Array;
    lots: Float32Array;
    lotIndices: Uint32Array;
}

export function buildFlightGeometry(tracks: readonly FlightTrack[]): FlightGeometry {
    const offsets: number[] = [];
    let samples = 0;
    for (const track of tracks) {
        offsets.push(samples);
        samples += track.x.length;
    }
    const bands: number[] = [];
    const bandIndices: number[] = [];
    const lots: number[] = [];
    const lotIndices: number[] = [];
    const stufen = lotSteps();
    let ecke = 0;
    let lotEcke = 0;
    for (const [nummer, track] of tracks.entries()) {
        const n = track.x.length;
        const erste = offsets[nummer] as number;
        const [r, g, b] = rgb(canonColour(track.colour));
        for (let k = 0; k < n; k += 1) {
            const davor = Math.max(0, k - 1);
            const danach = Math.min(n - 1, k + 1);
            for (const seite of [-1, 1]) {
                bands.push(track.x[k] as number, track.y[k] as number);
                bands.push(track.x[davor] as number, track.y[davor] as number);
                bands.push(track.x[danach] as number, track.y[danach] as number);
                bands.push(erste + k, erste + davor, erste + danach, seite);
                bands.push((track.length * k) / Math.max(1, n - 1), track.length, r, g, b, track.alpha);
            }
            if (k + 1 < n) {
                const a = ecke + 2 * k;
                bandIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
            }
        }
        ecke += 2 * n;
        for (const { anteil, stufe } of stufen) {
            const k = Math.round(anteil * (n - 1));
            for (const [ende, seite] of [
                [0, -1],
                [0, 1],
                [1, -1],
                [1, 1],
            ] as const) {
                lots.push(track.x[k] as number, track.y[k] as number, erste + k, ende, seite, stufe, track.length);
            }
            lotIndices.push(lotEcke, lotEcke + 1, lotEcke + 2, lotEcke + 1, lotEcke + 3, lotEcke + 2);
            lotEcke += 4;
        }
    }
    return {
        offsets,
        samples,
        bands: new Float32Array(bands),
        bandIndices: new Uint32Array(bandIndices),
        lots: new Float32Array(lots),
        lotIndices: new Uint32Array(lotIndices),
    };
}

export interface FlightArcsState {
    /** Flugabschnitte der Route. */
    flights: number;
    /** Wie das letzte Bild gezeichnet war: flach (die Linie der Route) oder geneigt im Raum. */
    mode: "flat" | "space";
    /** Im letzten Bild gezeichnete Bahnen. */
    drawn: number;
    exaggeration: number;
    /** Proben aller Bahnen, also Höhenabfragen je Abtastung. */
    samples: number;
    /** Wie oft abgetastet wurde, und wie lange die letzte Abtastung brauchte (ms). */
    groundSamplings: number;
    groundMs: number;
    /** Der höchste abgetastete Boden unter den Bahnen, in Schritt: Gelände wurde gelesen. */
    groundMax: number;
    /** Die höchste Stelle der Bahnen im letzten Profil, in Schritt über dem Meer (ohne Überhöhung). */
    arcMax: number;
    /** Wie oft das Profil neu gerechnet wurde, und wie lange zuletzt (ms). */
    profiles: number;
    profileMs: number;
}

/** Die Mitte einer Bahn und der Boden darunter im letzten Bild, in CSS-Pixeln. */
export interface FlightArcPeak {
    arc: { x: number; y: number };
    ground: { x: number; y: number };
}

/** Die Bahn über einer Stelle ihres Abschnitts: Mercator samt Höhe (mit Überhöhung), die Höhe auch in Metern. */
export interface FlightHeight {
    x: number;
    y: number;
    z: number;
    /** Dieselbe Höhe in Metern, wie MapLibre die Höhe der Kameramitte nimmt. */
    meters: number;
}

export interface FlightArcsController {
    state(): FlightArcsState;
    /** Die Mitte der Bahn `index` im letzten geneigten Bild, für Browsertests und Abnahmebilder. */
    peak(index?: number): FlightArcPeak | undefined;
    /**
     * Die Bahn über dem Abschnitt `segment` (`RouteSegment.index`) an der Stelle `along` (0 bis 1 seiner Länge),
     * wie sie das letzte Bild gezeichnet hat: für den Pfeil des Playmodes, der auf ihr mitfliegt. Flach, ohne
     * Flug an dieser Stelle oder vor dem ersten Profil: keine.
     */
    heightAt(segment: number, along: number): FlightHeight | undefined;
    remove(): void;
}

/**
 * Hängt die Flugbahn an die Karte. `data` liefert die Route, wie der Planer sie gerade zeigt; ändert sie
 * sich, liest die Ebene beim nächsten Bild die neuen Abschnitte.
 */
export function installFlightArcs(map: MapLibreMap, data: () => RouteLayerData): FlightArcsController {
    let lastData: RouteLayerData | undefined;
    let tracks: FlightTrack[] = [];
    let geometry: FlightGeometry = buildFlightGeometry([]);
    let profiles: Float32Array[] = [];
    /** Stehen in `profiles` die Höhen, die das letzte geneigte Bild gezeichnet hat? */
    let profiled = false;
    let groundStale = true;
    let lastSampled = Number.NEGATIVE_INFINITY;
    let nachholen: ReturnType<typeof setTimeout> | undefined;
    let lastMatrix: Float32Array | undefined;
    const zustand: FlightArcsState = {
        flights: 0,
        mode: "flat",
        drawn: 0,
        exaggeration: 0,
        samples: 0,
        groundSamplings: 0,
        groundMs: 0,
        groundMax: 0,
        arcMax: 0,
        profiles: 0,
        profileMs: 0,
    };

    const exaggeration = (): number =>
        (map as unknown as { terrain: { exaggeration: number } | null }).terrain?.exaggeration ?? 0;
    const inSpace = (): boolean => map.getPitch() > PILLS_IN_SPACE_FROM_PITCH;

    /** Liest die Route neu, wenn der Planer eine andere zeigt. */
    const readTracks = (): void => {
        const current = data();
        if (current === lastData) return;
        lastData = current;
        tracks = buildFlightTracks(current);
        geometry = buildFlightGeometry(tracks);
        profiles = tracks.map((track) => new Float32Array(track.x.length));
        profiled = false;
        groundStale = true;
        zustand.flights = tracks.length;
        zustand.samples = geometry.samples;
    };

    /** Die Bodenhöhen einmal je Route und Geländewechsel, gedrosselt; danach zeichnet die Karte nach. */
    const sampleGround = (): boolean => {
        const grown = exaggeration();
        if (!groundStale || !(grown > 0)) return false;
        const jetzt = globalThis.performance.now();
        const warten = TAFEL.proben.neuFruehestensMs - (jetzt - lastSampled);
        if (warten > 0) {
            nachholen ??= setTimeout(() => {
                nachholen = undefined;
                map.triggerRepaint();
            }, warten);
            return false;
        }
        groundStale = false;
        lastSampled = jetzt;
        let hoechster = 0;
        for (const track of tracks) {
            hoechster = Math.max(
                hoechster,
                sampleFlightGround(track, (lngLat) => map.queryTerrainElevation(lngLat), grown),
            );
        }
        zustand.groundSamplings += 1;
        zustand.groundMs = globalThis.performance.now() - jetzt;
        zustand.groundMax = hoechster;
        return true;
    };

    const layer = (): CustomLayerInterface => {
        let band: WebGLProgram | undefined;
        let lot: WebGLProgram | undefined;
        let bandVao: WebGLVertexArrayObject | null = null;
        let lotVao: WebGLVertexArrayObject | null = null;
        const puffer: WebGLBuffer[] = [];
        let hoehenTextur: WebGLTexture | null = null;
        let hoehenZeilen = 0;
        let hoehen = new Float32Array(0);
        /** Was in den Puffern dieser Ebene liegt, und für welche Werte das Profil zuletzt gerechnet wurde. */
        let geladen: FlightGeometry | undefined;
        let gerechnet = "";
        const orte = new Map<string, WebGLUniformLocation | null>();
        const u = (gl: WebGL2RenderingContext, p: WebGLProgram, name: string): WebGLUniformLocation | null => {
            const schluessel = `${p === band ? "b" : "l"}:${name}`;
            if (!orte.has(schluessel)) orte.set(schluessel, gl.getUniformLocation(p, name));
            return orte.get(schluessel) ?? null;
        };
        const merkmale = (
            gl: WebGL2RenderingContext,
            p: WebGLProgram,
            floats: number,
            liste: readonly [string, number, number][],
        ): { vao: WebGLVertexArrayObject; ecken: WebGLBuffer; dreiecke: WebGLBuffer } => {
            const vao = gl.createVertexArray();
            gl.bindVertexArray(vao);
            const ecken = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, ecken);
            for (const [name, groesse, versatz] of liste) {
                const stelle = gl.getAttribLocation(p, name);
                if (stelle < 0) continue;
                gl.enableVertexAttribArray(stelle);
                gl.vertexAttribPointer(stelle, groesse, gl.FLOAT, false, floats * 4, versatz * 4);
            }
            const dreiecke = gl.createBuffer();
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, dreiecke);
            gl.bindVertexArray(null);
            puffer.push(ecken, dreiecke);
            return { vao, ecken, dreiecke };
        };
        let bandPuffer: { ecken: WebGLBuffer; dreiecke: WebGLBuffer } | undefined;
        let lotPuffer: { ecken: WebGLBuffer; dreiecke: WebGLBuffer } | undefined;

        const hochladen = (gl: WebGL2RenderingContext): void => {
            if (geladen === geometry || !bandPuffer || !lotPuffer) return;
            geladen = geometry;
            gerechnet = "";
            // Die Dreiecke hängen an ihrem Vertex Array; der eigene wird dafür gebunden, nie MapLibres.
            gl.bindVertexArray(bandVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, bandPuffer.ecken);
            gl.bufferData(gl.ARRAY_BUFFER, geometry.bands, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bandPuffer.dreiecke);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.bandIndices, gl.STATIC_DRAW);
            gl.bindVertexArray(lotVao);
            gl.bindBuffer(gl.ARRAY_BUFFER, lotPuffer.ecken);
            gl.bufferData(gl.ARRAY_BUFFER, geometry.lots, gl.STATIC_DRAW);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, lotPuffer.dreiecke);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geometry.lotIndices, gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            hoehenZeilen = Math.max(1, Math.ceil(geometry.samples / HOEHEN_BREITE));
            hoehen = new Float32Array(HOEHEN_BREITE * hoehenZeilen * 2);
            gl.bindTexture(gl.TEXTURE_2D, hoehenTextur);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, HOEHEN_BREITE, hoehenZeilen, 0, gl.RG, gl.FLOAT, null);
        };

        /** Das Profil jeder Bahn, nur wenn sich die Überhöhung oder der Boden geändert haben. */
        const profilRechnen = (gl: WebGL2RenderingContext, grown: number): void => {
            const schluessel = `${String(grown)}|${String(zustand.groundSamplings)}`;
            if (schluessel === gerechnet) return;
            gerechnet = schluessel;
            const start = globalThis.performance.now();
            let hoechste = 0;
            for (const [nummer, track] of tracks.entries()) {
                const profil = flightProfile(track, grown, profiles[nummer]);
                const erste = geometry.offsets[nummer] as number;
                for (let k = 0; k < profil.length; k += 1) {
                    hoehen[(erste + k) * 2] = profil[k] as number;
                    hoehen[(erste + k) * 2 + 1] = (track.ground[k] as number) * grown;
                    hoechste = Math.max(hoechste, profil[k] as number);
                }
            }
            profiled = true;
            zustand.arcMax = grown > 0 ? hoechste / grown / MERCATOR_PER_SCHRITT : 0;
            gl.bindTexture(gl.TEXTURE_2D, hoehenTextur);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HOEHEN_BREITE, hoehenZeilen, gl.RG, gl.FLOAT, hoehen);
            zustand.profiles += 1;
            zustand.profileMs = globalThis.performance.now() - start;
        };

        return {
            id: FLIGHT_ARCS_LAYER_ID,
            type: "custom",
            renderingMode: "3d",
            onAdd(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                band = programm(gl2, BAND_VS, BAND_FS);
                lot = programm(gl2, LOT_VS, LOT_FS);
                const b = merkmale(gl2, band, FLOATS, [
                    ["a_pos", 2, 0],
                    ["a_prev", 2, 2],
                    ["a_next", 2, 4],
                    ["a_probe", 3, 6],
                    ["a_side", 1, 9],
                    ["a_run", 1, 10],
                    ["a_length", 1, 11],
                    ["a_colour", 4, 12],
                ]);
                bandVao = b.vao;
                bandPuffer = b;
                const l = merkmale(gl2, lot, FLOATS_LOT, [
                    ["a_pos", 2, 0],
                    ["a_probe", 1, 2],
                    ["a_end", 1, 3],
                    ["a_side", 1, 4],
                    ["a_level", 1, 5],
                    ["a_length", 1, 6],
                ]);
                lotVao = l.vao;
                lotPuffer = l;
                hoehenTextur = gl2.createTexture();
                gl2.bindTexture(gl2.TEXTURE_2D, hoehenTextur);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
            },
            onRemove(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                for (const p of [band, lot]) if (p) gl2.deleteProgram(p);
                for (const vao of [bandVao, lotVao]) if (vao) gl2.deleteVertexArray(vao);
                for (const b of puffer) gl2.deleteBuffer(b);
                if (hoehenTextur) gl2.deleteTexture(hoehenTextur);
                band = undefined;
                lot = undefined;
                orte.clear();
            },
            render(gl, args) {
                const gl2 = gl as WebGL2RenderingContext;
                readTracks();
                zustand.drawn = 0;
                zustand.mode = inSpace() ? "space" : "flat";
                if (zustand.mode === "flat" || tracks.length === 0 || !band || !lot) return;
                const grown = exaggeration();
                const proPx = 1 / (512 * 2 ** map.getZoom());
                zustand.exaggeration = grown;
                hochladen(gl2);
                sampleGround();
                profilRechnen(gl2, grown);

                const matrix = Float32Array.from(args.defaultProjectionData.mainMatrix);
                lastMatrix = matrix;
                const canvas = map.getCanvas();
                const ratio = canvas.clientWidth > 0 ? gl2.drawingBufferWidth / canvas.clientWidth : 1;
                // Den Tiefentest stellt MapLibre für 3D-Ebenen; die Bahn schreibt selbst keine Tiefe.
                gl2.depthMask(false);
                gl2.enable(gl2.BLEND);
                gl2.blendFunc(gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
                gl2.activeTexture(gl2.TEXTURE0);
                gl2.bindTexture(gl2.TEXTURE_2D, hoehenTextur);

                const gemeinsam = (p: WebGLProgram, breite: number): void => {
                    gl2.uniformMatrix4fv(u(gl2, p, "u_matrix"), false, matrix);
                    gl2.uniform2f(u(gl2, p, "u_viewport"), gl2.drawingBufferWidth, gl2.drawingBufferHeight);
                    gl2.uniform1f(u(gl2, p, "u_ratio"), ratio);
                    gl2.uniform1f(u(gl2, p, "u_width"), breite);
                    gl2.uniform1f(u(gl2, p, "u_anheben"), ZEICHNUNG.anhebenPx * proPx);
                    gl2.uniform1f(u(gl2, p, "u_proPx"), proPx);
                    gl2.uniform1i(u(gl2, p, "u_hoehen"), 0);
                };
                const saum = rgb(canonColour("routeHalo"));

                // Die Bodenspur, gestrichelt in der Farbe der Bahn.
                const spur = ZEICHNUNG.bodenspur;
                gl2.useProgram(band);
                gl2.bindVertexArray(bandVao);
                gemeinsam(band, spur.breitePx);
                gl2.uniform1f(u(gl2, band, "u_boden"), 1);
                gl2.uniform1f(u(gl2, band, "u_saum"), 0);
                gl2.uniform3f(u(gl2, band, "u_saumFarbe"), ...saum);
                gl2.uniform1f(u(gl2, band, "u_deckkraft"), spur.deckkraft);
                gl2.uniform1f(u(gl2, band, "u_periodePx"), spur.strichPx + spur.lueckePx);
                gl2.uniform1f(u(gl2, band, "u_strichPx"), spur.strichPx);
                gl2.drawElements(gl2.TRIANGLES, geometry.bandIndices.length, gl2.UNSIGNED_INT, 0);

                // Die Lote, hell, in der Deckkraft der Route.
                const lote = ZEICHNUNG.lote;
                gl2.useProgram(lot);
                gl2.bindVertexArray(lotVao);
                gemeinsam(lot, lote.breitePx);
                gl2.uniform1f(u(gl2, lot, "u_abstandPx"), lote.abstandPx);
                gl2.uniform3f(u(gl2, lot, "u_farbe"), ...saum);
                gl2.uniform1f(u(gl2, lot, "u_deckkraft"), lote.deckkraft * (tracks[0]?.alpha ?? 1));
                gl2.drawElements(gl2.TRIANGLES, geometry.lotIndices.length, gl2.UNSIGNED_INT, 0);

                // Die Bahn wie die Route: erst der Saum aller Abschnitte, dann ihr Kern.
                gl2.useProgram(band);
                gl2.bindVertexArray(bandVao);
                gl2.uniform1f(u(gl2, band, "u_boden"), 0);
                gl2.uniform1f(u(gl2, band, "u_deckkraft"), 1);
                gl2.uniform1f(u(gl2, band, "u_periodePx"), 0);
                for (const [breite, istSaum] of [
                    [route.width + 2 * route.haloWidth, 1],
                    [route.width, 0],
                ] as const) {
                    gl2.uniform1f(u(gl2, band, "u_width"), breite);
                    gl2.uniform1f(u(gl2, band, "u_saum"), istSaum);
                    gl2.drawElements(gl2.TRIANGLES, geometry.bandIndices.length, gl2.UNSIGNED_INT, 0);
                }
                gl2.bindVertexArray(null);
                zustand.drawn = tracks.length;
            },
        };
    };

    /** Geneigt tritt die Linie der Route für jeden Flug zurück (`ROUTE_FLIGHT_IN_SPACE`). */
    const lineSync = (): void => {
        const soll = inSpace();
        try {
            if (map.getGlobalState()[ROUTE_FLIGHT_IN_SPACE] !== soll)
                map.setGlobalStateProperty(ROUTE_FLIGHT_IN_SPACE, soll);
        } catch {
            // Mitten im Stilwechsel nimmt MapLibre keinen Zustand an; das nächste `styledata` setzt ihn.
        }
    };

    /** Direkt über den Pillen, sonst über der Trefferfläche der Route: dort, wo die Route ihre Linien hat. */
    const reconcile = (): void => {
        const anker = map.getLayer(ROUTE_PILLS_LAYER_ID) ? ROUTE_PILLS_LAYER_ID : ROUTE_HIT_LAYER_ID;
        if (!map.getLayer(anker)) return;
        const order = map.getLayersOrder();
        const next = order[order.indexOf(anker) + 1];
        if (!map.getLayer(FLIGHT_ARCS_LAYER_ID)) map.addLayer(layer(), next);
        else if (next !== FLIGHT_ARCS_LAYER_ID) map.moveLayer(FLIGHT_ARCS_LAYER_ID, next);
        lineSync();
    };
    const terrainChanged = (): void => {
        groundStale = true;
    };
    const heightTile = (event: { sourceId?: string; tile?: unknown }): void => {
        if (event.tile !== undefined && event.sourceId === map.getTerrain()?.source) groundStale = true;
    };
    // Nur, wenn der Stil Ebenen annimmt (`style-ready.ts`); das Ende seines Ladens ruft ihn selbst noch einmal.
    const stopReconcile = onStyleData(map, reconcile);
    map.on("pitch", lineSync);
    map.on("terrain", terrainChanged);
    map.on("sourcedata", heightTile);

    return {
        state: () => ({ ...zustand }),
        peak: (index = 0) => {
            const track = tracks[index];
            const profil = profiles[index];
            const matrix = lastMatrix;
            if (!track || !profil || !matrix || zustand.mode !== "space") return undefined;
            const k = Math.floor(track.x.length / 2);
            const canvas = map.getCanvas();
            const x = track.x[k] as number;
            const y = track.y[k] as number;
            const arc = projectToScreen(
                matrix,
                { x, y, z: profil[k] as number },
                canvas.clientWidth,
                canvas.clientHeight,
            );
            const ground = projectToScreen(
                matrix,
                { x, y, z: (track.ground[k] as number) * zustand.exaggeration },
                canvas.clientWidth,
                canvas.clientHeight,
            );
            return arc && ground ? { arc, ground } : undefined;
        },
        heightAt: (segment, along) => {
            // Nur, was gezeichnet ist: geneigt, für diese Route, nach dem ersten Profil.
            if (zustand.mode !== "space" || !profiled || lastData !== data()) return undefined;
            const nummer = tracks.findIndex((track) => track.segment === segment);
            const track = tracks[nummer];
            const profil = profiles[nummer];
            if (!track || !profil) return undefined;
            const punkt = flightPointAt(track, profil, along);
            return { ...punkt, meters: new MercatorCoordinate(punkt.x, punkt.y, punkt.z).toAltitude() };
        },
        remove: () => {
            stopReconcile();
            map.off("pitch", lineSync);
            map.off("terrain", terrainChanged);
            map.off("sourcedata", heightTile);
            if (nachholen) clearTimeout(nachholen);
            if (map.getLayer(FLIGHT_ARCS_LAYER_ID)) map.removeLayer(FLIGHT_ARCS_LAYER_ID);
        },
    };
}
