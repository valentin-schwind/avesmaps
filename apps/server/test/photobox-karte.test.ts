import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import Fastify, { type FastifyInstance } from "fastify";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MEDIA_REISEBILDER_PUBLIC_URL,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_RIGHTS,
    REISEBILD_AUSSCHNITT_MAX,
    ReisebilderAntwort,
    mediaPublicUrl,
    type PhotoboxCreationKind,
    type PhotoboxSubmissionState,
    type PhotoboxUsageGrant,
    type ReisebilderAusschnitt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { schluesselHash } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { registerErrorHandler } from "../src/error-handler.ts";
import { resolveReisebilder, REISEBILDER_QUERY, reisebilderParameter } from "../src/media/resolver.ts";
import { MediaStore, storageKey } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { lizenzfamilie } from "../src/photobox/db.ts";
import { liesReisebilder, REISEBILDER_SPEICHER_MS, vergissReisebilder } from "../src/photobox/karte.ts";
import { nehmeOffline } from "../src/photobox/redaktion.ts";
import { offlineNehmen } from "../src/photobox/status.ts";
import { liftSuspension, suspendAsset } from "../src/media-editor/suspension.ts";
import { reisebilderRoutes } from "../src/routes/reisebilder.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { neueOperation, neueSpuren, neuerSchluessel, type Spuren } from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Der öffentliche Lesepfad der Reisebilder je Ausschnitt (WI-0272 S4, Aufgabe 23, `GET /api/media/reisebilder`) gegen echtes PostgreSQL, über die echte Anwendung:
 *
 * - 🔴 **Nur Veröffentlichtes:** Jeder Zustand, der nicht öffentlich ist, fehlt in der Antwort, und zwar je einzeln (eingegangen, geprüft, Rückfrage, abgelehnt, zurückgezogen,
 *   offline, freigegeben ohne Regel, freigegeben ohne Datei, unter Notaus, zurückgenommene Verwendung, Medium nicht freigegeben, Schalter aus).
 * - 🔴 **Nichts Verborgenes:** Die Antwort trägt genau die Felder der Liste; kein Schlüssel, keine Prüfsumme, kein Speicherschlüssel, keinen Zustand, keine wartende Beschreibung,
 *   keine Nachricht der Redaktion; ein verborgener oder inaktiver Ort fehlt, das Bild gilt als frei.
 * - 🔴 **Offline wirkt sofort**, auch durch den Zwischenspeicher des Servers (15 s): Der Einreicher und die Redaktion leeren ihn.
 *
 * Die Bilder entstehen hier mit SQL (acht Tafeln je Bild), nicht über das Einreichen: Es kommt auf den Lesepfad an, und 501 Bilder wären sonst eine Minute Arbeit.
 * Alles trägt eine Marke (Quellsystem `photobox-karte-test`, Fassung der Bedingungen `karte-test`) und wird wieder aufgeräumt.
 */

const MARKE = "photobox-karte-test";
const BEDINGUNGEN = "karte-test";
const REGELN = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
const REGEL_TEXTE = REGELN.map((regel) => regel.scopeText);

/** Die Gegend der Tests: weit weg von den Stellen (300, 300) der anderen Reisebild-Tests, die sich die Datenbank teilen. */
const FELD: ReisebilderAusschnitt = { x0: 832, y0: 832, x1: 1024, y1: 1024 };

interface BildWunsch {
    x?: number;
    y?: number;
    /** Zustand der Einreichung; Vorgabe `approved`. */
    zustand?: PhotoboxSubmissionState;
    /** Moderation des Mediums; Vorgabe `approved`. */
    medium?: "approved" | "pending" | "rejected";
    /** `aktiv` (Vorgabe), `zurueckgenommen` oder `keine`. */
    verwendung?: "aktiv" | "zurueckgenommen" | "keine";
    /** `beide` (Vorgabe), `nurHaupt` oder `keine` öffentlichen Dateien. */
    dateien?: "beide" | "nurHaupt" | "keine";
    nutzung?: PhotoboxUsageGrant;
    entstehung?: PhotoboxCreationKind;
    name?: string | null;
    beschreibung?: string;
    wartendeBeschreibung?: string;
    nachricht?: string;
    blickrichtung?: number | null;
    ortId?: string | null;
    schluessel?: string;
}

interface Bild {
    assetId: string;
    assetPublicId: string;
    submissionId: string;
    submissionPublicId: string;
    schluessel: string;
    quelleSha: string;
    hauptSha: string;
    kachelSha: string;
}

function config(mediaRoot: string): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-karte-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Reisebilder auf der Karte: der Lesepfad (WI-0272 S4, Aufgabe 23)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: AuthFixture;
    let redaktion: { id: string };
    const spuren: Spuren = neueSpuren();
    let zaehler = 0;

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-karte-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        redaktion = await fixture.person("editor", { name: "Karte Redaktion" });
        app = buildApp({
            config: config(mediaRoot),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    }, 120_000);

    beforeEach(async () => {
        await seedPublicationRules(database, REGELN);
        await alleSchalterAn();
    });

    afterEach(async () => {
        await raeumeAuf();
        await alleSchalterAn();
        await seedPublicationRules(database, REGELN);
    });

    afterAll(async () => {
        await app?.close();
        await raeumeAuf();
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    // --- Hilfen -------------------------------------------------------------------------------------------------------------------

    async function alleSchalterAn(): Promise<void> {
        await database`DELETE FROM content_switch WHERE key = 'media.role.photobox'`;
        app?.inhaltsschalter?.forget();
        vergissReisebilder();
    }

    /** Der Schalter `media.role.photobox` aus; `revision` hebt, wie `schalteUm`, die Inhaltsrevision (daran hängt der Speicher des Lesepfads). */
    async function schalterAus(revision: boolean): Promise<void> {
        await database`
            INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
            VALUES ('media.role.photobox', false, now(), ${MARKE})
            ON CONFLICT (key) DO UPDATE SET enabled = false`;
        if (revision) await database`UPDATE system_state SET content_revision = content_revision + 1 WHERE id = 1`;
        app.inhaltsschalter?.forget();
    }

    const sha = (name: string): string => createHash("sha256").update(`${MARKE}:${name}`).digest("hex");

    /** Ein Reisebild mit allem, was der Lesepfad liest, gleich so, wie die Freigabe es hinterlässt (oder wie der Wunsch es abweichen lässt). */
    async function bild(wunsch: BildWunsch = {}): Promise<Bild> {
        zaehler += 1;
        const n = zaehler;
        const nutzung = wunsch.nutzung ?? "avesmaps_only";
        const entstehung = wunsch.entstehung ?? "photo";
        const zustand = wunsch.zustand ?? "approved";
        const schluessel = wunsch.schluessel ?? neuerSchluessel(spuren);
        const quelleSha = sha(`${String(n)}:quelle:${randomUUID()}`);
        const hauptSha = sha(`${String(n)}:haupt:${randomUUID()}`);
        const kachelSha = sha(`${String(n)}:kachel:${randomUUID()}`);
        const rechte = PHOTOBOX_RIGHTS[nutzung];
        const familie = await lizenzfamilie(database, rechte.licenseKey);
        return database.begin(async (tx) => {
            const [asset] = await tx<{ id: string; public_id: string }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
                VALUES ('image', 'picture', 'community_upload', ${PHOTOBOX_CREATION_METHOD[entstehung]}, 'ok',
                        ${wunsch.medium ?? "approved"}, ${MARKE})
                RETURNING id::text AS id, public_id::text AS public_id`;
            await tx`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, attribution, clearance_state)
                VALUES (${asset!.id}::bigint, ${rechte.basis}, ${rechte.licenseKey}, ${familie}, ${wunsch.name ?? null}, ${wunsch.name ?? null}, 'unreviewed')`;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset!.id}::bigint, 'source', 'private_source', ${storageKey("private_source", quelleSha, "png")}, 'image/png', 1600, 900, 1234, ${quelleSha})`;
            const dateien = wunsch.dateien ?? "beide";
            if (dateien !== "keine") {
                await tx`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                    VALUES (${asset!.id}::bigint, 'photobox_2048', 'published', ${storageKey("published", hauptSha, "webp")}, 'image/webp', 1600, 900, 1234, ${hauptSha}, 'photobox_2048', '1')`;
            }
            if (dateien === "beide") {
                await tx`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                    VALUES (${asset!.id}::bigint, 'photobox_kachel', 'published', ${storageKey("published", kachelSha, "webp")}, 'image/webp', 480, 270, 234, ${kachelSha}, 'photobox_kachel', '1')`;
            }
            const [einreichung] = await tx<{ id: string; public_id: string }[]>`
                INSERT INTO media_submission (status_key_hash, map_domain_id, geom, place_id, view_direction, creation_kind, usage_grant, description,
                                              pending_description, editor_message, attribution_name, terms_version, state, approved_media_asset_id, decided_at)
                VALUES (${schluesselHash(schluessel)}, 'aventuria', ST_SetSRID(ST_MakePoint(${wunsch.x ?? 900}::float8, ${wunsch.y ?? 900}::float8), 0),
                        ${wunsch.ortId ?? null}::bigint, ${wunsch.blickrichtung ?? null}::smallint, ${entstehung}, ${nutzung},
                        ${wunsch.beschreibung ?? `Der Blick Nummer ${String(n)}`}, ${wunsch.wartendeBeschreibung ?? null}, ${wunsch.nachricht ?? null},
                        ${wunsch.name ?? null}, ${BEDINGUNGEN}, ${zustand},
                        ${["approved", "offline"].includes(zustand) ? asset!.id : null}::bigint, now())
                RETURNING id::text AS id, public_id::text AS public_id`;
            const verwendung = wunsch.verwendung ?? "aktiv";
            if (verwendung !== "keine") {
                await tx`
                    INSERT INTO photobox_media (media_submission_id, media_asset_id, retired_at)
                    VALUES (${einreichung!.id}::bigint, ${asset!.id}::bigint, ${verwendung === "zurueckgenommen" ? new Date() : null})`;
            }
            return {
                assetId: asset!.id,
                assetPublicId: asset!.public_id,
                submissionId: einreichung!.id,
                submissionPublicId: einreichung!.public_id,
                schluessel,
                quelleSha,
                hauptSha,
                kachelSha,
            };
        });
    }

    async function raeumeAuf(): Promise<void> {
        const assets = `(SELECT id FROM media_asset WHERE source_system = '${MARKE}')`;
        await database.unsafe(
            `DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN (SELECT public_id::text FROM media_asset WHERE source_system = '${MARKE}'))`,
        );
        await database.unsafe(
            `DELETE FROM job WHERE kind = 'media_settle' AND input_ref ->> 'asset' IN (SELECT public_id::text FROM media_asset WHERE source_system = '${MARKE}')`,
        );
        await database.unsafe(
            `DELETE FROM media_audit_event WHERE operation_id IN (SELECT operation_id FROM media_operation WHERE operation_id = ANY($1::uuid[]))`,
            [spuren.operationen],
        );
        await database`DELETE FROM media_operation WHERE operation_id = ANY(${spuren.operationen}::uuid[])`;
        await database.unsafe(`DELETE FROM media_publication_suspension WHERE media_asset_id IN ${assets}`);
        await database.unsafe(`DELETE FROM photobox_media WHERE media_asset_id IN ${assets}`);
        await database`DELETE FROM media_submission WHERE terms_version = ${BEDINGUNGEN}`;
        await database.unsafe(`DELETE FROM media_file WHERE media_asset_id IN ${assets}`);
        await database.unsafe(`DELETE FROM media_rights WHERE media_asset_id IN ${assets}`);
        await database`DELETE FROM media_asset WHERE source_system = ${MARKE}`;
        await database`DELETE FROM territory_capital_band WHERE place_public_id IN (SELECT public_id FROM place WHERE source_system = ${MARKE})`;
        await database`DELETE FROM place WHERE source_system = ${MARKE}`;
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
        zaehler = 0;
    }

    /** Ein Ort für die Bilder: sichtbar (Vorgabe), verborgen oder inaktiv. */
    async function ort(
        angaben: {
            name?: string;
            subtype?: string;
            verborgen?: boolean;
            aktiv?: boolean;
            baender?: string;
            x?: number;
            y?: number;
        } = {},
    ): Promise<{ id: string; publicId: string; name: string }> {
        const publicId = randomUUID();
        const name = angaben.name ?? `Kartenort ${String(zaehler + 1)}`;
        const [zeile] = await database<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active, is_hidden)
            VALUES (${publicId}, 'aventuria', ${name}, ${angaben.subtype ?? "stadt"},
                    ST_SetSRID(ST_MakePoint(${angaben.x ?? 905}::float8, ${angaben.y ?? 905}::float8), 0), ${MARKE},
                    ${angaben.aktiv ?? true}, ${angaben.verborgen ?? false})
            RETURNING id::text AS id`;
        if (angaben.baender !== undefined) {
            await database`INSERT INTO territory_capital_band (place_public_id, bands) VALUES (${publicId}::uuid, ${angaben.baender})`;
        }
        return { id: zeile!.id, publicId, name };
    }

    interface Antwort {
        status: number;
        text: string;
        json: ReisebilderAntwort;
        kopf: Record<string, unknown>;
    }

    const url = (box: ReisebilderAusschnitt): string =>
        `${MEDIA_REISEBILDER_PUBLIC_URL}?x0=${String(box.x0)}&y0=${String(box.y0)}&x1=${String(box.x1)}&y1=${String(box.y1)}`;

    async function frage(box: ReisebilderAusschnitt = FELD, kopf: Record<string, string> = {}): Promise<Antwort> {
        const antwort = await app.inject({ method: "GET", url: url(box), headers: kopf });
        const text = antwort.body;
        return {
            status: antwort.statusCode,
            text,
            json: (text === "" ? {} : JSON.parse(text)) as ReisebilderAntwort,
            kopf: antwort.headers,
        };
    }
    const ids = (antwort: Antwort): string[] => antwort.json.bilder.map((eintrag) => eintrag.id);

    // --- Nur Veröffentlichtes -----------------------------------------------------------------------------------------------------

    it("Gegenprobe: ein freigegebenes Bild mit Regel und beiden Dateien steht in der Antwort", async () => {
        const da = await bild({ x: 900, y: 900, beschreibung: "Der Blick vom Hafen" });
        const antwort = await frage();
        expect(antwort.status).toBe(200);
        expect(Value.Check(ReisebilderAntwort, antwort.json)).toBe(true);
        expect(antwort.json).toMatchObject({ an: true, gekappt: false });
        expect(antwort.json.bilder).toEqual([
            {
                id: da.assetPublicId,
                lage: { x: 900, y: 900 },
                datei: { url: mediaPublicUrl(da.hauptSha), breite: 1600, hoehe: 900 },
                kachel: { url: mediaPublicUrl(da.kachelSha), breite: 480, hoehe: 270 },
                beschreibung: "Der Blick vom Hafen",
                entstehung: "photo",
            },
        ]);
    });

    it("🔴 jeder Zustand der Einreichung außer „freigegeben“ bleibt draußen, auch mit aktiver Verwendung und öffentlicher Datei", async () => {
        const zustaende: PhotoboxSubmissionState[] = [
            "incoming",
            "technical_failed",
            "pending",
            "changes_requested",
            "rejected",
            "withdrawn",
            "offline",
            "expired",
        ];
        const da = await bild();
        for (const zustand of zustaende) await bild({ zustand });
        expect(ids(await frage())).toEqual([da.assetPublicId]);
    });

    it("🔴 freigegeben, aber nicht öffentlich: ohne Datei, mit zurückgenommener Verwendung, ohne Verwendung, Medium nicht freigegeben, Medium abgelehnt", async () => {
        const da = await bild();
        await bild({ dateien: "keine" });
        await bild({ verwendung: "zurueckgenommen" });
        await bild({ verwendung: "keine" });
        await bild({ medium: "pending" });
        await bild({ medium: "rejected" });
        expect(ids(await frage())).toEqual([da.assetPublicId]);
    });

    it("🔴 freigegeben ohne Freigaberegel der Rolle: nichts erscheint", async () => {
        await bild();
        await bild({ nutzung: "cc-by-4.0" });
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        vergissReisebilder();
        const antwort = await frage();
        expect(antwort.json).toEqual({ an: true, bilder: [], gekappt: false });
    });

    it("🔴 unter einem Notaus: das Bild erscheint nicht, ein anderes mit anderen Bytes schon", async () => {
        const gesperrt = await bild();
        const frei = await bild();
        await database`
            INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person)
            VALUES (${gesperrt.quelleSha}, ${gesperrt.assetId}::bigint, 'Test', ${randomUUID()}::uuid)`;
        vergissReisebilder();
        expect(ids(await frage())).toEqual([frei.assetPublicId]);
    });

    it("🔴 der Schalter media.role.photobox aus: an ist falsch und die Liste leer; an: die Bilder sind wieder da", async () => {
        const da = await bild();
        expect(ids(await frage())).toEqual([da.assetPublicId]);
        await schalterAus(true);
        const aus = await frage();
        expect(aus.status).toBe(200);
        expect(aus.json).toEqual({ an: false, bilder: [], gekappt: false });
        await alleSchalterAn();
        await database`UPDATE system_state SET content_revision = content_revision + 1 WHERE id = 1`;
        app.inhaltsschalter?.forget();
        expect(ids(await frage())).toEqual([da.assetPublicId]);
    });

    it("🔴 ein umgelegter Schalter trifft nie einen alten Eintrag des Speichers (die Inhaltsrevision steht im Schlüssel)", async () => {
        const da = await bild();
        expect(ids(await frage())).toEqual([da.assetPublicId]);
        // Ohne vergissReisebilder(): allein die neue Revision lässt den Speicher nicht mehr passen.
        await schalterAus(true);
        expect((await frage()).json.an).toBe(false);
    });

    it("🔴 der Schalter einer Lizenzfamilie oder Rechtsgrundlage hält ein einzelnes Bild zurück (dieselbe Entscheidung wie überall)", async () => {
        const ohneCc = await bild({ nutzung: "avesmaps_only" });
        await bild({ nutzung: "cc-by-4.0" });
        await database`
            INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
            VALUES ('media.rights.permission', false, now(), ${MARKE})
            ON CONFLICT (key) DO UPDATE SET enabled = false`;
        await database`UPDATE system_state SET content_revision = content_revision + 1 WHERE id = 1`;
        app.inhaltsschalter?.forget();
        try {
            const antwort = await frage();
            expect(antwort.json.an).toBe(true);
            expect(ids(antwort)).not.toContain(ohneCc.assetPublicId);
            expect(ids(antwort)).toHaveLength(1);
        } finally {
            await database`DELETE FROM content_switch WHERE key = 'media.rights.permission'`;
            await database`UPDATE system_state SET content_revision = content_revision + 1 WHERE id = 1`;
            app.inhaltsschalter?.forget();
        }
    });

    // --- Nichts Verborgenes -------------------------------------------------------------------------------------------------------

    it("🔴 der Text der Antwort enthält keinen Schlüssel, keine Prüfsumme, keinen Zustand, keine wartende Beschreibung, keine Nachricht der Redaktion; die Felder sind genau die der Liste", async () => {
        const ortSichtbar = await ort({ baender: "0145", subtype: "metropole" });
        const voll = await bild({
            x: 910,
            y: 920,
            ortId: ortSichtbar.id,
            name: "Alrik Testmann",
            nutzung: "cc-by-4.0",
            entstehung: "drawing",
            blickrichtung: 3,
            beschreibung: "Die Sichtbare Beschreibung",
            wartendeBeschreibung: "WARTENDE-BESCHREIBUNG-GEHEIM",
            nachricht: "NACHRICHT-DER-REDAKTION-GEHEIM",
        });
        const antwort = await frage();
        expect(antwort.status).toBe(200);
        expect(Value.Check(ReisebilderAntwort, antwort.json)).toBe(true);
        const text = antwort.text;
        for (const verboten of [
            "WARTENDE-BESCHREIBUNG-GEHEIM",
            "NACHRICHT-DER-REDAKTION-GEHEIM",
            voll.schluessel,
            schluesselHash(voll.schluessel).toString("hex"),
            schluesselHash(voll.schluessel).toString("base64"),
            voll.quelleSha,
            voll.submissionPublicId,
            voll.assetId === voll.submissionId ? "" : "private/",
            "published/",
            "storage",
            "approved",
            "pending",
            "zustand",
            "state",
            "revision",
            "terms",
            '"sha256"',
        ].filter((eintrag) => eintrag !== "")) {
            expect(text, `„${verboten}“ darf nicht in der Antwort stehen`).not.toContain(verboten);
        }
        const [eintrag] = antwort.json.bilder;
        expect(Object.keys(eintrag!).sort()).toEqual(
            [
                "beschreibung",
                "blickrichtung",
                "datei",
                "entstehung",
                "id",
                "kachel",
                "lage",
                "lizenz",
                "name",
                "ort",
            ].sort(),
        );
        expect(Object.keys(eintrag!.datei).sort()).toEqual(["breite", "hoehe", "url"]);
        expect(Object.keys(eintrag!.ort!).sort()).toEqual(["capitalBands", "id", "lage", "name", "subtype"]);
        expect(eintrag).toMatchObject({
            id: voll.assetPublicId,
            name: "Alrik Testmann",
            entstehung: "drawing",
            blickrichtung: 3,
            beschreibung: "Die Sichtbare Beschreibung",
            lizenz: { name: expect.stringContaining("CC BY") as unknown as string },
        });
        // Die Lizenz nennt, was der Katalog nennt; nur bei CC BY.
        expect(eintrag!.lizenz!.uri ?? "").toMatch(/^https?:\/\//u);
    });

    it("die Lizenz steht nur bei CC BY, die Nennung nur, wenn der Einreicher einen Namen angab", async () => {
        const nurAvesmaps = await bild({ nutzung: "avesmaps_only", name: null });
        const antwort = await frage();
        const [eintrag] = antwort.json.bilder;
        expect(eintrag!.id).toBe(nurAvesmaps.assetPublicId);
        expect(eintrag).not.toHaveProperty("lizenz");
        expect(eintrag).not.toHaveProperty("name");
        expect(eintrag).not.toHaveProperty("blickrichtung");
        expect(eintrag).not.toHaveProperty("ort");
    });

    it("🔴 ein verborgener und ein inaktiver Ort: kein ort in der Antwort, das Bild erscheint frei; ein sichtbarer Ort: Typ und Hauptstadtbänder wie in place_render", async () => {
        const verborgen = await ort({ verborgen: true, name: "Geheimort" });
        const inaktiv = await ort({ aktiv: false, name: "Altort" });
        const sichtbar = await ort({ subtype: "dorf", baender: "0123", name: "Sichtort" });
        const a = await bild({ x: 850, y: 850, ortId: verborgen.id });
        const b = await bild({ x: 860, y: 860, ortId: inaktiv.id });
        const c = await bild({ x: 870, y: 870, ortId: sichtbar.id });
        const antwort = await frage();
        const nach = new Map(antwort.json.bilder.map((eintrag) => [eintrag.id, eintrag]));
        expect(nach.get(a.assetPublicId)).toBeDefined();
        expect(nach.get(a.assetPublicId)).not.toHaveProperty("ort");
        expect(nach.get(b.assetPublicId)).toBeDefined();
        expect(nach.get(b.assetPublicId)).not.toHaveProperty("ort");
        // Weder der Name noch die Kennung der verborgenen Orte kommt irgendwo vor.
        expect(antwort.text).not.toContain("Geheimort");
        expect(antwort.text).not.toContain("Altort");
        expect(antwort.text).not.toContain(verborgen.publicId);
        expect(antwort.text).not.toContain(inaktiv.publicId);

        const [kachel] = await database<{ subtype: string; capital_bands: string | null }[]>`
            SELECT subtype, capital_bands FROM place_render WHERE public_id = ${sichtbar.publicId}::uuid`;
        expect(nach.get(c.assetPublicId)?.ort).toEqual({
            id: sichtbar.publicId,
            name: "Sichtort",
            lage: { x: 905, y: 905 },
            subtype: kachel!.subtype,
            capitalBands: kachel!.capital_bands,
        });
        expect(kachel).toEqual({ subtype: "dorf", capital_bands: "0123" });
    });

    it("ein sichtbarer Ort ohne Hauptstadtband: capitalBands fehlt (kein null)", async () => {
        const sichtbar = await ort({ subtype: "dorf" });
        await bild({ ortId: sichtbar.id });
        const [eintrag] = (await frage()).json.bilder;
        expect(eintrag!.ort).toBeDefined();
        expect(eintrag!.ort).not.toHaveProperty("capitalBands");
    });

    // --- Der Ausschnitt -----------------------------------------------------------------------------------------------------------

    it("🔴 ein Punkt auf der Kante des Ausschnitts ist drin, knapp außerhalb nicht; ein Nachbarausschnitt zeigt ihn ebenfalls auf der gemeinsamen Kante", async () => {
        const box = { x0: 896, y0: 896, x1: 960, y1: 960 };
        const links = await bild({ x: 896, y: 900 });
        const rechts = await bild({ x: 960, y: 900 });
        const unten = await bild({ x: 900, y: 896 });
        const oben = await bild({ x: 900, y: 960 });
        await bild({ x: 895, y: 900 });
        const rechtsDraussen = await bild({ x: 961, y: 900 });
        await bild({ x: 900, y: 895 });
        await bild({ x: 900, y: 961 });
        const antwort = await frage(box);
        expect(new Set(ids(antwort))).toEqual(
            new Set([links.assetPublicId, rechts.assetPublicId, unten.assetPublicId, oben.assetPublicId]),
        );
        // Die gemeinsame Kante gehört beiden Nachbarn.
        const nachbar = await frage({ x0: 960, y0: 896, x1: 1024, y1: 960 });
        expect(new Set(ids(nachbar))).toEqual(new Set([rechts.assetPublicId, rechtsDraussen.assetPublicId]));
    });

    it("🔴 ungültige Ausschnitte sind 422 reisebilder_ausschnitt: kein Vielfaches des Rasters, leer, verkehrt, außerhalb der Welt, kein Ganzes", async () => {
        const fehler = async (query: string): Promise<[number, string | undefined]> => {
            const antwort = await app.inject({ method: "GET", url: `${MEDIA_REISEBILDER_PUBLIC_URL}?${query}` });
            return [antwort.statusCode, (antwort.json() as { error?: { code?: string } }).error?.code];
        };
        for (const query of [
            "x0=10&y0=0&x1=64&y1=64",
            "x0=0&y0=0&x1=64&y1=65",
            "x0=64&y0=0&x1=64&y1=64",
            "x0=128&y0=0&x1=64&y1=64",
            "x0=0&y0=64&x1=64&y1=0",
            "x0=0&y0=0&x1=1088&y1=64",
            "x0=-64&y0=0&x1=64&y1=64",
            "x0=0.5&y0=0&x1=64&y1=64",
        ]) {
            expect(await fehler(query), query).toEqual([422, "reisebilder_ausschnitt"]);
        }
        // Eine Zahl, die keine ist, ist ein Fehler der Anfrage (400), kein Ausschnitt.
        expect((await fehler("x0=abc&y0=0&x1=64&y1=64"))[0]).toBe(400);
        expect((await fehler("x0=0&y0=0&x1=64"))[0]).toBe(400);
    });

    it("die ganze Welt ist ein gültiger Ausschnitt", async () => {
        const da = await bild();
        const antwort = await frage({ x0: 0, y0: 0, x1: 1024, y1: 1024 });
        expect(antwort.status).toBe(200);
        expect(ids(antwort)).toContain(da.assetPublicId);
    });

    it("🔴 mehr als 500 Bilder: 500 und gekappt, zweimal dieselbe Auswahl, und es sind die ersten nach der Kennung", async () => {
        const box = { x0: 832, y0: 832, x1: 896, y1: 896 };
        for (let i = 0; i < REISEBILD_AUSSCHNITT_MAX + 1; i += 1) {
            await bild({ x: 833 + (i % 60), y: 833 + Math.floor(i / 60) });
        }
        const erste = await frage(box);
        expect(erste.json.an).toBe(true);
        expect(erste.json.gekappt).toBe(true);
        expect(erste.json.bilder).toHaveLength(REISEBILD_AUSSCHNITT_MAX);
        vergissReisebilder();
        const zweite = await frage(box);
        expect(ids(zweite)).toEqual(ids(erste));
        const erwartet = await database<{ id: string }[]>`
            SELECT a.public_id::text AS id
              FROM media_submission s JOIN photobox_media m ON m.media_submission_id = s.id JOIN media_asset a ON a.id = m.media_asset_id
             WHERE s.terms_version = ${BEDINGUNGEN} AND s.state = 'approved'
             ORDER BY s.public_id LIMIT ${REISEBILD_AUSSCHNITT_MAX}`;
        expect(new Set(ids(erste))).toEqual(new Set(erwartet.map((zeile) => zeile.id)));
    });

    it("die Grenze des Resolvers: genau so viele wie erlaubt sind nicht gekappt, eines mehr ist es", async () => {
        for (let i = 0; i < 4; i += 1) await bild({ x: 900 + i, y: 900 });
        const box = { x0: 896, y0: 896, x1: 960, y1: 960 };
        expect(await resolveReisebilder(database, box, 4)).toMatchObject({ an: true, gekappt: false });
        expect((await resolveReisebilder(database, box, 4)).bilder).toHaveLength(4);
        const gekappt = await resolveReisebilder(database, box, 3);
        expect(gekappt.gekappt).toBe(true);
        expect(gekappt.bilder).toHaveLength(3);
    });

    it("🔴 die Abfrage nutzt den räumlichen Index media_submission_geom_gist", async () => {
        const plan = await database.begin(async (tx) => {
            await tx`SET LOCAL enable_seqscan = off`;
            const zeilen = await tx.unsafe<Record<string, string>[]>(
                `EXPLAIN ${REISEBILDER_QUERY}`,
                reisebilderParameter({ x0: 896, y0: 896, x1: 960, y1: 960 }, REISEBILD_AUSSCHNITT_MAX),
            );
            return zeilen.map((zeile) => zeile["QUERY PLAN"]).join("\n");
        });
        expect(plan).toContain("media_submission_geom_gist");
    });

    // --- Zwischenspeicher ---------------------------------------------------------------------------------------------------------

    it("ETag und 304: no-cache, gleiche Antwort gleicher ETag, if-none-match (auch schwach, auch in einer Liste) bringt 304 ohne Körper", async () => {
        await bild();
        const erste = await frage();
        expect(erste.status).toBe(200);
        expect(erste.kopf["cache-control"]).toBe("no-cache");
        expect(erste.kopf["content-type"]).toContain("application/json");
        const etag = String(erste.kopf["etag"]);
        expect(etag).toMatch(/^"[0-9a-f]{16}"$/u);
        expect((await frage()).kopf["etag"]).toBe(etag);

        for (const gesendet of [etag, `W/${etag}`, `"anders", ${etag}`]) {
            const antwort = await frage(FELD, { "if-none-match": gesendet });
            expect(antwort.status, gesendet).toBe(304);
            expect(antwort.text).toBe("");
            expect(antwort.kopf["cache-control"]).toBe("no-cache");
            expect(antwort.kopf["etag"]).toBe(etag);
        }
        // Ein anderer Stand hat einen anderen ETag, ein alter bringt wieder 200.
        await bild({ x: 840, y: 840 });
        vergissReisebilder();
        const neu = await frage(FELD, { "if-none-match": etag });
        expect(neu.status).toBe(200);
        expect(neu.kopf["etag"]).not.toBe(etag);
        expect(neu.json.bilder).toHaveLength(2);
    });

    it("ohne Bilder: 200 mit leerer Liste, an ist wahr", async () => {
        const antwort = await frage({ x0: 0, y0: 0, x1: 64, y1: 64 });
        expect(antwort.status).toBe(200);
        expect(antwort.json).toEqual({ an: true, bilder: [], gekappt: false });
    });

    it("🔴 der Speicher des Servers hält eine Antwort höchstens 15 Sekunden, und Gegenprobe: ohne die Offline-Wege bleibt ein Bild bis dahin stehen", async () => {
        expect(REISEBILDER_SPEICHER_MS).toBe(15_000);
        const b = await bild({ x: 900, y: 900 });
        expect(ids(await frage())).toEqual([b.assetPublicId]);
        // Am Weg der Operationen vorbei (kein vergissReisebilder): die zwischengespeicherte Antwort trägt das Bild weiter.
        await database`UPDATE media_submission SET state = 'offline' WHERE id = ${b.submissionId}::bigint`;
        await database`UPDATE photobox_media SET retired_at = now() WHERE media_submission_id = ${b.submissionId}::bigint`;
        expect(ids(await frage())).toEqual([b.assetPublicId]);
        vergissReisebilder();
        expect(ids(await frage())).toEqual([]);
    });

    it("🔴 Offline durch den Einreicher wirkt sofort, auch innerhalb der 15 Sekunden des Speichers", async () => {
        const bleibt = await bild({ x: 850, y: 850 });
        const geht = await bild({ x: 860, y: 860 });
        expect(new Set(ids(await frage()))).toEqual(new Set([bleibt.assetPublicId, geht.assetPublicId]));
        await offlineNehmen(database, store, "test", {
            operationId: neueOperation(spuren),
            schluessel: geht.schluessel,
        });
        const danach = await frage();
        expect(ids(danach)).toEqual([bleibt.assetPublicId]);
        expect(danach.text).not.toContain(geht.assetPublicId);
    });

    it("🔴 Offline durch die Redaktion wirkt sofort, auch innerhalb der 15 Sekunden des Speichers", async () => {
        const bleibt = await bild({ x: 850, y: 850 });
        const geht = await bild({ x: 860, y: 860 });
        expect(new Set(ids(await frage()))).toEqual(new Set([bleibt.assetPublicId, geht.assetPublicId]));
        const [revision] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_submission WHERE id = ${geht.submissionId}::bigint`;
        await nehmeOffline(database, store, { personId: redaktion.id, environment: "test" }, geht.submissionPublicId, {
            operationId: neueOperation(spuren),
            baseRevision: revision!.revision,
        });
        const danach = await frage();
        expect(ids(danach)).toEqual([bleibt.assetPublicId]);
        expect(danach.text).not.toContain(geht.assetPublicId);
    });

    it("🔴 ein neuer Notaus und sein Aufheben wirken ebenfalls sofort (die Operationen leeren den Speicher)", async () => {
        const b = await bild({ x: 900, y: 900 });
        expect(ids(await frage())).toEqual([b.assetPublicId]);
        const seit = (await database<{ max: number | null }[]>`SELECT max(id)::int AS max FROM job`)[0]?.max ?? 0;
        const akteur = { personId: redaktion.id, environment: "test" } as const;
        await suspendAsset(database, akteur, b.assetPublicId, { operationId: neueOperation(spuren), reason: "Test" });
        expect(ids(await frage())).toEqual([]);
        const [zeile] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_publication_suspension WHERE source_sha256 = ${b.quelleSha} AND lifted_at IS NULL`;
        await liftSuspension(database, akteur, b.assetPublicId, {
            operationId: neueOperation(spuren),
            baseRevision: zeile!.revision,
            reason: "Test",
        });
        expect(ids(await frage())).toEqual([b.assetPublicId]);
        await database`DELETE FROM job_event WHERE job_id IN (SELECT id FROM job WHERE id > ${seit} AND kind IN ('media_quarantine', 'media_settle'))`;
        await database`DELETE FROM job WHERE id > ${seit} AND kind IN ('media_quarantine', 'media_settle')`;
    });

    it("Antworten vor dem Vergessen werden danach nicht mehr abgelegt (eine Anfrage, die noch rechnet, darf den Speicher nicht mit altem Stand füllen)", async () => {
        const b = await bild({ x: 900, y: 900 });
        // Eine Datenbank, deren erste Frage der Abfrage wartet, bis das Vergessen geschehen ist.
        let freigeben: () => void = () => undefined;
        const warten = new Promise<void>((weiter) => {
            freigeben = weiter;
        });
        let gelesen: () => void = () => undefined;
        const nachGelesen = new Promise<void>((weiter) => {
            gelesen = weiter;
        });
        const verzoegert = new Proxy(database, {
            get(ziel, eigenschaft) {
                const wert = Reflect.get(ziel, eigenschaft, ziel) as unknown;
                if (eigenschaft === "unsafe" && typeof wert === "function") {
                    return async (...argumente: unknown[]) => {
                        const zeilen = await (wert as (...a: unknown[]) => Promise<unknown>).apply(ziel, argumente);
                        gelesen();
                        await warten;
                        return zeilen;
                    };
                }
                return typeof wert === "function" ? (wert as (...a: unknown[]) => unknown).bind(ziel) : wert;
            },
            apply(ziel, dies, argumente) {
                return Reflect.apply(ziel, dies, argumente) as unknown;
            },
        }) as Database;
        const laufend = liesReisebilder(verzoegert, FELD);
        await nachGelesen;
        // Das Bild geht offline, während die Anfrage mit altem Stand noch wartet.
        await database`UPDATE media_submission SET state = 'offline' WHERE id = ${b.submissionId}::bigint`;
        vergissReisebilder();
        freigeben();
        const alt = JSON.parse((await laufend).body) as ReisebilderAntwort;
        expect(alt.bilder.map((eintrag) => eintrag.id)).toEqual([b.assetPublicId]);
        // Der Speicher hat die alte Antwort nicht aufgenommen: die nächste liest neu.
        expect(ids(await frage())).toEqual([]);
    });

    // --- Drossel ------------------------------------------------------------------------------------------------------------------

    it("🔴 die Drossel steht vor der Datenbank: mit drei Aufrufen je Stunde ist der vierte 429 und fragt die Datenbank nicht, auch ein ungültiger Ausschnitt zählt", async () => {
        await bild();
        let fragen = 0;
        const zaehlend = new Proxy(database, {
            apply(ziel, dies, argumente) {
                fragen += 1;
                return Reflect.apply(ziel, dies, argumente) as unknown;
            },
            get(ziel, eigenschaft) {
                const wert = Reflect.get(ziel, eigenschaft, ziel) as unknown;
                if (eigenschaft === "unsafe" && typeof wert === "function") {
                    return (...argumente: unknown[]) => {
                        fragen += 1;
                        return (wert as (...a: unknown[]) => unknown).apply(ziel, argumente);
                    };
                }
                return typeof wert === "function" ? (wert as (...a: unknown[]) => unknown).bind(ziel) : wert;
            },
        }) as Database;
        const klein = Fastify();
        registerErrorHandler(klein);
        klein.decorate("database", zaehlend);
        await klein.register(reisebilderRoutes, { jeStunde: 3 });
        await klein.ready();
        try {
            const abfrage = (query: string, ip: string) =>
                klein.inject({
                    method: "GET",
                    url: `${MEDIA_REISEBILDER_PUBLIC_URL}?${query}`,
                    remoteAddress: ip,
                });
            const gut = "x0=832&y0=832&x1=1024&y1=1024";
            expect((await abfrage(gut, "10.60.0.1")).statusCode).toBe(200);
            expect((await abfrage(gut, "10.60.0.1")).statusCode).toBe(200);
            expect((await abfrage("x0=1&y0=2&x1=3&y1=4", "10.60.0.1")).statusCode).toBe(422);
            const vorher = fragen;
            expect(vorher).toBeGreaterThan(0);
            for (const query of [gut, "x0=1&y0=2&x1=3&y1=4", "x0=abc"]) {
                const gedrosselt = await abfrage(query, "10.60.0.1");
                expect(gedrosselt.statusCode, query).toBe(429);
                expect((gedrosselt.json() as { error: { code: string } }).error.code).toBe("reisebilder_rate");
                expect(gedrosselt.headers["retry-after"]).toBeDefined();
            }
            expect(fragen).toBe(vorher);
            // Eine andere Adresse hat ihr eigenes Maß.
            expect((await abfrage(gut, "10.60.0.2")).statusCode).toBe(200);
        } finally {
            await klein.close();
        }
    });

    it("ohne Datenbank: 200 mit an: false, kein Fehler; auch der Ausschnitt wird noch geprüft", async () => {
        const ohne = Fastify();
        registerErrorHandler(ohne);
        ohne.decorate("database", undefined);
        await ohne.register(reisebilderRoutes);
        await ohne.ready();
        try {
            const antwort = await ohne.inject({ method: "GET", url: url(FELD) });
            expect(antwort.statusCode).toBe(200);
            expect(JSON.parse(antwort.body)).toEqual({ an: false, bilder: [], gekappt: false });
            expect(antwort.headers["cache-control"]).toBe("no-cache");
            const kaputt = await ohne.inject({
                method: "GET",
                url: `${MEDIA_REISEBILDER_PUBLIC_URL}?x0=1&y0=1&x1=2&y1=2`,
            });
            expect(kaputt.statusCode).toBe(422);
        } finally {
            await ohne.close();
        }
    });

    it("ohne die Tafeln (Schema fehlt noch): 200 mit an: false statt eines Fehlers", async () => {
        const fehlt = () => new postgres.PostgresError({ message: "relation does not exist", code: "42P01" } as never);
        const fehlendes = new Proxy(database, {
            apply() {
                throw fehlt();
            },
            get(ziel, eigenschaft) {
                if (eigenschaft === "unsafe") {
                    return () => {
                        throw fehlt();
                    };
                }
                return Reflect.get(ziel, eigenschaft, ziel) as unknown;
            },
        }) as Database;
        const klein = Fastify();
        registerErrorHandler(klein);
        klein.decorate("database", fehlendes);
        await klein.register(reisebilderRoutes);
        await klein.ready();
        try {
            const antwort = await klein.inject({ method: "GET", url: url(FELD) });
            expect(antwort.statusCode).toBe(200);
            expect(JSON.parse(antwort.body)).toEqual({ an: false, bilder: [], gekappt: false });
        } finally {
            await klein.close();
        }
    });
});
