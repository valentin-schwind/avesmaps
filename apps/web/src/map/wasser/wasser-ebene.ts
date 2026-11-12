import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { DESIGN_CANON, wetterDatenVorgaben, wetterJahreswerte, type WetterDaten } from "@avesmaps3d/shared";
import { startansicht } from "../start-view";
import { ladeWetterDaten } from "../wetter/wetter-daten";
import { AUF_WELT, mal, umkehrung } from "../wetter/wetter-kamera";
import { leseMvtEbene } from "../wetter/wetter-mvt";
import { WASSER_RAUSCHEN_GROESSE, wasserRauschen } from "./wasser-rauschen";
import { WASSER_FS, WASSER_VS } from "./wasser-shader";

/**
 * Das Wasser in 3D (WI-0288 Stufe 5): Meer und Seen bewegen sich, spiegeln den Himmel und glitzern in der Sonne. Eine eigene MapLibre-Ebene,
 * nachgeladen von `wasser-schalter.ts`, ohne die Rechnung des Wetters.
 *
 * - **Flächen:** Meer und Seen aus derselben Quelle, aus der die Karte sie zeichnet (`terrain_water_tile`, Ebene `terrain_water_render`),
 *   nur lesend, Zoom 1. Sie werden einmal in eine Maske gemalt (2048², Rot das Meer, Grün die Seen); die Kante ist die halbe Deckung, mit
 *   Bildpunktbreite geglättet.
 * - **Höhe:** das Meer auf 0, jeder See auf der Höhe, die das Gelände in ihm hat (das kleinste Höhenmodell unter ihm, Zoom 1, mit dem
 *   Breitenausgleich wie `ladeHoehen` der Engine). Das Höhenmodell ist in den Seen flach: 2026-11-08 an 667 Seen geprüft, Mittel und
 *   kleinster Wert liegen beisammen, nur am Ufer steigt es. Gezeichnet wird je See ein Rechteck auf seiner Höhe, fürs Meer eins über die
 *   Karte; das Gelände verdeckt sie, wo es höher liegt (Tiefentest von MapLibre), die Maske schneidet den Rest.
 * - **Stapel:** Die Ebene liegt direkt unter dem Wetter, sonst unter der ersten Symbolebene, also neben den übrigen eigenen Ebenen. Dazwischen
 *   gelegt, zerschnitte sie den Texturstapel des Geländes (`route-pills.ts`), und jede Geländekachel hielte einen Satz Zwischenbilder mehr.
 *   Darum liegt sie über den Linien der Karte; sie deckt nur wenig (Spiegelung nach Fresnel, gedeckelt), damit Seewege lesbar bleiben.
 * - **Kosten:** ein Pass über die Wasserflächen, Wellen nur so fein, wie Bildpunkte sie zeigen. Bewegt wird mit höchstens `TAKT_HZ[0]`
 *   Bildern je Sekunde; die Automatik senkt Takt und Wellenzahl, wenn die Karte die Bilder nicht schafft, und hält das Wasser zuletzt an.
 *   Stehend zeichnet es nur, wenn die Karte ohnehin zeichnet.
 * - **Glanz:** Stärke und Größe des Glanzpunkts aus den Standardwerten, Panel „OceanShader an/aus“ (`ozeanGlanz`, `ozeanGlanzpunkt`;
 *   Betreiber 2026-11-08), gelesen beim Öffnen der Karte. Die Größe teilt den Glanzexponenten durch ihr Quadrat: doppelt so groß heißt
 *   doppelter Winkel des Flecks. **Sonne** aus dem Wettermodell (`sunAz`) und dem Preset am Datum (`sunEl`, `sunPower`).
 */

export const WASSER_EBENE_ID = "wasser-3d";
const WETTER_EBENE_ID = "wetter-probe";
const MASKE = 2048;
const WASSER_KACHEL_ZOOM = 1;
/** Die Stufen der Automatik: Takt der Bewegung (0 steht) und Zahl der Wellenzüge. */
export const WASSER_STUFEN: readonly { readonly hz: number; readonly wellen: number }[] = [
    { hz: 30, wellen: 14 },
    { hz: 20, wellen: 10 },
    { hz: 12, wellen: 7 },
    { hz: 0, wellen: 7 },
];
/** Zu langsam heißt: Die Bilder kommen im Median um die Hälfte später als bestellt, zwei Fenster zu je 30 Bildern hintereinander. */
const ZU_LANGSAM = 1.5;
/** So lange bleibt eine gesenkte Stufe, bevor die Automatik eine höhere versucht; jeder Rückfall verdoppelt es. */
const HOCH_WARTEN_MS = 20_000;

export interface WasserStand {
    bereit: boolean;
    fehler: string | null;
    stufe: number;
    hz: number;
    wellen: number;
    staerke: number;
    seen: number;
    bilder: number;
    zeit: number;
}

export interface WasserEbene {
    ein(): void;
    aus(): void;
    /** Glanz und Sonne neu aus dem Leseweg (das Wettermodell wurde gespeichert). */
    neuLesen(): Promise<void>;
    stand(): WasserStand;
}

type Ring = { x: number; z: number }[];
interface Flaeche {
    meer: boolean;
    ringe: Ring[];
}

/** Meer und Seen der Kartenquelle, in Karteneinheiten (0 bis 1024). */
export async function ladeFlaechen(holen: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<Flaeche[]> {
    const n = 2 ** WASSER_KACHEL_ZOOM;
    const teil = 1024 / n;
    const flaechen: Flaeche[] = [];
    for (let ty = 0; ty < n; ty++)
        for (let tx = 0; tx < n; tx++) {
            const antwort = await holen(`/tiles/vector/terrain_water_tile/${WASSER_KACHEL_ZOOM}/${tx}/${ty}`);
            if (!antwort.ok) throw new Error(`Wasserkachel fehlt: ${antwort.status}`);
            const ebene = leseMvtEbene(new Uint8Array(await antwort.arrayBuffer()), "terrain_water_render");
            if (!ebene) continue;
            for (const objekt of ebene.objekte) {
                const art = objekt.eigenschaften["region_type"];
                if (art !== "meer" && art !== "see") continue;
                flaechen.push({
                    meer: art === "meer",
                    ringe: objekt.ringe.map((ring) =>
                        ring.map((q) => ({ x: (tx + q.x / ebene.extent) * teil, z: (ty + q.y / ebene.extent) * teil })),
                    ),
                });
            }
        }
    return flaechen;
}

/** Liegt der Punkt in den Ringen (gerade-ungerade, Löcher eingeschlossen)? */
export function innen(ringe: readonly Ring[], x: number, z: number): boolean {
    let drin = false;
    for (const ring of ringe)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const a = ring[i]!;
            const b = ring[j]!;
            if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) drin = !drin;
        }
    return drin;
}

/** Ein Höhenfeld in Schritt, `n` Zellen je Seite über die Karte. */
export interface Hoehenfeld {
    n: number;
    hoehe: Float32Array;
}

/** Das Höhenmodell der Karte in Zoom 1 (vier Kacheln, eine Zelle je Karteneinheit), wie `ladeHoehen` der Engine in Schritt. */
async function ladeHoehenfeld(holen: typeof fetch = (...a) => globalThis.fetch(...a)): Promise<Hoehenfeld> {
    const zeiger = (await (await holen("/tiles/terrain/dem/current.json")).json()) as {
        revision: string;
        tileSize: number;
        format: string;
    };
    const n = 2;
    const ts = zeiger.tileSize;
    const S = n * ts;
    const WELT = 40075016.68557849;
    const RMPS = WELT / (1024 * 3000);
    const hoehe = new Float32Array(S * S);
    const leinwand = new OffscreenCanvas(ts, ts);
    const g = leinwand.getContext("2d", { willReadFrequently: true })!;
    for (let ty = 0; ty < n; ty++)
        for (let tx = 0; tx < n; tx++) {
            const antwort = await holen(`/tiles/terrain/dem/${zeiger.revision}/1/${tx}/${ty}.${zeiger.format}`);
            if (!antwort.ok) throw new Error(`Geländekachel fehlt: ${antwort.status}`);
            const bild = await createImageBitmap(await antwort.blob(), {
                premultiplyAlpha: "none",
                colorSpaceConversion: "none",
            });
            g.clearRect(0, 0, ts, ts);
            g.drawImage(bild, 0, 0);
            const d = g.getImageData(0, 0, ts, ts).data;
            for (let y = 0; y < ts; y++) {
                const zeile = ty * ts + y;
                const ch = Math.cosh(Math.PI * (1 - (2 * (zeile + 0.5)) / S));
                for (let x = 0; x < ts; x++) {
                    const o = (y * ts + x) * 4;
                    const meter = -10000 + (d[o]! * 65536 + d[o + 1]! * 256 + d[o + 2]!) * 0.1;
                    hoehe[zeile * S + tx * ts + x] = Math.max(0, (meter * ch) / RMPS);
                }
            }
        }
    return { n: S, hoehe };
}

/**
 * Die Höhe eines Sees in Schritt: der kleinste Wert des Höhenfelds unter ihm (das Gelände ist in Seen flach, am Ufer mischt es höher);
 * trifft keine Zellmitte den See, die Zelle unter seiner Mitte.
 */
export function seeHoehe(ringe: readonly Ring[], feld: Hoehenfeld): number {
    const k = feld.n / 1024;
    const aussen = ringe[0] ?? [];
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const q of aussen) {
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        z0 = Math.min(z0, q.z);
        z1 = Math.max(z1, q.z);
    }
    const zelle = (i: number, j: number): number =>
        feld.hoehe[Math.min(feld.n - 1, Math.max(0, j)) * feld.n + Math.min(feld.n - 1, Math.max(0, i))]!;
    let tiefste = Infinity;
    for (let j = Math.floor(z0 * k); j <= Math.ceil(z1 * k); j++)
        for (let i = Math.floor(x0 * k); i <= Math.ceil(x1 * k); i++)
            if (innen(ringe, (i + 0.5) / k, (j + 0.5) / k)) tiefste = Math.min(tiefste, zelle(i, j));
    if (Number.isFinite(tiefste)) return tiefste;
    return zelle(Math.floor(((x0 + x1) / 2) * k), Math.floor(((z0 + z1) / 2) * k));
}

/**
 * Die Rechtecke: eins übers Meer (Höhe 0), eins je See auf seiner Höhe, eine Einheit größer als der See. Je Ecke x, z, Höhe in Schritt
 * und die Art (0 Meer, 1 See), zwei Dreiecke je Rechteck.
 */
export function wasserRechtecke(flaechen: readonly Flaeche[], feld: Hoehenfeld | undefined): Float32Array {
    const ecken: number[] = [];
    const rechteck = (x0: number, z0: number, x1: number, z1: number, h: number, art: number): void => {
        for (const [x, z] of [
            [x0, z0],
            [x1, z0],
            [x1, z1],
            [x0, z0],
            [x1, z1],
            [x0, z1],
        ] as const)
            ecken.push(x, z, h, art);
    };
    rechteck(0, 0, 1024, 1024, 0, 0);
    for (const f of flaechen) {
        if (f.meer) continue;
        const aussen = f.ringe[0] ?? [];
        if (aussen.length < 3) continue;
        const xs = aussen.map((q) => q.x);
        const zs = aussen.map((q) => q.z);
        const h = feld ? seeHoehe(f.ringe, feld) : 0;
        rechteck(Math.min(...xs) - 1, Math.min(...zs) - 1, Math.max(...xs) + 1, Math.max(...zs) + 1, h, 1);
    }
    return Float32Array.from(ecken);
}

/** Die Maske: Rot das Meer, Grün die Seen, Deckung je Bildpunkt (Kantenglättung der Leinwand). Deckend schwarz, damit nichts vormultipliziert. */
function maleMaske(flaechen: readonly Flaeche[]): OffscreenCanvas {
    const leinwand = new OffscreenCanvas(MASKE, MASKE);
    const g = leinwand.getContext("2d")!;
    g.fillStyle = "#000";
    g.fillRect(0, 0, MASKE, MASKE);
    g.globalCompositeOperation = "lighter";
    const k = MASKE / 1024;
    for (const f of flaechen) {
        g.fillStyle = f.meer ? "#ff0000" : "#00ff00";
        g.beginPath();
        for (const ring of f.ringe) {
            ring.forEach((q, i) => (i === 0 ? g.moveTo(q.x * k, q.z * k) : g.lineTo(q.x * k, q.z * k)));
            g.closePath();
        }
        g.fill("evenodd");
    }
    return leinwand;
}

interface Gl {
    programm: WebGLProgram;
    vao: WebGLVertexArrayObject;
    puffer: WebGLBuffer;
    maske: WebGLTexture | null;
    rauschen: WebGLTexture;
    ecken: number;
    orte: Map<string, WebGLUniformLocation | null>;
}

function baueProgramm(gl: WebGL2RenderingContext): WebGLProgram {
    const shader = (art: number, quelle: string): WebGLShader => {
        const s = gl.createShader(art)!;
        gl.shaderSource(s, quelle);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Wasser-Shader: ${gl.getShaderInfoLog(s)}`);
        return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, WASSER_VS));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, WASSER_FS));
    gl.bindAttribLocation(p, 0, "aEcke");
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Wasser-Programm: ${gl.getProgramInfoLog(p)}`);
    return p;
}

const farbe = (hex: string): [number, number, number] => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** Die Stärke des Wassers beim Kippen: mit dem Wachsen der Gebirge (`terrain.ts`), voll ab gut einem Drittel. */
export const wasserStaerke = (ueberhoehung: number): number => {
    const t = Math.min(1, Math.max(0, ueberhoehung / 0.35));
    return t * t * (3 - 2 * t);
};

export function erzeugeWasserEbene(map: MapLibreMap, datum: () => number | null): WasserEbene {
    let wetter: WetterDaten = wetterDatenVorgaben();
    let ecken: Float32Array | undefined;
    let maske: OffscreenCanvas | undefined;
    let seen = 0;
    let fehler: string | null = null;
    let teile: Gl | undefined;
    let stufe = 0;
    let hochAb = 0;
    let hochWarten = HOCH_WARTEN_MS;
    const abstaende: number[] = [];
    let langsam = 0;
    let letztes = 0;
    let uhr = 0;
    let bilder = 0;
    let geplant: ReturnType<typeof setTimeout> | undefined;
    let staerke = 0;
    let laeuft = false;
    const ruhig = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)");
    let letztesBild = 0;
    let messung:
        { rest: number; summe: number; n: number; offen: WebGLQuery[]; fertig: (ms: number) => void } | undefined;

    // Flächen, Höhen und Wettermodell kommen einmal je Seite; bis dahin zeichnet die Ebene nichts.
    void Promise.all([
        ladeFlaechen(),
        ladeHoehenfeld().catch((e: unknown) => {
            console.warn("Wasser: Höhenmodell nicht geladen, Seen liegen auf Meereshöhe", e);
            return undefined;
        }),
        ladeWetterDaten(),
    ])
        .then(([flaechen, feld, gelesen]) => {
            wetter = gelesen;
            ecken = wasserRechtecke(flaechen, feld);
            maske = maleMaske(flaechen);
            seen = flaechen.filter((f) => !f.meer).length;
            map.triggerRepaint();
        })
        .catch((e: unknown) => {
            fehler = e instanceof Error ? e.message : String(e);
            console.error("Wasser ließ sich nicht laden", e);
        });

    const stillstehen = (): boolean => ruhig?.matches === true || WASSER_STUFEN[stufe]!.hz <= 0;

    /** Die Automatik: Kommen die Bilder viel später als bestellt, eine Stufe tiefer; nach einer Weile wieder eine höher. */
    const automatik = (jetzt: number): void => {
        const takt = WASSER_STUFEN[stufe]!.hz;
        const abstand = jetzt - letztes;
        letztes = jetzt;
        // Bewegt sich die Karte oder lädt sie Kacheln, sagen die Abstände nichts über das Wasser.
        if (takt <= 0 || abstand <= 0 || abstand > 500 || map.isMoving() || !map.areTilesLoaded()) return;
        abstaende.push(abstand);
        if (abstaende.length < 30) return;
        // Der Median, nicht das Mittel: Einzelne lange Bilder (ein Stilwechsel, ein Fenster im Vordergrund) sollen nichts senken.
        const mittel = [...abstaende].sort((a, b) => a - b)[abstaende.length >> 1]!;
        abstaende.length = 0;
        langsam = mittel > (1000 / takt) * ZU_LANGSAM ? langsam + 1 : 0;
        if (langsam >= 2 && stufe < WASSER_STUFEN.length - 1) {
            langsam = 0;
            stufe++;
            hochAb = jetzt + hochWarten;
            hochWarten *= 2;
        } else if (stufe > 0 && jetzt > hochAb && mittel < (1000 / takt) * 1.1) {
            stufe--;
            hochAb = jetzt + hochWarten;
        }
    };
    // Steht das Wasser in der letzten Stufe, misst es nicht mehr; nach der Wartezeit versucht es die vorige.
    const ausDemStand = (jetzt: number): void => {
        if (WASSER_STUFEN[stufe]!.hz <= 0 && stufe > 0 && jetzt > hochAb) {
            stufe--;
            hochAb = jetzt + hochWarten;
            map.triggerRepaint();
        }
    };

    const plane = (jetzt: number): void => {
        if (!laeuft || geplant !== undefined) return;
        if (stillstehen()) {
            if (ruhig?.matches !== true && WASSER_STUFEN[stufe]!.hz <= 0)
                geplant = setTimeout(
                    () => {
                        geplant = undefined;
                        ausDemStand(performance.now());
                    },
                    Math.max(1000, hochAb - jetzt),
                );
            return;
        }
        const warte = Math.max(0, 1000 / WASSER_STUFEN[stufe]!.hz - (performance.now() - jetzt));
        geplant = setTimeout(() => {
            geplant = undefined;
            map.triggerRepaint();
        }, warte);
    };

    const ort = (gl: WebGL2RenderingContext, t: Gl, name: string): WebGLUniformLocation | null => {
        if (!t.orte.has(name)) t.orte.set(name, gl.getUniformLocation(t.programm, name));
        return t.orte.get(name) ?? null;
    };

    const bereite = (gl: WebGL2RenderingContext): Gl | undefined => {
        if (teile && teile.maske) return teile;
        if (!teile) {
            const programm = baueProgramm(gl);
            const vao = gl.createVertexArray()!;
            const puffer = gl.createBuffer()!;
            const r = gl.createTexture()!;
            gl.bindTexture(gl.TEXTURE_2D, r);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RG8,
                WASSER_RAUSCHEN_GROESSE,
                WASSER_RAUSCHEN_GROESSE,
                0,
                gl.RG,
                gl.UNSIGNED_BYTE,
                wasserRauschen(),
            );
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
            gl.generateMipmap(gl.TEXTURE_2D);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
            teile = { programm, vao, puffer, maske: null, rauschen: r, ecken: 0, orte: new Map() };
        }
        if (!ecken || !maske) return undefined;
        gl.bindVertexArray(teile.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, teile.puffer);
        gl.bufferData(gl.ARRAY_BUFFER, ecken, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 16, 0);
        gl.bindVertexArray(null);
        teile.ecken = ecken.length / 4;
        const m = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, m);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, gl.RG, gl.UNSIGNED_BYTE, maske);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        teile.maske = m;
        maske = undefined;
        return teile;
    };

    const himmel = DESIGN_CANON.atmosphere;
    const ebene: CustomLayerInterface = {
        id: WASSER_EBENE_ID,
        type: "custom",
        renderingMode: "3d",
        // Programm, Puffer und Masken bleiben beim Abnehmen liegen (rund 11 MB auf der Grafikkarte): Die Ebene kommt mit jedem Kippen wieder,
        // und die Maske neu zu malen kostete jedes Mal Zehntelsekunden. Der Kontext der Karte lebt so lange wie sie.
        onRemove() {
            if (geplant !== undefined) clearTimeout(geplant);
            geplant = undefined;
        },
        render(glBasis: WebGL2RenderingContext | WebGLRenderingContext, args: CustomRenderMethodInput): void {
            const gl = glBasis as WebGL2RenderingContext;
            const jetzt = performance.now();
            const gelaende = (map as unknown as { terrain?: { exaggeration?: number } | null }).terrain;
            staerke = wasserStaerke(gelaende?.exaggeration ?? 0);
            if (staerke <= 0 || fehler) return;
            let t: Gl | undefined;
            try {
                t = bereite(gl);
            } catch (e) {
                fehler = e instanceof Error ? e.message : String(e);
                console.error(e);
                return;
            }
            if (!t) return;
            const vp = mal(args.defaultProjectionData.mainMatrix, AUF_WELT);
            const inv = umkehrung(vp);
            if (!inv) return;
            const auge = [inv[8]! / inv[11]!, inv[9]! / inv[11]!, inv[10]! / inv[11]!];
            automatik(jetzt);
            if (!stillstehen()) uhr += Math.min(0.1, Math.max(0, (jetzt - (letztesBild || jetzt)) / 1000));
            letztesBild = jetzt;
            const tag = datum();
            const jahr = wetterJahreswerte(wetter.presets, tag);
            const az = ((wetter.modell["sunAz"] ?? 250) * Math.PI) / 180;
            const el = (jahr.sunEl * Math.PI) / 180;
            const sonne = [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
            const licht = Math.max(0, Math.min(1, (jahr.sunEl + 2) / 6)) * (jahr.sunPower / 1.25);
            // Stärke und Punktgröße des Glanzes: Standardwerte, Panel „OceanShader an/aus“ (Betreiber 2026-11-08).
            const { ozeanGlanz: glanz, ozeanGlanzpunkt: punkt } = startansicht();
            const hoehe = map.getCanvas().height || 1;

            gl.useProgram(t.programm);
            gl.uniformMatrix4fv(ort(gl, t, "uVP"), false, Float32Array.from(vp));
            gl.uniform1f(ort(gl, t, "uK"), ((gelaende?.exaggeration ?? 0) * 1) / 3000);
            gl.uniform3f(ort(gl, t, "uAuge"), auge[0]!, auge[1]!, auge[2]!);
            gl.uniform3f(ort(gl, t, "uSonne"), sonne[0]!, sonne[1]!, sonne[2]!);
            gl.uniform3fv(ort(gl, t, "uZenit"), farbe(himmel.sky));
            gl.uniform3fv(ort(gl, t, "uHorizont"), farbe(himmel.skyHorizon));
            gl.uniform1f(ort(gl, t, "uLicht"), licht);
            gl.uniform1f(ort(gl, t, "uZeit"), uhr);
            gl.uniform1f(ort(gl, t, "uGlanz"), glanz);
            gl.uniform1f(ort(gl, t, "uPunkt"), punkt);
            gl.uniform1f(ort(gl, t, "uStaerke"), staerke);
            gl.uniform1f(ort(gl, t, "uPixAng"), (2 * Math.tan(args.fov / 2)) / hoehe);
            gl.uniform1i(ort(gl, t, "uWellen"), WASSER_STUFEN[stufe]!.wellen);
            gl.uniform1i(ort(gl, t, "uMaske"), 0);
            gl.uniform1i(ort(gl, t, "uRauschen"), 1);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, t.maske);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, t.rauschen);
            gl.activeTexture(gl.TEXTURE0);
            // Den Tiefentest gegen das Gelände stellt MapLibre für 3D-Ebenen; das Wasser schreibt keine Tiefe.
            gl.depthMask(false);
            gl.disable(gl.CULL_FACE);
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE, gl.SRC_ALPHA, gl.ZERO, gl.ONE);
            const zeitmesser = messung ? gl.getExtension("EXT_disjoint_timer_query_webgl2") : null;
            let frage: WebGLQuery | null = null;
            // Gefragt wird nur in den bestellten Bildern; danach wartet die Messung, bis die offenen Antworten da sind.
            if (messung && zeitmesser && messung.rest > 0) {
                frage = gl.createQuery();
                if (frage) gl.beginQuery(zeitmesser.TIME_ELAPSED_EXT, frage);
            }
            gl.bindVertexArray(t.vao);
            gl.drawArrays(gl.TRIANGLES, 0, t.ecken);
            gl.bindVertexArray(null);
            if (messung && zeitmesser && frage) {
                gl.endQuery(zeitmesser.TIME_ELAPSED_EXT);
                messung.offen.push(frage);
            }
            if (messung) lies(gl, zeitmesser);
            bilder++;
            plane(jetzt);
        },
    };

    const lies = (
        gl: WebGL2RenderingContext,
        zeitmesser: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null,
    ): void => {
        const m = messung;
        if (!m) return;
        m.rest--;
        if (!zeitmesser) {
            m.fertig(Number.NaN);
            messung = undefined;
            return;
        }
        const gestoert = gl.getParameter(zeitmesser.GPU_DISJOINT_EXT) as boolean;
        m.offen = m.offen.filter((q) => {
            if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return true;
            if (!gestoert) {
                m.summe += (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6;
                m.n++;
            }
            gl.deleteQuery(q);
            return false;
        });
        if (m.rest <= 0 && m.offen.length === 0) {
            messung = undefined;
            m.fertig(m.n > 0 ? m.summe / m.n : Number.NaN);
        } else map.triggerRepaint();
    };

    let ab: (() => void) | undefined;
    const handle = {
        ein(): void {
            if (ab) return;
            laeuft = true;
            ab = () => {
                const stil = (map as unknown as { style?: { _loaded?: boolean } }).style;
                if (stil?._loaded !== true || map.getLayer(WASSER_EBENE_ID) !== undefined) return;
                map.addLayer(ebene, map.getLayer(WETTER_EBENE_ID) ? WETTER_EBENE_ID : ersteSymbolEbene(map));
            };
            map.on("styledata", ab);
            ab();
            map.triggerRepaint();
            if (import.meta.env.DEV) (globalThis as { avesmapsWasser?: unknown }).avesmapsWasser = entwicklung;
        },
        aus(): void {
            laeuft = false;
            if (geplant !== undefined) clearTimeout(geplant);
            geplant = undefined;
            if (ab) map.off("styledata", ab);
            ab = undefined;
            if (map.getLayer(WASSER_EBENE_ID) !== undefined) map.removeLayer(WASSER_EBENE_ID);
            map.triggerRepaint();
        },
        async neuLesen(): Promise<void> {
            const neu = await ladeWetterDaten();
            if (neu.nurVorgaben && !wetter.nurVorgaben) return;
            wetter = neu;
            map.triggerRepaint();
        },
        stand(): WasserStand {
            return {
                bereit: teile?.maske !== null && teile !== undefined,
                fehler,
                stufe,
                hz: ruhig?.matches === true ? 0 : WASSER_STUFEN[stufe]!.hz,
                wellen: WASSER_STUFEN[stufe]!.wellen,
                staerke,
                seen,
                bilder,
                zeit: uhr,
            };
        },
    };
    /** Das Messhandle der Probe (nur im Entwicklungsbuild): Stand, GPU-Zeit des Wassers je Bild, Stufe von Hand. */
    const entwicklung = {
        ...handle,
        gpuZeit: (n = 60): Promise<number> =>
            new Promise<number>((fertig) => {
                messung = { rest: n, summe: 0, n: 0, offen: [], fertig };
                map.triggerRepaint();
            }),
        setzeStufe(s: number): void {
            stufe = Math.max(0, Math.min(WASSER_STUFEN.length - 1, s));
            hochAb = Number.POSITIVE_INFINITY;
            map.triggerRepaint();
        },
    };
    return handle;
}

function ersteSymbolEbene(map: MapLibreMap): string | undefined {
    for (const id of map.getLayersOrder()) if (map.getLayer(id)?.type === "symbol") return id;
    return undefined;
}
