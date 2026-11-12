import { nextTick, watch } from "vue";
import type {
    FilterSpecification,
    GeoJSONSource,
    GeoJSONSourceSpecification,
    LayerSpecification,
    Map as MapLibreMap,
} from "maplibre-gl";
import {
    AVENTURIA,
    DESIGN_CANON,
    canonColour,
    fromRenderLngLat,
    roundMapCoordinate,
    toRenderLngLat,
    type CommunityLage,
} from "@avesmaps3d/shared";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import type { Camera } from "../map/camera/camera";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { nachStilwechsel, styleTakesChanges, whenStyleTakesChanges } from "../map/style-ready";
import type { BesucherSteuerung, LageVorschlag } from "./community-besucher";

/**
 * „Neue Lage auf der Karte zeigen“ (WI-0268 C2; Bedienkonzept §2.1 Schritt 2, Fachkonzept §6): Im Meldeformular der Besucher zeigt ein Klick auf die Karte, wo ein Objekt liegen sollte.
 * Der Vorschlag steht als Geist (hellgelbe Scheibe) mit einer gestrichelten Linie zur alten Lage (blassrote Scheibe); er wird gezeigt, nie angewandt (`map_mutation = false`).
 *
 * - 🔴 **Der Klick gehört dem Koordinator** (`map/interaction/`, Besitzer `lage-zeigen`, Rang in `priorities.ts`): Er ist nur angemeldet, solange der Modus läuft; dann bekommt der
 *   nächste Klick auf die Karte, wo auch immer (Fadenkreuz), die Lage und beendet den Modus. Die Karte außerhalb des Kartenraums nimmt er nicht an (der Server lehnte sie ab).
 * - **Esc beendet den Modus** (Escape-Kaskade, Stufe `action`); das Fenster klappt dann wieder auf, ein gesetzter Vorschlag bleibt.
 * - 🔴 **Nach dem Klick fliegt die Kamera über `camera.ts`** (`showBounds`, nie ein Sprung) so, dass alte und neue Lage in der freien Fläche neben dem wieder aufgeklappten Fenster
 *   stehen: Der Klick lag auf der freien Karte des eingeklappten Fensters, und ohne die Fahrt läge der Geist danach unter dem Fenster. Näher heran als zuvor geht sie nie.
 * - **Eine eigene kleine Quelle mit eigenen Ebenen, nicht anklickbar** (Muster `map/aenderungen-overlay.ts`): kein Ebenenname steht in einer Liste des Koordinators, die Klicks gehen
 *   durch. Ein Stilwechsel nimmt Quelle und Ebenen mit; sie kommen im nächsten Bild wieder (`nachStilwechsel`). Die Töne sind die der Vorher-Nachher-Überlagerung im Kanon
 *   (`colour.mapChange*`, ohne Dunkelwerte: Die Karte bleibt in beiden Themen hell).
 */

export const LAGE_QUELLE = "community-lage";
export const LAGE_EBENEN = {
    verbindung: "community-lage-verbindung",
    alt: "community-lage-alt",
    geist: "community-lage-geist",
} as const;
const LAGE_EBENEN_LISTE: readonly string[] = Object.values(LAGE_EBENEN);

const space = AVENTURIA.coordinateSpace;
const WELT = space.bounds;

/** Liegt der Punkt im Kartenraum? Was außerhalb liegt, nähme der Server nicht an (`Lage` im Vertrag). */
export const imKartenraum = (lage: CommunityLage): boolean =>
    lage.x >= WELT.minX && lage.x <= WELT.maxX && lage.y >= WELT.minY && lage.y <= WELT.maxY;

const punkt = (lage: CommunityLage): [number, number] => {
    const render = toRenderLngLat(space, lage);
    return [render.lng, render.lat];
};

interface LageMerkmal {
    readonly type: "Feature";
    readonly properties: { readonly t: "alt" | "geist" | "verbindung" };
    readonly geometry:
        | { readonly type: "Point"; readonly coordinates: [number, number] }
        | { readonly type: "LineString"; readonly coordinates: [number, number][] };
}

export interface LageDaten {
    readonly type: "FeatureCollection";
    readonly features: readonly LageMerkmal[];
}

/** Die Merkmale des Vorschlags: der Geist an der neuen Lage, dazu (wo die alte bekannt ist) ihre Scheibe und die Linie zwischen beiden. Ohne Vorschlag nichts. */
export function lageDaten(vorschlag: LageVorschlag | undefined): LageDaten {
    if (vorschlag === undefined) return { type: "FeatureCollection", features: [] };
    const features: LageMerkmal[] = [];
    if (vorschlag.alt !== undefined) {
        features.push({
            type: "Feature",
            properties: { t: "verbindung" },
            geometry: { type: "LineString", coordinates: [punkt(vorschlag.alt), punkt(vorschlag.neu)] },
        });
        features.push({
            type: "Feature",
            properties: { t: "alt" },
            geometry: { type: "Point", coordinates: punkt(vorschlag.alt) },
        });
    }
    features.push({
        type: "Feature",
        properties: { t: "geist" },
        geometry: { type: "Point", coordinates: punkt(vorschlag.neu) },
    });
    return { type: "FeatureCollection", features };
}

const nur = (t: string): FilterSpecification => ["==", ["get", "t"], t] as unknown as FilterSpecification;
/** Die Maße leiten sich aus der Auswahl der Karte ab und aus der Strichelung des Messwerkzeugs, nicht aus einer neuen Tafel (wie die Überlagerung der Änderungen). */
const BREITE = DESIGN_CANON.mapSelection.lineWidth;
const VERBINDUNG_STRICH = [1.5, 1.5] as const;

/** Die Ebenen, unten nach oben: die gestrichelte Linie, die alte Lage, der Geist. */
export function lageEbenen(): LayerSpecification[] {
    const scheibe = (id: string, t: string, fuellung: string, rand: string): LayerSpecification => ({
        id,
        type: "circle",
        source: LAGE_QUELLE,
        filter: nur(t),
        paint: {
            "circle-radius": BREITE * 2,
            "circle-color": fuellung,
            "circle-stroke-color": rand,
            "circle-stroke-width": BREITE * 0.75,
        },
    });
    return [
        {
            id: LAGE_EBENEN.verbindung,
            type: "line",
            source: LAGE_QUELLE,
            filter: nur("verbindung"),
            layout: { "line-join": "round" },
            paint: {
                "line-color": canonColour("mapChangeLink"),
                "line-width": BREITE * 0.75,
                "line-dasharray": [...VERBINDUNG_STRICH],
            },
        },
        scheibe(LAGE_EBENEN.alt, "alt", canonColour("mapChangeBeforeFill"), canonColour("mapChangeBeforeLine")),
        scheibe(LAGE_EBENEN.geist, "geist", canonColour("mapChangeAfterFill"), canonColour("mapChangeAfterLine")),
    ];
}

/** Der Ausschnitt um alte und neue Lage in Renderkoordinaten, Südwest und Nordost; ohne alte Lage ist es der Punkt der neuen. */
export function vorschlagGrenzen(vorschlag: LageVorschlag): [[number, number], [number, number]] {
    const punkte = [vorschlag.neu, ...(vorschlag.alt === undefined ? [] : [vorschlag.alt])].map(punkt);
    const lngs = punkte.map(([lng]) => lng);
    const lats = punkte.map(([, lat]) => lat);
    return [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
    ];
}

export interface LageVorschlagKarte {
    destroy(): void;
}

export function installLageVorschlag(
    map: MapLibreMap,
    umfeld: {
        readonly interaction: MapInteractionCoordinator;
        readonly escape: Pick<EscapeCascade, "register">;
        /** Die Kamera der Seite (sie entsteht nach der Karte); ohne sie bleibt die Fahrt aus. */
        readonly camera?: () => Pick<Camera, "showBounds"> | undefined;
        readonly steuerung: Pick<BesucherSteuerung, "lageModus" | "vorschlag" | "setzeVorschlag" | "beendeLageModus">;
    },
): LageVorschlagKarte {
    const { interaction, escape, steuerung } = umfeld;

    /**
     * Beide Lagen in die freie Fläche bringen, sobald das Fenster wieder aufgeklappt ist (ein Bild nach dem Klick: Vue zeichnet im nächsten Takt, die Fläche der Kamera misst danach).
     * Der Zoom wird nie größer als der jetzige; passen beide Lagen nicht hinein, geht er zurück.
     */
    const zeige = (): void => {
        void nextTick().then(() =>
            requestAnimationFrame(() => {
                const vorschlag = steuerung.vorschlag.value;
                if (vorschlag === undefined) return;
                void umfeld.camera?.()?.showBounds(vorschlagGrenzen(vorschlag), { maxZoom: map.getZoom() });
            }),
        );
    };

    // --- Der Besitzer des Klicks: nur angemeldet, solange der Modus läuft -----------------------------------------------------

    const besitzer: InteractionOwner<Claim> = {
        id: "lage-zeigen",
        priority: INTERACTION_PRIORITY["lage-zeigen"],
        kinds: ["click", "hover"],
        layers: () => [],
        hit: (context) => (context.kind === "hover" ? { cursor: "crosshair" } : {}),
        apply(kind, _claim, context) {
            if (kind !== "click") return;
            const lage = fromRenderLngLat(space, context.lngLat);
            const rund = { x: roundMapCoordinate(lage.x), y: roundMapCoordinate(lage.y) };
            if (!imKartenraum(rund)) return;
            steuerung.setzeVorschlag(rund);
            zeige();
        },
    };
    let abmelden: (() => void) | undefined;
    const stopModus = watch(
        steuerung.lageModus,
        (modus) => {
            if (modus !== undefined && abmelden === undefined) abmelden = interaction.register(besitzer);
            else if (modus === undefined && abmelden !== undefined) {
                abmelden();
                abmelden = undefined;
            }
        },
        { immediate: true, flush: "sync" },
    );
    // Esc beendet den Modus, bevor es die Auswahl der Karte aufhebt (Stufe `action`).
    const stopEscape = escape.register("action", () => {
        if (steuerung.lageModus.value === undefined) return false;
        steuerung.beendeLageModus();
        return true;
    });

    // --- Der Geist auf der Karte ------------------------------------------------------------------------------------------------

    const nimmWeg = (): void => {
        if (!styleTakesChanges(map)) return;
        for (const id of LAGE_EBENEN_LISTE) if (map.getLayer(id) !== undefined) map.removeLayer(id);
        if (map.getSource(LAGE_QUELLE) !== undefined) map.removeSource(LAGE_QUELLE);
    };
    /** Quelle und Ebenen anlegen, wo sie fehlen (ein Stilwechsel nimmt sie mit), und die Daten setzen; ohne Vorschlag nichts davon. */
    const lege = (): void => {
        if (!styleTakesChanges(map)) return;
        const daten = lageDaten(steuerung.vorschlag.value);
        if (daten.features.length === 0) {
            nimmWeg();
            return;
        }
        const inhalt = daten as unknown as GeoJSONSourceSpecification["data"];
        const quelle = map.getSource(LAGE_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(LAGE_QUELLE, { type: "geojson", data: inhalt });
        else quelle.setData(inhalt as Parameters<GeoJSONSource["setData"]>[0]);
        for (const ebene of lageEbenen()) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
    };
    const stopVorschlag = watch(steuerung.vorschlag, () => whenStyleTakesChanges(map, lege), {
        immediate: true,
        flush: "sync",
    });
    const stopStil = nachStilwechsel(map, lege);

    let ab = false;
    const destroy = (): void => {
        if (ab) return;
        ab = true;
        stopModus();
        stopEscape();
        stopVorschlag();
        stopStil();
        abmelden?.();
        abmelden = undefined;
        nimmWeg();
    };
    map.once("remove", destroy);
    return { destroy };
}
