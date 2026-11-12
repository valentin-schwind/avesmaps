import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    EDITOR_LANDSCAPES_URL,
    editorLandscapeBooleanUrl,
    editorLandscapeLabelRetireUrl,
    editorLandscapeLabelsUrl,
    editorLandscapeRestoreSeriesPreviewUrl,
    editorLandscapeRestoreSeriesUrl,
    editorLandscapeRetireUrl,
    editorLandscapeSplitUrl,
    editorLandscapeUrl,
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
 * Die Derographie atomar zurücknehmen (WI-0265 B6c; Fachvertrag C.2, C.3, F.1; Testvertrag U2 bis U9, U13): `POST /api/editor/landscapes/:id/restore-series[/preview]` durch Fastify, als App-Rolle im
 * Wegwerf-Cluster mit den Rollen des VPS, die Vorwärtsoperationen über ihre echten Routen. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten.
 *
 * Problemfälle: Eine Beschriftung, die dem Namen folgte, bleibt nach der Rücknahme umbenannt, oder die Landschaft steht in ihrer Ebene an einem anderen Platz (die Vorwärtswege leiten beides NEU
 * ab); die Form kommt zurück, die mitgezogene Nachbarfläche nicht (oder eine halbe); ein Werkzeug mit mehreren Teilflächen (vereinigen, zerschneiden) lässt eine Fläche, ihre Landschaft oder ihre
 * Beschriftung still; eine Fremdänderung bleibt unbemerkt oder hinterlässt eine halbe Rücknahme; ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund zurückgenommen; eine Rücknahme
 * einer Rücknahme geht nicht.
 */

const ENV = "ruecknahmeflaeche";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b6c";

const ID = (n: number): string => `b6c00265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Die Fälle: je eine Landschaft (`ID(n)`), Teilfläche (`ID(n + 0x100)`) und Beschriftung (`ID(n + 0x200)`, die zweite `ID(n + 0x300)`). */
const WALD = 1; // Felder, Beschriftungen, Form mit Nachbarn
const NACHBAR = 2; // die Nachbarfläche des Waldes (teilt zwei Ecken)
const TOOL_A = 3; // „Mit anderer Fläche“: Quelle
const TOOL_B = 4; // … und die andere Fläche, die ganz geht (samt Landschaft und Beschriftung)
const SCHNITT = 5; // Zerschneiden
const STILL = 6; // Entfernen und Zurückholen, Rücknahme einer Rücknahme
const FREMD = 7; // Fremdänderung, Sperre, Rechte
const WIEDERHOLT = 8; // Doppelklick und Replay
const GRUND = 9; // Gate 2
const MISCH = 10; // Gebirge und Felder in EINER Operation
const KRAFT = 11; // eine Kraftlinie endet an der Beschriftung: Die Rücknahme der Rücknahme (wieder entfernen) bleibt aus
const ETIKETT = 12; // B8c: eine Beschriftung löschen und eine neue anlegen, als Serie
/** Eine Fläche des Falls (`n`) oder eine, die der Test selbst angelegt hat (ihre Kennung). */
const landschaft = (n: number | string): string => (typeof n === "string" ? n : ID(n));
const flaeche = (n: number): string => ID(n + 0x100);
const beschriftung = (n: number, k = 0): string => ID(n + 0x200 + k * 0x100);

const wkt = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${x0} ${y0}, ${x1} ${y0}, ${x1} ${y1}, ${x0} ${y1}, ${x0} ${y0}))`;
/** Wo jede Fläche anfangs liegt. */
const FORM: Record<number, [number, number, number, number]> = {
    [WALD]: [100, 100, 120, 120],
    [NACHBAR]: [120, 100, 140, 120],
    [TOOL_A]: [200, 200, 230, 220],
    [TOOL_B]: [220, 200, 250, 220],
    [SCHNITT]: [300, 300, 340, 320],
    [STILL]: [400, 400, 420, 420],
    [FREMD]: [500, 500, 520, 520],
    [WIEDERHOLT]: [600, 600, 620, 620],
    [GRUND]: [700, 700, 720, 720],
    [MISCH]: [800, 800, 820, 820],
    [KRAFT]: [1000, 1000, 1020, 1020],
    [ETIKETT]: [900, 100, 920, 120],
};

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Derographie zurücknehmen (WI-0265 B6c, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
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

    const patch = (person: { cookie: string }, n: number | string, body: Record<string, unknown>): Promise<Antwort> =>
        app.inject({
            method: "PATCH",
            url: editorLandscapeUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: { operationId: randomUUID(), ...body },
        });
    const post = (person: { cookie: string }, url: string, body: Record<string, unknown>): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url,
            headers: kopf(person.cookie),
            payload: { operationId: randomUUID(), ...body },
        });
    const ok = async (antwort: Promise<Antwort>): Promise<string> => {
        const a = await antwort;
        expect(a.statusCode, a.body).toBe(200);
        return (a.json() as { operationId: string }).operationId;
    };
    const vorschau = (person: { cookie: string }, n: number | string, members: string[], membersHash?: string) =>
        app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesPreviewUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: { members, ...(membersHash === undefined ? {} : { membersHash }) },
        });
    const zuruecknehmen = (
        person: { cookie: string },
        n: number | string,
        members: string[],
        extra: { operationId?: string; reason?: string; membersHash?: string } = {},
    ): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: {
                operationId: extra.operationId ?? randomUUID(),
                members,
                membersHash: extra.membersHash ?? mitgliederHash(members),
                ...(extra.reason === undefined ? {} : { reason: extra.reason }),
            },
        });
    const fehler = (antwort: Antwort): [number, string | undefined] => [
        antwort.statusCode,
        (antwort.json() as { error?: { code?: string } }).error?.code,
    ];

    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);
    /** Was eine gescheiterte Rücknahme nie verändern darf: Operationen, Protokoll, Verknüpfungen, Aufträge und was an der Landschaft hängt. */
    const standVon = async (regionId: string) => ({
        operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        auftraege: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job`),
        flaeche: await flaechenZeilenVon(regionId),
    });
    const stand = (n: number) => standVon(landschaft(n));
    /** Landschaft, Teilflächen und Beschriftungen einer Landschaft, wie die Datenbank sie hält (ohne Zähler, die jedes Schreiben erhöht). */
    const flaechenZeilenVon = async (regionId: string) => ({
        region: await cluster.admin`
            SELECT name, region_layer, region_type, stack_order, is_locked, is_hidden, label_curve_enabled, label_curve_max, is_active, off_map
              FROM region WHERE public_id = ${regionId}::uuid`,
        teile: await cluster.admin`
            SELECT a.public_id::text AS id, a.is_active, ST_AsText(a.geom) AS geom
              FROM region_area a JOIN region r ON r.id = a.region_id WHERE r.public_id = ${regionId}::uuid ORDER BY a.public_id`,
        beschriftungen: await cluster.admin`
            SELECT l.public_id::text AS id, l.name, l.text_follows_name, l.subtype, l.label_size::float8 AS groesse, l.label_priority,
                   l.label_min_zoom, l.label_max_zoom, l.show_name, ST_X(l.geom) AS x, ST_Y(l.geom) AS y, l.is_active
              FROM map_label l JOIN region r ON r.id = l.region_id WHERE r.public_id = ${regionId}::uuid ORDER BY l.public_id`,
    });
    const flaechenZeilen = (n: number) => flaechenZeilenVon(landschaft(n));
    const revision = async (tabelle: "region" | "region_area" | "map_label", id: string): Promise<number> => {
        const [zeile] =
            tabelle === "region"
                ? await cluster.admin<
                      { r: number }[]
                  >`SELECT revision::int AS r FROM region WHERE public_id = ${id}::uuid`
                : tabelle === "region_area"
                  ? await cluster.admin<
                        { r: number }[]
                    >`SELECT revision::int AS r FROM region_area WHERE public_id = ${id}::uuid`
                  : await cluster.admin<
                        { r: number }[]
                    >`SELECT revision::int AS r FROM map_label WHERE public_id = ${id}::uuid`;
        return zeile!.r;
    };
    const eintrag = async (person: { cookie: string }, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];
    const liste = async (person: { cookie: string }) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}?limit=200`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        for (const n of [WALD, NACHBAR, TOOL_A, TOOL_B, SCHNITT, STILL, FREMD, WIEDERHOLT, GRUND, KRAFT, ETIKETT]) {
            const [x0, y0, x1, y1] = FORM[n]!;
            await m`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
                VALUES (${landschaft(n)}, ${DOMAIN}, ${`Rücknahmewald ${String(n)}`}, 'vegetation', 'wald', ${n}, TRUE, ${SOURCE})
            `;
            await m`
                INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
                SELECT ${flaeche(n)}::uuid, id, ${DOMAIN}, ST_GeomFromText(${wkt(x0, y0, x1, y1)}, 0), ${SOURCE}
                  FROM region WHERE public_id = ${landschaft(n)}
            `;
            // Die erste Beschriftung folgt dem Namen, die zweite hat einen eigenen Text, eine eigene Größe und Spanne.
            await m`
                INSERT INTO map_label (public_id, map_domain_id, region_id, name, subtype, geom, source_system, placement, sort_order, text_follows_name, is_active)
                SELECT ${beschriftung(n)}::uuid, ${DOMAIN}, id, name, 'wald', ST_SetSRID(ST_MakePoint(${x0 + 5}, ${y0 + 5}), 0), ${SOURCE}, 'punkt', 0, TRUE, TRUE
                  FROM region WHERE public_id = ${landschaft(n)}
            `;
            await m`
                INSERT INTO map_label (public_id, map_domain_id, region_id, name, subtype, geom, source_system, placement, sort_order, text_follows_name,
                                       label_size, label_priority, label_min_zoom, label_max_zoom, show_name, is_active)
                SELECT ${beschriftung(n, 1)}::uuid, ${DOMAIN}, id, 'Waldrand', 'wald', ST_SetSRID(ST_MakePoint(${x0 + 10}, ${y0 + 10}), 0), ${SOURCE}, 'punkt', 1, FALSE,
                       8, 3, 1, 6, TRUE, TRUE
                  FROM region WHERE public_id = ${landschaft(n)}
            `;
        }
        // Das Gebirge für den Fall, der Gebirge und Felder zugleich schreibt.
        await m`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
            VALUES (${landschaft(MISCH)}, ${DOMAIN}, 'Rücknahmegebirge', 'topographie', 'gebirge', ${MISCH}, TRUE, ${SOURCE})
        `;
        await m`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT ${flaeche(MISCH)}::uuid, id, ${DOMAIN}, ST_GeomFromText(${wkt(...FORM[MISCH]!)}, 0), ${SOURCE}
              FROM region WHERE public_id = ${landschaft(MISCH)}
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

    it("🔴 Felder und Beschriftungen als Serie (U2, U3): EINE Operation, zwei Verknüpfungen; Ebene, Art, Platz, Name samt folgender Beschriftung und die eigenen Werte der Beschriftung stehen wie vorher", async () => {
        const vorher = await flaechenZeilen(WALD);
        // Schritt 1: Name, Ebene und Art, Klicksperre: Die Landschaft steht in der neuen Ebene vorn, die folgende Beschriftung bekommt Text und Namensart.
        const eins = await ok(
            patch(anna, WALD, {
                baseRevision: await revision("region", landschaft(WALD)),
                changes: { name: "Neuer Wald", layer: "topographie", type: "tal", locked: true },
            }),
        );
        const nach1 = await flaechenZeilen(WALD);
        expect(nach1.region[0]).toMatchObject({
            name: "Neuer Wald",
            region_layer: "topographie",
            region_type: "tal",
            is_locked: true,
        });
        expect(nach1.beschriftungen.find((b) => b.id === beschriftung(WALD))).toMatchObject({
            name: "Neuer Wald",
            subtype: "tal",
        });
        // Schritt 2: verbergen, Kurve, und die eigenen Werte der zweiten Beschriftung.
        const zwei = await ok(
            patch(anna, WALD, {
                baseRevision: await revision("region", landschaft(WALD)),
                changes: { hidden: true, curve: { enabled: true, max: 2 } },
                labels: [
                    {
                        id: beschriftung(WALD, 1),
                        baseRevision: await revision("map_label", beschriftung(WALD, 1)),
                        changes: {
                            size: 12,
                            priority: 2,
                            zoomMin: 2,
                            zoomMax: 5,
                            visible: false,
                            position: [105, 105],
                        },
                    },
                ],
            }),
        );
        const { series } = await liste(anna);
        const serie = series?.find((s) => s.scope.id === landschaft(WALD));
        expect(serie).toMatchObject({ size: 2, members: [eins, zwei] });

        const pruefung = (await vorschau(anna, WALD, [eins, zwei], serie!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false, offen: [eins, zwei] });
        expect(pruefung.konflikte).toEqual([]);

        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, WALD, [eins, zwei], { operationId, membersHash: serie!.membersHash });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ operationId, status: "applied", reverts: [eins, zwei] });
        // EINE Operation mit der Quelle restore und zwei Verknüpfungen.
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen + 1,
        );
        const [neue] = await cluster.admin<{ source: string; action: string }[]>`
            SELECT source, action FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(neue).toEqual({ source: "restore", action: "landscape.restore_series" });
        expect(
            (
                await cluster.admin<{ r: string }[]>`
                    SELECT reverted_operation_id::text AS r FROM map_operation_revert_link WHERE restore_operation_id = ${operationId}::uuid ORDER BY position`
            ).map((z) => z.r),
        ).toEqual([eins, zwei]);
        // Alles wie vor dem ersten Schritt, auch der Platz in der alten Ebene und der Text der folgenden Beschriftung.
        expect(await flaechenZeilen(WALD)).toEqual(vorher);
        // Das Protokoll der Rücknahme trägt dieselben Aktionen wie die Vorwärtswege (und ist damit selbst wieder zurücknehmbar).
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["label.renamed", "label.updated", "region.updated"]);
        expect((await eintrag(anna, eins)).status).toBe("bereits_zurueckgenommen");
    });

    it("🔴 Form mit mitgezogener Nachbarfläche: beide Flächen kommen in EINER Operation zurück; eine Fremdänderung an der Nachbarin hält die ganze Rücknahme an (0 Änderungen)", async () => {
        const wald = await flaechenZeilen(WALD);
        const nachbar = await flaechenZeilen(NACHBAR);
        // „Ecken bearbeiten“ am Wald: Die gemeinsame Ecke (120|100) zieht auf (125|100), die Nachbarin zieht mit.
        const form = await ok(
            patch(anna, WALD, {
                areas: [
                    {
                        id: flaeche(WALD),
                        baseRevision: await revision("region_area", flaeche(WALD)),
                        polygons: [
                            [
                                [
                                    [100, 100],
                                    [125, 100],
                                    [120, 120],
                                    [100, 120],
                                ],
                            ],
                        ],
                    },
                    {
                        id: flaeche(NACHBAR),
                        baseRevision: await revision("region_area", flaeche(NACHBAR)),
                        polygons: [
                            [
                                [
                                    [125, 100],
                                    [140, 100],
                                    [140, 120],
                                    [120, 120],
                                ],
                            ],
                        ],
                    },
                ],
            }),
        );
        expect((await flaechenZeilen(WALD)).teile).not.toEqual(wald.teile);
        expect((await flaechenZeilen(NACHBAR)).teile).not.toEqual(nachbar.teile);
        const e = await eintrag(anna, form);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["area.carried", "area.reshaped"]);

        // Bernd zieht in der Nachbarfläche eine andere Ecke: später geändert, ganz oder gar nicht.
        const berndsOp = await ok(
            patch(bernd, NACHBAR, {
                areas: [
                    {
                        id: flaeche(NACHBAR),
                        baseRevision: await revision("region_area", flaeche(NACHBAR)),
                        polygons: [
                            [
                                [
                                    [125, 100],
                                    [140, 100],
                                    [145, 120],
                                    [120, 120],
                                ],
                            ],
                        ],
                    },
                ],
            }),
        );
        const vorher = await stand(WALD);
        const nachbarVorher = await flaechenZeilen(NACHBAR);
        const pruefung = (await vorschau(anna, WALD, [form])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({ art: "spaeter", kind: "area", id: flaeche(NACHBAR), operationId: berndsOp }),
        );
        const abgelehnt = await zuruecknehmen(anna, WALD, [form]);
        expect(fehler(abgelehnt)).toEqual([409, "edit_conflict"]);
        expect(await stand(WALD)).toEqual(vorher);
        expect(await flaechenZeilen(NACHBAR)).toEqual(nachbarVorher);

        // Bernd nimmt seine Änderung zurück (eigene Person, ohne Grund); danach geht Annas Form samt Nachbarin.
        const seine = await zuruecknehmen(bernd, NACHBAR, [berndsOp]);
        expect(seine.statusCode, seine.body).toBe(200);
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, WALD, [form], { operationId, reason: "Ecke war falsch" });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ reverts: [form] });
        const nachher = await flaechenZeilen(WALD);
        expect(nachher.teile).toEqual(wald.teile);
        expect((await flaechenZeilen(NACHBAR)).teile).toEqual(nachbar.teile);
        // Der Grund steht, auch wenn er freiwillig war, an den Einträgen der Rücknahme.
        expect(
            (await eintrag(anna, operationId)).objects.every(
                (o) => (o.changes["restoreReason"] as { after?: string } | undefined)?.after === "Ecke war falsch",
            ),
        ).toBe(true);
    });

    it("🔴 Mitgezogene Ecken, die nicht mehr genau an ihrer Stelle liegen: Konflikt `flaeche_nachbar` samt Revision, die Rücknahme bleibt aus", async () => {
        const form = await ok(
            patch(anna, WALD, {
                areas: [
                    {
                        id: flaeche(WALD),
                        baseRevision: await revision("region_area", flaeche(WALD)),
                        polygons: [
                            [
                                [
                                    [100, 100],
                                    [125, 100],
                                    [120, 120],
                                    [100, 120],
                                ],
                            ],
                        ],
                    },
                    {
                        id: flaeche(NACHBAR),
                        baseRevision: await revision("region_area", flaeche(NACHBAR)),
                        polygons: [
                            [
                                [
                                    [125, 100],
                                    [140, 100],
                                    [140, 120],
                                    [120, 120],
                                ],
                            ],
                        ],
                    },
                ],
            }),
        );
        // Ein Eingriff am Rand der Schreibnaht: Die Ecke der Nachbarin liegt nicht mehr bei (125|100).
        await cluster.admin`UPDATE region_area SET geom = ST_GeomFromText(${wkt(130, 100, 140, 120)}, 0) WHERE public_id = ${flaeche(NACHBAR)}::uuid`;
        const vorher = await stand(WALD);
        const pruefung = (await vorschau(anna, WALD, [form])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "area",
                id: flaeche(NACHBAR),
                felder: ["geometry"],
                abweichung: { was: "flaeche_nachbar" },
            }),
        );
        expect(fehler(await zuruecknehmen(anna, WALD, [form]))).toEqual([409, "edit_conflict"]);
        expect(await stand(WALD)).toEqual(vorher);
        // Aufräumen für die übrigen Fälle: die Flächen stehen wieder, wie sie anfangs lagen.
        await cluster.admin`UPDATE region_area SET geom = ST_GeomFromText(${wkt(...FORM[WALD]!)}, 0) WHERE public_id = ${flaeche(WALD)}::uuid`;
        await cluster.admin`UPDATE region_area SET geom = ST_GeomFromText(${wkt(...FORM[NACHBAR]!)}, 0) WHERE public_id = ${flaeche(NACHBAR)}::uuid`;
    });

    it("🔴 Stilllegen und Zurückholen: „Von der Karte nehmen“ geht samt Teilfläche und Beschriftungen zurück; die Rücknahme der Rücknahme nimmt sie wieder von der Karte (mit Grund)", async () => {
        const vorher = await flaechenZeilen(STILL);
        const entfernt = await ok(
            post(anna, editorLandscapeRetireUrl(landschaft(STILL)), {
                baseRevision: await revision("region", landschaft(STILL)),
                stage: "off_map",
            }),
        );
        const still = await flaechenZeilen(STILL);
        expect(still.region[0]).toMatchObject({ is_active: false, off_map: true });
        expect(still.teile.every((t) => t.is_active === false)).toBe(true);
        expect(still.beschriftungen.every((b) => b.is_active === false)).toBe(true);

        const holen = randomUUID();
        const antwort = await zuruecknehmen(anna, STILL, [entfernt], { operationId: holen });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await flaechenZeilen(STILL)).toEqual(vorher);
        expect((await eintrag(anna, holen)).objects.map((o) => o.action).sort()).toEqual([
            "area.restored",
            "label.restored",
            "label.restored",
            "region.restored",
        ]);

        // Bernd nimmt die Rücknahme zurück: Die Fläche geht wieder von der Karte. Fremde Person: ohne Grund 400, mit Grund EINE Operation.
        expect(fehler(await zuruecknehmen(bernd, STILL, [holen]))).toEqual([400, "reason_required"]);
        const wieder = randomUUID();
        const zurueck = await zuruecknehmen(bernd, STILL, [holen], { operationId: wieder, reason: "Doch entfernen" });
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect(await flaechenZeilen(STILL)).toEqual(still);
        const e = await eintrag(bernd, wieder);
        expect(e.objects.map((o) => o.action).sort()).toEqual([
            "area.retired",
            "label.retired",
            "label.retired",
            "region.taken_off_map",
        ]);
        expect(e.reason).toBe("Doch entfernen");
        // Der Grund ist kein Feld der Fläche: Annas nächste Rücknahme dieser Rücknahme setzt nichts Fremdes.
        const noch = await zuruecknehmen(anna, STILL, [wieder], { reason: "Zurück auf die Karte" });
        expect(noch.statusCode, noch.body).toBe(200);
        expect(await flaechenZeilen(STILL)).toEqual(vorher);
    });

    it("🔴 Kraftlinie: Endet seither eine Kraftlinie an der Beschriftung, nimmt die Rücknahme der Rücknahme die Fläche nicht wieder von der Karte (409 `powerline_endpoint`, 0 Änderungen)", async () => {
        const entfernt = await ok(
            post(anna, editorLandscapeRetireUrl(landschaft(KRAFT)), {
                baseRevision: await revision("region", landschaft(KRAFT)),
                stage: "off_map",
            }),
        );
        const holen = randomUUID();
        expect((await zuruecknehmen(anna, KRAFT, [entfernt], { operationId: holen })).statusCode).toBe(200);
        // Eine Kraftlinie endet jetzt an der ersten Beschriftung (ein Eingriff am Rand der Schreibnaht ändert die Fläche nicht).
        await cluster.admin`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${randomUUID()}, 'aventuria', 'Probelinie', ${beschriftung(KRAFT)}, ${randomUUID()},
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1010, 1005), ST_MakePoint(1050, 1005)), 0),
                    ST_SetSRID(ST_MakeLine(ST_MakePoint(1010, 1005), ST_MakePoint(1050, 1005)), 0), 'avesmaps3d')
        `;
        const vorher = await stand(KRAFT);
        const antwort = await zuruecknehmen(anna, KRAFT, [holen]);
        expect(fehler(antwort)).toEqual([409, "powerline_endpoint"]);
        expect(await stand(KRAFT)).toEqual(vorher);
    });

    it("🔴 Werkzeug „Mit anderer Fläche“ (vereinigen): Quelle, andere Fläche, deren Landschaft und Beschriftungen kommen in EINER Operation zurück", async () => {
        const quelle = await flaechenZeilen(TOOL_A);
        const ziel = await flaechenZeilen(TOOL_B);
        const werkzeug = await ok(
            post(anna, editorLandscapeBooleanUrl(landschaft(TOOL_A)), {
                operation: "vereinigen",
                areaId: flaeche(TOOL_A),
                baseRevision: await revision("region_area", flaeche(TOOL_A)),
                targetAreaId: flaeche(TOOL_B),
                targetBaseRevision: await revision("region_area", flaeche(TOOL_B)),
            }),
        );
        expect((await flaechenZeilen(TOOL_A)).teile).not.toEqual(quelle.teile);
        const weg = await flaechenZeilen(TOOL_B);
        expect(weg.region[0]).toMatchObject({ is_active: false });
        expect(weg.teile.every((t) => t.is_active === false)).toBe(true);
        expect(weg.beschriftungen.every((b) => b.is_active === false)).toBe(true);

        const pruefung = (await vorschau(anna, TOOL_A, [werkzeug])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", offen: [werkzeug] });
        const operationId = randomUUID();
        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const antwort = await zuruecknehmen(anna, TOOL_A, [werkzeug], { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen + 1,
        );
        expect(await flaechenZeilen(TOOL_A)).toEqual(quelle);
        expect(await flaechenZeilen(TOOL_B)).toEqual(ziel);
    });

    it("🔴 Werkzeug „Zerschneiden“: das abgeschnittene Stück (neue Landschaft samt Teilfläche) geht, die Form der Quelle kommt zurück", async () => {
        const vorher = await flaechenZeilen(SCHNITT);
        const geschnitten = await post(anna, editorLandscapeSplitUrl(landschaft(SCHNITT)), {
            areaId: flaeche(SCHNITT),
            baseRevision: await revision("region_area", flaeche(SCHNITT)),
            line: [
                [310, 295],
                [310, 325],
            ],
        });
        expect(geschnitten.statusCode, geschnitten.body).toBe(200);
        const { operationId: werkzeug, publicId } = geschnitten.json() as { operationId: string; publicId: string };
        expect((await flaechenZeilen(SCHNITT)).teile).not.toEqual(vorher.teile);
        const [neu] = await cluster.admin<
            { aktiv: boolean }[]
        >`SELECT is_active AS aktiv FROM region WHERE public_id = ${publicId}::uuid`;
        expect(neu!.aktiv).toBe(true);

        const antwort = await zuruecknehmen(anna, SCHNITT, [werkzeug]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((await flaechenZeilen(SCHNITT)).teile).toEqual(vorher.teile);
        const [danach] = await cluster.admin<{ aktiv: boolean; teile: string }[]>`
            SELECT r.is_active AS aktiv, (SELECT count(*) FROM region_area a WHERE a.region_id = r.id AND a.is_active)::text AS teile
              FROM region r WHERE r.public_id = ${publicId}::uuid`;
        expect(danach).toEqual({ aktiv: false, teile: "0" });
    });

    it("🔴 U6: Eine Fremdänderung an der Landschaft nach dem Schritt hält die Rücknahme an: 409 mit Gegenstand, Person und Operation, 0 Änderungen; eine fremde Sperre davor mit 409 `object_locked`", async () => {
        const annas = await ok(
            patch(anna, FREMD, {
                baseRevision: await revision("region", landschaft(FREMD)),
                changes: { name: "Annas Wald" },
            }),
        );
        const berndsOp = await ok(
            patch(bernd, FREMD, {
                baseRevision: await revision("region", landschaft(FREMD)),
                changes: { name: "Berndwald" },
            }),
        );
        const vorher = await stand(FREMD);
        const pruefung = (await vorschau(anna, FREMD, [annas])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "landscape",
                id: landschaft(FREMD),
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        // Der Wert weicht ab: als Schlüssel samt den Feldern.
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "landscape",
                id: landschaft(FREMD),
                felder: ["name"],
                abweichung: { was: "felder" },
            }),
        );
        const antwort = await zuruecknehmen(anna, FREMD, [annas]);
        expect(fehler(antwort)).toEqual([409, "edit_conflict"]);
        expect(await stand(FREMD)).toEqual(vorher);

        // Eine fremde Sperre (U9) hält vor jeder Änderung an.
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('landscape', ${landschaft(FREMD)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())
        `;
        try {
            expect(fehler(await zuruecknehmen(anna, FREMD, [annas]))).toEqual([409, "object_locked"]);
            expect(await stand(FREMD)).toEqual(vorher);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${landschaft(FREMD)}::uuid`;
        }
    });

    it("🔴 U9: ohne Anmeldung 401, mit dem Recht einer Prüferin 403 (Vorschau: `forbidden`), vor jeder Änderung", async () => {
        const annas = await ok(
            patch(anna, WIEDERHOLT, {
                baseRevision: await revision("region", landschaft(WIEDERHOLT)),
                changes: { locked: true },
            }),
        );
        const vorher = await stand(WIEDERHOLT);
        const ohne = await app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(landschaft(WIEDERHOLT)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: [annas], membersHash: mitgliederHash([annas]) },
        });
        expect(ohne.statusCode).toBe(401);
        expect(fehler(await zuruecknehmen(rita, WIEDERHOLT, [annas]))[0]).toBe(403);
        const pruefung = (await vorschau(rita, WIEDERHOLT, [annas])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("forbidden");
        expect(await stand(WIEDERHOLT)).toEqual(vorher);
    });

    it("🔴 U8: Doppelklick und Netzretry: dieselbe Kennung liefert `replayed` ohne neue Operation; eine andere Kennung für dieselbe Liste 409 `already_reverted`", async () => {
        const [annas] = [
            (await liste(anna)).entries.find(
                (e) => e.operation === "landscape.update" && e.objects.some((o) => o.id === landschaft(WIEDERHOLT)),
            )!.operationId,
        ];
        const operationId = randomUUID();
        const erste = await zuruecknehmen(anna, WIEDERHOLT, [annas], { operationId });
        expect(erste.statusCode, erste.body).toBe(200);
        const operationen = await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);
        const zweite = await zuruecknehmen(anna, WIEDERHOLT, [annas], { operationId });
        expect(zweite.statusCode, zweite.body).toBe(200);
        expect(zweite.json()).toMatchObject({ operationId, status: "replayed" });
        expect(await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`)).toBe(
            operationen,
        );
        expect(fehler(await zuruecknehmen(anna, WIEDERHOLT, [annas]))).toEqual([409, "already_reverted"]);
        expect((await flaechenZeilen(WIEDERHOLT)).region[0]).toMatchObject({ is_locked: false });
    });

    it("🔴 Gate 2: Bernd nimmt Annas Änderung zurück; ohne Grund 400 `reason_required` und nichts geschrieben, mit Grund steht er im Eintrag", async () => {
        const vorher = await flaechenZeilen(GRUND);
        const annas = await ok(
            patch(anna, GRUND, {
                baseRevision: await revision("region", landschaft(GRUND)),
                changes: { name: "Annas Name" },
                labels: [
                    {
                        id: beschriftung(GRUND, 1),
                        baseRevision: await revision("map_label", beschriftung(GRUND, 1)),
                        changes: { size: 20 },
                    },
                ],
            }),
        );
        const stehend = await stand(GRUND);
        expect(fehler(await zuruecknehmen(bernd, GRUND, [annas]))).toEqual([400, "reason_required"]);
        expect(await stand(GRUND)).toEqual(stehend);
        const pruefung = (await vorschau(bernd, GRUND, [annas])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            reasonRequired: true,
            fremdePersonen: [{ kind: "person", name: "Anna" }],
        });
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(bernd, GRUND, [annas], {
            operationId,
            reason: "Falsche Fläche bearbeitet",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await flaechenZeilen(GRUND)).toEqual(vorher);
        expect((await eintrag(bernd, operationId)).reason).toBe("Falsche Fläche bearbeitet");
        expect((await eintrag(bernd, annas)).revertedBy).toMatchObject({
            operationId,
            reason: "Falsche Fläche bearbeitet",
        });
    });

    it("🔴 Gebirge und Felder in EINER Operation gehen zusammen zurück (B3-Parität unverändert, dazu die Felder)", async () => {
        const vorherName = "Rücknahmegebirge";
        const mitte = await ok(
            patch(anna, MISCH, {
                baseRevision: await revision("region", landschaft(MISCH)),
                changes: { name: "Neues Gebirge" },
                gebirge: [{ area: flaeche(MISCH), changes: { kammhoehe: 3300 } }],
            }),
        );
        const e = await eintrag(anna, mitte);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["area.gebirge", "region.updated"]);
        const antwort = await zuruecknehmen(anna, MISCH, [mitte]);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const [region] = await cluster.admin<
            { name: string }[]
        >`SELECT name FROM region WHERE public_id = ${landschaft(MISCH)}::uuid`;
        expect(region!.name).toBe(vorherName);
        const [werte] = await cluster.admin<{ maximalhoehe: number | null }[]>`
            SELECT c.maximalhoehe FROM terrain_control c JOIN region_area a ON a.id = c.area_id WHERE a.public_id = ${flaeche(MISCH)}::uuid AND c.is_active`;
        expect(werte?.maximalhoehe ?? null).toBeNull();
    });

    // --- WI-0265 B8c: Anlegen und Beschriftungen -------------------------------------------------------------------------------

    /** Eine neue Fläche über die echte Route („Neue Fläche“): die Operation, die Landschaft und ihre erste Teilfläche. */
    const neueFlaeche = async (
        person: { cookie: string },
        [x0, y0, x1, y1]: [number, number, number, number],
        layer = "vegetation",
    ) => {
        const antwort = await post(person, EDITOR_LANDSCAPES_URL, {
            layer,
            ring: [
                [x0, y0],
                [x1, y0],
                [x1, y1],
                [x0, y1],
            ],
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const q = antwort.json() as { operationId: string; publicId: string; affected: { kind: string; id: string }[] };
        return { operationId: q.operationId, id: q.publicId, area: q.affected.find((e) => e.kind === "area")!.id };
    };
    /** Eine neue Beschriftung über die echte Route (gegen die Revision der Landschaft). */
    const neueBeschriftung = async (person: { cookie: string }, regionId: string, position: [number, number]) => {
        const antwort = await post(person, editorLandscapeLabelsUrl(regionId), {
            baseRevision: await revision("region", regionId),
            position,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const q = antwort.json() as { operationId: string; publicId: string };
        return { operationId: q.operationId, id: q.publicId };
    };
    const serieVon = async (person: { cookie: string }, regionId: string) =>
        (await liste(person)).series?.find((serie) => serie.scope.id === regionId);
    const warnungen = (antwort: Antwort): string[] =>
        ((antwort.json() as { warnings?: { code: string }[] }).warnings ?? []).map((w) => w.code);
    const anzahlOperationen = (): Promise<number> =>
        zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`);

    it("🔴 B8c: Eine Fläche anlegen, umbenennen und beschriften geht als Serie ganz zurück (still gelegt, nie gelöscht, der neue Name bleibt); die Rücknahme der Rücknahme belebt, und noch einmal zurück geht ebenso", async () => {
        const neu = await neueFlaeche(anna, [150, 450, 170, 470]);
        const umbenannt = await ok(
            patch(anna, neu.id, {
                baseRevision: await revision("region", neu.id),
                changes: { name: "Angelegter Wald", type: "wald" },
            }),
        );
        const beschriftet = await neueBeschriftung(anna, neu.id, [155, 455]);
        const angelegt = await flaechenZeilenVon(neu.id);
        expect(angelegt.region[0]).toMatchObject({ name: "Angelegter Wald", region_type: "wald", is_active: true });
        expect(angelegt.teile).toHaveLength(1);
        expect(angelegt.beschriftungen).toHaveLength(1);

        // Das Anlegen eröffnet die Serie (Mitglied, solange der Katalog es führt).
        const mitglieder = [neu.operationId, umbenannt, beschriftet.operationId];
        const serie = await serieVon(anna, neu.id);
        expect(serie).toMatchObject({ size: 3, members: mitglieder });
        const pruefung = (await vorschau(anna, neu.id, mitglieder, serie!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            reasonRequired: false,
            offen: mitglieder,
            folgen: { gegenstaende: 1, gelaende: "veraltet" },
        });
        expect(pruefung.konflikte).toEqual([]);

        const operationen = await anzahlOperationen();
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { operationId, membersHash: serie!.membersHash });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(antwort.json()).toMatchObject({ operationId, status: "applied", reverts: mitglieder });
        expect(await anzahlOperationen()).toBe(operationen + 1);
        // Still gelegt, nichts gelöscht; Name und Art danach bleiben (Zurück heißt „nicht mehr auf der Karte“).
        const still = await flaechenZeilenVon(neu.id);
        expect(still.region[0]).toMatchObject({ name: "Angelegter Wald", region_type: "wald", is_active: false });
        expect(still.teile.map((teil) => teil.is_active)).toEqual([false]);
        expect(still.beschriftungen.map((b) => b.is_active)).toEqual([false]);
        expect(still.teile[0]!.geom).toBe(angelegt.teile[0]!.geom);
        expect(warnungen(antwort)).toContain("terrain_stale");
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["area.retired", "label.retired", "region.retired"]);
        expect((await eintrag(anna, neu.operationId)).status).toBe("bereits_zurueckgenommen");

        // Die Rücknahme der Rücknahme belebt alles wieder, und diese noch einmal zurück: Die Einträge stehen in der Folge des Schreibens (kein Konflikt `revision`).
        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await flaechenZeilenVon(neu.id)).toEqual(angelegt);
        const dritte = await zuruecknehmen(anna, neu.id, [(wieder.json() as { operationId: string }).operationId]);
        expect(dritte.statusCode, dritte.body).toBe(200);
        expect(await flaechenZeilenVon(neu.id)).toEqual(still);
        expect((await eintrag(anna, neu.operationId)).status).toBe("bereits_zurueckgenommen");
    });

    it("🔴 B8c: Seit dem Anlegen hängt etwas an der Fläche (Bernds Beschriftung): 409 ohne Schreiben; nach Bernds Rücknahme geht das Anlegen, mit Grund für eine fremde Person; Doppelklick und zweite Kennung; Recht", async () => {
        const neu = await neueFlaeche(anna, [250, 450, 270, 470]);
        const berndsLabel = await neueBeschriftung(bernd, neu.id, [255, 455]);
        const vorher = await standVon(neu.id);
        const pruefung = (await vorschau(anna, neu.id, [neu.operationId])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "landscape",
                id: neu.id,
                operationId: berndsLabel.operationId,
                changedBy: expect.objectContaining({ name: "Bernd" }),
            }),
        );
        expect(fehler(await zuruecknehmen(anna, neu.id, [neu.operationId]))).toEqual([409, "edit_conflict"]);
        expect(await standVon(neu.id)).toEqual(vorher);

        // Bernd nimmt seine Beschriftung zurück (eine Beschriftung anlegen ist selbst zurücknehmbar); die Rücknahme hebt den Konflikt auf.
        const seine = await zuruecknehmen(bernd, neu.id, [berndsLabel.operationId]);
        expect(seine.statusCode, seine.body).toBe(200);
        expect((await flaechenZeilenVon(neu.id)).beschriftungen.map((b) => b.is_active)).toEqual([false]);

        // Annas Fläche gehört einer anderen Person: ohne Grund 400, nichts geschrieben; mit Grund steht er an jedem Eintrag.
        const danach = await standVon(neu.id);
        expect(fehler(await zuruecknehmen(bernd, neu.id, [neu.operationId]))).toEqual([400, "reason_required"]);
        expect(await standVon(neu.id)).toEqual(danach);
        const operationId = randomUUID();
        const mitGrund = await zuruecknehmen(bernd, neu.id, [neu.operationId], {
            operationId,
            reason: "Doppelt gezeichnet",
        });
        expect(mitGrund.statusCode, mitGrund.body).toBe(200);
        const e = await eintrag(anna, operationId);
        expect(e.objects.length).toBeGreaterThan(0);
        expect(
            e.objects.every(
                (o) => (o.changes["restoreReason"] as { after?: string } | undefined)?.after === "Doppelt gezeichnet",
            ),
        ).toBe(true);
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ is_active: false });

        // Doppelklick: dieselbe Kennung liefert `replayed` ohne neue Operation, eine andere `already_reverted`.
        const anzahl = await anzahlOperationen();
        const nochmal = await zuruecknehmen(bernd, neu.id, [neu.operationId], {
            operationId,
            reason: "Doppelt gezeichnet",
        });
        expect(nochmal.json()).toMatchObject({ operationId, status: "replayed" });
        expect(await anzahlOperationen()).toBe(anzahl);
        expect(fehler(await zuruecknehmen(bernd, neu.id, [neu.operationId], { reason: "x" }))).toEqual([
            409,
            "already_reverted",
        ]);

        // Bernds Rücknahme ist seine: Er nimmt sie ohne Grund zurück, und die Fläche steht wieder auf der Karte.
        const belebt = await zuruecknehmen(bernd, neu.id, [operationId]);
        expect(belebt.statusCode, belebt.body).toBe(200);
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ is_active: true });
        expect((await flaechenZeilenVon(neu.id)).teile.map((teil) => teil.is_active)).toEqual([true]);
        // Eine Prüferin darf das Anlegen nicht zurücknehmen (das Recht der Vorwärtsoperation).
        expect(fehler(await zuruecknehmen(rita, neu.id, [neu.operationId]))[0]).toBe(403);
        expect(((await vorschau(rita, neu.id, [neu.operationId])).json() as RuecknahmePruefung).ergebnis).toBe(
            "forbidden",
        );
    });

    it("🔴 B8c: Eine angelegte Fläche mit Gebirge folgt dem Gebirge-Weg: Fläche still, Kammhöhe wieder leer, in EINER Operation", async () => {
        const neu = await neueFlaeche(anna, [350, 450, 390, 490], "topographie");
        const art = await ok(
            patch(anna, neu.id, { baseRevision: await revision("region", neu.id), changes: { type: "gebirge" } }),
        );
        const werte = await ok(patch(anna, neu.id, { gebirge: [{ area: neu.area, changes: { kammhoehe: 3300 } }] }));
        const kammhoehe = async (): Promise<number | null> =>
            (
                await cluster.admin<{ maximalhoehe: number | null }[]>`
                    SELECT c.maximalhoehe FROM terrain_control c JOIN region_area a ON a.id = c.area_id
                     WHERE a.public_id = ${neu.area}::uuid AND c.is_active`
            )[0]?.maximalhoehe ?? null;
        expect(await kammhoehe()).toBe(3300);
        const mitglieder = [neu.operationId, art, werte];
        const serie = await serieVon(anna, neu.id);
        expect(serie).toMatchObject({ size: 3, members: mitglieder });

        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { membersHash: serie!.membersHash });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await kammhoehe()).toBeNull();
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ region_type: "gebirge", is_active: false });
        expect((await flaechenZeilenVon(neu.id)).teile.map((teil) => teil.is_active)).toEqual([false]);

        // Die Rücknahme der Rücknahme bringt die Fläche und die Kammhöhe wieder.
        const wieder = await zuruecknehmen(anna, neu.id, [(antwort.json() as { operationId: string }).operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await kammhoehe()).toBe(3300);
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ is_active: true });
    });

    it("🔴 B8c: Eine Beschriftung löschen und eine neue anlegen geht als Serie zurück (die gelöschte kehrt zurück, die neue wird still); die Rücknahme der Rücknahme tauscht beide wieder", async () => {
        const vorher = await flaechenZeilen(ETIKETT);
        const geloescht = await ok(
            post(anna, editorLandscapeLabelRetireUrl(landschaft(ETIKETT), beschriftung(ETIKETT, 1)), {
                baseRevision: await revision("region", landschaft(ETIKETT)),
                labelRevision: await revision("map_label", beschriftung(ETIKETT, 1)),
            }),
        );
        const neue = await neueBeschriftung(anna, landschaft(ETIKETT), [910, 105]);
        const nachher = await flaechenZeilen(ETIKETT);
        expect(nachher.beschriftungen.filter((b) => b.is_active)).toHaveLength(2);
        const serie = await serieVon(anna, landschaft(ETIKETT));
        expect(serie).toMatchObject({ size: 2, members: [geloescht, neue.operationId] });

        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, ETIKETT, [geloescht, neue.operationId], {
            operationId,
            membersHash: serie!.membersHash,
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const zurueck = await flaechenZeilen(ETIKETT);
        // Die beiden ursprünglichen Beschriftungen stehen wie vorher, die neue ist da, aber still.
        expect(zurueck.beschriftungen.filter((b) => vorher.beschriftungen.some((v) => v.id === b.id))).toEqual(
            vorher.beschriftungen,
        );
        expect(zurueck.beschriftungen.find((b) => b.id === neue.id)).toMatchObject({ is_active: false });
        expect(zurueck.region).toEqual(vorher.region);
        const e = await eintrag(anna, operationId);
        expect(e.objects.map((o) => o.action).sort()).toEqual(["label.restored", "label.retired"]);

        // Und zurück: die gelöschte wieder weg, die neue wieder da.
        const wieder = await zuruecknehmen(anna, ETIKETT, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect(await flaechenZeilen(ETIKETT)).toEqual(nachher);
    });

    it("🔴 B8c: Eine Fläche anlegen und eine Quelle anhängen geht als Serie ganz zurück (Verknüpfung still gelegt, nie gelöscht); die Rücknahme der Rücknahme belebt Fläche und Verknüpfung, obwohl die Fläche beim Prüfen noch still ist", async () => {
        const adresse = "https://example.test/ruck-flaeche-quelle";
        const [quelle] = await cluster.admin<{ public_id: string }[]>`
            INSERT INTO feature_source (source_key, identity_state, url, title, source_type, is_official, source_system)
            VALUES (${`url:${createHash("sha256").update(adresse, "utf8").digest("hex")}`}, 'final', ${adresse}, 'Ruck-Flaechenquelle', 'regelbuch', TRUE, ${SOURCE})
            RETURNING public_id::text`;
        const neu = await neueFlaeche(anna, [450, 450, 470, 470]);
        const quellenOp = randomUUID();
        const angehaengt = await app.inject({
            method: "POST",
            url: inhalteTraegerQuellenUrl("area", neu.id),
            headers: kopf(anna.cookie),
            payload: {
                operationId: quellenOp,
                aenderungen: [
                    { op: "add", sourceId: quelle!.public_id, vorher: null, referenceKind: "ausfuehrlich", pages: "7" },
                ],
            },
        });
        expect(angehaengt.statusCode, angehaengt.body).toBe(200);
        const verknuepfung = async () =>
            (
                await cluster.admin<{ state: string; is_active: boolean }[]>`
                    SELECT s.state, s.is_active FROM region_source s
                      JOIN region r ON r.id = s.region_id JOIN feature_source f ON f.id = s.source_id
                     WHERE r.public_id = ${neu.id}::uuid AND f.public_id = ${quelle!.public_id}::uuid`
            )[0];
        expect(await verknuepfung()).toMatchObject({ state: "active", is_active: true });

        const mitglieder = [neu.operationId, quellenOp];
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(anna, neu.id, mitglieder, { operationId });
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ is_active: false });
        expect(await verknuepfung()).toMatchObject({ state: "retired", is_active: false });

        const wieder = await zuruecknehmen(anna, neu.id, [operationId]);
        expect(wieder.statusCode, wieder.body).toBe(200);
        expect((await flaechenZeilenVon(neu.id)).region[0]).toMatchObject({ is_active: true });
        expect(await verknuepfung()).toMatchObject({ state: "active", is_active: true });
    });
});
