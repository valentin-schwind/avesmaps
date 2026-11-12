import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_CHANGES_URL,
    editorLandscapeRestoreSeriesPreviewUrl,
    editorLandscapeRestoreSeriesUrl,
    editorLandscapeUrl,
    type MapHistoryPage,
    type RuecknahmePruefung,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import { areaIndex, INPUT_INDEX_VERSION } from "../src/terrain/domain/input-index.ts";
import { fuehreFlussHoehenNach, wasserHoehenProtokoll } from "../src/terrain/fluss-hoehen.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Eine Gebirgsserie atomar zurücknehmen (WI-0265 B3; Fachvertrag C.2, C.3, D, F.1; Testvertrag U2, U3, U4, U5, U6, U8, U9, U13, Gate 2): `POST /api/editor/landscapes/:id/restore-series[/preview]`
 * durch Fastify, als App-Rolle im Wegwerf-Cluster mit den Rollen des VPS. 🔴 Kein Test schreibt in `avesmaps3d_dev`, in die geteilte Testdatenbank oder gegen echte Kartendaten; die Fixtures
 * sind vier kleine Gebirge mit je einem Flussweg, gerechnet wird nichts (die Aufträge des Geländes werden gezählt).
 *
 * Problemfälle: Die Rücknahme der acht „Fertig“ schreibt acht Operationen, stößt acht Ableitungen und acht Geländeketten an, vergisst die Höhen an Flüssen und Seen im Netz oder bringt sie
 * von der falschen Seite zurück; ein mittleres Mitglied wird blind zurückgesetzt und löscht spätere Schritte; eine Fremdänderung (Wert, Sperre, Flusshöhe, die mit ihrem Weg gewandert ist)
 * bleibt unbemerkt oder hinterlässt eine halbe Rücknahme oder einen Folgeauftrag; ein Doppelklick schreibt zweimal; eine fremde Person wird ohne Grund zurückgenommen; unter einem Rezept ohne
 * regionale Rückverteilung meldet die Quittung einen Lauf, der nie entsteht.
 */

const ENV = "ruecknahmegebirge";
const vorlagen = [
    "auth-grants.psql",
    "media-grants.psql",
    "system-grants.psql",
    "map-grants.psql",
    "jobs-grants.psql",
].map((name) => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)));
const describeWithCluster = postgresBin ? describe : describe.skip;
const DOMAIN = "aventuria";
const SOURCE = "test-wi0265-b3";

const ID = (n: number): string => `b3b30265-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** Vier Gebirge: je Landschaft (`ID(n)`), Teilfläche (`ID(n + 0x100)`) und Flussweg (`ID(n + 0x200)`). */
const G1 = 1; // Hauptfall U2, U3, U5, U6, U8, Grund
const G2 = 2; // Flusshöhe wandert NACH dem letzten Schritt
const G3 = 3; // Flusshöhe wandert ZWISCHEN den Schritten
const G4 = 4; // eigene Serie ohne Grund; Rezept ohne regionale Rückverteilung; Einzelrücknahme; Art
const landschaft = (n: number): string => ID(n);
const flaeche = (n: number): string => ID(n + 0x100);
const fluss = (n: number): string => ID(n + 0x200);
/** Der mittlere Stützpunkt des Flusswegs eines Gebirges, an dem die Flusshöhe liegt. */
const MITTE = (n: number): [number, number] => [10 + 30 * (n - 1) + 500, 512];

const punkte = (n: number): [number, number][] => {
    const x = 500 + 30 * (n - 1);
    return [
        [x + 2, 510],
        [x + 10, 512],
        [x + 18, 509],
    ];
};
/** Ein Netz, wie der Reiter es schreibt (Mulden und Höhen an Flüssen und Seen immer, auch leer). */
const netz = (n: number, stufe: 1 | 2 | 3) => {
    const x = 500 + 30 * (n - 1);
    const kamm = { punkte: punkte(n), rang: "haupt" as const };
    return {
        kaemme:
            stufe === 1
                ? [kamm]
                : [
                      {
                          ...kamm,
                          hoehen: [
                              [0, 2100],
                              [2, 1900],
                          ] as [number, number][],
                      },
                      {
                          punkte: [
                              [x + 10, 512],
                              [x + 11, 518],
                          ] as [number, number][],
                          rang: "neben" as const,
                      },
                  ],
        nebengipfel:
            stufe === 1
                ? [{ x: x + 15, y: 504, h: 1800 }]
                : [
                      { x: x + 15, y: 504, h: 1800 },
                      { x: x + 5, y: 516 },
                  ],
        mulden: stufe === 1 ? [] : [{ x: x + 12, y: 506 }],
        flussHoehen: [{ x: MITTE(n)[0], y: MITTE(n)[1], h: stufe === 3 ? 1900 : 1800 }],
        seeHoehen: stufe === 1 ? [] : [{ x: x + 3, y: 503, h: stufe === 3 ? 950 : 900 }],
    };
};

type Antwort = Awaited<ReturnType<FastifyInstance["inject"]>>;

describeWithCluster("Gebirgsserie zurücknehmen (WI-0265 B3, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster;
    let app: FastifyInstance;
    let anna = { id: "", cookie: "" };
    let bernd = { id: "", cookie: "" };
    let rita = { id: "", cookie: "" };
    const aktor = (person: { id: string }): MapActor => ({ kind: "person", personId: person.id, environment: "test" });
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

    /** „Fertig“ am Gebirge `n`: eine Operation `landscape.update` mit EINER Änderung am Gebirge. */
    const fertig = (person: { cookie: string }, n: number, aenderung: Record<string, unknown>): Promise<Antwort> =>
        app.inject({
            method: "PATCH",
            url: editorLandscapeUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: { operationId: randomUUID(), gebirge: [{ area: flaeche(n), changes: aenderung }] },
        });
    const fertigOk = async (
        person: { cookie: string },
        n: number,
        aenderung: Record<string, unknown>,
    ): Promise<string> => {
        const antwort = await fertig(person, n, aenderung);
        expect(antwort.statusCode, antwort.body).toBe(200);
        return (antwort.json() as { operationId: string }).operationId;
    };
    const vorschau = (
        person: { cookie: string },
        n: number,
        members: string[],
        membersHash?: string,
    ): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesPreviewUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: { members, ...(membersHash === undefined ? {} : { membersHash }) },
        });
    const zuruecknehmen = (
        person: { cookie: string },
        n: number,
        members: string[],
        membersHash: string,
        extra: { operationId?: string; reason?: string } = {},
    ): Promise<Antwort> =>
        app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(landschaft(n)),
            headers: kopf(person.cookie),
            payload: {
                operationId: extra.operationId ?? randomUUID(),
                members,
                membersHash,
                ...(extra.reason === undefined ? {} : { reason: extra.reason }),
            },
        });
    /** Die Serie des Gebirges `n` aus der Liste der „Änderungen“ (neueste zuerst). */
    const serie = async (person: { cookie: string }, n: number) => {
        const antwort = await app.inject({
            method: "GET",
            url: `${EDITOR_CHANGES_URL}?limit=200`,
            headers: { cookie: person.cookie },
        });
        expect(antwort.statusCode).toBe(200);
        const seite = antwort.json() as MapHistoryPage;
        return { seite, serie: seite.series?.find((s) => s.scope.id === landschaft(n)) };
    };
    const eintrag = async (person: { cookie: string }, operationId: string) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_CHANGES_URL}/${operationId}`,
                headers: { cookie: person.cookie },
            })
        ).json() as MapHistoryPage["entries"][number];

    const zahl = async (sql: Promise<{ n: string }[]>): Promise<number> => Number((await sql)[0]!.n);
    /** Was eine Rücknahme nie verändern darf, solange sie scheitert: Operationen, Protokoll, Aufträge, Ereignisse, die Gebirgswerte. */
    const stand = async (n: number) => ({
        operationen: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation`),
        protokoll: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_audit_event`),
        verknuepfungen: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation_revert_link`,
        ),
        auftraege: await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job`),
        ereignisse: await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
        ),
        werte: await cluster.admin`
            SELECT c.revision::text, c.gebirgstyp, c.muster, c.maximalhoehe, c.rauschen, c.grat, c.saat
              FROM terrain_control c JOIN region_area a ON a.id = c.area_id WHERE a.public_id = ${flaeche(n)}::uuid`,
        netz: await netzZeilen(n),
    });
    /** Das Netz in den Tafeln, wie die Datenbank es hält. */
    const netzZeilen = async (n: number) => ({
        kaemme: await cluster.admin<{ ordinal: number; rang: string; wkt: string; hoehen: (number | null)[] | null }[]>`
            SELECT e.ordinal, e.rang, ST_AsText(e.geom) AS wkt, to_json(e.heights_schritt) AS hoehen
              FROM terrain_ridge_edge e JOIN region_area a ON a.id = e.area_id WHERE a.public_id = ${flaeche(n)}::uuid ORDER BY e.ordinal`,
        nebengipfel: await cluster.admin<{ wkt: string; h: number | null }[]>`
            SELECT ST_AsText(p.geom) AS wkt, p.height_schritt AS h
              FROM terrain_ridge_point p JOIN region_area a ON a.id = p.area_id WHERE a.public_id = ${flaeche(n)}::uuid ORDER BY p.ordinal`,
        mulden: await cluster.admin<{ wkt: string }[]>`
            SELECT ST_AsText(p.geom) AS wkt
              FROM terrain_hollow_point p JOIN region_area a ON a.id = p.area_id WHERE a.public_id = ${flaeche(n)}::uuid ORDER BY p.ordinal`,
        wasser: await cluster.admin<{ art: string; wkt: string; h: number }[]>`
            SELECT w.art, ST_AsText(w.geom) AS wkt, w.height_schritt AS h
              FROM terrain_water_height w JOIN region_area a ON a.id = w.area_id WHERE a.public_id = ${flaeche(n)}::uuid ORDER BY w.art, w.ordinal`,
    });
    const gelaendeAuftraege = () =>
        cluster.admin<{ public_id: string; kind: string; state: string; coalesced_count: number }[]>`
            SELECT public_id::text, kind, state, coalesced_count FROM job WHERE kind IN ('terrain_local', 'dem_publish') ORDER BY id`;

    /** Der Flussweg bewegt seinen mittleren Stützpunkt; die Flusshöhe wandert in derselben Transaktion mit (WI-0259, `fuehreFlussHoehenNach`), das Protokoll des Wegs hält es als `wasserHoehen`. */
    const verschiebeFluss = async (person: { id: string }, n: number, nach: [number, number]): Promise<string> => {
        const von = MITTE(n);
        const operationId = randomUUID();
        await mapOperation(
            cluster.app,
            aktor(person),
            { operationId, operation: "path.update", mapDomainId: DOMAIN, body: { n, nach } },
            async (tx) => {
                await tx`UPDATE path SET geom = ST_SetPoint(geom, 1, ST_SetSRID(ST_MakePoint(${nach[0]}, ${nach[1]}), 0)) WHERE public_id = ${fluss(n)}::uuid`;
                const hoehen = await fuehreFlussHoehenNach(tx, DOMAIN, [
                    { von: { x: von[0], y: von[1] }, nach: { x: nach[0], y: nach[1] } },
                ]);
                expect(hoehen.umzuege).toHaveLength(1);
                return {
                    receipt: {
                        affected: [{ kind: "path", id: fluss(n) }, ...hoehen.affected],
                        derivedWork: [],
                        warnings: [],
                    },
                    summary: "Flussweg verschoben",
                    entries: [
                        {
                            action: "path.updated",
                            pathId: fluss(n),
                            changes: { wasserHoehen: wasserHoehenProtokoll(hoehen.umzuege) },
                        },
                    ],
                };
            },
        );
        return operationId;
    };

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        for (const n of [G1, G2, G3, G4]) {
            const x = 500 + 30 * (n - 1);
            await m`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, is_active, source_system)
                VALUES (${landschaft(n)}, ${DOMAIN}, ${`Rücknahmegebirge ${String(n)}`}, 'topographie', 'gebirge', ${n}, TRUE, ${SOURCE})
            `;
            await m`
                INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
                SELECT ${flaeche(n)}::uuid, id, ${DOMAIN}, ST_GeomFromText(${`POLYGON((${x} 500, ${x + 20} 500, ${x + 20} 520, ${x} 520, ${x} 500))`}, 0), ${SOURCE}
                  FROM region WHERE public_id = ${landschaft(n)}
            `;
            await m`
                INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                VALUES (${fluss(n)}, ${DOMAIN}, ${`Rücknahmefluss ${String(n)}`}, 'Flussweg',
                        ST_SetSRID(ST_GeomFromText(${`LINESTRING(${punkte(n)
                            .map(([px, py]) => `${String(px)} ${String(py)}`)
                            .join(", ")})`}), 0), ${SOURCE}, TRUE)
            `;
        }
        // Der geltende Master des Geländes: ein Platzhalter mit dem Index der heutigen Eingaben, damit die Schreibnaht das Gelände im Umkreis einreiht (wie `gelaende-lokal-ausloeser.test.ts`).
        await m`
            INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report, input_index)
            VALUES (${DOMAIN}, 'master-b3', 'eingaben-b3', '19', 4096, decode(repeat('0000', 4096 * 4096), 'hex'), '{}',
                    ${m.json({ v: INPUT_INDEX_VERSION, objects: await areaIndex(m, DOMAIN) })})
        `;
        await m`
            INSERT INTO terrain_dem (revision, map_domain_id, fingerprint, tile_size, max_zoom, encoding, tiles, bytes, is_current, domain_fingerprint)
            VALUES ('b3b30265a001', ${DOMAIN}, 'test', 512, 3, 'mapbox', 1, 1, true, 'master-b3')
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

    let ops: string[] = [];
    /** Die Rücknahme der ganzen Serie des ersten Gebirges (Gate 2 und U3). */
    let serienRuecknahme = "";
    let kette: { members: string[]; membersHash: string };

    it("🔴 U2: acht „Fertig“ am selben Gebirge sind acht Operationen mit eigener Kennung und EINE Arbeitsserie", async () => {
        ops = [
            await fertigOk(anna, G1, { werte: { rauschen: 0.5 }, kammhoehe: 3000 }),
            await fertigOk(anna, G1, { netz: netz(G1, 1) }),
            await fertigOk(anna, G1, { modell: { grat: 0.2 } }),
            await fertigOk(anna, G1, { werte: { rauschen: 0.6 } }),
            await fertigOk(anna, G1, { netz: netz(G1, 2) }),
            await fertigOk(anna, G1, { kammhoehe: 3500 }),
            await fertigOk(anna, G1, { saat: 12345 }),
            await fertigOk(anna, G1, { netz: netz(G1, 3) }),
        ];
        expect(new Set(ops).size).toBe(8);
        const { seite, serie: s } = await serie(anna, G1);
        expect(s).toMatchObject({ size: 8, members: ops, scope: { kind: "landscape", id: landschaft(G1) } });
        expect(s!.membersHash).toMatch(/^[0-9a-f]{64}$/u);
        const eigene = seite.entries.filter((e) => e.series?.id === ops[0]);
        expect(eigene.map((e) => e.operationId).sort()).toEqual([...ops].sort());
        expect(eigene.every((e) => e.actor.name === "Anna" && e.status === "ruecknehmbar")).toBe(true);
        kette = { members: ops, membersHash: s!.membersHash };
        // Der Zustand nach den acht: das Netz mit den Höhen an Fluss und See, die Werte, die Saat.
        expect(await netzZeilen(G1)).toMatchObject({
            wasser: [
                { art: "fluss", h: 1900 },
                { art: "see", h: 950 },
            ],
        });
    });

    it("🔴 die Vorschau liest nur: Ergebnis ok, die acht offenen Mitglieder, die Folgen; ohne Recht `forbidden`, ohne Anmeldung 401, nichts geschrieben", async () => {
        const vorher = await stand(G1);
        const antwort = await vorschau(anna, G1, kette.members, kette.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        const pruefung = antwort.json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            offen: kette.members,
            reasonRequired: false,
            konflikte: [],
            folgen: { gegenstaende: 1, gelaende: "lokal" },
        });
        expect(pruefung.mitglieder.map((mitglied) => mitglied.operationId)).toEqual(kette.members);
        // Ein Reviewer sieht die Vorprüfung, darf aber nicht zurücknehmen.
        const reviewer = await vorschau(rita, G1, kette.members, kette.membersHash);
        expect(reviewer.statusCode).toBe(200);
        expect((reviewer.json() as RuecknahmePruefung).ergebnis).toBe("forbidden");
        const verboten = await zuruecknehmen(rita, G1, kette.members, kette.membersHash);
        expect([verboten.statusCode, verboten.json().error.code]).toEqual([403, "forbidden"]);
        const anonym = await app.inject({
            method: "POST",
            url: editorLandscapeRestoreSeriesUrl(landschaft(G1)),
            headers: { origin: TEST_ORIGIN },
            payload: { operationId: randomUUID(), members: kette.members, membersHash: kette.membersHash },
        });
        expect(anonym.statusCode).toBe(401);
        expect(await stand(G1)).toEqual(vorher);
    });

    it("🔴 U5: ein mittleres Mitglied ist überholt und lässt sich nicht einzeln zurücknehmen; 409, nichts geschrieben", async () => {
        const vorher = await stand(G1);
        const mittleres = ops[2]!;
        const pruefung = (await vorschau(anna, G1, [mittleres])).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.mitglieder[0]!.ueberholtDurch).toMatchObject({ operationId: ops[3], position: 4 });
        expect(pruefung.konflikte[0]).toMatchObject({
            art: "ueberholt",
            ueberholtDurch: { operationId: ops[3], position: 4 },
        });
        const antwort = await zuruecknehmen(anna, G1, [mittleres], pruefung.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects[0]).toMatchObject({ art: "ueberholt" });
        expect(await stand(G1)).toEqual(vorher);
    });

    it("🔴 U6: Person B ändert dazwischen ein Feld der Serie: 409 mit Gegenstand, Person und Zeit, 0 Teilmutationen, 0 Aufträge, keine Erfolgsmeldung", async () => {
        const berndsOp = await fertigOk(bernd, G1, { kammhoehe: 4000 });
        const vorher = await stand(G1);
        const pruefung = (await vorschau(anna, G1, kette.members, kette.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "spaeter",
                kind: "area",
                id: flaeche(G1),
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
                // WI-0265 B5d: die Spalten, die Bernd änderte, nicht das Sammelfeld `gebirge` des Protokolls.
                felder: ["maximalhoehe"],
            }),
        );
        // Der Wert weicht ab: als Schlüssel (die Oberfläche schreibt den Satz in der Sprache der Person), mit den Feldern; der deutsche Satz bleibt nur Hinweis.
        const abweichung = pruefung.konflikte.find((konflikt) => konflikt.art === "wert");
        expect(abweichung).toMatchObject({
            kind: "area",
            id: flaeche(G1),
            felder: ["maximalhoehe"],
            abweichung: { was: "felder" },
            detail: expect.stringContaining("maximalhoehe"),
        });
        expect(abweichung?.abweichung?.netzTeile).toBeUndefined();
        const antwort = await zuruecknehmen(anna, G1, kette.members, kette.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({
                kind: "area",
                id: flaeche(G1),
                operationId: berndsOp,
                changedBy: expect.objectContaining({ name: "Bernd" }),
                felder: ["maximalhoehe"],
            }),
        );
        // Auch die 409-Antwort trägt die Abweichung als Schlüssel, damit die Oberfläche sie nach dem Schreiben genauso zeigt wie nach der Vorprüfung.
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ art: "wert", id: flaeche(G1), abweichung: { was: "felder" } }),
        );
        expect(await stand(G1)).toEqual(vorher);
        // Bernd nimmt seine Änderung selbst zurück (Einzelrücknahme, eigene Person: kein Grund nötig). Eine Operation und ihre geltende Rücknahme heben einander auf:
        // Die Serie lässt sich danach wieder zurücknehmen.
        const berndsEintrag = (await serie(bernd, G1)).seite.entries.find((e) => e.operationId === berndsOp)!;
        expect(berndsEintrag.series).toBeUndefined();
        const seinePruefung = (await vorschau(bernd, G1, [berndsOp])).json() as RuecknahmePruefung;
        expect(seinePruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false });
        const seine = await zuruecknehmen(bernd, G1, [berndsOp], seinePruefung.membersHash);
        expect(seine.statusCode, seine.body).toBe(200);
        expect((seine.json() as { reverts: string[] }).reverts).toEqual([berndsOp]);
        expect((await vorschau(anna, G1, kette.members, kette.membersHash)).json()).toMatchObject({ ergebnis: "ok" });
    });

    it("🔴 U9: eine fremde Sperre auf der Landschaft hält die Rücknahme an, vor jeder Änderung", async () => {
        await cluster.admin`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id, since, heartbeat_at)
            VALUES ('landscape', ${landschaft(G1)}::uuid, 'felder', ${bernd.id}::uuid, 'Bernd', ${randomUUID()}::uuid, now(), now())
        `;
        try {
            const vorher = await stand(G1);
            const pruefung = (await vorschau(anna, G1, kette.members, kette.membersHash)).json() as RuecknahmePruefung;
            expect(pruefung.ergebnis).toBe("object_locked");
            expect(pruefung.sperren[0]).toMatchObject({
                kind: "landscape",
                id: landschaft(G1),
                person: { name: "Bernd" },
            });
            const antwort = await zuruecknehmen(anna, G1, kette.members, kette.membersHash);
            expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "object_locked"]);
            expect(await stand(G1)).toEqual(vorher);
        } finally {
            await cluster.admin`DELETE FROM editor_lock WHERE object_id = ${landschaft(G1)}::uuid`;
        }
    });

    it("🔴 Gate 2 und U3, U13: Bernd nimmt Annas Serie zurück; ohne Grund 400 `reason_required` und nichts geschrieben, mit Grund EINE Operation, acht Verknüpfungen, alles vom Vorher, eine Ableitung, eine Kette", async () => {
        const vorher = await stand(G1);
        const ohne = await zuruecknehmen(bernd, G1, kette.members, kette.membersHash);
        expect([ohne.statusCode, ohne.json().error.code]).toEqual([400, "reason_required"]);
        expect(await stand(G1)).toEqual(vorher);
        const pruefung = (await vorschau(bernd, G1, kette.members, kette.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({
            ergebnis: "ok",
            reasonRequired: true,
            fremdePersonen: [{ kind: "person", name: "Anna" }],
        });

        // Die Aufträge des Geländes aus den acht „Fertig“ räumt der Test weg: Gezählt wird, was die Rücknahme selbst anstößt.
        await cluster.admin`DELETE FROM job_event`;
        await cluster.admin`DELETE FROM job`;
        const ereignisse = await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
        );
        const restoresVorher = await zahl(
            cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation WHERE source = 'restore'`,
        );
        const operationId = randomUUID();
        const antwort = await zuruecknehmen(bernd, G1, kette.members, kette.membersHash, {
            operationId,
            reason: "  Falsches Gebirge bearbeitet  ",
        });
        expect(antwort.statusCode, antwort.body).toBe(200);
        const quittung = antwort.json() as {
            operationId: string;
            status: string;
            affected: { kind: string; id: string }[];
            derivedWork: { kind: string; jobId?: string; state: string }[];
            warnings: unknown[];
            reverts: string[];
            mapRevision: number;
        };
        expect(quittung).toMatchObject({ operationId, status: "applied", reverts: kette.members, warnings: [] });
        expect(quittung.affected).toEqual([{ kind: "terrain_control", id: flaeche(G1), revision: expect.any(Number) }]);

        // EINE Operation mit der Quelle restore, acht Verknüpfungen in der Reihenfolge der Serie.
        serienRuecknahme = operationId;
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM map_operation WHERE source = 'restore'`,
            ),
        ).toBe(restoresVorher + 1);
        const [neue] = await cluster.admin<{ source: string; action: string; actor_person_id: string }[]>`
            SELECT source, action, actor_person_id::text FROM map_operation WHERE operation_id = ${operationId}::uuid`;
        expect(neue).toEqual({ source: "restore", action: "landscape.restore_series", actor_person_id: bernd.id });
        const links = await cluster.admin<{ reverted_operation_id: string; position: number }[]>`
            SELECT reverted_operation_id::text, position FROM map_operation_revert_link WHERE restore_operation_id = ${operationId}::uuid ORDER BY position`;
        expect(links.map((l) => [l.position, l.reverted_operation_id])).toEqual(kette.members.map((id, i) => [i, id]));

        // Alle Felder und das Netz stehen auf dem Stand VOR dem ersten Mitglied: keine Werte, kein Netz, keine Höhen an Fluss und See.
        const werte = await cluster.admin`
            SELECT c.gebirgstyp, c.muster, c.maximalhoehe, c.hypsometrie, c.plateau, c.rauschen, c.einschnitt, c.erosion, c.talbreite, c.koernung,
                   c.stufen, c.bergform, c.sattel, c.grat, c.grat_breite, c.talboden, c.erosionsfestigkeit, c.saat, c.is_active
              FROM terrain_control c JOIN region_area a ON a.id = c.area_id WHERE a.public_id = ${flaeche(G1)}::uuid`;
        expect(werte).toHaveLength(1);
        expect(Object.values(werte[0]!).filter((wert) => wert !== null)).toEqual([true]);
        expect(await netzZeilen(G1)).toEqual({ kaemme: [], nebengipfel: [], mulden: [], wasser: [] });

        // Das Fachprotokoll: eine Zeile je Teilfläche, vorher/nachher als Netz im Ganzen, der Grund sichtbar im Eintrag.
        const eintragR = await eintrag(anna, operationId);
        expect(eintragR).toMatchObject({
            source: "restore",
            operation: "landscape.restore_series",
            reverts: kette.members,
            status: "ruecknehmbar",
        });
        expect(eintragR.summary).toContain("8 Änderungen");
        const [gegenstand] = eintragR.objects;
        expect(eintragR.objects).toHaveLength(1);
        expect(gegenstand).toMatchObject({ kind: "area", id: flaeche(G1), action: "area.gebirge" });
        expect(gegenstand!.changes["restoreReason"]).toEqual({ after: "Falsches Gebirge bearbeitet" });
        const wechsel = gegenstand!.changes["gebirge"] as {
            before: Record<string, unknown>;
            after: Record<string, unknown>;
        };
        expect(Object.keys(wechsel.after).sort()).toEqual(Object.keys(wechsel.before).sort());
        expect(wechsel.after["netz"]).toEqual({ kaemme: [], nebengipfel: [] });
        expect(wechsel.before["netz"]).toMatchObject({
            flussHoehen: [{ x: MITTE(G1)[0], y: MITTE(G1)[1], h: 1900 }],
            seeHoehen: [{ h: 950 }],
        });
        expect(wechsel.after["saat"]).toBeNull();
        expect(wechsel.after["rauschen"]).toBeNull();
        // Die Originale zeigen die Rücknahme.
        for (const id of kette.members) {
            const original = await eintrag(anna, id);
            expect(original).toMatchObject({ status: "bereits_zurueckgenommen", revertedBy: { operationId } });
        }

        // U3 und U13: EINE Ableitung (ein Ereignis `map.changed`), höchstens EINE Kette des Geländes, und die Quittung nennt genau die Aufträge, die es gibt.
        expect(
            await zahl(
                cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job_event WHERE kind = 'map.changed'`,
            ),
        ).toBe(ereignisse + 1);
        const auftraege = await gelaendeAuftraege();
        expect(auftraege.filter((a) => a.kind === "terrain_local")).toHaveLength(1);
        expect(quittung.derivedWork.filter((w) => w.kind === "terrain_local")).toHaveLength(1);
        for (const arbeit of quittung.derivedWork.filter(
            (w) => w.kind === "terrain_local" || w.kind === "dem_publish",
        )) {
            expect(auftraege.find((a) => a.public_id === arbeit.jobId)).toMatchObject({
                kind: arbeit.kind,
                state: "QUEUED",
            });
            expect(arbeit.state).toBe("queued");
        }
        expect(
            await zahl(cluster.admin<{ n: string }[]>`SELECT count(*)::text AS n FROM job WHERE kind = 'label_runs'`),
        ).toBe(0);
    });

    it("🔴 U8: dieselbe Kennung gibt `replayed` und dieselbe Quittung, eine andere Kennung für dieselbe Liste `already_reverted`, dieselbe Kennung mit anderem Inhalt `idempotency_key_reused`", async () => {
        const [erste] = await cluster.admin<{ operation_id: string; receipt: Record<string, unknown> }[]>`
            SELECT operation_id::text, receipt FROM map_operation WHERE operation_id = ${serienRuecknahme}::uuid`;
        const vorher = await stand(G1);
        const nochmal = await zuruecknehmen(bernd, G1, kette.members, kette.membersHash, {
            operationId: erste!.operation_id,
            reason: "Falsches Gebirge bearbeitet",
        });
        expect(nochmal.statusCode, nochmal.body).toBe(200);
        expect(nochmal.json()).toMatchObject({ ...erste!.receipt, status: "replayed", reverts: kette.members });
        const andere = await zuruecknehmen(bernd, G1, kette.members, kette.membersHash, { reason: "Noch einmal" });
        expect([andere.statusCode, andere.json().error.code]).toEqual([409, "already_reverted"]);
        expect(andere.json().error.details.revertedBy).toEqual([
            { operationId: erste!.operation_id, at: expect.any(String) },
        ]);
        const verwechselt = await zuruecknehmen(bernd, G1, kette.members, kette.membersHash, {
            operationId: erste!.operation_id,
            reason: "Ein anderer Grund",
        });
        expect([verwechselt.statusCode, verwechselt.json().error.code]).toEqual([409, "idempotency_key_reused"]);
        expect(await stand(G1)).toEqual(vorher);
        // Die Vorschau meldet dasselbe.
        expect(
            ((await vorschau(bernd, G1, kette.members, kette.membersHash)).json() as RuecknahmePruefung).ergebnis,
        ).toBe("already_reverted");
    });

    it("🔴 die Rücknahme einer Rücknahme bringt Werte, Netz und die Höhen an Flüssen und Seen vom Stand nach den acht zurück; die Originale sind wieder offen", async () => {
        const pruefung = (await vorschau(bernd, G1, [serienRuecknahme])).json() as RuecknahmePruefung;
        expect(pruefung).toMatchObject({ ergebnis: "ok", reasonRequired: false });
        const antwort = await zuruecknehmen(bernd, G1, [serienRuecknahme], pruefung.membersHash);
        expect(antwort.statusCode, antwort.body).toBe(200);
        expect(await netzZeilen(G1)).toMatchObject({
            kaemme: [
                { ordinal: 0, rang: "haupt", wkt: "LINESTRING(502 510,510 512,518 509)", hoehen: [2100, null, 1900] },
                { ordinal: 1, rang: "neben", wkt: "LINESTRING(510 512,511 518)" },
            ],
            nebengipfel: [
                { wkt: "POINT(515 504)", h: 1800 },
                { wkt: "POINT(505 516)", h: null },
            ],
            mulden: [{ wkt: "POINT(512 506)" }],
            wasser: [
                { art: "fluss", wkt: "POINT(510 512)", h: 1900 },
                { art: "see", wkt: "POINT(503 503)", h: 950 },
            ],
        });
        const [zeile] = await cluster.admin<{ maximalhoehe: number; rauschen: number; grat: number; saat: number }[]>`
            SELECT c.maximalhoehe, c.rauschen, c.grat, c.saat FROM terrain_control c JOIN region_area a ON a.id = c.area_id WHERE a.public_id = ${flaeche(G1)}::uuid`;
        expect(zeile).toEqual({ maximalhoehe: 3500, rauschen: 0.6, grat: 0.2, saat: 12345 });
        for (const id of kette.members) expect((await eintrag(anna, id)).status).toBe("ruecknehmbar");
        // Die Serie ist wieder ganz offen: Anna kann sie jetzt selbst zurücknehmen, ohne Grund (eigene Serie).
        expect((await vorschau(anna, G1, kette.members, kette.membersHash)).json() as RuecknahmePruefung).toMatchObject(
            { ergebnis: "ok", reasonRequired: false },
        );
    });

    it("🔴 zwei Rücknahmen derselben Serie zugleich (verschiedene Kennungen): genau EINE gewinnt, die andere bekommt 409 und schreibt nichts", async () => {
        const vorher = await stand(G1);
        const [a, b] = await Promise.all([
            zuruecknehmen(anna, G1, kette.members, kette.membersHash),
            zuruecknehmen(bernd, G1, kette.members, kette.membersHash, { reason: "Gleichzeitig" }),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
        const verloren = a.statusCode === 409 ? a : b;
        expect(["already_reverted", "edit_conflict"]).toContain(verloren.json().error.code);
        const nachher = await stand(G1);
        expect(nachher.operationen).toBe(vorher.operationen + 1);
        expect(nachher.verknuepfungen).toBe(vorher.verknuepfungen + 8);
        expect(nachher.ereignisse).toBe(vorher.ereignisse + 1);
        expect(nachher.netz).toEqual({ kaemme: [], nebengipfel: [], mulden: [], wasser: [] });
        // Der Stand für die folgenden Fälle: die Serie ist zurückgenommen, die Änderungen wieder aufheben ist hier nicht nötig.
    });

    it("🔴 eine Flusshöhe, die NACH dem letzten Schritt mit ihrem Weg gewandert ist, hält die Rücknahme an (sonst käme sie an eine Lage ohne Stützpunkt zurück)", async () => {
        const erste = await fertigOk(anna, G2, { netz: netz(G2, 1) });
        const zweite = await fertigOk(anna, G2, { netz: netz(G2, 2) });
        const { serie: s } = await serie(anna, G2);
        expect(s!.members).toEqual([erste, zweite]);
        const weg = await verschiebeFluss(bernd, G2, [MITTE(G2)[0] + 1, MITTE(G2)[1] + 1]);
        // Die Höhe ist mit dem Stützpunkt gewandert (WI-0259).
        expect((await netzZeilen(G2)).wasser).toContainEqual({
            art: "fluss",
            wkt: `POINT(${String(MITTE(G2)[0] + 1)} ${String(MITTE(G2)[1] + 1)})`,
            h: 1800,
        });
        const vorher = await stand(G2);
        const pruefung = (await vorschau(anna, G2, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toContainEqual(
            expect.objectContaining({
                art: "wert",
                kind: "area",
                id: flaeche(G2),
                operationId: weg,
                changedBy: expect.objectContaining({ name: "Bernd" }),
                felder: expect.arrayContaining(["netz"]),
                abweichung: expect.objectContaining({ was: "flusshoehe" }),
            }),
        );
        const antwort = await zuruecknehmen(anna, G2, s!.members, s!.membersHash);
        expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "edit_conflict"]);
        expect(antwort.json().error.details.objects).toContainEqual(
            expect.objectContaining({ art: "wert", abweichung: expect.objectContaining({ was: "flusshoehe" }) }),
        );
        expect(await stand(G2)).toEqual(vorher);
    });

    it("🔴 eine Flusshöhe, die ZWISCHEN den Schritten gewandert ist, hält die Rücknahme ebenfalls an, obwohl der Stand dem nach dem letzten Schritt gleicht", async () => {
        const erste = await fertigOk(anna, G3, { netz: netz(G3, 1) });
        const nach: [number, number] = [MITTE(G3)[0] + 1, MITTE(G3)[1] + 1];
        const weg = await verschiebeFluss(bernd, G3, nach);
        // Der Reiter liest die gewanderte Höhe und schreibt sie mit: Das zweite „Fertig“ trägt sie an der neuen Lage.
        const zweite = await fertigOk(anna, G3, {
            netz: { ...netz(G3, 2), flussHoehen: [{ x: nach[0], y: nach[1], h: 1800 }] },
        });
        const { serie: s } = await serie(anna, G3);
        expect(s!.members).toEqual([erste, zweite]);
        const vorher = await stand(G3);
        const pruefung = (await vorschau(anna, G3, s!.members, s!.membersHash)).json() as RuecknahmePruefung;
        expect(pruefung.ergebnis).toBe("edit_conflict");
        expect(pruefung.konflikte).toHaveLength(1);
        expect(pruefung.konflikte[0]).toMatchObject({
            art: "wert",
            id: flaeche(G3),
            operationId: weg,
            felder: ["netz"],
            // Das Netz selbst weicht nicht ab (der Stand gleicht dem nach dem letzten Schritt): nur die Ursache, keine Teile.
            abweichung: { was: "flusshoehe" },
        });
        expect((await zuruecknehmen(anna, G3, s!.members, s!.membersHash)).statusCode).toBe(409);
        expect(await stand(G3)).toEqual(vorher);
        // Das letzte Mitglied allein geht: Seine Kette beginnt hinter dem Umzug.
        const einzel = (await vorschau(anna, G3, [zweite])).json() as RuecknahmePruefung;
        expect(einzel.ergebnis).toBe("ok");
    });

    describe("eigene Serie, Rezept ohne regionale Rückverteilung, Einzelrücknahme, Art", () => {
        let a: string;
        let b: string;
        let c: string;
        let zwei: { members: string[]; membersHash: string };

        it("🔴 die Serie wuchs seit dem Öffnen: 409 `series_changed` mit der neuen Liste, nichts geschrieben", async () => {
            a = await fertigOk(anna, G4, { werte: { sattel: 0.5 } });
            b = await fertigOk(anna, G4, { netz: netz(G4, 1) });
            const { serie: s } = await serie(anna, G4);
            zwei = { members: s!.members, membersHash: s!.membersHash };
            expect(zwei.members).toEqual([a, b]);
            c = await fertigOk(anna, G4, { netz: netz(G4, 3) });
            const { serie: neu } = await serie(anna, G4);
            const vorher = await stand(G4);
            const antwort = await zuruecknehmen(anna, G4, zwei.members, zwei.membersHash);
            expect([antwort.statusCode, antwort.json().error.code]).toEqual([409, "series_changed"]);
            expect(antwort.json().error.details).toEqual({ members: [a, b, c], membersHash: neu!.membersHash });
            expect(await stand(G4)).toEqual(vorher);
            zwei = { members: neu!.members, membersHash: neu!.membersHash };
        });

        it("🔴 eine Liste, die nicht zur Landschaft gehört oder deren Prüfsumme nicht passt, ist 400 `invalid_members`", async () => {
            const vorher = await stand(G4);
            const fremd = await zuruecknehmen(anna, G4, [ops[0]!], zwei.membersHash);
            expect([fremd.statusCode, fremd.json().error.code]).toEqual([400, "invalid_members"]);
            const unbekannt = await zuruecknehmen(anna, G4, [randomUUID()], zwei.membersHash);
            expect([unbekannt.statusCode, unbekannt.json().error.code]).toEqual([400, "invalid_members"]);
            const falscheSumme = await zuruecknehmen(anna, G4, zwei.members, "0".repeat(64));
            expect([falscheSumme.statusCode, falscheSumme.json().error.details]).toEqual([400, { reason: "hash" }]);
            expect(await stand(G4)).toEqual(vorher);
        });

        it("🔴 U4, U13: unter einem Rezept ohne regionale Rückverteilung geht nur das letzte Mitglied einzeln; es entsteht kein Lauf, und die Quittung sagt `terrain_stale` statt „aktualisiert“", async () => {
            await cluster.admin`INSERT INTO terrain_recipe_choice (map_domain_id, version) VALUES (${DOMAIN}, 17)`;
            try {
                await cluster.admin`DELETE FROM job_event`;
                await cluster.admin`DELETE FROM job`;
                const pruefung = (await vorschau(anna, G4, [c])).json() as RuecknahmePruefung;
                expect(pruefung).toMatchObject({ ergebnis: "ok", folgen: { gegenstaende: 1, gelaende: "veraltet" } });
                const antwort = await zuruecknehmen(anna, G4, [c], pruefung.membersHash);
                expect(antwort.statusCode, antwort.body).toBe(200);
                const quittung = antwort.json() as {
                    derivedWork: { kind: string }[];
                    warnings: { code: string }[];
                    reverts: string[];
                };
                expect(quittung.reverts).toEqual([c]);
                expect(quittung.warnings).toEqual([{ code: "terrain_stale", message: expect.any(String) }]);
                expect(quittung.derivedWork.map((w) => w.kind)).toEqual(["tiles"]);
                expect(await gelaendeAuftraege()).toEqual([]);
                // Das Netz steht wieder auf dem Stand nach dem zweiten Schritt: die Flusshöhe von dort (1800 statt 1900), die Seehöhe des dritten ist weg.
                const nachC = await netzZeilen(G4);
                expect(nachC.wasser).toEqual([{ art: "fluss", wkt: "POINT(600 512)", h: 1800 }]);
                expect(nachC.kaemme).toHaveLength(1);
                // Die ganze Liste: das dritte Mitglied ist schon zurückgenommen, die Rücknahme betrifft nur die zwei offenen (`reverts`), ohne Grund (eigene Serie).
                const ganz = (await vorschau(anna, G4, zwei.members, zwei.membersHash)).json() as RuecknahmePruefung;
                expect(ganz).toMatchObject({ ergebnis: "ok", offen: [a, b], reasonRequired: false });
                const alle = await zuruecknehmen(anna, G4, zwei.members, zwei.membersHash);
                expect(alle.statusCode, alle.body).toBe(200);
                expect((alle.json() as { reverts: string[] }).reverts).toEqual([a, b]);
                expect(await netzZeilen(G4)).toEqual({ kaemme: [], nebengipfel: [], mulden: [], wasser: [] });
                expect(await gelaendeAuftraege()).toEqual([]);
            } finally {
                await cluster.admin`DELETE FROM terrain_recipe_choice`;
            }
        });
    });
});
