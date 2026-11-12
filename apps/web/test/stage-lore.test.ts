import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref, shallowRef } from "vue";
import {
    ROUTE_STAGE_LORE_LIMITS,
    ROUTE_STAGE_LORE_URL,
    type LoreRowView,
    type RouteResponse,
    type RouteStage,
} from "@avesmaps3d/shared";
import type { LoreRowValue } from "../src/info-panel/panel-types.ts";
import {
    fetchStageLore,
    stageLines,
    stageLoreRows,
    stagePathIds,
    useStageLore,
} from "../src/route-planner/stage-lore.ts";

/**
 * Die Vorkommen einer ROUTENETAPPE (WI-0106): die Etappe selbst ist der Träger, gesammelt aus den Wegen, über die sie läuft.
 *
 * 🔴 Geprüft wird vor allem, was NICHT passiert: keine Frage ohne gezeigte Etappe, keine zweite Frage für dieselbe Wegkette,
 * keine Antwort, die in den Speicher einer anderen Reise fällt, und kein Nachladen beim Aufklappen (die Zeile bringt die
 * Antwort mit).
 */

const uuid = (n: number): string => `11111111-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const segment = (publicId: string, over: Partial<{ synthetic: boolean }> = {}): unknown => ({
    public_id: publicId,
    path_name: "",
    subtype: "Strasse",
    synthetic: false,
    geometry: { type: "LineString", coordinates: [] },
    ...over,
});

const stage = (start: number, count: number): RouteStage =>
    ({ index: 0, segment_start: start, segment_count: count }) as unknown as RouteStage;

const routeOf = (segments: unknown[], ...stages: RouteStage[]): RouteResponse =>
    ({ found: true, segments, stages }) as unknown as RouteResponse;

const row = (kind: LoreRowView["kind"], count: number, names: string[]): LoreRowView => ({
    kind,
    count,
    groups: names.length === 0 ? [] : [{ group: "region", entries: names.map((name) => ({ name })) }],
});

const answer = (rows: LoreRowView[]): Response =>
    new Response(JSON.stringify({ revision: "0000000000aa", rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
    });

const busy = (): Response =>
    new Response(JSON.stringify({ error: "busy" }), { status: 503, headers: { "retry-after": "1" } });

describe("Welche Wege eine Etappe nennt", () => {
    it("🔴 alle echten Abschnitte ihres Ausschnitts, jeden einmal - nicht nur den mit gezeigtem Namen", () => {
        const route = routeOf([
            segment(uuid(1)),
            segment(uuid(2)),
            segment(uuid(2)),
            segment(uuid(3)),
            segment(uuid(9)),
        ]);
        expect(stagePathIds(stage(1, 3), route)).toEqual([uuid(2), uuid(3)]);
    });

    it("🪤 ein erzeugter Abschnitt und einer ohne Kennung fallen weg - eine Etappe ganz daraus fragt mit leerer Liste", () => {
        const route = routeOf([segment(uuid(1), { synthetic: true }), segment("")]);
        expect(stagePathIds(stage(0, 2), route)).toEqual([]);
    });

    it("🪤 der Deckel des Vertrags gilt auch hier - eine Anfrage, die das Schema abweist, wäre eine stumm fehlende Zeile", () => {
        const many = Array.from({ length: ROUTE_STAGE_LORE_LIMITS.paths + 10 }, (_item, at) => segment(uuid(at + 1)));
        expect(stagePathIds(stage(0, many.length), routeOf(many))).toHaveLength(ROUTE_STAGE_LORE_LIMITS.paths);
    });
});

describe("Welche Linien eine Etappe nennt (WI-0257 S2)", () => {
    const line = (coordinates: [number, number][]): unknown => ({
        public_id: "",
        synthetic: true,
        geometry: { type: "LineString", coordinates },
    });

    it("🔴 die Abschnitte OHNE Weg bringen ihren Verlauf mit, flach und auf zwei Stellen gerundet - die echten Wege nicht", () => {
        const route = routeOf([
            segment(uuid(1)),
            line([
                [452.84, 590.761],
                [451.641, 584.7814],
            ]),
        ]);
        expect(stageLines(stage(0, 2), route)).toEqual([[452.84, 590.76, 451.64, 584.78]]);
        // Der echte Weg trägt keine Linie: seine Geometrie steht auf dem Server.
        expect(stageLines(stage(0, 1), route)).toEqual([]);
    });

    it("ein Abschnitt ohne Verlauf (weniger als zwei Punkte) fällt weg", () => {
        expect(stageLines(stage(0, 1), routeOf([line([[1, 2]])]))).toEqual([]);
    });

    it("🪤 die Deckel des Vertrags gelten auch hier: höchstens 200 Stützpunkte je Linie (ausgedünnt, Anfang und Ende bleiben), höchstens 16 Linien", () => {
        const lang = Array.from({ length: 1000 }, (_item, at) => [at, 0] as [number, number]);
        const [eine] = stageLines(stage(0, 1), routeOf([line(lang)]));
        expect(eine).toHaveLength(ROUTE_STAGE_LORE_LIMITS.vertices * 2);
        expect(eine?.slice(0, 2)).toEqual([0, 0]);
        expect(eine?.slice(-2)).toEqual([999, 0]);
        const viele = Array.from({ length: ROUTE_STAGE_LORE_LIMITS.lines + 5 }, () =>
            line([
                [1, 1],
                [2, 2],
            ]),
        );
        expect(stageLines(stage(0, viele.length), routeOf(viele))).toHaveLength(ROUTE_STAGE_LORE_LIMITS.lines);
    });
});

describe("Die vier Zeilen aus der Antwort", () => {
    const rows = stageLoreRows({
        rows: [row("ware", 3, ["Salz", "Vieh"]), row("flora", 1, ["Alraune"])],
    });
    const value = (at: number): LoreRowValue => rows[at]?.value as LoreRowValue;

    it("stehen in der Reihenfolge der Antwort, mit Beschriftung und Zählsatz", () => {
        expect(rows.map((entry) => [entry.key, entry.label])).toEqual([
            ["lore:ware", "Waren"],
            ["lore:flora", "Flora"],
        ]);
        expect(value(0).sentence).toBe("3 Handelswaren gelistet");
        expect(value(1).sentence).toBe("1 Pflanzenart gesehen");
    });

    it("🔴 bringen die ganze Antwort mit und haben KEINE Adresse - eine Etappe ist kein Kartenobjekt", () => {
        expect(value(0).ref).toBeUndefined();
        // Die vier Zeilen EINER Etappe teilen EINEN Lauf: beide tragen dieselbe Antwort, nicht ihre eigene Zeile.
        expect(value(0).section).toBe(value(1).section);
        expect(value(0).section?.rows.map((entry) => entry.kind)).toEqual(["ware", "flora"]);
    });
});

describe("Die Frage an den Server", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("schickt die Wege als Körper an die eine Adresse", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer([row("ware", 1, ["Salz"])])));
        await expect(fetchStageLore([uuid(1)], undefined, fetch)).resolves.toEqual({
            revision: "0000000000aa",
            rows: [row("ware", 1, ["Salz"])],
        });
        expect(fetch.mock.calls[0]?.[0]).toBe(ROUTE_STAGE_LORE_URL);
        expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ paths: [uuid(1)] });
    });

    it("🔴 schickt die Linien der Abschnitte ohne Weg mit - und ohne Linien keinen Schlüssel `lines`", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer([])));
        await fetchStageLore([], undefined, fetch, [[1, 2, 3, 4]]);
        expect(JSON.parse(String((fetch.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
            paths: [],
            lines: [[1, 2, 3, 4]],
        });
        await fetchStageLore([uuid(1)], undefined, fetch, []);
        expect(JSON.parse(String((fetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ paths: [uuid(1)] });
    });

    it("fragt bei einer Absage wegen Last noch einmal, höchstens dreimal, und bleibt dann still", async () => {
        const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(busy()));
        const outcome = fetchStageLore([uuid(1)], undefined, fetch);
        await vi.advanceTimersByTimeAsync(10_000);
        await expect(outcome).resolves.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(3);
    });

    it("🔴 scheitert still: ein Fehler nimmt dem Panel nichts weg, er lässt nur die vier Zeilen fehlen", async () => {
        const kaputt = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(new Response("", { status: 500 })));
        await expect(fetchStageLore([], undefined, kaputt)).resolves.toBeNull();
        const weg = vi.fn<typeof globalThis.fetch>(() => Promise.reject(new Error("offline")));
        await expect(fetchStageLore([], undefined, weg)).resolves.toBeNull();
    });
});

describe("Die Vorkommen der gezeigten Etappe", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    const world = (): {
        route: RouteResponse;
        other: RouteResponse;
        fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
    } => {
        const segments = [segment(uuid(1)), segment(uuid(2))];
        return {
            route: routeOf(segments, stage(0, 1), stage(1, 1)),
            other: routeOf(segments, stage(0, 2)),
            fetch: vi.fn<typeof globalThis.fetch>(() => Promise.resolve(answer([row("ware", 1, ["Salz"])]))),
        };
    };

    it("🔴 fragt nichts, solange keine Etappe im Panel steht", async () => {
        const { route, fetch } = world();
        const scope = effectScope();
        const source = scope.run(() =>
            useStageLore(
                () => route,
                () => null,
                fetch,
            ),
        );
        await vi.advanceTimersByTimeAsync(100);
        expect(fetch).not.toHaveBeenCalled();
        expect(source?.stageLore(0)).toBeNull();
        scope.stop();
    });

    it("🔴 fragt einmal je Etappe und danach aus dem Speicher - der Weg zurück kostet nichts", async () => {
        const { route, fetch } = world();
        const shown = ref<number | null>(0);
        const scope = effectScope();
        const source = scope.run(() =>
            useStageLore(
                () => route,
                () => shown.value,
                fetch,
            ),
        );
        await vi.advanceTimersByTimeAsync(10);
        expect(source?.stageLore(0)?.rows.map((entry) => entry.kind)).toEqual(["ware"]);
        expect(fetch).toHaveBeenCalledTimes(1);

        shown.value = 1;
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(2);

        // Zurück zur ersten: dieselbe Wegkette, also keine zweite Frage.
        shown.value = 0;
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(source?.stageLore(0)).not.toBeNull();
        scope.stop();
    });

    it("🪤 eine andere Reise leert den Speicher - ihre Etappen sind andere", async () => {
        const { route, other, fetch } = world();
        const shown = shallowRef<RouteResponse>(route);
        const scope = effectScope();
        const source = scope.run(() =>
            useStageLore(
                () => shown.value,
                () => 0,
                fetch,
            ),
        );
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(1);

        shown.value = other;
        await vi.advanceTimersByTimeAsync(10);
        // Die Etappe 0 der neuen Reise läuft über ZWEI Wege: eine eigene Frage, eine eigene Antwort.
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(JSON.parse(String((fetch.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
            paths: [uuid(1), uuid(2)],
        });
        expect(source?.stageLore(0)).not.toBeNull();
        scope.stop();
    });

    it("🔴 bricht die Frage nach der alten Etappe ab, und der Abbau des Panels beendet sie ganz", async () => {
        const { route } = world();
        const fetch = vi.fn<typeof globalThis.fetch>(() => Promise.resolve(busy()));
        const shown = ref<number | null>(0);
        const scope = effectScope();
        scope.run(() =>
            useStageLore(
                () => route,
                () => shown.value,
                fetch,
            ),
        );
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(1);

        // Eine jüngere Etappe lässt die Wiederholung der älteren fallen (das Signal steckt in der Pause).
        shown.value = 1;
        await vi.advanceTimersByTimeAsync(10);
        expect(fetch).toHaveBeenCalledTimes(2);
        scope.stop();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
