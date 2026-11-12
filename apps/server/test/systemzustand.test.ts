import { describe, expect, it } from "vitest";
import { leseMeminfo, osMesswerte } from "../src/system/messwerte.ts";
import { parseSystemStatus, type SystemStatusFile } from "../src/system/status-files.ts";
import { bucketVon } from "../src/system/stichprobe.ts";
import {
    migrationenStand,
    dateiZustand,
    dienstKomponente,
    fuerUmgebung,
    nginxUndTuer,
    routingKomponente,
    tuerKomponente,
} from "../src/system/systemzustand.ts";

/**
 * Der Systemzustand ohne Datenbank (WI-0127 SYS-8, SYS-0001 §3.6, §3.7): der Leser von Claudios `system.json` (tolerant, nur Kennungen, kein
 * freier Text), die Frische (älter als 15 min heißt veraltet), die Komponenten aus Routenrechner, Diensten und Tür, `/proc/meminfo`, das
 * 5-Minuten-Fach. 🔴 Was fehlt, ist `null`, nie 0.
 */

const NOW = new Date("2026-10-10T18:00:00Z");

/** Claudios Vorschlag (`handovers/2026-10-10-wi0119-systemzustand-antwort.md` Nr. 1), mit Werten. */
const CLAUDIO = {
    schema_version: 1,
    generated_at: "2026-10-10T17:57:00Z",
    host: "stage-vps",
    disks: [{ mount: "/", size_bytes: 160_000_000_000, free_bytes: 92_000_000_000 }],
    door_probe: {
        from: "public",
        at: "2026-10-10T17:57:00Z",
        checks: [
            { url: "/", expect: "302", got: "302", ms: 4 },
            { url: "/anmelden", expect: "200", got: "200", ms: 3 },
            { url: "/api/x", expect: "401", got: "401", ms: 2 },
        ],
    },
    services: {
        nginx: "active",
        postgresql: "active",
        martin: "active",
        fastify: "active",
        jobs_blue: "active",
        jobs_green: "inactive",
    },
    sizes: {
        at: "2026-10-10T17:00:00Z",
        tiles_bytes: 296_000_000,
        media_published_bytes: null,
        media_private_bytes: 1_200_000,
        backups_local_bytes: 48_000_000,
    },
    offsite: { at: "2026-10-10T17:00:00Z", provider: "dropbox", quota_bytes: null, used_bytes: null },
};

const gelesen = (stand: SystemStatusFile) => ({ art: "gelesen" as const, stand });

describe("system.json lesen (§3.6)", () => {
    it("🔴 Claudios Felder als Lesemodell; null bleibt null, nie 0", () => {
        const stand = parseSystemStatus(CLAUDIO)!;
        expect(stand.stand).toBe("2026-10-10T17:57:00Z");
        expect(stand.host).toBe("stage-vps");
        expect(stand.disks).toEqual([{ mount: "/", gesamt: 160_000_000_000, frei: 92_000_000_000 }]);
        expect(stand.tuer?.proben.map((probe) => [probe.url, probe.erwartet, probe.bekommen])).toEqual([
            ["/", "302", "302"],
            ["/anmelden", "200", "200"],
            ["/api/x", "401", "401"],
        ]);
        expect(stand.dienste).toContainEqual({ name: "jobs_green", zustand: "inactive" });
        expect(stand.groessen).toMatchObject({
            kacheln: 296_000_000,
            medienVeroeffentlicht: null,
            sicherungenLokal: 48_000_000,
        });
        expect(stand.neueresFormat).toBe(false);
    });

    it("🔴 nur Kennungen und Pfade, kein freier Text: fremde Werte fallen weg", () => {
        const stand = parseSystemStatus({
            ...CLAUDIO,
            host: "stage vps; rm -rf /",
            services: { nginx: "active", "martin; drop": "active", postgresql: "läuft gut" },
            door_probe: {
                from: "public",
                at: CLAUDIO.generated_at,
                checks: [
                    { url: "http://evil/", expect: "200", got: "200" },
                    { url: "/", expect: 302, got: "502" },
                ],
            },
        })!;
        expect(stand.host).toBeNull();
        expect(stand.dienste).toEqual([{ name: "nginx", zustand: "active" }]);
        expect(stand.tuer?.proben).toEqual([{ url: "/", erwartet: "302", bekommen: "502", ms: null }]);
    });

    it("falsche Form ist unlesbar; eine höhere Fassung liest die bekannten Felder und meldet sich", () => {
        expect(parseSystemStatus(null)).toBeNull();
        expect(parseSystemStatus({ generated_at: CLAUDIO.generated_at })).toBeNull();
        expect(parseSystemStatus([CLAUDIO])).toBeNull();
        const neuer = parseSystemStatus({ ...CLAUDIO, schema_version: 2, cpu_temp: 71 })!;
        expect(neuer.neueresFormat).toBe(true);
        expect(neuer.host).toBe("stage-vps");
    });

    it("🔴 frisch nur bis 15 min: danach veraltet, und keine Zahl gilt", () => {
        const stand = parseSystemStatus(CLAUDIO)!;
        expect(dateiZustand({ art: "fehlt" }, NOW)).toEqual({ zustand: "nicht_eingerichtet", frisch: null });
        expect(dateiZustand({ art: "unlesbar" }, NOW)).toEqual({ zustand: "unlesbar", frisch: null });
        expect(dateiZustand(gelesen(stand), NOW).zustand).toBe("aktuell");
        expect(dateiZustand(gelesen(stand), new Date("2026-10-10T18:11:59Z")).zustand).toBe("aktuell");
        expect(dateiZustand(gelesen(stand), new Date("2026-10-10T18:12:01Z"))).toEqual({
            zustand: "veraltet",
            frisch: null,
        });
        expect(dateiZustand(gelesen({ ...stand, stand: null }), NOW).zustand).toBe("veraltet");
    });
});

describe("Komponenten (§6.3)", () => {
    it("Routenrechner: bereit gesund, lädt oder kalt Warnung, gescheitert ausgefallen, ohne Rechner unbekannt", () => {
        expect(routingKomponente({ state: "ready", ageMs: 60_000, revision: "r42" }, NOW)).toEqual({
            id: "routing",
            zustand: "gesund",
            seit: "2026-10-10T17:59:00.000Z",
            version: "r42",
            hinweis: "ready",
        });
        expect(routingKomponente({ state: "warming", ageMs: 0 }, NOW).zustand).toBe("warnung");
        expect(routingKomponente({ state: "cold", ageMs: 0 }, NOW).zustand).toBe("warnung");
        expect(routingKomponente({ state: "failed", ageMs: 0 }, NOW).zustand).toBe("ausgefallen");
        expect(routingKomponente(undefined, NOW)).toMatchObject({ zustand: "unbekannt", hinweis: "not_configured" });
    });

    it("🔴 Dienste und Tür nur aus einer frischen Datei; sonst unbekannt mit dem Grund", () => {
        const stand = parseSystemStatus(CLAUDIO)!;
        expect(dienstKomponente("nginx", "nginx", stand, "x")).toMatchObject({ zustand: "gesund", hinweis: "active" });
        expect(dienstKomponente("nginx", "jobs_green", stand, "x")).toMatchObject({
            zustand: "ausgefallen",
            hinweis: "inactive",
        });
        expect(dienstKomponente("nginx", "foundry", stand, "x")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "not_listed",
        });
        expect(dienstKomponente("nginx", "nginx", null, "stale")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "stale",
        });
        expect(tuerKomponente(stand, "x")).toMatchObject({ zustand: "gesund", hinweis: "door_ok" });
        const kaputt = {
            ...stand,
            tuer: { at: null, von: "public", proben: [{ url: "/", erwartet: "302", bekommen: "500", ms: 9 }] },
        };
        expect(tuerKomponente(kaputt, "x")).toMatchObject({ zustand: "ausgefallen", hinweis: "door_mismatch" });
        expect(tuerKomponente({ ...stand, tuer: null }, "x")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "no_probe",
        });
        expect(tuerKomponente(null, "not_set_up")).toMatchObject({ zustand: "unbekannt", hinweis: "not_set_up" });
        // „Nginx und Tür“ (Blatt A7): das Schwerere aus beiden; beide gesund heißt gesund mit dem Hinweis der Tür.
        expect(nginxUndTuer(stand, "x")).toMatchObject({ id: "nginx", zustand: "gesund", hinweis: "door_ok" });
        expect(nginxUndTuer(kaputt, "x")).toMatchObject({ zustand: "ausgefallen", hinweis: "door_mismatch" });
        const ohneNginx = { ...stand, dienste: stand.dienste.filter((dienst) => dienst.name !== "nginx") };
        expect(nginxUndTuer(ohneNginx, "x")).toMatchObject({ zustand: "unbekannt", hinweis: "not_listed" });
        expect(nginxUndTuer(null, "stale")).toMatchObject({ zustand: "unbekannt", hinweis: "stale" });
    });
});

/**
 * Production liest den eigenen Abschnitt der Datei (Claudio, `handovers/2026-10-14-systemzustand-production-abschnitt-an-claudia.md`):
 * `system.json` ist EINE Datei für den ganzen Host, und ihre oberste Ebene beschreibt die Stage (302/200/401). Production hat seit
 * `aa5b7693` einen eigenen Abschnitt mit eigener Tür (200/200/401) und eigenen Diensten `fastify`/`martin`.
 *
 * 🔴 Der wichtigste Fall steht unten zuerst: Fehlt der Abschnitt, ist die Tür in Production **unbekannt** und nie die der Stage. Eine
 * grüne Kachel, die die falsche Domäne beschreibt, ist schlimmer als „unbekannt“.
 */
describe("Die Tür in Production (Claudio 2026-10-14)", () => {
    /** Die Form aus `ops/status/test/run-status-test.sh` Zeile 12: öffentlich 200/200, Verwaltung 401, Dienste `fastify` und `martin`. */
    const PRODUCTION = {
        door_probe: {
            from: "public",
            at: "2026-10-10T17:58:00Z",
            checks: [
                { url: "/", expect: "200", got: "200" },
                { url: "/anmelden", expect: "200", got: "200" },
                { url: "/api/admin/system", expect: "401", got: "401" },
            ],
        },
        services: { fastify: "active", martin: "active" },
    };

    it("🔴 ohne Abschnitt ist die Tür in Production unbekannt – niemals die der Stage", () => {
        const stand = parseSystemStatus(CLAUDIO)!;
        expect(stand.production).toBeNull();
        // Auf der Stage beschreibt dieselbe Datei eine gesunde Tür …
        expect(nginxUndTuer(fuerUmgebung(stand, false), "x")).toMatchObject({ zustand: "gesund", hinweis: "door_ok" });
        // … in Production darf daraus nichts Grünes werden.
        const inProduction = fuerUmgebung(stand, true)!;
        expect(inProduction.tuer).toBeNull();
        expect(nginxUndTuer(inProduction, "x")).toMatchObject({ zustand: "unbekannt", hinweis: "no_probe" });
        expect(fuerUmgebung(null, true)).toBeNull();
    });

    it("mit Abschnitt gilt dessen eigene Tür, und zwar unabhängig von der der Stage", () => {
        const stand = parseSystemStatus({ ...CLAUDIO, production: PRODUCTION })!;
        expect(stand.production?.tuer?.at).toBe("2026-10-10T17:58:00Z");
        expect(stand.production?.tuer?.proben.map((probe) => [probe.url, probe.erwartet, probe.bekommen])).toEqual([
            ["/", "200", "200"],
            ["/anmelden", "200", "200"],
            ["/api/admin/system", "401", "401"],
        ]);
        // Die oberste Ebene bleibt die Stage: 302 auf „/“.
        expect(stand.tuer?.proben[0]?.erwartet).toBe("302");
        expect(nginxUndTuer(fuerUmgebung(stand, true)!, "x")).toMatchObject({ zustand: "gesund", hinweis: "door_ok" });

        // Eine ausgefallene Stage-Tür färbt Production nicht rot …
        const kaputteStage = parseSystemStatus({
            ...CLAUDIO,
            door_probe: { ...CLAUDIO.door_probe, checks: [{ url: "/", expect: "302", got: "500" }] },
            production: PRODUCTION,
        })!;
        expect(nginxUndTuer(kaputteStage, "x")).toMatchObject({ zustand: "ausgefallen" });
        expect(nginxUndTuer(fuerUmgebung(kaputteStage, true)!, "x")).toMatchObject({ zustand: "gesund" });
        // … und eine ausgefallene Production-Tür färbt die Stage nicht rot.
        const kaputteProduction = parseSystemStatus({
            ...CLAUDIO,
            production: {
                ...PRODUCTION,
                door_probe: { ...PRODUCTION.door_probe, checks: [{ url: "/", expect: "200", got: "503" }] },
            },
        })!;
        expect(nginxUndTuer(fuerUmgebung(kaputteProduction, true)!, "x")).toMatchObject({
            zustand: "ausgefallen",
            hinweis: "door_mismatch",
        });
        expect(nginxUndTuer(fuerUmgebung(kaputteProduction, false), "x")).toMatchObject({ zustand: "gesund" });
    });

    it("🔴 host-weit bleibt host-weit: nginx, postgresql, backup_timer, Platten und Größen; nur fastify und martin je Umgebung", () => {
        const stand = parseSystemStatus({
            ...CLAUDIO,
            services: { ...CLAUDIO.services, backup_timer: "active" },
            production: { ...PRODUCTION, services: { fastify: "active", martin: "failed" } },
        })!;
        const inProduction = fuerUmgebung(stand, true)!;
        expect(inProduction.dienste).toContainEqual({ name: "nginx", zustand: "active" });
        expect(inProduction.dienste).toContainEqual({ name: "postgresql", zustand: "active" });
        expect(inProduction.dienste).toContainEqual({ name: "backup_timer", zustand: "active" });
        expect(inProduction.disks).toEqual(stand.disks);
        expect(inProduction.groessen).toEqual(stand.groessen);
        // Der Zustand des Abschnitts ersetzt den der Stage, auch wenn er schlechter ist.
        expect(inProduction.dienste).toContainEqual({ name: "martin", zustand: "failed" });
        expect(inProduction.dienste).not.toContainEqual({ name: "martin", zustand: "active" });
        expect(dienstKomponente("martin", "martin", inProduction, "x")).toMatchObject({ zustand: "ausgefallen" });
        // Fehlt der Dienst im Abschnitt, gilt er als nicht gemeldet – nie der der Stage.
        const ohneMartin = fuerUmgebung(
            parseSystemStatus({ ...CLAUDIO, production: { ...PRODUCTION, services: { fastify: "active" } } })!,
            true,
        )!;
        expect(ohneMartin.dienste.map((dienst) => dienst.name)).not.toContain("martin");
        expect(dienstKomponente("martin", "martin", ohneMartin, "x")).toMatchObject({
            zustand: "unbekannt",
            hinweis: "not_listed",
        });
    });

    it("🔴 dieselbe strenge Form wie oben: freier Text, falsche Codes und ein falsch geformter Abschnitt fallen weg", () => {
        const stand = parseSystemStatus({
            ...CLAUDIO,
            production: {
                door_probe: {
                    from: "public; rm -rf /",
                    at: "kein Zeitpunkt",
                    checks: [
                        { url: "https://avesmaps.de/", expect: "200", got: "200" },
                        { url: "/", expect: "zweihundert", got: 200 },
                    ],
                },
                services: { fastify: "active", "martin; drop": "active", postgresql: "läuft gut" },
            },
        })!;
        expect(stand.production?.tuer?.von).toBeNull();
        expect(stand.production?.tuer?.at).toBeNull();
        // Die Adresse fällt weg (nur Pfade), der Text als Code wird null, eine Zahl als Code gilt.
        expect(stand.production?.tuer?.proben).toEqual([{ url: "/", erwartet: null, bekommen: "200", ms: null }]);
        expect(stand.production?.dienste).toEqual([{ name: "fastify", zustand: "active" }]);
        expect(parseSystemStatus({ ...CLAUDIO, production: "ja" })!.production).toBeNull();
        expect(parseSystemStatus({ ...CLAUDIO, production: [PRODUCTION] })!.production).toBeNull();
        expect(parseSystemStatus({ ...CLAUDIO, production: {} })!.production).toEqual({ tuer: null, dienste: [] });
    });
});

describe("Messwerte (§3.7)", () => {
    it("/proc/meminfo in Bytes; das 5-Minuten-Fach", () => {
        expect(
            leseMeminfo(
                "MemTotal:       8000000 kB\nMemAvailable:   5000000 kB\nSwapTotal: 2048 kB\nSwapFree: 1024 kB\n",
            ),
        ).toEqual({
            MemTotal: 8_192_000_000,
            MemAvailable: 5_120_000_000,
            SwapTotal: 2_097_152,
            SwapFree: 1_048_576,
        });
        expect(bucketVon(new Date("2026-10-10T18:07:31Z")).toISOString()).toBe("2026-10-10T18:05:00.000Z");
        expect(bucketVon(new Date("2026-10-10T18:05:00Z")).toISOString()).toBe("2026-10-10T18:05:00.000Z");
    });

    it("🔴 unter Windows ist die Last unbekannt, nie 0; Speicher und Laufzeit sind da", async () => {
        const werte = await osMesswerte("win32");
        expect(werte.last).toBeNull();
        expect(werte.speicher.gesamt).toBeGreaterThan(0);
        expect(werte.laufzeit.prozess).toBeGreaterThanOrEqual(0);
        expect(werte.rss).toBeGreaterThan(0);
        if (process.platform !== "linux") expect(werte.speicher.auslagerung).toBeNull();
    });
});

describe("Der Schemastand (Betreiber 2026-10-14)", () => {
    // 🔴 Die Frage, die eine Nacht gekostet hat: Fehlt das Feature, oder lief nur `migrate` nicht?
    const db = (versionen: string[]) => (async () => versionen.map((version) => ({ version }))) as never;

    it("🔴 alles eingespielt: vollständig, und die höchste steht da", async () => {
        const stand = await migrationenStand(db(["0001_a", "0002_b"]), async () => ["0001_a", "0002_b"]);
        expect(stand).toEqual({ zustand: "vollstaendig", eingespielt: "0002_b", erwartet: "0002_b", fehlend: 0 });
    });

    it("🔴 eine fehlt: der Zustand sagt es und zählt sie", async () => {
        const stand = await migrationenStand(db(["0001_a"]), async () => ["0001_a", "0002_b", "0003_c"]);
        expect(stand).toEqual({ zustand: "fehlend", eingespielt: "0001_a", erwartet: "0003_c", fehlend: 2 });
    });

    it("🪤 die Datenbank ist weiter als der Code: das ist kein Fehler (Rückweg)", async () => {
        // Nach einem Rollback läuft das vorige Release gegen das neuere Schema. Gezählt wird nur, was dem RELEASE fehlt.
        const stand = await migrationenStand(db(["0001_a", "0002_b", "0003_c"]), async () => ["0001_a", "0002_b"]);
        expect(stand.zustand).toBe("vollstaendig");
        expect(stand.fehlend).toBe(0);
    });

    it('🔴 ohne Recht oder ohne Tafel: unlesbar, nicht "alles gut"', async () => {
        const kaputt = (async () => {
            throw Object.assign(new Error("permission denied for table schema_migration"), { code: "42501" });
        }) as never;
        const stand = await migrationenStand(kaputt, async () => ["0001_a"]);
        expect(stand).toEqual({ zustand: "unlesbar", eingespielt: null, erwartet: "0001_a", fehlend: 0 });
    });
});
