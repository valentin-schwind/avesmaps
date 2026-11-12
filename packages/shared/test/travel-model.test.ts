import { describe, expect, it } from "vitest";
import {
    AVENTURIA_TRAVEL_MODEL,
    allowedTransportsForPath,
    timeWeightFactor,
    travelDayHours,
    travelHoursFromTime,
    travelSpeed,
} from "../src/index.ts";

/**
 * Das Reisemodell (WI-0017 R2): Legacys Regeln aus `client-graph.php`, gegen die Zahlen geprüft, die
 * Legacys eigener Router für Gareth → Perricum liefert (106,50 Einheiten, 21,0067 Zeit, 74,99 h).
 */
const model = AVENTURIA_TRAVEL_MODEL;

describe("Reisemodell", () => {
    it("rechnet Kantenzeit in Stunden wie Legacy: Zeit x 3 Meilen x 1,19", () => {
        expect(travelHoursFromTime(model, 21.0067)).toBeCloseTo(74.99, 2);
    });

    it("gewichtet „schnellste“ mit 12 / Reisetag: Land 1,5, Wasser 1, Nachtfahrt 0,5", () => {
        expect(timeWeightFactor(model, "groupFoot")).toBe(1.5);
        expect(timeWeightFactor(model, "cargoShip")).toBe(1);
        expect(timeWeightFactor(model, "fastShip")).toBe(0.5);
        expect(travelDayHours(model, "riverBarge")).toBe(12);
    });

    it("kennt das Tempo je Mittel und Wegart, und nichts darüber hinaus", () => {
        expect(travelSpeed(model, "groupFoot", "Reichsstrasse")).toBe(4.9087);
        expect(travelSpeed(model, "cargoShip", "Reichsstrasse"), "ein Schiff fährt keine Straße").toBeNull();
    });

    it("🔴 eine leere Liste mit Domäne heißt NICHTS, ohne Domäne heißt sie Vorgabe", () => {
        // Legacy: `$allowedTransports === [] && transport_domain leer` ist eine Altzeile (client-graph.php).
        expect(allowedTransportsForPath(model, "Strasse", [], "land")).toEqual([]);
        expect(allowedTransportsForPath(model, "Strasse", [], null)).toHaveLength(
            model.transportmittel.wert.land.length,
        );
        expect(allowedTransportsForPath(model, "Strasse", null, null)).toHaveLength(
            model.transportmittel.wert.land.length,
        );
    });

    it("🪤 die Kutsche fehlt auf Pfaden nur in der Vorgabe, auf dem Wüstenpfad immer", () => {
        expect(allowedTransportsForPath(model, "Pfad", null, null)).not.toContain("horseCarriage");
        // Karren und Fuhrwerk fahren nie einen Pfad, der Schlitten folgt der Reisegruppe zu Pferd (WI-0069).
        expect(allowedTransportsForPath(model, "Pfad", ["horseCarriage"], "land")).toEqual(["horseCarriage"]);
        expect(allowedTransportsForPath(model, "Wuestenpfad", ["horseCarriage", "groupFoot"], "land")).toEqual([
            "groupFoot",
        ]);
    });
});
