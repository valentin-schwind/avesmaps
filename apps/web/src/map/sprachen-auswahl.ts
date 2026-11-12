import type { FilterSpecification, Map as MapLibreMap, MapGeoJSONFeature } from "maplibre-gl";
import { SPRACHE_FILL_LAYER_ID, SPRACHE_HOVER_STATE, SPRACHE_SOURCE_ID, SPRACHE_SOURCE_LAYER } from "./sprachen-layers";

/**
 * Zeigen und Wählen einer Sprache auf der Karte (WI-0261 S5b; Bauvorlage: die Probierseite vom 2026-10-30, `karte.js` `hoverPruefen`, `auswahlZeichnen`, `klick`).
 *
 * - **Zeigen** hebt die Sprache unter dem Zeiger hervor: eine helle Lasur über ihren Teilflächen und ihre Kontur 2,4 statt 1,1 px (Vorlage: `rgba(255,255,255,.2)`,
 *   `stroke-width` 2,4). Bei Überlappung gilt die Sprache mit der KLEINSTEN Teilfläche an dieser Stelle (Vorlage `treffer`: kleinste zuerst), denn die große liegt
 *   meist ringsum. 🔴 Über den Feature-State, nicht über einen Filter: Ein neuer Filter lädt jede Kachel der Quelle neu (dieselbe Falle wie bei den Wegen,
 *   `area-selection.ts` `buildPathPreviewLayer`); der Zustand malt nur neu. Die Teilflächen tragen dafür ihre Kennung (`promoteId` in `buildSprachSource`).
 * - **Gewählt** ist die Sprache, deren Infobox offen ist: Sie leuchtet im Hausmuster der Flächenauswahl (`sprachen-leuchten.ts`, seit S5c; Kanon `mapSelection`: goldene Lasur, Schein,
 *   Kontur). Die Auswahl wechselt selten (ein Klick), darum ist sie ein Filter am Stil, wie die gewählte Fläche.
 * - **Mehrere Sprachen** an einer Stelle: Ein Klick öffnet erst das kleine Menü am Zeiger mit beiden (Hausregel „Menü klein am Zeiger“, `area-choice-menu.vue`).
 */

/** Nur die Teilflächen einer Sprache, über ihren Schlüssel (`sprache_flaeche_render.schluessel`). */
export function sprachFilter(schluessel: string): FilterSpecification {
    return ["==", ["get", "schluessel"], schluessel];
}

/** Eine Sprache an einer Stelle der Karte, aus der Kachel ihrer Teilfläche. */
export interface SpracheAnStelle {
    /** `sprache.public_id`: die Kennung des Subjects. */
    id: string;
    schluessel: string;
    name: string;
    /** `#rrggbb`. */
    farbe: string;
    /** Die Fläche der getroffenen Teilfläche (E²); die kleinste steht vorn. */
    flaeche: number;
    /**
     * Die getroffene Teilfläche selbst (`sprache_flaeche.public_id`, die Kennung des Features), bei mehreren dieser Sprache die kleinste: Ein Klick
     * wählt sie im offenen Spracheditor, das Kartenmenü bearbeitet sie (WI-0261 Stufe 1). Ohne Kennung in der Kachel keine.
     */
    teilflaeche: string | undefined;
}

const FARBE = /^#[0-9a-f]{6}$/u;

/**
 * Die Sprachen an einer Stelle aus den gezeichneten Teilflächen (`queryRenderedFeatures`): je Sprache einmal, die mit der kleinsten getroffenen Teilfläche zuerst
 * (Bauvorlage `treffer`), bei gleicher Fläche nach Name. Eine Teilfläche ohne Kennung, Schlüssel oder Namen zählt nicht.
 */
export function sprachenAnStelle(
    features: readonly (Pick<MapGeoJSONFeature, "properties"> & { readonly id?: MapGeoJSONFeature["id"] })[],
): SpracheAnStelle[] {
    const je = new Map<string, SpracheAnStelle>();
    for (const feature of features) {
        const p = feature.properties as Record<string, unknown>;
        const id = p["sprache_public_id"];
        const schluessel = p["schluessel"];
        const name = p["name"];
        if (typeof id !== "string" || typeof schluessel !== "string" || typeof name !== "string") continue;
        if (schluessel === "" || name.trim() === "") continue;
        const farbe = typeof p["farbe"] === "string" && FARBE.test(p["farbe"]) ? p["farbe"] : "#808080";
        const flaeche = Number(p["area"]);
        const teil = p["public_id"] ?? feature.id;
        const eintrag = {
            id,
            schluessel,
            name,
            farbe,
            flaeche: Number.isFinite(flaeche) ? flaeche : Infinity,
            teilflaeche: typeof teil === "string" && teil !== "" ? teil : undefined,
        };
        const bekannt = je.get(schluessel);
        if (bekannt === undefined || eintrag.flaeche < bekannt.flaeche) je.set(schluessel, eintrag);
    }
    return [...je.values()].sort((a, b) => a.flaeche - b.flaeche || a.name.localeCompare(b.name, "de"));
}

/**
 * Die Sprachen unter einem Punkt der Leinwand, wie ein Klick sie nähme (das Kartenmenü der Editoren, WI-0261 Stufe 1): nur, was gezeichnet ist, also nur in der
 * Ebene „Sprachen“; ohne die Ebene im Stil keine.
 */
export function sprachenAmPunkt(
    map: Pick<MapLibreMap, "getLayer" | "queryRenderedFeatures">,
    punkt: { x: number; y: number },
): SpracheAnStelle[] {
    if (map.getLayer(SPRACHE_FILL_LAYER_ID) === undefined) return [];
    return sprachenAnStelle(map.queryRenderedFeatures([punkt.x, punkt.y], { layers: [SPRACHE_FILL_LAYER_ID] }));
}

export interface SprachHover {
    /** Hebt diese Sprache hervor (`undefined`: keine). Wiederholt dieselbe, geschieht nichts. */
    setze(schluessel: string | undefined): void;
    /** Die gezeigte Sprache. */
    readonly gezeigt: string | undefined;
}

/**
 * Hält den Feature-State der gezeigten Sprache: Er steht an allen GELADENEN Teilflächen dieser Sprache (`querySourceFeatures`); eine Kachel, die erst danach
 * kommt, trägt ihn nicht, und das ist für das Zeigen recht (gezeigt wird, was im Bild ist). Ein neuer Stil (`styledata`) löscht die Zustände; die Sprache
 * wird dann neu gesetzt, sobald der Zeiger sich bewegt.
 */
export function installSprachHover(
    map: Pick<MapLibreMap, "getSource" | "querySourceFeatures" | "setFeatureState">,
): SprachHover {
    let gezeigt: string | undefined;
    let markiert: (string | number)[] = [];

    const setzeZustand = (ids: readonly (string | number)[], wert: boolean): void => {
        for (const id of ids) {
            try {
                map.setFeatureState(
                    { source: SPRACHE_SOURCE_ID, sourceLayer: SPRACHE_SOURCE_LAYER, id },
                    { [SPRACHE_HOVER_STATE]: wert },
                );
            } catch {
                // Mitten im Stilwechsel gibt es die Quelle kurz nicht; der nächste Zeiger setzt neu.
            }
        }
    };

    return {
        get gezeigt() {
            return gezeigt;
        },
        setze(schluessel) {
            if (schluessel === gezeigt) return;
            setzeZustand(markiert, false);
            markiert = [];
            gezeigt = schluessel;
            if (schluessel === undefined || map.getSource(SPRACHE_SOURCE_ID) === undefined) return;
            const ids = new Set<string | number>();
            for (const feature of map.querySourceFeatures(SPRACHE_SOURCE_ID, {
                sourceLayer: SPRACHE_SOURCE_LAYER,
                filter: sprachFilter(schluessel),
            })) {
                if (feature.id !== undefined) ids.add(feature.id);
            }
            markiert = [...ids];
            setzeZustand(markiert, true);
        },
    };
}
