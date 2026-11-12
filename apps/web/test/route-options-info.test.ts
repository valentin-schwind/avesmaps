import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, LODGING_LEVELS, stageDayHours } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import {
    CLIMATE_ZONES,
    climateRows,
    coachFare,
    groundLosses,
    groundSeasons,
    lodgingRows,
    minBorderMiles,
    optimizeExample,
    restDay,
    roofedLandPaths,
    speedRange,
    transferPenalty,
    upstreamFactor,
} from "../src/route-planner/route-options-info-model.ts";
import { LAND_PATH_TYPES } from "../src/route-planner/transport-info-model.ts";

/**
 * Die Zahlen des Erklärfensters „Reiseoptionen“ (WI-0045 Stufe B; Legacy `route-options-info.js`):
 * aus unserem Reisemodell gerechnet, nie abgeschrieben. Wo Legacy abweicht, gilt das Modell.
 */

const model = AVENTURIA_TRAVEL_MODEL;
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("Schnellste · Kürzeste", () => {
    it("🔴 das Beispiel rechnet mit dem Tempo der Route, nicht mit Legacys überhöhter Tafel", () => {
        // Legacy zeigte 1,54–3,07 und 8,44 (die Tafel samt Zeitfaktor 1,19); seit WI-0258 (WdE S. 160–162) gilt die Tafel
        // 0,74 (Karren auf dem Pass) bis 2,55 (Einzelreiter) und 8,93 (Kutsche auf der Reichsstraße).
        const example = optimizeExample(model);
        expect(example?.passMin).toBeCloseTo(0.7437 / 1.19, 10);
        expect(example?.passMax).toBeCloseTo(2.55 / 1.19, 10);
        expect(example?.roadMax).toBeCloseTo(8.925 / 1.19, 10);
    });

    it("eine Wegart, die kein Mittel befährt, hat keine Spanne", () => {
        expect(speedRange("Nirgendweg", model)).toBeNull();
    });
});

describe("Umsteigen, Reisestunden", () => {
    it("der Aufschlag und die Reisetage kommen aus dem Modell", () => {
        expect(transferPenalty(model)).toBe(model.umstiegsaufschlag.wert);
        expect(restDay(model)).toEqual({ hours: 8, restHours: 16, landHours: 8, waterHours: 12 });
        expect(de["planner.optionsInfo.transfers.body"]).toContain("{penalty}");
        // Kein Entwicklerwort mehr: „Suchgewicht“ heißt jetzt, was es für die Reise bedeutet.
        expect(de["planner.optionsInfo.transfers.note"]).not.toContain("Suchgewicht");
    });

    it("🔴 das Feld „Reisestunden pro Tag“ gilt an Land UND im Flug (WI-0051 F-E2), an Bord der Tag der Besatzung", () => {
        expect(stageDayHours(model, "griffin", 10)).toBe(10);
        expect(stageDayHours(model, "groupFoot", 10)).toBe(10);
        expect(stageDayHours(model, "riverSailer", 10)).not.toBe(10);
        // Vorher hieß es „Das Feld gilt für Landreisen.“
        expect(de["planner.optionsInfo.rest.note"]).toContain("Das Feld gilt an Land und im Flug.");
        expect(en["planner.optionsInfo.rest.note"]).toContain("The field applies on land and in flight.");
        expect(de["planner.travelHours.title"]).toContain("an Land und im Flug");
        expect(de["planner.travelHours.title"]).toContain("auch an Bord");
        expect(de["planner.optionsInfo.rest.body"]).toContain("auch an Bord");
    });

    it("Schnellste und Kürzeste ohne Wegegraph und Kantengewicht, dafür mit dem, was sie suchen", () => {
        expect(de["planner.optionsInfo.optimize.body"]).not.toMatch(/Wegegraph|Kantengewicht/);
        expect(de["planner.optionsInfo.optimize.body"]).toContain("wenigsten **Stunden**");
        expect(de["planner.optionsInfo.optimize.body"]).toContain("wenigsten **Meilen**");
    });
});

describe("Reisebeginn: die Bodentafel Zone × Jahreszeit", () => {
    it("🔴 die Zeilen kommen aus der Karte (acht Zonen), benachbarte gleiche stehen in einer Zeile", () => {
        expect(CLIMATE_ZONES).toEqual([
            "polar",
            "subpolar",
            "boreal",
            "gemaessigt",
            "subtropen_winterfeucht",
            "trockene_subtropen",
            "subtropisch",
            "tropisch",
        ]);
        const rows = climateRows(CLIMATE_ZONES, model);
        expect(rows.map((row) => row.zones)).toEqual([
            ["polar"],
            ["subpolar", "boreal"],
            ["gemaessigt"],
            ["subtropen_winterfeucht"],
            // 💣 Die trockenen Subtropen haben keinen Abzug (WI-0038 E4): eine Zeile aus Strichen.
            ["trockene_subtropen", "subtropisch", "tropisch"],
        ]);
        expect(groundSeasons(model)).toEqual(["winter", "fruehling", "sommer", "herbst"]);
        expect(rows[0]?.conditions).toEqual(["eis", "eis", "tauboden", "eis"]);
        expect(rows[4]?.conditions).toEqual([null, null, null, null]);
    });

    it("zusammengefasst wird nur, was aneinandergrenzt", () => {
        const rows = climateRows(["polar", "tropisch", "polar"], model);
        expect(rows.map((row) => row.zones)).toEqual([["polar"], ["tropisch"], ["polar"]]);
    });

    it("🔴 die Verluste rechnen aus der Bodentafel in ganzen Prozent: zu Fuß 17, 33, 14, 43, 71, die Kutsche 28 und 78 (WI-0258)", () => {
        expect(groundLosses(model)).toEqual({
            road: 17,
            pass: 33,
            soft: 14,
            snow: 43,
            deep: 71,
            coachRoad: 28,
            coachDeep: 78,
        });
        // Die Zahlen stehen nie im Text, nur Platzhalter.
        for (const table of [de, en]) {
            const penalty = table["planner.optionsInfo.start.penalty"];
            for (const key of ["{road}", "{pass}", "{soft}", "{snow}", "{deep}"]) expect(penalty).toContain(key);
            const example = table["planner.optionsInfo.start.example"];
            for (const key of ["{coachRoad}", "{coachDeep}"]) expect(example).toContain(key);
        }
        expect(de["planner.optionsInfo.start.example"]).toContain("in Tiefschnee");
    });

    it("🔴 die Zustände der Bodentafel: Nässe ist kein Schnee, leichter Schnee, Tiefschnee und Eis sind es (WI-0258)", () => {
        const { zustaende, wegklasse } = model.jahreszeitBoden.wert;
        expect(Object.entries(zustaende).map(([name, state]) => [name, state.klasse, state.schnee])).toEqual([
            ["aufgeweicht", "nass", false],
            ["tauboden", "nass", false],
            ["schnee_leicht", "schnee", true],
            ["tiefschnee", "tief", true],
            ["eis", "tief", true],
        ]);
        // Reichsstraße wie Straße (S-3); Weg, Pfad und Wüstenpfad wie der trockene Weg.
        expect(wegklasse["Reichsstrasse"]).toBe(wegklasse["Strasse"]);
        expect([wegklasse["Weg"], wegklasse["Pfad"], wegklasse["Wuestenpfad"]]).toEqual(["weg", "weg", "weg"]);
        expect(de["planner.optionsInfo.start.exempt"]).toBe("Auf dem Wasser zählt kein Boden.");
    });

    it("Reisebeginn: Sperren, Schnee unter „Schnellste“, Schlitten und was ohne Reisebeginn gilt", () => {
        expect(Object.keys(model.bodenPflicht.wert)).toEqual(["sleigh"]);
        const note = de["planner.optionsInfo.start.note"];
        expect(note).toContain("unter „Schnellste“ im Schnee auch die langsamen");
        expect(note).toContain("Ohne Reisebeginn gibt es keine Jahreszeit und keinen Schlitten");
        expect(de["planner.travelStart.title"]).toContain("Der Schlitten fährt nur mit Reisebeginn.");
    });

    /**
     * 🔴 **Die DEUTSCHE Tafel trägt den Wortlaut der Datenbank** (Migration 0015, `climate_zone_type.label`):
     * Der Server liefert diesen Stamm überall mit, und der Test hält beide zusammen - er schlägt an, sobald eine
     * spätere Migration die Namen ändert.
     *
     * 🪤 **Die übrigen Tafeln gerade NICHT mehr** (WI-0171, Betreiber 2026-10-15: „übersetzen, auch der Name vom
     * Server“). Bis dahin stand hier `en` neben `de`, und das war die Regel; dass sie gefallen ist, prüft
     * `klimazonen-namen.test.ts` von der anderen Seite: je Tafel verschieden vom Deutschen, über `LOCALES`.
     */
    it("🔴 der deutsche Wortlaut ist der der Datenbank, und keine Migration ändert ihn nach", () => {
        const migrations = join(repositoryRoot, "apps", "server", "migrations");
        const sql = readFileSync(join(migrations, "0015_climate.sql"), "utf8");
        const labels = Object.fromEntries(
            [...sql.matchAll(/\('([a-z_]+)', '([^']+)', \d+\)/g)].map((match) => [match[1], match[2]]),
        );
        expect(Object.keys(labels)).toEqual([...CLIMATE_ZONES]);
        for (const [zone, label] of Object.entries(labels)) {
            expect(de[`climate.zone.${zone}` as keyof typeof de], zone).toBe(label);
            // Englisch übersetzt seit WI-0171; gleich wäre hier der Befund, nicht die Erwartung.
            expect(en[`climate.zone.${zone}` as keyof typeof en], zone).not.toBe(label);
        }
        const later = readdirSync(migrations)
            .filter((file) => file.endsWith(".sql") && file !== "0015_climate.sql")
            .filter((file) =>
                /(INSERT INTO|UPDATE)\s+climate_zone_type/i.test(readFileSync(join(migrations, file), "utf8")),
            );
        expect(later, "eine Migration ändert die Zonennamen - Sprachtafeln nachziehen").toEqual([]);
    });
});

describe("Unterbringung: Preise je Person", () => {
    it("🔴 vier Stufen mit Bett, Essen, Stall, Zoll und Passage - aus dem Modell, samt Seepassage", () => {
        const rows = lodgingRows(model);
        expect(rows.map((row) => row.level)).toEqual([...LODGING_LEVELS]);
        expect(rows[0]).toEqual({
            level: "frei",
            bed: 0,
            food: 4,
            stable: { perWeek: 5 },
            toll: 1,
            river: 100,
            sea: 67,
        });
        expect(rows[3]).toEqual({
            level: "zimmer",
            bed: 30,
            food: 17,
            stable: { perNight: 6 },
            toll: 500,
            river: 1000,
            sea: 416,
        });
        expect(upstreamFactor(model)).toBe(3);
    });

    /**
     * Die Sätze „Reichsstraße, Straße und Weg führen ins Gasthaus“ und „Auf Pfad, Pass, Wüstenpfad und querfeldein …
     * im Freien“ stehen als Text in der Sprachtafel (WI-0065 Nachtrag, `fd38df92`). Sie gelten, solange das Modell
     * dieselben Wegarten mit Gasthaus führt und die übrigen Landwege ohne Dach.
     */
    it("🔴 der Satz über das Dach passt zum Modell", () => {
        expect(roofedLandPaths(model)).toEqual(["Reichsstrasse", "Strasse", "Weg"]);
        const roof = model.reisekosten.dach.wert;
        expect(LAND_PATH_TYPES.filter((pathType) => roof[pathType] === undefined)).toEqual([
            "Pfad",
            "Gebirgspass",
            "Wuestenpfad",
            "Querfeldein",
        ]);
        expect([roof["Flussweg"], roof["Seeweg"]]).toEqual(["anBord", "anBord"]);
        for (const key of ["planner.optionsInfo.lodging.note", "planner.lodging.title"] as const) {
            expect(de[key], key).toMatch(/Reichsstraße, Straße,? (und )?Weg(: Gasthaus| führen ins Gasthaus)/);
            expect(de[key], key).toMatch(/Pfad, Pass, Wüstenpfad,? (und )?querfeldein/);
            expect(de[key], key).toMatch(/Fluss und See:? an Bord/);
        }
        // Im ⓘ als Aufzählung (WI-0076 Folge: weniger Textwand), am Feld als Satz.
        expect(de["planner.optionsInfo.lodging.note"]).toContain("- Reichsstraße, Straße, Weg: Gasthaus");
        expect(en["planner.optionsInfo.lodging.note"]).toContain("- Imperial road, road, way: inn");
    });

    /** Das Reittier: Stall in jeder Gasthausnacht, bei „im Freien/Zelt“ Futter je Woche (`travel-costs.ts`). */
    it("🔴 Stall und Futter: nur Gasthausnächte, bei „im Freien“ Futter je Woche; die Kutsche kauft die Fahrt", () => {
        const rows = lodgingRows(model);
        expect(rows.find((row) => row.level === "frei")?.stable).toEqual({ perWeek: 5 });
        expect(rows.find((row) => row.level === "bett")?.stable).toEqual({ perNight: 6 });
        const note = de["planner.optionsInfo.lodging.note"];
        expect(note).toContain("nur in Gasthausnächten");
        expect(note).toContain("bei „{open}“ Futter je Woche");
        // Die Kutschfahrt fehlte im Fenster; ihr Preis kommt aus dem Modell.
        expect(coachFare(model)).toBe(model.reisekosten.kutsche.wert.je100Meilen);
        expect(note).toContain("die Kutschfahrt {coach} je 100 Meilen");
        expect(en["planner.optionsInfo.lodging.note"]).toContain("the coach fare is {coach} per 100 miles");
    });

    /** Der Satz über die Grenze nennt die Schwelle aus dem Reisemodell (WI-0065), nicht eine abgeschriebene Zahl. */
    it("🔴 die Schwelle für eine Landesgrenze kommt aus dem Reisemodell", () => {
        expect(minBorderMiles(model)).toBe(model.reisekosten.grenzuebertritt.wert.mindestLaufMeilen);
        expect(de["planner.optionsInfo.lodging.note"]).toContain("Unter {miles} Meilen");
        expect(en["planner.optionsInfo.lodging.note"]).toContain("Under {miles} miles");
        expect(de["planner.optionsInfo.lodging.note"]).not.toContain("erst, wenn die Herrschaftsgebiete");
        // Kein „Server“ und kein „wie Legacy“ in einem Satz für Spieler.
        expect(de["planner.optionsInfo.lodging.note"]).not.toMatch(/Server|Legacy/);
    });
});
