import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OperationReceipt } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import { createDatabase } from "../src/database.ts";
import { mapOperation, type MapActor } from "../src/editor/map-operation.ts";
import { rechneSprachTreffer } from "../src/jobs/sprachen-treffer-job.ts";
import { sprachenDesObjekts, trefferDerSprache } from "../src/sprachen/treffer.ts";
import {
    alleSprachTrefferNeuRechnenLassen,
    SPRACHE_TREFFER_JOB_KIND,
    SPRACHE_TREFFER_RUHE_S,
    sprachTrefferEinreihen,
    sprachTrefferNeuRechnenLassen,
    umfangAus,
    type TrefferUmfang,
} from "../src/sprachen/treffer-auftrag.ts";
import type { SpracheMitTreffer } from "../src/sprachen/typen.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Treffer der Sprachen (WI-0261 S4, Migration 0256) gegen echtes PostGIS, so wie auf dem VPS: Wegwerf-Cluster mit Migrations-, App- und
 * Jobs-Rolle und den Vorlagen. Gerechnet wird als Jobs-Rolle, eingereiht als App-Rolle. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: überlappende Teilflächen derselben Sprache zählen doppelt; eine stillgelegte Fläche zählt; ein Meer, eine versteckte Region, eine
 * Klimafläche oder etwas außerhalb der Karte (`off_map`) bekommt Treffer; eine historische Gebietsfläche (nicht im Jahr der Karte) zählt mit; ein Lauf je Sprache oder je Objekt fasst fremde Treffer an; der Lesefilter verschluckt einen Ort oder lässt
 * eine Fläche unter der Schwelle durch; eine Operation ohne Sprachflächen reiht einen leeren Auftrag ein; zwei Anlässe ergeben zwei Aufträge; die
 * App darf die Treffer schreiben oder die Jobs-Rolle sie ändern oder leeren.
 *
 * Die kleine Welt (Karteneinheiten, Ursprung 300/300): Sprache A aus zwei überlappenden Quadraten (300–400 und 350–450 in x, 300–400 in y) und einer
 * stillgelegten Fläche (y 500–600), Sprache B 400–500 × 300–400. Ein Gebiet aus zwei Flächen (300–500 × 300–350), zwei Regionen, drei Flächen, die
 * nicht zählen, zwei Wege.
 */

const ENV = "sprtreffer";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777784-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const ORT = { p1: ID(1), p2: ID(2), p3: ID(3), p4: ID(4) };
const GEBIET = ID(0x10);
const GEBIETSFLAECHE = { g1: ID(0x11), g2: ID(0x12), alt: ID(0x13) };
const REGION = {
    wald: ID(0x20),
    gegend: ID(0x21),
    meer: ID(0x22),
    versteckt: ID(0x23),
    klima: ID(0x24),
    abseits: ID(0x25),
};
const REGIONSFLAECHE = {
    wald: ID(0x30),
    gegend: ID(0x31),
    meer: ID(0x32),
    versteckt: ID(0x33),
    klima: ID(0x34),
    abseits: ID(0x35),
};
const WEG = { lang: ID(0x40), kurz: ID(0x41), abseits: ID(0x42) };
const SPRACHFLAECHE = { a1: ID(0x51), a2: ID(0x52), aStill: ID(0x53), b1: ID(0x54) };
const SCHLUESSEL = { a: "s4test-alpha", b: "s4test-beta" };
const QUELLE = "e0619e909dcc".padEnd(64, "0");

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

interface Zeile {
    art: string;
    objekt: string;
    sprache: string;
    anteil: number;
    um: string;
}

describeWithCluster("Treffer der Sprachen (WI-0261 S4, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    let app: FastifyInstance | undefined;
    const sprachId: Record<"a" | "b", string> = { a: "", b: "" };
    const actor: MapActor = { kind: "person", personId: randomUUID(), environment: "test" };

    const db = (): VpsCluster => cluster!;
    /** Alle Treffer, lesbar sortiert; `um` ist die Zeit des Schreibens. */
    const treffer = async (): Promise<Zeile[]> =>
        db().admin<Zeile[]>`
            SELECT t.objekt_art AS art, t.objekt_public_id::text AS objekt, s.schluessel AS sprache, t.anteil,
                   t.berechnet_at::text AS um
              FROM sprache_treffer t JOIN sprache s ON s.id = t.sprache_id
             ORDER BY t.objekt_art, t.objekt_public_id, s.schluessel
        `;
    const anteil = (zeilen: Zeile[], objekt: string, sprache: string): number | undefined =>
        zeilen.find((zeile) => zeile.objekt === objekt && zeile.sprache === sprache)?.anteil;
    const sprachenVon = (zeilen: Zeile[], objekt: string): string[] =>
        zeilen.filter((zeile) => zeile.objekt === objekt).map((zeile) => zeile.sprache);
    const auftraege = async (): Promise<
        { public_id: string; input_ref: Record<string, unknown>; wartet_s: number }[]
    > =>
        db().admin`
            SELECT public_id::text, input_ref, round(extract(epoch FROM (not_before - queued_at)))::int AS wartet_s
              FROM job WHERE kind = ${SPRACHE_TREFFER_JOB_KIND} AND state = 'QUEUED' ORDER BY id
        `;
    /** Eine Operation an der Karte als App-Rolle; `work` meldet nur, was sie berührt hat. */
    const speichere = (affected: OperationReceipt["affected"]): Promise<OperationReceipt> =>
        mapOperation(
            db().app,
            actor,
            { operationId: randomUUID(), operation: "place.update", mapDomainId: "aventuria", body: {} },
            async () => ({ receipt: { affected, derivedWork: [], warnings: [] }, entries: [] }),
        );
    /** Ein Lauf als Jobs-Rolle mit dem Umfang, den der Auftrag in der Warteschlange trägt. */
    const rechne = (umfang: TrefferUmfang): Promise<Record<string, unknown>> =>
        rechneSprachTreffer(db().jobs, "aventuria", umfang);

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        const punkt = (x: number, y: number) => m`ST_SetSRID(ST_MakePoint(${x}, ${y}), 0)`;
        await m`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${ORT.p1}, 'aventuria', 'S4 Alpha', 'dorf', ${punkt(325, 350)}, 'test', TRUE),
                   (${ORT.p2}, 'aventuria', 'S4 Misch', 'dorf', ${punkt(425, 350)}, 'test', TRUE),
                   (${ORT.p3}, 'aventuria', 'S4 Still', 'dorf', ${punkt(350, 550)}, 'test', TRUE),
                   (${ORT.p4}, 'aventuria', 'S4 Beta', 'dorf', ${punkt(475, 350)}, 'test', TRUE)
        `;
        const [gebiet] = await m<{ id: string }[]>`
            INSERT INTO territory (public_id, map_domain_id, name, color, opacity, source_system)
            VALUES (${GEBIET}, 'aventuria', 'S4 Baronie', '#336699', 0.5, 'test') RETURNING id::text
        `;
        await m`
            INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system)
            VALUES (${GEBIETSFLAECHE.g1}, ${gebiet!.id}, 'aventuria', ST_GeomFromText(${quadrat(300, 300, 400, 350)}, 0), 'test'),
                   (${GEBIETSFLAECHE.g2}, ${gebiet!.id}, 'aventuria', ST_GeomFromText(${quadrat(400, 300, 500, 350)}, 0), 'test')
        `;
        // Eine historische Fläche (bis 100 BF): Sie liegt ganz in A und darf das Gebiet nicht vergrößern.
        await m`
            INSERT INTO territory_area (public_id, territory_id, map_domain_id, geom, source_system, valid_from_bf, valid_to_bf)
            VALUES (${GEBIETSFLAECHE.alt}, ${gebiet!.id}, 'aventuria', ST_GeomFromText(${quadrat(300, 350, 400, 400)}, 0), 'test', 0, 100)
        `;
        const region = async (
            id: string,
            flaeche: string,
            layer: string,
            typ: string,
            wkt: string,
            versteckt = false,
            abseits = false,
        ): Promise<void> => {
            const [zeile] = await m<{ id: string }[]>`
                INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, is_active, is_hidden, off_map)
                VALUES (${id}, 'aventuria', ${`S4 ${typ}`}, ${layer}, ${typ}, TRUE, ${versteckt}, ${abseits}) RETURNING id::text
            `;
            await m`
                INSERT INTO region_area (public_id, map_domain_id, region_id, geom, is_active)
                VALUES (${flaeche}, 'aventuria', ${zeile!.id}, ST_GeomFromText(${wkt}, 0), TRUE)
            `;
        };
        await region(REGION.wald, REGIONSFLAECHE.wald, "vegetation", "wald", quadrat(440, 300, 540, 400));
        await region(REGION.gegend, REGIONSFLAECHE.gegend, "derographisch", "region", quadrat(495, 300, 595, 400));
        await region(REGION.meer, REGIONSFLAECHE.meer, "topographie", "meer", quadrat(300, 300, 350, 350));
        await region(
            REGION.versteckt,
            REGIONSFLAECHE.versteckt,
            "vegetation",
            "wald",
            quadrat(300, 300, 350, 350),
            true,
        );
        await region(REGION.klima, REGIONSFLAECHE.klima, "klima", "gemaessigt", quadrat(300, 300, 350, 350));
        await region(
            REGION.abseits,
            REGIONSFLAECHE.abseits,
            "vegetation",
            "wald",
            quadrat(300, 300, 350, 350),
            false,
            true,
        );
        await m`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${WEG.lang}, 'aventuria', 'S4 Reichsstraße', 'Reichsstrasse', ST_GeomFromText('LINESTRING(300 375,500 375)', 0), 'test', TRUE),
                   (${WEG.kurz}, 'aventuria', 'S4 Pfad', 'Pfad', ST_GeomFromText('LINESTRING(445 380,460 380)', 0), 'test', TRUE)
        `;
        await m`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system, is_active, off_map)
            VALUES (${WEG.abseits}, 'aventuria', 'S4 Abseits', 'Pfad', ST_GeomFromText('LINESTRING(310 310,340 310)', 0), 'test', TRUE, TRUE)
        `;
    }, 300_000);

    afterAll(async () => {
        await app?.close();
        await cluster?.stop();
    }, 60_000);

    /** Legt die Sprachen an: A aus zwei überlappenden Quadraten und einer stillgelegten Fläche, B daneben. */
    const legeSprachenAn = async (): Promise<void> => {
        const m = db().migrator;
        for (const [k, schluessel, farbe] of [
            ["a", SCHLUESSEL.a, "#aa0000"],
            ["b", SCHLUESSEL.b, "#00aa00"],
        ] as const) {
            const [zeile] = await m<{ id: string }[]>`
                INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
                VALUES (${schluessel}, ${schluessel.toUpperCase()}, ${farbe}, 1, 'sprachenkarte') RETURNING public_id::text AS id
            `;
            sprachId[k] = zeile!.id;
        }
        const flaeche = async (id: string, schluessel: string, wkt: string, still = false): Promise<void> => {
            await m`
                INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision, is_active, retired_at,
                                             retired_origin)
                VALUES (${id}, (SELECT id FROM sprache WHERE schluessel = ${schluessel}), 'aventuria', ST_GeomFromText(${wkt}, 0),
                        'sprachenkarte', ${QUELLE}, ${!still}, ${still ? m`now()` : null}, ${still ? "editor" : null})
            `;
        };
        await flaeche(SPRACHFLAECHE.a1, SCHLUESSEL.a, quadrat(300, 300, 400, 400));
        await flaeche(SPRACHFLAECHE.a2, SCHLUESSEL.a, quadrat(350, 300, 450, 400));
        await flaeche(SPRACHFLAECHE.aStill, SCHLUESSEL.a, quadrat(300, 500, 400, 600), true);
        await flaeche(SPRACHFLAECHE.b1, SCHLUESSEL.b, quadrat(400, 300, 500, 400));
    };

    it("liest den Umfang eines Auftrags und lehnt alles andere ab", () => {
        expect(umfangAus({ alle: true })).toEqual({ alle: true });
        expect(umfangAus({ sprachen: [ID(1)] })).toEqual({ sprachen: [ID(1)], objekte: {} });
        expect(umfangAus({ objekte: { place: [ID(1)], path: [] } })).toEqual({
            sprachen: [],
            objekte: { place: [ID(1)] },
        });
        for (const kaputt of [
            {},
            { alle: false },
            { sprachen: [] },
            { sprachen: ["garethi"] },
            { objekte: { berg: [ID(1)] } },
            { objekte: [ID(1)] },
            { umfang: "alle" },
        ])
            expect(umfangAus(kaputt as Record<string, unknown>), JSON.stringify(kaputt)).toBeNull();
    });

    it("🔴 ohne aktive Sprachfläche reiht eine Operation an der Karte nichts ein", async () => {
        const quittung = await speichere([{ kind: "place", id: ORT.p1 }]);
        expect(quittung.derivedWork.some((arbeit) => arbeit.kind === SPRACHE_TREFFER_JOB_KIND)).toBe(false);
        expect(await auftraege()).toEqual([]);
    });

    it("🔴 eine Operation reiht EINEN Auftrag für ihre Objekte ein; weitere Anlässe vereinigen den Umfang, ein Lauf über alles schluckt alles", async () => {
        await legeSprachenAn();
        const erste = await speichere([
            { kind: "place", id: ORT.p1 },
            { kind: "territory_area", id: GEBIETSFLAECHE.g1 },
            { kind: "area", id: REGIONSFLAECHE.wald },
        ]);
        const [auftrag] = await auftraege();
        expect(auftrag).toBeDefined();
        expect(erste.derivedWork).toContainEqual({
            kind: SPRACHE_TREFFER_JOB_KIND,
            jobId: auftrag!.public_id,
            state: "queued",
        });
        // Eine Fläche zählt für ihr Gebiet und ihre Landschaft; gewartet wird die Ruhe.
        expect(auftrag!.input_ref).toEqual({
            objekte: { place: [ORT.p1], territory: [GEBIET], region: [REGION.wald] },
        });
        expect(auftrag!.wartet_s).toBe(SPRACHE_TREFFER_RUHE_S);
        const [bereich] = await db().admin<{ art: string; kacheln: number }[]>`
            SELECT scope_kind AS art, cardinality(scope_tiles)::int AS kacheln FROM job WHERE public_id = ${auftrag!.public_id}::uuid
        `;
        expect(bereich).toEqual({ art: "tiles", kacheln: 0 });

        // Zweiter Anlass, dazu eine Sprache vom Spracheditor: derselbe Auftrag, vereinigt und ohne Doppel.
        await speichere([
            { kind: "place", id: ORT.p1 },
            { kind: "place", id: ORT.p2 },
            { kind: "path", id: WEG.lang },
        ]);
        const jobs = await db().app.begin((tx) =>
            sprachTrefferNeuRechnenLassen(tx, actor.personId, "aventuria", [sprachId.b]),
        );
        const vereint = await auftraege();
        expect(vereint.map((zeile) => zeile.public_id)).toEqual([auftrag!.public_id]);
        expect(jobs).toBe(auftrag!.public_id);
        expect(vereint[0]!.input_ref).toEqual({
            sprachen: [sprachId.b],
            objekte: {
                place: [ORT.p1, ORT.p2].sort(),
                territory: [GEBIET],
                region: [REGION.wald],
                path: [WEG.lang],
            },
        });
        // Eine Übernahme des WikiSync reiht als Jobs-Rolle ein (sie ist eine Operation an der Karte).
        await db().jobs.begin((tx) =>
            sprachTrefferEinreihen(tx, "system:wikisync", "aventuria", { objekte: { path: [WEG.kurz] } }),
        );
        expect((await auftraege())[0]!.input_ref).toMatchObject({ objekte: { path: [WEG.lang, WEG.kurz].sort() } });
        // Der Import: ein Lauf über alles.
        await db().app.begin((tx) => alleSprachTrefferNeuRechnenLassen(tx, "system:import", "aventuria"));
        const alle = await auftraege();
        expect(alle).toHaveLength(1);
        expect(alle[0]!.input_ref).toEqual({ alle: true });
        // Ein leerer Umfang ist ein Fehler des Aufrufers.
        await expect(
            db().app.begin((tx) => sprachTrefferEinreihen(tx, "x", "aventuria", { sprachen: [] })),
        ).rejects.toMatchObject({ code: "22023" });
    });

    it("🔴 voller Lauf als Jobs-Rolle: Punkt in Fläche, Flächen- und Längenanteile, überlappende Teilflächen einer Sprache zählen einmal", async () => {
        const [auftrag] = await auftraege();
        const umfang = umfangAus(auftrag!.input_ref);
        expect(umfang).toEqual({ alle: true });
        const bericht = await rechne(umfang!);
        expect(bericht).toMatchObject({ status: "gerechnet", umfang: { alle: true } });
        const zeilen = await treffer();
        const { a, b } = SCHLUESSEL;
        // Orte: jede Sprache, in deren Fläche sie liegen; die stillgelegte Fläche zählt nicht.
        expect(sprachenVon(zeilen, ORT.p1)).toEqual([a]);
        expect(sprachenVon(zeilen, ORT.p2)).toEqual([a, b]);
        expect(sprachenVon(zeilen, ORT.p3)).toEqual([]);
        expect(sprachenVon(zeilen, ORT.p4)).toEqual([b]);
        expect(anteil(zeilen, ORT.p2, a)).toBe(1);
        // Gebiet aus zwei Flächen (10 000 E²): A 7 500 (nicht 10 000: die Überlappung von A1 und A2 zählt einmal), B 5 000. Die historische
        // Fläche zählt nicht (sonst A 12 500 von 15 000).
        expect(anteil(zeilen, GEBIET, a)).toBeCloseTo(0.75, 3);
        expect(anteil(zeilen, GEBIET, b)).toBeCloseTo(0.5, 3);
        // Regionen: der Wald zu 10 % A und 60 % B, die Gegend zu genau 5 % B; Meer, versteckte und Klimafläche nie.
        expect(anteil(zeilen, REGION.wald, a)).toBeCloseTo(0.1, 3);
        expect(anteil(zeilen, REGION.wald, b)).toBeCloseTo(0.6, 3);
        expect(sprachenVon(zeilen, REGION.gegend)).toEqual([b]);
        expect(anteil(zeilen, REGION.gegend, b)).toBeCloseTo(0.05, 3);
        for (const ohne of [REGION.meer, REGION.versteckt, REGION.klima, REGION.abseits, WEG.abseits])
            expect(sprachenVon(zeilen, ohne)).toEqual([]);
        // Wege: Anteil an der Länge.
        expect(anteil(zeilen, WEG.lang, a)).toBeCloseTo(0.75, 3);
        expect(anteil(zeilen, WEG.lang, b)).toBeCloseTo(0.5, 3);
        expect(anteil(zeilen, WEG.kurz, a)).toBeCloseTo(1 / 3, 3);
        expect(anteil(zeilen, WEG.kurz, b)).toBeCloseTo(1, 3);
        expect(zeilen).toHaveLength(13);
        // Ein zweiter voller Lauf ersetzt, statt zu doppeln.
        await rechne({ alle: true });
        expect(await treffer()).toHaveLength(13);
    });

    it("🔴 Lesefilter: Orte immer, Flächen und Wege ab dem Mindestanteil (0 heißt jede Berührung); die Route nennt die Zahlen nach der Vorgabe 5 %", async () => {
        const leser = db().app;
        const namen = async (
            art: Parameters<typeof sprachenDesObjekts>[1],
            id: string,
            min: number,
        ): Promise<string[]> => (await sprachenDesObjekts(leser, art, id, min)).map((zeile) => zeile.schluessel);
        // Der größte Anteil zuerst.
        expect(await namen("region", REGION.wald, 0)).toEqual([SCHLUESSEL.b, SCHLUESSEL.a]);
        expect(await namen("region", REGION.wald, 0.2)).toEqual([SCHLUESSEL.b]);
        expect(await namen("region", REGION.gegend, 0.05)).toEqual([SCHLUESSEL.b]);
        expect(await namen("region", REGION.gegend, 0.06)).toEqual([]);
        expect(await namen("path", WEG.kurz, 0.5)).toEqual([SCHLUESSEL.b]);
        expect(await namen("place", ORT.p2, 0.99)).toEqual([SCHLUESSEL.a, SCHLUESSEL.b]);
        expect(await sprachenDesObjekts(leser, "territory", GEBIET, 0)).toEqual([
            { id: sprachId.a, schluessel: SCHLUESSEL.a, name: "S4TEST-ALPHA", farbe: "#aa0000", anteil: 0.75 },
            { id: sprachId.b, schluessel: SCHLUESSEL.b, name: "S4TEST-BETA", farbe: "#00aa00", anteil: 0.5 },
        ]);
        expect(await trefferDerSprache(leser, SCHLUESSEL.b, 0.05)).toEqual({
            orte: 2,
            gebiete: 1,
            regionen: 2,
            wege: 2,
        });
        expect(await trefferDerSprache(leser, SCHLUESSEL.b, 0.55)).toEqual({
            orte: 2,
            gebiete: 0,
            regionen: 1,
            wege: 1,
        });
        expect(await trefferDerSprache(leser, "s4test-gibt-es-nicht", 0)).toBeNull();

        const o = db().app.options as unknown as { host: string[]; port: number[]; user: string; database: string };
        app = buildApp({
            config: { port: 0, host: "127.0.0.1", releaseId: "test", databaseUrl: undefined, tileRoot: undefined },
            database: createDatabase(`postgres://${o.user}@${o.host[0]!}:${String(o.port[0])}/${o.database}`, {
                max: 2,
            }),
            logStream: { write: () => undefined },
        });
        await app.ready();
        const antwort = await app.inject({ url: `/api/sprachen/${SCHLUESSEL.b}` });
        expect(antwort.statusCode).toBe(200);
        expect(antwort.json<SpracheMitTreffer>()).toMatchObject({
            schluessel: SCHLUESSEL.b,
            treffer: { orte: 2, gebiete: 1, regionen: 2, wege: 2 },
        });
        // Die Schwelle der Karteneinstellungen gilt: 55 % (wie eine Änderung im Panel „Sprachen“).
        await db().admin`
            INSERT INTO map_setting (key, value, changed_at, changed_by_label) VALUES ('sprachenMindestanteil', '55'::jsonb, now(), 'test')
        `;
        const verstellt = await app.inject({ url: `/api/sprachen/${SCHLUESSEL.b}` });
        expect(verstellt.json<SpracheMitTreffer>().treffer).toEqual({ orte: 2, gebiete: 0, regionen: 1, wege: 1 });
        expect(verstellt.headers["etag"]).not.toBe(antwort.headers["etag"]);
        await db().admin`DELETE FROM map_setting WHERE key = 'sprachenMindestanteil'`;
    });

    it("🔴 ein Lauf je Sprache bestimmt nur ihre Treffer neu: eine stillgelegte Teilfläche zählt danach nicht mehr", async () => {
        const vorher = await treffer();
        await db().migrator`
            UPDATE sprache_flaeche SET is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE public_id = ${SPRACHFLAECHE.a2}
        `;
        expect(await rechne({ sprachen: [sprachId.a] })).toMatchObject({
            status: "gerechnet",
            umfang: { sprachen: 1 },
        });
        const nachher = await treffer();
        const { a, b } = SCHLUESSEL;
        // A ist jetzt nur noch 300–400 in x.
        expect(sprachenVon(nachher, ORT.p2)).toEqual([b]);
        expect(anteil(nachher, GEBIET, a)).toBeCloseTo(0.5, 3);
        expect(anteil(nachher, REGION.wald, a)).toBeUndefined();
        expect(anteil(nachher, WEG.lang, a)).toBeCloseTo(0.5, 3);
        expect(anteil(nachher, WEG.kurz, a)).toBeUndefined();
        // B ist unberührt: dieselben Zeilen, zur selben Zeit geschrieben.
        expect(nachher.filter((zeile) => zeile.sprache === b)).toEqual(vorher.filter((zeile) => zeile.sprache === b));
    });

    it("🔴 ein Lauf je Objekt: ein verschobener Ort ändert nur seine eigenen Treffer", async () => {
        const vorher = await treffer();
        await db().migrator`UPDATE place SET geom = ST_SetSRID(ST_MakePoint(325, 360), 0) WHERE public_id = ${ORT.p4}`;
        expect(await rechne({ objekte: { place: [ORT.p4] } })).toMatchObject({
            status: "gerechnet",
            umfang: { sprachen: 0, objekte: { place: 1, territory: 0, region: 0, path: 0 } },
        });
        const nachher = await treffer();
        expect(sprachenVon(nachher, ORT.p4)).toEqual([SCHLUESSEL.a]);
        const ohneP4 = (zeilen: Zeile[]): Zeile[] => zeilen.filter((zeile) => zeile.objekt !== ORT.p4);
        expect(ohneP4(nachher)).toEqual(ohneP4(vorher));
    });

    it("🔴 Rechte: die App liest nur, die Jobs-Rolle legt an und löscht, ändert und leert nie", async () => {
        const zeile = `INSERT INTO sprache_treffer (objekt_art, objekt_public_id, sprache_id, map_domain_id, anteil)
                       SELECT 'place', '${ID(0x99)}', id, 'aventuria', 1 FROM sprache WHERE schluessel = '${SCHLUESSEL.a}'`;
        expect(
            await db().codesAs(db().app, [
                "SELECT count(*) FROM sprache_treffer",
                zeile,
                "UPDATE sprache_treffer SET anteil = 1",
                "DELETE FROM sprache_treffer",
            ]),
        ).toEqual(["ok", "42501", "42501", "42501"]);
        expect(
            await db().codesAs(db().jobs, [
                zeile,
                "DELETE FROM sprache_treffer WHERE anteil > 2",
                "UPDATE sprache_treffer SET anteil = 1",
                "TRUNCATE sprache_treffer",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501"]);
        // Kein Anteil von 0 oder über 1, keine fremde Art.
        expect(
            await db().codesAs(db().admin, [
                zeile.replace(", 1 FROM", ", 0 FROM"),
                zeile.replace(", 1 FROM", ", 1.5 FROM"),
                zeile.replace("'place'", "'berg'"),
            ]),
        ).toEqual(["23514", "23514", "23514"]);
    });

    it("🔴 ohne aktive Sprachfläche endet der Lauf sofort und löscht nur die Treffer seines Umfangs", async () => {
        await db().migrator`
            UPDATE sprache_flaeche SET is_active = FALSE, retired_at = now(), retired_origin = 'editor' WHERE is_active
        `;
        expect(await rechne({ sprachen: [sprachId.a] })).toMatchObject({ status: "ohne_sprachflaechen" });
        const zeilen = await treffer();
        expect(zeilen.some((zeile) => zeile.sprache === SCHLUESSEL.a)).toBe(false);
        expect(zeilen.some((zeile) => zeile.sprache === SCHLUESSEL.b)).toBe(true);
        // Und eine Operation reiht wieder nichts ein.
        await db().admin`DELETE FROM job WHERE kind = ${SPRACHE_TREFFER_JOB_KIND}`;
        await speichere([{ kind: "place", id: ORT.p1 }]);
        expect(await auftraege()).toEqual([]);
    });
});
