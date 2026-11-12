import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
    EDITOR_STATUS_URL,
    editorPeakRestoreSeriesUrl,
    editorPeakRetireUrl,
    editorPlaceInLandmarkeUrl,
    editorUmwandlungRestoreSeriesPreviewUrl,
    editorUmwandlungRestoreSeriesUrl,
    landmarkenArtVorschlag,
    type PlaceInLandmarkeReceipt,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { peakHistory } from "../src/editor/history.ts";
import { readEditorPowerline } from "../src/editor/kraftlinien.ts";
import { fuehreLaufAus, kennung, pruefeZeile } from "../src/editor/landmarken-umwandeln.ts";
import { vorDemCutoff } from "../src/editor/legacy-cutoff.ts";
import type { MapActor } from "../src/editor/map-operation.ts";
import { wandleOrtInLandmarke } from "../src/editor/ort-in-landmarke.ts";
import { deletePlace, restorePlace } from "../src/editor/place-removal.ts";
import { updatePeak } from "../src/editor/peak-update.ts";
import { readPowerlineNetwork } from "../src/powerlines/network.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * „In Landmarke umwandeln …“ (WI-0271 L8): EIN Ort wird eine Landmarke, EINE Operation, mit ↺ in beide Richtungen, gesperrt bis zum Cutoff der Orte in Production. Wegwerf-Cluster mit allen Rollen; die App-Rolle schreibt,
 * die Welt ist erfunden. 🔴 Keine Zeile in einer gemeinsamen Datenbank.
 *
 * Problemfälle: Wegenden, die über den Kasten am Ort hingen, zerfallen ohne ihn; ein Bezug bleibt am stillen Ort oder kommt nicht zurück; die Rücknahme überschreibt, was seither geschah; die Rücknahme der Rücknahme legt
 * eine zweite Landmarke an; in Production wandelt jemand vor dem Cutoff um; ein Dorf wird umgewandelt. Seit §17: Ein Merkmal bleibt am Ort, eine Kraftlinie zeigt ins Leere oder kommt nicht zurück.
 */

const ENV = "lmumw";
const DOMAIN = "aventuria";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const WIKI = "https://de.wiki-aventurica.de/wiki";

describeWithCluster("In Landmarke umwandeln (WI-0271 L8, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna = { id: "", cookie: "" };
    let zaehler = 0;
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const akteur = (environment: MapActor["environment"] = "test"): MapActor => ({
        kind: "person",
        personId: anna.id,
        environment,
    });
    const kopf = (person: { cookie: string }) => ({ cookie: person.cookie, origin: TEST_ORIGIN });

    /** Ein Ort mit allem, was mitgeht: Wiki, zwei Quellen, ein Treffer eines Vorkommens, eine Ortszeile eines Abenteuers und zwei Wegenden, eines genau am Ort, eines im Kasten daneben. */
    async function legeOrtAn(
        name: string,
        o: {
            subtype?: string;
            kind?: string;
            versteckt?: boolean;
            nodix?: boolean;
            ruine?: boolean;
            seehafen?: boolean;
            unterirdisch?: boolean;
            entrueckt?: boolean;
            ungefaehr?: boolean;
        } = {},
    ) {
        zaehler += 1;
        const m = cluster.migrator;
        const x = 300 + zaehler * 10;
        const y = 300;
        const id = randomUUID();
        const [ort] = await m<{ id: string }[]>`
            INSERT INTO place (public_id, map_domain_id, name, subtype, place_kind, is_hidden, is_nodix, is_ruined, is_seaport, is_underground, is_withdrawn,
                               is_approximate, geom, source_system)
            VALUES (${id}::uuid, ${DOMAIN}, ${name}, ${o.subtype ?? "gebaeude"}, ${o.kind ?? null}, ${o.versteckt ?? false}, ${o.nodix ?? false},
                    ${o.ruine ?? false}, ${o.seehafen ?? false}, ${o.unterirdisch ?? false}, ${o.entrueckt ?? false}, ${o.ungefaehr ?? false},
                    ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), 'legacy')
            RETURNING id::text AS id
        `;
        const url = `${WIKI}/${encodeURIComponent(name)}`;
        await m`
            INSERT INTO place_wiki_assignment (place_id, wiki_url, assignment_state, assignment_origin, source_system)
            VALUES (${ort!.id}::bigint, ${url}, 'address_only', 'unknown', 'legacy')
        `;
        await m`
            INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, source_system)
            VALUES ('siedlung', ${id}::uuid, ${`wiki:${name.toLowerCase()}`}, ${url}, ${name}, 'legacy')
        `;
        const quellen = await m<{ id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, legacy_source_id, title, source_type, is_official)
            SELECT 'legacy-id:' || (980000 + ${zaehler * 10} + n)::text, 'provisional', 980000 + ${zaehler * 10} + n, 'Quelle ' || n, 'regelbuch', true
              FROM generate_series(1, 2) AS n
            RETURNING id::text AS id
        `;
        for (const [position, quelle] of quellen.entries())
            await m`
                INSERT INTO place_source (place_id, source_id, position, pages, source_system)
                VALUES (${ort!.id}::bigint, ${quelle.id}::bigint, ${position}, '12', 'legacy')
            `;
        const [eintrag] = await m<{ id: string }[]>`
            INSERT INTO lore_entry (public_id, wiki_key, kind, name, wiki_title, legacy_origin, state, source_system, is_active)
            VALUES (${randomUUID()}::uuid, ${`lmumw-${String(zaehler)}`}, 'fauna', 'Höhlenbär', 'Höhlenbär', 'wiki', 'active', 'legacy', true)
            RETURNING id::text AS id
        `;
        const [zeile] = await m<{ id: string }[]>`
            INSERT INTO lore_place (lore_entry_id, place_wiki_key, relation, place_title, sort_order, key_class, target_state, target_count, legacy_origin, source_system)
            VALUES (${eintrag!.id}::bigint, ${`ort-${String(zaehler)}`}, 'vorkommen', ${name}, 1, 'other', 'ambiguous', 2, 'manual', 'test')
            RETURNING id::text AS id
        `;
        await m`INSERT INTO lore_place_target (lore_place_id, place_id) VALUES (${zeile!.id}::bigint, ${ort!.id}::bigint)`;
        const [werk] = await m<{ id: string }[]>`
            INSERT INTO adventure (public_id, title, product_type, is_official, source_system)
            VALUES (${randomUUID()}::uuid, 'Ein Werk', 'gruppenabenteuer', true, 'legacy') RETURNING id::text AS id
        `;
        const [ortszeile] = await m<{ id: string }[]>`
            INSERT INTO adventure_place (adventure_id, sort_order, export_ordinal, name_key, raw_name, role, target_state, resolved_by, place_id, source_system)
            VALUES (${werk!.id}::bigint, 1, 1, 'ort', ${name}, 'start', 'resolved', 'public_id', ${ort!.id}::bigint, 'legacy')
            RETURNING id::text AS id
        `;
        const wegGenau = randomUUID();
        const wegDaneben = randomUUID();
        const weg = async (wegId: string, xEnde: number, yEnde: number, xStart: number): Promise<void> => {
            await m`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                VALUES (${wegId}::uuid, ${DOMAIN}, 'Ein Pfad', 'Pfad', TRUE, FALSE,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${xStart}, ${y + 3}), ST_MakePoint(${xEnde}, ${yEnde})), 0), 'legacy', TRUE)
            `;
        };
        await weg(wegGenau, x, y, x - 3);
        await weg(wegDaneben, x + 0.2, y + 0.1, x + 3);
        return {
            id,
            ortId: ort!.id,
            url,
            x,
            y,
            wegGenau,
            wegDaneben,
            zeile: zeile!.id,
            ortszeile: ortszeile!.id,
            name,
        };
    }
    type Ort = Awaited<ReturnType<typeof legeOrtAn>>;

    const umwandeln = (id: string, baseRevision = 1, instanz: FastifyInstance = app) =>
        instanz.inject({
            method: "POST",
            url: editorPlaceInLandmarkeUrl(id),
            headers: kopf(anna),
            payload: { operationId: randomUUID(), baseRevision },
        });
    const ortAktiv = async (id: string): Promise<boolean> =>
        (await cluster.admin<{ a: boolean }[]>`SELECT is_active AS a FROM place WHERE public_id = ${id}::uuid`)[0]!.a;
    const landmarke = async (id: string) =>
        (
            await cluster.admin<
                {
                    id: string;
                    name: string;
                    subtype: string;
                    merkmale: string[];
                    show_name: boolean;
                    is_active: boolean;
                    x: number;
                    revision: number;
                }[]
            >`SELECT id::text AS id, name, subtype, merkmale, show_name, is_active, ST_X(geom) AS x, revision::int AS revision FROM terrain_peak WHERE public_id = ${id}::uuid`
        )[0]!;
    const bezuege = async (ort: Ort) => {
        const [zeile] = await cluster.admin<
            {
                treffer_ort: string | null;
                treffer_peak: string | null;
                abenteuer_ort: string | null;
                abenteuer_peak: string | null;
            }[]
        >`
            SELECT (SELECT place_id::text FROM lore_place_target WHERE lore_place_id = ${ort.zeile}::bigint) AS treffer_ort,
                   (SELECT terrain_peak_id::text FROM lore_place_target WHERE lore_place_id = ${ort.zeile}::bigint) AS treffer_peak,
                   (SELECT place_id::text FROM adventure_place WHERE id = ${ort.ortszeile}::bigint) AS abenteuer_ort,
                   (SELECT terrain_peak_id::text FROM adventure_place WHERE id = ${ort.ortszeile}::bigint) AS abenteuer_peak
        `;
        return zeile!;
    };
    const wegEnde = async (id: string) =>
        (
            await cluster.admin<{ x: number; y: number; revision: number }[]>`
                SELECT ST_X(ST_EndPoint(geom)) AS x, ST_Y(ST_EndPoint(geom)) AS y, revision::int AS revision FROM path WHERE public_id = ${id}::uuid`
        )[0]!;
    const rueckfrage = (peakId: string, operationId: string) =>
        app.inject({
            method: "POST",
            url: editorUmwandlungRestoreSeriesPreviewUrl(peakId),
            headers: kopf(anna),
            payload: { members: [operationId], membersHash: mitgliederHash([operationId]) },
        });
    const zurueck = (peakId: string, operationId: string) =>
        app.inject({
            method: "POST",
            url: editorUmwandlungRestoreSeriesUrl(peakId),
            headers: kopf(anna),
            payload: {
                operationId: randomUUID(),
                members: [operationId],
                membersHash: mitgliederHash([operationId]),
            },
        });

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const fixture = authFixture(cluster.admin);
        const annaP = await fixture.person("editor", { name: "Anna" });
        anna = { id: annaP.id, cookie: (await fixture.session(annaP.id, { passkeyMinutesAgo: 1 })).cookie };
        app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
        await app.ready();
    }, 300_000);

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    it("die Art nach Name und Ortsart, sonst Höhle: ein Vorschlag, den der Editor danach ändert", () => {
        expect(landmarkenArtVorschlag("Grotte Keranvor", "Höhle")).toBe("grotte");
        expect(landmarkenArtVorschlag("Bröllerloch", "Grotte")).toBe("hoehle");
        expect(landmarkenArtVorschlag("Donnerfall", null)).toBe("wasserfall");
        expect(landmarkenArtVorschlag("Darpatfälle", "Wasserfall")).toBe("wasserfall");
        expect(landmarkenArtVorschlag("Hursachquelle", null)).toBe("quelle");
        expect(landmarkenArtVorschlag("Tiefe Furt", "Furt")).toBe("furt");
        expect(landmarkenArtVorschlag("Korgraxon", null)).toBe("hoehle");
        expect(landmarkenArtVorschlag("Malmarzrom", "Heiligtum")).toBe("hoehle");
    });

    it("🔴 EINE Operation: Der Ort geht still, die Landmarke entsteht an seiner Lage, Wiki, Quellen und Bezüge gehen mit, die Wegenden treffen sich auf EINEM Punkt", async () => {
        const ort = await legeOrtAn("Grotte Keranvor", { kind: "Höhle", versteckt: true });
        const antwort = await umwandeln(ort.id);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<PlaceInLandmarkeReceipt>();
        expect(quittung).toMatchObject({ name: "Grotte Keranvor", subtype: "grotte" });

        expect(await ortAktiv(ort.id)).toBe(false);
        const peak = await landmarke(quittung.peakId);
        // Verborgen ist seit §17 ein Merkmal der Landmarke wie am Ort: Sie steht auf der Karte, ohne Namen und in keiner Suche.
        expect(peak).toMatchObject({ is_active: true, show_name: true, merkmale: ["verborgen"], x: ort.x });
        const [wiki] = await cluster.admin<{ wiki_url: string; assignment_state: string }[]>`
            SELECT wiki_url, assignment_state FROM terrain_peak_wiki_assignment WHERE terrain_peak_id = ${peak.id}::bigint AND is_active
        `;
        expect(wiki).toEqual({ wiki_url: ort.url, assignment_state: "address_only" });
        const x2 = await cluster.admin<{ wiki_key: string }[]>`
            SELECT wiki_key FROM wiki_key_assignment WHERE legacy_art = 'region' AND object_public_id = ${quittung.peakId}::uuid AND is_active
        `;
        expect(x2).toEqual([{ wiki_key: "wiki:grotte keranvor" }]);
        const quellen = await cluster.admin<{ pages: string }[]>`
            SELECT pages FROM terrain_peak_source WHERE terrain_peak_id = ${peak.id}::bigint AND is_active
        `;
        expect(quellen).toEqual([{ pages: "12" }, { pages: "12" }]);
        expect(await bezuege(ort)).toEqual({
            treffer_ort: null,
            treffer_peak: peak.id,
            abenteuer_ort: null,
            abenteuer_peak: peak.id,
        });
        // Das Ende daneben liegt jetzt genau am Ort; das andere lag schon dort und hat keine neue Revision.
        expect(await wegEnde(ort.wegDaneben)).toMatchObject({ x: ort.x, y: ort.y });
        expect(await wegEnde(ort.wegGenau)).toMatchObject({ x: ort.x, y: ort.y, revision: 1 });
        const [verweis] = await cluster.admin<{ rolle: string }[]>`
            SELECT rolle FROM terrain_peak_bezug WHERE terrain_peak_id = ${peak.id}::bigint AND ziel_public_id = ${ort.id}::uuid AND is_active
        `;
        expect(verweis?.rolle).toBe("umgewandelt_aus");

        const operation = await cluster.admin<{ action: string; aktionen: string[] }[]>`
            SELECT o.action, array_agg(e.action ORDER BY e.id) AS aktionen FROM map_operation o JOIN map_audit_event e USING (operation_id)
             WHERE o.operation_id = ${quittung.operationId}::uuid GROUP BY o.action
        `;
        expect(operation).toEqual([
            {
                action: "landmarke.umwandeln",
                aktionen: ["place.in_landmarke", "peak.aus_ort", "path.endpoint_moved"],
            },
        ]);
        // Eine wiederholte Kennung bekommt die erste Quittung und legt nichts doppelt an.
    });

    it("eine wiederholte Kennung bekommt die erste Quittung und legt keine zweite Landmarke an", async () => {
        const ort = await legeOrtAn("Strutzz' Höhle");
        const operationId = randomUUID();
        const body = { operationId, baseRevision: 1 };
        const erste = await wandleOrtInLandmarke(cluster.app, akteur(), ort.id, body);
        const zweite = await wandleOrtInLandmarke(cluster.app, akteur(), ort.id, body);
        expect(zweite.peakId).toBe(erste.peakId);
        const [n] = await cluster.admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM terrain_peak WHERE name = ${ort.name}`;
        expect(n?.n).toBe(1);
    });

    it("🔴 der Verlauf der Landmarke enthält den des Orts, aus dem sie entstand", async () => {
        const ort = await legeOrtAn("Falkenwinder Feengrotte");
        const geloescht = randomUUID();
        await deletePlace(cluster.app, akteur(), ort.id, { operationId: geloescht, baseRevision: 1 });
        const wieder = await restorePlace(cluster.app, akteur(), ort.id, {
            operationId: randomUUID(),
            reverts: geloescht,
        });
        const revision = wieder.affected.find((g) => g.kind === "place")!.revision!;
        const quittung = await wandleOrtInLandmarke(cluster.app, akteur(), ort.id, {
            operationId: randomUUID(),
            baseRevision: revision,
        });
        const seite = await peakHistory(cluster.app, quittung.peakId, {});
        expect(seite.entries.map((eintrag) => eintrag.operation)).toEqual([
            "landmarke.umwandeln",
            "place.restore",
            "place.delete",
        ]);
    });

    it("🔴 ↺ belebt den Ort samt Wegenden und Bezügen und legt die Landmarke still; ↺ davon wandelt mit DERSELBEN Landmarke wieder um; und wieder zurück", async () => {
        const ort = await legeOrtAn("Luzelins Grotte");
        const vorher = await wegEnde(ort.wegDaneben);
        const quittung = (await umwandeln(ort.id)).json<PlaceInLandmarkeReceipt>();
        const peak = await landmarke(quittung.peakId);

        const vorschau = await rueckfrage(quittung.peakId, quittung.operationId);
        expect(vorschau.statusCode, vorschau.body).toBe(200);
        expect(vorschau.json<RuecknahmePruefung>().offen).toEqual([quittung.operationId]);

        const eins = await zurueck(quittung.peakId, quittung.operationId);
        expect(eins.statusCode, eins.body).toBe(200);
        const rueck = eins.json<{ operationId: string }>().operationId;
        expect(await ortAktiv(ort.id)).toBe(true);
        expect((await landmarke(quittung.peakId)).is_active).toBe(false);
        expect(await bezuege(ort)).toEqual({
            treffer_ort: ort.ortId,
            treffer_peak: null,
            abenteuer_ort: ort.ortId,
            abenteuer_peak: null,
        });
        expect(await wegEnde(ort.wegDaneben)).toMatchObject({ x: vorher.x, y: vorher.y });
        const [wikiStill] = await cluster.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM terrain_peak_wiki_assignment WHERE terrain_peak_id = ${peak.id}::bigint AND is_active
        `;
        expect(wikiStill?.n).toBe(0);
        const [quellenStill] = await cluster.admin<{ n: number }[]>`
            SELECT count(*)::int AS n FROM terrain_peak_source WHERE terrain_peak_id = ${peak.id}::bigint AND is_active
        `;
        expect(quellenStill?.n).toBe(0);
        const aktionen = await cluster.admin<{ action: string }[]>`
            SELECT action FROM map_audit_event WHERE operation_id = ${rueck}::uuid ORDER BY id
        `;
        expect(aktionen.map((a) => a.action)).toEqual(["place.aus_landmarke", "peak.zum_ort", "path.endpoint_moved"]);

        // Noch einmal zurück: nicht derselbe Eintrag zweimal, 409.
        expect((await zurueck(quittung.peakId, quittung.operationId)).statusCode).toBe(409);

        const zwei = await zurueck(quittung.peakId, rueck);
        expect(zwei.statusCode, zwei.body).toBe(200);
        expect(await ortAktiv(ort.id)).toBe(false);
        expect((await landmarke(quittung.peakId)).is_active).toBe(true);
        expect((await bezuege(ort)).treffer_peak).toBe(peak.id);
        const [zahl] = await cluster.admin<
            { n: number }[]
        >`SELECT count(*)::int AS n FROM terrain_peak WHERE name = ${ort.name}`;
        expect(zahl?.n, "dieselbe Landmarke, keine zweite").toBe(1);

        const drei = await zurueck(quittung.peakId, zwei.json<{ operationId: string }>().operationId);
        expect(drei.statusCode, drei.body).toBe(200);
        expect(await ortAktiv(ort.id)).toBe(true);
        expect((await bezuege(ort)).treffer_ort).toBe(ort.ortId);
    });

    it("🔴 Streng: Hat sich seither etwas geändert, geht nichts zurück (die Art im Fenster, ein Bezug, der woandershin zeigt)", async () => {
        const ort = await legeOrtAn("Nebelhöhle", { kind: "Kultstätte" });
        const quittung = (await umwandeln(ort.id)).json<PlaceInLandmarkeReceipt>();
        const peak = await landmarke(quittung.peakId);

        // Ein Bezug zeigt inzwischen woandershin: Konflikt der Art `wert`, nichts geschrieben.
        await cluster.admin`UPDATE adventure_place SET terrain_peak_id = NULL, place_id = ${ort.ortId}::bigint WHERE id = ${ort.ortszeile}::bigint`;
        const verschoben = await zurueck(quittung.peakId, quittung.operationId);
        expect(verschoben.statusCode, verschoben.body).toBe(409);
        expect(await ortAktiv(ort.id)).toBe(false);
        await cluster.admin`UPDATE adventure_place SET place_id = NULL, terrain_peak_id = ${peak.id}::bigint WHERE id = ${ort.ortszeile}::bigint`;

        // Die Art im Fenster geändert: erst sie zurück.
        const artKennung = randomUUID();
        await updatePeak(cluster.app, akteur(), quittung.peakId, {
            operationId: artKennung,
            baseRevision: peak.revision,
            changes: { subtype: "grotte" },
        });
        const geaendert = await zurueck(quittung.peakId, quittung.operationId);
        expect(geaendert.statusCode, geaendert.body).toBe(409);
        expect(await ortAktiv(ort.id)).toBe(false);
        expect((await landmarke(quittung.peakId)).is_active).toBe(true);

        // Der Weg des Laufs bei Bröllerloch (`landmarke.umwandeln`, dann `peak.update` mit der Art): erst die Art zurück, dann die Umwandlung.
        const artZurueck = await app.inject({
            method: "POST",
            url: editorPeakRestoreSeriesUrl(quittung.peakId),
            headers: kopf(anna),
            payload: {
                operationId: randomUUID(),
                members: [artKennung],
                membersHash: mitgliederHash([artKennung]),
            },
        });
        expect(artZurueck.statusCode, artZurueck.body).toBe(200);
        const danach = await zurueck(quittung.peakId, quittung.operationId);
        expect(danach.statusCode, danach.body).toBe(200);
        expect(await ortAktiv(ort.id)).toBe(true);
    });

    /** Eine Linie zwischen zwei Knoten, in welchem Stand auch immer. */
    async function legeLinieAn(
        von: string,
        nach: string,
        x: number,
        y: number,
        stand: { aktiv?: boolean; abgenommen?: boolean } = {},
    ): Promise<string> {
        const id = randomUUID();
        await cluster.migrator`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system, is_active, off_map)
            VALUES (${id}::uuid, ${DOMAIN}, 'Eine Linie', ${von}::uuid, ${nach}::uuid,
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, ${y}), ST_MakePoint(${x + 5}, ${y})), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(${x}, ${y}), ST_MakePoint(${x + 5}, ${y})), 0), 'legacy',
                    ${stand.aktiv ?? true}, ${stand.abgenommen ?? false})
        `;
        return id;
    }
    const enden = async (id: string) =>
        (
            await cluster.admin<{ von: string; nach: string }[]>`
                SELECT from_public_id::text AS von, to_public_id::text AS nach FROM powerline WHERE public_id = ${id}::uuid`
        )[0]!;
    const ortsmerkmale = async (id: string) =>
        (
            await cluster.admin<{ ruine: boolean; seehafen: boolean; nodix: boolean }[]>`
                SELECT is_ruined AS ruine, is_seaport AS seehafen, is_nodix AS nodix FROM place WHERE public_id = ${id}::uuid`
        )[0]!;

    it("🔴 §17: Verborgen, Nodix, unterirdisch, entrückt und ungefähr gehen mit; Ruine und Seehafen bleiben am stillen Ort und sind nach ↺ noch da", async () => {
        const ort = await legeOrtAn("Aggrabans Loch", {
            versteckt: true,
            nodix: true,
            ruine: true,
            seehafen: true,
            unterirdisch: true,
            entrueckt: true,
            ungefaehr: true,
        });
        const antwort = await umwandeln(ort.id);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<PlaceInLandmarkeReceipt>();
        expect((await landmarke(quittung.peakId)).merkmale).toEqual([
            "verborgen",
            "nodix",
            "unterirdisch",
            "entrueckt",
            "ungefaehr",
        ]);
        expect(await ortsmerkmale(ort.id)).toEqual({ ruine: true, seehafen: true, nodix: true });
        const [kachel] = await cluster.admin<{ is_hidden: boolean; is_approximate: boolean }[]>`
            SELECT is_hidden, is_approximate FROM terrain_peak_render WHERE public_id = ${quittung.peakId}::uuid
        `;
        expect(kachel).toEqual({ is_hidden: true, is_approximate: true });
        const [knoten] = await cluster.admin<{ node_kind: string; is_hidden: boolean }[]>`
            SELECT node_kind, is_hidden FROM ley_node_render WHERE public_id = ${quittung.peakId}::uuid
        `;
        expect(knoten, "mit dem Merkmal Nodix ein Knoten, auch ohne Linie").toEqual({
            node_kind: "landmark",
            is_hidden: true,
        });

        const eins = await zurueck(quittung.peakId, quittung.operationId);
        expect(eins.statusCode, eins.body).toBe(200);
        expect(await ortAktiv(ort.id)).toBe(true);
        expect(await ortsmerkmale(ort.id)).toEqual({ ruine: true, seehafen: true, nodix: true });
    });

    it("🔴 §17: Kraftlinien hängen vom Ort auf die Landmarke, auch von der Karte genommene, gelöschte nicht; ↺ hängt genau sie zurück, ↺ davon wieder um", async () => {
        const ort = await legeOrtAn("Narai Tuschas", { nodix: true });
        const fern = randomUUID();
        const anfang = await legeLinieAn(ort.id, fern, ort.x, ort.y);
        const ende = await legeLinieAn(fern, ort.id, ort.x, ort.y);
        const abgenommen = await legeLinieAn(ort.id, fern, ort.x, ort.y, { aktiv: false, abgenommen: true });
        const geloescht = await legeLinieAn(ort.id, fern, ort.x, ort.y, { aktiv: false });

        const antwort = await umwandeln(ort.id);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json<PlaceInLandmarkeReceipt>();
        const peak = quittung.peakId;
        expect(await enden(anfang)).toEqual({ von: peak, nach: fern });
        expect(await enden(ende)).toEqual({ von: fern, nach: peak });
        expect(await enden(abgenommen)).toEqual({ von: peak, nach: fern });
        expect(await enden(geloescht), "eine gelöschte bleibt, wie sie war").toEqual({ von: ort.id, nach: fern });
        expect(
            quittung.affected
                .filter((g) => g.kind === "powerline")
                .map((g) => g.id)
                .sort(),
        ).toEqual([anfang, ende, abgenommen].sort());
        const protokoll = await cluster.admin<{ linie: string; changes: Record<string, unknown> }[]>`
            SELECT powerline_public_id::text AS linie, changes FROM map_audit_event
             WHERE operation_id = ${quittung.operationId}::uuid AND action = 'powerline.updated' ORDER BY id
        `;
        expect(protokoll.find((zeile) => zeile.linie === anfang)?.changes).toEqual({
            from: { before: ort.id, after: peak },
        });
        expect(protokoll.find((zeile) => zeile.linie === ende)?.changes).toEqual({
            to: { before: ort.id, after: peak },
        });

        // Die Lesewege sehen die Landmarke als Knoten, nicht als fehlendes Ende.
        const detail = await readEditorPowerline(cluster.app, anfang);
        expect(detail?.nodes.find((knoten) => knoten.id === peak)).toMatchObject({
            kind: "landmark",
            name: "Narai Tuschas",
            nodix: true,
        });
        const netz = await readPowerlineNetwork(cluster.app);
        expect(netz.lines.find((linie) => linie.id === anfang)?.from).toEqual({ id: peak, kind: "landmark" });
        const [knoten] = await cluster.admin<{ node_kind: string }[]>`
            SELECT node_kind FROM ley_node_render WHERE public_id = ${peak}::uuid
        `;
        expect(knoten?.node_kind).toBe("landmark");

        // ↺: genau die drei zurück, der Ort lebt wieder.
        const eins = await zurueck(peak, quittung.operationId);
        expect(eins.statusCode, eins.body).toBe(200);
        expect(await enden(anfang)).toEqual({ von: ort.id, nach: fern });
        expect(await enden(ende)).toEqual({ von: fern, nach: ort.id });
        expect(await enden(abgenommen)).toEqual({ von: ort.id, nach: fern });

        // ↺ davon: wieder umgehängt, ohne dass die Linien sperren.
        const zwei = await zurueck(peak, eins.json<{ operationId: string }>().operationId);
        expect(zwei.statusCode, zwei.body).toBe(200);
        expect(await enden(anfang)).toEqual({ von: peak, nach: fern });
        expect(await enden(ende)).toEqual({ von: fern, nach: peak });
    });

    it("🔴 §17: Eine weitere Linie an der Landmarke hält das ↺ an und sperrt das Entfernen; die Bahn folgt, wenn die Landmarke wandert", async () => {
        const ort = await legeOrtAn("Hursachquelle");
        // Das andere Ende ist ein echter Knoten: Nur zwischen zwei Knoten rechnet sich die Bahn neu.
        const fern = randomUUID();
        await cluster.migrator`
            INSERT INTO nodix (public_id, map_domain_id, legacy_kind, geom, source_system)
            VALUES (${fern}::uuid, ${DOMAIN}, 'junction', ST_SetSRID(ST_MakePoint(${ort.x + 5}, ${ort.y}), 0), 'legacy')
        `;
        await legeLinieAn(ort.id, fern, ort.x, ort.y);
        const quittung = (await umwandeln(ort.id)).json<PlaceInLandmarkeReceipt>();
        const peak = quittung.peakId;
        // Hursachquelle trägt kein Nodix: Die Linie endet dort trotzdem, wie vorher am Ort, und das Merkmal entsteht nicht von selbst.
        expect((await landmarke(peak)).merkmale).toEqual([]);

        const weitere = await legeLinieAn(peak, fern, ort.x, ort.y);
        const angehalten = await zurueck(peak, quittung.operationId);
        expect(angehalten.statusCode, angehalten.body).toBe(409);
        expect(await ortAktiv(ort.id)).toBe(false);
        await cluster.migrator`DELETE FROM powerline WHERE public_id = ${weitere}::uuid`;

        const stand = await landmarke(peak);
        const entfernen = await app.inject({
            method: "POST",
            url: editorPeakRetireUrl(peak),
            headers: kopf(anna),
            payload: { operationId: randomUUID(), baseRevision: stand.revision },
        });
        expect(entfernen.statusCode, entfernen.body).toBe(409);
        expect(entfernen.json<{ error: { code: string } }>().error.code).toBe("powerline_endpoint");
        expect((await landmarke(peak)).is_active).toBe(true);

        await updatePeak(cluster.app, akteur(), peak, {
            operationId: randomUUID(),
            baseRevision: stand.revision,
            changes: { position: [ort.x + 1, ort.y + 1] },
        });
        const [bahn] = await cluster.admin<{ x: number; y: number }[]>`
            SELECT ST_X(ST_StartPoint(drawn_geom)) AS x, ST_Y(ST_StartPoint(drawn_geom)) AS y FROM powerline WHERE from_public_id = ${peak}::uuid AND is_active
        `;
        expect(bahn).toEqual({ x: ort.x + 1, y: ort.y + 1 });
    });

    it("🔴 §17: Der Lauf zieht die Merkmale einer schon umgewandelten Landmarke aus dem stillen Ort nach, einmal, mit ↺; Offenes nimmt er samt Kraftlinie mit", async () => {
        const claudio: MapActor = {
            kind: "agent",
            label: "claudio",
            approvalRef: "Test-Freigabe",
            environment: "test",
        };
        const alt = await legeOrtAn("Nebelschlucht", { versteckt: true, unterirdisch: true, ruine: true });
        const q = (await umwandeln(alt.id)).json<PlaceInLandmarkeReceipt>();
        // Der Stand der ersten Läufe: keine Merkmale, verborgen nur als `show_name = false`.
        await cluster.admin`UPDATE terrain_peak SET merkmale = '{}', show_name = FALSE WHERE public_id = ${q.peakId}::uuid`;
        const offen = await legeOrtAn("Heilige Quellen zu Ilsur", { nodix: true });
        const linie = await legeLinieAn(offen.id, randomUUID(), offen.x, offen.y);

        const liste = [
            { publicId: alt.id, art: "schlucht" as const },
            { publicId: offen.id, art: "quelle" as const },
        ];
        const befunde = await Promise.all(liste.map((zeile) => pruefeZeile(cluster.app, zeile, "test")));
        expect(befunde[0]).toMatchObject({
            zustand: "nachzug",
            landmarke: q.peakId,
            merkmale: ["verborgen", "unterirdisch"],
            bleibt: ["Ruine"],
            nachzug: { changes: { merkmale: ["verborgen", "unterirdisch"], showName: true } },
        });
        expect(befunde[1]).toMatchObject({
            zustand: "offen",
            kraftlinien: 1,
            merkmale: ["nodix"],
            vorschlag: "quelle",
        });

        const ergebnisse = await fuehreLaufAus(cluster.app, claudio, befunde);
        expect(ergebnisse.map((e) => e.art)).toEqual(["nachgezogen", "umgewandelt"]);
        expect(await landmarke(q.peakId)).toMatchObject({
            show_name: true,
            merkmale: ["verborgen", "unterirdisch"],
        });
        const neu = ergebnisse[1]!.art === "umgewandelt" ? ergebnisse[1]!.peakId : "";
        expect((await enden(linie)).von).toBe(neu);
        expect((await landmarke(neu)).merkmale).toEqual(["nodix"]);

        // Ein zweiter Lauf: nichts mehr offen; auch nicht, wenn ein Editor ein Merkmal wieder wegnimmt.
        const stand = await landmarke(q.peakId);
        await updatePeak(cluster.app, akteur(), q.peakId, {
            operationId: randomUUID(),
            baseRevision: stand.revision,
            changes: { merkmale: ["verborgen"] },
        });
        const nochmal = await Promise.all(liste.map((zeile) => pruefeZeile(cluster.app, zeile, "test")));
        expect(nochmal.map((b) => b.zustand)).toEqual(["erledigt", "erledigt"]);
        const [agent] = await cluster.admin<{ approval_ref: string | null }[]>`
            SELECT approval_ref FROM map_operation WHERE operation_id = ${kennung(alt.id, "merkmale")}::uuid
        `;
        expect(agent?.approval_ref).toBe("Test-Freigabe");
    });

    it("🔴 abgewiesen, ohne etwas zu schreiben: ein Ort, der kein Bauwerk ist, ein zweites Umwandeln, eine veraltete Revision", async () => {
        const dorf = await legeOrtAn("Kleindorf", { subtype: "dorf" });
        expect((await umwandeln(dorf.id)).statusCode).toBe(400);
        expect(await ortAktiv(dorf.id)).toBe(true);

        const ort = await legeOrtAn("Korgraxon");
        expect((await umwandeln(ort.id, 99)).statusCode).toBe(409);
        expect((await umwandeln(ort.id)).statusCode).toBe(200);
        expect((await umwandeln(ort.id, 2)).statusCode).toBeGreaterThanOrEqual(400);
    });

    describe("Gesperrt bis zum Cutoff", () => {
        const LISTE = { RELEASE_ID: "r1", ABGLEICHE: "legacy:kategorien=wege+landschaften,medien:aus" };

        it("🔴 nur Production ist gesperrt, und dort nur, solange die Kategorienliste des Zugs die Orte nicht ausdrücklich auslässt; die Vorgabe ist gesperrt", () => {
            const r = { RELEASE_ID: "r1" };
            expect(vorDemCutoff("staging", { ...r, ABGLEICHE: "production:korridor" }, "orte")).toBe(false);
            expect(vorDemCutoff("development", {}, "orte")).toBe(false);
            expect(vorDemCutoff(undefined, {}, "orte")).toBe(false);
            expect(vorDemCutoff("production", r, "orte"), "kein Wert").toBe(true);
            expect(vorDemCutoff("production", { ...r, ABGLEICHE: "legacy:kategorien,medien:aus" }, "orte")).toBe(true);
            expect(
                vorDemCutoff("production", { ...r, ABGLEICHE: "legacy:kategorien=wege+orte,medien:aus" }, "orte"),
            ).toBe(true);
            expect(vorDemCutoff("production", LISTE, "orte"), "Orte fehlen in der Liste").toBe(false);
            expect(vorDemCutoff("production", LISTE, "wege")).toBe(true);
            expect(
                vorDemCutoff("production", { ...r, ABGLEICHE: "legacy:aus,medien:aus" }, "orte"),
                "Zug ganz aus",
            ).toBe(false);
        });

        it("🔴 in Production vor dem Cutoff 409 `vor_cutoff`, nichts geschrieben; nach dem Cutoff geht es", async () => {
            const ort = await legeOrtAn("Malmarzrom", { kind: "Heiligtum" });
            const versuch = (umgebung: NodeJS.ProcessEnv) =>
                wandleOrtInLandmarke(
                    cluster.app,
                    akteur("production"),
                    ort.id,
                    { operationId: randomUUID(), baseRevision: 1 },
                    umgebung,
                );
            await expect(
                versuch({ RELEASE_ID: "r1", ABGLEICHE: "legacy:kategorien,medien:aus" }),
            ).rejects.toMatchObject({
                statusCode: 409,
                code: "vor_cutoff",
            });
            expect(await ortAktiv(ort.id)).toBe(true);
            const [zahl] = await cluster.admin<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM terrain_peak WHERE name = ${ort.name}`;
            expect(zahl?.n).toBe(0);

            expect((await versuch(LISTE)).peakId).toBeTruthy();
            expect(await ortAktiv(ort.id)).toBe(false);
        });

        it("der Stand des Bearbeitens sagt es der Oberfläche", async () => {
            const antwort = await app.inject({ method: "GET", url: EDITOR_STATUS_URL, headers: kopf(anna) });
            expect(antwort.statusCode, antwort.body).toBe(200);
            expect(antwort.json<{ umwandelnFrei?: boolean }>().umwandelnFrei).toBe(true);
        });
    });
});
