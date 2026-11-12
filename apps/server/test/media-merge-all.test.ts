import { readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    MEDIA_COAT_BIND_URL,
    MEDIA_MERGE_ALL_URL,
    MEDIA_MERGE_PREVIEW_URL,
    MEDIA_UPLOAD_URL,
    mediaMergeLiftUrl,
    type MediaMergePreview,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import type { Database } from "../src/database.ts";
import {
    MERGE_ALL_SETTLE_PRIORITY,
    gruppenOperation,
    mergeAllInput,
    runMergeAll,
} from "../src/media-editor/merge-all.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { insertPlace } from "./support/media-fixture.ts";
import { bytegleichesWerk, file, operation, pngBytes, uploadForm } from "./support/media-operations-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

const describeWithCluster = postgresBin ? describe : describe.skip;
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));

/**
 * „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17): „ein einziger bewusst ausgelöster Vorgang“ über
 * alle zulässigen Gruppen, „mit nachvollziehbarem Fortschritt, Fehlerbericht und Audit“.
 *
 * - **Wer**: nur der Betreiber (`merge_media_all`, frischer Passkey); eine Redakteurin bekommt 403.
 * - **Scope**: Der Körper ist die Vorschau; weicht sie vom heutigen Stand ab, 409 `merge_preview_stale`, und nichts wird eingereiht.
 * - **Lauf**: sauber zusammengeführte Gruppen ziehen ihre Verwendungen um; eine Gruppe, deren Rechte inzwischen abweichen, bleibt
 *   stehen und steht im Bericht. Die Abgleiche kommen am Ende mit Priorität 90.
 * - **Wiederholung**: Ein zweiter Lauf desselben Auftrags findet die Quittungen und legt keine zweite Zusammenführung an.
 * - **Umkehr**: Jede Gruppe bleibt einzeln aufhebbar.
 *
 * ⭐ Auf einem Wegwerf-Cluster mit den Rollen des VPS: Fastify als App-Rolle, der Lauf als JOBS-ROLLE — so prüft der Fall die Rechte
 * aus `media-grants.psql` gleich mit, und die neue Migration 0151 erreicht nie die geteilte Testdatenbank.
 */
describeWithCluster(
    "Alle bytegleichen Duplikate zusammenführen (WI-0068, Betreiber 2026-10-17)",
    { timeout: 180_000 },
    () => {
        let cluster: VpsCluster;
        let database: Database;
        let app: FastifyInstance;
        let mediaRoot = "";
        let fixture: ReturnType<typeof authFixture>;
        let betreiber = "";
        let redakteurin = "";

        const config = (): ServerConfig => ({
            port: 0,
            host: "127.0.0.1",
            releaseId: "test",
            databaseUrl: undefined,
            tileRoot: undefined,
            mediaRoot,
            auth: TEST_AUTH,
        });
        const post = (url: string, cookie: string, payload: object) =>
            app.inject({
                method: "POST",
                url,
                payload: { operationId: operation(), ...payload },
                headers: { origin: TEST_ORIGIN, cookie },
            });
        const ladeHoch = async (seed: number, titel: string): Promise<string> => {
            const antwort = await post(MEDIA_UPLOAD_URL, redakteurin, {
                file: file(await pngBytes(seed), `${titel}.png`),
                form: uploadForm({ title: titel, role: "coat", creationMethod: "ai_generated" }),
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            return (antwort.json() as OperationReceipt).affected.find((eintrag) => eintrag.kind === "media_asset")!.id;
        };
        const bindeAnOrt = async (assetId: string, seed: number): Promise<string> => {
            const ort = (await insertPlace(database, seed)).publicId;
            const antwort = await post(MEDIA_COAT_BIND_URL, redakteurin, {
                subject: { kind: "place", id: ort },
                assetId,
                baseState: "undecided",
            });
            expect(antwort.statusCode, antwort.body).toBe(200);
            return ort;
        };
        const vorschau = async (): Promise<MediaMergePreview> => {
            const antwort = await app.inject({ url: MEDIA_MERGE_PREVIEW_URL, headers: { cookie: betreiber } });
            expect(antwort.statusCode, antwort.body).toBe(200);
            return antwort.json();
        };
        const auftragAus = (vorher: MediaMergePreview) => ({
            groups: vorher.groups
                .filter((gruppe) => !gruppe.rightsDiffer)
                .map(({ fileGroup, keepAssetId }) => ({ fileGroup, keepAssetId })),
            expected: {
                groups: vorher.totals.groups,
                members: vorher.totals.members,
                moves: vorher.totals.moves,
                retires: vorher.totals.retires,
            },
        });
        const wappenAm = async (ort: string): Promise<string | undefined> => {
            const [row] = await database<{ asset: string }[]>`
            SELECT a.public_id::text AS asset FROM place_media pm
              JOIN place p ON p.id = pm.place_id JOIN media_asset a ON a.id = pm.media_asset_id
             WHERE p.public_id = ${ort}::uuid AND pm.role = 'coat' AND pm.retired_at IS NULL
        `;
            return row?.asset;
        };
        const aufgegangen = async (): Promise<number> => {
            const [row] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM media_merge WHERE lifted_at IS NULL`;
            return row!.n;
        };

        /** Drei Gruppen: zwei saubere (a+b, e+f) und eine, deren Rechte abweichen (c+d). */
        let a = "";
        let b = "";
        let c = "";
        let d = "";
        let e = "";
        let f = "";
        let ortB = "";
        let ortF = "";

        beforeAll(async () => {
            cluster = await startVpsCluster("mergeall", VORLAGEN, { mapDomains: true });
            database = cluster.admin;
            mediaRoot = await mkdtemp(join(tmpdir(), "avesmaps3d-merge-all-"));
            fixture = authFixture(database);
            const op = await fixture.person("operator", { name: "Sammellauf Betreiberin" });
            const ed = await fixture.person("editor", { name: "Sammellauf Redakteurin" });
            betreiber = (await fixture.session(op.id, { passkeyMinutesAgo: 1 })).cookie;
            redakteurin = (await fixture.session(ed.id, { passkeyMinutesAgo: 1 })).cookie;
            await database`
            INSERT INTO publication_rule (rights_basis, creation_method, role, scope_text, operator_quote, decided_on)
            VALUES ('own_work', 'ai_generated', 'coat', 'media-test Sammellauf', 'Testzitat', '2026-10-17')
        `;
            app = buildApp({ config: config(), database: cluster.app, logStream: { write: () => undefined } });
            await app.ready();

            a = await ladeHoch(151, "Sammel A");
            b = await bytegleichesWerk(database, a, "Sammel B");
            c = await ladeHoch(152, "Sammel C");
            d = await bytegleichesWerk(database, c, "Sammel D");
            await database`
            UPDATE media_rights SET creator = 'Eine andere Urheberin'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${d}::uuid)
        `;
            e = await ladeHoch(153, "Sammel E");
            f = await bytegleichesWerk(database, e, "Sammel F");
            await bindeAnOrt(a, 151);
            ortB = await bindeAnOrt(b, 152);
            ortF = await bindeAnOrt(f, 153);
        }, 150_000);

        afterAll(async () => {
            await app?.close();
            await cluster?.stop();
            if (mediaRoot !== "") await rm(mediaRoot, { recursive: true, force: true });
        });

        it("🔴 nur der Betreiber; eine veraltete Vorschau ist 409 und reiht nichts ein", async () => {
            const auftrag = auftragAus(await vorschau());
            const alsRedakteurin = await post(MEDIA_MERGE_ALL_URL, redakteurin, auftrag);
            expect(alsRedakteurin.statusCode).toBe(403);

            const veraltet = await post(MEDIA_MERGE_ALL_URL, betreiber, {
                ...auftrag,
                expected: { ...auftrag.expected, members: auftrag.expected.members + 1 },
            });
            expect(veraltet.statusCode, veraltet.body).toBe(409);
            expect(veraltet.json()).toMatchObject({ error: { code: "merge_preview_stale" } });
            const [row] = await database<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM job WHERE kind = 'media_merge_all'`;
            expect(row!.n).toBe(0);
        });

        it("🔴 der Lauf führt die sauberen Gruppen zusammen, lässt die mit abweichenden Rechten stehen, Abgleiche am Ende mit Priorität 90", async () => {
            const vorher = await vorschau();
            const gruppeVon = (keep: string) => vorher.groups.find((gruppe) => gruppe.keepAssetId === keep);
            expect(gruppeVon(a)?.rightsDiffer).toBe(false);
            expect(gruppeVon(c)?.rightsDiffer).toBe(true);

            const antwort = await post(MEDIA_MERGE_ALL_URL, betreiber, auftragAus(vorher));
            expect(antwort.statusCode, antwort.body).toBe(200);
            const quittung = antwort.json() as OperationReceipt;
            const jobId = quittung.derivedWork.find((arbeit) => arbeit.kind === "media_merge_all")?.jobId;
            expect(jobId).toBeDefined();
            const [job] = await database<{ input_ref: Record<string, unknown>; priority: number }[]>`
            SELECT input_ref, priority::int AS priority FROM job WHERE public_id = ${jobId!}::uuid
        `;
            // Gerechnet wird nur über die Gruppen dieses Falls; die Eingabe des Auftrags nennt alle sauberen Gruppen.
            const eingabe = mergeAllInput(job!.input_ref);
            expect(eingabe.groups.map((gruppe) => gruppe.keepAssetId)).not.toContain(c);
            const meine = {
                ...eingabe,
                groups: eingabe.groups.filter((gruppe) => [a, e].includes(gruppe.keepAssetId)),
            };
            // Zwischen Vorschau und Lauf weichen die Rechte von e+f ab: Der Lauf fasst die Gruppe nicht an.
            await database`
            UPDATE media_rights SET creator = 'Eine andere Urheberin'
             WHERE media_asset_id = (SELECT id FROM media_asset WHERE public_id = ${f}::uuid)
        `;
            const fortschritt: number[] = [];
            const ergebnis = await runMergeAll(cluster.jobs, meine, {
                auftrag: jobId!,
                fortschritt: async (erledigt) => {
                    fortschritt.push(erledigt);
                },
            });
            expect(ergebnis).toMatchObject({ groups: 2, merged: 1, assets: 1, moved: 1, failed: [] });
            expect(ergebnis.skipped).toEqual([
                { fileGroup: meine.groups.find((g) => g.keepAssetId === e)!.fileGroup, reason: "rights_differ" },
            ]);
            expect(fortschritt).toEqual([1, 2]);
            expect(await wappenAm(ortB), "die Verwendung zeigt auf das bleibende Werk").toBe(a);
            expect(await wappenAm(ortF), "die übersprungene Gruppe bleibt").toBe(f);
            expect(ergebnis.settles).toBeGreaterThan(0);
            const [abgleiche] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job
             WHERE kind = 'media_settle' AND priority = ${MERGE_ALL_SETTLE_PRIORITY} AND input_ref ->> 'asset' = ${a}
        `;
            expect(abgleiche!.n).toBeGreaterThan(0);
            // Audit: die Zusammenführung steht im Fachprotokoll am aufgegangenen Werk, unter der Operation der Gruppe.
            const [protokoll] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM media_audit_event
             WHERE operation_id = ${gruppenOperation(jobId!, a)}::uuid AND action = 'asset.merged' AND media_asset_public_id = ${b}::uuid
        `;
            expect(protokoll!.n).toBe(1);

            // 🔴 Derselbe Auftrag noch einmal (Neustart): dieselben Quittungen, keine zweite Zusammenführung.
            const vorZweitem = await aufgegangen();
            const zweiter = await runMergeAll(cluster.jobs, meine, {
                auftrag: jobId!,
                fortschritt: async () => undefined,
            });
            expect(zweiter.failed).toEqual([]);
            expect(await aufgegangen()).toBe(vorZweitem);

            // Umkehrbar: die Gruppe einzeln aufheben, die Verwendung geht zurück.
            const aufheben = await post(mediaMergeLiftUrl(b), redakteurin, {});
            expect(aufheben.statusCode, aufheben.body).toBe(200);
            expect(await wappenAm(ortB)).toBe(b);
            void d;
        });
    },
);
