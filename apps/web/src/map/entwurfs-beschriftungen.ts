import type { FilterSpecification, GeoJSONSource, LayerSpecification, Map as MapLibreMap } from "maplibre-gl";
import { AVENTURIA, toRenderLngLat } from "@avesmaps3d/shared";
import {
    LANDSCAPE_NAME_LAYER_RANK,
    MAP_LABEL_SOURCE_ID,
    MAP_LABEL_SOURCE_LAYER,
    mapLabelLayerId,
} from "./landscape-layers";

/**
 * Beschriftungen im Entwurf an ihrer neuen Lage (WI-0178 C4; Betreiber 2026-10-18, wörtlich: „Auf karte anzeigen und auf der karte
 * verschieben klappt, aber kannst du nach "Verschieben beenden" auch das label korrekt positionieren? unabhängig von "fertig" machen“).
 * Neben `entwurfs-flaechen.ts` der zweite gemeinsame Baustein für „die Karte zeigt den Entwurf“; erste Nutzerin ist die Derographie.
 *
 * - **Im Entwurf** (`zeige`): Die Beschriftung aus der Kachel ist ausgeblendet (Filter ihrer Punktebene), und dieselbe Beschriftung
 *   steht an der Lage des Entwurfs: in einer Kopie ihrer Punktebene (`map-label-<ebene>`), also in Schrift, Größe, Farbe, Band und
 *   Kollision wie in der Kachel, nur aus einer GeoJSON-Quelle. Ihre Werte kommen aus der geladenen Kachel (`querySourceFeatures`, gemerkt
 *   je Beschriftung), der Text aus dem Entwurf.
 * - **Nach „Fertig“** (`halte`): Sie bleibt, bis die Kacheln der Beschriftungen die Revision der Quittung geladen haben (`idle` mit
 *   geladener Karte), höchstens `HALTEN_MS`. Ohne das sprang sie zurück, bis die Kachel nachkam.
 * - Steht der Name auf einer Kurve (`has_curve_run`), zeichnet die Karte den Punkt gar nicht; dann auch hier nichts.
 * - Ein Stilwechsel (`setStyle` mit `diff`) nimmt Quelle, Kopien und Filter mit; sie kommen mit `styledata` wieder. Alles hier ist
 *   gleichbleibend wiederholbar: Ein `styledata` aus den eigenen Aufrufen ändert nichts mehr.
 */
export const ENTWURF_BESCHRIFTUNG_QUELLE = "editor-entwurf-beschriftungen";
/** Die Kopie der Punktebene einer Landschaftsebene. */
export const entwurfBeschriftungEbene = (ebene: string): string => `editor-entwurf-beschriftung-${ebene}`;
/** Alle Kopien, die es geben kann (für Abfragen gezeichneter Namen, `area-selection-name.ts`). */
export const ENTWURF_BESCHRIFTUNG_EBENEN: readonly string[] = LANDSCAPE_NAME_LAYER_RANK.map(entwurfBeschriftungEbene);
/** So lange steht eine gespeicherte Beschriftung höchstens, wenn die Kachel nicht nachkommt. */
export const HALTEN_MS = 15_000;

export interface EntwurfsBeschriftung {
    /** Die Beschriftung (`map_label.public_id`). */
    readonly id: string;
    /** Die Lage im Entwurf, in Karteneinheiten (MCS). */
    readonly x: number;
    readonly y: number;
    /** Der Text im Entwurf; ohne der aus der Kachel. */
    readonly text?: string | undefined;
}

export interface EntwurfsBeschriftungen {
    /** Die Beschriftungen im Entwurf; ersetzt die vorigen. */
    zeige(liste: readonly EntwurfsBeschriftung[]): void;
    /** Gespeichert: Sie stehen weiter, bis die Kacheln die Revision `revision` geladen haben. */
    halte(liste: readonly EntwurfsBeschriftung[], revision: number): void;
    entferne(): void;
}

export interface EntwurfsBeschriftungenDeps {
    /** Die Revision, mit der die Kachelquellen gerade laden (`edit-revision.ts`). */
    kachelRevision(): number;
    setTimeout?: (callback: () => void, ms: number) => unknown;
    clearTimeout?: (handle: unknown) => void;
}

type Merkmale = Record<string, unknown>;
const json = (wert: unknown): string => JSON.stringify(wert ?? null);

export function installEntwurfsBeschriftungen(
    map: MapLibreMap,
    deps: EntwurfsBeschriftungenDeps,
): EntwurfsBeschriftungen {
    const space = AVENTURIA.coordinateSpace;
    const spaeter = deps.setTimeout ?? ((callback, ms) => globalThis.setTimeout(callback, ms));
    const abbrechen =
        deps.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));
    let entwurf: readonly EntwurfsBeschriftung[] = [];
    let gehalten: { liste: readonly EntwurfsBeschriftung[]; revision: number; uhr: unknown }[] = [];
    /** Die Werte je Beschriftung aus der Kachel, einmal gelesen: Nach dem Ziehen liegt ihre Kachel vielleicht nicht mehr im Bild. */
    const merkmale = new Map<string, Merkmale>();
    /** Je Punktebene ihr Filter aus dem Stil und der, den wir gesetzt haben (ein neuer Stil bringt einen neuen). */
    const filter = new Map<string, { stil: unknown; gesetzt: string }>();
    /** Je Kopie die Ebene, aus der sie gebaut ist (ein neuer Stil, eine neue Auswahl: neu bauen). */
    const kopien = new Map<string, string>();
    /** Was die Quelle zuletzt bekam: Ein `styledata` ohne Änderung setzt nichts neu. */
    let gesendet = "";

    const alle = (): EntwurfsBeschriftung[] => {
        const nach = new Map<string, EntwurfsBeschriftung>();
        for (const halt of gehalten) for (const b of halt.liste) nach.set(b.id, b);
        for (const b of entwurf) nach.set(b.id, b);
        return [...nach.values()];
    };

    function merkmaleVon(id: string): Merkmale | undefined {
        const gemerkt = merkmale.get(id);
        if (gemerkt !== undefined || map.getSource(MAP_LABEL_SOURCE_ID) === undefined) return gemerkt;
        const [feature] = map.querySourceFeatures(MAP_LABEL_SOURCE_ID, {
            sourceLayer: MAP_LABEL_SOURCE_LAYER,
            filter: ["==", ["get", "public_id"], id] as FilterSpecification,
        });
        if (feature?.properties) merkmale.set(id, { ...feature.properties });
        return merkmale.get(id);
    }

    const daten = () => ({
        type: "FeatureCollection" as const,
        features: alle().flatMap((b) => {
            const werte = merkmaleVon(b.id);
            if (werte === undefined || werte["has_curve_run"] === true) return [];
            const p = toRenderLngLat(space, { x: b.x, y: b.y });
            return [
                {
                    type: "Feature" as const,
                    properties: { ...werte, ...(b.text === undefined ? {} : { name: b.text }) },
                    geometry: { type: "Point" as const, coordinates: [p.lng, p.lat] },
                },
            ];
        }),
    });

    /** Blendet die Beschriftungen in ihrer Kachel aus; ohne Beschriftungen gilt wieder der Filter des Stils. */
    function verberge(ids: readonly string[]): void {
        for (const ebene of LANDSCAPE_NAME_LAYER_RANK) {
            const schicht = mapLabelLayerId(ebene);
            if (map.getLayer(schicht) === undefined) continue;
            const jetzt = map.getFilter(schicht);
            const bekannt = filter.get(schicht);
            const stil = bekannt !== undefined && bekannt.gesetzt === json(jetzt) ? bekannt.stil : jetzt;
            const neu =
                ids.length === 0
                    ? stil
                    : [
                          "all",
                          ["!", ["in", ["get", "public_id"], ["literal", [...ids]]]],
                          ...(stil === undefined || stil === null ? [] : [stil]),
                      ];
            if (json(neu) !== json(jetzt)) map.setFilter(schicht, (neu ?? null) as FilterSpecification | null);
            filter.set(schicht, { stil, gesetzt: json(neu) });
        }
    }

    /** Die Kopie jeder Punktebene, die der Stil trägt, gleich hinter ihr. */
    function kopiere(): void {
        const schichten = map.getStyle().layers ?? [];
        for (const ebene of LANDSCAPE_NAME_LAYER_RANK) {
            const vorlageId = mapLabelLayerId(ebene);
            const kopieId = entwurfBeschriftungEbene(ebene);
            const index = schichten.findIndex((schicht) => schicht.id === vorlageId);
            const vorlage = schichten[index];
            if (vorlage === undefined || vorlage.type !== "symbol") {
                if (map.getLayer(kopieId) !== undefined) map.removeLayer(kopieId);
                kopien.delete(kopieId);
                continue;
            }
            // Aus der GeoJSON-Quelle, und mit dem Filter des Stils, nicht mit dem, den wir zum Ausblenden gesetzt haben.
            const spec: Record<string, unknown> = { ...vorlage, id: kopieId, source: ENTWURF_BESCHRIFTUNG_QUELLE };
            delete spec["source-layer"];
            delete spec["filter"];
            const stil = filter.get(vorlageId)?.stil;
            if (stil !== undefined && stil !== null) spec["filter"] = stil;
            if (kopien.get(kopieId) === json(spec) && map.getLayer(kopieId) !== undefined) continue;
            if (map.getLayer(kopieId) !== undefined) map.removeLayer(kopieId);
            const danach = schichten.slice(index + 1).find((schicht) => !kopien.has(schicht.id))?.id;
            map.addLayer(spec as LayerSpecification, danach);
            kopien.set(kopieId, json(spec));
        }
    }

    function raeume(): void {
        for (const kopieId of [...kopien.keys()]) if (map.getLayer(kopieId) !== undefined) map.removeLayer(kopieId);
        kopien.clear();
        if (map.getSource(ENTWURF_BESCHRIFTUNG_QUELLE) !== undefined) map.removeSource(ENTWURF_BESCHRIFTUNG_QUELLE);
        gesendet = "";
        verberge([]);
    }

    function zeichne(): void {
        const liste = alle();
        if (liste.length === 0) {
            raeume();
            return;
        }
        verberge(liste.map((b) => b.id));
        // `querySourceFeatures` liest die Quelle, nicht das Gezeichnete: Die Werte kommen auch aus der ausgeblendeten Kachel.
        const neu = daten();
        const quelle = map.getSource(ENTWURF_BESCHRIFTUNG_QUELLE) as GeoJSONSource | undefined;
        if (quelle === undefined) map.addSource(ENTWURF_BESCHRIFTUNG_QUELLE, { type: "geojson", data: neu });
        else if (json(neu) !== gesendet) quelle.setData(neu);
        gesendet = json(neu);
        kopiere();
    }

    const anlegen = (): void => {
        // 🪤 Nicht auf `isStyleLoaded()` warten (wie `entwurfs-flaechen.ts`): Es wartet auch auf alle Kacheln.
        try {
            zeichne();
        } catch {
            map.once("styledata", anlegen);
        }
    };

    /** Gehaltene Beschriftungen gehen, sobald die Kacheln ihre Revision geladen haben. */
    function pruefeGehalten(): void {
        if (gehalten.length === 0) return;
        const bleibt = gehalten.filter((halt) => !(deps.kachelRevision() >= halt.revision && map.loaded()));
        if (bleibt.length === gehalten.length) return;
        for (const halt of gehalten) if (!bleibt.includes(halt)) abbrechen(halt.uhr);
        gehalten = bleibt;
        anlegen();
    }

    const nachStil = (): void => {
        if (alle().length > 0) anlegen();
    };
    map.on("styledata", nachStil);
    map.on("idle", pruefeGehalten);

    return {
        zeige(liste) {
            if (liste.length === 0 && entwurf.length === 0) return;
            entwurf = liste;
            anlegen();
        },
        halte(liste, revision) {
            if (liste.length === 0) return;
            const halt = {
                liste,
                revision,
                uhr: spaeter(() => {
                    gehalten = gehalten.filter((h) => h !== halt);
                    anlegen();
                }, HALTEN_MS),
            };
            gehalten = [...gehalten, halt];
            anlegen();
            pruefeGehalten();
        },
        entferne() {
            map.off("styledata", nachStil);
            map.off("idle", pruefeGehalten);
            for (const halt of gehalten) abbrechen(halt.uhr);
            gehalten = [];
            entwurf = [];
            raeume();
        },
    };
}
