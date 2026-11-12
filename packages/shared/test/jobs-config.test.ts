import { describe, expect, it } from "vitest";
import {
    JOBS_PROFILES,
    UNKNOWN_JOBS_CONFIG,
    getJobsConfig,
    leaseSecondsFor,
    resolveJobsConfig,
    swapRateFor,
    type JobsProfile,
} from "../src/index.ts";

/**
 * Die Variablen der Warteschlange (JOBS-0001 Abschnitt 6.0, WI-0074).
 *
 * 🔴 Ein Wert in einem Profil `staging` oder `production` steht nur mit Beleg: als Startwert (Claudios Richtwert aus
 * Stage-Läufen) bis zum Messtor, oder als gemessener Wert mit Verweis auf das Protokoll. Das ist ein Test der Entwicklung,
 * kein Betriebs-Gate: er hält nur, dass kein Rechnerwert ohne Herkunft in einem Profil landet.
 */

const NEEDS_EVIDENCE = new Set(["staging", "production"]);
const EVIDENCE = /^(start|messung|offen): \S/;

describe("config/jobs: Profile", () => {
    it("🔴 jedes Profil auf staging oder production belegt jeden Wert (start, messung oder offen)", () => {
        for (const [name, profile] of Object.entries(JOBS_PROFILES)) {
            expect(profile.profile).toBe(name);
            if (!NEEDS_EVIDENCE.has(name)) continue;
            const without = Object.entries(profile.values)
                .filter(([, entry]) => !EVIDENCE.test(entry.evidence ?? ""))
                .map(([key]) => key);
            expect(without, `Werte ohne Beleg in ${name}`).toEqual([]);
        }
    });

    it("jeder Startwert verweist auf eine Kennung des Registers oder nennt seine Herkunft", () => {
        const staging = JOBS_PROFILES["staging"];
        expect(staging).toBeDefined();
        for (const [key, entry] of Object.entries(staging?.values ?? {})) {
            expect(entry.note, `${key} ohne Kennung`).toMatch(/^(MS\d+|Q\d+|Takt des Planers)/);
        }
    });

    it("Claudios Startwerte stehen unverändert im Profil staging (MS1 bis MS20)", () => {
        const config = getJobsConfig("staging");
        expect(config.heartbeatS).toBe(10);
        expect(config.leaseS["default"]).toBe(60);
        expect(config.maxConcurrent).toEqual({
            terrain_local: 1,
            display_heights: 1,
            import: 1,
            // Claudios Messung unter dem Host-Dirigenten (2026-10-15, WI-0163): kleine Arten neben einem Schweren
            benachrichtigung: 2,
            routing_reload: 1,
            legacy_zug: 1,
            terrain_full: 1,
            production_pull: 1,
            // Claudios Einschätzung zur Ableitung der Herrschaftsgebiete (2026-10-17, WI-0209 B3): schwer, allein.
            territory_derive: 1,
            // Claudio 2026-10-17 (WI-0153 7b): der Seegraph ist schwer, zwei nebeneinander nie.
            sea_derive: 1,
            // Claudio 2026-10-17 (WI-0220 §4.3): eine Kartenserie zerlegen ist schwer, einer zur Zeit.
            map_series_tile: 1,
            karten_svg: 1,
            // Claudio 2026-10-18 (WI-0177): die Folgen einer Wege-Operation, leichte Arten des Dirigenten, je einer zur Zeit.
            path_label_runs: 1,
            path_profile: 1,
            // WI-0253 §22 (Entwurf der Entwicklung): das Holen des Dumps hat einen Schreiber im gemeinsamen Dump-Ordner, schwer, einer zur Zeit.
            wiki_dump_holen: 1,
            // Claudio 2026-10-30 (WI-0261 S4, §3): die Treffer der Sprachen, ein Lauf zur Zeit.
            sprache_treffer: 1,
            // Claudio 2026-11-06 (WI-0283): die Folgen einer gespeicherten Landschaft, leichte Arten, je einer zur Zeit.
            land_smooth: 1,
            label_runs: 1,
        });
        expect(config.threads).toEqual({ legacy_zug: 2, production_pull: 1 });
        // Claudio 2026-10-19 (WI-0229): die leichte Ableitung der Gebiete nie neben der Kopie von Production und dem vollen Import.
        expect(config.exclusivePairs).toEqual([
            ["import", "terrain_local"],
            ["import", "territory_derive"],
            ["production_pull", "territory_derive"],
            // WI-0253 D-1 (Entwurf der Entwicklung, Claudio bestätigt am echten Bestand): die Übernahme und die Rücknahme des WikiSync schreiben Fachtafeln der Karte,
            // nie neben dem Legacy-Zug, dem vollen Import und der leichten Gebietsableitung.
            ["wiki_uebernehmen", "legacy_zug"],
            ["wiki_uebernehmen", "import"],
            ["wiki_uebernehmen", "territory_derive"],
            ["wiki_zuruecknehmen", "legacy_zug"],
            ["wiki_zuruecknehmen", "import"],
            ["wiki_zuruecknehmen", "territory_derive"],
            // WI-0261 S4 (nach Claudio 2026-10-30 §3, wie die Gebietsableitung): die leichten Treffer der Sprachen lesen Orte, Wege und Flächen,
            // nie neben dem vollen Import und der Kopie von Production.
            ["import", "sprache_treffer"],
            ["production_pull", "sprache_treffer"],
        ]);
        // 4 seit Claudio 2026-10-19 Weg A: neben dem einen Schweren (3 Threads) nur leichte Ein-Thread-Aufträge, gedrosselt im Wrapper.
        expect(config.cpuBudgetThreads).toBe(4);
        expect(config.memExpectedMb).toEqual({
            // Claudio 2026-10-19 (Wahl A): terrain_local braucht unabhängig von der Kachelzahl rund 1,73 GiB; vorher 1400.
            terrain_full: 1850,
            terrain_publish_only: 800,
            display_heights: 700,
            import: 300,
            // Claudios Messlauf auf Stage (handovers/2026-10-05-stage-rollout-9b6213f.md): land_smooth voller Lauf 400 MB als
            // Startwert, und eine Probe braucht auf dem VPS 51 MB Grundbedarf, nicht die 41 MB des nackten Node-Prozesses.
            land_smooth: 400,
            // Claudio 2026-10-19 (WI-0229): gemessen 120 bis 123 MB; mit 150 passt die leichte Ableitung neben ein Gelände (1850 + 150 ≤ 2000).
            territory_derive: 150,
            // Claudio 2026-10-17 (WI-0153 7b): lokal gemessen rund 1 GB Spitze; neben terrain_full lässt ihn das Budget nie laufen.
            sea_derive: 1200,
            // Claudio 2026-10-17 (WI-0220 §4.3): 64k gemessen 780 MB Spitze; der Katalogwert mit Luft.
            map_series_tile: 900,
            karten_svg: 800,
            probe_base: 51,
            // Claudio 2026-10-18 (WI-0177): auf der Stage gemessen 136 und 346 MB Spitze; die Werte mit Luft.
            path_label_runs: 150,
            path_profile: 400,
            // Claudio 2026-10-30 (WI-0261 S4, §3): die Rechnung liegt in PostgreSQL; wie die Gebietsableitung neben ein Gelände (1850 + 150 ≤ 2000).
            sprache_treffer: 150,
            // Stage 2026-11-05 (WI-0283): 95 MB Spitze.
            label_runs: 120,
        });
        // Claudio 2026-10-19 (Wahl A): Budget ein Gelände plus eine leichte Art.
        expect(config.memTotalBudgetMb).toBe(2000);
        // Claudio 2026-10-19: Ein Gelände meldet sich erst nahe an MemoryHigh 2200M des Wrappers; 1,75 bis 1,9 GB sind der Normalfall.
        expect(config.memReportWarnMb).toEqual({ terrain_full: 2000, display_heights: 700 });
        // Vali 2026-11-06 nach Claudios Beleg (WI-0283 §5): Boden 560 statt 1024, ein Gelände mit 2000 startet ab 2560 MB frei, dem Speichertor des Wrappers.
        expect(config.memAvailFloorMb).toBe(560);
        // WI-0283: wie das Speichertor des Wrappers für leichte Arten.
        expect(config.memAvailFloorLightMb).toBe(512);
        expect(config.rolloutMaxJobMb).toBe(300);
        expect(config.swapNoiseMb).toBe(64);
        expect(config.swapInRateMbPerMin).toBe(21);
        // Claudio 2026-10-19, erster Abend: Der Rollout treibt den Host auch ohne Prüflauf in den Swap; er meldet erst über 200 je Minute.
        expect(swapRateFor(config, "stage_rollout")).toBe(200);
        expect(swapRateFor(config, "terrain_full")).toBe(21);
        expect(config.expectedDurationS).toMatchObject({
            terrain_full: 360,
            terrain_publish_only: 90,
            display_heights: 120,
            import: 900,
            // WI-0253 §22: Claudio holte den Dump am 2026-10-26 in 11 s; 60 s mit bzip2 -t und Umbenennen als Obergrenze.
            wiki_dump_holen: 60,
            // WI-0261 S4: Obergrenze des vollen Laufs (Claudio §3: unter 5 Minuten).
            sprache_treffer: 60,
        });
        expect(config.historyMinRuns).toBe(5);
        expect(config.drainMaxS).toBe(420);
        expect(config.retention).toMatchObject({ keepDays: 30, keepRuns: 200 });
        expect(config.apiLatencyTargetMs).toEqual({ p95: 300, p99: 1000 });
        expect(config.dbConnectionBudget).toBe(6);
        // MS14 hat keinen Startwert: unbegrenzt, bis Claudio misst.
        expect(config.wsMaxConnections).toBeNull();
    });

    it("🔴 ein Profil ohne Datei (production) hat keinen Rechnerwert: jede Jobart läuft allein", () => {
        const config = getJobsConfig("production");
        expect(config.profile).toBe("production");
        expect(config.maxConcurrent).toEqual({});
        expect(config.memTotalBudgetMb).toBeNull();
        expect(config.memAvailFloorMb).toBeNull();
        expect(config.cpuBudgetThreads).toBeNull();
        expect(config.memExpectedMb).toEqual({});
        // Die Entwurfswerte bleiben: Heartbeat 10 s und Lease 60 s sind Design, keine Messung.
        expect(config.heartbeatS).toBe(UNKNOWN_JOBS_CONFIG.heartbeatS);
        expect(config.leaseS["default"]).toBe(60);
    });

    it("lease: je Art, sonst der Standard; aufgezeichnete Jobs haben ihre eigene, längere", () => {
        const config = getJobsConfig("staging");
        expect(leaseSecondsFor(config, "probe", false)).toBe(60);
        expect(leaseSecondsFor(config, "import", true)).toBe(900);
        expect(leaseSecondsFor(config, "rollout", true)).toBe(300);
        expect(leaseSecondsFor(config, "etwas-neues", true)).toBe(900);
    });

    it("ein Wert aus der Datei gewinnt, ein fehlender fällt auf den Entwurfswert zurück", () => {
        const profile: JobsProfile = {
            schemaVersion: 1,
            profile: "probe",
            values: { heartbeatS: { value: 3 } },
        };
        const config = resolveJobsConfig(profile, "probe");
        expect(config.heartbeatS).toBe(3);
        expect(config.tickS).toBe(UNKNOWN_JOBS_CONFIG.tickS);
        expect(config.retention).toEqual(UNKNOWN_JOBS_CONFIG.retention);
    });
});
