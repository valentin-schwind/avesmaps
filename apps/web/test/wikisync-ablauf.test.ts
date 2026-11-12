import { describe, expect, it } from "vitest";
import {
    WIKISYNC_BEREICHE,
    wikisyncAngeschlossen,
    wikisyncHatKategorien,
    type WikisyncAuftrag,
    type WikisyncBereich,
    type WikisyncBereichStand,
    type WikisyncStand,
    type WikisyncUebernahmeKurz,
} from "@avesmaps3d/shared";
import {
    KATEGORIEN_ABSTAND_TAGE,
    bereichImLauf,
    bereicheImLauf,
    berichtZeile,
    frageSatz,
    herkunftSatz,
    kategorienAbstandTage,
    laufAktiv,
    laufBilanz,
    laufLage,
    laufSchritte,
    planHinweise,
    planSatz,
    planSchritte,
    quellenStand,
    standSpalte,
    startPlan,
    type AblaufDaten,
} from "../src/wikisync/wikisync-ablauf.ts";

/**
 * Der Ablauf von „WikiSync starten“ (WI-0253 §20, Variante A; WI-0294: ohne Wiki-Teil): Was jede Zeile der Tafel im Plan, im Lauf und danach sagt, ohne Vue. Die Szenen sind die des Entwurfs
 * (`review/wi-0253/wikisync-ablauf-mockup.html`): bereit, läuft (Dump, Übernahme, wartet auf den Legacy-Zug), fertig, und neu die Kategorien-Datei, die fehlt.
 *
 * - **Soll:** Der Ablauf kommt aus dem, was die Seite ohnehin liest; ein Bereich gehört zum Lauf, wenn ein Auftrag für ihn arbeitet, die jüngste Vorschau ihn übernommen hat oder seine Übernahme
 *   wegen der fehlenden Kategorien-Datei aussteht. Zwei Schritte je Zeile: Dump und Übernahme.
 * - **Problemfälle:** Legacy-Zug läuft (Warten, kein Fehler), ein Bereich ohne angeschlossene Übernahme (nicht im Lauf), keine Kategorien-Datei (Orte, Herrschaftsgebiete, Derographie warten, die
 *   übrigen laufen), Dump und Kategorien weit auseinander (nur ein Hinweis), eine zurückgenommene Übernahme, eine Übernahme aus einer älteren Vorschau.
 */

const JETZT = new Date("2026-10-26T20:00:00.000Z");
const V = 7;
const DATEI = "dump_categorylinks-20261003.sql.gz";
/** Mittags (UTC), damit das Datum in jeder Zeitzone des Prüfstands dasselbe bleibt. */
const GELESEN_STAND = "2026-10-03T12:00:00.000Z";

const bereichStand = (
    bereich: WikisyncBereich,
    letzteUebernahme: WikisyncUebernahmeKurz | null = null,
): WikisyncBereichStand => ({
    bereich,
    angeschlossen: wikisyncAngeschlossen(bereich),
    kategorien: wikisyncHatKategorien(bereich),
    letzteUebernahme,
});

const uebernahme = (
    lauf: number,
    felder: number,
    extra: Partial<WikisyncUebernahmeKurz> = {},
): WikisyncUebernahmeKurz => ({
    id: 1,
    art: "uebernahme",
    lauf,
    status: "fertig",
    gestartetAm: "2026-10-26T19:55:00.000Z",
    beendetAm: "2026-10-26T19:56:00.000Z",
    ausgeloestVon: "Vali",
    grund: null,
    felder,
    befunde: 3,
    gleich: 100,
    zurueckgenommen: false,
    ...extra,
});

const auftrag = (art: WikisyncAuftrag["art"], extra: Partial<WikisyncAuftrag> = {}): WikisyncAuftrag => ({
    art,
    zustand: "RUNNING",
    phase: null,
    fortschritt: null,
    eingereihtAm: "2026-10-26T19:50:00.000Z",
    gestartetAm: "2026-10-26T19:50:10.000Z",
    ausgeloestVon: "Vali",
    ...extra,
});

interface Optionen {
    uebernahmen?: Partial<Record<WikisyncBereich, WikisyncUebernahmeKurz>>;
    auftraege?: WikisyncAuftrag[];
    vorschau?: boolean | "fehlgeschlagen" | "laeuft";
    /** Liegt eine Kategorien-Datei im Dump-Ordner? Vorgabe: ja. */
    datei?: boolean;
    /** Hat die jüngste Vorschau eine Kategorien-Datei gelesen? Vorgabe: ja. */
    gelesen?: boolean;
    /** Der Stand der Kategorien-Datei im Ordner (Datum aus dem Namen). */
    dateiStand?: string | null;
    dumpStand?: string | null;
    vorschauBereiche?: WikisyncBereich[];
}

function daten(optionen: Optionen = {}): AblaufDaten {
    const datei = optionen.datei ?? true;
    const stand: WikisyncStand = {
        jetzt: JETZT.toISOString(),
        dump: {
            ordner: true,
            datei: "dump.xml.bz2",
            geholtAm: null,
            groesse: null,
            stand: optionen.dumpStand === undefined ? "2026-10-01" : optionen.dumpStand,
            seiten: 10,
            sha256: null,
            vollstaendig: true,
            namensraeume: [],
        },
        kategorienDatei: datei
            ? {
                  datei: DATEI,
                  geholtAm: "2026-10-04T10:00:00.000Z",
                  groesse: 1000,
                  stand: optionen.dateiStand === undefined ? "2026-10-03" : optionen.dateiStand,
              }
            : { datei: null, geholtAm: null, groesse: null, stand: null },
        dumpHolen: { erlaubt: true, grund: null, letzter: null },
        vorschau:
            optionen.vorschau === false
                ? null
                : {
                      id: V,
                      status:
                          optionen.vorschau === "fehlgeschlagen"
                              ? "fehlgeschlagen"
                              : optionen.vorschau === "laeuft"
                                ? "laeuft"
                                : "fertig",
                      bereiche: optionen.vorschauBereiche ?? [...WIKISYNC_BEREICHE],
                      gestartetAm: "2026-10-26T19:50:00.000Z",
                      beendetAm: "2026-10-26T19:50:50.000Z",
                      fehler: optionen.vorschau === "fehlgeschlagen" ? "kaputt" : null,
                      dumpDatei: "dump.xml.bz2",
                      dumpStand: "2026-10-01",
                      kategorien:
                          (optionen.gelesen ?? true) ? { datei: DATEI, stand: GELESEN_STAND, zeilen: 1_000_000 } : null,
                      tafelRevision: 1,
                      ausgeloestVon: "Vali",
                  },
        tafelRevision: 1,
        auftraege: optionen.auftraege ?? [],
    };
    return {
        stand,
        bereiche: {
            jetzt: JETZT.toISOString(),
            bereiche: WIKISYNC_BEREICHE.map((bereich) =>
                bereichStand(bereich, optionen.uebernahmen?.[bereich] ?? null),
            ),
        },
    };
}

const texte = (schritte: { text: string }[]): string[] => schritte.map((schritt) => schritt.text);
const stati = (schritte: { status: string }[]): string[] => schritte.map((schritt) => schritt.status);

describe("Szene bereit: nichts läuft, der Plan", () => {
    it("jeder gewählte Bereich zeigt seine zwei Schritte als wartend, auch die mit Kategorien", () => {
        const d = daten({ vorschau: false });
        expect(laufAktiv(d)).toBe(false);
        expect(bereicheImLauf(d)).toEqual([]);
        const ort = planSchritte(d, "ort");
        expect(ort.map((schritt) => schritt.art)).toEqual(["dump", "uebernahme"]);
        expect(stati(ort)).toEqual(["wartet", "wartet"]);
        expect(texte(ort)).toEqual(["Dump", "Übernahme"]);
        expect(planSchritte(d, "weg").map((schritt) => schritt.art)).toEqual(["dump", "uebernahme"]);
        expect(laufLage(d, JETZT)).toMatchObject({ phase: "bereit", satz: null });
    });

    it("🔴 liegt keine Kategorien-Datei im Ordner, sagt die Übernahme der Bereiche mit Kategorien das; die übrigen bleiben bei „Übernahme“", () => {
        const d = daten({ vorschau: false, datei: false });
        for (const bereich of ["ort", "gebiet", "region"] as const) {
            expect(texte(planSchritte(d, bereich))).toEqual(["Dump", "Übernahme wartet auf die Kategorien-Datei"]);
        }
        expect(texte(planSchritte(d, "weg"))).toEqual(["Dump", "Übernahme"]);
        expect(texte(planSchritte(d, "kraftlinie"))).toEqual(["Dump", "Übernahme"]);
    });

    it("die Plan-Zeile nennt Dump, Kategorien und Übernahme mit beiden Ständen; ohne Bereich mit Kategorien nur den Dump", () => {
        const d = daten({ vorschau: false });
        const plan = startPlan(d, new Set<WikisyncBereich>(["ort", "gebiet", "weg"]));
        expect(plan).toMatchObject({
            bereiche: ["ort", "weg", "gebiet"],
            mitKategorien: ["ort", "gebiet"],
            wartend: [],
        });
        expect(planSatz(plan, quellenStand(d))).toBe(
            "Dump vom 01.10.2026 lesen · Kategorien vom 03.10.2026 lesen · dann übernehmen",
        );
        expect(planHinweise(plan, quellenStand(d))).toEqual([]);
        const ohne = startPlan(d, new Set<WikisyncBereich>(["weg", "kraftlinie"]));
        expect(ohne).toMatchObject({ mitKategorien: [], wartend: [] });
        expect(planSatz(ohne, quellenStand(d))).toBe("Dump vom 01.10.2026 lesen · dann übernehmen");
    });

    it("kennt die Seite einen Stand nicht, steht die Zeile ohne Datum da", () => {
        const d = daten({ vorschau: false, dumpStand: null, dateiStand: null });
        const plan = startPlan(d, new Set<WikisyncBereich>(["region"]));
        expect(planSatz(plan, quellenStand(d))).toBe("Dump lesen · Kategorien lesen · dann übernehmen");
        // Ohne Stand lässt sich auch kein Abstand rechnen: kein Hinweis.
        expect(planHinweise(plan, quellenStand(d))).toEqual([]);
    });

    it("🔴 hat die jüngste Vorschau genau diese Datei gelesen, gilt ihr Stand aus der Endzeile; eine andere Datei im Ordner zählt mit ihrem Datum aus dem Namen", () => {
        const gleich = daten({ dateiStand: "2026-10-03" });
        expect(quellenStand(gleich)).toEqual({
            dumpStand: "2026-10-01",
            kategorienDa: true,
            kategorienStand: GELESEN_STAND,
        });
        const neuer = daten();
        neuer.stand.kategorienDatei = {
            ...neuer.stand.kategorienDatei,
            datei: "dump_categorylinks-20261109.sql.gz",
            stand: "2026-11-09",
        };
        expect(quellenStand(neuer).kategorienStand).toBe("2026-11-09");
        const keine = daten({ datei: false });
        expect(quellenStand(keine)).toMatchObject({ kategorienDa: false, kategorienStand: null });
        // Fehlt der Stand des Dumps im Ordner, gilt der der jüngsten Vorschau.
        expect(quellenStand(daten({ dumpStand: null })).dumpStand).toBe("2026-10-01");
        expect(quellenStand(daten({ dumpStand: null, vorschau: false })).dumpStand).toBeNull();
    });

    it("🔴 fehlt die Kategorien-Datei, warten die gewählten Bereiche mit Kategorien; die Plan-Zeile nennt sie nicht, ein Hinweis schon", () => {
        const d = daten({ vorschau: false, datei: false });
        const plan = startPlan(d, new Set<WikisyncBereich>(["ort", "gebiet", "region", "weg"]));
        expect(plan.wartend).toEqual(["ort", "gebiet", "region"]);
        expect(planSatz(plan, quellenStand(d))).toBe("Dump vom 01.10.2026 lesen · dann übernehmen");
        expect(planHinweise(plan, quellenStand(d))).toEqual([
            "Kategorien-Datei fehlt, Orte, Herrschaftsgebiete und Derographie warten",
        ]);
        // Nur die gewählten: Wer die drei abwählt, braucht die Datei nicht.
        const nurWeg = startPlan(d, new Set<WikisyncBereich>(["weg"]));
        expect(nurWeg.wartend).toEqual([]);
        expect(planHinweise(nurWeg, quellenStand(d))).toEqual([]);
        expect(planHinweise(startPlan(d, new Set<WikisyncBereich>(["ort"])), quellenStand(d))).toEqual([
            "Kategorien-Datei fehlt, Orte warten",
        ]);
    });

    it("🔴 liegen Dump und Kategorien mehr als 14 Tage auseinander, steht ein Hinweis da; der Plan bleibt der gleiche (kein Halt)", () => {
        const weit = daten({ vorschau: false, dateiStand: "2026-10-20" });
        const plan = startPlan(weit, new Set<WikisyncBereich>(["ort", "weg"]));
        expect(plan.wartend).toEqual([]);
        expect(planHinweise(plan, quellenStand(weit))).toEqual(["Kategorien und Dump sind 19 Tage auseinander"]);
        expect(planSatz(plan, quellenStand(weit))).toBe(
            "Dump vom 01.10.2026 lesen · Kategorien vom 20.10.2026 lesen · dann übernehmen",
        );
        // Genau 14 Tage sind noch in Ordnung; auch die Kategorien VOR dem Dump zählen mit ihrem Betrag.
        expect(planHinweise(plan, quellenStand(daten({ vorschau: false, dateiStand: "2026-10-15" })))).toEqual([]);
        const davor = daten({ vorschau: false, dumpStand: "2026-11-01", dateiStand: "2026-10-10" });
        expect(planHinweise(plan, quellenStand(davor))).toEqual(["Kategorien und Dump sind 22 Tage auseinander"]);
        // Ohne Bereich mit Kategorien in der Wahl gibt es nichts zu sagen.
        const ohne = startPlan(weit, new Set<WikisyncBereich>(["weg"]));
        expect(planHinweise(ohne, quellenStand(weit))).toEqual([]);
    });

    it("die Frage vor dem Start sagt in Sätzen, was geschieht, bevor die Vorschau gesehen ist", () => {
        const d = daten({ vorschau: false });
        const plan = startPlan(d, new Set<WikisyncBereich>(["ort", "weg"]));
        expect(frageSatz(plan, quellenStand(d), "Stage")).toBe(
            "Liest den Dump vom 01.10.2026. Liest dazu die Kategorien-Datei für Orte. Übernimmt ohne Halt die eindeutigen Änderungen dieser Bereiche in der Umgebung Stage: Orte und Wege. Die Vorschau erscheint erst im Laufbericht; jeder Bereich lässt sich danach einzeln zurücknehmen.",
        );
        const ohne = startPlan(d, new Set<WikisyncBereich>(["weg"]));
        expect(frageSatz(ohne, quellenStand(d), "Stage")).toBe(
            "Liest den Dump vom 01.10.2026. Übernimmt ohne Halt die eindeutigen Änderungen dieser Bereiche in der Umgebung Stage: Wege. Die Vorschau erscheint erst im Laufbericht; jeder Bereich lässt sich danach einzeln zurücknehmen.",
        );
    });

    it("🔴 die Frage ohne Kategorien-Datei sagt, dass die Bereiche mit Kategorien diesmal nicht übernommen werden, und nennt als Übernahme nur die übrigen", () => {
        const d = daten({ vorschau: false, datei: false, dumpStand: null });
        const gemischt = startPlan(d, new Set<WikisyncBereich>(["ort", "weg"]));
        expect(frageSatz(gemischt, quellenStand(d), "Stage")).toBe(
            "Liest den Dump. Die Kategorien-Datei fehlt: Orte warten und werden diesmal nicht übernommen. Übernimmt ohne Halt die eindeutigen Änderungen dieser Bereiche in der Umgebung Stage: Wege. Die Vorschau erscheint erst im Laufbericht; jeder Bereich lässt sich danach einzeln zurücknehmen.",
        );
        // Bleibt nichts zu übernehmen, fehlt der Satz zur Übernahme.
        const nurOrte = startPlan(d, new Set<WikisyncBereich>(["ort"]));
        expect(frageSatz(nurOrte, quellenStand(d), "Stage")).toBe(
            "Liest den Dump. Die Kategorien-Datei fehlt: Orte warten und werden diesmal nicht übernommen.",
        );
    });
});

describe("Der Abstand von Dump und Kategorien (kategorienAbstandTage)", () => {
    it("rechnet die Tage zwischen den Ständen als Betrag, in beiden Richtungen und über Monatsgrenzen", () => {
        expect(kategorienAbstandTage("2026-11-01", "2026-11-09")).toBe(8);
        expect(kategorienAbstandTage("2026-11-09", "2026-11-01")).toBe(8);
        expect(kategorienAbstandTage("2026-10-28", "2026-11-12")).toBe(15);
        expect(kategorienAbstandTage("2026-11-05", "2026-11-05")).toBe(0);
    });

    it("nimmt Daten und ISO-Zeiten (UTC) gleich; eine Uhrzeit verschiebt den Tag nicht", () => {
        expect(kategorienAbstandTage("2026-11-01", "2026-11-09T23:59:00.000Z")).toBe(8);
        expect(kategorienAbstandTage("2026-11-01T00:00:01.000Z", "2026-11-09")).toBe(8);
        expect(kategorienAbstandTage("2026-10-01T10:00:00.000Z", "2026-10-15T04:12:00.000Z")).toBe(14);
    });

    it("kennt einen Stand nicht oder ist er kein Datum, gibt es keine Zahl (unbekannt ist nicht null)", () => {
        expect(kategorienAbstandTage(null, "2026-11-09")).toBeNull();
        expect(kategorienAbstandTage("2026-11-01", null)).toBeNull();
        expect(kategorienAbstandTage("kaputt", "2026-11-09")).toBeNull();
        expect(kategorienAbstandTage("2026-11-01", "")).toBeNull();
    });

    it("die Schwelle ist 14 Tage", () => {
        expect(KATEGORIEN_ABSTAND_TAGE).toBe(14);
    });
});

describe("Szene läuft: Dump, Übernahme", () => {
    it("Dump wird gelesen: die Bereiche des Auftrags gehören zum Lauf, die anderen nicht", () => {
        const d = daten({
            vorschau: false,
            auftraege: [auftrag("wiki_vorschau", { bereiche: ["ort", "weg"] })],
        });
        expect(laufAktiv(d)).toBe(true);
        expect(bereichImLauf(d, "ort")).toBe(true);
        expect(bereichImLauf(d, "gipfel")).toBe(false);
        const ort = laufSchritte(d, "ort");
        expect(stati(ort)).toEqual(["laeuft", "wartet"]);
        expect(texte(ort)).toEqual(["Dump", "Übernahme wartet"]);
        expect(laufLage(d, JETZT)).toMatchObject({
            phase: "dump",
            satz: "Dump wird gelesen …",
            leise: "Der Lauf liest zuerst Dump und Kategorien und übernimmt danach ohne Halt.",
        });
    });

    it("🔴 die Übernahme der Orte wartet, der Weg ist längst übernommen: Es gibt nur noch zwei Schritte, keinen Wiki-Teil", () => {
        const d = daten({
            uebernahmen: { weg: uebernahme(V, 23) },
            auftraege: [auftrag("wiki_uebernehmen", { zustand: "QUEUED", bereiche: ["ort", "gebiet"] })],
        });
        expect(bereicheImLauf(d)).toEqual(["ort", "weg", "gebiet"]);
        const ort = laufSchritte(d, "ort");
        expect(stati(ort)).toEqual(["fertig", "wartet"]);
        expect(texte(ort)).toEqual(["Dump", "Übernahme wartet"]);
        const weg = laufSchritte(d, "weg");
        expect(stati(weg)).toEqual(["fertig", "fertig"]);
        expect(texte(weg)).toEqual(["Dump", "Übernahme"]);
        expect(laufLage(d, JETZT)).toMatchObject({ phase: "wartet", satz: "Wartet in der Warteschlange" });
    });

    it("ein Bereich ohne Änderungen sagt „nichts zu übernehmen“; eine zurückgenommene Übernahme „zurückgenommen“", () => {
        const d = daten({
            uebernahmen: {
                kraftlinie: uebernahme(V, 0),
                weg: uebernahme(V, 5, { art: "zuruecknahme" }),
            },
        });
        expect(laufSchritte(d, "kraftlinie")[1]!.text).toBe("nichts zu übernehmen");
        expect(laufSchritte(d, "weg")[1]!.text).toBe("zurückgenommen");
    });

    it("🔴 Läuft ein Legacy-Zug, wartet die Übernahme: kein Fehler, ein Satz in der Zeile und im Fuß", () => {
        const d = daten({
            auftraege: [auftrag("wiki_uebernehmen", { zustand: "QUEUED", wartetAuf: "legacy_zug", bereiche: ["weg"] })],
        });
        const weg = laufSchritte(d, "weg");
        expect(weg[1]).toMatchObject({
            status: "wartet",
            text: "Übernahme wartet, bis der Import fertig ist",
        });
        expect(laufLage(d, JETZT)).toMatchObject({
            phase: "wartet",
            satz: "Wartet, bis der Import fertig ist",
            ton: "warnung",
        });
        // Ein Abbruch durch den Zug mitten im Lauf (nichts geschrieben) ist auch ein Warten, solange der Auftrag in der Schlange steht.
        const abgebrochen = daten({
            uebernahmen: {
                weg: uebernahme(V, 0, { status: "abgebrochen", grund: "Wartet, bis der Legacy-Zug fertig ist" }),
            },
            auftraege: [auftrag("wiki_uebernehmen", { zustand: "QUEUED", wartetAuf: "legacy_zug", bereiche: ["weg"] })],
        });
        expect(laufSchritte(abgebrochen, "weg")[1]!.status).toBe("wartet");
    });

    it("die Übernahme läuft: der Fuß sagt es, die Zeile zeigt „Übernahme …“", () => {
        const d = daten({ auftraege: [auftrag("wiki_uebernehmen", { bereiche: ["weg"] })] });
        expect(laufSchritte(d, "weg")[1]).toMatchObject({ status: "laeuft", text: "Übernahme …" });
        expect(laufLage(d, JETZT)).toMatchObject({ phase: "uebernahme", satz: "Übernahme läuft" });
    });
});

describe("Szene Kategorien-Datei fehlte: die drei Bereiche stehen aus, die übrigen sind übernommen", () => {
    const ohneDatei = (extra: Optionen = {}): AblaufDaten =>
        daten({ gelesen: false, uebernahmen: { weg: uebernahme(V, 23), kraftlinie: uebernahme(V, 3) }, ...extra });

    it("🔴 Orte, Herrschaftsgebiete und Derographie gehören zum Lauf und sagen, worauf sie warten", () => {
        const d = ohneDatei();
        expect(bereicheImLauf(d)).toEqual(["ort", "weg", "gebiet", "region", "kraftlinie"]);
        for (const bereich of ["ort", "gebiet", "region"] as const) {
            const schritte = laufSchritte(d, bereich);
            expect(stati(schritte)).toEqual(["fertig", "wartet"]);
            expect(texte(schritte)).toEqual(["Dump", "Übernahme wartet auf die Kategorien-Datei"]);
        }
        expect(texte(laufSchritte(d, "weg"))).toEqual(["Dump", "Übernahme"]);
        expect(stati(laufSchritte(d, "weg"))).toEqual(["fertig", "fertig"]);
        expect(laufLage(d, JETZT).phase).toBe("fertig");
    });

    it("sie stehen nur dann aus, wenn die jüngste fertige Vorschau sie gerechnet hat", () => {
        // Eine Vorschau nur für die Vorkommen („neu ableiten“) rechnet die Orte nicht.
        expect(bereichImLauf(ohneDatei({ vorschauBereiche: ["vorkommen"] }), "ort")).toBe(false);
        // Eine Vorschau, die noch läuft oder scheiterte, sagt dazu nichts.
        expect(bereichImLauf(ohneDatei({ vorschau: "laeuft" }), "ort")).toBe(false);
        expect(bereichImLauf(ohneDatei({ vorschau: "fehlgeschlagen" }), "ort")).toBe(false);
        // Ohne Vorschau gibt es nichts, was aussteht.
        expect(bereichImLauf(ohneDatei({ vorschau: false }), "ort")).toBe(false);
    });

    it("hat die Vorschau eine Datei gelesen, steht nichts aus: Die Übernahme wartet gewöhnlich", () => {
        const d = daten({ uebernahmen: { weg: uebernahme(V, 23) } });
        expect(bereichImLauf(d, "ort")).toBe(false);
        expect(texte(laufSchritte(d, "ort"))).toEqual(["Dump", "Übernahme wartet"]);
    });

    it("eine Übernahme aus dieser Vorschau zeigt ihr Ergebnis, auch wenn die Vorschau keine Kategorien führt (ein Lauf vor WI-0294)", () => {
        const d = daten({ gelesen: false, uebernahmen: { ort: uebernahme(V, 412) } });
        expect(texte(laufSchritte(d, "ort"))).toEqual(["Dump", "Übernahme"]);
        expect(stati(laufSchritte(d, "ort"))).toEqual(["fertig", "fertig"]);
    });

    it("🔴 ein Auftrag, der für den Bereich arbeitet, geht vor: Die Übernahme läuft, statt zu warten", () => {
        const d = ohneDatei({ auftraege: [auftrag("wiki_uebernehmen", { bereiche: ["ort"] })] });
        expect(laufSchritte(d, "ort")[1]).toMatchObject({ status: "laeuft", text: "Übernahme …" });
    });
});

describe("Szene fertig: das Ergebnis", () => {
    const fertig = (): AblaufDaten =>
        daten({
            uebernahmen: {
                ort: uebernahme(V, 412, { gleich: 3788, befunde: 1640, beendetAm: "2026-10-26T20:41:00.000Z" }),
                weg: uebernahme(V, 23, { gleich: 407, befunde: 7 }),
            },
        });

    it("der Fuß nennt Zeit und Felder; die Zeilen zeigen beide Schritte als fertig", () => {
        const d = fertig();
        d.stand.vorschau!.gestartetAm = "2026-10-26T19:50:00.000Z";
        const lage = laufLage(d, new Date("2026-10-26T20:45:00.000Z"));
        expect(lage.phase).toBe("fertig");
        expect(lage.satz).toMatch(/^Lauf fertig, .+: 435 Felder übernommen\. Der Bericht steht darunter\.$/u);
        expect(stati(laufSchritte(d, "ort"))).toEqual(["fertig", "fertig"]);
        expect(texte(laufSchritte(d, "ort"))).toEqual(["Dump", "Übernahme"]);
    });

    it("die Bilanz summiert die Übernahmen des Laufs und nennt Dump, Kategorien und Dauer", () => {
        const bilanz = laufBilanz(fertig());
        expect(bilanz).toEqual({
            felder: 435,
            gleich: 4195,
            befunde: 1647,
            dumpStand: "2026-10-01",
            kategorienStand: GELESEN_STAND,
            dauerSekunden: 3060,
        });
        expect(herkunftSatz(bilanz!)).toBe("Dump vom 01.10.2026 · Kategorien vom 03.10.2026 · Dauer 51 Min.");
    });

    it("hat die Vorschau keine Kategorien-Datei gelesen, fehlt der Stand in der Bilanz und in der Herkunft", () => {
        const d = daten({
            gelesen: false,
            uebernahmen: { weg: uebernahme(V, 23, { beendetAm: "2026-10-26T20:41:00.000Z" }) },
        });
        const bilanz = laufBilanz(d)!;
        expect(bilanz.kategorienStand).toBeNull();
        expect(herkunftSatz(bilanz)).toBe("Dump vom 01.10.2026 · Dauer 51 Min.");
        expect(herkunftSatz({ ...bilanz, dumpStand: null, dauerSekunden: null })).toBe("Dump");
    });

    it("eine zurückgenommene Übernahme zählt nicht mehr in die Felder; kennt eine die Zahl „unverändert“ nicht, fehlt die Summe", () => {
        const d = fertig();
        d.bereiche.bereiche.find((stand) => stand.bereich === "weg")!.letzteUebernahme = uebernahme(V, 23, {
            zurueckgenommen: true,
        });
        expect(laufBilanz(d)?.felder).toBe(412);
        const ohneZahl = fertig();
        const eintrag = ohneZahl.bereiche.bereiche.find((stand) => stand.bereich === "weg")!;
        eintrag.letzteUebernahme = { ...eintrag.letzteUebernahme!, gleich: undefined as never };
        delete (eintrag.letzteUebernahme as { gleich?: number }).gleich;
        expect(laufBilanz(ohneZahl)?.gleich).toBeNull();
    });

    it("die Zeile im Laufbericht nennt Felder, unverändert, Befunde und die Kategorien; Bereiche ohne Kategorien „nur Dump“", () => {
        const d = fertig();
        const ort = d.bereiche.bereiche.find((stand) => stand.bereich === "ort")!;
        const weg = d.bereiche.bereiche.find((stand) => stand.bereich === "weg")!;
        expect(berichtZeile(d, ort, JETZT)).toBe(
            "412 Felder übernommen · 3.788 unverändert · 1.640 Befunde · Kategorien vom 03.10.2026",
        );
        expect(berichtZeile(d, weg, JETZT)).toBe("23 Felder übernommen · 407 unverändert · 7 Befunde · Wiki: nur Dump");
    });

    it("eine Übernahme aus einem Lauf vor WI-0294 (ohne Kategorien in der Vorschau) nennt bei den Orten keine Quelle, statt „nur Dump“ zu behaupten", () => {
        const d = daten({ gelesen: false, uebernahmen: { ort: uebernahme(V, 412, { gleich: 3788, befunde: 1640 }) } });
        const ort = d.bereiche.bereiche.find((stand) => stand.bereich === "ort")!;
        expect(berichtZeile(d, ort, JETZT)).toBe("412 Felder übernommen · 3.788 unverändert · 1.640 Befunde");
    });

    it("🔴 die Quellen legen an und legen still: Die Zeile des Laufberichts nennt die Zahlen (angelegt, still gelegt, neue Quellen), nur wo sie größer als null sind", () => {
        const d = daten({
            uebernahmen: {
                weg: uebernahme(V, 14, { angelegt: 12, stillgelegt: 1, quellenAngelegt: 1, gleich: 5, befunde: 2 }),
                kraftlinie: uebernahme(V, 3, { angelegt: 0, stillgelegt: 0, gleich: 5, befunde: 2 }),
            },
        });
        const stand = (bereich: string) => d.bereiche.bereiche.find((eintrag) => eintrag.bereich === bereich)!;
        expect(berichtZeile(d, stand("weg"), JETZT)).toContain(
            "14 Felder übernommen · 5 unverändert · 12 angelegt · 1 still gelegt · 1 neue Quellen · 2 Befunde",
        );
        expect(berichtZeile(d, stand("kraftlinie"), JETZT)).not.toContain("angelegt");
    });

    it("🔴 eine Übernahme aus einer älteren Vorschau ist kein Teil dieses Laufs", () => {
        const d = daten({ uebernahmen: { weg: uebernahme(V - 1, 5) } });
        expect(bereichImLauf(d, "weg")).toBe(false);
        expect(laufLage(d, JETZT).phase).toBe("bereit");
        // Die Spalte „Letzte Übernahme“ zeigt sie trotzdem.
        expect(
            standSpalte(
                d.bereiche.bereiche.find((stand) => stand.bereich === "weg"),
                JETZT,
            ).unten,
        ).toBe("5 Felder übernommen");
    });

    it("eine Übernahme, die nicht anlief oder scheiterte, steht als Fehler in der Zeile", () => {
        const d = daten({
            uebernahmen: {
                weg: uebernahme(V, 0, { status: "abgelehnt", grund: "gehoert_legacy" }),
                kraftlinie: uebernahme(V, 0, { status: "fehlgeschlagen", grund: "kaputt" }),
            },
        });
        expect(laufSchritte(d, "weg")[1]).toMatchObject({
            status: "fehler",
            text: "Übernahme nicht angelaufen: gehoert_legacy",
        });
        expect(laufSchritte(d, "kraftlinie")[1]).toMatchObject({
            status: "fehler",
            text: "Übernahme gescheitert: kaputt",
        });
    });

    it("ein gescheiterter Dump (die Vorschau) steht im Fuß, nicht als Lauf", () => {
        const lage = laufLage(daten({ vorschau: "fehlgeschlagen" }), JETZT);
        expect(lage.ton).toBe("fehler");
        expect(lage.satz).toMatch(/^Zuletzt gescheitert: .+ · kaputt$/u);
    });
});

describe("Spalte „Letzte Übernahme“", () => {
    it("ohne Übernahme: ein Strich und der Satz; mit Rücknahme: das Wort; scheiterte sie: ihr Status", () => {
        expect(standSpalte(undefined, JETZT)).toEqual({ oben: "—", unten: "noch keine Übernahme" });
        const zurueck = bereichStand("ort", uebernahme(V, 5, { art: "zuruecknahme" }));
        expect(standSpalte(zurueck, JETZT).unten).toBe("zurückgenommen");
        const gescheitert = bereichStand("ort", uebernahme(V, 0, { status: "fehlgeschlagen" }));
        expect(standSpalte(gescheitert, JETZT).unten).toBe("gescheitert");
    });
});
