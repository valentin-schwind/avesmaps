import { shallowRef, type ShallowRef } from "vue";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    canonColour,
    toRenderLngLat,
    type LandscapeBooleanOperation,
    type LandscapeBooleanPreview,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { belegeGeometrie, meldeGeometrieAn } from "../map/geometrie/besitzer";
import type { FlaechenSofort } from "../map/geometrie/flaechen-quelle";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, HitContext, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { landschaftSofort } from "./landschaft-flaechen";

/**
 * „Mit anderer Fläche ›“ (Werkzeug 1 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1: „Mehrere Landschaftsflächen miteinander
 * vereinigen“; Legacy `map-features-ecosystem-geometry-ops.js#L49-L55`, `#L400-L546`): die Wahl der anderen Fläche auf der Karte.
 *
 * - **Wählen:** Unter dem Zeiger wird die oberste andere Teilfläche einer gezeichneten Ebene zum Ziel (nur, was die Karte zeigt, wie in
 *   Legacy seit 09.10.2026); eine für Klicks gesperrte nie. Das Ziel steht gelb umrissen (`mapSelection`), das Ergebnis für die Quelle
 *   gestrichelt in Knallrot (`editEdge`), gerechnet vom Server (`boolean-preview`), je Ziel einmal.
 * - **Bestätigen:** Ein Klick auf das Ziel oder „Fertig“ in der Leiste schreibt `landscape.boolean` als EINE Operation, sofort
 *   (Editor-Orchestrierung 2026-10-19: Ausnahme von EDIT-0003 G4 wie „Verbergen“); ↺ im Verlauf holt beides zurück. Esc oder „Verwerfen“
 *   bricht ab, ohne etwas zu schreiben.
 * - Lehnt der Server ab (Konflikt, Sperre, kein Ergebnis), bleibt der Modus stehen und sagt den Satz des Servers.
 * - Ein Modus des Geometrie-Moduls (`geometry-edit`): nie zwei zugleich.
 * - **Die Art** gibt die Quelle (`FlaechenSofort`, WI-0261 Stufe 3), ohne Angabe die Landschaft (`landschaftSofort`): An einer Sprache sind Ziele nur die
 *   Teilflächen ANDERER Sprachen (Ebene `sprachen-fill`), geschrieben wird `sprache_flaeche.boolean`; eine Sprache geht nie mit (`targetLandscapeGoes`).
 */

const space = AVENTURIA.coordinateSpace;
const QUELLE = "editor-mit-anderer";
const EBENEN = { ziel: "editor-mit-anderer-ziel", vorschau: "editor-mit-anderer-vorschau" } as const;

export interface MitAndererSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    /** Die Füllebenen der Landschaften und des wählbaren Wassers, die die Karte gerade zeichnet (`flaechenEbenenImStil`). */
    flaechenEbenen(): readonly string[];
    /** Geschrieben: Kachelrevision, Fenster und Liste neu, die Meldung. */
    geschrieben(quittung: OperationReceipt, regionen: readonly string[]): void;
    melde(text: string, ton: "warning" | "success"): void;
    fetcher?: typeof fetch;
}

export interface MitAndererLauf {
    readonly regionId: string;
    readonly areaId: string;
    readonly name: string;
    readonly operation: LandscapeBooleanOperation;
    readonly phase: "waehlt" | "rechnet" | "schreibt";
    /** Das gewählte Ziel und, sobald gerechnet, die Vorschau. */
    readonly ziel?: { readonly areaId: string; readonly vorschau?: LandscapeBooleanPreview } | undefined;
}

export interface MitAnderer {
    readonly laufend: Readonly<ShallowRef<MitAndererLauf | undefined>>;
    /** `quelle`: die Art (ohne Angabe die Landschaft). */
    starte(
        lauf: { regionId: string; areaId: string; name: string; operation: LandscapeBooleanOperation },
        quelle?: FlaechenSofort,
    ): void;
    /** „Fertig“: schreibt mit dem gewählten Ziel. */
    bestaetige(): Promise<void>;
    abbrechen(): boolean;
}

type Ring = readonly (readonly [number, number])[];

const alsFeatures = (polygone: readonly (readonly Ring[])[] | undefined) => ({
    type: "FeatureCollection" as const,
    features: (polygone ?? []).map((polygon) => ({
        type: "Feature" as const,
        properties: {},
        geometry: {
            type: "Polygon" as const,
            coordinates: polygon.map((ring) => {
                const punkte = ring.map(([x, y]) => {
                    const p = toRenderLngLat(space, { x, y });
                    return [p.lng, p.lat];
                });
                return punkte.length > 0 ? [...punkte, punkte[0]!] : punkte;
            }),
        },
    })),
});

export function createMitAnderer(seite: MitAndererSeite): MitAnderer {
    const landschaft: FlaechenSofort = {
        ...landschaftSofort({ fetcher: seite.fetcher, ebenen: () => seite.flaechenEbenen() }),
        geschrieben: (quittung) =>
            seite.geschrieben(quittung, [
                ...new Set(quittung.affected.filter((x) => x.kind === "landscape").map((x) => x.id)),
            ]),
    };
    /** Die Art des laufenden Modus. */
    let art: FlaechenSofort = landschaft;
    const laufend = shallowRef<MitAndererLauf | undefined>(undefined);
    let ende: (() => void) | undefined;
    let karte: MapLibreMap | undefined;
    let frage: AbortController | undefined;
    /** Je Ziel die Vorschau, einmal gerechnet. */
    const vorschauen = new Map<string, LandscapeBooleanPreview>();

    function zeichne(): void {
        const lauf = laufend.value;
        const vorschau = lauf?.ziel?.vorschau;
        (karte?.getSource(QUELLE) as GeoJSONSource | undefined)?.setData({
            type: "FeatureCollection",
            features: [
                ...alsFeatures(vorschau?.targetPolygons).features.map((f) => ({ ...f, properties: { art: "ziel" } })),
                ...alsFeatures(vorschau?.polygons).features.map((f) => ({ ...f, properties: { art: "vorschau" } })),
            ],
        });
    }

    function schichten(map: MapLibreMap): () => void {
        map.addSource(QUELLE, { type: "geojson", data: alsFeatures([]) });
        map.addLayer({
            id: EBENEN.ziel,
            type: "line",
            source: QUELLE,
            filter: ["==", ["get", "art"], "ziel"],
            paint: { "line-color": canonColour("mapSelection"), "line-width": 4 },
        });
        map.addLayer({
            id: EBENEN.vorschau,
            type: "line",
            source: QUELLE,
            filter: ["==", ["get", "art"], "vorschau"],
            paint: { "line-color": canonColour("editEdge"), "line-width": 2.5, "line-dasharray": [3, 2] },
        });
        return () => {
            for (const id of Object.values(EBENEN)) if (map.getLayer(id) !== undefined) map.removeLayer(id);
            if (map.getSource(QUELLE) !== undefined) map.removeSource(QUELLE);
        };
    }

    function setze(neu: Partial<MitAndererLauf>): void {
        const lauf = laufend.value;
        if (lauf === undefined) return;
        laufend.value = { ...lauf, ...neu };
        zeichne();
    }

    /** Das Ziel unter dem Zeiger, wie die Art es sieht (Landschaft: die oberste andere Teilfläche einer gezeichneten Ebene, nie eine gesperrte). */
    function zielAn(context: HitContext): string | undefined {
        const lauf = laufend.value;
        if (lauf === undefined) return undefined;
        return art.ziel(context.features([...art.zielEbenen()]), lauf.areaId);
    }

    async function waehle(areaId: string | undefined): Promise<void> {
        const lauf = laufend.value;
        if (lauf === undefined || lauf.phase === "schreibt" || lauf.ziel?.areaId === areaId) return;
        frage?.abort();
        if (areaId === undefined) {
            setze({ ziel: undefined, phase: "waehlt" });
            return;
        }
        const gemerkt = vorschauen.get(areaId);
        setze({
            ziel: { areaId, ...(gemerkt === undefined ? {} : { vorschau: gemerkt }) },
            phase: gemerkt ? "waehlt" : "rechnet",
        });
        if (gemerkt !== undefined) return;
        const eigene = new AbortController();
        frage = eigene;
        try {
            const ergebnis = await art.vorschau(
                lauf.regionId,
                lauf.areaId,
                { operation: lauf.operation, targetAreaId: areaId },
                eigene.signal,
            );
            if (eigene.signal.aborted || laufend.value?.ziel?.areaId !== areaId) return;
            if (!ergebnis.ok) {
                setze({ ziel: undefined, phase: "waehlt" });
                seite.melde(ergebnis.satz, "warning");
                return;
            }
            vorschauen.set(areaId, ergebnis.wert);
            setze({ ziel: { areaId, vorschau: ergebnis.wert }, phase: "waehlt" });
        } catch {
            // Abgebrochen (ein anderes Ziel) oder ohne Antwort: Das nächste Zeigen fragt wieder.
        }
    }

    async function bestaetige(): Promise<void> {
        const lauf = laufend.value;
        const vorschau = lauf?.ziel?.vorschau;
        if (lauf === undefined || lauf.ziel === undefined || vorschau === undefined || lauf.phase !== "waehlt") return;
        setze({ phase: "schreibt" });
        const quelle = art;
        try {
            const ergebnis = await quelle.verknuepfe(lauf.regionId, lauf.areaId, {
                operationId: crypto.randomUUID(),
                operation: lauf.operation,
                baseRevision: vorschau.areaRevision,
                targetAreaId: lauf.ziel.areaId,
                targetBaseRevision: vorschau.targetAreaRevision,
            });
            if (!ergebnis.ok) {
                vorschauen.delete(lauf.ziel.areaId);
                setze({ phase: "waehlt", ziel: undefined });
                seite.melde(ergebnis.satz, "warning");
                return;
            }
            beende();
            quelle.geschrieben(ergebnis.wert, "mitAnderer");
        } catch {
            setze({ phase: "waehlt" });
            seite.melde(t("landschaftseditor.mitAnderer.offline"), "warning");
        }
    }

    function beende(): void {
        frage?.abort();
        frage = undefined;
        vorschauen.clear();
        ende?.();
        ende = undefined;
        karte = undefined;
        laufend.value = undefined;
    }

    function starte(
        start: {
            regionId: string;
            areaId: string;
            name: string;
            operation: LandscapeBooleanOperation;
        },
        quelle = landschaft,
    ): void {
        const k = seite.karte();
        if (k === undefined) return;
        const beleg = belegeGeometrie(quelle.werkzeug);
        if (beleg === undefined) return;
        art = quelle;
        karte = k.map;
        const owner: InteractionOwner<Claim> = {
            id: "geometry-edit",
            priority: INTERACTION_PRIORITY["geometry-edit"],
            kinds: ["hover", "click"],
            layers: () => [...art.zielEbenen()],
            // Beansprucht jedes Zeigen, auch ins Leere: Dort hebt `waehle(undefined)` das Ziel auf.
            hit: (context) => (zielAn(context) === undefined ? {} : { cursor: "pointer" }),
            apply(kind, _claim, context) {
                const ziel = zielAn(context);
                if (kind === "hover") void waehle(ziel);
                else if (kind === "click") {
                    // Der Klick auf das gewählte Ziel bestätigt; auf ein anderes wählt er erst.
                    if (ziel !== undefined && ziel === laufend.value?.ziel?.areaId) void bestaetige();
                    else void waehle(ziel);
                }
            },
            // 🪤 Kein Aufheben bei `lost("hover-ended")`: Der Koordinator beendet vor JEDEM Klick das Zeigen, das Ziel wäre weg, und
            // der Klick auf das gezeigte Ziel wählte es nur neu, statt zu bestätigen (Browserfall, Prüfbank 2026-10-19).
        };
        const weg = schichten(k.map);
        const anmeldung = meldeGeometrieAn(k.interaction, owner);
        ende = () => {
            anmeldung.ab();
            weg();
            beleg.frei();
        };
        laufend.value = { ...start, phase: "waehlt" };
    }

    return {
        laufend,
        starte,
        bestaetige,
        abbrechen() {
            if (laufend.value === undefined || laufend.value.phase === "schreibt") return false;
            beende();
            return true;
        },
    };
}
