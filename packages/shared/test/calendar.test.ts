import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    calendarDate,
    CLOCK_START,
    clockEnter,
    clockTravel,
    dayAfter,
    dayOfYear,
    departureDayOfYear,
    departureDays,
    isDepartureMonth,
    restCounter,
    seasonGround,
    seasonOfDay,
    windowContains,
} from "../src/index.ts";

/**
 * Der aventurische Kalender, die Uhr der Reise und der Boden der Jahreszeit (WI-0038). Die Fälle
 * folgen Legacys `travel-calendar-test.php`, `transport-season-test.php` und `season-ground-test.php`
 * (avesmaps@770c80e, MCS-024).
 */

const model = AVENTURIA_TRAVEL_MODEL;

describe("Der Kalender", () => {
    it("zählt 12 Monate zu 30 Tagen und klemmt den Tag", () => {
        expect(dayOfYear("praios", 1)).toBe(1);
        expect(dayOfYear("rahja", 30)).toBe(360);
        expect(dayOfYear("firun", 0)).toBe(181);
        expect(dayOfYear("firun", 45)).toBe(210);
    });

    it("nach Rahja kommen die fünf Namenlosen Tage, dann ein neues Jahr", () => {
        expect(calendarDate(dayOfYear("rahja", 30), 24)).toEqual({
            month: "",
            day: 1,
            nameless: true,
            season: "fruehling",
            years_passed: 0,
        });
        expect(calendarDate(dayOfYear("rahja", 30), 6 * 24)).toMatchObject({
            month: "praios",
            day: 1,
            years_passed: 1,
        });
        // Ganze Tage: 23 Stunden nach dem Aufbruch ist es noch derselbe Tag.
        expect(calendarDate(dayOfYear("efferd", 30), 23.9)).toMatchObject({ month: "efferd", day: 30 });
        expect(dayAfter(dayOfYear("efferd", 30), 24)).toBe(dayOfYear("travia", 1));
    });

    it("Sommer ab Praios, Herbst ab Travia, Winter ab Firun, Frühling ab Peraine; die Namenlosen Tage sind Frühling", () => {
        expect(seasonOfDay(dayOfYear("praios", 1))).toBe("sommer");
        expect(seasonOfDay(dayOfYear("travia", 1))).toBe("herbst");
        expect(seasonOfDay(dayOfYear("phex", 30))).toBe("winter");
        expect(seasonOfDay(dayOfYear("peraine", 1))).toBe("fruehling");
        expect(seasonOfDay(363)).toBe("fruehling");
    });
});

describe("Der Reisebeginn mit den Namenlosen Tagen", () => {
    it("zählt die Namenlosen Tage als 361 bis 365 und klemmt den Tag auf fünf", () => {
        expect(departureDayOfYear("namenlos", 1)).toBe(361);
        expect(departureDayOfYear("namenlos", 5)).toBe(365);
        expect(departureDayOfYear("namenlos", 9)).toBe(365);
        expect(departureDayOfYear("firun", 12)).toBe(dayOfYear("firun", 12));
        expect([departureDays("namenlos"), departureDays("firun")]).toEqual([5, 30]);
    });

    it("kennt nur den kleingeschriebenen Namen", () => {
        expect(isDepartureMonth("namenlos")).toBe(true);
        expect(isDepartureMonth("firun")).toBe(true);
        expect(isDepartureMonth("Namenlos")).toBe(false);
    });
});

describe("Ein Sperrfenster", () => {
    const warm = { from_month: "peraine", from_day: 1, to_month: "boron", to_day: 30 };

    it("schließt beide Enden ein und läuft über den Jahreswechsel, samt Namenlosen Tagen", () => {
        expect(windowContains(warm, dayOfYear("peraine", 1))).toBe(true);
        expect(windowContains(warm, dayOfYear("boron", 30))).toBe(true);
        expect(windowContains(warm, 363)).toBe(true);
        expect(windowContains(warm, dayOfYear("praios", 1))).toBe(true);
        expect(windowContains(warm, dayOfYear("hesinde", 1))).toBe(false);
        expect(windowContains(warm, dayOfYear("phex", 30))).toBe(false);
    });

    it("ein Fenster ohne Wechsel ist nur innen offen; ein unbekannter Monat sperrt nicht", () => {
        const sommer = { from_month: "praios", from_day: 1, to_month: "efferd", to_day: 30 };
        expect(windowContains(sommer, dayOfYear("efferd", 30))).toBe(true);
        expect(windowContains(sommer, dayOfYear("travia", 1))).toBe(false);
        expect(windowContains({ ...sommer, to_month: "niemals" }, dayOfYear("firun", 1))).toBe(true);
    });
});

describe("Die Uhr der Reise (E1: eine Uhr)", () => {
    it("rechnet die Rast wie der Rastzähler des Reiseplans", () => {
        const book = restCounter(true);
        let clock = CLOCK_START;
        for (const [hours, day] of [
            [6, 8],
            [5, 8],
            [12, 12],
            [3, 8],
        ] as const) {
            const step = clockTravel(clock, hours, day, false, true);
            expect(step.rest).toBe(book(hours, day, false));
            clock = step.clock;
        }
        // 26 Reisestunden und zwei gebuchte Nächte: 16 Stunden an Land, 13,5 nach dem Tag mit Segeln.
        expect(clock.hours).toBeCloseTo(26 + 16 + 13.5, 9);
    });

    it("die Rast eines vollen Tages wird erst vor dem nächsten Stück gebucht", () => {
        const voll = clockTravel(CLOCK_START, 8, 8, false, true).clock;
        expect(voll.hours).toBe(8);
        expect(clockEnter(voll).hours).toBe(24);
        expect(clockEnter(clockTravel(CLOCK_START, 4, 8, false, true).clock).hours).toBe(4);
    });
});

describe("Der Boden der Jahreszeit (E10, seit WI-0258 nach Wege des Entdeckers S. 160-162)", () => {
    it("verlängert je Wegart um trocken / Wert des Zustands in den Meilen am Tag des Mittels", () => {
        // Gruppe zu Fuß, borealer Winter (Tiefschnee): Straße 30 / 25, Reichsstraße wie Straße (S-3), Pass 12 / 8.
        expect(seasonGround(model, "boreal", "winter", "Strasse", "groupFoot")).toEqual({
            condition: "tiefschnee",
            factor: 30 / 25,
        });
        expect(seasonGround(model, "boreal", "winter", "Reichsstrasse", "groupFoot")?.factor).toBeCloseTo(1.2, 9);
        expect(seasonGround(model, "boreal", "winter", "Gebirgspass", "groupFoot")?.factor).toBeCloseTo(1.5, 9);
        // Kontrollwert des Auftrags: zu Fuß Weg nass 1,2.
        expect(seasonGround(model, "gemaessigt", "fruehling", "Pfad", "groupFoot")?.factor).toBeCloseTo(1.2, 9);
        expect(seasonGround(model, "gemaessigt", "winter", "Weg", "groupFoot")?.factor).toBeCloseTo(1.2, 9);
    });

    it("🔴 querfeldein gilt er auch (E3); zu Fuß im Tiefschnee 3,5, auf leichtem Schnee 1,75", () => {
        expect(seasonGround(model, "boreal", "winter", "Querfeldein", "groupFoot")?.factor).toBeCloseTo(3.5, 9);
        expect(seasonGround(model, "gemaessigt", "winter", "Querfeldein", "groupFoot")?.factor).toBeCloseTo(21 / 12, 9);
        expect(seasonGround(model, "gemaessigt", "fruehling", "Querfeldein", "groupFoot")?.factor).toBeCloseTo(
            21 / 18,
            9,
        );
    });

    it("🔴 jedes Mittel rechnet mit seiner Zeile: Kutsche, Karren, Schlitten (Kontrollwerte des Auftrags)", () => {
        // Kutsche, Straße nass 50 / 36; Karren, Pass nass 5 / 3.
        expect(seasonGround(model, "gemaessigt", "fruehling", "Strasse", "horseCarriage")?.factor).toBeCloseTo(
            50 / 36,
            4,
        );
        expect(seasonGround(model, "gemaessigt", "fruehling", "Gebirgspass", "cart")?.factor).toBeCloseTo(5 / 3, 4);
        // Schlitten: querfeldein im Tiefschnee 20 / 10, auf leichtem Schnee überall 1.
        expect(seasonGround(model, "boreal", "winter", "Querfeldein", "sleigh")?.factor).toBeCloseTo(2, 9);
        for (const pathType of [
            "Reichsstrasse",
            "Strasse",
            "Weg",
            "Pfad",
            "Wuestenpfad",
            "Gebirgspass",
            "Querfeldein",
        ]) {
            expect(seasonGround(model, "gemaessigt", "winter", pathType, "sleigh"), pathType).toBeNull();
        }
    });

    it("Wanderer und Karawane gehen wie die Gruppe zu Fuß, der Einzelreiter wie die berittene Gruppe (S-1)", () => {
        for (const pathType of ["Strasse", "Weg", "Gebirgspass", "Querfeldein"]) {
            const foot = seasonGround(model, "boreal", "winter", pathType, "groupFoot");
            expect(seasonGround(model, "boreal", "winter", pathType, "lightWalker"), pathType).toEqual(foot);
            expect(seasonGround(model, "boreal", "winter", pathType, "caravan"), pathType).toEqual(foot);
            const horse = seasonGround(model, "boreal", "winter", pathType, "groupHorse");
            expect(seasonGround(model, "boreal", "winter", pathType, "lightRider"), pathType).toEqual(horse);
        }
        // Ein Mittel ohne Zeile hat keinen Boden.
        expect(seasonGround(model, "boreal", "winter", "Strasse", "unbekannt")).toBeNull();
    });

    it("Nässe bremst auch die Straße (WdE), Wasser nie, die trockenen Subtropen haben keinen Boden (E4)", () => {
        expect(seasonGround(model, "gemaessigt", "fruehling", "Strasse", "groupFoot")).toEqual({
            condition: "aufgeweicht",
            factor: 30 / 25,
        });
        expect(seasonGround(model, "gemaessigt", "fruehling", "Pfad", "groupFoot")?.condition).toBe("aufgeweicht");
        expect(seasonGround(model, "polar", "winter", "Seeweg", "cargoShip")).toBeNull();
        expect(seasonGround(model, "trockene_subtropen", "winter", "Pfad", "groupFoot")).toBeNull();
        expect(seasonGround(model, "gemaessigt", "sommer", "Pfad", "groupFoot")).toBeNull();
        expect(seasonGround(model, null, "winter", "Pfad", "groupFoot")).toBeNull();
    });
});
