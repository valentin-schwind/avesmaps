import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { Finding } from "../src/findings.ts";
import { coatRightsOutcome, planCoat, readCoat, type CoatFacts } from "../src/migration/territory-coat.ts";
import { importTerritoryDetails } from "../src/migration/territory-details-import.ts";
import {
    DETAIL_FIELDS,
    transformTerritoryDetails,
    type DetailTerritory,
    type TerritoryDetailIndex,
} from "../src/migration/territory-details.ts";
import { verifyTerritoryDetails } from "../src/migration/verify-territory-details.ts";

/**
 * Gebietsdetails und Wappenzustand (WI-0063 P3, Migration 0076, Vertrag `territory-details.yaml`, Export E4): erst die reine Umwandlung
 * mit kleinen Antworten in der Form der Beispielantwort von Legacy (`docs/legacy-exporte/political-territories-export.beispiel.json`,
 * Mirror `024e3af3d`, gekürzt, mit UUID statt der Testkennungen), dann Import, Idempotenz, bewusste Leerwerte, Stilllegen, Schutz der
 * Zeilen des Editors und der Prüfer gegen echtes PostgreSQL.
 *
 * 🔴 Der Wappenzustand wird nur durchgerechnet: kein Test legt eine Medienzeile an, und der Import schreibt keine.
 */

type Bag = Record<string, unknown>;

const id = (n: number): string => `76000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = id(1);
const KEINS = id(2);
const BARONIE = id(3);
const WIKIKOPIE = id(4);
const EXTERN = id(5);
const GESPERRT = id(6);
const ZWISCHEN = id(7);
const EIGEN = id(8);
const UNBEKANNT = id(9);
const STILL = id(10);

const emptyDetail = (): Bag => Object.fromEntries(DETAIL_FIELDS.map((field) => [field, null]));

const coat = (over: Bag = {}): Bag => ({
    state: "undecided",
    source: null,
    origin: null,
    url: null,
    license_status: null,
    license: null,
    author: null,
    attribution: null,
    public: false,
    shown: false,
    ...over,
});

const territory = (publicId: string, name: string, over: Bag = {}): Bag => ({
    public_id: publicId,
    name,
    type: "Baronie",
    status: "",
    wiki_key: `wiki:${name.toLowerCase().replace(/\W+/g, "-")}`,
    wiki_url: "",
    coat_of_arms_url: "",
    coat_license_status: "",
    coat_origin: "",
    detail: emptyDetail(),
    detail_overrides: [],
    coat: coat(),
    ...over,
});

/** Die Gebiete der Beispielantwort, erweitert um jeden Wappenfall. */
function fixture(): Bag {
    return {
        ok: true,
        map_revision: 812,
        territories_revision: "pt-97e772d5ee6d4fd2",
        territories: [
            territory(REICH, "R76T Reich", {
                type: "Kaiserreich",
                coat_of_arms_url: "https://de.wiki-aventurica.de/images/reich.png",
                coat_license_status: "public_domain",
                coat_origin: "wiki",
                detail: {
                    ...emptyDetail(),
                    continent: "Aventurien",
                    founded_text: "900 BF",
                    dissolved_text: "besteht",
                    form_of_government: "Monarchie",
                    ruler: "Kaiserin Rohaja",
                    language: "",
                    population: "1 Mio.",
                },
                detail_overrides: ["founded_text", "dissolved_text", "ruler", "language"],
                coat: coat({
                    state: "undecided",
                    source: "staging",
                    origin: "wiki_localized",
                    url: "https://de.wiki-aventurica.de/images/reich.png",
                    license_status: "public_domain",
                    license: "public domain",
                    author: "Beispiel-Zeichner",
                    public: true,
                    shown: true,
                }),
            }),
            territory(KEINS, "R76T Keins", { coat: coat({ state: "none" }) }),
            territory(BARONIE, "R76T Baronie", {
                coat_of_arms_url: "/uploads/wappen/r76t-baronie-custom.png?v=1767225600",
                coat_license_status: "public_domain",
                coat_origin: "own",
                coat: coat({
                    state: "set",
                    source: "override",
                    origin: "custom",
                    url: "/uploads/wappen/r76t-baronie-custom.png",
                    license_status: "public_domain",
                    public: true,
                    shown: true,
                }),
            }),
            territory(WIKIKOPIE, "R76T Wikikopie", {
                coat_of_arms_url: "/uploads/wappen/r76t-wikikopie.png?v=1767225600",
                coat_license_status: "cc_by",
                coat_origin: "own",
                coat: coat({
                    state: "set",
                    source: "territory",
                    origin: "wiki_localized",
                    url: "/uploads/wappen/r76t-wikikopie.png",
                    license_status: "cc_by",
                    license: "CC BY-SA 3.0",
                    author: "Wiki-Zeichner",
                    public: true,
                    shown: true,
                }),
            }),
            territory(EXTERN, "R76T Extern", {
                coat: coat({
                    state: "set",
                    source: "territory",
                    origin: "wiki_staging",
                    url: "https://de.wiki-aventurica.de/images/extern.png",
                    license_status: "ai_generated",
                    public: true,
                    shown: false,
                }),
            }),
            territory(GESPERRT, "R76T Gesperrt", { coat: coat({ state: "set" }) }),
            territory(ZWISCHEN, "R76T Zwischenspeicher", {
                coat: coat({
                    state: "set",
                    source: "territory",
                    origin: "wiki_localized",
                    url: "/uploads/wappen/cache/0123456789abcdef.png",
                    license_status: "unknown_other",
                    public: true,
                    shown: true,
                }),
            }),
            territory(EIGEN, "R76T Eigener Knoten", {
                wiki_key: "eigener-knoten:r76t",
                detail: { ...emptyDetail(), ruler: "Von Hand gesetzt", geographic: "" },
                detail_overrides: ["ruler", "geographic"],
            }),
            territory(UNBEKANNT, "R76T Unbekannt", {
                detail: { ...emptyDetail(), ruler: "Gibt es hier nicht" },
                detail_overrides: ["ruler"],
            }),
            territory(STILL, "R76T Stillgelegt", { detail: { ...emptyDetail(), founder: "Fremder Gründer" } }),
        ],
        geometries: [],
        claims: [],
    };
}

function index(): TerritoryDetailIndex {
    const row = (n: number, name: string, active = true): [string, DetailTerritory] => [
        id(n),
        // Der eigene Knoten hat keinen Wiki-Artikel und damit keinen Schnappschuss (Migration 0162).
        {
            id: String(n),
            publicId: id(n),
            name,
            active,
            wikiKey: n === 8 ? `eigener-knoten:r76t-${String(n)}` : `wiki:r76t-${String(n)}`,
        },
    ];
    return new Map([
        row(1, "R76T Reich"),
        row(2, "R76T Keins"),
        row(3, "R76T Baronie"),
        row(4, "R76T Wikikopie"),
        row(5, "R76T Extern"),
        row(6, "R76T Gesperrt"),
        row(7, "R76T Zwischenspeicher"),
        row(8, "R76T Eigener Knoten"),
        // 9 fehlt ganz, 10 ist stillgelegt
        row(10, "R76T Stillgelegt", false),
    ]);
}

const find = (findings: readonly Finding[], code: string): Finding | undefined =>
    findings.find((finding) => finding.code === code);

describe("Gebietsdetails: die reine Umwandlung der Gebietsantwort von E4", () => {
    it("übernimmt die 17 Felder mit Herkunft je Feld: Liste detail_overrides gleich override, Text daneben gleich wiki, null gleich kein Wert", () => {
        const result = transformTerritoryDetails(fixture(), index());
        expect(result.detailPart).toBe("applied");
        const reich = result.details.find((row) => row.territoryPublicId === REICH);
        expect(reich?.values).toEqual({
            continent: "Aventurien",
            founded_text: "900 BF",
            dissolved_text: "besteht",
            form_of_government: "Monarchie",
            capital_name: null,
            seat_name: null,
            ruler: "Kaiserin Rohaja",
            language: "",
            currency: null,
            population: "1 Mio.",
            founder: null,
            political: null,
            trade_zone: null,
            trade_goods: null,
            geographic: null,
            blazon: null,
            affiliation_raw: null,
        });
        expect(reich?.origins).toEqual({
            continent: "wiki",
            founded_text: "override",
            dissolved_text: "override",
            form_of_government: "wiki",
            ruler: "override",
            language: "override",
            population: "wiki",
        });
    });

    it("🔴 der Wiki-Schnappschuss (0162): Herkunft wiki gibt den Wert, override „unbekannt“, kein Wert „das Wiki kennt nichts“; kein eigener Knoten", () => {
        const result = transformTerritoryDetails(fixture(), index());
        const reich = result.snapshots.find((row) => row.wikiKey === "wiki:r76t-1");
        expect(reich?.values).toEqual({
            ...Object.fromEntries(DETAIL_FIELDS.map((field) => [field, null])),
            continent: "Aventurien",
            form_of_government: "Monarchie",
            population: "1 Mio.",
        });
        // Auch der bewusste Leerwert (language) ist ein eigener Wert: Sein Wiki-Wert ist unbekannt, nicht leer.
        expect(reich?.unknown).toEqual(["founded_text", "dissolved_text", "ruler", "language"]);
        const keins = result.snapshots.find((row) => row.wikiKey === "wiki:r76t-2");
        expect(Object.values(keins?.values ?? {}).every((value) => value === null)).toBe(true);
        expect(keins?.unknown).toEqual([]);
        // Je bekanntem aktivem Gebiet mit detail und Artikel einer: nicht der eigene Knoten, nicht das unbekannte, nicht das stillgelegte.
        expect(result.snapshots.map((row) => row.wikiKey).sort()).toEqual(
            [1, 2, 3, 4, 5, 6, 7].map((n) => `wiki:r76t-${String(n)}`),
        );
    });

    it("🔴 der bewusste Leerwert bleibt leer und wird nie NULL; ein Feld ohne Wert hat keinen Vermerk", () => {
        const result = transformTerritoryDetails(fixture(), index());
        const reich = result.details.find((row) => row.territoryPublicId === REICH);
        expect(reich?.values.language).toBe("");
        expect(reich?.origins.language).toBe("override");
        expect(reich?.values.currency).toBeNull();
        expect(reich?.origins.currency).toBeUndefined();
        expect(result.fieldCounts.language).toEqual({ values: 0, empty: 1, missing: 9 });
        // Der leere Override am eigenen Knoten.
        const own = result.details.find((row) => row.territoryPublicId === EIGEN);
        expect(own?.values.geographic).toBe("");
        expect(own?.origins.geographic).toBe("override");
        expect(find(result.findings, "detail_empty_override_kept")?.numbers).toEqual({ language: 1, geographic: 1 });
        expect(find(result.findings, "detail_for_own_node")?.numbers["gebiete"]).toBe(1);
    });

    it("eine Zeile gibt es nur mit mindestens einem Feld (auch dem leeren); Unbekanntes und Stillgelegtes wird nicht gespeichert, aber gemeldet", () => {
        const result = transformTerritoryDetails(fixture(), index());
        expect(result.details.map((row) => row.territoryPublicId).sort()).toEqual([REICH, EIGEN].sort());
        const notFound = find(result.findings, "detail_territory_not_found");
        expect(notFound?.objects.map((object) => object.publicId).sort()).toEqual([UNBEKANNT, STILL].sort());
        // Die Zahlen der Quelle zählen alle Gebiete mit detail, auch die nicht gespeicherten.
        expect(result.withDetail).toBe(10);
        expect(result.fieldCounts.ruler).toEqual({ values: 3, empty: 0, missing: 7 });
    });

    it("🔴 Widersprüche in der Antwort: Marker ohne Wert, Leerwert ohne Marker, unbekannte Felder, Wikimarkup, kein Text", () => {
        const payload = fixture();
        const reich = (payload["territories"] as Bag[])[0] as Bag;
        reich["detail"] = {
            ...emptyDetail(),
            continent: "[[Aventurien]]",
            founded_text: "",
            ruler: null,
            population: 1000000,
            erfundenes_feld: "x",
        };
        reich["detail_overrides"] = ["ruler", "gibt_es_nicht"];
        const result = transformTerritoryDetails(payload, index());
        const row = result.details.find((entry) => entry.territoryPublicId === REICH);
        // Ein Marker ohne Wert ist kein Wert; ein Leerwert ohne Marker wird NULL; eine Zahl ist kein Text.
        expect(row?.values.ruler).toBeNull();
        expect(row?.values.founded_text).toBeNull();
        expect(row?.values.population).toBeNull();
        // Wikimarkup wird gemeldet und NICHT repariert.
        expect(row?.values.continent).toBe("[[Aventurien]]");
        expect(row?.origins.continent).toBe("wiki");
        expect(find(result.findings, "wikitext_residue")?.numbers).toEqual({ continent: 1 });
        expect(find(result.findings, "detail_override_marker_inconsistent")?.objectCount).toBe(1);
        expect(find(result.findings, "detail_empty_without_override")?.objectCount).toBe(1);
        expect(find(result.findings, "detail_value_not_text")?.objectCount).toBe(1);
        expect(find(result.findings, "detail_field_unknown")?.notes).toEqual([
            "detail: erfundenes_feld",
            "detail_overrides: gibt_es_nicht",
        ]);
    });

    it("fehlt die Liste detail_overrides ganz (älterer Export): ein Text ohne Herkunftsvermerk, ein leerer Wert gilt als Override", () => {
        const payload = fixture();
        const reich = (payload["territories"] as Bag[])[0] as Bag;
        delete reich["detail_overrides"];
        const result = transformTerritoryDetails(payload, index());
        const row = result.details.find((entry) => entry.territoryPublicId === REICH);
        expect(row?.values.continent).toBe("Aventurien");
        expect(row?.origins.continent).toBeUndefined();
        expect(row?.origins.language).toBe("override");
        expect(find(result.findings, "detail_origin_not_delivered")?.objectCount).toBeGreaterThan(0);
    });

    it("🔴 ein älterer Export ohne detail und coat schreibt nichts und meldet es (kein Tor)", () => {
        const payload = fixture();
        for (const row of payload["territories"] as Bag[]) {
            delete row["detail"];
            delete row["detail_overrides"];
            delete row["coat"];
        }
        const result = transformTerritoryDetails(payload, index());
        expect(result.detailPart).toBe("block_missing");
        expect(result.coatPart).toBe("block_missing");
        expect(result.details).toEqual([]);
        expect(result.findings.filter((finding) => finding.code === "source_block_missing")).toHaveLength(2);
        for (const unusable of [null, "x", { ok: true }, { territories: [] }]) {
            expect(transformTerritoryDetails(unusable, index()).detailPart).toBe("block_missing");
        }
    });

    it("nur ein Teil der Gebiete trägt detail: gemeldet, die übrigen gelten als ohne", () => {
        const payload = fixture();
        delete ((payload["territories"] as Bag[])[1] as Bag)["detail"];
        const result = transformTerritoryDetails(payload, index());
        expect(result.detailPart).toBe("applied");
        expect(find(result.findings, "source_detail_partial")?.numbers).toMatchObject({
            objekt: "detail",
            mit: 9,
            gebiete: 10,
        });
    });

    it("rechnet den Wappenzustand durch: Unterdrückung, Bindung oder keine Zeile, nichts wird geschrieben", () => {
        const result = transformTerritoryDetails(fixture(), index());
        expect(result.coatPart).toBe("planned");
        const planOf = (publicId: string) => result.coats.find((plan) => plan.territoryPublicId === publicId);
        // Ausdrücklich keins: Unterdrückung (Rolle coat).
        expect(planOf(KEINS)?.outcome).toEqual({ kind: "suppression" });
        // Ein Upload: Bindung mit Herkunft legacy und der Schlüssel aus Gebiet, Herkunft und Adresse ohne ?v=.
        expect(planOf(BARONIE)?.outcome).toEqual({
            kind: "binding",
            bindingOrigin: "legacy",
            legacyMediaKey: `territory-coat:${BARONIE}:custom:/uploads/wappen/r76t-baronie-custom.png`,
            fileHint: "uploads",
        });
        // Eine lokalisierte Wiki-Kopie: Herkunft wiki_localized, nie eigene Kreation.
        expect(planOf(WIKIKOPIE)?.outcome).toMatchObject({
            kind: "binding",
            bindingOrigin: "wiki_localized",
            fileHint: "uploads",
        });
        // Eine Datei nur im Wiki: nichts wird nachgeladen.
        expect(planOf(EXTERN)?.outcome).toEqual({ kind: "none", reason: "external_unlocalized" });
        // Unter nicht öffentlicher Lizenz: keine Adresse, keine Bindung aus E4.
        expect(planOf(GESPERRT)?.outcome).toEqual({ kind: "none", reason: "set_without_file" });
        // Der Wappen-Zwischenspeicher: gebunden, aber als Zwischenspeicher-Herkunft gekennzeichnet.
        expect(planOf(ZWISCHEN)?.outcome).toMatchObject({ kind: "binding", fileHint: "cache_path" });
        expect(planOf(ZWISCHEN)?.notes).toContain("coat_cache_path_source");
        // Ohne Entscheid, aber mit bekanntem Wiki-Wappen: keine Zeile, gemeldet, nichts geraten (Legacy zeigt es hier sogar).
        expect(planOf(REICH)?.outcome).toEqual({ kind: "none", reason: "undecided_wiki_candidate" });
        expect(planOf(EIGEN)?.outcome).toEqual({ kind: "none", reason: "undecided" });

        const summary = result.coatSummary;
        expect(summary).toMatchObject({
            undecided: 4,
            none: 1,
            set: 5,
            setCustom: 1,
            setWikiLocalized: 2,
            setWikiStaging: 1,
            suppressions: 1,
            bindings: 3,
            undecidedWikiCandidate: 1,
            undecidedWikiCandidateShown: 1,
        });
        expect(summary.undecided + summary.none + summary.set).toBe(result.coats.length);
        expect(summary.suppressions + summary.bindings + summary.omitted).toBe(result.coats.length);
        expect(find(result.findings, "coat_state_summary")?.numbers).toMatchObject({ set: 5, none: 1, undecided: 4 });
        expect(find(result.findings, "coat_set_without_file")?.objects.map((object) => object.publicId)).toEqual([
            GESPERRT,
        ]);
        expect(find(result.findings, "coat_external_unlocalized")?.objects.map((object) => object.publicId)).toEqual([
            EXTERN,
        ]);
        expect(
            find(result.findings, "coat_undecided_with_wiki_candidate")?.objects.map((object) => object.publicId),
        ).toEqual([REICH]);
        expect(find(result.findings, "coat_not_shown")?.objects.map((object) => object.publicId)).toEqual([EXTERN]);
    });

    it("nach media.yaml nicht automatisch öffentliche Wappen stehen mit Lizenz im Befund coat_rights_pending", () => {
        const result = transformTerritoryDetails(fixture(), index());
        const pending = find(result.findings, "coat_rights_pending");
        // cc_by (Wikikopie), unknown_other (Zwischenspeicher) und das Wappen unter nicht öffentlicher Lizenz (Gesperrt); ai_generated ist
        // eine ausdrückliche Einstufung und automatisch öffentlich.
        expect(pending?.numbers).toEqual({ cc_by: 1, unknown_other: 1, "(nicht genannt)": 1 });
        expect(coatRightsOutcome("ai_generated").automatic).toBe(true);
        expect(coatRightsOutcome("public_domain").automatic).toBe(true);
        expect(coatRightsOutcome("permission_granted").automatic).toBe(false);
        expect(coatRightsOutcome("etwas_neues").reason).toContain("unbekannter Lizenzcode");
    });

    it("liest ein unbekanntes coat.state als undecided (nie als keins) und meldet unbekannte Herkunft", () => {
        const read = readCoat({ state: "kaputt", origin: "irgendwo", source: "woher", url: 7 });
        expect(read.coat?.state).toBe("undecided");
        expect(read.coat?.origin).toBeNull();
        expect(read.problems.sort()).toEqual(["origin_unknown", "source_unknown", "state_unknown", "url_not_text"]);
        expect(readCoat(undefined).coat).toBeNull();
        expect(readCoat("x").coat).toBeNull();
        // Ein gesetztes Wappen mit unbekannter Herkunft bekommt keine Bindung.
        const plan = planCoat(
            REICH,
            readCoat(coat({ state: "set", url: "/uploads/wappen/x.png", public: true })).coat as CoatFacts,
        );
        expect(plan.outcome).toEqual({ kind: "none", reason: "origin_unknown" });
        // Ein widersprüchliches „keins“ mit Adresse: der strengere Zustand gilt.
        const none = planCoat(REICH, readCoat(coat({ state: "none", url: "/uploads/wappen/x.png" })).coat as CoatFacts);
        expect(none.outcome).toEqual({ kind: "suppression" });
        expect(none.notes).toContain("coat_none_with_url");
    });
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase(
    "Gebietsdetails: Import, Idempotenz, Stilllegen und Prüfer gegen PostgreSQL (Migration 0076)",
    () => {
        let database: Database;

        async function clean(): Promise<void> {
            const mine = `public_id::text LIKE '76000000-%'`;
            await database.unsafe(
                `DELETE FROM wiki_territory_snapshot_unknown WHERE snapshot_id IN (SELECT id FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:r76t-%')`,
            );
            await database.unsafe(`DELETE FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:r76t-%'`);
            await database.unsafe(
                `DELETE FROM territory_detail_field_origin WHERE territory_detail_id IN (SELECT id FROM territory_detail WHERE territory_id IN (SELECT id FROM territory WHERE ${mine}))`,
            );
            await database.unsafe(
                `DELETE FROM territory_detail WHERE territory_id IN (SELECT id FROM territory WHERE ${mine})`,
            );
            await database.unsafe(`DELETE FROM territory WHERE ${mine}`);
            try {
                // Die Läufe der Tests; hängt noch eine Zeile daran, bleibt der Lauf stehen.
                await database.unsafe(`DELETE FROM migration_run WHERE data_domain = 'territory-details'`);
            } catch {
                // ein Fremdschlüssel hält ihn: stehen lassen
            }
        }

        beforeAll(async () => {
            database = createDatabase(testDatabaseUrl as string);
            await migrate(database);
            await clean();
        }, 180_000);

        afterAll(async () => {
            await clean();
            await database.end({ timeout: 5 });
        });

        beforeEach(async () => {
            await clean();
            const insert = async (
                n: number,
                name: string,
                over: { active?: boolean; coatRef?: string; wikiKey?: string } = {},
            ): Promise<void> => {
                await database`
                INSERT INTO territory (public_id, map_domain_id, name, color, opacity, wiki_key, is_active, source_system, coat_ref)
                VALUES (${id(n)}, 'aventuria', ${name}, '#B2B065', 0.7, ${over.wikiKey ?? `wiki:r76t-${String(n)}`}, ${over.active ?? true}, 'test', ${over.coatRef ?? null})
            `;
            };
            await insert(1, "R76T Reich", { coatRef: "https://de.wiki-aventurica.de/images/reich.png?v=1" });
            await insert(2, "R76T Keins");
            await insert(3, "R76T Baronie", { coatRef: "/uploads/wappen/r76t-baronie-custom.png?v=1767225600" });
            await insert(4, "R76T Wikikopie");
            await insert(5, "R76T Extern");
            await insert(6, "R76T Gesperrt");
            await insert(7, "R76T Zwischenspeicher");
            await insert(8, "R76T Eigener Knoten", { wikiKey: "eigener-knoten:r76t-8" });
            await insert(10, "R76T Stillgelegt", { active: false });
        });

        const details = async (): Promise<
            {
                public_id: string;
                state: string;
                ruler: string | null;
                language: string | null;
                geographic: string | null;
                continent: string | null;
            }[]
        > =>
            database`
            SELECT t.public_id::text, d.state, d.ruler, d.language, d.geographic, d.continent
            FROM territory_detail d JOIN territory t ON t.id = d.territory_id
            WHERE t.public_id::text LIKE '76000000-%' ORDER BY t.public_id
        `;
        const origins = async (publicId: string): Promise<string[]> =>
            (
                await database<{ field: string; origin: string }[]>`
                SELECT o.field, o.origin FROM territory_detail_field_origin o
                JOIN territory_detail d ON d.id = o.territory_detail_id JOIN territory t ON t.id = d.territory_id
                WHERE t.public_id = ${publicId} ORDER BY o.field
            `
            ).map((row) => `${row.field}=${row.origin}`);

        it("schreibt die Detailzeilen mit Herkunft je Feld, den Leerwert als leeren Text und NICHTS für den Wappenzustand; der zweite Lauf ändert nichts", async () => {
            const first = await importTerritoryDetails(database, fixture());
            expect(first.skipped).toBe(false);
            expect(first.tables.territory_detail).toMatchObject({ created: 2, updated: 0, unchanged: 0, retired: 0 });
            expect(first.tables.territory_detail_field_origin).toMatchObject({ created: 9, retired: 0 });
            expect(first.stored).toBe(2);
            expect(first.changed).toBe(true);

            const rows = await details();
            expect(rows.map((row) => row.public_id)).toEqual([REICH, EIGEN]);
            const reich = rows.find((row) => row.public_id === REICH);
            // Der bewusste Leerwert ist '' (nicht NULL), ein Feld ohne Wert ist NULL.
            expect(reich?.language).toBe("");
            expect(reich?.ruler).toBe("Kaiserin Rohaja");
            expect(reich?.geographic).toBeNull();
            expect(await origins(REICH)).toEqual([
                "continent=wiki",
                "dissolved_text=override",
                "form_of_government=wiki",
                "founded_text=override",
                "language=override",
                "population=wiki",
                "ruler=override",
            ]);
            expect(await origins(EIGEN)).toEqual(["geographic=override", "ruler=override"]);
            // Kein Medienbezug, keine Änderung an den alten Wappenspalten.
            const [media] = await database<{ n: number }[]>`
            SELECT (SELECT count(*) FROM territory_media_suppression s JOIN territory t ON t.id = s.territory_id WHERE t.public_id::text LIKE '76000000-%')::int
                 + (SELECT count(*) FROM territory_media m JOIN territory t ON t.id = m.territory_id WHERE t.public_id::text LIKE '76000000-%')::int AS n
        `;
            expect(media?.n).toBe(0);
            const [column] = await database<
                { coat_ref: string }[]
            >`SELECT coat_ref FROM territory WHERE public_id = ${BARONIE}`;
            expect(column?.coat_ref).toBe("/uploads/wappen/r76t-baronie-custom.png?v=1767225600");
            // Die Abbildung des Wappenzustands steht im Bericht, durchgerechnet.
            expect(first.coatSummary).toMatchObject({ none: 1, suppressions: 1, bindings: 3 });

            const second = await importTerritoryDetails(database, fixture());
            expect(second.tables.territory_detail).toMatchObject({ created: 0, updated: 0, unchanged: 2, retired: 0 });
            expect(second.tables.territory_detail_field_origin).toMatchObject({ created: 0, retired: 0, unchanged: 9 });
            expect(second.changed).toBe(false);
        });

        /** Die Schnappschüsse der Testgebiete: Artikel → Werte mit Text und die Felder „unbekannt“. */
        const snapshots = async (
            sql: Queryable = database,
        ): Promise<Record<string, { werte: Record<string, string>; unbekannt: string[] }>> => {
            const rows = await sql<
                (Record<string, string | null> & { wiki_key: string; unbekannt: string[] | null })[]
            >`
                SELECT s.*, (SELECT array_agg(u.field ORDER BY u.field) FROM wiki_territory_snapshot_unknown u WHERE u.snapshot_id = s.id) AS unbekannt
                FROM wiki_territory_snapshot s WHERE s.wiki_key LIKE 'wiki:r76t-%' AND s.is_active ORDER BY s.wiki_key
            `;
            return Object.fromEntries(
                rows.map((row) => [
                    row.wiki_key,
                    {
                        werte: Object.fromEntries(
                            DETAIL_FIELDS.flatMap((field) =>
                                row[field] == null ? [] : [[field, row[field] as string]],
                            ),
                        ),
                        unbekannt: row.unbekannt ?? [],
                    },
                ]),
            );
        };

        it("🔴 der Wiki-Schnappschuss (0162): je Artikel eine Zeile, Wiki-Werte und „unbekannt“, nichts für den eigenen Knoten; der zweite Lauf ändert nichts", async () => {
            const first = await importTerritoryDetails(database, fixture());
            expect(first.tables.wiki_territory_snapshot).toMatchObject({ created: 7, updated: 0, retired: 0 });
            expect(first.tables.wiki_territory_snapshot_unknown).toMatchObject({ created: 4, retired: 0 });
            const stand = await snapshots();
            expect(Object.keys(stand)).toEqual([1, 2, 3, 4, 5, 6, 7].map((n) => `wiki:r76t-${String(n)}`));
            expect(stand["wiki:r76t-1"]).toEqual({
                werte: { continent: "Aventurien", form_of_government: "Monarchie", population: "1 Mio." },
                unbekannt: ["dissolved_text", "founded_text", "language", "ruler"],
            });
            expect(stand["wiki:r76t-2"]).toEqual({ werte: {}, unbekannt: [] });
            const second = await importTerritoryDetails(database, fixture());
            expect(second.tables.wiki_territory_snapshot).toMatchObject({
                created: 0,
                updated: 0,
                unchanged: 7,
                retired: 0,
            });
            expect(second.tables.wiki_territory_snapshot_unknown).toMatchObject({
                created: 0,
                retired: 0,
                unchanged: 4,
            });
            expect(second.changed).toBe(false);

            // Legacy nimmt den Override von ruler zurück: der Wiki-Wert ist dann bekannt, „unbekannt“ schrumpft.
            const changed = fixture();
            const reich = (changed["territories"] as Bag[])[0] as Bag;
            reich["detail_overrides"] = ["founded_text", "dissolved_text", "language"];
            const third = await importTerritoryDetails(database, changed);
            expect(third.tables.wiki_territory_snapshot.updated).toBe(1);
            expect((await snapshots())["wiki:r76t-1"]).toEqual({
                werte: {
                    continent: "Aventurien",
                    form_of_government: "Monarchie",
                    population: "1 Mio.",
                    ruler: "Kaiserin Rohaja",
                },
                unbekannt: ["dissolved_text", "founded_text", "language"],
            });
        });

        /** Die zwei Anweisungen der einmaligen Füllung, wörtlich aus Migration 0162. */
        const fuellung = (): string[] => {
            const sql = readFileSync(
                fileURLToPath(new URL("../migrations/0162_wiki_territory_snapshot.sql", import.meta.url)),
                "utf8",
            );
            return sql
                .slice(sql.indexOf("-- EINMALIGE FÜLLUNG"))
                .split(/;\s*\n/u)
                .map((teil) => teil.replace(/^\s*--.*$/gmu, "").trim())
                .filter((teil) => teil !== "");
        };
        /** Führt `arbeit` in einer Transaktion aus, die danach zurückrollt: Die geteilte Testdatenbank bleibt, wie sie war. */
        const zurueckgerollt = async <T>(arbeit: (tx: Queryable) => Promise<T>): Promise<T> => {
            class Zurueck extends Error {}
            let ergebnis: T | undefined;
            await database
                .begin(async (tx) => {
                    ergebnis = await arbeit(tx);
                    throw new Zurueck();
                })
                .catch((error: unknown) => {
                    if (!(error instanceof Zurueck)) throw error;
                });
            return ergebnis as T;
        };
        const zaehle = async (tx: Queryable): Promise<{ zeilen: number; unbekannt: number }> => {
            const [z] = await tx<{ zeilen: number; unbekannt: number }[]>`
                SELECT (SELECT count(*) FROM wiki_territory_snapshot)::int AS zeilen,
                       (SELECT count(*) FROM wiki_territory_snapshot_unknown)::int AS unbekannt
            `;
            return z!;
        };

        it("🔴 die einmalige Füllung der Migration 0162 aus den eigenen Tafeln ergibt dasselbe wie der Import; ein zweiter Lauf ändert nichts", async () => {
            await importTerritoryDetails(database, fixture());
            const ausImport = await snapshots();
            const anweisungen = fuellung();
            expect(anweisungen).toHaveLength(2);
            const lauf = await zurueckgerollt(async (tx) => {
                // Ohne die Zeilen des Imports füllt die Migration sie neu.
                await tx.unsafe(
                    `DELETE FROM wiki_territory_snapshot_unknown WHERE snapshot_id IN (SELECT id FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:r76t-%')`,
                );
                await tx.unsafe(`DELETE FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:r76t-%'`);
                for (const anweisung of anweisungen) await tx.unsafe(anweisung);
                const erster = { stand: await snapshots(tx), zahlen: await zaehle(tx) };
                // Derselbe Lauf noch einmal: keine neue Zeile, kein neues „unbekannt“, kein geänderter Wert (ON CONFLICT DO NOTHING).
                const neu: number[] = [];
                for (const anweisung of anweisungen) neu.push((await tx.unsafe(anweisung)).count);
                return { erster, neu, zweiter: { stand: await snapshots(tx), zahlen: await zaehle(tx) } };
            });
            // Gebiete ohne Detailzeile bekommen aus der Füllung eine leere Zeile, wie aus dem Import (das Wiki kennt nichts).
            expect(lauf.erster.stand).toEqual(ausImport);
            expect(lauf.neu).toEqual([0, 0]);
            expect(lauf.zweiter).toEqual(lauf.erster);
        });

        it("🔴 ohne territory_detail läuft die Füllung der Migration 0162 ohne Fehler durch: kein Wert, kein „unbekannt“", async () => {
            const lauf = await zurueckgerollt(async (tx) => {
                // Eine Datenbank, in der der Gebietsdetail-Import (E4) nie lief: keine Detailzeile, kein Vermerk, kein Schnappschuss.
                await tx.unsafe(`DELETE FROM wiki_territory_snapshot_unknown`);
                await tx.unsafe(`DELETE FROM wiki_territory_snapshot`);
                await tx.unsafe(`DELETE FROM territory_detail_field_origin`);
                await tx.unsafe(`DELETE FROM territory_detail`);
                for (const anweisung of fuellung()) await tx.unsafe(anweisung);
                const [werte] = await tx<{ mit_wert: number; artikel: number }[]>`
                    SELECT count(*) FILTER (WHERE num_nonnulls(
                               continent, founded_text, dissolved_text, form_of_government, capital_name, seat_name, ruler, language,
                               currency, population, founder, political, trade_zone, trade_goods, geographic, blazon, affiliation_raw
                           ) > 0)::int AS mit_wert,
                           (SELECT count(DISTINCT wiki_key) FROM territory WHERE is_active AND wiki_key LIKE 'wiki:_%')::int AS artikel
                    FROM wiki_territory_snapshot
                `;
                return { zahlen: await zaehle(tx), werte: werte! };
            });
            // Je Artikel höchstens eine Zeile ohne jeden Wert („das Wiki kennt nichts“), nie ein erfundener Wert, nie „unbekannt“.
            expect(lauf.werte.mit_wert).toBe(0);
            expect(lauf.zahlen.unbekannt).toBe(0);
            expect(lauf.zahlen.zeilen).toBe(lauf.werte.artikel);
        });

        it("🔴 NULL und der leere Text sind verschieden: aus '' wird NULL (und umgekehrt) eine Änderung, nie stillschweigend gleich", async () => {
            await importTerritoryDetails(database, fixture());
            const changed = fixture();
            const reich = (changed["territories"] as Bag[])[0] as Bag;
            // Der Override wird entfernt: der Wiki-Wert tritt wieder ein (Legacy), das Feld ist nicht mehr leer.
            reich["detail"] = { ...(reich["detail"] as Bag), language: "Garethi" };
            reich["detail_overrides"] = ["founded_text", "dissolved_text", "ruler"];
            const report = await importTerritoryDetails(database, changed);
            expect(report.tables.territory_detail.updated).toBe(1);
            expect((await details()).find((row) => row.public_id === REICH)?.language).toBe("Garethi");
            expect(await origins(REICH)).toContain("language=wiki");
            // Und zurück zum bewussten Leerwert.
            const back = await importTerritoryDetails(database, fixture());
            expect(back.tables.territory_detail.updated).toBe(1);
            expect((await details()).find((row) => row.public_id === REICH)?.language).toBe("");
            expect(await origins(REICH)).toContain("language=override");
        });

        it("verliert ein Gebiet alle Felder, wird die Zeile stillgelegt (Felder und Vermerke geleert), nie gelöscht; sie kehrt zurück", async () => {
            await importTerritoryDetails(database, fixture());
            const lost = fixture();
            const reich = (lost["territories"] as Bag[])[0] as Bag;
            reich["detail"] = emptyDetail();
            reich["detail_overrides"] = [];
            const retired = await importTerritoryDetails(database, lost);
            expect(retired.tables.territory_detail.retired).toBe(1);
            expect(retired.tables.territory_detail_field_origin.retired).toBe(7);
            expect(retired.findings.some((finding) => finding.code === "stilllegequote")).toBe(true);
            const [row] = await database<
                {
                    state: string;
                    is_active: boolean;
                    retired_origin: string | null;
                    continent: string | null;
                    language: string | null;
                }[]
            >`
            SELECT d.state, d.is_active, d.retired_origin, d.continent, d.language
            FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = ${REICH}
        `;
            expect(row).toEqual({
                state: "retired",
                is_active: false,
                retired_origin: "import",
                continent: null,
                language: null,
            });
            expect(await origins(REICH)).toEqual([]);
            // Ein zweiter Lauf mit demselben Stand ändert nichts.
            expect((await importTerritoryDetails(database, lost)).changed).toBe(false);

            const back = await importTerritoryDetails(database, fixture());
            expect(back.tables.territory_detail.reappeared).toBe(1);
            expect(back.findings.some((finding) => finding.code === "row_reappeared")).toBe(true);
            expect((await details()).find((entry) => entry.public_id === REICH)?.state).toBe("active");
            expect(await origins(REICH)).toHaveLength(7);
        });

        it("🔴 eine Zeile, die der Editor unterdrückt hat (state suppressed), fasst der Import nie an", async () => {
            await importTerritoryDetails(database, fixture());
            await database`
            UPDATE territory_detail d
            SET state = 'suppressed', is_active = FALSE, retired_at = now(), retired_origin = 'editor', ruler = 'Redaktion'
            FROM territory t WHERE t.id = d.territory_id AND t.public_id = ${REICH}
        `;
            const report = await importTerritoryDetails(database, fixture());
            expect(report.tables.territory_detail.protectedRows).toBe(1);
            expect(report.findings.find((finding) => finding.code === "row_vs_decision")?.objects[0]?.publicId).toBe(
                REICH,
            );
            const reich = (await details()).find((row) => row.public_id === REICH);
            expect(reich).toMatchObject({ state: "suppressed", ruler: "Redaktion" });
            // Die Vermerke der gehaltenen Zeile bleiben ebenfalls stehen.
            expect((await origins(REICH)).length).toBeGreaterThan(0);
        });

        it("🔴 ein älterer Export ohne detail schreibt nichts und legt nichts still", async () => {
            await importTerritoryDetails(database, fixture());
            const old = fixture();
            for (const row of old["territories"] as Bag[]) {
                delete row["detail"];
                delete row["detail_overrides"];
                delete row["coat"];
            }
            const report = await importTerritoryDetails(database, old);
            expect(report.skipped).toBe(true);
            expect(report.changed).toBe(false);
            expect(report.findings.some((finding) => finding.code === "source_block_missing")).toBe(true);
            expect((await details()).filter((row) => row.state === "active")).toHaveLength(2);
        });

        it("🔴 ein Probelauf (dryRun) schreibt nichts, auch kein Journal", async () => {
            const [before] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'territory-details'`;
            const report = await importTerritoryDetails(database, fixture(), { dryRun: true });
            expect(report.dryRun).toBe(true);
            expect(report.tables.territory_detail.created).toBe(2);
            expect(await details()).toEqual([]);
            const [after] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM migration_run WHERE data_domain = 'territory-details'`;
            expect(after?.n).toBe(before?.n);
        });

        it("das Schema trägt keine Lizenz-, Datei- oder Wappenspalte und prüft den Leerwert nur mit Herkunft override (Prüfer)", async () => {
            const payload = fixture();
            await importTerritoryDetails(database, payload);
            const ok = await verifyTerritoryDetails(database, payload);
            expect(ok.skipped).toBe(false);
            expect(ok.checks.map((check) => `${check.name}:${String(check.passed)}`)).toEqual([
                "counts:true",
                "fields:true",
                "origin:true",
                "foreign_keys:true",
                "wiki_snapshot:true",
                "structure:true",
                "coat_mapping:true",
            ]);
            expect(ok.passed).toBe(true);
            // Die alten Spalten tragen für die Wikikopie nichts, E4 aber eine Adresse: Information.
            expect(
                ok.findings.find((finding) => finding.code === "coat_columns_superseded")?.numbers["abweichend"],
            ).toBeGreaterThan(0);

            // Der Leerwert ohne Herkunft override, ein Vermerk an einem Feld ohne Wert und eine veränderte Zeile.
            await database`
            DELETE FROM territory_detail_field_origin o USING territory_detail d, territory t
            WHERE d.id = o.territory_detail_id AND t.id = d.territory_id AND t.public_id = ${REICH} AND o.field = 'language'
        `;
            await database`
            INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
            SELECT d.id, 'currency', 'wiki' FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = ${REICH}
        `;
            await database`
            UPDATE territory_detail d SET ruler = 'Verändert' FROM territory t WHERE t.id = d.territory_id AND t.public_id = ${REICH}
        `;
            const broken = await verifyTerritoryDetails(database, payload);
            const failed = broken.checks.filter((check) => !check.passed).map((check) => check.name);
            expect(failed).toEqual(expect.arrayContaining(["fields", "origin"]));
            expect(broken.passed).toBe(true);
            expect(broken.checks.filter((check) => !check.passed).every((check) => check.blocking === false)).toBe(
                true,
            );

            const columns = await database<{ table_name: string; column_name: string }[]>`
            SELECT table_name, column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name IN ('territory_detail', 'territory_detail_field_origin')
        `;
            const names = columns.map((column) => column.column_name);
            for (const forbidden of [
                "coat_ref",
                "coat_state",
                "license_status",
                "license_text",
                "file_url",
                "storage_key",
                "author",
                "attribution",
            ]) {
                expect(names, forbidden).not.toContain(forbidden);
            }
        });

        it("der Prüfer hat bei einem älteren Export nichts zu prüfen", async () => {
            const report = await verifyTerritoryDetails(database, { ok: true, territories: [{ public_id: REICH }] });
            expect(report.skipped).toBe(true);
            expect(report.passed).toBe(true);
        });
    },
);
