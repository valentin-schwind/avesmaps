import { describe, expect, it } from "vitest";
import { commitLink, kurzinfoAus, versionGruppen, zeileAus, type ReleaseCommit } from "../src/versionen.ts";

/** „Versionen“ (WI-0137): Satz ohne Präfix, Gruppen nach Arbeitspaket, Leser der Kurzinfo, Commit-Link. */
const c = (betreff: string, datum: string, doku = false): ReleaseCommit => ({
    sha: datum.replace(/\D/gu, "").padEnd(40, "a").slice(0, 40),
    datum,
    wer: "Claudia",
    betreff,
    doku,
});

describe("Versionen: Satz und Gruppen", () => {
    it("der Satz ohne Präfix trägt den Rest des Bereichs; ohne Präfix bleibt der Betreff", () => {
        expect(zeileAus(c("feat(WI-0128 E12): Ort verschieben", "2026-10-11T00:41:00+02:00"))).toMatchObject({
            wi: "WI-0128",
            zeile: { art: "feat", text: "E12 · Ort verschieben" },
        });
        expect(
            zeileAus(c("fix(WI-0131): Prüfhaken folgen der Sitzung", "2026-10-11T00:00:00+02:00")).zeile,
        ).toMatchObject({
            art: "fix",
            text: "Prüfhaken folgen der Sitzung",
        });
        expect(zeileAus(c("fix: Zahl stimmt", "2026-10-11T00:00:00+02:00"))).toMatchObject({
            wi: null,
            zeile: { art: "fix", text: "Zahl stimmt" },
        });
        expect(
            zeileAus(c("Auth auf Stage vorbereitet (WI-0120 A13)", "2026-10-11T00:00:00+02:00")).zeile,
        ).toMatchObject({
            art: null,
            text: "Auth auf Stage vorbereitet (WI-0120 A13)",
        });
        expect(zeileAus(c("wip(WI-0128): Zwischenstand", "2026-10-11T00:00:00+02:00")).zeile.art).toBeNull();
    });

    it("🔴 Gruppen nach dem jüngsten Commit, „Sonstiges“ zuletzt, Doku nur mit dem Schalter", () => {
        const commits = [
            c("feat(WI-0128 E12): Ort verschieben", "2026-10-11T00:41:00+02:00"),
            c("fix: Zahl stimmt", "2026-10-11T03:00:00+02:00"),
            c("feat(WI-0127 SYS-8): Systemzustand", "2026-10-10T22:00:00+02:00"),
            c("feat(WI-0127 SYS-13): Höhenmodell", "2026-10-11T01:00:00+02:00"),
            c("docs(WI-0137): Bauplan", "2026-10-11T05:00:00+02:00", true),
            c("feat(WI-0133): Feld in der Kontenverwaltung", "2026-10-10T20:00:00+02:00"),
        ];
        const pakete = {
            "WI-0128": "Ortseditor (Identität, Lage), Bau nach EDIT-0001",
            "WI-0127": "WI-0127: Systemsteuerung, Bau Stufe 1",
            // Ein Doppelpunkt im Zitat schneidet den Namen nicht ab.
            "WI-0133": "„Verantwortlich für:“ je Person",
        };
        const ohne = versionGruppen(commits, pakete, false);
        expect(ohne.map((g) => [g.id, g.name, g.zeilen.length])).toEqual([
            ["WI-0127", "Systemsteuerung", 2],
            ["WI-0128", "Ortseditor", 1],
            ["WI-0133", "„Verantwortlich für:“ je Person", 1],
            ["sonstiges", null, 1],
        ]);
        expect(ohne[0]!.zeilen.map((z) => z.text)).toEqual(["SYS-13 · Höhenmodell", "SYS-8 · Systemzustand"]);
        expect(versionGruppen(commits, pakete, true).map((g) => g.id)).toEqual([
            "WI-0137",
            "WI-0127",
            "WI-0128",
            "WI-0133",
            "sonstiges",
        ]);
    });
});

describe("Versionen: Kurzinfo", () => {
    it("🔴 nur drei Abschnitte in fester Folge, leere fallen weg, Kommentare und Fremdes nicht; Text bleibt Text", () => {
        const md = [
            "# Was ist neu?",
            "<!-- Gedächtnisstütze",
            "## Anschauen",
            "- nicht zeigen",
            "-->",
            "## Beachten",
            "- Ortseditor: Bearbeiten bleibt aus.",
            "",
            "## Anschauen",
            "- Zoomstufe 8: <b>näher</b> heran.",
            "* zweiter Punkt",
            "## Prüfen",
            "",
            "## Sonstiges",
            "- gehört nicht dazu",
        ].join("\r\n");
        expect(kurzinfoAus(md)).toEqual({
            abschnitte: [
                { titel: "Anschauen", punkte: ["Zoomstufe 8: <b>näher</b> heran.", "zweiter Punkt"] },
                { titel: "Beachten", punkte: ["Ortseditor: Bearbeiten bleibt aus."] },
            ],
            fremd: ["Sonstiges"],
        });
        expect(kurzinfoAus("")).toEqual({ abschnitte: [], fremd: [] });
    });

    it("der Commit-Link entsteht nur aus einer SHA", () => {
        expect(commitLink("b7e2d41")).toBe("https://github.com/valentin-schwind/avesmaps3D/commit/b7e2d41");
        expect(commitLink("javascript:alert(1)")).toBeNull();
        expect(commitLink("B7E2D41")).toBeNull();
    });
});
