import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";

import {
    areaIds,
    areaNameFeatures,
    AREA_SELECTION_LABEL_SOURCE_ID,
    NO_AREA_NAME,
    type AreaNameForm,
    type AreaNamePoints,
    type DrawnArea,
} from "./area-selection";
import {
    LANDSCAPE_NAME_LAYER_IDS,
    LANDSCAPE_RUN_SOURCE_ID,
    LANDSCAPE_RUN_SOURCE_LAYER,
    LANDSCAPE_SOURCE_ID,
    LANDSCAPE_SOURCE_LAYER,
    landscapeTypeName,
    isTypeLineLayer,
    MAP_LABEL_SOURCE_ID,
    MAP_LABEL_SOURCE_LAYER,
} from "./landscape-layers";
import { ENTWURF_BESCHRIFTUNG_EBENEN } from "./entwurfs-beschriftungen";

/**
 * Wann der Name einer gewählten Fläche VERSETZT auftritt (WI-0093).
 *
 * 🔴 Betreiber 2026-10-06, aus dem Nutzertest: „wenn der der text schon voll sichtbar/lesbar ist, braucht er
 * keine verschiebung erfahren (das ist nur praktisch für flächen, wo man nur zu nah dran ist)". Steht der
 * gewöhnliche Name im Bild, bleibt er stehen und wird golden (`labelColour` in `landscape-layers.ts`); nur
 * wenn er fehlt, tritt der Ersatz an seine Stelle.
 *
 * 🔴 Das ist eine LAUFZEITFRAGE, die der Stilbau nicht beantworten kann: Ob ein Name gezeichnet ist, hängt an
 * der Kollision, am Erscheinungsband, am Ausschnitt und an der Ansicht - und ändert sich bei jedem Zoomen und
 * Verschieben. Eine Entscheidung, die nur beim Klick fiele, wäre nach dem ersten Zoom falsch.
 *
 * 🪤 Gefragt wird mit `queryRenderedFeatures` auf die beiden Namensebenen. MapLibre gibt dort nur PLATZIERTE
 * Symbole zurück - dieselbe Eigenschaft, auf der die ganze Karteninteraktion beruht (`interaction/coordinator.ts`),
 * und derselbe Weg, den die Gebietsauswahl beim Bandwechsel schon geht (`app.vue`). `querySourceFeatures` taugt
 * dafür ausdrücklich NICHT: Es liefert auch, was die Kollision verworfen hat.
 *
 * 💣 Gefragt wird einen Frame NACH `idle`. Das Bild, bei dem `idle` feuert, ist nicht immer das letzte: Beim
 * Herauszoomen hält MapLibre die alte Kachel fest, damit ihre Symbole ausblenden können, und gibt sie erst nach
 * dem Zeichnen frei - ohne neu zu zeichnen. Ohne den zusätzlichen Frame meldete die Abfrage einen Namen, den der
 * nächste Zeichenlauf wegnimmt. Dieselbe Falle und derselbe Griff wie in `e2e/map-handle.ts` (`settleFrame`).
 *
 * 🪤 Nicht im Klickpfad: Gefragt wird nur, wenn eine Landschaft gewählt ist, und nur bei `idle` - nie an einem
 * Zeiger-Ereignis. `e2e/interaction.spec.ts` zählt die Abfragen je Ereignis und hielte eine zusätzliche fest.
 *
 * 🔴 Nur Landschaften (WI-0121 Nachtrag, Betreiber 2026-10-09). Der Name eines gewählten HERRSCHAFTSGEBIETS bleibt immer in der
 * Ebene der Gebietsnamen stehen und wird dort gelb (`buildTerritoryLabelLayer`); einen versetzten Ersatz gibt es für ihn nicht,
 * auch keine zweite Zeile mit dem Obergebiet: Das nennt das Infopanel („Liegt in“).
 */
export interface AreaSelectionName {
    /** Trägt die Quelle gerade einen Ersatznamen? Für Tests und Abnahmeblätter. */
    shown(): boolean;
    /** Die Form, in der die Karte die Beschriftung dieser Region zuletzt gezeigt hat. */
    form(): AreaNameForm | undefined;
    remove(): void;
}

/** Was von einem Kachel-Feature gebraucht wird: seine Eigenschaften. Mehr fragt diese Datei nicht ab. */
interface TileFeature {
    properties: Record<string, unknown>;
}

/** Die Eigenschaften, aus denen eine Beschriftung ihre Form zieht - aus einem Kachel-Feature gelesen. */
function formOf(feature: TileFeature): AreaNameForm | undefined {
    const size = Number(feature.properties["label_size"]);
    if (!Number.isFinite(size) || size <= 0) {
        return undefined;
    }
    const type = feature.properties["label_type"];
    return { labelSize: size, labelType: typeof type === "string" ? type : "" };
}

const regionOf = (feature: TileFeature): string =>
    typeof feature.properties["region_public_id"] === "string" ? feature.properties["region_public_id"] : "";

export function installAreaSelectionName(
    map: MapLibreMap,
    options: {
        area: () => DrawnArea | undefined;
    },
): AreaSelectionName {
    /** Die zuletzt gesehene Form, je Auswahl. Wird verworfen, sobald eine andere Fläche gewählt ist. */
    let known: { id: string; form: AreaNameForm } | undefined;
    /** Was die Quelle zuletzt bekommen hat; `undefined` heißt „unbekannt, also setzen". */
    let sent: AreaNamePoints | undefined;
    /** Steht noch ein zusätzliches Bild aus, bevor gemessen werden darf? Siehe `settled`. */
    let extraFrame = true;

    /**
     * 💣 Verglichen werden WERTE, nicht Objekte. `areaNameFeatures` baut bei jedem Aufruf ein neues
     * Objekt; ein Identitätsvergleich hieße „immer neu", und jedes `setData` zöge ein Bild und damit das
     * nächste `idle` nach sich - eine Karte, die nie zur Ruhe kommt.
     */
    const same = (left: AreaNamePoints | undefined, right: AreaNamePoints): boolean => {
        if (left === undefined || left.features.length !== right.features.length) return false;
        return left.features.every((feature, index) => {
            const other = right.features[index];
            return (
                other !== undefined &&
                feature.properties.name === other.properties.name &&
                feature.properties.label_size === other.properties.label_size &&
                feature.properties.label_type === other.properties.label_type &&
                feature.geometry.coordinates[0] === other.geometry.coordinates[0] &&
                feature.geometry.coordinates[1] === other.geometry.coordinates[1]
            );
        });
    };

    const show = (next: AreaNamePoints): void => {
        if (same(sent, next)) return;
        sent = next;
        (map.getSource(AREA_SELECTION_LABEL_SOURCE_ID) as GeoJSONSource | undefined)?.setData(next);
    };

    /**
     * Die Ebenen der Landschaftsnamen, die der Stil GERADE trägt. Fehlen sie, ist kein Name gezeichnet. Dazu die Namen im Entwurf
     * (`entwurfs-beschriftungen.ts`): Eine verschobene Beschriftung steht dort, nicht in der Kachel, und bekäme sonst einen Ersatz.
     */
    const nameLayers = (): string[] =>
        [...LANDSCAPE_NAME_LAYER_IDS, ...ENTWURF_BESCHRIFTUNG_EBENEN].filter((id) => map.getLayer(id) !== undefined);

    /**
     * Die Form aus den geladenen Kacheln, wenn die Karte den Namen noch nie gezeigt hat. Hier ist
     * `querySourceFeatures` richtig: Gesucht sind die WERTE der Beschriftung, nicht ihre Sichtbarkeit.
     */
    const formFromTiles = (ids: readonly string[]): AreaNameForm | undefined => {
        const filter = ["in", ["get", "region_public_id"], ["literal", [...ids]]] as never;
        for (const [source, sourceLayer] of [
            [MAP_LABEL_SOURCE_ID, MAP_LABEL_SOURCE_LAYER],
            [LANDSCAPE_RUN_SOURCE_ID, LANDSCAPE_RUN_SOURCE_LAYER],
        ] as const) {
            if (!map.getSource(source)) continue;
            for (const feature of map.querySourceFeatures(source, { sourceLayer, filter })) {
                const form = formOf(feature);
                if (form) return form;
            }
        }
        return undefined;
    };

    function update(): void {
        const area = options.area();
        // Ein Weg trägt seine Namen schon, ein Gebiet seinen Namen in der Ebene der Gebietsnamen: kein Ersatz.
        if (area === undefined || area.kind !== "landscape") {
            known = undefined;
            show(NO_AREA_NAME);
            return;
        }
        if (known?.id !== area.id) known = undefined;
        const ids = areaIds(area);
        const layers = nameLayers();
        const drawn =
            layers.length === 0
                ? []
                : map.queryRenderedFeatures({ layers }).filter((feature) => ids.includes(regionOf(feature)));
        const seen = drawn.map((feature) => formOf(feature)).find((form) => form !== undefined);
        if (seen) known = { id: area.id, form: seen };
        if (drawn.length > 0) {
            // Der Name steht im Bild. Er ist golden, weil er GEWÄHLT ist - ein zweiter wäre eine Doppelung.
            show(NO_AREA_NAME);
            return;
        }
        if (known === undefined) {
            const form = formFromTiles(ids);
            if (form) known = { id: area.id, form };
        }
        show(areaNameFeatures(area, known?.form, typeLineOf(area)));
    }

    /**
     * Die Art als zweite Zeile, wenn eine ANDERE gleichnamige Fläche der Vegetation oder Topographie in den geladenen Kacheln
     * liegt (WI-0135). Der gewöhnliche Name weiß das aus der Kachel (`name_twin`); eine Fläche ohne eigenen Namen, wie die
     * Tiefebene „Große Öde“, hat keinen und bekommt es hier. Gefragt werden die Kacheln, weil der Zwilling, um den es geht,
     * neben der Auswahl liegt und damit geladen ist. Ob die Zeile erscheint, entscheidet der Stil (nur in „Alle“).
     */
    function typeLineOf(area: DrawnArea): string | undefined {
        if (area.name === null || !map.getSource(LANDSCAPE_SOURCE_ID)) return undefined;
        const ids = areaIds(area);
        const gleichnamig = map.querySourceFeatures(LANDSCAPE_SOURCE_ID, {
            sourceLayer: LANDSCAPE_SOURCE_LAYER,
            filter: ["==", ["get", "name"], area.name] as never,
        });
        const ebene = (feature: { properties: Record<string, unknown> | null }): string =>
            String(feature.properties?.["region_layer"] ?? "");
        const eigene = gleichnamig.filter((feature) => ids.includes(String(feature.properties?.["region_public_id"])));
        if (!eigene.some((feature) => isTypeLineLayer(ebene(feature)))) return undefined;
        const zwilling = gleichnamig.some(
            (feature) =>
                !ids.includes(String(feature.properties?.["region_public_id"])) && isTypeLineLayer(ebene(feature)),
        );
        return zwilling ? landscapeTypeName(area.type) : undefined;
    }

    /**
     * 💣 Erst einen Frame weiter, dann messen (siehe oben). `extraFrame` steht nach jedem Ereignis, das das
     * Bild ändern kann; das `idle` danach löst ein zusätzliches Zeichnen aus, und erst das `idle` DARAUF
     * fragt die Karte.
     */
    const settled = (): void => {
        if (extraFrame) {
            extraFrame = false;
            map.triggerRepaint();
            return;
        }
        update();
    };
    const again = (): void => {
        extraFrame = true;
    };
    /**
     * Ein Stilumbau kann die Quelle neu angelegt haben - dann steht sie wieder leer, und was wir gesetzt
     * zu haben glauben, gilt nicht mehr. 🪤 Ohne das stünde nach einem Ansichtswechsel kein Ersatzname
     * mehr, weil der Merker ihn noch für gesetzt hielt.
     *
     * ⭐ Was KEINE Messung braucht, steht sofort: ohne Auswahl, beim Weg und beim Gebiet bleibt die Quelle leer. Nur die
     * Landschaft wartet auf das Messbild - sonst blinkte ihr Ersatzname auf, bevor feststeht, ob der gewöhnliche im Bild ist.
     */
    const restyled = (): void => {
        sent = undefined;
        again();
        if (options.area()?.kind !== "landscape") update();
    };
    const tilesArrived = (event: { sourceId?: string }): void => {
        // 🪤 Nicht die eigene Quelle: `setData` meldet selbst `sourcedata`, und ohne diese Grenze liefe nach
        // jeder Entscheidung ein weiterer Frame.
        if (event.sourceId === MAP_LABEL_SOURCE_ID || event.sourceId === LANDSCAPE_RUN_SOURCE_ID) again();
    };

    map.on("idle", settled);
    map.on("moveend", again);
    map.on("styledata", restyled);
    map.on("sourcedata", tilesArrived);

    return {
        shown: () => (sent?.features.length ?? 0) > 0,
        form: () => known?.form,
        /** Eine neue Auswahl misst neu, und zwar erst eine Zeichnung später. */
        remove() {
            map.off("idle", settled);
            map.off("moveend", again);
            map.off("styledata", restyled);
            map.off("sourcedata", tilesArrived);
        },
    };
}
