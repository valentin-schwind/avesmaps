import { describe, expect, it } from "vitest";
import {
    KANAL_STATIONEN,
    KANAL_STATIONEN_FREIGABE,
    erreichteStatusStationen,
    fortschrittDerZeile,
    staende,
    stationenFuer,
    wegFuer,
} from "../src/kanal.ts";

/**
 * 💣 **Der Befund des Betreibers am 2026-10-13** (Bild von OPS-000003, einer Nutzerfrage von Thomas): In der Fortschrittsleiste
 * standen `production_live` und `production_zurueck` als fünfte und sechste Station — an einer Frage, die sie nie erreichen kann.
 * Sie standen dort auf „offen“, und „offen“ liest sich wie „kommt noch“. Der Vorgang sah damit nach Stillstand aus, obwohl
 * Claudio geantwortet und den Status weitergesetzt hatte.
 *
 * 🪤 Die Ursache war eine Zeile, die stur die ganze Aufzählung zeichnete (`KANAL_STATIONEN.map(...)` in `kanal-vorgang.vue`),
 * während der Vertrag daneben schrieb, die zwei letzten gebe es „nur für eine Production-Freigabe“. Ein Kommentar ist keine
 * Zusicherung; deshalb steht die Regel jetzt als Funktion da und wird hier gemessen.
 */
describe("Die Stationen eines Vorgangs", () => {
    it("🔴 eine Meldung hat die zwei Production-Stationen nicht", () => {
        const stationen = stationenFuer("meldung");
        expect(stationen).toEqual(["fix_committed", "auf_stage", "claudia_nachgeprueft", "betreiber_abnahme"]);
        for (const nurFreigabe of KANAL_STATIONEN_FREIGABE) {
            expect(stationen, `${nurFreigabe} gehört nicht an eine Meldung`).not.toContain(nurFreigabe);
        }
    });

    it("eine Wiederherstellung ebenso", () => {
        expect(stationenFuer("wiederherstellung")).toEqual(stationenFuer("meldung"));
    });

    it("🔴 eine Freigabe hat alle, und die zwei Production-Stationen stehen hinten", () => {
        expect(stationenFuer("freigabe")).toEqual(KANAL_STATIONEN);
        expect(stationenFuer("freigabe").slice(-2)).toEqual(KANAL_STATIONEN_FREIGABE);
    });

    it("keine Art bekommt eine Station, die es gar nicht gibt", () => {
        for (const art of ["meldung", "wiederherstellung", "freigabe"] as const) {
            for (const station of stationenFuer(art)) expect(KANAL_STATIONEN).toContain(station);
        }
    });
});

/**
 * 💣 **Der Fall, der den Betreiber abends um acht erreicht hat.** Thomas fragte „Wann kann ich Wege und Orte bearbeiten?“,
 * Claudio antwortete und setzte `neu → bei_claudia` — und die Leiste zeigte vier Fix-Stationen, alle „offen“. Der Betreiber:
 * „gar kein fortschritt obwohl claudio was gemacht und geantwortet hat“.
 *
 * 🔴 Der Vorgang steht unter der Kategorie `editor_optimierung`. Eine feste Tafel „Kategorie → Stationen“ hätte ihm weiterhin
 * den Fix-Weg gegeben; deshalb entscheidet nicht die Kategorie, sondern ob es einen Fix gibt.
 */
describe("Welchen Weg ein Vorgang geht", () => {
    const thomas = { art: "meldung", alleNachweise: [], aenderungen: [] } as const;

    it("🔴 ohne Fix-Bericht und ohne Nachweis: der Status-Weg", () => {
        expect(wegFuer(thomas)).toBe("status");
    });

    it("ein Nachweis macht daraus einen Fix-Vorgang", () => {
        expect(wegFuer({ ...thomas, alleNachweise: [{}] })).toBe("fix");
    });

    it("ein Fix-Bericht ebenso", () => {
        expect(wegFuer({ ...thomas, aenderungen: [{}] })).toBe("fix");
    });

    it("eine Freigabe geht immer den Fix-Weg, auch ohne Nachweis", () => {
        expect(wegFuer({ art: "freigabe", alleNachweise: [], aenderungen: [] })).toBe("fix");
    });
});

describe("Die erreichten Status-Stationen", () => {
    const status = (nach: string) => ({ art: "status", statusNach: nach });

    it("🔴 Thomas' Vorgang: gemeldet und übernommen, nicht beantwortet", () => {
        // Genau der Stand aus dem Bild: Claudio hat geantwortet und auf „an Claudia“ gesetzt.
        const erreicht = erreichteStatusStationen("bei_claudia", [status("bei_claudia")]);
        expect([...erreicht].sort()).toEqual(["gemeldet", "uebernommen"]);
    });

    it("ein frischer Vorgang hat nur „gemeldet“ — aber den hat er immer", () => {
        expect([...erreichteStatusStationen("neu", [])]).toEqual(["gemeldet"]);
    });

    it("🔴 der Verlauf zählt, nicht nur der jetzige Status", () => {
        // Abgenommen heißt: alles davor ist passiert, auch wenn kein Zwischenstatus geschrieben wurde.
        const erreicht = erreichteStatusStationen("abgenommen", []);
        expect([...erreicht].sort()).toEqual(["beantwortet", "erledigt", "gemeldet", "uebernommen"]);
    });

    it("ein abgelehnter Vorgang bleibt bei dem, was er erreicht hat", () => {
        const erreicht = erreichteStatusStationen("abgelehnt", [status("angenommen"), status("abgelehnt")]);
        expect([...erreicht].sort()).toEqual(["gemeldet", "uebernommen"]);
    });
});

/**
 * 💣 **Derselbe Befund, eine Ebene höher** (Betreiber 2026-10-15, Bild der Liste mit Pfeil auf die vier Punkte): Im Vorgang wurde
 * die Leiste am 2026-10-13 repariert, die LISTE blieb stehen. Dort zeichnete eine Zeile stur vier Punkte und füllte sie mit der
 * Zahl der Nachweise — an OPS-000003 (eine Frage) und OPS-000005 (eine Datenänderung ohne Code) standen deshalb vier leere
 * Kreise, obwohl beide beantwortet und zur Abnahme gestellt waren. „Leer“ liest sich wie „nichts passiert“.
 *
 * 🪤 Die Liste kennt den Verlauf nicht, nur den jetzigen Status — deshalb rechnet sie die Zahl aus ihm. Das geht, weil die
 * Stationen aufeinander aufbauen (`erreichteStatusStationen` füllt nach unten auf); gemessen wird hier, dass beide Wege
 * dieselbe Zahl sagen.
 */
describe("Der Fortschritt einer Zeile in der Liste (WI-0162)", () => {
    const zeile = (werte: Partial<Parameters<typeof fortschrittDerZeile>[0]>) =>
        fortschrittDerZeile({ art: "meldung", status: "neu", nachweise: 0, fixNachweise: 0, aenderungen: 0, ...werte });

    it("ohne Fix zählt der Status, und „gemeldet“ hat jeder", () => {
        expect(zeile({ status: "neu" })).toEqual({ weg: "status", erreicht: 1, von: 4 });
        expect(zeile({ status: "bei_claudia" })).toEqual({ weg: "status", erreicht: 2, von: 4 });
        expect(zeile({ status: "zur_abnahme" })).toEqual({ weg: "status", erreicht: 3, von: 4 });
        expect(zeile({ status: "abgenommen" })).toEqual({ weg: "status", erreicht: 4, von: 4 });
    });

    it("🔴 OPS-000003 und OPS-000005: beantwortet und zur Abnahme, also drei von vier statt vier leeren Kreisen", () => {
        expect(zeile({ status: "zur_abnahme" }).erreicht).toBe(3);
    });

    it("mit Fix-Bericht oder Nachweis zählen die Nachweise", () => {
        expect(zeile({ status: "bei_claudia", aenderungen: 1 })).toEqual({ weg: "fix", erreicht: 0, von: 4 });
        expect(zeile({ status: "zur_abnahme", nachweise: 2, fixNachweise: 2, aenderungen: 1 })).toEqual({
            weg: "fix",
            erreicht: 2,
            von: 4,
        });
    });

    it("🔴 nur abgenommen: der Status-Weg, nicht vier Fix-Stationen mit einem Punkt ganz hinten", () => {
        // OPS-000003, OPS-000005, OPS-000020 am 2026-10-16: eine Frage, die beantwortet und abgenommen wurde.
        expect(zeile({ status: "abgenommen", nachweise: 1, fixNachweise: 0 })).toEqual({
            weg: "status",
            erreicht: 4,
            von: 4,
        });
    });

    it("eine Freigabe geht immer den Fix-Weg, mit ihren sechs Stationen", () => {
        expect(zeile({ art: "freigabe", status: "in_arbeit", nachweise: 1, fixNachweise: 1 })).toEqual({
            weg: "fix",
            erreicht: 1,
            von: 6,
        });
    });

    it("🔴 ein abgelehnter Vorgang stand bei jemandem — er fällt nicht auf „nur gemeldet“ zurück", () => {
        expect(zeile({ status: "abgelehnt" }).erreicht).toBe(2);
    });

    it("beide Wege sagen dasselbe wie die Leiste im Vorgang", () => {
        for (const status of ["neu", "bei_claudia", "beantwortet", "zur_abnahme", "abgenommen"] as const) {
            expect(zeile({ status }).erreicht, status).toBe(erreichteStatusStationen(status, []).size);
        }
    });
});

/**
 * 💣 **Drei Befunde vom 2026-10-16 am echten Stand der Stage** (Betreiber: „manche laufen plötzlich parallel und
 * bezeichner sind nicht aufgelöst … schau ob die darstellung den internen zustand wiedergeben tut“):
 *
 * 1. **Die Abnahme machte jeden Vorgang zum Fix-Vorgang.** `kanal_abnehmen` schreibt den Nachweis `betreiber_abnahme` —
 *    auch an einer Frage ohne eine Zeile Code (OPS-000003, OPS-000005, OPS-000020). `wegFuer` sah einen Nachweis und
 *    zeigte die vier FIX-Stationen, drei davon leer. Der Status-Weg verschwand genau dann, wenn der Vorgang fertig war.
 * 2. **Lücken sahen aus wie zwei Läufe.** OPS-000002 trägt `fix_committed` und `betreiber_abnahme`, dazwischen nichts:
 *    ✔ ○ ○ ✔. Ein leerer Kreis VOR einem vollen liest sich wie „kommt noch“, nicht wie „ist übersprungen“.
 * 3. **Liste und Vorgang rechneten verschieden.** Die Liste zählt die laufende Runde, der Vorgang bekam alle Runden.
 *    Nach einem Wiederöffnen zeigte dieselbe Meldung in der Liste den Status-Weg und im Vorgang den Fix-Weg.
 */
describe("Der Weg und die Stände einer Leiste (2026-10-16)", () => {
    it("🔴 die Abnahme allein macht keinen Fix-Vorgang", () => {
        expect(wegFuer({ art: "meldung", alleNachweise: [{ station: "betreiber_abnahme" }], aenderungen: [] })).toBe(
            "status",
        );
    });

    it("ein Fix-Bericht oder ein anderer Nachweis schon", () => {
        expect(wegFuer({ art: "meldung", alleNachweise: [{ station: "fix_committed" }], aenderungen: [] })).toBe("fix");
        expect(wegFuer({ art: "meldung", alleNachweise: [], aenderungen: [{}] })).toBe("fix");
    });

    it("eine Freigabe bleibt der Fix-Weg, auch ganz am Anfang", () => {
        expect(wegFuer({ art: "freigabe", alleNachweise: [], aenderungen: [] })).toBe("fix");
    });

    it("🔴 eine übersprungene Station heißt „entfallen“, nicht „offen“", () => {
        expect(
            staende(
                ["fix_committed", "auf_stage", "claudia_nachgeprueft", "betreiber_abnahme"],
                new Set(["fix_committed", "betreiber_abnahme"]),
            ),
        ).toEqual(["erreicht", "entfallen", "entfallen", "erreicht"]);
    });

    it("was hinter der letzten erreichten Station liegt, bleibt offen", () => {
        expect(staende(["a", "b", "c"], new Set(["a"]))).toEqual(["erreicht", "offen", "offen"]);
        expect(staende(["a", "b", "c"], new Set())).toEqual(["offen", "offen", "offen"]);
    });
});
