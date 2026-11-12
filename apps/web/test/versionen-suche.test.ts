import { describe, expect, it } from "vitest";
import type { VersionGruppe } from "@avesmaps3d/shared";
import { gesuchteGruppen } from "../src/auth/versionen.ts";

/**
 * Die Suche in „Versionen“ (Koordination 2026-10-11: jede Liste bekommt die Leiste mit Freitextsuche, `AvmListenleiste`; Versionen nur die
 * Suche, „Auch Doku zeigen“ bleibt der Aufklapper unter der Liste). Gesucht wird im Satz, im Betreff, im Arbeitspaket (Nummer und Name),
 * beim Wer und im Commit.
 */
const commit = (sha: string, betreff: string, wer = "Claudia") => ({
    sha,
    datum: "2026-10-11T10:00:00+02:00",
    wer,
    betreff,
    doku: false,
});

const GRUPPEN: VersionGruppe[] = [
    {
        id: "WI-0128",
        name: "Ortseditor",
        zeilen: [
            {
                commit: commit("aaaa1111", "feat(WI-0128 E12): Bilder als Bindung"),
                art: "feat",
                text: "E12 · Bilder als Bindung",
            },
            {
                commit: commit("bbbb2222", "fix(WI-0128): Kreis zählt richtig"),
                art: "fix",
                text: "Kreis zählt richtig",
            },
        ],
    },
    {
        id: "sonstiges",
        name: null,
        zeilen: [
            {
                commit: commit("cccc3333", "Kanal-Routine: Tarif Max", "Claudio"),
                art: null,
                text: "Kanal-Routine: Tarif Max",
            },
        ],
    },
];

describe("Versionen: die Suche", () => {
    it("🔴 leer zeigt alles, sonst nur Zeilen, in denen jedes Wort vorkommt; leere Gruppen fallen weg", () => {
        expect(gesuchteGruppen(GRUPPEN, "  ")).toEqual(GRUPPEN);
        const bilder = gesuchteGruppen(GRUPPEN, "bilder BINDUNG");
        expect(bilder.map((gruppe) => [gruppe.id, gruppe.zeilen.map((zeile) => zeile.commit.sha)])).toEqual([
            ["WI-0128", ["aaaa1111"]],
        ]);
    });

    it("🔴 trifft auch Arbeitspaket, Wer und Commit", () => {
        expect(gesuchteGruppen(GRUPPEN, "ortseditor").flatMap((gruppe) => gruppe.zeilen)).toHaveLength(2);
        expect(
            gesuchteGruppen(GRUPPEN, "wi-0128 kreis").flatMap((gruppe) =>
                gruppe.zeilen.map((zeile) => zeile.commit.sha),
            ),
        ).toEqual(["bbbb2222"]);
        expect(gesuchteGruppen(GRUPPEN, "claudio").map((gruppe) => gruppe.id)).toEqual(["sonstiges"]);
        expect(gesuchteGruppen(GRUPPEN, "cccc33").map((gruppe) => gruppe.id)).toEqual(["sonstiges"]);
    });
});
