import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope } from "vue";
import type { RouteLandscapesResponse, RouteResponse } from "@avesmaps3d/shared";
import {
    areasLid,
    candidateTypeLabel,
    fetchRouteLandscapes,
    frageBeigaben,
    landscapeLine,
    routeSprachen,
    stageLines,
    useRouteLandscapes,
} from "../src/route-planner/route-landscapes.ts";
import { ladeTafel, locale } from "../src/i18n/i18n.ts";
import { unterwegsAnfrage } from "../src/route-planner/stage-lore.ts";

/**
 * Die Zeilen „Landschaften auf der Route“ und „durch …“ (WI-0035): Legacys Regeln aus V10 „Führt durch“.
 */

const label = (type: string): string => ({ wald: "Wald", see: "See", gebirge: "Gebirge" })[type] ?? "";
const target = { label: "l", x: 1, y: 2, zoom: 5 };
const regions: RouteLandscapesResponse["regions"] = {
    farindel: { name: "Farindelwald", type: "wald", target },
    weiden: { name: "Weiden", type: "region", target: null },
    see1: { name: null, type: "see", target: null },
    see2: { name: null, type: "see", target },
    klein: { name: "Winzling", type: "wald", target: null },
    namenlos: { name: null, type: "", target: null },
};

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("Die Zeile der Landschaften", () => {
    it("behält für die Gesamtroute die erste Begegnung statt des größten Anteils bei", () => {
        const stages = [
            {
                length: 100,
                in: [
                    ["farindel", 10],
                    ["weiden", 90],
                ] as [string, number][],
            },
        ];
        expect(landscapeLine(stages, regions, label, "encounter").map((entry) => entry.name)).toEqual([
            "Farindelwald",
            "Weiden",
        ]);
    });

    it("nennt den Namen, sonst die Art, sortiert nach Anteil - und nichts unter 5 %", () => {
        const line = landscapeLine(
            [
                {
                    length: 100,
                    in: [
                        ["weiden", 100],
                        ["farindel", 60],
                        ["klein", 4],
                        ["namenlos", 50],
                    ],
                },
            ],
            regions,
            label,
        );
        expect(line.map((entry) => entry.name)).toEqual(["Weiden", "Farindelwald"]);
        expect(line[0]?.share).toBe(1);
        expect(line[1]).toMatchObject({ key: "farindel", art: "Wald", share: 0.6, target });
    });

    it("fasst gleiche Namen zusammen: zwei namenlose Seen sind „See“, und der Eintrag nimmt ein Ziel samt seiner Region", () => {
        const line = landscapeLine(
            [
                {
                    length: 10,
                    in: [
                        ["see1", 3],
                        ["see2", 4],
                    ],
                },
            ],
            regions,
            label,
        );
        // 🔴 Das Ziel kommt vom zweiten See - dann auch die Kennung: Es leuchtet der See, zu dem der Klick fliegt (WI-0043).
        expect(line).toEqual([{ key: "see2", name: "See", art: "", type: "see", share: 0.7, target }]);
    });

    it("rechnet die Route über alle Etappen und kappt den Anteil bei 100 %", () => {
        const stages = [
            { length: 50, in: [["weiden", 50]] as [string, number][] },
            {
                length: 50,
                in: [
                    ["weiden", 60],
                    ["farindel", 10],
                ] as [string, number][],
            },
        ];
        const line = landscapeLine(stages, regions, label);
        expect(line.map((entry) => [entry.name, entry.share])).toEqual([
            ["Weiden", 1],
            ["Farindelwald", 0.1],
        ]);
        expect(landscapeLine([{ length: 0, in: [] }], regions, label)).toEqual([]);
    });
});

/**
 * Die Sprachen der ganzen Route (WI-0261 O8, Bauvorlage: Probierseite „Sprachen unterwegs“ Fassung 2): Anteil = Länge der Etappen in der Sprachfläche
 * durch die ganze Strecke, die größte zuerst.
 */
describe("Die Sprachen der Route", () => {
    const sprache = (id: string, name: string, anteil: number) => ({
        ref: { kind: "sprache" as const, id },
        name,
        farbe: "#ffb901",
        anteil,
    });
    const leer = (length: number) => ({ length, in: [] as [string, number][] });

    it("gewichtet den Anteil jeder Etappe mit ihrer Länge und sortiert nach Anteil", () => {
        // Etappe 1 auf See (keine Sprache), Etappe 2 ganz Garethi, Etappe 3 halb Garethi, halb Tulamidya.
        const stages = [leer(10), leer(60), leer(30)];
        const liste = routeSprachen(stages, [
            [],
            [sprache("g", "Garethi", 1)],
            [sprache("t", "Tulamidya", 0.5), sprache("g", "Garethi", 0.5)],
        ]);
        expect(liste.map((s) => [s.name, Number(s.anteil.toFixed(2))])).toEqual([
            ["Garethi", 0.75],
            ["Tulamidya", 0.15],
        ]);
        expect(liste[0]!.ref).toEqual({ kind: "sprache", id: "g" });
    });

    it("ohne Sprachen oder ohne Strecke keine Liste", () => {
        expect(routeSprachen([leer(10)], undefined)).toEqual([]);
        expect(routeSprachen([leer(0)], [[sprache("g", "Garethi", 1)]])).toEqual([]);
    });
});

/**
 * 🔴 Der Deckel der Gegenden-Box bleibt mit Sprachen einzeilig (Betreiber 2026-11-01): Die Gebiete heißen dann kurz „Gebiete“. Ohne Sprachen bleibt er,
 * wie er war. Einzahl und Mehrzahl stimmen in jeder Verbindung.
 */
describe("Der Deckel mit Sprachen", () => {
    // Außer Deutsch kommt jede Tafel erst per `import()` (WI-0235).
    beforeAll(async () => {
        await Promise.all([ladeTafel("en"), ladeTafel("pl")]);
    });
    beforeEach(() => {
        locale.value = "de";
    });
    afterEach(() => {
        locale.value = "de";
    });

    it("deutsch: alle Fälle", () => {
        expect(areasLid(17, 4, 81)).toBe("17 Gegenden, 4 Sprachen und 81 Gebiete");
        expect(areasLid(1, 1, 1)).toBe("1 Gegend, 1 Sprache und 1 Gebiet");
        expect(areasLid(17, 4, 0)).toBe("17 Gegenden und 4 Sprachen");
        expect(areasLid(0, 4, 81)).toBe("4 Sprachen und 81 Gebiete");
        expect(areasLid(0, 1, 0)).toBe("1 Sprache");
        // Ohne Sprachen wie bisher.
        expect(areasLid(17, 0, 81)).toBe("17 Gegenden und 81 politische Gebiete");
        expect(areasLid(17, 0, 0)).toBe("17 Gegenden");
        expect(areasLid(0, 0, 1)).toBe("1 politisches Gebiet");
    });

    it("englisch und polnisch setzen ihre eigenen Formen ein", () => {
        locale.value = "en";
        expect(areasLid(17, 4, 81)).toBe("17 areas, 4 languages and 81 territories");
        locale.value = "pl";
        expect(areasLid(2, 2, 5)).toBe("2 tereny, 2 języki i 5 obszarów");
    });
});

describe("Die Art eines Kandidaten der Kartenauswahl", () => {
    it("🔴 eine Region ohne Art heißt „Region“ (Betreiber 2026-10-20: „Gjalskerland noch als Region bezeichnen“), andere Flächen ohne Art nichts", () => {
        expect(candidateTypeLabel({ kind: "landscape", type: "", layer: "derographisch" })).toBe("Region");
        expect(candidateTypeLabel({ kind: "landscape", type: "", layer: "vegetation" })).toBe("");
        expect(candidateTypeLabel({ kind: "landscape", type: "tiefebene", layer: "topographie" })).toBe("Tiefebene");
    });
});

describe("Die Linien je Etappe", () => {
    const route = {
        found: true,
        stages: [
            { segment_start: 0, segment_count: 2 },
            { segment_start: 2, segment_count: 1 },
        ],
        segments: [
            {
                geometry: {
                    coordinates: [
                        [0, 0],
                        [1, 0],
                    ],
                },
            },
            { geometry: { coordinates: [[1, 0]] } },
            {
                geometry: {
                    coordinates: [
                        [1, 0],
                        [1, 1],
                        [2, 1],
                    ],
                },
            },
        ],
    } as unknown as RouteResponse;

    it("nimmt die Abschnitte jeder Etappe, wie die Route sie fährt, und lässt Stücke ohne Länge weg", () => {
        expect(stageLines(route)).toEqual([
            [
                [
                    [0, 0],
                    [1, 0],
                ],
            ],
            [
                [
                    [1, 0],
                    [1, 1],
                    [2, 1],
                ],
            ],
        ]);
    });

    it("🔴 scheitert still: Ohne Antwort bleibt die Route, wie sie ist", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.reject(new TypeError("offline"))),
        );
        expect(await fetchRouteLandscapes(route)).toBeNull();
        vi.stubGlobal(
            "fetch",
            vi.fn(() => Promise.resolve(new Response("{}", { status: 503 }))),
        );
        expect(await fetchRouteLandscapes(route)).toBeNull();
    });
});

/**
 * Absage wegen Last (Befund 2026-10-03): Der Server lässt je Prozess zwei Abfragen zu und antwortet sonst sofort mit
 * 503 `busy` samt `Retry-After`. Der Browser fragt dann selbst noch einmal, wie beim Routing (Betreiber 2026-09-27),
 * nur ohne Meldung: Die Zeile kommt später oder gar nicht.
 */
describe("Absage wegen Last", () => {
    const route = { found: true, stages: [], segments: [] } as unknown as RouteResponse;
    const answer: RouteLandscapesResponse = { stages: [], regions: {} };
    const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
        Promise.resolve(
            new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
        );
    const busy = (retryAfter = "2") => reply({ error: "busy" }, 503, { "retry-after": retryAfter });

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("🔴 fragt nach der Pause aus Retry-After noch einmal und liefert dann die Landschaften", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockReturnValueOnce(busy())
            .mockReturnValueOnce(busy())
            .mockReturnValueOnce(reply(answer));
        vi.stubGlobal("fetch", fetch);

        const outcome = fetchRouteLandscapes(route);
        await vi.advanceTimersByTimeAsync(1999);
        expect(fetch, "vor Ablauf von Retry-After fragt er nicht").toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2000);

        await expect(outcome).resolves.toEqual(answer);
        expect(fetch).toHaveBeenCalledTimes(3);
        // Dieselbe Frage, nicht eine andere Route.
        expect(new Set(fetch.mock.calls.map(([, init]) => String(init?.body))).size).toBe(1);
    });

    it("gibt nach drei Absagen still auf", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => busy());
        vi.stubGlobal("fetch", fetch);

        const outcome = fetchRouteLandscapes(route);
        await vi.advanceTimersByTimeAsync(10_000);

        await expect(outcome).resolves.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("wiederholt keine andere Absage", async () => {
        for (const [body, status] of [
            [{ error: "database_unavailable" }, 503],
            [{ error: "too_long" }, 413],
            [{}, 503],
        ] as const) {
            const fetch = vi.fn<typeof globalThis.fetch>(() => reply(body, status, { "retry-after": "2" }));
            vi.stubGlobal("fetch", fetch);

            const outcome = fetchRouteLandscapes(route);
            await vi.advanceTimersByTimeAsync(10_000);

            await expect(outcome).resolves.toBeNull();
            expect(fetch, JSON.stringify(body)).toHaveBeenCalledTimes(1);
        }
    });

    it("hört in der Pause auf, sobald eine neue Route die Frage verwirft", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => busy());
        vi.stubGlobal("fetch", fetch);
        const controller = new AbortController();

        const outcome = fetchRouteLandscapes(route, controller.signal);
        await vi.advanceTimersByTimeAsync(500);
        controller.abort();
        await expect(outcome).resolves.toBeNull();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("🪤 hört auch auf, wenn der Planer abgebaut wird", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => busy());
        vi.stubGlobal("fetch", fetch);
        const shown = { ...route, stages: [{ segment_start: 0, segment_count: 0 }] } as unknown as RouteResponse;

        const scope = effectScope();
        scope.run(() => useRouteLandscapes(() => shown));
        await vi.advanceTimersByTimeAsync(500);
        expect(fetch).toHaveBeenCalledTimes(1);
        scope.stop();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

/**
 * Die Drossel (429) und die gemeinsame Frage (WI-0292, Vali 2026-11-09): Jede neue Route kostete drei Fragen in derselben Zone der Reise (Route, Landschaften, Unterwegs), nach
 * ein paar schnellen Änderungen war sie leer, und Landschaften und Unterwegs fielen bei 429 still weg.
 */
describe("Drossel und gemeinsame Frage (WI-0292)", () => {
    const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
        Promise.resolve(
            new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
        );
    const gedrosselt = () => reply({ error: { code: "rate_limited", message: "…" } }, 429, { "retry-after": "60" });
    /** Eine Route mit einer Etappe über einen Weg; je Fall ein neues Objekt, denn die Antwort wird am Objekt gemerkt. */
    const neueRoute = (): RouteResponse =>
        ({
            found: true,
            stages: [{ segment_start: 0, segment_count: 1 }],
            segments: [
                {
                    synthetic: false,
                    public_id: "00000000-0000-4000-8000-000000029201",
                    geometry: {
                        coordinates: [
                            [1, 0],
                            [1, 1],
                        ],
                    },
                },
            ],
        }) as unknown as RouteResponse;
    const UNTERWEGS = { revision: "0000000000aa", eintraege: [] };

    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("🔴 die Drossel fragt EINMAL still nach, nach höchstens 3 s statt der 60 aus Retry-After; ein zweites 429 gibt auf", async () => {
        const fetch = vi
            .fn<typeof globalThis.fetch>()
            .mockReturnValueOnce(gedrosselt())
            .mockReturnValueOnce(reply({ stages: [], regions: {} }));
        vi.stubGlobal("fetch", fetch);
        const outcome = fetchRouteLandscapes(neueRoute());
        await vi.advanceTimersByTimeAsync(2999);
        expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(outcome).resolves.toEqual({ stages: [], regions: {} });
        expect(fetch).toHaveBeenCalledTimes(2);

        const immer = vi.fn<typeof globalThis.fetch>(() => gedrosselt());
        vi.stubGlobal("fetch", immer);
        const vergeblich = fetchRouteLandscapes(neueRoute());
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(vergeblich).resolves.toBeNull();
        expect(immer).toHaveBeenCalledTimes(2);
    });

    it("🔴 Landschaften und Unterwegs im selben Zug: EINE Frage mit beiden Körpern; dieselbe Route fragt danach nicht mehr", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => reply({ stages: [], regions: {}, unterwegs: UNTERWEGS }));
        vi.stubGlobal("fetch", fetch);
        const route = neueRoute();
        const unterwegs = unterwegsAnfrage(route) ?? undefined;
        expect(unterwegs).toBeDefined();

        const landschaften = frageBeigaben(route, new AbortController().signal, { landschaften: true });
        const box = frageBeigaben(route, new AbortController().signal, { ...(unterwegs ? { unterwegs } : {}) });
        const [l, u] = await Promise.all([landschaften, box]);

        expect(fetch).toHaveBeenCalledTimes(1);
        const [url, init] = fetch.mock.calls[0] ?? [];
        expect(url).toBe("/api/route/landscapes");
        expect(JSON.parse(String(init?.body))).toEqual({ stages: stageLines(route), unterwegs });
        expect(l.landschaften).toMatchObject({ stages: [], regions: {} });
        expect(u.unterwegs).toEqual(UNTERWEGS);

        // Kommt dieselbe Route wieder (Speicher des Planers), kommen ihre Beigaben ohne Frage mit.
        await frageBeigaben(route, new AbortController().signal, { landschaften: true });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("bringt die Antwort kein Unterwegs mit (Schranke voll, voriges Release), fragt die Box selbst; nach der Drossel nicht", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => reply({ stages: [], regions: {} })),
        );
        const ohne = neueRoute();
        const [, u] = await Promise.all([
            frageBeigaben(ohne, new AbortController().signal, { landschaften: true }),
            frageBeigaben(ohne, new AbortController().signal, { unterwegs: { stages: [{ paths: [] }] } }),
        ]);
        expect(u.unterwegs, "undefined: die Box fragt einzeln").toBeUndefined();

        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>(() => gedrosselt()),
        );
        const voll = neueRoute();
        const beide = Promise.all([
            frageBeigaben(voll, new AbortController().signal, { landschaften: true }),
            frageBeigaben(voll, new AbortController().signal, { unterwegs: { stages: [{ paths: [] }] } }),
        ]);
        await vi.advanceTimersByTimeAsync(10_000);
        const [l2, u2] = await beide;
        expect(l2.landschaften).toBeNull();
        expect(u2.unterwegs, "null: kein zweiter Anlauf in die leere Zone").toBeNull();
    });

    it("fragt nur die Box, sendet die gemeinsame Frage nichts; die Box fragt einzeln wie vorher", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => reply({ stages: [], regions: {} }));
        vi.stubGlobal("fetch", fetch);
        const allein = await frageBeigaben(neueRoute(), new AbortController().signal, {
            unterwegs: { stages: [{ paths: [] }] },
        });
        expect(allein).toEqual({ landschaften: undefined, unterwegs: undefined });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("bricht erst ab, wenn kein Leser mehr wartet", async () => {
        const signale: AbortSignal[] = [];
        vi.stubGlobal(
            "fetch",
            vi.fn<typeof globalThis.fetch>((_url, init) => {
                if (init?.signal) signale.push(init.signal);
                return new Promise<Response>(() => undefined);
            }),
        );
        const route = neueRoute();
        const a = new AbortController();
        const b = new AbortController();
        void frageBeigaben(route, a.signal, { landschaften: true });
        void frageBeigaben(route, b.signal, { unterwegs: { stages: [{ paths: [] }] } });
        await vi.advanceTimersByTimeAsync(0);
        expect(signale).toHaveLength(1);
        a.abort();
        expect(signale[0]?.aborted).toBe(false);
        b.abort();
        expect(signale[0]?.aborted).toBe(true);
    });
});
