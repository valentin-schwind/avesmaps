import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RouteResponse, RouteTravelCosts, WaypointHit } from "@avesmaps3d/shared";
import { copyOptions, DEFAULT_OPTIONS, type PlannerOptions } from "../src/route-planner/planner-model.ts";
import { costView, travelCosts } from "../src/route-planner/travel-cost-view.ts";
import { createPlanner, type PlannerEffects, type PlannerMapState } from "../src/route-planner/use-planner.ts";
import { routeBorderFeatures } from "../src/map/route-layers.ts";

/**
 * 🔴 Der Browser wählt nur, der Server rechnet (WI-0065 U5, Hardening Review M3 „B′“). Drei Beweise, die einander nicht
 * brauchen:
 *
 * 1. **Ein Textwächter:** In `apps/web/src` steht keine Kostenrechnung und keine Grenzzählung mehr.
 * 2. **Eine gefälschte Antwort:** Trägt `travel_costs` absurde Zahlen, zeigt der Kasten genau diese - und nichts, was aus den
 *    Etappen derselben Antwort folgte. Damit ist bewiesen, dass er nichts nachrechnet.
 * 3. **Ein zurückgehaltener Neustart:** Solange eine neue Antwort aussteht, zeigt der Kasten die Zahlen der Route, die
 *    noch steht (Nebenbefund `use-planner.ts`: Er rechnete die alte Route mit den neuen Optionen).
 */

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const source = join(repositoryRoot, "apps/web/src");

/** Der Text ohne Kommentare: Ein Kommentar darf die Namen nennen, Code nicht. */
function code(path: string): string {
    return readFileSync(path, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .split("\n")
        .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
        .join("\n");
}

describe("🔴 Der Browser rechnet nicht mehr: der Textwächter", () => {
    const files = readdirSync(source, { recursive: true, encoding: "utf8" })
        .filter((path) => /\.(ts|vue)$/.test(path))
        .map((path) => join(source, path));

    it("in apps/web/src steht weder Kostenrechnung noch Nachtzählung noch Grenzzählung", () => {
        expect(files.length).toBeGreaterThan(50);
        const funde: string[] = [];
        for (const file of files) {
            const text = code(file);
            for (const name of ["buildTravelCosts", "buildRouteTravelCosts", "travelNights", "countBorderCrossings"]) {
                if (new RegExp(`\\b${name}\\b`).test(text)) funde.push(`${file}: ${name}`);
            }
            // Auch kein Import der Rechnung unter einem anderen Namen.
            if (/from\s+["'][^"']*travel-costs(\.ts)?["']/.test(text)) funde.push(`${file}: Import von travel-costs`);
            if (/from\s+["'][^"']*travel-borders(\.ts)?["']/.test(text))
                funde.push(`${file}: Import von travel-borders`);
        }
        expect(funde).toEqual([]);
    });

    it("der Wächter findet, was er finden soll (sonst prüfte er nichts)", () => {
        const probe = code(join(repositoryRoot, "apps/web/test/route-costs.test.ts"));
        expect(probe).toMatch(/\bbuildRouteTravelCosts\b/);
        // Kommentare zählen nicht: Die Kopfzeile der Ansicht nennt keinen der Namen im Code.
        expect(code(join(source, "route-planner/travel-cost-view.ts"))).not.toMatch(/buildTravelCosts/);
    });
});

/** Absurde Zahlen: Nichts in einer echten Reise ergäbe sie, und die Etappen unten ergäben ganz andere. */
function forged(): RouteTravelCosts {
    const level = (total: number, tolls: number) => ({
        rows: [
            { key: "lodging" as const, heller: 111, status: "SOURCE_RULE" as const, count: 9 },
            { key: "food" as const, heller: 222, status: "SOURCE_RULE" as const, count: 77 },
            { key: "tolls" as const, heller: tolls, status: "SOURCE_RULE" as const, count: 7 },
        ],
        nights: { inn: 9, open: 3, aboard: 1 },
        days: 77,
        mounts: 1,
        total,
        complete: true,
    });
    return {
        borders: {
            count: 7,
            harbour_toll_unknown: true,
            crossings: Array.from({ length: 7 }, (_, index) => ({
                from: {
                    id: `f${String(index)}`,
                    name: `Volles Reich ${String(index)}`,
                    short_name: `F${String(index)}`,
                },
                to: {
                    id: `t${String(index)}`,
                    name: `Volles Reich ${String(index + 1)}`,
                    short_name: `T${String(index)}`,
                },
                x: 10 * index,
                y: 5 * index,
            })),
        },
        territory_year_bf: 1049,
        by_lodging: {
            frei: level(1, 7),
            strohsack: level(22222, 35),
            bett: level(12345, 700),
            zimmer: level(999999, 3500),
        },
    };
}

/** Eine Antwort, deren Etappen und Strecke etwas ganz anderes ergäben als ihre Kosten. */
function answer(costs: RouteTravelCosts | undefined): RouteResponse {
    return {
        found: true,
        failed_leg_index: null,
        map_domain: "aventuria",
        travel_model_version: "v",
        routing_graph_revision: "r",
        waypoints: [
            { id: "id-Gareth", name: "Gareth" },
            { id: "id-Perricum", name: "Perricum" },
        ],
        legs: [],
        segments: [],
        distance_units: 3,
        travel_hours: 1,
        travel_days: 1,
        hours_per_day: 8,
        rest_hours: 0,
        total_hours: 1,
        miles_per_unit: 3,
        air_legs_units: [],
        stages: [
            {
                index: 0,
                leg_index: 0,
                segment_start: 0,
                segment_count: 1,
                type: "Strasse",
                transport: "groupFoot",
                flow_state: null,
                path_names: [],
                from: { point: "place", place_id: "a", name: "A", x: 0, y: 0 },
                to: { point: "place", place_id: "b", name: "B", x: 1, y: 1 },
                distance_units: 3,
                travel_hours: 1,
                rest_hours: 0,
            },
        ],
        warnings: [],
        ...(costs ? { travel_costs: costs } : {}),
    };
}

const withLodging = (lodging: PlannerOptions["lodging"]): PlannerOptions => ({
    ...copyOptions(DEFAULT_OPTIONS),
    lodging,
});

describe("🔴 Der Kasten zeigt, was der Server sagt - nicht, was die Etappen ergäben", () => {
    it("gefälschte Zahlen kommen unverändert an: Posten, Zoll, Summe und die Liste der Übertritte", () => {
        const view = costView(answer(forged()), withLodging("bett"));
        expect(view).not.toBeNull();
        expect(view?.lines.map((line) => [line.key, line.value])).toEqual([
            ["lodging", "1 D 1 S 1 H"],
            ["food", "2 D 2 S 2 H"],
            ["tolls", "7 D"],
        ]);
        expect(view?.lines.find((line) => line.key === "tolls")?.note).toBe("7 Landesgrenzen, als Söldner veranlagt");
        expect(view?.lines.find((line) => line.key === "tolls")?.extra).toBe("Hafenzoll nicht beziffert");
        expect(view?.total).toBe("123 D 4 S 5 H");
        expect(view?.borders?.count).toBe(7);
        expect(view?.borders?.steps.map((step) => `${step.from}>${step.to}`)).toEqual([
            "F0>T0",
            "F1>T1",
            "F2>T2",
            "F3>T3",
            "F4>T4",
            "F5>T5",
            "F6>T6",
        ]);
        // Die Nächte und Reisetage der Summe stammen ebenfalls aus der Antwort: 9 + 3 + 1 Nächte, 77 Tage.
        expect(view?.totalNote).toBe("13 Nächte, 77 Reisetage, mit Reittier");
    });

    it("ein Wechsel der Unterbringung zeigt die Zahlen der anderen Stufe - aus derselben Antwort, ohne Anfrage", () => {
        const route = answer(forged());
        const totals = (["frei", "strohsack", "bett", "zimmer"] as const).map(
            (level) => costView(route, withLodging(level))?.total,
        );
        expect(totals).toEqual(["1 H", "222 D 2 S 2 H", "123 D 4 S 5 H", "9.999 D 9 S 9 H"]);
        expect(travelCosts(route, withLodging("zimmer"))?.total).toBe(999999);
    });

    it("🔴 ohne travel_costs kein Kasten - keine Zahl statt einer geratenen (Flug, älterer Server)", () => {
        const route = answer(undefined);
        expect(travelCosts(route, DEFAULT_OPTIONS)).toBeNull();
        expect(costView(route, DEFAULT_OPTIONS)).toBeNull();
    });

    it("🔴 ohne abgeleitete Gebiete (borders null): der Zoll ist „nicht ermittelbar“, nie 0, und es gibt keine Liste", () => {
        const costs = forged();
        costs.borders = null;
        costs.territory_year_bf = null;
        for (const level of Object.values(costs.by_lodging)) {
            level.rows = level.rows.map((row) =>
                row.key === "tolls" ? { ...row, heller: null, status: "UNKNOWN" as const, count: 0 } : row,
            );
            level.complete = false;
        }
        const view = costView(answer(costs), withLodging("bett"));
        const tolls = view?.lines.find((line) => line.key === "tolls");
        expect(tolls).toMatchObject({ value: "?", note: "Grenzen hier nicht ermittelbar", unknown: true });
        expect(view?.totalNote).toContain("ohne Zölle");
        expect(view?.borders).toBeNull();
    });
});

function hit(name: string): WaypointHit {
    return { id: `id-${name}`, name, subtype: "dorf", hidden: false, x: 1, y: 2 };
}

function effectsSpy() {
    const maps: PlannerMapState[] = [];
    const addresses: string[] = [];
    const effects: PlannerEffects = {
        showOnMap: (state) => maps.push(state),
        fitRoute: () => undefined,
        showPlace: () => undefined,
        notify: () => undefined,
        writeAddress: (query) => addresses.push(query),
    };
    return { maps, addresses, effects };
}

const json = (body: unknown) =>
    Promise.resolve(
        new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
    );

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("🔴 Nebenbefund: während neu gerechnet wird, gehören Kasten und Route zusammen", () => {
    it("die Optionen ändern sich, die Antwort steht aus: der Kasten zeigt die Zahlen der Route, die noch steht - erst die Antwort ändert ihn", async () => {
        const first = forged();
        const second = forged();
        second.by_lodging.bett.total = 500;
        let release: (() => void) | undefined;
        let call = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn(() => {
                call += 1;
                if (call === 1) return json(answer(first));
                // Die zweite Antwort wird zurückgehalten, bis der Test sie freigibt.
                return new Promise<Response>((resolveResponse) => {
                    release = () => {
                        resolveResponse(
                            new Response(JSON.stringify(answer(second)), {
                                status: 200,
                                headers: { "content-type": "application/json" },
                            }),
                        );
                    };
                });
            }),
        );
        const { effects } = effectsSpy();
        const planner = createPlanner(effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        const total = () => {
            const route = planner.route.value;
            return route ? costView(route, planner.options)?.total : undefined;
        };
        expect(total()).toBe("123 D 4 S 5 H");

        // Reisestunden und Landmittel ändern: Es wird neu gerechnet, die alte Route steht gedimmt.
        planner.setOptions((options) => {
            options.hoursPerDay = 12;
            options.transports.land = "groupHorse";
        });
        await vi.waitFor(() => expect(planner.stale.value).toBe(true));
        expect(planner.status.value).toBe("loading");
        // Die Optionen sind schon die neuen, der Kasten noch der alte - seine Zahlen gehören zur Route, die steht.
        expect(planner.options.hoursPerDay).toBe(12);
        expect(total()).toBe("123 D 4 S 5 H");
        // Die Unterbringung wirkt sofort, auch jetzt (keine Anfrage).
        planner.setLodging("strohsack");
        expect(total()).toBe("222 D 2 S 2 H");
        planner.setLodging("bett");

        release?.();
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(planner.stale.value).toBe(false);
        expect(total()).toBe("5 D");
    });
});

describe("🔴 Z3 C: „auf der Karte zeigen“ legt Marken auf die Karte - reine Anzeige, nie im Link", () => {
    async function ready(costs: RouteTravelCosts | undefined) {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => json(answer(costs))),
        );
        const spy = effectsSpy();
        const planner = createPlanner(spy.effects);
        planner.setPlace(planner.waypoints[0]?.key ?? 0, hit("Gareth"));
        planner.setPlace(planner.addWaypoint(), hit("Perricum"));
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        return { planner, ...spy };
    }

    it("Vorgabe aus; an: ein Marker je Übertritt an seiner Stelle, in Reihenfolge; aus: keine", async () => {
        const { planner, maps } = await ready(forged());
        expect(planner.showBorders.value).toBe(false);
        expect(maps.at(-1)?.borders).toEqual([]);

        planner.setShowBorders(true);
        expect(planner.showBorders.value).toBe(true);
        expect(maps.at(-1)?.borders).toEqual(
            Array.from({ length: 7 }, (_, index) => expect.objectContaining({ x: 10 * index, y: 5 * index })),
        );
        // Die Karte bekommt daraus Punkte in Renderkoordinaten, einen je Übertritt.
        expect(routeBorderFeatures({ ...(maps.at(-1) as PlannerMapState) }).features).toHaveLength(7);

        planner.setShowBorders(false);
        expect(maps.at(-1)?.borders).toEqual([]);
        expect(routeBorderFeatures({ ...(maps.at(-1) as PlannerMapState) }).features).toEqual([]);
    });

    it("ohne Übertritte (0 Grenzen, null, kein travel_costs) bleibt das Häkchen aus - es gibt nichts zu zeigen", async () => {
        const none = forged();
        none.borders = { count: 0, harbour_toll_unknown: false, crossings: [] };
        const zero = await ready(none);
        zero.planner.setShowBorders(true);
        expect(zero.planner.showBorders.value).toBe(false);

        const unknown = forged();
        unknown.borders = null;
        const undetermined = await ready(unknown);
        undetermined.planner.setShowBorders(true);
        expect(undetermined.planner.showBorders.value).toBe(false);

        const flight = await ready(undefined);
        flight.planner.setShowBorders(true);
        expect(flight.planner.showBorders.value).toBe(false);
    });

    it("🔴 eine neue Anfrage nimmt die Marken sofort mit, und die neue Route beginnt wieder mit „aus“", async () => {
        const { planner, maps } = await ready(forged());
        planner.setShowBorders(true);
        expect(maps.at(-1)?.borders).toHaveLength(7);
        planner.setOptions((options) => {
            options.optimize = "shortest";
        });
        // Mit der Anfrage: gedimmte Route, keine Marken, Häkchen aus.
        const loading = maps.filter((state) => state.stale).at(-1);
        expect(loading?.borders).toEqual([]);
        expect(planner.showBorders.value).toBe(false);
        await vi.waitFor(() => expect(planner.status.value).toBe("ready"));
        expect(planner.showBorders.value).toBe(false);
        expect(maps.at(-1)?.borders).toEqual([]);
    });

    it("die Unterbringung wechselt die Zahlen, nicht die Marken: dieselbe Route, dieselben Übertritte", async () => {
        const { planner, maps } = await ready(forged());
        planner.setShowBorders(true);
        const before = maps.at(-1)?.borders;
        planner.setLodging("zimmer");
        expect(planner.showBorders.value).toBe(true);
        expect(maps.at(-1)?.borders).toEqual(before);
    });

    it("🔴 weder Adresse noch Kurzlink tragen das Häkchen (Legacy kennt es nicht)", async () => {
        const { planner, addresses } = await ready(forged());
        planner.setShowBorders(true);
        planner.setLodging("zimmer");
        for (const address of addresses) expect(address).not.toMatch(/border|grenz|show/i);
        expect(JSON.stringify(planner.shareState())).not.toMatch(/border|grenz|show/i);
    });

    it("keine Route mehr, keine Marken: Die Wegpunkte wegnehmen räumt sie ab", async () => {
        const { planner, maps } = await ready(forged());
        planner.setShowBorders(true);
        planner.clear();
        expect(planner.showBorders.value).toBe(false);
        expect(maps.at(-1)?.borders).toEqual([]);
        expect(maps.at(-1)?.route).toBeNull();
    });
});
