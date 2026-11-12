import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { REDACTED, dissolvePerson } from "../src/auth/dissolve.ts";
import { MEDIA_AUDIT_FREE_TEXT_KEYS } from "../src/media-editor/audit.ts";
import { authFixture } from "./support/auth-fixture.ts";
import { insertRule, violation } from "./support/media-fixture.ts";
import {
    PRIVATE_VALUES,
    buildMediaWorld,
    cleanMediaWorld,
    operationId,
    type MediaWorld,
} from "./support/media-editor-world.ts";

/**
 * Konto auflösen schwärzt auch in den Medien (WI-0068 P2, Migration 0088; WI-0120 A15, Betreiber 2026-10-09 „1 B“).
 *
 * Problemfall: Eine Person, die Gründe für Freigaben, Sperren, einen Notaus oder einen Widerruf schrieb und Dateien hochlud, löst
 * ihr Konto auf; ihre Texte und Dateinamen stünden sonst für immer im Fachprotokoll, das die App nur anhängen darf. Soll: ihr
 * Freitext wird "[geschwärzt]", der Hash ihrer Anfragen und der Dateiname leer; Struktur, Codes, Zeiten und alles einer anderen
 * Person bleiben; ein zweiter Lauf ändert nichts.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const MIGRATION = fileURLToPath(new URL("../migrations/0088_media_redact_person.sql", import.meta.url));

describe("Freitextschlüssel des Fachprotokolls", () => {
    it("🔴 dieselbe Liste in Migration 0088 und im Code", () => {
        const sql = readFileSync(MIGRATION, "utf8");
        const listed = /free_text CONSTANT text\[\] := ARRAY\[([^\]]*)\]/.exec(sql)?.[1];
        expect(listed?.split(",").map((entry) => entry.trim().replace(/^'|'$/g, ""))).toEqual([
            ...MEDIA_AUDIT_FREE_TEXT_KEYS,
        ]);
        expect(sql).toContain(`'${REDACTED}'`);
    });
});

describeWithDatabase("Konto auflösen: Medien (Migration 0088)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: ReturnType<typeof authFixture>;
    let world: MediaWorld;
    let leaving: { id: string; name: string };
    let staying: { id: string; name: string };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        fixture = authFixture(database);
    }, 120_000);

    beforeEach(async () => {
        await cleanMediaWorld(database);
        leaving = await fixture.person("editor", { name: "Medien Gehende" });
        staying = await fixture.person("editor", { name: "Medien Bleibende" });
        // Die Gehende entschied die Freigabe am Ort, sperrte den Galerieeintrag und setzte den Notaus; hochgeladen hat sie.
        world = await buildMediaWorld(database, { decider: leaving.id, uploader: leaving.id });
    });

    afterEach(async () => {
        await cleanMediaWorld(database);
        await fixture.cleanup();
    });

    afterAll(async () => {
        await database.end({ timeout: 5 });
    });

    async function operation(n: number, actor: string, details: Record<string, unknown>): Promise<string> {
        const id = operationId(n);
        const receipt = {
            operationId: id,
            status: "applied",
            environment: "test",
            affected: [],
            derivedWork: [],
            warnings: [],
        };
        await database`
            INSERT INTO media_operation (operation_id, request_hash, receipt, action, environment, actor_kind, actor_person_id)
            VALUES (${id}, sha256(${id}::bytea), ${database.json(receipt as never)}, 'suspension.set', 'test', 'person', ${actor})`;
        await database`
            INSERT INTO media_audit_event (operation_id, action, media_asset_public_id, target_revision, details)
            VALUES (${id}, 'suspension.set', ${world.coat.publicId}, 1, ${database.json(details as never)})`;
        return id;
    }

    async function dissolve(personId: string, name: string) {
        return database.begin((tx) =>
            dissolvePerson(tx, { personId, environment: "test", actorLabel: "cli:test", expectName: name }),
        );
    }

    it("🔴 ihr Freitext und ihre Spuren gehen, die einer anderen Person und die Struktur bleiben; ein zweiter Lauf ändert nichts", async () => {
        const own = await operation(1, leaving.id, { reason: "Mail von Rondrikan an mich", note: "privat", assets: 2 });
        const other = await operation(2, staying.id, { reason: "Grund der Bleibenden", assets: 1 });
        // Der Notaus, den die Gehende setzte, hob die Bleibende auf; einen zweiten setzte die Bleibende, den hob die Gehende auf.
        await database`
            UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = ${staying.id}, lift_reason = 'Wieder frei'
             WHERE source_sha256 = ${world.bytes}`;
        await database`
            INSERT INTO media_publication_suspension (source_sha256, media_asset_id, reason, suspended_by_person, lifted_at,
                                                      lifted_by_person, lift_reason)
            VALUES (${world.bytes}, ${world.coat.id}, 'Notaus der Bleibenden', ${staying.id}, now(), ${leaving.id}, 'Wieder frei von ihr')`;
        const rule = await insertRule(database, { basis: "own_work", role: "map_full", revokedOn: "2026-10-09" });
        await database`UPDATE publication_rule SET revoked_by_person = ${leaving.id}, revoked_reason = 'Widerruf von ihr' WHERE id = ${rule}`;
        const [before] = await database<{ revision: string }[]>`
            SELECT revision FROM place_media WHERE media_asset_id = ${world.coat.id}`;

        const result = await dissolve(leaving.id, leaving.name);
        // 1 Protokolleintrag, 1 Hash, Freigabe am Ort und Sperre in der Galerie, ihr Notausgrund, ihre Wiederfreigabe, ihr Widerruf,
        // ihr Dateiname.
        expect(result.counts.redactedMedia).toBe(8);

        const events = await database<{ operation_id: string; details: Record<string, unknown> }[]>`
            SELECT operation_id::text, details FROM media_audit_event WHERE operation_id IN (${own}, ${other})`;
        const detailsOf = (id: string) => events.find((row) => row.operation_id === id)?.details;
        expect(detailsOf(own)).toEqual({ reason: REDACTED, note: REDACTED, assets: 2 });
        expect(detailsOf(other)).toEqual({ reason: "Grund der Bleibenden", assets: 1 });
        const hashes = await database<{ operation_id: string; cleared: boolean }[]>`
            SELECT operation_id::text, request_hash IS NULL AS cleared FROM media_operation WHERE operation_id IN (${own}, ${other})
             ORDER BY operation_id`;
        expect(hashes.map((row) => row.cleared)).toEqual([true, false]);

        const [binding] = await database<
            { override_reason: string; override_operator_quote: string; revision: string }[]
        >`
            SELECT override_reason, override_operator_quote, revision FROM place_media WHERE media_asset_id = ${world.coat.id}`;
        // Das Betreiberzitat ist keine Begründung über sie; es bleibt. Die Revision zählt die Änderung.
        expect(binding).toMatchObject({
            override_reason: REDACTED,
            override_operator_quote: PRIVATE_VALUES.operatorQuote,
        });
        expect(Number(binding!.revision)).toBe(Number(before!.revision) + 1);
        const [item] = await database<{ override_reason: string }[]>`
            SELECT override_reason FROM media_gallery_item WHERE media_asset_id = ${world.coat.id}`;
        expect(item!.override_reason).toBe(REDACTED);

        const suspensions = await database<{ reason: string; lift_reason: string | null }[]>`
            SELECT reason, lift_reason FROM media_publication_suspension WHERE source_sha256 = ${world.bytes} ORDER BY id`;
        expect(suspensions).toEqual([
            { reason: REDACTED, lift_reason: "Wieder frei" },
            { reason: "Notaus der Bleibenden", lift_reason: REDACTED },
        ]);
        const [revoked] = await database<{ revoked_reason: string; operator_quote: string }[]>`
            SELECT revoked_reason, operator_quote FROM publication_rule WHERE id = ${rule}`;
        expect(revoked).toEqual({ revoked_reason: REDACTED, operator_quote: "Testzitat des Betreibers" });
        const [ingest] = await database<{ original_filename: string | null; actor: string }[]>`
            SELECT original_filename, actor_person_id::text AS actor FROM media_ingest WHERE media_asset_id = ${world.coat.id}`;
        expect(ingest).toEqual({ original_filename: null, actor: leaving.id });

        // Was sie über Medien schrieb, steht nirgends mehr; ein zweiter Lauf findet nichts.
        const everything = JSON.stringify(
            await database`
                SELECT (SELECT jsonb_agg(details) FROM media_audit_event WHERE operation_id = ${own}) AS audit,
                       (SELECT jsonb_agg(override_reason) FROM place_media WHERE media_asset_id = ${world.coat.id}) AS place,
                       (SELECT jsonb_agg(reason) FROM media_publication_suspension WHERE suspended_by_person = ${leaving.id}) AS halt`,
        );
        for (const trace of ["Rondrikan", "privat", PRIVATE_VALUES.overrideReason, PRIVATE_VALUES.suspensionReason])
            expect(everything).not.toContain(trace);
        expect((await dissolve(leaving.id, leaving.name)).counts.redactedMedia).toBe(0);
    });

    it("🔴 der Wächter des Notaus lässt nur den Übergang zur Marke zu", async () => {
        const update = (sql: string) => database.unsafe(sql, [world.bytes]);
        expect(
            await violation(
                update(`UPDATE media_publication_suspension SET reason = 'anders' WHERE source_sha256 = $1`),
            ),
        ).toEqual({ code: "23514", constraint: "media_publication_suspension_fixed" });
        await update(`UPDATE media_publication_suspension SET reason = '${REDACTED}' WHERE source_sha256 = $1`);
        // Aus der Marke wird nichts mehr.
        expect(
            await violation(
                update(`UPDATE media_publication_suspension SET reason = 'zurück' WHERE source_sha256 = $1`),
            ),
        ).toEqual({ code: "23514", constraint: "media_publication_suspension_fixed" });
        // Aufgehoben ohne Begründung: Eine Marke an ihre Stelle zu setzen, wäre eine Erfindung.
        await update(
            `UPDATE media_publication_suspension SET lifted_at = now(), lifted_by_person = gen_random_uuid() WHERE source_sha256 = $1`,
        );
        expect(
            await violation(
                update(`UPDATE media_publication_suspension SET lift_reason = '${REDACTED}' WHERE source_sha256 = $1`),
            ),
        ).toEqual({ code: "23514", constraint: "media_publication_suspension_lifted_is_final" });
    });
});
