import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { requestHash } from "../src/auth/operations.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { storageKey } from "../src/media/storage.ts";
import {
    FIXTURE_SOURCE,
    cleanMediaFixtures,
    insertAdventure,
    insertAsset,
    insertCitymap,
    insertGallery,
    insertPlace,
    insertRule,
    insertPublishedFile,
    insertTerritory,
    sha,
    violation,
} from "./support/media-fixture.ts";

/**
 * Das additive MAM-Datenmodell gegen echtes PostgreSQL (WI-0068 P1, Migration 0086): Fachrevision und Konflikt (ADR-0020), die
 * Galerie als Objekt, Entscheidungen einer Person, Provenienz `media_ingest`, Operation und Fachprotokoll (ADR-0019) und der
 * Einzelbild-Notaus. Jede Zusicherung hier hält das Schema selbst, nicht ein Schreibpfad (den gibt es in P1 noch nicht).
 * Die Rechte der Rollen prüft `media-mam-grants.test.ts` auf einem Wegwerf-Cluster wie dem VPS.
 *
 * Alles trägt die Marken der Medienfixtures (Quellsystem `media-test`, UUIDs `6d656469-…`); Operationen die Aktion `mamtest.…`.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const CHECK = "23514";
const NOT_NULL = "23502";
const UNIQUE = "23505";
const FOREIGN_KEY = "23503";

/** Pseudonyme Personen (`person.id`); die Fachtabellen verweisen ohne Fremdschlüssel ins Schema `avesmaps_auth`. */
const ALRIK = "7e570000-0000-4000-8000-00000000000a";
const BRIN = "7e570000-0000-4000-8000-00000000000b";
const operationId = (n: number): string => `6d616d74-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const MIGRATION_FILE = fileURLToPath(new URL("../migrations/0086_media_mam.sql", import.meta.url));
const ROLLBACK = "__zurueck__";

describeWithDatabase("MAM-Datenmodell (WI-0068 P1, Migration 0086)", () => {
    let database: Database;

    async function cleanOperations(): Promise<void> {
        await database`DELETE FROM media_audit_event WHERE operation_id IN (SELECT operation_id FROM media_operation WHERE action LIKE 'mamtest.%')`;
        await database`DELETE FROM media_operation WHERE action LIKE 'mamtest.%'`;
    }

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
    }, 120_000);

    afterAll(async () => {
        await cleanOperations();
        await cleanMediaFixtures(database);
        await database.end({ timeout: 5 });
    });

    beforeEach(async () => {
        await cleanOperations();
        await cleanMediaFixtures(database);
    });

    afterEach(async () => {
        await cleanOperations();
        await cleanMediaFixtures(database);
    });

    /** Führt `work` in einer Transaktion aus und rollt immer zurück. */
    async function rolledBack(work: (tx: Queryable) => Promise<void>): Promise<void> {
        try {
            await database.begin(async (tx) => {
                await work(tx);
                throw new Error(ROLLBACK);
            });
        } catch (error) {
            if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
        }
    }

    async function revisionOf(table: string, id: string): Promise<number> {
        const [row] = await database.unsafe<{ revision: string }[]>(`SELECT revision FROM ${table} WHERE id = $1`, [
            id,
        ]);
        if (row === undefined) throw new Error(`${table} ${id} fehlt`);
        return Number(row.revision);
    }

    async function insertItem(galleryId: string, assetId: string, sortOrder: number): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO media_gallery_item (gallery_id, media_asset_id, sort_order) VALUES (${galleryId}, ${assetId}, ${sortOrder})
            RETURNING id
        `;
        if (row === undefined) throw new Error("Eintrag nicht angelegt");
        return row.id;
    }

    async function bindPlace(placeId: string, assetId: string, role = "coat"): Promise<string> {
        const [row] = await database<{ id: string }[]>`
            INSERT INTO place_media (place_id, media_asset_id, role, origin) VALUES (${placeId}, ${assetId}, ${role}, 'legacy')
            RETURNING id
        `;
        if (row === undefined) throw new Error("Bindung nicht angelegt");
        return row.id;
    }

    interface OperationRow {
        request_hash: Buffer;
        receipt: object;
        action: string;
        environment: string;
        actor_kind: string;
        actor_person_id: string | null;
        actor_label: string | null;
    }

    /** Eine Zeile, wie sie `runOperation` mit der Speicherstelle der Medien schriebe (Kennung, Hash, Quittung, Akteur). */
    async function insertOperation(db: Queryable, n: number, body: unknown, overrides: Partial<OperationRow> = {}) {
        const id = operationId(n);
        const receipt = {
            operationId: id,
            status: "applied",
            environment: "test",
            affected: [{ kind: "media_asset", id: "x", revision: 2 }],
            derivedWork: [],
            warnings: [],
        };
        const row: OperationRow = {
            request_hash: requestHash(body),
            receipt,
            action: "mamtest.probe",
            environment: "test",
            actor_kind: "person",
            actor_person_id: ALRIK,
            actor_label: null,
            ...overrides,
        };
        await db`
            INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id, actor_label)
            VALUES (${id}, ${row.request_hash}, ${db.json(row.receipt as never)}, ${row.action}, ${row.environment}, ${row.actor_kind},
                    ${row.actor_person_id}, ${row.actor_label})
        `;
        return { id, receipt };
    }

    describe("Fachrevision und Konflikt (ADR-0020)", () => {
        it("jede änderbare Medientabelle zählt bei jeder Änderung hoch, auch wenn jemand die Revision selbst setzen will", async () => {
            const asset = await insertAsset(database, { ref: "rev:a" });
            await database`INSERT INTO media_creation (media_asset_id, tool) VALUES (${asset.id}, 'Pinsel')`;
            const gallery = await insertGallery(database, "rev:g");
            const item = await insertItem(gallery.id, asset.id, 0);
            const place = await insertPlace(database, 1);
            const territory = await insertTerritory(database, 2);
            const adventure = await insertAdventure(database, 3);
            const citymap = await insertCitymap(database, 4);
            const ids: Record<string, string> = {
                media_gallery: gallery.id,
                media_gallery_item: item,
                place_media: await bindPlace(place.id, asset.id),
                territory_media: await (async () => {
                    const [row] = await database<{ id: string }[]>`
                        INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
                        VALUES (${territory.id}, ${asset.id}, 'coat', 'legacy') RETURNING id`;
                    return row?.id ?? "";
                })(),
                adventure_media: await (async () => {
                    const [row] = await database<{ id: string }[]>`
                        INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin)
                        VALUES (${adventure.id}, ${asset.id}, 'literature_cover', 'legacy') RETURNING id`;
                    return row?.id ?? "";
                })(),
                citymap_media: await (async () => {
                    const [row] = await database<{ id: string }[]>`
                        INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
                        VALUES (${citymap.id}, ${asset.id}, 'map_preview', 'legacy') RETURNING id`;
                    return row?.id ?? "";
                })(),
                place_media_gallery: await (async () => {
                    const [row] = await database<{ id: string }[]>`
                        INSERT INTO place_media_gallery (place_id, media_gallery_id, role, origin)
                        VALUES (${place.id}, ${gallery.id}, 'header', 'legacy') RETURNING id`;
                    return row?.id ?? "";
                })(),
                publication_rule: await insertRule(database, { basis: "own_work", role: "coat" }),
            };
            const assetKeyed: Record<string, string> = { media_rights: asset.id, media_creation: asset.id };

            // 🔴 Die Bindungen von Wappen und Titelbild zählen seit 0195 mit `revision_bump_forward()` (GREATEST(OLD + 1, NEW)): Beim Wechsel
            // des Bildes setzt die Operation die neu aktive Zeile über jede frühere des Platzes (`naechsteRevision`, WI-0068 R8,
            // `media-wettlauf.test.ts`). Eine HÖHERE Zahl nimmt der Trigger dort an; zurückdrehen oder einfrieren lässt sich die Revision
            // nirgends.
            const VORWAERTS = new Set(["place_media", "territory_media"]);
            for (const [table, id] of Object.entries(ids)) {
                const before = await revisionOf(table, id);
                await database.unsafe(`UPDATE ${table} SET updated_at = updated_at WHERE id = $1`, [id]);
                expect(await revisionOf(table, id), `${table}: jede Änderung zählt`).toBe(before + 1);
                await database.unsafe(`UPDATE ${table} SET revision = 99 WHERE id = $1`, [id]);
                if (VORWAERTS.has(table)) {
                    expect(await revisionOf(table, id), `${table}: eine höhere Zahl gilt`).toBe(99);
                    await database.unsafe(`UPDATE ${table} SET revision = 1 WHERE id = $1`, [id]);
                    expect(await revisionOf(table, id), `${table}: zurückdrehen geht nie`).toBe(100);
                } else {
                    expect(await revisionOf(table, id), `${table}: die Revision schreibt nur der Trigger`).toBe(
                        before + 2,
                    );
                }
            }
            for (const [table, assetId] of Object.entries(assetKeyed)) {
                const read = async () => {
                    const [row] = await database.unsafe<{ revision: string }[]>(
                        `SELECT revision FROM ${table} WHERE media_asset_id = $1`,
                        [assetId],
                    );
                    return Number(row?.revision);
                };
                expect(await read(), `${table} beginnt bei 1`).toBe(1);
                await database.unsafe(`UPDATE ${table} SET updated_at = updated_at WHERE media_asset_id = $1`, [
                    assetId,
                ]);
                await database.unsafe(`UPDATE ${table} SET revision = 7 WHERE media_asset_id = $1`, [assetId]);
                expect(await read(), table).toBe(3);
            }
        });

        it("am Asset zählt nur das Fachliche: der Binärimport (technical_state) erzeugt keinen Konflikt, Titel und Entstehung schon", async () => {
            const asset = await insertAsset(database, { ref: "rev:b", technicalState: "pending" });
            expect(await revisionOf("media_asset", asset.id)).toBe(1);
            await database`UPDATE media_asset SET technical_state = 'ok', updated_at = now() WHERE id = ${asset.id}`;
            expect(await revisionOf("media_asset", asset.id), "technical_state gehört dem Binärimport").toBe(1);
            await database`UPDATE media_asset SET title = 'Wappen von Gareth' WHERE id = ${asset.id}`;
            await database`UPDATE media_asset SET creation_method = 'drawing' WHERE id = ${asset.id}`;
            await database`UPDATE media_asset SET revision = 1 WHERE id = ${asset.id}`;
            expect(await revisionOf("media_asset", asset.id)).toBe(4);
        });

        it("🔴 Konflikt: zwei Editoren mit derselben baseRevision, gleichzeitig; der zweite trifft keine Zeile (409 edit_conflict)", async () => {
            const asset = await insertAsset(database, { ref: "rev:c" });
            const base = await revisionOf("media_asset", asset.id);
            const first = await database.reserve();
            const second = await database.reserve();
            try {
                await first`BEGIN`;
                const won = await first<{ revision: string }[]>`
                    UPDATE media_asset SET title = 'Alriks Titel' WHERE id = ${asset.id} AND revision = ${base} RETURNING revision`;
                expect(won.map((row) => Number(row.revision))).toEqual([base + 1]);
                // Der zweite wartet auf die Zeilensperre und prüft seine Bedingung danach gegen die neue Zeile (READ COMMITTED).
                const pending = second<{ revision: string }[]>`
                    UPDATE media_asset SET title = 'Brins Titel' WHERE id = ${asset.id} AND revision = ${base} RETURNING revision`.execute();
                await new Promise((resolve) => setTimeout(resolve, 150));
                await first`COMMIT`;
                expect(await pending).toHaveLength(0);
            } finally {
                first.release();
                second.release();
            }
            const [row] = await database<{ title: string; revision: string }[]>`
                SELECT title, revision FROM media_asset WHERE id = ${asset.id}`;
            expect(row).toEqual({ title: "Alriks Titel", revision: String(base + 1) });
        });
    });

    describe("Die Galerie als Objekt (§9)", () => {
        it("🔴 die Reihenfolge ist je Galerie eindeutig, auch über zurückgezogene Einträge; Tauschen geht in einer Transaktion", async () => {
            const gallery = await insertGallery(database, "order:g");
            const a = await insertAsset(database, { ref: "order:a" });
            const b = await insertAsset(database, { ref: "order:b" });
            const c = await insertAsset(database, { ref: "order:c" });
            const first = await insertItem(gallery.id, a.id, 0);
            const second = await insertItem(gallery.id, b.id, 1);
            expect(await violation(insertItem(gallery.id, c.id, 1))).toEqual({
                code: UNIQUE,
                constraint: "media_gallery_item_order_unique",
            });
            // Tauschen: der Zwischenzustand mit doppelter Stelle ist erlaubt, nur das Ende zählt.
            await database.begin(async (tx) => {
                await tx`UPDATE media_gallery_item SET sort_order = 1 WHERE id = ${first}`;
                await tx`UPDATE media_gallery_item SET sort_order = 0 WHERE id = ${second}`;
            });
            const order = await database<{ id: string }[]>`
                SELECT id FROM media_gallery_item WHERE gallery_id = ${gallery.id} ORDER BY sort_order`;
            expect(order.map((row) => row.id)).toEqual([second, first]);
            // Ein zurückgezogener Eintrag behält seine Stelle.
            await database`UPDATE media_gallery_item SET retired_at = now() WHERE id = ${second}`;
            expect((await violation(insertItem(gallery.id, c.id, 0))).constraint).toBe(
                "media_gallery_item_order_unique",
            );
            // Eine andere Galerie darf dieselbe Stelle haben, und dasselbe Asset darf in mehreren Galerien stehen.
            const other = await insertGallery(database, "order:h");
            await insertItem(other.id, a.id, 0);
        });

        it("🔴 jede Änderung an einem Eintrag zählt die Revision der Galerie hoch: ein Umsortieren mit alter Revision verliert gegen den Reimport", async () => {
            const gallery = await insertGallery(database, "touch:g");
            const a = await insertAsset(database, { ref: "touch:a" });
            const b = await insertAsset(database, { ref: "touch:b" });
            const seen: number[] = [await revisionOf("media_gallery", gallery.id)];
            const item = await insertItem(gallery.id, a.id, 0);
            seen.push(await revisionOf("media_gallery", gallery.id));
            const other = await insertItem(gallery.id, b.id, 1);
            seen.push(await revisionOf("media_gallery", gallery.id));
            await database`UPDATE media_gallery_item SET caption = 'Hafen' WHERE id = ${item}`;
            seen.push(await revisionOf("media_gallery", gallery.id));
            await database`UPDATE media_gallery_item SET retired_at = now() WHERE id = ${other}`;
            seen.push(await revisionOf("media_gallery", gallery.id));
            await database`DELETE FROM media_gallery_item WHERE id = ${other}`;
            seen.push(await revisionOf("media_gallery", gallery.id));
            for (let index = 1; index < seen.length; index += 1) {
                expect(seen[index], `Schritt ${String(index)}: ${seen.join(" -> ")}`).toBeGreaterThan(
                    seen[index - 1] as number,
                );
            }

            // Ein Editor liest die Galerie, dann ändert ein Reimport die Folge (nur am Eintrag): der Editor speichert ins Leere.
            const base = await revisionOf("media_gallery", gallery.id);
            await database`UPDATE media_gallery_item SET sort_order = 5 WHERE id = ${item}`;
            const guarded = await database`
                UPDATE media_gallery SET updated_at = now() WHERE id = ${gallery.id} AND revision = ${base} RETURNING id`;
            expect(guarded).toHaveLength(0);
        });

        it("das Cover ist ein Eintrag DIESER Galerie; fällt der Eintrag weg, fällt nur das Cover", async () => {
            const mine = await insertGallery(database, "cover:g");
            const foreign = await insertGallery(database, "cover:h");
            const asset = await insertAsset(database, { ref: "cover:a" });
            const own = await insertItem(mine.id, asset.id, 0);
            const theirs = await insertItem(foreign.id, asset.id, 0);
            await database`UPDATE media_gallery SET cover_item_id = ${own} WHERE id = ${mine.id}`;
            expect(
                await violation(database`UPDATE media_gallery SET cover_item_id = ${theirs} WHERE id = ${mine.id}`),
            ).toEqual({ code: FOREIGN_KEY, constraint: "media_gallery_cover_in_gallery" });
            await database`DELETE FROM media_gallery_item WHERE id = ${own}`;
            const [row] = await database<{ cover: string | null }[]>`
                SELECT cover_item_id AS cover FROM media_gallery WHERE id = ${mine.id}`;
            expect(row).toEqual({ cover: null });
        });

        it("Titel, Zustand, Herkunft und Art: was das vorige Release anlegt, ist veröffentlicht und gehört Legacy; editorial ist neu", async () => {
            const legacy = await insertGallery(database, "kind:g");
            const [row] = await database<{ title: string | null; state: string; origin: string; revision: string }[]>`
                SELECT title, publication_state AS state, origin, revision FROM media_gallery WHERE id = ${legacy.id}`;
            expect(row).toEqual({ title: null, state: "published", origin: "legacy", revision: "1" });
            await database`
                INSERT INTO media_gallery (gallery_kind, source_system, source_ref, title, publication_state, origin)
                VALUES ('editorial', ${FIXTURE_SOURCE}, 'kind:e', 'Häfen der Westküste', 'draft', 'editor')`;
            const insert = (column: string, value: string) =>
                database`INSERT INTO media_gallery ${database({
                    gallery_kind: "editorial",
                    source_system: FIXTURE_SOURCE,
                    source_ref: "kind:x",
                    [column]: value,
                })}`;
            expect((await violation(insert("gallery_kind", "social"))).constraint).toBe("media_gallery_kind_known");
            expect((await violation(insert("publication_state", "live"))).constraint).toBe(
                "media_gallery_publication_state_known",
            );
            expect((await violation(insert("origin", "wiki"))).constraint).toBe("media_gallery_origin_known");
            expect((await violation(insert("title", "   "))).constraint).toBe("media_gallery_title_not_blank");
        });
    });

    describe("Entscheidungen einer Person", () => {
        it("🔴 Einzelfreigabe an allen fünf Stellen: Datum und (Zitat ODER Person); eine Person nie ohne Datum", async () => {
            const asset = await insertAsset(database, { ref: "decide:a" });
            const place = await insertPlace(database, 11);
            const territory = await insertTerritory(database, 12);
            const adventure = await insertAdventure(database, 13);
            const citymap = await insertCitymap(database, 14);
            const gallery = await insertGallery(database, "decide:g");
            const targets: [string, string][] = [
                ["place_media", await bindPlace(place.id, asset.id)],
                [
                    "territory_media",
                    (
                        await database<{ id: string }[]>`
                        INSERT INTO territory_media (territory_id, media_asset_id, role, origin)
                        VALUES (${territory.id}, ${asset.id}, 'coat', 'legacy') RETURNING id`
                    )[0]?.id ?? "",
                ],
                [
                    "adventure_media",
                    (
                        await database<{ id: string }[]>`
                        INSERT INTO adventure_media (adventure_id, media_asset_id, role, origin)
                        VALUES (${adventure.id}, ${asset.id}, 'literature_cover', 'legacy') RETURNING id`
                    )[0]?.id ?? "",
                ],
                [
                    "citymap_media",
                    (
                        await database<{ id: string }[]>`
                        INSERT INTO citymap_media (citymap_id, media_asset_id, role, origin)
                        VALUES (${citymap.id}, ${asset.id}, 'map_full', 'legacy') RETURNING id`
                    )[0]?.id ?? "",
                ],
                ["media_gallery_item", await insertItem(gallery.id, asset.id, 0)],
            ];
            for (const [table, id] of targets) {
                const set = (sql: string, params: unknown[]) =>
                    database.unsafe(`UPDATE ${table} SET ${sql} WHERE id = $1`, [id, ...params] as never[]);
                expect((await violation(set("publication_override = 'approved'", []))).constraint, table).toBe(
                    `${table}_approved_has_decision`,
                );
                expect(
                    (await violation(set("publication_override = 'approved', override_decided_by = $2", [BRIN])))
                        .constraint,
                    `${table}: Person ohne Datum`,
                ).toMatch(new RegExp(`^${table}_(approved_has_decision|decided_by_has_date)$`));
                expect((await violation(set("override_decided_by = $2", [BRIN]))).constraint, table).toBe(
                    `${table}_decided_by_has_date`,
                );
                await set(
                    "publication_override = 'approved', override_decided_on = '2026-10-10', override_decided_by = $2, override_reason = $3",
                    [BRIN, "Eigenes Werk, Namensnennung im Panel"],
                );
                // Das Zitat des Betreibers trägt weiter allein (vorige Fassung der Regel).
                await set(
                    "override_decided_by = NULL, override_operator_quote = 'ja, freigeben', override_decided_on = '2026-10-10'",
                    [],
                );
            }
        });

        it("Rechteprüfer und Widerrufer einer Regel als Person nur mit ihrem Datum", async () => {
            const asset = await insertAsset(database, { ref: "decide:r" });
            expect(
                (
                    await violation(
                        database`UPDATE media_rights SET reviewed_by_person = ${ALRIK} WHERE media_asset_id = ${asset.id}`,
                    )
                ).constraint,
            ).toBe("media_rights_reviewer_has_date");
            await database`
                UPDATE media_rights SET reviewed_by_person = ${ALRIK}, reviewed_at = now(), clearance_state = 'cleared'
                WHERE media_asset_id = ${asset.id}`;
            const rule = await insertRule(database, { basis: "own_work", role: "header" });
            expect(
                (await violation(database`UPDATE publication_rule SET revoked_by_person = ${ALRIK} WHERE id = ${rule}`))
                    .constraint,
            ).toBe("publication_rule_revoker_needs_revocation");
            await database`
                UPDATE publication_rule SET revoked_by_person = ${ALRIK}, revoked_on = '2026-10-10', revoked_reason = 'Test',
                       decided_by_person = ${BRIN}
                WHERE id = ${rule}`;
        });
    });

    describe("Provenienz media_ingest (§5)", () => {
        const ingest = (row: Record<string, unknown>) => database`INSERT INTO media_ingest ${database(row)}`;

        it("🔴 der Hochlader ist nicht der Urheber: Ingest-Person und Urheber stehen unabhängig nebeneinander", async () => {
            const asset = await insertAsset(database, {
                ref: "ingest:a",
                rights: { basis: "own_work", clearance: "unreviewed", creator: "Xeledon" },
            });
            await ingest({
                media_asset_id: asset.id,
                ingest_kind: "editor_upload",
                actor_person_id: ALRIK,
                original_filename: "gareth wappen.png",
            });
            const [row] = await database<{ uploader: string; creator: string }[]>`
                SELECT i.actor_person_id::text AS uploader, r.creator
                FROM media_ingest i JOIN media_rights r ON r.media_asset_id = i.media_asset_id
                WHERE i.media_asset_id = ${asset.id}`;
            expect(row).toEqual({ uploader: ALRIK, creator: "Xeledon" });
            // Ein zweiter Ingest desselben Assets (Quelle ersetzt) ist erlaubt; der erste bleibt.
            await ingest({ media_asset_id: asset.id, ingest_kind: "editor_upload", actor_person_id: BRIN });
            const [count] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM media_ingest WHERE media_asset_id = ${asset.id}`;
            expect(count?.n).toBe(2);
        });

        it("die Regeln je Art: Editor mit Person, Legacy mit Lauf und nie mit Person, Legacy-Angaben nur bei legacy_import", async () => {
            const asset = await insertAsset(database, { ref: "ingest:b" });
            const [run] = await database<{ id: string }[]>`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (gen_random_uuid(), 'media', ${FIXTURE_SOURCE}, 'mamtest', 'test') RETURNING id`;
            const base = { media_asset_id: asset.id };
            const cases: [Record<string, unknown>, string][] = [
                [{ ...base, ingest_kind: "editor_upload" }, "media_ingest_editor_has_person"],
                [{ ...base, ingest_kind: "legacy_import" }, "media_ingest_legacy_has_run"],
                // Ein Legacy-Login ist kein Konto (§2 Nr. 8): kein erfundener Personenverweis.
                [
                    { ...base, ingest_kind: "legacy_import", migration_run_id: run?.id, actor_person_id: ALRIK },
                    "media_ingest_legacy_no_person",
                ],
                [
                    { ...base, ingest_kind: "editor_upload", actor_person_id: ALRIK, legacy_actor_label: "thomas" },
                    "media_ingest_legacy_fields_only_legacy",
                ],
                [{ ...base, ingest_kind: "community_upload" }, "media_ingest_community_has_submission"],
                [{ ...base, ingest_kind: "upload" }, "media_ingest_kind_known"],
                [
                    {
                        ...base,
                        ingest_kind: "editor_upload",
                        actor_person_id: ALRIK,
                        original_filename: "../etc/passwd",
                    },
                    "media_ingest_filename_plain",
                ],
                [
                    {
                        ...base,
                        ingest_kind: "editor_upload",
                        actor_person_id: ALRIK,
                        original_filename: "C:\\bild.png",
                    },
                    "media_ingest_filename_plain",
                ],
                [
                    {
                        ...base,
                        ingest_kind: "legacy_import",
                        migration_run_id: run?.id,
                        legacy_stamp_semantics: "upload_time",
                    },
                    "media_ingest_stamp_semantics_known",
                ],
            ];
            for (const [row, constraint] of cases) {
                expect(await violation(ingest(row)), constraint).toEqual({ code: CHECK, constraint });
            }
            await ingest({
                ...base,
                ingest_kind: "legacy_import",
                migration_run_id: run?.id,
                legacy_actor_label: "thomas",
                legacy_stamp_semantics: "last_classification",
            });
            expect(
                await violation(ingest({ ...base, ingest_kind: "legacy_import", migration_run_id: run?.id })),
            ).toEqual({ code: UNIQUE, constraint: "media_ingest_one_legacy_import" });
            await database`DELETE FROM media_ingest WHERE media_asset_id = ${asset.id}`;
            await database`DELETE FROM migration_run WHERE id = ${run?.id ?? ""}`;
        });

        it("🔴 die Übernahme in 0086 schreibt je Legacy-Asset genau eine Zeile mit dem ANLEGENDEN Lauf, ist wiederholbar und erfindet nichts", async () => {
            const migration = await readFile(MIGRATION_FILE, "utf8");
            const backfill = /-- BACKFILL-BEGIN[^\n]*\n([\s\S]*?)\n-- BACKFILL-END/.exec(migration)?.[1];
            expect(backfill, "die Übernahme steht zwischen den Marken in 0086").toBeDefined();
            await rolledBack(async (tx) => {
                const runs = await tx<{ id: string; ref: string }[]>`
                    INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version, started_at)
                    VALUES (gen_random_uuid(), 'media', 'avesmaps-legacy', 'mamtest-1', 'test', '2026-10-05T10:00:00Z'),
                           (gen_random_uuid(), 'media', 'avesmaps-legacy', 'mamtest-2', 'test', '2026-10-06T10:00:00Z')
                    RETURNING id, source_ref AS ref`;
                const created = runs.find((row) => row.ref === "mamtest-1")?.id as string;
                const latest = runs.find((row) => row.ref === "mamtest-2")?.id as string;
                const asset = async (ref: string, system: string, run: string | null, importedAt: string | null) => {
                    const [row] = await tx<{ id: string }[]>`
                        INSERT INTO media_asset (media_kind, origin, source_system, source_ref, migration_run_id, imported_at,
                                                 ingest_actor_legacy, legacy_uploaded_at, stamp_semantics)
                        VALUES ('image', 'legacy_import', ${system}, ${ref}, ${run}, ${importedAt},
                                ${ref === "mamtest:x" ? "thomas" : null}, ${ref === "mamtest:x" ? "2026-09-02T10:00:00Z" : null},
                                ${ref === "mamtest:x" ? "last_classification" : null})
                        RETURNING id`;
                    return row?.id as string;
                };
                // X: angelegt im ersten Lauf, zuletzt geschrieben im zweiten. Y: kein Lauf mit seinem Beginn, also der letzte am Asset.
                // Z: ohne Lauf (kein Import). W: anderes Quellsystem.
                const x = await asset("mamtest:x", "avesmaps-legacy", latest, "2026-10-05T10:00:00Z");
                const y = await asset("mamtest:y", "avesmaps-legacy", latest, "2026-10-07T10:00:00Z");
                const z = await asset("mamtest:z", "avesmaps-legacy", null, null);
                const w = await asset("mamtest:w", FIXTURE_SOURCE, latest, "2026-10-05T10:00:00Z");
                await tx.unsafe(backfill as string);
                await tx.unsafe(backfill as string);
                const rows = await tx<
                    {
                        asset: string;
                        kind: string;
                        run: string;
                        label: string | null;
                        semantics: string | null;
                        person: string | null;
                        at: Date;
                    }[]
                >`
                    SELECT media_asset_id::text AS asset, ingest_kind AS kind, migration_run_id::text AS run, legacy_actor_label AS label,
                           legacy_stamp_semantics AS semantics, actor_person_id::text AS person, ingested_at AS at
                    FROM media_ingest WHERE media_asset_id IN (${x}, ${y}, ${z}, ${w}) ORDER BY media_asset_id`;
                expect(rows.map((row) => row.asset)).toEqual([x, y]);
                expect(rows[0]).toMatchObject({
                    kind: "legacy_import",
                    run: created,
                    label: "thomas",
                    semantics: "last_classification",
                    person: null,
                });
                expect(rows[0]?.at.toISOString()).toBe("2026-10-05T10:00:00.000Z");
                expect(rows[1]).toMatchObject({
                    kind: "legacy_import",
                    run: latest,
                    label: null,
                    semantics: null,
                    person: null,
                });
            });
        });
    });

    describe("Operation und Fachprotokoll (ADR-0019)", () => {
        it("🔴 höchstens einmal: dieselbe Kennung scheitert ein zweites Mal am Primärschlüssel, auch gleichzeitig; die erste Quittung bleibt", async () => {
            const body = { operationId: operationId(1), baseRevision: 3, title: "Gareth" };
            const first = await database.reserve();
            const second = await database.reserve();
            let firstReceipt: unknown;
            try {
                await first`BEGIN`;
                firstReceipt = (await insertOperation(first, 1, body)).receipt;
                const racing = insertOperation(second, 1, body, { actor_person_id: BRIN }).then(
                    () => "ok",
                    (error: unknown) => error as { code?: string; constraint_name?: string },
                );
                await new Promise((resolve) => setTimeout(resolve, 150));
                await first`COMMIT`;
                expect(await racing).toMatchObject({ code: UNIQUE, constraint_name: "media_operation_pkey" });
            } finally {
                first.release();
                second.release();
            }
            const [stored] = await database<{ receipt: unknown; person: string }[]>`
                SELECT receipt, actor_person_id::text AS person FROM media_operation WHERE operation_id = ${operationId(1)}`;
            expect(stored).toEqual({ receipt: firstReceipt, person: ALRIK });
        });

        it("Wiederholung erkennen: gleicher Inhalt ergibt den gespeicherten Hash und dieselbe Quittung, anderer Inhalt nicht (409)", async () => {
            const body = { operationId: operationId(2), baseRevision: 3, title: "Gareth" };
            const { receipt } = await insertOperation(database, 2, body);
            const [stored] = await database<{ request_hash: Buffer; receipt: unknown }[]>`
                SELECT request_hash, receipt FROM media_operation WHERE operation_id = ${operationId(2)}`;
            // Dieselbe Anfrage, Schlüssel in anderer Reihenfolge: derselbe Hash, also die gespeicherte Quittung (`replayed`).
            expect(
                stored?.request_hash.equals(
                    requestHash({ title: "Gareth", baseRevision: 3, operationId: operationId(2) }),
                ),
            ).toBe(true);
            expect(stored?.receipt).toEqual(receipt);
            // Dieselbe Kennung mit anderem Inhalt: ein anderer Hash, also 409 `idempotency_key_reused`.
            expect(stored?.request_hash.equals(requestHash({ ...body, title: "Gareth (Stadt)" }))).toBe(false);
        });

        it("die Quittung gehört zur Kennung und ist die angewandte, der Hash ist SHA-256, eine Person nur bei actor_kind person", async () => {
            const body = { probe: true };
            const cases: [Record<string, unknown>, string][] = [
                [{ request_hash: Buffer.alloc(16) }, "media_operation_hash_sha256"],
                [
                    {
                        receipt: {
                            operationId: operationId(4),
                            status: "applied",
                            environment: "test",
                            affected: [],
                            derivedWork: [],
                            warnings: [],
                        },
                    },
                    "media_operation_receipt_applied",
                ],
                [
                    {
                        receipt: {
                            operationId: operationId(3),
                            status: "replayed",
                            environment: "test",
                            affected: [],
                            derivedWork: [],
                            warnings: [],
                        },
                    },
                    "media_operation_receipt_applied",
                ],
                [{ actor_person_id: null }, "media_operation_person_iff_person"],
                [{ actor_kind: "cli" }, "media_operation_person_iff_person"],
                [{ actor_kind: "robot", actor_person_id: null }, "media_operation_actor_kind_known"],
                [{ environment: "stage" }, "media_operation_environment_known"],
                [{ action: "Probe" }, "media_operation_action_format"],
            ];
            for (const [overrides, constraint] of cases) {
                expect(await violation(insertOperation(database, 3, body, overrides)), constraint).toEqual({
                    code: CHECK,
                    constraint,
                });
            }
            await insertOperation(database, 3, body, {
                actor_kind: "cli",
                actor_person_id: null,
                actor_label: "media-cli",
            });
        });

        it("🔴 Fachprotokoll: nur zu einer gespeicherten Operation, mit typisiertem Ziel; es überlebt das Löschen seines Assets", async () => {
            const asset = await insertAsset(database, { ref: "audit:a", published: [] });
            const audit = (row: Record<string, unknown>) => database`INSERT INTO media_audit_event ${database(row)}`;
            expect(
                await violation(
                    audit({
                        operation_id: operationId(9),
                        action: "asset.title_changed",
                        media_asset_public_id: asset.publicId,
                    }),
                ),
            ).toEqual({ code: FOREIGN_KEY, constraint: "media_audit_event_operation_id_fkey" });
            await insertOperation(database, 5, { probe: 5 });
            expect(await violation(audit({ operation_id: operationId(5), action: "asset.title_changed" }))).toEqual({
                code: CHECK,
                constraint: "media_audit_event_has_target",
            });
            expect(
                (
                    await violation(
                        audit({
                            operation_id: operationId(5),
                            action: "asset.title_changed",
                            media_asset_public_id: asset.publicId,
                            details: database.json(["kein", "Objekt"]),
                        }),
                    )
                ).constraint,
            ).toBe("media_audit_event_details_object");
            await audit({
                operation_id: operationId(5),
                action: "asset.title_changed",
                media_asset_public_id: asset.publicId,
                target_revision: 2,
                details: database.json({ from: null, to: "Wappen von Gareth" }),
            });
            // Endgültig gelöscht (später `delete_media`): das Protokoll bleibt und hält das Löschen nicht auf.
            await database`DELETE FROM media_rights WHERE media_asset_id = ${asset.id}`;
            await database`DELETE FROM media_asset WHERE id = ${asset.id}`;
            const [kept] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_audit_event WHERE media_asset_public_id = ${asset.publicId}`;
            expect(kept?.n).toBe(1);
        });

        it("Operation, Protokoll und Änderung stehen in EINER Transaktion: scheitert die Änderung, bleibt nichts", async () => {
            const asset = await insertAsset(database, { ref: "audit:b" });
            await expect(
                database.begin(async (tx) => {
                    await insertOperation(tx, 6, { probe: 6 });
                    await tx`INSERT INTO media_audit_event (operation_id, action, media_asset_public_id) VALUES (${operationId(6)}, 'asset.title_changed', ${asset.publicId})`;
                    await tx`UPDATE media_asset SET title = '   ' WHERE id = ${asset.id}`;
                }),
            ).rejects.toMatchObject({ code: CHECK, constraint_name: "media_asset_title_not_blank" });
            const [left] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_operation WHERE operation_id = ${operationId(6)}`;
            expect(left?.n).toBe(0);
        });
    });

    describe("Einzelbild-Notaus (suspend_media_publication): er gilt dem Bild, nicht der Stelle", () => {
        const suspend = (row: Record<string, unknown>) =>
            database<{ id: string }[]>`INSERT INTO media_publication_suspension ${database(row)} RETURNING id`;

        /** Das Original eines Assets (`private_source`), wie der Binärimport es ablegt. */
        async function insertSource(assetId: string, sha256: string): Promise<void> {
            await database`
                INSERT INTO media_file (media_asset_id, variant, storage_class, storage_key, mime_type, width, height, byte_size, sha256)
                VALUES (${assetId}, 'source', 'private_source', ${storageKey("private_source", sha256, "png")}, 'image/png', 64, 48,
                        2048, ${sha256})`;
        }

        /** Zwei Assets mit denselben Bytes (Legacy legte je Verwendung ein Werk an) und eines mit anderen. */
        async function sharedBytes(prefix: string) {
            const bytes = sha(`${prefix}/original`);
            const first = await insertAsset(database, {
                ref: `${prefix}:a`,
                published: [{ variant: "coat", sha: sha(`${prefix}/p`) }],
            });
            const second = await insertAsset(database, {
                ref: `${prefix}:b`,
                published: [{ variant: "coat", sha: sha(`${prefix}/p`) }],
            });
            const other = await insertAsset(database, {
                ref: `${prefix}:c`,
                published: [{ variant: "coat", sha: sha(`${prefix}/q`) }],
            });
            await insertSource(first.id, bytes);
            await insertSource(second.id, bytes);
            await insertSource(other.id, sha(`${prefix}/anderes`));
            return { bytes, first, second, other, published: sha(`${prefix}/p`) };
        }

        it("🔴 der Grund ist Pflicht, die Person immer, und die Bytes sind die des Originals am auslösenden Asset", async () => {
            const { bytes, first, other, published } = await sharedBytes("stop:a");
            const base = { source_sha256: bytes, media_asset_id: first.id, suspended_by_person: ALRIK };
            expect(await violation(suspend({ ...base, reason: "  " }))).toEqual({
                code: CHECK,
                constraint: "media_publication_suspension_reason_not_blank",
            });
            expect(
                (await violation(suspend({ source_sha256: bytes, media_asset_id: first.id, reason: "Abmahnung" })))
                    .code,
            ).toBe(NOT_NULL);
            expect(
                (
                    await violation(
                        suspend({ source_sha256: bytes, media_asset_id: first.id, suspended_by_person: ALRIK }),
                    )
                ).code,
            ).toBe(NOT_NULL);
            // Ein fremder Hash, die veröffentlichte Datei statt des Originals, die Bytes eines anderen Assets: nie.
            for (const wrong of [sha("stop:a/geraten"), published]) {
                expect(await violation(suspend({ ...base, reason: "Abmahnung", source_sha256: wrong }))).toEqual({
                    code: CHECK,
                    constraint: "media_publication_suspension_bytes_of_asset",
                });
            }
            expect(
                (await violation(suspend({ ...base, reason: "Abmahnung", media_asset_id: other.id }))).constraint,
            ).toBe("media_publication_suspension_bytes_of_asset");
            await suspend({ ...base, reason: "Abmahnung" });
        });

        it("🔴 höchstens ein aktiver Notaus je Bild, auch von einem anderen Asset mit denselben Bytes aus; nach dem Aufheben ein neuer", async () => {
            const { bytes, first, second, other } = await sharedBytes("stop:b");
            const [active] = await suspend({
                source_sha256: bytes,
                media_asset_id: first.id,
                reason: "Abmahnung",
                suspended_by_person: ALRIK,
            });
            expect(
                await violation(
                    suspend({
                        source_sha256: bytes,
                        media_asset_id: second.id,
                        reason: "noch einmal",
                        suspended_by_person: BRIN,
                    }),
                ),
            ).toEqual({ code: UNIQUE, constraint: "media_publication_suspension_one_active" });
            await suspend({
                source_sha256: sha("stop:b/anderes"),
                media_asset_id: other.id,
                reason: "anderes Bild",
                suspended_by_person: BRIN,
            });
            await database`
                UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${BRIN}, lift_reason = 'Rechte geklärt'
                WHERE id = ${active?.id ?? ""}`;
            expect(await revisionOf("media_publication_suspension", active?.id ?? "")).toBe(2);
            await suspend({
                source_sha256: bytes,
                media_asset_id: second.id,
                reason: "erneute Beschwerde",
                suspended_by_person: ALRIK,
            });
            const [history] = await database<{ n: number; open: number }[]>`
                SELECT count(*)::int AS n, count(*) FILTER (WHERE lifted_at IS NULL)::int AS open
                FROM media_publication_suspension WHERE source_sha256 = ${bytes}`;
            expect(history).toEqual({ n: 2, open: 1 });
        });

        it("🔴 ein Medienlauf erkennt je Datei, ob sie ausgeblendet ist, und welche Assets die Bytes teilen; alles über Indizes, und kein Neuschreiben der Dateizeilen hebt den Notaus auf", async () => {
            const { bytes, first, second, published } = await sharedBytes("stop:c");
            await suspend({
                source_sha256: bytes,
                media_asset_id: first.id,
                reason: "Abmahnung",
                suspended_by_person: ALRIK,
            });
            // Die Zuordnung „welche Assets und veröffentlichten Dateien hängen an diesem Bild“: beide Assets mit denselben Bytes.
            const affected = `
                SELECT src.media_asset_id::text AS asset, pub.storage_key AS key
                FROM media_publication_suspension s
                JOIN media_file src ON src.sha256 = s.source_sha256 AND src.storage_class = 'private_source'
                JOIN media_file pub ON pub.media_asset_id = src.media_asset_id AND pub.storage_class = 'published'
                WHERE s.source_sha256 = $1 AND s.lifted_at IS NULL`;
            const rows = await database.unsafe<{ asset: string; key: string }[]>(affected, [bytes]);
            expect(rows.map((row) => row.asset).sort()).toEqual([first.id, second.id].sort());
            expect(new Set(rows.map((row) => row.key))).toEqual(new Set([storageKey("published", published, "webp")]));
            // Die Frage des Medienlaufs je veröffentlichter Datei (Hash oder Speicherschlüssel).
            const isSuspended = `
                SELECT EXISTS (
                    SELECT 1 FROM media_file pub
                    JOIN media_file src ON src.media_asset_id = pub.media_asset_id AND src.storage_class = 'private_source'
                    JOIN media_publication_suspension s ON s.source_sha256 = src.sha256 AND s.lifted_at IS NULL
                    WHERE pub.sha256 = $1) AS suspended`;
            const ask = async (hash: string) =>
                (await database.unsafe<{ suspended: boolean }[]>(isSuspended, [hash]))[0]?.suspended;
            expect(await ask(published)).toBe(true);
            expect(await ask(sha("stop:c/q"))).toBe(false);

            // Ein Medienlauf rendert neu: Dateizeilen weg und wieder da. Der Notaus hängt an den Bytes und bleibt.
            await database`DELETE FROM media_file WHERE media_asset_id = ${second.id} AND storage_class = 'published'`;
            await insertPublishedFile(database, second.id, "stop:c", { variant: "coat", sha: published });
            expect(await ask(published)).toBe(true);
            const [open] = await database<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_publication_suspension WHERE source_sha256 = ${bytes} AND lifted_at IS NULL`;
            expect(open?.n).toBe(1);

            // Ohne Volltabellenlauf: Mit abgeschaltetem Seq Scan bleibt er nur dort, wo kein Index den Weg trägt.
            await rolledBack(async (tx) => {
                await tx`SET LOCAL enable_seqscan = off`;
                for (const [label, sql] of [
                    ["betroffene Assets", affected.replace("$1", `'${bytes}'`)],
                    ["Datei ausgeblendet?", isSuspended.replace("$1", `'${published}'`)],
                    [
                        "Original ausgeblendet?",
                        `SELECT 1 FROM media_publication_suspension WHERE source_sha256 = '${bytes}' AND lifted_at IS NULL`,
                    ],
                ] as const) {
                    const plan = (await tx.unsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN ${sql}`))
                        .map((row) => row["QUERY PLAN"])
                        .join("\n");
                    expect(plan, `${label}\n${plan}`).not.toMatch(
                        /Seq Scan on (media_file|media_publication_suspension)/,
                    );
                }
            });
        });

        it("🔴 Aufheben braucht Person und Zeit; Bild, Asset, Grund und Person ändern sich nie; danach folgt nur noch file_state den Dateien", async () => {
            const { bytes, first, second } = await sharedBytes("stop:d");
            const [row] = await suspend({
                source_sha256: bytes,
                media_asset_id: first.id,
                reason: "Abmahnung",
                suspended_by_person: ALRIK,
            });
            const id = row?.id ?? "";
            const update = (sql: string, params: unknown[] = []) =>
                database.unsafe(`UPDATE media_publication_suspension SET ${sql} WHERE id = $1`, [
                    id,
                    ...params,
                ] as never[]);
            expect((await violation(update("lifted_at = now()"))).constraint).toBe(
                "media_publication_suspension_lift_has_person",
            );
            expect((await violation(update("lift_reason = 'vorab'"))).constraint).toBe(
                "media_publication_suspension_lift_reason_needs_lift",
            );
            expect(
                (await violation(update("lifted_at = suspended_at - interval '1 hour', lifted_by_person = $2", [BRIN])))
                    .constraint,
            ).toBe("media_publication_suspension_lift_after_suspend");
            for (const [sql, params] of [
                ["reason = 'anders begründet'", []],
                ["suspended_by_person = $2", [BRIN]],
                ["media_asset_id = $2", [second.id]],
                ["source_sha256 = $2", [sha("stop:d/anderes")]],
            ] as const) {
                expect(await violation(update(sql, [...params])), sql).toEqual({
                    code: CHECK,
                    constraint: "media_publication_suspension_fixed",
                });
            }
            // Der Stand der Dateien zählt nicht als Entscheidung: keine Revision, kein Konflikt mit dem, der aufhebt.
            expect((await violation(update("file_state = 'restored'"))).constraint).toBe(
                "media_publication_suspension_file_state_fits",
            );
            await update("file_state = 'quarantined'");
            expect(await revisionOf("media_publication_suspension", id)).toBe(1);
            expect((await violation(update("lifted_at = now(), lifted_by_person = $2", [BRIN]))).constraint).toBe(
                "media_publication_suspension_file_state_fits",
            );
            await update("lifted_at = now(), lifted_by_person = $2, file_state = 'pending'", [BRIN]);
            expect(await revisionOf("media_publication_suspension", id)).toBe(2);
            expect(await violation(update("lift_reason = 'nachgetragen'"))).toEqual({
                code: CHECK,
                constraint: "media_publication_suspension_lifted_is_final",
            });
            // Der Job, der zurückschiebt, darf später kommen.
            await update("file_state = 'restored'");
            expect((await violation(update("file_state = 'quarantined'"))).constraint).toBe(
                "media_publication_suspension_file_state_fits",
            );
        });
    });
});
