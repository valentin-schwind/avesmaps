import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { MEDIA_UPLOAD_URL, mediaRightsReviewUrl, type OperationReceipt, type Role } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { MediaStore } from "../src/media/storage.ts";
import { socialBildUrteile } from "../src/community/social/bild-urteil.ts";
import type { Queryable } from "../src/database.ts";
import { searchMedia } from "../src/media-editor/search.ts";
import { settleAssetFiles } from "../src/media-editor/settle.ts";
import { readUsages } from "../src/migration/media-publication.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type TestPerson } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";
import { cleanMediaFixtures } from "./support/media-fixture.ts";
import { cleanEditorMedia, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";

/**
 * „Bild hochladen“ im Social Hub (WI-0278) gegen echtes PostgreSQL und den echten Abgleich.
 *
 * Problemfälle: Das hochgeladene Bild landet zwischen den Ortsbildern; es wird still auf 16:9 zugeschnitten; es bleibt ohne öffentliche Datei hängen, und der Versand scheitert; wer freigibt, kann die
 * Rechte am eigenen Upload nicht klären und hängt fest.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithDatabase("Social Hub: Bild hochladen (WI-0278)", { timeout: 180_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    let mediaRoot = "";
    let store: MediaStore;
    let fixture: ReturnType<typeof authFixture>;
    const people: TestPerson[] = [];
    let edda = "";
    let betreiber = "";
    let saat = 90_000;

    const config = (): ServerConfig => ({
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        mediaRoot,
        statusPage: true,
        auth: TEST_AUTH,
    });
    const post = (url: string, payload: unknown, cookie: string) =>
        app.inject({ method: "POST", url, payload: payload as object, headers: { origin: TEST_ORIGIN, cookie } });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;

    async function hochladen(cookie: string, rights: Record<string, unknown> = {}): Promise<string> {
        saat += 1;
        const antwort = await post(
            MEDIA_UPLOAD_URL,
            {
                operationId: operation(),
                file: file(await pngBytes(saat, 1600, 400), "post.png"),
                form: uploadForm({
                    title: "Bild für einen Beitrag",
                    role: "social_post",
                    rights: { basis: "own_work", creator: "Vali", ...rights } as never,
                }),
            },
            cookie,
        );
        expect(code(antwort)).toBe("200");
        const id = (antwort.json() as OperationReceipt).affected.find((a) => a.kind === "media_asset")?.id;
        if (id === undefined) throw new Error("Kein Asset in der Quittung");
        return id;
    }
    const bestaetigen = (asset: string, cookie: string) =>
        post(`/api/community/social/bilder/${asset}/rechte`, { operationId: randomUUID() }, cookie);
    const beitrag = async (cookie: string, bild: string): Promise<{ id: number; revision: number }> => {
        const antwort = await post(
            "/api/community/social",
            {
                operationId: randomUUID(),
                titel: "Ein Bild",
                text: "Ein Text.",
                hashtags: [],
                rubrik: "karte",
                ki: false,
                kanaele: ["neuigkeiten"],
                bild,
                bildBeschreibung: "Eine Karte.",
            },
            cookie,
        );
        expect(code(antwort)).toBe("201");
        return antwort.json() as { id: number; revision: number };
    };
    const schritt = (b: { id: number; revision: number }, was: string, cookie: string) =>
        post(
            `/api/community/social/${String(b.id)}/${was}`,
            { operationId: randomUUID(), baseRevision: b.revision },
            cookie,
        );
    const abgleich = (assetPublicId: string) =>
        settleAssetFiles(database, store, { assetPublicId, role: "social_post" });
    const dbId = async (publicId: string): Promise<string> => {
        const [row] = await database<{ id: string }[]>`
            SELECT id::text AS id FROM media_asset WHERE public_id = ${publicId}::uuid`;
        return row!.id;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 6 });
        await migrate(database);
        await cleanMediaFixtures(database);
        mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-social-bild-"));
        store = new MediaStore(mediaRoot);
        fixture = authFixture(database);
        const person = async (role: Role, name: string): Promise<string> => {
            const created = await fixture.person(role, { name });
            people.push(created);
            return (await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 })).cookie;
        };
        edda = await person("editor", "Social Edda");
        betreiber = await person("operator", "Social Betreiber");
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
    }, 120_000);

    afterEach(async () => {
        await database`DELETE FROM avesmaps_community.beitrag`;
        await database`DELETE FROM public.news_entry`;
    });

    afterAll(async () => {
        await app?.close();
        await cleanEditorMedia(
            database,
            people.map((p) => p.id),
        );
        await cleanMediaFixtures(database);
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
        if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
    });

    it("🔴 das Bild landet in der eigenen Kategorie, ungeprüft und noch nicht öffentlich", async () => {
        const id = await hochladen(edda);
        const treffer = await searchMedia(database, { type: "social_post", limit: 50 });
        expect(treffer.items.map((a) => a.id)).toContain(id);
        const bilder = await searchMedia(database, { type: "picture", limit: 100 });
        expect(bilder.items.map((a) => a.id)).not.toContain(id);
        expect(treffer.items.find((a) => a.id === id)).toMatchObject({ clearance: "unreviewed", published: false });
        expect(await readUsages(database, await dbId(id))).toEqual([
            expect.objectContaining({ role: "social_post", retired: false, override: "none" }),
        ]);
        expect((await abgleich(id)).published).toBe(false);
    });

    it("🔴 wer freigeben darf, bestätigt auch den eigenen Upload; danach gibt es die öffentliche Fassung ohne Zuschnitt", async () => {
        const id = await hochladen(betreiber);
        expect(code(await bestaetigen(id, betreiber))).toBe("200");
        const [rechte] = await database<{ clearance_state: string; reviewed_at: Date | null }[]>`
            SELECT r.clearance_state, r.reviewed_at FROM media_rights r
              JOIN media_asset a ON a.id = r.media_asset_id WHERE a.public_id = ${id}::uuid`;
        expect(rechte?.clearance_state).toBe("cleared");
        expect(rechte?.reviewed_at).not.toBeNull();
        expect(await readUsages(database, await dbId(id))).toEqual([expect.objectContaining({ override: "approved" })]);
        // Der Abgleich läuft im Worker; die Bestätigung reiht ihn in derselben Transaktion ein.
        const [job] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job WHERE kind = 'media_settle' AND input_ref->>'asset' = ${id} AND input_ref->>'role' = 'social_post'`;
        expect(job?.n).toBeGreaterThanOrEqual(2);
        expect((await abgleich(id)).published).toBe(true);
        const [datei] = await database<{ variant: string; width: number; height: number; mime_type: string }[]>`
            SELECT f.variant, f.width, f.height, f.mime_type FROM media_file f
              JOIN media_asset a ON a.id = f.media_asset_id
             WHERE a.public_id = ${id}::uuid AND f.storage_class = 'published'`;
        expect(datei).toMatchObject({ variant: "social_post_2048", width: 1600, height: 400, mime_type: "image/webp" });
        // Eine Wiederholung ändert nichts.
        expect(code(await bestaetigen(id, betreiber))).toBe("200");
    });

    it("🔴 eine Erlaubnis geht nach der Bestätigung hinaus, obwohl sie sonst eine Regel bräuchte; unbekannte Rechte nie", async () => {
        const lizenz = await hochladen(betreiber, { basis: "permission", rightsNote: "Erlaubnis liegt vor." });
        expect(code(await bestaetigen(lizenz, betreiber))).toBe("200");
        expect((await abgleich(lizenz)).published).toBe(true);
        const unbekannt = await hochladen(betreiber, { basis: "unknown" });
        expect(code(await bestaetigen(unbekannt, betreiber))).toBe("400 validation_failed");
    });

    it("🔴 ohne manage_news bestätigt niemand im Hub; in der Medienverwaltung prüft, wer das Recht hat, auch den eigenen Upload (WI-0282)", async () => {
        const id = await hochladen(edda);
        expect(code(await bestaetigen(id, edda))).toBe("403 forbidden");
        const eigenes = await post(
            mediaRightsReviewUrl(id),
            { operationId: operation(), baseRevision: 1, decision: "cleared" },
            edda,
        );
        expect(code(eigenes)).toBe("200");
        // Nur Bilder dieser Kategorie: Ein Titelbild prüft weiter die Medienverwaltung.
        saat += 1;
        const titelbild = await post(
            MEDIA_UPLOAD_URL,
            {
                operationId: operation(),
                file: file(await pngBytes(saat, 800, 450), "titel.png"),
                form: uploadForm({ title: "Ein Titelbild", role: "header", rights: { basis: "public_domain" } }),
            },
            edda,
        );
        const andere = (titelbild.json() as OperationReceipt).affected.find((a) => a.kind === "media_asset")?.id;
        const fremd = await bestaetigen(andere as string, betreiber);
        expect(code(fremd)).toBe("422 community_invalid");
        expect((fremd.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "bild_nicht_social",
        });
    });

    it("🔴 Fund eines Editors 2026-11-04: Editor mit Sonderrolle ohne zweiten Faktor lädt hoch; was Stufe V braucht, meldet die Stufe, nicht „Recht fehlt“, und geht danach", async () => {
        const elwe = await fixture.person("editor", { name: "Social Elwe" });
        people.push(elwe);
        await database`
            INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, reason)
            VALUES (${elwe.id}, 'test', 'social_media_manager', 'Probe')
        `;
        const ohne = (await fixture.session(elwe.id, { assurance: "basic" })).cookie;
        const mit = (await fixture.session(elwe.id, { assurance: "strong", passkeyMinutesAgo: 60 })).cookie;

        const eigenes = await hochladen(ohne);
        const fremd = await beitrag(betreiber, eigenes);
        const aendern = (cookie: string) =>
            post(
                `/api/community/social/${String(fremd.id)}/aendern`,
                {
                    operationId: randomUUID(),
                    baseRevision: fremd.revision,
                    titel: "Ein Bild",
                    text: "Geändert.",
                    hashtags: [],
                    rubrik: "karte",
                    ki: false,
                    kanaele: ["neuigkeiten"],
                    bild: eigenes,
                    bildBeschreibung: "Eine Karte.",
                },
                cookie,
            );
        expect(code(await bestaetigen(eigenes, ohne))).toBe("403 assurance_required");
        expect(code(await aendern(ohne))).toBe("403 assurance_required");

        expect(code(await bestaetigen(eigenes, mit))).toBe("200");
        expect(code(await aendern(mit))).toBe("200");
    });

    it("🔴 Vorlegen geht ohne bestätigte Rechte, Freigeben erst danach; ein anderes Bild prüft schon das Vorlegen", async () => {
        const id = await hochladen(edda);
        const b = await beitrag(edda, id);
        const vorgelegt = await schritt(b, "vorlegen", edda);
        expect(code(vorgelegt)).toBe("200");
        const stand = vorgelegt.json() as { id: number; revision: number };
        const ohneRechte = await schritt(stand, "freigeben", betreiber);
        expect(code(ohneRechte)).toBe("422 community_invalid");
        // Der Grund kommt als Fachcode, das Fenster sagt ihn in seiner Sprache samt dem, was zu tun ist (Vali 2026-11-08).
        expect((ohneRechte.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "bild_nicht_geklaert",
            sperrgrund: { art: "bild_nicht_geklaert", grund: expect.any(String) },
        });
        const bestaetigt = await bestaetigen(id, betreiber);
        expect(code(bestaetigt)).toBe("200");
        expect(bestaetigt.json()).toMatchObject({ klaerung: "cleared", geklaert: true, oeffentlich: true });
        expect(code(await schritt(stand, "freigeben", betreiber))).toBe("200");

        const [fremd] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO media_asset (media_kind, asset_type, origin, source_system, title)
            VALUES ('image', 'picture', 'editor_upload', 'avesmaps3d', 'Ungeklärt') RETURNING id::text, public_id::text`;
        await database`
            INSERT INTO media_rights (media_asset_id, rights_basis, clearance_state)
            VALUES (${fremd!.id}::bigint, 'own_work', 'unreviewed')`;
        const anderer = await beitrag(edda, fremd!.public_id);
        expect(code(await schritt(anderer, "vorlegen", edda))).toBe("422 community_invalid");
        await database`DELETE FROM media_rights WHERE media_asset_id = ${fremd!.id}::bigint`;
        await database`DELETE FROM media_asset WHERE id = ${fremd!.id}::bigint`;
    });

    it("🔴 Fund Vali 2026-11-08 (Beitrag 20): „Rechte bestätigen“ meldet das Urteil danach; sperrt die Policy weiter, sagt es der Grund, und die Liste kennt ihn auch", async () => {
        const id = await hochladen(betreiber);
        // Bestätigte Rechte heben nicht jede Sperre auf: hier die Moderation.
        await database`UPDATE media_asset SET moderation_state = 'pending' WHERE public_id = ${id}::uuid`;
        const bestaetigt = await bestaetigen(id, betreiber);
        expect(code(bestaetigt)).toBe("200");
        // Vorher stand hier fest `geklaert: true`, das Fenster bot „Freigeben“ an und der Server lehnte ohne sichtbaren Grund ab.
        expect(bestaetigt.json()).toMatchObject({ klaerung: "cleared", geklaert: false, grund: "moderation_pending" });
        const b = await beitrag(betreiber, id);
        const abgelehnt = await schritt(b, "freigeben", betreiber);
        expect(code(abgelehnt)).toBe("422 community_invalid");
        expect((abgelehnt.json() as { error: { details?: unknown } }).error.details).toEqual({
            reason: "bild_nicht_geklaert",
            sperrgrund: { art: "bild_nicht_geklaert", grund: "moderation_pending" },
        });
        const liste = await app.inject({
            method: "GET",
            url: "/api/community/social?segment=offen",
            headers: { cookie: betreiber },
        });
        const zeile = (liste.json() as { zeilen: { id: number; bildUrteil?: unknown }[] }).zeilen.find(
            (z) => z.id === b.id,
        );
        expect(zeile?.bildUrteil).toEqual({
            erlaubt: false,
            grund: "moderation_pending",
            oeffentlich: true,
            social: true,
        });
    });

    // --- Bestehende Bilder: Die Lizenz entscheidet --------------------------------------------------------------------------------

    interface Rechte {
        basis: string;
        klaerung: string;
        typ?: string;
        lizenz?: string;
        entstehung?: string;
        urheber?: string;
        nennung?: string;
        datei?: boolean;
    }
    /** Ein Bild, wie es im Bestand steht. In einer Transaktion: Eine Probe lässt nichts in der gemeinsamen Testdatenbank zurück. */
    async function bestand(db: Queryable, r: Rechte): Promise<string> {
        const [asset] = await db<{ id: string; public_id: string }[]>`
            INSERT INTO media_asset (media_kind, asset_type, origin, source_system, title, creation_method)
            VALUES ('image', ${r.typ ?? "picture"}, 'editor_upload', 'avesmaps3d', 'Aus dem Bestand', ${r.entstehung ?? "unknown"})
            RETURNING id::text, public_id::text`;
        await db`
            INSERT INTO media_rights (media_asset_id, rights_basis, clearance_state, license_key, creator, attribution)
            VALUES (${asset!.id}::bigint, ${r.basis}, ${r.klaerung}, ${r.lizenz ?? null}, ${r.urheber ?? null}, ${r.nennung ?? null})`;
        if (r.datei === true) {
            const hash = randomUUID().replaceAll("-", "").repeat(2);
            await db`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256, derivative_recipe, recipe_version)
                VALUES (${asset!.id}::bigint, 'header_16_9', 'published', ${`published/sha256/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}.webp`}, 'image/webp', 800, 450, 3, ${hash}, 'header_16_9', '1')`;
        }
        return asset!.public_id;
    }
    /** Probe in einer Transaktion, die nie gilt, samt der KI-Regel, wie sie auf der Stage und in Production steht. */
    async function probe(lauf: (tx: Queryable) => Promise<void>): Promise<void> {
        const zurueck = new Error("zurückrollen");
        await database
            .begin(async (tx) => {
                await tx`DELETE FROM publication_rule WHERE rights_basis = 'own_work'`;
                await tx`
                    INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
                    VALUES ('own_work', 'ai_generated', 'header', 'Probe', 'Probe', '2026-10-10')`;
                await lauf(tx);
                throw zurueck;
            })
            .catch((fehler: unknown) => {
                if (fehler !== zurueck) throw fehler;
            });
    }
    const urteil = async (tx: Queryable, r: Rechte) => {
        const id = await bestand(tx, r);
        return (await socialBildUrteile(tx, [id])).get(id);
    };

    it("🔴 was die Lizenz zulässt, ist erlaubt: KI-Bilder auch ungeprüft, Gemeinfreies, CC0, ein geprüftes eigenes Werk", () =>
        probe(async (tx) => {
            for (const klaerung of ["unreviewed", "legacy_assumed", "legacy_asserted"]) {
                expect(await urteil(tx, { basis: "own_work", klaerung, entstehung: "ai_generated" })).toMatchObject({
                    erlaubt: true,
                    grund: "rule",
                    nennung: null,
                });
            }
            expect(
                await urteil(tx, { basis: "public_domain", klaerung: "legacy_asserted", typ: "coat" }),
            ).toMatchObject({
                erlaubt: true,
                grund: "automatic",
            });
            expect(await urteil(tx, { basis: "license", klaerung: "cleared", lizenz: "cc0-1.0" })).toMatchObject({
                erlaubt: true,
                nennung: null,
            });
            expect(await urteil(tx, { basis: "own_work", klaerung: "cleared" })).toMatchObject({ erlaubt: true });
        }));

    it("🔴 was sie nicht zulässt, nennt den Grund: Fan-Richtlinie, Einzelerlaubnis, ungeprüftes eigenes Werk, unbekannt, abgelehnt", () =>
        probe(async (tx) => {
            const nein = async (r: Rechte, grund: string): Promise<void> => {
                expect(await urteil(tx, r)).toMatchObject({ erlaubt: false, grund });
            };
            await nein(
                { basis: "fan_policy", klaerung: "legacy_asserted", typ: "cover", datei: true },
                "fan_policy_needs_approval",
            );
            await nein({ basis: "permission", klaerung: "legacy_asserted", typ: "map" }, "permission_needs_approval");
            await nein({ basis: "own_work", klaerung: "unreviewed" }, "clearance_pending");
            await nein({ basis: "unknown", klaerung: "unreviewed" }, "rights_unknown");
            await nein({ basis: "own_work", klaerung: "rejected", entstehung: "ai_generated" }, "clearance_rejected");
        }));

    it("🔴 wird die KI-Regel widerrufen, ist auch hier Schluss", () =>
        probe(async (tx) => {
            await tx`UPDATE publication_rule SET revoked_on = '2026-11-01', revoked_reason = 'Probe' WHERE rights_basis = 'own_work'`;
            expect(
                await urteil(tx, { basis: "own_work", klaerung: "unreviewed", entstehung: "ai_generated" }),
            ).toMatchObject({ erlaubt: false, grund: "clearance_pending" });
        }));

    it("🔴 eine Lizenz mit Namensnennung geht nur geprüft und nennt den Text; eine ohne kommerzielle Nutzung geht nicht", () =>
        probe(async (tx) => {
            const cc = { basis: "license", lizenz: "cc-by-4.0", urheber: "Rohaja Hesindian" };
            expect(await urteil(tx, { ...cc, klaerung: "cleared" })).toMatchObject({
                erlaubt: true,
                nennung: "Rohaja Hesindian, CC BY 4.0",
            });
            expect(await urteil(tx, { ...cc, klaerung: "legacy_asserted", nennung: "Foto: Rohaja" })).toMatchObject({
                erlaubt: true,
                nennung: "Foto: Rohaja",
            });
            expect(await urteil(tx, { ...cc, klaerung: "unreviewed" })).toMatchObject({
                erlaubt: false,
                grund: "attribution_required",
            });
            expect(await urteil(tx, { ...cc, klaerung: "cleared", lizenz: "cc-by-nc-sa-3.0" })).toMatchObject({
                erlaubt: false,
            });
        }));

    it("🔴 die Einzelerlaubnis im Hub verlangt die Nennung auch; Instagram braucht eine öffentliche Datei, die Kategorie bekommt sie von selbst", () =>
        probe(async (tx) => {
            expect(
                await urteil(tx, { basis: "permission", klaerung: "cleared", typ: "social_post", urheber: "Rohaja" }),
            ).toMatchObject({ erlaubt: true, nennung: "Rohaja", oeffentlich: true });
            expect(await urteil(tx, { basis: "public_domain", klaerung: "cleared" })).toMatchObject({
                erlaubt: true,
                oeffentlich: false,
            });
            expect(await urteil(tx, { basis: "public_domain", klaerung: "cleared", datei: true })).toMatchObject({
                oeffentlich: true,
            });
        }));

    it("🔴 die Route nennt die Urteile, weist Unsinn ab, und das Freigeben folgt demselben Urteil", async () => {
        const frei = await bestand(database, { basis: "public_domain", klaerung: "legacy_asserted", datei: true });
        const fan = await bestand(database, { basis: "fan_policy", klaerung: "legacy_asserted", typ: "cover" });
        const lesen = (ids: string) =>
            app.inject({
                method: "GET",
                url: `/api/community/social/bilder/urteile?ids=${ids}`,
                headers: { origin: TEST_ORIGIN, cookie: edda },
            });
        const antwort = await lesen(`${frei},${fan}`);
        expect(code(antwort)).toBe("200");
        const { urteile } = antwort.json() as { urteile: { id: string; erlaubt: boolean; grund: string }[] };
        expect(urteile.find((u) => u.id === frei)).toMatchObject({ erlaubt: true, oeffentlich: true });
        expect(urteile.find((u) => u.id === fan)).toMatchObject({ erlaubt: false, grund: "fan_policy_needs_approval" });
        expect(code(await lesen("nicht-mal-eine-kennung"))).toBe("422 community_invalid");

        const mitFrei = await beitrag(edda, frei);
        const detail = await app.inject({
            method: "GET",
            url: `/api/community/social/${String(mitFrei.id)}`,
            headers: { origin: TEST_ORIGIN, cookie: edda },
        });
        expect((detail.json() as { bild: unknown }).bild).toMatchObject({
            geklaert: true,
            grund: "automatic",
            nennung: null,
        });
        expect(code(await schritt(mitFrei, "vorlegen", edda))).toBe("200");
        const mitFan = await beitrag(edda, fan);
        const gesperrt = await schritt(mitFan, "vorlegen", edda);
        expect(code(gesperrt)).toBe("422 community_invalid");
        expect((gesperrt.json() as { error: { message: string } }).error.message).toBe(
            "Die Rechte des Bildes lassen keinen Beitrag zu.",
        );
    });

    it("🔴 die Datenbank hält, was die Policy nie zulässt: unbekannte Rechte und abgelehnte; ein KI-Bild auf ungeprüft kommt durch", () =>
        probe(async (tx) => {
            const pruefe = (bild: string) =>
                tx`SELECT avesmaps_community._beitrag_bild_pruefen(${bild}::uuid, 'Eine Karte')`;
            await pruefe(await bestand(tx, { basis: "own_work", klaerung: "unreviewed", entstehung: "ai_generated" }));
            await tx`SAVEPOINT vor_der_sperre`;
            await expect(pruefe(await bestand(tx, { basis: "unknown", klaerung: "unreviewed" }))).rejects.toThrow(
                "die Rechte des Bildes lassen keinen Beitrag zu",
            );
        }));
});
