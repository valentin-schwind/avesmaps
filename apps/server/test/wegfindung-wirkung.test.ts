import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    MAP_SETTINGS_URL,
    WEGFINDUNG_FREIGABE_URL,
    WEGFINDUNG_IM_BROWSER,
    WEGFINDUNG_URL,
    WEGFINDUNG_WERTE,
    wegfindungVorgaben,
    type AdminWegfindung,
    type MapSettings,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database, type Queryable } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { WEGFINDUNG_VORGABEN } from "../src/routing/einstellungen.ts";
import { loadLooseEndpoints, measureLooseEndpoints } from "../src/routing/loose-endpoints.ts";
import type { PathRow, RouteNode } from "../src/routing/network.ts";
import type { RouteRunner } from "../src/routing/runner.ts";
import type { RouteQuery } from "../src/routing/service.ts";
import type { WaypointIndex } from "../src/routing/waypoints.ts";
import { readRouteSegments } from "../src/subjects/path-route.ts";
import {
    leseWegfindung,
    vergissWegfindungswerte,
    WEGFINDUNG_LESEN_MS,
    wegfindungswerte,
} from "../src/system/wegfindungsstand.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Regler der Wegfindung WIRKEN (WI-0214, Befunde S3-01, S3-02, S3-08 und P1-09 des Code-Reviews vom 2026-10-16).
 *
 * Vorher prüften die Tests nur, dass Tafel und Konstante übereinstimmen. Dabei blieb unbemerkt, dass der Fastify-Hauptthread
 * nie einen eingestellten Wert sah (`werte()` setzt nur der Routing-Worker, und Worker-Threads haben eigene Module) und
 * dass zwei Regler niemand las. Diese Datei prüft die Seite außerhalb des Workers:
 *
 * 1. zwei Wächter am Quelltext (jede Kennung hat einen Leser; außerhalb des Workers liest niemand `werte()`),
 * 2. die Lesestelle des Hauptthreads (`wegfindungswerte`): Regel, Zwischenspeicher, Grenzen, Ausfall,
 * 3. je Hauptthread-Wert ein abweichender Wert in der DATENBANK und seine Wirkung an der Schnittstelle (`app.inject`),
 * 4. die Prüfhaken mit den eingestellten Abständen.
 *
 * Die Werte, die der Routing-Worker liest, prüft `wegfindung-wirkung-worker.test.ts` Kennung für Kennung; die Kette von der
 * Tafel bis in den Worker `wegfindung-einstellungen.test.ts`.
 */

const SRC = join(import.meta.dirname, "..", "src");
const WEB_SRC = join(import.meta.dirname, "..", "..", "web", "src");

function quellen(wurzel: string): string[] {
    const raus: string[] = [];
    for (const name of readdirSync(wurzel)) {
        const pfad = join(wurzel, name);
        if (statSync(pfad).isDirectory()) raus.push(...quellen(pfad));
        else if (/\.(ts|vue)$/u.test(name)) raus.push(pfad);
    }
    return raus;
}

describe("Wächter am Quelltext", () => {
    const server = quellen(SRC).map((pfad) => ({
        pfad: relative(SRC, pfad).replaceAll("\\", "/"),
        text: readFileSync(pfad, "utf8"),
    }));
    const web = quellen(WEB_SRC).map((pfad) => ({ pfad, text: readFileSync(pfad, "utf8") }));

    it("🔴 jede Kennung des Registers hat einen Leser außerhalb des Registers", () => {
        // `exitNearestTries` und `directEdgeMiles` standen nur im Register: `map-points.ts` las die Konstanten (S3-02).
        const texte = [...server, ...web].map((datei) => datei.text);
        const ohneLeser = WEGFINDUNG_WERTE.map((wert) => wert.id).filter((id) => {
            const zugriff = new RegExp(`(\\.${id}\\b|anteil\\("${id}"\\))`, "u");
            return !texte.some((text) => zugriff.test(text));
        });
        expect(ohneLeser).toEqual([]);
    });

    it("🔴 außerhalb des Routing-Workers liest niemand `werte()` oder `anteil()`", () => {
        // Das ist der Zustand EINES Threads, gesetzt nur im Worker (`service.ts`). Im Hauptthread stand er für immer auf den
        // Vorgaben (S3-01); dort gilt die Lesestelle `wegfindungswerte` aus `system/wegfindungsstand.ts`.
        // 🪤 Die Prüfhaken in `routing/` laufen im Hauptthread, also gilt die Regel für sie auch.
        const hauptthreadInRouting = new Set(["routing/loose-endpoints.ts", "routing/topology-findings.ts"]);
        const import_ = /import\s*\{[^}]*\b(werte|anteil)\b[^}]*\}\s*from\s*"[^"]*einstellungen\.ts"/u;
        const verstoesse = server
            .filter((datei) => !datei.pfad.startsWith("routing/") || hauptthreadInRouting.has(datei.pfad))
            .filter((datei) => import_.test(datei.text))
            .map((datei) => datei.pfad);
        expect(verstoesse).toEqual([]);
    });
});

describe("Die Prüfhaken messen mit den eingestellten Abständen (ohne Datenbank)", () => {
    // Fall 1 aus `loose-endpoints.test.ts`: zwei Wege enden 0,3 neben dem Rasthof und 0,002 voneinander.
    const ort = (id: string, x: number, y: number): RouteNode => ({
        id,
        name: id,
        kind: "place",
        isHidden: false,
        subtype: "dorf",
        x,
        y,
    });
    const weg = (id: string, points: [number, number][]): PathRow => ({
        public_id: id,
        name: id,
        subtype: "Strasse",
        coordinates: JSON.stringify({ type: "LineString", coordinates: points }),
        allowed_transports: null,
        transport_domain: null,
        flow_direction: null,
        flow_factor: null,
    });
    const orte = [ort("start", 8, 10), ort("rasthof", 10.3, 10), ort("ziel", 13, 10)];
    const wege = [
        weg("weg-a", [
            [8, 10],
            [10, 10],
        ]),
        weg("weg-b", [
            [10.002, 10],
            [13, 10],
        ]),
    ];
    const messe = (abweichung: Partial<typeof WEGFINDUNG_VORGABEN> = {}) =>
        measureLooseEndpoints(orte, wege, [], { werte: { ...WEGFINDUNG_VORGABEN, ...abweichung } });

    it("`looseDistance`: über dem eingestellten Abstand ist ein Ende nicht mehr lose", () => {
        expect(messe().loose).toHaveLength(2);
        expect(messe().looseDistance).toBe(0.05);
        const weiter = messe({ looseDistance: 0.4 });
        expect(weiter.loose).toHaveLength(0);
        expect(weiter.looseDistance).toBe(0.4);
    });

    it("`endpointBox`: ein kleinerer Ortskasten hängt die Enden nicht mehr an den Rasthof", () => {
        const klein = messe({ endpointBox: 0.2 });
        expect(klein.endpointBox).toBe(0.2);
        // Ohne den Rasthof hängen die Enden an ihren eigenen technischen Knoten: nichts mehr 0,3 daneben.
        expect(klein.loose).toHaveLength(0);
    });

    it("`endSnap`: ohne Ortskasten verbindet erst der eingestellte Fangradius die beiden Enden", () => {
        const getrennt = messe({ endpointBox: 0.2, endSnap: 0.001 });
        const verbunden = messe({ endpointBox: 0.2, endSnap: 0.02 });
        expect(getrennt.deadEnds).toBeGreaterThan(verbunden.deadEnds);
    });
});

describe("Fehlerfall: die Grenzen lassen sich nicht lesen", () => {
    /**
     * 🔴 Geschlossen, nicht offen (Sicherheitsprüfung 2026-10-17): Hat der Prozess die Grenzen nie gelesen und ist die
     * Datenbank weg, weist er ab. Mit den Vorgaben stünde eine abgesenkte Lastschraube (S-04) im Störfall still offen.
     */
    it("503 statt der Vorgaben, und der Routenrechner sieht nichts", async () => {
        const gerechnet: RouteQuery[] = [];
        const gesucht: number[] = [];
        // Port 9 nimmt keine Verbindung an: Jede Abfrage scheitert sofort.
        const tot = createDatabase("postgres://niemand@127.0.0.1:9/keine", { max: 1, connectTimeoutS: 1 });
        const app = buildApp({
            config: {
                port: 0,
                host: "127.0.0.1",
                releaseId: "wi0214-tot",
                databaseUrl: undefined,
                tileRoot: undefined,
                auth: TEST_AUTH,
            },
            database: tot,
            routeRunner: {
                run: (query) => {
                    gerechnet.push(query);
                    return Promise.resolve({ ok: false, error: "routing_failed" });
                },
                warm: () => undefined,
                status: () => ({ state: "ready", ageMs: 0 }),
                close: () => Promise.resolve(),
            },
            waypointIndex: {
                lookup: (query, limit) => {
                    gesucht.push(limit);
                    return Promise.resolve({ query, hits: [], truncated: false });
                },
                resolve: (names) => Promise.resolve(names.map(() => null)),
                byIds: (ids) => Promise.resolve(ids.map(() => null)),
                nearest: () => Promise.reject(new Error("nicht gebraucht")),
            },
            logStream: { write: () => undefined },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        try {
            await app.ready();
            const route = await app.inject({
                method: "GET",
                url: `/api/route?waypoints=${randomUUID()},${randomUUID()}`,
            });
            expect(route.statusCode).toBe(503);
            expect(route.json()).toEqual({ error: "database_unavailable" });
            // Über den Fehlerhandler des Hauses: mit Retry-After, wie jede andere Absage ohne Datenbank.
            expect(route.headers["retry-after"]).toBe("5");
            const suche = await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar" });
            expect(suche.statusCode).toBe(503);
            const namen = await app.inject({ method: "GET", url: "/api/route/waypoints/resolve?names=A~B" });
            expect(namen.statusCode).toBe(503);
            expect(gerechnet).toEqual([]);
            expect(gesucht).toEqual([]);
        } finally {
            await app.close();
            await tot.end({ timeout: 1 });
        }
    }, 60_000);
});

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0214-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Die Regler wirken außerhalb des Workers (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let appDatabase: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    /** Was der Routenrechner zu sehen bekam: Eine abgewiesene Anfrage darf ihn nie erreichen. */
    const gerechnet: RouteQuery[] = [];
    /** Mit welcher Grenze die Ortssuche gefragt wurde. */
    const gesucht: number[] = [];

    const runner: RouteRunner = {
        run: (query) => {
            gerechnet.push(query);
            return Promise.resolve({ ok: false, error: "routing_failed" });
        },
        warm: () => undefined,
        status: () => ({ state: "ready", ageMs: 0 }),
        close: () => Promise.resolve(),
    };
    const index: WaypointIndex = {
        lookup: (query, limit) => {
            gesucht.push(limit);
            return Promise.resolve({ query, hits: [], truncated: false });
        },
        resolve: (names) => Promise.resolve(names.map(() => null)),
        byIds: (ids) => Promise.resolve(ids.map(() => null)),
        nearest: () => Promise.reject(new Error("nicht gebraucht")),
    };

    const reset = async (): Promise<void> => {
        await database`DELETE FROM routing_setting`;
        await database`DELETE FROM routing_setting_applied`;
        await database`
            UPDATE job SET state = 'CANCELLED', finished_at = now()
             WHERE kind = 'routing_reload' AND state IN ('QUEUED', 'RUNNING')
        `;
        vergissWegfindungswerte(appDatabase);
        vergissWegfindungswerte(database);
        gerechnet.length = 0;
        gesucht.length = 0;
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        appDatabase = createDatabase(testDatabaseUrl as string, { max: 2 });
        app = buildApp({
            config: config(),
            database: appDatabase,
            routeRunner: runner,
            waypointIndex: index,
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = await fixture.person("operator", { name: "Rondrikan" });
        const { cookie } = await fixture.session(person.id, { assurance: "strong", passkeyMinutesAgo: 1 });
        operator = { cookie };
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const revision = async (): Promise<number> => {
        const response = await app.inject({ method: "GET", url: WEGFINDUNG_URL, headers: { cookie: operator.cookie } });
        return (response.json() as AdminWegfindung).revision!;
    };
    /** Verstellt über den Schreibweg der Systemsteuerung, wie ein Mensch es tut. */
    const setze = async (id: string, value: number): Promise<void> => {
        const response = await app.inject({
            method: "POST",
            url: WEGFINDUNG_URL,
            payload: { operationId: randomUUID(), baseRevision: await revision(), id, value },
            headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
        });
        expect(response.statusCode, response.body).toBe(200);
    };
    const freigib = async (): Promise<void> => {
        const response = await app.inject({
            method: "POST",
            url: WEGFINDUNG_FREIGABE_URL,
            payload: { operationId: randomUUID(), baseRevision: await revision() },
            headers: { origin: TEST_ORIGIN, cookie: operator.cookie },
        });
        expect(response.statusCode, response.body).toBe(200);
    };
    const route = (waypoints: readonly string[]) =>
        app.inject({ method: "GET", url: `/api/route?waypoints=${waypoints.join(",")}` });
    const orte = (n: number): string[] => Array.from({ length: n }, () => randomUUID());
    const kartenpunkte = (n: number): string[] =>
        Array.from({ length: n }, (_, k) => `p:${String(100 + k)}:${String(200 + k)}`);

    describe("die Lesestelle des Hauptthreads", () => {
        it("ohne Zeile die Vorgaben; ein Wert ohne Knopf gilt nach dem Speichern, einer am Knopf erst nach der Freigabe", async () => {
            expect(await wegfindungswerte(appDatabase)).toEqual(WEGFINDUNG_VORGABEN);
            await setze("looseDistance", 0.2);
            await setze("endpointBox", 0.3);
            const gespeichert = await wegfindungswerte(appDatabase);
            expect(gespeichert.looseDistance).toBe(0.2);
            // 🔴 Dieselbe Regel wie der Worker: am Knopf rechnet der freigegebene Stand.
            expect(gespeichert.endpointBox).toBe(0.5);
            await freigib();
            expect((await wegfindungswerte(appDatabase)).endpointBox).toBe(0.3);
        });

        it("hält einen Stand fünf Sekunden; verstellt jemand per SQL, sieht ihn die Lesestelle erst danach", async () => {
            let jetzt = 1_000_000;
            const uhr = () => jetzt;
            expect((await wegfindungswerte(database, uhr)).cellLimit).toBe(150_000);
            await database`INSERT INTO routing_setting (key, value, changed_by_label) VALUES ('cellLimit', 20000, 'test')`;
            expect((await wegfindungswerte(database, uhr)).cellLimit).toBe(150_000);
            jetzt += WEGFINDUNG_LESEN_MS;
            expect((await wegfindungswerte(database, uhr)).cellLimit).toBe(20_000);
        });

        it("🔴 P1-09: ein gespeicherter Wert außerhalb seiner Grenzen gilt nicht und steht in `unknownKeys`", async () => {
            // Der Seegraph hält je Hafenpaar EIN Byte: Mehr als 8 Sperrgebiete passen nicht hinein.
            await database`INSERT INTO routing_setting (key, value, changed_by_label) VALUES ('seaClosureLimit', 9, 'sql')`;
            await database`INSERT INTO routing_setting_applied (key, value) VALUES ('endSnap', 0.5)`;
            const stand = await leseWegfindung(database);
            expect(stand.unknownKeys.sort()).toEqual(["endSnap", "seaClosureLimit"]);
            expect(stand.zeilen.has("seaClosureLimit")).toBe(false);
            expect(stand.freigegeben.has("endSnap")).toBe(false);
            const werte = await wegfindungswerte(database);
            expect(werte.seaClosureLimit).toBe(8);
            expect(werte.endSnap).toBe(0.02);
        });

        it("fällt die Datenbank aus, gilt der zuletzt gelesene Stand; ohne Datenbank die Vorgaben", async () => {
            await setze("cellLimit", 30_000);
            let kaputt = false;
            // Eine Datenbank, die nach dem ersten Lesen ausfällt: Der Routenrechner rechnet weiter, die Grenzen auch.
            const wackelig = ((...args: Parameters<Queryable>) => {
                if (kaputt) return Promise.reject(new Error("Verbindung weg"));
                return (database as unknown as (...a: Parameters<Queryable>) => unknown)(...args);
            }) as unknown as Queryable;
            let jetzt = 0;
            expect((await wegfindungswerte(wackelig, () => jetzt)).cellLimit).toBe(30_000);
            kaputt = true;
            jetzt += WEGFINDUNG_LESEN_MS;
            expect((await wegfindungswerte(wackelig, () => jetzt)).cellLimit).toBe(30_000);
            expect(await wegfindungswerte(undefined)).toEqual(wegfindungVorgaben());
        });
    });

    describe("je Wert die Wirkung an der Schnittstelle", () => {
        it("`routeWaypointLimit`: mehr Wegpunkte als eingestellt erreichen den Routenrechner nicht", async () => {
            expect((await route(orte(4))).statusCode).not.toBe(400);
            expect(gerechnet).toHaveLength(1);
            await setze("routeWaypointLimit", 3);
            const zuViele = await route(orte(4));
            expect(zuViele.statusCode).toBe(400);
            expect((zuViele.json() as { code: string }).code).toBe("FST_ERR_VALIDATION");
            expect(gerechnet).toHaveLength(1);
            await route(orte(3));
            expect(gerechnet).toHaveLength(2);
            // Auch die Namen eines geteilten Links: dieselbe Grenze.
            const namen = await app.inject({ method: "GET", url: "/api/route/waypoints/resolve?names=A~B~C~D" });
            expect(namen.statusCode).toBe(400);
        });

        it("`routeMapPointLimit`: mehr Kartenpunkte als eingestellt werden abgewiesen", async () => {
            await route(kartenpunkte(2));
            expect(gerechnet).toHaveLength(1);
            await setze("routeMapPointLimit", 1);
            const zuViele = await route(kartenpunkte(2));
            expect(zuViele.statusCode).toBe(400);
            expect(zuViele.json()).toEqual({ error: "too_many_map_points", detail: "2" });
            expect(gerechnet).toHaveLength(1);
        });

        it("`waypointLookupLimit`: die Ortssuche schlägt höchstens so viele vor, auch mit eigenem `limit`", async () => {
            await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar" });
            await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar&limit=50" });
            expect(gesucht).toEqual([20, 20]);
            await setze("waypointLookupLimit", 5);
            await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar" });
            await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar&limit=3" });
            await app.inject({ method: "GET", url: "/api/route/waypoints?q=Gar&limit=50" });
            expect(gesucht.slice(2)).toEqual([5, 3, 5]);
        });

        it("die Werte des Browsers kommen mit `GET /api/map-settings`", async () => {
            const lies = async () =>
                ((await app.inject({ method: "GET", url: MAP_SETTINGS_URL })).json() as MapSettings).wegfindung;
            const vorgaben = wegfindungVorgaben();
            expect(await lies()).toEqual(Object.fromEntries(WEGFINDUNG_IM_BROWSER.map((id) => [id, vorgaben[id]])));
            const vorher = (await app.inject({ method: "GET", url: MAP_SETTINGS_URL })).headers["etag"];
            await setze("routeWaypointLimit", 40);
            await setze("routeMapPointLimit", 4);
            await setze("landscapeMinShare", 12);
            expect(await lies()).toEqual({ routeWaypointLimit: 40, routeMapPointLimit: 4, landscapeMinShare: 12 });
            // Der Abdruck folgt: Ein Browser mit dem alten ETag bekommt die neuen Werte, kein 304.
            expect((await app.inject({ method: "GET", url: MAP_SETTINGS_URL })).headers["etag"]).not.toBe(vorher);
        });

        it("`exactHit`: das Infopanel nennt einen Ort am Wegende nur innerhalb des eingestellten Abstands", async () => {
            // Ein Weg am Rand der Karte, sein Anfang 0,004 neben einem Ort. Mit 0,01 (Vorgabe) heißt der Anfang nach dem Ort,
            // mit 0,003 nicht mehr. `detail-path.ts` gibt genau `wegfindungswerte(…).exactHit` hinein.
            const quelle = "wi0214-test";
            const ort = randomUUID();
            const weg = randomUUID();
            await database`DELETE FROM path WHERE source_system = ${quelle}`;
            await database`DELETE FROM place WHERE source_system = ${quelle}`;
            try {
                await database`
                    INSERT INTO place (public_id, map_domain_id, name, subtype, geom, source_system, is_active)
                    VALUES (${ort}, 'aventuria', 'WI-0214 Rand', 'dorf', ST_SetSRID(ST_MakePoint(3.004, 3.5), 0), ${quelle}, TRUE)
                `;
                await database`
                    INSERT INTO path (public_id, map_domain_id, name, subtype, label_visible, is_bach, geom, source_system, is_active)
                    VALUES (${weg}, 'aventuria', 'WI-0214 Weg', 'Weg', FALSE, FALSE,
                            ST_GeomFromText('LINESTRING(3 3.5, 5 3.5)', 0), ${quelle}, TRUE)
                `;
                const anfang = async (reach: number) =>
                    (await readRouteSegments(database, [weg], "aventuria", reach))[0]?.fromPlace?.id ?? null;
                expect(await anfang((await wegfindungswerte(database)).exactHit)).toBe(ort);
                await setze("exactHit", 0.003);
                vergissWegfindungswerte(database);
                expect(await anfang((await wegfindungswerte(database)).exactHit)).toBeNull();
            } finally {
                await database`DELETE FROM path WHERE source_system = ${quelle}`;
                await database`DELETE FROM place WHERE source_system = ${quelle}`;
            }
        });

        it("`looseDistance` und `endpointBox`: der Befund der losen Wegenden misst mit den eingestellten Abständen", async () => {
            await setze("looseDistance", 0.25);
            await setze("endpointBox", 0.4);
            vergissWegfindungswerte(database);
            const gespeichert = await loadLooseEndpoints(database);
            expect(gespeichert.looseDistance).toBe(0.25);
            // Der Ortskasten hängt am Knopf: Erst die Freigabe bringt ihn auch in den Prüfhaken.
            expect(gespeichert.endpointBox).toBe(0.5);
            await freigib();
            vergissWegfindungswerte(database);
            expect((await loadLooseEndpoints(database)).endpointBox).toBe(0.4);
        });
    });
});
