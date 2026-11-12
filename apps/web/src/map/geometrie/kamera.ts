import type { Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import type { Camera } from "../camera/camera";
import { targetInsets } from "../camera/visible-area";
import type { Pixel, Punkt, Teil } from "./geometrie";

/**
 * Ein Objekt des Modus in die freie Fläche holen (Hausregel „Kamera fliegt immer“), für jeden Formmodus gleich: Weg, Fläche, Gebiet,
 * Kraftlinie (Betreiber 2026-10-19, wörtlich „formmodus A“; vorher nur die Wegkurve, Betreiber 2026-10-17: „beim doppelklick auf ein
 * wegsegment zoomt die ansicht plötzlich zurück -> soll sie nicht“):
 * - Die Kamera bleibt stehen, solange ein Teil des Objekts in der freien Fläche zu sehen ist (Kartenrand abzüglich dessen, was Panels,
 *   Fenster und die Bedienelemente mit `data-ziel-deckung` decken, `targetInsets`; WI-0218 §5, §10). Gemessen wird an der Form, nicht an
 *   den Ecken (`trifftFlaeche`): eine Ecke, eine Kante oder bei einer Fläche ihr Inneres. Vorher zählten nur die Ecken, und eine große
 *   Fläche, die das Bild ganz deckte, galt als „nicht zu sehen“: Vorderkosch beim Vereinfachen von 6,35 auf 5,35 (Kraftlinien-Sitzung auf
 *   der Stage). Davor passte die Kamera bei Fläche, Gebiet und Kraftlinie das ganze Objekt ein, sobald EIN Punkt draußen lag: beim
 *   Vorgebirge des Kosch bei 1280 × 800 von Zoom 6,5 auf 4,3, bei 800 px bis Stufe 1 (Fund der Hauptorchestrierung auf der Stage).
 * - Liegt nichts frei, fliegt sie hin wie die Suche (`maxZoom`), aber höchstens eine Stufe hinaus (`minZoom`, gemessen am Zoom beim Start
 *   des Modus, auch beim zweiten Einpassen nach dem Einzug der Liste). Passt das Objekt darüber nicht ganz hinein, rückt nur seine Mitte
 *   in die freie Fläche.
 */
const space = AVENTURIA.coordinateSpace;

/** Was die Kamera von einem Objekt braucht: seine Teile, offen (Weg, Kraftlinie), geschlossen (Fläche, Gebiet, Loch) oder ein Punkt. */
export type Umriss = Pick<Teil, "art" | "punkte">;

/** Ein Rechteck in Bildpunkten der Karte. */
export interface Rechteck {
    readonly links: number;
    readonly oben: number;
    readonly rechts: number;
    readonly unten: number;
}

const imRechteck = (r: Rechteck, p: Pixel): boolean =>
    p.x >= r.links && p.x <= r.rechts && p.y >= r.oben && p.y <= r.unten;

/** Berührt die Strecke a-b das Rechteck (Liang-Barsky)? */
function schneidet(r: Rechteck, a: Pixel, b: Pixel): boolean {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    let t0 = 0;
    let t1 = 1;
    for (const [p, q] of [
        [-dx, a.x - r.links],
        [dx, r.rechts - a.x],
        [-dy, a.y - r.oben],
        [dy, r.unten - a.y],
    ] as const) {
        if (p === 0) {
            if (q < 0) return false;
            continue;
        }
        const t = q / p;
        if (p < 0) {
            if (t > t1) return false;
            t0 = Math.max(t0, t);
        } else {
            if (t < t0) return false;
            t1 = Math.min(t1, t);
        }
    }
    return true;
}

/**
 * Ist von den Teilen (in Bildpunkten) etwas im Rechteck zu sehen? Eine Ecke darin, eine Kante hindurch, oder das Rechteck liegt im Inneren
 * der Fläche. Berührt keine Kante das Rechteck, liegt es ganz drinnen oder ganz draußen; dann entscheidet seine Mitte, gezählt über alle
 * Ringe des Objekts (gerade/ungerade): So deckt ein Loch, was es ausspart.
 */
export function trifftFlaeche(
    frei: Rechteck,
    teile: readonly { readonly art: Teil["art"]; readonly punkte: readonly Pixel[] }[],
): boolean {
    const mitte = { x: (frei.links + frei.rechts) / 2, y: (frei.oben + frei.unten) / 2 };
    let innen = false;
    for (const teil of teile) {
        const p = teil.punkte;
        const ring = teil.art === "ring" && p.length >= 3;
        for (let i = 0; i < p.length; i += 1) {
            const a = p[i]!;
            if (imRechteck(frei, a)) return true;
            const b = i + 1 < p.length ? p[i + 1] : ring ? p[0] : undefined;
            if (b === undefined || teil.art === "punkt") continue;
            if (schneidet(frei, a, b)) return true;
            if (
                ring &&
                a.y > mitte.y !== b.y > mitte.y &&
                mitte.x < a.x + ((mitte.y - a.y) * (b.x - a.x)) / (b.y - a.y)
            )
                innen = !innen;
        }
    }
    return innen;
}

/** Ist ein Teil des Objekts in der freien Fläche zu sehen? Dann bleibt die Kamera stehen. */
export function freiZuSehen(map: MapLibreMap, teile: readonly Umriss[]): boolean {
    const padding = targetInsets(map);
    const leinwand = map.getContainer().getBoundingClientRect();
    const frei: Rechteck = {
        links: padding.left ?? 0,
        oben: padding.top ?? 0,
        rechts: leinwand.width - (padding.right ?? 0),
        unten: leinwand.height - (padding.bottom ?? 0),
    };
    return trifftFlaeche(
        frei,
        teile.map((teil) => ({
            art: teil.art,
            punkte: teil.punkte.map((p) => {
                const render = toRenderLngLat(space, p);
                return map.project([render.lng, render.lat]);
            }),
        })),
    );
}

/**
 * Der Hinflug des laufenden Modus, einmal zu wiederholen, wenn das Fenster seine Liste eingezogen hat (WI-0218 §10). Der Modus passt beim
 * Start ein, und erst danach zieht das angedockte Fenster seine Liste ein (EDIT-0003 Regel 7, `listeImModus`, 220 ms). Bei 1280 px
 * bleibt bis dahin zwischen Planer und Fenster keine Lücke (`leavesGap`), die Kamera zielt auf die Bildmitte, und ein Griff lag unter
 * dem Fenster (Befund der Kraftlinien-Sitzung, 2026-10-18). Nach dem Einzug (`zeigeNachEinzug`, gerufen von `app.vue`) rechnet derselbe
 * Hinflug noch einmal; liegt jetzt alles frei, bleibt die Kamera stehen.
 */
let nachEinzug: (() => void) | undefined;

/** Den gemerkten Hinflug einmal wiederholen (nach dem Einzug der Liste); danach ist er vergessen. */
export function zeigeNachEinzug(): void {
    const wiederhole = nachEinzug;
    nachEinzug = undefined;
    wiederhole?.();
}

/** Den gemerkten Hinflug vergessen (der Modus ist zu Ende). */
export function vergissEinzug(): void {
    nachEinzug = undefined;
}

/** Höchstens so viele Stufen zoomt der Hinflug eines Formmodus hinaus („formmodus A“). */
export const FORMMODUS_HINAUS = 1;

export function zeigeFrei(
    map: MapLibreMap,
    camera: Pick<Camera, "showBounds">,
    teile: readonly Umriss[],
    maxZoom: number,
): void {
    if (teile.every((teil) => teil.punkte.length === 0)) return;
    const minZoom = map.getZoom() - FORMMODUS_HINAUS;
    nachEinzug = () => passeEin(map, camera, teile, maxZoom, minZoom);
    passeEin(map, camera, teile, maxZoom, minZoom);
}

function passeEin(
    map: MapLibreMap,
    camera: Pick<Camera, "showBounds">,
    teile: readonly Umriss[],
    maxZoom: number,
    minZoom: number,
): void {
    if (freiZuSehen(map, teile)) return;
    const ecken = teile.flatMap((teil) => teil.punkte).map((p: Punkt) => toRenderLngLat(space, p));
    const lng = ecken.map((e) => e.lng);
    const lat = ecken.map((e) => e.lat);
    void camera.showBounds(
        [
            [Math.min(...lng), Math.min(...lat)],
            [Math.max(...lng), Math.max(...lat)],
        ],
        { maxZoom, minZoom, free: targetInsets(map) },
    );
}
