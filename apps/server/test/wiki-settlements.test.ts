import { readFileSync } from "node:fs";
import { Value } from "@sinclair/typebox/value";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EditorPlaceRow, editorPlacePublicId } from "@avesmaps3d/shared";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { listEditorPlaces } from "../src/editor/places.ts";
import { verifyWikiSettlements } from "../src/migration/verify-wiki-settlements.ts";
import { importWikiSettlements } from "../src/migration/wiki-settlements-import.ts";
import { crossStampFindings, transformWikiSettlements } from "../src/migration/wiki-settlements.ts";

/**
 * Die Wiki-Siedlungsregistry (WI-0128 E4, Legacy-Export X3, Migration 0089): Umwandlung, Import, Prüfer und der Leser für „Fehlt“.
 *
 * 🔴 **Die Fixture ist die echte Ausgabe von Legacys Bibliothek.** `fixtures/wiki-siedlungen-export.json` hat die Bibliothek
 * `api/_internal/app/wiki-siedlungen-export.php` aus der Legacy-Anfrage (`project-control/legacy-requests/2026-10-10-wiki-siedlungsregistry-export/`)
 * auf der SQLite-Welt ihres eigenen Tests erzeugt (Mirror `cfbbe69c8`, PHP 8.5): Gareth an zwei Orten, ein Alias (Havena), ein Namensraum
 * (Inoffiziell:), ein nur gleichnamiger Ort (Trallop), ein gelöschter Ort (Ochsenblut), eine ausgeblendete Straße, ein Stadtviertel ohne Werte.
 * Kein Netzabruf.
 *
 * 🔴 Gegen PostgreSQL arbeitet der Test mit einer UMBENANNTEN Kopie (Keys `wiki:wsr89-…`, Titel `WSR89 …`, Orte `89000000-…`), damit er
 * keinen fremden Bestand in der Testdatenbank trifft und genau das abräumt, was er angelegt hat.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

type Bag = Record<string, unknown>;

const FIXTURE = JSON.parse(
    readFileSync(new URL("./fixtures/wiki-siedlungen-export.json", import.meta.url), "utf8"),
) as Bag & { siedlungen: Bag[] };

/** Eine tiefe Kopie, damit jeder Fall seine eigene Antwort verändern darf. */
const copy = (): Bag & { siedlungen: Bag[] } => structuredClone(FIXTURE);

describe("Umwandlung von X3 (ohne Datenbank)", () => {
    it("liest die echte Antwort: sieben Siedlungen, Key, Namensraum, Weiterleitung, naive Zeit, NULL bleibt NULL", () => {
        const result = transformWikiSettlements(copy());
        expect(result.skipped).toBe(false);
        expect(result.rows.map((row) => row.wikiKey)).toEqual([
            "wiki:arenaviertel",
            "wiki:baronie-ochsenblut",
            "wiki:gareth",
            "wiki:havena",
            "wiki:inoffiziell-kleewiesen",
            "wiki:reichsstrasse-3",
            "wiki:trallop",
        ]);
        const byKey = new Map(result.rows.map((row) => [row.wikiKey, row]));
        expect(byKey.get("wiki:havena")).toMatchObject({
            title: "Havena (Siedlung)",
            isRedirect: true,
            redirectTitle: null,
            redirectNs: null,
            settlementClass: "grossstadt",
        });
        expect(byKey.get("wiki:inoffiziell-kleewiesen")).toMatchObject({ ns: 222, nsName: "Inoffiziell" });
        expect(byKey.get("wiki:gareth")).toMatchObject({
            wikiFetchedAt: "2026-09-08T12:00:00.123",
            wikiEnrichedAt: "2026-09-08T12:05:00.000",
            lage: "Garetien · Mittelreich",
            hasCoat: true,
            isRuined: false,
        });
        expect(byKey.get("wiki:arenaviertel")).toMatchObject({
            isRuined: null,
            continent: null,
            buildingType: null,
            standort: "[[Gareth]]: [[Arenaviertel]]",
        });
        expect(byKey.get("wiki:reichsstrasse-3")).toMatchObject({
            buildingType: "Reichsstraße",
            buildingTypeExcluded: true,
        });
        expect(result.counts).toEqual({
            delivered: 7,
            stored: 7,
            withoutKey: 0,
            duplicateKeys: 0,
            unusable: 0,
            withPlace: 3,
            excluded: 1,
            legacyMissing: 3,
        });
        expect(result.stamps).toEqual({
            mapRevision: 812,
            aliasStamp: FIXTURE["aliase_stempel"],
            registryRevision: FIXTURE["registry_revision"],
        });
    });

    it("🔴 trennt Legacys Zuordnung über den Key von Legacys NAMENSurteil und meldet, was nur per Name platziert ist", () => {
        const result = transformWikiSettlements(copy());
        const evidence = new Map(result.evidence.map((entry) => [entry.wikiKey, entry]));
        expect(evidence.get("wiki:gareth")?.places).toEqual([
            "11111111-1111-4111-8111-000000000001",
            "11111111-1111-4111-8111-000000000002",
        ]);
        expect(evidence.get("wiki:trallop")).toMatchObject({ places: [], legacyOnMap: true });
        const nameOnly = result.findings.find((finding) => finding.code === "registry_nur_per_name_platziert");
        expect(nameOnly?.objects).toEqual([
            { table: "wiki_settlement_registry", publicId: "wiki:trallop", name: "Trallop" },
        ]);
        // Der Kopf der echten Antwort passt zu ihren Zeilen.
        expect(result.findings.map((finding) => finding.code)).toEqual(["registry_nur_per_name_platziert"]);
    });

    it("eine unbrauchbare oder leere Antwort schreibt nichts (Befund, kein Tor)", () => {
        for (const payload of [null, { ok: false, siedlungen: [] }, { ok: true }, { ok: true, siedlungen: {} }]) {
            const result = transformWikiSettlements(payload);
            expect(result.skipped).toBe(true);
            expect(result.findings.map((finding) => finding.code)).toEqual(["source_block_missing"]);
        }
        const empty = transformWikiSettlements({ ...copy(), siedlungen: [] });
        expect(empty.skipped).toBe(true);
        expect(empty.findings.map((finding) => finding.code)).toEqual(["source_empty_catalog"]);
    });

    it("eine Zeile ohne Key wird nicht gespeichert und kein Key wird geraten; ein doppelter Key: die erste Zeile gilt", () => {
        const payload = copy();
        const [first, second] = payload.siedlungen;
        if (!first || !second) throw new Error("Fixture zu kurz");
        first["wiki_key"] = null;
        second["wiki_key"] = "wiki:gareth";
        const result = transformWikiSettlements(payload);
        expect(result.rows.find((row) => row.title === "Arenaviertel")).toBeUndefined();
        expect(result.rows.filter((row) => row.wikiKey === "wiki:gareth").map((row) => row.title)).toEqual([
            "Baronie Ochsenblut",
        ]);
        expect(result.counts).toMatchObject({ delivered: 7, stored: 5, withoutKey: 1, duplicateKeys: 1 });
        const codes = result.findings.map((finding) => finding.code);
        expect(codes).toContain("x3_ohne_schluessel");
        expect(codes).toContain("x3_schluessel_doppelt");
        // Der Kopf zählt weiter über ALLE gelieferten Zeilen: eine Zeile ohne Key mehr, ein verschiedener Key weniger.
        const head = result.findings.find((finding) => finding.code === "x3_kopf_abweichung");
        expect(head?.notes).toEqual([
            "ohne_schluessel: Kopf 0, gelesen 1",
            "verschiedene_schluessel: Kopf 7, gelesen 5",
        ]);
    });

    it("nur http und https als Adresse; unlesbare Zeit wird NULL, beides mit Befund", () => {
        const payload = copy();
        const row = payload.siedlungen.find((entry) => entry["titel"] === "Gareth");
        if (!row) throw new Error("Gareth fehlt");
        row["wiki_url"] = "javascript:alert(1)";
        row["angereichert_am"] = "gestern";
        const result = transformWikiSettlements(payload);
        expect(result.rows.find((entry) => entry.wikiKey === "wiki:gareth")).toMatchObject({
            wikiUrl: null,
            wikiEnrichedAt: null,
        });
        const codes = result.findings.map((finding) => finding.code);
        expect(codes).toContain("link_scheme_rejected");
        expect(codes).toContain("x3_zeit_unlesbar");
    });

    it("🔴 die Linkziele der Standortkette (WI-0134): Ziel und Key wörtlich, in Quelltext-Reihenfolge, als Evidenz - kein Urteil, keine Bindung", () => {
        const result = transformWikiSettlements(copy());
        expect(result.linksDelivered).toBe(true);
        expect(result.links.get("wiki:arenaviertel")).toEqual([
            { position: 0, targetRaw: "Gareth", targetKey: "wiki:gareth" },
            { position: 1, targetRaw: "Arenaviertel", targetKey: "wiki:arenaviertel" },
        ]);
        // Zwei Orte in einer Kette, einer durch die Weiterleitungstafel, einer in einem Namensraum: beide stehen, keiner gewinnt.
        expect(result.links.get("wiki:reichsstrasse-3")).toEqual([
            { position: 0, targetRaw: "Havena (Siedlung)", targetKey: "wiki:havena" },
            { position: 1, targetRaw: "Inoffiziell:Kleewiesen", targetKey: "wiki:inoffiziell-kleewiesen" },
        ]);
        // Jede gespeicherte Zeile nennt ihren Satz, auch den leeren: so verschwindet, was Legacy aus der Kette nimmt.
        expect(result.links.get("wiki:gareth")).toEqual([]);
        expect([...result.links.keys()].sort()).toEqual(result.rows.map((row) => row.wikiKey).sort());
        // Ein Ziel ohne Key bleibt ohne Key; nichts wird aus dem Titel gerechnet.
        const payload = copy();
        const arena = payload.siedlungen.find((row) => row["titel"] === "Arenaviertel");
        (arena?.["standort_links"] as Bag[])[1] = { ziel: "Arenaviertel", ziel_key: null };
        expect(transformWikiSettlements(payload).links.get("wiki:arenaviertel")?.[1]).toEqual({
            position: 1,
            targetRaw: "Arenaviertel",
            targetKey: null,
        });
    });

    it("X3 ohne Linkziele (vor WI-0134): die genannten Orte bleiben unberührt, ein Befund, kein Tor", () => {
        const payload = copy();
        for (const row of payload.siedlungen) delete row["standort_links"];
        const kopf = payload["kopf"] as Bag;
        delete kopf["standort_linkziele"];
        delete kopf["standort_linkziele_ohne_schluessel"];
        const result = transformWikiSettlements(payload);
        expect(result.skipped).toBe(false);
        expect(result.linksDelivered).toBe(false);
        expect(result.links.size).toBe(0);
        expect(result.findings.map((finding) => finding.code)).toEqual([
            "registry_nur_per_name_platziert",
            "x3_ohne_standort_links",
        ]);
    });

    it("hält X3 gegen X2 desselben Zuges: gleiche Stände sind still, verschiedene ein Befund", () => {
        const { stamps } = transformWikiSettlements(copy());
        const x2 = { ok: true, map_revision: 812, aliase_stempel: FIXTURE["aliase_stempel"], objekte: [] };
        expect(crossStampFindings(stamps, x2)).toEqual([]);
        expect(crossStampFindings(stamps, { ...x2, map_revision: 813 }).map((finding) => finding.code)).toEqual([
            "x3_x2_stand",
        ]);
        expect(crossStampFindings(stamps, undefined)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------------------------------------------------------------------
// Gegen PostgreSQL
// ---------------------------------------------------------------------------------------------------------------------------------------

const PLACE = (n: number): string => `89000000-0000-4000-8000-${n.toString().padStart(12, "0")}`;
const LEGACY_PLACE = /^11111111-1111-4111-8111-0+(\d+)$/;

/** Die Antwort mit eigenen Keys, Titeln und Orten: genau die Welt dieses Tests. */
function scoped(payload: Bag & { siedlungen: Bag[] }): Bag & { siedlungen: Bag[] } {
    const result = structuredClone(payload);
    for (const row of result.siedlungen) {
        row["titel"] = `WSR89 ${String(row["titel"])}`;
        row["wiki_key"] = String(row["wiki_key"]).replace(/^wiki:/, "wiki:wsr89-");
        const redirect = row["weiterleitung_auf"] as Bag | null;
        if (redirect) redirect["wiki_key"] = String(redirect["wiki_key"]).replace(/^wiki:/, "wiki:wsr89-");
        row["orte"] = (row["orte"] as string[]).map((id) => PLACE(Number(LEGACY_PLACE.exec(id)?.[1] ?? 0)));
        for (const link of (row["standort_links"] as Bag[] | undefined) ?? []) {
            if (typeof link["ziel_key"] === "string")
                link["ziel_key"] = link["ziel_key"].replace(/^wiki:/, "wiki:wsr89-");
        }
    }
    return result;
}

/** Die Orte und die Zuordnung X2, wie Legacy sie für die Fixture hält: 1 und 2 Gareth, 3 Havena, 5 (gelöscht) Ochsenblut, 6 Kleewiesen. */
async function insertWorld(database: Queryable): Promise<void> {
    const places: [number, string, boolean][] = [
        [1, "WSR89 Gareth", true],
        [2, "WSR89 Alt-Gareth", true],
        [3, "WSR89 Havena", true],
        // 🔴 Derselbe NAME wie die Registry-Zeile, aber keine Zuweisung: das ist kein Kartenpunkt dieser Siedlung.
        [4, "WSR89 Trallop", true],
        [5, "WSR89 Ochsenblut", false],
        [6, "WSR89 Kleewiesen am Ort", true],
    ];
    for (const [n, name, active] of places) {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${PLACE(n)}, 'aventuria', ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${890 + n}, 890), 0), 'test', ${active})
        `;
    }
    const assignments: [number, string][] = [
        [1, "wiki:wsr89-gareth"],
        [2, "wiki:wsr89-gareth"],
        [3, "wiki:wsr89-havena"],
        [5, "wiki:wsr89-baronie-ochsenblut"],
        [6, "wiki:wsr89-inoffiziell-kleewiesen"],
    ];
    for (const [n, key] of assignments) {
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES ('siedlung', ${PLACE(n)}, ${key})
        `;
    }
}

async function cleanWorld(database: Queryable): Promise<void> {
    // Die genannten Orte (WI-0134, 0099) hängen an der Registry-Zeile: zuerst sie.
    await database.unsafe(
        `DELETE FROM wiki_settlement_registry_named_place
          WHERE registry_id IN (SELECT id FROM wiki_settlement_registry WHERE wiki_key LIKE 'wiki:wsr89-%')`,
    );
    await database.unsafe(`DELETE FROM wiki_settlement_registry WHERE wiki_key LIKE 'wiki:wsr89-%'`);
    await database.unsafe(`DELETE FROM wiki_key_assignment WHERE wiki_key LIKE 'wiki:wsr89-%'`);
    await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '89000000-%'`);
    try {
        await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'wiki-settlements'`);
    } catch {
        // Hängt noch eine fremde Zeile daran, bleibt der Lauf stehen - dieselbe Vorsicht wie in den Nachbartests.
    }
}

describeWithDatabase("Die Wiki-Siedlungsregistry gegen PostgreSQL", () => {
    let database: Database;
    const payload = scoped(FIXTURE as Bag & { siedlungen: Bag[] });

    beforeAll(async () => {
        // 🪤 Ein kleiner Pool: der gemeinsame Entwicklungscluster lässt nur 50 Verbindungen zu.
        database = createDatabase(testDatabaseUrl as string, { max: 2 });
        await migrate(database);
        await seedMapDomains(database);
        await cleanWorld(database);
        await insertWorld(database);
    }, 180_000);

    afterAll(async () => {
        await cleanWorld(database);
        await database.end({ timeout: 5 });
    });

    it("legt an, der zweite Lauf schreibt nichts, Fehlendes wird stillgelegt und kehrt zurück", async () => {
        const first = await importWikiSettlements(database, payload);
        expect(first.skipped).toBe(false);
        // 🪤 Kein `retired: 0` hier: Der Abgleich gilt der GANZEN Tabelle. Läge in der Testdatenbank eine fremde aktive Zeile (etwa von
        // einem Probelauf der CLI), legte dieser erste Lauf sie still - gemessen am 2026-10-10 im Wegwerf-Cluster.
        expect(first.tables.wiki_settlement_registry).toMatchObject({ created: 7, updated: 0 });

        const again = await importWikiSettlements(database, payload);
        expect(again.tables.wiki_settlement_registry).toMatchObject({
            created: 0,
            updated: 0,
            retired: 0,
            unchanged: 7,
        });
        expect(again.changed).toBe(false);

        const shorter = {
            ...payload,
            siedlungen: payload.siedlungen.filter((row) => row["titel"] !== "WSR89 Arenaviertel"),
        };
        const retired = await importWikiSettlements(database, shorter);
        expect(retired.tables.wiki_settlement_registry).toMatchObject({ retired: 1, unchanged: 6 });
        const [row] = await database<{ is_active: boolean; retired_origin: string | null }[]>`
            SELECT is_active, retired_origin FROM wiki_settlement_registry WHERE wiki_key = 'wiki:wsr89-arenaviertel'
        `;
        expect(row).toEqual({ is_active: false, retired_origin: "import" });

        const back = await importWikiSettlements(database, payload);
        expect(back.tables.wiki_settlement_registry).toMatchObject({ reappeared: 1 });
        expect(back.findings.map((finding) => finding.code)).toContain("row_reappeared");
    });

    /** Die gespeicherten genannten Orte einer Zeile dieses Tests, in ihrer Reihenfolge. */
    const namedOf = async (
        wikiKey: string,
    ): Promise<{ position: number; target_raw: string; target_key: string | null }[]> =>
        database<{ position: number; target_raw: string; target_key: string | null }[]>`
            SELECT n.position, n.target_raw, n.target_key
              FROM wiki_settlement_registry_named_place n JOIN wiki_settlement_registry r ON r.id = n.registry_id
             WHERE r.wiki_key = ${wikiKey} ORDER BY n.position
        `;

    it("🔴 speichert die Linkziele der Standortkette als genannte Orte (WI-0134); ein X3 ohne sie lässt sie stehen, eine geänderte Kette ersetzt sie", async () => {
        await importWikiSettlements(database, payload);
        expect(await namedOf("wiki:wsr89-arenaviertel")).toEqual([
            { position: 0, target_raw: "Gareth", target_key: "wiki:wsr89-gareth" },
            { position: 1, target_raw: "Arenaviertel", target_key: "wiki:wsr89-arenaviertel" },
        ]);
        expect(await namedOf("wiki:wsr89-reichsstrasse-3")).toEqual([
            { position: 0, target_raw: "Havena (Siedlung)", target_key: "wiki:wsr89-havena" },
            { position: 1, target_raw: "Inoffiziell:Kleewiesen", target_key: "wiki:wsr89-inoffiziell-kleewiesen" },
        ]);
        const again = await importWikiSettlements(database, payload);
        expect(again.tables.wiki_settlement_registry_named_place).toMatchObject({
            created: 0,
            retired: 0,
            unchanged: 4,
        });
        expect(again.changed).toBe(false);

        // X3 vor WI-0134: die genannten Orte bleiben, wie sie sind.
        const old = structuredClone(payload);
        for (const row of old.siedlungen) delete row["standort_links"];
        const before = await importWikiSettlements(database, old);
        expect(before.findings.map((finding) => finding.code)).toContain("x3_ohne_standort_links");
        expect(before.tables.wiki_settlement_registry_named_place).toMatchObject({ created: 0, retired: 0 });
        expect(await namedOf("wiki:wsr89-arenaviertel")).toHaveLength(2);

        // Legacy nimmt ein Ziel aus der Kette: der Satz der Zeile wird ersetzt, nicht angehäuft.
        const shorter = structuredClone(payload);
        const arena = shorter.siedlungen.find((row) => row["titel"] === "WSR89 Arenaviertel");
        if (!arena) throw new Error("Arenaviertel fehlt");
        arena["standort_links"] = [{ ziel: "Gareth", ziel_key: "wiki:wsr89-gareth" }];
        const replaced = await importWikiSettlements(database, shorter);
        expect(replaced.tables.wiki_settlement_registry_named_place).toMatchObject({ created: 1, retired: 2 });
        expect(await namedOf("wiki:wsr89-arenaviertel")).toEqual([
            { position: 0, target_raw: "Gareth", target_key: "wiki:wsr89-gareth" },
        ]);
        await importWikiSettlements(database, payload);
        expect(await namedOf("wiki:wsr89-arenaviertel")).toHaveLength(2);
    });

    it("speichert die Zeile Spalte für Spalte, Zeit naiv, und keine Spalte für „platziert“", async () => {
        const [row] = await database<Record<string, unknown>[]>`
            SELECT title, ns, ns_name, is_redirect, settlement_class, building_type_excluded, is_ruined, lage, has_coat,
                   to_char(wiki_fetched_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS') AS fetched
            FROM wiki_settlement_registry WHERE wiki_key = 'wiki:wsr89-gareth'
        `;
        expect(row).toEqual({
            title: "WSR89 Gareth",
            ns: 0,
            ns_name: "",
            is_redirect: false,
            settlement_class: "metropole",
            building_type_excluded: false,
            is_ruined: false,
            lage: "Garetien · Mittelreich",
            has_coat: true,
            fetched: "2026-09-08T12:00:00.123",
        });
        const columns = await database<{ column_name: string }[]>`
            SELECT column_name FROM information_schema.columns WHERE table_name = 'wiki_settlement_registry'
        `;
        const names = columns.map((column) => column.column_name);
        for (const forbidden of ["place_id", "on_map", "legacy_on_map", "coat_url", "match_key"]) {
            expect(names).not.toContain(forbidden);
        }
    });

    /** Die Wiki-Zeilen dieses Tests in der echten Ortsliste (`GET /api/editor/places`). */
    const wikiRows = async (): Promise<EditorPlaceRow[]> => {
        const list = await listEditorPlaces(database);
        expect(list.wikiListe).toBe(true);
        return list.rows.filter((row) => row.origin === "wiki" && row.key.startsWith("wiki:wsr89-"));
    };

    it("🔴 der Schlüssel einer Wiki-Siedlung IST ihr kanonischer Wiki-Key: keiner beginnt mit wiki:wiki:, jeder steht so in der Registry", async () => {
        const list = await listEditorPlaces(database);
        expect(list.rows.filter((row) => row.key.startsWith("wiki:wiki:")).map((row) => row.key)).toEqual([]);
        expect(new Set(list.rows.map((row) => row.key)).size).toBe(list.rows.length);
        const registry = new Set(
            (
                await database<{ wiki_key: string }[]>`
                    SELECT wiki_key FROM wiki_settlement_registry WHERE wiki_key LIKE 'wiki:wsr89-%' AND is_active
                `
            ).map((row) => row.wiki_key),
        );
        const ours = await wikiRows();
        expect(ours.length).toBeGreaterThan(0);
        for (const row of ours) expect(registry.has(row.key), row.key).toBe(true);
    });

    it("🔴 „Fehlt“ in der Ortsliste: nur über den Key gegen X2 und aktive Orte, nie über den Namen; die ausgeblendete Straße fehlt wie in Legacy", async () => {
        const ours = await wikiRows();
        expect(ours.map((row) => row.name)).toEqual([
            "WSR89 Arenaviertel",
            // Der einzige Ort hängt hier an einem STILLGELEGTEN Kartenpunkt: also fehlt die Siedlung.
            "WSR89 Baronie Ochsenblut",
            // Ein aktiver Ort trägt denselben Namen, aber nicht den Key.
            "WSR89 Trallop",
        ]);
        for (const row of ours) expect(Value.Check(EditorPlaceRow, row)).toBe(true);
        expect(ours.find((row) => row.name === "WSR89 Trallop")).toEqual({
            key: "wiki:wsr89-trallop",
            origin: "wiki",
            name: "WSR89 Trallop",
            circle: "leer",
            assignment: "none",
            subtype: "stadt",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Trallop", title: "WSR89 Trallop" },
        });
        // Leer bleibt weg; die Ruine und „Region, sonst Staat“ aus Legacys `lage`.
        expect(ours.find((row) => row.name === "WSR89 Arenaviertel")).toEqual({
            key: "wiki:wsr89-arenaviertel",
            origin: "wiki",
            name: "WSR89 Arenaviertel",
            circle: "leer",
            assignment: "none",
            subtype: "stadtviertel",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/Arenaviertel", title: "WSR89 Arenaviertel" },
            // „[[Gareth]]: [[Arenaviertel]]“: Gareth ist eine Siedlung der Karte (Key in X2), also innerorts (Legacys place-scope über Keys).
            within: "WSR89 Gareth",
            scope: "innerorts",
        });
        expect(ours.find((row) => row.name === "WSR89 Baronie Ochsenblut")).toMatchObject({ ruined: true });
        expect(editorPlacePublicId(ours[0] as EditorPlaceRow)).toBeUndefined();
    });

    it("🔴 Lage wie Legacy über Keys: ein Bauwerk auf der Karte trägt das Urteil seines Artikels; ohne Siedlung der Karte gilt außerorts", async () => {
        // Ein Kartenort mit dem Artikel des Arenaviertels (X2): dasselbe Urteil wie die Registry-Zeile, die Siedlung beim Titel ihres Artikels.
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${PLACE(7)}, 'aventuria', 'WSR89 Arena am Ort', 'gebaeude', ST_SetSRID(ST_MakePoint(897, 890), 0), 'test', TRUE)
        `;
        await database`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key) VALUES ('siedlung', ${PLACE(7)}, 'wiki:wsr89-arenaviertel')
        `;
        const arena = async () => (await listEditorPlaces(database)).rows.find((row) => row.key === PLACE(7));
        try {
            expect(await arena()).toMatchObject({ origin: "karte", within: "WSR89 Gareth", scope: "innerorts" });
            // Gareth nur noch als Bauwerk auf der Karte (keine Siedlungsgröße): kein Ort der Karte ist die Siedlung, also außerorts.
            await database`UPDATE place SET subtype = 'gebaeude' WHERE public_id IN (${PLACE(1)}, ${PLACE(2)})`;
            const ohne = await arena();
            expect(ohne?.scope).toBeUndefined();
            expect(ohne?.within).toBeUndefined();
        } finally {
            await database`UPDATE place SET subtype = 'dorf' WHERE public_id IN (${PLACE(1)}, ${PLACE(2)})`;
            await database`DELETE FROM wiki_key_assignment WHERE object_public_id = ${PLACE(7)}`;
            await database`DELETE FROM place WHERE public_id = ${PLACE(7)}`;
        }
    });

    it("eine Zuweisung, die verschwindet, macht die Siedlung zu „Fehlt“; eine stillgelegte Zeile und ein anderer Kontinent fehlen dort", async () => {
        // Gareth hängt an zwei Orten: erst wenn beide Zuweisungen fehlen, fehlt die Siedlung.
        await database`UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'import' WHERE object_public_id = ${PLACE(1)}`;
        try {
            expect((await wikiRows()).map((row) => row.name)).not.toContain("WSR89 Gareth");
            await database`UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'import' WHERE wiki_key = 'wiki:wsr89-gareth'`;
            const gareth = (await wikiRows()).find((row) => row.name === "WSR89 Gareth");
            // „Region, sonst Staat“: der erste Teil von Legacys „Garetien · Mittelreich“; das Wappen nennt nur die Registry.
            expect(gareth).toMatchObject({ subtype: "metropole", hasCoat: true, region: "Garetien" });
        } finally {
            await database`UPDATE wiki_key_assignment SET is_active = TRUE, retired_at = NULL, retired_origin = NULL WHERE wiki_key = 'wiki:wsr89-gareth'`;
        }
        await database`UPDATE wiki_settlement_registry SET is_active = FALSE, retired_at = now(), retired_origin = 'import' WHERE wiki_key = 'wiki:wsr89-trallop'`;
        await database`UPDATE wiki_settlement_registry SET continent = 'Myranor' WHERE wiki_key = 'wiki:wsr89-arenaviertel'`;
        try {
            expect((await wikiRows()).map((row) => row.name)).toEqual(["WSR89 Baronie Ochsenblut"]);
        } finally {
            await database`UPDATE wiki_settlement_registry SET is_active = TRUE, retired_at = NULL, retired_origin = NULL WHERE wiki_key = 'wiki:wsr89-trallop'`;
            await database`UPDATE wiki_settlement_registry SET continent = NULL WHERE wiki_key = 'wiki:wsr89-arenaviertel'`;
        }
    });

    it("der Prüfer: Parität bestanden, Legacys Orte gleich X2 hier, die Wirkung als Zahl; eine fehlende Zuweisung ist ein Befund, kein Tor", async () => {
        const report = await verifyWikiSettlements(database, payload);
        expect(report.passed).toBe(true);
        const byName = new Map(report.checks.map((entry) => [entry.name, entry]));
        for (const name of ["counts", "rows", "structure", "placement", "effect", "standort_links", "genannte_orte"]) {
            expect(byName.get(name)?.passed, name).toBe(true);
        }
        // Evidenz als Zahl, keine Bindung: zwei Zeilen tragen einen Standort; die Prüfung über die rohe Adresse ist ersetzt.
        expect(byName.get("genannte_orte")?.detail).toContain("2 Wiki-Siedlungen mit Standort");
        expect(byName.get("staetten_overlap")).toBeUndefined();

        await database`DELETE FROM wiki_key_assignment WHERE wiki_key = 'wiki:wsr89-inoffiziell-kleewiesen'`;
        const drifted = await verifyWikiSettlements(database, payload);
        expect(drifted.passed).toBe(true);
        const placement = drifted.checks.find((entry) => entry.name === "placement");
        expect(placement?.passed).toBe(false);
        expect(placement?.blocking).toBe(false);
        expect(placement?.offenders?.[0]).toContain("wiki:wsr89-inoffiziell-kleewiesen");
    });

    it("ein Probelauf schreibt nichts, auch kein Journal; eine leere Antwort legt nichts still", async () => {
        const before = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'wiki-settlements'`;
        const dry = await importWikiSettlements(database, { ...payload, siedlungen: [] }, { dryRun: true });
        expect(dry.skipped).toBe(true);
        const probe = await importWikiSettlements(
            database,
            { ...payload, siedlungen: payload.siedlungen.slice(0, 1) },
            { dryRun: true },
        );
        expect(probe.tables.wiki_settlement_registry.retired).toBe(6);
        const after = await database<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'wiki-settlements'`;
        expect(after[0]?.n).toBe(before[0]?.n);
        const active = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM wiki_settlement_registry WHERE wiki_key LIKE 'wiki:wsr89-%' AND is_active
        `;
        expect(active[0]?.n).toBe(7);
    });
});
