import { describe, expect, it } from "vitest";
import { kurzinfoVon, laufendesRelease, type GeleseneReleases } from "../src/versionen/lesen.ts";

/**
 * Welche Release-Notizen zum LAUFENDEN Release gehören (Befund des Betreibers 2026-10-17: „bei den systemmeldungen in production kommt
 * immer nur diese meldung“). Seit dem 2026-10-12 schreibt niemand mehr eine Datei unter `config/releases/` (Stage bei jedem Push,
 * Production über die Freigabe); „Neue Version verfügbar“ zeigte darum bei jedem Release die Kurzinfo vom 12.10., samt ihres
 * Satzes über die Stage. Die Kurzinfo gehört zu der Datei, deren `bis` der laufende Stand ist; ohne sie keine Abschnitte.
 */
const sha = (ziffer: string) => ziffer.repeat(40);

function release(bis: string, datum: string, kurzinfo: string | null): GeleseneReleases["releases"][number] {
    return {
        stamm: `${datum.slice(0, 10)}-${bis.slice(0, 8)}`,
        titel: "",
        datum,
        von: sha("0"),
        bis,
        zahl: 1,
        doku: 0,
        pakete: {},
        commits: [],
        kurzinfo,
    };
}

const GELESEN: GeleseneReleases = {
    releases: [
        release(sha("1"), "2026-10-11T22:00:00+02:00", "## Anschauen\n- Erstes Release.\n"),
        release(
            sha("d"),
            "2026-10-12T21:53:29+02:00",
            "## Beachten\n- Die öffentliche Karte läuft bis zu einem eigenen Schnitt weiter.\n",
        ),
    ],
    kaputt: [],
};

describe("Kurzinfo des laufenden Release", () => {
    it("🔴 läuft ein Stand ohne eigene Notizen, gibt es keine Abschnitte, nicht die der letzten Datei", () => {
        // Production am 2026-10-17: Release `…-3ab71b9`, die jüngste Datei ist die vom 12.10.
        expect(kurzinfoVon(GELESEN, "20261017T170005Z-3ab71b9")).toEqual({ stand: null, abschnitte: [] });
        expect(laufendesRelease(GELESEN, "20261017T170005Z-3ab71b9")).toBeUndefined();
    });

    it("die Datei, deren `bis` der laufende Stand ist, auch eine ältere", () => {
        expect(kurzinfoVon(GELESEN, "20261012T220000Z-ddddddd")).toEqual({
            stand: "2026-10-12T21:53:29+02:00",
            abschnitte: [
                { titel: "Beachten", punkte: ["Die öffentliche Karte läuft bis zu einem eigenen Schnitt weiter."] },
            ],
        });
        expect(kurzinfoVon(GELESEN, "20261011T220000Z-1111111")).toEqual({
            stand: "2026-10-11T22:00:00+02:00",
            abschnitte: [{ titel: "Anschauen", punkte: ["Erstes Release."] }],
        });
    });

    it("ohne Stand im Namen (lokal `dev`) die jüngste Datei, als Vorschau beim Schreiben der Notizen", () => {
        expect(laufendesRelease(GELESEN, "dev")?.bis).toBe(sha("d"));
    });
});
