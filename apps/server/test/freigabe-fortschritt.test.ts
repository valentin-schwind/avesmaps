import { describe, expect, it } from "vitest";
import { alsFortschritt } from "../src/routes/freigabe-fortschritt.ts";

/**
 * Der Fortschritt einer Freigabe aus einer Zeile der Warteschlange (WI-0204), ohne Datenbank. Den Weg durch die echte Tafel samt
 * `jobs-cli record` prüft `test/freigabe.test.ts`.
 *
 * 🔴 Die Sätze, auf die es ankommt:
 * 1. Die Reihenfolge ist die des Ablaufs, nicht die des JSON-Objekts.
 * 2. Was nicht gemeldet ist, bleibt `null`; nichts wird erfunden.
 * 3. Eine Kennung bleibt eine Kennung: Ein Freitext als Fehlercode fällt weg.
 */

const BEGINN = new Date("2026-10-16T19:00:00.000Z");

function zeile(patch: Partial<Parameters<typeof alsFortschritt>[0]> = {}): Parameters<typeof alsFortschritt>[0] {
    return {
        external_ref: "freigabe-OPS-000030",
        state: "RUNNING",
        phase: "migrieren",
        phase_stats: { vorbereiten: { wallMs: 5000 }, abgeholt: { wallMs: 2000 } },
        started_at: BEGINN,
        created_at: BEGINN,
        finished_at: null,
        error_code: null,
        error_summary: null,
        ...patch,
    };
}

describe("Freigabe: der Fortschritt aus der Warteschlange", () => {
    it("🔴 die fertigen Phasen stehen in der Reihenfolge des Ablaufs, mit Dauer, und die jetzige seit ihrem Beginn", () => {
        const f = alsFortschritt(zeile(), "release");
        expect(f.zustand).toBe("laeuft");
        expect(f.phase).toBe("migrieren");
        expect(f.fertig).toEqual([
            { phase: "abgeholt", ms: 2000 },
            { phase: "vorbereiten", ms: 5000 },
        ]);
        expect(f.phaseSeit).toBe(new Date(BEGINN.getTime() + 7000).toISOString());
    });

    it("🔴 fehlt eine Dauer, ist die Phase trotzdem fertig, aber seit wann die jetzige läuft, bleibt offen", () => {
        const f = alsFortschritt(zeile({ phase: "rechte", phase_stats: { abgeholt: { wallMs: 2000 } } }), "release");
        expect(f.fertig.map((eintrag) => [eintrag.phase, eintrag.ms])).toEqual([
            ["abgeholt", 2000],
            ["vorbereiten", null],
            ["migrieren", null],
        ]);
        expect(f.phaseSeit).toBeNull();
    });

    it("grün heißt: auch die letzte Phase ist fertig", () => {
        const f = alsFortschritt(
            zeile({ state: "SUCCEEDED", phase: "proben", finished_at: new Date("2026-10-16T19:03:00.000Z") }),
            "release",
        );
        expect(f.zustand).toBe("gruen");
        expect(f.fertig.at(-1)?.phase).toBe("proben");
        expect(f.ende).toBe("2026-10-16T19:03:00.000Z");
        expect(f.phaseSeit).toBeNull();
    });

    it("🔴 rot: die Phase, in der es scheiterte, ist nicht fertig; der Code bleibt nur, wenn er eine Kennung ist", () => {
        const rot = alsFortschritt(
            zeile({ state: "FAILED", error_code: "migrieren_rot", error_summary: "Migration 0129 schlug fehl." }),
            "release",
        );
        expect(rot.zustand).toBe("rot");
        expect(rot.fertig.map((eintrag) => eintrag.phase)).toEqual(["abgeholt", "vorbereiten"]);
        expect(rot.fehlerCode).toBe("migrieren_rot");
        expect(rot.fehler).toBe("Migration 0129 schlug fehl.");
        expect(
            alsFortschritt(zeile({ state: "FAILED", error_code: "Rot | erfunden" }), "release").fehlerCode,
        ).toBeNull();
    });

    it("eine fremde Phase zählt nicht, und ein Rückweg hat seine eigene Reihenfolge", () => {
        expect(alsFortschritt(zeile({ phase: "tanzen", phase_stats: {} }), "release").phase).toBeNull();
        const zurueck = alsFortschritt(
            zeile({ phase: "proben", phase_stats: { zurueck: { wallMs: 1500 }, abgeholt: { wallMs: 900 } } }),
            "rollback",
        );
        expect(zurueck.fertig).toEqual([
            { phase: "abgeholt", ms: 900 },
            { phase: "zurueck", ms: 1500 },
        ]);
    });
});
