import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    allowedTransportsForPath,
    buildRouteStages,
    coastProfileOf,
    groundRequirement,
    seasonSnow,
    snowlineHeight,
    isRestExempt,
    pathSeasonWindow,
    RouteQuerystring,
    seaGraphTransport,
    seaGraphTransports,
    shipWaters,
    slopeFamily,
    stageDayHours,
    timeWeightFactor,
    transportFlowFactor,
    travelDayHours,
    travelNights,
    travelSpeed,
    TravelModel,
    type RouteSegment,
} from "../src/index.ts";

/**
 * Der Katalog der Transportmittel nach der Geographia (WI-0069). Quellen: GA S. 118-123 (Land), S. 129 (Fluss
 * und Binnensee), S. 131 (See); der 8-h-Landtag aus Wege des Entdeckers S. 160-162. Nichts davon kalibriert neu:
 * Die Werte der elf Legacy-Mittel bleiben wertgleich, die neuen folgen demselben Schema.
 */
const model = AVENTURIA_TRAVEL_MODEL;

describe("Der Katalog", () => {
    it("🔴 das Reisemodell ist gültig und kennt die neuen Mittel in der Reihenfolge des Planers", () => {
        expect(Value.Check(TravelModel, model)).toBe(true);
        expect(model.transportmittel.wert).toEqual({
            land: [
                "groupFoot",
                "lightWalker",
                "groupHorse",
                "lightRider",
                "caravan",
                "cart",
                "wagon",
                "horseCarriage",
                "sleigh",
            ],
            // Betreiber 2026-10-03: „Boote dürfen auf Flüsse und Seen“ - das Ruderboot in beiden Listen.
            river: ["riverSailer", "riverBarge", "riverGalley", "rowboat"],
            // Betreiber 2026-10-03: „Schnellsegler ist immer durchfahrend“, „galeere wird nicht eilgerudert“.
            sea: ["cargoShip", "fastShip", "galley", "courierDromone", "rowboat"],
        });
    });

    /**
     * Die Meilen am Tag eines Mittels auf einer Wegart (WI-0258): seine `meilenJeWegart` (absolute WdE-Werte); wer
     * `wegartenWie` trägt, nimmt eigene `meilen` × Meilen der Wegart des Verweises / dessen `meilen` (S-1); auf dem
     * Wasser gilt `meilen`.
     */
    const dayMiles = (transport: string, pathType: string): number => {
        const day = model.tagesleistung.wert[transport];
        if (day === undefined) return 0;
        if (day.wegartenWie !== undefined) {
            const base = model.tagesleistung.wert[day.wegartenWie];
            return (day.meilen * (base?.meilenJeWegart?.[pathType] ?? base?.meilen ?? 0)) / (base?.meilen ?? 1);
        }
        return day.meilenJeWegart?.[pathType] ?? day.meilen;
    };

    it("🔴 jede Zelle der Tempotafel folgt aus der Tagesleistung - Legacys elf wie die neuen", () => {
        const land = new Set(model.transportmittel.wert.land);
        const all = [...new Set(Object.values(model.transportmittel.wert).flat())];
        expect(Object.keys(model.tempo.wert).sort()).toEqual([...all].sort());
        expect(Object.keys(model.tagesleistung.wert).sort()).toEqual([...all].sort());
        for (const transport of all) {
            for (const [pathType, speed] of Object.entries(model.tempo.wert[transport] ?? {})) {
                const expected =
                    (dayMiles(transport, pathType) * model.zeitfaktor.wert) / travelDayHours(model, transport);
                // An Land vier Stellen, damit die Tagesleistung genau aufgeht; auf dem Wasser zwei wie Legacys Livetafel.
                const stellen = land.has(transport) ? 10000 : 100;
                expect(speed, `${transport} ${pathType}`).toBe(Math.round(expected * stellen) / stellen);
            }
        }
    });

    it("🔴 die Landtafel nach Wege des Entdeckers S. 160-162 (WI-0258 E1): Meilen am Tag je Mittel und Wegart", () => {
        const days = (transport: string) => model.tagesleistung.wert[transport]?.meilenJeWegart;
        const row = (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => ({
            Reichsstrasse: a,
            Strasse: b,
            Weg: c,
            Pfad: d,
            Gebirgspass: e,
            Wuestenpfad: f,
            Querfeldein: g,
        });
        expect(days("groupFoot")).toEqual(row(33, 30, 24, 24, 12, 15, 21));
        expect(days("groupHorse")).toEqual(row(39, 35, 28, 28, 12, 18, 23));
        expect(days("cart")).toEqual(row(27.5, 25, 20, 20, 5, 12.5, 12));
        expect(days("wagon")).toEqual(row(36, 30, 24, 24, 6, 15, 18));
        expect(days("horseCarriage")).toEqual(row(60, 50, 40, 40, 10, 25, 18));
        expect(days("sleigh")).toEqual(row(42, 42, 35, 35, 6, 35, 20));
        // Die drei Mittel ohne WdE-Zeile behalten ihre GA-Grundleistung und die Verhältnisse ihrer Familie (S-1).
        expect(model.tagesleistung.wert["lightWalker"]).toEqual({ meilen: 40, wegartenWie: "groupFoot" });
        expect(model.tagesleistung.wert["lightRider"]).toEqual({ meilen: 50, wegartenWie: "groupHorse" });
        expect(model.tagesleistung.wert["caravan"]).toEqual({ meilen: 30, wegartenWie: "groupFoot" });
        // Einzelreiter auf dem Pass: 50 × 12 / 35 = 17,14 Meilen am Tag.
        expect(dayMiles("lightRider", "Gebirgspass")).toBeCloseTo(17.142857, 5);
        // Die Kutsche fährt auf dem Weg 40 statt 20 (E1), der Schlitten hat WdE-Werte (E3).
        expect(travelSpeed(model, "horseCarriage", "Weg")).toBe(5.95);
        expect(travelSpeed(model, "sleigh", "Querfeldein")).toBe(2.975);
    });

    it("🔴 die Landtafel ist für jedes Landmittel vollständig; was es nie fährt, entscheidet das Angebot", () => {
        const pathTypes = Object.keys(model.jahreszeitBoden.wert.wegklasse);
        for (const transport of model.transportmittel.wert.land) {
            expect(Object.keys(model.tempo.wert[transport] ?? {}).sort(), transport).toEqual([...pathTypes].sort());
        }
    });

    it("die Kontrollwerte nach WdE: Karren 25, Fuhrwerk 30, Schlitten (Kaleschka) 42 Meilen am Tag", () => {
        expect(model.tempo.wert["cart"]).toEqual({
            Reichsstrasse: 4.0906,
            Strasse: 3.7188,
            Weg: 2.975,
            Pfad: 2.975,
            Gebirgspass: 0.7437,
            Wuestenpfad: 1.8594,
            Querfeldein: 1.785,
        });
        expect(model.tempo.wert["wagon"]).toEqual({
            Reichsstrasse: 5.355,
            Strasse: 4.4625,
            Weg: 3.57,
            Pfad: 3.57,
            Gebirgspass: 0.8925,
            Wuestenpfad: 2.2312,
            Querfeldein: 2.6775,
        });
        expect(model.tempo.wert["sleigh"]).toEqual({
            Reichsstrasse: 6.2475,
            Strasse: 6.2475,
            Weg: 5.2063,
            Pfad: 5.2063,
            Gebirgspass: 0.8925,
            Wuestenpfad: 5.2063,
            Querfeldein: 2.975,
        });
        expect(travelSpeed(model, "riverGalley", "Flussweg")).toBe(7.44);
        expect(travelSpeed(model, "galley", "Seeweg")).toBe(10.41);
        expect(travelSpeed(model, "courierDromone", "Seeweg")).toBe(9.92);
        expect(travelSpeed(model, "rowboat", "Seeweg")).toBe(2.48);
        expect(travelSpeed(model, "rowboat", "Flussweg")).toBe(2.48);
    });

    it("🔴 die bestehenden Werte bleiben wertgleich: keine Neukalibrierung", () => {
        expect(model.zeitfaktor.wert).toBe(1.19);
        expect(model.stroemungsfaktorVorgabe.wert).toBe(2);
        expect(model.meilenJeKarteneinheit.wert).toBe(3);
        const { land, water, night } = model.reisetagStunden.wert;
        expect([land, water, night]).toEqual([8, 12, 24]);
        const { FOOT, EQUID, WHEEL } = model.steigung.wert.familien;
        expect([EQUID.exponent, EQUID.versatz, EQUID.kehren]).toEqual([3.5, 0.05, true]);
        expect([WHEEL.quadrat, WHEEL.rollgrenze, WHEEL.kehren]).toEqual([200, 0.03333333333333333, true]);
        expect(FOOT.reisemittel).toEqual(["groupFoot", "lightWalker"]);
        // Legacys Livetafel (Snapshot 140088), Zelle für Zelle.
        const row = (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => ({
            Reichsstrasse: a,
            Strasse: b,
            Weg: c,
            Pfad: d,
            Gebirgspass: e,
            Wuestenpfad: f,
            Querfeldein: g,
        });
        // Seit WI-0258 (E1) Wege des Entdeckers S. 160-162; die Kontrollwerte stehen im Test oben.
        expect(model.tempo.wert["groupFoot"]).toEqual(row(4.9087, 4.4625, 3.57, 3.57, 1.785, 2.2312, 3.1237));
        expect(model.tempo.wert["lightWalker"]).toEqual(row(6.545, 5.95, 4.76, 4.76, 2.38, 2.975, 4.165));
        expect(model.tempo.wert["groupHorse"]).toEqual(row(5.8012, 5.2063, 4.165, 4.165, 1.785, 2.6775, 3.4213));
        expect(model.tempo.wert["lightRider"]).toEqual(row(8.2875, 7.4375, 5.95, 5.95, 2.55, 3.825, 4.8875));
        expect(model.tempo.wert["caravan"]).toEqual(row(4.9087, 4.4625, 3.57, 3.57, 1.785, 2.2312, 3.1237));
        expect(model.tempo.wert["horseCarriage"]).toEqual(row(8.925, 7.4375, 5.95, 5.95, 1.4875, 3.7188, 2.6775));
        expect(model.tempo.wert["riverSailer"]).toEqual({ Flussweg: 5.95 });
        expect(model.tempo.wert["riverBarge"]).toEqual({ Flussweg: 3.97 });
        expect(model.tempo.wert["cargoShip"]).toEqual({ Seeweg: 11.9 });
        expect(model.tempo.wert["fastShip"]).toEqual({ Seeweg: 12.4 });
        // Die eine Ausnahme (Betreiber 2026-10-03, Option A): die Galeere mit den GA-Normalwerten 70 Meilen in 8 h
        // statt Legacys 100 in 12 h (9,92). Ihr Küstenabstand bleibt.
        expect(model.tempo.wert["galley"]).toEqual({ Seeweg: 10.41 });
        expect(model.kuestenfahrt.wert["galley"]).toEqual({ near: 0.75, nearPenalty: 1, far: 3, farPenalty: 1 });
        expect(model.kuestenfahrt.wert["cargoShip"]).toEqual({ near: 1.25, nearPenalty: 1, far: 12, farPenalty: 0.3 });
        expect(model.kuestenfahrt.wert["fastShip"]).toEqual({ near: 1.25, nearPenalty: 1, far: 40, farPenalty: 0.1 });
    });

    it("🔴 jedes Landmittel steht in genau der vorgesehenen Steigungsfamilie", () => {
        const families = model.steigung.wert.familien;
        expect(families.FOOT.reisemittel).toEqual(["groupFoot", "lightWalker"]);
        expect(families.EQUID.reisemittel).toEqual(["groupHorse", "lightRider", "caravan"]);
        expect(families.WHEEL.reisemittel).toEqual(["horseCarriage", "cart", "wagon", "sleigh"]);
        const members = [...families.FOOT.reisemittel, ...families.EQUID.reisemittel, ...families.WHEEL.reisemittel];
        expect([...members].sort()).toEqual([...model.transportmittel.wert.land].sort());
        expect(slopeFamily(model, "cart")).toBe("WHEEL");
        expect(slopeFamily(model, "caravan")).toBe("EQUID");
    });

    it("🔴 alte Links und Anfragen mit fastShip, galley und caravan gelten weiter, die neuen Kennungen auch", () => {
        const waypoints = "00000000-0000-4000-8000-000000000001,00000000-0000-4000-8000-000000000002";
        for (const query of [
            { waypoints, land: "caravan", river: "riverSailer", sea: "fastShip" },
            { waypoints, sea: "galley" },
            { waypoints, land: "sleigh", river: "riverGalley", sea: "courierDromone" },
            { waypoints, land: "cart", sea: "cargoShip" },
            { waypoints, land: "wagon", sea: "galley" },
            { waypoints, sea: "rowboat" },
        ]) {
            expect(Value.Check(RouteQuerystring, query), JSON.stringify(query)).toBe(true);
        }
        // Die Varianten gab es nie auf Stage; sie sind wieder weg (Betreiber 2026-10-03).
        for (const sea of ["rowboats", "fastShipDay", "standardGalley"]) {
            expect(Value.Check(RouteQuerystring, { waypoints, sea }), sea).toBe(false);
        }
    });
});

describe("Reisetag, Rast und Zeitgewicht aus einer Quelle", () => {
    const day = (transport: string) => [
        travelDayHours(model, transport),
        timeWeightFactor(model, transport),
        isRestExempt(model, { type: "Seeweg", transport }),
    ];

    it("🔴 Stunden je Mittel: Land 8, Fluss 12, Schiffe nach der Geographia", () => {
        expect(day("groupFoot")).toEqual([8, 1.5, false]);
        expect(day("cart")).toEqual([8, 1.5, false]);
        expect(day("riverGalley")).toEqual([12, 1, false]);
        expect(day("cargoShip")).toEqual([12, 1, false]);
        // Schnellsegler immer durchfahrend 250 / 24.
        expect(day("fastShip")).toEqual([24, 0.5, true]);
        // Galeere 70 / 8, nie eilgerudert.
        expect(day("galley")).toEqual([8, 1.5, false]);
        // Kurierdromone bis 200 / 24, rastbefreit.
        expect(day("courierDromone")).toEqual([24, 0.5, true]);
        // 🔴 Ruderboot 25 / 12 auf dem Binnensee - NICHT 25 / 8.
        expect(day("rowboat")).toEqual([12, 1, false]);
        expect(model.tagesleistung.wert["rowboat"]?.meilen).toBe(25);
    });

    it("🔴 das Planerfeld gilt an Land, ein Schiff fährt seinen eigenen Tag", () => {
        expect(stageDayHours(model, "wagon", 10)).toBe(10);
        expect(stageDayHours(model, "sleigh", 6)).toBe(6);
        expect(stageDayHours(model, "galley", 10)).toBe(8);
        expect(stageDayHours(model, "cargoShip", 10)).toBe(12);
        expect(stageDayHours(model, "courierDromone", 10)).toBe(24);
    });

    it("🔴 Rast, Etappenplan und Ankunft rechnen mit denselben Stunden", () => {
        // 20 Reisestunden auf See: die Galeere (8 h) rastet zweimal, der Lastensegler (12 h) einmal, die Dromone nie.
        const stage = (transport: string) => ({
            type: "Seeweg",
            transport,
            flow_state: null,
            distance_units: 10,
            travel_hours: 20,
        });
        expect(travelNights(model, [stage("galley")], 8)).toHaveLength(2);
        expect(travelNights(model, [stage("cargoShip")], 8)).toHaveLength(1);
        expect(travelNights(model, [stage("courierDromone")], 8)).toHaveLength(0);

        const at = (id: string, x: number) => ({ id, name: id, hidden: false, x, y: 0 });
        const places = new Map([
            ["A", at("A", 0)],
            ["B", at("B", 10)],
        ]);
        const seaSegment = (transport: string): RouteSegment => ({
            index: 0,
            edge_id: "A-B",
            public_id: "",
            from_node: "A",
            to_node: "B",
            from_node_id: "A",
            to_node_id: "B",
            subtype: "Seeweg",
            path_name: "",
            transport_type: transport,
            distance_units: 10,
            cost_units: 10,
            cost_factor: 1,
            travel_hours: 20,
            flow_time_factor: 1,
            flow_state: "",
            synthetic: false,
            offroad: false,
            geometry: {
                type: "LineString",
                coordinates: [
                    [0, 0],
                    [10, 0],
                ],
            },
        });
        const plan = (transport: string) =>
            buildRouteStages(
                [seaSegment(transport)],
                [{ from: "A", to: "B", segment_start: 0, segment_count: 1, distance_units: 10, travel_hours: 20 }],
                {
                    model,
                    waypointIds: ["A", "B"],
                    placeAt: (id) => places.get(id),
                    placeNear: () => undefined,
                },
                { hoursPerDay: 8, departure: 1 },
            )[0];
        expect(plan("galley")).toMatchObject({ rest_hours: 32, end_date: { month: "praios", day: 3 } });
        expect(plan("cargoShip")).toMatchObject({ rest_hours: 12, end_date: { month: "praios", day: 2 } });
        expect(plan("courierDromone")).toMatchObject({ rest_hours: 0, end_date: { month: "praios", day: 1 } });
    });
});

describe("Strömung", () => {
    it("🔴 die Flussgaleere: stromab 75, stromauf 35 Meilen - der Faktor ist 75 / 35, nicht 2", () => {
        expect(transportFlowFactor(model, "riverGalley")).toBe(75 / 35);
        expect(transportFlowFactor(model, "riverBarge")).toBe(2);
        expect(transportFlowFactor(model, "riverSailer")).toBe(2);
        // Ohne Tagesleistung stromauf gilt die Vorgabe.
        expect(transportFlowFactor(model, "unbekannt")).toBe(model.stroemungsfaktorVorgabe.wert);
    });
});

describe("Gespeicherte Legacy-Freigaben und neue Mittel", () => {
    const LEGACY_LAND = ["caravan", "groupFoot", "lightWalker", "horseCarriage", "groupHorse", "lightRider"];

    it("🔴 Karren und Fuhrwerk folgen der Kutsche, nie auf Pfad oder Wüstenpfad, querfeldein nur über offenes Land", () => {
        const withCarriage = allowedTransportsForPath(model, "Weg", LEGACY_LAND, "land");
        expect(withCarriage).toEqual([...LEGACY_LAND, "cart", "wagon", "sleigh"]);
        const withoutCarriage = LEGACY_LAND.filter((transport) => transport !== "horseCarriage");
        // Ohne Kutsche kein Wagen; der Schlitten folgt der Reisegruppe zu Pferd.
        expect(allowedTransportsForPath(model, "Weg", withoutCarriage, "land")).toEqual([...withoutCarriage, "sleigh"]);
        for (const pathType of ["Reichsstrasse", "Strasse", "Weg", "Gebirgspass"]) {
            expect(allowedTransportsForPath(model, pathType, LEGACY_LAND, "land"), pathType).toContain("cart");
            expect(allowedTransportsForPath(model, pathType, null, null), pathType).toContain("wagon");
        }
        for (const pathType of ["Pfad", "Wuestenpfad"]) {
            for (const list of [LEGACY_LAND, null]) {
                const allowed = allowedTransportsForPath(model, pathType, list, list ? "land" : null);
                expect(allowed, pathType).not.toContain("cart");
                expect(allowed, pathType).not.toContain("wagon");
            }
        }
        // Querfeldein fahren sie seit WI-0258 (E2): nur über offenes Land, das sperrt `querfeldeinFahrzeuge`, nicht das Angebot.
        const offroad = allowedTransportsForPath(model, "Querfeldein", null, null);
        for (const transport of ["cart", "wagon", "horseCarriage"]) expect(offroad, transport).toContain(transport);
        expect(model.nieAngeboten.wert["Querfeldein"]).toBeUndefined();
        expect(model.querfeldeinFahrzeuge.wert).toEqual({
            reisemittel: ["cart", "wagon", "horseCarriage"],
            offeneLandschaften: ["tundra", "hochebene"],
            gebirge: true,
        });
        // Wagen queren einen Bach so teuer wie die Karawane (S-6).
        const bach = model.bachQuerung.wert.meilenJeReisemittel;
        expect([bach["cart"], bach["wagon"], bach["horseCarriage"]]).toEqual([30, 30, 30]);
    });

    it("🔴 eine Legacy-Liste wird nie über ihr Angebot erweitert, eine leere bleibt leer", () => {
        expect(allowedTransportsForPath(model, "Weg", [], "land")).toEqual([]);
        expect(allowedTransportsForPath(model, "Wuestenpfad", ["horseCarriage", "groupFoot"], "land")).toEqual([
            "groupFoot",
        ]);
        // Der Schlitten folgt der Reisegruppe zu Pferd (er darf im Winter querfeldein, also auch auf den Pfad).
        expect(allowedTransportsForPath(model, "Pfad", null, null)).toContain("sleigh");
        expect(allowedTransportsForPath(model, "Pfad", ["horseCarriage"], "land")).not.toContain("sleigh");
        expect(allowedTransportsForPath(model, "Pfad", ["groupHorse"], "land")).toEqual(["groupHorse", "sleigh"]);
        expect(allowedTransportsForPath(model, "Querfeldein", null, null)).toContain("sleigh");
    });

    it("🔴 die neuen Schiffe erben vom Schiff ihrer Klasse, das Ruderboot fährt Flüsse wie der Kahn, keinen Seeweg", () => {
        expect(allowedTransportsForPath(model, "Seeweg", ["fastShip"], "sea")).toEqual(["fastShip"]);
        expect(allowedTransportsForPath(model, "Seeweg", ["galley"], "sea")).toEqual(["galley", "courierDromone"]);
        expect(allowedTransportsForPath(model, "Seeweg", ["cargoShip"], "sea")).toEqual(["cargoShip"]);
        expect(allowedTransportsForPath(model, "Seeweg", null, null)).not.toContain("rowboat");
        expect(allowedTransportsForPath(model, "Flussweg", ["riverSailer"], "river")).toEqual([
            "riverSailer",
            "riverGalley",
        ]);
        expect(allowedTransportsForPath(model, "Flussweg", ["riverBarge"], "river")).toEqual(["riverBarge", "rowboat"]);
        expect(allowedTransportsForPath(model, "Flussweg", null, null)).toContain("rowboat");
        expect(allowedTransportsForPath(model, "Flussweg", [], "river")).toEqual([]);
    });

    it("das Sperrfenster eines Weges gilt auch für den Erben, ein eigenes geht vor", () => {
        const winter = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 };
        const own = { from_month: "praios", from_day: 1, to_month: "rahja", to_day: 30 };
        expect(pathSeasonWindow(model, { horseCarriage: winter }, "cart")).toBe(winter);
        expect(pathSeasonWindow(model, { galley: winter }, "courierDromone")).toBe(winter);
        expect(pathSeasonWindow(model, { galley: winter, courierDromone: own }, "courierDromone")).toBe(own);
        expect(pathSeasonWindow(model, { galley: winter }, "cargoShip")).toBeUndefined();
        expect(pathSeasonWindow(model, undefined, "cart")).toBeUndefined();
    });

    it("🔴 vom Editor vollständig geschrieben (Migration 0208, F16 „A“): nichts erbt, die Liste gilt genau, auch leer", () => {
        const winter = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 };
        // Karren abgewählt bei Kutsche: Er fährt nicht; ohne das Merkmal erbte er.
        expect(allowedTransportsForPath(model, "Weg", LEGACY_LAND, "land", true)).toEqual(
            allowedTransportsForPath(model, "Weg", LEGACY_LAND, "land").filter((mittel) =>
                LEGACY_LAND.includes(mittel),
            ),
        );
        expect(allowedTransportsForPath(model, "Weg", LEGACY_LAND, "land", true)).not.toContain("cart");
        // Eine leere Liste ohne Domäne ist geschrieben keine Altzeile mehr: Nichts fährt.
        expect(allowedTransportsForPath(model, "Weg", [], null)).toContain("groupFoot");
        expect(allowedTransportsForPath(model, "Weg", [], null, true)).toEqual([]);
        // Auch geschrieben nie über das Angebot hinaus; ohne Liste bleibt es die Vorgabe.
        expect(allowedTransportsForPath(model, "Wuestenpfad", ["horseCarriage", "groupFoot"], "land", true)).toEqual([
            "groupFoot",
        ]);
        expect(allowedTransportsForPath(model, "Pfad", null, null, true)).toEqual(
            allowedTransportsForPath(model, "Pfad", null, null),
        );
        // Ein Fenster gilt geschrieben nur seinem Mittel: Der Karren fährt ganzjährig, wenn er kein eigenes hat.
        expect(pathSeasonWindow(model, { horseCarriage: winter }, "cart", true)).toBeUndefined();
        expect(pathSeasonWindow(model, { horseCarriage: winter }, "horseCarriage", true)).toBe(winter);
    });
});

describe("Schlitten und Ruderboot", () => {
    it("🔴 der Schlitten: Winter mit Schnee, im Gebirge über der Schneegrenze immer, die Bäche zugefroren", () => {
        const rule = groundRequirement(model, "sleigh");
        expect(rule).toEqual({
            zustaende: ["schnee_leicht", "tiefschnee", "eis"],
            jahreszeiten: ["winter"],
            gebirgeUeberSchneegrenze: true,
            baecheGefroren: true,
        });
        for (const transport of Object.values(model.transportmittel.wert).flat()) {
            if (transport !== "sleigh") expect(groundRequirement(model, transport), transport).toBeNull();
        }
        // Die Zustände gibt es in der Bodentafel wirklich.
        for (const condition of rule?.zustaende ?? []) {
            expect(model.jahreszeitBoden.wert.zustaende[condition], condition).toBeDefined();
        }
        if (!rule) return;
        // Winter mit Schnee: gemäßigt, boreal, subpolar, polar; nicht im Frühling auf polarem Eis, nicht in den Subtropen.
        for (const zone of ["gemaessigt", "boreal", "subpolar", "polar"]) {
            expect(seasonSnow(model, rule, zone, "winter"), zone).toBe(true);
        }
        expect(seasonSnow(model, rule, "polar", "fruehling")).toBe(false);
        expect(seasonSnow(model, rule, "subtropen_winterfeucht", "winter")).toBe(false);
        expect(seasonSnow(model, rule, null, "winter")).toBe(false);
    });

    it("die Schneegrenze: Tafel je Zone zur Mitte der Jahreszeit, dazwischen linear, auf 100 gerundet", () => {
        expect(snowlineHeight(model, "gemaessigt", 45)).toBe(3100);
        expect(snowlineHeight(model, "gemaessigt", 225)).toBe(500);
        expect(snowlineHeight(model, "gemaessigt", 90)).toBe(2600);
        expect(snowlineHeight(model, "tropisch", 225)).toBe(4500);
        expect(snowlineHeight(model, "polar", 45)).toBe(0);
        expect(snowlineHeight(model, "gemaessigt", 370)).toBe(snowlineHeight(model, "gemaessigt", 5));
        expect(snowlineHeight(model, "unbekannt", 45)).toBeNull();
        expect(snowlineHeight(model, null, 45)).toBeNull();
        // Jede Klimazone der Bodentafel hat eine Schneegrenze.
        for (const zone of Object.keys(model.jahreszeitBoden.wert.tafel)) {
            expect(model.schneegrenze.wert.zonen[zone], zone).toBeDefined();
        }
    });

    it("🔴 das Ruderboot fährt frei nur auf Binnenseen, Segler und Galeeren auf Meer und See", () => {
        expect(shipWaters(model, "rowboat")).toEqual(["see"]);
        expect(shipWaters(model, "galley")).toEqual(["meer", "see"]);
        expect(shipWaters(model, "courierDromone")).toEqual(["meer", "see"]);
    });

    it("🔴 der Seegraph hält Seereisen nur für Schiffe mit eigenen Wegen", () => {
        expect(seaGraphTransports(model)).toEqual(["cargoShip", "fastShip", "galley", "rowboat"]);
        expect(seaGraphTransport(model, "courierDromone")).toBe("galley");
        // Gleicher Küstenabstand wie die Galeere, aber eigene Gewässer: eigene Seereisen.
        expect(seaGraphTransport(model, "rowboat")).toBe("rowboat");
        expect(coastProfileOf(model, "rowboat")).toEqual(model.kuestenfahrt.wert["galley"]);
        expect(coastProfileOf(model, "courierDromone")).toEqual(model.kuestenfahrt.wert["galley"]);
    });

    it("ein Verweis im Kreis ist kein Küstenabstand", () => {
        const looping = structuredClone(model);
        looping.kuestenfahrt.wert = { a: { wie: "b" }, b: { wie: "a" } };
        expect(coastProfileOf(looping, "a")).toBeNull();
        expect(seaGraphTransport(looping, "a")).toBe("b");
    });
});
