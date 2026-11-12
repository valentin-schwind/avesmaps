import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    EDITOR_TERRITORIES_URL,
    EDITOR_TERRITORY_FINDINGS_URL,
    EditorTerritoryParentConsequences,
    EditorTerritoryDetail,
    EditorTerritoryFindings,
    EditorTerritoryForm,
    EditorTerritoryHierarchy,
    EditorTerritoryList,
    editorTerritoryCircles,
    editorTerritoryFormUrl,
    editorTerritoryHierarchyUrl,
    editorTerritoryHistoryUrl,
    MapHistoryPage,
    editorTerritoryParentConsequencesUrl,
    legacyDisplayByBand,
    mediaPublicUrl,
    type EditorTerritoryRow,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { deriveTerritories } from "../src/territories/derive.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";
import { insertPublishedFile } from "./support/media-fixture.ts";

/**
 * Der Lesepfad des Herrschaftsgebiete-Editors (WI-0209 Paket A1, EDIT-0005 §7) gegen echtes PostgreSQL (`avesmaps3d_test`).
 *
 * Paket A3 dazu: die Hierarchie eines Gebiets (Kette, Nachfahren, Flächen) und das Wappen im Detail. Paket C1: der Lesepfad des Modus
 * „Grenzen bearbeiten“ (Flächen eckig mit Revision, Kette, Nachbarn mit gemeinsamen Ecken, Kanten, Baronie unter einem abgeleiteten
 * Gebiet).
 *
 * Problemfälle: ein Besucher oder Tester liest den Baum; der Kreis folgt nicht Legacys Regel über die Untergebiete; ein Gebiet ohne
 * Fläche oder außerhalb des Anzeigejahrs fehlt; ein unveränderter Stand wird jedes Mal neu übertragen; der Sitz zeigt einen Namen statt
 * eines Verweises ins Leere; eine abgelaufene Fläche gilt als aktuell.
 * Soll: ab Reviewer, 401/403 vor jeder Abfrage, ● ◑ ◐ ○ je Beispiel, `ETag` mit 304 und neuem Wert nach einer Änderung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ID = (n: number): string => `77777781-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const G = {
    reich: ID(1),
    provinz: ID(2),
    baronie: ID(3),
    leereBaronie: ID(4),
    ganzReich: ID(5),
    ganzKind: ID(6),
    halbReich: ID(7),
    halbKind: ID(8),
    nichts: ID(9),
    vergangen: ID(10),
    nachbar: ID(11),
} as const;
const ORT = ID(0x200);
const WAPPEN_QUELLE = "test-wi0209-a3-wappen";
const SITZ_INS_LEERE = ID(0x201);

function gebiet(
    id: string,
    name: string,
    parent: string | null,
    band: [number, number],
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: id,
        name,
        short_name: "",
        type: "Baronie",
        wiki_type: "Baronie",
        parent_public_id: parent,
        status: "abhängige Provinz",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: band[0],
        max_zoom: band[1],
        valid_from_bf: 100,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: `wiki:${name}`,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-17 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
        ...extra,
    };
}
function flaeche(
    n: number,
    territory: string,
    x: number,
    extra: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        public_id: ID(0x100 + n),
        territory_public_id: territory,
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [x, 300],
                    [x + 30, 300],
                    [x + 30, 330],
                    [x, 330],
                    [x, 300],
                ],
            ],
        },
        valid_from_bf: null,
        valid_to_bf: null,
        min_zoom: null,
        max_zoom: null,
        updated_at: "2026-10-17 01:00:00",
        ...extra,
    };
}

/** Je ein Beispiel der vier Kreise, ein Gebiet außerhalb des Jahrs, Hauptstadt, Sitz ins Leere, eine verdrängte Fläche, ein Anspruch. */
function quelle(): LegacyTerritoryPayload {
    return {
        ok: true,
        map_revision: 1,
        territories_revision: "pt-fixture-editor",
        territories: [
            gebiet(G.reich, "A1 Reich", null, [0, 1], { type: "Kaiserreich", color: "#40a040" }),
            gebiet(G.provinz, "A1 Provinz", G.reich, [2, 3], { type: "Herzogtum" }),
            gebiet(G.baronie, "A1 Baronie", G.provinz, [4, 6], {
                wiki_url: "https://de.wiki-aventurica.de/wiki/A1_Baronie",
                capital_place_public_id: ORT,
                seat_place_public_id: SITZ_INS_LEERE,
                valid_label: "seit 100 BF",
            }),
            gebiet(G.leereBaronie, "A1 Leere Baronie", G.provinz, [4, 6]),
            gebiet(G.ganzReich, "A1 Ganzreich", null, [0, 1], { type: "Königreich" }),
            gebiet(G.ganzKind, "A1 Ganzkind", G.ganzReich, [2, 6]),
            gebiet(G.halbReich, "A1 Halbreich", null, [0, 6], { type: "Königreich" }),
            gebiet(G.halbKind, "A1 Halbkind", G.halbReich, [2, 6]),
            gebiet(G.nichts, "A1 Nichts", null, [0, 6]),
            gebiet(G.vergangen, "A1 Vergangen", null, [0, 6], { valid_to_bf: 1000 }),
            // C1: links neben der Baronie, die Kante x = 100 gemeinsam.
            gebiet(G.nachbar, "A1 Nachbar", null, [0, 6]),
        ],
        geometries: [
            // Die Baronie: eine abgelaufene Form und die jüngere, die sie verdrängt.
            flaeche(1, G.baronie, 100, { valid_from_bf: 0, valid_to_bf: 1000 }),
            flaeche(2, G.baronie, 100, { valid_from_bf: 1001 }),
            flaeche(3, G.ganzReich, 140),
            flaeche(4, G.ganzKind, 180),
            flaeche(5, G.halbReich, 220),
            flaeche(6, G.vergangen, 260),
            flaeche(7, G.nachbar, 70),
        ],
        claims: [
            { territory_public_id: G.leereBaronie, claimant_public_id: G.ganzReich, sort_order: 0, source: "wiki" },
        ],
    } as unknown as LegacyTerritoryPayload;
}

describeWithDatabase("Lesepfad des Herrschaftsgebiete-Editors (WI-0209 A1)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: ReturnType<typeof authFixture>;
    const cookies = new Map<Role, string>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
    };

    const get = (url: string, role?: Role, headers: Record<string, string> = {}) =>
        app.inject({
            method: "GET",
            url,
            headers: { ...headers, ...(role === undefined ? {} : { cookie: cookies.get(role) ?? "" }) },
        });

    async function aufraeumen(): Promise<void> {
        const eigene = `(SELECT id FROM territory WHERE public_id::text LIKE '77777781-%')`;
        const bilder = `(SELECT id FROM media_asset WHERE source_system = '${WAPPEN_QUELLE}')`;
        await database.unsafe(`DELETE FROM territory_media WHERE media_asset_id IN ${bilder}`);
        await database.unsafe(`DELETE FROM media_file WHERE media_asset_id IN ${bilder}`);
        await database.unsafe(`DELETE FROM media_asset WHERE id IN ${bilder}`);
        await database.unsafe(
            `DELETE FROM territory_detail_field_origin WHERE territory_detail_id IN (SELECT id FROM territory_detail WHERE territory_id IN ${eigene})`,
        );
        await database.unsafe(`DELETE FROM territory_detail WHERE territory_id IN ${eigene}`);
        await database.unsafe(
            `DELETE FROM wiki_territory_snapshot_unknown WHERE snapshot_id IN (SELECT id FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:A1 %')`,
        );
        await database.unsafe(`DELETE FROM wiki_territory_snapshot WHERE wiki_key LIKE 'wiki:A1 %'`);
        await database.unsafe(`DELETE FROM territory_border WHERE territory_id IN ${eigene}`);
        await database
            .unsafe(`DELETE FROM territory_capital_band WHERE territory_id IN ${eigene}`)
            .catch(() => undefined);
        await database
            .unsafe(`DELETE FROM territory_claim_shape WHERE territory_id IN ${eigene}`)
            .catch(() => undefined);
        await database.unsafe(`DELETE FROM territory_shape WHERE territory_id IN ${eigene}`);
        await database.unsafe(`DELETE FROM territory_display_area WHERE territory_id IN ${eigene}`);
        await database.unsafe(
            `DELETE FROM territory_claim WHERE territory_id IN ${eigene} OR claimant_id IN ${eigene}`,
        );
        await database.unsafe(`DELETE FROM territory_area WHERE public_id::text LIKE '77777781-%'`);
        await database.unsafe(`UPDATE territory SET parent_id = NULL WHERE public_id::text LIKE '77777781-%'`);
        await database.unsafe(`DELETE FROM territory WHERE public_id::text LIKE '77777781-%'`);
        await database.unsafe(`DELETE FROM place WHERE public_id::text LIKE '77777781-%'`);
        await database`DELETE FROM territory_state WHERE map_domain_id = 'aventuria' AND source_stamp = 'pt-fixture-editor'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor", "admin"] as const) {
            const person = await fixture.person(role, { name: `Gebietsliste ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${ORT}, 'aventuria', 'A1 Hauptdorf', 'dorf', ST_SetSRID(ST_MakePoint(115, 315), 0), 'test-wi0209-a1')
        `;
        await importTerritories(database, quelle());
        await deriveTerritories(database, { force: true });
        const [baronie] = await database<
            { id: string }[]
        >`SELECT id::text FROM territory WHERE public_id = ${G.baronie}`;
        const [detail] = await database<{ id: string }[]>`
            INSERT INTO territory_detail (territory_id, ruler, language, blazon)
            VALUES (${baronie!.id}::bigint, 'Baron Probe', 'Garethi', '') RETURNING id::text
        `;
        for (const [field, origin] of [
            ["ruler", "override"],
            ["language", "wiki"],
            ["blazon", "override"],
        ] as const) {
            await database`INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin) VALUES (${detail!.id}::bigint, ${field}, ${origin})`;
        }
        // Der Wiki-Stand (Migration 0162): language bekannt, blazon kennt das Wiki nicht, ruler unbekannt (Legacy-Override).
        const [stand] = await database<{ id: string }[]>`
            INSERT INTO wiki_territory_snapshot (wiki_key, language) VALUES ('wiki:A1 Baronie', 'Garethi') RETURNING id::text
        `;
        await database`INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field) VALUES (${stand!.id}::bigint, 'ruler')`;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const zeile = (list: EditorTerritoryList, id: string): EditorTerritoryRow | undefined =>
        list.rows.find((row) => row.id === id);

    it("🔴 Besucher 401, Tester 403; Reviewer und Editor lesen, privat und jedes Mal neu geprüft", async () => {
        const anonymous = await get(EDITOR_TERRITORIES_URL);
        expect([anonymous.statusCode, anonymous.json().error.code]).toEqual([401, "unauthenticated"]);
        expect(Value.Check(ApiErrorBody, anonymous.json())).toBe(true);
        const tester = await get(EDITOR_TERRITORIES_URL, "tester");
        expect([tester.statusCode, tester.json().error.code]).toEqual([403, "forbidden"]);
        expect((await get(`${EDITOR_TERRITORIES_URL}/${G.baronie}`, "tester")).statusCode).toBe(403);
        for (const role of ["reviewer", "editor"] as const) {
            const allowed = await get(EDITOR_TERRITORIES_URL, role);
            expect([role, allowed.statusCode]).toEqual([role, 200]);
            expect(allowed.headers["cache-control"]).toBe("private, no-cache");
            expect(String(allowed.headers["etag"])).toMatch(/^W\/"/);
            expect(Value.Check(EditorTerritoryList, allowed.json())).toBe(true);
        }
    });

    it("🔴 der Kreis nach Legacys Regel über die Untergebiete, in vier Zuständen", async () => {
        const list = (await get(EDITOR_TERRITORIES_URL, "editor")).json() as EditorTerritoryList;
        expect(list.yearBf).toBe(1049);
        const kreis = (id: string) => zeile(list, id)?.circle;
        // Ganzreich: eigene Fläche, das Kind auch → ●; Halbreich: eigene Fläche, das Kind nicht → ◑.
        expect([kreis(G.ganzReich), kreis(G.ganzKind), kreis(G.halbReich), kreis(G.halbKind)]).toEqual([
            "voll",
            "voll",
            "halb-rechts",
            "leer",
        ]);
        // Reich und Provinz: ohne eigene Fläche, nur ein Teil der Baronien auf der Karte → ◐; die leere Baronie ○.
        expect([kreis(G.reich), kreis(G.provinz), kreis(G.baronie), kreis(G.leereBaronie), kreis(G.nichts)]).toEqual([
            "halb",
            "halb",
            "voll",
            "leer",
            "leer",
        ]);
    });

    it("🔴 alle Gebiete stehen da, knapp: Elter, Spanne nach der Importregel, Farbe, Fläche, Jahr, Rahmen", async () => {
        const list = (await get(EDITOR_TERRITORIES_URL, "editor")).json() as EditorTerritoryList;
        expect(zeile(list, G.baronie)).toEqual({
            id: G.baronie,
            name: "A1 Baronie",
            type: "Baronie",
            parent: G.provinz,
            circle: "voll",
            area: true,
            minZoom: 4,
            maxZoom: 8,
            color: "#b2b065",
            wiki: "https://de.wiki-aventurica.de/wiki/A1_Baronie",
            order: 0,
            bounds: [100, 300, 130, 330],
        });
        // Ohne Fläche: kein `area`, kein Rahmen, aber in der Liste (○ im Baum, Frage 9).
        expect(zeile(list, G.nichts)).toEqual({
            id: G.nichts,
            name: "A1 Nichts",
            type: "Baronie",
            circle: "leer",
            minZoom: 0,
            maxZoom: 8,
            color: "#b2b065",
            order: 0,
        });
        // Außerhalb des Anzeigejahrs: steht da, die Karte zeigt es nie.
        expect(zeile(list, G.vergangen)).toMatchObject({ notInYear: true, area: true });
        expect(zeile(list, G.vergangen)).not.toHaveProperty("bounds");
        expect(zeile(list, G.reich)?.color).toBe("#40a040");
        // Das Reich zeigt in Band 0 und 1 die Baronie: Sein Rahmen ist der der Formen unter ihm.
        expect(zeile(list, G.reich)?.bounds).toEqual([100, 300, 130, 330]);
    });

    it("🔴 das Detail: Felder, Kette, Kinder, Hauptstadt als Ort, Sitz ins Leere, Detailfelder mit Herkunft, aktuelle Form, Ansprüche", async () => {
        const response = await get(`${EDITOR_TERRITORIES_URL}/${G.baronie}`, "reviewer");
        expect(response.statusCode).toBe(200);
        const detail = response.json() as EditorTerritoryDetail;
        expect(Value.Check(EditorTerritoryDetail, detail)).toBe(true);
        expect(detail).toMatchObject({
            id: G.baronie,
            name: "A1 Baronie",
            type: "Baronie",
            wikiType: "Baronie",
            status: "abhängige Provinz",
            color: "#b2b065",
            opacity: 0.7,
            minZoom: 4,
            maxZoom: 8,
            validFromBf: 100,
            validLabel: "seit 100 BF",
            parents: [
                { id: G.provinz, name: "A1 Provinz" },
                { id: G.reich, name: "A1 Reich" },
            ],
            children: [],
            capital: { id: ORT, name: "A1 Hauptdorf", kind: "dorf" },
            seat: { id: SITZ_INS_LEERE, missing: true },
            details: {
                ruler: { value: "Baron Probe", origin: "override" },
                language: { value: "Garethi", origin: "wiki", wiki: "Garethi" },
                // Der bewusste Leerwert eines Overrides bleibt erkennbar; das Wiki kennt hier nichts.
                blazon: { value: "", origin: "override", wiki: null },
            },
            claimedBy: [],
            claims: [],
        });
        expect(detail.details).not.toHaveProperty("continent");
        // Unbekannt heißt: kein Schlüssel wiki (nie null), damit der Baustein weder durchstreicht noch ↺ anbietet.
        expect(detail.details["ruler"]).not.toHaveProperty("wiki");
        // Jede Fläche trägt ihre Revision (B2 Teil 2): Konflikt und „Überschreiben“ der Form rücken auf sie.
        expect(detail.areas).toEqual([
            {
                id: ID(0x101),
                revision: 1,
                validFromBf: 0,
                validToBf: 1000,
                notInYear: true,
                bounds: [100, 300, 130, 330],
            },
            { id: ID(0x102), revision: 1, validFromBf: 1001, bounds: [100, 300, 130, 330] },
        ]);
        const leer = (
            await get(`${EDITOR_TERRITORIES_URL}/${G.leereBaronie}`, "editor")
        ).json() as EditorTerritoryDetail;
        expect(leer.claimedBy).toEqual([{ id: G.ganzReich, name: "A1 Ganzreich" }]);
        const ganz = (await get(`${EDITOR_TERRITORIES_URL}/${G.ganzReich}`, "editor")).json() as EditorTerritoryDetail;
        expect(ganz.claims).toEqual([{ id: G.leereBaronie, name: "A1 Leere Baronie" }]);
        expect(ganz.children).toEqual([{ id: G.ganzKind, name: "A1 Ganzkind" }]);
        expect((await get(`${EDITOR_TERRITORIES_URL}/${ID(0xfff)}`, "editor")).statusCode).toBe(404);
        // Ohne gebundenes Wappen steht keins da.
        expect(detail).not.toHaveProperty("hasCoat");
        expect(detail).not.toHaveProperty("coat");
    });

    it("🔴 das Wappen (A3, Frage 13): gebunden heißt `hasCoat`, die veröffentlichte Datei steht als Adresse da", async () => {
        const [bild] = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, technical_state, moderation_state, source_system, source_ref)
            VALUES ('image', 'legacy_import', 'ok', 'not_applicable', ${WAPPEN_QUELLE}, 'a3-wappen')
            RETURNING id::text
        `;
        await database`
            INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
            SELECT id, ${bild!.id}, 'coat', 'editor' FROM territory WHERE public_id = ${G.baronie}
        `;
        const lesen = async (): Promise<EditorTerritoryDetail> =>
            (await get(`${EDITOR_TERRITORIES_URL}/${G.baronie}`, "editor")).json() as EditorTerritoryDetail;
        const gebunden = await lesen();
        expect(gebunden.hasCoat).toBe(true);
        expect(gebunden).not.toHaveProperty("coat");
        const sha = "a3a3".padEnd(64, "0");
        await insertPublishedFile(database, bild!.id, "a3-wappen", { variant: "coat", sha });
        const veroeffentlicht = await lesen();
        expect(Value.Check(EditorTerritoryDetail, veroeffentlicht)).toBe(true);
        expect(veroeffentlicht).toMatchObject({ hasCoat: true, coat: mediaPublicUrl(sha) });
        await database`UPDATE territory_media SET retired_at = now() WHERE media_asset_id = ${bild!.id}`;
        const weg = await lesen();
        expect(weg).not.toHaveProperty("hasCoat");
        expect(weg).not.toHaveProperty("coat");
    });

    it("🔴 die Hierarchie (A3): ab Reviewer, Kette darüber, alle Nachfahren mit ihren Flächen, gepackt und mit ETag", async () => {
        const url = editorTerritoryHierarchyUrl(G.provinz);
        expect((await get(url)).statusCode).toBe(401);
        expect((await get(url, "tester")).statusCode).toBe(403);
        expect((await get(editorTerritoryHierarchyUrl(ID(0xfff)), "reviewer")).statusCode).toBe(404);
        const antwort = await get(url, "reviewer");
        expect(antwort.statusCode).toBe(200);
        const daten = antwort.json() as EditorTerritoryHierarchy;
        expect(Value.Check(EditorTerritoryHierarchy, daten)).toBe(true);
        expect(daten.yearBf).toBe(1049);
        const [oben] = await database<{ band: number }[]>`SELECT max(band)::int AS band FROM territory_display_area`;
        expect(daten.derivedMaxBand).toBe(oben?.band);
        // Die Kette über der Provinz trägt `above`; darunter beide Baronien, auch die ohne Fläche.
        const nach = new Map(daten.territories.map((t) => [t.id, t]));
        expect([...nach.keys()].sort()).toEqual([G.reich, G.provinz, G.baronie, G.leereBaronie].sort());
        expect(nach.get(G.reich)).toMatchObject({ above: true, minZoom: 0, maxZoom: 1, color: "#40a040" });
        expect(nach.get(G.provinz)).toMatchObject({ parent: G.reich, minZoom: 2, maxZoom: 3, type: "Herzogtum" });
        expect(nach.get(G.provinz)).not.toHaveProperty("above");
        expect(nach.get(G.baronie)).toMatchObject({ parent: G.provinz, minZoom: 4, maxZoom: 8, validFromBf: 100 });
        // D2: Gegen diese Revision speichert „Zoombänder bearbeiten“; die Kette darüber ändert der Reiter nicht und trägt keine.
        expect(nach.get(G.baronie)?.revision).toBeGreaterThan(0);
        expect(nach.get(G.reich)).not.toHaveProperty("revision");
        // Die Flächen der Nachfahren, auch die abgelaufene (die Regel entscheidet über die aktuelle Form), nie die der Kette.
        expect(daten.areas.map((a) => a.id).sort()).toEqual([ID(0x101), ID(0x102)]);
        expect(daten.areas.find((a) => a.id === ID(0x101))).toMatchObject({ territory: G.baronie, validToBf: 1000 });
        const etag = String(antwort.headers["etag"]);
        expect((await get(url, "reviewer", { "if-none-match": etag })).statusCode).toBe(304);
        // Packen tut Nginx (Block E): die Route antwortet ungepackt, auch auf Wunsch.
        const roh = await get(url, "reviewer", { "accept-encoding": "gzip" });
        expect(roh.headers["content-encoding"]).toBeUndefined();
        expect(roh.json()).toEqual(daten);
    });

    it("🔴 D6 „Prüfen“: ab Reviewer, im Vertrag; der Sitz ins Leere ist ein Befund, keine Sperre", async () => {
        expect((await get(EDITOR_TERRITORY_FINDINGS_URL, "tester")).statusCode).toBe(403);
        const antwort = await get(EDITOR_TERRITORY_FINDINGS_URL, "reviewer");
        expect(antwort.statusCode).toBe(200);
        const daten = antwort.json() as EditorTerritoryFindings;
        expect(Value.Check(EditorTerritoryFindings, daten)).toBe(true);
        expect(daten.findings).toContainEqual({
            territory: G.baronie,
            kind: "verweis",
            field: "seat",
            place: SITZ_INS_LEERE,
        });
        expect(antwort.headers["etag"]).toBeDefined();
    });

    it("🔴 D1 die Folgen von „Umhängen“: ab Reviewer, im Vertrag; unter ein eigenes Untergebiet ist ein Kreis; ein unbekanntes Ziel 400", async () => {
        expect((await get(editorTerritoryParentConsequencesUrl(G.provinz, ""), "tester")).statusCode).toBe(403);
        const antwort = await get(editorTerritoryParentConsequencesUrl(G.provinz, ""), "reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        const daten = antwort.json() as EditorTerritoryParentConsequences;
        expect(Value.Check(EditorTerritoryParentConsequences, daten)).toBe(true);
        expect(daten).toMatchObject({ id: G.provinz, from: { id: G.reich, name: "A1 Reich" }, kreis: false });
        expect(daten.to).toBeUndefined();
        expect(daten.descendants).toBeGreaterThan(0);
        const kreis = (await get(editorTerritoryParentConsequencesUrl(G.provinz, G.baronie), "reviewer")).json();
        expect(kreis).toMatchObject({ kreis: true, changes: [] });
        expect((await get(editorTerritoryParentConsequencesUrl(G.provinz, ID(0x999)), "reviewer")).statusCode).toBe(
            400,
        );
        expect((await get(`/api/editor/territories/${G.provinz}/reparent?parent=kaputt`, "reviewer")).statusCode).toBe(
            400,
        );
        expect((await get(editorTerritoryParentConsequencesUrl(ID(0x998), ""), "reviewer")).statusCode).toBe(404);
    });

    it("🔴 D5 der Verlauf: ab Reviewer, im Vertrag, privat; ein unbekanntes Gebiet 404", async () => {
        expect((await get(editorTerritoryHistoryUrl(G.baronie), "tester")).statusCode).toBe(403);
        const antwort = await get(editorTerritoryHistoryUrl(G.baronie), "reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(antwort.headers["cache-control"]).toBe("private, no-cache");
        expect(Value.Check(MapHistoryPage, antwort.json())).toBe(true);
        expect((await get(editorTerritoryHistoryUrl(ID(0x997)), "reviewer")).statusCode).toBe(404);
    });

    it("🔴 aus der Hierarchie rechnet die Regel für jede Fläche darunter, was die Ableitung zeigt (N2 im Teilbaum)", async () => {
        const daten = (await get(editorTerritoryHierarchyUrl(G.reich), "editor")).json() as EditorTerritoryHierarchy;
        const regel = legacyDisplayByBand(
            {
                territories: daten.territories.map((t) => ({
                    publicId: t.id,
                    name: t.name,
                    shortName: t.shortName ?? "",
                    parentPublicId: t.parent ?? null,
                    minZoom: t.minZoom ?? null,
                    maxZoom: t.maxZoom ?? null,
                    validFromBf: t.validFromBf ?? null,
                    validToBf: t.validToBf ?? null,
                })),
                geometries: daten.areas.map((a) => ({
                    publicId: a.id,
                    territoryPublicId: a.territory,
                    minZoom: a.minZoom ?? null,
                    maxZoom: a.maxZoom ?? null,
                    validFromBf: a.validFromBf ?? null,
                    validToBf: a.validToBf ?? null,
                })),
            },
            daten.yearBf,
            8,
            (band) => Math.max(0, Math.min(band, daten.derivedMaxBand)),
        );
        const abgeleitet = await database<{ band: number; area: string; territory: string }[]>`
            SELECT da.band::int AS band, a.public_id::text AS area, t.public_id::text AS territory
              FROM territory_display_area da
              JOIN territory_area a ON a.id = da.area_id
              JOIN territory t ON t.id = da.territory_id
             WHERE a.public_id = ANY(${daten.areas.map((a) => a.id)}::uuid[])
        `;
        for (let band = 0; band <= 8; band++) {
            const ab = Math.min(band, daten.derivedMaxBand);
            const erwartet = new Map(abgeleitet.filter((z) => z.band === ab).map((z) => [z.area, z.territory]));
            expect([band, Object.fromEntries(regel[band]!)]).toEqual([band, Object.fromEntries(erwartet)]);
        }
        // Gezeigt wird in Band 0 und 1 das Reich, in 2 und 3 die Provinz, ab 4 die Baronie.
        expect(regel.map((b) => b.get(ID(0x102)))).toEqual([
            G.reich,
            G.reich,
            G.provinz,
            G.provinz,
            G.baronie,
            G.baronie,
            G.baronie,
            G.baronie,
            G.baronie,
        ]);
    });

    it("🔴 C1 „Grenzen bearbeiten“: eckige Flächen des Jahrs mit Revision, Kette, Nachbar mit gemeinsamer Ecke ganz, Kanten im Kasten", async () => {
        expect((await get(editorTerritoryFormUrl(G.baronie), "reviewer")).statusCode).toBe(403);
        // Ein Editor ebenso: Die Form kommt ab Admin oder mit der Sonderrolle (WI-0279, Paket 6).
        expect((await get(editorTerritoryFormUrl(G.baronie), "editor")).statusCode).toBe(403);
        const antwort = await get(editorTerritoryFormUrl(G.baronie), "admin");
        expect(antwort.statusCode).toBe(200);
        const form = antwort.json() as EditorTerritoryForm;
        expect(Value.Check(EditorTerritoryForm, form)).toBe(true);
        expect(form).toMatchObject({ id: G.baronie, name: "A1 Baronie", margin: 15 });
        expect(form).not.toHaveProperty("requested");
        expect(form.parents.map((p) => p.id)).toEqual([G.provinz, G.reich]);
        // Nur die Form, die im Anzeigejahr gilt; die verdrängte fehlt.
        expect(form.areas.map((a) => a.id)).toEqual([ID(0x102)]);
        expect(form.areas[0]!.revision).toBeGreaterThanOrEqual(1);
        expect(form.areas[0]!.polygons).toEqual([
            [
                [
                    [100, 300],
                    [130, 300],
                    [130, 330],
                    [100, 330],
                ],
            ],
        ]);
        expect(form.neighbors.map((n) => [n.id, n.territory, n.name])).toEqual([[ID(0x107), G.nachbar, "A1 Nachbar"]]);
        // Kanten: das Ganzreich (x 140 bis 170) liegt im Kasten 85 bis 145, der Nachbar steht ganz da und nicht noch einmal.
        const kanten = new Set(form.edges.map((e) => e.areaId));
        expect(kanten.has(ID(0x103))).toBe(true);
        expect(kanten.has(ID(0x107))).toBe(false);
        expect(kanten.has(ID(0x102))).toBe(false);
    });

    it("🔴 C1 Frage 2: am Reich mit Punkt die Baronie darunter; ohne Punkt nichts zu bearbeiten; unbekannt 404", async () => {
        const darunter = (
            await get(editorTerritoryFormUrl(G.reich, { x: 115, y: 315 }), "admin")
        ).json() as EditorTerritoryForm;
        expect(darunter).toMatchObject({ id: G.baronie, requested: { id: G.reich, name: "A1 Reich" } });
        expect(darunter.areas.map((a) => a.id)).toEqual([ID(0x102)]);
        const ohne = (await get(editorTerritoryFormUrl(G.reich), "admin")).json() as EditorTerritoryForm;
        expect(ohne).toMatchObject({ id: G.reich, areas: [], neighbors: [], edges: [] });
        // Ein Punkt außerhalb jeder Fläche darunter lässt es beim verlangten.
        expect(
            ((await get(editorTerritoryFormUrl(G.reich, { x: 5, y: 5 }), "admin")).json() as EditorTerritoryForm).id,
        ).toBe(G.reich);
        expect((await get(editorTerritoryFormUrl(ID(0x999)), "admin")).statusCode).toBe(404);
    });

    it("🔴 ETag: 304 bei unverändertem Stand, ein neuer Wert nach einer Änderung", async () => {
        const erste = await get(EDITOR_TERRITORIES_URL, "editor");
        const etag = String(erste.headers["etag"]);
        const wieder = await get(EDITOR_TERRITORIES_URL, "editor", { "if-none-match": etag });
        expect(wieder.statusCode).toBe(304);
        await database`UPDATE territory SET name = 'A1 Baronie (neu)' WHERE public_id = ${G.baronie}`;
        try {
            const neu = await get(EDITOR_TERRITORIES_URL, "editor", { "if-none-match": etag });
            expect(neu.statusCode).toBe(200);
            expect(String(neu.headers["etag"])).not.toBe(etag);
        } finally {
            await database`UPDATE territory SET name = 'A1 Baronie' WHERE public_id = ${G.baronie}`;
        }
    });
});

describe("Legacys Kreis über die Untergebiete (rein)", () => {
    it("ein Zyklus im Baum endet, statt endlos zu laufen", () => {
        const kreise = editorTerritoryCircles(
            ["a", "b"],
            (id) => (id === "a" ? ["b"] : ["a"]),
            (id) => id === "b",
        );
        expect([...kreise.keys()].sort()).toEqual(["a", "b"]);
    });
});
