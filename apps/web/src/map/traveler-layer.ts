import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, DESIGN_CANON, toRenderLngLat } from "@avesmaps3d/shared";
import { shiftCenter } from "./camera/camera-math";
import type { FlightHeight } from "./flight-arcs";
import { projectToScreen } from "./flight-path";
import { drawTravelerImage, type RouteTraveler } from "./route-layers";
import { onStyleData } from "./style-ready";

/**
 * Der Pfeil der Reisenden (WI-0031) als eigene WebGL2-Ebene, im selben Bild gezeichnet wie die Kamera.
 *
 * 💣 **Warum keine Symbolebene mehr:** Der Pfeil war ein Punkt in einer GeoJSON-Quelle. Jede neue Lage
 * ging über den Worker, der die Quelle in Kacheln schneidet, und kam drei bis vier Bilder später zurück.
 * Die Kamera folgt dagegen sofort. Auf Flughöhe (Zoom 7) stand der Pfeil so rund 30 px hinter der Mitte,
 * unter Last mehr (gemessen 2026-09-25). Ein Rechenproblem war das nicht, nur ein Umweg. Diese Ebene
 * liest die Lage in jedem Bild selbst und rechnet sie mit derselben Kamera, mit der MapLibre das Bild
 * zeichnet.
 *
 * - **Wie vorher als Symbol:** Er liegt flach auf der Karte und dreht mit ihr, in 3D liegt er auf dem
 *   Boden (`icon-pitch-alignment: map`). Seine Größe wächst mit dem Zoom (`travelerScale`).
 * - **Ganz oben:** über Ortsmarken und Namen. `installTravelerLayer` hängt ihn nach jedem `styledata`
 *   wieder an das Ende des Stils.
 * - **Auf einem Flug fliegt er geneigt mit** (WI-0051 F3, Betreiber 2026-09-28: „im playmode läuft der pfeil
 *   noch am boden entlang, er soll in der luft mitfliegen“): Er liegt dann flach in der Höhe der Flugbahn
 *   über seiner Stelle, die ihm die Bahn selbst sagt (`FlightHeight`, `flight-arcs.ts`). Am Start und am
 *   Ziel steht die Bahn auf dem Boden, dort geht er ohne Sprung vom Boden in die Luft und zurück. Flach und
 *   auf jedem anderen Abschnitt liegt er wie bisher auf dem Boden.
 */

export const ROUTE_TRAVELER_LAYER_ID = "route-traveler";

/** Wo die Reisenden stehen, dazu der Abschnitt unter ihnen und wie weit sie in ihm sind (0 bis 1). */
export interface TravelerPosition extends RouteTraveler {
    segment?: number;
    along?: number;
}

/** Die Höhe der Flugbahn über dieser Stelle, wenn sie gerade im Raum steht - sonst keine. */
export type TravelerFlightHeight = (position: TravelerPosition) => FlightHeight | undefined;

const route = DESIGN_CANON.route;
/** Das Bild ist in doppelter Auflösung gezeichnet. */
const IMAGE_PIXEL_RATIO = 2;

/**
 * Wie groß der Pfeil bei welchem Zoom steht, als Anteil seines Bildes: Gezeichnet ist er in der großen
 * Fassung (`travelerSizeClose`), bis `travelerZoom[0]` steht er auf `travelerSize` verkleinert und wächst
 * dann gleichmäßig (Betreiber 2026-09-24: „bei höherwerdender Zoomstufe größer“).
 */
export function travelerScale(zoom: number): number {
    const [from, to] = route.travelerZoom;
    const small = route.travelerSize / route.travelerSizeClose;
    const share = Math.min(1, Math.max(0, (zoom - from) / (to - from)));
    return small + (1 - small) * share;
}

/**
 * Die vier Ecken des Pfeilbilds auf der Karte, im Uhrzeigersinn ab links oben: um `center` gedreht nach
 * `heading` (im Uhrzeigersinn ab Kartennorden), `half` Bildpunkte vom Mittelpunkt bei diesem Zoom.
 */
export function travelerCorners(
    center: readonly [number, number],
    heading: number,
    zoom: number,
    half: number,
): [number, number][] {
    const angle = (heading * Math.PI) / 180;
    // Auf der Karte: rechts vom Pfeil und zu seinem Fuß, in Weltpixeln (x nach Osten, y nach Süden).
    const right = [Math.cos(angle), Math.sin(angle)] as const;
    const down = [-Math.sin(angle), Math.cos(angle)] as const;
    return (
        [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
        ] as const
    ).map(([u, v]) =>
        shiftCenter(center, half * (u * right[0] + v * down[0]), half * (u * right[1] + v * down[1]), zoom, 0),
    );
}

const VS = `#version 300 es
precision highp float;
in vec2 a_position;
in vec2 a_uv;
uniform vec2 u_viewport;
out vec2 v_uv;
void main() {
    gl_Position = vec4(a_position.x / u_viewport.x * 2.0 - 1.0, 1.0 - a_position.y / u_viewport.y * 2.0, 0.0, 1.0);
    v_uv = a_uv;
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_image;
out vec4 colour;
void main() {
    colour = texture(u_image, v_uv);
}`;

/** Zwei Dreiecke über die vier Ecken: je Ecke Lage in Gerätepixeln (2) und Bildkoordinate (2). */
const TRIANGLES = [0, 1, 2, 0, 2, 3] as const;
const UV: readonly [number, number][] = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
];

function program(gl: WebGL2RenderingContext): WebGLProgram {
    const shader = (type: number, source: string): WebGLShader => {
        const created = gl.createShader(type);
        if (!created) throw new Error("Pfeil: kein Shader");
        gl.shaderSource(created, source);
        gl.compileShader(created);
        if (!gl.getShaderParameter(created, gl.COMPILE_STATUS)) {
            throw new Error(`Pfeil: Shader übersetzt nicht: ${gl.getShaderInfoLog(created) ?? ""}`);
        }
        return created;
    };
    const linked = gl.createProgram();
    gl.attachShader(linked, shader(gl.VERTEX_SHADER, VS));
    gl.attachShader(linked, shader(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(linked);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
        throw new Error(`Pfeil: Programm bindet nicht: ${gl.getProgramInfoLog(linked) ?? ""}`);
    }
    return linked;
}

/** Wo der Pfeil im letzten Bild stand, in CSS-Pixeln der Karte. */
export interface DrawnTraveler {
    x: number;
    y: number;
    heading: number;
    /** Nur wenn er auf einem Flug in der Luft steht: der Boden unter ihm, ebenso in CSS-Pixeln. */
    ground?: { x: number; y: number };
}

export interface TravelerLayerController {
    /** Der Pfeil des letzten Bildes - oder keiner. Für Browsertests: was man sieht, nicht was gemeldet ist. */
    drawn(): DrawnTraveler | null;
    remove(): void;
}

/**
 * Hängt den Pfeil an die Karte. `current` sagt, wo er gerade steht; gelesen wird in jedem Bild. `flightHeight`
 * sagt auf einem Flug, wie hoch seine Bahn im selben Bild steht.
 */
export function installTravelerLayer(
    map: MapLibreMap,
    current: () => TravelerPosition | null,
    flightHeight?: TravelerFlightHeight,
): TravelerLayerController {
    const space = AVENTURIA.coordinateSpace;
    let drawn: DrawnTraveler | null = null;

    const layer = (): CustomLayerInterface => {
        let linked: WebGLProgram | undefined;
        let vao: WebGLVertexArrayObject | null = null;
        let buffer: WebGLBuffer | null = null;
        let texture: WebGLTexture | null = null;
        let imageSize = 0;
        return {
            id: ROUTE_TRAVELER_LAYER_ID,
            type: "custom",
            renderingMode: "2d",
            onAdd(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                linked = program(gl2);
                vao = gl2.createVertexArray();
                buffer = gl2.createBuffer();
                gl2.bindVertexArray(vao);
                gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer);
                const attribute = (name: string, offset: number): void => {
                    const at = gl2.getAttribLocation(linked as WebGLProgram, name);
                    if (at < 0) return;
                    gl2.enableVertexAttribArray(at);
                    gl2.vertexAttribPointer(at, 2, gl2.FLOAT, false, 4 * 4, offset * 4);
                };
                attribute("a_position", 0);
                attribute("a_uv", 2);
                gl2.bindVertexArray(null);

                // Das Bild ist dasselbe wie vorher als Symbol, mit Mipmaps: verkleinert bleibt es ruhig.
                const image = drawTravelerImage(IMAGE_PIXEL_RATIO);
                imageSize = image.width / IMAGE_PIXEL_RATIO;
                texture = gl2.createTexture();
                gl2.activeTexture(gl2.TEXTURE0);
                gl2.bindTexture(gl2.TEXTURE_2D, texture);
                gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, image);
                gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                gl2.generateMipmap(gl2.TEXTURE_2D);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.LINEAR_MIPMAP_LINEAR);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.LINEAR);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_S, gl2.CLAMP_TO_EDGE);
                gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_WRAP_T, gl2.CLAMP_TO_EDGE);
                gl2.bindTexture(gl2.TEXTURE_2D, null);
            },
            onRemove(_map, gl) {
                const gl2 = gl as WebGL2RenderingContext;
                if (linked) gl2.deleteProgram(linked);
                if (buffer) gl2.deleteBuffer(buffer);
                if (vao) gl2.deleteVertexArray(vao);
                if (texture) gl2.deleteTexture(texture);
                linked = undefined;
                texture = null;
                drawn = null;
            },
            render(gl, args) {
                const gl2 = gl as WebGL2RenderingContext;
                const traveler = current();
                drawn = null;
                if (!linked || !texture || !traveler) return;
                const lngLat = toRenderLngLat(space, traveler);
                const center: [number, number] = [lngLat.lng, lngLat.lat];
                const zoom = map.getZoom();
                const corners = travelerCorners(center, traveler.heading, zoom, (imageSize * travelerScale(zoom)) / 2);
                const canvas = map.getCanvas();
                // Auf einem Flug flach in der Höhe der Bahn, sonst auf dem Boden wie bisher.
                const flight = flightHeight?.(traveler);
                const place = (point: [number, number]): { x: number; y: number } | undefined => {
                    if (!flight) return map.project(point);
                    const at = MercatorCoordinate.fromLngLat({ lng: point[0], lat: point[1] });
                    return projectToScreen(
                        args.defaultProjectionData.mainMatrix,
                        { x: at.x, y: at.y, z: flight.z },
                        canvas.clientWidth,
                        canvas.clientHeight,
                    );
                };
                const screen = corners.map(place);
                const anchor = place(center);
                if (!anchor) return;
                const boden = flight ? map.project(center) : undefined;
                drawn = {
                    x: anchor.x,
                    y: anchor.y,
                    heading: traveler.heading,
                    ...(boden ? { ground: { x: boden.x, y: boden.y } } : {}),
                };

                const ratio = canvas.clientWidth > 0 ? gl2.drawingBufferWidth / canvas.clientWidth : 1;
                const vertices = new Float32Array(TRIANGLES.length * 4);
                TRIANGLES.forEach((corner, index) => {
                    const at = screen[corner];
                    const uv = UV[corner];
                    if (!at || !uv) return;
                    vertices.set([at.x * ratio, at.y * ratio, uv[0], uv[1]], index * 4);
                });

                gl2.useProgram(linked);
                gl2.bindVertexArray(vao);
                gl2.bindBuffer(gl2.ARRAY_BUFFER, buffer);
                gl2.bufferData(gl2.ARRAY_BUFFER, vertices, gl2.DYNAMIC_DRAW);
                gl2.uniform2f(
                    gl2.getUniformLocation(linked, "u_viewport"),
                    gl2.drawingBufferWidth,
                    gl2.drawingBufferHeight,
                );
                gl2.activeTexture(gl2.TEXTURE0);
                gl2.bindTexture(gl2.TEXTURE_2D, texture);
                gl2.uniform1i(gl2.getUniformLocation(linked, "u_image"), 0);
                gl2.enable(gl2.BLEND);
                gl2.blendFunc(gl2.ONE, gl2.ONE_MINUS_SRC_ALPHA);
                gl2.disable(gl2.DEPTH_TEST);
                gl2.drawArrays(gl2.TRIANGLES, 0, TRIANGLES.length);
                gl2.bindVertexArray(null);
                gl2.bindTexture(gl2.TEXTURE_2D, null);
            },
        };
    };

    /** Ganz oben: über allem, was der Stil mitbringt, auch nach einem Stilwechsel. */
    const reconcile = (): void => {
        if (!map.getLayer(ROUTE_TRAVELER_LAYER_ID)) {
            map.addLayer(layer());
            return;
        }
        const order = map.getLayersOrder();
        if (order[order.length - 1] !== ROUTE_TRAVELER_LAYER_ID) map.moveLayer(ROUTE_TRAVELER_LAYER_ID);
    };
    // Nur, wenn der Stil Ebenen annimmt (`style-ready.ts`): sonst wirft `addLayer` in den Aufrufer, der `styledata` auslöste.
    const stopReconcile = onStyleData(map, reconcile);

    return {
        drawn: () => drawn,
        remove: () => {
            stopReconcile();
            if (map.getLayer(ROUTE_TRAVELER_LAYER_ID)) map.removeLayer(ROUTE_TRAVELER_LAYER_ID);
        },
    };
}
