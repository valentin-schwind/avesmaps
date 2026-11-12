import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_PEAKS_URL,
    editorLandscapesBatchRetireUrl,
    editorPeakRestoreSeriesPreviewUrl,
    editorPeakRestoreSeriesUrl,
    editorPeakRetireUrl,
    editorPeakUrl,
    inhalteTraegerQuellenUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Einen Gipfel zurücknehmen (WI-0265 B6c; Fachvertrag C.2, C.3, F.1; Testvertrag U2 bis U9): `POST /api/editor/peaks/:id/restore-series[/preview]` durch Fastify, als App-Rolle im Wegwerf-Cluster mit
 * den Rollen des VPS, die Vorwärtsoperationen über ihre echten Routen. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Eine Höhe, die dem Wiki folgte, kommt als eigene zurück (der WikiSync übernähme nichts mehr); eine Höhe, die vorher leer war, wird still auf 0 gesetzt oder lässt eine halbe Rücknahme
 * zurück; ein Gipfel, den die Mehrfachauswahl mit seiner Landschaft entfernte, kommt allein zurück; eine Fremdänderung bleibt unbemerkt; ein Doppelklick schreibt zweimal.
 */

const ENV = "ruecknahmegipfel";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b6c-gipfel";

const ID = (n: number): string => `b6c00266-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const WIKI_GIPFEL = ID(1); // Höhe folgt dem Wiki (Vermerk `wiki`)
const OHNE_VERMERK = ID(2); // Höhe ohne Vermerk (folgt dem Wiki, wo es einen Wert gibt)
const OHNE_HOEHE = ID(3); // vorher keine Höhe
const ENTFERNT = ID(4); // Stilllegen und Zurückholen
const AUSWAHL = ID(5); // von der Mehrfachauswahl samt Landschaft entfernt
const FREMD = ID(6); // Fremdänderung, Sperre, Rechte
const WALD = ID(0x100); // die Landschaft der Mehrfachauswahl
const WALD_FLAECHE = ID(0x101);
const WALD_BESCHRIFTUNG = ID(0x102);

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Gipfel zurücknehmen (WI-0265 B6c, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna = { id: "", cookie: "" };
    let bernd = { id: "", cookie: "" };
    let rita = { id: "", cookie: "" };
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const kopf = (cookie: string) => ({ cookie, origin: TEST_ORIGIN });

    const revision = async (id: string): Promise<number> =>
        (
            await cluster.admin<
                { r: number }[]
            >`SELECT revision::int AS r FROM terrain_peak WHERE public_id = ${id}::uuid`
        )[0]!.r;
    const aendere = (person: { cookie: string }, id: string, changes: Record<string, unknown>): Promise<Antwort> =>
        revision(id).then((baseRevision) =>
            app.inject({
                method: "PATCH",
                url: editorPeakUrl(id),
                headers: kopf(person.cookie),
                payload: { operationId: randomUUID(), baseRevision, changes },
            }),
        );
    const ok = async (antwort: Promise<Antwort>): Promise<string> => {
        const a = await antwort;
        expect(a.statusCode, a.body).toBe(200);
        return (a.json() as { operationId: string }).operationId;
    };
    const vorschau = (person: { cookie: string }, id: string, members: string[]) =>
        app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesPreviewUrl(id),
            headers: kopf(person.cookie),
            payload: { members, membersHash: mitgliederHash(members) },
        });
    const zuruecknehmen = (
        person: { cookie: string },
        id: string,
        members: string[],
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesUrl(id),
            headers: kopf(person.cookie),
            payload: {
                operationId: extra.operationId ?? randomUUID(),
                members,
                membersHash: mitgliederHash(members),
                ...(extra.reason === undefined ? {} : { reason: extra.reason }),
            },
        });
    const fehler = (antwort: Antwort): [number, string | undefined] => [
        antwort.statusCode,
        (antwort.json() as { error?: { code?: string } }).error?.code,
    ];
    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);
    const gipfel = async (id: string) =>
        (
            await cluster.admin<
                {
                    name: string;
                    height: number | null;
                    show_name: boolean;
                    x: number;
                    y: number;
                    is_active: boolean;
                    origin: string | null;
                }[]
            >`
                SELECT t.name, t.height_schritt AS height, t.show_name, ST_X(t.geom) AS x, ST_Y(t.geom) AS y, t.is_active,
                       (SELECT o.origin FROM field_origin o WHERE o.object_kind = 'peak' AND o.object_id = t.public_id AND o.field = 'height') AS origin
                  FROM terrain_peak t WHERE t.public_id = ${id}::uuid`
        )[0]!;
    /** Was eine gescheiterte Rücknahme nie verändern darf. */
    const stand = async (id: string) => ({
        operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        auftraege: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job`),
        gipfel: await gipfel(id),
    });
    const eintrag = async (person: { cookie: string }, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const peak = async (id: string, name: string, hoehe: number | null, x: number) => {
            await m`
                INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
                VALUES (${id}::uuid, ${DOMAIN}, ${name}, 'berggipfel', ST_SetSRID(ST_MakePoint(${x}, 515), 0), ${hoehe})
            `;
        };
        await peak(WIKI_GIPFEL, "Wikizinne", 3200, 530);
        await peak(OHNE_VERMERK, "Vermerklose Zinne", 2800, 540);
        await peak(OHNE_HOEHE, "Hoehenlose Zinne", null, 550);
        await peak(ENTFERNT, "Entfernzinne", 2000, 560);
        await peak(AUSWAHL, "Auswahlzinne", 2100, 570);
        await peak(FREMD, "Fremdzinne", 2200, 580);
        await m`INSERT INTO field_origin (object_kind, object_id, field, origin) VALUES ('peak', ${WIKI_GIPFEL}::uuid, 'height', 'wiki')`;
        await m`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${WALD}, ${DOMAIN}, 'Auswahlwald', 'vegetation', 'wald', 1, TRUE, ${SOURCE})
        `;
        await m`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${WALD_FLAECHE}::uuid, id, ${DOMAIN}, ST_GeomFromText('POLYGON((300 300, 320 300, 320 320, 300 320, 300 300))', 0), ${SOURCE}
              FROM region WHERE public_id = ${WALD}
        `;
        await m`
            INSERT INTO map_label (public_id, map_domain_id, region_id, name, subtype, geom, source_system, placement, sort_order, text_follows_name, is_active)
            SELECT ${WALD_BESCHRIFTUNG}::uuid, ${DOMAIN}, id, name, 'wald', ST_SetSRID(ST_MakePoint(305, 305), 0), ${SOURCE}, 'punkt', 0, TRUE, TRUE
              FROM region WHERE public_id = ${WALD}
        `;
        const fixture = authFixture(cluster.admin);
        const person = async (name: string, role: "admin" | "reviewer") => {
            const p = await fixture.person(role, { name });
            return { id: p.id, cookie: (await fixture.session(p.id, { passkeyMinutesAgo: 1 })).cookie };
        };
        anna = await person("Anna", "admin");
        bernd = await person("Bernd", "admin");
        rita = await person("Rita", "reviewer");
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 300_000);
    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    });

    it("🔴 Höhe, Name, Anzeige und Lage als Serie (U2, U3): EINE Operation `peak.restore_series`, zwei Verknüpfungen; die Höhe, die dem Wiki folgte, kommt mit dem Vermerk `wiki` zurück", async () => {
        const vorher = await gipfel(WIKI_GIPFEL);
        expect(vorher).toMatchObject({ height: 3200, origin: "wiki" });
        const eins = await ok(aendere(anna, WIKI_GIPFEL, { height: 3500 }));
        expect(await gipfel(WIKI_GIPFEL)).toMatchObject({ height: 3500, origin: "manual" });
        const zwei = await ok(
            aendere(anna, WIKI_GIPFEL, { name: "Neue Zinne", showName: false, position: [531, 516] }),
        );

        const pruefung = (await vorschau(anna, WIKI_GIPFEL, [eins, zwei])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false, offen: [eins, zwei] });
        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, WIKI_GIPFEL, [eins, zwei], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ operationId, status: "applied", reverts: [eins, zwei] });
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen + 1,
        );
        const [neue] = await cluster.admin<{ source: string; action: string }[]>`
            SELECT source, action FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(neue).toEqual({ source: "restore", action: "peak.restore_series" });
        // Alles wie vorher, auch der Vermerk: Die Höhe folgt dem Wiki wieder.
        expect(await gipfel(WIKI_GIPFEL)).toEqual(vorher);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action)).toEqual(["peak.updated"]);
        expect(e.objects[0]!.changes["heightOrigin"]).toEqual({ before: "manual", after: "wiki" });
        // Die Rücknahme ist selbst zurücknehmbar (der Vermerk geht mit): wieder 3500 und eigen.
        const nochmal = await zuruecknehmen(anna, WIKI_GIPFEL, [operationId]);
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(await gipfel(WIKI_GIPFEL)).toMatchObject({
            height: 3500,
            origin: "manual",
            name: "Neue Zinne",
            show_name: false,
        });
    });

    it("🔴 OPS-000088: Die Lage zurücknehmen holt das Flussende mit, das ihr gefolgt ist", async () => {
        const MARKE = "c8c8c8c8-0000-4000-8000-0000000000c1";
        const FLUSS = "c8c8c8c8-0000-4000-8000-0000000000c2";
        await cluster.migrator`
            INSERT INTO terrain_peak (public_id, map_domain_id, name, subtype, geom, height_schritt)
            VALUES (${MARKE}::uuid, ${DOMAIN}, 'Flussmarke', 'berggipfel', ST_SetSRID(ST_MakePoint(590, 515), 0), 2000)
        `;
        await cluster.migrator`
            INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
            VALUES (${FLUSS}::uuid, ${DOMAIN}, 'Markenfluss', 'Flussweg', FALSE, FALSE,
                    ST_GeomFromText('LINESTRING(590 515, 595 515, 599 517)', 0), ${SOURCE}, TRUE)
        `;
        const anfang = async (): Promise<string> =>
            (
                await cluster.admin<{ a: string }[]>`
                    SELECT ST_AsText(ST_StartPoint(geom)) AS a FROM path WHERE public_id = ${FLUSS}::uuid`
            )[0]!.a;
        const zug = await ok(aendere(anna, MARKE, { position: [591, 516] }));
        expect(await anfang()).toBe("POINT(591 516)");
        const antwort = await zuruecknehmen(anna, MARKE, [zug]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await gipfel(MARKE)).toMatchObject({ x: 590, y: 515 });
        expect(await anfang()).toBe("POINT(590 515)");
    });

    it("🔴 Eine Höhe ohne Vermerk folgt dem Wiki: Zurück bedeutet `wiki`; eine Höhe, die vorher leer war, lässt sich nicht leeren (Konflikt `gipfel_wert`, 0 Änderungen)", async () => {
        const operationId = await ok(aendere(anna, OHNE_VERMERK, { height: 2900 }));
        const antwort = await zuruecknehmen(anna, OHNE_VERMERK, [operationId]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await gipfel(OHNE_VERMERK)).toMatchObject({ height: 2800, origin: "wiki" });

        const gesetzt = await ok(aendere(anna, OHNE_HOEHE, { height: 1000 }));
        const vorher = await stand(OHNE_HOEHE);
        const pruefung = (await vorschau(anna, OHNE_HOEHE, [gesetzt])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "peak",
                id: OHNE_HOEHE,
                felder: ["height"],
                abweichung: { was: "gipfel_wert" },
            }),
        );
        expect(fehler(await zuruecknehmen(anna, OHNE_HOEHE, [gesetzt]))).toEqual([409, "edit_conflict"]);
        expect(await stand(OHNE_HOEHE)).toEqual(vorher);
    });

    it("🔴 Stilllegen und Zurückholen („Gipfel entfernen …“): zurück auf die Karte; die Rücknahme der Rücknahme nimmt ihn wieder weg, von einer fremden Person nur mit Grund", async () => {
        const entfernt = await ok(
            revision(ENTFERNT).then((baseRevision) =>
                app.inject({
                    method: "POST",
                    url: editorPeakRetireUrl(ENTFERNT),
                    headers: kopf(anna.cookie),
                    payload: { operationId: randomUUID(), baseRevision },
                }),
            ),
        );
        expect(await gipfel(ENTFERNT)).toMatchObject({ is_active: false });
        const holen = randomUUID();
        const antwort = await zuruecknehmen(anna, ENTFERNT, [entfernt], { operationId: holen });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await gipfel(ENTFERNT)).toMatchObject({ is_active: true, height: 2000, name: "Entfernzinne" });
        expect((await eintrag(anna, holen)).objects.map((o) => o.action)).toEqual(["peak.restored"]);

        expect(fehler(await zuruecknehmen(bernd, ENTFERNT, [holen]))).toEqual([400, "reason_required"]);
        const wieder = randomUUID();
        const zurueck = await zuruecknehmen(bernd, ENTFERNT, [holen], {
            operationId: wieder,
            reason: "Gipfel gehört doch weg",
        });
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await gipfel(ENTFERNT)).toMatchObject({ is_active: false });
        expect((await eintrag(bernd, wieder)).reason).toBe("Gipfel gehört doch weg");
    });

    it("🔴 „Entfernen …“ der Mehrfachauswahl nahm Gipfel und Landschaft mit: Vom Gipfel aus kommt beides zurück (ganz oder gar nicht)", async () => {
        const auswahl = await ok(
            app.inject({
                method: "POST",
                url: editorLandscapesBatchRetireUrl,
                headers: kopf(anna.cookie),
                payload: { operationId: randomUUID(), ids: [WALD], peaks: [AUSWAHL], stage: "retire" },
            }),
        );
        expect(await gipfel(AUSWAHL)).toMatchObject({ is_active: false });
        const [still] = await cluster.admin<
            { aktiv: boolean }[]
        >`SELECT is_active AS aktiv FROM region WHERE public_id = ${WALD}::uuid`;
        expect(still!.aktiv).toBe(false);
        const antwort = await zuruecknehmen(anna, AUSWAHL, [auswahl]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await gipfel(AUSWAHL)).toMatchObject({ is_active: true });
        const [zeile] = await cluster.admin<{ region: boolean; flaeche: boolean; label: boolean }[]>`
            SELECT r.is_active AS region,
                   (SELECT a.is_active FROM region_area a WHERE a.public_id = ${WALD_FLAECHE}::uuid) AS flaeche,
                   (SELECT l.is_active FROM map_label l WHERE l.public_id = ${WALD_BESCHRIFTUNG}::uuid) AS label
              FROM region r WHERE r.public_id = ${WALD}::uuid`;
        expect(zeile).toEqual({ region: true, flaeche: true, label: true });
    });

    it("🔴 U6, U9: Fremdänderung, fremde Sperre, fehlendes Recht, Doppelklick und Anlegen", async () => {
        const annas = await ok(aendere(anna, FREMD, { height: 2300 }));
        const berndsOp = await ok(aendere(bernd, FREMD, { height: 2400 }));
        const vorher = await stand(FREMD);
        const pruefung = (await vorschau(anna, FREMD, [annas])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "peak",
                id: FREMD,
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        expect(fehler(await zuruecknehmen(anna, FREMD, [annas]))).toEqual([409, "edit_conflict"]);
        expect(await stand(FREMD)).toEqual(vorher);

        // Bernd nimmt seine Änderung zurück (Doppelklick: dieselbe Kennung liefert `replayed`, eine andere `already_reverted`).
        const seine = randomUUID();
        expect((await zuruecknehmen(bernd, FREMD, [berndsOp], { operationId: seine })).statusCode).toBe(200);
        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const nochmal = await zuruecknehmen(bernd, FREMD, [berndsOp], { operationId: seine });
        expect(nochmal.json()).toMatchObject({ operationId: seine, status: "replayed" });
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen,
        );
        expect(fehler(await zuruecknehmen(bernd, FREMD, [berndsOp]))).toEqual([409, "already_reverted"]);

        // Eine fremde Sperre und ein fehlendes Recht halten vor jeder Änderung an.
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('peak', ${FREMD}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())
        `;
        try {
            const gesperrt = await stand(FREMD);
            expect(fehler(await zuruecknehmen(anna, FREMD, [annas]))).toEqual([409, "object_locked"]);
            expect(await stand(FREMD)).toEqual(gesperrt);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${FREMD}::uuid`;
        }
        const ohne = await app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesUrl(FREMD),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [annas], membersHash: mitgliederHash([annas]) },
        });
        expect(ohne.statusCode).toBe(401);
        expect(fehler(await zuruecknehmen(rita, FREMD, [annas]))[0]).toBe(403);
        expect(((await vorschau(rita, FREMD, [annas])).json() as RuecknahmePruefung).ergebnis).toBe("forbidden");
    });

    // --- WI-0265 B8c: Gipfel setzen ---------------------------------------------------------------------------------------------

    /** „Gipfel setzen“ über die echte Route: die Operation und der neue Gipfel. */
    const setze = async (
        person: { cookie: string },
        position: [number, number],
        extra: Record<string, unknown> = {},
    ) => {
        const antwort = await app.inject({
            method: "POST",
            url: EDITOR_PEAKS_URL,
            headers: kopf(person.cookie),
            payload: { operationId: randomUUID(), position, ...extra },
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const q = antwort.json() as { operationId: string; publicId: string };
        return { operationId: q.operationId, id: q.publicId };
    };

    it("🔴 B8c: Einen Gipfel setzen und bearbeiten geht als Serie ganz zurück (still gelegt, nie gelöscht, Name und Höhe danach bleiben, kein `gipfel_wert`); die Rücknahme der Rücknahme belebt, und noch einmal zurück geht ebenso", async () => {
        const neu = await setze(anna, [600, 600]);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: true, height: null });
        const geaendert = await ok(aendere(anna, neu.id, { name: "Hochzinne", height: 3100 }));
        const mitglieder = [neu.operationId, geaendert];
        // Das Setzen eröffnet die Serie.
        const liste = (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}?limit=200`,
                headers: { cookie: anna.cookie },
            })
        ).json() as MapHistoryPage;
        expect(liste.series?.find((serie) => serie.scope.id === neu.id)).toMatchObject({
            size: 2,
            members: mitglieder,
        });

        const pruefung = (await vorschau(anna, neu.id, mitglieder)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false, offen: mitglieder });
        expect(pruefung.konflikte).toEqual([]);
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ operationId, status: "applied", reverts: mitglieder });
        // Still gelegt, die Zeile gibt es noch; was nach dem Setzen kam, bleibt.
        expect(await gipfel(neu.id)).toMatchObject({ is_active: false, name: "Hochzinne", height: 3100 });
        expect((await eintrag(anna, operationId)).objects.map((o) => o.action)).toEqual(["peak.retired"]);
        expect((await eintrag(anna, neu.operationId)).status).toBe("bereits_zurueckgenommen");

        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: true, name: "Hochzinne", height: 3100 });
        const dritte = await zuruecknehmen(anna, neu.id, [(wieder.json() as { operationId: string }).operationId]);
        expect(dritte.statusCode, dritte.body).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: false });
    });

    it("🔴 B8c: Einen gesetzten Gipfel zurücknehmen — eine Fremdänderung danach hält an (409, 0 Änderungen); eine fremde Person braucht einen Grund; Doppelklick und zweite Kennung; ohne Recht 403", async () => {
        const neu = await setze(anna, [610, 610]);
        const berndsOp = await ok(aendere(bernd, neu.id, { name: "Berndzinne" }));
        const vorher = await stand(neu.id);
        const pruefung = (await vorschau(anna, neu.id, [neu.operationId])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "peak",
                id: neu.id,
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        expect(fehler(await zuruecknehmen(anna, neu.id, [neu.operationId]))).toEqual([409, "edit_conflict"]);
        expect(await stand(neu.id)).toEqual(vorher);

        // Bernd nimmt seine Änderung zurück; die Rücknahme hebt den Konflikt auf.
        expect((await zuruecknehmen(bernd, neu.id, [berndsOp])).statusCode).toBe(200);
        const danach = await stand(neu.id);
        expect(fehler(await zuruecknehmen(bernd, neu.id, [neu.operationId]))).toEqual([400, "reason_required"]);
        expect(await stand(neu.id)).toEqual(danach);
        const operationId = randomUUID();
        const mitGrund = await zuruecknehmen(bernd, neu.id, [neu.operationId], {
            operationId,
            reason: "Falsche Stelle",
        });
        expect(mitGrund.statusCode, mitGrund.body).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: false });
        expect(
            (await eintrag(anna, operationId)).objects.every(
                (o) => (o.changes["restoreReason"] as { after?: string } | undefined)?.after === "Falsche Stelle",
            ),
        ).toBe(true);

        // Doppelklick: dieselbe Kennung liefert `replayed` ohne neue Operation, eine andere `already_reverted`.
        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const nochmal = await zuruecknehmen(bernd, neu.id, [neu.operationId], {
            operationId,
            reason: "Falsche Stelle",
        });
        expect(nochmal.json()).toMatchObject({ operationId, status: "replayed" });
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen,
        );
        expect(fehler(await zuruecknehmen(bernd, neu.id, [neu.operationId], { reason: "x" }))).toEqual([
            409,
            "already_reverted",
        ]);
        // Eine Prüferin darf es nicht (das Recht der Vorwärtsoperation); Bernds Rücknahme ist seine und geht ohne Grund zurück.
        expect(fehler(await zuruecknehmen(rita, neu.id, [neu.operationId]))[0]).toBe(403);
        expect(((await vorschau(rita, neu.id, [neu.operationId])).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
        expect((await zuruecknehmen(bernd, neu.id, [operationId])).statusCode).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: true });
    });

    it("🔴 B8c: Einen Gipfel setzen und eine Quelle anhängen geht als Serie ganz zurück: der Gipfel still, die Verknüpfung still gelegt (nie gelöscht); die Rücknahme der Rücknahme belebt beide", async () => {
        const adresse = "https://example.test/ruck-gipfel-quelle";
        const [quelle] = await cluster.admin<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
            VALUES (${`url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`}, 'final', ${adresse}, 'Ruck-Gipfelquelle', 'regelbuch', TRUE, ${SOURCE})
            RETURNING public_id::text`;
        const neu = await setze(anna, [620, 620]);
        const quellenOp = randomUUID();
        const angehaengt = await app.inject({
            method: "POST",
            url: inhalteTraegerQuellenUrl("peak", neu.id),
            headers: kopf(anna.cookie),
            payload: {
                operationId: quellenOp,
                aenderungen: [
                    { op: "add", sourceId: quelle!.public_id, vorher: null, referenceKind: "ausfuehrlich", pages: "3" },
                ],
            },
        });
        expect(angehaengt.statusCode, angehaengt.body).toBe(200);
        const verknuepfung = async () =>
            (
                await cluster.admin<{ state: string; is_active: boolean }[]>`
                    SELECT s.state, s.is_active FROM terrain_peak_source s
                      JOIN terrain_peak t ON t.id = s.terrain_peak_id JOIN feature_source f ON f.id = s.source_id
                     WHERE t.public_id = ${neu.id}::uuid AND f.public_id = ${quelle!.public_id}::uuid`
            )[0];
        expect(await verknuepfung()).toMatchObject({ state: "active", is_active: true });

        const mitglieder = [neu.operationId, quellenOp];
        const pruefung = (await vorschau(anna, neu.id, mitglieder)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: mitglieder });
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: false });
        expect(await verknuepfung()).toMatchObject({ state: "retired", is_active: false });
        expect((await eintrag(anna, operationId)).objects.map((o) => o.action).sort()).toEqual([
            "peak.retired",
            "peak.sources_changed",
        ]);

        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await gipfel(neu.id)).toMatchObject({ is_active: true });
        expect(await verknuepfung()).toMatchObject({ state: "active", is_active: true });
    });
});
