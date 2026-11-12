import { nextTick, watch } from "vue";
import type { GeoJSONSource, GeoJSONSourceSpecification, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    PLACE_ZOOM_FLOOR,
    canonColour,
    fromRenderLngLat,
    renderZoomForBand,
    roundMapCoordinate,
    toRenderLngLat,
    type CommunityLage,
} from "@avesmaps3d/shared";
import { imKartenraum } from "../community/lage-vorschlag";
import { phoneViewport } from "../controls/phone-viewport";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import type { Camera, PointOptions } from "../map/camera/camera";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { nachStilwechsel, styleTakesChanges, whenStyleTakesChanges } from "../map/style-ready";
import { REISEBILD_FENSTER, REISEBILD_STATUS_FENSTER, freiNebenMitte, type Rechteck } from "./fenster-linie";
import type { ReisebildSteuerung } from "./reisebild-besucher";

/**
 * Die Stelle eines Reisebilds auf der Karte (WI-0272 S2b, Aufgabe 12): das gelbe Platzhaltersymbol, solange das Formular „Eigenes Bild hinzufügen“ offen ist (und die Statusseite mit „Auf der Karte
 * zeigen“ ihre Stelle zeigt, bis sie schließt; es ist `steuerung.stelle`), und der Modus
 * „Stelle ändern“ (Probierseite 7.1: gestrichelter Ring im Gelb der Auswahl, dunkle Scheibe, kleines Bildzeichen). Das Symbol wird gezeigt, nie gespeichert; die Stelle gehört dem
 * Formular (`map_mutation = false`).
 *
 * - 🔴 **Der Klick gehört dem Koordinator** (`map/interaction/`, Besitzer `stelle-waehlen`, Rang in `priorities.ts`): Er ist nur angemeldet, solange der Modus läuft; dann bekommt
 *   der nächste Klick auf die Karte, wo auch immer (Fadenkreuz), die Stelle und beendet den Modus. Außerhalb des Kartenraums nimmt er nichts an (der Server lehnte sie ab).
 *   Wie `community/lage-vorschlag.ts` (`lage-zeigen`), nur für ein anderes Fenster.
 * - **Esc beendet den Modus** (Escape-Kaskade, Stufe `action`); das Fenster klappt dann wieder auf, die Stelle bleibt, wie sie war.
 * - **Eine eigene kleine Quelle mit eigener Ebene, nicht anklickbar** (Muster `lage-vorschlag.ts`): kein Ebenenname steht in einer Liste des Koordinators, die Klicks gehen durch. Ein
 *   Stilwechsel nimmt Quelle, Ebene und Bild mit; sie kommen im nächsten Bild wieder (`nachStilwechsel`).
 * - **Der Bildschirmpunkt der Stelle** geht an die Steuerung (`setzeSchirm`), damit die Linie vom Fensterkopf (`fenster-linie.ts`) der Karte folgt.
 * - 🔴 **Die Kamera fliegt, sie springt nie.** Am Telefon liegt das Formular als Blatt unten, und die Kamera fliegt die Stelle in die freie Fläche darüber (Probierseite
 *   `fliegeZurStelle`); am Rechner steht das Fenster in der Mitte, und sie fliegt die Stelle in die Mitte der freien Fläche NEBEN ihm, links, sonst rechts (Entwurf 8, Betreiber 2026-11-01), damit Symbol
 *   und Linie zu sehen sind. Dieselbe Fahrt trägt „Auf der Karte zeigen“ der Statusseite (`verbinde`); Symbol und Linie dazu kommen aus der Steuerung (`gezeigt`).
 */

export const STELLE_QUELLE = "photobox-stelle";
export const STELLE_EBENE = "photobox-stelle";
export const STELLE_BILD = "photobox-stelle-bild";

const space = AVENTURIA.coordinateSpace;

const rechteck = (r: DOMRect): Rechteck => ({ links: r.left, oben: r.top, rechts: r.right, unten: r.bottom });

const punkt = (lage: CommunityLage): [number, number] => {
    const render = toRenderLngLat(space, lage);
    return [render.lng, render.lat];
};

export interface StelleDaten {
    readonly type: "FeatureCollection";
    readonly features: readonly {
        readonly type: "Feature";
        readonly properties: Record<string, never>;
        readonly geometry: { readonly type: "Point"; readonly coordinates: [number, number] };
    }[];
}

/** Die Merkmale der Quelle: ein Punkt an der Stelle, ohne Stelle nichts. */
export function stelleDaten(lage: CommunityLage | undefined): StelleDaten {
    if (lage === undefined) return { type: "FeatureCollection", features: [] };
    return {
        type: "FeatureCollection",
        features: [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: punkt(lage) } }],
    };
}

/** Die Ebene: das Symbol, immer sichtbar (kein Zusammenfallen, keine Kollision mit Ortsmarken: Es ist eine Stelle, die gerade gewählt wird). */
export function stelleEbenen(): LayerSpecification[] {
    return [
        {
            id: STELLE_EBENE,
            type: "symbol",
            source: STELLE_QUELLE,
            layout: {
                "icon-image": STELLE_BILD,
                "icon-anchor": "center",
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-pitch-alignment": "viewport",
                "icon-rotation-alignment": "viewport",
            },
        },
    ];
}

/** Der Durchmesser des Symbols in Bildpunkten (nach Dichte 1); der Ring misst `SYMBOL_RADIUS` der Linie, 17 px. */
const BILD_KANTE = 36;

/**
 * Das Bildzeichen (Rahmen, Berg, Sonne) mittig um (`mitteX`, `mitteY`) in `kante` Einheiten, in `farbe`. Die Zeichnung ist die der Probierseite (`BILDZEICHEN`, 20 × 20) und gehört EINMAL hierher: Das
 * Platzhaltersymbol der Stelle (16 px) und die Zeichen der Reisebilder auf der Karte (`reisebilder-zeichen.ts`: 17 px in der Scheibe, 13 px in der Fahne) zeichnen sie mit dieser Funktion, keine zweite
 * Fassung. Der Zustand der Leinwand bleibt, wie er war (`save`/`restore`).
 */
export function zeichneBildzeichen(
    kontext: CanvasRenderingContext2D,
    mitteX: number,
    mitteY: number,
    kante: number,
    farbe: string,
): void {
    kontext.save();
    kontext.setLineDash([]);
    kontext.translate(mitteX - kante / 2, mitteY - kante / 2);
    kontext.scale(kante / 20, kante / 20);
    kontext.strokeStyle = farbe;
    kontext.fillStyle = farbe;
    kontext.lineWidth = 1.6;
    kontext.lineJoin = "round";
    kontext.beginPath();
    kontext.roundRect(2.2, 3.6, 15.6, 12.8, 1.6);
    kontext.stroke();
    kontext.stroke(new Path2D("M2.6 14.8 7.4 9.6l3.2 3.3 2.2-2.2 4.6 4.3"));
    kontext.beginPath();
    kontext.arc(13.6, 7.4, 1.4, 0, Math.PI * 2);
    kontext.fill();
    kontext.restore();
}

/**
 * Das Bild des Symbols: eine dunkle Scheibe, ein gestrichelter Ring im Gelb der Auswahl (`mapSelection`, gestrichelt heißt „noch nicht öffentlich“) und das Bildzeichen darin.
 * Die Zeichnung steht hier, weil MapLibre keine Formen kennt (`map/runtime-images.ts`); `pixelRatio` 2 wie die übrigen Laufzeitbilder.
 */
export function zeichneStelleBild(pixelRatio = 2): ImageData {
    const kante = BILD_KANTE * pixelRatio;
    const leinwand = document.createElement("canvas");
    leinwand.width = kante;
    leinwand.height = kante;
    const kontext = leinwand.getContext("2d");
    if (kontext === null) throw new Error("Keine 2D-Fläche für das Symbol der Stelle");
    const gelb = canonColour("mapSelection");
    kontext.scale(pixelRatio, pixelRatio);
    const mitte = BILD_KANTE / 2;
    kontext.fillStyle = "rgba(0, 0, 0, 0.35)";
    kontext.beginPath();
    kontext.arc(mitte, mitte, 15, 0, Math.PI * 2);
    kontext.fill();
    kontext.strokeStyle = gelb;
    kontext.lineWidth = 2;
    kontext.setLineDash([4, 3]);
    kontext.beginPath();
    kontext.arc(mitte, mitte, 15, 0, Math.PI * 2);
    kontext.stroke();
    // Das Bildzeichen in 16 × 16 px mittig.
    zeichneBildzeichen(kontext, mitte, mitte, 16, gelb);
    return kontext.getImageData(0, 0, kante, kante);
}

export interface StelleKarte {
    destroy(): void;
}

export function installStelleLayer(
    map: MapLibreMap,
    umfeld: {
        readonly interaction: MapInteractionCoordinator;
        readonly escape: Pick<EscapeCascade, "register">;
        /** Die Kamera der Seite (sie entsteht nach der Karte); ohne sie bleibt die Fahrt aus. */
        readonly camera?: () => Pick<Camera, "showPoint"> | undefined;
        readonly steuerung: ReisebildSteuerung;
    },
): StelleKarte {
    const { interaction, escape, steuerung } = umfeld;

    // --- Die Kamera ------------------------------------------------------------------------------------------------------

    /**
     * Wo Panels die Karte decken (Bildschirmkoordinaten): die rechte Kante des Planers links, die linke Kante des Info- oder Editorpanels rechts. Zu ist zu: Ein Panel unter `inert` zählt nicht,
     * und die Fenster der Reisebilder selbst zählen nicht (sie sind das, dem die Fahrt ausweicht).
     */
    const belegtDurchPanels = (): { links?: number; rechts?: number } => {
        const kante = (seite: "left" | "right"): DOMRect | undefined => {
            for (const element of document.querySelectorAll<HTMLElement>(`[data-map-overlay="${seite}"]`)) {
                if (element.closest("[inert]") !== null) continue;
                if (
                    element.matches(`[data-testid="${REISEBILD_FENSTER}"], [data-testid="${REISEBILD_STATUS_FENSTER}"]`)
                )
                    continue;
                const kasten = element.getBoundingClientRect();
                if (kasten.width > 0) return kasten;
            }
            return undefined;
        };
        const links = kante("left")?.right;
        const rechts = kante("right")?.left;
        return { ...(links === undefined ? {} : { links }), ...(rechts === undefined ? {} : { rechts }) };
    };
    /**
     * Wie die Kamera zur Stelle fährt (`PointOptions`). Am Telefon zählt die freie Fläche über dem Blatt (`{}`). Am Rechner steht das Fenster der Reisebilder auf der Karte, meist in der Mitte: Die
     * Stelle landet in der Mitte der freien Fläche NEBEN ihm, links, sonst rechts (`freiNebenMitte`). Bleibt auf keiner Seite Platz, zielt die Kamera wie ohne `free`.
     */
    const optionenDerFahrt = (): PointOptions => {
        if (phoneViewport.value) return {};
        const fenster = document.querySelector(
            `[data-testid="${REISEBILD_FENSTER}"], [data-testid="${REISEBILD_STATUS_FENSTER}"]`,
        );
        if (fenster === null) return {};
        const frei = freiNebenMitte(
            rechteck(fenster.getBoundingClientRect()),
            rechteck(map.getCanvas().getBoundingClientRect()),
            belegtDurchPanels(),
        );
        return frei === undefined ? {} : { free: frei };
    };
    /** Die Stelle in die freie Fläche bringen, sobald das Fenster dasteht (Vue zeichnet im nächsten Takt, die Fläche der Kamera misst danach). */
    const fliegeZurStelle = (): void => {
        const lage = steuerung.stelle.value;
        if (lage === undefined) return;
        void nextTick().then(() =>
            requestAnimationFrame(() =>
                requestAnimationFrame(() => {
                    if (steuerung.stelle.value !== lage) return;
                    // Näher heran als zuvor geht sie nie. Am Telefon liegt das Blatt unten (es meldet sich als Rand), dort zählt die freie Fläche darüber; am Rechner die neben dem Fenster.
                    void umfeld.camera?.()?.showPoint(punkt(lage), map.getZoom(), optionenDerFahrt());
                }),
            ),
        );
    };
    const stopFahrt = watch(
        () => {
            const anzeige = steuerung.anzeige.value;
            return anzeige?.art === "formular" ? anzeige.stelle : undefined;
        },
        (lage) => {
            if (lage !== undefined && !steuerung.waehlen.value) fliegeZurStelle();
        },
        { flush: "sync" },
    );
    // Nach dem Wählen klappt das Fenster wieder auf: Dann erst fliegt die Kamera (sonst zielte sie neben ein eingeklapptes Fenster).
    const stopWahl = watch(
        steuerung.waehlen,
        (jetzt, vorher) => {
            if (vorher && !jetzt) fliegeZurStelle();
        },
        { flush: "sync" },
    );
    const stopZeigen = steuerung.verbinde((lage) => {
        // „Auf der Karte zeigen“ ist eine ausdrückliche Bitte: Die Kamera fliegt, in die freie Fläche neben dem Fenster (wie bei der Stelle des Formulars), und holt die Stelle auch näher heran.
        void umfeld
            .camera?.()
            ?.showPoint(punkt(lage), Math.max(map.getZoom(), renderZoomForBand(PLACE_ZOOM_FLOOR)), optionenDerFahrt());
    });

    // --- Der Besitzer des Klicks: nur angemeldet, solange der Modus läuft ----------------------------------------------------

    const besitzer: InteractionOwner<Claim> = {
        id: "stelle-waehlen",
        priority: INTERACTION_PRIORITY["stelle-waehlen"],
        kinds: ["click", "hover"],
        layers: () => [],
        hit: (context) => (context.kind === "hover" ? { cursor: "crosshair" } : {}),
        apply(kind, _claim, context) {
            if (kind !== "click") return;
            const lage = fromRenderLngLat(space, context.lngLat);
            const rund = { x: roundMapCoordinate(lage.x), y: roundMapCoordinate(lage.y) };
            if (!imKartenraum(rund)) return;
            steuerung.setzeStelle(rund);
        },
    };
    let abmelden: (() => void) | undefined;
    const stopModus = watch(
        steuerung.waehlen,
        (modus) => {
            if (modus && abmelden === undefined) abmelden = interaction.register(besitzer);
            else if (!modus && abmelden !== undefined) {
                abmelden();
                abmelden = undefined;
            }
        },
        { immediate: true, flush: "sync" },
    );
    // Esc beendet den Modus, bevor es die Auswahl der Karte aufhebt (Stufe `action`).
    const stopEscape = escape.register("action", () => {
        if (!steuerung.waehlen.value) return false;
        steuerung.beendeWahl();
        return true;
    });

    // --- Das Symbol auf der Karte -----------------------------------------------------------------------------------------

    const nimmWeg = (): void => {
        if (!styleTakesChanges(map)) return;
        if (map.getLayer(STELLE_EBENE) !== undefined) map.removeLayer(STELLE_EBENE);
        if (map.getSource(STELLE_QUELLE) !== undefined) map.removeSource(STELLE_QUELLE);
    };
    /** Quelle, Bild und Ebene anlegen, wo sie fehlen (ein Stilwechsel nimmt sie mit), und die Daten setzen; ohne Stelle nichts davon. */
    const lege = (): void => {
        if (!styleTakesChanges(map)) return;
        const daten = stelleDaten(steuerung.stelle.value);
        if (daten.features.length === 0) {
            nimmWeg();
            return;
        }
        const inhalt = daten as unknown as GeoJSONSourceSpecification["data"];
        const quelle = map.getSource(STELLE_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(STELLE_QUELLE, { type: "geojson", data: inhalt });
        else quelle.setData(inhalt as Parameters<GeoJSONSource["setData"]>[0]);
        if (!map.hasImage(STELLE_BILD)) map.addImage(STELLE_BILD, zeichneStelleBild(2), { pixelRatio: 2 });
        for (const ebene of stelleEbenen()) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
    };

    // --- Der Bildschirmpunkt für die Linie ----------------------------------------------------------------------------------

    const veroeffentliche = (): void => {
        const lage = steuerung.stelle.value;
        if (lage === undefined) {
            steuerung.setzeSchirm(undefined);
            return;
        }
        const im = map.project(punkt(lage));
        const rahmen = map.getCanvas().getBoundingClientRect();
        steuerung.setzeSchirm({
            x: Math.round((rahmen.left + im.x) * 10) / 10,
            y: Math.round((rahmen.top + im.y) * 10) / 10,
        });
    };
    map.on("move", veroeffentliche);
    map.on("resize", veroeffentliche);

    const stopStelle = watch(
        steuerung.stelle,
        () => {
            whenStyleTakesChanges(map, lege);
            veroeffentliche();
        },
        { immediate: true, flush: "sync" },
    );
    const stopStil = nachStilwechsel(map, lege);

    let ab = false;
    const destroy = (): void => {
        if (ab) return;
        ab = true;
        stopFahrt();
        stopWahl();
        stopZeigen();
        stopModus();
        stopEscape();
        stopStelle();
        stopStil();
        map.off("move", veroeffentliche);
        map.off("resize", veroeffentliche);
        abmelden?.();
        abmelden = undefined;
        steuerung.setzeSchirm(undefined);
        nimmWeg();
    };
    map.once("remove", destroy);
    return { destroy };
}
