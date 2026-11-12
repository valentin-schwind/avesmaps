import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { LEGACY_ZUG_KATEGORIEN } from "../src/system/legacy-zug.ts";
import {
    WIKISYNC_ANGESCHLOSSEN,
    WIKISYNC_ARTIKEL_TITEL_MAX,
    WIKISYNC_ARTIKEL_TITEL_VERBOTEN,
    WIKISYNC_BEREICHE,
    WIKISYNC_MIT_KATEGORIEN,
    WIKISYNC_ORTSROLLEN,
    WIKISYNC_ZUG_KATEGORIE,
    WikisyncArtikelBody,
    WikisyncUebernehmenBody,
    WikisyncVorschauBody,
    WikisyncZuruecknehmenBody,
    wikisyncAngeschlossen,
    wikisyncBereicheDerKategorie,
    wikisyncHatKategorien,
} from "../src/system/wikisync.ts";

/**
 * Die Wörter und Verträge des Bereichsschalters (WI-0253 D-1): welche Bereiche angeschlossen sind, welche Kategorien aus der Datei haben, in welcher Kategorie der Legacy-Zug sie
 * fährt, und die Formen der vier Schreibrouten. Rein, ohne Datenbank.
 */
const OPERATION = "11111111-1111-4111-8111-111111111111";

describe("Bereiche: angeschlossen, Kategorien, Kategorie des Legacy-Zugs", () => {
    it("🔴 angeschlossen sind alle Bereiche, seit der Scheibe Gipfel auch die Gipfel (ihr Wiki-Stand), seit der Scheibe Literatur die Werke, seit der Scheibe Quellen die Katalogquellen, seit der Scheibe Vorkommen die Einträge, seit WI-0261 S3 die Sprachartikel, seit WI-0271 L7 die Landmarken-Artikel; jeder angeschlossene Bereich ist ein Bereich", () => {
        expect([...WIKISYNC_ANGESCHLOSSEN].sort()).toEqual([
            "gebiet",
            "gipfel",
            "kraftlinie",
            "literatur",
            "ort",
            "quelle",
            "region",
            "sprachen",
            "vorkommen",
            "weg",
        ]);
        for (const bereich of WIKISYNC_BEREICHE) expect(wikisyncAngeschlossen(bereich), bereich).toBe(true);
    });

    it("🔴 Die Rolle einer Ortszeile (Vali 2026-10-27, Knopfwahl „Ja, mit Rolle“): acht Wörter, das erste ist der Ort – nur er trifft", () => {
        expect([...WIKISYNC_ORTSROLLEN]).toEqual([
            "ort",
            "bezugspunkt",
            "ausgenommen",
            "teil",
            "landschaftsart",
            "volk",
            "frueher",
            "andere_welt",
        ]);
    });

    it("Kategorien aus der Datei haben die Bereiche, deren Werte erst eine Vorlage im Wiki setzt (Ortsgröße, Bauwerkart, Kontinent)", () => {
        expect([...WIKISYNC_MIT_KATEGORIEN].sort()).toEqual(["gebiet", "ort", "region"]);
        expect(wikisyncHatKategorien("kraftlinie")).toBe(false);
        expect(wikisyncHatKategorien("ort")).toBe(true);
    });

    it("🔴 Der Legacy-Zug fährt Orte, Wege und Landschaften je Kategorie; Gipfel fahren mit den Landschaften, Gebiete, Kraftlinien und Literatur in keiner", () => {
        expect(wikisyncBereicheDerKategorie("orte")).toEqual(["ort"]);
        expect(wikisyncBereicheDerKategorie("wege")).toEqual(["weg"]);
        expect(wikisyncBereicheDerKategorie("landschaften")).toEqual(["region", "gipfel"]);
        expect(wikisyncBereicheDerKategorie("herrschaftsgebiete")).toEqual([]);
        expect(WIKISYNC_ZUG_KATEGORIE.gebiet).toBeNull();
        expect(WIKISYNC_ZUG_KATEGORIE.kraftlinie).toBeNull();
        expect(WIKISYNC_ZUG_KATEGORIE.literatur).toBeNull();
        expect(WIKISYNC_ZUG_KATEGORIE.quelle).toBeNull();
        expect(WIKISYNC_ZUG_KATEGORIE.vorkommen).toBeNull();
        // Die Sprachen kennt der Legacy-Zug gar nicht (WI-0261 S3).
        expect(WIKISYNC_ZUG_KATEGORIE.sprachen).toBeNull();
        expect(wikisyncHatKategorien("sprachen")).toBe(false);
        // Jede Kategorie des Zugs gehört mindestens einem Bereich.
        for (const kategorie of LEGACY_ZUG_KATEGORIEN)
            expect(wikisyncBereicheDerKategorie(kategorie).length, kategorie).toBeGreaterThan(0);
    });
});

describe("Die Formen der Schreibrouten", () => {
    it("Vorschau: ohne Angabe alle Bereiche; eine Liste ohne Doppelte", () => {
        expect(Value.Check(WikisyncVorschauBody, { operationId: OPERATION })).toBe(true);
        expect(Value.Check(WikisyncVorschauBody, { operationId: OPERATION, bereiche: ["ort", "weg"] })).toBe(true);
        expect(Value.Check(WikisyncVorschauBody, { operationId: OPERATION, bereiche: ["sprachen"] })).toBe(true);
        expect(Value.Check(WikisyncVorschauBody, { operationId: OPERATION, bereiche: [] })).toBe(false);
        expect(Value.Check(WikisyncVorschauBody, { operationId: OPERATION, bereiche: ["ort", "ort"] })).toBe(false);
    });

    it("Übernehmen: Bereiche ODER alle (die Route prüft, dass genau eins da ist); der Lauf ist optional", () => {
        expect(
            Value.Check(WikisyncUebernehmenBody, { operationId: OPERATION, bereiche: ["kraftlinie"], lauf: 4 }),
        ).toBe(true);
        expect(Value.Check(WikisyncUebernehmenBody, { operationId: OPERATION, alle: true })).toBe(true);
        expect(Value.Check(WikisyncUebernehmenBody, { operationId: OPERATION, alle: false })).toBe(false);
        expect(
            Value.Check(WikisyncUebernehmenBody, { operationId: OPERATION, bereiche: ["kraftlinie"], lauf: 0 }),
        ).toBe(false);
    });

    it("Zurücknehmen: je Bereich und Lauf, ohne Bereich der ganze Lauf; der Lauf ist Pflicht", () => {
        expect(Value.Check(WikisyncZuruecknehmenBody, { operationId: OPERATION, lauf: 4, bereich: "kraftlinie" })).toBe(
            true,
        );
        expect(Value.Check(WikisyncZuruecknehmenBody, { operationId: OPERATION, lauf: 4 })).toBe(true);
        expect(Value.Check(WikisyncZuruecknehmenBody, { operationId: OPERATION, bereich: "kraftlinie" })).toBe(false);
        expect(Value.Check(WikisyncZuruecknehmenBody, { operationId: OPERATION, lauf: 4, bereich: "unbekannt" })).toBe(
            false,
        );
    });

    it("Artikel vergleichen: ein Titel in der erlaubten Länge; die verbotenen Zeichen stehen in der Prüfung", () => {
        expect(Value.Check(WikisyncArtikelBody, { operationId: OPERATION, titel: "Gareth" })).toBe(true);
        expect(Value.Check(WikisyncArtikelBody, { operationId: OPERATION, titel: "" })).toBe(false);
        expect(
            Value.Check(WikisyncArtikelBody, {
                operationId: OPERATION,
                titel: "x".repeat(WIKISYNC_ARTIKEL_TITEL_MAX + 1),
            }),
        ).toBe(false);
        for (const zeichen of ["|", "#", "<", ">", "[", "]", "{", "}"])
            expect(WIKISYNC_ARTIKEL_TITEL_VERBOTEN.test(`A${zeichen}B`), zeichen).toBe(true);
        expect(WIKISYNC_ARTIKEL_TITEL_VERBOTEN.test("Inoffiziell:Trutzbach/Zollhaus (Gasthaus)")).toBe(false);
    });
});
