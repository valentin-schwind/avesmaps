import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { legacyImportOffen } from "./support/legacy-import-offen.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { resolveTarget, type TargetIndex } from "../src/migration/catalog-places.ts";
import type { Finding } from "../src/findings.ts";
import {
    hasOrderedPlaceList,
    isLocalUpload,
    parseLiteratureOverlay,
    transformLiterature,
} from "../src/migration/literature.ts";
import { importLiterature } from "../src/migration/literature-import.ts";
import { verifyLiterature } from "../src/migration/verify-literature.ts";
import { C, cleanCatalogFixtures, fixtureIndex, insertCatalogCarriers, workId } from "./support/catalog-fixture.ts";

/**
 * Spielliteratur (WI-0063 P3, Migration 0068, Vertrag `literature.yaml`, D3): erst die reine Umwandlung und die Auflösung der Ortsbezüge
 * mit kleinen synthetischen Antworten in Legacys Form, dann Import, Stilllegen, Wiederaufnahme, Idempotenz, Auflösung gegen echte
 * Trägertabellen, die privaten Felder (E5/E5+) und der Prüfer gegen echtes PostgreSQL.
 */

type Bag = Record<string, unknown>;

const place = (sortOrder: number, rawName: string, over: Bag = {}): Bag => ({
    role: "play",
    target_kind: "unresolved",
    target_public_id: "",
    target_wiki_key: "",
    territory_path: [],
    raw_name: rawName,
    sort_order: sortOrder,
    ...over,
});

const work = (n: number, over: Bag = {}): Bag => ({
    public_id: workId(n),
    title: `P68T Werk ${String(n)}`,
    wiki_url: "",
    product_type: "gruppenabenteuer",
    edition: "DSA5",
    bf_year: null,
    bf_label: "",
    genre: "",
    complexity_gm: "",
    complexity_pl: "",
    is_official: true,
    fshop_code: "",
    cover_url: "",
    series: "",
    link_ulisses: "",
    link_fshop: "",
    isbn: "",
    contained_in: "",
    places: [],
    links: [],
    ...over,
});

const catalog = (items: Bag[], over: Bag = {}): Bag => ({
    ok: true,
    adventures: items,
    territory_meta: {},
    covers_enabled: true,
    adventures_enabled: true,
    ...over,
});

const codes = (findings: readonly Finding[]): string[] => findings.map((finding) => finding.code);
const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

describe("Auflösung der Ortsbezüge (D3 und D2)", () => {
    const index = fixtureIndex();
    const resolve = (
        kind: string | null,
        publicId: string | null,
        wikiKey: string | null,
        over?: Partial<TargetIndex>,
    ) => resolveTarget({ kind, publicId, wikiKey }, over ? fixtureIndex(over) : index);

    it("Legacy ohne Ziel bleibt unresolved, ohne Namensabgleich", () => {
        for (const kind of ["unresolved", "", null]) {
            expect(resolve(kind, C.ortA, "wiki:p68t-ort-a")).toMatchObject({
                state: "unresolved",
                target: null,
                resolvedBy: null,
                notes: ["place_unresolved"],
            });
        }
    });

    it("eine fremde Art ist unmatched und wird gemeldet", () => {
        for (const kind of ["lore", "powerline", "ecosystem"]) {
            expect(resolve(kind, C.ortA, null)).toMatchObject({ state: "unmatched", notes: ["place_kind_unknown"] });
        }
    });

    it("die Kennung löst auf eine aktive Zeile auf (aufgelöst mit public_id)", () => {
        expect(resolve("settlement", C.ortA, "")).toMatchObject({
            state: "resolved",
            resolvedBy: "public_id",
            target: { column: "place_id", id: "1" },
            notes: [],
        });
        expect(resolve("territory", C.gebietB, "")).toMatchObject({ target: { column: "territory_id", id: "11" } });
        expect(resolve("path", C.wegA2, "")).toMatchObject({ target: { column: "path_id", id: "41" } });
    });

    it("die Kennung einer Region ist die einer BESCHRIFTUNG: gebundene führt zur Region, ein Gipfel zu terrain_peak", () => {
        expect(resolve("region", C.beschriftungA, "")).toMatchObject({
            state: "resolved",
            target: { column: "region_id", id: "20" },
        });
        expect(resolve("region", C.gipfelA, "")).toMatchObject({ target: { column: "terrain_peak_id", id: "30" } });
        // Die public_id der Landschaft selbst trifft nie (0 von 1.530 in region.legacy_public_id).
        expect(resolve("region", C.regionA, "")).toMatchObject({ state: "unmatched", notes: ["place_unmatched"] });
    });

    it("eine inaktive Zeile ist kein Treffer: ohne Schlüssel unmatched, mit Schlüssel entscheidet der Schlüssel", () => {
        expect(resolve("settlement", C.ortInaktiv, "")).toMatchObject({
            state: "unmatched",
            notes: ["place_unmatched"],
        });
        expect(resolve("settlement", C.ortInaktiv, "wiki:p68t-ort-a")).toMatchObject({
            state: "resolved",
            resolvedBy: "wiki_key",
            target: { column: "place_id", id: "1" },
        });
        // Eine Beschriftung, deren Region inaktiv ist, trifft nicht.
        expect(resolve("region", C.beschriftungInaktiv, "")).toMatchObject({ state: "unmatched" });
        expect(resolve("territory", C.gebietInaktiv, "")).toMatchObject({ state: "unmatched" });
    });

    it("der Schlüssel gilt nur, wenn die Kennung leer ist oder nichts fand; er trägt bei Orten und Landschaften das Präfix wiki:", () => {
        expect(resolve("settlement", "", "wiki:p68t-ort-a")).toMatchObject({
            resolvedBy: "wiki_key",
            target: { id: "1" },
        });
        expect(resolve("settlement", null, "p68t-ort-a")).toMatchObject({
            resolvedBy: "wiki_key",
            target: { id: "1" },
        });
        expect(resolve("region", "", "wiki:p68t-region-a")).toMatchObject({
            target: { column: "region_id", id: "20" },
        });
        expect(resolve("region", "", "wiki:p68t-gipfel-a")).toMatchObject({
            target: { column: "terrain_peak_id", id: "30" },
        });
        // Bei Gebieten steht der Schlüssel schon in Avesmaps3D-Form: wörtlich, mit dem Präfix.
        expect(resolve("territory", "", "wiki:p68t-gebiet-a")).toMatchObject({
            resolvedBy: "wiki_key",
            target: { id: "10" },
        });
        expect(resolve("territory", "", "p68t-gebiet-a")).toMatchObject({ state: "unmatched" });
    });

    it("ein mehrdeutiger Schlüssel wird nie still gewählt", () => {
        expect(resolve("settlement", "", "wiki:p68t-ort-geteilt")).toMatchObject({
            state: "unmatched",
            target: null,
            notes: ["place_target_ambiguous"],
        });
        expect(resolve("territory", "", "wiki:p68t-gebiet-doppelt")).toMatchObject({
            state: "unmatched",
            notes: ["place_target_ambiguous"],
        });
    });

    it("Kennung und Schlüssel zeigen auf verschiedene Ziele: die Kennung gewinnt, der Befund nennt es", () => {
        expect(resolve("settlement", C.ortB, "wiki:p68t-ort-a")).toMatchObject({
            state: "resolved",
            resolvedBy: "public_id",
            target: { id: "2" },
            notes: ["place_target_key_disagrees"],
        });
        // Die Kennung liegt unter den Treffern eines mehrdeutigen Schlüssels: kein Widerspruch.
        expect(resolve("settlement", C.ortB, "wiki:p68t-ort-geteilt")).toMatchObject({
            target: { id: "2" },
            notes: [],
        });
    });

    it("ein Weg über den Schlüssel löst auf den Anker der Gruppe auf; ein Segment der Gruppe widerspricht dem Schlüssel nicht", () => {
        expect(resolve("path", "", "p68t-weg-a")).toMatchObject({
            state: "resolved",
            resolvedBy: "wiki_key",
            target: { column: "path_id", id: "40" },
            notes: ["path_anchor_derived"],
        });
        expect(resolve("path", C.wegA2, "p68t-weg-a")).toMatchObject({ target: { id: "41" }, notes: [] });
        expect(resolve("path", C.wegOhneZuordnung, "p68t-weg-a")).toMatchObject({
            target: { id: "42" },
            notes: ["place_target_key_disagrees"],
        });
        expect(resolve("path", "", "wiki:p68t-weg-a")).toMatchObject({ state: "unmatched" });
    });

    it("weder Kennung noch Schlüssel: unmatched", () => {
        expect(resolve("settlement", "00000000-0000-4000-8000-000000000999", "wiki:gibtesnicht")).toMatchObject({
            state: "unmatched",
            notes: ["place_unmatched"],
        });
        expect(resolve("settlement", "", "")).toMatchObject({ state: "unmatched", notes: ["place_unmatched"] });
    });

    it("fehlt D6 (kein Schlüsselraum), gilt die Kennung allein", () => {
        const withoutD6 = {
            placesByKey: new Map(),
            peaksByKey: new Map(),
            pathAnchors: new Map(),
        } satisfies Partial<TargetIndex>;
        expect(resolve("settlement", C.ortA, "wiki:p68t-ort-a", withoutD6)).toMatchObject({ resolvedBy: "public_id" });
        expect(resolve("settlement", "", "wiki:p68t-ort-a", withoutD6)).toMatchObject({ state: "unmatched" });
        expect(resolve("path", "", "p68t-weg-a", withoutD6)).toMatchObject({ state: "unmatched" });
    });
});

describe("transformLiterature: die Antwort", () => {
    const index = fixtureIndex();

    it("eine unbrauchbare Antwort schreibt nichts und meldet source_block_missing (kein Tor)", () => {
        for (const payload of [
            null,
            "x",
            {},
            { ok: false, adventures: [] },
            { ok: true },
            { ok: true, adventures: {} },
        ]) {
            const result = transformLiterature(payload, index);
            expect(result.skipped).toBe(true);
            expect(codes(result.findings)).toEqual(["source_block_missing"]);
        }
    });

    it("ein leerer Katalog bei aktivem Schalter ist source_empty_catalog, bei abgeschaltetem source_switched_off", () => {
        expect(codes(transformLiterature(catalog([]), index).findings)).toEqual(["source_empty_catalog"]);
        const off = transformLiterature(catalog([], { adventures_enabled: false }), index);
        expect(off.skipped).toBe(true);
        expect(codes(off.findings)).toEqual(["source_switched_off"]);
        // Ein abgeschalteter Katalog ist kein „alles entfernt“, auch nicht mit Werken in der Liste.
        expect(transformLiterature(catalog([work(1)], { adventures_enabled: false }), index).skipped).toBe(true);
    });

    it("übernimmt Stammfelder wörtlich, ein leerer Wert ist NULL, die Werkart wird nicht abgeleitet gespeichert", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    title: "P68T Der  Fall",
                    product_type: "Kampagnenband",
                    edition: "",
                    bf_year: 1040,
                    bf_label: "Praios 1040",
                    genre: "Krimi",
                    is_official: false,
                    series: "Reihe",
                    fshop_code: "US25000",
                    isbn: "978-3-0000-0000-0",
                    contained_in: "Im Namen des Thearchen",
                    cover_url: "/uploads/questcovers/a.webp",
                }),
            ]),
            index,
        );
        expect(result.works).toHaveLength(1);
        expect(result.works[0]).toMatchObject({
            publicId: workId(1),
            title: "P68T Der  Fall",
            productType: "Kampagnenband",
            edition: null,
            bfYear: 1040,
            bfLabel: "Praios 1040",
            genre: "Krimi",
            complexityGm: null,
            isOfficial: false,
            series: "Reihe",
            fshopCode: "US25000",
            isbn: "978-3-0000-0000-0",
            containedIn: "Im Namen des Thearchen",
            wikiUrl: null,
        });
        // Das Cover wird nie übernommen: keine Spalte, nur ein Befund bei fremder Adresse.
        expect(Object.keys(result.works[0] as object)).not.toContain("coverUrl");
    });

    it("is_official hat Legacys Vorgabe true, bf_year bleibt NULL ohne Zahl", () => {
        const result = transformLiterature(catalog([work(1, { is_official: undefined, bf_year: "x" })]), index);
        expect(result.works[0]).toMatchObject({ isOfficial: true, bfYear: null });
    });

    it("ein Werk ohne public_id, Titel oder Werkart ist nicht speicherbar: ausgelassen, gemeldet", () => {
        const result = transformLiterature(
            catalog([
                work(1),
                work(2, { public_id: "keine-uuid" }),
                work(3, { title: "  " }),
                work(4, { product_type: "" }),
                "kein Objekt" as unknown as Bag,
            ]),
            index,
        );
        expect(result.works.map((row) => row.publicId)).toEqual([workId(1)]);
        expect(find(result.findings, "work_entry_unusable")?.objectCount).toBe(4);
    });

    it("🔴 Auszeichnung im Titel bereinigt der Import; bleibt nichts, ist das Werk unbrauchbar", () => {
        const result = transformLiterature(
            catalog([work(1, { title: "Der Scharlatan<br>Die Gabe der Amazonen" }), work(2, { title: "<br />" })]),
            index,
        );
        expect(result.works.map((row) => row.title)).toEqual(["Der Scharlatan Die Gabe der Amazonen"]);
        expect(find(result.findings, "work_entry_unusable")?.objectCount).toBe(1);
    });

    it("dieselbe public_id zweimal: das erste Werk gilt", () => {
        const result = transformLiterature(
            catalog([work(1, { title: "P68T Erst" }), work(1, { title: "P68T Zweit" })]),
            index,
        );
        expect(result.works.map((row) => row.title)).toEqual(["P68T Erst"]);
        expect(find(result.findings, "work_duplicate_public_id")?.objectCount).toBe(1);
    });

    it("die Reihenfolge der Ortsliste bleibt verbatim: Lücken, Gleichstand und Ausgabereihenfolge", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    places: [
                        place(7, "Dritter", { role: "play" }),
                        place(2, "Erster", { role: "start" }),
                        place(7, "Vierter", { role: "play" }),
                        place(7, "dritter", { role: "play" }),
                    ],
                }),
            ]),
            index,
        );
        // Nichts wird sortiert: die Ausgabereihenfolge ist die der Antwort, export_ordinal zählt sie.
        expect(
            result.places.map((row) => [row.sortOrder, row.exportOrdinal, row.rawName, row.nameKey, row.dupOrdinal]),
        ).toEqual([
            [7, 0, "Dritter", "dritter", 0],
            [2, 1, "Erster", "erster", 0],
            [7, 2, "Vierter", "vierter", 0],
            [7, 3, "dritter", "dritter", 1],
        ]);
        expect(codes(result.findings)).toContain("place_duplicate_row");
        expect(codes(result.findings)).toContain("place_sort_order_tie");
    });

    it("ein unbekannter Rollenwert wird play (lieber verschleiern als verraten), Rollen werden nie umgeschrieben", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    places: [
                        place(0, "A", { role: "start" }),
                        place(1, "B", { role: "covers" }),
                        place(2, "C", { role: "lore" }),
                    ],
                }),
            ]),
            index,
        );
        expect(result.places.map((row) => row.role)).toEqual(["start", "covers", "play"]);
        expect(find(result.findings, "role_unknown")?.objectCount).toBe(1);
    });

    it("Werke ohne Ort und Werke mit geordneter Liste ohne Startzeile werden gemeldet, Spielhilfen nicht", () => {
        const result = transformLiterature(
            catalog([
                work(1, { places: [] }),
                work(2, { places: [place(0, "A", { role: "play" }), place(1, "B", { role: "start" })] }),
                work(3, { product_type: "regionalspielhilfe", places: [place(0, "A", { role: "covers" })] }),
                work(4, {
                    product_type: "roman",
                    places: [place(3, "A", { role: "start" }), place(4, "B", { role: "play" })],
                }),
            ]),
            index,
        );
        expect(find(result.findings, "work_without_places")?.objects.map((row) => row.publicId)).toEqual([workId(1)]);
        expect(find(result.findings, "work_without_start")?.objects.map((row) => row.publicId)).toEqual([workId(2)]);
        expect(hasOrderedPlaceList("Roman")).toBe(true);
        expect(hasOrderedPlaceList("Regionalspielhilfe")).toBe(false);
        expect(hasOrderedPlaceList("spielhilfe")).toBe(false);
        // Ein unbekannter Wert gilt als Abenteuer.
        expect(hasOrderedPlaceList("etwasneues")).toBe(true);
    });

    it("zählt die Auflösung je Zustand und Art, mit allen Befunden der Ortsbezüge", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    places: [
                        place(0, "Gareth", { target_kind: "settlement", target_public_id: C.ortA }),
                        place(1, "Dorf", { target_kind: "unresolved" }),
                        place(2, "Geteilt", { target_kind: "settlement", target_wiki_key: "wiki:p68t-ort-geteilt" }),
                        place(3, "Anders", {
                            target_kind: "settlement",
                            target_public_id: C.ortB,
                            target_wiki_key: "wiki:p68t-ort-a",
                        }),
                        place(4, "Weg", { target_kind: "path", target_wiki_key: "p68t-weg-a" }),
                        place(5, "Lore", { target_kind: "lore", target_public_id: "x" }),
                        place(6, "Nirgends", {
                            target_kind: "territory",
                            target_public_id: "00000000-0000-4000-8000-000000000999",
                        }),
                    ],
                }),
            ]),
            index,
        );
        expect(result.totals).toMatchObject({ resolved: 3, unresolved: 1, unmatched: 3 });
        expect(result.totals.byKind["settlement"]).toEqual({ resolved: 2, unmatched: 1 });
        expect(result.totals.byKind["unresolved"]).toEqual({ resolved: 0, unmatched: 0 });
        for (const code of [
            "place_unresolved",
            "place_unmatched",
            "place_target_ambiguous",
            "place_target_key_disagrees",
            "place_kind_unknown",
            "path_anchor_derived",
        ]) {
            expect(codes(result.findings), code).toContain(code);
        }
        const unresolved = find(result.findings, "place_unresolved");
        expect(unresolved?.objects[0]).toEqual({
            table: "adventure_place",
            publicId: workId(1),
            name: "P68T Werk 1 / Dorf",
        });
    });

    it("speichert nur die kuratierten Links (extra:<n>); die berechneten sind Gegenprobe", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    wiki_url: "https://de.wiki-aventurica.de/wiki/Werk_1",
                    link_ulisses: "https://p68test.example/ulisses",
                    link_fshop: "https://p68test.example/fshop",
                    links: [
                        {
                            key: "ulisses",
                            label: "Ulisses eBook",
                            url: "https://p68test.example/ulisses",
                            state: "unchecked",
                        },
                        { key: "fshop", label: "F-Shop", url: "https://p68test.example/fshop", state: "unchecked" },
                        {
                            key: "wiki",
                            label: "Wiki Aventurica",
                            url: "https://de.wiki-aventurica.de/wiki/Werk_1",
                            state: "online",
                        },
                        {
                            key: "dnb",
                            label: "Dt. Nationalbibliothek",
                            url: "https://portal.dnb.de/opac/simpleSearch?query=x",
                            state: "tot",
                        },
                        {
                            key: "extra:7",
                            label: "Rezension",
                            url: "https://p68test.example/rezension",
                            state: "unchecked",
                        },
                        { key: "extra:9", label: "Errata", url: "https://p68test.example/errata", state: "unchecked" },
                    ],
                }),
            ]),
            index,
        );
        expect(result.links.map((link) => [link.label, link.url, link.position])).toEqual([
            ["Rezension", "https://p68test.example/rezension", 0],
            ["Errata", "https://p68test.example/errata", 1],
        ]);
        expect(codes(result.findings)).not.toContain("link_derived_mismatch");
        expect(result.works[0]).toMatchObject({
            linkUlisses: "https://p68test.example/ulisses",
            linkFshop: "https://p68test.example/fshop",
        });
    });

    it("eine Adresse ohne http oder https wird nicht gespeichert, eine doppelte ist eine Zeile, ein Widerspruch der berechneten Links ein Befund", () => {
        const result = transformLiterature(
            catalog([
                work(1, {
                    wiki_url: "javascript:alert(1)",
                    link_ulisses: "ftp://p68test.example/x",
                    links: [
                        { key: "ulisses", label: "Ulisses eBook", url: "https://p68test.example/anderes" },
                        { key: "extra:1", label: "A", url: "https://p68test.example/a" },
                        { key: "extra:2", label: "A noch einmal", url: "https://p68test.example/a" },
                        { key: "extra:3", label: "Böse", url: "javascript:alert(2)" },
                        { key: "extra:4", label: "", url: "https://p68test.example/ohne-titel" },
                    ],
                }),
            ]),
            index,
        );
        expect(result.works[0]).toMatchObject({ wikiUrl: null, linkUlisses: null });
        expect(result.links.map((link) => link.url)).toEqual(["https://p68test.example/a"]);
        expect(find(result.findings, "link_scheme_rejected")?.objectCount).toBe(3);
        expect(find(result.findings, "link_duplicate_url")?.objectCount).toBe(1);
        expect(find(result.findings, "link_unusable")?.numbers).toEqual({ links: 1 });
        expect(find(result.findings, "link_derived_mismatch")?.objectCount).toBe(1);
    });

    it("das Cover wird nie übernommen: nur eine fremde Adresse ist ein Befund, die Herkunft ist ohne E5 nicht bekannt", () => {
        const result = transformLiterature(
            catalog([
                work(1, { cover_url: "/uploads/questcovers/ok.webp" }),
                work(2, { cover_url: "https://avesmaps.de/uploads/questcovers/ok2.webp" }),
                work(3, { cover_url: "https://fremd.example/cover.jpg" }),
                work(4, { cover_url: "/uploads/siedlungen/falsch.webp" }),
            ]),
            index,
        );
        expect(find(result.findings, "external_unlocalized")?.objects.map((row) => row.publicId)).toEqual([
            workId(3),
            workId(4),
        ]);
        expect(find(result.findings, "cover_origin_unknown")?.numbers).toEqual({ cover: 4 });
        expect(isLocalUpload("/uploads/questcovers/a.webp", "/uploads/questcovers/")).toBe(true);
        expect(isLocalUpload("https://evil.example/uploads/questcovers/a.webp", "/uploads/questcovers/")).toBe(false);
    });

    it("die sechs Bootstrap-Beispielwerke bleiben Werke wie alle (Information), lange Texte werden gemeldet, nicht gekürzt", () => {
        const long = "x".repeat(301);
        const result = transformLiterature(
            catalog([
                work(1, { public_id: "a0e17e10-0000-4000-8000-000000000003", title: long }),
                work(2, { places: [place(0, long)] }),
            ]),
            index,
        );
        expect(find(result.findings, "work_seed_sample")?.objectCount).toBe(1);
        expect(result.works[0]?.title).toBe(long);
        expect(result.places[0]?.rawName).toBe(long);
        expect(find(result.findings, "text_exceeds_legacy_limit")?.objectCount).toBe(2);
    });

    it("trägt die Informationsbefunde (bf_year und isbn dünn, is_official ist Legacys Vorgabe) und ohne Datei suppressed_not_exported", () => {
        const result = transformLiterature(catalog([work(1, { bf_year: 1000 }), work(2)]), index);
        expect(find(result.findings, "bf_year_sparse")?.numbers).toEqual({ bf_year: 1, isbn: 0, werke: 2 });
        expect(find(result.findings, "is_official_default")?.numbers).toEqual({ offiziell: 2, werke: 2 });
        expect(codes(result.findings)).toContain("suppressed_not_exported");
    });
});

describe("transformLiterature: die privaten Felder (E5 und E5+, Format als Annahme)", () => {
    const index = fixtureIndex();
    const base = catalog([
        work(1, { places: [place(0, "Gareth", { role: "start" }), place(1, "Dorf", { role: "play" })] }),
        work(2),
    ]);

    it("liest Herkunft, Wiki-Schlüssel, Autoren, Stempel und Herkunftsvermerke und meldet Unlesbares", () => {
        const overlay = parseLiteratureOverlay({
            adventures: [
                {
                    public_id: workId(1).toUpperCase(),
                    origin: "wiki",
                    wiki_key: "p68t-werk-1",
                    authors: "Autor A",
                    synced_at: "2026-08-17 07:57:14.387",
                    field_origins: { title: "wiki", genre: "manual", series: "irgendwas", unbekanntes_feld: "wiki" },
                },
                { public_id: "keine-uuid" },
            ],
        });
        expect(overlay.entries.get(workId(1))).toMatchObject({
            origin: "wiki",
            wikiKey: "p68t-werk-1",
            authors: "Autor A",
            syncedAt: "2026-08-17T07:57:14.387Z",
            fieldOrigins: [
                { field: "title", origin: "wiki" },
                { field: "genre", origin: "manual" },
            ],
        });
        expect(codes(overlay.findings).sort()).toEqual(["field_origin_unknown", "private_entry_unusable"]);
        expect(codes(parseLiteratureOverlay({ x: 1 }).findings)).toEqual(["private_file_unusable"]);
    });

    it("ohne Datei bleibt alles unknown; mit der Datei werden die Werke der Antwort angereichert, fremde gemeldet", () => {
        const overlay = parseLiteratureOverlay({
            adventures: [
                { public_id: workId(1), origin: "manual", wiki_key: "p68t-eins" },
                { public_id: workId(2), origin: "wiki", wiki_key: "p68t-eins" },
                { public_id: workId(9), origin: "wiki" },
            ],
        });
        const result = transformLiterature(base, index, overlay);
        expect(result.privateWorks.map((row) => [row.publicId, row.origin, row.wikiKey])).toEqual([
            [workId(1), "manual", "p68t-eins"],
            // Der Wiki-Schlüssel ist eindeutig: das zweite Werk bekommt ihn nicht.
            [workId(2), "wiki", null],
        ]);
        expect(codes(result.findings)).toContain("wiki_key_conflict");
        expect(codes(result.findings)).toContain("private_work_unknown");
        expect(codes(result.findings)).not.toContain("suppressed_not_exported");
    });

    it("unterdrückte Orte werden Tombstones; ein Eintrag, den die Antwort zugleich genehmigt führt, ist ein Widerspruch (die Antwort gewinnt)", () => {
        const overlay = parseLiteratureOverlay({
            adventures: [
                {
                    public_id: workId(1),
                    places: [
                        { sort_order: 0, raw_name: "Gareth", origin: "wiki", status: "approved" },
                        { sort_order: 1, raw_name: "Dorf", origin: "manual", status: "suppressed" },
                        {
                            sort_order: 5,
                            raw_name: "Entfernt",
                            origin: "wiki",
                            status: "suppressed",
                            role: "play",
                            target_kind: "settlement",
                            target_public_id: C.ortA,
                        },
                    ],
                },
                { public_id: workId(7), status: "suppressed" },
                { public_id: workId(2), status: "suppressed" },
            ],
        });
        const result = transformLiterature(base, index, overlay);
        expect(result.privatePlaces).toEqual([
            { workPublicId: workId(1), sortOrder: 0, nameKey: "gareth", dupOrdinal: 0, origin: "wiki" },
        ]);
        expect(
            result.suppressedPlaces.map((row) => [row.rawName, row.sortOrder, row.exportOrdinal, row.origin]),
        ).toEqual([["Entfernt", 5, 2, "wiki"]]);
        expect(result.suppressedWorks).toEqual([workId(7)]);
        expect(find(result.findings, "private_conflict")?.objectCount).toBe(2);
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Spielliteratur: Import, Idempotenz und Prüfer gegen PostgreSQL (Migration 0068)", () => {
    let database: Database;
    let ids: Record<string, string>;

    beforeAll(async () => {
        // Die Testdaten entstehen mit dem Schreibweg des Imports; der Besitz des Bereichs ist hier nicht Gegenstand.
        legacyImportOffen();
        database = createDatabase(testDatabaseUrl as string);
        await migrate(database);
        await cleanCatalogFixtures(database);
    }, 180_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        await cleanCatalogFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanCatalogFixtures(database);
        ids = await insertCatalogCarriers(database);
    });

    /** Eine Antwort, die jeden Fall der Auflösung trägt. */
    function fixtureCatalog(): Bag {
        return catalog([
            work(1, {
                title: "P68T Siegelbruch",
                wiki_url: "https://de.wiki-aventurica.de/wiki/Siegelbruch",
                link_ulisses: "https://p68test.example/ulisses",
                bf_year: 1040,
                isbn: "978-3-0000-0000-0",
                places: [
                    place(0, "Gareth", {
                        role: "start",
                        target_kind: "settlement",
                        target_public_id: C.ortA,
                        target_wiki_key: "wiki:p68t-ort-a",
                    }),
                    place(1, "Mittelreich", {
                        role: "play",
                        target_kind: "territory",
                        target_public_id: C.gebietB,
                        target_wiki_key: "wiki:p68t-gebiet-b",
                        territory_path: ["wiki:p68t-gebiet-b", "wiki:p68t-gebiet-a"],
                    }),
                    place(2, "Bornstrasse", {
                        role: "play",
                        target_kind: "path",
                        target_public_id: C.wegA2,
                        target_wiki_key: "p68t-weg-a",
                    }),
                    place(3, "Ein Dorf", { role: "play", target_kind: "unresolved" }),
                    place(4, "Geteilt", {
                        role: "play",
                        target_kind: "settlement",
                        target_wiki_key: "wiki:p68t-ort-geteilt",
                    }),
                ],
                links: [
                    {
                        key: "ulisses",
                        label: "Ulisses eBook",
                        url: "https://p68test.example/ulisses",
                        state: "unchecked",
                    },
                    {
                        key: "wiki",
                        label: "Wiki Aventurica",
                        url: "https://de.wiki-aventurica.de/wiki/Siegelbruch",
                        state: "unchecked",
                    },
                    { key: "dnb", label: "Dt. Nationalbibliothek", url: "https://portal.dnb.de/x", state: "unchecked" },
                    {
                        key: "extra:1",
                        label: "Rezension",
                        url: "https://p68test.example/rezension",
                        state: "unchecked",
                    },
                ],
            }),
            work(2, {
                title: "P68T Region",
                product_type: "regionalspielhilfe",
                places: [
                    place(5, "Wald", { role: "covers", target_kind: "region", target_public_id: C.beschriftungA }),
                    place(5, "Wald", { role: "covers", target_kind: "region", target_public_id: C.beschriftungA }),
                    place(9, "Gipfel", { role: "covers", target_kind: "region", target_public_id: C.gipfelA }),
                    place(10, "Nirgends", {
                        role: "covers",
                        target_kind: "settlement",
                        target_public_id: "00000000-0000-4000-8000-000000000999",
                    }),
                ],
            }),
            work(3, { title: "P68T Ohne Orte", product_type: "roman" }),
        ]);
    }

    const counts = async (): Promise<Record<string, number>> => {
        const result: Record<string, number> = {};
        for (const table of ["adventure", "adventure_place", "adventure_link"]) {
            const [row] = await database.unsafe<{ n: number }[]>(
                `SELECT count(*)::int AS n FROM ${table} t WHERE t.is_active ${table === "adventure" ? "AND public_id::text LIKE '68100000-%'" : `AND t.adventure_id IN (SELECT id FROM adventure WHERE public_id::text LIKE '68100000-%')`}`,
            );
            result[table] = row?.n ?? 0;
        }
        return result;
    };

    it("🔴 der Legacy-Import lässt die Literatur aus, solange sie dem WikiSync gehört: skipped, Befund bereich_wikisync, nichts geschrieben", async () => {
        vi.restoreAllMocks();
        try {
            const report = await importLiterature(database, fixtureCatalog());
            expect(report.skipped).toBe(true);
            expect(report.changed).toBe(false);
            expect(codes(report.findings)).toEqual(["bereich_wikisync"]);
            const tabellen = await counts();
            expect(Object.values(tabellen).every((n) => n === 0)).toBe(true);
        } finally {
            legacyImportOffen();
        }
    });

    it("der Prüfer bestätigt den Import; eine Abweichung ist ein Befund, kein Tor", async () => {
        const payload = fixtureCatalog();
        await importLiterature(database, payload);
        const ok = await verifyLiterature(database, payload);
        expect(ok.skipped).toBe(false);
        expect(ok.checks.filter((entry) => !entry.passed)).toEqual([]);
        expect(ok.passed).toBe(true);
        expect(ok.checks.map((entry) => entry.name)).toEqual([
            "counts",
            "work_parity",
            "place_parity",
            "place_targets",
            "place_resolution",
            "place_order",
            "roles",
            "link_parity",
            "field_origins",
            "structure",
            "no_orphans",
            "contract_numbers",
        ]);
        // Der Gebietspfad aus Legacy passt zur Kette im Baum: kein Befund.
        expect(codes(ok.findings)).not.toContain("territory_path_divergent");

        await database`UPDATE adventure SET genre = 'verfälscht' WHERE public_id = ${workId(1)}`;
        await database`
            UPDATE adventure_place SET role = 'covers' WHERE raw_name = 'Gareth'
              AND adventure_id IN (SELECT id FROM adventure WHERE public_id = ${workId(1)})
        `;
        const bad = await verifyLiterature(database, payload);
        expect(bad.checks.find((entry) => entry.name === "work_parity")?.passed).toBe(false);
        expect(bad.checks.find((entry) => entry.name === "place_parity")?.passed).toBe(false);
        expect(bad.checks.find((entry) => entry.name === "work_parity")?.blocking).toBe(false);
        // Nichts hält an: kein Prüfer steht in BLOCKING_CHECKS.
        expect(bad.passed).toBe(true);
    });

    it("der Prüfer nennt abweichende Gebietspfade als Information", async () => {
        const payload = fixtureCatalog();
        const places = ((payload["adventures"] as Bag[])[0] as Bag)["places"] as Bag[];
        (places[1] as Bag)["territory_path"] = ["wiki:p68t-gebiet-b", "wiki:p68t-gebiet-doppelt"];
        await importLiterature(database, payload);
        const report = await verifyLiterature(database, payload);
        expect(find(report.findings, "territory_path_divergent")?.numbers).toEqual({ abweichend: 1, verglichen: 1 });
    });

    it("Struktur: keine entity_type-Spalte, kein JSON-Typ, kein gespeicherter Gebietspfad, keine Bild- oder Link-Zustandsspalte", async () => {
        const columns = await database<{ table_name: string; column_name: string; data_type: string }[]>`
            SELECT table_name, column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name IN ('adventure', 'adventure_field_origin', 'adventure_place', 'adventure_link', 'adventure_media')
        `;
        expect(columns.length).toBeGreaterThan(50);
        expect(columns.filter((row) => row.column_name === "entity_type")).toEqual([]);
        expect(columns.filter((row) => ["json", "jsonb"].includes(row.data_type))).toEqual([]);
        const names = new Set(columns.map((row) => row.column_name));
        for (const forbidden of ["territory_path", "cover_url", "cover_path", "link_state", "state_check", "kind"]) {
            expect(names.has(forbidden), forbidden).toBe(false);
        }
        // Die Werkart wird nicht gespeichert: nur product_type.
        expect(names.has("adventure_kind")).toBe(false);
        expect(names.has("product_type")).toBe(true);
    });

    it("Schema: ein Ort ist aufgelöst mit genau einem Fremdschlüssel oder mit keinem", async () => {
        await importLiterature(database, fixtureCatalog());
        const [placeRow] = await database<{ adventure_id: string }[]>`
            SELECT adventure_id::text FROM adventure_place LIMIT 1
        `;
        const attempt = (target: string, state: string, by: string | null, extra = ""): Promise<unknown> =>
            database.unsafe(
                `INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, resolved_by${extra === "" ? "" : ", place_id, territory_id"})
                 VALUES (${placeRow?.adventure_id ?? "0"}, 99, 99, '${target}', '${target}', 'play', '${state}', ${by === null ? "NULL" : `'${by}'`}${extra})`,
            );
        // resolved ohne Fremdschlüssel, unresolved mit Fremdschlüssel, zwei Fremdschlüssel, resolved ohne resolved_by.
        await expect(attempt("a", "resolved", "public_id")).rejects.toMatchObject({ code: "23514" });
        await expect(attempt("b", "unresolved", null, `, ${ids[C.ortA]}, NULL`)).rejects.toMatchObject({
            code: "23514",
        });
        await expect(
            attempt("c", "resolved", "public_id", `, ${ids[C.ortA]}, ${ids[C.gebietA]}`),
        ).rejects.toMatchObject({ code: "23514" });
        await expect(attempt("d", "resolved", null, `, ${ids[C.ortA]}, NULL`)).rejects.toMatchObject({ code: "23514" });
        await expect(attempt("e", "unmatched", "wiki_key")).rejects.toMatchObject({ code: "23514" });
        await expect(attempt("f", "gefunden", null)).rejects.toMatchObject({ code: "23514" });
        await attempt("g", "resolved", "wiki_key", `, ${ids[C.ortA]}, NULL`);
    });

    it("Schema: Rolle, Zustand und Aktivität gehören zusammen; Adressen nur mit http und https; Texte nie leer", async () => {
        await importLiterature(database, fixtureCatalog());
        const violation = async (statement: string): Promise<{ code: string; constraint_name?: string }> => {
            try {
                await database.unsafe(statement);
            } catch (error) {
                return error as { code: string; constraint_name?: string };
            }
            throw new Error(`keine Verletzung: ${statement}`);
        };
        const scope = `adventure_id IN (SELECT id FROM adventure WHERE public_id = '${workId(1)}')`;
        expect((await violation(`UPDATE adventure_place SET role = 'lore' WHERE ${scope}`)).constraint_name).toBe(
            "adventure_place_role_known",
        );
        expect((await violation(`UPDATE adventure_place SET state = 'retired' WHERE ${scope}`)).constraint_name).toBe(
            "adventure_place_state_matches_activity",
        );
        expect(
            (await violation(`UPDATE adventure SET state = 'bogus' WHERE public_id = '${workId(1)}'`)).constraint_name,
        ).toBe("adventure_state_known");
        expect(
            (await violation(`UPDATE adventure SET wiki_url = 'javascript:alert(1)' WHERE public_id = '${workId(1)}'`))
                .constraint_name,
        ).toBe("adventure_urls_http");
        expect((await violation(`UPDATE adventure_link SET url = 'ftp://x' WHERE ${scope}`)).constraint_name).toBe(
            "adventure_link_url_http",
        );
        expect(
            (await violation(`UPDATE adventure SET genre = '  ' WHERE public_id = '${workId(1)}'`)).constraint_name,
        ).toBe("adventure_text_not_blank");
        expect(
            (await violation(`UPDATE adventure SET legacy_origin = 'editor' WHERE public_id = '${workId(1)}'`))
                .constraint_name,
        ).toBe("adventure_legacy_origin_known");
        // Aktivität ohne Stilllegestempel verletzt beide Regeln; welche zuerst gemeldet wird, ist nicht festgelegt.
        expect(
            (await violation(`UPDATE adventure SET is_active = FALSE WHERE public_id = '${workId(1)}'`))
                .constraint_name,
        ).toMatch(/^adventure_(state_matches_activity|retired_consistent)$/);
        // Der Wiki-Schlüssel ist eindeutig, sobald er gesetzt ist; mehrere NULL sind erlaubt.
        await database`UPDATE adventure SET wiki_key = 'p68t-eindeutig' WHERE public_id = ${workId(1)}`;
        expect(
            (await violation(`UPDATE adventure SET wiki_key = 'p68t-eindeutig' WHERE public_id = '${workId(2)}'`))
                .constraint_name,
        ).toBe("adventure_wiki_key_unique");
        // Legacys Längen stehen nicht als CHECK: ein langer Text wird gespeichert und gemeldet.
        await database`UPDATE adventure SET genre = ${"g".repeat(400)} WHERE public_id = ${workId(1)}`;
    });

    it("Schema: adventure_media bindet ein Cover je Werk in der Rolle literature_cover, höchstens eine aktive Bindung", async () => {
        await importLiterature(database, fixtureCatalog());
        const [adventure] = await database<
            { id: string }[]
        >`SELECT id::text FROM adventure WHERE public_id = ${workId(1)}`;
        const [assetOne] = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref)
            VALUES ('image', 'legacy_import', 'catalog-test', 'adventure:p68t:cover:1') RETURNING id::text
        `;
        const [assetTwo] = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, source_system, source_ref)
            VALUES ('image', 'legacy_import', 'catalog-test', 'adventure:p68t:cover:2') RETURNING id::text
        `;
        try {
            const bind = (assetId: string, role: string, origin = "legacy", retired = false): Promise<unknown> =>
                database.unsafe(
                    `INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin, retired_at)
                     VALUES (${adventure?.id ?? "0"}, ${assetId}, '${role}', '${origin}', ${retired ? "now()" : "NULL"})`,
                );
            await bind(assetOne?.id as string, "literature_cover", "wiki_localized");
            await expect(bind(assetTwo?.id as string, "literature_cover")).rejects.toMatchObject({
                constraint_name: "adventure_media_one_active_per_role",
            });
            await expect(bind(assetTwo?.id as string, "header")).rejects.toMatchObject({
                constraint_name: "adventure_media_role_known",
            });
            await expect(bind(assetTwo?.id as string, "literature_cover", "scraper", true)).rejects.toMatchObject({
                constraint_name: "adventure_media_origin_known",
            });
            await expect(bind(assetOne?.id as string, "literature_cover", "legacy", true)).rejects.toMatchObject({
                constraint_name: "adventure_media_unique",
            });
            await database`UPDATE adventure_media SET retired_at = now() WHERE adventure_id = ${adventure?.id as string}`;
            await bind(assetTwo?.id as string, "literature_cover");
            // approved ohne Entscheid ist ausgeschlossen.
            await expect(
                database`UPDATE adventure_media SET publication_override = 'approved' WHERE media_asset_id = ${assetTwo?.id as string}`,
            ).rejects.toMatchObject({ constraint_name: "adventure_media_approved_has_decision" });
        } finally {
            await database`DELETE FROM adventure_media WHERE adventure_id = ${adventure?.id as string}`;
            await database`DELETE FROM media_asset WHERE source_system = 'catalog-test'`;
        }
    });

    describe("private Felder (E5 und E5+)", () => {
        const overlay = (extra: Bag = {}): ReturnType<typeof parseLiteratureOverlay> =>
            parseLiteratureOverlay({
                adventures: [
                    {
                        public_id: workId(1),
                        origin: "wiki",
                        wiki_key: "p68t-siegelbruch",
                        authors: "A. Autor",
                        synced_at: "2026-08-17 07:57:14.387",
                        field_origins: { title: "wiki", genre: "manual" },
                        places: [
                            { sort_order: 0, raw_name: "Gareth", origin: "wiki", status: "approved" },
                            { sort_order: 3, raw_name: "Ein Dorf", origin: "manual", status: "approved" },
                            { sort_order: 8, raw_name: "Entfernt", origin: "wiki", status: "suppressed", role: "play" },
                        ],
                        ...extra,
                    },
                ],
            });

        it("der Prüfer prüft mit der Datei auch die Herkunftsvermerke", async () => {
            const payload = fixtureCatalog();
            await importLiterature(database, payload, { overlay: overlay() });
            const report = await verifyLiterature(database, payload, overlay());
            expect(report.checks.filter((entry) => !entry.passed)).toEqual([]);
            expect(report.checks.find((entry) => entry.name === "field_origins")?.detail).toContain(
                "2 Herkunftsvermerke",
            );
            await database`DELETE FROM adventure_field_origin WHERE field = 'genre' AND adventure_id = (SELECT id FROM adventure WHERE public_id = ${workId(1)})`;
            const bad = await verifyLiterature(database, payload, overlay());
            expect(bad.checks.find((entry) => entry.name === "field_origins")?.passed).toBe(false);
        });
    });
});
