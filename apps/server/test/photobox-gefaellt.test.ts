import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MEDIA_REISEBILDER_PUBLIC_URL,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_GRENZEN,
    PHOTOBOX_RIGHTS,
    PHOTOBOX_URL,
    PhotoboxGefaelltAntwort,
    ReisebilderAntwort,
    type PhotoboxSubmissionState,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { schluesselHash } from "../src/community/db.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { storageKey } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { lizenzfamilie } from "../src/photobox/db.ts";
import { vergissReisebilder } from "../src/photobox/karte.ts";
import { TEST_AUTH, TEST_ORIGIN } from "./support/auth-fixture.ts";
import { neuerSchluessel, neueSpuren } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * „Gefällt mir“ an Reisebildern (WI-0304, Migration 0337, `POST /api/photobox/reisebilder/:id/gefaellt`) gegen echtes PostgreSQL, über die echte Anwendung:
 *
 * - setzen, zurücknehmen, nie unter 0; die Antwort ist die Zahl danach;
 * - 🔴 nur an einem freigegebenen, nicht offline genommenen Reisebild: jeder andere Zustand, eine zurückgenommene oder fehlende Verwendung und eine unbekannte Kennung sind 404 und legen nichts an;
 * - 🔴 die Fachrevision der Einreichung bleibt stehen (ein Handgriff der Besucher stört die Redaktion nicht);
 * - die Drossel je Adresse und Stunde, beim Eintritt gezählt; der Rumpf ist streng (`delta` nur 1 oder -1);
 * - die öffentliche Antwort der Karte trägt die Zahl (nur wenn sie größer als 0 ist).
 *
 * Die Bilder entstehen mit SQL wie im Test des Lesepfads (`photobox-karte.test.ts`); alles trägt eine Marke und wird aufgeräumt.
 */

const MARKE = "photobox-gefaellt-test";
const BEDINGUNGEN = "gefaellt-test";
const REGELN = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
const REGEL_TEXTE = REGELN.map((regel) => regel.scopeText);

function config(mediaRoot: string): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-gefaellt-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Reisebilder: „Gefällt mir“ (WI-0304)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    const spuren = neueSpuren();
    let zaehler = 0;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-gefaellt-"));
    }, 120_000);

    beforeEach(async () => {
        await seedPublicationRules(database, REGELN);
        // Frische Anwendung je Test: Die Drossel lebt im Speicher einer Instanz.
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 3 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        vergissReisebilder();
    });

    afterEach(async () => {
        await app?.close();
        await raeumeAuf();
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        vergissReisebilder();
    });

    afterAll(async () => {
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    interface Bild {
        assetPublicId: string;
        submissionId: string;
        hauptSha: string;
    }

    const sha = (name: string): string => createHash("sha256").update(`${MARKE}:${name}`).digest("hex");

    async function bild(
        wunsch: {
            zustand?: PhotoboxSubmissionState;
            verwendung?: "aktiv" | "zurueckgenommen" | "keine";
            x?: number;
        } = {},
    ): Promise<Bild> {
        zaehler += 1;
        const zustand = wunsch.zustand ?? "approved";
        const hauptSha = sha(`${String(zaehler)}:haupt:${randomUUID()}`);
        const quelleSha = sha(`${String(zaehler)}:quelle:${randomUUID()}`);
        const rechte = PHOTOBOX_RIGHTS["avesmaps_only"];
        const familie = await lizenzfamilie(database, rechte.licenseKey);
        return database.begin(async (tx) => {
            const [asset] = await tx<{ id: string; public_id: string }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
                VALUES ('image', 'picture', 'community_upload', ${PHOTOBOX_CREATION_METHOD["photo"]}, 'ok', 'approved', ${MARKE})
                RETURNING id::text AS id, public_id::text AS public_id`;
            await tx`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, clearance_state)
                VALUES (${asset!.id}::bigint, ${rechte.basis}, ${rechte.licenseKey}, ${familie}, 'unreviewed')`;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset!.id}::bigint, 'source', 'private_source', ${storageKey("private_source", quelleSha, "png")}, 'image/png', 1600, 900, 1234, ${quelleSha})`;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                VALUES (${asset!.id}::bigint, 'photobox_2048', 'published', ${storageKey("published", hauptSha, "webp")}, 'image/webp', 1600, 900, 1234, ${hauptSha}, 'photobox_2048', '1')`;
            const [einreichung] = await tx<{ id: string }[]>`
                INSERT INTO media_submission (status_key_hash, map_domain_id, geom, creation_kind, usage_grant, description, terms_version, state, approved_media_asset_id, decided_at)
                VALUES (${schluesselHash(neuerSchluessel(spuren))}, 'aventuria', ST_SetSRID(ST_MakePoint(${wunsch.x ?? 700}::float8, 700::float8), 0), 'photo',
                        'avesmaps_only', ${`Der Blick Nummer ${String(zaehler)}`}, ${BEDINGUNGEN}, ${zustand},
                        ${["approved", "offline"].includes(zustand) ? asset!.id : null}::bigint, now())
                RETURNING id::text AS id`;
            const verwendung = wunsch.verwendung ?? "aktiv";
            if (verwendung !== "keine") {
                await tx`
                    INSERT INTO photobox_media (media_submission_id, media_asset_id, retired_at)
                    VALUES (${einreichung!.id}::bigint, ${asset!.id}::bigint, ${verwendung === "zurueckgenommen" ? new Date() : null})`;
            }
            return { assetPublicId: asset!.public_id, submissionId: einreichung!.id, hauptSha };
        });
    }

    async function raeumeAuf(): Promise<void> {
        const assets = `(SELECT id FROM media_asset WHERE source_system = '${MARKE}')`;
        await database.unsafe(`DELETE FROM photobox_media WHERE media_asset_id IN ${assets}`);
        // Die Zahl fällt mit ihrer Einreichung (ON DELETE CASCADE).
        await database`DELETE FROM media_submission WHERE terms_version = ${BEDINGUNGEN}`;
        await database.unsafe(`DELETE FROM media_file WHERE media_asset_id IN ${assets}`);
        await database.unsafe(`DELETE FROM media_rights WHERE media_asset_id IN ${assets}`);
        await database`DELETE FROM media_asset WHERE source_system = ${MARKE}`;
        zaehler = 0;
    }

    const adresse = (nummer: number): string => `10.60.0.${String(nummer)}`;
    const mag = (id: string, delta: unknown, ip = adresse(1)) =>
        app.inject({
            method: "POST",
            url: `${PHOTOBOX_URL}/reisebilder/${id}/gefaellt`,
            payload: { delta } as object,
            remoteAddress: ip,
            headers: { origin: TEST_ORIGIN },
        });
    const zahlIn = async (submissionId: string): Promise<number | undefined> => {
        const [zeile] = await database<{ gefaellt: number }[]>`
            SELECT gefaellt FROM photobox_gefaellt WHERE media_submission_id = ${submissionId}::bigint`;
        return zeile?.gefaellt;
    };

    it("setzen, noch einmal setzen und zurücknehmen: die Antwort ist die Zahl danach", async () => {
        const da = await bild();
        const erste = await mag(da.assetPublicId, 1);
        expect(erste.statusCode).toBe(200);
        expect(Value.Check(PhotoboxGefaelltAntwort, erste.json())).toBe(true);
        expect(erste.json()).toEqual({ gefaellt: 1 });
        expect((await mag(da.assetPublicId, 1, adresse(2))).json()).toEqual({ gefaellt: 2 });
        expect((await mag(da.assetPublicId, -1)).json()).toEqual({ gefaellt: 1 });
        expect(await zahlIn(da.submissionId)).toBe(1);
    });

    it("🔴 nie unter 0: Zurücknehmen ohne Zahl bleibt bei 0", async () => {
        const da = await bild();
        expect((await mag(da.assetPublicId, -1)).json()).toEqual({ gefaellt: 0 });
        expect((await mag(da.assetPublicId, -1)).json()).toEqual({ gefaellt: 0 });
        expect(await zahlIn(da.submissionId)).toBe(0);
        expect((await mag(da.assetPublicId, 1)).json()).toEqual({ gefaellt: 1 });
        expect((await mag(da.assetPublicId, -1)).json()).toEqual({ gefaellt: 0 });
        expect((await mag(da.assetPublicId, -1)).json()).toEqual({ gefaellt: 0 });
    });

    it("🔴 ein Reisebild, das nicht freigegeben ist, wird abgelehnt (404 mit Fachcode) und legt nichts an", async () => {
        const zustaende: PhotoboxSubmissionState[] = [
            "incoming",
            "pending",
            "changes_requested",
            "rejected",
            "withdrawn",
            "offline",
            "expired",
        ];
        for (const zustand of zustaende) {
            const nein = await bild({ zustand });
            const antwort = await mag(nein.assetPublicId, 1);
            expect(antwort.statusCode, zustand).toBe(404);
            expect(antwort.json()).toMatchObject({ error: { details: { reason: "reisebild_unbekannt" } } });
            expect(await zahlIn(nein.submissionId), zustand).toBeUndefined();
        }
        for (const verwendung of ["zurueckgenommen", "keine"] as const) {
            const nein = await bild({ verwendung });
            expect((await mag(nein.assetPublicId, 1)).statusCode, verwendung).toBe(404);
            expect(await zahlIn(nein.submissionId), verwendung).toBeUndefined();
        }
        expect((await mag(randomUUID(), 1)).statusCode).toBe(404);
    });

    it("🔴 wird das Bild offline genommen, zählt es nicht mehr", async () => {
        const da = await bild();
        expect((await mag(da.assetPublicId, 1)).statusCode).toBe(200);
        await database`UPDATE photobox_media SET retired_at = now() WHERE media_submission_id = ${da.submissionId}::bigint`;
        expect((await mag(da.assetPublicId, 1)).statusCode).toBe(404);
    });

    it("🔴 die Fachrevision der Einreichung bleibt stehen", async () => {
        const da = await bild();
        const [vorher] = await database<
            { revision: string }[]
        >`SELECT revision::text FROM media_submission WHERE id = ${da.submissionId}::bigint`;
        await mag(da.assetPublicId, 1);
        await mag(da.assetPublicId, -1);
        const [nachher] = await database<
            { revision: string }[]
        >`SELECT revision::text FROM media_submission WHERE id = ${da.submissionId}::bigint`;
        expect(nachher!.revision).toBe(vorher!.revision);
    });

    it("der Rumpf ist streng: nur 1 oder -1, ein fremdes Feld zählt nicht; eine Kennung, die keine ist, wird abgewiesen", async () => {
        const da = await bild();
        for (const delta of [0, 2, -2, null, "x"]) {
            expect((await mag(da.assetPublicId, delta)).statusCode, String(delta)).toBe(400);
        }
        const fremd = await app.inject({
            method: "POST",
            url: `${PHOTOBOX_URL}/reisebilder/${da.assetPublicId}/gefaellt`,
            payload: { delta: 1, gefaellt: 9999 },
            remoteAddress: adresse(3),
            headers: { origin: TEST_ORIGIN },
        });
        // Ein fremdes Feld nimmt Fastify aus dem Rumpf (`removeAdditional`); die Zahl kann der Besucher so nicht vorgeben.
        expect(fremd.statusCode).toBe(200);
        expect(fremd.json()).toEqual({ gefaellt: 1 });
        expect((await mag("kein-uuid", 1)).statusCode).toBe(400);
        expect(await zahlIn(da.submissionId)).toBe(1);
    });

    it("🔴 nur von der eigenen Seite: eine fremde Herkunft wird abgewiesen", async () => {
        const da = await bild();
        const antwort = await app.inject({
            method: "POST",
            url: `${PHOTOBOX_URL}/reisebilder/${da.assetPublicId}/gefaellt`,
            payload: { delta: 1 },
            remoteAddress: adresse(4),
            headers: { origin: "https://fremd.example" },
        });
        expect(antwort.statusCode).toBe(403);
        expect(await zahlIn(da.submissionId)).toBeUndefined();
    });

    it("🔴 die Drossel zählt beim Eintritt: gleichzeitig genau so viele durch, wie die Grenze der Adresse erlaubt; eine andere Adresse bleibt frei", async () => {
        const da = await bild();
        const grenze = PHOTOBOX_GRENZEN.gefaelltJeAdresseJeStunde;
        const antworten = await Promise.all(
            Array.from({ length: grenze + 5 }, () => mag(da.assetPublicId, 1, adresse(10))),
        );
        const drossel = antworten.filter((a) => a.statusCode === 429);
        expect(antworten.length - drossel.length).toBe(grenze);
        expect(drossel[0]!.json()).toMatchObject({ error: { code: "photobox_rate" } });
        expect(await zahlIn(da.submissionId)).toBe(grenze);
        expect((await mag(da.assetPublicId, 1, adresse(11))).statusCode).toBe(200);
    });

    it("die öffentliche Antwort der Karte trägt die Zahl, aber nur wenn sie größer als 0 ist", async () => {
        const da = await bild({ x: 700 });
        const lies = async () => {
            vergissReisebilder();
            const antwort = await app.inject({
                method: "GET",
                url: `${MEDIA_REISEBILDER_PUBLIC_URL}?x0=640&y0=640&x1=832&y1=832`,
                remoteAddress: adresse(20),
            });
            expect(antwort.statusCode).toBe(200);
            const json = antwort.json() as ReisebilderAntwort;
            expect(Value.Check(ReisebilderAntwort, json)).toBe(true);
            return json.bilder.find((b) => b.id === da.assetPublicId);
        };
        expect(await lies()).not.toHaveProperty("gefaellt");
        await mag(da.assetPublicId, 1, adresse(21));
        await mag(da.assetPublicId, 1, adresse(22));
        expect((await lies())?.gefaellt).toBe(2);
        await mag(da.assetPublicId, -1, adresse(21));
        await mag(da.assetPublicId, -1, adresse(22));
        expect(await lies()).not.toHaveProperty("gefaellt");
    });

    it("die Funktion lehnt einen anderen Schritt als 1 und -1 ab (KC422)", async () => {
        const da = await bild();
        await expect(
            database`SELECT public.photobox_gefaellt(${da.assetPublicId}::uuid, 5) AS z`,
        ).rejects.toMatchObject({ code: "KC422" });
        await expect(
            database`SELECT public.photobox_gefaellt(${da.assetPublicId}::uuid, NULL) AS z`,
        ).rejects.toMatchObject({ code: "KC422" });
    });

    it("🔴 die Zahl fällt mit ihrer Einreichung (Aufbewahrung löscht, nichts bleibt hängen)", async () => {
        const da = await bild();
        await mag(da.assetPublicId, 1);
        expect(await zahlIn(da.submissionId)).toBe(1);
        await database`DELETE FROM photobox_media WHERE media_submission_id = ${da.submissionId}::bigint`;
        await database`DELETE FROM media_submission WHERE id = ${da.submissionId}::bigint`;
        expect(await zahlIn(da.submissionId)).toBeUndefined();
    });
});
