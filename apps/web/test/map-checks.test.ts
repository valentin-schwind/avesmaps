import { nextTick, shallowRef } from "vue";
import { describe, expect, it } from "vitest";
import { createPropertyExpression, featureFilter, validateStyleMin } from "@maplibre/maplibre-gl-style-spec";
import type { CircleLayerSpecification, GeoJSONSourceSpecification, LayerSpecification } from "maplibre-gl";
import {
    canonColour,
    DEFAULT_LANDSCAPE_SELECTION,
    MAP_CHECKS_URL,
    type MapCheckResult,
    type MapView,
} from "@avesmaps3d/shared";
import type { AuthSnapshot } from "../src/auth/session-state.ts";
import {
    checksAllowedBySession,
    checksStorageKey,
    readStoredChecks,
    storeChecks,
    useMapChecks,
    type ChecksStorage,
    type MapCheckResults,
} from "../src/map/map-checks.ts";
import { CHECK_SOURCE, withMapChecks } from "../src/map/map-checks-layers.ts";
import { buildPlaceStyle, HAIRLINE_LAYER_ID } from "../src/map/place-layers.ts";
import { ortsnamenImStapel, propertySpec } from "./style-spec.ts";
import { EMPTY_ROUTE_LAYER, ROUTE_LINE_LAYER_ID, withRoute } from "../src/map/route-layers.ts";

/**
 * Die Prüfhaken im Auge (WI-0131 Stufe 1), im Browser.
 *
 * Problemfälle: ein Besucher lädt gemerkte Haken; ein gesperrter Speicher bricht die Karte; ein ausgeschalteter Haken zeichnet weiter;
 * „Keine Wiki-Zuweisung“ blendet einen Ort ein, den das Auge ausgeblendet hat; die Markierung sitzt im falschen Ton.
 * Soll: merken je Person, laden erst beim Einschalten, abbrechen beim Ausschalten, Ringe nur an sichtbaren Marken, Töne aus dem Kanon.
 */

function tafel(start: Record<string, string> = {}): ChecksStorage & { daten: Map<string, string> } {
    const daten = new Map(Object.entries(start));
    return {
        daten,
        getItem: (key) => daten.get(key) ?? null,
        setItem: (key, value) => void daten.set(key, value),
    };
}

const gesperrt: ChecksStorage = {
    getItem: () => {
        throw new Error("SecurityError");
    },
    setItem: () => {
        throw new Error("QuotaExceededError");
    },
};

describe("Prüfhaken merken, je Person", () => {
    it("liest nur bekannte Haken, in der Reihenfolge des Auges", () => {
        const key = checksStorageKey("p1");
        expect(key).toBe("avesmaps3d.pruefhaken.p1");
        expect(readStoredChecks(tafel({ [key]: '["no-wiki","kreuzungen",3,"uphill-rivers"]' }), key)).toEqual([
            "uphill-rivers",
            "no-wiki",
        ]);
        expect(readStoredChecks(tafel({ [key]: "{kaputt" }), key)).toEqual([]);
        expect(readStoredChecks(tafel(), key)).toEqual([]);
    });

    it("🪤 ein gesperrter Speicher wirft nicht, die Haken gelten dann bis zum Neuladen", () => {
        expect(readStoredChecks(gesperrt, "x")).toEqual([]);
        expect(() => storeChecks(gesperrt, "x", ["no-wiki"])).not.toThrow();
    });
});

/** Eine Sitzung, wie `/api/auth/session` sie meldet. */
function sitzung(over: Partial<AuthSnapshot> = {}): AuthSnapshot {
    return {
        known: true,
        authEnabled: true,
        environment: "development",
        person: { id: "p1" } as AuthSnapshot["person"],
        capabilities: ["use_editor_menu"],
        ...over,
    };
}

describe("Prüfhaken folgen der echten Sitzung (Fehlerbericht 2026-10-10)", () => {
    it("🔴 ohne Anmeldung keine Haken, auch wenn die Übergangsansicht `use_editor_menu` meldet: die Route verlangt eine Sitzung", () => {
        expect(checksAllowedBySession(sitzung({ person: null }))).toBe(false);
    });

    it("angemeldet nur mit dem Recht; ohne eingerichtete Anmeldung (lokal, Basic Auth) entscheidet die Ansicht", () => {
        expect(checksAllowedBySession(sitzung())).toBe(true);
        expect(checksAllowedBySession(sitzung({ capabilities: ["view_flow_directions"] }))).toBe(false);
        expect(checksAllowedBySession(sitzung({ authEnabled: false, person: null, capabilities: [] }))).toBe(true);
        expect(checksAllowedBySession(sitzung({ known: false, authEnabled: false, person: null }))).toBe(true);
    });
});

describe("Prüfhaken laden", () => {
    const antwort = (check: string): MapCheckResult =>
        check === "unconnected"
            ? { check: "unconnected", nodes: [{ id: "o1", kind: "place", name: "Ort", x: 1, y: 2 }] }
            : ({ check, places: [], paths: [] } as unknown as MapCheckResult);

    function abrufer() {
        const aufrufe: { url: string; init: RequestInit }[] = [];
        const fetcher = (url: string, init: RequestInit) => {
            aufrufe.push({ url, init });
            const check = url.slice(MAP_CHECKS_URL.length + 1);
            return Promise.resolve(new Response(JSON.stringify(antwort(check)), { status: 200 }));
        };
        return { aufrufe, fetcher };
    }

    it("🔴 eine Absage des Servers steht als Satz am Haken: 401/403 „Rechte“, sonst „Störung“; der Haken bleibt an", async () => {
        for (const [status, problem] of [
            [401, "rechte"],
            [403, "rechte"],
            [500, "stoerung"],
        ] as const) {
            const state = useMapChecks({
                allowed: true,
                personId: "p1",
                storage: tafel(),
                session: shallowRef(sitzung()),
                fetcher: () => Promise.resolve(new Response("{}", { status })),
            });
            state.enabled.value = ["unconnected"];
            await nextTick();
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(state.problems.value.unconnected, String(status)).toBe(problem);
            expect(state.enabled.value).toEqual(["unconnected"]);
            expect(state.results.value).toEqual({});
            state.enabled.value = [];
            await nextTick();
            expect(state.problems.value.unconnected, "ausgeschaltet heißt kein Satz mehr").toBeUndefined();
        }
    });

    it("🔴 ohne Anmeldung lädt auch ein gemerkter Haken nichts, solange die Sitzung fehlt", async () => {
        const { aufrufe, fetcher } = abrufer();
        const session = shallowRef(sitzung({ person: null }));
        const state = useMapChecks({
            allowed: true,
            personId: undefined,
            storage: tafel({ [checksStorageKey(undefined)]: '["unconnected"]' }),
            session,
            fetcher,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(aufrufe).toEqual([]);
        expect(state.enabled.value).toEqual([]);
    });

    it("🔴 ohne Recht: gemerkte Haken bleiben aus, nichts wird geladen", async () => {
        const { aufrufe, fetcher } = abrufer();
        const speicher = tafel({ [checksStorageKey("p1")]: '["unconnected"]' });
        const state = useMapChecks({ allowed: false, personId: "p1", storage: speicher, fetcher });
        await nextTick();
        expect(state.enabled.value).toEqual([]);
        expect(aufrufe).toEqual([]);
    });

    // 🪤 Jeder Fall bringt seine Sitzung mit: Ohne `session` liest `useMapChecks` den globalen `authState`, und den lässt im geteilten Prozess
    // (vor-dem-push, `--no-isolate`) eine frühere Datei abgemeldet zurück (`auth-einstieg.test.ts`; Wackler 2026-10-18, gemeldet von den
    // Herrschaftsgebieten, nachgestellt von der Arbeitshygiene).
    it("lädt beim Einschalten mit ETag-Nachfrage, merkt, und wirft beim Ausschalten weg", async () => {
        const { aufrufe, fetcher } = abrufer();
        const speicher = tafel();
        const state = useMapChecks({
            allowed: true,
            personId: "p1",
            storage: speicher,
            session: shallowRef(sitzung()),
            fetcher,
        });
        expect(aufrufe).toEqual([]);

        state.enabled.value = ["unconnected"];
        await nextTick();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(aufrufe.map((aufruf) => aufruf.url)).toEqual([`${MAP_CHECKS_URL}/unconnected`]);
        expect(aufrufe[0]?.init).toMatchObject({ cache: "no-cache", credentials: "same-origin" });
        expect(state.results.value.unconnected?.nodes).toHaveLength(1);
        expect(speicher.daten.get(checksStorageKey("p1"))).toBe('["unconnected"]');

        state.enabled.value = [];
        await nextTick();
        expect(state.results.value).toEqual({});
        expect(speicher.daten.get(checksStorageKey("p1"))).toBe("[]");
    });

    it("gemerkte Haken laden beim Start", async () => {
        const { aufrufe, fetcher } = abrufer();
        const state = useMapChecks({
            allowed: true,
            personId: "p1",
            storage: tafel({ [checksStorageKey("p1")]: '["unconnected"]' }),
            session: shallowRef(sitzung()),
            fetcher,
        });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(state.enabled.value).toEqual(["unconnected"]);
        expect(aufrufe).toHaveLength(1);
    });
});

describe("Prüfhaken auf der Karte", () => {
    const stil = () =>
        buildPlaceStyle({
            tileUrl: "/v/place/{z}/{x}/{y}",
            landscapeUrl: "/v/landscape/{z}/{x}/{y}",
            landscapeRunUrl: "/v/run/{z}/{x}/{y}",
            mapLabelUrl: "/v/label/{z}/{x}/{y}",
            climateUrl: "/v/climate/{z}/{x}/{y}",
            pathUrl: "/v/path/{z}/{x}/{y}",
            pathLabelUrl: "/v/path-label/{z}/{x}/{y}",
            powerlineUrl: "/v/powerline/{z}/{x}/{y}",
            leyNodeUrl: "/v/ley-node/{z}/{x}/{y}",
            basemap: undefined,
            seriesId: "original",
            view: "standard" as MapView,
            landscapeSelection: DEFAULT_LANDSCAPE_SELECTION,
        });
    const ALLE: MapCheckResults = {
        "uphill-rivers": {
            check: "uphill-rivers",
            rivers: [
                {
                    id: "f1",
                    name: "Bodrin",
                    rise: 12,
                    lines: [
                        [
                            [470, 515],
                            [471, 516],
                        ],
                    ],
                },
            ],
        },
        "loose-ends": {
            check: "loose-ends",
            paths: [
                {
                    id: "w1",
                    name: "Leuenach",
                    lines: [
                        [
                            [472, 517],
                            [473, 518],
                        ],
                    ],
                },
            ],
            ends: [{ x: 473, y: 518, path: "w1" }],
            absorbed_ends: 0,
            looped_paths: 0,
        },
        unconnected: { check: "unconnected", nodes: [{ id: "o1", kind: "place", name: "Âthykril", x: 474, y: 519 }] },
        "paths-apart": {
            check: "paths-apart",
            spots: [
                { kind: "offen", x: 475, y: 520, path: "w3", other: "w4", distance: 0.0004, near_miss: true },
                { kind: "offen", x: 476, y: 521, path: "w3", other: null, distance: null, near_miss: false },
            ],
            at_place: 0,
        },
        "no-wiki": { check: "no-wiki", places: ["o2"], paths: ["w2"] },
        "invalid-areas": {
            check: "invalid-areas",
            spots: [
                {
                    kind: "territory",
                    area: "f1",
                    owner: "g1",
                    name: "Baronie Wasserburg",
                    art: "schneidet_sich",
                    x: 601,
                    y: 521,
                },
                { kind: "landscape", area: "f2", owner: "l1", name: "Moor", art: "beruehrt_sich", x: 410, y: 445 },
            ],
        },
    };
    const layer = (layers: readonly LayerSpecification[], id: string) => layers.find((entry) => entry.id === id);

    it("ohne eingeschalteten Haken bleibt der Stil derselbe", () => {
        const vorher = stil();
        expect(withMapChecks(vorher, {})).toBe(vorher);
    });

    it("jede Markierung in ihrem Kanonton, und der Stil bleibt gültig", () => {
        const nachher = withMapChecks(stil(), ALLE);
        expect(validateStyleMin(nachher)).toEqual([]);
        const farbe = (id: string, key: string) =>
            (layer(nachher.layers, id) as { paint?: Record<string, unknown> } | undefined)?.paint?.[key];
        expect(farbe("check-uphill-river", "line-color")).toBe(canonColour("mapCheckUphill"));
        expect(farbe("check-loose-path", "line-color")).toBe(canonColour("mapCheckLoosePath"));
        expect(farbe("check-loose-end", "circle-stroke-color")).toBe(canonColour("mapCheckLoosePath"));
        expect(farbe("check-unconnected", "circle-stroke-color")).toBe(canonColour("mapCheckUnconnected"));
        expect(farbe("check-no-wiki-place", "circle-stroke-color")).toBe(canonColour("mapCheckNoWiki"));
        expect(farbe("check-paths-apart", "circle-stroke-color")).toBe(canonColour("mapCheckApart"));
        // Flächen kreuzen sich: das Zeichen, mit dem „Ecken bearbeiten“ eine abgelehnte Form markiert (Art `fehler`).
        expect(farbe("check-invalid-area", "circle-stroke-color")).toBe(canonColour("danger"));
        expect(farbe("check-invalid-area", "circle-color")).toBe(canonColour("danger"));
        expect(farbe("check-invalid-area-label", "text-color")).toBe(canonColour("danger"));
        expect(nachher.layers.some((entry) => entry.id.startsWith("check-no-wiki-path-"))).toBe(true);
        for (const source of Object.values(CHECK_SOURCE)) expect(nachher.sources[source]).toBeDefined();
    });

    /** Die Füllung eines Rings an einer Stelle oder einem zusammengefassten Ring: Hexwert, „leer“ bei Deckkraft 0. */
    function füllung(ring: CircleLayerSpecification, properties: Record<string, unknown>): string {
        const compiled = createPropertyExpression(
            ring.paint?.["circle-color"],
            "circle-color",
            propertySpec("paint_circle", "circle-color"),
        );
        if (compiled.result !== "success") throw new Error("circle-color ungültig");
        const colour = compiled.value.evaluate({ zoom: 5 }, { type: "Point", properties } as never) as {
            r: number;
            g: number;
            b: number;
            a: number;
        };
        if (colour.a === 0) return "leer";
        const hex = [colour.r, colour.g, colour.b].map((value) =>
            Math.round(value * 255)
                .toString(16)
                .padStart(2, "0"),
        );
        return `#${hex.join("")}`;
    }

    function apartStyle() {
        const apart = ALLE["paths-apart"];
        if (!apart) throw new Error("Funde fehlen");
        const style = withMapChecks(stil(), { "paths-apart": apart });
        const ring = layer(style.layers, "check-paths-apart") as CircleLayerSpecification | undefined;
        const halo = layer(style.layers, "check-paths-apart-halo") as CircleLayerSpecification | undefined;
        if (!ring || !halo) throw new Error("Ring fehlt");
        return { apart, ring, halo, style };
    }

    it("🔴 „Wege treffen sich nicht“: ein Ring je Stelle; „knapp verfehlt“ füllt ihn ganz aus, in Ton und Größe des Rings (Blatt, „ja B“)", () => {
        const { ring, halo, style } = apartStyle();
        const quelle = style.sources[CHECK_SOURCE.apart] as { data: { features: { properties: unknown }[] } };
        expect(quelle.data.features.map((feature) => feature.properties)).toEqual([
            { id: "w3", near: true },
            { id: "w3", near: false },
        ]);
        const ton = canonColour("mapCheckApart").toLowerCase();
        expect(füllung(ring, { near: true })).toBe(ton);
        expect(füllung(ring, { near: false })).toBe("leer");
        expect(ring.paint?.["circle-stroke-color"]).toBe(canonColour("mapCheckApart"));
        // Die Scheibe IST der Ring: kein zweiter, kleinerer Kreis, dieselbe weiße Unterlage, derselbe Radius.
        const ebenen = style.layers.filter((entry) => "source" in entry && entry.source === CHECK_SOURCE.apart);
        expect(ebenen.map((entry) => entry.id)).toEqual(["check-paths-apart-halo", "check-paths-apart"]);
        expect(halo.paint?.["circle-radius"]).toBe(ring.paint?.["circle-radius"]);
        expect(halo.paint?.["circle-stroke-color"]).toBe(canonColour("mapCheckHalo"));
        expect(füllung(halo, { near: true })).toBe("leer");
    });

    it("🔴 Doppelrand: fast deckungsgleiche Stellen zeigt die Anzeige als einen Ring; jede Stelle bleibt ein Fund, „knapp verfehlt“ geht auf den Ring über", () => {
        const { apart, ring, style } = apartStyle();
        const quelle = style.sources[CHECK_SOURCE.apart] as GeoJSONSourceSpecification & {
            data: { features: unknown[] };
        };
        expect(quelle.cluster).toBe(true);
        // Fangradius ist der Ringradius: Liegt eine Stelle im Rund des Rings einer anderen, steht dort ein Ring.
        expect(quelle.clusterRadius).toBe(ring.paint?.["circle-radius"]);
        expect(quelle.clusterProperties).toEqual({ near: ["any", ["==", ["get", "near"], true]] });
        // Zusammengefasst wird nur gezeichnet: Jede Stelle bleibt ein eigenes Feature der Quelle.
        expect(quelle.data.features).toHaveLength(apart.spots.length);
        const ton = canonColour("mapCheckApart").toLowerCase();
        expect(füllung(ring, { cluster: true, point_count: 2, near: true })).toBe(ton);
        expect(füllung(ring, { cluster: true, point_count: 2, near: false })).toBe("leer");
    });

    it("🔴 „Keine Wiki-Zuweisung“ färbt nur sichtbare Marken: der Filter ist der der Haarlinie, dazu die Kennung", () => {
        const basis = stil();
        const haarlinie = layer(basis.layers, HAIRLINE_LAYER_ID) as { filter: unknown };
        const ring = layer(withMapChecks(basis, ALLE).layers, "check-no-wiki-place") as unknown as { filter: never };
        const compiled = featureFilter(ring.filter, "filter");
        const trifft = (zoom: number, properties: Record<string, unknown>) =>
            compiled.filter({ zoom }, { type: 1, properties } as never, undefined as never);
        expect(trifft(9, { subtype: "stadt", public_id: "o2" })).toBe(true);
        expect(trifft(9, { subtype: "stadt", public_id: "o3" })).toBe(false);
        // Wo die Haarlinie den Ort nicht zeigt (Dörfer weit draußen), zeigt der Ring ihn auch nicht.
        const haarlinieTrifft = featureFilter(haarlinie.filter as never, "filter");
        expect(trifft(1, { subtype: "dorf", public_id: "o2" })).toBe(
            haarlinieTrifft.filter(
                { zoom: 1 },
                { type: 1, properties: { subtype: "dorf" } } as never,
                undefined as never,
            ),
        );
    });

    it("🔴 Linien unter der Route, Ringe über den Ortsmarken: keine Marke deckt ihren Ring zu", () => {
        const ids = withMapChecks(withRoute(stil(), EMPTY_ROUTE_LAYER), ALLE).layers.map((entry) => entry.id);
        const letzteMarke = Math.max(...ids.flatMap((id, index) => (id.startsWith("place-marker") ? [index] : [])));
        expect(ids.indexOf("check-uphill-river")).toBeLessThan(ids.indexOf(ROUTE_LINE_LAYER_ID));
        expect(ids.indexOf("check-loose-path")).toBeLessThan(ids.indexOf(ROUTE_LINE_LAYER_ID));
        for (const ring of ["check-unconnected", "check-loose-end", "check-paths-apart", "check-no-wiki-place"]) {
            expect(ids.indexOf(ring), ring).toBeGreaterThan(letzteMarke);
            expect(ids.indexOf(ring), ring).toBeLessThan(ortsnamenImStapel(ids).erste);
        }
    });

    it("Flächen kreuzen sich: je Stelle ein Ring, daneben Name und Grund in Worten; die Beschriftung zuoberst und ohne Verdrängen", () => {
        const nachher = withMapChecks(stil(), { "invalid-areas": ALLE["invalid-areas"]! });
        expect(validateStyleMin(nachher)).toEqual([]);
        const quelle = nachher.sources[CHECK_SOURCE.invalid] as GeoJSONSourceSpecification;
        const features = (quelle.data as { features: { properties: Record<string, unknown> }[] }).features;
        expect(features.map((f) => [f.properties["name"], f.properties["grund"], f.properties["owner"]])).toEqual([
            ["Baronie Wasserburg", "Kreuzt sich selbst", "g1"],
            ["Moor", "Berührt sich an einem Punkt", "l1"],
        ]);
        const ids = nachher.layers.map((entry) => entry.id);
        expect(ids.at(-1)).toBe("check-invalid-area-label");
        expect(ids.indexOf("check-invalid-area")).toBeGreaterThan(ids.lastIndexOf("place-marker"));
        expect(ids.indexOf("check-invalid-area")).toBeLessThan(ortsnamenImStapel(ids).erste);
        const label = layer(nachher.layers, "check-invalid-area-label") as { layout?: Record<string, unknown> };
        expect(label.layout?.["text-ignore-placement"]).toBe(true);
        expect(label.layout?.["text-allow-overlap"]).toBe(true);
    });

    it("die Ringe an Orten liegen über den Marken und unter den Namen", () => {
        const ids = withMapChecks(stil(), ALLE).layers.map((entry) => entry.id);
        const ring = ids.indexOf("check-no-wiki-place");
        expect(ring).toBeGreaterThan(ids.lastIndexOf("place-marker"));
        expect(ring).toBeLessThan(ortsnamenImStapel(ids).erste);
    });
});
