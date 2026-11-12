import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_LANDSCAPES_URL,
    EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL,
    EDITOR_SPRACHEN_URL,
    editorLandscapeRestoreSeriesPreviewUrl,
    editorLandscapeRestoreSeriesUrl,
    editorSpracheFlaecheUmformenUrl,
    editorSpracheRestoreSeriesPreviewUrl,
    editorSpracheRestoreSeriesUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Sprachen zurücknehmen (WI-0265 B6e, für WI-0261; Fachvertrag C.2, C.3, F.1; Testvertrag U2 bis U9, U13): `POST /api/editor/sprachen/:id/restore-series[/preview]` durch Fastify, als App-Rolle im
 * Wegwerf-Cluster mit den Rollen des VPS, die Vorwärtsoperationen über ihre echten Routen. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Ein Wiki-Artikel, den eine andere Sprache hergab, kommt nicht zu ihr zurück oder als neue Zeile der Redaktion statt mit der Herkunft von vorher; eine Teilfläche der Sprachenkarte
 * bleibt nach der Rücknahme eine der Redaktion (der nächste Import ersetzte sie); eine Operation über mehrere Teilflächen oder zwei Sprachen geht halb zurück; das Kopieren in eine neue Sprache lässt
 * die Sprache stehen; eine Fremdänderung bleibt unbemerkt; ein Doppelklick schreibt zweimal; die Rücknahme stößt mehr als einen Auftrag für die Treffer an.
 */

const ENV = "ruecknahmesprache";
const DB_ORDNER = fileURLToPath(new URL("../src/db/", import.meta.url));
const VORLAGEN = readdirSync(DB_ORDNER)
    .filter((name) => name.endsWith(".psql"))
    .sort()
    .map((name) => join(DB_ORDNER, name));
const describeWithCluster = postgresBin ? describe : describe.skip;
const SILENT = { write: () => undefined };
const QUELLE = "e0619e909dcc".padEnd(64, "0");

const quadrat = (x0: number, y0: number, x1: number, y1: number): number[][][][] => [
    [
        [
            [x0, y0],
            [x1, y0],
            [x1, y1],
            [x0, y1],
        ],
    ],
];

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

interface Person {
    id: string;
    cookie: string;
    run: string;
    name: string;
}

interface Quittung {
    operationId: string;
    status: string;
    affected: { kind: string; id: string; revision?: number }[];
    derivedWork: { kind: string; jobId?: string; state: string }[];
    reverts?: string[];
    publicId?: string;
    flaecheId?: string;
    spracheId?: string;
}

describeWithCluster("Sprachen zurücknehmen (WI-0265 B6e, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let fixture: AuthFixture;
    const anna: Person = { id: "", cookie: "", run: randomUUID(), name: "Anna" };
    const bernd: Person = { id: "", cookie: "", run: randomUUID(), name: "Bernd" };
    const rita: Person = { id: "", cookie: "", run: randomUUID(), name: "Rita" };
    // Eine Fläche der Derographie anlegen ist Form und steht seit WI-0279 (Betreiber 2026-11-04) ab Admin: Anna ist Editorin und darf es nicht.
    const ada: Person = { id: "", cookie: "", run: randomUUID(), name: "Ada" };
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };
    const kopf = (person: Person) => ({ cookie: person.cookie, origin: TEST_ORIGIN });

    const post = (person: Person, url: string, payload?: object): Promise<Antwort> =>
        app.inject({ method: "POST", url, headers: kopf(person), ...(payload === undefined ? {} : { payload }) });
    const ok = <T = Quittung>(antwort: Antwort): T => {
        expect(antwort.statusCode, antwort.body).toBe(200);
        return antwort.json() as T;
    };
    const fehler = (antwort: Antwort): [number, string | undefined] => [
        antwort.statusCode,
        (antwort.json() as { error?: { code?: string } }).error?.code,
    ];
    const sperren = async (person: Person, sprache: string): Promise<void> => {
        ok(await post(person, "/api/editor/locks", { run: person.run, kind: "sprache", id: sprache, part: "form" }));
    };
    const freigeben = async (person: Person, sprache: string): Promise<void> => {
        const antwort = await post(person, "/api/editor/locks/release", {
            run: person.run,
            kind: "sprache",
            id: sprache,
        });
        expect(antwort.statusCode).toBe(204);
    };
    /** Ein Schreibweg unter der eigenen Sperre der Sprache (die Vorwärtswege des Spracheditors verlangen sie). */
    const unterSperre = async <T>(person: Person, sprache: string, tu: () => Promise<T>): Promise<T> => {
        await sperren(person, sprache);
        try {
            return await tu();
        } finally {
            await freigeben(person, sprache);
        }
    };

    const revisionVon = async (sprache: string): Promise<number> =>
        (
            await cluster.admin<
                { r: number }[]
            >`SELECT revision::int AS r FROM sprache WHERE public_id = ${sprache}::uuid`
        )[0]!.r;
    const flaechenRevision = async (flaeche: string): Promise<number> =>
        (
            await cluster.admin<
                { r: number }[]
            >`SELECT revision::int AS r FROM sprache_flaeche WHERE public_id = ${flaeche}::uuid`
        )[0]!.r;
    const neueSprache = async (
        person: Person,
        name: string,
        mehr: { wiki?: string[]; legende?: string } = {},
    ): Promise<string> => {
        const quittung = ok(
            await post(person, EDITOR_SPRACHEN_URL, { operationId: randomUUID(), name, farbe: "#8f6fb3", ...mehr }),
        );
        return quittung.publicId!;
    };
    /** Eine Sprache ohne Operation im Protokoll (wie aus dem Import): Die Serie der Felder beginnt dann mit der ersten Änderung, nicht mit dem Anlegen. */
    const spracheOhneProtokoll = async (name: string, legende: string): Promise<string> =>
        (
            await cluster.admin<{ public_id: string }[]>`
                INSERT INTO sprache (schluessel, name, legende, farbe, reihenfolge, herkunft)
                VALUES (${name.toLowerCase().replace(/ /g, "-")}, ${name}, ${legende}, '#8f6fb3',
                        (SELECT COALESCE(max(reihenfolge) + 1, 0) FROM sprache), 'redaktion')
                RETURNING public_id::text`
        )[0]!.public_id;
    const artikel = async (titel: string): Promise<string> =>
        (
            await cluster.admin<{ public_id: string }[]>`
                INSERT INTO wiki_sprache_artikel (schluessel, titel, kurzbeschreibung, sprachfamilie)
                VALUES (${titel.toLowerCase()}, ${titel}, ${`Kurz zu ${titel}`}, 'Testfamilie') RETURNING public_id::text`
        )[0]!.public_id;
    /** Eine Zuordnung als Import (Herkunft `import`), wie der Import der Sprachenkarte sie anlegt. */
    const ordneImportZu = async (sprache: string, artikelId: string, stelle: number): Promise<void> => {
        await cluster.admin`
            INSERT INTO sprache_wiki (sprache_id, wiki_sprache_artikel_id, position, herkunft)
            SELECT s.id, a.id, ${stelle}, 'import' FROM sprache s, wiki_sprache_artikel a
             WHERE s.public_id = ${sprache}::uuid AND a.public_id = ${artikelId}::uuid`;
    };
    const flaecheAn = async (person: Person, sprache: string, polygons: number[][][][]): Promise<string> =>
        unterSperre(person, sprache, async () =>
            ok(
                await post(person, `${EDITOR_SPRACHEN_URL}/${sprache}/flaechen`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(sprache),
                    polygons,
                }),
            ),
        ).then((q) => q.flaecheId!);
    /** Eine Teilfläche aus der Sprachenkarte (Herkunft `sprachenkarte`, mit Revision der Quelle) als Besitzer. */
    const flaecheAusKarte = async (sprache: string, x0: number, y0: number, x1: number, y1: number): Promise<string> =>
        (
            await cluster.admin<{ public_id: string }[]>`
                INSERT INTO sprache_flaeche (sprache_id, map_domain_id, geom, herkunft, quelle_revision)
                SELECT s.id, 'aventuria', ST_GeomFromText(${`POLYGON((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))`}, 0),
                       'sprachenkarte', ${QUELLE}
                  FROM sprache s WHERE s.public_id = ${sprache}::uuid
                RETURNING public_id::text`
        )[0]!.public_id;

    const spracheZeile = async (id: string) =>
        (
            await cluster.admin<
                {
                    name: string;
                    legende: string | null;
                    farbe: string;
                    reihenfolge: number;
                    is_active: boolean;
                    state: string;
                    retired_origin: string | null;
                    revision: number;
                }[]
            >`
                SELECT name, legende, farbe, reihenfolge, is_active, state, retired_origin, revision::int AS revision
                  FROM sprache WHERE public_id = ${id}::uuid`
        )[0]!;
    const flaechenZeile = async (id: string) =>
        (
            await cluster.admin<
                {
                    is_active: boolean;
                    herkunft: string;
                    quelle_revision: string | null;
                    retired_origin: string | null;
                    geojson: string;
                    revision: number;
                }[]
            >`
                SELECT is_active, herkunft, quelle_revision, retired_origin, ST_AsGeoJSON(geom, 6) AS geojson, revision::int AS revision
                  FROM sprache_flaeche WHERE public_id = ${id}::uuid`
        )[0]!;
    const pillen = async (sprache: string): Promise<{ titel: string; position: number; herkunft: string }[]> =>
        cluster.admin`
            SELECT a.titel, w.position, w.herkunft
              FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
             WHERE s.public_id = ${sprache}::uuid AND w.is_active ORDER BY w.position`;
    const zeilenDerPille = async (sprache: string, artikelId: string): Promise<number> =>
        Number(
            (
                await cluster.admin<{ n: string }[]>`
                    SELECT count(*)::text AS n FROM sprache_wiki w JOIN sprache s ON s.id = w.sprache_id JOIN wiki_sprache_artikel a ON a.id = w.wiki_sprache_artikel_id
                     WHERE s.public_id = ${sprache}::uuid AND a.public_id = ${artikelId}::uuid`
            )[0]!.n,
        );
    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);
    const operationen = (): Promise<number> =>
        zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
    /** Was eine gescheiterte Rücknahme nie verändern darf. */
    const stand = async (sprachen: string[], flaechen: string[]) => ({
        operationen: await operationen(),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        sprachen: await Promise.all(sprachen.map(spracheZeile)),
        flaechen: await Promise.all(flaechen.map(flaechenZeile)),
        pillen: await Promise.all(sprachen.map(pillen)),
    });
    const trefferAuftraege = async (): Promise<{ public_id: string; input_ref: { sprachen?: string[] } }[]> =>
        cluster.admin`SELECT public_id::text, input_ref FROM job WHERE kind = 'sprache_treffer' AND state = 'QUEUED' ORDER BY id`;
    const eintrag = async (person: Person, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];

    const vorschau = (person: Person, sprache: string, members: string[]) =>
        app.inject({
            method: "POST",
            url: editorSpracheRestoreSeriesPreviewUrl(sprache),
            headers: kopf(person),
            payload: { members, membersHash: mitgliederHash(members) },
        });
    const zuruecknehmen = (
        person: Person,
        sprache: string,
        members: string[],
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorSpracheRestoreSeriesUrl(sprache),
            headers: kopf(person),
            payload: {
                operationId: extra.operationId ?? randomUUID(),
                members,
                membersHash: mitgliederHash(members),
                ...(extra.reason === undefined ? {} : { reason: extra.reason }),
            },
        });
    const aendere = async (person: Person, sprache: string, felder: Record<string, unknown>): Promise<string> =>
        unterSperre(person, sprache, async () =>
            ok(
                await post(person, `${EDITOR_SPRACHEN_URL}/${sprache}/update`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(sprache),
                    ...felder,
                }),
            ),
        ).then((q) => q.operationId);

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, VORLAGEN, { mapDomains: true });
        fixture = authFixture(cluster.admin);
        for (const [rolle, wer] of [
            ["editor", anna],
            ["editor", bernd],
            ["reviewer", rita],
            ["admin", ada],
        ] as const) {
            const person = await fixture.person(rolle, { name: wer.name });
            wer.id = person.id;
            // Sprachen schreibt nur der Linguist, darüber Admins und Betreiber (WI-0279 E17a): Anna und Bernd tragen die Sonderrolle.
            if (rolle === "editor") {
                await cluster.admin`
                    INSERT INTO avesmaps_auth.sonderrolle_zuteilung (person_id, environment, sonderrolle, granted_by, reason)
                    VALUES (${person.id}, 'test', 'linguist', ${person.id}, 'Probe E17a')
                `;
            }
            wer.cookie = (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie;
        }
        app = buildApp({ config, database: cluster.app, logStream: SILENT });
        await app.ready();
    }, 300_000);
    afterAll(async () => {
        await fixture?.cleanup();
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    it("🔴 Felder als Serie (U2, U3): EINE Operation `sprache.restore_series`, zwei Verknüpfungen, Namen und Farbe wie vorher; die Rücknahme ist selbst zurücknehmbar", async () => {
        const id = await spracheOhneProtokoll("Ruck Alpha", "Alpha-Legende");
        const vorher = await spracheZeile(id);
        const eins = await aendere(anna, id, { name: "Ruck Alpha II", farbe: "#112233" });
        const zwei = await aendere(anna, id, { legende: "Neue Legende", reihenfolge: 7 });
        expect(await spracheZeile(id)).toMatchObject({
            name: "Ruck Alpha II",
            farbe: "#112233",
            legende: "Neue Legende",
        });

        const pruefung = (await vorschau(anna, id, [eins, zwei])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            reasonRequired: false,
            offen: [eins, zwei],
            folgen: { gegenstaende: 0, gelaende: "keines" },
        });
        const vorOperationen = await operationen();
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, id, [eins, zwei], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as Quittung;
        expect(quittung).toMatchObject({ operationId, status: "applied", reverts: [eins, zwei] });
        expect(await operationen()).toBe(vorOperationen + 1);
        const [neue] = await cluster.admin<{ source: string; action: string }[]>`
            SELECT source, action FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(neue).toEqual({ source: "restore", action: "sprache.restore_series" });
        expect(await spracheZeile(id)).toMatchObject({
            name: vorher.name,
            farbe: vorher.farbe,
            legende: vorher.legende,
            reihenfolge: vorher.reihenfolge,
        });
        // Name, Farbe, Legende und Reihenfolge gehen in keinen Treffer ein: kein Auftrag, nur die Kachelrevision.
        expect(quittung.derivedWork.map((arbeit) => arbeit.kind)).toEqual(["tiles"]);
        expect(await trefferAuftraege()).toEqual([]);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action)).toEqual(["sprache.updated"]);
        expect(Object.keys(e.objects[0]!.changes).sort()).toEqual(["farbe", "legende", "name", "reihenfolge"]);

        // Die Rücknahme der Rücknahme setzt die Werte vom Ende der Serie wieder: Annas eigene, ohne Grund.
        const nochmal = await zuruecknehmen(anna, id, [operationId]);
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(await spracheZeile(id)).toMatchObject({
            name: "Ruck Alpha II",
            farbe: "#112233",
            legende: "Neue Legende",
        });
    });

    it("🔴 Wiki-Artikel samt Herkunft: der Artikel, den die Sprache einer anderen nahm, geht zu ihr zurück, mit der Zuordnung von vorher (kein Doppel, `import` bleibt)", async () => {
        const [x, y] = [await artikel("Ruck Eins"), await artikel("Ruck Zwei")];
        const geber = await neueSprache(bernd, "Ruck Geber");
        await ordneImportZu(geber, x, 0);
        const nehmer = await neueSprache(anna, "Ruck Nehmer");
        // Anna ordnet X (gehört dem Geber) und Y (frei) zu: EINE Operation an zwei Sprachen, `wiki_released` an der Geberin.
        const zuordnen = await unterSperre(anna, nehmer, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${nehmer}/wiki`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(nehmer),
                    artikel: [x, y],
                }),
            ),
        );
        expect((await pillen(geber)).length).toBe(0);
        expect((await pillen(nehmer)).map((p) => p.titel)).toEqual(["Ruck Eins", "Ruck Zwei"]);
        const pruefung = (await vorschau(anna, nehmer, [zuordnen.operationId])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false });
        // Die Geberin gehört Bernd: Eine Rücknahme von Annas Operation betrifft Annas Operation; ein Grund ist nicht verlangt.
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, nehmer, [zuordnen.operationId], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((await pillen(nehmer)).length).toBe(0);
        expect(await pillen(geber)).toEqual([{ titel: "Ruck Eins", position: 0, herkunft: "import" }]);
        // Dieselbe Zeile belebt, keine neue der Redaktion: Die Geberin hat genau EINE Zeile für X, und sie ist die ursprüngliche.
        expect(await zeilenDerPille(geber, x)).toBe(1);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => [o.kind, o.action]).sort()).toEqual([
            ["sprache", "sprache.wiki_changed"],
            ["sprache", "sprache.wiki_changed"],
        ]);
        const ids = e.objects.map((o) => o.id).sort();
        expect(ids).toEqual([geber, nehmer].sort());

        // Zurück in den Stand von vorher (die Rücknahme ist selbst zurücknehmbar): X wieder bei der Nehmerin, die Geberin ohne Artikel.
        const wieder = await zuruecknehmen(anna, nehmer, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await pillen(nehmer)).map((p) => p.titel)).toEqual(["Ruck Eins", "Ruck Zwei"]);
        expect((await pillen(geber)).length).toBe(0);
    });

    it("🔴 Ein Artikel, der inzwischen einer anderen Sprache gehört oder aus dem Wiki verschwand, lässt die Rücknahme ganz aus (`sprache_wiki`, 0 Änderungen)", async () => {
        const [x, y] = [await artikel("Ruck Drei"), await artikel("Ruck Vier")];
        const erste = await neueSprache(anna, "Ruck Erste", { wiki: [x] });
        const dritte = await neueSprache(anna, "Ruck Dritte");
        // Anna löst den Artikel von der ersten Sprache (Wiki leer), Bernd ordnet ihn der dritten zu.
        const geloest = await unterSperre(anna, erste, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${erste}/wiki`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(erste),
                    artikel: [],
                }),
            ),
        );
        await unterSperre(bernd, dritte, async () =>
            ok(
                await post(bernd, `${EDITOR_SPRACHEN_URL}/${dritte}/wiki`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(dritte),
                    artikel: [x, y],
                }),
            ),
        );
        const vorher = await stand([erste, dritte], []);
        const pruefung = (await vorschau(anna, erste, [geloest.operationId])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "sprache",
                id: erste,
                felder: ["wiki"],
                abweichung: { was: "sprache_wiki" },
            }),
        );
        expect(fehler(await zuruecknehmen(anna, erste, [geloest.operationId]))).toEqual([409, "edit_conflict"]);
        expect(await stand([erste, dritte], [])).toEqual(vorher);
    });

    it("🔴 Stilllegen und Zurückholen von Teilfläche und Sprache: Pillen mit ihrer Herkunft, EIN Auftrag für die Treffer; die Rücknahme der Rücknahme von einer fremden Person nur mit Grund (Gate 2)", async () => {
        const z = await artikel("Ruck Fuenf");
        const id = await neueSprache(anna, "Ruck Stilll");
        await ordneImportZu(id, z, 0);
        const teil = await flaecheAn(anna, id, quadrat(300, 300, 320, 320));

        // Die Teilfläche: stilllegen über ihre Route, zurück über die Rücknahme.
        const still = await unterSperre(anna, id, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${id}/flaechen/${teil}/retire`, {
                    operationId: randomUUID(),
                    baseRevision: await flaechenRevision(teil),
                }),
            ),
        );
        expect(await flaechenZeile(teil)).toMatchObject({ is_active: false, retired_origin: "editor" });
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const holen = randomUUID();
        const antwort = await zuruecknehmen(anna, id, [still.operationId], { operationId: holen });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await flaechenZeile(teil)).toMatchObject({ is_active: true, retired_origin: null });
        const quittung = antwort.json() as Quittung;
        // Genau EIN Auftrag für die Treffer, für diese Sprache.
        expect(quittung.derivedWork.filter((arbeit) => arbeit.kind === "sprache_treffer")).toHaveLength(1);
        expect((await trefferAuftraege()).map((job) => job.input_ref.sprachen)).toEqual([[id]]);
        expect((await eintrag(anna, holen)).objects.map((o) => [o.kind, o.action, o.sprache?.id])).toEqual([
            ["sprache_flaeche", "sprache_flaeche.restored", id],
        ]);

        // Die Sprache: stilllegen gibt ihre Pille frei, die Rücknahme belebt DIESELBE Zeile (Herkunft `import`).
        const aus = await unterSperre(anna, id, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${id}/retire`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(id),
                }),
            ),
        );
        expect(await spracheZeile(id)).toMatchObject({ is_active: false, state: "retired", retired_origin: "editor" });
        expect(await pillen(id)).toEqual([]);
        const zurueck = randomUUID();
        const wieder = await zuruecknehmen(anna, id, [aus.operationId], { operationId: zurueck });
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await spracheZeile(id)).toMatchObject({ is_active: true, state: "active", retired_origin: null });
        expect(await pillen(id)).toEqual([{ titel: "Ruck Fuenf", position: 0, herkunft: "import" }]);
        expect(await zeilenDerPille(id, z)).toBe(1);

        // Bernd nimmt Annas Rücknahme zurück: eine fremde Person, also mit Grund.
        const vor = await stand([id], [teil]);
        expect(fehler(await zuruecknehmen(bernd, id, [zurueck]))).toEqual([400, "reason_required"]);
        expect(await stand([id], [teil])).toEqual(vor);
        const grund = randomUUID();
        const mitGrund = await zuruecknehmen(bernd, id, [zurueck], {
            operationId: grund,
            reason: "Die Sprache bleibt weg",
        });
        expect(mitGrund.statusCode, mitGrund.body).toBe(200);
        expect(await spracheZeile(id)).toMatchObject({ is_active: false, retired_origin: "editor" });
        expect(await pillen(id)).toEqual([]);
        expect((await eintrag(bernd, grund)).reason).toBe("Die Sprache bleibt weg");
        const [protokoll] = await cluster.admin<{ changes: Record<string, unknown> }[]>`
            SELECT changes FROM map_audit_event WHERE operation_id = ${grund}::uuid AND sprache_public_id = ${id}::uuid`;
        expect(protokoll!.changes["restoreReason"]).toEqual({ after: "Die Sprache bleibt weg" });
    });

    it("🔴 „Unterflächen vereinigen“ (mehrere Teilflächen, EINE Operation): Form und Herkunft der Sprachenkarte kehren zurück, die aufgegangene Teilfläche kommt wieder; die Vorschau nennt zwei Gegenstände", async () => {
        const id = await neueSprache(anna, "Ruck Werkzeug");
        const f1 = await flaecheAusKarte(id, 300, 300, 340, 340);
        const f2 = await flaecheAn(anna, id, quadrat(330, 300, 370, 340));
        const vorher = await stand([id], [f1, f2]);
        expect(vorher.flaechen[0]).toMatchObject({ herkunft: "sprachenkarte", quelle_revision: QUELLE });

        const vereinigt = await unterSperre(anna, id, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${id}/flaechen/${f1}/parts`, {
                    operationId: randomUUID(),
                    operation: "vereinigen",
                    baseRevision: await flaechenRevision(f1),
                }),
            ),
        );
        const nach = await flaechenZeile(f1);
        expect(nach).toMatchObject({ herkunft: "redaktion", quelle_revision: null });
        expect(nach.geojson).not.toBe(vorher.flaechen[0]!.geojson);
        expect(await flaechenZeile(f2)).toMatchObject({ is_active: false });

        const pruefung = (await vorschau(anna, id, [vereinigt.operationId])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", folgen: { gegenstaende: 2, gelaende: "keines" } });
        const vorOperationen = await operationen();
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, id, [vereinigt.operationId], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await operationen()).toBe(vorOperationen + 1);
        // Die Form bitgenau wie vorher, die Herkunft samt Revision der Quelle (der nächste Import ersetzte sie sonst nicht), die zweite Teilfläche wieder auf der Karte.
        const zurueck = await stand([id], [f1, f2]);
        expect(zurueck.flaechen[0]).toMatchObject({
            herkunft: "sprachenkarte",
            quelle_revision: QUELLE,
            geojson: vorher.flaechen[0]!.geojson,
            is_active: true,
        });
        expect(zurueck.flaechen[1]).toMatchObject({
            is_active: true,
            retired_origin: null,
            geojson: vorher.flaechen[1]!.geojson,
        });
        expect((await trefferAuftraege()).map((job) => job.input_ref.sprachen)).toEqual([[id]]);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => `${o.id}:${o.action}`).sort()).toEqual(
            [`${f1}:sprache_flaeche.reshaped`, `${f2}:sprache_flaeche.restored`].sort(),
        );
        // Selbst zurücknehmbar: wieder vereinigt.
        expect((await zuruecknehmen(anna, id, [operationId])).statusCode).toBe(200);
        expect(await flaechenZeile(f2)).toMatchObject({ is_active: false });
        expect(await flaechenZeile(f1)).toMatchObject({ herkunft: "redaktion", quelle_revision: null });
    });

    it("🔴 „Mit anderer Fläche“ über zwei Sprachen: ganz oder gar nicht; eine fremde Sperre der anderen Sprache hält vor jeder Änderung an", async () => {
        const [p, q] = [await neueSprache(anna, "Ruck Pe"), await neueSprache(anna, "Ruck Qu")];
        const f = await flaecheAn(anna, p, quadrat(300, 400, 340, 440));
        const g = await flaecheAn(anna, q, quadrat(330, 400, 370, 440));
        const davor = await stand([p, q], [f, g]);
        const verknuepft = await unterSperre(anna, p, async () =>
            unterSperre(anna, q, async () =>
                ok(
                    await post(anna, `${EDITOR_SPRACHEN_URL}/${p}/flaechen/${f}/boolean`, {
                        operationId: randomUUID(),
                        operation: "vereinigen",
                        baseRevision: await flaechenRevision(f),
                        targetAreaId: g,
                        targetBaseRevision: await flaechenRevision(g),
                    }),
                ),
            ),
        );
        expect(await flaechenZeile(g)).toMatchObject({ is_active: false });
        const vorher = await stand([p, q], [f, g]);

        // Bernd hält die andere Sprache: Die Rücknahme von Annas Sprache aus ändert nichts.
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('sprache', ${q}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            expect(fehler(await zuruecknehmen(anna, p, [verknuepft.operationId]))).toEqual([409, "object_locked"]);
            expect(await stand([p, q], [f, g])).toEqual(vorher);
            const pruefung = (await vorschau(anna, p, [verknuepft.operationId])).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${q}::uuid`;
        }
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const antwort = await zuruecknehmen(anna, p, [verknuepft.operationId]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const danach = await stand([p, q], [f, g]);
        expect(danach.flaechen).toEqual(
            davor.flaechen.map((zeile, i) => ({ ...zeile, revision: danach.flaechen[i]!.revision })),
        );
        // Beide Sprachen wurden berührt: EIN Auftrag nennt beide.
        const jobs = await trefferAuftraege();
        expect(jobs).toHaveLength(1);
        expect([...(jobs[0]!.input_ref.sprachen ?? [])].sort()).toEqual([p, q].sort());
    });

    it("🔴 „Kopieren …“ in eine NEUE Sprache mit Originalfläche löschen: die Rücknahme legt die neue Sprache und ihre Teilfläche still und holt die Quelle zurück, ganz oder gar nicht (U13)", async () => {
        const quelle = await neueSprache(anna, "Ruck Kopierquelle");
        const f = await flaecheAn(anna, quelle, quadrat(300, 500, 340, 540));
        const kopieren = (name: string) =>
            unterSperre(anna, quelle, async () =>
                ok(
                    await post(anna, `${EDITOR_SPRACHEN_URL}/${quelle}/flaechen/${f}/copy`, {
                        operationId: randomUUID(),
                        baseRevision: await flaechenRevision(f),
                        neueSprache: { name },
                        deleteSource: true,
                    }),
                ),
            );

        // Eine Fremdänderung an der neuen Sprache hält die ganze Rücknahme an: Weder die Sprache noch die Teilflächen ändern sich.
        const eins = await kopieren("Ruck Kopieziel Eins");
        const neuEins = eins.spracheId!;
        const kopieEins = eins.flaecheId!;
        await aendere(bernd, neuEins, { farbe: "#010203" });
        const vorher = await stand([quelle, neuEins], [f, kopieEins]);
        expect(vorher.sprachen[1]).toMatchObject({ is_active: true });
        const pruefung = (await vorschau(anna, quelle, [eins.operationId])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte.map((k) => k.kind)).toContain("sprache");
        expect(fehler(await zuruecknehmen(anna, quelle, [eins.operationId]))).toEqual([409, "edit_conflict"]);
        expect(await stand([quelle, neuEins], [f, kopieEins])).toEqual(vorher);
        // Die Quelle ist weiter stillgelegt. Für die nächste Kopie holt der Vorwärtsweg sie zurück.
        expect(await flaechenZeile(f)).toMatchObject({ is_active: false });
        await unterSperre(anna, quelle, async () =>
            ok(
                await post(anna, `${EDITOR_SPRACHEN_URL}/${quelle}/flaechen/${f}/restore`, {
                    operationId: randomUUID(),
                    baseRevision: await flaechenRevision(f),
                }),
            ),
        );

        const zwei = await kopieren("Ruck Kopieziel Zwei");
        const neuZwei = zwei.spracheId!;
        const kopieZwei = zwei.flaecheId!;
        const anzahl = async () => ({
            sprachen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM sprache`),
            flaechen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM sprache_flaeche`),
        });
        const vorAnzahl = await anzahl();
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, quelle, [zwei.operationId], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        // Nichts wird gelöscht: dieselbe Zahl Zeilen, die neue Sprache und ihre Teilfläche still, die Quelle wieder da.
        expect(await anzahl()).toEqual(vorAnzahl);
        expect(await spracheZeile(neuZwei)).toMatchObject({
            is_active: false,
            state: "retired",
            retired_origin: "editor",
        });
        expect(await flaechenZeile(kopieZwei)).toMatchObject({ is_active: false, retired_origin: "editor" });
        expect(await flaechenZeile(f)).toMatchObject({ is_active: true, retired_origin: null });
        const jobs = await trefferAuftraege();
        expect(jobs).toHaveLength(1);
        expect([...(jobs[0]!.input_ref.sprachen ?? [])].sort()).toEqual([quelle, neuZwei].sort());
        expect((antwort.json() as Quittung).derivedWork.filter((a) => a.kind === "sprache_treffer")).toHaveLength(1);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action).sort()).toEqual(
            ["sprache.retired", "sprache_flaeche.restored", "sprache_flaeche.retired"].sort(),
        );

        // Die Rücknahme ist selbst zurücknehmbar: Sprache und Kopie wieder da, die Quelle wieder stillgelegt.
        const nochmal = await zuruecknehmen(anna, quelle, [operationId]);
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(await spracheZeile(neuZwei)).toMatchObject({ is_active: true, state: "active", retired_origin: null });
        expect(await flaechenZeile(kopieZwei)).toMatchObject({ is_active: true });
        expect(await flaechenZeile(f)).toMatchObject({ is_active: false });
    });

    it("🔴 U6, U9: Fremdänderung, Doppelklick, fremde Sperre, fehlendes Recht, unbekannte Sprache", async () => {
        const id = await neueSprache(anna, "Ruck Fremd");
        const annas = await aendere(anna, id, { name: "Ruck Fremd A" });
        const berndsOp = await aendere(bernd, id, { farbe: "#445566" });
        const vorher = await stand([id], []);
        const pruefung = (await vorschau(anna, id, [annas])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "sprache",
                id,
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        expect(fehler(await zuruecknehmen(anna, id, [annas]))).toEqual([409, "edit_conflict"]);
        expect(await stand([id], [])).toEqual(vorher);

        // Bernd nimmt seine Änderung zurück: dieselbe Kennung liefert `replayed` (nichts doppelt), eine andere `already_reverted`.
        const seine = randomUUID();
        expect((await zuruecknehmen(bernd, id, [berndsOp], { operationId: seine })).statusCode).toBe(200);
        const anzahl = await operationen();
        const nochmal = await zuruecknehmen(bernd, id, [berndsOp], { operationId: seine });
        expect(nochmal.json()).toMatchObject({ operationId: seine, status: "replayed" });
        expect(await operationen()).toBe(anzahl);
        expect(fehler(await zuruecknehmen(bernd, id, [berndsOp]))).toEqual([409, "already_reverted"]);

        // Eine fremde Sperre hält vor jeder Änderung an.
        const gesperrt = await neueSprache(anna, "Ruck Gesperrt");
        const op = await aendere(anna, gesperrt, { name: "Ruck Gesperrt II" });
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('sprache', ${gesperrt}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())`;
        try {
            const dazwischen = await stand([gesperrt], []);
            expect(fehler(await zuruecknehmen(anna, gesperrt, [op]))).toEqual([409, "object_locked"]);
            expect(await stand([gesperrt], [])).toEqual(dazwischen);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${gesperrt}::uuid`;
        }

        // Ohne Anmeldung 401, als Reviewer 403 (Vorschau: `forbidden`), eine unbekannte Sprache 404.
        const ohne = await app.inject({
            method: "POST",
            url: editorSpracheRestoreSeriesUrl(gesperrt),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [op], membersHash: mitgliederHash([op]) },
        });
        expect(ohne.statusCode).toBe(401);
        expect(fehler(await zuruecknehmen(rita, gesperrt, [op]))[0]).toBe(403);
        expect(((await vorschau(rita, gesperrt, [op])).json() as RuecknahmePruefung).ergebnis).toBe("forbidden");
        expect(fehler(await zuruecknehmen(anna, randomUUID(), [op]))).toEqual([404, "not_found"]);
        // Und es ging alles ohne Änderung: Annas Rücknahme klappt jetzt, die Sperre ist weg.
        expect((await zuruecknehmen(anna, gesperrt, [op])).statusCode).toBe(200);
        expect(await spracheZeile(gesperrt)).toMatchObject({ name: "Ruck Gesperrt" });
    });

    // --- WI-0265 B8c: Anlegen und Kopie aus der Derographie ---------------------------------------------------------------------

    /** Eine Sprache über die echte Route anlegen: die Operation und die Sprache. */
    const legeSpracheAn = async (
        person: Person,
        name: string,
        mehr: { wiki?: string[]; legende?: string } = {},
    ): Promise<{ operationId: string; id: string }> => {
        const q = ok(
            await post(person, EDITOR_SPRACHEN_URL, { operationId: randomUUID(), name, farbe: "#8f6fb3", ...mehr }),
        );
        return { operationId: q.operationId, id: q.publicId! };
    };
    /** Eine Teilfläche über die echte Route zeichnen (unter der Sperre der Sprache). */
    const zeichneFlaeche = async (
        person: Person,
        sprache: string,
        polygons: number[][][][],
    ): Promise<{ operationId: string; id: string }> => {
        const q = await unterSperre(person, sprache, async () =>
            ok(
                await post(person, `${EDITOR_SPRACHEN_URL}/${sprache}/flaechen`, {
                    operationId: randomUUID(),
                    baseRevision: await revisionVon(sprache),
                    polygons,
                }),
            ),
        );
        return { operationId: q.operationId, id: q.flaecheId! };
    };
    /** Eine Sprache ohne Operation im Protokoll (wie aus dem Import). */
    const alteSprache = async (name: string): Promise<string> =>
        (
            await cluster.admin<{ public_id: string }[]>`
                INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
                VALUES (${name.toLowerCase().replace(/ /g, "-")}, ${name}, '#8f6fb3', (SELECT COALESCE(max(reihenfolge) + 1, 0) FROM sprache), 'redaktion')
                RETURNING public_id::text`
        )[0]!.public_id;
    const serieDerSprache = async (person: Person, sprache: string) =>
        (
            (await (
                await app.inject({
                    method: "GET",
                    url: `${EDITOR_CHANGES_URL}?limit=200`,
                    headers: { cookie: person.cookie },
                })
            ).json()) as MapHistoryPage
        ).series?.find((serie) => serie.scope.id === sprache);

    it("🔴 B8c: Eine Sprache anlegen, zeichnen und umbenennen geht als Serie ganz zurück (still gelegt, nie gelöscht, der neue Name bleibt), mit EINEM Auftrag für die Treffer; die Rücknahme der Rücknahme belebt, und noch einmal zurück geht ebenso", async () => {
        const neu = await legeSpracheAn(anna, "Ruck Neu Alpha", { legende: "Anfang" });
        const teil = await zeichneFlaeche(anna, neu.id, quadrat(100, 800, 120, 820));
        const umbenannt = await aendere(anna, neu.id, { name: "Ruck Neu Alpha II" });
        const mitglieder = [neu.operationId, teil.operationId, umbenannt];
        expect(await serieDerSprache(anna, neu.id)).toMatchObject({ size: 3, members: mitglieder });
        const angelegt = [await spracheZeile(neu.id), await flaechenZeile(teil.id)] as const;
        expect(angelegt[0]).toMatchObject({ name: "Ruck Neu Alpha II", is_active: true });

        const pruefung = (await vorschau(anna, neu.id, mitglieder)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            reasonRequired: false,
            offen: mitglieder,
            folgen: { gegenstaende: 1, gelaende: "keines" },
        });
        expect(pruefung.konflikte).toEqual([]);
        await cluster.admin`DELETE FROM job WHERE kind = 'sprache_treffer'`;
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ operationId, status: "applied", reverts: mitglieder });
        // Still gelegt, die Zeilen gibt es noch; der Name danach bleibt (Zurück heißt „nicht mehr da“).
        expect(await spracheZeile(neu.id)).toMatchObject({
            name: "Ruck Neu Alpha II",
            is_active: false,
            state: "retired",
            retired_origin: "editor",
        });
        expect(await flaechenZeile(teil.id)).toMatchObject({ is_active: false, retired_origin: "editor" });
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["sprache.retired", "sprache_flaeche.retired"]);
        expect((await eintrag(anna, neu.operationId)).status).toBe("bereits_zurueckgenommen");
        // Genau EIN Auftrag für die Treffer.
        expect((await trefferAuftraege()).map((job) => job.input_ref.sprachen)).toEqual([[neu.id]]);

        // Die Rücknahme der Rücknahme belebt beide wieder; noch einmal zurück legt sie wieder still (die Einträge stehen in der Folge des Schreibens).
        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await spracheZeile(neu.id)).toMatchObject({ is_active: true, state: "active", retired_origin: null });
        expect(await flaechenZeile(teil.id)).toMatchObject({ is_active: true, retired_origin: null });
        expect((await flaechenZeile(teil.id)).geojson).toBe(angelegt[1].geojson);
        const dritte = await zuruecknehmen(anna, neu.id, [(wieder.json() as Quittung).operationId]);
        expect(dritte.statusCode, dritte.body).toBe(200);
        expect(await spracheZeile(neu.id)).toMatchObject({ is_active: false });
    });

    it("🔴 B8c: Eine Sprache mit Wiki-Artikeln anlegen, die sie einer anderen nahm: Zurück gibt die Sprache die Artikel frei und die andere bekommt sie mit ihrer Herkunft zurück; die Rücknahme der Rücknahme tauscht wieder", async () => {
        const [x, y] = [await artikel("Ruck Sieben"), await artikel("Ruck Acht")];
        const geber = await neueSprache(bernd, "Ruck Geber Acht");
        await ordneImportZu(geber, x, 0);
        const neu = await legeSpracheAn(anna, "Ruck Nehmer Acht", { wiki: [x, y] });
        expect((await pillen(neu.id)).map((p) => p.titel)).toEqual(["Ruck Sieben", "Ruck Acht"]);
        expect(await pillen(geber)).toEqual([]);

        // Die Operation berührt zwei Sprachen (die der Geberin gehört Bernd): Annas Operation ist es, die zurückgeht, ein Grund ist nicht verlangt.
        const pruefung = (await vorschau(anna, neu.id, [neu.operationId])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false });
        expect(pruefung.konflikte).toEqual([]);
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, [neu.operationId], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await spracheZeile(neu.id)).toMatchObject({ is_active: false });
        expect(await pillen(neu.id)).toEqual([]);
        // Die Geberin hat ihren Artikel mit der Zuordnung von vorher zurück: dieselbe Zeile, kein Doppel, Herkunft `import`.
        expect(await pillen(geber)).toEqual([{ titel: "Ruck Sieben", position: 0, herkunft: "import" }]);
        expect(await zeilenDerPille(geber, x)).toBe(1);

        // Zurück in den Stand nach dem Anlegen: die Nehmerin hat beide Artikel, die Geberin keinen.
        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await spracheZeile(neu.id)).toMatchObject({ is_active: true, state: "active" });
        expect((await pillen(neu.id)).map((p) => p.titel)).toEqual(["Ruck Sieben", "Ruck Acht"]);
        expect(await pillen(geber)).toEqual([]);
    });

    it("🔴 B8c: Eine Teilfläche zeichnen: Zurück legt sie still; Bernds Umformen danach hält an (409, 0 Änderungen); eine fremde Person braucht einen Grund; Doppelklick; ohne Recht 403; die Rücknahme der Rücknahme belebt", async () => {
        const id = await alteSprache("Ruck Zeichnen");
        const teil = await zeichneFlaeche(anna, id, quadrat(200, 800, 220, 820));
        const berndsOp = await unterSperre(bernd, id, async () =>
            ok(
                await post(bernd, editorSpracheFlaecheUmformenUrl(id, teil.id), {
                    operationId: randomUUID(),
                    baseRevision: await flaechenRevision(teil.id),
                    polygons: quadrat(200, 800, 230, 830),
                }),
            ),
        ).then((q) => q.operationId);
        const vorher = await stand([id], [teil.id]);
        const pruefung = (await vorschau(anna, id, [teil.operationId])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "sprache_flaeche",
                id: teil.id,
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        expect(fehler(await zuruecknehmen(anna, id, [teil.operationId]))).toEqual([409, "edit_conflict"]);
        expect(await stand([id], [teil.id])).toEqual(vorher);

        // Bernd nimmt sein Umformen zurück; Annas Teilfläche gehört einer anderen Person: ohne Grund 400, mit Grund steht er im Eintrag.
        expect((await zuruecknehmen(bernd, id, [berndsOp])).statusCode).toBe(200);
        const danach = await stand([id], [teil.id]);
        expect(fehler(await zuruecknehmen(bernd, id, [teil.operationId]))).toEqual([400, "reason_required"]);
        expect(await stand([id], [teil.id])).toEqual(danach);
        const operationId = randomUUID();
        const mitGrund = await zuruecknehmen(bernd, id, [teil.operationId], {
            operationId,
            reason: "Falsch gezeichnet",
        });
        expect(mitGrund.statusCode, mitGrund.body).toBe(200);
        expect(await flaechenZeile(teil.id)).toMatchObject({ is_active: false, retired_origin: "editor" });
        expect(
            (await eintrag(anna, operationId)).objects.every(
                (o) => (o.changes["restoreReason"] as { after?: string } | undefined)?.after === "Falsch gezeichnet",
            ),
        ).toBe(true);

        // Doppelklick: dieselbe Kennung liefert `replayed` ohne neue Operation, eine andere `already_reverted`.
        const anzahl = await operationen();
        const nochmal = await zuruecknehmen(bernd, id, [teil.operationId], {
            operationId,
            reason: "Falsch gezeichnet",
        });
        expect(nochmal.json()).toMatchObject({ operationId, status: "replayed" });
        expect(await operationen()).toBe(anzahl);
        expect(fehler(await zuruecknehmen(bernd, id, [teil.operationId], { reason: "x" }))).toEqual([
            409,
            "already_reverted",
        ]);
        // Eine Prüferin darf es nicht; Bernds Rücknahme ist seine und geht ohne Grund zurück.
        expect(fehler(await zuruecknehmen(rita, id, [teil.operationId]))[0]).toBe(403);
        expect(((await vorschau(rita, id, [teil.operationId])).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
        expect((await zuruecknehmen(bernd, id, [operationId])).statusCode).toBe(200);
        expect(await flaechenZeile(teil.id)).toMatchObject({ is_active: true, retired_origin: null });
    });

    it("🔴 B8c: Eine Fläche der Derographie in eine neue Sprache kopieren: Zurück legt Sprache und Teilfläche still und lässt die Derographie unberührt; in eine bestehende Sprache nur die Teilfläche; die Rücknahme der Rücknahme belebt", async () => {
        const regionId = randomUUID();
        const areaId = randomUUID();
        await cluster.admin`
            WITH r AS (
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, source_system)
                VALUES (${regionId}, 'aventuria', 'Ruckwald Kopie', 'vegetation', 'wald', 'ruecktest')
                RETURNING id
            )
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${areaId}, r.id, 'aventuria', ST_GeomFromText('POLYGON((300 600, 340 600, 340 640, 300 640, 300 600))', 0), 'ruecktest'
              FROM r`;
        const derographie = async () => ({
            region: (
                await cluster.admin`SELECT name, region_layer, region_type, is_active, revision::int AS revision FROM region WHERE public_id = ${regionId}::uuid`
            )[0],
            teil: (
                await cluster.admin`SELECT is_active, revision::int AS revision, ST_AsText(geom) AS geom FROM region_area WHERE public_id = ${areaId}::uuid`
            )[0],
        });
        const vorher = await derographie();
        const aus = ok(
            await post(anna, EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL, {
                operationId: randomUUID(),
                regionId,
                areaId,
                neueSprache: { name: "Ruck aus dem Wald" },
            }),
        );
        const pruefung = (await vorschau(anna, aus.spracheId!, [aus.operationId])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false, folgen: { gegenstaende: 1 } });
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, aus.spracheId!, [aus.operationId], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await spracheZeile(aus.spracheId!)).toMatchObject({ is_active: false, retired_origin: "editor" });
        expect(await flaechenZeile(aus.flaecheId!)).toMatchObject({ is_active: false, retired_origin: "editor" });
        expect((await eintrag(anna, operationId)).objects.map((o) => o.action).sort()).toEqual([
            "sprache.retired",
            "sprache_flaeche.retired",
        ]);
        // Die Fläche der Derographie wurde nie angefasst: auch ihre Revision steht.
        expect(await derographie()).toEqual(vorher);
        expect((await zuruecknehmen(anna, aus.spracheId!, [aus.operationId])).json()).toMatchObject({
            error: { code: "already_reverted" },
        });

        const wieder = await zuruecknehmen(anna, aus.spracheId!, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await spracheZeile(aus.spracheId!)).toMatchObject({ is_active: true, state: "active" });
        expect(await flaechenZeile(aus.flaecheId!)).toMatchObject({ is_active: true });
        expect(await derographie()).toEqual(vorher);

        // In eine bestehende Sprache: Nur die Teilfläche geht still, die Sprache bleibt.
        const ziel = await alteSprache("Ruck Kopieziel");
        const inZiel = await unterSperre(anna, ziel, async () =>
            ok(
                await post(anna, EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL, {
                    operationId: randomUUID(),
                    regionId,
                    areaId,
                    targetId: ziel,
                }),
            ),
        );
        const zurueck = await zuruecknehmen(anna, ziel, [inZiel.operationId]);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await spracheZeile(ziel)).toMatchObject({ is_active: true });
        expect(await flaechenZeile(inZiel.flaecheId!)).toMatchObject({ is_active: false });
        expect(await derographie()).toEqual(vorher);
    });

    it("🔴 B8c: Eine angelegte Fläche der Derographie, aus der seither eine Sprachfläche kopiert wurde, geht nicht zurück (409 am Sprachgegenstand, 0 Änderungen); erst die Kopie zurück, dann die Anlage", async () => {
        const angelegt = ok(
            await post(ada, EDITOR_LANDSCAPES_URL, {
                operationId: randomUUID(),
                layer: "vegetation",
                ring: [
                    [300, 700],
                    [340, 700],
                    [340, 740],
                    [300, 740],
                ],
            }),
        );
        const regionId = angelegt.publicId!;
        const areaId = angelegt.affected.find((e) => e.kind === "area")!.id;
        const kopie = ok(
            await post(ada, EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL, {
                operationId: randomUUID(),
                regionId,
                areaId,
                neueSprache: { name: "Ruck Kopie der Anlage" },
            }),
        );
        const zustand = async () => ({
            operationen: await operationen(),
            protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
            region: await cluster.admin`SELECT is_active, revision::int AS revision FROM region WHERE public_id = ${regionId}::uuid`,
            teil: await cluster.admin`SELECT is_active, revision::int AS revision FROM region_area WHERE public_id = ${areaId}::uuid`,
        });
        const vorher = await zustand();
        const vorschauLandschaft = (
            await app.inject({
                method: "POST",
                url: editorLandscapeRestoreSeriesPreviewUrl(regionId),
                headers: kopf(ada),
                payload: { members: [angelegt.operationId], membersHash: mitgliederHash([angelegt.operationId]) },
            })
        ).json() as RuecknahmePruefung;
        expect(vorschauLandschaft.ergebnis).toBe("edit_conflict");
        expect(vorschauLandschaft.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "sprache",
                id: kopie.spracheId,
                name: "Ruck Kopie der Anlage",
                felder: ["kopiertAus"],
                abweichung: { was: "felder" },
            }),
        );
        const abgelehnt = await app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(regionId),
            headers: kopf(ada),
            payload: {
                operationId: randomUUID(),
                members: [angelegt.operationId],
                membersHash: mitgliederHash([angelegt.operationId]),
            },
        });
        expect(fehler(abgelehnt)).toEqual([409, "edit_conflict"]);
        expect(await zustand()).toEqual(vorher);

        // Die Kopie zurück (sie legt nur Sprache und Teilfläche still), dann geht die Anlage.
        expect((await zuruecknehmen(ada, kopie.spracheId!, [kopie.operationId])).statusCode).toBe(200);
        const frei = await app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(regionId),
            headers: kopf(ada),
            payload: {
                operationId: randomUUID(),
                members: [angelegt.operationId],
                membersHash: mitgliederHash([angelegt.operationId]),
            },
        });
        expect(frei.statusCode, frei.body).toBe(200);
        expect((await zustand()).region).toEqual([{ is_active: false, revision: expect.any(Number) }]);
    });
});
