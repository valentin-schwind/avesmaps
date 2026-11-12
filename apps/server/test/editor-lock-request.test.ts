import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    EDITOR_LOCKS_URL,
    EDITOR_LOCK_REQUEST_KEEP_MINUTES,
    EDITOR_LOCK_REQUEST_MINUTES,
    type EditorLockIncoming,
    type EditorLockRequest,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { beatEditorLocks, listEditorLocks, releaseEditorLock, takeEditorLock } from "../src/editor/editor-lock.ts";
import {
    answerEditorLockRequest,
    askEditorLockRelease,
    incomingEditorLockRequests,
    ownEditorLockRequests,
} from "../src/editor/editor-lock-request.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture } from "./support/auth-fixture.ts";
import { postgresBin, startVpsCluster, type VpsCluster } from "./support/vps-cluster.ts";

/**
 * Die Bitte um Freigabe einer Sperre (WI-0262, OPS-000059; Migration 0253), im Wegwerf-Cluster mit den Rollen und Rechten des VPS: die
 * Logik als App-Rolle, die Routen gegen denselben Cluster (Muster `editor-lock.test.ts`).
 *
 * Problemfälle: Eine zweite offene Bitte derselben Person an dieselbe Sperre entsteht (auch bei zwei zugleich); eine abgelaufene Bitte
 * blockiert die nächste oder wird noch dem Inhaber gezeigt; ein anderer antwortet für den Inhaber (anderer Mensch, oder derselbe
 * Mensch in einem anderen Fenster); „freigegeben“ lässt die Sperre stehen; eine Antwort auf eine abgelaufene Bitte gilt noch;
 * eine Bitte an die eigene oder an eine nicht gesperrte Sperre; die Bitte einer Person erscheint in der Liste einer anderen;
 * ohne Recht oder bei ausgeschaltetem Bearbeiten wird gebeten; die App darf die Tafel leeren.
 */
const ENV = "bitttest";
const vorlage = (name: string): string => fileURLToPath(new URL(`../src/db/${name}`, import.meta.url));
const ORT = "b9b9b9b9-0000-4000-8000-000000000001";
const ORT2 = "b9b9b9b9-0000-4000-8000-000000000002";
const ORT3 = "b9b9b9b9-0000-4000-8000-000000000003";
const thomas = { personId: "b9b9b9b9-0000-4000-8000-00000000aa01", personName: "Thomas" };
const valentin = { personId: "b9b9b9b9-0000-4000-8000-00000000aa02", personName: "Valentin" };
const dritte = { personId: "b9b9b9b9-0000-4000-8000-00000000aa03", personName: "Dritte" };

describe.skipIf(postgresBin === undefined)("Freigabe einer Sperre erbitten (WI-0262)", { timeout: 240_000 }, () => {
    let cluster: VpsCluster;

    beforeAll(async () => {
        cluster = await startVpsCluster(ENV, [vorlage("auth-grants.psql"), vorlage("map-grants.psql")], {
            mapDomains: true,
        });
    }, 240_000);
    afterAll(async () => {
        await cluster?.stop();
    });

    const sperre = (id: string, run: string, wer = thomas) =>
        takeEditorLock(cluster.app, { kind: "place", id, part: "felder", run, ...wer });
    const bitte = (id: string, run: string, wer = valentin) =>
        askEditorLockRelease(cluster.app, { kind: "place", id, run, ...wer });
    const aufraeumen = async () => {
        await cluster.admin`DELETE FROM editor_lock_request`;
        await cluster.admin`DELETE FROM editor_lock`;
    };

    it("🔴 bitten: die Bitte merkt sich den Halter und läuft nach 5 Minuten ab; der Bittende sieht sie offen", async () => {
        const halter = randomUUID();
        const bittender = randomUUID();
        await sperre(ORT, halter);
        const ergebnis = await bitte(ORT, bittender);
        expect(ergebnis).toMatchObject({
            art: "gestellt",
            request: { kind: "place", id: ORT, state: "open" },
        });
        if (ergebnis.art !== "gestellt") throw new Error("nicht gestellt");
        const dauer = Date.parse(ergebnis.request.expiresAt) - Date.parse(ergebnis.request.createdAt);
        expect(dauer).toBeGreaterThan((EDITOR_LOCK_REQUEST_MINUTES * 60 - 5) * 1000);
        expect(dauer).toBeLessThanOrEqual((EDITOR_LOCK_REQUEST_MINUTES * 60 + 5) * 1000);
        const eigene = await ownEditorLockRequests(cluster.app, valentin.personId, "place");
        expect(eigene.map((b) => [b.requestId, b.state])).toEqual([[ergebnis.request.requestId, "open"]]);
        // Der Inhaber sieht sie mit dem Namen des Bittenden; ein anderer Lauf und eine andere Art sehen nichts.
        const eingang = await incomingEditorLockRequests(cluster.app, halter);
        expect(eingang).toMatchObject([
            { requestId: ergebnis.request.requestId, kind: "place", id: ORT, from: { name: "Valentin" } },
        ]);
        expect(await incomingEditorLockRequests(cluster.app, bittender)).toEqual([]);
        expect(await ownEditorLockRequests(cluster.app, valentin.personId, "path")).toEqual([]);
        expect(await ownEditorLockRequests(cluster.app, thomas.personId, "place")).toEqual([]);
        await aufraeumen();
    });

    it("🔴 höchstens eine offene Bitte je Person und Sperre, auch bei zwei zugleich; eine andere Person darf zusätzlich bitten", async () => {
        const halter = randomUUID();
        await sperre(ORT, halter);
        const laeufe = [randomUUID(), randomUUID(), randomUUID()];
        const ergebnisse = await Promise.all(laeufe.map((run) => bitte(ORT, run)));
        expect(ergebnisse.filter((e) => e.art === "gestellt")).toHaveLength(1);
        expect(ergebnisse.filter((e) => e.art === "offen")).toHaveLength(2);
        const offen = ergebnisse.find((e) => e.art === "offen");
        const gestellt = ergebnisse.find((e) => e.art === "gestellt");
        expect(offen?.art === "offen" && gestellt?.art === "gestellt" && offen.request.requestId).toBe(
            gestellt?.art === "gestellt" ? gestellt.request.requestId : "",
        );
        // Eine zweite Person bittet für sich; der Inhaber sieht beide.
        expect((await bitte(ORT, randomUUID(), dritte)).art).toBe("gestellt");
        expect(await incomingEditorLockRequests(cluster.app, halter)).toHaveLength(2);
        await aufraeumen();
    });

    it("🔴 ohne Sperre oder an die eigene Sperre gibt es keine Bitte", async () => {
        const run = randomUUID();
        expect((await bitte(ORT, run)).art).toBe("nicht_gesperrt");
        await sperre(ORT, run);
        expect((await bitte(ORT, run, thomas)).art).toBe("eigene_sperre");
        // Eine abgelaufene Sperre (kein Herzschlag seit 16 Minuten) ist frei: Bitten ist unnötig.
        await cluster.admin`UPDATE editor_lock SET heartbeat_at = now() - interval '16 minutes' WHERE object_id = ${ORT}`;
        expect((await bitte(ORT, randomUUID())).art).toBe("nicht_gesperrt");
        await aufraeumen();
    });

    it("🔴 Ablauf: nach 5 Minuten steht die Bitte als abgelaufen da, erreicht den Inhaber nicht mehr, und eine neue geht", async () => {
        const halter = randomUUID();
        await sperre(ORT, halter);
        const erst = await bitte(ORT, randomUUID());
        if (erst.art !== "gestellt") throw new Error("nicht gestellt");
        await cluster.admin`UPDATE editor_lock_request SET expires_at = now() - interval '1 second', created_at = now() - interval '5 minutes' WHERE id = ${erst.request.requestId}`;
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place")).map((b) => b.state)).toEqual([
            "expired",
        ]);
        expect(await incomingEditorLockRequests(cluster.app, halter)).toEqual([]);
        // Eine Antwort darauf gilt nicht mehr.
        expect(
            await answerEditorLockRequest(cluster.app, {
                requestId: erst.request.requestId,
                run: halter,
                personId: thomas.personId,
                answer: "released",
            }),
        ).toBe("geschlossen");
        expect(await listEditorLocks(cluster.app, "place", undefined)).toHaveLength(1);
        // Eine neue Bitte ist jetzt möglich; die alte Zeile steht auf abgelaufen.
        const zweit = await bitte(ORT, randomUUID());
        expect(zweit.art).toBe("gestellt");
        const zeilen = await cluster.admin<
            { state: string }[]
        >`SELECT state FROM editor_lock_request ORDER BY created_at, id`;
        expect(zeilen.map((z) => z.state).sort()).toEqual(["expired", "open"]);
        // Nach EDITOR_LOCK_REQUEST_KEEP_MINUTES verschwindet die abgelaufene Bitte aus der Liste des Bittenden.
        await cluster.admin`UPDATE editor_lock_request SET expires_at = now() - make_interval(mins => ${EDITOR_LOCK_REQUEST_KEEP_MINUTES + 1}), state = 'expired' WHERE id = ${erst.request.requestId}`;
        const liste = await ownEditorLockRequests(cluster.app, valentin.personId, "place");
        expect(liste.map((b) => b.requestId)).not.toContain(erst.request.requestId);
        await aufraeumen();
    });

    it("🔴 nur der Inhaber antwortet: ein anderer Mensch nicht, derselbe Mensch in einem anderen Fenster nicht, der Bittende nicht", async () => {
        const halter = randomUUID();
        const bittender = randomUUID();
        await sperre(ORT, halter);
        const b = await bitte(ORT, bittender);
        if (b.art !== "gestellt") throw new Error("nicht gestellt");
        const antwort = (run: string, wer: string, answer: "released" | "later" = "released") =>
            answerEditorLockRequest(cluster.app, { requestId: b.request.requestId, run, personId: wer, answer });
        expect(await antwort(halter, valentin.personId)).toBe("nicht_halter");
        expect(await antwort(bittender, valentin.personId)).toBe("nicht_halter");
        expect(await antwort(randomUUID(), thomas.personId)).toBe("nicht_halter");
        expect(await antwort(bittender, dritte.personId)).toBe("nicht_halter");
        expect(
            await answerEditorLockRequest(cluster.app, {
                requestId: randomUUID(),
                run: halter,
                personId: thomas.personId,
                answer: "later",
            }),
        ).toBe("unbekannt");
        // Nichts davon hat die Sperre berührt oder die Bitte geschlossen.
        expect(await listEditorLocks(cluster.app, "place", bittender)).toHaveLength(1);
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("open");
        await aufraeumen();
    });

    it("🔴 „später“ lässt die Sperre stehen; der Bittende liest „später“ und kann danach erneut bitten", async () => {
        const halter = randomUUID();
        await sperre(ORT, halter);
        const b = await bitte(ORT, randomUUID());
        if (b.art !== "gestellt") throw new Error("nicht gestellt");
        expect(
            await answerEditorLockRequest(cluster.app, {
                requestId: b.request.requestId,
                run: halter,
                personId: thomas.personId,
                answer: "later",
            }),
        ).toBe("ok");
        expect(await listEditorLocks(cluster.app, "place", undefined)).toHaveLength(1);
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]).toMatchObject({
            requestId: b.request.requestId,
            state: "later",
        });
        expect(await incomingEditorLockRequests(cluster.app, halter)).toEqual([]);
        // Dieselbe Antwort noch einmal ist kein Fehler; eine andere auf die beantwortete Bitte gilt nicht.
        const nochmal = { requestId: b.request.requestId, run: halter, personId: thomas.personId };
        expect(await answerEditorLockRequest(cluster.app, { ...nochmal, answer: "later" })).toBe("ok");
        expect(await answerEditorLockRequest(cluster.app, { ...nochmal, answer: "released" })).toBe("geschlossen");
        expect(await listEditorLocks(cluster.app, "place", undefined)).toHaveLength(1);
        expect((await bitte(ORT, randomUUID())).art).toBe("gestellt");
        await aufraeumen();
    });

    it("🔴 „freigegeben“ gibt die Sperre frei, und der Bittende nimmt sie sofort", async () => {
        const halter = randomUUID();
        const bittender = randomUUID();
        await sperre(ORT, halter);
        const b = await bitte(ORT, bittender);
        if (b.art !== "gestellt") throw new Error("nicht gestellt");
        expect(
            await answerEditorLockRequest(cluster.app, {
                requestId: b.request.requestId,
                run: halter,
                personId: thomas.personId,
                answer: "released",
            }),
        ).toBe("ok");
        expect(await listEditorLocks(cluster.app, "place", undefined)).toEqual([]);
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("released");
        expect(await beatEditorLocks(cluster.app, halter, [{ kind: "place", id: ORT }])).toEqual([
            { kind: "place", id: ORT },
        ]);
        const genommen = await takeEditorLock(cluster.app, {
            kind: "place",
            id: ORT,
            part: "felder",
            run: bittender,
            ...valentin,
        });
        expect(genommen.taken).toBe(true);
        // Die Bitte gilt dem früheren Halter: Sie belebt sich mit der neuen Sperre nicht wieder.
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("released");
        await aufraeumen();
    });

    it("🔴 hat der Browser die Sperre nach dem Speichern schon abgegeben, bleibt „freigegeben“ gültig und die Antwort ein Erfolg", async () => {
        const halter = randomUUID();
        await sperre(ORT, halter);
        const b = await bitte(ORT, randomUUID());
        if (b.art !== "gestellt") throw new Error("nicht gestellt");
        // Fertig: Der Browser gibt frei, ohne zu antworten. Der Bittende liest sofort „freigegeben“.
        expect(await releaseEditorLock(cluster.app, halter, { kind: "place", id: ORT })).toBe(true);
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("released");
        expect(await incomingEditorLockRequests(cluster.app, halter)).toEqual([]);
        expect(
            await answerEditorLockRequest(cluster.app, {
                requestId: b.request.requestId,
                run: halter,
                personId: thomas.personId,
                answer: "released",
            }),
        ).toBe("ok");
        await aufraeumen();
    });

    it("🔴 fällt die Sperre ohne Antwort (Herzschlag aus) oder nimmt ein anderer sie, liest der Bittende „freigegeben“ bzw. „abgelaufen“", async () => {
        const halter = randomUUID();
        await sperre(ORT2, halter);
        await bitte(ORT2, randomUUID());
        await cluster.admin`UPDATE editor_lock SET heartbeat_at = now() - interval '16 minutes' WHERE object_id = ${ORT2}`;
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("released");
        // Ein Dritter nimmt die abgelaufene Sperre: Die Bitte galt dem früheren Halter und ist erledigt.
        await takeEditorLock(cluster.app, {
            kind: "place",
            id: ORT2,
            part: "felder",
            run: randomUUID(),
            ...dritte,
        });
        expect((await ownEditorLockRequests(cluster.app, valentin.personId, "place"))[0]?.state).toBe("expired");
        expect(await incomingEditorLockRequests(cluster.app, halter)).toEqual([]);
        // Eine neue Bitte an den neuen Halter ist möglich.
        expect((await bitte(ORT2, randomUUID())).art).toBe("gestellt");
        await aufraeumen();
    });

    it("alte Zeilen räumt das Bitten weg; die App darf die Tafel nicht leeren", async () => {
        await sperre(ORT3, randomUUID());
        await bitte(ORT3, randomUUID());
        await cluster.admin`UPDATE editor_lock_request SET created_at = now() - interval '25 hours', state = 'expired'`;
        await bitte(ORT3, randomUUID(), dritte);
        const [zaehlung] = await cluster.admin<{ n: number }[]>`SELECT count(*)::int AS n FROM editor_lock_request`;
        expect(zaehlung?.n).toBe(1);
        expect(await cluster.granted(cluster.roles.app, "editor_lock_request")).toEqual([
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
        ]);
        expect(await cluster.codesAs(cluster.app, ["TRUNCATE editor_lock_request"])).toEqual(["42501"]);
        await aufraeumen();
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
        const liste = (wer: string, kind = "place") =>
            app.inject({
                method: "GET",
                url: `${EDITOR_LOCKS_URL}?kind=${kind}`,
                headers: { cookie: cookies.get(wer) ?? "" },
            });
        const ziel = { kind: "place", id: ORT };

        beforeAll(async () => {
            const fixture = authFixture(cluster.admin);
            for (const role of ["reviewer", "editor", "admin"] as const) {
                const person = await fixture.person(role, { name: `Bitte ${role}` });
                cookies.set(role, (await fixture.session(person.id, { passkeyMinutesAgo: 1 })).cookie);
            }
            const zweiter = await fixture.person("editor", { name: "Bitte zweiter" });
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

        it("🔴 bitten und antworten über die Routen: Herzschlag liefert dem Inhaber, die Liste dem Bittenden; „freigegeben“ gibt frei", async () => {
            const halter = randomUUID();
            const bittender = randomUUID();
            expect(
                (await post(app, EDITOR_LOCKS_URL, "editor", { ...ziel, part: "felder", run: halter })).statusCode,
            ).toBe(200);
            // Ohne Bitte bleibt der Herzschlag so klein wie zuvor.
            const still = await post(app, `${EDITOR_LOCKS_URL}/heartbeat`, "editor", { run: halter, locks: [ziel] });
            expect([still.statusCode, still.json()]).toEqual([200, { lost: [] }]);

            const gebeten = await post(app, `${EDITOR_LOCKS_URL}/request`, "zweiter", { ...ziel, run: bittender });
            expect(gebeten.statusCode).toBe(200);
            const bittenAntwort = gebeten.json() as { request: EditorLockRequest };
            expect(bittenAntwort.request).toMatchObject({ kind: "place", id: ORT, state: "open" });
            const requestId = bittenAntwort.request.requestId;

            // Zweimal ist zu viel: 409 mit der offenen Bitte.
            const doppelt = await post(app, `${EDITOR_LOCKS_URL}/request`, "zweiter", { ...ziel, run: randomUUID() });
            expect(doppelt.statusCode).toBe(409);
            expect(doppelt.json().error).toMatchObject({ code: "request_open", details: { request: { requestId } } });

            // Der Inhaber liest die Bitte mit dem Herzschlag, mit dem Namen des Bittenden.
            const schlag = await post(app, `${EDITOR_LOCKS_URL}/heartbeat`, "editor", { run: halter, locks: [ziel] });
            expect(schlag.json()).toMatchObject({
                lost: [],
                requests: [{ requestId, kind: "place", id: ORT, from: { name: "Bitte zweiter" } }],
            });
            expect((schlag.json() as { requests: EditorLockIncoming[] }).requests).toHaveLength(1);
            // Der Bittende liest seinen Stand mit der Liste, der Inhaber nicht.
            expect((await liste("zweiter")).json().requests).toMatchObject([{ requestId, state: "open" }]);
            expect((await liste("editor")).json().requests).toBeUndefined();

            // Nur der Inhaber antwortet: der Bittende bekommt 403, ein unbekanntes Ziel 404.
            const falsch = await post(app, `${EDITOR_LOCKS_URL}/request/answer`, "zweiter", {
                requestId,
                run: bittender,
                answer: "released",
            });
            expect([falsch.statusCode, falsch.json().error.code]).toEqual([403, "not_lock_holder"]);
            const unbekannt = await post(app, `${EDITOR_LOCKS_URL}/request/answer`, "editor", {
                requestId: randomUUID(),
                run: halter,
                answer: "released",
            });
            expect([unbekannt.statusCode, unbekannt.json().error.code]).toEqual([404, "request_not_found"]);
            expect((await liste("zweiter")).json().locks).toHaveLength(1);

            const ok = await post(app, `${EDITOR_LOCKS_URL}/request/answer`, "editor", {
                requestId,
                run: halter,
                answer: "released",
            });
            expect(ok.statusCode).toBe(204);
            expect((await liste("zweiter")).json()).toMatchObject({
                locks: [],
                requests: [{ requestId, state: "released" }],
            });
            const jetzt = await post(app, EDITOR_LOCKS_URL, "zweiter", { ...ziel, part: "felder", run: bittender });
            expect(jetzt.statusCode).toBe(200);
            await aufraeumen();
        });

        it("🔴 Rechte und Schalter: ohne Anmeldung 401, ohne Recht zum Bearbeiten 403, bei ausgeschaltetem Bearbeiten 423; Antworten geht immer", async () => {
            const halter = randomUUID();
            await post(app, EDITOR_LOCKS_URL, "editor", { ...ziel, part: "felder", run: halter });
            const bitteOhne = (wer: string, server = app) =>
                post(server, `${EDITOR_LOCKS_URL}/request`, wer, { ...ziel, run: randomUUID() });
            expect((await bitteOhne("keiner")).statusCode).toBe(401);
            const ohneRecht = await bitteOhne("reviewer");
            expect([ohneRecht.statusCode, ohneRecht.json().error.code]).toEqual([403, "forbidden"]);
            const ausgeschaltet = await bitteOhne("zweiter", aus);
            expect([ausgeschaltet.statusCode, ausgeschaltet.json().error.code]).toEqual([423, "map_editing_off"]);
            expect((await cluster.admin`SELECT 1 FROM editor_lock_request`).length).toBe(0);

            // Eine Bitte an die eigene Sperre und an ein freies Objekt: 409 mit eigenem Code.
            const eigene = await post(app, `${EDITOR_LOCKS_URL}/request`, "editor", { ...ziel, run: halter });
            expect([eigene.statusCode, eigene.json().error.code]).toEqual([409, "own_lock"]);
            const frei = await post(app, `${EDITOR_LOCKS_URL}/request`, "zweiter", {
                kind: "place",
                id: ORT3,
                run: randomUUID(),
            });
            expect([frei.statusCode, frei.json().error.code]).toEqual([409, "not_locked"]);

            // Antworten geht auch bei ausgeschaltetem Bearbeiten: Der Inhaber soll eine offene Bitte beantworten können.
            const gestellt = await post(app, `${EDITOR_LOCKS_URL}/request`, "zweiter", { ...ziel, run: randomUUID() });
            const requestId = (gestellt.json() as { request: EditorLockRequest }).request.requestId;
            const spaeter = await post(aus, `${EDITOR_LOCKS_URL}/request/answer`, "editor", {
                requestId,
                run: halter,
                answer: "later",
            });
            expect(spaeter.statusCode).toBe(204);
            // Eine zweite Antwort, die der ersten widerspricht, trifft eine geschlossene Bitte.
            const widerspruch = await post(app, `${EDITOR_LOCKS_URL}/request/answer`, "editor", {
                requestId,
                run: halter,
                answer: "released",
            });
            expect([widerspruch.statusCode, widerspruch.json().error.code]).toEqual([409, "request_closed"]);
            // Falsch geformte Anfragen weist das Schema ab.
            expect(
                (
                    await post(app, `${EDITOR_LOCKS_URL}/request/answer`, "editor", {
                        requestId,
                        run: halter,
                        answer: "ja",
                    })
                ).statusCode,
            ).toBe(400);
            await aufraeumen();
        });
    });
});
