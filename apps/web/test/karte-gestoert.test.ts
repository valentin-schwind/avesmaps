import { describe, expect, it } from "vitest";
import {
    FENSTER_MS,
    NACHFRAGE_MS,
    SCHWELLE,
    createStoerungsWache,
    istAusfall,
    type Uhr,
} from "../src/map/karte-gestoert.ts";

/**
 * Der Hinweis „Die Karte ist gerade gestört.“ (WI-0127 SYS-6, SYS-0001 §6.6): Er kommt erst nach einer Serie von Ausfällen, sagt
 * nichts zu einem einzelnen Aussetzer, zählt Antworten der Tür nicht, fragt nur nach, solange er steht, und geht mit der ersten
 * gelungenen Kachel von selbst.
 */
function uhr() {
    let jetzt = 0;
    const laeufe: { ms: number; tun: () => void; aktiv: boolean }[] = [];
    const steuer: Uhr = {
        jetzt: () => jetzt,
        alle(ms, tun) {
            const lauf = { ms, tun, aktiv: true };
            laeufe.push(lauf);
            return () => {
                lauf.aktiv = false;
            };
        },
    };
    return {
        steuer,
        vor(ms: number) {
            jetzt += ms;
        },
        tick() {
            for (const lauf of laeufe) if (lauf.aktiv) lauf.tun();
        },
        aktiv: () => laeufe.filter((lauf) => lauf.aktiv).length,
    };
}

describe("Die Karte ist gestört", () => {
    it("Ausfall heißt: kein Status, 0 oder 5xx; 401, 403 und 404 sind Antworten", () => {
        expect(istAusfall(undefined)).toBe(true);
        expect(istAusfall(0)).toBe(true);
        expect(istAusfall(500)).toBe(true);
        expect(istAusfall(502)).toBe(true);
        expect(istAusfall(503)).toBe(true);
        expect(istAusfall(401)).toBe(false);
        expect(istAusfall(403)).toBe(false);
        expect(istAusfall(404)).toBe(false);
    });

    it("🔴 erst nach einer Serie ohne gelungene Kachel dazwischen; ein Aussetzer zeigt nichts", () => {
        const zeit = uhr();
        const wache = createStoerungsWache(() => undefined, zeit.steuer);
        for (let index = 1; index < SCHWELLE; index += 1) wache.fehler(503, "orte");
        expect(wache.sichtbar.value).toBe(false);
        wache.erfolg();
        wache.fehler(503, "orte");
        expect(wache.sichtbar.value).toBe(false);
        // Fehler, die weiter auseinanderliegen als das Fenster, sind keine Serie.
        zeit.vor(FENSTER_MS);
        wache.fehler(503, "orte");
        zeit.vor(FENSTER_MS);
        wache.fehler(503, "orte");
        expect(wache.sichtbar.value).toBe(false);
        // Antworten der Tür zählen nie.
        for (let index = 0; index < SCHWELLE * 2; index += 1) wache.fehler(401, "orte");
        expect(wache.sichtbar.value).toBe(false);
    });

    it("🔴 eine Serie zeigt ihn; solange er steht, fragt die Wache die gescheiterten Quellen nach; eine Kachel nimmt ihn zurück", () => {
        const zeit = uhr();
        const nachgefragt: [string, string[]][][] = [];
        const wache = createStoerungsWache(
            (gescheitert) =>
                nachgefragt.push(
                    [...gescheitert].map(([quelle, kacheln]) => [
                        quelle,
                        kacheln.map((k) => `${String(k.z)}/${String(k.x)}/${String(k.y)}`),
                    ]),
                ),
            zeit.steuer,
        );
        expect(zeit.aktiv()).toBe(0);
        wache.fehler(undefined, "raster", { z: 4, x: 8, y: 8 });
        wache.fehler(502, "orte", { z: 4, x: 7, y: 8 });
        wache.fehler(504, "raster", { z: 4, x: 8, y: 8 });
        expect(wache.sichtbar.value).toBe(true);
        expect(zeit.aktiv()).toBe(1);
        zeit.vor(NACHFRAGE_MS);
        zeit.tick();
        // Je Quelle die gescheiterten Kacheln, jede einmal: MapLibre lädt nur so eine gescheiterte Kachel neu.
        expect(nachgefragt).toEqual([
            [
                ["raster", ["4/8/8"]],
                ["orte", ["4/7/8"]],
            ],
        ]);
        wache.erfolg();
        expect(wache.sichtbar.value).toBe(false);
        expect(zeit.aktiv()).toBe(0);
    });

    it("stop nimmt ihn und die Nachfrage zurück", () => {
        const zeit = uhr();
        const wache = createStoerungsWache(() => undefined, zeit.steuer);
        for (let index = 0; index < SCHWELLE; index += 1) wache.fehler(500, "orte");
        expect(wache.sichtbar.value).toBe(true);
        wache.stop();
        expect(wache.sichtbar.value).toBe(false);
        expect(zeit.aktiv()).toBe(0);
    });
});
