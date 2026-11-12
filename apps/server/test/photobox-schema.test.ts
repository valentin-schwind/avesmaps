import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MEDIA_GALLERY_KINDS,
    MEDIA_GALLERY_ORIGINS,
    MEDIA_ROLES,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_LIMITS,
    PHOTOBOX_REFERENCE_KINDS,
    PHOTOBOX_SUBMISSION_STATES,
    PHOTOBOX_USAGE_GRANTS,
    photoboxGrantAllowed,
} from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import {
    FIXTURE_SOURCE,
    cleanMediaFixtures,
    insertAsset,
    insertGallery,
    insertPlace,
    insertRule,
    violation,
} from "./support/media-fixture.ts";

/**
 * Die Einreichung eines Reisebildes gegen echtes PostgreSQL (WI-0272 S1, Migration 0274): die Tafel `media_submission` (Besucher
 * ohne Konto, WI-0068 §12, WI-0272 §12/§13), der Fremdschlüssel von `media_ingest` und die erweiterten Wertelisten alter Tafeln.
 * Jede Zusage hält das Schema selbst, nicht erst das Formular oder die Route.
 *
 * 🔴 Die Listen der Tafel (Zustände, Entstehung, Lizenzwahl, Bezugsarten, Blickrichtungen, Längen) sind hier aus den Konstanten in
 * `packages/shared/src/photobox.ts` abgeleitet: Weicht die Migration von ihnen ab, wird dieser Test rot.
 *
 * Alles trägt Marken: Einreichungen die Fassung `photobox-test`, Medienfixtures ihre eigenen (Quellsystem `media-test`).
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const CHECK = "23514";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";

/** Die Marke der Einreichungen dieses Tests (`terms_version`); `cleanSubmissions` entfernt nur sie. */
const MARK = "photobox-test";
const MAP_DOMAIN = "aventuria";
/** Eine Nummer, die es in keiner Tafel gibt (Einreichung, Ort, Asset). */
const MISSING_ID = "4611686018427387000";

describeWithDatabase("Reisebild-Einreichung (WI-0272 S1, Migration 0274)", () => {
    let database: Database;
    let sequence = 0;

    /** Ein anderer Statusschlüssel-Hash je Aufruf: SHA-256, 32 Bytes. */
    const keyHash = (): Buffer =>
        createHash("sha256")
            .update(`photobox-test/${String(++sequence)}`)
            .digest();

    async function cleanSubmissions(): Promise<void> {
        await database`DELETE FROM photobox_media WHERE media_submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_ingest WHERE submission_id IN (SELECT id FROM media_submission WHERE terms_version = ${MARK})`;
        await database`DELETE FROM media_submission WHERE terms_version = ${MARK}`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanSubmissions();
        await cleanMediaFixtures(database);
    });

    /** Die Spalten einer gültigen offenen Einreichung; `overrides` ersetzt einzelne (oder fügt `place_id`, `approved_media_asset_id` hinzu). */
    function validRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
        return {
            status_key_hash: keyHash(),
            map_domain_id: MAP_DOMAIN,
            geom: "SRID=0;POINT(300 300)",
            creation_kind: "photo",
            usage_grant: "avesmaps_only",
            description: "Der Blick vom Hafen auf die Prem-Brücke",
            terms_version: MARK,
            ...overrides,
        };
    }

    async function insertSubmission(
        overrides: Record<string, unknown> = {},
    ): Promise<{ id: string; public_id: string }> {
        const [row] = await database<{ id: string; public_id: string }[]>`
            INSERT INTO media_submission ${database(validRow(overrides))} RETURNING id, public_id`;
        if (row === undefined) throw new Error("Einreichung nicht angelegt");
        return row;
    }

    /** Was `state` verlangt, damit nur `state` selbst geprüft wird: freigegeben/offline mit Asset, geleert ohne Schlüssel und Texte. */
    async function rowForState(state: string): Promise<Record<string, unknown>> {
        if (state === "approved" || state === "offline") {
            const asset = await insertAsset(database, { ref: `state:${state}` });
            return { state, approved_media_asset_id: asset.id };
        }
        if (state === "purged") {
            return { state, status_key_hash: null, description: null, attribution_name: null };
        }
        return { state };
    }

    describe("die Tafel", () => {
        it("eine gültige Einreichung: eingegangen, Fassung 1, Reisebild, nicht angepasst, Zeitstempel gesetzt", async () => {
            const created = await insertSubmission();
            expect(created.public_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
            const [row] = await database<
                {
                    state: string;
                    revision: number;
                    contribution_kind: string;
                    adjusted_by_editors: boolean;
                    place_id: string | null;
                    view_direction: number | null;
                    attribution_name: string | null;
                    approved_media_asset_id: string | null;
                    decided_at: Date | null;
                    original_deleted_at: Date | null;
                    submitted_at: Date;
                    state_changed_at: Date;
                    updated_at: Date;
                    geometry_type: string;
                    srid: number;
                }[]
            >`
                SELECT state, revision::int AS revision, contribution_kind, adjusted_by_editors, place_id, view_direction, attribution_name,
                       approved_media_asset_id, decided_at, original_deleted_at, submitted_at, state_changed_at, updated_at,
                       GeometryType(geom) AS geometry_type, ST_SRID(geom) AS srid
                  FROM media_submission WHERE id = ${created.id}`;
            expect(row).toMatchObject({
                state: "incoming",
                revision: 1,
                contribution_kind: "photobox",
                adjusted_by_editors: false,
                place_id: null,
                view_direction: null,
                attribution_name: null,
                approved_media_asset_id: null,
                decided_at: null,
                original_deleted_at: null,
                geometry_type: "POINT",
                srid: 0,
            });
            expect(row?.submitted_at).toBeInstanceOf(Date);
            expect(row?.state_changed_at).toBeInstanceOf(Date);
            expect(row?.updated_at).toBeInstanceOf(Date);
        });

        it("die öffentliche Kennung ist eindeutig und je Einreichung eine andere", async () => {
            const first = await insertSubmission();
            const second = await insertSubmission();
            expect(second.public_id).not.toBe(first.public_id);
            expect((await violation(insertSubmission({ public_id: first.public_id }))).constraint).toBe(
                "media_submission_public_id_unique",
            );
        });

        it("jeder Zustand aus PHOTOBOX_SUBMISSION_STATES wird angenommen (mit den Feldern, die er verlangt); ein anderer nicht", async () => {
            for (const state of PHOTOBOX_SUBMISSION_STATES) {
                const created = await insertSubmission(await rowForState(state));
                const [row] = await database<
                    { state: string }[]
                >`SELECT state FROM media_submission WHERE id = ${created.id}`;
                expect(row?.state, state).toBe(state);
            }
            expect(await violation(insertSubmission({ state: "unknown" }))).toEqual({
                code: CHECK,
                constraint: "media_submission_state_known",
            });
            // Auch die Wörter der Redaktion aus dem Medienkern sind hier keine Zustände.
            expect((await violation(insertSubmission({ state: "published" }))).constraint).toBe(
                "media_submission_state_known",
            );
        });

        it("die Art des Beitrags ist heute nur photobox; Bild- und Kartenvorschläge bringen ihre Werte selbst", async () => {
            await insertSubmission({ contribution_kind: "photobox" });
            expect(await violation(insertSubmission({ contribution_kind: "image_suggestion" }))).toEqual({
                code: CHECK,
                constraint: "media_submission_kind_known",
            });
        });

        it("🔴 der Statusschlüssel: 32 Bytes, nie doppelt; ohne Schlüssel nur geleert (purged)", async () => {
            const key = keyHash();
            await insertSubmission({ status_key_hash: key });
            expect(await violation(insertSubmission({ status_key_hash: key }))).toEqual({
                code: UNIQUE,
                constraint: "media_submission_status_key_unique",
            });
            for (const length of [0, 31, 33]) {
                expect(
                    (await violation(insertSubmission({ status_key_hash: Buffer.alloc(length, 7) }))).constraint,
                    `${String(length)} Bytes`,
                ).toBe("media_submission_key_hash_len");
            }
            // Ohne Schlüssel gibt es keine Statusseite: nur eine geleerte Einreichung hat keinen.
            expect((await violation(insertSubmission({ status_key_hash: null }))).constraint).toBe(
                "media_submission_purged_empty",
            );
            // Mehrere geleerte Einreichungen haben alle keinen Schlüssel: NULL ist nicht doppelt.
            await insertSubmission(await rowForState("purged"));
            await insertSubmission(await rowForState("purged"));
        });

        it("Bildbeschreibung: 1 bis 300 Zeichen nach btrim, Nennung höchstens 80 und nie leer", async () => {
            const { descriptionMax, attributionMax } = PHOTOBOX_LIMITS;
            await insertSubmission({ description: "x" });
            await insertSubmission({ description: "ä".repeat(descriptionMax) });
            // Gezählt wird nach dem Kürzen der Leerzeichen am Rand.
            await insertSubmission({ description: `  ${"y".repeat(descriptionMax)}  ` });
            for (const description of ["ä".repeat(descriptionMax + 1), "   ", ""]) {
                expect(
                    (await violation(insertSubmission({ description }))).constraint,
                    `Beschreibung mit ${String(description.length)} Zeichen`,
                ).toBe("media_submission_description_len");
            }
            await insertSubmission({ attribution_name: "n" });
            await insertSubmission({ attribution_name: "ö".repeat(attributionMax) });
            for (const name of ["ö".repeat(attributionMax + 1), "   ", ""]) {
                expect(
                    (await violation(insertSubmission({ attribution_name: name }))).constraint,
                    `Name mit ${String(name.length)} Zeichen`,
                ).toBe("media_submission_attribution_len");
            }
        });

        it("die Nutzungsbedingungen: die Fassung ist nie leer", async () => {
            for (const terms of ["", "   "]) {
                expect((await violation(insertSubmission({ terms_version: terms }))).constraint).toBe(
                    "media_submission_terms_version_not_blank",
                );
            }
        });

        it("Entstehung und Lizenzwahl: jeder Wert aus shared wird angenommen, ein anderer nicht", async () => {
            for (const kind of PHOTOBOX_CREATION_KINDS) {
                await insertSubmission({ creation_kind: kind, usage_grant: "avesmaps_only" });
            }
            for (const grant of PHOTOBOX_USAGE_GRANTS) {
                await insertSubmission({ creation_kind: "drawing", usage_grant: grant });
            }
            expect(await violation(insertSubmission({ creation_kind: "scan" }))).toEqual({
                code: CHECK,
                constraint: "media_submission_creation_kind_known",
            });
            expect(await violation(insertSubmission({ usage_grant: "cc0" }))).toEqual({
                code: CHECK,
                constraint: "media_submission_usage_grant_known",
            });
            expect((await violation(insertSubmission({ usage_grant: "permission" }))).constraint).toBe(
                "media_submission_usage_grant_known",
            );
        });

        it("🔴 eine Avesmaps-Aufnahme gibt es nur für Avesmaps, nie unter CC BY (die Datenbank weist es ab, nicht nur das Formular)", async () => {
            expect(
                await violation(insertSubmission({ creation_kind: "avesmaps_capture", usage_grant: "cc-by-4.0" })),
            ).toEqual({
                code: CHECK,
                constraint: "media_submission_capture_avesmaps_only",
            });
            // Die Datenbank folgt `photoboxGrantAllowed` für jede Kombination.
            for (const kind of PHOTOBOX_CREATION_KINDS) {
                for (const grant of PHOTOBOX_USAGE_GRANTS) {
                    const attempt = insertSubmission({ creation_kind: kind, usage_grant: grant });
                    if (photoboxGrantAllowed(kind, grant)) {
                        await attempt;
                    } else {
                        expect((await violation(attempt)).constraint, `${kind} + ${grant}`).toBe(
                            "media_submission_capture_avesmaps_only",
                        );
                    }
                }
            }
            // Auch nachträglich: eine angenommene Aufnahme unter Avesmaps lässt sich nicht auf CC BY umstellen.
            const capture = await insertSubmission({ creation_kind: "avesmaps_capture", usage_grant: "avesmaps_only" });
            expect(
                (
                    await violation(
                        database`UPDATE media_submission SET usage_grant = 'cc-by-4.0' WHERE id = ${capture.id}`,
                    )
                ).constraint,
            ).toBe("media_submission_capture_avesmaps_only");
        });

        it("Blickrichtung: NULL oder 0 bis 7 (acht Himmelsrichtungen)", async () => {
            for (let direction = 0; direction < PHOTOBOX_LIMITS.viewDirections; direction += 1) {
                await insertSubmission({ view_direction: direction });
            }
            for (const direction of [PHOTOBOX_LIMITS.viewDirections, -1, 360]) {
                expect(
                    await violation(insertSubmission({ view_direction: direction })),
                    `Richtung ${String(direction)}`,
                ).toEqual({ code: CHECK, constraint: "media_submission_view_direction_range" });
            }
        });

        it("Bezug: Art und Schlüssel beide oder keins; die Arten sind die der Suche", async () => {
            for (const kind of PHOTOBOX_REFERENCE_KINDS) {
                await insertSubmission({ reference_kind: kind, reference_key: `${kind}:Gareth` });
            }
            expect(PHOTOBOX_REFERENCE_KINDS.length).toBeGreaterThan(0);
            expect((await violation(insertSubmission({ reference_kind: "ort" }))).constraint).toBe(
                "media_submission_reference_pair",
            );
            expect((await violation(insertSubmission({ reference_key: "ort:Gareth" }))).constraint).toBe(
                "media_submission_reference_pair",
            );
            expect(
                await violation(insertSubmission({ reference_kind: "fluss", reference_key: "fluss:Großer Fluss" })),
            ).toEqual({ code: CHECK, constraint: "media_submission_reference_kind_known" });
        });

        it("🔴 freigegeben und offline brauchen das Asset; andere Zustände dürfen es nicht haben müssen", async () => {
            for (const state of ["approved", "offline"]) {
                expect(await violation(insertSubmission({ state })), state).toEqual({
                    code: CHECK,
                    constraint: "media_submission_approved_has_asset",
                });
            }
            const asset = await insertAsset(database, { ref: "approved:a", rights: null, published: [] });
            const approved = await insertSubmission({ state: "approved", approved_media_asset_id: asset.id });
            // Das Asset gehört nicht weg, solange eine Einreichung darauf zeigt (kein ON DELETE).
            expect(await violation(database`DELETE FROM media_asset WHERE id = ${asset.id}`)).toEqual({
                code: FOREIGN_KEY,
                constraint: "media_submission_asset_fk",
            });
            // Zurücknehmen (offline) lässt den Verweis stehen; ihn zu entfernen geht nicht.
            await database`UPDATE media_submission SET state = 'offline' WHERE id = ${approved.id}`;
            expect(
                (
                    await violation(
                        database`UPDATE media_submission SET approved_media_asset_id = NULL WHERE id = ${approved.id}`,
                    )
                ).constraint,
            ).toBe("media_submission_approved_has_asset");
            await insertSubmission({ state: "pending" });
            await insertSubmission({ state: "rejected" });
        });

        it("🔴 geleert (purged): Schlüssel, Beschreibung und Name sind weg, sonst nicht; alle anderen Zustände behalten Schlüssel und Beschreibung", async () => {
            const emptied = { state: "purged", status_key_hash: null, description: null, attribution_name: null };
            await insertSubmission(emptied);
            for (const leftover of [
                { description: "noch da" },
                { attribution_name: "Alrik" },
                { status_key_hash: keyHash() },
            ]) {
                expect(
                    await violation(insertSubmission({ ...emptied, ...leftover })),
                    JSON.stringify(Object.keys(leftover)),
                ).toEqual({ code: CHECK, constraint: "media_submission_purged_empty" });
            }
            // Jede andere Einreichung hat Schlüssel und Beschreibung.
            expect((await violation(insertSubmission({ description: null }))).constraint).toBe(
                "media_submission_purged_empty",
            );
            // Der Name ist freiwillig.
            await insertSubmission({ attribution_name: null });
        });

        it("🔴 geleert statt gelöscht: purged geht durch, auch wenn ein media_ingest auf die Einreichung zeigt; löschen scheitert am Fremdschlüssel", async () => {
            const created = await insertSubmission({ state: "expired" });
            const asset = await insertAsset(database, { ref: "purge:a" });
            await database`
                INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id)
                VALUES (${asset.id}, 'community_upload', ${created.id})`;
            await database`
                UPDATE media_submission
                   SET state = 'purged', status_key_hash = NULL, description = NULL, attribution_name = NULL, state_changed_at = now()
                 WHERE id = ${created.id}`;
            const [kept] = await database<
                { state: string }[]
            >`SELECT state FROM media_submission WHERE id = ${created.id}`;
            expect(kept?.state).toBe("purged");
            const [ingest] = await database<{ submission_id: string }[]>`
                SELECT submission_id FROM media_ingest WHERE media_asset_id = ${asset.id}`;
            expect(ingest?.submission_id).toBe(created.id);
            // Gelöscht wird nie: der Eingang hielte den Fremdschlüssel (die App-Rolle darf media_ingest ohnehin nicht löschen).
            expect((await violation(database`DELETE FROM media_submission WHERE id = ${created.id}`)).constraint).toBe(
                "media_ingest_submission_fk",
            );
        });

        it("Fremdschlüssel: Kartendomäne, Ort und Asset müssen es geben; der Ort ist freiwillig", async () => {
            const place = await insertPlace(database, 701);
            const withPlace = await insertSubmission({ place_id: place.id });
            const [row] = await database<
                { place_id: string | null }[]
            >`SELECT place_id FROM media_submission WHERE id = ${withPlace.id}`;
            expect(row?.place_id).toBe(place.id);
            expect(await violation(insertSubmission({ map_domain_id: "nirgendwo" }))).toEqual({
                code: FOREIGN_KEY,
                constraint: "media_submission_map_domain_fk",
            });
            expect(await violation(insertSubmission({ place_id: MISSING_ID }))).toEqual({
                code: FOREIGN_KEY,
                constraint: "media_submission_place_fk",
            });
            expect(
                await violation(insertSubmission({ state: "approved", approved_media_asset_id: MISSING_ID })),
            ).toEqual({ code: FOREIGN_KEY, constraint: "media_submission_asset_fk" });
        });

        it("die Stelle der Karte ist ein Punkt und nie leer", async () => {
            await expect(insertSubmission({ geom: "SRID=0;LINESTRING(0 0, 1 1)" })).rejects.toThrow(/Point/u);
            await expect(insertSubmission({ geom: null })).rejects.toMatchObject({ code: "23502" });
        });

        it("🔴 die Stelle liegt in der Kartendomäne (wie place): ein Punkt außerhalb oder in einer anderen SRID wird abgewiesen", async () => {
            // Die Domäne reicht von 0 bis 1024 (config der Kartendomäne `aventuria`); Besucher ohne Konto liefern die Koordinate.
            await insertSubmission({ geom: "SRID=0;POINT(1 1)" });
            await insertSubmission({ geom: "SRID=0;POINT(1023 1023)" });
            for (const geom of [
                "SRID=0;POINT(2000 300)",
                "SRID=0;POINT(300 -5)",
                "SRID=0;POINT(1000000000 1000000000)",
                "SRID=0;POINT(-1000000000 300)",
            ]) {
                expect(await violation(insertSubmission({ geom })), geom).toEqual({
                    code: CHECK,
                    constraint: "media_submission_inside_domain",
                });
            }
            // Eine andere SRID besteht die Bedingung nie: Die Prüfung gegen die Hülle der Domäne meldet gemischte SRIDs.
            await expect(insertSubmission({ geom: "SRID=4326;POINT(10 50)" })).rejects.toThrow(/SRID/u);
            // Auch nachträglich: Ein angenommener Punkt lässt sich nicht aus der Karte schieben.
            const created = await insertSubmission();
            expect(
                (
                    await violation(
                        database`UPDATE media_submission SET geom = ST_SetSRID(ST_MakePoint(5000, 5), 0) WHERE id = ${created.id}`,
                    )
                ).constraint,
            ).toBe("media_submission_inside_domain");
        });

        it("die Stelle hat einen räumlichen Index (GiST) wie place.geom", async () => {
            const [index] = await database<{ indexdef: string }[]>`
                SELECT indexdef FROM pg_indexes
                 WHERE schemaname = 'public' AND tablename = 'media_submission' AND indexname = 'media_submission_geom_gist'`;
            expect(index?.indexdef).toMatch(/USING gist \(geom\)/iu);
        });

        it("🔴 die Fachrevision zählt allein der Trigger (BIGINT wie bei den Medientafeln, ADR-0020): jedes UPDATE erhöht revision und setzt updated_at", async () => {
            const [type] = await database<{ data_type: string }[]>`
                SELECT data_type FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'media_submission' AND column_name = 'revision'`;
            expect(type?.data_type).toBe("bigint");
            const created = await insertSubmission();
            // `updated_at` als Text: ein `Date` kennt nur Millisekunden, zwei Anweisungen liegen oft in derselben.
            const read = async (): Promise<{ revision: number; updated_at: string; state_changed_at: Date }> => {
                const [row] = await database<{ revision: number; updated_at: string; state_changed_at: Date }[]>`
                    SELECT revision::int AS revision, updated_at::text AS updated_at, state_changed_at FROM media_submission WHERE id = ${created.id}`;
                if (row === undefined) throw new Error("Einreichung fehlt");
                return row;
            };
            const before = await read();
            expect(before.revision).toBe(1);
            await database`UPDATE media_submission SET state = 'pending' WHERE id = ${created.id}`;
            const once = await read();
            expect(once.revision).toBe(2);
            expect(once.updated_at).not.toBe(before.updated_at);
            // `state_changed_at` setzt die App, nicht der Trigger.
            expect(once.state_changed_at.getTime()).toBe(before.state_changed_at.getTime());
            await database`UPDATE media_submission SET adjusted_by_editors = true WHERE id = ${created.id}`;
            expect((await read()).revision).toBe(3);
            // Wer die Revision setzen will, zählt stattdessen hoch: der Trigger gewinnt.
            await database`UPDATE media_submission SET revision = 99 WHERE id = ${created.id}`;
            expect((await read()).revision).toBe(4);
            // Eine bedingte Änderung mit veralteter Revision trifft keine Zeile (Grundlage von baseRevision).
            const stale =
                await database`UPDATE media_submission SET state = 'rejected' WHERE id = ${created.id} AND revision = 2`;
            expect(stale.count).toBe(0);
        });

        it("der Index für den Moderationskorb und die Aufbewahrung liegt auf (Zustand, Zustandswechsel)", async () => {
            const [index] = await database<{ indexdef: string }[]>`
                SELECT indexdef FROM pg_indexes
                 WHERE schemaname = 'public' AND tablename = 'media_submission' AND indexname = 'media_submission_state_changed'`;
            expect(index?.indexdef).toMatch(/\(state, state_changed_at\)/u);
        });

        it("die Tafel und ihre Spalten tragen einen Kommentar mit Verweis auf WI-0068 §12 und WI-0272", async () => {
            const [table] = await database<{ comment: string | null }[]>`
                SELECT obj_description('public.media_submission'::regclass, 'pg_class') AS comment`;
            expect(table?.comment).toMatch(/WI-0068 §12/u);
            expect(table?.comment).toMatch(/WI-0272/u);
            const columns = await database<{ column_name: string; comment: string | null }[]>`
                SELECT a.attname AS column_name, col_description(a.attrelid, a.attnum) AS comment
                  FROM pg_attribute a
                 WHERE a.attrelid = 'public.media_submission'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                 ORDER BY a.attnum`;
            const bare = columns.filter((column) => column.comment === null || column.comment.trim() === "");
            expect(bare.map((column) => column.column_name)).toEqual([]);
        });
    });

    describe("der Eingang verweist auf die Einreichung", () => {
        it("🔴 media_ingest.submission_id auf eine fehlende Einreichung scheitert am Fremdschlüssel; auf eine vorhandene geht", async () => {
            const asset = await insertAsset(database, { ref: "ingest:a" });
            expect(
                await violation(
                    database`INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id)
                             VALUES (${asset.id}, 'community_upload', ${MISSING_ID})`,
                ),
            ).toEqual({ code: FOREIGN_KEY, constraint: "media_ingest_submission_fk" });
            const created = await insertSubmission();
            await database`INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id)
                           VALUES (${asset.id}, 'community_upload', ${created.id})`;
            // Die Zeilen des vorigen Release (ohne Einreichung) bleiben gültig.
            const other = await insertAsset(database, { ref: "ingest:b" });
            await database`INSERT INTO media_ingest (media_asset_id, ingest_kind, submission_id, actor_person_id)
                           VALUES (${other.id}, 'editor_upload', NULL, '7e570000-0000-4000-8000-00000000000a')`;
        });
    });

    describe("die Folgefelder der Einreichung (WI-0272 S2, Migration 0284)", () => {
        it("wartende Beschreibung: NULL oder 1 bis 300 Zeichen nach btrim; 301 Zeichen verletzen media_submission_pending_description_len", async () => {
            const { descriptionMax } = PHOTOBOX_LIMITS;
            const [leer] = await database<{ pending_description: string | null; editor_message: string | null }[]>`
                SELECT pending_description, editor_message FROM media_submission WHERE id = ${(await insertSubmission()).id}`;
            expect(leer).toEqual({ pending_description: null, editor_message: null });
            await insertSubmission({ pending_description: "x" });
            await insertSubmission({ pending_description: "ä".repeat(descriptionMax) });
            // Gezählt wird nach dem Kürzen der Leerzeichen am Rand.
            await insertSubmission({ pending_description: `  ${"y".repeat(descriptionMax)}  ` });
            for (const text of ["ä".repeat(descriptionMax + 1), "   ", ""]) {
                expect(
                    await violation(insertSubmission({ pending_description: text })),
                    `wartende Beschreibung mit ${String(text.length)} Zeichen`,
                ).toEqual({ code: CHECK, constraint: "media_submission_pending_description_len" });
            }
        });

        it("Nachricht der Redaktion: NULL oder 1 bis 1000 Zeichen nach btrim; 1001 Zeichen verletzen media_submission_editor_message_len", async () => {
            await insertSubmission({ editor_message: "x" });
            await insertSubmission({ editor_message: "ö".repeat(1000) });
            for (const text of ["ö".repeat(1001), "   ", ""]) {
                expect(
                    await violation(insertSubmission({ editor_message: text })),
                    `Nachricht mit ${String(text.length)} Zeichen`,
                ).toEqual({ code: CHECK, constraint: "media_submission_editor_message_len" });
            }
        });

        it("beide Spalten lassen sich an einer vorhandenen Einreichung setzen und wieder leeren (UPDATE geprüft wie INSERT)", async () => {
            const created = await insertSubmission();
            await database`UPDATE media_submission SET pending_description = 'Neu', editor_message = 'Bitte kürzen' WHERE id = ${created.id}`;
            expect(
                await violation(
                    database`UPDATE media_submission SET pending_description = ${"z".repeat(301)} WHERE id = ${created.id}`,
                ),
            ).toEqual({ code: CHECK, constraint: "media_submission_pending_description_len" });
            await database`UPDATE media_submission SET pending_description = NULL, editor_message = NULL WHERE id = ${created.id}`;
        });
    });

    describe("erweiterte Wertelisten alter Tafeln: photobox kommt dazu, nichts fällt weg", () => {
        /** Die Werte, die ein CHECK in der Form `x IN (…)` nennt (`pg_get_constraintdef`: `'wert'::text`), sortiert. */
        async function listedValues(table: string, constraint: string): Promise<string[]> {
            const [row] = await database<{ definition: string }[]>`
                SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
                 WHERE conrelid = ${`public.${table}`}::regclass AND conname = ${constraint}`;
            if (row === undefined) throw new Error(`${table}.${constraint} fehlt`);
            return [...row.definition.matchAll(/'([^']*)'::text/gu)].map((match) => match[1] ?? "").sort();
        }

        it("🔴 die Werteliste jedes CHECK ist genau die Konstante aus shared (in beide Richtungen), wo es eine gibt", async () => {
            const sorted = (values: readonly string[]): string[] => [...values].sort();
            const expected: [string, string, readonly string[]][] = [
                ["media_submission", "media_submission_kind_known", ["photobox"]],
                ["media_submission", "media_submission_state_known", PHOTOBOX_SUBMISSION_STATES],
                ["media_submission", "media_submission_creation_kind_known", PHOTOBOX_CREATION_KINDS],
                ["media_submission", "media_submission_usage_grant_known", PHOTOBOX_USAGE_GRANTS],
                ["media_submission", "media_submission_reference_kind_known", PHOTOBOX_REFERENCE_KINDS],
                ["media_gallery", "media_gallery_kind_known", MEDIA_GALLERY_KINDS],
                ["publication_rule", "publication_rule_role_known", MEDIA_ROLES],
                ["place_media_gallery", "place_media_gallery_origin_known", MEDIA_GALLERY_ORIGINS],
            ];
            for (const [table, constraint, constants] of expected) {
                expect(await listedValues(table, constraint), constraint).toEqual(sorted(constants));
            }
            // `place_media_gallery.role` hat keine Entsprechung in shared (heute nur Orte): hier steht die Liste des Schemas.
            expect(await listedValues("place_media_gallery", "place_media_gallery_role_known")).toEqual([
                "header",
                "photobox",
            ]);
        });

        it("media_gallery.gallery_kind: jede Art aus MEDIA_GALLERY_KINDS wird angenommen, ein unbekannter Wert nicht", async () => {
            for (const kind of MEDIA_GALLERY_KINDS) {
                await database`INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES (${kind}, ${FIXTURE_SOURCE}, ${`kind:${kind}`})`;
            }
            expect(MEDIA_GALLERY_KINDS).toContain("photobox");
            expect(
                (
                    await violation(
                        database`INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES ('social', ${FIXTURE_SOURCE}, 'kind:social')`,
                    )
                ).constraint,
            ).toBe("media_gallery_kind_known");
        });

        it("publication_rule.role: jede Rolle aus MEDIA_ROLES trägt eine Regel, auch die beiden stehenden für photobox; ein unbekannter Wert nicht", async () => {
            for (const role of MEDIA_ROLES) {
                await insertRule(database, { basis: "own_work", role });
            }
            // Die zwei stehenden Regeln der Rolle (WI-0272 §12 Nr. 2): je Rechtsgrundlage, die CC-Regel mit Lizenzschlüssel.
            await insertRule(database, { basis: "permission", role: "photobox" });
            await insertRule(database, { basis: "license", licenseKey: "cc-by-4.0", role: "photobox" });
            expect((await violation(insertRule(database, { basis: "permission", role: "social" }))).constraint).toBe(
                "publication_rule_role_known",
            );
        });

        it("place_media_gallery: jede Herkunft aus MEDIA_GALLERY_ORIGINS und die Rolle photobox werden angenommen, ein unbekannter Wert nicht", async () => {
            let n = 710;
            for (const origin of MEDIA_GALLERY_ORIGINS) {
                const place = await insertPlace(database, n);
                const gallery = await insertGallery(database, `pmg:${origin}`);
                n += 1;
                await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                               VALUES (${place.id}, ${gallery.id}, 'header', ${origin})`;
            }
            const place = await insertPlace(database, n);
            const photobox = await database<{ id: string }[]>`
                INSERT INTO media_gallery (gallery_kind, source_system, source_ref) VALUES ('photobox', ${FIXTURE_SOURCE}, 'pmg:kind-photobox')
                RETURNING id`;
            const photoboxGallery = photobox[0];
            if (photoboxGallery === undefined) throw new Error("Galerie nicht angelegt");
            await database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                           VALUES (${place.id}, ${photoboxGallery.id}, 'photobox', 'photobox')`;
            const other = await insertGallery(database, "pmg:other");
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                                 VALUES (${place.id}, ${other.id}, 'social', 'photobox')`,
                    )
                ).constraint,
            ).toBe("place_media_gallery_role_known");
            expect(
                (
                    await violation(
                        database`INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                                 VALUES (${place.id}, ${other.id}, 'photobox', 'wiki')`,
                    )
                ).constraint,
            ).toBe("place_media_gallery_origin_known");
        });
    });

    describe("die Verwendung der Rolle photobox (WI-0272 S3, Migration 0293)", () => {
        /** Eine freigegebene Einreichung mit ihrem Asset: das, woran eine Verwendung hängt. */
        async function freigegeben(ref: string): Promise<{ submissionId: string; assetId: string }> {
            const asset = await insertAsset(database, { ref, rights: null, published: [] });
            const submission = await insertSubmission({ state: "approved", approved_media_asset_id: asset.id });
            return { submissionId: submission.id, assetId: asset.id };
        }

        async function insertUsage(
            fall: { submissionId: string; assetId: string },
            overrides: Record<string, unknown> = {},
        ): Promise<{ id: string }> {
            const [row] = await database<{ id: string }[]>`
                INSERT INTO photobox_media ${database({ media_submission_id: fall.submissionId, media_asset_id: fall.assetId, ...overrides })}
                RETURNING id`;
            if (row === undefined) throw new Error("Verwendung nicht angelegt");
            return row;
        }

        /** Die Werte, die ein CHECK der Form `x = '…'` oder `x IN (…)` nennt, sortiert. */
        async function werteDes(constraint: string): Promise<string[]> {
            const [row] = await database<{ definition: string }[]>`
                SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
                 WHERE conrelid = 'public.photobox_media'::regclass AND conname = ${constraint}`;
            if (row === undefined) throw new Error(`photobox_media.${constraint} fehlt`);
            return [...row.definition.matchAll(/'([^']*)'::text/gu)].map((match) => match[1] ?? "").sort();
        }

        it("eine gültige Verwendung: Rolle photobox, keine Einzelentscheidung, aktiv, Fassung 1", async () => {
            const fall = await freigegeben("verwendung:gueltig");
            const angelegt = await insertUsage(fall);
            const [row] = await database<
                {
                    role: string;
                    publication_override: string;
                    retired_at: Date | null;
                    revision: number;
                    override_decided_on: Date | null;
                }[]
            >`
                SELECT role, publication_override, retired_at, revision::int AS revision, override_decided_on
                  FROM photobox_media WHERE id = ${angelegt.id}`;
            expect(row).toEqual({
                role: "photobox",
                publication_override: "none",
                retired_at: null,
                revision: 1,
                override_decided_on: null,
            });
        });

        it("🔴 eine Einreichung hat höchstens EINE Verwendung, auch eine zurückgenommene zählt", async () => {
            const fall = await freigegeben("verwendung:eindeutig");
            const erste = await insertUsage(fall);
            expect(await violation(insertUsage(fall))).toEqual({
                code: UNIQUE,
                constraint: "photobox_media_submission_unique",
            });
            await database`UPDATE photobox_media SET retired_at = now() WHERE id = ${erste.id}`;
            expect((await violation(insertUsage(fall))).constraint).toBe("photobox_media_submission_unique");
        });

        it("die Rolle ist photobox und nichts anderes", async () => {
            expect(MEDIA_ROLES).toContain("photobox");
            const fall = await freigegeben("verwendung:rolle");
            for (const rolle of MEDIA_ROLES.filter((role) => role !== "photobox")) {
                expect((await violation(insertUsage(fall, { role: rolle }))).constraint, rolle).toBe(
                    "photobox_media_role_known",
                );
            }
        });

        it("Fremdschlüssel: Einreichung und Asset müssen es geben; beide halten ihre Verwendung (kein ON DELETE)", async () => {
            const fall = await freigegeben("verwendung:fk");
            expect(await violation(insertUsage({ submissionId: MISSING_ID, assetId: fall.assetId }))).toEqual({
                code: FOREIGN_KEY,
                constraint: "photobox_media_media_submission_id_fkey",
            });
            expect(await violation(insertUsage({ submissionId: fall.submissionId, assetId: MISSING_ID }))).toEqual({
                code: FOREIGN_KEY,
                constraint: "photobox_media_media_asset_id_fkey",
            });
            await insertUsage(fall);
            // Wer die Einreichung oder das Asset löschen will, muss erst die Verwendung auflösen (so wie die Aufbewahrung es tut).
            expect(
                (await violation(database`DELETE FROM media_submission WHERE id = ${fall.submissionId}`)).constraint,
            ).toBe("photobox_media_media_submission_id_fkey");
            expect((await violation(database`DELETE FROM media_asset WHERE id = ${fall.assetId}`)).constraint).toMatch(
                /^(photobox_media_media_asset_id_fkey|media_submission_asset_fk)$/u,
            );
        });

        it("🔴 Einzelentscheidung wie an place_media: approved braucht Datum UND (Zitat ODER Person); eine Person nie ohne Datum", async () => {
            const fall = await freigegeben("verwendung:override");
            expect(await violation(insertUsage(fall, { publication_override: "veroeffentlicht" }))).toEqual({
                code: CHECK,
                constraint: "photobox_media_override_known",
            });
            expect((await violation(insertUsage(fall, { publication_override: "approved" }))).constraint).toBe(
                "photobox_media_approved_has_decision",
            );
            expect(
                (
                    await violation(
                        insertUsage(fall, { publication_override: "approved", override_decided_on: "2026-11-01" }),
                    )
                ).constraint,
            ).toBe("photobox_media_approved_has_decision");
            expect(
                (
                    await violation(
                        insertUsage(fall, {
                            publication_override: "none",
                            override_decided_by: "7e570000-0000-4000-8000-0000000000bb",
                        }),
                    )
                ).constraint,
            ).toBe("photobox_media_decided_by_has_date");
            const gut = await insertUsage(fall, {
                publication_override: "approved",
                override_decided_on: "2026-11-01",
                override_decided_by: "7e570000-0000-4000-8000-0000000000bb",
            });
            const [row] = await database<
                { publication_override: string }[]
            >`SELECT publication_override FROM photobox_media WHERE id = ${gut.id}`;
            expect(row?.publication_override).toBe("approved");
            expect(await werteDes("photobox_media_override_known")).toEqual(["approved", "blocked", "none"]);
        });

        it("🔴 die Fachrevision zählt allein der Trigger: jedes UPDATE erhöht revision, eine gesetzte Zahl gilt nicht", async () => {
            const fall = await freigegeben("verwendung:revision");
            const angelegt = await insertUsage(fall);
            const lies = async (): Promise<number> => {
                const [row] = await database<{ revision: number }[]>`
                    SELECT revision::int AS revision FROM photobox_media WHERE id = ${angelegt.id}`;
                return row!.revision;
            };
            expect(await lies()).toBe(1);
            await database`UPDATE photobox_media SET retired_at = now() WHERE id = ${angelegt.id}`;
            expect(await lies()).toBe(2);
            await database`UPDATE photobox_media SET revision = 99 WHERE id = ${angelegt.id}`;
            expect(await lies()).toBe(3);
        });

        it("Indizes: die aktive Verwendung je Asset und der Eingang je Einreichung (nur wo es eine Einreichung gibt)", async () => {
            const indizes = await database<{ indexname: string; indexdef: string }[]>`
                SELECT indexname, indexdef FROM pg_indexes
                 WHERE schemaname = 'public' AND indexname IN ('photobox_media_asset', 'media_ingest_submission')`;
            const nachName = new Map(indizes.map((index) => [index.indexname, index.indexdef]));
            expect(nachName.get("photobox_media_asset")).toMatch(/\(media_asset_id\) WHERE \(retired_at IS NULL\)/u);
            expect(nachName.get("media_ingest_submission")).toMatch(
                /\(submission_id\) WHERE \(submission_id IS NOT NULL\)/u,
            );
        });

        it("die Tafel und ihre fachlichen Spalten tragen einen Kommentar mit Verweis auf WI-0272", async () => {
            const [table] = await database<{ comment: string | null }[]>`
                SELECT obj_description('public.photobox_media'::regclass, 'pg_class') AS comment`;
            expect(table?.comment).toMatch(/WI-0272/u);
            const columns = await database<{ column_name: string; comment: string | null }[]>`
                SELECT a.attname AS column_name, col_description(a.attrelid, a.attnum) AS comment
                  FROM pg_attribute a
                 WHERE a.attrelid = 'public.photobox_media'::regclass AND a.attnum > 0 AND NOT a.attisdropped
                 ORDER BY a.attnum`;
            // Schlüssel und Zeitstempel erklären sich selbst; alles Fachliche trägt einen Kommentar.
            const ohne = columns
                .filter((column) => (column.comment ?? "").trim() === "")
                .map((column) => column.column_name);
            expect(ohne).toEqual(["id", "created_at", "updated_at"]);
        });
    });
});
