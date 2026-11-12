import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EDITOR_LOCKS_URL, type EditorLock } from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { beatEditorLocks, listEditorLocks, releaseEditorLock, takeEditorLock } from "../src/editor/editor-lock.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Sperre während der Bearbeitung (EDIT-0003 §4, T27 (14); Migration 0138), im Wegwerf-Cluster mit den Rollen und Rechten des VPS: die
 * Logik als App-Rolle, die Routen gegen denselben Cluster. 🔴 Nie gegen die Testdatenbank der anderen Sitzungen: 0138 ist neu.
 *
 * Problemfälle: Zwei bekommen dieselbe Sperre (auch wenn sie zugleich fragen); eine abgelaufene Sperre bleibt gesperrt, oder eine
 * frische ist schon frei; der alte Lauf merkt nicht, dass ein anderer sie genommen hat; einer gibt die Sperre eines anderen frei; die
 * Liste zeigt Abgelaufenes; alte Zeilen bleiben ewig; die App darf die Tafel leeren; ohne Recht an der Geometrie nimmt jemand die Form;
 * bei ausgeschaltetem Bearbeiten sperrt jemand; der Fehler nennt nicht, wer das Objekt hält.
 */
const ENV = "locktest";
const vorlage = (name: string): string => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url));
const FLAECHE = "a8a8a8a8-0000-4000-8000-000000000001";
const ANDERE = "a8a8a8a8-0000-4000-8000-000000000002";
const thomas = { personId: "a8a8a8a8-0000-4000-8000-00000000aa01", personName: "Thomas" };
const valentin = { personId: "a8a8a8a8-0000-4000-8000-00000000aa02", personName: "Valentin" };

describe.skipIf(postgresBin === undefined)(
    "Sperre während der Bearbeitung (EDIT-0003 §4)",
    { timeout: 240_000 },
    () => {
        let cluster: VpsCluster;

        beforeAll(async () => {
            cluster = await startVpsCluster(ENV, [vorlage("auth-grants.psql"), vorlage("map-grants.psql")], {
                mapDomains: true,
            });
        }, 240_000);
        afterAll(async () => {
            await cluster?.stop();
        });

        /** Den letzten Herzschlag einer Sperre zurückdrehen, als wäre so viel Zeit vergangen. */
        const altern = (id: string, minuten: number) =>
            cluster.admin`UPDATE editor_lock SET heartbeat_at = now() - make_interval(mins => ${minuten}) WHERE object_id = ${id}`;

        it("🔴 eine Sperre je Objekt: der zweite Lauf erfährt, wer sie hält; nach 15 Minuten ohne Herzschlag nimmt er sie, der erste verliert sie", async () => {
            const a = randomUUID();
            const b = randomUUID();
            const erst = await takeEditorLock(cluster.app, {
                kind: "landscape",
                id: FLAECHE,
                part: "form",
                run: a,
                ...thomas,
            });
            expect(erst).toMatchObject({ taken: true, lock: { own: true, part: "form", person: { name: "Thomas" } } });
            const zweit = await takeEditorLock(cluster.app, {
                kind: "landscape",
                id: FLAECHE,
                part: "felder",
                run: b,
                ...valentin,
            });
            expect(zweit).toMatchObject({
                taken: false,
                lock: { own: false, part: "form", person: { name: "Thomas" } },
            });
            // 14 Minuten: noch gesperrt. 16 Minuten: frei.
            await altern(FLAECHE, 14);
            expect(
                (
                    await takeEditorLock(cluster.app, {
                        kind: "landscape",
                        id: FLAECHE,
                        part: "felder",
                        run: b,
                        ...valentin,
                    })
                ).taken,
            ).toBe(false);
            await altern(FLAECHE, 16);
            expect(
                await takeEditorLock(cluster.app, {
                    kind: "landscape",
                    id: FLAECHE,
                    part: "felder",
                    run: b,
                    ...valentin,
                }),
            ).toMatchObject({
                taken: true,
                lock: { person: { name: "Valentin" }, part: "felder" },
            });
            expect(await beatEditorLocks(cluster.app, a, [{ kind: "landscape", id: FLAECHE }])).toEqual([
                { kind: "landscape", id: FLAECHE },
            ]);
            expect(await beatEditorLocks(cluster.app, b, [{ kind: "landscape", id: FLAECHE }])).toEqual([]);
            await releaseEditorLock(cluster.app, b, { kind: "landscape", id: FLAECHE });
        });

        it("🔴 dieselbe Person sperrt sich nie selbst: das zweite Fenster übernimmt, das erste verliert sie beim Herzschlag", async () => {
            const erstes = randomUUID();
            const zweites = randomUUID();
            const ziel = { kind: "landscape", id: FLAECHE } as const;
            await takeEditorLock(cluster.app, { ...ziel, part: "form", run: erstes, ...valentin });
            expect(
                await takeEditorLock(cluster.app, { ...ziel, part: "felder", run: zweites, ...valentin }),
            ).toMatchObject({
                taken: true,
                lock: { own: true, part: "felder", person: { name: "Valentin" } },
            });
            expect(await beatEditorLocks(cluster.app, erstes, [ziel])).toEqual([ziel]);
            expect(await beatEditorLocks(cluster.app, zweites, [ziel])).toEqual([]);
            // Verlässt das erste Fenster die Seite, trifft sein Freigeben die übernommene Sperre nicht.
            expect(await releaseEditorLock(cluster.app, erstes, ziel)).toBe(false);
            // Aus dem ersten Fenster gefragt: für dieselbe Person eigen, für andere fremd.
            const eigen = async (personId?: string) =>
                (await listEditorLocks(cluster.app, "landscape", erstes, personId))[0]?.own;
            expect(await eigen(valentin.personId)).toBe(true);
            expect(await eigen(thomas.personId)).toBe(false);
            expect(await eigen()).toBe(false);
            // Eine andere Person bleibt draußen.
            expect(
                await takeEditorLock(cluster.app, { ...ziel, part: "form", run: randomUUID(), ...thomas }),
            ).toMatchObject({
                taken: false,
                lock: { own: false, person: { name: "Valentin" } },
            });
            await releaseEditorLock(cluster.app, zweites, ziel);
        });

        it("🔴 zwei zugleich: genau einer bekommt sie", async () => {
            const leute = [
                thomas,
                valentin,
                { personId: "a8a8a8a8-0000-4000-8000-00000000aa03", personName: "Dritte" },
                { personId: "a8a8a8a8-0000-4000-8000-00000000aa04", personName: "Vierte" },
            ];
            const laeufe = leute.map(() => randomUUID());
            const ergebnisse = await Promise.all(
                laeufe.map((run, i) =>
                    takeEditorLock(cluster.app, {
                        kind: "landscape",
                        id: ANDERE,
                        part: "form",
                        run,
                        ...leute[i]!,
                    }),
                ),
            );
            expect(ergebnisse.filter((ergebnis) => ergebnis.taken)).toHaveLength(1);
            const gewinner = laeufe[ergebnisse.findIndex((ergebnis) => ergebnis.taken)]!;
            await releaseEditorLock(cluster.app, gewinner, { kind: "landscape", id: ANDERE });
        });

        it("🔴 derselbe Lauf behält sein „seit“; freigeben kann nur, wer hält; die Liste zeigt nur Geltendes", async () => {
            const a = randomUUID();
            const b = randomUUID();
            const erst = await takeEditorLock(cluster.app, {
                kind: "place",
                id: FLAECHE,
                part: "felder",
                run: a,
                ...thomas,
            });
            await cluster.admin`UPDATE editor_lock SET since = since - interval '3 minutes' WHERE object_id = ${FLAECHE} AND object_kind = 'place'`;
            const wieder = await takeEditorLock(cluster.app, {
                kind: "place",
                id: FLAECHE,
                part: "form",
                run: a,
                ...thomas,
            });
            expect(wieder.taken).toBe(true);
            expect(Date.parse(wieder.lock.since)).toBeLessThan(Date.parse(erst.lock.since));
            expect(await releaseEditorLock(cluster.app, b, { kind: "place", id: FLAECHE })).toBe(false);
            expect((await listEditorLocks(cluster.app, "place", b)).map((lock) => [lock.id, lock.own])).toEqual([
                [FLAECHE, false],
            ]);
            expect((await listEditorLocks(cluster.app, "place", a))[0]?.own).toBe(true);
            expect(await listEditorLocks(cluster.app, "landscape", a)).toEqual([]);
            await altern(FLAECHE, 16);
            expect(await listEditorLocks(cluster.app, "place", a)).toEqual([]);
            await altern(FLAECHE, 1);
            expect(await releaseEditorLock(cluster.app, a, { kind: "place", id: FLAECHE })).toBe(true);
            expect(await listEditorLocks(cluster.app, "place", a)).toEqual([]);
        });

        it("🔴 die Liste nennt bei Landschaften den Punkt des Schilds: in der größten Teilfläche, nie daneben", async () => {
            const region = "a8a8a8a8-0000-4000-8000-0000000000b1";
            await cluster.admin`
            INSERT INTO region (public_id, map_domain_id, name, region_layer, is_active, source_system)
            VALUES (${region}, 'aventuria', 'Sperrprobe', 'vegetation', TRUE, 'sperrtest')
        `;
            // Eine kleine und eine große, L-förmige Teilfläche: Der Schwerpunkt der großen läge außerhalb, der Punkt muss drin liegen.
            await cluster.admin`
            INSERT INTO region_area (public_id, region_id, map_domain_id, geom, source_system)
            SELECT gen_random_uuid(), id, 'aventuria', ST_GeomFromText(g, 0), 'sperrtest'
              FROM region, unnest(ARRAY['POLYGON((0 0, 2 0, 2 2, 0 2, 0 0))',
                                        'POLYGON((10 10, 40 10, 40 14, 14 14, 14 40, 10 40, 10 10))']) AS g
             WHERE public_id = ${region}
        `;
            await takeEditorLock(cluster.app, {
                kind: "landscape",
                id: region,
                part: "form",
                run: randomUUID(),
                ...thomas,
            });
            const [sperre] = await listEditorLocks(cluster.app, "landscape", undefined);
            expect(sperre?.at).toBeDefined();
            expect(sperre?.layer).toBe("vegetation");
            const [drin] = await cluster.admin<{ drin: boolean }[]>`
            SELECT ST_Contains(ST_GeomFromText('POLYGON((10 10, 40 10, 40 14, 14 14, 14 40, 10 40, 10 10))', 0),
                               ST_MakePoint(${sperre!.at!.x}, ${sperre!.at!.y})) AS drin
        `;
            expect(drin?.drin).toBe(true);
            await cluster.admin`DELETE FROM editor_lock`;
            await cluster.admin`DELETE FROM region_area WHERE source_system = 'sperrtest'`;
            await cluster.admin`DELETE FROM region WHERE source_system = 'sperrtest'`;
        });

        it("🔴 die Liste nennt bei Orten den Punkt des Orts, ohne Ebene; ein Ort ohne Lage hat keinen Punkt", async () => {
            const ort = "a8a8a8a8-0000-4000-8000-0000000000d1";
            const ohneLage = "a8a8a8a8-0000-4000-8000-0000000000d2";
            await cluster.admin`
            INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${ort}, 'aventuria', 'Sperrdorf', 'dorf', ST_SetSRID(ST_MakePoint(321.5, 654.25), 0), 'sperrtest')
        `;
            for (const id of [ort, ohneLage]) {
                await takeEditorLock(cluster.app, { kind: "place", id, part: "felder", run: randomUUID(), ...thomas });
            }
            const sperren = await listEditorLocks(cluster.app, "place", undefined);
            expect(sperren.find((sperre) => sperre.id === ort)).toMatchObject({ at: { x: 321.5, y: 654.25 } });
            expect(sperren.find((sperre) => sperre.id === ort)?.layer).toBeUndefined();
            expect(sperren.find((sperre) => sperre.id === ohneLage)?.at).toBeUndefined();
            await cluster.admin`DELETE FROM editor_lock`;
            await cluster.admin`DELETE FROM place WHERE source_system = 'sperrtest'`;
        });

        it("🔴 an Linien: beim Weg die Mitte des Abschnitts, bei der Kraftlinie die Mitte des längsten Abschnitts und alle Abschnitte der Gruppe", async () => {
            const weg = "a8a8a8a8-0000-4000-8000-0000000000e1";
            const [kurz, lang, fremd] = [
                "a8a8a8a8-0000-4000-8000-0000000000f1",
                "a8a8a8a8-0000-4000-8000-0000000000f2",
                "a8a8a8a8-0000-4000-8000-0000000000f3",
            ];
            await cluster.admin`
            INSERT INTO path (public_id, map_domain_id, name, subtype, geom, source_system)
            VALUES (${weg}, 'aventuria', 'Sperrweg', 'Pfad', ST_SetSRID(ST_GeomFromText('LINESTRING(100 100, 140 100)'), 0), 'sperrtest')
        `;
            await cluster.admin`
            INSERT INTO powerline (public_id, map_domain_id, name, from_public_id, to_public_id, geom, drawn_geom, source_system)
            VALUES (${kurz}, 'aventuria', 'Sperrlinie', ${randomUUID()}, ${randomUUID()}, ST_SetSRID(ST_GeomFromText('LINESTRING(0 0, 10 0)'), 0),
                    ST_SetSRID(ST_GeomFromText('LINESTRING(0 0, 10 0)'), 0), 'sperrtest'),
                   (${lang}, 'aventuria', 'Sperrlinie', ${randomUUID()}, ${randomUUID()}, ST_SetSRID(ST_GeomFromText('LINESTRING(10 0, 10 40)'), 0),
                    ST_SetSRID(ST_GeomFromText('LINESTRING(10 0, 10 40)'), 0), 'sperrtest'),
                   (${fremd}, 'aventuria', 'Andere Linie', ${randomUUID()}, ${randomUUID()}, ST_SetSRID(ST_GeomFromText('LINESTRING(50 0, 60 0)'), 0),
                    ST_SetSRID(ST_GeomFromText('LINESTRING(50 0, 60 0)'), 0), 'sperrtest')
        `;
            await takeEditorLock(cluster.app, { kind: "path", id: weg, part: "form", run: randomUUID(), ...thomas });
            await takeEditorLock(cluster.app, {
                kind: "powerline",
                id: kurz,
                part: "felder",
                run: randomUUID(),
                ...thomas,
            });
            const [wegSperre] = await listEditorLocks(cluster.app, "path", undefined);
            expect(wegSperre).toMatchObject({ at: { x: 120, y: 100 }, sections: [weg] });
            const [linie] = await listEditorLocks(cluster.app, "powerline", undefined);
            expect(linie).toMatchObject({ id: kurz, at: { x: 10, y: 20 }, sections: [kurz, lang] });
            await cluster.admin`DELETE FROM editor_lock`;
            await cluster.admin`DELETE FROM powerline WHERE source_system = 'sperrtest'`;
            await cluster.admin`DELETE FROM path WHERE source_system = 'sperrtest'`;
        });

        it("alte Zeilen räumt das Nehmen weg; die App darf die Tafel nicht leeren", async () => {
            await takeEditorLock(cluster.app, {
                kind: "path",
                id: FLAECHE,
                part: "form",
                run: randomUUID(),
                ...thomas,
            });
            await cluster.admin`UPDATE editor_lock SET heartbeat_at = now() - interval '25 hours' WHERE object_kind = 'path'`;
            await takeEditorLock(cluster.app, { kind: "path", id: ANDERE, part: "form", run: randomUUID(), ...thomas });
            const [zaehlung] = await cluster.admin<
                { n: number }[]
            >`SELECT count(*)::int AS n FROM editor_lock WHERE object_kind = 'path'`;
            expect(zaehlung?.n).toBe(1);
            expect(await cluster.granted(cluster.roles.app, "editor_lock")).toEqual([
                "SELECT",
                "INSERT",
                "UPDATE",
                "DELETE",
            ]);
            expect(await cluster.codesAs(cluster.app, ["TRUNCATE editor_lock"])).toEqual(["42501"]);
            await cluster.admin`DELETE FROM editor_lock`;
        });

        describe("Routen", () => {
            let app: FastifyInstance;
            let aus: FastifyInstance;
            const cookies = new Map<string, string>();
            const config: ServerConfig = {
                port: 0,
                host: "127.0.0.1",
                releaseId: "test",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
                mapEditing: "testwelt",
            };
            const post = (server: FastifyInstance, url: string, wer: string, payload: unknown) =>
                server.inject({
                    method: "POST",
                    url,
                    headers: { cookie: cookies.get(wer) ?? "", origin: TEST_ORIGIN },
                    payload: payload as object,
                });

            beforeAll(async () => {
                const fixture = authFixture(cluster.admin);
                for (const role of ["reviewer", "editor", "admin"] as const) {
                    const person = await fixture.person(role, { name: `Sperre ${role}` });
                    cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
                }
                // Wer die Form sperrt, braucht das Recht an der Form (WI-0279, Paket 6).
                const inhaber = await fixture.person("admin", { name: "Sperre inhaber" });
                cookies.set("inhaber", (await fixture.session(inhaber.id, { passkeyMinutesAgo: 1 })).cookie);
                const zweiter = await fixture.person("admin", { name: "Sperre zweiter" });
                cookies.set("zweiter", (await fixture.session(zweiter.id, { passkeyMinutesAgo: 1 })).cookie);
                app = buildApp({ config, database: cluster.app, logStream: { write: () => undefined } });
                aus = buildApp({
                    config: { ...config, mapEditing: "off" },
                    database: cluster.app,
                    logStream: { write: () => undefined },
                });
                await app.ready();
                await aus.ready();
            });
            afterAll(async () => {
                await app?.close();
                await aus?.close();
            });

            it("🔴 nehmen, 409 mit dem, der hält, Herzschlag, freigeben; Rechte und Schalter vor jeder Abfrage", async () => {
                const run = randomUUID();
                const ziel = { kind: "landscape", id: FLAECHE };
                expect((await post(app, EDITOR_LOCKS_URL, "keiner", { ...ziel, part: "felder", run })).statusCode).toBe(
                    401,
                );
                const ohneRecht = await post(app, EDITOR_LOCKS_URL, "reviewer", { ...ziel, part: "felder", run });
                expect([ohneRecht.statusCode, ohneRecht.json().error.code]).toEqual([403, "forbidden"]);
                const ausgeschaltet = await post(aus, EDITOR_LOCKS_URL, "inhaber", { ...ziel, part: "form", run });
                expect([ausgeschaltet.statusCode, ausgeschaltet.json().error.code]).toEqual([423, "map_editing_off"]);

                const genommen = await post(app, EDITOR_LOCKS_URL, "inhaber", { ...ziel, part: "form", run });
                expect(genommen.statusCode).toBe(200);
                expect((genommen.json() as { lock: EditorLock }).lock).toMatchObject({
                    own: true,
                    person: { name: "Sperre inhaber" },
                });

                const gesperrt = await post(app, EDITOR_LOCKS_URL, "zweiter", {
                    ...ziel,
                    part: "form",
                    run: randomUUID(),
                });
                expect(gesperrt.statusCode).toBe(409);
                expect(gesperrt.json().error).toMatchObject({
                    code: "object_locked",
                    details: { lock: { own: false, part: "form", person: { name: "Sperre inhaber" } } },
                });

                const schlag = await post(app, `${EDITOR_LOCKS_URL}/heartbeat`, "inhaber", { run, locks: [ziel] });
                expect([schlag.statusCode, schlag.json()]).toEqual([200, { lost: [] }]);
                const liste = await app.inject({
                    method: "GET",
                    url: `${EDITOR_LOCKS_URL}?kind=landscape&run=${run}`,
                    headers: { cookie: cookies.get("reviewer")! },
                });
                expect(liste.json().locks).toMatchObject([{ id: FLAECHE, own: true }]);
                expect((await post(app, `${EDITOR_LOCKS_URL}/release`, "inhaber", { run, ...ziel })).statusCode).toBe(
                    204,
                );
                const ersterLauf = randomUUID();
                const frei = await post(app, EDITOR_LOCKS_URL, "zweiter", { ...ziel, part: "form", run: ersterLauf });
                expect(frei.statusCode).toBe(200);

                // Dasselbe Konto in einem zweiten Fenster: übernimmt, das erste Fenster sieht kein Schloss und verliert sie beim Herzschlag.
                const uebernommen = await post(app, EDITOR_LOCKS_URL, "zweiter", {
                    ...ziel,
                    part: "form",
                    run: randomUUID(),
                });
                expect(uebernommen.statusCode).toBe(200);
                const listeVon = (wer: string) =>
                    app.inject({
                        method: "GET",
                        url: `${EDITOR_LOCKS_URL}?kind=landscape&run=${ersterLauf}`,
                        headers: { cookie: cookies.get(wer)! },
                    });
                expect((await listeVon("zweiter")).json().locks).toMatchObject([{ id: FLAECHE, own: true }]);
                expect((await listeVon("inhaber")).json().locks).toMatchObject([{ id: FLAECHE, own: false }]);
                const verloren = await post(app, `${EDITOR_LOCKS_URL}/heartbeat`, "zweiter", {
                    run: ersterLauf,
                    locks: [ziel],
                });
                expect(verloren.json()).toEqual({ lost: [ziel] });
            });

            it("🔴 WI-0279 Paket 6: Ein Editor sperrt die Felder, nicht die Form", async () => {
                const run = randomUUID();
                const ziel = { kind: "landscape", id: ANDERE };
                const form = await post(app, EDITOR_LOCKS_URL, "editor", { ...ziel, part: "form", run });
                expect([form.statusCode, form.json().error.code]).toEqual([403, "forbidden"]);
                const felder = await post(app, EDITOR_LOCKS_URL, "editor", { ...ziel, part: "felder", run });
                expect(felder.statusCode).toBe(200);
                expect((await post(app, `${EDITOR_LOCKS_URL}/release`, "editor", { run, ...ziel })).statusCode).toBe(
                    204,
                );
            });

            it("🔴 aufheben: nur ein Admin; wer hielt, verliert die Sperre beim nächsten Herzschlag", async () => {
                const run = randomUUID();
                const ziel = { kind: "landscape", id: ANDERE };
                expect((await post(app, EDITOR_LOCKS_URL, "inhaber", { ...ziel, part: "form", run })).statusCode).toBe(
                    200,
                );
                const ohneRecht = await post(app, `${EDITOR_LOCKS_URL}/lift`, "editor", ziel);
                expect([ohneRecht.statusCode, ohneRecht.json().error.code]).toEqual([403, "forbidden"]);
                expect((await post(app, `${EDITOR_LOCKS_URL}/lift`, "admin", ziel)).statusCode).toBe(204);
                const schlag = await post(app, `${EDITOR_LOCKS_URL}/heartbeat`, "inhaber", { run, locks: [ziel] });
                expect(schlag.json()).toEqual({ lost: [ziel] });
            });
        });
    },
);
