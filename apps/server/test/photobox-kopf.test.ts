import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MEDIA_EDITOR_PREVIEW_URL_PATTERN,
    MEDIA_EDITOR_URL,
    MEDIA_ROLE_SWITCH,
    PHOTOBOX_CREATION_METHOD,
    PHOTOBOX_ORT_EINGAENGE_MAX,
    PHOTOBOX_RIGHTS,
    MamSearchResult,
    MediaPublicView,
    PhotoboxOrtEingaenge,
    PhotoboxStatus,
    SubjectDetail,
    mediaPhotoboxOrtEingaengeUrl,
    MEDIA_PHOTOBOX_GALERIEN_URL,
    MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL,
    mediaPhotoboxOrtReisebilderUrl,
    mediaPublicUrl,
    subjectDetailUrl,
    type PhotoboxCreationKind,
    type PhotoboxSubmissionState,
    type PhotoboxGalerien,
    type PhotoboxOrtReisebilder,
    type PhotoboxUsageGrant,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { schluesselHash } from "../src/community/db.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { mediaNavigation } from "../src/media-editor/search.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { suspendAsset } from "../src/media-editor/suspension.ts";
import {
    resolvePlaceMedia,
    resolvePlaceMediaParts,
    resolveReisebild,
    resolveReisebilder,
} from "../src/media/resolver.ts";
import { MediaStore, storageKey } from "../src/media/storage.ts";
import { PUBLICATION_RULE_SEEDS, seedPublicationRules } from "../src/migration/media-rules.ts";
import { lizenzfamilie, technikNachziehen } from "../src/photobox/db.ts";
import { einreichen } from "../src/photobox/einreichen.ts";
import { vergissReisebilder } from "../src/photobox/karte.ts";
import { nehmeOffline } from "../src/photobox/redaktion.ts";
import { statusLesen } from "../src/photobox/status.ts";
import { TEST_AUTH, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { cleanMediaFixtures, insertAsset, insertGallery, insertPlace, sha } from "./support/media-fixture.ts";
import {
    einreichung as neueEinreichung,
    neueOperation,
    neueSpuren,
    neuerSchluessel,
    raeumeAuf as raeumeEinreichungenAuf,
    type Spuren,
} from "./support/photobox-fixture.ts";

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

/**
 * Reisebilder im Kopf der Infobox eines Ortes (WI-0272 S5) gegen echtes PostgreSQL und die echte Anwendung:
 *
 * - **Resolver:** Freigegebene Reisebilder eines Ortes stehen hinter einer Ortsansicht, ohne Ortsansicht ersetzen sie die Typbilder; mit dem Bildbezug `reisebild` und den Angaben, die Besucher auch auf der
 *   Karte sehen. Nur, wer ausdrücklich danach fragt (`reisebilder: true`): Wer den Resolver sonst liest (Prüfer der Medienparität, Medienverwaltung, ein Gipfel aus einem Ort), bekommt nichts Neues.
 * - 🔴 **Nur Veröffentlichtes, je Zustand einzeln:** eingegangen, geprüft, Rückfrage, abgelehnt, zurückgezogen, offline, Verwendung zurückgenommen, ohne öffentliche Datei, Medium nicht freigegeben, ohne Regel,
 *   Schalter aus, Notaus; ein Bild eines anderen Ortes oder ohne Ort steht nicht im Kopf. „Titelbild entfernen“ (`header.none`) heißt Typbild und blendet keine Reisebilder aus (Valis Kopfregel 2026-11-02).
 * - 🔴 **Eingänge nur geschützt:** Die öffentliche Antwort des Ortes, öffentlich zwischengespeichert, kennt keinen offenen Eingang. Die eigene Route verlangt `view_media_private` (401, 403), antwortet `no-store`
 *   und nennt nur Kennung, Adresse und Maße der internen Vorschau.
 * - **Auswahl:** `ohneReisebilder` lässt Reisebilder aus der Liste der Medienverwaltung weg (auch ein ersetztes Bild einer Einreichung).
 *
 * Die Bilder des Resolvers entstehen mit SQL (acht Tafeln je Bild), die Eingänge über das echte Einreichen. Alles trägt Marken (Fassung der Bedingungen `kopf-test`, die Orte der Fixtures) und wird aufgeräumt.
 */

const BEDINGUNGEN = "kopf-test";
const REGELN = PUBLICATION_RULE_SEEDS.filter((seed) => seed.role === "photobox");
const REGEL_TEXTE = REGELN.map((regel) => regel.scopeText);
const ROLLEN_MIT_MAM: readonly Role[] = ["reviewer", "editor"];
const OWN_CLEARED = { basis: "own_work", clearance: "cleared" } as const;

interface BildWunsch {
    ort?: { id: string } | null;
    /** Zustand der Einreichung; Vorgabe `approved`. */
    zustand?: PhotoboxSubmissionState;
    medium?: "approved" | "pending" | "rejected";
    verwendung?: "aktiv" | "zurueckgenommen" | "keine";
    dateien?: "haupt" | "keine";
    nutzung?: PhotoboxUsageGrant;
    entstehung?: PhotoboxCreationKind;
    name?: string | null;
    beschreibung?: string;
}

interface Bild {
    assetId: string;
    assetPublicId: string;
    submissionId: string;
    submissionPublicId: string;
    hauptSha: string;
    quelleSha: string;
}

describeWithDatabase("Reisebilder im Kopf eines Ortes (WI-0272 S5)", { timeout: 240_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    let mediaRoot = "";
    let store: MediaStore;
    let redaktion: { id: string };
    const cookies = new Map<Role, string>();
    const spuren: Spuren = neueSpuren();
    let zaehler = 0;
    let ortNr = 400;

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "photobox-kopf-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        auth: TEST_AUTH,
    });

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await aufraeumen();
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-photobox-kopf-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        for (const role of ["tester", ...ROLLEN_MIT_MAM] as const) {
            const person = await fixture.person(role, { name: `Kopf ${role}` });
            if (role === "editor") redaktion = { id: person.id };
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config: config(),
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
        await aufraeumen();
        await alleSchalterAn();
        await seedPublicationRules(database, REGELN);
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    // --- Hilfen -------------------------------------------------------------------------------------------------------------------

    async function alleSchalterAn(): Promise<void> {
        await database`DELETE FROM content_switch WHERE key = 'media.role.photobox'`;
        app?.inhaltsschalter?.forget();
    }

    async function aufraeumen(): Promise<void> {
        // Reisebilder aus SQL: erst die Verwendung und die Einreichung, dann gehen die Assets mit `cleanMediaFixtures`.
        await database`DELETE FROM photobox_media WHERE media_submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${BEDINGUNGEN})`;
        await database`DELETE FROM media_submission WHERE terms_version = ${BEDINGUNGEN}`;
        await database`DELETE FROM media_publication_suspension WHERE media_asset_id IN (SELECT id FROM media_asset WHERE source_system = 'media-test')`;
        await raeumeEinreichungenAuf(database, spuren);
        await cleanMediaFixtures(database);
        spuren.schluessel.length = 0;
        spuren.operationen.length = 0;
        zaehler = 0;
    }

    /** Ein Ort der Fixtures (feste Kennung, `cleanMediaFixtures` räumt ihn ab). */
    const neuerOrt = async (): Promise<{ id: string; publicId: string }> => {
        ortNr += 1;
        return insertPlace(database, ortNr);
    };

    /** Die Kopfbilder des Ortes als Legacy-Galerie, in dieser Folge: `ortsansicht` mit eigener Quelldatei, `typbild` übersteuert zum Typbild. Gibt die Kennungen der Assets zurück. */
    async function kopfbilder(
        ort: { id: string },
        bilder: readonly (readonly [string, "ortsansicht" | "typbild"])[],
    ): Promise<string[]> {
        const galerie = await insertGallery(database, `kopf-galerie-${ort.id}`);
        await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin) VALUES (${ort.id}, ${galerie.id}, 'header', 'legacy')`;
        const kennungen: string[] = [];
        for (const [stelle, [ref, art]] of bilder.entries()) {
            const asset = await insertAsset(database, {
                ref,
                rights: OWN_CLEARED,
                published: [{ variant: "header_16_9" }],
            });
            const quelle = sha(`quelle:${ref}`);
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset.id}, 'source', 'private_source', ${storageKey("private_source", quelle, "png")}, 'image/png', 1600, 900, 4321, ${quelle})`;
            await database`
                INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order, image_relation_override)
                VALUES (${galerie.id}, ${asset.id}, ${stelle}, ${art === "typbild" ? "type_image" : null})`;
            kennungen.push(asset.publicId);
        }
        return kennungen;
    }

    /** Ein Reisebild mit allem, was der Kopf liest, gleich so, wie die Freigabe es hinterlässt (oder wie der Wunsch es abweichen lässt). */
    async function bild(wunsch: BildWunsch = {}): Promise<Bild> {
        zaehler += 1;
        const n = zaehler;
        const nutzung = wunsch.nutzung ?? "avesmaps_only";
        const entstehung = wunsch.entstehung ?? "photo";
        const zustand = wunsch.zustand ?? "approved";
        const hauptSha = createHash("sha256")
            .update(`kopf:${String(n)}:haupt:${randomUUID()}`)
            .digest("hex");
        const quelleSha = createHash("sha256")
            .update(`kopf:${String(n)}:quelle:${randomUUID()}`)
            .digest("hex");
        const rechte = PHOTOBOX_RIGHTS[nutzung];
        const familie = await lizenzfamilie(database, rechte.licenseKey);
        const name = wunsch.name === undefined ? null : wunsch.name;
        return database.begin(async (tx) => {
            const [asset] = await tx<{ id: string; public_id: string }[]>`
                INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
                VALUES ('image', 'picture', 'community_upload', ${PHOTOBOX_CREATION_METHOD[entstehung]}, 'ok',
                        ${wunsch.medium ?? "approved"}, 'media-test')
                RETURNING id::text AS id, public_id::text AS public_id`;
            await tx`
                INSERT INTO media_rights (media_asset_id, rights_basis, license_key, license_family, creator, attribution, clearance_state)
                VALUES (${asset!.id}::bigint, ${rechte.basis}, ${rechte.licenseKey}, ${familie}, ${name}, ${name}, 'unreviewed')`;
            await tx`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${asset!.id}::bigint, 'source', 'private_source', ${storageKey("private_source", quelleSha, "png")}, 'image/png', 1600, 900, 1234, ${quelleSha})`;
            if ((wunsch.dateien ?? "haupt") === "haupt") {
                await tx`
                    INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                    VALUES (${asset!.id}::bigint, 'photobox_2048', 'published', ${storageKey("published", hauptSha, "webp")}, 'image/webp', 1600, 900, 1234, ${hauptSha}, 'photobox_2048', '1')`;
            }
            const [einreichung] = await tx<{ id: string; public_id: string }[]>`
                INSERT INTO media_submission (status_key_hash, map_domain_id, geom, place_id, creation_kind, usage_grant, description,
                                              attribution_name, terms_version, state, approved_media_asset_id, decided_at)
                VALUES (${schluesselHash(neuerSchluessel(spuren))}, 'aventuria', ST_SetSRID(ST_MakePoint(300, 300), 0),
                        ${wunsch.ort === null || wunsch.ort === undefined ? null : wunsch.ort.id}::bigint, ${entstehung}, ${nutzung},
                        ${wunsch.beschreibung ?? `Der Blick Nummer ${String(n)}`}, ${name}, ${BEDINGUNGEN}, ${zustand},
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
                hauptSha,
                quelleSha,
            };
        });
    }

    const kopf = async (ort: { publicId: string }): Promise<MediaPublicView[]> =>
        (await resolvePlaceMedia(database, ort.publicId, { reisebilder: true })).filter(
            (sicht) => sicht.role === "header" || sicht.role === "photobox",
        );
    const ids = (sichten: readonly MediaPublicView[]): string[] => sichten.map((sicht) => sicht.id);

    // --- Resolver -----------------------------------------------------------------------------------------------------------------

    it("🔴 ohne die Option liefert der Resolver keine Reisebilder (Prüfer, Medienverwaltung und Gipfel lesen weiter nur Wappen und Kopfbilder)", async () => {
        const ort = await neuerOrt();
        await bild({ ort });
        expect(await resolvePlaceMedia(database, ort.publicId)).toEqual([]);
        expect((await resolvePlaceMediaParts(database, ort.publicId)).delivered).toEqual([]);
        expect(await kopf(ort)).toHaveLength(1);
    });

    it("🔴 ohne Ortsansicht reiht sich das Reisebild hinter die Typbilder (Vali 2026-11-09); Bezug, Beschreibung, Name und Entstehung gehen mit", async () => {
        const ort = await neuerOrt();
        const [typ] = await kopfbilder(ort, [["kopf-typ", "typbild"]]);
        const da = await bild({ ort, name: "Alrik", beschreibung: "Der Blick vom Hafen", entstehung: "drawing" });
        const teile = await resolvePlaceMediaParts(database, ort.publicId, { reisebilder: true });
        expect(ids(teile.delivered)).toEqual([typ, da.assetPublicId]);
        expect(teile.withheld).toEqual([]);
        const sicht = teile.delivered[1]!;
        expect(sicht).toMatchObject({
            role: "photobox",
            relation: "reisebild",
            url: mediaPublicUrl(da.hauptSha),
            width: 1600,
            height: 900,
            reisebild: { beschreibung: "Der Blick vom Hafen", name: "Alrik", entstehung: "drawing" },
            credit: { creator: "Alrik" },
        });
        expect(Value.Check(MediaPublicView, sicht), JSON.stringify([...Value.Errors(MediaPublicView, sicht)])).toBe(
            true,
        );
    });

    it("ohne Namen fehlt der Name im Block (die Oberfläche setzt „anonym“)", async () => {
        const ort = await neuerOrt();
        await bild({ ort, name: null });
        const sichten = await kopf(ort);
        expect(sichten).toHaveLength(1);
        expect(sichten[0]!.reisebild).toBeDefined();
        expect(sichten[0]!.reisebild).not.toHaveProperty("name");
        expect(sichten[0]!.credit?.creator).toBeUndefined();
    });

    it("🔴 eine vorhandene Ortsansicht bleibt das erste Bild, die Reisebilder folgen in der Reihenfolge der Freigabe", async () => {
        const ort = await neuerOrt();
        const [ansicht, typ] = await kopfbilder(ort, [
            ["kopf-ansicht", "ortsansicht"],
            ["kopf-typ-2", "typbild"],
        ]);
        const erstes = await bild({ ort });
        const zweites = await bild({ ort });
        const sichten = await kopf(ort);
        expect(ids(sichten)).toEqual([ansicht, erstes.assetPublicId, zweites.assetPublicId]);
        expect(sichten.map((sicht) => sicht.relation)).toEqual(["place_view", "reisebild", "reisebild"]);
        expect(ids((await resolvePlaceMediaParts(database, ort.publicId, { reisebilder: true })).withheld)).toEqual([
            typ,
        ]);
    });

    it("🔴 ein Typbild bleibt, solange es kein öffentliches Reisebild gibt (Gegenprobe zu „ersetzt“)", async () => {
        const ort = await neuerOrt();
        const [typ] = await kopfbilder(ort, [["kopf-typ-3", "typbild"]]);
        await bild({ ort, zustand: "pending", verwendung: "keine", medium: "pending" });
        expect(ids(await kopf(ort))).toEqual([typ]);
    });

    it("🔴 nur Veröffentlichtes: jeder Zustand, der es nicht ist, fehlt im Kopf, je einzeln", async () => {
        const ort = await neuerOrt();
        const da = await bild({ ort });
        for (const zustand of [
            "incoming",
            "technical_failed",
            "pending",
            "changes_requested",
            "rejected",
            "withdrawn",
            "offline",
            "expired",
        ] as const) {
            await bild({ ort, zustand, verwendung: "keine", medium: "pending" });
            // Auch mit einer aktiven Verwendung: nur der Zustand `approved` zählt.
            await bild({ ort, zustand });
        }
        expect(ids(await kopf(ort))).toEqual([da.assetPublicId]);
        await bild({ ort, verwendung: "zurueckgenommen" });
        await bild({ ort, dateien: "keine" });
        await bild({ ort, medium: "pending" });
        await bild({ ort, medium: "rejected" });
        expect(ids(await kopf(ort))).toEqual([da.assetPublicId]);
    });

    it("🔴 ohne die Freigaberegel der Rolle bleibt auch ein freigegebenes Reisebild aus dem Kopf (erst prüfen, dann zeigen)", async () => {
        const ort = await neuerOrt();
        await bild({ ort });
        await bild({ ort, nutzung: "cc-by-4.0", name: "Anna" });
        expect(await kopf(ort)).toHaveLength(2);
        await database`DELETE FROM publication_rule WHERE scope_text = ANY(${REGEL_TEXTE})`;
        expect(await kopf(ort)).toEqual([]);
    });

    it("🔴 ein Bild eines anderen Ortes und ein Bild ohne Ort stehen nicht im Kopf", async () => {
        const hier = await neuerOrt();
        const anders = await neuerOrt();
        const eigenes = await bild({ ort: hier });
        await bild({ ort: anders });
        await bild({ ort: null });
        expect(ids(await kopf(hier))).toEqual([eigenes.assetPublicId]);
    });

    it("🔴 der Schalter der Rolle (media.role.photobox) nimmt die Reisebilder aus dem Kopf", async () => {
        const ort = await neuerOrt();
        await bild({ ort });
        expect(await kopf(ort)).toHaveLength(1);
        await database`
            INSERT INTO content_switch (key, enabled, changed_at, changed_by_label)
            VALUES (${MEDIA_ROLE_SWITCH["photobox"] ?? "media.role.photobox"}, false, now(), 'kopf-test')
            ON CONFLICT (key) DO UPDATE SET enabled = false`;
        app.inhaltsschalter?.forget();
        // Der Resolver rechnet mit dem Stand des Speichers der Anwendung (`inhaltsstandFuer`, ohne Datenbankfrage): gelesen wird frisch.
        expect(await kopf(ort)).toEqual([]);
    });

    it("🔴 Notaus nimmt das Bild heraus, Offline durch die Redaktion ebenso (die Verwendung ist zurückgenommen)", async () => {
        const ort = await neuerOrt();
        const bleibt = await bild({ ort });
        const notaus = await bild({ ort });
        const offline = await bild({ ort });
        expect(await kopf(ort)).toHaveLength(3);
        await suspendAsset(database, { personId: redaktion.id, environment: "test" }, notaus.assetPublicId, {
            operationId: neueOperation(spuren),
            reason: "Test",
        });
        const [revision] = await database<{ revision: number }[]>`
            SELECT revision::int AS revision FROM media_submission WHERE id = ${offline.submissionId}::bigint`;
        await nehmeOffline(
            database,
            store,
            { personId: redaktion.id, environment: "test" },
            offline.submissionPublicId,
            {
                operationId: neueOperation(spuren),
                baseRevision: revision!.revision,
            },
        );
        expect(ids(await kopf(ort))).toEqual([bleibt.assetPublicId]);
    });

    it("🔴 Valis Kopfregel (Fassung 2026-11-09): Typbild; Typbild zuerst, dann Reisebilder; eigenes Titelbild; eigenes Titelbild zuerst, dann Reisebilder", async () => {
        const nurTyp = await neuerOrt();
        const [typbild] = await kopfbilder(nurTyp, [[`regel-typ-${randomUUID()}`, "typbild"]]);
        expect(ids(await kopf(nurTyp))).toEqual([typbild]);

        const typUndReise = await neuerOrt();
        const [typVorn] = await kopfbilder(typUndReise, [[`regel-typ-${randomUUID()}`, "typbild"]]);
        const erstes = await bild({ ort: typUndReise });
        const zweites = await bild({ ort: typUndReise });
        expect(ids(await kopf(typUndReise))).toEqual([typVorn, erstes.assetPublicId, zweites.assetPublicId]);

        const nurEigenes = await neuerOrt();
        const [eigenes] = await kopfbilder(nurEigenes, [[`regel-eigen-${randomUUID()}`, "ortsansicht"]]);
        expect(ids(await kopf(nurEigenes))).toEqual([eigenes]);

        const eigenesUndReise = await neuerOrt();
        const [titelbild] = await kopfbilder(eigenesUndReise, [[`regel-eigen-${randomUUID()}`, "ortsansicht"]]);
        const dahinter = await bild({ ort: eigenesUndReise });
        expect(ids(await kopf(eigenesUndReise))).toEqual([titelbild, dahinter.assetPublicId]);
    });

    it("🔴 „Titelbild entfernen“ heißt Typbild und blendet keine Reisebilder aus (Vali: „kein titelbild aber typbild“)", async () => {
        const mitReise = await neuerOrt();
        const da = await bild({ ort: mitReise });
        await database`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${mitReise.id}, 'header', 'editor')`;
        expect(ids(await kopf(mitReise))).toEqual([da.assetPublicId]);

        // Ohne Reisebilder bleibt kein gebundenes Bild: Der Kopf zeigt die Grafik der Art (Typbild).
        const ohneReise = await neuerOrt();
        await database`INSERT INTO place_media_suppression (place_id, role, origin) VALUES (${ohneReise.id}, 'header', 'editor')`;
        expect(await kopf(ohneReise)).toEqual([]);
    });

    it("🔴 die Leiste nennt alle freigegebenen Reisebilder: die an einem Ort und die frei auf der Karte", async () => {
        const ort = await neuerOrt();
        const amOrt = await bild({ ort });
        const frei = await bild({});
        const antwort = await resolveReisebilder(database, { x0: 0, y0: 0, x1: 1024, y1: 1024 }, 200);
        const gefunden = antwort.bilder.map((eintrag) => eintrag.id);
        expect(gefunden).toContain(amOrt.assetPublicId);
        expect(gefunden).toContain(frei.assetPublicId);
    });

    it("der Stand der Reisebilder fährt im Takt der offenen Seite mit: Er ändert ETag und Antwort, sobald sich die Reisebilder ändern", async () => {
        vergissReisebilder();
        const vorher = await app.inject({ method: "GET", url: "/api/content-state" });
        expect(vorher.statusCode, vorher.body).toBe(200);
        expect(vorher.json().reisebilder).toEqual(expect.any(String));
        const gleich = await app.inject({
            method: "GET",
            url: "/api/content-state",
            headers: { "if-none-match": String(vorher.headers["etag"]) },
        });
        expect(gleich.statusCode).toBe(304);

        await bild({ ort: await neuerOrt() });
        vergissReisebilder();
        const danach = await app.inject({
            method: "GET",
            url: "/api/content-state",
            headers: { "if-none-match": String(vorher.headers["etag"]) },
        });
        expect(danach.statusCode).toBe(200);
        expect(danach.json().reisebilder).not.toBe(vorher.json().reisebilder);
    });

    // --- Die öffentliche Antwort ----------------------------------------------------------------------------------------------------

    it("🔴 für „Ohne KI“ nennt die öffentliche Antwort die zurückgehaltenen Typbilder und kennzeichnet KI-Ortsansichten", async () => {
        const ort = await neuerOrt();
        const [typ, ansicht, foto] = await kopfbilder(ort, [
            [`ki-typ-${randomUUID()}`, "typbild"],
            [`ki-ansicht-${randomUUID()}`, "ortsansicht"],
            [`ki-foto-${randomUUID()}`, "ortsansicht"],
        ]);
        await database`UPDATE media_asset SET creation_method = 'ai_generated' WHERE public_id = ${ansicht!}::uuid`;
        const da = await bild({ ort, entstehung: "ai_generated" });
        const antwort = await app.inject({
            method: "GET",
            url: subjectDetailUrl({ kind: "place", id: ort.publicId })!,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const detail = antwort.json() as SubjectDetail;
        expect(
            Value.Check(SubjectDetail, detail),
            JSON.stringify([...Value.Errors(SubjectDetail, detail)].slice(0, 3)),
        ).toBe(true);
        const kopfSichten = new Map(detail.media?.header?.map((sicht) => [sicht.id, sicht]));
        expect(kopfSichten.get(ansicht!)?.ki).toBe(true);
        expect(kopfSichten.get(foto!)?.ki).toBeUndefined();
        expect(kopfSichten.get(da.assetPublicId)?.reisebild?.entstehung).toBe("ai_generated");
        expect(detail.media?.typbilder?.map((sicht) => sicht.id)).toEqual([typ]);
    });

    it("ein Ort ohne zurückgehaltenes Typbild trägt das Feld nicht", async () => {
        const ort = await neuerOrt();
        await kopfbilder(ort, [[`ki-nur-typ-${randomUUID()}`, "typbild"]]);
        const antwort = await app.inject({
            method: "GET",
            url: subjectDetailUrl({ kind: "place", id: ort.publicId })!,
        });
        expect((antwort.json() as SubjectDetail).media?.typbilder).toBeUndefined();
    });

    it("🔴 der Stand nennt die Karte des Bildes nur, solange Besucher es sehen dürfen", async () => {
        const ort = await neuerOrt();
        const frei = await bild({ ort, beschreibung: "Der Hafen", entstehung: "drawing" });
        const schluessel = neuerSchluessel(spuren);
        await database`UPDATE media_submission SET status_key_hash = ${schluesselHash(schluessel)} WHERE id = ${frei.submissionId}::bigint`;

        const stand = await statusLesen(database, schluessel);
        expect(stand?.karte?.id).toBe(frei.assetPublicId);
        expect(stand?.karte?.beschreibung).toBe("Der Hafen");
        expect(stand?.karte?.ort?.id).toBe(ort.publicId);
        expect(Value.Check(PhotoboxStatus, stand), JSON.stringify([...Value.Errors(PhotoboxStatus, stand)])).toBe(true);
        // Dieselbe Karte wie auf der Karte.
        const imAusschnitt = await resolveReisebilder(database, { x0: 256, y0: 256, x1: 320, y1: 320 }, 500);
        expect(imAusschnitt.bilder.find((b) => b.id === frei.assetPublicId)).toEqual(stand?.karte);

        await database`UPDATE media_submission SET state = 'offline' WHERE id = ${frei.submissionId}::bigint`;
        expect((await statusLesen(database, schluessel))?.karte).toBeUndefined();
        await database`UPDATE media_submission SET state = 'approved' WHERE id = ${frei.submissionId}::bigint`;

        const ohneDatei = await bild({ ort, dateien: "keine" });
        expect(await resolveReisebild(database, ohneDatei.submissionId)).toBeUndefined();
        const offen = await bild({ ort, zustand: "pending" });
        expect(await resolveReisebild(database, offen.submissionId)).toBeUndefined();
    });

    it("die öffentliche Antwort des Ortes trägt die Reisebilder im Kopf, passt zum Vertrag und ist öffentlich zwischengespeichert", async () => {
        const ort = await neuerOrt();
        const [ansicht] = await kopfbilder(ort, [["kopf-http", "ortsansicht"]]);
        const da = await bild({ ort, name: "Alrik", beschreibung: "Die Bucht" });
        const antwort = await app.inject({
            method: "GET",
            url: subjectDetailUrl({ kind: "place", id: ort.publicId })!,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(String(antwort.headers["cache-control"])).toContain("public");
        const detail = antwort.json() as SubjectDetail;
        expect(
            Value.Check(SubjectDetail, detail),
            JSON.stringify([...Value.Errors(SubjectDetail, detail)].slice(0, 3)),
        ).toBe(true);
        expect(detail.media?.header?.map((sicht) => [sicht.id, sicht.relation])).toEqual([
            [ansicht, "place_view"],
            [da.assetPublicId, "reisebild"],
        ]);
    });

    it("🔴 die öffentliche Antwort verrät keinen offenen Eingang des Ortes (kein Bild, keine Kennung, keine Beschreibung), auch nicht für einen Editor mit ?editor=true", async () => {
        const ort = await neuerOrt();
        const eingang = await eingereicht(ort, "Geheime Bucht im Nebel");
        const url = subjectDetailUrl({ kind: "place", id: ort.publicId })!;
        for (const kopfzeilen of [{}, { cookie: cookies.get("editor") ?? "" }]) {
            const antwort = await app.inject({
                method: "GET",
                url: `${url}${Object.keys(kopfzeilen).length === 0 ? "" : "?editor=true"}`,
                headers: kopfzeilen,
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(antwort.body).not.toContain(eingang.assetPublicId);
            expect(antwort.body).not.toContain(eingang.publicId);
            expect(antwort.body).not.toContain("Geheime Bucht");
            expect(antwort.body).not.toContain("intern_");
            expect(antwort.body).not.toContain("eingang");
            expect((antwort.json() as SubjectDetail).media).toBeUndefined();
        }
    });

    // --- Die Eingänge --------------------------------------------------------------------------------------------------------------

    let seed = 9300;
    /** Reicht ein Bild für den Ort ein, rechnet es durch (interne Vorschau) und zieht den Übergang nach: Zustand `pending`. */
    async function eingereicht(
        ort: { publicId: string },
        beschreibung = "Der Blick vom Hafen auf die Bucht",
        rechnen = true,
    ): Promise<{ publicId: string; assetPublicId: string; id: string }> {
        seed += 1;
        const { publicId } = await einreichen(
            database,
            store,
            "test",
            await neueEinreichung(spuren, seed, { placeId: ort.publicId, beschreibung }),
        );
        const [zeile] = await database<{ id: string; asset: string }[]>`
            SELECT s.id::text AS id, a.public_id::text AS asset
              FROM media_submission s JOIN media_ingest i ON i.submission_id = s.id JOIN media_asset a ON a.id = i.media_asset_id
             WHERE s.public_id = ${publicId}::uuid`;
        if (rechnen) {
            await settleAssetFiles(database, store, { assetPublicId: zeile!.asset, role: "photobox" });
            await technikNachziehen(database, zeile!.id);
        }
        return { publicId, assetPublicId: zeile!.asset, id: zeile!.id };
    }

    /** Setzt den Zustand einer Einreichung; ein freigegebener braucht sein Medium (die Datenbank verlangt es). */
    async function setzeZustand(
        fall: { id: string; assetPublicId: string },
        state: PhotoboxSubmissionState,
    ): Promise<void> {
        const [datei] = await database<
            { id: string }[]
        >`SELECT id::text AS id FROM media_asset WHERE public_id = ${fall.assetPublicId}::uuid`;
        await database`
            UPDATE media_submission
               SET state = ${state}, approved_media_asset_id = ${state === "approved" ? datei!.id : null}::bigint
             WHERE id = ${fall.id}::bigint`;
    }

    const eingaenge = (ortId: string, rolle?: Role) =>
        app.inject({
            method: "GET",
            url: mediaPhotoboxOrtEingaengeUrl(ortId),
            headers: rolle === undefined ? {} : { cookie: cookies.get(rolle) ?? "" },
        });

    it("🔴 Recht: ohne Anmeldung 401, ohne view_media_private 403, ab Reviewer 200, nie zwischengespeichert", async () => {
        const ort = await neuerOrt();
        await eingereicht(ort);
        expect((await eingaenge(ort.publicId)).statusCode).toBe(401);
        expect((await eingaenge(ort.publicId, "tester")).statusCode).toBe(403);
        for (const rolle of ROLLEN_MIT_MAM) {
            const antwort = await eingaenge(ort.publicId, rolle);
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(String(antwort.headers["cache-control"])).toContain("no-store");
        }
    });

    it("🔴 das Panel im Ortseditor: nur mit Recht, nie zwischengespeichert; die freigegebenen Reisebilder dieses Ortes in der Reihenfolge der Freigabe", async () => {
        const ort = await neuerOrt();
        const erstes = await bild({ ort, name: "Alrik", beschreibung: "Der Hafen", entstehung: "drawing" });
        const zweites = await bild({ ort });
        await bild({ ort, zustand: "pending" });
        await bild({ ort: await neuerOrt() });
        const lies = (rolle?: Role) =>
            app.inject({
                method: "GET",
                url: mediaPhotoboxOrtReisebilderUrl(ort.publicId),
                headers: rolle === undefined ? {} : { cookie: cookies.get(rolle) ?? "" },
            });
        expect((await lies()).statusCode).toBe(401);
        expect((await lies("tester")).statusCode).toBe(403);
        const antwort = await lies("editor");
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(String(antwort.headers["cache-control"])).toContain("no-store");
        const { reisebilder } = antwort.json<PhotoboxOrtReisebilder>();
        expect(reisebilder.map((eintrag) => eintrag.publicId)).toEqual([erstes.assetPublicId, zweites.assetPublicId]);
        expect(reisebilder[0]).toMatchObject({ name: "Alrik", beschreibung: "Der Hafen", entstehung: "drawing" });
        expect(reisebilder[0]?.lage).toEqual({ x: expect.any(Number), y: expect.any(Number) });
    });

    it("🔴 die PhotoBox-Galerien: nur mit Recht; je Ort die freigegebenen Bilder, die ohne Ort zuletzt, die Suche über den Ortsnamen", async () => {
        const ort = await neuerOrt();
        const [{ name: ortName } = { name: "" }] = await database<
            { name: string }[]
        >`SELECT name FROM place WHERE id = ${ort.id}::bigint`;
        await bild({ ort });
        await bild({ ort });
        await bild({ ort, zustand: "pending" });
        const frei = await bild({ ort: null });
        const lies = (url: string, rolle?: Role) =>
            app.inject({
                method: "GET",
                url,
                headers: rolle === undefined ? {} : { cookie: cookies.get(rolle) ?? "" },
            });
        expect((await lies(MEDIA_PHOTOBOX_GALERIEN_URL)).statusCode).toBe(401);
        expect((await lies(MEDIA_PHOTOBOX_GALERIEN_URL, "tester")).statusCode).toBe(403);
        const antwort = await lies(MEDIA_PHOTOBOX_GALERIEN_URL, "editor");
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(String(antwort.headers["cache-control"])).toContain("no-store");
        const { items } = antwort.json<PhotoboxGalerien>();
        expect(items.find((zeile) => zeile.ort?.id === ort.publicId)?.bilder).toBe(2);
        expect(items.at(-1)?.ort).toBeNull();

        const gesucht = (
            await lies(`${MEDIA_PHOTOBOX_GALERIEN_URL}?q=${encodeURIComponent(ortName)}`, "editor")
        ).json<PhotoboxGalerien>();
        expect(gesucht.items.map((zeile) => zeile.ort?.id)).toEqual([ort.publicId]);

        const ohneOrt = (await lies(MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL, "editor")).json<PhotoboxOrtReisebilder>();
        expect(ohneOrt.reisebilder.map((eintrag) => eintrag.publicId)).toContain(frei.assetPublicId);
        expect((await mediaNavigation(database)).photoboxGalerien).toBe(items.length);
    });

    it("die offenen Eingänge des Ortes: Kennung, Adresse der internen Vorschau und Maße, sonst nichts", async () => {
        const ort = await neuerOrt();
        const eins = await eingereicht(ort, "Der Blick vom Turm ins Tal");
        const antwort = await eingaenge(ort.publicId, "reviewer");
        expect(antwort.statusCode, antwort.body).toBe(200);
        const body = antwort.json() as PhotoboxOrtEingaenge;
        expect(
            Value.Check(PhotoboxOrtEingaenge, body),
            JSON.stringify([...Value.Errors(PhotoboxOrtEingaenge, body)]),
        ).toBe(true);
        expect(body.eingaenge).toHaveLength(1);
        const [eingang] = body.eingaenge;
        expect(eingang!.publicId).toBe(eins.assetPublicId);
        expect(eingang!.url).toMatch(new RegExp(MEDIA_EDITOR_PREVIEW_URL_PATTERN));
        expect(eingang!.url).toContain(`/${eins.assetPublicId}/preview/intern_`);
        expect(eingang!.breite).toBeGreaterThan(0);
        expect(eingang!.hoehe).toBeGreaterThan(0);
        // Nichts über den Einreicher: keine Beschreibung, kein Name, keine Stelle, kein Zustand, kein Schlüssel.
        expect(antwort.body).not.toContain("Turm");
        expect(Object.keys(eingang!).sort()).toEqual(["breite", "hoehe", "publicId", "url"]);
        // Die Vorschau selbst liefert der vorhandene private Weg: mit Recht ein Bild, ohne Anmeldung nicht.
        const bild = await app.inject({
            method: "GET",
            url: eingang!.url,
            headers: { cookie: cookies.get("reviewer") ?? "" },
        });
        expect(bild.statusCode).toBe(200);
        expect(String(bild.headers["content-type"])).toBe("image/webp");
        expect((await app.inject({ method: "GET", url: eingang!.url })).statusCode).toBe(401);
    });

    it("🔴 nur offene Eingänge DIESES Ortes: nicht entschiedene, nicht ungeprüfte, nicht die eines anderen Ortes", async () => {
        const ort = await neuerOrt();
        const anders = await neuerOrt();
        const offen = await eingereicht(ort);
        const ungerechnet = await eingereicht(ort, "Noch ohne Vorschau", false);
        const frageNach = await eingereicht(ort);
        const abgelehnt = await eingereicht(ort);
        const freigegeben = await eingereicht(ort);
        const fremd = await eingereicht(anders);
        await setzeZustand(frageNach, "changes_requested");
        await setzeZustand(abgelehnt, "rejected");
        await setzeZustand(freigegeben, "approved");
        const antwort = (await eingaenge(ort.publicId, "editor")).json() as PhotoboxOrtEingaenge;
        expect(antwort.eingaenge.map((eingang) => eingang.publicId)).toEqual([offen.assetPublicId]);
        expect(JSON.stringify(antwort)).not.toContain(ungerechnet.assetPublicId);
        expect(JSON.stringify(antwort)).not.toContain(fremd.assetPublicId);
        const dortigen = (await eingaenge(anders.publicId, "editor")).json() as PhotoboxOrtEingaenge;
        expect(dortigen.eingaenge.map((eingang) => eingang.publicId)).toEqual([fremd.assetPublicId]);
    });

    it("ein ersetztes Bild zählt nicht: der Eingang ist das aktuelle Bild der Einreichung", async () => {
        const ort = await neuerOrt();
        const eins = await eingereicht(ort);
        const alt = eins.assetPublicId;
        await database`
            INSERT INTO media_asset (media_kind, asset_type, origin, creation_method, technical_state, moderation_state, source_system)
            VALUES ('image', 'picture', 'community_upload', 'photo', 'ok', 'pending', 'photobox')`;
        const [neu] = await database<{ id: string; public_id: string }[]>`
            SELECT id::text AS id, public_id::text AS public_id FROM media_asset ORDER BY id DESC LIMIT 1`;
        await database`
            INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
            VALUES (${neu!.id}::bigint, 'intern_photobox_2048', 'derivative', ${`derivatives/kopf-test/${neu!.public_id}.webp`}, 'image/webp', 640, 360, 100,
                    ${sha(`kopf-neu:${neu!.public_id}`)}, 'photobox_2048', '1')`;
        await database`
            INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id, source_system, source_ref)
            VALUES (${neu!.id}::bigint, 'community_upload', ${eins.id}::bigint, 'photobox', ${`photobox:${eins.publicId}`})`;
        const body = (await eingaenge(ort.publicId, "reviewer")).json() as PhotoboxOrtEingaenge;
        expect(body.eingaenge.map((eingang) => eingang.publicId)).toEqual([neu!.public_id]);
        expect(JSON.stringify(body)).not.toContain(alt);
        // Aufräumen: das ersetzte Bild gehört der Einreichung; die Spur räumt `raeumeAuf` über den Eingang ab.
    });

    it("höchstens PHOTOBOX_ORT_EINGAENGE_MAX Eingänge, die ältesten zuerst", async () => {
        const ort = await neuerOrt();
        const alle: string[] = [];
        for (let i = 0; i < PHOTOBOX_ORT_EINGAENGE_MAX + 2; i += 1) alle.push((await eingereicht(ort)).assetPublicId);
        const body = (await eingaenge(ort.publicId, "reviewer")).json() as PhotoboxOrtEingaenge;
        expect(body.eingaenge.map((eingang) => eingang.publicId)).toEqual(alle.slice(0, PHOTOBOX_ORT_EINGAENGE_MAX));
    });

    it("eine Kennung, die kein Ort ist, und eine, die keine UUID ist: leer beziehungsweise 400", async () => {
        const leer = await eingaenge(randomUUID(), "reviewer");
        expect(leer.statusCode).toBe(200);
        expect((leer.json() as PhotoboxOrtEingaenge).eingaenge).toEqual([]);
        expect((await eingaenge("kein-ort", "reviewer")).statusCode).toBe(400);
    });

    // --- Die Auswahl ---------------------------------------------------------------------------------------------------------------

    it("🔴 die Auswahl: ohneReisebilder lässt Reisebilder weg, auch ein ersetztes; die Verwaltung ohne den Filter zeigt sie", async () => {
        const ort = await neuerOrt();
        const eingang = await eingereicht(ort);
        const eigenes = await insertAsset(database, {
            ref: "kopf-auswahl",
            rights: OWN_CLEARED,
            published: [{ variant: "header_16_9" }],
        });
        await database`UPDATE media_asset SET asset_type = 'picture' WHERE id = ${eigenes.id}`;
        const suche = async (frage: string): Promise<string[]> => {
            const antwort = await app.inject({
                method: "GET",
                url: `${MEDIA_EDITOR_URL}?type=picture&limit=200&${frage}`,
                headers: { cookie: cookies.get("reviewer") ?? "" },
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            const body = antwort.json() as MamSearchResult;
            expect(Value.Check(MamSearchResult, body)).toBe(true);
            return body.items.map((eintrag) => eintrag.id);
        };
        const alle = await suche("");
        expect(alle).toContain(eingang.assetPublicId);
        expect(alle).toContain(eigenes.publicId);
        const auswahl = await suche("ohneReisebilder=true");
        expect(auswahl).not.toContain(eingang.assetPublicId);
        expect(auswahl).toContain(eigenes.publicId);
        expect(await suche("ohneReisebilder=true&groupFiles=true")).not.toContain(eingang.assetPublicId);
    });
});
