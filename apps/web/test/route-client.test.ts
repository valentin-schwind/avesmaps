import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_OPTIONS } from "../src/route-planner/planner-model.ts";
import { fetchRoute } from "../src/route-planner/route-client.ts";
import { melde, meldeEinmal } from "../src/besuch/besuch-melden.ts";

// Die Zählung läuft nur im Browser (`window`); hier steht an ihrer Stelle ein Horcher, der zeigt, WAS der Planer meldet.
// 🪤 `meldeEinmal` gehört mit in den Nachbau: Ein Modul-Mock ersetzt das GANZE Modul, und ein fehlender Export wäre im
// Produktionspfad `undefined` - der Test fiele an einer Stelle, die mit ihm nichts zu tun hat.
vi.mock("../src/besuch/besuch-melden.ts", () => ({ melde: vi.fn(), meldeEinmal: vi.fn() }));

/**
 * Absagen wegen Last (Betreiber 2026-09-27): Der Planer fragt selbst noch einmal, mit der Pause aus
 * `Retry-After`, und gibt nach drei Versuchen mit einem eigenen Satz auf.
 *
 * 🪤 `routing_timeout` zählt mit: Die 2 s des Servers schließen das Warten in der Schlange ein. Im
 * parallelen Volllauf der Browsertests traf es eine Route mit zwei Wegpunkten (route-departure.spec.ts:18).
 */

const ROUTE = {
    found: true,
    stages: [],
    // Die Wegpunkte der Antwort tragen die Namen, aus denen die Statistik „Start → Ziel" bildet (WI-0157).
    waypoints: [
        { id: "a", name: "Gareth" },
        { id: "b", name: "Perricum" },
        { id: "c", name: "Punin" },
    ],
};

const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Promise.resolve(
        new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
    );
const load = (error: "routing_busy" | "routing_timeout", retryAfter = "2") =>
    answer({ error }, 503, { "retry-after": retryAfter });

beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(melde).mockClear();
    vi.mocked(meldeEinmal).mockClear();
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Absage wegen Last", () => {
    it("fragt nach der Pause aus Retry-After selbst noch einmal und zeigt dann die Route", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockReturnValueOnce(load("routing_busy"))
            .mockReturnValueOnce(load("routing_timeout"))
            .mockReturnValueOnce(answer(ROUTE));
        vi.stubGlobal("fetch", fetch);

        const outcome = fetchRoute(["a", "b"], DEFAULT_OPTIONS);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetch, "vor Ablauf von Retry-After fragt er nicht").toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2000);

        await expect(outcome).resolves.toEqual({ ok: true, route: ROUTE });
        expect(fetch).toHaveBeenCalledTimes(3);
        // Dieselbe Anfrage, nicht eine neue Reise.
        expect(new Set(fetch.mock.calls.map(([url]) => String(url))).size).toBe(1);
    });

    it("gibt nach drei Absagen auf und sagt, warum", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => load("routing_timeout"));
        vi.stubGlobal("fetch", fetch);

        const outcome = fetchRoute(["a", "b"], DEFAULT_OPTIONS);
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(outcome).resolves.toEqual({ ok: false, message: "Route aufgrund von zu viel Last abgelehnt." });
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("wiederholt keine andere Absage", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => answer({ error: "no_offroad_route" }, 422));
        vi.stubGlobal("fetch", fetch);

        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toEqual({
            ok: false,
            message: "Dorthin führt kein Weg über Land.",
        });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("hört in der Pause auf, sobald der Planer die Anfrage verwirft", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => load("routing_busy"));
        vi.stubGlobal("fetch", fetch);
        const controller = new AbortController();

        const outcome = fetchRoute(["a", "b"], DEFAULT_OPTIONS, controller.signal);
        const verworfen = expect(outcome).rejects.toMatchObject({ name: "AbortError" });
        await vi.advanceTimersByTimeAsync(500);
        controller.abort();
        await verworfen;
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("🪤 wartet höchstens 5 s, auch wenn der Server mehr verlangt, und ohne Angabe 2 s", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockReturnValueOnce(load("routing_busy", "120"))
            .mockReturnValueOnce(answer({ error: "routing_busy" }, 503))
            .mockReturnValueOnce(answer(ROUTE));
        vi.stubGlobal("fetch", fetch);

        const outcome = fetchRoute(["a", "b"], DEFAULT_OPTIONS);
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(1);

        await expect(outcome).resolves.toEqual({ ok: true, route: ROUTE });
        expect(fetch).toHaveBeenCalledTimes(3);
    });
});

/**
 * Was der Planer der Statistik meldet (WI-0138 V11, WI-0157). Bis zum 2026-10-13 ging `melde("route")` ohne Ausprägung weg, und
 * der Server verwarf die Zeile still: Die Kennzahl „Routen geplant" stand still, während `route_option` und `transport`
 * desselben Laufs weiterzählten. Hier steht, dass genau EINE `route`-Meldung je Lauf weggeht - und was in ihr steht.
 */
describe("Meldung an die Statistik", () => {
    const routeMeldungen = (): (string | undefined)[][] =>
        vi.mocked(melde).mock.calls.filter(([metrik]) => metrik === "route");

    it("meldet die Route als „Start → Ziel“ aus den Wegpunkten der Antwort, einmal je Lauf", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => answer(ROUTE)),
        );

        await expect(fetchRoute(["a", "c"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: true });

        // 🔴 Start und Ziel, nie der Zwischenpunkt Perricum: jeder weitere Name vervielfachte die Zeilen.
        expect(routeMeldungen()).toEqual([["route", "Gareth → Punin"]]);
    });

    it("meldet die Route auch ohne Namen - die Kennzahl darf nicht an ihnen hängen", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => answer({ ...ROUTE, waypoints: [] })),
        );

        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: true });

        expect(routeMeldungen()).toEqual([["route", undefined]]);
    });

    /**
     * 🔴 WI-0159: Die Liste „Orte" (`route_waypoint`) stand leer, weil niemand sie meldete. Legacy zählte JEDEN Wegpunkt
     * (Gareth 3.617, Punin 1.774, Festum 1.707) - also auch die Zwischenpunkte, anders als bei `route`, das Start und Ziel
     * als ein Paar nennt.
     */
    it("meldet jeden angesteuerten Ort der Antwort, auch die Zwischenpunkte (WI-0159)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => answer(ROUTE)),
        );

        await expect(fetchRoute(["a", "b", "c"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: true });

        expect(vi.mocked(melde).mock.calls.filter(([metrik]) => metrik === "route_waypoint")).toEqual([
            ["route_waypoint", "Gareth"],
            ["route_waypoint", "Perricum"],
            ["route_waypoint", "Punin"],
        ]);
    });

    it("meldet keinen Ort für einen Wegpunkt ohne Ortsnamen - ein Kartenpunkt ist kein Ort", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() =>
                answer({
                    ...ROUTE,
                    waypoints: [
                        { id: "a", name: "Gareth" },
                        // Ein Kartenpunkt (`p:<x>:<y>`): Der Server gibt seine Kennung als Namen, kein Ort steht dort.
                        { id: "p:1234.5:678.9", name: "p:1234.5:678.9" },
                        { id: "", name: "" },
                    ],
                }),
            ),
        );

        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: true });

        // 🪤 Sichtbar vorher weg, nicht still am Riegel des Servers: Genau diese Naht hat WI-0157 gekostet.
        expect(vi.mocked(melde).mock.calls.filter(([metrik]) => metrik === "route_waypoint")).toEqual([
            ["route_waypoint", "Gareth"],
        ]);
    });

    /**
     * Die Reiseart „Flug": Sie steht nicht in `options.transports` (dort sind Land, Fluss und Meer), sondern kommt als
     * eigenes Flugmittel an `fetchRoute`. Einmal je Besuch, wie die Neigung daneben im Block „3D".
     */
    it("meldet den Flug nur, wo mit einem Flugmittel gerechnet wird (WI-0159)", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => answer(ROUTE)),
        );

        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: true });
        expect(vi.mocked(meldeEinmal).mock.calls, "eine Reise an Land ist kein Flug").toEqual([]);

        await expect(
            fetchRoute(["a", "b"], DEFAULT_OPTIONS, undefined, { profile: "drache", custom: undefined } as never),
        ).resolves.toMatchObject({ ok: true });
        // `meldeEinmal` hält die Zusage „einmal je Besuch"; der Planer gibt sie bei jedem Flug ab, und das ist richtig so.
        expect(vi.mocked(meldeEinmal).mock.calls).toEqual([["flight"]]);
    });

    it("meldet keine Route, wo der Router absagt - dort zählt nur der Fehlschlag", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => answer({ error: "no_offroad_route" }, 422)),
        );

        await expect(fetchRoute(["a", "b"], DEFAULT_OPTIONS)).resolves.toMatchObject({ ok: false });

        expect(routeMeldungen()).toEqual([]);
        expect(vi.mocked(melde).mock.calls).toContainEqual(["route_fail", "no_offroad_route"]);
    });
});

/**
 * Die Drossel vor der Anwendung (WI-0292, Vali 2026-11-09): Nginx antwortet je Adresse mit 429 `rate_limited` (`location @zu_viel`). Vorher meldete der Planer
 * „Die Route konnte nicht berechnet werden.“ und zählte `route_fail` „unbekannt“.
 */
describe("Die Drossel (429)", () => {
    const gedrosselt = () =>
        answer({ error: { code: "rate_limited", message: "Zu viele Anfragen. Bitte kurz warten." } }, 429, {
            "retry-after": "60",
        });

    it("🔴 eigener Satz, eigene Kennung, kein zweiter Versuch", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => gedrosselt());
        vi.stubGlobal("fetch", fetch);

        const outcome = await fetchRoute(["a", "b"], DEFAULT_OPTIONS);

        expect(outcome).toEqual({
            ok: false,
            message: "Zu viele Anfragen in kurzer Zeit. Nach ein paar Sekunden rechnet der Routenplaner wieder.",
        });
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(vi.mocked(melde).mock.calls).toContainEqual(["route_fail", "gedrosselt"]);
        expect(vi.mocked(melde).mock.calls).not.toContainEqual(["route_fail", "unbekannt"]);
    });
});
