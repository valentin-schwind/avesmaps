import { afterEach, describe, expect, it } from "vitest";
import type { LoreRowView, RouteDate, RouteResponse, RouteStage, RouteStagePoint } from "@avesmaps3d/shared";
import { setLocale } from "../src/i18n/i18n.ts";
import { panelModelOf } from "../src/info-panel/panel-model.ts";
import type { PanelModel, RowModel, TextPart } from "../src/info-panel/panel-types.ts";
import type { LandscapeEntry, LandscapeLines } from "../src/route-planner/route-landscapes.ts";
import { env } from "./panel-fixtures.ts";

/**
 * Die Etappe im Infopanel (WI-0063 27.13): Kopf (Titel, Von → Bis als Links, Pfeile) und Feldliste aus dem, was der Planer von der Etappe
 * weiß - in seinen Worten und Formaten, ohne leere Zeile, mit Objektlinks, wo ein Name genau ein Objekt der Karte ist. Wie es aussieht und
 * sich verhält (mittig, Pfeile fest), prüft `e2e/info-panel-stage-head.spec.ts`.
 */

afterEach(() => setLocale("de"));

const GARETH = "80558060-4299-54aa-b520-814b10819885";
const PERRICUM = "9a1c6b0e-3d1f-4b7e-8a3f-0c2d4e6f8a10";
const WALD = "11111111-1111-4111-8111-111111111111";
const GOLDENE_AU = "22222222-2222-4222-8222-222222222222";
const REICH = "33333333-3333-4333-8333-333333333333";

const place = (name: string, id: string): RouteStagePoint => ({ point: "place", place_id: id, name, x: 1, y: 2 });
const exit: RouteStagePoint = { point: "exit", place_id: null, name: "", x: 1, y: 2 };

const date = (day: number, over: Partial<RouteDate> = {}): RouteDate => ({
    month: "firun",
    day,
    nameless: false,
    season: "winter",
    years_passed: 0,
    ...over,
});

const stageOf = (index: number, over: Partial<RouteStage> = {}): RouteStage => ({
    index,
    leg_index: 0,
    segment_start: 0,
    segment_count: 1,
    type: "Strasse",
    transport: "groupFoot",
    flow_state: null,
    path_names: ["Reichsstraße 1"],
    from: place("Gareth", GARETH),
    to: place("Perricum", PERRICUM),
    distance_units: 12,
    travel_hours: 8.2,
    rest_hours: 0,
    ...over,
});

/** Eine Reise hat immer ihre Teilstrecken; ohne sie gibt es keine Zeile „Teilstrecke n von m“ (WI-0079 §3). */
const routeOf = (...stages: RouteStage[]): RouteResponse =>
    ({ found: true, miles_per_unit: 1.5, legs: [], stages }) as unknown as RouteResponse;

const landscape = (key: string, name: string, over: Partial<LandscapeEntry> = {}): LandscapeEntry => ({
    key,
    name,
    art: "Wald",
    type: "wald",
    share: 0.5,
    target: { x: 1, y: 2, zoom: 5 },
    ...over,
});

const linesOf = (over: Partial<LandscapeLines> = {}): LandscapeLines => ({ route: [], stages: [[]], ...over });

const modelOf = (
    route: RouteResponse | null,
    lines: LandscapeLines | null = null,
    index = 0,
    air = "",
    /** Die Namen der Kartenpunkte des Planers (WI-0087 P9), dieselbe Quelle wie die Wegpunkteingabe. */
    pointNames: ReadonlyMap<string, string> = new Map(),
    /** Die Vorkommen je Etappe, wie das Panel sie abgefragt hat (WI-0106). */
    lore: ReadonlyMap<number, { rows: readonly LoreRowView[] }> = new Map(),
): PanelModel => {
    const result = panelModelOf(
        {
            ref: { kind: "routeStage", index, routeKey: "a~b" },
            key: `k${String(index)}`,
            title: undefined,
            status: "ready",
            answer: undefined,
        },
        route,
        env("legacy", [], lines, air, pointNames, lore),
    );
    if (result === undefined) throw new Error("kein Modell");
    return result;
};

const rowOf = (m: PanelModel, key: string): RowModel | undefined => m.rows.find((row) => row.key === key);
const textOf = (row: RowModel | undefined): string => {
    if (row === undefined) return "";
    if (row.value.kind === "text" || row.value.kind === "measure") return row.value.text;
    if (row.value.kind === "parts") return row.value.parts.map((part) => part.text).join("");
    return "";
};
/** Geschützte Leerzeichen und die Schriftvariante der Pfeile sind für die Lesbarkeit gleich, für den Vergleich nicht. */
const plain = (text: string): string => text.replace(/\u00a0/g, " ").replace(/\uFE0E/g, "");
const partsOf = (row: RowModel | undefined): TextPart[] => (row?.value.kind === "parts" ? row.value.parts : []);

describe("🔴 der Kopf: Titel, Von → Bis als Links, Pfeile", () => {
    const route = routeOf(stageOf(0), stageOf(1), stageOf(2, { to: exit }));

    it("Titel „Etappe n von m“; der Untertitel ist EINE Zeile Von, Pfeil, Bis - Orte sind Objektlinks", () => {
        const m = modelOf(route, null, 1);
        expect(m.header.title).toBe("Etappe 2 von 3");
        expect(m.header.subtitle).toHaveLength(1);
        const parts = m.header.subtitle[0]?.parts ?? [];
        expect(parts.map((part) => part.text)).toEqual(["Gareth", "\u00a0→ ", "Perricum"]);
        expect(parts[0]?.ref).toEqual({ kind: "place", id: GARETH });
        expect(parts[1]?.ref).toBeUndefined();
        expect(parts[2]?.ref).toEqual({ kind: "place", id: PERRICUM });
    });

    it("🔴 der Pfeil bleibt an der ersten Zeile hängen: geschütztes Leerzeichen davor, ein gewöhnliches dahinter", () => {
        const parts = modelOf(route).header.subtitle[0]?.parts ?? [];
        expect(parts[1]?.text).toBe("\u00a0→ ");
    });

    it("ein Ende ohne Ort („Kreuzung“, Abgangspunkt) bleibt Text; ein Kartenpunkt öffnet die Kartenstelle", () => {
        const last = modelOf(route, null, 2).header.subtitle[0]?.parts ?? [];
        expect(last[2]).toEqual({ text: "Kreuzung" });
        const withPoint = routeOf(
            stageOf(0, { to: { point: "point", place_id: "p:100.5:200.25", name: "Kartenpunkt", x: 1, y: 2 } }),
        );
        const parts = modelOf(withPoint).header.subtitle[0]?.parts ?? [];
        expect(parts[2]?.ref).toEqual({ kind: "mapPoint", x: 100.5, y: 200.25 });
    });

    it("die Pfeile: an der ersten Etappe ist ‹ gesperrt, an der letzten ›", () => {
        expect(modelOf(route, null, 0).header.stageNav).toMatchObject({ hasPrev: false, hasNext: true });
        expect(modelOf(route, null, 1).header.stageNav).toMatchObject({ hasPrev: true, hasNext: true });
        expect(modelOf(route, null, 2).header.stageNav).toMatchObject({ hasPrev: true, hasNext: false });
    });
});

describe("🔴 die Feldliste: jede Angabe des Planers, in seinen Worten, keine leere Zeile", () => {
    it("eine schlichte Etappe: Wegart, Wege, Transportmittel - sonst nichts", () => {
        const m = modelOf(routeOf(stageOf(0)));
        expect(m.rows.map((row) => [row.label, textOf(row)])).toEqual([
            ["Wegart", "Straße"],
            ["Wege", "Reichsstraße 1"],
            ["Transportmittel", "Reisegruppe zu Fuß"],
        ]);
    });

    it("🔴 Distanz, Reisezeit und Rastzeit stehen als Kacheln ÜBER der Feldliste, nicht doppelt darin (WI-0079 §3)", () => {
        const m = modelOf(routeOf(stageOf(0, { rest_hours: 3.5 })));
        expect(["type", "paths", "transport"].map((key) => rowOf(m, key)?.value.kind)).toEqual([
            "text",
            "text",
            "text",
        ]);
        expect(["distance", "travel", "rest"].map((key) => rowOf(m, key))).toEqual([undefined, undefined, undefined]);
    });

    it("keine Rast, keine Strecke, keine Zeit, kein Name: keine Zeile (und nie ein Platzhalter)", () => {
        const m = modelOf(
            routeOf(stageOf(0, { distance_units: 0, travel_hours: 0, rest_hours: 0, path_names: [], transport: "" })),
        );
        expect(m.rows.map((row) => row.key)).toEqual(["type"]);
    });

    it("🔴 keine Zeile ist leer: Beschriftung und Text stehen immer da", () => {
        const stage = stageOf(0, {
            rest_hours: 1,
            start_date: date(25),
            end_date: date(27),
            ground: { condition: "tiefschnee", percent: 30 },
            slope: {
                ascent_schritt: 1540,
                descent_schritt: 810,
                highest_schritt: 2000,
                steepest_grade: 0.21,
                extra_hours: 1.2,
                covered_miles: 10,
            },
        });
        const m = modelOf(routeOf(stage), linesOf({ stages: [[landscape(WALD, "Reichsforst")]], territories: [[]] }));
        for (const row of m.rows) {
            expect(row.label, row.key).not.toBe("");
            expect(textOf(row) || row.value.kind, row.key).not.toBe("");
        }
        expect(m.rows.map((row) => row.key)).toEqual([
            "type",
            "paths",
            "transport",
            "period",
            "ground",
            "slope",
            "landscapes",
            "territories",
        ]);
    });

    it("Reisebeginn: der Zeitraum der Etappe in den Worten des Planers (25.–27. Firun); ohne Reisebeginn keine Zeile", () => {
        expect(
            textOf(rowOf(modelOf(routeOf(stageOf(0, { start_date: date(25), end_date: date(27) }))), "period")),
        ).toBe("25.–27. Firun");
        expect(rowOf(modelOf(routeOf(stageOf(0))), "period")).toBeUndefined();
    });

    it("der Boden der Jahreszeit mit Prozent, wie die Etappenzeile des Planers; die Steigung als Satz mit Kosten", () => {
        const m = modelOf(
            routeOf(
                stageOf(0, {
                    ground: { condition: "aufgeweicht", percent: 12 },
                    slope: {
                        ascent_schritt: 1539,
                        descent_schritt: 809,
                        highest_schritt: 2000,
                        steepest_grade: 0.21,
                        extra_hours: 1.2,
                        covered_miles: 10,
                    },
                }),
            ),
        );
        expect(plain(textOf(rowOf(m, "ground")))).toBe("Aufgeweichter Boden +12 %");
        expect(rowOf(m, "ground")?.label).toBe("Boden");
        expect(plain(textOf(rowOf(m, "slope")))).toBe("max. 21 % Steigung, 1.540 ↑, 810 ↓ Schritt, kostet 1,2 h");
    });

    it("eine ebene Etappe (nichts bergauf, nichts bergab) hat keine Steigungszeile; unter drei Minuten schweigt auch der Flugzuschlag", () => {
        const flat = {
            ascent_schritt: 0,
            descent_schritt: 0,
            highest_schritt: 0,
            steepest_grade: 0,
            extra_hours: 0,
            covered_miles: 5,
        };
        expect(rowOf(modelOf(routeOf(stageOf(0, { slope: flat }))), "slope")).toBeUndefined();
        const tiny = modelOf(routeOf(stageOf(0, { air_extra: { extra_hours: 0.01, peak_schritt: 10 } })));
        expect(rowOf(tiny, "airExtra")).toBeUndefined();
    });

    it("Fortbewegung: auf dem Fluss mit der Strömung, im Flug das Flugmittel (auch das eigene mit dem Namen des Planers) und der Zuschlag", () => {
        const river = modelOf(
            routeOf(stageOf(0, { type: "Flussweg", transport: "riverBarge", flow_state: "upstream" })),
        );
        expect(textOf(rowOf(river, "transport"))).toBe("Flusskahn, flussaufwärts");
        const down = modelOf(routeOf(stageOf(0, { transport: "riverSailer", flow_state: "downstream" })));
        expect(textOf(rowOf(down, "transport"))).toBe("Flusssegler, flussabwärts");

        const flight = modelOf(
            routeOf(
                stageOf(0, { type: "Flug", transport: "griffin", air_extra: { extra_hours: 0.4, peak_schritt: 120 } }),
            ),
        );
        expect(textOf(rowOf(flight, "transport"))).toBe("Greif");
        expect(rowOf(flight, "airExtra")?.label).toBe("Flugzuschlag");
        expect(plain(textOf(rowOf(flight, "airExtra")))).toBe("+0,4 Std. über üblicher Flughöhe");
        const own = modelOf(routeOf(stageOf(0, { type: "Flug", transport: "custom" })), null, 0, "Mein Drache");
        expect(textOf(rowOf(own, "transport"))).toBe("Mein Drache");
        expect(textOf(rowOf(modelOf(routeOf(stageOf(0, { type: "Flug", transport: "custom" }))), "transport"))).toBe(
            "Eigenes Flugmittel",
        );
    });

    it("🔴 englisch: dieselben Zeilen in den Worten der englischen Tafel (Planerwörter wiederverwendet)", () => {
        setLocale("en");
        const m = modelOf(routeOf(stageOf(0, { rest_hours: 2 })));
        expect(m.rows.map((row) => row.label)).toEqual(["Way type", "Ways", "Transport"]);
        expect(
            m.header.stageHead?.figures.map((figure) => [figure.label, figure.value.zahl, figure.value.einheit]),
        ).toEqual([
            ["Miles", "18.00", ""],
            ["Travel time", "8.2", "h"],
            ["Rest time", "2.0", "h"],
        ]);
        expect(m.header.title).toBe("Stage 1 of 1");
    });
});

describe("🔴 der Kopf der Etappe: drei Kennzahlen, Teilstrecke und die geretteten Hinweise (WI-0079 §3, §4, §7a)", () => {
    it("die drei Kacheln: Distanz, Reisezeit, Rastzeit - Zahl und Einheit getrennt (Klappbox-Regel)", () => {
        const head = modelOf(routeOf(stageOf(0, { rest_hours: 3.5 }))).header.stageHead;
        expect(
            head?.figures.map((figure) => [figure.key, figure.label, figure.value.zahl, figure.value.einheit]),
        ).toEqual([
            // 🔴 Die Distanz trägt ihre Einheit in der BESCHRIFTUNG, die Zeiten in der Zahl (F5 = A, Bildvorgabe).
            ["distance", "Meilen", "18,00", ""],
            ["travel", "Reisezeit", "8,2", "h"],
            ["rest", "Rastzeit", "3,5", "h"],
        ]);
        expect(head?.figures.map((figure) => figure.icon.endsWith(".webp"))).toEqual([true, true, true]);
    });

    it("🔴 ohne Rast gibt es zwei Spalten, keine dritte mit einer Null (WI-0063 §27.13)", () => {
        const head = modelOf(routeOf(stageOf(0))).header.stageHead;
        expect(head?.figures.map((figure) => figure.key)).toEqual(["distance", "travel"]);
    });

    /**
     * 🔴 WI-0087 P9. `RouteLeg.from`/`to` tragen die WEGPUNKTSCHLÜSSEL der Anfrage, nicht Namen - gemessen an einer
     * echten Antwort: `from: "p:592.99:515.80"`, `to: "bf35ed1d-…"`. Ungefiltert stand genau das im Kopf.
     */
    const MARKT = "p:533.43:547.65";
    const DORF = "bf35ed1d-553a-4540-86cc-fee5111590bf";
    const dreiTeilstrecken = (over: Partial<RouteResponse> = {}): RouteResponse =>
        ({
            found: true,
            miles_per_unit: 1.5,
            legs: [
                { from: MARKT, to: DORF },
                { from: DORF, to: "p:600.00:500.00" },
            ],
            waypoints: [
                { id: MARKT, name: "Kartenpunkt" },
                { id: DORF, name: "Dragenfels" },
                { id: "p:600.00:500.00", name: "Kartenpunkt" },
            ],
            stages: [stageOf(0), stageOf(1, { leg_index: 1 })],
            ...over,
        }) as unknown as RouteResponse;

    it("die Teilstrecke steht nur bei mehr als zwei Wegpunkten", () => {
        expect(modelOf(routeOf(stageOf(0))).header.stageHead?.leg).toBeUndefined();
    });

    it("🔴 P9: die Teilstrecke nennt NAMEN, nicht die Schlüssel der Anfrage", () => {
        const head = modelOf(dreiTeilstrecken(), null, 1).header.stageHead;
        expect(head?.leg).toBe("Teilstrecke 2 von 2 · Dragenfels → Kartenpunkt");
        expect(head?.leg).not.toContain("p:");
        expect(head?.leg).not.toContain("bf35ed1d");
    });

    it("🔴 P9: der Name des Kartenpunkts kommt aus dem Planer, wie in der Wegpunkteingabe", () => {
        const namen = new Map([
            [MARKT, "Kartenpunkt bei Rabenfelde"],
            ["p:600.00:500.00", "Kartenpunkt bei Durân"],
        ]);
        const head = modelOf(dreiTeilstrecken(), null, 0, "", namen).header.stageHead;
        expect(head?.leg).toBe("Teilstrecke 1 von 2 · Kartenpunkt bei Rabenfelde → Dragenfels");
    });

    it("🔴 P9: ein Schlüssel ohne Namen lässt die Zeile WEG - nie eine Kennung im Text", () => {
        const route = dreiTeilstrecken({
            waypoints: [{ id: DORF, name: "Dragenfels" }],
        } as unknown as Partial<RouteResponse>);
        expect(modelOf(route, null, 0).header.stageHead?.leg).toBeUndefined();
        // Die Kennzahlen bleiben: Es entfällt nur die eine Zeile, nicht der Kopf.
        expect(modelOf(route, null, 0).header.stageHead?.figures.length).toBeGreaterThan(0);
    });

    it("🔴 der lange Querfeldein-Hinweis geht nicht verloren: er steht jetzt im Panel (WI-0079 §4)", () => {
        const kurz = modelOf(routeOf(stageOf(0, { type: "Querfeldein", distance_units: 12 })));
        expect(kurz.header.stageHead?.notes).toEqual([]);
        const lang = modelOf(routeOf(stageOf(0, { type: "Querfeldein", distance_units: 50 })));
        expect(lang.header.stageHead?.notes[0]).toContain("Lange Querfeldein-Strecke");
        expect(lang.header.stageHead?.notes[0]).toContain("75,00 Meilen");
    });

    it("Eiltempo (WI-0078): eine Zeile mit den Zahlen, nur wo es gegriffen hat", () => {
        expect(rowOf(modelOf(routeOf(stageOf(0))), "hurry")).toBeUndefined();
        const m = modelOf(routeOf(stageOf(0, { hurry: { distance_units: 5, saved_hours: 0.5, hurried_hours: 1 } })));
        expect(rowOf(m, "hurry")?.label).toBe("Eiltempo");
        expect(plain(textOf(rowOf(m, "hurry")))).toBe("7,50 von 18,00 Meilen · spart 0,5 Stunden");
    });
});

describe("🔴 Landschaften und Gebiete: aus dem, was der Planer schon abgefragt hat - als Objektlinks, wo eindeutig", () => {
    const route = routeOf(stageOf(0));

    it("solange die Abfrage läuft (oder scheiterte), fehlen beide Zeilen - ohne Platzhalter", () => {
        const m = modelOf(route, null);
        expect(rowOf(m, "landscapes")).toBeUndefined();
        expect(rowOf(m, "territories")).toBeUndefined();
        // Eine Antwort ohne Landschaften dieser Etappe und ohne gültige Gebietsableitung: ebenso keine Zeile.
        const empty = modelOf(route, linesOf({ stages: [[]], territories: null }));
        expect(rowOf(empty, "landscapes")).toBeUndefined();
        expect(rowOf(empty, "territories")).toBeUndefined();
    });

    it("jede Landschaft mit Ziel öffnet ihre Fläche über die Naht; „, “ dazwischen, in der Folge des Planers", () => {
        const m = modelOf(
            route,
            linesOf({
                stages: [[landscape(WALD, "Reichsforst"), landscape(GOLDENE_AU, "Goldene Au", { art: "Ebene" })]],
            }),
        );
        const row = rowOf(m, "landscapes");
        expect(row?.label).toBe("Derographie");
        expect(partsOf(row).map((part) => part.text)).toEqual(["Reichsforst", ", ", "Goldene Au"]);
        expect(partsOf(row).map((part) => part.ref)).toEqual([
            { kind: "area", id: WALD },
            undefined,
            { kind: "area", id: GOLDENE_AU },
        ]);
    });

    it("🔴 nie raten: eine Landschaft ohne Ziel und ein Name, der nur die Art ist („Wald“ für viele namenlose Wälder), bleiben Text", () => {
        const m = modelOf(
            route,
            linesOf({
                stages: [
                    [
                        landscape(WALD, "Reichsforst", { target: null }),
                        landscape(GOLDENE_AU, "Wald", { art: "" }),
                        landscape(REICH, "Goldene Au"),
                    ],
                ],
            }),
        );
        expect(partsOf(rowOf(m, "landscapes")).filter((part) => part.ref !== undefined)).toEqual([
            { text: "Goldene Au", ref: { kind: "area", id: REICH } },
        ]);
    });

    it("Gebiete: jedes ein Link auf sein Gebiet, Zeile für Zeile (lange Namen); wenige stehen offen", () => {
        const territories = [
            { id: REICH, name: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth" },
            { id: WALD, name: "Königreich Garetien", parentId: REICH },
        ];
        const m = modelOf(route, linesOf({ territories: [territories] }));
        const row = rowOf(m, "territories");
        expect(row?.label).toBe("Gebiete");
        expect(partsOf(row)).toEqual([
            { text: "Heiliges Neues Kaiserreich vom Greifenthron zu Gareth", ref: { kind: "territory", id: REICH } },
            { text: "Königreich Garetien", ref: { kind: "territory", id: WALD }, breakBefore: true },
        ]);
    });

    it("eine lange Kette steht im Deckel mit der Zahl; die Links bleiben darin", () => {
        const many = Array.from({ length: 7 }, (_, at) => ({
            id: `4444444${String(at)}-4444-4444-8444-444444444444`,
            name: `Baronie ${String(at)}`,
        }));
        const row = rowOf(modelOf(route, linesOf({ territories: [many] })), "territories");
        expect(row?.value).toMatchObject({
            kind: "lid",
            count: 7,
            unit: "politische Gebiete",
        });
        const parts = row?.value.kind === "lid" ? (row.value.fullParts ?? []) : [];
        expect(parts.map((part) => part.ref?.kind)).toEqual(Array.from({ length: 7 }, () => "territory"));
        // Genau vier stehen noch offen.
        const four = rowOf(modelOf(route, linesOf({ territories: [many.slice(0, 4)] })), "territories");
        expect(four?.value.kind).toBe("parts");
    });

    it("keine Gebiete heißt Niemandsland - die Zeile steht, mit dem Wort des Planers", () => {
        const m = modelOf(route, linesOf({ territories: [[]] }));
        expect(textOf(rowOf(m, "territories"))).toBe("Niemandsland");
    });

    it("die Zeilen gehören der gezeigten Etappe, nicht der ersten", () => {
        const two = routeOf(stageOf(0), stageOf(1));
        const lines = linesOf({
            stages: [[landscape(WALD, "Reichsforst")], [landscape(GOLDENE_AU, "Goldene Au")]],
            territories: [[], [{ id: REICH, name: "Mittelreich" }]],
        });
        const second = modelOf(two, lines, 1);
        expect(textOf(rowOf(second, "landscapes"))).toBe("Goldene Au");
        expect(textOf(rowOf(second, "territories"))).toBe("Mittelreich");
        expect(textOf(rowOf(modelOf(two, lines, 0), "territories"))).toBe("Niemandsland");
    });
});

describe("🔴 Die Vorkommen der Etappe (WI-0106): vier Zeilen am ENDE der Feldliste", () => {
    const route = routeOf(stageOf(0), stageOf(1));
    const loreRow = (kind: LoreRowView["kind"], count: number, names: string[]): LoreRowView => ({
        kind,
        count,
        groups: names.length === 0 ? [] : [{ group: "region", entries: names.map((name) => ({ name })) }],
    });
    const lines = linesOf({
        stages: [[landscape(WALD, "Reichsforst")], []],
        territories: [[{ id: REICH, name: "Mittelreich" }], []],
    });

    it("stehen HINTER Landschaften und Gebieten - wie in Legacys Etappen-Infobox", () => {
        const answer = { rows: [loreRow("ware", 2, ["Salz"]), loreRow("fauna", 1, ["Wolf"])] };
        const m = modelOf(route, lines, 0, "", new Map(), new Map([[0, answer]]));
        expect(m.rows.map((row) => row.key)).toEqual([
            "type",
            "paths",
            "transport",
            "landscapes",
            "territories",
            "lore:ware",
            "lore:fauna",
        ]);
        const ware = rowOf(m, "lore:ware");
        expect(ware?.label).toBe("Waren");
        expect(ware?.value).toMatchObject({ kind: "lore", loreKind: "ware", count: 2 });
    });

    it("🪤 ohne Antwort gibt es keine Zeile und keinen Platzhalter - wie bei den Landschaften", () => {
        expect(modelOf(route, lines, 0).rows.filter((row) => row.key.startsWith("lore:"))).toEqual([]);
    });

    it("die Zeilen gehören der gezeigten Etappe, nicht der ersten", () => {
        const only = new Map([[1, { rows: [loreRow("flora", 1, ["Alraune"])] }]]);
        expect(modelOf(route, lines, 0, "", new Map(), only).rows.some((row) => row.key.startsWith("lore:"))).toBe(
            false,
        );
        expect(modelOf(route, lines, 1, "", new Map(), only).rows.map((row) => row.key)).toContain("lore:flora");
    });
});
