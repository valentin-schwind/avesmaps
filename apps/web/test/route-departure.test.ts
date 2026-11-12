import { describe, expect, it } from "vitest";
import {
    canonicalSharePayload,
    type RouteClosure,
    type RouteDate,
    type RouteResponse,
    type SharePayload,
} from "@avesmaps3d/shared";
import {
    closureAnywayHead,
    closureHead,
    closureNotes,
    closureReason,
    closureRefusal,
    closureWayName,
    seasonalWayNotes,
} from "../src/route-planner/closure-notes.ts";
import { readPlannerLink, writePlannerLink } from "../src/route-planner/planner-link.ts";
import {
    clampStartDay,
    copyOptions,
    DEFAULT_OPTIONS,
    formatDate,
    formatDateRange,
    optionsSummary,
} from "../src/route-planner/planner-model.ts";
import { routeQuery } from "../src/route-planner/route-client.ts";

/**
 * Der Reisebeginn im Planer (WI-0038): Feld, Adresse, Kurzlink, Kalenderdaten und die Sperrhinweise
 * nach Legacys Variante C (`route-closures.js`, `route-plan-calendar.js`, avesmaps@770c80e).
 */

const date = (month: RouteDate["month"], day: number, extra: Partial<RouteDate> = {}): RouteDate => ({
    month,
    day,
    nameless: month === "",
    season: "winter",
    years_passed: 0,
    ...extra,
});

describe("Der Reisebeginn in Feld, Adresse und Anfrage", () => {
    it("ist ohne Wahl „Unbekannt“; der Tag wird auf 1 bis 30 geklemmt", () => {
        expect(DEFAULT_OPTIONS.departure).toBeNull();
        expect([0, 12.4, 31, Number.NaN].map((tag) => clampStartDay(tag))).toEqual([1, 12, 30, 1]);
        // An den Namenlosen Tagen gibt es nur fünf.
        expect([0, 3, 9, Number.NaN].map((tag) => clampStartDay(tag, "namenlos"))).toEqual([1, 3, 5, 1]);
    });

    it("liest Legacys startMonth und startDay; ein unbekannter Monat bleibt „Unbekannt“, ein Tag allein wirkt nicht", () => {
        expect(readPlannerLink("?route=A~B&startMonth=Firun&startDay=12").options.departure).toEqual({
            month: "firun",
            day: 12,
        });
        expect(readPlannerLink("?startMonth=firun").options.departure).toEqual({ month: "firun", day: 1 });
        expect(readPlannerLink("?startMonth=namenlos&startDay=3").options.departure).toEqual({
            month: "namenlos",
            day: 3,
        });
        expect(readPlannerLink("?startMonth=namenlos&startDay=9").options.departure?.day).toBe(5);
        expect(readPlannerLink("?startMonth=Namenlos").options.departure).toEqual({ month: "namenlos", day: 1 });
        expect(readPlannerLink("?startDay=25").options.departure).toBeNull();
        expect(readPlannerLink("?startMonth=praios&startDay=99").options.departure?.day).toBe(30);
    });

    it("schreibt den Tag nur mit dem Monat, und den 1. gar nicht", () => {
        const options = { ...copyOptions(DEFAULT_OPTIONS), departure: { month: "firun" as const, day: 12 } };
        expect(writePlannerLink(["A", "B"], options)).toBe("route=A~B&startMonth=firun&startDay=12");
        expect(writePlannerLink(["A", "B"], { ...options, departure: { month: "tsa", day: 1 } })).toBe(
            "route=A~B&startMonth=tsa",
        );
        expect(writePlannerLink(["A", "B"], { ...options, departure: { month: "namenlos", day: 3 } })).toBe(
            "route=A~B&startMonth=namenlos&startDay=3",
        );
        expect(writePlannerLink(["A", "B"], DEFAULT_OPTIONS)).toBe("route=A~B");
        expect(readPlannerLink(`?${writePlannerLink(["A", "B"], options)}`).options.departure).toEqual({
            month: "firun",
            day: 12,
        });
    });

    it("fragt den Server mit start_month und start_day - nur mit Reisebeginn", () => {
        const query = new URLSearchParams(
            routeQuery(["a", "b"], { ...copyOptions(DEFAULT_OPTIONS), departure: { month: "firun", day: 3 } }),
        );
        expect([query.get("start_month"), query.get("start_day")]).toEqual(["firun", "3"]);
        expect(new URLSearchParams(routeQuery(["a", "b"], DEFAULT_OPTIONS)).has("start_month")).toBe(false);
    });

    it("die eingeklappte Leiste sagt „ab 12. Firun“", () => {
        const options = { ...copyOptions(DEFAULT_OPTIONS), departure: { month: "firun" as const, day: 12 } };
        expect(optionsSummary(options).map((part) => part.text)).toContain("ab 12. Firun");
        expect(
            optionsSummary(DEFAULT_OPTIONS)
                .map((part) => part.text)
                .join(" "),
        ).not.toContain("ab ");
        const namenlos = { ...copyOptions(DEFAULT_OPTIONS), departure: { month: "namenlos" as const, day: 2 } };
        expect(optionsSummary(namenlos).map((part) => part.text)).toContain("ab 2. Namenloser Tag");
    });

    it("🔴 der Kurzlink trägt ihn mit; ohne ihn bleibt der gespeicherte Zustand wie vor WI-0038", () => {
        const payload: SharePayload = {
            v: 1,
            waypoints: ["p:1:2", "p:3:4"],
            options: {
                optimize: "fastest",
                minimizeTransfers: false,
                enabled: { land: true, river: true, sea: true },
                transports: { land: "groupFoot", river: "riverSailer", sea: "cargoShip" },
                hoursPerDay: 8,
            },
            view: { series: "modern", view: "standard", layer: "alle" },
        };
        expect(canonicalSharePayload({ ...payload, options: { ...payload.options, departure: null } })).toEqual(
            canonicalSharePayload(payload),
        );
        expect(
            canonicalSharePayload({
                ...payload,
                options: { ...payload.options, departure: { month: "firun", day: 3 } },
            }).options.departure,
        ).toEqual({ month: "firun", day: 3 });
    });
});

describe("Die Daten im Reiseplan", () => {
    it("„25. Firun“, am Namenlosen Tag „2. Namenloser Tag“", () => {
        expect(formatDate(date("firun", 25))).toBe("25. Firun");
        expect(formatDate(date("", 2))).toBe("2. Namenloser Tag");
    });

    it("zieht nur im selben Monat zusammen: „25.–27. Firun“, sonst „30. Firun – 2. Tsa“", () => {
        expect(formatDateRange(date("firun", 25), date("firun", 25))).toBe("25. Firun");
        expect(formatDateRange(date("firun", 25), date("firun", 27))).toBe("25.–27. Firun");
        expect(formatDateRange(date("firun", 30), date("tsa", 2))).toBe("30. Firun – 2. Tsa");
        expect(formatDateRange(date("rahja", 30), date("", 1))).toBe("30. Rahja – 1. Namenloser Tag");
        // Über den Jahreswechsel verschwiege die Kurzform ein ganzes Jahr.
        expect(formatDateRange(date("firun", 25), date("firun", 26, { years_passed: 1 }))).toBe(
            "25. Firun – 26. Firun",
        );
    });
});

describe("🔴 Die Sperrhinweise (Variante C, Owner 14.09.2026)", () => {
    const avoided: RouteClosure["avoided"][number] = {
        kind: "season",
        path_name: "Saljethweg",
        public_ids: ["p1", "p2"],
        subtype: "Pfad",
        transport: "lightRider",
        from_node: "Greifenfurt",
        open_from: { month: "praios", day: 1 },
        open_to: { month: "efferd", day: 30 },
        reached_on: date("firun", 1),
    };
    const closure = (extra: Partial<RouteClosure> = {}): RouteClosure => ({
        leg_index: 0,
        blocked: false,
        diverges_at_node: "Greifenfurt",
        diverges_at_node_id: "g",
        diverges_at_edge_id: "k2",
        avoided: [avoided],
        actual: { distance_units: 30, travel_hours: 121.4, total_hours: 361.4 },
        unrestricted: { distance_units: 20, travel_hours: 78.3, total_hours: 222.3 },
        ...extra,
    });
    const route = (extra: Partial<RouteResponse>): RouteResponse =>
        ({
            found: true,
            miles_per_unit: 3,
            legs: [{ from: "a", to: "b", segment_start: 0, segment_count: 3, distance_units: 0, travel_hours: 0 }],
            segments: [{ edge_id: "k1" }, { edge_id: "k2" }, { edge_id: "k3" }],
            stages: [
                { index: 0, segment_start: 0, segment_count: 1 },
                { index: 1, segment_start: 1, segment_count: 2 },
            ],
            ...extra,
        }) as unknown as RouteResponse;

    it("oben: DASS umgeleitet wurde, und um wie viele Tage (Schnellste) oder Meilen (Kürzeste)", () => {
        const umgeleitet = route({ closures: [closure()] });
        expect(closureHead(umgeleitet, "fastest")).toBe("Wegen einer Sperrung anders geführt · 5,8 Tage länger");
        expect(closureHead(umgeleitet, "shortest")).toBe("Wegen einer Sperrung anders geführt · 30,0 Meilen länger");
        const zwei = closure({ avoided: [avoided, { ...avoided, path_name: "Eisenstraße", public_ids: ["e"] }] });
        expect(closureHead(route({ closures: [zwei] }), "fastest")).toMatch(/^Wegen zweier Sperrungen/);
        expect(closureHead(route({}), "fastest")).toBeNull();
    });

    it("🔴 WI-0082: gesperrt, aber ohnehin gemieden - eigener Wortlaut, OHNE Zeitangabe", () => {
        const ohnehin = route({ closures: [closure({ avoided_anyway: true })] });
        // Der alte Kopfhinweis schweigt: Die Route ist nicht wegen der Sperrung länger.
        expect(closureHead(ohnehin, "fastest")).toBeNull();
        expect(closureAnywayHead(ohnehin)).toBe(
            "Ein Weg, den diese Reise sonst nähme, ist gesperrt — die Route meidet ihn ohnehin.",
        );
        // 🔴 Keine Zahl, keine Zeit, keine Anrede - obwohl `actual` und `unrestricted` weit auseinanderliegen.
        expect(closureAnywayHead(ohnehin)).not.toMatch(/\d/);
        const zwei = closure({
            avoided_anyway: true,
            avoided: [avoided, { ...avoided, path_name: "Eisenstraße", public_ids: ["e"] }],
        });
        expect(closureAnywayHead(route({ closures: [zwei] }))).toMatch(/^Zwei Wege/);
        // Der alte Fall bleibt der alte: ohne `avoided_anyway` sagt der zweite Wortlaut nichts.
        expect(closureAnywayHead(route({ closures: [closure()] }))).toBeNull();
        expect(closureAnywayHead(route({}))).toBeNull();
        // Der Vermerk am Abzweig entsteht in beiden Fällen gleich - er nennt Weg, Tag und Fenster.
        expect([...closureNotes(ohnehin).keys()]).toEqual([1]);
    });

    it("am Abzweig: die Etappe, die die Abzweigkante enthält, mit Weg und Grund", () => {
        const notes = closureNotes(route({ closures: [closure()] }));
        expect([...notes.keys()]).toEqual([1]);
        expect(`Gesperrt: ${closureWayName(avoided)} — ${closureReason(avoided)}.`).toBe(
            "Gesperrt: Saljethweg — am 1. Firun, befahrbar vom 1. Praios bis zum 30. Efferd.",
        );
        // Ohne gefundene Kante bleibt der Hinweis oben allein - kein Vermerk an einer geratenen Etappe.
        expect(closureNotes(route({ closures: [closure({ diverges_at_edge_id: "fremd" })] })).size).toBe(0);
    });

    it("ein unbenannter Weg heißt nach Wegart und Ort, nie nach einer Kreuzung", () => {
        expect(closureWayName({ ...avoided, path_name: "" })).toBe("Pfad ab Greifenfurt");
        expect(closureWayName({ ...avoided, path_name: "", from_node: "" })).toBe("Pfad");
    });

    it("unbenannte Wege derselben Art mit demselben Fenster sind EIN Weg („Seeweg ab Riva“, nicht zweimal)", () => {
        const see = { ...avoided, path_name: "", subtype: "Seeweg", transport: "cargoShip", from_node: "Riva" };
        const zu = route({
            found: false,
            reason: "season_closed",
            closures: [
                closure({
                    blocked: true,
                    actual: null,
                    avoided: [see, { ...see, public_ids: ["s2"], from_node: "" }],
                }),
            ],
        });
        expect(closureRefusal(zu, ["Riva", "Varmur"])?.avoided.map(closureWayName)).toEqual(["Seeweg ab Riva"]);
    });

    it("ohne Reisebeginn: jeder Weg mit Sperrzeit einmal, mit seinem Fenster", () => {
        const way = { ...avoided, kind: undefined, reached_on: undefined };
        const notes = seasonalWayNotes(route({ seasonal_ways: [way, way] }));
        expect(notes).toEqual([{ name: "Saljethweg", window: "befahrbar vom 1. Praios bis zum 30. Efferd" }]);
    });

    it("die Absage im Panel nennt die Etappe und die Gründe", () => {
        const zu = route({
            found: false,
            reason: "season_closed",
            failed_leg_index: 0,
            closures: [closure({ blocked: true, actual: null, diverges_at_edge_id: "" })],
        });
        expect(closureRefusal(zu, ["Greifenfurt", "Lowangen"])).toEqual({
            title: "Keine offene Route von Greifenfurt nach Lowangen",
            avoided: [avoided],
        });
        expect(closureRefusal(route({ found: false, reason: "network_disconnected" }), ["A", "B"])).toBeNull();
    });
});
