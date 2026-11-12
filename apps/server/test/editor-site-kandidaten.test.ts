import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    editorPlaceSiteCandidatesUrl,
    editorPlaceSitesAddUrl,
    editorPlaceSitesUrl,
    type EditorPlaceSites,
    type EditorSiteCandidates,
    type OperationReceipt,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * „Innerorts hinzufügen“ (WI-0196, EDIT-0003 T33 (3)) gegen die Testdatenbank: die Kandidaten mit Abstand in Meilen, dann `site.add`
 * - alle gewählten Einträge in EINER Operation, ein Kartenpunkt bekommt seine Stätte (`site_punkt_fuer_ort`, Migration 0139).
 *
 * 🔴 Problemfälle: ein verborgenes Gebäude, ein Dorf, eine schon woanders gebundene Stätte oder ein „keine Stadt“ eines Menschen steht
 * in der Auswahl; ein Eintrag, der inzwischen woanders gebunden ist, wird still übersprungen statt die Operation scheitern zu lassen;
 * die Revision des Orts steigt (und jeder offene Entwurf bekäme einen Konflikt).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const QUELLE = "test-wi0196";
const ORT = "e196e196-0000-4000-8000-000000000001";
const ANDERER = "e196e196-0000-4000-8000-000000000002";
const NAH = "e196e196-0000-4000-8000-000000000003";
const FERN = "e196e196-0000-4000-8000-000000000004";
const VERBORGEN = "e196e196-0000-4000-8000-000000000005";
const DORF = "e196e196-0000-4000-8000-000000000006";
const PUNKTHAUS = "e196e196-0000-4000-8000-000000000007";
const UNSERE = [ORT, ANDERER, NAH, FERN, VERBORGEN, DORF, PUNKTHAUS];
let zaehler = 0;
const operationId = (): string => `e196e196-0000-4000-9000-${String((zaehler += 1)).padStart(12, "0")}`;

describeWithDatabase("Innerorts hinzufügen: Kandidaten und site.add (WI-0196)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
    const staetten = new Map<string, string>();

    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    async function aufraeumen(): Promise<void> {
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'e196e196-%'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'e196e196-%'`;
        // Die Stätten dieses Tests: die angelegten und die, die `site_punkt_fuer_ort` für unsere Orte anlegt (Schlüssel = public_id).
        await database`
            DELETE FROM site_settlement
             WHERE site_id IN (SELECT id FROM site WHERE source_system = ${QUELLE} OR source_key LIKE 'e196e196-%')
        `;
        await database`DELETE FROM site WHERE source_system = ${QUELLE} OR source_key LIKE 'e196e196-%'`;
        await database`DELETE FROM place WHERE source_system = ${QUELLE}`;
    }

    async function ort(
        id: string,
        name: string,
        subtype: string,
        x: number,
        mehr: { versteckt?: boolean; art?: string } = {},
    ) {
        await database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, place_kind, is_hidden, geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, ${subtype}, ${mehr.art ?? null}, ${mehr.versteckt === true},
                    ST_SetSRID(ST_MakePoint(${x}, 600), 0), ${QUELLE}, TRUE)
        `;
    }

    async function staette(name: string, kind: string, key: string): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO site (source_kind, source_key, name, site_type, source_system)
            VALUES (${kind}, ${key}, ${name}, 'Bauwerk', ${QUELLE})
            RETURNING id::text AS id
        `;
        staetten.set(name, row!.id);
        return row!.id;
    }

    const kandidaten = async () => {
        const antwort = await app.inject({
            method: "GET",
            url: editorPlaceSiteCandidatesUrl(ORT),
            headers: { cookie: cookies.get("editor") ?? "" },
        });
        expect(antwort.statusCode).toBe(200);
        const ids = new Set([...UNSERE, ...staetten.values()]);
        return antwort.json<EditorSiteCandidates>().candidates.filter((kandidat) => ids.has(kandidat.id));
    };

    const fuegeHinzu = (body: { sites?: string[]; places?: string[] }, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url: editorPlaceSitesAddUrl(ORT),
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), sites: body.sites ?? [], places: body.places ?? [] },
        });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await aufraeumen();
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `E196 ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        // Eine Karteneinheit sind 3 Meilen (`map_domain.miles_per_unit`): 0,1 Einheiten sind 0,3 Meilen.
        await ort(ORT, "E196 Stadt", "stadt", 600);
        await ort(ANDERER, "E196 Nachbarstadt", "stadt", 650);
        await ort(NAH, "E196 Tempel", "gebaeude", 600.1, { art: "Tempel" });
        await ort(FERN, "E196 Turm", "gebaeude", 602);
        await ort(VERBORGEN, "E196 Versteck", "gebaeude", 600.05, { versteckt: true });
        await ort(DORF, "E196 Dorf", "dorf", 600.02);
        await ort(PUNKTHAUS, "E196 Kontor", "stadtviertel", 600.2);
        await staette("E196 Gespeichert frei", "gespeichert", "e196-gespeichert");
        await staette("E196 Lauf ohne Stadt", "weg", "e196-lauf");
        const mensch = await staette("E196 Mensch ohne Stadt", "weg", "e196-mensch");
        const woanders = await staette("E196 Woanders", "weg", "e196-woanders");
        await staette("E196 Kontor", "punkt", PUNKTHAUS);
        await database`
            INSERT INTO site_settlement (site_id, settlement_legacy_public_id, place_id, origin, source_system)
            VALUES (${staetten.get("E196 Lauf ohne Stadt")!}::bigint, NULL, NULL, 'wiki', ${QUELLE}),
                   (${mensch}::bigint, NULL, NULL, 'manual', ${QUELLE}),
                   (${woanders}::bigint, ${ANDERER}::uuid, (SELECT id FROM place WHERE public_id = ${ANDERER}::uuid), 'wiki', ${QUELLE})
        `;
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 Kandidaten: Kartenpunkte und freie Stätten, nach Abstand in Meilen; verborgen, Dorf, gebunden, ‚keine Stadt‘ eines Menschen nicht", async () => {
        const liste = await kandidaten();
        expect(liste.map((kandidat) => [kandidat.kind, kandidat.name, kandidat.meilen])).toEqual([
            ["kartenpunkt", "E196 Tempel", 0.3],
            ["staette", "E196 Kontor", 0.6],
            ["kartenpunkt", "E196 Turm", 6],
            ["staette", "E196 Gespeichert frei", undefined],
            ["staette", "E196 Lauf ohne Stadt", undefined],
        ]);
        expect(liste[0]).toMatchObject({ id: NAH, type: "Tempel", siteClass: "gebaeude" });
        expect(liste[1]).toMatchObject({ sourceKind: "punkt" });
    });

    it("🔴 site.add: EINE Operation bindet alle, ein Kartenpunkt bekommt seine Stätte, die Revision des Orts bleibt", async () => {
        const [vorher] = await database<{ revision: number }[]>`SELECT revision FROM place WHERE public_id = ${ORT}`;
        const antwort = await fuegeHinzu({
            sites: [staetten.get("E196 Gespeichert frei")!, staetten.get("E196 Lauf ohne Stadt")!],
            places: [NAH],
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<OperationReceipt>();
        expect(quittung.affected.filter((eintrag) => eintrag.kind === "site")).toHaveLength(3);
        const [neu] = await database<
            { source_system: string; site_class: string; site_type: string; on_map: boolean }[]
        >`
            SELECT source_system, site_class, site_type, on_map FROM site WHERE source_kind = 'punkt' AND source_key = ${NAH}
        `;
        expect(neu).toEqual({ source_system: "avesmaps3d", site_class: "gebaeude", site_type: "Tempel", on_map: true });
        const gebunden = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM site_settlement ss JOIN place p ON p.id = ss.place_id
             WHERE p.public_id = ${ORT} AND ss.is_active AND ss.origin = 'editor'
        `;
        expect(gebunden[0]!.n).toBe(3);
        const eintraege = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM map_audit_event
             WHERE operation_id = ${quittung.operationId}::uuid AND action = 'place.site_attached'
        `;
        expect(eintraege[0]!.n).toBe(3);
        const [nachher] = await database<{ revision: number }[]>`SELECT revision FROM place WHERE public_id = ${ORT}`;
        expect(nachher!.revision).toBe(vorher!.revision);
        // Danach stehen sie belegt am Ort und nicht mehr in der Auswahl.
        const sites = (
            await app.inject({
                method: "GET",
                url: editorPlaceSitesUrl(ORT),
                headers: { cookie: cookies.get("editor") ?? "" },
            })
        ).json<EditorPlaceSites>();
        expect(sites.bound.map((eintrag) => eintrag.name).sort()).toEqual([
            "E196 Gespeichert frei",
            "E196 Lauf ohne Stadt",
            "E196 Tempel",
        ]);
        expect((await kandidaten()).map((kandidat) => kandidat.name)).toEqual(["E196 Kontor", "E196 Turm"]);
    });

    it("🔴 ist ein Eintrag inzwischen woanders gebunden, scheitert die ganze Operation, und nichts ist geschrieben", async () => {
        const antwort = await fuegeHinzu({ sites: [staetten.get("E196 Kontor")!, staetten.get("E196 Woanders")!] });
        expect(antwort.statusCode).toBe(409);
        expect(antwort.json<{ error: { code: string; message: string } }>().error.message).toContain("Nachbarstadt");
        const [kontor] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM site_settlement WHERE site_id = ${staetten.get("E196 Kontor")!}::bigint AND is_active
        `;
        expect(kontor!.n).toBe(0);
    });

    it("leer, ein Dorf, ein verborgenes Gebäude: 400; ein Reviewer schreibt nicht", async () => {
        expect((await fuegeHinzu({})).statusCode).toBe(400);
        expect((await fuegeHinzu({ places: [DORF] })).statusCode).toBe(400);
        expect((await fuegeHinzu({ places: [VERBORGEN] })).statusCode).toBe(400);
        expect((await fuegeHinzu({ places: [FERN] }, "reviewer")).statusCode).toBe(403);
    });
});
