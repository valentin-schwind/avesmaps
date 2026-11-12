import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL as model,
    buildRouteTravelCosts,
    buildTravelCosts,
    coinParts,
    COST_STATUSES,
    LODGING_LEVELS,
    travelNights,
    type BorderCount,
    type LodgingLevel,
    type RouteStage,
    type TravelCostKey,
} from "../src/index.ts";

/**
 * Die Reisekosten je Person (WI-0042). Jede Zahl ist von Hand gerechnet: Heller aus der Tafel im
 * Reisemodell, Nächte aus der Uhr des Reiseplans. Legacys Fälle (`travel-costs.test.js`,
 * avesmaps@770c80e) prüfen dieselben Posten.
 */

type Stage = Pick<RouteStage, "type" | "transport" | "flow_state" | "distance_units" | "travel_hours">;

const stage = (
    type: string,
    transport: string,
    units: number,
    hours: number,
    flow: Stage["flow_state"] = null,
): Stage => ({
    type,
    transport,
    flow_state: flow,
    distance_units: units,
    travel_hours: hours,
});

/** Die Gesamte Reisezeit so, wie der Reiseplan sie rechnet: Reisestunden und Rast. */
const route = (stages: Stage[], restHours: number) => ({
    stages,
    total_hours: stages.reduce((sum, entry) => sum + entry.travel_hours, 0) + restHours,
});

const costs = (
    stages: Stage[],
    restHours: number,
    lodging: LodgingLevel,
    landTransport = "groupFoot",
    hoursPerDay = 8,
    borders?: { count: number } | null,
) => buildTravelCosts(model, route(stages, restHours), { lodging, landTransport, hoursPerDay }, borders);

/** Landesgrenzen mit Namen und Ort, wie `countBorderCrossings` sie liefert. */
const borders = (count: number, harbourTollUnknown = false): BorderCount => ({
    count,
    harbourTollUnknown,
    crossings: Array.from({ length: count }, (_, index) => ({
        from: { id: `a${String(index)}`, name: `Reich ${String(index)}`, shortName: `R${String(index)}` },
        to: { id: `a${String(index + 1)}`, name: `Reich ${String(index + 1)}`, shortName: `R${String(index + 1)}` },
        x: 100 + index,
        y: 50,
    })),
});

const row = (result: ReturnType<typeof costs>, key: TravelCostKey) => result.rows.find((entry) => entry.key === key);

// 20 Stunden Straße am 8-Stunden-Tag: drei Reisetage, zwei Nächte (je 16 Stunden Rast), 52 Stunden.
const strasse = [stage("Strasse", "groupFoot", 20, 20)];

describe("Die Nächte kommen aus der Uhr des Reiseplans", () => {
    it("zwei volle Tage und ein angebrochener: zwei Nächte, beide an der Straße", () => {
        expect(travelNights(model, strasse, 8)).toEqual(["Strasse", "Strasse"]);
    });

    it("wer genau mit dem Reisetag ankommt, rastet nicht mehr", () => {
        expect(travelNights(model, [stage("Strasse", "groupFoot", 8, 8)], 8)).toEqual([]);
    });

    it("🔴 endet der Tag mit einer Etappe, zählt ihr Dach - nicht das der nächsten", () => {
        const stages = [stage("Strasse", "groupFoot", 8, 8), stage("Pfad", "groupFoot", 4, 4)];
        expect(travelNights(model, stages, 8)).toEqual(["Strasse"]);
    });

    it("24 Reisestunden je Tag heißt keine Rast und keine Nacht", () => {
        expect(travelNights(model, strasse, 24)).toEqual([]);
    });

    it("der Schnellsegler auf See schläft an Bord und bucht keine Rast", () => {
        expect(travelNights(model, [stage("Seeweg", "fastShip", 100, 50)], 8)).toEqual([]);
    });
});

describe("🔴 Die Posten je Person (Tafel im Reisemodell)", () => {
    it("zu Fuß im Gemeinschaftszimmer: 2 × 6 H Bett, 3 × 8 H Verpflegung, kein Reittier", () => {
        const result = costs(strasse, 32, "bett");
        expect(result.nights).toEqual({ inn: 2, open: 0, aboard: 0 });
        expect(result.days).toBe(3);
        expect(result.mounts).toBe(0);
        expect(row(result, "lodging")).toMatchObject({ heller: 12, count: 2, status: "SOURCE_RULE" });
        expect(row(result, "food")).toMatchObject({ heller: 24, count: 3 });
        expect(row(result, "mount")).toBeUndefined();
        expect(result.total).toBe(36);
    });

    it("im Freien: kein Bett, 4 H Verpflegung je Tag", () => {
        const result = costs(strasse, 32, "frei");
        expect(result.nights).toEqual({ inn: 0, open: 2, aboard: 0 });
        expect(row(result, "lodging")?.heller).toBe(0);
        expect(row(result, "food")?.heller).toBe(12);
    });

    it("im Einzelzimmer: 3 S je Nacht, 17 H Verpflegung", () => {
        const result = costs(strasse, 32, "zimmer");
        expect(row(result, "lodging")?.heller).toBe(60);
        expect(row(result, "food")?.heller).toBe(51);
    });

    it("zu Pferd: Stall je Gasthausnacht und einmal Hufbeschlag (4 × 5 H)", () => {
        const result = costs([stage("Strasse", "groupHorse", 20, 20)], 32, "bett", "groupHorse");
        expect(result.mounts).toBe(1);
        expect(row(result, "mount")).toMatchObject({ heller: 2 * 6 + 20, count: 2 });
    });

    it("zu Pferd im Freien: eigenes Futter je Woche statt Stall", () => {
        const result = costs([stage("Strasse", "groupHorse", 20, 20)], 32, "frei", "groupHorse");
        // 5 H je Woche × 3/7 Wochen = 2,14 H, dazu 20 H Hufbeschlag.
        expect(row(result, "mount")?.heller).toBe(22);
    });

    it("auf dem Pfad gibt es kein Gasthaus: im Freien, auch mit Bett gewählt", () => {
        const result = costs([stage("Pfad", "groupFoot", 20, 20)], 32, "bett");
        expect(result.nights).toEqual({ inn: 0, open: 2, aboard: 0 });
        expect(row(result, "lodging")?.heller).toBe(0);
    });

    it("die Kutsche kauft die Fahrt: 4 D je 100 Meilen, ohne Reittier", () => {
        // 100 Einheiten sind 300 Meilen.
        const result = costs([stage("Strasse", "horseCarriage", 100, 40)], 64, "bett", "horseCarriage");
        expect(row(result, "coach")).toMatchObject({ heller: 1200, count: 300, status: "SOURCE_RULE" });
        expect(result.mounts).toBe(0);
    });

    it("🔴 Flusspassage: stromauf dreifach, das Tier zum Kahnpreis, die Kabine nur für den Menschen", () => {
        const stages = [
            stage("Flussweg", "riverSailer", 10, 5, "upstream"),
            stage("Flussweg", "riverSailer", 10, 3, "downstream"),
        ];
        // (30 + 30 × 3) / 100 = 1,2 Hundertmeilen.
        expect(row(costs(stages, 0, "bett"), "river")?.heller).toBe(120);
        expect(row(costs(stages, 0, "bett", "groupHorse"), "river")?.heller).toBe(240);
        expect(row(costs(stages, 0, "zimmer", "groupHorse"), "river")?.heller).toBe(1200 + 120);
    });

    it("eine unbekannte Strömung zählt als stromab", () => {
        expect(row(costs([stage("Flussweg", "riverSailer", 10, 3)], 0, "bett"), "river")?.heller).toBe(30);
    });

    it("Seepassage aus dem Beispiel Havena–Kuslik: 67 H je 100 Meilen, in der Kabine 416 H (eigene Setzung)", () => {
        const sea = [stage("Seeweg", "cargoShip", 200, 60)];
        expect(row(costs(sea, 0, "bett"), "sea")).toMatchObject({
            heller: 402,
            count: 600,
            status: "AVESMAPS_DECISION",
        });
        expect(row(costs(sea, 0, "zimmer"), "sea")?.heller).toBe(2496);
        expect(row(costs(sea, 0, "bett", "groupHorse"), "sea")?.heller).toBe(804);
    });

    it("an Bord kostet die Nacht kein Bett: Sie steckt in der Passage", () => {
        const result = costs([stage("Flussweg", "riverSailer", 40, 30)], 24, "bett");
        expect(result.nights.aboard).toBeGreaterThan(0);
        expect(result.nights.inn).toBe(0);
        expect(row(result, "lodging")?.heller).toBe(0);
    });
});

describe("🔴 Zölle ohne politische Karte (Betreiber 2026-09-26, K1)", () => {
    it("stehen als nicht ermittelbar da, zählen nicht als 0, und die Summe ist unvollständig", () => {
        const result = costs(strasse, 32, "bett");
        expect(row(result, "tolls")).toEqual({ key: "tolls", heller: null, status: "UNKNOWN", count: 0 });
        expect(result.complete).toBe(false);
        expect(result.total).toBe(36);
    });
});

describe("🔴 Zölle aus den Landesgrenzen (WI-0065): Tafel je Stufe mal Grenzen", () => {
    it("drei Grenzen: 3 H im Freien, 15 H im Schlafsaal, 3 D im Gemeinschaftszimmer, 15 D im Einzelzimmer", () => {
        const toll = (lodging: LodgingLevel) => row(costs(strasse, 32, lodging, "groupFoot", 8, borders(3)), "tolls");
        expect(toll("frei")).toEqual({ key: "tolls", heller: 3, status: "SOURCE_RULE", count: 3 });
        expect(toll("strohsack")).toEqual({ key: "tolls", heller: 15, status: "SOURCE_RULE", count: 3 });
        expect(toll("bett")).toEqual({ key: "tolls", heller: 300, status: "SOURCE_RULE", count: 3 });
        expect(toll("zimmer")).toEqual({ key: "tolls", heller: 1500, status: "SOURCE_RULE", count: 3 });
    });

    it("mit Grenzen ist die Summe vollständig und trägt den Zoll: 36 H Bett und Essen plus 3 D", () => {
        const result = costs(strasse, 32, "bett", "groupFoot", 8, borders(3));
        expect(result.complete).toBe(true);
        expect(result.total).toBe(36 + 300);
    });

    it("🔴 null Grenzen sind ein Ergebnis: 0 H mit Status aus der Quelle und vollständige Summe - nicht „nicht ermittelbar“", () => {
        const result = costs(strasse, 32, "zimmer", "groupFoot", 8, borders(0));
        expect(row(result, "tolls")).toEqual({ key: "tolls", heller: 0, status: "SOURCE_RULE", count: 0 });
        expect(result.complete).toBe(true);
    });

    it("🔴 ohne Angabe oder mit null bleibt der Zoll null und UNKNOWN, die Summe unvollständig (rückwärtskompatibel)", () => {
        for (const missing of [undefined, null]) {
            const result = costs(strasse, 32, "bett", "groupFoot", 8, missing);
            expect(row(result, "tolls")).toEqual({ key: "tolls", heller: null, status: "UNKNOWN", count: 0 });
            expect(result.complete).toBe(false);
            expect(result.total).toBe(36);
        }
    });

    it("der Zoll steht zuletzt, hinter allen anderen Posten, auch mit Zahl", () => {
        const result = costs([stage("Strasse", "horseCarriage", 100, 40)], 64, "bett", "horseCarriage", 8, borders(1));
        expect(result.rows.at(-1)?.key).toBe("tolls");
    });
});

describe("🔴 Alle vier Stufen für das Result des Servers (WI-0065, `travel_costs`)", () => {
    const journey = route(strasse, 32);
    const options = { landTransport: "groupFoot", hoursPerDay: 8 };

    it("jede Stufe ist genau das, was buildTravelCosts für sie liefert - der Server rechnet mit derselben Funktion", () => {
        const result = buildRouteTravelCosts(model, journey, options, borders(3), 1049);
        for (const lodging of LODGING_LEVELS) {
            expect(result.by_lodging[lodging], lodging).toEqual(
                buildTravelCosts(model, journey, { ...options, lodging }, borders(3)),
            );
        }
        expect(Object.keys(result.by_lodging)).toEqual([...LODGING_LEVELS]);
    });

    it("der Zoll je Stufe von Hand: 3 Grenzen ergeben 3 H · 15 H · 3 D · 15 D, die Nächte hängen an der Stufe", () => {
        const result = buildRouteTravelCosts(model, journey, options, borders(3), 1049);
        const tolls = LODGING_LEVELS.map((level) => row(result.by_lodging[level], "tolls")?.heller);
        expect(tolls).toEqual([3, 15, 300, 1500]);
        // Im Freien schläft niemand im Gasthaus, sonst zwei Nächte unter Dach.
        expect(result.by_lodging.frei.nights).toEqual({ inn: 0, open: 2, aboard: 0 });
        expect(result.by_lodging.bett.nights).toEqual({ inn: 2, open: 0, aboard: 0 });
    });

    it("die Landesgrenzen samt Ort und das Anzeigejahr stehen im Ergebnis", () => {
        const result = buildRouteTravelCosts(model, journey, options, borders(2), 1049);
        expect(result.borders?.count).toBe(2);
        expect(result.borders?.crossings).toEqual([
            {
                from: { id: "a0", name: "Reich 0", short_name: "R0" },
                to: { id: "a1", name: "Reich 1", short_name: "R1" },
                x: 100,
                y: 50,
            },
            {
                from: { id: "a1", name: "Reich 1", short_name: "R1" },
                to: { id: "a2", name: "Reich 2", short_name: "R2" },
                x: 101,
                y: 50,
            },
        ]);
        expect(result.territory_year_bf).toBe(1049);
    });

    it("🔴 ohne Grenzen (Gebiete nicht abgeleitet): borders und Jahr null, der Zoll in jeder Stufe null und UNKNOWN, keine Summe vollständig", () => {
        const result = buildRouteTravelCosts(model, journey, options, null, 1049);
        expect(result.borders).toBeNull();
        expect(result.territory_year_bf).toBeNull();
        for (const lodging of LODGING_LEVELS) {
            const costsOfLevel = result.by_lodging[lodging];
            expect(row(costsOfLevel, "tolls"), lodging).toEqual({
                key: "tolls",
                heller: null,
                status: "UNKNOWN",
                count: 0,
            });
            expect(costsOfLevel.complete, lodging).toBe(false);
        }
        // Auch ganz ohne Angabe.
        expect(buildRouteTravelCosts(model, journey, options).borders).toBeNull();
    });

    it("🔴 der Hinweis „Hafenzoll nicht beziffert“ (Z1 A+) reist mit den Grenzen: gesetzt bleibt gesetzt, sonst falsch", () => {
        expect(
            buildRouteTravelCosts(model, journey, options, borders(1, true), 1049).borders?.harbour_toll_unknown,
        ).toBe(true);
        expect(
            buildRouteTravelCosts(model, journey, options, borders(0, false), 1049).borders?.harbour_toll_unknown,
        ).toBe(false);
        // Der Hinweis ändert keinen Betrag: Er zählt keine Landesgrenze.
        const marked = buildRouteTravelCosts(model, journey, options, borders(2, true), 1049);
        const plain = buildRouteTravelCosts(model, journey, options, borders(2, false), 1049);
        expect(marked.by_lodging).toEqual(plain.by_lodging);
    });

    it("das Ergebnis teilt nichts mit der Eingabe: eine spätere Änderung an den Grenzen ändert es nicht", () => {
        const input = borders(1);
        const result = buildRouteTravelCosts(model, journey, options, input, 1049);
        input.crossings[0]!.from.name = "geändert";
        expect(result.borders?.crossings[0]?.from.name).toBe("Reich 0");
    });
});

describe("Die Tafel im Reisemodell", () => {
    it("jeder Posten trägt Status und Herkunft (Kap. 6.20); die Seereise ist unsere Setzung", () => {
        for (const [name, entry] of Object.entries(model.reisekosten)) {
            expect(COST_STATUSES, name).toContain(entry.status);
            expect(entry.herkunft.length, name).toBeGreaterThan(20);
        }
        expect(model.reisekosten.seepassage.status).toBe("AVESMAPS_DECISION");
    });
});

describe("Münzen", () => {
    it("1 Dukat = 10 Silbertaler = 100 Heller, gerundet auf ganze Heller", () => {
        expect(coinParts(1234)).toEqual({ ducats: 12, silver: 3, heller: 4 });
        expect(coinParts(7.6)).toEqual({ ducats: 0, silver: 0, heller: 8 });
        expect(coinParts(0)).toEqual({ ducats: 0, silver: 0, heller: 0 });
    });
});
