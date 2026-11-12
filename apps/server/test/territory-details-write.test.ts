import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TerritoryDetailChanges } from "@avesmaps3d/shared";
import { createDatabase, type Database } from "../src/database.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { readEditorTerritory } from "../src/editor/territories.ts";
import { retireTerritory } from "../src/editor/territory-retire.ts";
import { updateTerritory } from "../src/editor/territory-update.ts";
import type { LegacyTerritoryPayload } from "../src/migration/territories.ts";
import { importTerritories } from "../src/migration/territory-import.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die 17 Detailfelder schreiben (WI-0209 G6; Wiki-Feld WI-0225, Modell c; `territory-details-write.ts`), so wie auf dem VPS: Wegwerf-
 * Cluster mit allen Rechtevorlagen, geschrieben als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die geteilte Testdatenbank.
 *
 * Problemfälle: ein eigener Wert bekommt die Herkunft wiki oder keine; ↺ nimmt nicht den Wert des Schnappschusses oder setzt die Herkunft
 * nicht auf wiki; ein leerer eigener Wert wird NULL statt des bewussten Leerwerts; ↺ auf ein Feld mit unbekanntem Wiki-Wert schreibt
 * trotzdem; die Zeile bleibt aktiv ohne Feld (die Datenbank verweigert es) oder wird gelöscht; das Protokoll trägt die Herkunft nicht und
 * ↺ im Verlauf kann einen Wiki-Wert nicht zurückholen; die Revision des Gebiets zählt nicht; die App-Rolle darf nicht schreiben.
 */

const ENV = "gebietdetail";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `d6d6d6d6-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REICH = ID(1);
const OHNE = ID(2);

function gebiet(publicId: string, name: string, wikiKey: string | null) {
    return {
        public_id: publicId,
        name,
        short_name: "",
        type: "Reich",
        wiki_type: "",
        parent_public_id: null,
        status: "",
        color: "#b2b065",
        opacity: 0.7,
        min_zoom: null,
        max_zoom: null,
        valid_from_bf: null,
        valid_to_bf: 9999,
        valid_label: "",
        wiki_key: wikiKey,
        wiki_url: null,
        capital_place_public_id: null,
        seat_place_public_id: null,
        sort_order: 0,
        updated_at: "2026-10-18 01:00:00",
        coat_of_arms_url: "",
        coat_license_status: "",
        coat_origin: "",
    };
}

describeWithCluster(
    "Detailfelder: territory.update mit details (WI-0209 G6, Wegwerf-Cluster)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster | undefined;
        let importer: Database | undefined;
        const thomas: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

        const revision = async (publicId: string): Promise<number> => {
            const [z] = await cluster!.admin<{ revision: number }[]>`
            SELECT revision::int AS revision FROM territory WHERE public_id = ${publicId}::uuid
        `;
            return z!.revision;
        };
        const schreibe = async (publicId: string, details: TerritoryDetailChanges) =>
            updateTerritory(cluster!.app, thomas, publicId, {
                operationId: randomUUID(),
                baseRevision: await revision(publicId),
                changes: { details },
            });
        const stand = async (publicId: string) => {
            const [zeile] = await cluster!.admin<
                {
                    is_active: boolean;
                    state: string;
                    retired_origin: string | null;
                    source_system: string;
                    ruler: string | null;
                    currency: string | null;
                    language: string | null;
                    founded_text: string | null;
                    herkunft: Record<string, string> | null;
                }[]
            >`
            SELECT d.is_active, d.state, d.retired_origin, d.source_system, d.ruler, d.currency, d.language, d.founded_text,
                   (SELECT jsonb_object_agg(o.field, o.origin) FROM territory_detail_field_origin o WHERE o.territory_detail_id = d.id)
                       AS herkunft
              FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = ${publicId}::uuid
        `;
            return zeile;
        };
        const fehler = async (
            arbeit: Promise<unknown>,
        ): Promise<{ statusCode?: number; code?: string; details?: unknown }> => {
            try {
                await arbeit;
                return {};
            } catch (error) {
                return error as { statusCode?: number; code?: string; details?: unknown };
            }
        };

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
            const o = cluster.migrator.options as unknown as {
                host: string[];
                port: number[];
                user: string;
                database: string;
            };
            importer = createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 3,
            });
            await importTerritories(importer, {
                ok: true,
                map_revision: 1,
                territories_revision: "pt-fixture-gebietdetail",
                territories: [gebiet(REICH, "G6 Reich", "wiki:G6 Reich"), gebiet(OHNE, "G6 Ohne", null)],
                geometries: [],
                claims: [],
            } as unknown as LegacyTerritoryPayload);
            // Wie der Import E4: der Herrscher folgt dem Wiki, die Währung ist ein bewusster Leerwert, die Gründung ein eigener Text.
            await cluster.admin`
            INSERT INTO territory_detail (territory_id, ruler, currency, founded_text)
            SELECT id, 'Kaiser Hal', '', '1000 BF' FROM territory WHERE public_id = ${REICH}::uuid
        `;
            await cluster.admin`
            INSERT INTO territory_detail_field_origin (territory_detail_id, field, origin)
            SELECT d.id, f.field, f.origin FROM territory_detail d JOIN territory t ON t.id = d.territory_id
              CROSS JOIN (VALUES ('ruler', 'wiki'), ('currency', 'override'), ('founded_text', 'override')) AS f(field, origin)
             WHERE t.public_id = ${REICH}::uuid
        `;
            // Der Schnappschuss: Herrscher und Währung bekannt, Sprache „das Wiki kennt keinen“, die Gründung unbekannt.
            await cluster.admin`
            INSERT INTO wiki_territory_snapshot (wiki_key, ruler, currency, language) VALUES ('wiki:G6 Reich', 'Kaiser Hal', 'Dukaten', NULL)
        `;
            await cluster.admin`
            INSERT INTO wiki_territory_snapshot_unknown (snapshot_id, field)
            SELECT id, 'founded_text' FROM wiki_territory_snapshot WHERE wiki_key = 'wiki:G6 Reich'
        `;
        }, 240_000);

        afterAll(async () => {
            await importer?.end({ timeout: 5 });
            await cluster?.stop();
        }, 60_000);

        it("🔴 ein eigener Wert ist manual (override), getrimmt; das Protokoll trägt Wert und Herkunft; die Revision des Gebiets zählt", async () => {
            const vorher = await revision(REICH);
            const quittung = await schreibe(REICH, { ruler: { value: "  Kaiserin Rohaja " } });
            expect(await revision(REICH)).toBe(vorher + 1);
            expect(quittung.affected).toEqual([{ kind: "territory", id: REICH, revision: vorher + 1 }]);
            expect(await stand(REICH)).toMatchObject({
                ruler: "Kaiserin Rohaja",
                herkunft: { ruler: "override", currency: "override", founded_text: "override" },
            });
            const [eintrag] = await cluster!.admin<{ changes: unknown }[]>`
            SELECT changes FROM map_audit_event WHERE territory_public_id = ${REICH}::uuid ORDER BY id DESC LIMIT 1
        `;
            expect(eintrag!.changes).toEqual({
                ruler: { before: "Kaiser Hal", after: "Kaiserin Rohaja" },
                rulerOrigin: { before: "wiki", after: "manual" },
            });
            // Das Detail zeigt den eigenen Wert und daneben den des Wiki.
            expect((await readEditorTerritory(cluster!.app, REICH))?.details.ruler).toEqual({
                value: "Kaiserin Rohaja",
                origin: "override",
                wiki: "Kaiser Hal",
            });
        });

        it("🔴 ↺ holt den Wert aus dem Schnappschuss und setzt die Herkunft wiki; der bewusste Leerwert weicht dem Wiki-Wert", async () => {
            await schreibe(REICH, { ruler: { revert: "wiki" }, currency: { revert: "wiki" } });
            expect(await stand(REICH)).toMatchObject({
                ruler: "Kaiser Hal",
                currency: "Dukaten",
                herkunft: { ruler: "wiki", currency: "wiki", founded_text: "override" },
            });
            const [eintrag] = await cluster!.admin<{ changes: unknown }[]>`
            SELECT changes FROM map_audit_event WHERE territory_public_id = ${REICH}::uuid ORDER BY id DESC LIMIT 1
        `;
            expect(eintrag!.changes).toEqual({
                ruler: { before: "Kaiserin Rohaja", after: "Kaiser Hal" },
                rulerOrigin: { before: "manual", after: "wiki" },
                currency: { before: "", after: "Dukaten" },
                currencyOrigin: { before: "manual", after: "wiki" },
            });
            // Ein leerer eigener Wert ist der bewusste Leerwert, nicht „kein Wert“.
            await schreibe(REICH, { currency: { value: "" } });
            expect(await stand(REICH)).toMatchObject({ currency: "", herkunft: { currency: "override" } });
            // `{ value: null }` ist kein Wert und kein Vermerk (↺ im Verlauf); das Detail nennt dann den Wiki-Wert, den ↺ holen kann.
            await schreibe(REICH, { currency: { value: null } });
            const ohneWaehrung = await stand(REICH);
            expect(ohneWaehrung?.currency).toBeNull();
            expect(ohneWaehrung?.herkunft).not.toHaveProperty("currency");
            expect((await readEditorTerritory(cluster!.app, REICH))?.details.currency).toEqual({
                value: null,
                wiki: "Dukaten",
            });
        });

        it("🔴 ↺ auf einen unbekannten Wiki-Wert schreibt nichts (400); ohne Artikel ebenso", async () => {
            const vorher = await stand(REICH);
            const r = await revision(REICH);
            expect(
                await fehler(schreibe(REICH, { founded_text: { revert: "wiki" }, ruler: { value: "X" } })),
            ).toMatchObject({
                statusCode: 400,
                code: "validation_failed",
                details: { field: "founded_text", reason: "wiki_unbekannt" },
            });
            expect(await stand(REICH)).toEqual(vorher);
            expect(await revision(REICH)).toBe(r);
            expect(await fehler(schreibe(OHNE, { ruler: { revert: "wiki" } }))).toMatchObject({ statusCode: 400 });
        });

        it("🔴 kennt das Wiki keinen Wert, hat das Feld danach keinen und keinen Vermerk; ohne Feld legt sich die Zeile still, mit einem lebt sie auf", async () => {
            await schreibe(REICH, { language: { value: "Garethi" } });
            expect(await stand(REICH)).toMatchObject({ language: "Garethi", herkunft: { language: "override" } });
            await schreibe(REICH, { language: { revert: "wiki" } });
            const ohneSprache = await stand(REICH);
            expect(ohneSprache?.language).toBeNull();
            expect(ohneSprache?.herkunft).not.toHaveProperty("language");
            // Alle Felder leer machen: Die Zeile legt sich still (nie gelöscht), und ein neuer Wert holt sie zurück.
            await schreibe(REICH, { ruler: { value: "Weg" } });
            await cluster!.admin`
            UPDATE wiki_territory_snapshot SET ruler = NULL, currency = NULL WHERE wiki_key = 'wiki:G6 Reich'
        `;
            await cluster!.admin`DELETE FROM wiki_territory_snapshot_unknown`;
            await schreibe(REICH, {
                ruler: { revert: "wiki" },
                currency: { revert: "wiki" },
                founded_text: { revert: "wiki" },
            });
            expect(await stand(REICH)).toMatchObject({
                is_active: false,
                state: "retired",
                retired_origin: "editor",
                ruler: null,
                currency: null,
                founded_text: null,
                herkunft: null,
            });
            await schreibe(REICH, { ruler: { value: "Kaiser Hal" } });
            expect(await stand(REICH)).toMatchObject({
                is_active: true,
                state: "active",
                retired_origin: null,
                ruler: "Kaiser Hal",
            });
        });

        it("an einem Gebiet ohne Detailzeile legt der erste Wert sie an (eigene Herkunft); ein Konflikt nimmt alles zurück", async () => {
            expect(await stand(OHNE)).toBeUndefined();
            await schreibe(OHNE, { blazon: { value: "In Rot ein goldener Greif" } });
            const [zeile] = await cluster!.admin<{ blazon: string; source_system: string }[]>`
            SELECT d.blazon, d.source_system FROM territory_detail d JOIN territory t ON t.id = d.territory_id
             WHERE t.public_id = ${OHNE}::uuid
        `;
            expect(zeile).toEqual({ blazon: "In Rot ein goldener Greif", source_system: "avesmaps3d" });
            const r = await revision(OHNE);
            expect(
                await fehler(
                    updateTerritory(cluster!.app, thomas, OHNE, {
                        operationId: randomUUID(),
                        baseRevision: r - 1,
                        changes: { details: { blazon: { value: "Spät" } } },
                    }),
                ),
            ).toMatchObject({ statusCode: 409, code: "edit_conflict" });
            const [danach] = await cluster!.admin<{ blazon: string }[]>`
            SELECT d.blazon FROM territory_detail d JOIN territory t ON t.id = d.territory_id WHERE t.public_id = ${OHNE}::uuid
        `;
            expect(danach!.blazon).toBe("In Rot ein goldener Greif");
        });

        it("🔴 Claudios Fund (503 während der Ableitung): Hält eine andere Transaktion FOR KEY SHARE auf dem Gebiet, gehen Umbenennen und Entfernen trotzdem durch", async () => {
            const name = async (): Promise<{ name: string; is_active: boolean }> => {
                const [z] = await cluster!.admin<{ name: string; is_active: boolean }[]>`
                SELECT name, is_active FROM territory WHERE public_id = ${OHNE}::uuid
            `;
                return z!;
            };
            // Wie die Ableitung: Jede eingefügte Zeile ihrer Tafeln sperrt das Gebiet über den Fremdschlüssel mit FOR KEY SHARE, bis zum Commit.
            // Die Revision vorher lesen: Der Pool der Prüfung steckt gleich in der offenen Transaktion.
            const vorher = await revision(OHNE);
            await cluster!.admin.begin(async (ableitung) => {
                await ableitung`SELECT 1 FROM territory WHERE public_id = ${OHNE}::uuid FOR KEY SHARE`;
                const umbenannt = await updateTerritory(cluster!.app, thomas, OHNE, {
                    operationId: randomUUID(),
                    baseRevision: vorher,
                    changes: { name: "Valis Reich" },
                });
                await retireTerritory(cluster!.app, thomas, OHNE, {
                    operationId: randomUUID(),
                    baseRevision: umbenannt.affected.find((x) => x.kind === "territory")!.revision!,
                    stage: "retire",
                });
            });
            expect(await name()).toEqual({ name: "Valis Reich", is_active: false });
        });
    },
);
