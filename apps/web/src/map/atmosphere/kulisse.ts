import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { AUF_WELT, mal, umkehrung } from "../wetter/wetter-kamera";
import { dunstLage } from "./dunst-tiefe";
import { KULISSE_FS, KULISSE_VS } from "./kulisse-shader";
import { KM_JE_EINHEIT, KULISSEN_VORGABE, nebelDeckkraft, type KulissenWerte } from "./kulisse-werte";

/**
 * Die Kulisse der geneigten Karte (WI-0290): Himmel, eine weite Fläche bis zum Horizont und Dunst. Zwei MapLibre-Ebenen: die Kulisse
 * ganz unten im Stapel (die Karte zeichnet darüber, man sieht sie nur, wo keine Karte ist) und die Randblende über dem Gelände.
 *
 * Löst die Dunstebene aus CSS ab (WI-0016): Sie legte den Dunstton deckend auf die ferne Kartenkante und malte dahinter einen Verlauf,
 * der weder Himmel noch Boden war (Betreiber 2026-11-08: „blaugrauer Balken“). Jetzt hat jeder Bildpunkt seinen Strahl: nach oben
 * Himmel, nach unten die Fläche auf Höhe 0, beides mit demselben Dunst wie das Gelände.
 *
 * 🪤 Den Dunst auf dem Gelände rechnet MapLibre (`fog` im Stil, `atmosphere.ts`). Seine Deckkraft kommt aus einer festen Kurve der
 * Neigung (`Sky.calculateFogBlendOpacity`: unter 60° keiner, ab 70° voll). Die Kulisse ersetzt sie am Himmel der Karte durch
 * `nebelDeckkraft`, damit der Dunst wie bei Google Maps mit dem Neigen kommt; nach jedem Stilwechsel neu, weil der Himmel dann neu
 * entstehen kann. Nah, fern und Deckkraft kommen aus `dunstLage` (`dunst-tiefe.ts`); Wolken und Wetter-Icons lesen dieselbe (WI-0288). Fehlt die Methode einmal (neue MapLibre-Fassung), bleibt MapLibres Kurve: kein Fehler, nur später Dunst.
 */

export const KULISSE_EBENE_ID = "himmel-kulisse";
/** Die Randblende: über dem Gelände und dem Wasser, unter dem Wetter und den Namen. */
export const RAND_EBENE_ID = "himmel-rand";
const WETTER_EBENE_ID = "wetter-probe";

export const farbe = (hex: string): [number, number, number] => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

interface Gl {
    programm: WebGLProgram;
    vao: WebGLVertexArrayObject;
    orte: Map<string, WebGLUniformLocation | null>;
}

function baueProgramm(gl: WebGL2RenderingContext): WebGLProgram {
    const teil = (art: number, text: string): WebGLShader => {
        const s = gl.createShader(art)!;
        gl.shaderSource(s, text);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
            throw new Error(`Kulisse: ${gl.getShaderInfoLog(s) ?? "Shader"}`);
        return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, teil(gl.VERTEX_SHADER, KULISSE_VS));
    gl.attachShader(p, teil(gl.FRAGMENT_SHADER, KULISSE_FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
        throw new Error(`Kulisse: ${gl.getProgramInfoLog(p) ?? "Programm"}`);
    return p;
}

interface MitHimmel {
    style?: { _loaded?: boolean; sky?: { calculateFogBlendOpacity?: (neigung: number) => number } };
    /** MapLibres Texturstapel des Geländes (privat): `_stacks` wächst im Bild mit jedem Stapel, den es auf das Gelände legt. */
    painter?: { renderToTexture?: { _stacks?: unknown[] } };
}

export interface Kulisse {
    /** Andere Werte (im Entwicklungsbuild über `avesmapsHimmel`); `beiAenderung` gibt sie an MapLibres Nebel weiter. */
    setze(werte: Partial<KulissenWerte>): void;
    werte(): KulissenWerte;
    ab(): void;
}

/** Hängt Kulisse und Randblende ein, auch nach jedem Stilwechsel, und setzt MapLibres Kurve des Dunsts. */
export function installiereKulisse(map: MapLibreMap, beiAenderung: (werte: KulissenWerte) => void): Kulisse {
    let werte: KulissenWerte = { ...KULISSEN_VORGABE };
    let teile: Gl | undefined;
    let fehler = false;
    /**
     * 🪤 MapLibre zeichnet das Gelände je Texturstapel neu (`RenderToTexture.renderLayer` → `drawTerrain`) und legt jedes Mal den Nebel darüber,
     * auch über die durchsichtigen Stellen eines späteren Stapels. Liegen Ebenen der Karte zwischen eigenen Ebenen oder über den Namen (im Editor:
     * drei Stapel), deckt der Dunst doppelt und dreifach, die Ferne wird milchig und die Namen darunter mit (Betreiber 2026-11-09 unter /edit:
     * „milchig“; unter „/“ ein Stapel, klar). Darum trägt nur der erste Stapel, die Karte selbst, den Nebel.
     */
    const kurve = (neigung: number): number => {
        const stapel = (map as unknown as MitHimmel).painter?.renderToTexture?._stacks?.length ?? 0;
        return stapel > 1 ? 0 : nebelDeckkraft(werte, neigung);
    };

    const ort = (gl: WebGL2RenderingContext, t: Gl, name: string): WebGLUniformLocation | null => {
        if (!t.orte.has(name)) t.orte.set(name, gl.getUniformLocation(t.programm, name));
        return t.orte.get(name) ?? null;
    };

    const zeichne = (
        glBasis: WebGL2RenderingContext | WebGLRenderingContext,
        args: CustomRenderMethodInput,
        rand: number,
    ): void => {
        const gl = glBasis as WebGL2RenderingContext;
        const neigung = map.getPitch();
        if (fehler || neigung < 1) return;
        if (!teile) {
            try {
                teile = { programm: baueProgramm(gl), vao: gl.createVertexArray()!, orte: new Map() };
            } catch (e) {
                fehler = true;
                console.error(e);
                return;
            }
        }
        const t = teile;
        const vp = mal(args.defaultProjectionData.mainMatrix, AUF_WELT);
        const inv = umkehrung(vp);
        if (!inv) return;
        const auge = [inv[8]! / inv[11]!, inv[9]! / inv[11]!, inv[10]! / inv[11]!] as const;
        const hoehe = map.getCanvas().clientHeight;
        const lage = dunstLage({ vp, inv, sichtfeld: args.fov, fern: args.farZ, hoehe, neigung }, werte);
        if (!lage) return;

        gl.useProgram(t.programm);
        gl.uniformMatrix4fv(ort(gl, t, "uInvVP"), false, Float32Array.from(inv));
        gl.uniform4f(ort(gl, t, "uTiefe"), ...lage.zeile);
        gl.uniform3f(ort(gl, t, "uAuge"), auge[0], auge[1], auge[2]);
        gl.uniform3fv(ort(gl, t, "uDunst"), farbe(werte.dunst));
        gl.uniform3fv(ort(gl, t, "uZenit"), farbe(werte.zenit));
        gl.uniform3fv(ort(gl, t, "uMeer"), farbe(werte.meer));
        gl.uniform1f(ort(gl, t, "uVerlauf"), Math.sin((Math.max(werte.verlauf, 0.5) * Math.PI) / 180));
        gl.uniform4f(ort(gl, t, "uNebel"), lage.nah, lage.fern, lage.beginn, lage.deckkraft);
        gl.uniform1f(ort(gl, t, "uRand"), rand);
        gl.disable(gl.DEPTH_TEST);
        gl.depthMask(false);
        gl.disable(gl.STENCIL_TEST);
        if (rand > 0) {
            gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        } else gl.disable(gl.BLEND);
        gl.bindVertexArray(t.vao);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.bindVertexArray(null);
    };

    const ebene: CustomLayerInterface = {
        id: KULISSE_EBENE_ID,
        type: "custom",
        renderingMode: "2d",
        render: (gl, args) => zeichne(gl, args, 0),
    };
    const randEbene: CustomLayerInterface = {
        id: RAND_EBENE_ID,
        type: "custom",
        renderingMode: "2d",
        render: (gl, args) => {
            if (werte.rand > 0) zeichne(gl, args, werte.rand / KM_JE_EINHEIT);
        },
    };

    // Die Kulisse ganz unten; die Blende direkt unter dem Wetter, sonst unter dem ersten Namen, und über dem Wasser, das sich ebenfalls
    // dort einhängt (`map/wasser/`), damit sie auch dessen Spiegelung am Rand mitnimmt.
    const einhaengen = (): void => {
        const stil = (map as unknown as MitHimmel).style;
        if (stil?._loaded !== true) return;
        if (
            stil.sky &&
            typeof stil.sky.calculateFogBlendOpacity === "function" &&
            stil.sky.calculateFogBlendOpacity !== kurve
        )
            stil.sky.calculateFogBlendOpacity = kurve;
        const reihe = map.getLayersOrder();
        if (map.getLayer(KULISSE_EBENE_ID) === undefined) map.addLayer(ebene, reihe[0]);
        else if (reihe[0] !== KULISSE_EBENE_ID) map.moveLayer(KULISSE_EBENE_ID, reihe[0]);
        const jetzt = map.getLayersOrder();
        const anker = map.getLayer(WETTER_EBENE_ID) ? WETTER_EBENE_ID : ersteSymbolEbene(map);
        const davor = anker === undefined ? jetzt[jetzt.length - 1] : jetzt[jetzt.indexOf(anker) - 1];
        if (map.getLayer(RAND_EBENE_ID) === undefined) map.addLayer(randEbene, anker);
        else if (davor !== RAND_EBENE_ID) map.moveLayer(RAND_EBENE_ID, anker);
    };
    map.on("styledata", einhaengen);
    einhaengen();
    map.triggerRepaint();

    return {
        setze(neu: Partial<KulissenWerte>): void {
            werte = { ...werte, ...neu };
            beiAenderung(werte);
            einhaengen();
            map.triggerRepaint();
        },
        werte: () => ({ ...werte }),
        ab(): void {
            map.off("styledata", einhaengen);
            const stil = (map as unknown as MitHimmel).style;
            if (stil?.sky?.calculateFogBlendOpacity === kurve) delete stil.sky.calculateFogBlendOpacity;
            if (map.getLayer(KULISSE_EBENE_ID) !== undefined) map.removeLayer(KULISSE_EBENE_ID);
            if (map.getLayer(RAND_EBENE_ID) !== undefined) map.removeLayer(RAND_EBENE_ID);
        },
    };
}

function ersteSymbolEbene(map: MapLibreMap): string | undefined {
    for (const id of map.getLayersOrder()) if (map.getLayer(id)?.type === "symbol") return id;
    return undefined;
}
