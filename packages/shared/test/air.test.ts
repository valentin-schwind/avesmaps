import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    CUSTOM_AIR,
    RouteQuerystring,
    TravelModel,
    airCeilingAbsolute,
    airMaxAboveGround,
    airProfile,
    airProfileIds,
    airStandardHeight,
    airSurcharge,
    airSurchargeHours,
    airSurchargeRule,
    isAirTransport,
    resolveAirQuery,
    stageDayHours,
    timeWeightFactor,
    travelDayHours,
} from "../src/index.ts";

/**
 * Der Flug im Reisemodell (WI-0051, F1): die zwölf Flugmittel aus dem Zielbild des Betreibers (bis dahin
 * `apps/web/src/route-planner/air-profiles.ts`, WI-0050), die Grenzen des eigenen Flugmittels und die
 * Flugparameter einer Anfrage; dazu die zwei Höchstgrenzen: das Zehnfache der Reisehöhe über Grund (Prozentwert) und
 * die absolute Höchstflughöhe von 5.000 Schritt über dem Meer (F2, Betreiber 2026-10-04).
 */
const model = AVENTURIA_TRAVEL_MODEL;
const flug = model.flug.wert;

describe("Flug im Reisemodell", () => {
    it("🔴 trägt die zwölf Flugmittel mit genau den Werten des Zielbilds, in seiner Reihenfolge", () => {
        expect(flug.profile.map((profile) => [profile.id, profile.gruppe, profile.tempo, profile.reisehoehe])).toEqual([
            ["witchFlight", "devices", 40, 100],
            ["flyingCarpet", "devices", 35, 150],
            // Die Bahalyr: etwa 100 Meilen am Tag bei 8 Reisestunden (Betreiber 2026-09-27).
            ["airship", "devices", 12.5, 1000],
            ["flyingLizard", "mounts", 30, 200],
            ["hippogriff", "mounts", 40, 400],
            ["giantAuk", "mounts", 38, 400],
            ["skySteed", "mounts", 45, 500],
            ["westwindDragon", "mounts", 50, 600],
            ["airDjinn", "summoned", 25, 300],
            ["karakil", "summoned", 45, 400],
            ["irrhalk", "summoned", 80, 700],
            ["griffin", "extraordinary", 50, 800],
        ]);
    });

    it("die Kennungen sind eindeutig, und keine heißt wie das eigene Flugmittel", () => {
        const ids = airProfileIds(model);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids).not.toContain(CUSTOM_AIR);
    });

    it("das eigene Flugmittel: Tempo 1 bis 999 mit einer Stelle, Höhe 1 bis 5.000 ganz (höchstens die absolute Höchstflughöhe), Vorgaben 40 und 250", () => {
        expect(flug.eigenes).toEqual({
            tempo: { min: 1, max: 999, nachkommastellen: 1, vorgabe: 40 },
            reisehoehe: { min: 1, max: 5000, nachkommastellen: 0, vorgabe: 250 },
        });
        // Der Mindestabstand zum Gelände (Betreiber 2026-09-27, WI-0046); er wirkt mit dem Umfliegen (F2).
        expect(flug.mindestabstandSchritt).toBe(200);
        expect(model.flug.herkunft).toMatch(/Setzung des Betreibers, keine Regelquelle/);
    });

    it("🔴 die Höhe über Grund ist ein Prozentwert der Reisehöhe, gesetzt vom Betreiber (2026-09-28, über Grund seit 2026-10-04)", () => {
        // Die einzige Stelle, die den Wert festhält; alles andere rechnet über `airMaxAboveGround`.
        expect(flug.hoechstflughoeheProzent).toBe(1000);
        expect(model.flug.herkunft).toMatch(/hoechstflughoeheProzent: Setzung des Betreibers 2026-09-28/);
        expect(model.flug.herkunft).toMatch(/UEBER GRUND/);
    });

    it("🔴 die absolute Höchstflughöhe: 5.000 Schritt über dem Meer, für alle gleich, gesetzt vom Betreiber (2026-10-04)", () => {
        expect(flug.hoechstflughoeheAbsolutSchritt).toBe(5000);
        expect(airCeilingAbsolute(model)).toBe(5000);
        expect(model.flug.herkunft).toMatch(/hoechstflughoeheAbsolutSchritt: Setzung des Betreibers 2026-10-04/);
        // Umflogen wird nur Gelände über der absoluten Höchstflughöhe minus Mindestabstand.
        expect(airCeilingAbsolute(model) - flug.mindestabstandSchritt).toBe(4800);
    });

    it("🔴 F4: Steigen und Halten über der Reisehöhe haben je EINE Zeile im Reisemodell, gesetzt mit dem Zitat des Betreibers (2026-10-04)", () => {
        // Die einzigen Stellen; Server und Oberfläche rechnen über `airSurchargeRule`.
        expect(flug.steigkostenFaktor).toBe(50);
        expect(flug.haltekostenFaktor).toBe(1);
        expect(model.flug.herkunft).toMatch(
            /steigkostenFaktor und haltekostenFaktor \(WI-0051 F4, Betreiber 2026-10-04/,
        );
        expect(model.flug.herkunft).toMatch(/lieber um hohe berge herumfliegen als einfach drueber/);
        expect(model.flug.herkunft).toMatch(/der aufstieg zur durchschnittlichen flughoehe kostet nichts/);
        // Keine negativen Faktoren, keine fremden Schlüssel.
        const mit = (change: (copy: typeof model) => void): boolean => {
            const copy = structuredClone(model);
            change(copy);
            return Value.Check(TravelModel, copy);
        };
        expect(mit(() => undefined)).toBe(true);
        expect(mit((copy) => (copy.flug.wert.steigkostenFaktor = -1))).toBe(false);
        expect(mit((copy) => (copy.flug.wert.haltekostenFaktor = -0.1))).toBe(false);
        expect(mit((copy) => (copy.flug.wert.steigkostenFaktor = 0))).toBe(true);
        expect(mit((copy) => Object.assign(copy.flug.wert, { steigkosten: 1 }))).toBe(false);
    });

    it("🔴 F4: Die Standardflughöhe ist die Reisehöhe, mindestens der Mindestabstand: Auf ihr zu fliegen kostet nichts", () => {
        expect(airStandardHeight(model, 800)).toBe(800);
        // Der Hexenbesen (100 Schritt Reisehöhe) fliegt nie tiefer als Boden + 200 (`flightAltitude`): Das ist seine Standardhöhe.
        expect(airStandardHeight(model, 100)).toBe(200);
        expect(airStandardHeight(model, 1)).toBe(200);
        const rule = airSurchargeRule(model, 100);
        expect(rule).toEqual({ standard: 200, scale: 1000, climbFactor: 50, holdFactor: 1 });
        expect(airSurchargeRule(model, 800)).toMatchObject({ standard: 800, scale: 8000 });
    });

    it("F4: Der Zuschlag in Stunden ist die zusätzliche Strecke in Schritt durch 1.000 je Meile durch das Tempo", () => {
        expect(airSurchargeHours(50_000, 50)).toBeCloseTo(1, 12);
        expect(airSurchargeHours(0, 50)).toBe(0);
        const ground = [0, 0, 0, 0, 0];
        // Überstand 0, 400, 400, 400, 0 auf 4.000 Schritt Strecke, Reisehöhe 800: Bahn auf 1.200 über dem Meer.
        const altitude = [800, 1200, 1200, 1200, 800];
        const greif = { altitudeSchritt: 800, speedMph: 50 };
        const surcharge = airSurcharge(model, greif, { ground, altitude, lengthSchritt: 4000 });
        expect(surcharge.peakSchritt).toBe(400);
        expect(surcharge.climbSchritt).toBeCloseTo(400 * 50, 9);
        expect(surcharge.climbHours).toBeCloseTo((400 * 50) / 1000 / 50, 12);
        expect(surcharge.hours).toBeCloseTo(surcharge.climbHours + surcharge.holdHours, 12);
        // Ein langsameres Flugmittel braucht dieselbe zusätzliche Strecke länger.
        const lahm = airSurcharge(
            model,
            { altitudeSchritt: 800, speedMph: 25 },
            { ground, altitude, lengthSchritt: 4000 },
        );
        expect(lahm.hours).toBeCloseTo(2 * surcharge.hours, 12);
        // Eben, auf der Reisehöhe: nichts.
        expect(
            airSurcharge(model, greif, { ground, altitude: [800, 800, 800, 800, 800], lengthSchritt: 4000 }).hours,
        ).toBe(0);
    });

    it("die Höhe über Grund folgt für jedes Flugmittel aus seiner Reisehöhe, auch mit einem anderen Prozentwert", () => {
        for (const profile of flug.profile) {
            expect(airMaxAboveGround(model, profile.reisehoehe), profile.id).toBeCloseTo(
                (profile.reisehoehe * flug.hoechstflughoeheProzent) / 100,
                9,
            );
        }
        const halb = structuredClone(model);
        halb.flug.wert.hoechstflughoeheProzent = 150;
        expect(airMaxAboveGround(halb, 1000)).toBe(1500);
        // Höher steigt, wer höher reist.
        const greif = airProfile(model, "griffin");
        const hexe = airProfile(model, "witchFlight");
        if (!greif || !hexe) throw new Error("Profile erwartet");
        expect(airMaxAboveGround(model, greif.reisehoehe)).toBeGreaterThan(airMaxAboveGround(model, hexe.reisehoehe));
    });

    it("das Schema weist fremde Gruppen, Nullwerte und fremde Schlüssel ab", () => {
        const mit = (change: (copy: typeof model) => void): boolean => {
            const copy = structuredClone(model);
            change(copy);
            return Value.Check(TravelModel, copy);
        };
        expect(mit(() => undefined)).toBe(true);
        expect(mit((copy) => ((copy.flug.wert.profile[0] as { gruppe: string }).gruppe = "drachen"))).toBe(false);
        expect(mit((copy) => ((copy.flug.wert.profile[0] as { tempo: number }).tempo = 0))).toBe(false);
        expect(mit((copy) => ((copy.flug.wert.profile[0] as { id: string }).id = "Greif mit Reiter"))).toBe(false);
        // Die Höchstflughöhe steht nicht je Profil, sondern als Prozentwert (über Grund) und als ein absoluter Wert.
        expect(mit((copy) => Object.assign(copy.flug.wert, { hoechstflughoehe: 3000 }))).toBe(false);
        expect(mit((copy) => Object.assign(copy.flug.wert.profile[0] ?? {}, { hoechstflughoehe: 3000 }))).toBe(false);
        expect(mit((copy) => (copy.flug.wert.hoechstflughoeheProzent = 0))).toBe(false);
        expect(mit((copy) => (copy.flug.wert.hoechstflughoeheAbsolutSchritt = 0))).toBe(false);
        expect(mit((copy) => (copy.flug.wert.profile = []))).toBe(false);
    });

    it("🔴 F-E2: Ein Flugmittel reist mit dem Tag an Land, nicht mit dem 12-h-Tag des Wassers", () => {
        for (const transport of [...airProfileIds(model), CUSTOM_AIR]) {
            expect(isAirTransport(model, transport), transport).toBe(true);
            expect(travelDayHours(model, transport), transport).toBe(8);
            expect(stageDayHours(model, transport, 10), transport).toBe(10);
        }
        // Land und Wasser rechnen wie zuvor.
        expect(isAirTransport(model, "groupFoot")).toBe(false);
        expect(isAirTransport(model, "cargoShip")).toBe(false);
        expect(stageDayHours(model, "groupFoot", 10)).toBe(10);
        expect(stageDayHours(model, "cargoShip", 10)).toBe(12);
        expect(stageDayHours(model, "fastShip", 10)).toBe(24);
        expect(timeWeightFactor(model, "riverSailer")).toBe(1);
    });
});

describe("Flugparameter der Anfrage", () => {
    it("ohne air wird nicht geflogen", () => {
        expect(resolveAirQuery(model, {})).toEqual({ ok: true, air: null });
    });

    it("ein Profil bringt Tempo und Höhe aus dem Reisemodell, die Höhe über Grund folgt aus der Reisehöhe, die absolute ist für alle gleich", () => {
        expect(resolveAirQuery(model, { air: "griffin" })).toEqual({
            ok: true,
            air: {
                profile: "griffin",
                speedMph: 50,
                altitudeSchritt: 800,
                maxAboveGroundSchritt: 8000,
                ceilingSchritt: 5000,
            },
        });
        expect(resolveAirQuery(model, { air: "airship" })).toMatchObject({
            air: { speedMph: 12.5, maxAboveGroundSchritt: airMaxAboveGround(model, 1000), ceilingSchritt: 5000 },
        });
        expect(resolveAirQuery(model, { air: "witchFlight" })).toMatchObject({
            air: { maxAboveGroundSchritt: 1000, ceilingSchritt: 5000 },
        });
    });

    it("das eigene Flugmittel verlangt ein Tempo; ohne Höhe gilt die Vorgabe, die Grenzen folgen wie bei allen", () => {
        expect(resolveAirQuery(model, { air: "custom", air_speed: 12.5, air_altitude: 3000 })).toEqual({
            ok: true,
            air: {
                profile: "custom",
                speedMph: 12.5,
                altitudeSchritt: 3000,
                maxAboveGroundSchritt: airMaxAboveGround(model, 3000),
                ceilingSchritt: airCeilingAbsolute(model),
            },
        });
        expect(resolveAirQuery(model, { air: "custom", air_speed: 999 })).toEqual({
            ok: true,
            air: {
                profile: "custom",
                speedMph: 999,
                altitudeSchritt: 250,
                maxAboveGroundSchritt: airMaxAboveGround(model, flug.eigenes.reisehoehe.vorgabe),
                ceilingSchritt: airCeilingAbsolute(model),
            },
        });
        expect(resolveAirQuery(model, { air: "custom", air_speed: 1, air_altitude: 5000 }).ok).toBe(true);
    });

    it("🔴 eine eigene Höchstflughöhe gibt es in der Adresse nicht", () => {
        const waypoints = "p:1:1,p:2:2";
        expect(Value.Check(RouteQuerystring, { waypoints, air: "custom", air_speed: 40, air_ceiling: 3000 })).toBe(
            false,
        );
    });

    it("🔴 weist ab, was nicht passt, und nennt den Parameter", () => {
        const fälle: [Parameters<typeof resolveAirQuery>[1], string][] = [
            [{ air: "custom" }, "air_speed"],
            [{ air: "custom", air_speed: 0.5 }, "air_speed"],
            [{ air: "custom", air_speed: 1000 }, "air_speed"],
            [{ air: "custom", air_speed: 12.55 }, "air_speed"],
            [{ air: "custom", air_speed: Number.NaN }, "air_speed"],
            [{ air: "custom", air_speed: 40, air_altitude: 0 }, "air_altitude"],
            [{ air: "custom", air_speed: 40, air_altitude: 5001 }, "air_altitude"],
            [{ air: "custom", air_speed: 40, air_altitude: 12.5 }, "air_altitude"],
            // Beim Profil sind die eigenen Werte verboten, ohne air erst recht.
            [{ air: "griffin", air_speed: 40 }, "air_speed"],
            [{ air: "griffin", air_altitude: 900 }, "air_altitude"],
            [{ air_speed: 40 }, "air_speed"],
            [{ air_altitude: 900 }, "air_altitude"],
            [{ air: "drache" }, "air"],
        ];
        for (const [query, parameter] of fälle) {
            expect(resolveAirQuery(model, query), JSON.stringify(query)).toMatchObject({ ok: false, parameter });
        }
    });

    it("das Schema der Adresse kennt die Flugmittel und die äußeren Grenzen", () => {
        const waypoints = "p:1:1,p:2:2";
        const gilt = (query: Record<string, unknown>): boolean =>
            Value.Check(RouteQuerystring, { waypoints, ...query });
        expect(gilt({ air: "griffin" })).toBe(true);
        expect(gilt({ air: "custom", air_speed: 12.5, air_altitude: 300 })).toBe(true);
        expect(gilt({ air: "drache" })).toBe(false);
        expect(gilt({ air: "custom", air_speed: 0.9 })).toBe(false);
        expect(gilt({ air: "custom", air_speed: 1000 })).toBe(false);
        expect(gilt({ air: "custom", air_speed: 40, air_altitude: 5001 })).toBe(false);
    });
});
