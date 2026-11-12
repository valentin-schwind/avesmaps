import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { JobContext } from "../src/jobs/handlers.ts";
import { meldeSprachKacheln, rechneSprachTreffer } from "../src/jobs/sprachen-treffer-job.ts";
import { sprachTrefferNeuRechnenLassen, type TrefferUmfang } from "../src/sprachen/treffer-auftrag.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Mischgebiete der Sprachen (WI-0261 S5a, Migration 0257) gegen echtes PostGIS, wie auf dem VPS: Wegwerf-Cluster mit Migrations-, App- und
 * Jobs-Rolle und den Vorlagen. Gerechnet wird als Jobs-Rolle im Auftrag `sprache_treffer`. 🔴 Kein Test schreibt in `avesmaps3d_dev` oder in die
 * geteilte Testdatenbank.
 *
 * Problemfälle: zwei Teilflächen derselben Sprache ergeben ein Mischgebiet; ein Kleinstrest an einer Kante bleibt stehen; eine stillgelegte Fläche
 * zählt; ein Lauf nur über Objekte fasst die Paare an oder meldet neue Kacheln; ein Lauf je Sprache fasst fremde Paare an; eine stillgelegte Sprache
 * steht weiter in der Kachel; die App darf schreiben.
 *
 * Die kleine Welt (Karteneinheiten): Alpha aus zwei überlappenden Quadraten (300–400 und 350–450 × 300–400) und einem dritten (310–330 ×
 * 460–480); Beta 420–520 × 300–400 und 300–320 × 450–470; Gamma 449,95–470 × 395–400 (berührt Alpha nur mit 0,25 E²) und eine stillgelegte
 * Fläche mitten in Alpha; Delta 300–310 × 300–310.
 */

const ENV = "sprmisch";
const vorlagen = ["media-grants.psql", "system-grants.psql", "map-grants.psql", "jobs-grants.psql"].map((name) =>
    fileURLToPath(new URL(`../src/db/${name}`, import.meta.url)),
);
const describeWithCluster = postgresBin ? describe : describe.skip;

const ID = (n: number): string => `77777785-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const SCHLUESSEL = { a: "s5test-alpha", b: "s5test-beta", c: "s5test-gamma", d: "s5test-delta" } as const;
const FARBE = { a: "#aa0000", b: "#00aa00", c: "#0000aa", d: "#aaaa00" } as const;
const FLAECHE = { b1: ID(0x11), dStill: ID(0x12) };
const QUELLE = "e0619e909dcc".padEnd(64, "0");

const quadrat = (x0: number, y0: number, x1: number, y1: number): string =>
    `POLYGON((${String(x0)} ${String(y0)},${String(x1)} ${String(y0)},${String(x1)} ${String(y1)},${String(x0)} ${String(y1)},${String(x0)} ${String(y0)}))`;

interface Paar {
    a: string;
    b: string;
    teil: number;
    flaeche: number;
    um: string;
}

describeWithCluster("Mischgebiete der Sprachen (WI-0261 S5a, Wegwerf-Cluster)", { timeout: 300_000 }, () => {
    let cluster: VpsCluster | undefined;
    const sprachId: Record<keyof typeof SCHLUESSEL, string> = { a: "", b: "", c: "", d: "" };
    let meldungen = 0;
    let phasen: string[] = [];

    const db = (): VpsCluster => cluster!;
    /** Alle Paare, lesbar sortiert; `um` ist die Zeit des Schreibens. */
    const paare = async (): Promise<Paar[]> =>
        db().admin<Paar[]>`
            SELECT a.schluessel AS a, b.schluessel AS b, m.teil, round(ST_Area(m.geom)::numeric, 2)::float8 AS flaeche,
                   m.berechnet_at::text AS um
              FROM sprache_misch m JOIN sprache a ON a.id = m.sprache_a_id JOIN sprache b ON b.id = m.sprache_b_id
             ORDER BY a.schluessel, b.schluessel, m.teil
        `;
    const ohneZeit = (zeilen: Paar[]): Omit<Paar, "um">[] =>
        zeilen.map(({ a, b, teil, flaeche }) => ({ a, b, teil, flaeche }));
    /** Ein Lauf als Jobs-Rolle; Phasen und Meldungen werden mitgeschrieben. */
    const rechne = (umfang: TrefferUmfang): Promise<Record<string, unknown>> => {
        phasen = [];
        return rechneSprachTreffer(
            db().jobs,
            "aventuria",
            umfang,
            async (name) => {
                phasen.push(name);
            },
            async () => {
                meldungen += 1;
            },
        );
    };
    const stillgelegt = (tafel: "sprache" | "sprache_flaeche") =>
        tafel === "sprache"
            ? db().admin`state = 'retired', is_active = FALSE, retired_at = now(), retired_origin = 'editor'`
            : db().admin`is_active = FALSE, retired_at = now(), retired_origin = 'editor'`;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, vorlagen, { mapDomains: true });
        const m = cluster.migrator;
        for (const k of ["a", "b", "c", "d"] as const) {
            const [zeile] = await m<{ id: string }[]>`
                INSERT INTO sprache (schluessel, name, farbe, reihenfolge, herkunft)
                VALUES (${SCHLUESSEL[k]}, ${SCHLUESSEL[k].toUpperCase()}, ${FARBE[k]}, 1, 'sprachenkarte') RETURNING public_id::text AS id
            `;
            sprachId[k] = zeile!.id;
        }
        const flaeche = async (k: keyof typeof SCHLUESSEL, wkt: string, id?: string, still = false): Promise<void> => {
            await m`
                INSERT INTO sprache_flaeche (public_id, sprache_id, map_domain_id, geom, herkunft, quelle_revision, is_active, retired_at,
                                             retired_origin)
                VALUES (${id ?? m`gen_random_uuid()`}, (SELECT id FROM sprache WHERE schluessel = ${SCHLUESSEL[k]}), 'aventuria',
                        ST_GeomFromText(${wkt}, 0), 'sprachenkarte', ${QUELLE}, ${!still}, ${still ? m`now()` : null},
                        ${still ? "editor" : null})
            `;
        };
        await flaeche("a", quadrat(300, 300, 400, 400));
        await flaeche("a", quadrat(350, 300, 450, 400));
        await flaeche("a", quadrat(310, 460, 330, 480));
        await flaeche("b", quadrat(420, 300, 520, 400), FLAECHE.b1);
        await flaeche("b", quadrat(300, 450, 320, 470));
        await flaeche("c", quadrat(449.95, 395, 470, 400));
        await flaeche("c", quadrat(330, 330, 340, 340), FLAECHE.dStill, true);
        await flaeche("d", quadrat(300, 300, 310, 310));
    }, 300_000);

    afterAll(async () => {
        await cluster?.stop();
    }, 60_000);

    it("🔴 voller Lauf: je Paar die Überlappung der vereinigten Flächen, der größte Teil zuerst; keine Kleinstreste, keine stillgelegte Fläche; einmal gemeldet", async () => {
        const bericht = await rechne({ alle: true });
        expect(bericht).toMatchObject({ status: "gerechnet", misch: { geloescht: 0, angelegt: 4 } });
        expect(phasen).toEqual(["orte", "gebiete", "regionen", "wege", "misch"]);
        expect(meldungen).toBe(1);
        // Alpha mit sich selbst (350–400) ist kein Mischgebiet; Alpha/Gamma (0,25 E²) fällt weg; die stillgelegte Gamma-Fläche in Alpha zählt nicht.
        expect(ohneZeit(await paare())).toEqual([
            { a: SCHLUESSEL.a, b: SCHLUESSEL.b, teil: 1, flaeche: 3000 },
            { a: SCHLUESSEL.a, b: SCHLUESSEL.b, teil: 2, flaeche: 100 },
            { a: SCHLUESSEL.a, b: SCHLUESSEL.d, teil: 1, flaeche: 100 },
            { a: SCHLUESSEL.b, b: SCHLUESSEL.c, teil: 1, flaeche: 100.25 },
        ]);
        // Ein zweiter voller Lauf ersetzt, statt zu doppeln.
        await rechne({ alle: true });
        expect(await paare()).toHaveLength(4);
    });

    it("🔴 die Kachelsicht: Schlüssel und Farbe beider Sprachen, Fläche, SRID 3857, feste Reihenfolge", async () => {
        const zeilen = await db().app<
            {
                schluessel_a: string;
                schluessel_b: string;
                farbe_a: string;
                farbe_b: string;
                teil: number;
                area: number;
                srid: number;
            }[]
        >`
            SELECT schluessel_a, schluessel_b, farbe_a, farbe_b, teil, area, ST_SRID(geom) AS srid FROM sprache_misch_render
        `;
        expect(zeilen.map((z) => [z.schluessel_a, z.schluessel_b, z.teil, z.area])).toEqual([
            [SCHLUESSEL.a, SCHLUESSEL.b, 1, 3000],
            [SCHLUESSEL.a, SCHLUESSEL.b, 2, 100],
            [SCHLUESSEL.a, SCHLUESSEL.d, 1, 100],
            [SCHLUESSEL.b, SCHLUESSEL.c, 1, 100.25],
        ]);
        expect(zeilen[0]).toMatchObject({ farbe_a: FARBE.a, farbe_b: FARBE.b, srid: 3857 });
        expect(zeilen[3]).toMatchObject({ farbe_a: FARBE.b, farbe_b: FARBE.c });
    });

    it("🔴 ein Lauf nur über Objekte fasst die Mischgebiete nicht an und meldet nichts", async () => {
        const vorher = await paare();
        const zuvor = meldungen;
        const bericht = await rechne({ objekte: { place: [ID(0x99)] } });
        expect(bericht).toMatchObject({ status: "gerechnet" });
        expect(bericht).not.toHaveProperty("misch");
        expect(phasen).toEqual(["orte"]);
        expect(meldungen).toBe(zuvor);
        expect(await paare()).toEqual(vorher);
    });

    it("🔴 ein Lauf je Sprache: eine stillgelegte Fläche nimmt ihr Paar weg, fremde Paare bleiben unberührt", async () => {
        const vorher = await paare();
        await db().admin`UPDATE sprache_flaeche SET ${stillgelegt("sprache_flaeche")} WHERE public_id = ${FLAECHE.b1}`;
        const zuvor = meldungen;
        expect(await rechne({ sprachen: [sprachId.b] })).toMatchObject({
            status: "gerechnet",
            misch: { geloescht: 3, angelegt: 1 },
        });
        expect(meldungen).toBe(zuvor + 1);
        const nachher = await paare();
        // Beta ist nur noch 300–320 × 450–470: mit Alpha 100 E², Gamma berührt es nicht mehr.
        expect(ohneZeit(nachher.filter((zeile) => zeile.a === SCHLUESSEL.b || zeile.b === SCHLUESSEL.b))).toEqual([
            { a: SCHLUESSEL.a, b: SCHLUESSEL.b, teil: 1, flaeche: 100 },
        ]);
        // Alpha/Delta ist dieselbe Zeile, zur selben Zeit geschrieben.
        const delta = (zeilen: Paar[]): Paar[] => zeilen.filter((zeile) => zeile.b === SCHLUESSEL.d);
        expect(delta(nachher)).toEqual(delta(vorher));
        expect(delta(nachher)).toHaveLength(1);
    });

    it("🔴 eine stillgelegte Sprache verschwindet sofort aus der Kachel; ihr Lauf löscht danach ihre Paare", async () => {
        await db().admin`UPDATE sprache SET ${stillgelegt("sprache")} WHERE schluessel = ${SCHLUESSEL.d}`;
        const kachel = async (): Promise<string[]> =>
            (
                await db().app<{ paar: string }[]>`
                    SELECT schluessel_a || '/' || schluessel_b || '/' || teil AS paar FROM sprache_misch_render
                `
            ).map((zeile) => zeile.paar);
        expect(await kachel()).not.toContain(`${SCHLUESSEL.a}/${SCHLUESSEL.d}/1`);
        expect((await paare()).some((zeile) => zeile.b === SCHLUESSEL.d)).toBe(true);
        await rechne({ sprachen: [sprachId.d] });
        expect((await paare()).some((zeile) => zeile.b === SCHLUESSEL.d)).toBe(false);
    });

    it("🔴 Rechte und Bedingungen: die App liest nur, die Jobs-Rolle legt an und löscht, ändert und leert nie", async () => {
        type K = keyof typeof SCHLUESSEL;
        const zeile = (teil: number, wkt = quadrat(0, 0, 10, 10), a: K = "a", b: K = "c"): string =>
            `INSERT INTO sprache_misch (map_domain_id, sprache_a_id, sprache_b_id, teil, geom)
             SELECT 'aventuria', x.id, y.id, ${String(teil)}, ST_GeomFromText('${wkt}', 0)
               FROM sprache x, sprache y
              WHERE x.schluessel = '${SCHLUESSEL[a]}' AND y.schluessel = '${SCHLUESSEL[b]}'`;
        expect(
            await db().codesAs(db().app, [
                "SELECT count(*) FROM sprache_misch",
                "SELECT count(*) FROM sprache_misch_render",
                zeile(90),
                "UPDATE sprache_misch SET teil = teil",
                "DELETE FROM sprache_misch",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501", "42501"]);
        expect(
            await db().codesAs(db().jobs, [
                zeile(91),
                "DELETE FROM sprache_misch WHERE teil = 91",
                "UPDATE sprache_misch SET teil = teil",
                "TRUNCATE sprache_misch",
            ]),
        ).toEqual(["ok", "ok", "42501", "42501"]);
        // Das Paar steht geordnet, ein Teil hat mindestens 0,5 E², es zählt ab 1.
        expect(
            await db().codesAs(db().admin, [
                zeile(92, quadrat(0, 0, 10, 10), "c", "a"),
                zeile(93, quadrat(0, 0, 0.5, 0.5)),
                zeile(0),
            ]),
        ).toEqual(["23514", "23514", "23514"]);
    });

    it("🔴 ohne aktive Sprachfläche löscht ein Lauf je Sprache ihre Paare und meldet", async () => {
        await db().admin`UPDATE sprache_flaeche SET ${stillgelegt("sprache_flaeche")} WHERE is_active`;
        const zuvor = meldungen;
        expect(await rechne({ sprachen: [sprachId.a] })).toMatchObject({
            status: "ohne_sprachflaechen",
            misch: { geloescht: 1, angelegt: 0 },
        });
        expect(meldungen).toBe(zuvor + 1);
        expect(await paare()).toEqual([]);
    });

    it("🔴 die Meldung: `map.changed` des Auftrags mit der Art `sprache`, als Jobs-Rolle", async () => {
        const auftrag = await db().app.begin((tx) =>
            sprachTrefferNeuRechnenLassen(tx, "test", "aventuria", [sprachId.a]),
        );
        const [job] = await db().admin<{ id: string }[]>`SELECT id::text FROM job WHERE public_id = ${auftrag}`;
        const context = {
            job: { id: Number(job!.id), publicId: auftrag, leaseNo: null, mapDomainId: "aventuria" },
        } as unknown as JobContext;
        await meldeSprachKacheln(db().jobs, context, "aventuria");
        const [ereignis] = await db().admin<{ kind: string; payload: Record<string, unknown> }[]>`
            SELECT kind, payload FROM job_event WHERE job_id = ${job!.id}::bigint AND kind = 'map.changed'
        `;
        expect(ereignis).toMatchObject({
            kind: "map.changed",
            payload: { jobId: auftrag, jobKind: "sprache_treffer", affected: [{ kind: "sprache" }] },
        });
    });
});
