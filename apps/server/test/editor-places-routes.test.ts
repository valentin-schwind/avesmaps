import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    ApiErrorBody,
    EDITOR_PLACES_URL,
    EDITOR_PLACE_KINDS_URL,
    EditorPlaceDetail,
    EditorPlaceKindList,
    EditorPlaceList,
    editorPlacePublicId,
    mediaPublicUrl,
    type EditorPlaceRow,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { staetteKey } from "../src/editor/places.ts";
import { TEST_AUTH, authFixture } from "./support/auth-fixture.ts";
import { insertPublishedFile } from "./support/media-fixture.ts";

/**
 * Der Lesepfad der Ortsliste (WI-0128 E4, EDIT-0001 §7.1 E4) gegen echtes PostgreSQL (`avesmaps3d_test`, nie die geteilte
 * Testwelt).
 *
 * Problemfälle: ein Besucher oder Tester liest die Liste; ein verborgener Ort fehlt dem Editor; der Kreis stimmt nicht (eine
 * bloße Adresse zählt als Artikel); ein unveränderter Stand wird jedes Mal neu übertragen, ein geänderter nicht. Soll: ab
 * Reviewer, 401/403 vor jeder Abfrage, ● ◐ je Zuordnung, `ETag` mit 304 und neuem Wert nach einer Änderung.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const ORT = {
    zugeordnet: "e4e4e4e4-0000-4000-8000-000000000001",
    adresse: "e4e4e4e4-0000-4000-8000-000000000002",
    verborgen: "e4e4e4e4-0000-4000-8000-000000000003",
} as const;
const SOURCE = "test-wi0128-e4";
const WIKI_KEY = "wi0128-e4-probe";
/** Der Eintrag des Tempels in Legacys Registry (X3), kanonischer Key mit Namensraum wie X1/X2. */
const REGISTRY_KEY = "wiki:wi0128-e4-probe-tempel";

describeWithDatabase("Ortsliste des Ortseditors (WI-0128 E4)", { timeout: 120_000 }, () => {
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

    const get = (role?: Role, headers: Record<string, string> = {}) =>
        app.inject({
            method: "GET",
            url: EDITOR_PLACES_URL,
            headers: { ...headers, ...(role === undefined ? {} : { cookie: cookies.get(role) ?? "" }) },
        });

    async function aufraeumen(): Promise<void> {
        const bilder = database`SELECT id FROM media_asset WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place_media WHERE media_asset_id IN (${bilder})`;
        await database`DELETE FROM media_file WHERE media_asset_id IN (${bilder})`;
        await database`DELETE FROM media_asset WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM settlement_place WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place_wiki_assignment WHERE place_id IN (SELECT id FROM place WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM wiki_settlement_snapshot WHERE wiki_key = ${WIKI_KEY}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        fixture = authFixture(database);
        for (const role of ["tester", "reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `Ortsliste ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden, place_kind)
            VALUES (${ORT.zugeordnet}, 'aventuria', 'E4 Probe Zugeordnet', 'stadt', ST_SetSRID(ST_MakePoint(401, 402), 0), ${SOURCE}, TRUE, FALSE, NULL),
                   (${ORT.adresse}, 'aventuria', 'E4 Probe Adresse', 'dorf', ST_SetSRID(ST_MakePoint(403, 404), 0), ${SOURCE}, TRUE, FALSE, 'Kloster'),
                   (${ORT.verborgen}, 'aventuria', 'E4 Probe Verborgen', 'gebaeude', ST_SetSRID(ST_MakePoint(405, 406), 0), ${SOURCE}, TRUE, TRUE, NULL)
        `;
        const [snapshot] = await database<{ id: string }[]>`
            INSERT INTO wiki_settlement_snapshot (wiki_key, wiki_url, wiki_title, wiki_name, region_text, staat_text, building_type, synced_at)
            VALUES (${WIKI_KEY}, 'https://de.wiki-aventurica.de/wiki/E4_Probe', 'E4 Probe', 'E4 Probe', 'Kosch', 'Mittelreich', 'Stadt', now())
            RETURNING id::text
        `;
        await database`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/E4_Probe', ${snapshot!.id}, 'assigned', 'unknown'
              FROM place WHERE public_id = ${ORT.zugeordnet}
        `;
        await database`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, snapshot_id, assignment_state, assignment_origin)
            SELECT id, 'https://de.wiki-aventurica.de/wiki/E4_Adresse', NULL, 'address_only', 'unknown'
              FROM place WHERE public_id = ${ORT.adresse}
        `;
        // Zwei Stätten von „E4 Probe Zugeordnet“: eine nur im Wiki, eine als innerorts-Punkt auf dem verborgenen Probeort.
        await database`
            INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, wiki_url, legacy_public_id, on_map, source_system)
            VALUES ('e4 probe zugeordnet', 'E4 Probe Zugeordnet', 'E4 Probe Tempel', 'Tempel', 'https://de.wiki-aventurica.de/wiki/E4_Tempel', NULL, FALSE, ${SOURCE}),
                   ('e4 probe zugeordnet', 'E4 Probe Zugeordnet', 'E4 Probe Verborgen', 'Turm', NULL, ${ORT.verborgen}, TRUE, ${SOURCE})
        `;
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

    const zeile = (list: EditorPlaceList, publicId: string): EditorPlaceRow | undefined =>
        list.rows.find((row) => editorPlacePublicId(row) === publicId);

    it("🔴 Ortsarten zur Wahl (WI-0295): ab Reviewer, alphabetisch, ohne Ruine, Bauwerk und lineare Anlagen, gezählt wie die Ortsliste", async () => {
        const holen = (role?: Role) =>
            app.inject({
                method: "GET",
                url: EDITOR_PLACE_KINDS_URL,
                headers: role === undefined ? {} : { cookie: cookies.get(role) ?? "" },
            });
        expect((await holen()).statusCode).toBe(401);
        expect((await holen("tester")).statusCode).toBe(403);
        const antwort = await holen("reviewer");
        expect(antwort.statusCode).toBe(200);
        expect(String(antwort.headers["etag"])).toMatch(/^W\/"/);
        const { kinds } = antwort.json() as EditorPlaceKindList;
        expect(Value.Check(EditorPlaceKindList, { kinds })).toBe(true);
        const namen = kinds.map((art) => art.kind);
        expect(namen).toEqual(expect.arrayContaining(["Festung", "Gut", "Gutshof", "Kloster", "Tempel"]));
        for (const verborgen of ["Ruine", "Bauwerk", "Mauer", "Damm", "Deich", "Kanalisation", "Äquadukt"])
            expect(namen).not.toContain(verborgen);
        expect(namen).toEqual(
            [...namen].sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base", numeric: true })),
        );
        // Dieselbe Zahl wie der Art-Filter der Ortsliste: Der Probeort „Adresse“ trägt „Kloster“.
        const liste = (await get("editor")).json() as EditorPlaceList;
        const klosterInListe = liste.rows.filter((row) => row.kind === "Kloster").length;
        expect(klosterInListe).toBeGreaterThanOrEqual(1);
        expect(kinds.find((art) => art.kind === "Kloster")?.count).toBe(klosterInListe);
    });

    it("🔴 die Art laut Wiki im Detail (WI-0295): nur mit Artikel, sonst fehlt sie", async () => {
        const detail = async (publicId: string) =>
            (
                await app.inject({
                    method: "GET",
                    url: `${EDITOR_PLACES_URL}/${publicId}`,
                    headers: { cookie: cookies.get("editor") ?? "" },
                })
            ).json() as EditorPlaceDetail;
        expect((await detail(ORT.zugeordnet)).kindWiki).toBe("Stadt");
        expect(await detail(ORT.adresse)).not.toHaveProperty("kindWiki");
    });

    it("🔴 Besucher 401, Tester 403; Reviewer und Editor lesen, privat und jedes Mal neu geprüft", async () => {
        const anonymous = await get();
        expect([anonymous.statusCode, anonymous.json().error.code]).toEqual([401, "unauthenticated"]);
        expect(Value.Check(ApiErrorBody, anonymous.json())).toBe(true);
        const tester = await get("tester");
        expect([tester.statusCode, tester.json().error.code]).toEqual([403, "forbidden"]);
        for (const role of ["reviewer", "editor"] as const) {
            const allowed = await get(role);
            expect([role, allowed.statusCode]).toEqual([role, 200]);
            expect(allowed.headers["cache-control"]).toBe("private, no-cache");
            expect(String(allowed.headers["etag"])).toMatch(/^W\/"/);
            expect(Value.Check(EditorPlaceList, allowed.json())).toBe(true);
        }
    });

    it("🔴 der Kreis je Zeile: ● mit Artikel, ◐ mit bloßer Adresse und ohne Zuordnung; verborgene Orte stehen markiert darin", async () => {
        const list = (await get("editor")).json() as EditorPlaceList;
        // Knapp: Was falsch, null oder leer ist, fehlt in der Zeile.
        expect(zeile(list, ORT.zugeordnet)).toEqual({
            key: ORT.zugeordnet,
            origin: "karte",
            name: "E4 Probe Zugeordnet",
            subtype: "stadt",
            kind: "Stadt",
            circle: "voll",
            assignment: "assigned",
            wiki: { title: "E4 Probe", url: "https://de.wiki-aventurica.de/wiki/E4_Probe" },
            region: "Kosch",
            x: 401,
            y: 402,
            source: SOURCE,
        });
        expect(zeile(list, ORT.adresse)).toMatchObject({
            circle: "halb",
            assignment: "address_only",
            kind: "Kloster",
            wiki: { url: "https://de.wiki-aventurica.de/wiki/E4_Adresse" },
        });
        expect(zeile(list, ORT.adresse)?.wiki).not.toHaveProperty("title");
        const verborgen = zeile(list, ORT.verborgen);
        expect(verborgen).toMatchObject({ circle: "halb", assignment: "none", hidden: true });
        expect(verborgen).not.toHaveProperty("wiki");
    });

    it("🔴 das Wappen links in der Zeile (E19): die veröffentlichte Fassung des gebundenen Wappens, auch vor der Rechteprüfung", async () => {
        const [bild] = await database<{ id: string }[]>`
            INSERT INTO media_asset (media_kind, origin, technical_state, moderation_state, source_system, source_ref)
            VALUES ('image', 'legacy_import', 'ok', 'not_applicable', ${SOURCE}, 'e19-wappen')
            RETURNING id::text
        `;
        const sha = "e19".padEnd(64, "0");
        await insertPublishedFile(database, bild!.id, "e19-wappen", { variant: "coat", sha });
        await database`
            INSERT INTO place_media (place_id, media_asset_id, role, origin)
            SELECT id, ${bild!.id}, 'coat', 'editor' FROM place WHERE public_id = ${ORT.adresse}
        `;
        const list = (await get("editor")).json() as EditorPlaceList;
        expect(Value.Check(EditorPlaceList, list)).toBe(true);
        expect(zeile(list, ORT.adresse)).toMatchObject({ hasCoat: true, coat: mediaPublicUrl(sha) });
        expect(zeile(list, ORT.verborgen)).not.toHaveProperty("coat");
        // Zurückgezogen: kein Wappen mehr in der Zeile.
        await database`UPDATE place_media SET retired_at = now() WHERE media_asset_id = ${bild!.id}`;
        const danach = (await get("editor")).json() as EditorPlaceList;
        expect(zeile(danach, ORT.adresse)).not.toHaveProperty("coat");
        expect(zeile(danach, ORT.adresse)).not.toHaveProperty("hasCoat");
    });

    it("🔴 ungepackt, auch wenn der Browser gzip annimmt: Packen tut Nginx (Block E); der schwache ETag trägt durch Nginx", async () => {
        const offen = (await get("editor")).json() as EditorPlaceList;
        const roh = await get("editor", { "accept-encoding": "gzip, deflate, br" });
        expect(roh.statusCode).toBe(200);
        expect(roh.headers["content-encoding"]).toBeUndefined();
        expect(String(roh.headers["content-type"])).toMatch(/^application\/json/);
        const inhalt = roh.json() as EditorPlaceList;
        expect(Value.Check(EditorPlaceList, inhalt)).toBe(true);
        expect(inhalt).toEqual(offen);
        // Nginx macht beim Packen einen starken ETag schwach; dieser ist es schon und kommt so zurück, wie der Browser ihn schickt.
        const etag = String(roh.headers["etag"]);
        expect(etag).toMatch(/^W\/"/u);
        const wieder = await get("editor", { "if-none-match": etag, "accept-encoding": "gzip" });
        expect([wieder.statusCode, wieder.body]).toEqual([304, ""]);
    });

    it("🔴 „Fehlt“: eine Stätte ohne Kartenpunkt steht als ○ „nur Wiki“ mit ihrer Siedlung da; ein innerorts-Punkt auf der Karte nicht doppelt", async () => {
        const list = (await get("reviewer")).json() as EditorPlaceList;
        expect(list.wikiListe).toBe(false);
        const tempel = list.rows.filter((row) => row.name === "E4 Probe Tempel");
        expect(tempel).toEqual([
            {
                key: staetteKey({
                    settlement_key: "e4 probe zugeordnet",
                    name: "E4 Probe Tempel",
                    legacy_public_id: null,
                }),
                origin: "wiki",
                name: "E4 Probe Tempel",
                circle: "leer",
                assignment: "none",
                kind: "Tempel",
                wiki: { url: "https://de.wiki-aventurica.de/wiki/E4_Tempel" },
                within: "E4 Probe Zugeordnet",
            },
        ]);
        expect(tempel[0]!.key).toMatch(/^staette:/);
        // Der Punkt auf dem (verborgenen, aber aktiven) Ort ist dessen Kartenzeile, keine zweite.
        expect(list.rows.filter((row) => row.name === "E4 Probe Verborgen").map((row) => row.origin)).toEqual([
            "karte",
        ]);
        expect(new Set(list.rows.map((row) => row.key)).size).toBe(list.rows.length);
    });

    it("🔴 mit Legacys Registry ist sie „Fehlt“, je Wiki-Artikel eine Zeile; Stätten stehen dort nicht (wie settlements.php:1488-1630)", async () => {
        // Betreiber 2026-10-10: 2.684 Wiki-Adressen standen doppelt (Stätte und Registry); Legacys Liste liest „Fehlt“ nur aus der Registry.
        await database`
            INSERT INTO wiki_settlement_registry (wiki_key, title, wiki_url, settlement_class, continent)
            VALUES (${REGISTRY_KEY}, 'E4 Probe Tempel', 'https://de.wiki-aventurica.de/wiki/E4_Tempel', 'Besondere Bauwerke/Stätten', 'Aventurien')
        `;
        await database`
            INSERT INTO settlement_place (settlement_key, settlement_name, name, place_type, wiki_url, legacy_public_id, on_map, source_system)
            VALUES ('e4 probe zugeordnet', 'E4 Probe Zugeordnet', 'E4 Probe Hauptsitz', 'Kirchlicher Orden (Hauptsitz)',
                    'https://de.wiki-aventurica.de/wiki/E4_Orden', NULL, FALSE, ${SOURCE})
        `;
        try {
            const list = (await get("reviewer")).json() as EditorPlaceList;
            expect(list.wikiListe).toBe(true);
            expect(list.rows.filter((row) => row.name === "E4 Probe Tempel")).toEqual([
                {
                    key: REGISTRY_KEY,
                    origin: "wiki",
                    name: "E4 Probe Tempel",
                    circle: "leer",
                    assignment: "none",
                    subtype: "Besondere Bauwerke/Stätten",
                    wiki: { url: "https://de.wiki-aventurica.de/wiki/E4_Tempel", title: "E4 Probe Tempel" },
                },
            ]);
            expect(list.rows.filter((row) => row.name === "E4 Probe Hauptsitz")).toEqual([]);
            expect(list.rows.some((row) => row.key.startsWith("staette:"))).toBe(false);
        } finally {
            await database`DELETE FROM wiki_settlement_registry WHERE wiki_key = ${REGISTRY_KEY}`;
            await database`DELETE FROM settlement_place WHERE source_system = ${SOURCE} AND name = 'E4 Probe Hauptsitz'`;
        }
    });

    it("eine Stätte, deren Punkt nicht mehr auf der Karte steht, kehrt nach „Fehlt“ zurück", async () => {
        await database`UPDATE place SET is_active = FALSE WHERE public_id = ${ORT.verborgen}`;
        try {
            const list = (await get("editor")).json() as EditorPlaceList;
            expect(list.rows.filter((row) => row.name === "E4 Probe Verborgen").map((row) => row.origin)).toEqual([
                "wiki",
            ]);
        } finally {
            await database`UPDATE place SET is_active = TRUE WHERE public_id = ${ORT.verborgen}`;
        }
    });

    it("🔴 ETag: unverändert 304 ohne Körper, nach einer Änderung ein neuer Wert", async () => {
        const erste = await get("editor");
        const etag = String(erste.headers["etag"]);
        const wieder = await get("editor", { "if-none-match": etag });
        expect(wieder.statusCode).toBe(304);
        expect(wieder.body).toBe("");
        await database`UPDATE place SET name = 'E4 Probe Umbenannt' WHERE public_id = ${ORT.adresse}`;
        const danach = await get("editor", { "if-none-match": etag });
        expect(danach.statusCode).toBe(200);
        expect(String(danach.headers["etag"])).not.toBe(etag);
        expect(zeile(danach.json() as EditorPlaceList, ORT.adresse)?.name).toBe("E4 Probe Umbenannt");
    });
});
