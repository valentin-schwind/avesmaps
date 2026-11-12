import { describe, expect, it } from "vitest";
import { createRateLimiter } from "../src/share/rate-limiter.ts";

/**
 * Die gleitende Drossel im Speicher (`share/rate-limiter.ts`): höchstens `limit` Ereignisse je Schlüssel in `windowMs`. Hier das, was Aufrufer
 * verlangen dürfen und was die öffentlichen Routen (Community, Reisebilder) voraussetzen:
 *
 * - 🔴 **Die Zeitreihe je Schlüssel wächst nie über `limit`** (WI-0272 Review C1): Ein Aufrufer, der ohne vorheriges `allows` zählt (eine Falle, die
 *   immer zählt), baute sonst je Adresse eine unbegrenzte Liste auf, die jeder Aufruf kopiert und filtert.
 * - Das Kappen ändert nicht, wann ein Schlüssel wieder darf: Die Grenze entscheidet das älteste der letzten `limit` Ereignisse, und genau diese bleiben.
 */
describe("Drossel im Speicher (share/rate-limiter.ts)", () => {
    it("🔴 hält je Schlüssel höchstens limit Zeitstempel: tausend Einträge ohne Prüfung wachsen nicht", () => {
        let jetzt = 0;
        const drossel = createRateLimiter(3, 1000, () => jetzt);
        for (let nummer = 0; nummer < 1000; nummer += 1) {
            drossel.record("a");
            jetzt += 1;
        }
        expect(drossel.held("a")).toBe(3);
        expect(drossel.held("unbekannt")).toBe(0);
        // Auch innerhalb eines Augenblicks (alle Einträge mit demselben Zeitstempel).
        for (let nummer = 0; nummer < 1000; nummer += 1) drossel.record("b");
        expect(drossel.held("b")).toBe(3);
    });

    it("gleitet wie zuvor: gesperrt, bis das älteste der letzten limit Ereignisse das Fenster verlässt", () => {
        let jetzt = 0;
        const drossel = createRateLimiter(3, 1000, () => jetzt);
        // Fünf Einträge ohne Prüfung: die letzten drei (200, 300, 400) entscheiden.
        for (const zeit of [0, 100, 200, 300, 400]) {
            jetzt = zeit;
            drossel.record("a");
        }
        jetzt = 1199;
        expect(drossel.allows("a")).toBe(false);
        jetzt = 1200;
        expect(drossel.allows("a")).toBe(true);
    });

    it("🔴 verhält sich wie eine unbegrenzte Liste: zufällige Folgen aus Zählen und Fragen ergeben dieselben Antworten", () => {
        // Das Vorbild: alle Zeitstempel behalten und im Fenster zählen. Die gekappte Drossel muss immer dasselbe antworten.
        let zustand = 12345;
        const zufall = (bis: number): number => {
            zustand = (zustand * 1103515245 + 12345) % 2_147_483_648;
            return zustand % bis;
        };
        for (const limit of [1, 2, 5, 20]) {
            let jetzt = 0;
            const drossel = createRateLimiter(limit, 500, () => jetzt);
            const vorbild: number[] = [];
            for (let schritt = 0; schritt < 3000; schritt += 1) {
                jetzt += zufall(40);
                const erwartet = vorbild.filter((zeit) => jetzt - zeit < 500).length < limit;
                expect(drossel.allows("k"), `limit ${String(limit)}, Schritt ${String(schritt)}`).toBe(erwartet);
                // Zählen mal mit, mal ohne Prüfung (die Falle zählt immer).
                if (zufall(3) !== 0 || erwartet) {
                    drossel.record("k");
                    vorbild.push(jetzt);
                }
                expect(drossel.held("k")).toBeLessThanOrEqual(limit);
            }
        }
    });

    it("zählt je Schlüssel für sich und vergisst nach dem Fenster (wie bisher)", () => {
        let jetzt = 0;
        const drossel = createRateLimiter(2, 1000, () => jetzt);
        drossel.record("a");
        drossel.record("a");
        expect(drossel.allows("a")).toBe(false);
        expect(drossel.allows("b")).toBe(true);
        jetzt = 999;
        expect(drossel.allows("a")).toBe(false);
        jetzt = 1000;
        expect(drossel.allows("a")).toBe(true);
    });
});
