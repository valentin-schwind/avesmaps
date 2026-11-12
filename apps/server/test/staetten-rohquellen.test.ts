import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { classifyNamedPlaces } from "../src/migration/staetten-genannte-orte.ts";
import { importStaettenRohquellen, summarizeStaettenRohquellen } from "../src/migration/staetten-rohquellen-import.ts";
import {
    crossStampFindingsV2,
    seatSourceKey,
    siteKeyOf,
    transformRohquellen,
} from "../src/migration/staetten-rohquellen.ts";
import { verifyStaetten } from "../src/migration/verify-staetten.ts";

/**
 * Die Stätten über Kennungen (WI-0134, Betreiberentscheid F1 = B, Migration 0099, Vertrag `staetten.yaml` Version 2): Umformung, Import,
 * Prüfer V21 (Teil Kennungen) und die benannten Fälle aus WI-0134 §4 (T1, T2, T3, T5, T6, T8, T9, T13, dazu T14 und die Entscheidung
 * „keine Stadt“).
 *
 * 🔴 **Die Fixture ist die echte Ausgabe von Legacys Bibliothek.** `fixtures/staetten-rohquellen-export.json` hat die Bibliothek
 * `api/_internal/app/staetten-rohquellen-export.php` aus der Legacy-Anfrage (`project-control/legacy-requests/2026-10-10-staetten-rohquellen-export/`)
 * auf der SQLite-Welt ihres eigenen Geschwistertests erzeugt (Mirror `271e301d2`, PHP 8.5). Kein Netzabruf.
 *
 * 🔴 Gegen PostgreSQL arbeitet der Test mit einer UMBENANNTEN Kopie (Kennungen `99134000-…`, Keys `wiki:stk134-…`), damit er keinen
 * fremden Bestand trifft. Die Tabellen `site`, `site_settlement` und `site_named_place` schreibt nur diese Datei (die Testdatenbank gehört
 * einer Datei zur Zeit, AGENTS.md); sie räumt sie ganz ab.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

type Bag = Record<string, unknown>;

const FIXTURE_TEXT = readFileSync(new URL("./fixtures/staetten-rohquellen-export.json", import.meta.url), "utf8");
const legacy = (): Bag => JSON.parse(FIXTURE_TEXT) as Bag;

// Legacys Kennungen der Fixture (aus dem Geschwistertest).
const L = {
    gareth: "22222222-2222-4222-8222-000000000001",
    eichweiler: "22222222-2222-4222-8222-000000000004",
    fuchswalden: "22222222-2222-4222-8222-000000000005",
    eichstein: "22222222-2222-4222-8222-000000000011",
    weyring: "22222222-2222-4222-8222-000000000012",
    nordquartier: "22222222-2222-4222-8222-000000000013",
    kaiserpalast: "22222222-2222-4222-8222-000000000015",
    phex: "33333333-3333-4333-8333-000000000021",
    kosch: "33333333-3333-4333-8333-000000000026",
};

const list = (payload: Bag, source: string): Bag[] => payload[source] as Bag[];

// ---------------------------------------------------------------------------------------------------------------------------------------
// Umformung (ohne Datenbank)
// ---------------------------------------------------------------------------------------------------------------------------------------

describe("Umformung von X4 (ohne Datenbank)", () => {
    it("liest die echte Antwort: je Quelle die Zeilen mit Legacys eigener Kennung, nichts zusammengelegt", () => {
        const result = transformRohquellen(legacy());
        expect(result.skipped).toBe(false);
        expect(result.failedKinds).toEqual([]);
        expect(Object.fromEntries(Object.entries(result.counts).map(([kind, count]) => [kind, count.stored]))).toEqual({
            punkt: 4,
            gespeichert: 5,
            weg: 2,
            sitz: 5,
            stadtteil: 3,
        });
        expect(result.findings).toEqual([]);
    });

    it("🔴 T1: die Nordlandbank mit drei Sitzen sind drei Stätten - ein Artikel, drei Kennungen, die Rolle je Sitz", () => {
        const result = transformRohquellen(legacy());
        const seats = result.sites.filter((site) => site.name === "Nordlandbank");
        expect(seats.map((site) => [site.sourceKey, site.seatRole, site.seatOrder])).toEqual([
            [seatSourceKey("Nordlandbank", "[[Festum]]"), "hauptsitz", 0],
            [seatSourceKey("Nordlandbank", "zwischen [[Smamid]] und [[Ehristar]]"), "zweigsitz", 1],
            [seatSourceKey("Nordlandbank", "[[Gareth]]"), "zweigsitz", 2],
        ]);
        expect(new Set(seats.map((site) => site.wikiKey))).toEqual(new Set(["wiki:nordlandbank"]));
        // Ein Sitz hat keine gespeicherte Beziehung: sein Ort ist eine Kette, also Evidenz.
        expect(result.relations.filter((relation) => relation.siteKey.startsWith("sitz"))).toEqual([]);
    });

    it("🔴 T2: die Weiterleitung Yol-Fessar ist eine eigene Stätte mit ihrem Titel als Kennung und OHNE Key; Fasar ist nur genannt", () => {
        const payload = legacy();
        // Selbst eine Antwort, die einen Key trüge, setzt ihn nicht: der Key einer Stadtteilweiterleitung ist der Key ihrer Stadt.
        const yol = list(payload, "stadtteile").find((row) => row["titel"] === "Yol-Fessar");
        if (!yol) throw new Error("Yol-Fessar fehlt");
        yol["wiki_key"] = "wiki:fasar";
        const result = transformRohquellen(payload);
        const site = result.sites.find((entry) => entry.sourceKind === "stadtteil" && entry.sourceKey === "Yol-Fessar");
        expect(site).toMatchObject({ name: "Yol-Fessar", wikiKey: null, rawLocation: "[[Fasar]]" });
        expect(result.namedPlaces.get(siteKeyOf("stadtteil", "Yol-Fessar"))).toEqual([
            { position: 0, targetRaw: "Fasar", targetKey: "wiki:fasar" },
        ]);
        expect(
            result.relations.find((relation) => relation.siteKey === siteKeyOf("stadtteil", "Yol-Fessar")),
        ).toBeUndefined();
    });

    it("Beziehungen nur aus der Kennung, mit Herkunft; die Entscheidung „keine Stadt“ reist mit; ohne Stempel heißt es „gespeichert“", () => {
        const result = transformRohquellen(legacy());
        const relationOf = (kind: "punkt" | "gespeichert", id: string) =>
            result.relations.find((relation) => relation.siteKey === siteKeyOf(kind, id));
        expect(relationOf("punkt", L.eichstein)).toMatchObject({
            settlementLegacyPublicId: L.eichweiler,
            origin: "manual",
        });
        expect(relationOf("punkt", L.weyring)).toMatchObject({ settlementLegacyPublicId: L.gareth, origin: "wiki" });
        expect(relationOf("punkt", L.nordquartier)).toMatchObject({ settlementLegacyPublicId: null, origin: "manual" });
        expect(relationOf("punkt", L.kaiserpalast)).toMatchObject({
            settlementLegacyPublicId: L.gareth,
            origin: "gespeichert",
        });
        // T3: die gespeicherte Stätte hängt an der KENNUNG der umbenannten Stadt.
        expect(relationOf("gespeichert", L.phex)).toMatchObject({
            settlementLegacyPublicId: L.fuchswalden,
            origin: "gespeichert",
        });
        expect(FIXTURE_TEXT).not.toContain("Siebeneichen");
    });

    it("🔴 T13: eine Zeile ohne Key bleibt ohne Key, ein Linkziel ohne Key auch - nichts wird gerechnet", () => {
        const result = transformRohquellen(legacy());
        const site = (kind: "punkt" | "gespeichert", id: string) =>
            result.sites.find((entry) => entry.sourceKind === kind && entry.sourceKey === id);
        expect(site("gespeichert", L.phex)?.wikiKey).toBeNull();
        expect(site("gespeichert", L.kosch)?.wikiKey).toBeNull();
        expect(site("punkt", L.kaiserpalast)?.wikiKey).toBeNull();
        expect(result.namedPlaces.get(siteKeyOf("stadtteil", "Unterstadt"))).toEqual([
            { position: 0, targetRaw: "_", targetKey: null },
        ]);
    });

    it("die Art bereinigt (WI-0122), die Rolle steht daneben; eine leere Art bleibt leer", () => {
        const result = transformRohquellen(legacy());
        expect(result.sites.find((site) => site.name === "Garderegiment Rabenmund")?.siteType).toBe(
            "Provinzherrliches Garderegiment",
        );
        expect(result.sites.find((site) => site.name === "Handelshaus Ongswin")?.siteType).toBeNull();
        expect(result.sites.find((site) => site.sourceKey === L.eichstein)).toMatchObject({
            siteClass: "gebaeude",
            siteType: "Burg",
            onMap: true,
        });
        expect(result.sites.find((site) => site.sourceKey === L.weyring)?.onMap).toBe(false);
    });

    it("🔴 T9: eine Quelle, die der Kopf als ausgefallen meldet, liefert nichts und legt nichts still; die anderen bleiben ganz", () => {
        const payload = legacy();
        (payload["kopf"] as Bag)["sitze"] = { ok: false, zeilen: 0 };
        payload["sitze"] = [];
        const result = transformRohquellen(payload);
        expect(result.failedKinds).toEqual(["sitz"]);
        expect(result.sites.filter((site) => site.sourceKind === "sitz")).toEqual([]);
        expect(result.counts.weg.stored).toBe(2);
        expect(result.findings.map((finding) => finding.code)).toEqual(["staetten_quelle_ausgefallen"]);
        // Ein Kopf, der eine andere Zahl nennt als die Liste trägt, gilt genauso als ausgefallen.
        const lying = legacy();
        ((lying["kopf"] as Bag)["wege"] as Bag)["zeilen"] = 7;
        expect(transformRohquellen(lying).failedKinds).toEqual(["weg"]);
    });

    it("eine unbrauchbare Antwort schreibt nichts; eine fremde Kennung bindet nichts und heißt nicht „keine Stadt“", () => {
        for (const payload of [null, { ok: false }, { ok: true }, []]) {
            const result = transformRohquellen(payload);
            expect(result.skipped).toBe(true);
            expect(result.findings.map((finding) => finding.code)).toEqual(["source_block_missing"]);
        }
        const payload = legacy();
        const punkt = list(payload, "punkte").find((row) => row["public_id"] === L.kaiserpalast);
        if (!punkt) throw new Error("Kaiserpalast fehlt");
        punkt["innerorts_ort"] = "Gareth";
        const result = transformRohquellen(payload);
        expect(
            result.relations.find((relation) => relation.siteKey === siteKeyOf("punkt", L.kaiserpalast)),
        ).toBeUndefined();
        expect(result.findings.map((finding) => finding.code)).toEqual(["site_settlement_id_unusable"]);
    });

    it("T14: X4 gegen X2 und X3 desselben Zuges - gleiche Stände still, verschiedene ein Befund mit allen Ständen", () => {
        const { stamps } = transformRohquellen(legacy());
        const same = { ok: true, map_revision: stamps.mapRevision, aliase_stempel: stamps.aliasStamp };
        expect(crossStampFindingsV2(stamps, { "Wiki-Zuordnung": same, "Wiki-Siedlungen": same })).toEqual([]);
        const drift = crossStampFindingsV2(stamps, {
            "Wiki-Zuordnung": { ...same, map_revision: 999 },
            "Wiki-Siedlungen": same,
        });
        expect(drift.map((finding) => finding.code)).toEqual(["stand_abweichend"]);
        expect(drift[0]?.notes).toEqual(["Wiki-Zuordnung.mapRevision: Stätten 812, Wiki-Zuordnung 999"]);
    });

    it("🔴 T6: eine Kette mit zwei Orten ist mehrdeutig, ohne Key bleibt offen - die Klasse kommt nur aus Keys", () => {
        const index = new Map([
            ["wiki:smamid", ["a"]],
            ["wiki:ehristar", ["b"]],
            ["wiki:gareth", ["c"]],
            ["wiki:gareth-doppelt", ["c", "d"]],
        ]);
        expect(classifyNamedPlaces(["wiki:smamid", "wiki:ehristar"], index)).toBe("mehrdeutig");
        expect(classifyNamedPlaces(["wiki:gareth"], index)).toBe("eindeutig");
        expect(classifyNamedPlaces(["wiki:gareth", "wiki:arenaviertel"], index)).toBe("eindeutig");
        expect(classifyNamedPlaces(["wiki:gareth-doppelt"], index)).toBe("mehrdeutig");
        expect(classifyNamedPlaces(["wiki:garetien"], index)).toBe("ohne_ort");
        expect(classifyNamedPlaces([null], index)).toBe("ohne_key");
        expect(classifyNamedPlaces([], index)).toBe("ohne_link");
    });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Gegen PostgreSQL
// ---------------------------------------------------------------------------------------------------------------------------------------

/** Die umbenannte Kopie: eigene Kennungen und Keys, sonst Zeichen für Zeichen Legacys Antwort. */
const scopedText = FIXTURE_TEXT.replaceAll("22222222-2222-4222-8222-", "99134000-0000-4000-8000-")
    .replaceAll("33333333-3333-4333-8333-", "99134000-0000-4000-8001-")
    .replaceAll('"wiki:', '"wiki:stk134-');
const scoped = (): Bag => JSON.parse(scopedText) as Bag;
const ID = (legacyId: string): string =>
    legacyId
        .replace("22222222-2222-4222-8222-", "99134000-0000-4000-8000-")
        .replace("33333333-3333-4333-8333-", "99134000-0000-4000-8001-");
const P = (n: number): string => `99134000-0000-4000-8000-${n.toString().padStart(12, "0")}`;

/** Die Orte dieser Welt; der Name steht nur zur Anzeige, gebunden wird über die Kennung. */
async function insertWorld(database: Queryable): Promise<void> {
    const places: [number, string, string, boolean][] = [
        [1, "STK134 Gareth", "metropole", true],
        [2, "STK134 Festum", "grossstadt", true],
        [3, "STK134 Fasar", "grossstadt", true],
        [4, "STK134 Eichweiler", "dorf", true],
        // 🔴 T3: die Stadt heißt heute anders, als die gespeicherte Stätte sich merkt.
        [5, "STK134 Fuchswalden (Bärenau)", "dorf", true],
        [6, "STK134 Smamid", "stadt", true],
        [7, "STK134 Ehristar", "stadt", true],
        [11, "STK134 Burg Eichstein", "gebaeude", true],
        // 🔴 T5: von der Karte genommen - bei uns ein stillgelegter Ort, die Stätte bleibt.
        [12, "STK134 Gut Weyring", "gebaeude", false],
        [13, "STK134 Nordquartier", "stadtviertel", true],
        [15, "STK134 Kaiserpalast", "gebaeude", true],
    ];
    for (const [n, name, subtype, active] of places) {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${P(n)}, 'aventuria', ${name}, ${subtype}, ST_SetSRID(ST_MakePoint(${700 + n}, 700), 0), 'test', ${active})
        `;
    }
    // Die Zuordnung X2: nur über sie wird ein genannter Ort zu einer Siedlung (eine Zahl im Bericht, keine Bindung).
    for (const [n, key] of [
        [1, "wiki:stk134-gareth"],
        [2, "wiki:stk134-festum"],
        [3, "wiki:stk134-fasar"],
        [6, "wiki:stk134-smamid"],
        [7, "wiki:stk134-ehristar"],
    ] as const) {
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES ('siedlung', ${P(n)}, ${key})
        `;
    }
}

async function cleanWorld(database: Queryable): Promise<void> {
    await database.unsafe(`DELETE FROM site_named_place`);
    await database.unsafe(`DELETE FROM site_settlement`);
    await database.unsafe(`DELETE FROM site`);
    await database.unsafe(`DELETE FROM wiki_key_assignment WHERE wiki_key LIKE 'wiki:stk134-%'`);
    await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '99134000-%'`);
    try {
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'staetten-kennungen'`);
    } catch {
        // Hängt noch eine fremde Zeile daran, bleibt der Lauf stehen - dieselbe Vorsicht wie in den Nachbartests.
    }
}

interface SiteDb {
    id: string;
    source_kind: string;
    source_key: string;
    name: string;
    is_active: boolean;
    on_map: boolean;
    wiki_key: string | null;
    seat_role: string | null;
    seat_order: number | null;
}

describeWithDatabase("Die Stätten über Kennungen gegen PostgreSQL", () => {
    let database: Database;

    const sites = async (): Promise<SiteDb[]> =>
        database<SiteDb[]>`
            SELECT id::text, source_kind, source_key, name, is_active, on_map, wiki_key, seat_role, seat_order
              FROM site ORDER BY source_kind, source_key
        `;
    const siteOf = async (kind: string, key: string): Promise<SiteDb | undefined> =>
        (await sites()).find((site) => site.source_kind === kind && site.source_key === key);
    const relationOf = async (
        kind: string,
        key: string,
    ): Promise<{ settlement: string | null; place: string | null; origin: string; is_active: boolean } | undefined> => {
        const [row] = await database<
            { settlement: string | null; place: string | null; origin: string; is_active: boolean }[]
        >`
            SELECT r.settlement_legacy_public_id::text AS settlement, p.public_id::text AS place, r.origin, r.is_active
              FROM site_settlement r JOIN site s ON s.id = r.site_id LEFT JOIN place p ON p.id = r.place_id
             WHERE s.source_kind = ${kind} AND s.source_key = ${key}
        `;
        return row;
    };
    const namedOf = async (kind: string, key: string): Promise<[string, string | null][]> =>
        (
            await database<{ target_raw: string; target_key: string | null }[]>`
                SELECT n.target_raw, n.target_key FROM site_named_place n JOIN site s ON s.id = n.site_id
                 WHERE s.source_kind = ${kind} AND s.source_key = ${key} ORDER BY n.position
            `
        ).map((row) => [row.target_raw, row.target_key]);

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanWorld(database);
        await insertWorld(database);
    }, 180_000);

    beforeEach(async () => {
        // Jeder Fall beginnt mit dem eingespielten Satz.
        await importStaettenRohquellen(database, scoped());
    });

    afterAll(async () => {
        await cleanWorld(database);
        await database.end({ timeout: 5 });
    });

    it("legt an, der zweite Lauf schreibt nichts, und die bisherige Tabelle bleibt unberührt", async () => {
        const before = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM settlement_place`;
        const again = await importStaettenRohquellen(database, scoped());
        expect(again.changed).toBe(false);
        for (const table of Object.values(again.tables)) {
            expect(table).toMatchObject({ created: 0, updated: 0, retired: 0 });
        }
        expect((await sites()).filter((site) => site.is_active)).toHaveLength(19);
        const after = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM settlement_place`;
        expect(after[0]?.n).toBe(before[0]?.n);
        expect(summarizeStaettenRohquellen(again)).toContain("punkt 4, gespeichert 5, weg 2, sitz 5, stadtteil 3");
    });

    it("🔴 T1: drei Sitze der Nordlandbank sind drei Zeilen mit ihrer Rolle, nichts verschmolzen", async () => {
        const seats = (await sites())
            .filter((site) => site.source_kind === "sitz" && site.name === "Nordlandbank")
            .sort((left, right) => (left.seat_order ?? 0) - (right.seat_order ?? 0));
        expect(seats.map((site) => [site.seat_role, site.seat_order])).toEqual([
            ["hauptsitz", 0],
            ["zweigsitz", 1],
            ["zweigsitz", 2],
        ]);
        expect(new Set(seats.map((site) => site.wiki_key))).toEqual(new Set(["wiki:stk134-nordlandbank"]));
        expect(await namedOf("sitz", seatSourceKey("Nordlandbank", "[[Gareth]]"))).toEqual([
            ["Gareth", "wiki:stk134-gareth"],
        ]);
        expect(await relationOf("sitz", seatSourceKey("Nordlandbank", "[[Gareth]]"))).toBeUndefined();
    });

    it("🔴 T2: Yol-Fessar ist eine eigene Stätte mit ihrem Titel, ohne Key, nicht mit Fasar verschmolzen; Fasar ist genannt, nicht innerorts", async () => {
        const yol = await siteOf("stadtteil", "Yol-Fessar");
        expect(yol).toMatchObject({ name: "Yol-Fessar", wiki_key: null, is_active: true });
        expect(await namedOf("stadtteil", "Yol-Fessar")).toEqual([["Fasar", "wiki:stk134-fasar"]]);
        expect(await relationOf("stadtteil", "Yol-Fessar")).toBeUndefined();
        expect((await sites()).filter((site) => site.source_kind === "stadtteil")).toHaveLength(3);
    });

    it("🔴 T3: die gespeicherte Stätte hängt über die Kennung an der umbenannten Stadt", async () => {
        expect(await relationOf("gespeichert", ID(L.phex))).toEqual({
            settlement: P(5),
            place: P(5),
            origin: "gespeichert",
            is_active: true,
        });
        const [place] = await database<{ name: string }[]>`SELECT name FROM place WHERE public_id = ${P(5)}`;
        expect(place?.name).toBe("STK134 Fuchswalden (Bärenau)");
    });

    it("🔴 T5: ein von der Karte genommener Punkt behält Stätte und Beziehung, sein Ort ist stillgelegt", async () => {
        expect(await siteOf("punkt", P(12))).toMatchObject({ is_active: true, on_map: false });
        expect(await relationOf("punkt", P(12))).toEqual({
            settlement: P(1),
            place: P(1),
            origin: "wiki",
            is_active: true,
        });
        const [point] = await database<
            { is_active: boolean }[]
        >`SELECT is_active FROM place WHERE public_id = ${P(12)}`;
        expect(point?.is_active).toBe(false);
        // Und der Punkt auf der Karte (T4): Beziehung von Hand UND Kartenpräsenz.
        expect(await siteOf("punkt", P(11))).toMatchObject({ on_map: true });
        expect(await relationOf("punkt", P(11))).toMatchObject({ place: P(4), origin: "manual" });
    });

    it("🔴 T15 (WI-0196): eine Stätte des Editors für einen Kartenpunkt hält den Zug nicht auf - er übergeht sie und meldet sie", async () => {
        // Claudio 2026-10-16: Hat Legacy denselben Punkt später selbst innerorts, trifft der Import auf die Zeile mit
        // `source_system 'avesmaps3d'`. `protectedWhere` hält sie vom Ändern fern; an `site_source_unique` scheitern darf er nicht.
        const legacy = await siteOf("punkt", P(15));
        if (!legacy) throw new Error("Kaiserpalast fehlt");
        // Als der Editor den Punkt hinzufügte, war er in Legacy noch nicht innerorts: Es gab nur die Stätte des Editors.
        await database`DELETE FROM site_named_place WHERE site_id = ${legacy.id}::bigint`;
        await database`DELETE FROM site_settlement WHERE site_id = ${legacy.id}::bigint`;
        await database`DELETE FROM site WHERE id = ${legacy.id}::bigint`;
        const [editor] = await database<
            { id: string }[]
        >`SELECT public.site_punkt_fuer_ort(${P(15)}::uuid)::text AS id`;

        const report = await importStaettenRohquellen(database, scoped());
        const nachher = await database<{ id: string; source_system: string; name: string }[]>`
            SELECT id::text AS id, source_system, name FROM site WHERE source_kind = 'punkt' AND source_key = ${P(15)}
        `;
        expect(nachher).toEqual([{ id: editor!.id, source_system: "avesmaps3d", name: "STK134 Kaiserpalast" }]);
        expect(report.tables.site.protectedRows).toBeGreaterThanOrEqual(1);
        // Aufräumen: Der nächste Fall beginnt mit dem eingespielten Satz, und der legt die Legacy-Zeile wieder an.
        await database`DELETE FROM site_named_place WHERE site_id = ${editor!.id}::bigint`;
        await database`DELETE FROM site_settlement WHERE site_id = ${editor!.id}::bigint`;
        await database`DELETE FROM site WHERE id = ${editor!.id}::bigint`;
    });

    it("die Entscheidung „keine Stadt“ steht als Beziehung ohne Ort; eine Kennung ohne Ort steht mit leerem Ort und Befund", async () => {
        expect(await relationOf("punkt", P(13))).toEqual({
            settlement: null,
            place: null,
            origin: "manual",
            is_active: true,
        });
        const payload = scoped();
        const punkt = list(payload, "punkte").find((row) => row["public_id"] === P(15));
        if (!punkt) throw new Error("Kaiserpalast fehlt");
        punkt["innerorts_ort"] = "99134000-0000-4000-8000-000000000999";
        const report = await importStaettenRohquellen(database, payload);
        expect(await relationOf("punkt", P(15))).toMatchObject({
            settlement: "99134000-0000-4000-8000-000000000999",
            place: null,
            origin: "gespeichert",
        });
        expect(report.relations).toMatchObject({ unresolved: 1, noSettlement: 1 });
        expect(report.findings.map((finding) => finding.code)).toContain("site_settlement_unresolved");
    });

    it("🔴 T6: die mehrdeutige Kette bleibt offen; offene Zuordnungen sind eine Zahl im Bericht, kein Fehler", async () => {
        const report = await importStaettenRohquellen(database, scoped());
        expect(await namedOf("sitz", seatSourceKey("Nordlandbank", "zwischen [[Smamid]] und [[Ehristar]]"))).toEqual([
            ["Smamid", "wiki:stk134-smamid"],
            ["Ehristar", "wiki:stk134-ehristar"],
        ]);
        expect(report.namedPlaces).toEqual({ eindeutig: 5, mehrdeutig: 1, ohne_ort: 3, ohne_key: 1, ohne_link: 0 });
        expect(report.relations).toEqual({ withId: 8, resolved: 8, unresolved: 0, noSettlement: 1, open: 10 });
        // Keine Kette hat eine Beziehung erzeugt.
        const [chain] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM site_settlement r JOIN site s ON s.id = r.site_id
             WHERE s.source_kind IN ('weg', 'sitz', 'stadtteil')
        `;
        expect(chain?.n).toBe(0);
    });

    it("🔴 T8: was ein Mensch in Avesmaps3D gesetzt hat, überlebt den Zug - auch an einer Stätte, die Legacy ohne Stadt führt", async () => {
        const eichstein = await siteOf("punkt", P(11));
        const weg = await siteOf("weg", "wiki:stk134-webergasse");
        if (!eichstein || !weg) throw new Error("Stätten fehlen");
        const [gareth] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${P(1)}`;
        await database`
            UPDATE site_settlement SET origin = 'editor', place_id = ${gareth?.id ?? null}, settlement_legacy_public_id = NULL,
                   source_system = 'editor'
             WHERE site_id = ${eichstein.id}
        `;
        await database`
            INSERT INTO site_settlement (site_id, place_id, origin, source_system) VALUES (${weg.id}, ${gareth?.id ?? null}, 'editor', 'editor')
        `;
        try {
            const report = await importStaettenRohquellen(database, scoped());
            expect(await relationOf("punkt", P(11))).toMatchObject({ place: P(1), origin: "editor", is_active: true });
            expect(await relationOf("weg", "wiki:stk134-webergasse")).toMatchObject({
                place: P(1),
                origin: "editor",
                is_active: true,
            });
            expect(report.findings.map((finding) => finding.code)).toContain("row_vs_decision");
            expect(report.tables.site_settlement.protectedRows).toBe(1);
        } finally {
            await database`DELETE FROM site_settlement WHERE site_id IN (${eichstein.id}, ${weg.id})`;
        }
    });

    it("🔴 T9: fällt eine Quelle aus, bleiben ihre Stätten und Beziehungen stehen; was Legacy wirklich nicht mehr nennt, wird stillgelegt", async () => {
        const payload = scoped();
        (payload["kopf"] as Bag)["punkte"] = { ok: false, zeilen: 0 };
        payload["punkte"] = [];
        (payload["kopf"] as Bag)["sitze"] = { ok: false, zeilen: 0 };
        payload["sitze"] = [];
        payload["wege"] = list(payload, "wege").filter((row) => row["weg_key"] !== "wiki:stk134-webergasse");
        ((payload["kopf"] as Bag)["wege"] as Bag)["zeilen"] = 1;
        const report = await importStaettenRohquellen(database, payload);
        expect(report.failedKinds).toEqual(["punkt", "sitz"]);
        expect(report.tables.site.retired).toBe(1);
        expect((await sites()).filter((site) => site.source_kind === "sitz" && site.is_active)).toHaveLength(5);
        expect(await relationOf("punkt", P(12))).toMatchObject({ is_active: true, place: P(1) });
        expect(await siteOf("weg", "wiki:stk134-webergasse")).toMatchObject({ is_active: false });
        // Eine stillgelegte Stätte behält ihre genannten Orte.
        expect(await namedOf("weg", "wiki:stk134-webergasse")).toEqual([["Khunchom", "wiki:stk134-khunchom"]]);
        const codes = report.findings.map((finding) => finding.code);
        expect(codes).toContain("staetten_quelle_ausgefallen");
        expect(codes).toContain("staetten_quelle_geschuetzt");
    });

    it("ein Probelauf schreibt nichts, auch kein Journal; eine unbrauchbare Antwort schreibt nichts", async () => {
        const before = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'staetten-kennungen'
        `;
        const payload = scoped();
        payload["stadtteile"] = [];
        ((payload["kopf"] as Bag)["stadtteile"] as Bag)["zeilen"] = 0;
        const dry = await importStaettenRohquellen(database, payload, { dryRun: true });
        expect(dry.tables.site.retired).toBe(3);
        expect((await sites()).filter((site) => site.source_kind === "stadtteil" && site.is_active)).toHaveLength(3);
        const broken = await importStaettenRohquellen(database, { ok: false });
        expect(broken.skipped).toBe(true);
        const after = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'staetten-kennungen'
        `;
        expect(after[0]?.n).toBe(before[0]?.n);
    });

    it("der Prüfer V21 (Kennungen): bestanden gegen dieselbe Antwort; ein Ort, der nicht aus der Kennung kommt, ist ein Befund, kein Tor", async () => {
        const payload = scoped();
        const report = await verifyStaetten(database, { ok: true }, { rohquellen: payload });
        expect(report.skipped).toBe(false);
        expect(report.checks.map((entry) => entry.name)).toEqual([
            "kennungen_counts",
            "kennungen_rows",
            "sitze_getrennt",
            "kennungen_relations",
            "kennungen_named_places",
            "kennungen_structure",
            "kennungen_effect",
        ]);
        for (const entry of report.checks) expect(entry.passed, `${entry.name}: ${entry.detail}`).toBe(true);
        expect(report.checks.every((entry) => entry.blocking !== true)).toBe(true);

        // Ein Ort aus etwas anderem als der Kennung (hier: von Hand falsch gesetzt, als käme er aus Legacy).
        const eichstein = await siteOf("punkt", P(11));
        const [fasar] = await database<{ id: string }[]>`SELECT id::text FROM place WHERE public_id = ${P(3)}`;
        await database`UPDATE site_settlement SET place_id = ${fasar?.id ?? null} WHERE site_id = ${eichstein?.id ?? null}`;
        const wrong = await verifyStaetten(database, { ok: true }, { rohquellen: payload });
        const relations = wrong.checks.find((entry) => entry.name === "kennungen_relations");
        expect(relations).toMatchObject({ passed: false, blocking: false });
        expect(wrong.passed).toBe(true);
    });
});
