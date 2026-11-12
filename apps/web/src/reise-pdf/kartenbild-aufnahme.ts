import { nextTick } from "vue";
import type { Map as MapLibreMap } from "maplibre-gl";
import { FLY_MAX_BAND, renderZoomForBand, type RouteResponse } from "@avesmaps3d/shared";
import { routeRenderBounds } from "../map/route-layers";
import { visibleRect } from "../map/camera/visible-area";
import { dichte, kartenbild, type Kasten } from "../screenshot/kartenbild";
import { ansichtFuer, gleicheAnsicht, type KartenWahl } from "./einstellungen";
import type { ReisePdfKarte } from "./karte-zugang";
import { liegtIn, umriss, zuschnitt } from "./zuschnitt";

/**
 * Das Kartenbild des Deckblatts aufnehmen (WI-0306), wie der Karten-Screenshot (`screenshot/kartenbild.ts`: die Leinwand im `render`-Takt
 * lesen, WI-0274).
 *
 * - **Ganze Route:** Liegt die Route schon ganz in der freien Fläche, wird nur aufgenommen. Sonst passt die Kamera sie ein
 *   (`camera.showBounds`, sie fliegt, springt nie), nimmt auf und fliegt zurück, wo der Betrachter war (`camera.returnTo`).
 * - **Andere Serie oder Ansicht:** Die Karte schaltet vorübergehend um (Ansichtszustand von `app.vue` über `ReisePdfKarte`), wartet, bis sie
 *   fertig gezeichnet ist (`idle`, höchstens `WARTEN_MS`), nimmt auf und stellt den Zustand des Besuchers wieder her - auch wenn die Aufnahme
 *   scheitert. Eine Serie mit Namen im Bild steht dabei unter „Nur Karte“ (`ansichtFuer`).
 * - Die Aufnahme behält die ganze Leinwand; zugeschnitten wird je Feld des Deckblatts (`ausschnittBild`), ein anderes Papier braucht keine
 *   neue Aufnahme.
 * - 🔴 Eine Aufnahme zur Zeit: `nimmAuf` reiht sich hinter die vorige, sonst schaltete die eine zurück, was die andere gerade braucht.
 */

export interface Aufnahme {
    bild: HTMLCanvasElement;
    /** Bildpunkte der Leinwand je CSS-Pixel. */
    faktor: number;
    behaelter: Kasten;
    frei: Kasten;
    /** Der Umriss der Route auf dem Bild, in CSS-Pixeln des Behälters; fehlt bei „Ausschnitt“. */
    route?: Kasten;
}

/** So lange wird höchstens gewartet, bis die Karte nach einem Umschalten oder einem Flug fertig gezeichnet ist. */
const WARTEN_MS = 6000;
/** So lange wartet ein Schritt höchstens auf ein Bild der Karte, bevor er weitergeht. */
const BILD_MS = 100;
/** So lange darf das Lesen der Leinwand dauern; sonst scheitert die Aufnahme, und das Deckblatt nennt die Stationen. */
const LESEN_MS = 15_000;
/** Wie nah das Einpassen fliegt: wie „Route einpassen“ im Planer. */
const FLY_MAX_ZOOM = renderZoomForBand(FLY_MAX_BAND);
/** Die Route liegt „schon ganz da“, wenn sie mit diesem Abstand in der freien Fläche liegt und sie zu einem Viertel füllt. */
const SCHON_DA_RAND = 24;
const SCHON_DA_ANTEIL = 0.25;

/** Ein Bild abwarten; in einem verborgenen Tab ruht `requestAnimationFrame`, dann reicht eine kurze Pause. */
function bild(): Promise<void> {
    return new Promise((fertig) => {
        const uhr = setTimeout(fertig, BILD_MS);
        requestAnimationFrame(() => {
            clearTimeout(uhr);
            fertig();
        });
    });
}

/** Wirft nach `ms`: Eine Karte, die nicht zeichnet (der Tab ist verborgen), hält die Aufnahme nicht ewig an. */
function mitFrist<T>(arbeit: Promise<T>, ms: number): Promise<T> {
    return new Promise((fertig, fehler) => {
        const uhr = setTimeout(() => fehler(new Error("Die Karte zeichnet nicht")), ms);
        arbeit.then(
            (wert) => {
                clearTimeout(uhr);
                fertig(wert);
            },
            (grund: unknown) => {
                clearTimeout(uhr);
                fehler(grund instanceof Error ? grund : new Error(String(grund)));
            },
        );
    });
}

/** Wartet, bis die Karte steht und alles geladen hat, höchstens `WARTEN_MS`. */
async function gezeichnet(map: MapLibreMap): Promise<void> {
    await nextTick();
    await bild();
    await bild();
    if (map.loaded() && map.areTilesLoaded() && !map.isMoving()) return;
    await new Promise<void>((fertig) => {
        const uhr = setTimeout(fertig, WARTEN_MS);
        map.once("idle", () => {
            clearTimeout(uhr);
            fertig();
        });
    });
}

function freieFlaeche(map: MapLibreMap, zugang: ReisePdfKarte): { behaelter: Kasten; frei: Kasten } {
    const behaelter = map.getContainer();
    const groesse = { width: behaelter.clientWidth, height: behaelter.clientHeight };
    const frei = visibleRect(groesse, zugang.kamera()?.insets() ?? {});
    return {
        behaelter: { x: 0, y: 0, w: groesse.width, h: groesse.height },
        frei: { x: frei.left, y: frei.top, w: frei.width, h: frei.height },
    };
}

function routeAufDemBild(map: MapLibreMap, grenzen: [[number, number], [number, number]]): Kasten | undefined {
    const [[w, s], [o, n]] = grenzen;
    return umriss(
        [
            [w, s],
            [w, n],
            [o, s],
            [o, n],
        ].map(([lng, lat]) => map.project([lng!, lat!])),
    );
}

let reihe: Promise<unknown> = Promise.resolve();

/** Nimmt das Kartenbild für `modus` und `wahl` auf und stellt danach Kamera und Ansicht wieder her. */
export function nimmAuf(
    zugang: ReisePdfKarte,
    route: RouteResponse,
    modus: "route" | "ausschnitt",
    wahl: KartenWahl,
): Promise<Aufnahme> {
    const lauf = reihe.then(() => aufnehmen(zugang, route, modus, wahl));
    reihe = lauf.catch(() => undefined);
    return lauf;
}

async function aufnehmen(
    zugang: ReisePdfKarte,
    route: RouteResponse,
    modus: "route" | "ausschnitt",
    wahl: KartenWahl,
): Promise<Aufnahme> {
    const map = zugang.karte();
    const kamera = zugang.kamera();
    if (map === undefined || kamera === undefined) throw new Error("keine Karte");
    const vorher = zugang.ansicht();
    const ziel = ansichtFuer(wahl, vorher, zugang.serien(), zugang.vorgabeSerie());
    const umgeschaltet = !gleicheAnsicht(ziel, vorher);
    const blickVorher = kamera.view();
    let geflogen = false;
    try {
        if (umgeschaltet) {
            zugang.setzeAnsicht(ziel);
            await gezeichnet(map);
        }
        const grenzen = modus === "route" ? routeRenderBounds(route) : undefined;
        if (grenzen !== undefined) {
            const { frei } = freieFlaeche(map, zugang);
            const jetzt = routeAufDemBild(map, grenzen);
            const schonDa =
                jetzt !== undefined &&
                liegtIn(jetzt, frei, SCHON_DA_RAND) &&
                Math.max(jetzt.w / frei.w, jetzt.h / frei.h) >= SCHON_DA_ANTEIL;
            if (!schonDa) {
                geflogen = true;
                await mitFrist(kamera.showBounds(grenzen, { maxZoom: FLY_MAX_ZOOM }), LESEN_MS);
                await gezeichnet(map);
            }
        }
        const leinwand = await mitFrist(kartenbild(map), LESEN_MS);
        const { behaelter, frei } = freieFlaeche(map, zugang);
        const umrissRoute = grenzen === undefined ? undefined : routeAufDemBild(map, grenzen);
        return {
            bild: leinwand,
            faktor: dichte(map),
            behaelter,
            frei,
            ...(umrissRoute === undefined ? {} : { route: umrissRoute }),
        };
    } finally {
        if (umgeschaltet) zugang.setzeAnsicht(vorher);
        // Der Rückflug darf die Reihe nicht anhalten, auch wenn die Karte gerade nicht zeichnet.
        if (geflogen) await mitFrist(kamera.returnTo(blickVorher), LESEN_MS).catch(() => undefined);
    }
}

/** Das Feld aus der Aufnahme im Verhältnis `r`, höchstens `laengste` Bildpunkte an der langen Seite, als JPEG (data-URL). */
export function ausschnittBild(aufnahme: Aufnahme, modus: "route" | "ausschnitt", r: number, laengste = 1800): string {
    const feld = zuschnitt(modus, r, aufnahme.behaelter, aufnahme.frei, aufnahme.route);
    const quelleW = feld.w * aufnahme.faktor;
    const quelleH = feld.h * aufnahme.faktor;
    const mass = Math.min(1, laengste / Math.max(quelleW, quelleH));
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.max(1, Math.round(quelleW * mass));
    leinwand.height = Math.max(1, Math.round(quelleH * mass));
    const ctx = leinwand.getContext("2d");
    if (ctx === null) throw new Error("keine Leinwand");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
        aufnahme.bild,
        feld.x * aufnahme.faktor,
        feld.y * aufnahme.faktor,
        quelleW,
        quelleH,
        0,
        0,
        leinwand.width,
        leinwand.height,
    );
    return leinwand.toDataURL("image/jpeg", 0.86);
}
