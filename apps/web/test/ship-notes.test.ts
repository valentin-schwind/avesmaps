import { afterEach, describe, expect, it } from "vitest";
import { AVENTURIA_TRAVEL_MODEL, type RouteResponse } from "@avesmaps3d/shared";
import { de } from "../src/i18n/de.ts";
import { en } from "../src/i18n/en.ts";
import { locale } from "../src/i18n/i18n.ts";
import { shipNotes } from "../src/route-planner/ship-notes.ts";

/**
 * Die Schifffahrtshinweise der Routendetails (WI-0069): nur mit Schiff, nur zu den benutzten Schiffen, jeder Satz
 * einmal, die Zahl vorn gleich der Zahl der Zeilen. Fahr- und Rastzeiten kommen aus dem Reisemodell; die erklärenden
 * Hinweise sind aus der Geographia Aventurica (Betreiber 2026-10-03).
 */

afterEach(() => {
    locale.value = "de";
});

const route = (transports: string[], hours = 8): Pick<RouteResponse, "stages" | "hours_per_day"> => ({
    hours_per_day: hours,
    stages: transports.map((transport) => ({ transport })) as unknown as RouteResponse["stages"],
});
const CREW = "An Bord gilt der Rhythmus der Besatzung, nicht die Reisestunden der Reisenden.";
const NO_REST = "Mit 24 Reisestunden pro Tag rechnet die Route ohne Rast, auch an Bord.";
const OARED_CARGO = "Ruderschiffe besitzen nur begrenzten Frachtraum.";

/** Alles, was eine Fahrt nur mit diesem Schiff an Zeilen hat, ohne den Satz zur Besatzung. */
const SHIP_LINES: Readonly<Record<string, readonly string[]>> = {
    riverSailer: [
        "Flusssegler: 12 Stunden Fahrt am Tag, danach 12 Stunden vor Anker.",
        "Flusssegler benötigen ausreichend breite und gut befahrbare Gewässer.",
    ],
    riverBarge: [
        "Flusskahn: 12 Stunden Fahrt am Tag, danach 12 Stunden vor Anker.",
        "Flusskahn: Günstige Passage setzt Mitarbeit voraus; ohne Mitarbeit ist sie deutlich teurer.",
        "Passagiere schlafen auf einfachen Treidelkähnen meist bei der Fracht oder an Deck.",
    ],
    riverGalley: [
        "Flussgaleere: 12 Stunden Fahrt am Tag, danach 12 Stunden vor Anker.",
        "Flussgaleere: Schnelles Passagier- und Kurierschiff.",
        OARED_CARGO,
    ],
    rowboat: [
        "Ruderboot: 12 Stunden gerudert, danach 12 Stunden Rast.",
        "Ruderboot: Überfahrten werden meist mit örtlichen Bootsführern ausgehandelt; auf gefährlichen oder schlecht erschlossenen Gewässern können sie teuer sein.",
    ],
    cargoShip: [
        "Lastensegler: 12 Stunden Fahrt am Tag, danach 12 Stunden Rast vor Anker oder im Hafen.",
        "Hafenhalte dienen dem Umschlag sowie dem Ergänzen von Wasser und Proviant.",
    ],
    fastShip: [
        "Schnellsegler: fährt Tag und Nacht, die Besatzung wechselt sich ab, keine Rast.",
        "Schnelle Schiffe bieten meist komfortablere, aber deutlich teurere Passage.",
    ],
    galley: ["Galeere: 8 Stunden gerudert, danach 16 Stunden Rast der Ruderer.", OARED_CARGO],
    courierDromone: [
        "Kurierdromone: fährt Tag und Nacht, die Besatzung wechselt sich ab, keine Rast.",
        "Kurierdromone: Für schnellen Kurierbetrieb ausgelegt und nur eingeschränkt als Frachtschiff geeignet.",
    ],
};
const SHIPS = Object.keys(SHIP_LINES);
/** Die Zahl vorn in der Überschrift. */
const headingCount = (heading: string): number => Number(/^\d+/.exec(heading)?.[0]);

describe("Schifffahrtshinweise: wann es einen Deckel gibt", () => {
    it("🔴 eine Reise ohne Schiff hat keinen Deckel, auch keine reine Landreise mit eigenem Tag", () => {
        expect(shipNotes(route(["groupFoot", "cart"]))).toBeNull();
        expect(shipNotes(route(["lightRider"], 10))).toBeNull();
        expect(shipNotes(route(["horseCarriage", "sleigh"], 24))).toBeNull();
        expect(shipNotes(route([]))).toBeNull();
    });

    it("🔴 das Reisemodell kennt genau diese acht Schiffe, jedes hat seine Zeilen", () => {
        const { river, sea } = AVENTURIA_TRAVEL_MODEL.transportmittel.wert;
        expect([...new Set([...river, ...sea])].sort()).toEqual([...SHIPS].sort());
    });
});

describe("Schifffahrtshinweise: die Hinweise je Schiffstyp", () => {
    it.each(SHIPS)("🔴 %s: Satz zur Besatzung, Zeitzeile, seine Hinweise - sonst nichts", (ship) => {
        const notes = shipNotes(route([ship]));
        expect(notes?.lines).toEqual([CREW, ...(SHIP_LINES[ship] ?? [])]);
        expect(notes?.heading).toBe(`${notes?.lines.length} Schifffahrtshinweise`);
    });

    it("🔴 keine Hinweise für nicht benutzte Schiffe, auch nicht für ein Schiff, das nur im Modell steht", () => {
        for (const ship of SHIPS) {
            const mine = new Set(SHIP_LINES[ship]);
            const foreign = SHIPS.filter((other) => other !== ship).flatMap((other) =>
                (SHIP_LINES[other] ?? []).filter((line) => !mine.has(line)),
            );
            const lines = shipNotes(route([ship]))?.lines ?? [];
            expect(
                lines.filter((line) => foreign.includes(line)),
                ship,
            ).toEqual([]);
            // Land davor und dahinter ändert nichts.
            expect(shipNotes(route(["groupFoot", ship, "cart"]))?.lines, ship).toEqual(lines);
        }
        // Flusssegler und Lastensegler: nichts vom Kahn, von der Galeere, vom Schnellsegler.
        const both = shipNotes(route(["groupFoot", "riverSailer", "cargoShip"]))?.lines.join(" ") ?? "";
        expect(both).not.toMatch(/Treidel|Mitarbeit|Ruderschiffe|Kurier|Bootsführer|Schnelle Schiffe/);
    });

    it("🔴 eine gemischte Reise: nur deren Schiffe, in der Reihenfolge der ersten Nutzung, jedes mit seinen Hinweisen, nichts zu Land", () => {
        const notes = shipNotes(
            route(["groupFoot", "riverSailer", "groupFoot", "galley", "riverSailer", "rowboat"], 10),
        );
        expect(notes?.lines).toEqual([
            CREW,
            ...(SHIP_LINES.riverSailer ?? []),
            ...(SHIP_LINES.galley ?? []),
            ...(SHIP_LINES.rowboat ?? []),
        ]);
        // Kein Wort zum Planerfeld an Land und zum Umsteigen (Betreiber 2026-10-03).
        expect(notes?.lines.join(" ")).not.toMatch(/An Land|Umsteigen|Reisestunden pro Tag/);
        expect(notes?.heading).toBe("7 Schifffahrtshinweise");
    });

    it("die Zeile des Lastenseglers sagt Anker und Hafen einmal, ein eigener Satz dazu entfällt", () => {
        const lines = shipNotes(route(["cargoShip"]))?.lines ?? [];
        expect(lines.filter((line) => /Anker|ankern/.test(line))).toHaveLength(1);
        // Fährt das Schiff laut Modell durch, gibt es keine Rast, also auch kein Ankern.
        const model = structuredClone(AVENTURIA_TRAVEL_MODEL);
        model.nachtfahrt.wert = [...model.nachtfahrt.wert, "cargoShip"];
        const nonStop = shipNotes(route(["cargoShip"]), model)?.lines ?? [];
        expect(nonStop[1]).toBe("Lastensegler: fährt Tag und Nacht, die Besatzung wechselt sich ab, keine Rast.");
        expect(nonStop.join(" ")).not.toMatch(/Anker|ankern/);
    });
});

describe("Schifffahrtshinweise: keine Duplikate, Zahl gleich Zeilen", () => {
    it("🔴 Flussgaleere und Galeere teilen den Satz zum Frachtraum: er steht einmal", () => {
        const lines = shipNotes(route(["riverGalley", "galley"]))?.lines ?? [];
        expect(lines.filter((line) => line === OARED_CARGO)).toHaveLength(1);
        expect(lines).toEqual([
            CREW,
            "Flussgaleere: 12 Stunden Fahrt am Tag, danach 12 Stunden vor Anker.",
            "Flussgaleere: Schnelles Passagier- und Kurierschiff.",
            OARED_CARGO,
            "Galeere: 8 Stunden gerudert, danach 16 Stunden Rast der Ruderer.",
        ]);
    });

    it("🔴 jede Teilmenge der Schiffe, in jeder Reihenfolge: kein Satz doppelt, Zahl vorn = Zahl der Zeilen, de und en", () => {
        for (const lang of ["de", "en"] as const) {
            locale.value = lang;
            for (let mask = 1; mask < 1 << SHIPS.length; mask += 1) {
                const subset = SHIPS.filter((_, index) => (mask >> index) & 1);
                for (const order of [subset, [...subset].reverse(), [...subset, ...subset]]) {
                    for (const hours of [8, 10, 24]) {
                        const notes = shipNotes(route(order, hours));
                        const label = `${lang} ${order.join(",")} ${hours} h`;
                        expect(new Set(notes?.lines).size, label).toBe(notes?.lines.length);
                        expect(headingCount(notes?.heading ?? ""), label).toBe(notes?.lines.length);
                    }
                }
            }
        }
    });

    it("die Überschrift hat Einzahl und Mehrzahl", () => {
        expect(shipNotes(route(["groupFoot", "galley"], 24))?.heading).toBe("2 Schifffahrtshinweise");
        expect(shipNotes(route(["courierDromone"]))?.heading).toBe("3 Schifffahrtshinweise");
    });
});

describe("Schifffahrtshinweise: 24 Reisestunden", () => {
    it("🔴 die Route rechnet ohne Rast, auch an Bord: der Satz ersetzt Besatzung und Zeitzeilen, die Hinweise bleiben", () => {
        expect(shipNotes(route(["groupFoot", "galley"], 24))).toEqual({
            heading: "2 Schifffahrtshinweise",
            lines: [NO_REST, OARED_CARGO],
        });
        expect(shipNotes(route(["riverBarge", "fastShip"], 24))?.lines).toEqual([
            NO_REST,
            ...(SHIP_LINES.riverBarge ?? []).slice(1),
            (SHIP_LINES.fastShip ?? [])[1],
        ]);
        // Lastensegler: der Anker steht in der Zeitzeile, die mit 24 Stunden entfällt; der Hafenhalt bleibt.
        expect(shipNotes(route(["cargoShip"], 24))?.lines).toEqual([NO_REST, (SHIP_LINES.cargoShip ?? [])[1]]);
    });
});

describe("Schifffahrtshinweise: Zahlen aus dem Modell, Texte aus der Tafel, nichts erfunden", () => {
    it("🔴 die Stunden stehen im Reisemodell, nicht in der Sprachtafel", () => {
        const model = structuredClone(AVENTURIA_TRAVEL_MODEL);
        model.reisetagStunden.wert.jeReisemittel = { galley: 10, cargoShip: 9 };
        expect(shipNotes(route(["galley"]), model)?.lines[1]).toBe(
            "Galeere: 10 Stunden gerudert, danach 14 Stunden Rast der Ruderer.",
        );
        expect(shipNotes(route(["cargoShip"]), model)?.lines[1]).toBe(
            "Lastensegler: 9 Stunden Fahrt am Tag, danach 15 Stunden Rast vor Anker oder im Hafen.",
        );
    });

    it("🔴 keine Zahl, kein Preis in den Sprachtafeln der Schifffahrtshinweise", () => {
        for (const table of [de, en] as Record<string, string>[]) {
            for (const [key, value] of Object.entries(table)) {
                if (!key.startsWith("planner.ships.")) continue;
                expect(value, key).not.toMatch(/\d/);
                expect(value, key).not.toMatch(
                    /Dukat|Silber|Heller|Kreuzer|Kaufpreis|Fahrpreis|ducat|silver|farthing|kreutzer/i,
                );
            }
        }
    });

    it("🔴 englisch: Überschrift, Zeitzeilen und Hinweise sinngemäß, alles übersetzt", () => {
        locale.value = "en";
        expect(shipNotes(route(["riverBarge", "galley"]))?.heading).toBe("6 notes on travel by ship");
        expect(shipNotes(route(["galley"], 24))?.heading).toBe("2 notes on travel by ship");
        expect(shipNotes(route(["riverBarge", "cargoShip"]))?.lines).toEqual([
            "On board the crew's rhythm applies, not the travellers' hours per day.",
            "River barge: 12 hours under way a day, then 12 hours at anchor.",
            "River barge: A cheap passage requires working for it; without that it costs considerably more.",
            "Passengers on simple towed river barges usually sleep with the cargo or on deck.",
            "Cargo sailer: 12 hours under way a day, then 12 hours of rest at anchor or in port.",
            "Port calls are for loading and unloading and for taking on water and provisions.",
        ]);
        for (const ship of SHIPS) {
            locale.value = "en";
            const english = shipNotes(route([ship]))?.lines ?? [];
            locale.value = "de";
            const german = shipNotes(route([ship]))?.lines ?? [];
            expect(english, ship).toHaveLength(german.length);
            english.forEach((line, index) => expect(line, ship).not.toBe(german[index]));
        }
    });
});

describe("Schifffahrtshinweise: berühren Routing, Reisezeit und Reisekosten nicht", () => {
    it("🔴 Route und Reisemodell bleiben unangetastet (eingefroren: jede Änderung würfe)", () => {
        const deepFreeze = <T>(value: T): T => {
            if (typeof value === "object" && value !== null) {
                for (const inner of Object.values(value)) deepFreeze(inner);
                Object.freeze(value);
            }
            return value;
        };
        const model = deepFreeze(structuredClone(AVENTURIA_TRAVEL_MODEL));
        const frozen = deepFreeze(route(["groupFoot", ...SHIPS, "cart"]));
        expect(() => shipNotes(frozen, model)).not.toThrow();
        // Das Reisemodell des Bestands ist nach dem Aufruf, was es vorher war.
        const before = JSON.stringify(AVENTURIA_TRAVEL_MODEL);
        shipNotes(route(SHIPS, 10));
        shipNotes(route(SHIPS, 24));
        expect(JSON.stringify(AVENTURIA_TRAVEL_MODEL)).toBe(before);
    });
});
