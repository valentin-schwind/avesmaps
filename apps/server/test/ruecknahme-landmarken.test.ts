import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    EDITOR_PEAKS_URL,
    editorPeakRestoreSeriesPreviewUrl,
    editorPeakRestoreSeriesUrl,
    editorPeakUrl,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { INPUT_INDEX_VERSION, peakIndex } from "../src/terrain/domain/input-index.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Landmarken zurücknehmen (WI-0271 L3; Editor-Orchestrierung 2026-10-31): Art und Merkmale gehen über den EINEN Adapter des Gipfels zurück
 * (`ruecknahme-gipfel.ts` → `ruecknahme-flaeche.ts`), durch Fastify als App-Rolle im Wegwerf-Cluster. 🔴 R5: Zeilen einer neuen Art gibt es nur in diesem Cluster.
 *
 * Problemfälle: Ein Artwechsel wird als „zurückgenommen“ quittiert, die Art bleibt aber stehen; Berggipfel → Höhle und zurück rechnet das Gelände mehrfach oder gar nicht; ein
 * Wechsel zwischen zwei Arten ohne Gelände rechnet es; die Höhe, die dem Wiki folgte, kommt als eigene zurück; ein Gipfelfeld, das der Adapter nicht kennt, wird still übergangen.
 */

const ENV = "rueckland";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const BERG = "b6c00271-0000-4000-8000-000000000001";

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Landmarken zurücknehmen (WI-0271 L3, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna = { id: "", cookie: "" };
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const kopf = () => ({ cookie: anna.cookie, origin: TEST_ORIGIN });
    const ok = async (antwort: Promise<Antwort>): Promise<string> => {
        const a = await antwort;
        expect(a.statusCode, a.body).toBe(200);
        return (a.json() as { operationId: string }).operationId;
    };
    const aendere = async (id: string, changes: Record<string, unknown>): Promise<string> => {
        const [zeile] = await cluster.admin<{ r: number }[]>`
            SELECT revision::int AS r FROM terrain_peak WHERE public_id = ${id}::uuid`;
        return ok(
            app.inject({
                method: "PATCH",
                url: editorPeakUrl(id),
                headers: kopf(),
                payload: { operationId: randomUUID(), baseRevision: zeile!.r, changes },
            }),
        );
    };
    const vorschau = async (id: string, members: string[]): Promise<RuecknahmePruefung> =>
        (
            await app.inject({
                method: "POST",
                url: editorPeakRestoreSeriesPreviewUrl(id),
                headers: kopf(),
                payload: { members, membersHash: mitgliederHash(members) },
            })
        ).json() as RuecknahmePruefung;
    const zuruecknehmen = (id: string, members: string[]): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesUrl(id),
            headers: kopf(),
            payload: { operationId: randomUUID(), members, membersHash: mitgliederHash(members) },
        });
    const landmarke = async (id: string) =>
        (
            await cluster.admin<
                {
                    art: string;
                    merkmale: string[];
                    height: number | null;
                    name: string;
                    is_active: boolean;
                    origin: string | null;
                }[]
            >`
                SELECT t.subtype AS art, t.merkmale, t.height_schritt AS height, t.name, t.is_active,
                       (SELECT o.origin FROM field_origin o WHERE o.object_kind = 'peak' AND o.object_id = t.public_id AND o.field = 'height') AS origin
                  FROM terrain_peak t WHERE t.public_id = ${id}::uuid`
        )[0]!;
    /** Die Geländeketten, die warten: je Art die Zahl der Aufträge. */
    const ketten = async (): Promise<Record<string, number>> =>
        Object.fromEntries(
            (
                await cluster.admin<{ kind: string; n: number }[]>`
                    SELECT kind, count(*)::int AS n FROM job WHERE kind IN ('terrain_local', 'dem_publish') GROUP BY kind`
            ).map((zeile) => [zeile.kind, zeile.n]),
        );
    /** Der geltende Master trägt den heutigen Stand: als wäre die letzte Kette gelaufen. */
    const masterNachziehen = async (): Promise<void> => {
        const m = cluster.migrator;
        await m`
            UPDATE terrain_domain_raster SET input_index = ${m.json({ v: INPUT_INDEX_VERSION, objects: await peakIndex(m, DOMAIN) })}
             WHERE fingerprint = 'master-0271r'`;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        await m`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${BERG}::uuid, ${DOMAIN}, 'Wikizinne', 'berggipfel', ST_SetSRID(ST_MakePoint(530, 515), 0), 3200)
        `;
        await m`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('peak', ${BERG}::uuid, 'height', 'wiki')`;
        await m`
            INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, input_index)
            VALUES (${DOMAIN}, 'master-0271r', 'eingaben-0271r', '19', 4096, decode(repeat('0000', 4096 * 4096), 'hex'), '{}',
                    ${m.json({ v: INPUT_INDEX_VERSION, objects: await peakIndex(m, DOMAIN) })})
        `;
        await m`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
            VALUES ('a0271b000001', ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, 1, true, 'master-0271r')
        `;
        const fixture = authFixture(cluster.admin);
        const p = await fixture.person("admin", { name: "Anna" });
        anna = { id: p.id, cookie: (await fixture.session(p.id, { passkeyMinutesAgo: 1 })).cookie };
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 300_000);
    beforeEach(async () => {
        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
    });
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 Berggipfel → Höhle und zurück: Art und Höhe kommen zurück (die Höhe folgt weiter dem Wiki), mit genau EINER Geländekette", async () => {
        const vorher = await landmarke(BERG);
        const wechsel = await aendere(BERG, { subtype: "hoehle" });
        expect(await landmarke(BERG)).toMatchObject({ art: "hoehle", height: null, origin: "wiki" });
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });
        // Die Kette des Wechsels ist gelaufen: Der Master kennt den Berg nicht mehr.
        await masterNachziehen();
        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;

        const pruefung = await vorschau(BERG, [wechsel]);
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [wechsel], folgen: { gelaende: "lokal" } });
        const antwort = await zuruecknehmen(BERG, [wechsel]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await landmarke(BERG)).toEqual(vorher);
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });
    });

    it("🔴 ein Wechsel zwischen zwei Arten ohne Gelände geht samt Merkmalen zurück, ohne Geländekette", async () => {
        const angelegt = await app.inject({
            method: "POST",
            url: EDITOR_PEAKS_URL,
            headers: kopf(),
            payload: { operationId: randomUUID(), position: [540, 520], subtype: "hoehle", merkmale: ["heilig"] },
        });
        expect(angelegt.statusCode, angelegt.body).toBe(200);
        const id = (angelegt.json() as { publicId: string }).publicId;
        const vorher = await landmarke(id);
        expect(vorher).toMatchObject({ art: "hoehle", merkmale: ["heilig"], height: null });

        const wechsel = await aendere(id, { subtype: "schlucht", merkmale: ["magisch", "gefaehrlich"] });
        expect(await landmarke(id)).toMatchObject({ art: "schlucht", merkmale: ["magisch", "gefaehrlich"] });
        expect((await vorschau(id, [wechsel])).folgen).toMatchObject({ gelaende: "keines" });
        const antwort = await zuruecknehmen(id, [wechsel]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await landmarke(id)).toEqual(vorher);
        expect(await ketten()).toEqual({});
    });

    it("🔴 ein Gipfelfeld, das der Adapter nicht kennt: `not_revertable` (Grund `art`), nichts geändert", async () => {
        const operationId = await aendere(BERG, { name: "Neue Zinne" });
        // Ein Feld eines späteren Releases (die App darf das Protokoll nicht ändern, darum der Verwalter).
        await cluster.admin`
            UPDATE map_audit_event SET changes = changes || '{"ausdehnung": {"before": null, "after": "LINESTRING(0 0, 1 1)"}}'::jsonb
             WHERE operation_id = ${operationId}::uuid`;
        const vorher = await landmarke(BERG);
        const antwort = await zuruecknehmen(BERG, [operationId]);
        expect([antwort.statusCode, antwort.json().error.code, antwort.json().error.details.reason]).toEqual([
            400,
            "not_revertable",
            "art",
        ]);
        expect(await landmarke(BERG)).toEqual(vorher);
    });

    // --- WI-0265 B8c: Setzen ---------------------------------------------------------------------------------------------------

    /** „Gipfel setzen“ und „Landmarke setzen“ über die echte Route. */
    const setze = async (position: [number, number], extra: Record<string, unknown> = {}) => {
        const antwort = await app.inject({
            method: "POST",
            url: EDITOR_PEAKS_URL,
            headers: kopf(),
            payload: { operationId: randomUUID(), position, ...extra },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const q = antwort.json() as { operationId: string; publicId: string };
        return { operationId: q.operationId, id: q.publicId };
    };
    const loescheAuftraege = async (): Promise<void> => {
        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
    };

    it("🔴 B8c: Einen Berggipfel setzen und zurücknehmen löst beim Stilllegen und beim Beleben je genau EINE Geländekette aus (wie das Setzen selbst)", async () => {
        const gesetzt = await setze([545, 525]);
        expect(await landmarke(gesetzt.id)).toMatchObject({ art: "berggipfel", is_active: true });
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });
        // Die Kette des Setzens ist gelaufen: Der Master kennt den Berg.
        await masterNachziehen();
        await loescheAuftraege();

        const pruefung = await vorschau(gesetzt.id, [gesetzt.operationId]);
        expect(pruefung).toMatchObject({ ergebnis: "ok", folgen: { gegenstaende: 1, gelaende: "lokal" } });
        const antwort = await zuruecknehmen(gesetzt.id, [gesetzt.operationId]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await landmarke(gesetzt.id)).toMatchObject({ is_active: false });
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });

        // Die Rücknahme der Rücknahme belebt den Berg: wieder genau eine Kette.
        await masterNachziehen();
        await loescheAuftraege();
        const wieder = await zuruecknehmen(gesetzt.id, [(antwort.json() as { operationId: string }).operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await landmarke(gesetzt.id)).toMatchObject({ is_active: true });
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });
    });

    it("🔴 B8c: Einen Gipfel setzen und die Höhe ändern geht als Serie zurück: EINE Kette für beide Schritte", async () => {
        const gesetzt = await setze([546, 526]);
        const hoehe = await aendere(gesetzt.id, { height: 3000 });
        await masterNachziehen();
        await loescheAuftraege();

        const mitglieder = [gesetzt.operationId, hoehe];
        expect(await vorschau(gesetzt.id, mitglieder)).toMatchObject({ ergebnis: "ok", offen: mitglieder });
        const antwort = await zuruecknehmen(gesetzt.id, mitglieder);
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Still gelegt, die Höhe danach bleibt (sie war nie ein Ziel); ein Lauf für beide.
        expect(await landmarke(gesetzt.id)).toMatchObject({ is_active: false, height: 3000 });
        expect(await ketten()).toEqual({ terrain_local: 1, dem_publish: 1 });
    });

    it("🔴 B8c: Eine Landmarke ohne Geländewirkung setzen und zurücknehmen: keine Geländekette, auch nicht beim Beleben; die Vorschau sagt `keines`", async () => {
        const gesetzt = await setze([547, 527], { subtype: "hoehle", merkmale: ["heilig"] });
        expect(await landmarke(gesetzt.id)).toMatchObject({ art: "hoehle", merkmale: ["heilig"], is_active: true });
        expect(await ketten()).toEqual({});

        const pruefung = await vorschau(gesetzt.id, [gesetzt.operationId]);
        expect(pruefung).toMatchObject({ ergebnis: "ok", folgen: { gelaende: "keines" } });
        const antwort = await zuruecknehmen(gesetzt.id, [gesetzt.operationId]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await landmarke(gesetzt.id)).toMatchObject({ is_active: false, art: "hoehle", merkmale: ["heilig"] });
        expect(await ketten()).toEqual({});

        const wieder = await zuruecknehmen(gesetzt.id, [(antwort.json() as { operationId: string }).operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await landmarke(gesetzt.id)).toMatchObject({ is_active: true });
        expect(await ketten()).toEqual({});
    });
});
