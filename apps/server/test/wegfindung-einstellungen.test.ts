import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
    AVENTURIA,
    AVENTURIA_TRAVEL_MODEL,
    WEGFINDUNG_AM_KNOPF,
    WEGFINDUNG_FREIGABE_URL,
    WEGFINDUNG_NETZ,
    WEGFINDUNG_URL,
    WEGFINDUNG_VON_SELBST,
    WEGFINDUNG_WERTE,
    wegfindungGrenzen,
    wegfindungImRahmen,
    wegfindungVorgabe,
    wegfindungWert,
    wegfindungWirksam,
    type AdminWegfindung,
    type Role,
} from "@avesmaps3d/shared";
import { buildApp } from "../src/app.ts";
import type { ServerConfig } from "../src/config.ts";
import { createDatabase, type Database } from "../src/database.ts";
import { migrate } from "../src/db/migrate.ts";
import { seedMapDomains } from "../src/db/seed-map-domains.ts";
import { buildRouteNetwork } from "../src/routing/network.ts";
import { NO_CLIMATE } from "../src/routing/climate.ts";
import { NO_GROUND } from "../src/routing/ground.ts";
import { readRoutingRevision, travelModelVersion } from "../src/routing/revision.ts";
import { NO_RIVERS } from "../src/routing/rivers.ts";
import { RouteService } from "../src/routing/service.ts";
import { NO_WATER } from "../src/routing/water.ts";
import { anteil, modellMitWerten, setzeWerte, WEGFINDUNG_VORGABEN, werte } from "../src/routing/einstellungen.ts";
import { leseWegfindung, wirksameWegfindung } from "../src/system/wegfindungsstand.ts";
import { TEST_AUTH, TEST_ORIGIN, authFixture, type AuthFixture } from "./support/auth-fixture.ts";
import { testJobsConfig } from "./support/jobs-support.ts";

/**
 * Die Kenngrößen der Wegfindung in der Systemsteuerung (WI-0153, Schnitte 2, 3 und 6): die Grenzen aus der Vorgabe, der
 * Leseweg, der Schreibweg mit Revision und Protokoll, das Zurücksetzen und die FREIGABE.
 *
 * 🔴 Der Kern von Schnitt 6: Speichern ändert an der Wegfindung NICHTS. Gerechnet wird mit dem freigegebenen Stand
 * (`routing_setting_applied`), und nur der Knopf schreibt ihn fort — in derselben Transaktion wie sein Protokollereignis,
 * samt `routing_reload` in der Warteschlange. Darum prüfen die Fälle unten beides getrennt: was gespeichert ist, und was
 * gilt.
 *
 * Dass jede der 51 Zahlen des Registers mit ihrer Konstante übereinstimmt, prüft `wegfindung-vorgaben.test.ts` (Schnitt 1);
 * hier geht es nur um Speicher und Wege.
 */

describe("Die Grenzen je Wert (ohne Datenbank)", () => {
    it("🔴 jeder der 51 Werte hat eine Grenze, einen Grund, und seine Vorgabe liegt darin", () => {
        for (const wert of WEGFINDUNG_WERTE) {
            const vorgabe = wegfindungVorgabe(wert);
            expect(wert.min, wert.id).toBeGreaterThan(0);
            expect(wert.min, wert.id).toBeLessThan(wert.max);
            expect(vorgabe, wert.id).toBeGreaterThanOrEqual(wert.min);
            expect(vorgabe, wert.id).toBeLessThanOrEqual(wert.max);
            expect(wegfindungImRahmen(wert, vorgabe), wert.id).toBe(true);
            expect(wegfindungImRahmen(wert, wert.min), wert.id).toBe(true);
            expect(wegfindungImRahmen(wert, wert.max), wert.id).toBe(true);
            // Der Satz sagt, WARUM die Grenze dort liegt - eine Zahl ohne Grund ist eine Behauptung.
            expect(wert.grenze.length, wert.id).toBeGreaterThan(40);
        }
    });

    it("🔴 wo das Speicherformat die Grenze setzt, IST die Vorgabe die Obergrenze (Sperrgebiete: ein Byte)", () => {
        const sperrgebiete = wegfindungWert("seaClosureLimit")!;
        expect(wegfindungGrenzen(sperrgebiete)).toEqual({ min: 1, max: 8 });
        expect(wegfindungVorgabe(sperrgebiete)).toBe(8);
        expect(wegfindungImRahmen(sperrgebiete, 9)).toBe(false);
        expect(sperrgebiete.grenze).toContain("EIN BYTE");
    });

    it("🔴 draußen: null, negativ, verrutschtes Komma, nicht endlich", () => {
        const fang = wegfindungWert("endSnap")!;
        expect(wegfindungGrenzen(fang)).toEqual({ min: 0.001, max: 0.05 });
        for (const daneben of [0, -0.02, 0.2, 2, 0.0009, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(wegfindungImRahmen(fang, daneben), String(daneben)).toBe(false);
        }
        // 0,03 ist die Zahl, die der Betreiber im Blatt sieht: erlaubt.
        expect(wegfindungImRahmen(fang, 0.03)).toBe(true);
    });

    it("die wirksamen Werte sind die Vorgaben, überschrieben von den Abweichungen; eine fremde Kennung wird übergangen", () => {
        const wirksam = wegfindungWirksam({ endSnap: 0.03, gibtEsNicht: 7 });
        expect(wirksam.endSnap).toBe(0.03);
        expect(wirksam.endpointBox).toBe(0.5);
        expect((wirksam as Record<string, number>)["gibtEsNicht"]).toBeUndefined();
        expect(Object.keys(wirksam)).toHaveLength(WEGFINDUNG_WERTE.length);
    });
});

describe("Die wirksamen Zahlen im Routing (Schnitt 5)", () => {
    afterEach(() => setzeWerte(null));

    it("🔴 ohne gesetzten Wert sind es die Vorgaben des Registers — und die sind die Konstanten des Codes", () => {
        expect(werte()).toBe(WEGFINDUNG_VORGABEN);
        expect(werte().endSnap).toBe(0.02);
        expect(werte().cellUnits).toBe(0.25);
        // `wegfindung-vorgaben.test.ts` rechnet jede der 51 gegen ihre Konstante nach; hier zählt nur, dass das
        // Register die Quelle ist.
        expect(Object.keys(werte())).toHaveLength(WEGFINDUNG_WERTE.length);
    });

    it("🔴 ein gesetzter Wert gilt, ein zurückgesetzter wieder die Vorgabe", () => {
        setzeWerte(wegfindungWirksam({ endSnap: 0.03 }));
        expect(werte().endSnap).toBe(0.03);
        expect(werte().endpointBox).toBe(0.5);
        setzeWerte(null);
        expect(werte().endSnap).toBe(0.02);
    });

    it("🔴 die vier Prozentwerte kommen als Anteil heraus, nicht hundertfach", () => {
        expect(werte().weighDetour).toBe(50);
        expect(anteil("weighDetour")).toBe(0.5);
        expect(anteil("weighNearEdge")).toBe(0.8);
        setzeWerte(wegfindungWirksam({ weighDetour: 80 }));
        expect(anteil("weighDetour")).toBe(0.8);
    });

    it("🔴 das Reisemodell bleibt dasselbe Objekt, solange die zwei Zahlen aus ihm stimmen", () => {
        const vorgaben = wegfindungWirksam({});
        expect(modellMitWerten(AVENTURIA_TRAVEL_MODEL, vorgaben)).toBe(AVENTURIA_TRAVEL_MODEL);
        const anders = modellMitWerten(AVENTURIA_TRAVEL_MODEL, wegfindungWirksam({ querfeldeinAufschlag: 30 }));
        expect(anders).not.toBe(AVENTURIA_TRAVEL_MODEL);
        expect(anders.querfeldeinAufschlag.wert).toBe(30);
        expect(anders.meilenJeKarteneinheit.wert).toBe(AVENTURIA_TRAVEL_MODEL.meilenJeKarteneinheit.wert);
        // 🪤 Die Herkunft bleibt stehen: Nur die Zahl wechselt.
        expect(anders.querfeldeinAufschlag.herkunft).toBe(AVENTURIA_TRAVEL_MODEL.querfeldeinAufschlag.herkunft);
    });

    it("🔴 der Netzaufbau nimmt die Zahlen als Argument, nicht aus dem Prozess", () => {
        const orte = [
            { id: "a", name: "A", kind: "place" as const, isHidden: false, x: 0, y: 0 },
            { id: "b", name: "B", kind: "place" as const, isHidden: false, x: 10, y: 0 },
        ];
        const wege = [
            {
                public_id: "w1",
                name: "Weg",
                subtype: "strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [0.4, 0],
                        [9.6, 0],
                    ],
                }),
                allowed_transports: null,
                transport_domain: null,
                flow_direction: null,
                flow_factor: null,
                transport_seasons: null,
            },
        ];
        // Mit dem Ortskasten 0,5 hängt das Wegende am Ort; mit 0,1 nicht mehr.
        const mitKasten = buildRouteNetwork(orte, wege, { endpointBox: 0.5 });
        const ohneKasten = buildRouteNetwork(orte, wege, { endpointBox: 0.1 });
        expect([...mitKasten.nodes.keys()]).toContain("a");
        expect(mitKasten.links[0]?.from).toBe("a");
        expect(ohneKasten.links[0]?.from).not.toBe("a");
    });
});

/** Ein Netz mit genau einer Kante: gerade so viel, dass ein Stand aktiv werden darf (`assertUsableNetwork`). */
const kleinesNetz = () =>
    buildRouteNetwork(
        [
            { id: "a", name: "A", kind: "place" as const, isHidden: false, x: 0, y: 0 },
            { id: "b", name: "B", kind: "place" as const, isHidden: false, x: 10, y: 0 },
        ],
        [
            {
                public_id: "w1",
                name: "Weg",
                subtype: "strasse",
                coordinates: JSON.stringify({
                    type: "LineString",
                    coordinates: [
                        [0, 0],
                        [10, 0],
                    ],
                }),
                allowed_transports: null,
                transport_domain: null,
                flow_direction: null,
                flow_factor: null,
                transport_seasons: null,
            },
        ],
    );

const testDatabaseUrl = process.env["TEST_DATABASE_URL"];
const describeWithDatabase = testDatabaseUrl ? describe : describe.skip;

function config(): ServerConfig {
    return {
        port: 0,
        host: "127.0.0.1",
        releaseId: "wi0153-test",
        databaseUrl: undefined,
        tileRoot: undefined,
        statusPage: true,
        auth: TEST_AUTH,
    };
}

describeWithDatabase("Wegfindung lesen und verstellen (PostgreSQL)", { timeout: 120_000 }, () => {
    let database: Database;
    let fixture: AuthFixture;
    let app: FastifyInstance;
    let operator: { cookie: string };
    let admin: { cookie: string };

    const reset = async (): Promise<void> => {
        await database`DELETE FROM routing_setting`;
        await database`DELETE FROM routing_setting_applied`;
        await database`
            UPDATE routing_setting_state
               SET applied_at = NULL, applied_by = NULL, applied_by_label = NULL, applied_job = NULL WHERE id = 1
        `;
        await database`
            UPDATE job SET state = 'CANCELLED', finished_at = now()
             WHERE kind IN ('routing_reload', 'path_profile') AND state IN ('QUEUED', 'RUNNING')
        `;
        await database`
            UPDATE system_state SET system_lock = false, system_lock_since = NULL, system_lock_reason = NULL WHERE id = 1
        `;
        await app?.systemState?.refresh();
    };

    beforeAll(async () => {
        database = createDatabase(testDatabaseUrl as string, { max: 4 });
        await migrate(database);
        await seedMapDomains(database);
        fixture = authFixture(database);
        app = buildApp({
            config: config(),
            database: createDatabase(testDatabaseUrl as string, { max: 2 }),
            logStream: { write: () => undefined },
            jobs: { config: testJobsConfig(), recheckEveryMs: 60_000 },
            stichprobe: { start: () => undefined, close: () => undefined },
        });
        await app.ready();
        const person = async (role: Role, name: string) => {
            const created = await fixture.person(role, { name });
            const { cookie } = await fixture.session(created.id, { assurance: "strong", passkeyMinutesAgo: 1 });
            return { ...created, cookie };
        };
        operator = await person("operator", "Rondrikan");
        admin = await person("admin", "Admina");
    });

    beforeEach(reset);

    afterAll(async () => {
        await reset();
        await app?.close();
        await fixture?.cleanup();
        await database?.end({ timeout: 5 });
    });

    const lies = async (cookie: string = admin.cookie): Promise<AdminWegfindung> => {
        const response = await app.inject({ method: "GET", url: WEGFINDUNG_URL, headers: { cookie } });
        expect(response.statusCode).toBe(200);
        return response.json() as AdminWegfindung;
    };
    const setze = async (
        id: string,
        value: number | null,
        cookie = operator.cookie,
        baseRevision?: number,
    ): Promise<ReturnType<typeof app.inject>> =>
        app.inject({
            method: "POST",
            url: WEGFINDUNG_URL,
            payload: { operationId: randomUUID(), baseRevision: baseRevision ?? (await lies()).revision!, id, value },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    const code = (response: { statusCode: number; json(): unknown }): string =>
        response.statusCode < 300
            ? String(response.statusCode)
            : `${String(response.statusCode)} ${(response.json() as { error: { code: string } }).error.code}`;
    const ereignisse = async (action = "system.routing_setting_changed"): Promise<number> => {
        const [row] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = ${action}
        `;
        return row!.n;
    };
    const freigib = async (cookie = operator.cookie, baseRevision?: number): Promise<ReturnType<typeof app.inject>> =>
        app.inject({
            method: "POST",
            url: WEGFINDUNG_FREIGABE_URL,
            payload: { operationId: randomUUID(), baseRevision: baseRevision ?? (await lies()).revision! },
            headers: { origin: TEST_ORIGIN, cookie },
        });
    /**
     * Die zwei Teile der Routing-Revision, die an den Kenngrößen hängen (WI-0153 Schnitt 6): `settings` am
     * FREIGEGEBENEN Stand der Werte am Knopf, `settingsLive` am GESPEICHERTEN Stand aller übrigen.
     */
    const teile = async (): Promise<{ settings: string | null; settingsLive: string | null }> => {
        const revision = await readRoutingRevision(
            database,
            AVENTURIA.mapDomain,
            travelModelVersion(AVENTURIA_TRAVEL_MODEL),
        );
        return { settings: revision.settings, settingsLive: revision.settingsLive };
    };
    /** Womit das Routing gerade rechnet (nicht: was im Feld steht). */
    const gilt = async (id: string): Promise<number | undefined> =>
        (wirksameWegfindung(await leseWegfindung(database)) as Record<string, number>)[id];

    it("🔴 ohne Abweichung antwortet der Leseweg leer: die Vorgaben stehen im Register, nicht in der Leitung", async () => {
        const stand = await lies();
        expect(stand.source).toBe("database");
        expect(stand.rows).toEqual([]);
        expect(stand.unknownKeys).toEqual([]);
        expect(stand.revision).toBeGreaterThanOrEqual(1);
    });

    it("🔴 verstellen: eine Zeile, eine höhere Revision, genau ein Protokollereignis, und der wirksame Wert ändert sich", async () => {
        const vorher = await lies();
        const vorherEreignisse = await ereignisse();
        const antwort = await setze("endSnap", 0.03, operator.cookie, vorher.revision!);
        expect(code(antwort)).toBe("200");
        const nachher = await lies();
        expect(nachher.rows).toHaveLength(1);
        expect(nachher.rows[0]).toMatchObject({ id: "endSnap", value: 0.03, changedBy: "Rondrikan" });
        expect(nachher.revision!).toBeGreaterThan(vorher.revision!);
        expect(await ereignisse()).toBe(vorherEreignisse + 1);
        const [ereignis] = await database<{ details: { key: string; from: number | null; to: number | null } }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.routing_setting_changed'
             ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis!.details).toEqual({ key: "endSnap", from: null, to: 0.03 });
        // 🔴 Gespeichert ist 0,03 — gerechnet wird weiter mit der Vorgabe, bis der Knopf freigibt (Schnitt 6).
        expect(nachher.rows[0]).toMatchObject({ applied: null });
        expect(await gilt("endSnap")).toBe(0.02);
    });

    it("🔴 zurücksetzen löscht die Zeile (es gibt keinen Zustand „steht auf der Vorgabe“)", async () => {
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await setze("endSnap", null))).toBe("200");
        const stand = await lies();
        expect(stand.rows).toEqual([]);
        const [zeile] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM routing_setting`;
        expect(zeile!.n).toBe(0);
        expect(await gilt("endSnap")).toBe(0.02);
        // Ein zweites Zurücksetzen ist keine Änderung und darf kein Protokollereignis schreiben.
        expect(code(await setze("endSnap", null))).toBe("409 no_change");
    });

    it("🔴 veraltete Revision: 409 edit_conflict, und nichts ist geschrieben", async () => {
        const alt = (await lies()).revision!;
        expect(code(await setze("endSnap", 0.03, operator.cookie, alt))).toBe("200");
        expect(code(await setze("endpointBox", 0.6, operator.cookie, alt))).toBe("409 edit_conflict");
        expect((await lies()).rows.map((row) => row.id)).toEqual(["endSnap"]);
    });

    it("🔴 unbekannte Kennung 400, Wert außerhalb der Grenzen 400, derselbe Wert 409", async () => {
        expect(code(await setze("gibtEsNicht", 1))).toBe("400 unknown_setting");
        expect(code(await setze("endSnap", 2))).toBe("400 value_out_of_range");
        expect(code(await setze("endSnap", 0))).toBe("400 value_out_of_range");
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await setze("endSnap", 0.03))).toBe("409 no_change");
        // Eine Kennung, die das Muster nicht erfüllt, hält schon das Schema an.
        expect(code(await setze("Nicht Erlaubt", 1))).toBe("400 validation_failed");
    });

    it("🔴 Stufe S: wer nur den Betrieb liest, darf nicht verstellen (403), lesen aber schon", async () => {
        expect((await lies(admin.cookie)).source).toBe("database");
        const antwort = await setze("endSnap", 0.03, admin.cookie);
        expect(antwort.statusCode).toBe(403);
        expect((await lies()).rows).toEqual([]);
    });

    it("🔴 Systemsperre: Schreibklasse `system` antwortet 423, Lesen bleibt offen", async () => {
        await database`
            UPDATE system_state
               SET system_lock = true, system_lock_since = now(), system_lock_reason = 'Wächter WI-0153' WHERE id = 1
        `;
        await app.systemState?.refresh();
        expect(code(await setze("endSnap", 0.03))).toBe("423 system_locked");
        expect((await lies()).rows).toEqual([]);
    });

    it("eine gespeicherte Kennung, die das Register nicht kennt, wird übergangen und gemeldet", async () => {
        await database`INSERT INTO routing_setting (key, value) VALUES ('ausEinemSpaeterenRelease', 7)`;
        const stand = await lies();
        expect(stand.rows).toEqual([]);
        expect(stand.unknownKeys).toEqual(["ausEinemSpaeterenRelease"]);
        const wirksam = wirksameWegfindung(await leseWegfindung(database)) as Record<string, number>;
        expect(wirksam["ausEinemSpaeterenRelease"]).toBeUndefined();
    });
    // --- Freigeben (Schnitt 6): zwei Teile -------------------------------------------------------------------------
    //
    // 🔴 Die sechs Werte AM KNOPF (Folge `netz`) kosten einen Netzaufbau; sie gelten erst nach der Freigabe. Alle
    // übrigen baut niemand: Sie gelten ohne Knopf, sobald der Dienst den Stand nachprüft. Das prüfen die Fälle
    // getrennt, denn genau hier war die gepushte Fassung von heute Nacht falsch (sie hängte alle 51 an den Knopf).

    it("🔴 am Knopf hängen die fünf Werte des Netzaufbaus und die vier des Seegraphen (7c)", () => {
        expect([...WEGFINDUNG_AM_KNOPF].sort()).toEqual(
            WEGFINDUNG_WERTE.filter((wert) => wert.folge === "netz" || wert.folge === "seegraph")
                .map((wert) => wert.id)
                .sort(),
        );
        // Den Revisionsteil `settings` bilden nur die des Netzaufbaus; der Seegraph wirkt über seinen neuen Graphen.
        expect([...WEGFINDUNG_NETZ].sort()).toEqual(
            WEGFINDUNG_WERTE.filter((wert) => wert.folge === "netz")
                .map((wert) => wert.id)
                .sort(),
        );
        // Fünf seit WI-0214: Der exakte Treffer wirkt im Netzaufbau nicht (der nächste Ort im Ortskasten gewinnt ohnehin),
        // nur im Infopanel, und braucht darum keinen Knopf.
        expect(WEGFINDUNG_NETZ).toHaveLength(5);
        expect(WEGFINDUNG_AM_KNOPF).toHaveLength(9);
        // Keine Kennung steht in beiden Listen, und zusammen sind es alle 51.
        const beides = WEGFINDUNG_AM_KNOPF.filter((id) => (WEGFINDUNG_VON_SELBST as readonly string[]).includes(id));
        expect(beides).toEqual([]);
        expect(WEGFINDUNG_AM_KNOPF.length + WEGFINDUNG_VON_SELBST.length).toBe(WEGFINDUNG_WERTE.length);
    });

    it("🔴 Prüfung 1: ein Wert am Knopf bewegt KEINEN Revisionsteil; erst die Freigabe bewegt `settings`", async () => {
        const vorher = await teile();
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        // Gespeichert — und beide Teile stehen still. Kein Worker hat einen Grund nachzuladen.
        expect(await teile()).toEqual(vorher);
        expect(await gilt("endSnap")).toBe(0.02);
        expect(code(await freigib())).toBe("200");
        const nachher = await teile();
        expect(nachher.settings).not.toBe(vorher.settings);
        expect(nachher.settingsLive).toBe(vorher.settingsLive);
        expect(await gilt("endSnap")).toBe(0.03);
    });

    it("🔴 Prüfung 3: ein Wert ohne Knopf bewegt `settingsLive` sofort und braucht keine Freigabe", async () => {
        const vorher = await teile();
        expect(code(await setze("cellUnits", 0.3))).toBe("200");
        const nachher = await teile();
        expect(nachher.settingsLive).not.toBe(vorher.settingsLive);
        expect(nachher.settings).toBe(vorher.settings);
        // 🔴 Er gilt schon: Der Dienst liest ihn aus dem gespeicherten Stand.
        expect(await gilt("cellUnits")).toBe(0.3);
        // Und er ist kein Grund zur Freigabe — am Knopf steht nichts an.
        expect(code(await freigib())).toBe("409 nothing_to_apply");
    });

    it("🔴 am Dienst gemessen: der Wert ohne Knopf kommt beim Nachprüfen an, der Wert am Knopf erst mit der Freigabe", async () => {
        // 🪤 `refresh()` ist genau das, was der Worker tut, wenn seine Frist abgelaufen ist (`recheckMs`,
        // Vorgabe 5000 ms in `service.ts`): Fingerabdruck prüfen, bei einer Änderung laden, wechseln, Zahlen
        // umstellen. Darum prüft der Fall die Kette, ohne sechs Sekunden zu warten.
        // 🪤 Die Quelle liest Revision UND Werte wirklich aus dieser Datenbank — nur das Netz ist ein winziges eigenes:
        // Die Testdatenbank trägt keine Kanten, und `assertUsableNetwork` ließe einen leeren Stand nie aktiv werden.
        // Geprüft wird hier die Kette von der Tafel bis zu `werte()`, nicht der Netzaufbau.
        const quelle = async () => {
            const revision = await readRoutingRevision(
                database,
                AVENTURIA.mapDomain,
                travelModelVersion(AVENTURIA_TRAVEL_MODEL),
            );
            const gelesen = wirksameWegfindung(await leseWegfindung(database, { personen: false }));
            return {
                network: kleinesNetz(),
                water: NO_WATER,
                land: NO_WATER,
                rivers: NO_RIVERS,
                ground: NO_GROUND,
                climate: NO_CLIMATE,
                revision,
                werte: gelesen,
                model: modellMitWerten(AVENTURIA_TRAVEL_MODEL, gelesen),
            };
        };
        const dienst = new RouteService({
            mapDomain: AVENTURIA.mapDomain,
            model: AVENTURIA_TRAVEL_MODEL,
            source: {
                revision: () =>
                    readRoutingRevision(database, AVENTURIA.mapDomain, travelModelVersion(AVENTURIA_TRAVEL_MODEL)),
                load: quelle,
            },
        });
        try {
            await dienst.refresh();
            expect(werte().endSnap).toBe(0.02);
            expect(werte().cellUnits).toBe(0.25);
            // Beides speichern, nichts freigeben.
            expect(code(await setze("endSnap", 0.03))).toBe("200");
            expect(code(await setze("cellUnits", 0.3))).toBe("200");
            await dienst.refresh();
            // 🔴 Der Wert ohne Knopf rechnet jetzt mit; der Wert am Knopf nicht.
            expect(werte().cellUnits).toBe(0.3);
            expect(werte().endSnap).toBe(0.02);
            // Prüfung 2: Erst der Knopf bringt ihn — und zwar ohne dass jemand sonst etwas tun muss.
            expect(code(await freigib())).toBe("200");
            await dienst.refresh();
            expect(werte().endSnap).toBe(0.03);
        } finally {
            // Der Werte-Speicher ist prozessweit: Was dieser Fall gesetzt hat, darf keinem anderen gelten.
            setzeWerte(null);
        }
    }, 240_000);

    it("🔴 eine zweite Freigabe hängt am wartenden Reload: Jeder Reload ist eine Lücke in der Wegfindung (WI-0279, Claudio)", async () => {
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await freigib())).toBe("200");
        const erster = (await lies()).appliedJob;
        expect(code(await setze("endpointBox", 0.6))).toBe("200");
        expect(code(await freigib())).toBe("200");
        expect((await lies()).appliedJob).toBe(erster);
        const auftraege = await database`SELECT 1 FROM job WHERE kind = 'routing_reload' AND state = 'QUEUED'`;
        expect(auftraege).toHaveLength(1);
    });

    it("🔴 Prüfung 2: die Freigabe schreibt genau ein Ereignis und reiht genau einen `routing_reload` ein", async () => {
        const vorher = await ereignisse("system.routing_settings_applied");
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await setze("endpointBox", 0.6))).toBe("200");
        // Ein Wert ohne Knopf darf die Zahl der Freigabe nicht erhöhen: Er wird nicht freigegeben.
        expect(code(await setze("cellUnits", 0.3))).toBe("200");
        expect(code(await freigib())).toBe("200");
        expect(await ereignisse("system.routing_settings_applied")).toBe(vorher + 1);
        const [ereignis] = await database<{ details: { werte: number; job: string | null } }[]>`
            SELECT details FROM avesmaps_auth.security_event
             WHERE environment = 'test' AND action = 'system.routing_settings_applied'
             ORDER BY id DESC LIMIT 1
        `;
        expect(ereignis!.details.werte).toBe(2);
        expect(ereignis!.details.job).not.toBeNull();
        const auftraege = await database<{ public_id: string; state: string; input_ref: { grund?: string } }[]>`
            SELECT public_id::text AS public_id, state, input_ref FROM job
             WHERE kind = 'routing_reload' AND state = 'QUEUED'
        `;
        expect(auftraege).toHaveLength(1);
        expect(auftraege[0]!.input_ref.grund).toBe("wegfindung");
        // Die Leiste zeigt den Zustand der Warteschlange, nicht einen eigenen.
        const stand = await lies();
        expect(stand.appliedJob).toBe(auftraege[0]!.public_id);
        expect(stand.appliedJobState).toBe("QUEUED");
        expect(ereignis!.details.job).toBe(auftraege[0]!.public_id);
        // In der Tafel der freigegebenen Werte stehen NUR die vom Knopf.
        const freigegeben = await database<{ key: string }[]>`SELECT key FROM routing_setting_applied ORDER BY key`;
        expect(freigegeben.map((zeile) => zeile.key)).toEqual(["endSnap", "endpointBox"]);
    });

    it("🔴 ein freigegebener Maßstab rechnet erst die Wegprofile, dann lädt das Netz (WI-0153 Schnitt 7d)", async () => {
        const arten = (antwort: { json(): unknown }): string[] =>
            (antwort.json() as { derivedWork: { kind: string }[] }).derivedWork.map((arbeit) => arbeit.kind);
        expect(code(await setze("schrittPerUnit", 4000))).toBe("200");
        const antwort = await freigib();
        expect(code(antwort)).toBe("200");
        expect(arten(antwort)).toEqual(["path_profile", "routing_reload"]);
        const [profil] = await database<{ id: string; input_ref: { schrittPerUnit?: number } }[]>`
            SELECT id::text AS id, input_ref FROM job WHERE kind = 'path_profile' AND state = 'QUEUED' ORDER BY id DESC LIMIT 1
        `;
        expect(profil!.input_ref.schrittPerUnit).toBe(4000);
        // 🪤 `routing_reload` liest beim Start, welche Revision er erwartet: Er wartet auf die Profile.
        const [kette] = await database<{ n: number }[]>`
            SELECT count(*)::int AS n FROM job_dependency d JOIN job j ON j.id = d.job_id
             WHERE j.kind = 'routing_reload' AND j.state = 'QUEUED' AND d.depends_on_id = ${profil!.id}::bigint
        `;
        expect(kette!.n).toBe(1);
        // Ein anderer Wert am Knopf ohne neuen Maßstab rechnet keine Profile.
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        const zweite = await freigib();
        expect(code(zweite)).toBe("200");
        expect(arten(zweite)).toEqual(["routing_reload"]);
    });

    it("🔴 nichts anstehend: 409 nothing_to_apply, kein Ereignis, kein Auftrag", async () => {
        expect(code(await freigib())).toBe("409 nothing_to_apply");
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await freigib())).toBe("200");
        const nachher = await ereignisse("system.routing_settings_applied");
        const teil = (await teile()).settings;
        // Zweimal hintereinander gibt nichts frei: Gespeichert und gerechnet sind jetzt gleich.
        expect(code(await freigib())).toBe("409 nothing_to_apply");
        expect(await ereignisse("system.routing_settings_applied")).toBe(nachher);
        expect((await teile()).settings).toBe(teil);
    });

    it("🔴 gespeichert und nie freigegeben: es gilt der freigegebene Stand — auch nach dem Zurücksetzen", async () => {
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await freigib())).toBe("200");
        expect(await gilt("endSnap")).toBe(0.03);
        // Zurückgesetzt, aber nicht freigegeben: Die Zeile ist weg, gerechnet wird weiter mit 0,03.
        expect(code(await setze("endSnap", null))).toBe("200");
        expect(await gilt("endSnap")).toBe(0.03);
        const stand = await lies();
        expect(stand.rows[0]).toMatchObject({ id: "endSnap", value: null, applied: 0.03 });
        // Erst die Freigabe räumt auch den gerechneten Stand ab.
        expect(code(await freigib())).toBe("200");
        expect(await gilt("endSnap")).toBe(0.02);
        expect((await lies()).rows).toEqual([]);
    });

    it("🔴 das Lesemodell: `applied` ist, womit gerechnet wird — ohne Knopf also gleich `value`", async () => {
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        expect(code(await setze("cellUnits", 0.3))).toBe("200");
        const rows = (await lies()).rows;
        // Der Wert am Knopf wartet (value ≠ applied), der ohne Knopf nicht (value = applied).
        expect(rows.find((row) => row.id === "endSnap")).toMatchObject({ value: 0.03, applied: null });
        expect(rows.find((row) => row.id === "cellUnits")).toMatchObject({ value: 0.3, applied: 0.3 });
    });

    it("🔴 pausierte Warteschlange: der Auftrag wird eingereiht und wartet; die Leiste sagt genau das", async () => {
        await database`
            UPDATE system_state
               SET queue_paused = true, queue_paused_since = now(), queue_paused_reason = 'Wächter WI-0153'
             WHERE id = 1
        `;
        await app.systemState?.refresh();
        try {
            expect(code(await setze("endSnap", 0.03))).toBe("200");
            expect(code(await freigib())).toBe("200");
            const stand = await lies();
            expect(stand.appliedJob).not.toBeNull();
            expect(stand.appliedJobState).toBe("QUEUED");
            // 🔴 Freigegeben ist freigegeben: Der gerechnete Stand steht, auch wenn niemand den Auftrag abarbeitet.
            expect(await gilt("endSnap")).toBe(0.03);
        } finally {
            await database`
                UPDATE system_state
                   SET queue_paused = false, queue_paused_since = NULL, queue_paused_reason = NULL
                 WHERE id = 1
            `;
            await app.systemState?.refresh();
        }
    });

    it("🔴 veraltete Revision 409, Stufe S 403, Systemsperre 423 — und jedes Mal ist nichts freigegeben", async () => {
        expect(code(await setze("endSnap", 0.03))).toBe("200");
        const alt = 1;
        expect(code(await freigib(operator.cookie, alt))).toBe("409 edit_conflict");
        const nurLesen = await freigib(admin.cookie);
        expect(nurLesen.statusCode).toBe(403);
        await database`
            UPDATE system_state
               SET system_lock = true, system_lock_since = now(), system_lock_reason = 'Wächter WI-0153' WHERE id = 1
        `;
        await app.systemState?.refresh();
        expect(code(await freigib())).toBe("423 system_locked");
        expect(await gilt("endSnap")).toBe(0.02);
        const [zeile] = await database<{ n: number }[]>`SELECT count(*)::int AS n FROM routing_setting_applied`;
        expect(zeile!.n).toBe(0);
    });
});
