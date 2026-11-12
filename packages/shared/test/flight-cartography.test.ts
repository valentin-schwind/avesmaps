import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { AVENTURIA_FLIGHT_CARTOGRAPHY, FlightCartography } from "../src/index.ts";

/**
 * Die Kartografie des Flugs (WI-0051 F3): Form, Flugbahn im Raum, Bodenspur und Lote.
 *
 * 🔴 Die Höhe im echten Maßstab (Betreiber 2026-09-28 zum Entwurf f3-echt2: „A“), die Zeichnung wie im Entwurf
 * f3-farbe („3. ja“, keine Pfeile).
 */

const T = AVENTURIA_FLIGHT_CARTOGRAPHY;

describe("Flug-Kartografie", () => {
    it("🔴 A: steigen und sinken mit 1 : 4, die Höhe über ± 2 E halten, sonst nichts", () => {
        expect(T.bahn).toEqual({ steigung: 0.25, haltenEinheiten: 2 });
    });

    it("die Proben reichen: Mindestens nie über Höchstens, und eine Route trägt einen ganzen Abschnitt", () => {
        expect(T.proben.jeAbschnittMindestens).toBeLessThanOrEqual(T.proben.jeAbschnittHoechstens);
        expect(T.proben.jeRouteHoechstens).toBeGreaterThanOrEqual(T.proben.jeAbschnittHoechstens);
    });

    it("💣 ein unbekannter Schlüssel fällt auf, statt still einen Vorgabewert zu nehmen", () => {
        const kopie = structuredClone(T) as unknown as { bahn: Record<string, unknown> };
        kopie.bahn["steigungg"] = 0.2;
        expect(Value.Check(FlightCartography, kopie)).toBe(false);
        // Auch ein Schlüssel des alten Bogens (B + C) gilt nicht mehr.
        const alt = structuredClone(T) as unknown as { bahn: Record<string, unknown> };
        alt.bahn["anteil"] = 0.14;
        expect(Value.Check(FlightCartography, alt)).toBe(false);
    });
});
