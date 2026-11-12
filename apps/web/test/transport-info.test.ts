import { afterEach, describe, expect, it } from "vitest";
import {
    airCeilingAbsolute,
    airMaxAboveGround,
    airStandardHeight,
    AVENTURIA_TRAVEL_MODEL,
    familyStepFactor,
    SLOPE_FAMILIES,
    stageDayHours,
    transportFlowFactor,
} from "@avesmaps3d/shared";
import { en } from "../src/i18n/en.ts";
import { de } from "../src/i18n/de.ts";
import { formatDecimal, locale } from "../src/i18n/i18n.ts";
import {
    crossCountryRange,
    LAND_PATH_TYPES,
    landSpeedTable,
    ledPace,
    nonStopTransports,
    offroadRampMax,
    paceExample,
    realSpeed,
    steepDownhill,
    tierOf,
    travelDay,
    waterSpeeds,
} from "../src/route-planner/transport-info-model.ts";

/**
 * Die Zahlen des Erklärfensters „Transportmittel“ (WI-0045): aus unserem Reisemodell gerechnet.
 *
 * 🔴 Beim Tempo gilt unser Modell, nicht Legacys Anzeige: Legacy zeigte die um den Zeitfaktor
 * überhöhte Tafel. Gezeigt wird, was die Route wirklich rechnet (WI-0017, Inventur C7).
 */

const model = AVENTURIA_TRAVEL_MODEL;

afterEach(() => {
    locale.value = "de";
});

describe("Das Tempo, mit dem die Route rechnet", () => {
    it("🔴 ist der Tafelwert geteilt durch den Zeitfaktor", () => {
        expect(model.zeitfaktor.wert).toBe(1.19);
        expect(realSpeed(model, "groupFoot", "Strasse")).toBeCloseTo(4.4625 / 1.19, 10);
        // Die Tagesleistung der Geographia: ein Lastensegler 120 Meilen in 12 Stunden, ein Flusssegler 60.
        expect(realSpeed(model, "cargoShip", "Seeweg")).toBeCloseTo(10, 10);
        expect(realSpeed(model, "riverSailer", "Flussweg")).toBeCloseTo(5, 10);
    });

    it("🔴 wo ein Mittel nie fährt, gibt es keine Zahl: die Kutsche auf dem Wüstenpfad; querfeldein fährt sie (WI-0258)", () => {
        expect(realSpeed(model, "horseCarriage", "Wuestenpfad")).toBeNull();
        expect(realSpeed(model, "horseCarriage", "Querfeldein")).toBeCloseTo(2.6775 / 1.19, 12);
        expect(realSpeed(model, "cart", "Querfeldein")).toBeCloseTo(1.785 / 1.19, 12);
        expect(realSpeed(model, "wagon", "Querfeldein")).toBeCloseTo(2.6775 / 1.19, 12);
        // Auf einem Pfad darf sie, wo die Redaktion es erlaubt - die Zahl steht.
        expect(realSpeed(model, "horseCarriage", "Pfad")).not.toBeNull();
    });

    it("die Tafel hat Legacys Zeilen und die Landmittel des Modells als Spalten", () => {
        const table = landSpeedTable(model);
        expect(table.rows.map((row) => row.pathType)).toEqual([...LAND_PATH_TYPES]);
        expect(table.transports).toEqual(model.transportmittel.wert.land);
        for (const row of table.rows) expect(row.cells.map((cell) => cell.transport)).toEqual(table.transports);
    });

    it("💣 die Ampel teilt die gezeigten Zahlen in Drittel - und sieht die Striche nicht", () => {
        const table = landSpeedTable(model);
        const cells = table.rows.flatMap((row) => row.cells);
        const shown = cells.flatMap((cell) => (cell.speed === null ? [] : [cell.speed]));
        const fastest = Math.max(...shown);
        const slowest = Math.min(...shown);
        expect(cells.find((cell) => cell.speed === fastest)?.tier).toBe("schnell");
        expect(cells.find((cell) => cell.speed === slowest)?.tier).toBe("langsam");
        expect(cells.filter((cell) => cell.speed === null).every((cell) => cell.tier === null)).toBe(true);
        expect(new Set(cells.map((cell) => cell.tier))).toEqual(new Set(["schnell", "mittel", "langsam", null]));
        // Die Grenzen liegen bei einem und zwei Dritteln.
        const step = (fastest - slowest) / 3;
        expect(tierOf(slowest + step, shown)).toBe("mittel");
        expect(tierOf(slowest + step - 1e-9, shown)).toBe("langsam");
        expect(tierOf(slowest + 2 * step, shown)).toBe("schnell");
        expect(tierOf(3, [3, 3])).toBe("mittel");
    });

    it("die Spanne querfeldein kommt aus derselben Spalte der Tafel", () => {
        const range = crossCountryRange(model);
        const column = landSpeedTable(model)
            .rows.find((row) => row.pathType === "Querfeldein")
            ?.cells.flatMap((cell) => (cell.speed === null ? [] : [cell.speed]));
        expect(range).toEqual({ min: Math.min(...(column ?? [])), max: Math.max(...(column ?? [])) });
    });

    it("Fluss und Meer: die Mittel des Modells in seiner Reihenfolge", () => {
        expect(waterSpeeds("river", model).map((entry) => entry.transport)).toEqual([
            "riverSailer",
            "riverBarge",
            "riverGalley",
            "rowboat",
        ]);
        expect(waterSpeeds("sea", model).map((entry) => entry.transport)).toEqual([
            "cargoShip",
            "fastShip",
            "galley",
            "courierDromone",
            "rowboat",
        ]);
    });

    it("🔴 jedes Schiff zeigt Reisestunden, Tagesleistung und Tempo aus dem Modell (WI-0069)", () => {
        const rows = new Map(
            [...waterSpeeds("river", model), ...waterSpeeds("sea", model)].map((row) => [row.transport, row]),
        );
        const expected: Record<string, [number, number, boolean]> = {
            riverBarge: [40, 12, false],
            riverSailer: [60, 12, false],
            riverGalley: [75, 12, false],
            cargoShip: [120, 12, false],
            fastShip: [250, 24, true],
            // Betreiber 2026-10-03, Option A: die Galeere mit den GA-Normalwerten, nicht eilgerudert.
            galley: [70, 8, false],
            courierDromone: [200, 24, true],
            rowboat: [25, 12, false],
        };
        for (const [transport, [miles, hours, nonStop]] of Object.entries(expected)) {
            const row = rows.get(transport);
            expect(row?.miles, transport).toBe(miles);
            expect(row?.hours, transport).toBe(hours);
            expect(row?.nonStop, transport).toBe(nonStop);
            // Das Tempo ist die Tagesleistung durch die Stunden, auf zwei Stellen der Tafel genau.
            expect(row?.speed, transport).toBeCloseTo(miles / hours, 1);
        }
        // Stromauf: Kahn und Flusssegler mit halbem Tempo, die Flussgaleere mit 35 Meilen am Tag (GA S. 129).
        expect(rows.get("riverBarge")?.upstream).toBeCloseTo((rows.get("riverBarge")?.speed ?? 0) / 2, 12);
        expect(rows.get("riverGalley")?.upstream).toBeCloseTo(((rows.get("riverGalley")?.speed ?? 0) * 35) / 75, 12);
        expect(rows.get("cargoShip")?.upstream).toBeNull();
        // Das Ruderboot fährt keinen gezeichneten Seeweg, hat aber sein Tempo auf See (freie Seefahrt).
        expect(rows.get("rowboat")?.speed).toBeCloseTo(2.48 / 1.19, 12);
    });

    it("die Landtafel trägt über den Tempi die Tagesleistung je Mittel", () => {
        const table = landSpeedTable(model);
        expect(
            Object.fromEntries(table.transports.map((transport, index) => [transport, table.dayMiles[index]])),
        ).toEqual({
            groupFoot: 30,
            lightWalker: 40,
            groupHorse: 35,
            lightRider: 50,
            caravan: 30,
            cart: 25,
            wagon: 30,
            horseCarriage: 50,
            // Kaleschka auf Kufen (WdE S. 162, WI-0258 E3).
            sleigh: 42,
        });
    });

    it("Zahlen wie in Legacys Tafel: höchstens zwei Stellen, ohne Nullen am Ende", () => {
        expect(formatDecimal(4.4625 / 1.19, 2)).toBe("3,75");
        expect(formatDecimal(5, 2)).toBe("5");
        locale.value = "en";
        expect(formatDecimal(4.4625 / 1.19, 2)).toBe("3.75");
    });
});

describe("Die Sätze passen zum Modell", () => {
    it("Reise- und Rastzeit kommen aus dem Modell, nicht aus dem Satz", () => {
        expect(travelDay(model)).toEqual({ landHours: 8, landRest: 16, waterHours: 12, waterRest: 12 });
    });

    /**
     * 🪤 Diese Sätze nennen Werte des Modells in Worten („doppelt so lang“, „twice“), wie Legacy sie schreibt.
     * Ändert jemand das Modell, schlägt dieser Test an - dann gehört der Satz mitgeändert, in beiden Sprachen.
     */
    it("🪤 der Satz zu Strom und Nachtfahrt nennt, was das Modell rechnet", () => {
        expect(model.stroemungsfaktorVorgabe.wert).toBe(2);
        expect(de["transportInfo.riverNote"]).toContain("in der Regel doppelt so lang");
        expect(en["transportInfo.riverNote"]).toContain("usually takes twice as long");
        // WI-0076: Die Flussgaleere braucht stromauf MEHR als das Doppelte (75/35). Der alte Satz „rudert kräftiger
        // dagegen an“ las sich wie das Gegenteil; jetzt verweist der Satz auf die Spalte stromauf.
        expect(transportFlowFactor(model, "riverGalley")).toBeGreaterThan(model.stroemungsfaktorVorgabe.wert);
        expect(de["transportInfo.riverNote"]).not.toContain("kräftiger");
        expect(de["transportInfo.riverNote"]).toContain("in der letzten Spalte");
        // Eine eingetragene Strömung hat keinen Deckel (der Router nimmt `max(1, Faktor)`): kein „bis zum 6-fachen“.
        expect(de["transportInfo.riverNote"]).not.toMatch(/6-fach/);
        expect(en["transportInfo.riverNote"]).not.toMatch(/6 times/);
        // Wer durchfährt, kommt aus dem Modell ({nonStop}); kein Name steht als feste Zahl oder Liste im Satz.
        expect(nonStopTransports(model)).toEqual(["fastShip", "courierDromone"]);
        expect(de["transportInfo.seaNote"]).toContain("{nonStop}");
        expect(en["transportInfo.seaNote"]).toContain("{nonStop}");
        expect(de["transportInfo.seaNote"]).not.toContain("Nur der Schnellsegler");
        expect(de["planner.optionsInfo.rest.note"]).toContain("{nonStop}");
        // Keine Stundenzahl der Schiffe als Literal in den Sätzen zu Rast und Reisestunden.
        for (const key of [
            "transportInfo.rest",
            "planner.optionsInfo.rest.note",
            "planner.travelHours.title",
        ] as const) {
            expect(de[key], key).not.toMatch(/\b(8|12|24) (Stunden|Std)/);
            expect(en[key], key).not.toMatch(/\b(8|12|24) hours/);
        }
    });

    it("🔴 die Einleitung rechnet ihr Beispiel aus der Tafel (WI-0076), statt „doppelt so schnell“ abzuschreiben", () => {
        // Reichsstraße 1,1 gegen Gebirgspass 0,4: fast dreimal so schnell, nicht „doppelt“; und einen „Gebirgspfad“ gibt
        // es nicht.
        const pace = paceExample(model);
        expect(pace?.road).toBeCloseTo(realSpeed(model, "groupFoot", "Reichsstrasse") ?? 0, 12);
        expect(pace?.pass).toBeCloseTo(realSpeed(model, "groupFoot", "Gebirgspass") ?? 0, 12);
        expect((pace?.road ?? 0) / (pace?.pass ?? 1)).toBeGreaterThan(2.5);
        for (const table of [de, en]) {
            expect(table["transportInfo.intro"]).toContain("{road}");
            expect(table["transportInfo.intro"]).toContain("{pass}");
        }
        expect(de["transportInfo.intro"]).not.toMatch(/doppelt so schnell|Gebirgspfad/);
        // Die Landtafel trägt seit WI-0069 auch die Meilen am Tag: „Alle Werte in Meilen pro Stunde“ stimmt nicht mehr.
        expect(de["transportInfo.intro"]).not.toContain("Alle Werte in Meilen pro Stunde");
        expect(de["transportInfo.intro"]).toContain("Meilen am Tag");
    });

    it("🔴 querfeldein: kein „per Luftlinie“ mehr (WI-0049 F5), der Längenaufschlag kommt aus dem Modell", () => {
        expect(offroadRampMax(model)).toBe(model.querfeldeinLaengenaufschlag.wert.hoechstens);
        for (const table of [de, en]) {
            expect(table["transportInfo.crossCountry"]).toContain("{range}");
            expect(table["transportInfo.crossCountry"]).toContain("{ramp}");
        }
        expect(de["transportInfo.crossCountry"]).not.toContain("Luftlinie");
        expect(de["transportInfo.crossCountry"]).toContain("Hänge, Wald und Sumpf umgeht sie");
        expect(de["transportInfo.crossCountry"]).toContain("Seen quert sie nie");
    });

    it("die Steigung verweist auf den Reiter unter seinem heutigen Namen, nicht auf ein getipptes „Gebirge“", () => {
        expect(de["transportInfo.slope"]).toContain("„{tab}“");
        expect(en["transportInfo.slope"]).toContain("“{tab}”");
        expect(de["transportInfo.slope"]).toContain("auf Wegen wie querfeldein");
    });

    it("der Schlitten: nur mit Reisebeginn, Winterschnee und über der Schneegrenze, mit Werten der Kaleschka und zugefrorenen Bächen", () => {
        const sleigh = model.bodenPflicht.wert["sleigh"];
        expect(sleigh?.jahreszeiten).toEqual(["winter"]);
        expect(sleigh?.gebirgeUeberSchneegrenze).toBe(true);
        expect(sleigh?.baecheGefroren).toBe(true);
        expect(de["transportInfo.sleigh"]).toContain("Er braucht einen Reisebeginn und fährt nur\n- im Winter");
        expect(de["transportInfo.sleigh"]).toContain("oberhalb der Schneegrenze, dort das ganze Jahr");
        expect(de["transportInfo.sleigh"]).toContain("Seine Werte sind die eines Pferdeschlittens auf Schnee");
        expect(de["transportInfo.sleigh"]).toContain("zugefrorene Bäche quert er ohne Aufenthalt");
        // 🪤 Die Fenster liegen geschlossen im DOM: Ein Erklärsatz trägt die Feldaufschrift „Reisebeginn:“ nicht wörtlich,
        // sonst wird `getByText("Reisebeginn:")` mehrdeutig (route-departure.spec).
        expect(de["transportInfo.sleigh"]).not.toContain(de["planner.travelStartLabel"]);
        expect(en["transportInfo.sleigh"]).not.toContain(en["planner.travelStartLabel"]);
    });
});

/**
 * Der Ton der Erklärtexte (WI-0076, Betreiber 2026-10-04: „einfacher, verständlich und menschenähnlicher (aber wie aus
 * einem regelwerk)“): unpersönliche Regelstimme ohne Anrede (Guide §24) und keine Entwicklersprache. Platzhalter zählen
 * nicht mit.
 */
describe("Der Ton der Erklärtexte", () => {
    const PROSE =
        /^(transportInfo\.(intro|riverNote|seaNote|rest|crossCountry|sleigh|slope|button\.title|air\.(intro|custom|mark\.|chartNote|rule\.)|mountain\.(intro|rule\.))|planner\.optionsInfo\.(intro|[a-z]+\.(body|note|example|penalty|exempt|canon))|planner\.(travelHours|travelStart|lodging|air\.values)\.title)/;
    const keys = (Object.keys(de) as (keyof typeof de)[]).filter((key) => PROSE.test(key));
    const plain = (text: string): string => text.replace(/\{\w+\}/g, "").replace(/\]\(https?:[^)]*\)/g, "]");

    it("deckt alle Fenster ab", () => {
        expect(keys.length).toBeGreaterThan(45);
    });

    it("🔴 deutsch ohne Anrede", () => {
        for (const key of keys) expect(plain(de[key]), key).not.toMatch(/\b(du|dich|dir|dein\w*|euch|euer\w*)\b/i);
    });

    it("🪤 kein Erklärtext trägt eine Feldaufschrift wörtlich (die Fenster liegen geschlossen im DOM)", () => {
        const labels = ["planner.travelStartLabel", "planner.lodgingLabel", "planner.travelHoursLabel"] as const;
        for (const key of keys) {
            for (const label of labels) {
                expect(de[key], key).not.toContain(de[label]);
                expect(en[key], key).not.toContain(en[label]);
            }
        }
    });

    it("🔴 englisch ohne Anrede", () => {
        for (const key of keys) expect(plain(en[key]), key).not.toMatch(/\b(you|your\w*)\b/i);
    });

    it("🔴 keine Entwicklersprache", () => {
        const jargonDe =
            /A\*|Kostenfeld|Faktor|μ|Eichung|Kalibrier|Domäne|(?<!Höhen)[Pp]rofil|Revision|Legacy|WI-\d|Tafelwert|Zeitfaktor|Suchgewicht|Kantengewicht|Wegegraph|\bGraph|Server|Setzung/;
        const jargonEn =
            /A\*|cost field|factor|calibrat|domain|(?<!elevation )profile|revision|Legacy|WI-\d|search weight|edge weight|\bgraph\b|server/i;
        for (const key of keys) {
            expect(plain(de[key]), key).not.toMatch(jargonDe);
            expect(plain(en[key]), key).not.toMatch(jargonEn);
        }
    });
});

/**
 * Der Reiter „Gebirge“ (WI-0049, Betreiber 2026-09-28). Das Bild rechnet mit dem Rechner des Routers; die
 * Regeln darunter sagen Werte des Modells in Worten. 🪤 Ändert jemand das Modell, schlägt das hier an - dann
 * gehört der Satz mitgeändert, in beiden Sprachen.
 */
describe("Der Reiter Gebirge sagt, was das Modell rechnet", () => {
    const rule = model.steigung.wert;

    it("bergab ist nie schneller als eben; zu Fuß bremst es erst steil, Tier und Wagen schon früher", () => {
        for (const family of SLOPE_FAMILIES) {
            for (let s = -1; s <= 1; s += 0.01) expect(familyStepFactor(family, s, model)).toBeGreaterThanOrEqual(1);
        }
        expect(familyStepFactor("FOOT", -(rule.steilAb - 0.01), model)).toBe(1);
        expect(familyStepFactor("EQUID", -(rule.steilAb - 0.01), model)).toBeGreaterThan(1);
        expect(familyStepFactor("WHEEL", -(rule.steilAb - 0.01), model)).toBeGreaterThan(1);
        // WI-0076: Die Schwellen stehen als Zahl im Satz, gesucht am Rechner des Routers: zu Fuß der steile Abstieg,
        // das Tier bis 2 × Versatz frei, der Wagen bis zur Rollgrenze.
        const steep = steepDownhill(model);
        // Gesucht auf sechs Stellen genau (der Wagen wächst quadratisch, darunter rundet die Rechnung auf 1); der Satz
        // zeigt ganze Prozent.
        expect(steep.FOOT).toBeCloseTo(rule.steilAb, 6);
        expect(steep.EQUID).toBeCloseTo(2 * rule.familien.EQUID.versatz, 6);
        expect(steep.WHEEL).toBeCloseTo(rule.familien.WHEEL.rollgrenze, 6);
        expect(steep.FOOT).toBeGreaterThan(steep.EQUID);
        expect(steep.EQUID).toBeGreaterThan(steep.WHEEL);
        for (const table of [de, en]) {
            for (const name of ["{foot}", "{animal}", "{wheel}"]) {
                expect(table["transportInfo.mountain.rule.downhill"]).toContain(name);
            }
        }
    });

    it("Kehren gibt es für Tier und Wagen", () => {
        expect(rule.familien.EQUID.kehren).toBe(true);
        expect(rule.familien.WHEEL.kehren).toBe(true);
        expect(de["transportInfo.mountain.rule.switchbacks"]).toContain("Tiere ({animal}) oder Wagen ({wheel})");
    });

    it("🪤 abgesessen wird querfeldein und auf Pfaden im Gebirge, alle gehen dann langsamer als die Gruppe zu Fuß (WdE S. 161)", () => {
        expect(rule.sternregel.imGebirge).toEqual(["Pfad", "Querfeldein"]);
        expect(new Set(Object.values(rule.sternregel.absteigen))).toEqual(new Set(["groupFoot"]));
        // Geführt: Pfad 7 gegen 9, querfeldein 3 gegen 6 Meilen am Tag - die Anzeige liest 78 und 50 % aus dem Modell.
        expect(rule.sternregel.gefuehrt).toEqual({ Pfad: { tier: 7, fuss: 9 }, Querfeldein: { tier: 3, fuss: 6 } });
        const led = ledPace(model);
        expect(Math.round((led?.path ?? 0) * 100)).toBe(78);
        expect(Math.round((led?.open ?? 0) * 100)).toBe(50);
        expect(de["transportInfo.mountain.rule.dismount"]).toContain(
            "Dann geht es langsamer als eine Gruppe zu Fuß: auf dem Pfad mit {path} %, querfeldein mit {open} % ihres Tempos.",
        );
        for (const table of [de, en]) {
            for (const name of ["{path}", "{open}"]) {
                expect(table["transportInfo.mountain.rule.dismount"]).toContain(name);
            }
        }
        expect(en["transportInfo.mountain.rule.dismount"]).toContain("slower than a group on foot");
    });

    it("🔴 die Steigung zählt auch außerhalb der Gebirge, querfeldein (F5) und auf Wegen (F5c); der Reiter sagt es in beiden Sprachen", () => {
        expect(de["transportInfo.mountain.rule.open.title"]).toBe("Auch im Hügelland");
        expect(de["transportInfo.mountain.rule.open"]).toContain("auf Straßen, Wegen und Pfaden wie querfeldein");
        expect(de["transportInfo.mountain.rule.open"]).toContain("behält jede Wegart ihr Tempo");
        expect(de["transportInfo.mountain.rule.open"]).toContain("die stärkere Bremse");
        expect(en["transportInfo.mountain.rule.open.title"]).toBe("In the hills, too");
        expect(en["transportInfo.mountain.rule.open"]).toContain("on roads, ways and trails as well as cross-country");
        expect(en["transportInfo.mountain.rule.open"]).toContain("every way type keeps its pace");
        expect(en["transportInfo.mountain.rule.open"]).toContain("the stronger brake");
        // Abgesessen wird nur in den Gebirgsflächen (Sternregel): Im Hügelland bleiben Reiter im Sattel.
        expect(de["transportInfo.mountain.rule.open"]).toContain("Reiter bleiben hier im Sattel");
        expect(en["transportInfo.mountain.rule.open"]).toContain("Riders stay in the saddle here");
    });

    it("🔴 Wagen: was die Tafel nie anbietet, steht im Satz - auch der Wüstenpfad (WI-0076, vorher vergessen)", () => {
        const never = model.nieAngeboten.wert;
        expect(never["Wuestenpfad"]).toEqual(expect.arrayContaining(["horseCarriage", "cart", "wagon"]));
        // Querfeldein fahren sie seit WI-0258, aber nur über offenes Land (`querfeldeinFahrzeuge`).
        expect(never["Querfeldein"]).toBeUndefined();
        expect(model.querfeldeinFahrzeuge.wert.reisemittel).toEqual(["cart", "wagon", "horseCarriage"]);
        expect(never["Pfad"]).toEqual(expect.arrayContaining(["cart", "wagon"]));
        expect(never["Pfad"]).not.toContain("horseCarriage");
        // Ohne gespeicherte Freigabe fährt die Kutsche keinen Pfad.
        expect(model.vorgabeOhneListe.wert["Pfad"]).toContain("horseCarriage");
        const text = de["transportInfo.mountain.rule.carriage"];
        expect(text).toContain("querfeldein nur über offenes Land, Tundra und Hochebenen");
        expect(text).toContain("nicht ins Gebirge");
        expect(text).toContain("Wüstenpfade fahren sie nie");
        expect(de["transportInfo.mountain.rule.carriage.title"]).toBe("Wagen bleiben auf offenem Land");
        expect(text).toContain("Karren und Fuhrwerk fahren auch nicht auf Pfaden");
        expect(text).toContain("einen Pfad nur, wo er für sie freigegeben ist");
        expect(en["transportInfo.mountain.rule.carriage"]).toContain(
            "go cross-country only over open land, tundra and plateaus",
        );
    });

    it("das Beispiel mit 10 % liest sich rund: zu Fuß doppelt so lang", () => {
        expect(familyStepFactor("FOOT", 0.1, model)).toBeCloseTo(2, 12);
        expect(Math.round(familyStepFactor("EQUID", 0.1, model) * 10) / 10).toBe(1.4);
        expect(Math.round(familyStepFactor("WHEEL", 0.1, model) * 10) / 10).toBe(2.8);
    });
});

/**
 * Der Reiter „Flug“ (WI-0051, Betreiber 2026-09-28: „du machst den reiter für flug“). Die Sätze nennen Werte des
 * Reisemodells über Platzhalter; was fest im Satz steht, hält dieser Block fest.
 */
describe("Der Reiter Flug sagt, was das Modell rechnet", () => {
    const flug = model.flug.wert;

    it("🔴 Betreiber 2026-10-04: höchstens Flughöhe mal 1.000 % über Grund, nie höher als 5.000 über dem Meer, für jedes Flugmittel", () => {
        expect(flug.hoechstflughoeheProzent).toBe(1000);
        expect(airCeilingAbsolute(model)).toBe(5000);
        for (const profile of flug.profile) {
            expect(airMaxAboveGround(model, profile.reisehoehe)).toBe(profile.reisehoehe * 10);
        }
        expect(de["transportInfo.air.rule.ceiling"]).toContain("{factor}-mal seine Flughöhe über den Boden");
        expect(de["transportInfo.air.rule.ceiling"]).toContain("Höher als {ceiling} Schritt über dem Meer");
        // Das Beispiel nennt das Flugmittel mit seinem Namen aus der Tafel, nicht „Hexenbesen“.
        expect(de["transportInfo.air.rule.ceiling"]).toContain("beim {name} mit {cruise} Schritt Flughöhe");
        expect(de["transportInfo.air.custom"]).toContain("höchstens {factor}-mal die Flughöhe über dem Boden");
        expect(de["transportInfo.air.custom"]).toContain("nie mehr als {ceiling} Schritt über dem Meer");
        expect(en["transportInfo.air.custom"]).toContain("never more than {ceiling} paces above sea level");
    });

    it("der Abstand über den Graten und das Ausweichen kommen aus dem Modell", () => {
        expect(flug.mindestabstandSchritt).toBe(200);
        expect(de["transportInfo.air.rule.around"]).toContain("mit {clearance} Schritt Abstand");
        expect(de["transportInfo.air.rule.around"]).toContain("Berge bis {limit} Schritt");
        expect(de["transportInfo.air.mark.over"]).toContain("{clearance} Schritt über den Graten");
        // Umflogen wird nur Gelände über 5.000 − 200 Schritt (4.800), nicht mehr je Flugmittel.
        expect(airCeilingAbsolute(model) - flug.mindestabstandSchritt).toBe(4800);
        // Start oder Ziel in solchem Gelände: dieselbe Grenze, als Platzhalter.
        expect(de["transportInfo.air.rule.start"]).toContain("in Bergen über {limit} Schritt");
        expect(en["transportInfo.air.rule.start"]).toContain("mountains above {limit} paces");
    });

    it("🔴 Jahreszeit und Schneegrenze im Flug (WI-0051 Nachtrag 2026-10-04): bremst nicht, das Höhenprofil zeigt sie", () => {
        const text = de["transportInfo.air.rule.notCounted"];
        expect(text).toContain("Jahreszeit");
        expect(text).toContain("Mit Reisebeginn zeigt das Höhenprofil trotzdem die Schneegrenze");
        expect(text).toContain("Klimazone");
        expect(en["transportInfo.air.rule.notCounted"]).toContain("the elevation profile still shows the snow line");
        expect(de["transportInfo.air.rule.map"]).toContain(
            "Im Höhenprofil der Reise steht die Flughöhe als rote Linie",
        );
    });

    it("🔴 F4 (Betreiber 2026-10-04): Höhe über der üblichen Flughöhe kostet Zeit; die Sätze nennen die Werte des Modells über Platzhalter", () => {
        // Die Werte stehen einmal im Reisemodell, der Reiter liest sie.
        expect(flug.steigkostenFaktor).toBe(50);
        expect(flug.haltekostenFaktor).toBe(1);
        const rule = de["transportInfo.air.rule.height"];
        // Betreiber: „der aufstieg zur durchschnittlichen flughöhe kostet nichts“, „die flughöhe soll kosten bis wieder
        // die durchschnittliche flughöhe erreicht ist“. Bezug ist die übliche Flughöhe (im Modell `reisehoehe`), mindestens der Mindestabstand.
        expect(airStandardHeight(model, 100)).toBe(flug.mindestabstandSchritt);
        expect(rule).toContain("Bis zur üblichen Flughöhe über dem Boden (mindestens {clearance} Schritt)");
        expect(rule).toContain("kostet nichts");
        expect(rule).toContain("{climb} Schritt Strecke");
        expect(rule).toContain("bis zu {hold} Prozent");
        expect(rule).toContain("das gilt auch beim Sinken, bis es wieder auf der üblichen Flughöhe ist");
        expect(rule).toContain("Darum fliegt es lieber durchs Tal oder an einem Gipfel vorbei als darüber.");
        // Der Name der Anzeige kommt aus ihrem eigenen Schlüssel, nicht getippt.
        expect(rule).toContain("„{extra}“");
        expect(en["transportInfo.air.rule.height"]).toContain(
            "That is why it prefers the valley or a way past a peak to going over it.",
        );
        expect(en["transportInfo.air.rule.height"]).toContain("{climb} paces of distance");
        // Der Zuschlag heißt „über üblicher Flughöhe“, nicht „Aufstieg“: Auch das Halten kostet. Betreiber 2026-10-04:
        // „Flughöhe ist korrekt, wenn es um fliegende Dinge geht … Reisehöhe könnte auch für den Boden gelten.“
        expect(de["planner.air.extra"]).toBe("+{hours} Std. über üblicher Flughöhe");
        expect(en["planner.air.extra"]).toBe("+{hours} h above usual flight altitude");
        // Die Prozentzahl in der größten Höhe: 1 − 100 % / 1.000 % = 90 % des Haltefaktors.
        expect((1 - 100 / flug.hoechstflughoeheProzent) * flug.haltekostenFaktor * 100).toBeCloseTo(90, 9);
        // „Nur höhere Berge umfliegt es“ gilt nicht mehr: Der Flug sucht sich selbst den Weg mit der kürzesten Zeit (F4b: über
        // einem Kostenfeld, auch knapp an einem Gipfel vorbei oder durchs Tal, nicht nur um Gebirge über festen Schwellen).
        expect(de["transportInfo.air.rule.around"]).not.toContain("Nur höhere Berge");
        expect(de["transportInfo.air.rule.around"]).toContain("den Weg mit der kürzesten Zeit");
        expect(de["transportInfo.air.rule.around"]).toContain("knapp an einem einzelnen Gipfel vorbei oder durchs Tal");
        expect(en["transportInfo.air.rule.around"]).toContain("close by a single peak or along the valley");
        expect(de["transportInfo.air.rule.time"]).toContain("über der üblichen Flughöhe");
    });

    it("🪤 Rast wie an Land: Ein Flug rechnet mit den Reisestunden des Planers, nicht mit dem Tag auf dem Wasser", () => {
        expect(stageDayHours(model, "griffin", 8)).toBe(stageDayHours(model, "groupFoot", 8));
        expect(de["transportInfo.air.rule.time"]).toContain("wie an Land");
    });

    it("🔴 der Wert der Flugmittel heißt „Flughöhe“, nie „Reisehöhe“ (Betreiber 2026-10-04: „Reisehöhe könnte auch für den Boden gelten“)", () => {
        for (const key of Object.keys(de) as (keyof typeof de)[]) {
            expect(de[key], key).not.toMatch(/Reise­?höhe|Standardflughöhe/);
            expect(en[key], key).not.toMatch(/cruising|standard flight altitude/i);
        }
        expect(de["transportInfo.air.col.cruise"].replace("­", "")).toBe("Flughöhe");
        expect(en["transportInfo.air.col.cruise"]).toBe("Flight altitude");
        expect(de["planner.air.custom.altitude"]).toBe("Flughöhe:");
        expect(en["planner.air.custom.altitude"]).toBe("Flight altitude:");
        // Die Obergrenze bleibt „Höchstflughöhe“; wo beide nebeneinander stehen, heißt der Wert „übliche Flughöhe“.
        expect(de["transportInfo.air.ceilingLine"]).toContain("Höchstflughöhe");
        expect(de["transportInfo.air.cruiseLine"]).toContain("übliche Flughöhe");
    });
});
