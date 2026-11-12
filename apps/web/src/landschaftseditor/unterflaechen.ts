import { shallowRef, type ShallowRef } from "vue";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import {
    AVENTURIA,
    canonColour,
    fromRenderLngLat,
    pointInGeometry,
    toRenderLngLat,
    type LandscapePartsBody,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { belegeGeometrie, meldeGeometrieAn } from "../map/geometrie/besitzer";
import type { FlaechenSofort, SofortTeilflaeche } from "../map/geometrie/flaechen-quelle";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { landschaftSofort } from "./landschaft-flaechen";

/**
 * „Unterflächen ›“ (Werkzeug 3 im Plan der Editor-Orchestrierung 2026-10-19, Thomas 4.1; Legacy
 * `map-features-ecosystem-geometry-ops.js#L580-L760`): Eine Unterfläche ist ein Stück der Teilfläche, an der das Menü steht.
 *
 * - **Alle vereinigen** schreibt sofort, ohne Wahl (es betrifft alle) und sagt, was blieb.
 * - **Herauslösen** und **Löschen** wählen EIN Stück: Alle Stücke stehen blau umrissen, das unter dem Rechtsklick ist vorgewählt (meist
 *   ist genau das gemeint), das unter dem Zeiger wird gewählt; der Klick auf ein Stück oder „Fertig“ schreibt `landscape.parts`, sofort
 *   (Ausnahme von EDIT-0003 G4 wie „Mit anderer Fläche“), ↺ im Verlauf holt es zurück. Löschen fragt nicht (Owner 2026-07-27: man sieht
 *   das Stück, bevor der Klick fällt). Esc bricht ab, ohne zu schreiben.
 * - Aus einem Stück: nichts zu tun, die Meldung sagt es (Legacy „besteht nur aus einer Unterfläche“).
 * - Lehnt der Server ab, bleibt der Modus stehen und sagt den Satz des Servers. Ein Modus des Geometrie-Moduls: nie zwei zugleich.
 * - **Die Art** gibt die Quelle (`FlaechenSofort`, WI-0261 Stufe 3), ohne Angabe die Landschaft (`landschaftSofort`). An einer Sprache schreibt dasselbe
 *   `sprache_flaeche.parts`; „Alle vereinigen“ nimmt dort die Teilflächen derselben Sprache mit, die mit ihr zusammenhängen, darum fragt erst der Server, ob
 *   es etwas zu verschmelzen gibt (`vereinigtMitAnderen`).
 */

const space = AVENTURIA.coordinateSpace;
const QUELLE = "editor-unterflaechen";
const EBENEN = { alle: "editor-unterflaechen-alle", gewaehlt: "editor-unterflaechen-gewaehlt" } as const;

type Ring = readonly (readonly [number, number])[];
type Polygon = readonly Ring[];

export interface UnterflaechenSeite {
    karte(): { map: MapLibreMap; interaction: MapInteractionCoordinator } | undefined;
    /** Geschrieben (Landschaft): Kachelrevision, Fenster und Liste neu. */
    geschrieben(quittung: OperationReceipt, regionen: readonly string[]): void;
    melde(text: string, ton: "warning" | "success"): void;
    fetcher?: typeof fetch;
}

export interface UnterflaechenLauf {
    readonly regionId: string;
    readonly areaId: string;
    readonly name: string;
    readonly operation: "herausloesen" | "loeschen";
    readonly teile: readonly Polygon[];
    readonly revision: number;
    /** Das gewählte Stück (ab 0); vorgewählt das unter dem Rechtsklick. */
    readonly gewaehlt: number | undefined;
    readonly phase: "waehlt" | "schreibt";
}

export interface Unterflaechen {
    readonly laufend: Readonly<ShallowRef<UnterflaechenLauf | undefined>>;
    /** „Alle Unterflächen vereinigen“: sofort, ohne Wahl. `quelle`: die Art (ohne Angabe die Landschaft). */
    vereinige(start: { regionId: string; areaId: string }, quelle?: FlaechenSofort): Promise<void>;
    /** „Unterfläche herauslösen“ und „Unterfläche löschen …“: die Wahl auf der Karte, `punkt` in Kartenkoordinaten. */
    starte(
        start: {
            regionId: string;
            areaId: string;
            operation: "herausloesen" | "loeschen";
            punkt?: { x: number; y: number } | undefined;
        },
        quelle?: FlaechenSofort,
    ): Promise<void>;
    /** „Fertig“: schreibt mit dem gewählten Stück. */
    bestaetige(): Promise<void>;
    abbrechen(): boolean;
}

/** Das Stück unter einem Punkt (Kartenkoordinaten), sonst keins. */
export function stueckAn(teile: readonly Polygon[], punkt: { x: number; y: number }): number | undefined {
    const i = teile.findIndex((polygon) =>
        pointInGeometry([punkt.x, punkt.y], {
            type: "Polygon",
            coordinates: polygon.map((ring) => ring.map(([x, y]) => [x, y])),
        }),
    );
    return i < 0 ? undefined : i;
}

const alsFeatures = (teile: readonly Polygon[], gewaehlt: number | undefined) => ({
    type: "FeatureCollection" as const,
    features: teile.map((polygon, i) => ({
        type: "Feature" as const,
        properties: { gewaehlt: i === gewaehlt },
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

export function createUnterflaechen(seite: UnterflaechenSeite): Unterflaechen {
    const regionenVon = (quittung: OperationReceipt): string[] => [
        ...new Set(quittung.affected.filter((x) => x.kind === "landscape").map((x) => x.id)),
    ];
    const landschaft: FlaechenSofort = {
        ...landschaftSofort({ fetcher: seite.fetcher }),
        geschrieben: (quittung) => seite.geschrieben(quittung, regionenVon(quittung)),
    };
    const laufend = shallowRef<UnterflaechenLauf | undefined>(undefined);
    /** Die Art des laufenden Modus. */
    let art: FlaechenSofort = landschaft;
    let ende: (() => void) | undefined;
    let karte: MapLibreMap | undefined;

    function zeichne(): void {
        const lauf = laufend.value;
        (karte?.getSource(QUELLE) as GeoJSONSource | undefined)?.setData(
            alsFeatures(lauf?.teile ?? [], lauf?.gewaehlt),
        );
    }

    function schichten(map: MapLibreMap): () => void {
        map.addSource(QUELLE, { type: "geojson", data: alsFeatures([], undefined) });
        // Legacy: alle Stücke blau umrissen, das gewählte kräftig (`ecosystem-subarea--chosen`).
        map.addLayer({
            id: EBENEN.alle,
            type: "line",
            source: QUELLE,
            paint: { "line-color": canonColour("editEdge"), "line-width": 2, "line-dasharray": [3, 2] },
        });
        map.addLayer({
            id: EBENEN.gewaehlt,
            type: "line",
            source: QUELLE,
            filter: ["==", ["get", "gewaehlt"], true],
            paint: { "line-color": canonColour("mapSelection"), "line-width": 4 },
        });
        return () => {
            for (const id of Object.values(EBENEN)) if (map.getLayer(id) !== undefined) map.removeLayer(id);
            if (map.getSource(QUELLE) !== undefined) map.removeSource(QUELLE);
        };
    }

    function setze(neu: Partial<UnterflaechenLauf>): void {
        const lauf = laufend.value;
        if (lauf === undefined) return;
        laufend.value = { ...lauf, ...neu };
        zeichne();
    }

    /** Die Teilfläche, wie die Art sie führt: Stücke, Revision, Name des Objekts. */
    async function lies(
        quelle: FlaechenSofort,
        regionId: string,
        areaId: string,
    ): Promise<SofortTeilflaeche | undefined> {
        try {
            const antwort = await quelle.lies(regionId, areaId);
            if (!antwort.ok) {
                seite.melde(antwort.satz, "warning");
                return undefined;
            }
            return antwort.wert;
        } catch {
            seite.melde(t("landschaftseditor.mitAnderer.offline"), "warning");
            return undefined;
        }
    }

    /** Schreibt die Unterflächen; gibt die Quittung oder nichts (dann ist schon gemeldet). */
    async function schreibe(
        quelle: FlaechenSofort,
        regionId: string,
        areaId: string,
        body: Omit<LandscapePartsBody, "areaId">,
    ) {
        try {
            const ergebnis = await quelle.teile(regionId, areaId, body);
            if (!ergebnis.ok) {
                seite.melde(ergebnis.satz, "warning");
                return undefined;
            }
            return ergebnis.wert;
        } catch {
            seite.melde(t("landschaftseditor.mitAnderer.offline"), "warning");
            return undefined;
        }
    }

    async function vereinige(start: { regionId: string; areaId: string }, quelle = landschaft): Promise<void> {
        const teil = await lies(quelle, start.regionId, start.areaId);
        if (teil === undefined) return;
        if (teil.teile.length < 2 && !quelle.vereinigtMitAnderen) {
            seite.melde(t("landschaftseditor.unterflaechen.nurEins"), "warning");
            return;
        }
        const quittung = await schreibe(quelle, start.regionId, start.areaId, {
            operationId: crypto.randomUUID(),
            operation: "vereinigen",
            baseRevision: teil.revision,
        });
        if (quittung === undefined) return;
        quelle.geschrieben(quittung, "unterflaechen");
        const nachher = quittung.partsAfter ?? 1;
        seite.melde(
            nachher === 1
                ? t("landschaftseditor.unterflaechen.vereinigtEins")
                : t("landschaftseditor.unterflaechen.vereinigt", {
                      vorher: String(quittung.partsBefore ?? teil.teile.length),
                      nachher: String(nachher),
                  }),
            "success",
        );
    }

    async function bestaetige(): Promise<void> {
        const lauf = laufend.value;
        if (lauf === undefined || lauf.gewaehlt === undefined || lauf.phase !== "waehlt") return;
        const quelle = art;
        setze({ phase: "schreibt" });
        const quittung = await schreibe(quelle, lauf.regionId, lauf.areaId, {
            operationId: crypto.randomUUID(),
            operation: lauf.operation,
            baseRevision: lauf.revision,
            part: lauf.gewaehlt,
        });
        if (quittung === undefined) {
            setze({ phase: "waehlt" });
            return;
        }
        beende();
        quelle.geschrieben(quittung, "unterflaechen");
        seite.melde(
            lauf.operation === "herausloesen"
                ? t(quelle.saetze.herausgeloest)
                : t("landschaftseditor.unterflaechen.geloescht"),
            "success",
        );
    }

    function beende(): void {
        ende?.();
        ende = undefined;
        karte = undefined;
        laufend.value = undefined;
    }

    async function starte(
        start: {
            regionId: string;
            areaId: string;
            operation: "herausloesen" | "loeschen";
            punkt?: { x: number; y: number } | undefined;
        },
        quelle = landschaft,
    ): Promise<void> {
        if (laufend.value !== undefined) return;
        const teil = await lies(quelle, start.regionId, start.areaId);
        if (teil === undefined) return;
        if (teil.teile.length < 2) {
            seite.melde(t("landschaftseditor.unterflaechen.nurEins"), "warning");
            return;
        }
        const k = seite.karte();
        if (k === undefined || laufend.value !== undefined) return;
        const beleg = belegeGeometrie(quelle.werkzeug);
        if (beleg === undefined) return;
        art = quelle;
        karte = k.map;
        const unterZeiger = (lngLat: { lng: number; lat: number }): number | undefined => {
            const lauf = laufend.value;
            return lauf === undefined ? undefined : stueckAn(lauf.teile, fromRenderLngLat(space, lngLat));
        };
        const owner: InteractionOwner<Claim> = {
            id: "geometry-edit",
            priority: INTERACTION_PRIORITY["geometry-edit"],
            kinds: ["hover", "click"],
            layers: () => [],
            hit: (context) => (unterZeiger(context.lngLat) === undefined ? {} : { cursor: "pointer" }),
            apply(kind, _claim, context) {
                const lauf = laufend.value;
                const stueck = unterZeiger(context.lngLat);
                if (lauf === undefined || lauf.phase !== "waehlt" || stueck === undefined) return;
                // Zeigen wählt, der Klick nimmt das Stück darunter (Legacy: „der Klick nimmt, was hervorgehoben ist“).
                if (stueck !== lauf.gewaehlt) setze({ gewaehlt: stueck });
                if (kind === "click") void bestaetige();
            },
        };
        const weg = schichten(k.map);
        const anmeldung = meldeGeometrieAn(k.interaction, owner);
        ende = () => {
            anmeldung.ab();
            weg();
            beleg.frei();
        };
        laufend.value = {
            regionId: start.regionId,
            areaId: start.areaId,
            name: teil.name,
            operation: start.operation,
            teile: teil.teile,
            revision: teil.revision,
            gewaehlt: start.punkt === undefined ? 0 : (stueckAn(teil.teile, start.punkt) ?? 0),
            phase: "waehlt",
        };
        zeichne();
    }

    return {
        laufend,
        vereinige,
        starte,
        bestaetige,
        abbrechen() {
            if (laufend.value === undefined || laufend.value.phase === "schreibt") return false;
            beende();
            return true;
        },
    };
}
