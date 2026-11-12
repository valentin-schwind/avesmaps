import { pathReaderName } from "@avesmaps3d/shared";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { formatFindings, type Finding } from "../src/findings.ts";
import { MigrationAborted } from "../src/migration/places.ts";
import { importSubjectDetails, readCarriers, SUBJECT_DETAIL_TABLES } from "../src/migration/subject-details-import.ts";
import {
    corpusKeyOfUrl,
    hasWikitextResidue,
    parseLegacyStamp,
    textOf,
    transformSubjectDetails,
    type CarrierTargets,
} from "../src/migration/subject-details.ts";
import { computePathGroups, normalizeSearchText } from "../src/migration/path-groups.ts";
import { verifySubjectDetails } from "../src/migration/verify-subject-details.ts";
import type { MapFeaturesPayload } from "../src/migration/map-features.ts";
import { cleanP3Fixtures, insertP3Carriers, P3 } from "./support/p3-fixture.ts";

/**
 * Detailfelder und Wiki-Zuordnung der Subjects (WI-0063 P3, Migration 0065, Vertrag `subject-details.yaml`, D6): die reine
 * Umwandlung mit kleinen synthetischen Sätzen, dann Import, Stilllegen, Wiederaufnahme, Idempotenz, Schutz der Entscheide und
 * Prüfer gegen echtes PostgreSQL.
 */

type Bag = Record<string, unknown>;

const URL_BASE = "https://de.wiki-aventurica.de/wiki/";

function satz(features: Bag[], revision = 9001): MapFeaturesPayload {
    return { ok: true, revision, features: features.map((properties) => ({ properties })) };
}

function ort(publicId: string, name: string, extra: Bag = {}): Bag {
    return { feature_type: "location", public_id: publicId, name, ...extra };
}

function ortNest(key: string, extra: Bag = {}): Bag {
    return {
        title: key,
        name: key,
        wiki_key: key,
        wiki_url: `${URL_BASE}${key}`,
        description: `Beschreibung ${key}`,
        einwohner: "100",
        oberhaupt: "",
        region: "Region",
        staat: "Staat",
        lage: "Region · Staat",
        handelszone: "",
        verkehrswege: "",
        bevoelkerung: "",
        tempel: "",
        synced_at: "2026-06-06T21:01:40+00:00",
        ...extra,
    };
}

function weg(publicId: string, name: string, extra: Bag = {}): Bag {
    return {
        feature_type: "path",
        public_id: publicId,
        name,
        display_name: name,
        feature_subtype: "Strasse",
        ...extra,
    };
}

function wegNest(key: string, extra: Bag = {}): Bag {
    return {
        wiki_key: key,
        name: `Name ${key}`,
        kind: "strasse",
        art: "Straße",
        lage: "Lage",
        laenge: "",
        verlauf: "Verlauf",
        description: "Beschreibung",
        wiki_url: `${URL_BASE}${key}`,
        synced_at: "2026-08-17 07:57:14.387",
        source: "editor",
        ...extra,
    };
}

function beschriftung(publicId: string, name: string, extra: Bag = {}): Bag {
    return { feature_type: "label", public_id: publicId, name, text: name, feature_subtype: "wald", ...extra };
}

function regionNest(key: string, extra: Bag = {}): Bag {
    return {
        wiki_key: key,
        name: `Landschaft ${key}`,
        art: "Wald",
        continent: "Aventurien",
        region_parent: "Garetien",
        affiliation_staat: "",
        einwohner: "",
        sprache: "",
        vegetation: "",
        verkehrswege: "",
        description: "Ein Wald.",
        image_url: "",
        wiki_url: `${URL_BASE}${key}`,
        neighbors: { N: ["Nordland"], O: ["Ostland", "Ostmark"] },
        synonyms: ["Alter Name"],
        synced_at: "2026-08-14 21:54:33.494",
        ...extra,
    };
}

function targets(over: Partial<CarrierTargets> = {}): CarrierTargets {
    return {
        places: new Set([P3.ort, P3.ortZwei, P3.ortLeer, P3.ortAdresse]),
        paths: new Set([P3.weg, P3.wegZwei, P3.wegDrei]),
        powerlines: new Set([P3.kraftlinie, P3.kraftlinieZwei]),
        labels: new Map([
            [P3.beschriftung, true],
            [P3.beschriftungZwei, true],
        ]),
        peaks: new Map([
            [P3.gipfel, true],
            [P3.gipfelInaktiv, false],
        ]),
        ...over,
    };
}

const finding = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((entry) => entry.code === code);

describe("D6: kleine Leser", () => {
    it("textOf: unverändert, aber leer oder nur Leerraum ist nichts", () => {
        expect(textOf("  Text  ")).toBe("  Text  ");
        expect(textOf("")).toBeNull();
        expect(textOf("   ")).toBeNull();
        expect(textOf(5)).toBeNull();
        expect(textOf(null)).toBeNull();
    });

    it("parseLegacyStamp: mit Zone wie geliefert, ohne Zone als UTC, Unlesbares ist nichts", () => {
        expect(parseLegacyStamp("2026-06-06T21:01:40+00:00")).toBe("2026-06-06T21:01:40.000Z");
        expect(parseLegacyStamp("2026-06-06T23:01:40+02:00")).toBe("2026-06-06T21:01:40.000Z");
        expect(parseLegacyStamp("2026-08-17 07:57:14.387")).toBe("2026-08-17T07:57:14.387Z");
        expect(parseLegacyStamp("kein Datum")).toBeNull();
        expect(parseLegacyStamp("")).toBeNull();
        expect(parseLegacyStamp(undefined)).toBeNull();
    });

    it("hasWikitextResidue findet Reste von Wikimarkup, sonst nichts", () => {
        expect(hasWikitextResidue("Text mit [[Link]]")).toBe(true);
        expect(hasWikitextResidue("{{Vorlage}}")).toBe(true);
        expect(hasWikitextResidue("a&nbsp;b")).toBe(true);
        expect(hasWikitextResidue("<ref>x</ref>")).toBe(true);
        expect(hasWikitextResidue("glatter Text")).toBe(false);
        expect(hasWikitextResidue(null)).toBe(false);
    });

    it("corpusKeyOfUrl: die registrierbare Domain (Legacy avesmapsSourceCorpusKey)", () => {
        expect(corpusKeyOfUrl("https://de.wiki-aventurica.de/wiki/Gareth")).toBe("wiki-aventurica.de");
        expect(corpusKeyOfUrl("https://www.herzogtum-weiden.net/politik")).toBe("herzogtum-weiden.net");
        expect(corpusKeyOfUrl("herzogtum-weiden.net/seite")).toBe("herzogtum-weiden.net");
        expect(corpusKeyOfUrl("https://wiki.example.co.uk/x")).toBe("example.co.uk");
        expect(corpusKeyOfUrl("http://127.0.0.1/x")).toBe("");
        expect(corpusKeyOfUrl("localhost")).toBe("");
        expect(corpusKeyOfUrl("")).toBe("");
    });
});

describe("D6: reine Umwandlung", () => {
    it("🔴 ein Nest mit Schlüssel ist zugewiesen, nur eine Adresse ist address_only, nichts ist nichts", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", { wiki_url: `${URL_BASE}p3t-ort`, wiki_settlement: ortNest("p3t-ort") }),
                ort(P3.ortAdresse, "Ort Adresse", { wiki_url: `${URL_BASE}Handgetippt` }),
                ort(P3.ortLeer, "Ort Leer"),
            ]),
            targets(),
        );
        expect(transformed.placeAssignments).toEqual([
            {
                publicId: P3.ort,
                name: "Ort Eins",
                wikiUrl: `${URL_BASE}p3t-ort`,
                state: "assigned",
                origin: "unknown",
                snapshotKey: "p3t-ort",
            },
            {
                publicId: P3.ortAdresse,
                name: "Ort Adresse",
                wikiUrl: `${URL_BASE}Handgetippt`,
                state: "address_only",
                origin: "unknown",
                snapshotKey: null,
            },
        ]);
        expect(transformed.settlementSnapshots.map((row) => row.wikiKey)).toEqual(["p3t-ort"]);
        expect(finding(transformed.findings, "wiki_address_only")?.numbers).toEqual({
            place: 1,
            path: 0,
            powerline: 0,
        });
        // 🔴 Der Zustand getrennt oder unterdrückt ist kein Datum des Exports und wird nie erzeugt.
        const states = new Set(transformed.placeAssignments.map((row) => row.state));
        expect([...states].sort()).toEqual(["address_only", "assigned"]);
    });

    it("der Schnappschuss trägt den Text des Nests, aber keine Lage (abgeleitet) und leere Felder als NULL", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", {
                    wiki_url: `${URL_BASE}p3t-ort`,
                    wiki_settlement: ortNest("p3t-ort", {
                        building_type: "tempel",
                        is_ruined: true,
                        verkehrswege_links: { "Reichsstraße 2": "Reichsstraße 2", Garether: "Gardel" },
                    }),
                }),
            ]),
            targets(),
        );
        const row = transformed.settlementSnapshots[0];
        expect(row).toMatchObject({
            wikiKey: "p3t-ort",
            description: "Beschreibung p3t-ort",
            einwohner: "100",
            oberhaupt: null,
            regionText: "Region",
            staatText: "Staat",
            buildingType: "tempel",
            isRuined: true,
            syncedAt: "2026-06-06T21:01:40.000Z",
        });
        expect(row).not.toHaveProperty("lage");
        expect(row?.trafficLinks).toEqual([
            { position: 0, linkText: "Reichsstraße 2", pathName: "Reichsstraße 2" },
            { position: 1, linkText: "Garether", pathName: "Gardel" },
        ]);
    });

    it("🔴 die Ortsklasse des Nests kommt wörtlich mit, samt Kennzeichen „geraten“; ohne Kennzeichen NULL (WI-0225, 0184)", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", {
                    wiki_url: `${URL_BASE}p3t-ort`,
                    wiki_settlement: ortNest("p3t-ort", { settlement_class: "stadt", settlement_class_guessed: false }),
                }),
                ort(P3.ortAdresse, "Ort Zwei", {
                    wiki_url: `${URL_BASE}p3t-zwei`,
                    wiki_settlement: ortNest("p3t-zwei", { settlement_class: "dorf" }),
                }),
            ]),
            targets(),
        );
        const zeile = (key: string) => transformed.settlementSnapshots.find((row) => row.wikiKey === key);
        expect(zeile("p3t-ort")).toMatchObject({ settlementClass: "stadt", settlementClassGuessed: false });
        expect(zeile("p3t-zwei")).toMatchObject({ settlementClass: "dorf", settlementClassGuessed: null });
    });

    it("gleicher Schlüssel an zwei Orten: ein Schnappschuss, der jüngste Stempel gewinnt, auch über zwei Zeitformate", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", {
                    wiki_url: `${URL_BASE}p3t-geteilt`,
                    wiki_settlement: ortNest("p3t-geteilt", {
                        description: "alt",
                        synced_at: "2026-06-06T21:01:40+00:00",
                    }),
                }),
                ort(P3.ortZwei, "Ort Zwei", {
                    wiki_url: `${URL_BASE}p3t-geteilt`,
                    wiki_settlement: ortNest("p3t-geteilt", {
                        description: "neu",
                        synced_at: "2026-08-01T10:00:00+02:00",
                    }),
                }),
            ]),
            targets(),
        );
        expect(transformed.settlementSnapshots).toHaveLength(1);
        expect(transformed.settlementSnapshots[0]).toMatchObject({
            description: "neu",
            syncedAt: "2026-08-01T08:00:00.000Z",
        });
        expect(transformed.placeAssignments.map((row) => row.snapshotKey)).toEqual(["p3t-geteilt", "p3t-geteilt"]);
        expect(finding(transformed.findings, "wiki_key_shared")).toBeDefined();
        expect(finding(transformed.findings, "snapshot_stamp_divergent")?.numbers).toMatchObject({
            ortNester: 1,
            ortSchluessel: 1,
        });
    });

    it("redaktionelle Felder: eine Zeile nur bei einem gefüllten Feld, Herkunft nur aus wiki oder manual", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", {
                    einwohner: "200",
                    lage: "am Fluss",
                    field_origins: { einwohner: "manual", lage: "wiki", oberhaupt: "wiki" },
                }),
                ort(P3.ortZwei, "Ort Zwei", {
                    description: "Handtext",
                    oberhaupt: "Graf",
                    field_origins: { oberhaupt: "irgendwas" },
                }),
                ort(P3.ortLeer, "Ort Leer", { description: "  ", einwohner: "", field_origins: { einwohner: "wiki" } }),
            ]),
            targets(),
        );
        expect(transformed.placeDetails.map((row) => row.placePublicId)).toEqual([P3.ort, P3.ortZwei]);
        expect(transformed.placeDetails[0]).toMatchObject({
            einwohner: "200",
            einwohnerOrigin: "manual",
            lage: "am Fluss",
            lageOrigin: "wiki",
            oberhaupt: null,
            oberhauptOrigin: null,
            description: null,
        });
        // Ein unbekannter Wert ist nie wiki: NULL und ein Befund.
        expect(transformed.placeDetails[1]).toMatchObject({
            description: "Handtext",
            oberhaupt: "Graf",
            oberhauptOrigin: null,
        });
        expect(finding(transformed.findings, "field_origin_unknown_value")?.objectCount).toBe(1);
    });

    it("direkter Wert gegen Nestwert: Widerspruch und verborgene Felder werden gemeldet, nichts wird gewählt", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(P3.ort, "Ort Eins", {
                    wiki_url: `${URL_BASE}p3t-ort`,
                    wiki_settlement: ortNest("p3t-ort", { einwohner: "100" }),
                    einwohner: "250",
                    description: "Beschreibung p3t-ort",
                }),
                ort(P3.ortZwei, "Ort Zwei", { einwohner: "50", lage: "irgendwo", description: "ohne Nest" }),
            ]),
            targets(),
        );
        expect(finding(transformed.findings, "direct_overrides_wiki")?.numbers).toEqual({
            description: 0,
            einwohner: 1,
            lage: 0,
            oberhaupt: 0,
        });
        expect(finding(transformed.findings, "direct_only_hidden_in_legacy")?.numbers).toEqual({
            einwohner: 1,
            lage: 1,
            oberhaupt: 0,
        });
        // Beide Werte bleiben getrennt erhalten.
        expect(transformed.settlementSnapshots[0]?.einwohner).toBe("100");
        expect(transformed.placeDetails.find((row) => row.placePublicId === P3.ort)?.einwohner).toBe("250");
    });

    it("zu langer Text ist ein Befund, kein Abbruch, und bleibt unverändert", () => {
        const lang = "x".repeat(1201);
        const transformed = transformSubjectDetails(satz([ort(P3.ort, "Ort Eins", { description: lang })]), targets());
        expect(transformed.placeDetails[0]?.description).toBe(lang);
        expect(finding(transformed.findings, "text_exceeds_legacy_limit")?.numbers).toMatchObject({ description: 1 });
    });

    it("Träger ohne aktive Zeile in Avesmaps3D: keine Zuordnung, ein Befund", () => {
        const transformed = transformSubjectDetails(
            satz([
                ort(p3Missing(), "Fehlender Ort", { wiki_url: `${URL_BASE}x`, wiki_settlement: ortNest("p3t-fehlt") }),
            ]),
            targets(),
        );
        expect(transformed.placeAssignments).toEqual([]);
        expect(transformed.settlementSnapshots).toEqual([]);
        expect(finding(transformed.findings, "carrier_missing")?.objectCount).toBe(1);
    });

    it("Wege: Hauptzuweisung mit Herkunft, bloße Adresse, weitere nur mit Hauptzuweisung, schlanker Schnappschuss", () => {
        const further = (key: string): Bag => ({
            wiki_key: key,
            name: `Name ${key}`,
            wiki_url: `${URL_BASE}${key}`,
            art: "Pfad",
            kind: "strasse",
        });
        const transformed = transformSubjectDetails(
            satz([
                weg(P3.weg, "Weg Eins", {
                    wiki_url: `${URL_BASE}p3t-hauptweg`,
                    wiki_path: wegNest("p3t-hauptweg"),
                    wiki_path_weitere: [further("p3t-nebenweg"), further("p3t-hauptweg"), further("p3t-nebenweg")],
                }),
                weg(P3.wegZwei, "Weg Zwei", {
                    wiki_url: `${URL_BASE}Handgetippt`,
                    wiki_path_weitere: [further("p3t-nebenweg")],
                }),
                weg(P3.wegDrei, "Strasse-77", { wiki_path_weitere: [further("p3t-ohne-haupt")] }),
            ]),
            targets(),
        );
        expect(
            transformed.pathAssignments.map(
                (row) => `${row.publicId.slice(-2)} ${row.role} ${row.state} ${String(row.snapshotKey)} ${row.origin}`,
            ),
        ).toEqual([
            "0a main assigned p3t-hauptweg legacy_editor",
            "0a further assigned p3t-nebenweg unknown",
            "0b main address_only null unknown",
            "0b further assigned p3t-nebenweg unknown",
        ]);
        // Eine weitere Zuweisung ohne Hauptzuweisung wird nicht angelegt, und eine Wiederholung nur einmal.
        expect(finding(transformed.findings, "path_further_without_main")?.objectCount).toBe(1);
        expect(finding(transformed.findings, "path_further_duplicate")?.objectCount).toBe(2);
        const snapshots = transformed.pathSnapshots.map((row) => `${row.wikiKey} ${row.isLean ? "schlank" : "voll"}`);
        expect(snapshots).toEqual(["p3t-hauptweg voll", "p3t-nebenweg schlank"]);
        expect(transformed.pathSnapshots[0]).toMatchObject({
            syncedAt: "2026-08-17T07:57:14.387Z",
            name: "Name p3t-hauptweg",
            kind: "strasse",
        });
        expect(transformed.pathSnapshots[1]).toMatchObject({
            lage: null,
            verlauf: null,
            description: null,
            syncedAt: null,
            name: "Name p3t-nebenweg",
        });
    });

    it("Herkunft einer Wegzuordnung: editor und verlauf-sync sind Legacys, alles andere ist unbekannt", () => {
        const transformed = transformSubjectDetails(
            satz([
                weg(P3.weg, "Weg Eins", {
                    wiki_url: `${URL_BASE}p3t-a`,
                    wiki_path: wegNest("p3t-a", { source: "verlauf-sync" }),
                }),
                weg(P3.wegZwei, "Weg Zwei", {
                    wiki_url: `${URL_BASE}p3t-b`,
                    wiki_path: wegNest("p3t-b", { source: "etwas anderes" }),
                }),
            ]),
            targets(),
        );
        expect(transformed.pathAssignments.map((row) => row.origin)).toEqual(["legacy_verlauf_sync", "unknown"]);
    });

    it("Kraftlinien: das Nest trägt keinen Stempel, eine bloße Adresse ist address_only", () => {
        const nest = (key: string): Bag => ({
            wiki_key: key,
            wiki_url: `${URL_BASE}${key}`,
            name: "Linie",
            staerke: "",
            affinitaet: "Magie",
            laenge: "",
            regionen: "",
            verlauf: "A → B",
            description: "Text",
        });
        const transformed = transformSubjectDetails(
            satz([
                {
                    feature_type: "powerline",
                    public_id: P3.kraftlinie,
                    name: "Linie",
                    wiki_url: `${URL_BASE}p3t-linie`,
                    wiki_powerline: nest("p3t-linie"),
                },
                {
                    feature_type: "powerline",
                    public_id: P3.kraftlinieZwei,
                    name: "Linie Zwei",
                    wiki_url: `${URL_BASE}Handgetippt`,
                },
            ]),
            targets(),
        );
        expect(transformed.powerlineSnapshots).toHaveLength(1);
        expect(transformed.powerlineSnapshots[0]).toMatchObject({
            wikiKey: "p3t-linie",
            syncedAt: null,
            staerke: null,
            affinitaet: "Magie",
        });
        expect(transformed.powerlineAssignments.map((row) => row.state)).toEqual(["assigned", "address_only"]);
    });

    it("🔴 Landschaften: gebundene Beschriftung liefert den Schnappschuss ohne eigene Zuordnung, Gipfel bekommt sie, ohne Ziel nur ein Befund", () => {
        const transformed = transformSubjectDetails(
            satz([
                beschriftung(P3.beschriftung, "Wald Eins", {
                    ecosystem_region_public_id: P3.region,
                    wiki_url: `${URL_BASE}p3t-wald`,
                    wiki_region: regionNest("p3t-wald"),
                }),
                beschriftung(P3.gipfelInaktiv, "Gipfel inaktiv", {
                    wiki_url: `${URL_BASE}p3t-gipfel-alt`,
                    wiki_region: regionNest("p3t-gipfel-alt"),
                }),
                beschriftung(P3.gipfel, "Gipfel", {
                    wiki_url: `${URL_BASE}p3t-gipfel`,
                    wiki_region: regionNest("p3t-gipfel", {
                        art: "Berggipfel|Vulkan",
                        synonyms: ["[[Rest]]"],
                        image_url: "https://x.example/b.png",
                    }),
                }),
                beschriftung(p3Missing(), "Frei ohne Zeile", {
                    wiki_url: `${URL_BASE}p3t-frei`,
                    wiki_region: regionNest("p3t-frei"),
                }),
                beschriftung(p3Missing(2), "Frei ohne Zeile und ohne Nest"),
            ]),
            targets(),
        );
        expect(transformed.regionSnapshots.map((row) => row.wikiKey)).toEqual(["p3t-gipfel", "p3t-wald"]);
        expect(transformed.boundLabelNests).toEqual([
            { publicId: P3.beschriftung, wikiKey: "p3t-wald", name: "Wald Eins" },
        ]);
        expect(transformed.peakAssignments).toEqual([
            {
                publicId: P3.gipfel,
                name: "Gipfel",
                wikiUrl: `${URL_BASE}p3t-gipfel`,
                state: "assigned",
                origin: "unknown",
                snapshotKey: "p3t-gipfel",
            },
        ]);
        // Inaktiver Gipfel und Beschriftung ohne Zeile: kein aktives Ziel.
        expect(finding(transformed.findings, "orphan_nest")?.numbers).toEqual({ nester: 2, schluesselOhneZiel: 2 });
        expect(finding(transformed.findings, "place_link_target_missing")?.objectCount).toBe(2);
        expect(finding(transformed.findings, "image_unlicensed_not_imported")?.objectCount).toBe(1);
        expect(finding(transformed.findings, "art_multivalue")?.numbers).toEqual({ schnappschuesse: 1 });
        expect(finding(transformed.findings, "wikitext_residue")?.numbers).toMatchObject({ synonymlisten: 1 });
    });

    it("Nachbarn und Synonyme werden Zeilen mit der Position der Quelle; ein leerer Eintrag oder eine fremde Richtung ist ein Befund", () => {
        const transformed = transformSubjectDetails(
            satz([
                beschriftung(P3.beschriftung, "Wald Eins", {
                    wiki_url: `${URL_BASE}p3t-wald`,
                    wiki_region: regionNest("p3t-wald", {
                        neighbors: { N: ["Nordland"], SO: ["", "Südost"], X: ["Unbekannt"] },
                        synonyms: ["Eins", " ", "Drei"],
                    }),
                }),
            ]),
            targets(),
        );
        const row = transformed.regionSnapshots[0];
        expect(row?.neighbors).toEqual([
            { direction: "N", position: 0, name: "Nordland" },
            { direction: "SO", position: 1, name: "Südost" },
        ]);
        expect(row?.synonyms).toEqual([
            { position: 0, text: "Eins" },
            { position: 2, text: "Drei" },
        ]);
        expect(finding(transformed.findings, "source_entry_unusable")?.numbers).toEqual({ eintraege: 3 });
    });

    it("ein Nest nur mit Schlüssel und Adresse ist ein Schnappschuss mit NULL-Texten und ein Befund", () => {
        const transformed = transformSubjectDetails(
            satz([
                beschriftung(P3.beschriftung, "Buli", {
                    ecosystem_region_public_id: P3.region,
                    wiki_url: `${URL_BASE}p3t-buli`,
                    wiki_region: { wiki_key: "p3t-buli", wiki_url: `${URL_BASE}p3t-buli` },
                }),
            ]),
            targets(),
        );
        expect(transformed.regionSnapshots[0]).toMatchObject({
            wikiKey: "p3t-buli",
            name: null,
            description: null,
            neighbors: [],
            synonyms: [],
        });
        expect(finding(transformed.findings, "snapshot_incomplete")?.objectCount).toBe(1);
    });

    it("🔴 A13: eine Antwort, die nicht ok meldet, hält an, bevor etwas gerechnet ist", () => {
        expect(() =>
            transformSubjectDetails({ ok: false, revision: 1, features: [{ properties: {} }] }, targets()),
        ).toThrow(MigrationAborted);
        expect(() => transformSubjectDetails({ ok: true, revision: 1, features: [] }, targets())).toThrow(
            MigrationAborted,
        );
    });
});

/** Eine UUID, die es nirgends gibt. */
function p3Missing(n = 1): string {
    return `63ffffff-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

describe("Wegegruppen (Rechenvorschrift des Vertrags)", () => {
    // Die Regel selbst steht seit WI-0105 in `packages/shared/src/path-names.ts` und ist dort gesichert
    // (`pathReaderName`); hier bleibt nur, was der Vertrag der Wegegruppen daraus baut.
    it("echter Name: weder die nackte Wegart noch <Wegart>-<n> noch <wort>-<zahl>", () => {
        expect(pathReaderName("Reichsstraße 2", "Reichsstrasse")).toBe("Reichsstraße 2");
        expect(pathReaderName("Strasse-77", "Strasse")).toBeNull();
        expect(pathReaderName("Meer-835", "Seeweg")).toBeNull();
        // Ein Pfad namens „Weg“ ist gegen SEINE Wegart ein Name.
        expect(pathReaderName("Weg", "Pfad")).toBe("Weg");
    });

    it("normalizeSearchText: klein, ohne Akzente, ß als ss, Sonderzeichen werden Leerzeichen", () => {
        expect(normalizeSearchText("Reichsstraße 2")).toBe("reichsstrasse 2");
        expect(normalizeSearchText("  Wüstenpfad (alt) ")).toBe("wustenpfad alt");
    });

    it("Wiki-Gruppen über den Hauptschlüssel und jede weitere, Namensgruppen nur ohne Hauptzuweisung, nichts ohne Namen und Zuordnung", () => {
        const input = (
            publicId: string,
            name: string,
            subtype: string,
            mainKey: string | null,
            further: string[] = [],
        ) => ({
            publicId,
            name,
            subtype,
            mainKey,
            further: further.map((key) => ({ key, name: `Name ${key}` })),
            wikiName: mainKey ? `Wiki ${mainKey}` : null,
        });
        const result = computePathGroups([
            input("a", "Reichsstraße 2", "Reichsstrasse", "reichsstrasse-2", ["baerenpfad"]),
            input("b", "Reichsstraße 2", "Reichsstrasse", "reichsstrasse-2"),
            input("c", "Waldstraße", "Strasse", null),
            input("d", "Waldstraße", "Strasse", null),
            input("e", "Waldstraße", "Pfad", null),
            // Ein Seeweg gleichen Namens bleibt für sich: Besucher sehen keine Seewege.
            input("s", "Waldstraße", "Seeweg", null),
            input("f", "Strasse-9", "Strasse", null),
            input("g", "Strasse-10", "Strasse", "gar-nicht-sein-name"),
        ]);
        expect(result.wikiGroups).toBe(3);
        // „Waldstraße“ ist EIN Weg über Strasse und Pfad (WI-0177 Schritt 2b, Legacys Regel (c)); der Seeweg ist eine eigene Gruppe.
        expect(result.nameGroups).toBe(2);
        expect(
            result.groups.filter((group) => group.kind === "name").map((group) => [group.key, group.members]),
        ).toEqual([
            ["waldstrasse", ["c", "d", "e"]],
            ["seeweg:waldstrasse", ["s"]],
        ]);
        expect(result.segmentsWithoutGroup).toBe(1);
        expect(result.titlesInSeveralGroups).toBe(1);
        const wiki = result.groups.find((group) => group.kind === "wiki" && group.key === "reichsstrasse-2");
        expect(wiki?.members).toEqual(["a", "b"]);
        expect(result.groups.find((group) => group.key === "baerenpfad")?.members).toEqual(["a"]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------
// Gegen PostgreSQL
// ---------------------------------------------------------------------------------------------------------------------

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("D6 gegen PostgreSQL (Migration 0065)", () => {
    let database: Database;

    /** Der Satz, den die Fälle unten verändern. */
    function volleSatz(over: { nestOrt?: Bag | null; ortFelder?: Bag; synonyms?: string[] } = {}): MapFeaturesPayload {
        const nestOrt = over.nestOrt === undefined ? ortNest("p3t-ort") : over.nestOrt;
        return satz([
            ort(P3.ort, "P3T Ort Eins", {
                wiki_url: `${URL_BASE}p3t-ort`,
                ...(nestOrt
                    ? { wiki_settlement: { ...nestOrt, verkehrswege_links: { "Reichsstraße 2": "Reichsstraße 2" } } }
                    : {}),
                einwohner: "250",
                field_origins: { einwohner: "manual" },
                ...over.ortFelder,
            }),
            ort(P3.ortZwei, "P3T Ort Zwei", { wiki_url: `${URL_BASE}p3t-ort`, wiki_settlement: ortNest("p3t-ort") }),
            ort(P3.ortAdresse, "P3T Ort Adresse", { wiki_url: `${URL_BASE}Handgetippt` }),
            ort(P3.ortLeer, "P3T Ort Leer"),
            weg(P3.weg, "P3T Weg Eins", {
                wiki_url: `${URL_BASE}p3t-hauptweg`,
                wiki_path: wegNest("p3t-hauptweg"),
                wiki_path_weitere: [
                    {
                        wiki_key: "p3t-nebenweg",
                        name: "Nebenweg",
                        wiki_url: `${URL_BASE}p3t-nebenweg`,
                        art: "Pfad",
                        kind: "strasse",
                    },
                ],
            }),
            weg(P3.wegZwei, "P3T Weg Zwei", { wiki_url: `${URL_BASE}Handgetippt` }),
            {
                feature_type: "powerline",
                public_id: P3.kraftlinie,
                name: "P3T Kraftlinie Eins",
                wiki_url: `${URL_BASE}p3t-linie`,
                wiki_powerline: {
                    wiki_key: "p3t-linie",
                    wiki_url: `${URL_BASE}p3t-linie`,
                    name: "Linie",
                    staerke: "",
                    affinitaet: "Magie",
                    laenge: "",
                    regionen: "",
                    verlauf: "",
                    description: "Text",
                },
            },
            beschriftung(P3.beschriftung, "P3T Wald Eins", {
                ecosystem_region_public_id: P3.region,
                wiki_url: `${URL_BASE}p3t-region`,
                wiki_region: regionNest("p3t-region", { synonyms: over.synonyms ?? ["Alter Name"] }),
            }),
            beschriftung(P3.gipfel, "P3T Gipfel", {
                wiki_url: `${URL_BASE}p3t-gipfel`,
                wiki_region: regionNest("p3t-gipfel"),
            }),
        ]);
    }

    const count = async (table: string, where = "TRUE"): Promise<number> => {
        const [row] = await database.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`);
        return row?.n ?? 0;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanP3Fixtures(database);
        await insertP3Carriers(database);
    }, 120_000);

    afterAll(async () => {
        await cleanP3Fixtures(database);
        await database.end({ timeout: 5 });
    });

    it("🔴 der Erstimport legt alles an, bis auf die Kraftlinien (sie gehören dem WikiSync, Befund bereich_wikisync)", async () => {
        const report = await importSubjectDetails(database, volleSatz());
        const created = (table: (typeof SUBJECT_DETAIL_TABLES)[number]): number => report.tables[table].created;
        expect(created("wiki_settlement_snapshot")).toBe(1);
        expect(created("wiki_settlement_traffic_link")).toBe(1);
        expect(created("wiki_path_snapshot")).toBe(2);
        expect(created("wiki_region_snapshot")).toBe(2);
        expect(created("wiki_region_snapshot_neighbor")).toBe(6);
        expect(created("wiki_region_snapshot_synonym")).toBe(2);
        // Die Kraftlinien gehören dem WikiSync: der Zug lässt ihren Wiki-Stand und ihre Zuordnung aus und sagt es.
        expect(created("wiki_powerline_snapshot")).toBe(0);
        expect(created("place_wiki_assignment")).toBe(3);
        expect(created("path_wiki_assignment")).toBe(3);
        expect(created("terrain_peak_wiki_assignment")).toBe(1);
        expect(created("powerline_wiki_assignment")).toBe(0);
        expect(finding(report.findings, "bereich_wikisync")).toBeDefined();
        expect(created("place_detail")).toBe(1);
        expect(report.changed).toBe(true);
        expect(
            finding(report.findings, "wiki_text_license_unrecorded"),
            "die Entscheidung des Betreibers trägt die Korpuszeile",
        ).toBeUndefined();

        const [snapshot] = await database<{ wiki_key: string; synced_at: Date }[]>`
            SELECT wiki_key, synced_at FROM wiki_settlement_snapshot WHERE wiki_key = 'p3t-ort'
        `;
        expect(snapshot?.synced_at.toISOString()).toBe("2026-06-06T21:01:40.000Z");
    });

    // Die Kraftlinien gehören dem WikiSync: der Prüfer erwartet ihren Wiki-Stand und ihre Zuordnung nicht, wie der Zug sie auslässt.
    it("🔴 der Prüfer findet Parität zwischen Antwort und Bestand, ohne die Kraftlinien des WikiSync", async () => {
        const parity = await verifySubjectDetails(database, volleSatz());
        const failed = parity.checks.filter((entry) => !entry.passed);
        expect(failed.map((entry) => `${entry.name}: ${entry.detail}`)).toEqual([]);
        expect(parity.passed).toBe(true);
        // Die Wegegruppen werden aus der Datenbank gerechnet.
        expect(parity.checks.find((entry) => entry.name === "path_groups")?.detail).toContain("Gruppen");
        expect(parity.checks.find((entry) => entry.name === "structure")?.passed).toBe(true);
    });

    it("🔴 ein zweiter Lauf mit demselben Satz ändert nichts (created 0, updated 0, retired 0)", async () => {
        const again = await importSubjectDetails(database, volleSatz());
        for (const table of SUBJECT_DETAIL_TABLES) {
            expect({ table, ...again.tables[table], unchanged: undefined }).toEqual({
                table,
                created: 0,
                updated: 0,
                unchanged: undefined,
                retired: 0,
                protectedRows: 0,
                reappeared: 0,
            });
        }
        expect(again.tables.wiki_settlement_snapshot.unchanged).toBe(1);
        expect(again.tables.place_wiki_assignment.unchanged).toBe(3);
        expect(again.changed).toBe(false);
    });

    it("🔴 Probelauf: rechnet alles, zählt, schreibt und journalisiert nichts", async () => {
        const before = await count("wiki_settlement_snapshot", "wiki_key LIKE 'p3t-%'");
        const runsBefore = await count("migration_run", "data_domain = 'subject-details'");
        const report = await importSubjectDetails(
            database,
            volleSatz({ nestOrt: ortNest("p3t-ort", { description: "Probe" }) }),
            { dryRun: true },
        );
        expect(report.dryRun).toBe(true);
        expect(report.tables.wiki_settlement_snapshot.updated).toBe(1);
        expect(await count("wiki_settlement_snapshot", "wiki_key LIKE 'p3t-%'")).toBe(before);
        const [row] = await database<
            { description: string }[]
        >`SELECT description FROM wiki_settlement_snapshot WHERE wiki_key = 'p3t-ort'`;
        expect(row?.description).toBe("Beschreibung p3t-ort");
        expect(await count("migration_run", "data_domain = 'subject-details'")).toBe(runsBefore);
    });

    it("eine Änderung im Nest aktualisiert den Schnappschuss und ersetzt seine Kindzeilen, ohne sie anzuhäufen", async () => {
        const changed = await importSubjectDetails(
            database,
            volleSatz({
                nestOrt: ortNest("p3t-ort", { description: "Neue Beschreibung" }),
                synonyms: ["Eins", "Zwei"],
            }),
        );
        expect(changed.tables.wiki_settlement_snapshot).toMatchObject({ created: 0, updated: 1, retired: 0 });
        // Das Synonym-Set eines Schnappschusses wird ersetzt: 1 alte Zeile weg, 2 neue.
        expect(changed.tables.wiki_region_snapshot_synonym).toMatchObject({ created: 2, retired: 1 });
        expect(
            await count(
                "wiki_region_snapshot_synonym",
                "snapshot_id IN (SELECT id FROM wiki_region_snapshot WHERE wiki_key = 'p3t-region')",
            ),
        ).toBe(2);
        const [row] = await database<
            { description: string }[]
        >`SELECT description FROM wiki_settlement_snapshot WHERE wiki_key = 'p3t-ort'`;
        expect(row?.description).toBe("Neue Beschreibung");
    });

    it("🔴 Fehlt ein Nest, wird die Zuordnung stillgelegt (nie gelöscht); kommt es zurück, wird sie wieder aktiv mit Befund", async () => {
        // Beide Orte tragen denselben Schlüssel; nimmt man das Nest nur dem ersten, bleibt der Schnappschuss.
        const retired = await importSubjectDetails(
            database,
            volleSatz({ nestOrt: null, ortFelder: { wiki_url: undefined } }),
        );
        expect(retired.tables.place_wiki_assignment).toMatchObject({ created: 0, updated: 0, retired: 1 });
        expect(retired.tables.wiki_settlement_snapshot.retired).toBe(0);
        const [row] = await database<
            { is_active: boolean; retired_origin: string | null; retired_at: Date | null; state: string }[]
        >`
            SELECT a.is_active, a.retired_origin, a.retired_at, a.assignment_state AS state
            FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id = ${P3.ort}
        `;
        expect(row).toMatchObject({ is_active: false, retired_origin: "import", state: "assigned" });
        expect(row?.retired_at).toBeInstanceOf(Date);
        // Das direkte Feld bleibt, die Zuordnung ist weg.
        expect(await count("place_detail", "is_active")).toBe(1);

        const back = await importSubjectDetails(database, volleSatz());
        expect(back.tables.place_wiki_assignment).toMatchObject({ created: 0, updated: 1, reappeared: 1 });
        expect(finding(back.findings, "assignment_reappeared")?.objectCount).toBe(1);
        const [again] = await database<
            { is_active: boolean; retired_at: Date | null; retired_origin: string | null }[]
        >`
            SELECT a.is_active, a.retired_at, a.retired_origin FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id = ${P3.ort}
        `;
        expect(again).toEqual({ is_active: true, retired_at: null, retired_origin: null });
    });

    it("🔴 ein Schnappschuss, den kein Träger mehr nennt, wird stillgelegt, nie gelöscht", async () => {
        const without = satz([ort(P3.ortAdresse, "P3T Ort Adresse", { wiki_url: `${URL_BASE}Handgetippt` })]);
        const report = await importSubjectDetails(database, without);
        expect(report.tables.wiki_settlement_snapshot.retired).toBe(1);
        const [snapshot] = await database<{ is_active: boolean; retired_origin: string | null }[]>`
            SELECT is_active, retired_origin FROM wiki_settlement_snapshot WHERE wiki_key = 'p3t-ort'
        `;
        expect(snapshot).toEqual({ is_active: false, retired_origin: "import" });
        // Die Stilllegequote meldet nur: mehr als 5 % der aktiven Zeilen, mit den betroffenen Objekten, ohne Abbruch.
        const quota = report.findings.filter((entry) => entry.code === "stilllegequote");
        expect(quota.length).toBeGreaterThan(0);
        expect(formatFindings(quota).join("\n")).toContain("der Lauf geht weiter");
        // Das direkte Feld der übrigen Orte ist weg: die Zeile ist stillgelegt und ihre Felder sind NULL (Legacy löscht den Schlüssel).
        const [detail] = await database<
            { is_active: boolean; einwohner: string | null; einwohner_origin: string | null }[]
        >`
            SELECT d.is_active, d.einwohner, d.einwohner_origin FROM place_detail d JOIN place p ON p.id = d.place_id WHERE p.public_id = ${P3.ort}
        `;
        expect(detail).toEqual({ is_active: false, einwohner: null, einwohner_origin: null });
        // Und wieder auf den vollen Satz: alles kommt zurück, derselbe Schnappschuss wird wieder aktiv.
        const back = await importSubjectDetails(database, volleSatz());
        expect(back.tables.wiki_settlement_snapshot).toMatchObject({ created: 0, updated: 1, reappeared: 1 });
        expect(await count("wiki_settlement_snapshot", "wiki_key = 'p3t-ort' AND is_active")).toBe(1);
    });

    it("🔴 manuell schlägt Wiki: getrennt, unterdrückt und eine Herkunft des Editors überschreibt kein Import", async () => {
        // Ein Editor trennt den Ort Eins bewusst und weist dem zweiten eine eigene Herkunft zu.
        await database`
            UPDATE place_wiki_assignment SET assignment_state = 'separated', assignment_origin = 'editor', snapshot_id = NULL, wiki_url = NULL
            WHERE place_id = (SELECT id FROM place WHERE public_id = ${P3.ort})
        `;
        await database`
            UPDATE place_wiki_assignment SET assignment_origin = 'editor'
            WHERE place_id = (SELECT id FROM place WHERE public_id = ${P3.ortZwei})
        `;
        const report = await importSubjectDetails(database, volleSatz());
        expect(report.tables.place_wiki_assignment).toMatchObject({
            created: 0,
            updated: 0,
            retired: 0,
            protectedRows: 2,
        });
        const decision = finding(report.findings, "wiki_assignment_vs_decision");
        expect(decision?.objectCount).toBe(2);
        const rows = await database<{ id: string; state: string; origin: string; url: string | null }[]>`
            SELECT p.public_id::text AS id, a.assignment_state AS state, a.assignment_origin AS origin, a.wiki_url AS url
            FROM place_wiki_assignment a JOIN place p ON p.id = a.place_id WHERE p.public_id IN (${P3.ort}, ${P3.ortZwei}) ORDER BY p.public_id
        `;
        expect(rows).toEqual([
            { id: P3.ort, state: "separated", origin: "editor", url: null },
            { id: P3.ortZwei, state: "assigned", origin: "editor", url: `${URL_BASE}p3t-ort` },
        ]);
        // Entfällt ihr Nest, legt der Import sie auch nicht still.
        const without = await importSubjectDetails(
            database,
            satz([ort(P3.ortAdresse, "P3T Ort Adresse", { wiki_url: `${URL_BASE}Handgetippt` })]),
        );
        expect(await count("place_wiki_assignment", "is_active AND assignment_state = 'separated'")).toBe(1);
        expect(
            without.tables.place_wiki_assignment.retired,
            "nur die Zeile ohne Schutz wird stillgelegt",
        ).toBeLessThanOrEqual(1);
        // Der Prüfer: von der Importquelle nur assigned und address_only, die Entscheide stehen daneben.
        await importSubjectDetails(database, volleSatz());
        const parity = await verifySubjectDetails(database, volleSatz());
        const states = parity.checks.find((entry) => entry.name === "states_written");
        expect(states?.passed).toBe(true);
        expect(states?.detail).toContain("1 Entscheide stehen");
        // Aufräumen für die Folgefälle: den Entscheid wieder aufheben.
        await database`
            UPDATE place_wiki_assignment SET assignment_state = 'address_only', wiki_url = ${`${URL_BASE}x`}, assignment_origin = 'unknown'
            WHERE place_id = (SELECT id FROM place WHERE public_id = ${P3.ort})
        `;
    });

    it("Schema: Zustand, Schnappschuss und Adresse gehören zusammen; eine Wegzuordnung hat höchstens eine Hauptzuweisung", async () => {
        const [placeRow] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${P3.ortLeer}`;
        const [pathRow] = await database<{ id: string }[]>`SELECT id::text FROM path WHERE public_id = ${P3.wegDrei}`;
        const [snapshot] = await database<
            { id: string }[]
        >`SELECT id::text FROM wiki_settlement_snapshot WHERE wiki_key = 'p3t-ort'`;
        const violation = async (work: Promise<unknown>): Promise<string> => {
            try {
                await work;
            } catch (error) {
                if (error instanceof postgres.PostgresError)
                    return `${error.code} ${error.constraint_name ?? ""}`.trim();
                throw error;
            }
            return "ging durch";
        };
        // assigned braucht einen Schnappschuss.
        expect(
            await violation(database`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, assignment_state)
                VALUES (${placeRow?.id as string}, 'https://x.example/', 'assigned')`),
        ).toBe("23514 place_wiki_assignment_snapshot_iff_assigned");
        // address_only trägt keinen.
        expect(
            await violation(database`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, assignment_state, snapshot_id)
                VALUES (${placeRow?.id as string}, 'https://x.example/', 'address_only', ${snapshot?.id as string})`),
        ).toBe("23514 place_wiki_assignment_snapshot_iff_assigned");
        // Zustand und Herkunft stehen im Wortschatz.
        expect(
            await violation(database`
                INSERT INTO place_wiki_assignment (place_id, wiki_url, assignment_state) VALUES (${placeRow?.id as string}, 'https://x.example/', 'geraten')`),
        ).toBe("23514 place_wiki_assignment_state_known");
        // Ein getrenntes Objekt trägt keine Adresse, aber assigned und address_only brauchen eine.
        expect(
            await violation(database`
                INSERT INTO place_wiki_assignment (place_id, assignment_state) VALUES (${placeRow?.id as string}, 'address_only')`),
        ).toBe("23514 place_wiki_assignment_url_when_stated");
        // Eine bloße Adresse ist nie eine weitere Zuweisung.
        expect(
            await violation(database`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state)
                VALUES (${pathRow?.id as string}, 'further', 'https://x.example/', 'address_only')`),
        ).toBe("23514 path_wiki_assignment_address_only_is_main");
        // Höchstens eine Hauptzuweisung je Segment.
        await database`INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state) VALUES (${pathRow?.id as string}, 'main', 'https://x.example/', 'address_only')`;
        expect(
            await violation(database`
                INSERT INTO path_wiki_assignment (path_id, role, wiki_url, assignment_state)
                VALUES (${pathRow?.id as string}, 'main', 'https://y.example/', 'address_only')`),
        ).toBe("23505 path_wiki_assignment_one_main_per_path");
        // Ein Feld ist NULL oder nicht leer; eine aktive Zeile trägt mindestens eines; Herkunft nur zu einem Feld.
        expect(
            await violation(
                database`INSERT INTO place_detail (place_id, description) VALUES (${placeRow?.id as string}, '')`,
            ),
        ).toBe("23514 place_detail_fields_not_blank");
        expect(await violation(database`INSERT INTO place_detail (place_id) VALUES (${placeRow?.id as string})`)).toBe(
            "23514 place_detail_active_has_a_field",
        );
        expect(
            await violation(
                database`INSERT INTO place_detail (place_id, einwohner_origin, lage) VALUES (${placeRow?.id as string}, 'wiki', 'x')`,
            ),
        ).toBe("23514 place_detail_origin_needs_field");
        // Stillgelegt heißt: Zeitpunkt und Ursprung gehören dazu.
        expect(
            await violation(database`
                UPDATE path_wiki_assignment SET is_active = FALSE WHERE path_id = ${pathRow?.id as string}`),
        ).toBe("23514 path_wiki_assignment_retired_consistent");
    });

    it("🔴 Struktur: keine entity_type-Spalte und kein JSON-Typ in den Tabellen von D6", async () => {
        const rows = await database<{ table_name: string; column_name: string; data_type: string }[]>`
            SELECT table_name, column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ANY(${[...SUBJECT_DETAIL_TABLES]}::text[])
              AND (column_name = 'entity_type' OR data_type IN ('json', 'jsonb'))
        `;
        expect(rows).toEqual([]);
        // Und jede der zwölf Tabellen gibt es.
        const present = await database<{ table_name: string }[]>`
            SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY(${[...SUBJECT_DETAIL_TABLES]}::text[])
        `;
        expect(present).toHaveLength(SUBJECT_DETAIL_TABLES.length);
    });

    it("readCarriers kennt die aktiven Träger und stillgelegte Gipfel getrennt", async () => {
        const { targets: read } = await readCarriers(database);
        expect(read.places.has(P3.ort)).toBe(true);
        expect(read.peaks.get(P3.gipfel)).toBe(true);
        expect(read.peaks.get(P3.gipfelInaktiv)).toBe(false);
        expect(read.labels.get(P3.beschriftung)).toBe(true);
    });
});
