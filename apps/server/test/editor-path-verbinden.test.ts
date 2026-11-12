import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_PATHS_VERBINDEN_URL,
    editorPathRestoreSeriesUrl,
    type PathVerbindenBody,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { mitgliederHash } from "../src/editor/arbeitsserie.ts";
import { migrate } from "../src/db/migrate.ts";
import { buildRouteNetwork, loadRouteGraphRows, type RouteNetwork } from "../src/routing/network.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";

/**
 * „Wege verbinden“ (WI-0252, `path.join`) gegen echtes PostgreSQL (Wegwerf-Postgres von `vor-dem-push`, sonst `avesmaps3d_test`).
 *
 * Die Kette: Ort X – A – (Stoß, dort beginnt der Abzweig D zum Ort Z) – B (läuft andersherum) – (Stoß) – C – Ort Y. Die Enden an den Stößen
 * liegen knapp innerhalb des Fangradius, nicht genau aufeinander.
 *
 * Problemfälle: Die Linie läuft in der Folge der Auswahl statt der Kette, der umgedrehte Abschnitt bleibt verkehrt, an einem Stoß stehen
 * zwei Stützpunkte; der Abzweig verliert seinen Anschluss; ein durchgehender Weg an einem Stoß verliert die Verbindung, ohne dass es
 * jemand merkt; die Einstellungen kommen nicht von der Vorlage; die übrigen Abschnitte bleiben auf der Karte; ↺ holt sie nicht zurück; die
 * Wegfindung fährt danach eine andere Kantenfolge.
 */

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

const SOURCE = "test-wi0252-verbinden";
const P = "a2520252-0000-4000-8000-0000000001";
const W = { a: `${P}a1`, b: `${P}b1`, c: `${P}c1`, d: `${P}d1`, e: `${P}e1`, fluss: `${P}f1` } as const;
const O = { x: `${P}aa`, y: `${P}bb`, z: `${P}cc` } as const;

let zaehler = 0;
const operationId = (): string => `a2520252-0000-4000-9000-${String((zaehler += 1)).padStart(8, "0")}1252`;

/** Der kürzeste Weg im Netz von Knoten zu Knoten (Dijkstra über die Länge): die Knoten unterwegs und die Wege der Kanten. */
function weg(netz: RouteNetwork, von: string, nach: string): { knoten: string[]; wege: string[]; laenge: number } {
    const kanten = new Map<string, { zu: string; laenge: number; weg: string }[]>();
    for (const l of netz.links) {
        kanten.set(l.from, [...(kanten.get(l.from) ?? []), { zu: l.to, laenge: l.distance, weg: l.pathPublicId }]);
        kanten.set(l.to, [...(kanten.get(l.to) ?? []), { zu: l.from, laenge: l.distance, weg: l.pathPublicId }]);
    }
    const abstand = new Map<string, number>([[von, 0]]);
    const vorher = new Map<string, { knoten: string; weg: string }>();
    const offen = new Set([von]);
    while (offen.size > 0) {
        const hier = [...offen].reduce((a, b) =>
            (abstand.get(a) ?? Infinity) <= (abstand.get(b) ?? Infinity) ? a : b,
        );
        offen.delete(hier);
        if (hier === nach) break;
        for (const k of kanten.get(hier) ?? []) {
            const neu = (abstand.get(hier) ?? 0) + k.laenge;
            if (neu < (abstand.get(k.zu) ?? Infinity)) {
                abstand.set(k.zu, neu);
                vorher.set(k.zu, { knoten: hier, weg: k.weg });
                offen.add(k.zu);
            }
        }
    }
    const knoten = [nach];
    const wege: string[] = [];
    for (let k = nach; k !== von;) {
        const v = vorher.get(k);
        if (v === undefined) return { knoten: [], wege: [], laenge: Infinity };
        knoten.unshift(v.knoten);
        wege.unshift(v.weg);
        k = v.knoten;
    }
    return { knoten, wege, laenge: abstand.get(nach) ?? Infinity };
}

describeWithDatabase("„Wege verbinden“ (WI-0252, path.join)", { timeout: 120_000 }, () => {
    let database: Database;
    let app: FastifyInstance;
    const cookies = new Map<Role, string>();
    const config: ServerConfig = {
        port: 0,
        host: "127.0.0.1",
        releaseId: "test",
        databaseUrl: undefined,
        tileRoot: undefined,
        auth: TEST_AUTH,
        mapEditing: "testwelt",
    };

    async function aufraeumen(): Promise<void> {
        const ids = Object.values(W);
        await database`DELETE FROM job_event WHERE kind = 'map.changed' OR job_id IN (SELECT id FROM job WHERE kind IN ('path_profile', 'path_label_runs'))`;
        await database`DELETE FROM job WHERE kind IN ('path_profile', 'path_label_runs')`;
        await database`DELETE FROM map_audit_event WHERE operation_id::text LIKE 'a2520252-0000-4000-9000-%1252'`;
        await database`DELETE FROM map_operation WHERE operation_id::text LIKE 'a2520252-0000-4000-9000-%1252'`;
        await database`DELETE FROM editor_lock WHERE object_kind = 'path' AND object_id = ANY(${ids}::uuid[])`;
        await database`DELETE FROM path_visual WHERE path_id IN (SELECT id FROM path WHERE source_system = ${SOURCE})`;
        await database`DELETE FROM path WHERE source_system = ${SOURCE}`;
        await database`DELETE FROM place WHERE source_system = ${SOURCE}`;
    }

    const linie = (punkte: readonly (readonly [number, number])[]): string =>
        `LINESTRING(${punkte.map(([x, y]) => `${String(x)} ${String(y)}`).join(", ")})`;
    async function lege(mitDurchgang = false): Promise<void> {
        await aufraeumen();
        const ort = (id: string, name: string, x: number, y: number) => database`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
            VALUES (${id}, 'aventuria', ${name}, 'dorf', ST_SetSRID(ST_MakePoint(${x}, ${y}), 0), ${SOURCE}, TRUE)
        `;
        await ort(O.x, "VB Anfang", 900, 400);
        await ort(O.y, "VB Ende", 920, 400);
        await ort(O.z, "VB Abzweig", 906.5, 410);
        const strecke = (
            id: string,
            name: string,
            subtype: string,
            punkte: readonly (readonly [number, number])[],
            extra = {},
        ) =>
            database`
                INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, is_tunnel, geom, source_system)
                VALUES (${id}, 'aventuria', ${name}, ${subtype}, ${(extra as { sichtbar?: boolean }).sichtbar ?? true}, FALSE,
                        ${(extra as { tunnel?: boolean }).tunnel ?? false}, ST_GeomFromText(${linie(punkte)}, 0), ${SOURCE})
            `;
        // A vorwärts, B rückwärts (endet am Stoß mit A, 0,011 daneben), C vorwärts (beginnt 0,005 neben B).
        await strecke(W.a, "VB Kette", "Strasse", [
            [900, 400],
            [903, 401],
            [906, 400],
        ]);
        await strecke(
            W.b,
            "VB Kette",
            "Weg",
            [
                [913, 400],
                [909.5, 401],
                [906.01, 400.005],
            ],
            { tunnel: true, sichtbar: false },
        );
        await strecke(W.c, "VB Kette", "Strasse", [
            [913.005, 400],
            [916, 399],
            [920, 400],
        ]);
        // Der Abzweig D beginnt 0,005 neben dem Stoß A/B und endet am Ort Z.
        await strecke(W.d, "VB Abzweig", "Pfad", [
            [906.005, 400],
            [906.3, 405],
            [906.5, 410],
        ]);
        // Ein Fluss daneben (Land und Wasser verbindet man nicht).
        await strecke(W.fluss, "VB Fluss", "Flussweg", [
            [920, 400],
            [925, 402],
        ]);
        if (mitDurchgang)
            // Ein durchgehender Weg mit einem Stützpunkt am Stoß B/C: Dort hängt er im Netz (T-Stoß der Enden auf ihn).
            await strecke(W.e, "VB Quer", "Weg", [
                [913, 395],
                [913.002, 400.001],
                [913, 405],
            ]);
    }

    const post = (body: Partial<PathVerbindenBody>, role: Role = "editor") =>
        app.inject({
            method: "POST",
            url: EDITOR_PATHS_VERBINDEN_URL,
            headers: { cookie: cookies.get(role) ?? "", origin: TEST_ORIGIN },
            payload: { operationId: operationId(), ...body },
        });
    const pruefe = async (ids: readonly string[]) =>
        (
            await app.inject({
                method: "GET",
                url: `${EDITOR_PATHS_VERBINDEN_URL}?ids=${ids.join(",")}`,
                headers: { cookie: cookies.get("reviewer") ?? "" },
            })
        ).json<{ geht: boolean; kette?: { publicId: string; umgedreht: boolean }[]; grund?: string }>();
    const zeile = async (id: string) =>
        (
            await database<{ aktiv: boolean; revision: number; subtype: string; tunnel: boolean; linie: string }[]>`
                SELECT is_active AS aktiv, revision::int AS revision, subtype, is_tunnel AS tunnel, ST_AsText(geom) AS linie
                  FROM path WHERE public_id = ${id}::uuid
            `
        )[0]!;
    const netz = async (): Promise<RouteNetwork> => {
        const { places, paths } = await loadRouteGraphRows(database, "aventuria");
        return buildRouteNetwork(places, paths);
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        const fixture = authFixture(database);
        for (const role of ["reviewer", "editor"] as const) {
            const person = await fixture.person(role, { name: `WI-0252 VB ${role}` });
            cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
        }
        app = buildApp({
            config,
            database: createDatabase(testDatabaseUrl as string, { max: 4 }),
            logStream: { write: () => undefined },
        });
        await app.ready();
    });

    afterAll(async () => {
        await app?.close();
        await aufraeumen();
        await database.end({ timeout: 5 });
    });

    it("🔴 die Kette in Kettenfolge, B umgedreht; die Stöße werden EIN Punkt auf dem Knoten; die Einstellungen der Vorlage; die anderen still; der Abzweig hängt weiter; dieselbe Kantenfolge", async () => {
        await lege();
        // Die Folge der Auswahl spielt keine Rolle.
        expect(await pruefe([W.c, W.a, W.b])).toEqual({
            geht: true,
            kette: [
                { publicId: W.a, umgedreht: false },
                { publicId: W.b, umgedreht: true },
                { publicId: W.c, umgedreht: false },
            ],
        });
        const vorher = await netz();
        const routeVorher = weg(vorher, O.x, O.y);
        const abzweigVorher = weg(vorher, O.x, O.z);
        expect(routeVorher.wege).toEqual([W.a, W.b, W.c]);
        const id = operationId();
        const antwort = await app.inject({
            method: "POST",
            url: EDITOR_PATHS_VERBINDEN_URL,
            headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
            payload: {
                operationId: id,
                vorlage: W.b,
                sections: [
                    { publicId: W.c, baseRevision: 1 },
                    { publicId: W.a, baseRevision: 1 },
                    { publicId: W.b, baseRevision: 1 },
                ],
            },
        });
        expect(antwort.statusCode).toBe(200);
        const quittung = antwort.json<{ publicId: string; derivedWork: { kind: string }[] }>();
        expect(quittung.publicId).toBe(W.b);
        expect(quittung.derivedWork.map((w) => w.kind)).toContain("routing");
        // Die Vorlage B trägt die Linie, in IHRER Richtung (von Y nach X), mit ihren Einstellungen; ein Stützpunkt je Stoß, auf dem Knoten.
        const b = await zeile(W.b);
        expect(b).toMatchObject({ aktiv: true, revision: 2, subtype: "Weg", tunnel: true });
        // Die Stöße liegen auf den Knoten des Netzes: dem Ende von A (906 400) und dem Anfang von B (913 400), je die ersten ihrer Gruppe.
        expect(b.linie).toBe("LINESTRING(920 400,916 399,913 400,909.5 401,906 400,903 401,900 400)");
        expect((await zeile(W.a)).aktiv).toBe(false);
        expect((await zeile(W.c)).aktiv).toBe(false);
        // Der Abzweig bleibt unberührt.
        expect((await zeile(W.d)).revision).toBe(1);
        // EINE Operation; das Protokoll führt die Linie vorher und nachher und das Stilllegen.
        const protokoll = await database<{ path: string; changes: Record<string, unknown> }[]>`
            SELECT path_public_id::text AS path, changes FROM map_audit_event WHERE operation_id = ${id}::uuid ORDER BY path_public_id
        `;
        expect(protokoll.map((z) => [z.path, Object.keys(z.changes)])).toEqual([
            [W.a, ["active"]],
            [W.b, ["geometry"]],
            [W.c, ["active"]],
        ]);
        // 🔴 Die Wegfindung: dieselbe Folge der Orte und Knoten mit Anschluss, nur weniger Kanten; der Abzweig hängt am Stoß.
        const nachher = await netz();
        const routeNachher = weg(nachher, O.x, O.y);
        expect(routeNachher.wege.every((w) => w === W.b)).toBe(true);
        expect(routeNachher.knoten[0]).toBe(O.x);
        expect(routeNachher.knoten.at(-1)).toBe(O.y);
        expect(Math.abs(routeNachher.laenge - routeVorher.laenge)).toBeLessThan(0.05);
        const abzweigNachher = weg(nachher, O.x, O.z);
        expect(abzweigNachher.wege).toEqual([W.b, W.d]);
        expect(abzweigVorher.wege).toEqual([W.a, W.d]);
        expect(Math.abs(abzweigNachher.laenge - abzweigVorher.laenge)).toBeLessThan(0.05);
        // Der Stoß ohne Anschluss (B/C) ist kein Knoten mehr; der mit Abzweig (A/B) bleibt einer.
        expect(routeVorher.knoten).toHaveLength(4);
        expect(routeNachher.knoten).toHaveLength(3);
    });

    it("🔴 ↺ aus dem Verlauf: die Vorlage mit ihrer alten Linie, die anderen zurück auf der Karte; das Netz wie vorher", async () => {
        await lege();
        const vorher = await netz();
        const id = operationId();
        expect(
            (
                await post({
                    operationId: id,
                    vorlage: W.a,
                    sections: [
                        { publicId: W.a, baseRevision: 1 },
                        { publicId: W.b, baseRevision: 1 },
                        { publicId: W.c, baseRevision: 1 },
                    ],
                })
            ).statusCode,
        ).toBe(200);
        // Seit WI-0265 B6a2 ist ↺ die Rücknahme der Wege (`restore-series`): ein Abschnitt, den die Verbindung nie berührte, ist nicht von hier (400).
        const rueck = (abschnitt: string) =>
            app.inject({
                method: "POST",
                url: editorPathRestoreSeriesUrl(abschnitt),
                headers: { cookie: cookies.get("editor") ?? "", origin: TEST_ORIGIN },
                payload: { operationId: operationId(), members: [id], membersHash: mitgliederHash([id]) },
            });
        expect((await rueck(W.d)).statusCode).toBe(400);
        const zurueck = await rueck(W.b);
        expect(zurueck.statusCode, zurueck.body).toBe(200);
        expect((await zeile(W.a)).linie).toBe("LINESTRING(900 400,903 401,906 400)");
        expect((await zeile(W.b)).aktiv).toBe(true);
        expect((await zeile(W.c)).aktiv).toBe(true);
        expect(weg(await netz(), O.x, O.y).wege).toEqual(weg(vorher, O.x, O.y).wege);
    });

    it("🔴 ein durchgehender Weg am Stoß: geht nicht (netz), auch nicht beim Schreiben; Lücke, Land und Wasser, zu wenige gehen nicht", async () => {
        await lege(true);
        expect(await pruefe([W.a, W.b, W.c])).toEqual({ geht: false, grund: "netz" });
        const nicht = await post({
            vorlage: W.a,
            sections: [
                { publicId: W.a, baseRevision: 1 },
                { publicId: W.b, baseRevision: 1 },
                { publicId: W.c, baseRevision: 1 },
            ],
        });
        expect(nicht.statusCode).toBe(400);
        expect(nicht.json<{ error: { details?: { grund?: string } } }>().error.details?.grund).toBe("netz");
        expect((await zeile(W.a)).revision).toBe(1);
        // Ohne den Stoß B/C (nur A und B) geht es: Dort hängt nur der Abzweig, und der hängt danach am T-Stoß.
        expect((await pruefe([W.a, W.b])).geht).toBe(true);
        // A und C berühren sich nicht: keine Kette.
        expect(await pruefe([W.a, W.c])).toEqual({ geht: false, grund: "kette" });
        // C und der Fluss hängen am Ort Y aneinander, sind aber Land und Wasser.
        expect(await pruefe([W.c, W.fluss])).toEqual({ geht: false, grund: "art" });
        // Drei an einem Stoß (A, B und der Abzweig D) sind keine Kette.
        expect(await pruefe([W.a, W.b, W.d])).toEqual({ geht: false, grund: "kette" });
    });

    it("🔴 Revision bewegt 409, fremde Sperre 409, Reviewer 403, die Vorlage muss dabei sein", async () => {
        await lege();
        const satz = [
            { publicId: W.a, baseRevision: 1 },
            { publicId: W.b, baseRevision: 1 },
        ];
        expect((await post({ vorlage: W.c, sections: satz })).statusCode).toBe(400);
        expect((await post({ vorlage: W.a, sections: satz }, "reviewer")).statusCode).toBe(403);
        expect(
            (
                await post({
                    vorlage: W.a,
                    sections: [
                        { publicId: W.a, baseRevision: 5 },
                        { publicId: W.b, baseRevision: 1 },
                    ],
                })
            ).statusCode,
        ).toBe(409);
        const anderer = await authFixture(database).person("editor", { name: "WI-0252 VB anderer" });
        await database`
            INSERT INTO editor_lock (object_kind, object_id, part, person_id, person_name, run_id)
            VALUES ('path', ${W.b}::uuid, 'form', ${anderer.id}::uuid, 'WI-0252 VB anderer', gen_random_uuid())
        `;
        const gesperrt = await post({ vorlage: W.a, sections: satz });
        expect(gesperrt.statusCode).toBe(409);
        expect(gesperrt.json<{ error: { code: string } }>().error.code).toBe("object_locked");
        await database`DELETE FROM editor_lock WHERE object_id = ${W.b}::uuid`;
    });
});
