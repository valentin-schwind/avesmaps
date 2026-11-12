import { describe, expect, it } from "vitest";
import {
    artAus,
    neuUndAchtung,
    neuerungenAlsKurzinfo,
    neuerungenNachArt,
    standAus,
    titelOhnePraefix,
    type ReleaseVerlauf,
    type VerlaufCommit,
} from "../src/versionen.ts";

/**
 * Die Meldung „Neue Version“ zeigt, was zwischen dem Stand im offenen Tab und dem neuen Stand neu ist (Betreiber 2026-10-17: „ich will dass
 * die stelle mir eigentlich anzeigt was neu ist und auf was man achten muss, wenn man neu lädt“; Regel A in AGENTS.md: jeder feat/fix-Commit
 * trägt `Neu:` und bei Bedarf `Achtung:`). Ein Beispiel vom 2026-10-17.
 */
const sha = (ziffer: string) => ziffer.repeat(40);
const commit = (ziffer: string, titel: string, beschreibung = "", anwendung = true): VerlaufCommit => ({
    sha: sha(ziffer),
    art: artAus(titel),
    titel,
    ...neuUndAchtung(beschreibung),
    anwendung,
});

// Neueste zuerst, wie `git log`.
const VERLAUF: ReleaseVerlauf = {
    schema: 1,
    bis: sha("5"),
    commits: [
        commit(
            "5",
            "feat(WI-0127): Gelaende neu rechnen im Reiter Hoehenmodell",
            "Route …\n\nNeu: Im Reiter „Höhenmodell“ gibt es den Knopf „Gelände neu rechnen“.\nAchtung: Solange schon eine Geländerechnung wartet, ist der Knopf gesperrt.\n\nCo-Authored-By: x",
        ),
        commit("4", "docs(WI-0141): Endstand", "Neu: steht in Doku, zählt nicht"),
        commit("3", "feat(dev): Pruefbank - Vorrang fuer einen Hotfix", "Neu: nur ein Werkzeug", false),
        commit("2", "fix(WI-0137): Kurzinfo und Versionen zeigen die Notizen des laufenden Release"),
        commit(
            "1",
            "feat(WI-0141): Legacy-Zug reiht hinter einem laufenden ein",
            "Neu: Ein Legacy-Zug lässt sich einreihen.",
        ),
    ],
};

describe("Neuerungen der Meldung „Neue Version“", () => {
    it("liest Neu: und Achtung: aus der Beschreibung, die Art und den Titel ohne Präfix", () => {
        expect(neuUndAchtung("Text\n  Neu: Eins\nAchtung:  Zwei \r\nNeu: Drei")).toEqual({
            neu: ["Eins", "Drei"],
            achtung: ["Zwei"],
        });
        expect(artAus("feat(WI-0141): x")).toBe("feat");
        expect(artAus("fix!: x")).toBe("fix");
        expect(artAus("Merge branch")).toBeNull();
        expect(titelOhnePraefix("fix(WI-0137): Kurzinfo zeigt die Notizen")).toBe("Kurzinfo zeigt die Notizen");
        expect(standAus("20261017T170005Z-3ab71b9")).toBe("3ab71b9");
        expect(standAus("dev")).toBeNull();
    });

    it("🔴 zwischen Tab-Stand und neuem Stand: Neu und Achtung der feat/fix der Anwendung, älteste zuerst; ohne Neu: die Titelzeile, unredigiert", () => {
        expect(neuerungenAlsKurzinfo(VERLAUF, "1111111", "5555555")).toEqual({
            abschnitte: [
                {
                    titel: "Neu",
                    punkte: [
                        "Kurzinfo und Versionen zeigen die Notizen des laufenden Release",
                        "Im Reiter „Höhenmodell“ gibt es den Knopf „Gelände neu rechnen“.",
                    ],
                },
                { titel: "Achtung", punkte: ["Solange schon eine Geländerechnung wartet, ist der Knopf gesperrt."] },
            ],
            unredigiert: ["Kurzinfo und Versionen zeigen die Notizen des laufenden Release"],
            mehr: false,
        });
    });

    it("🔴 gleicher Stand oder unbekannter neuer Stand: nichts; ein Tab älter als der Verlauf: alles mit „mehr“", () => {
        expect(neuerungenAlsKurzinfo(VERLAUF, "5555555", "5555555").abschnitte).toEqual([]);
        expect(neuerungenAlsKurzinfo(VERLAUF, "1111111", "9999999").abschnitte).toEqual([]);
        const alt = neuerungenAlsKurzinfo(VERLAUF, "0000000", "5555555");
        expect(alt.mehr).toBe(true);
        expect(alt.abschnitte[0]?.punkte).toEqual([
            "Ein Legacy-Zug lässt sich einreihen.",
            "Kurzinfo und Versionen zeigen die Notizen des laufenden Release",
            "Im Reiter „Höhenmodell“ gibt es den Knopf „Gelände neu rechnen“.",
        ]);
    });

    it("🔴 mit der Art (Discord-Bericht): feat als Merkmal, fix als Behebung, dieselbe Spanne wie die Kurzinfo, ohne Satz nur gezählt", () => {
        const verlauf: ReleaseVerlauf = {
            schema: 1,
            bis: sha("6"),
            commits: [
                commit("6", "fix(WI-0149): Absturz beim Speichern", "Neu: Ein Absturz beim Speichern ist behoben."),
                commit("5", "fix(WI-0150): Rechtetest", ""),
                commit("4", "docs(WI-0141): Endstand", "Neu: steht in Doku, zählt nicht"),
                commit(
                    "3",
                    "feat(WI-0127): Gelände neu rechnen",
                    "Neu: Der Knopf „Gelände neu rechnen“ ist da.\nNeu: Ein zweiter Satz.",
                ),
                commit("2", "feat(WI-0127): Wiederholt", "Neu: Der Knopf „Gelände neu rechnen“ ist da."),
                commit("1", "feat(WI-0001): Anfang", "Neu: Davor."),
            ],
        };
        expect(neuerungenNachArt(verlauf, "1111111", "6666666")).toEqual({
            saetze: [
                { satz: "Der Knopf „Gelände neu rechnen“ ist da.", art: "feature" },
                { satz: "Ein zweiter Satz.", art: "feature" },
                { satz: "Ein Absturz beim Speichern ist behoben.", art: "fix" },
            ],
            ohneSatz: 1,
        });
        // Dieselbe Spanne wie die Kurzinfo: gleicher Stand und unbekannter neuer Stand liefern nichts; ein älterer Tab alles.
        expect(neuerungenNachArt(verlauf, "6666666", "6666666")).toEqual({ saetze: [], ohneSatz: 0 });
        expect(neuerungenNachArt(verlauf, "1111111", "9999999")).toEqual({ saetze: [], ohneSatz: 0 });
        expect(neuerungenNachArt(verlauf, "0000000", "6666666").saetze).toHaveLength(4);
    });
});
