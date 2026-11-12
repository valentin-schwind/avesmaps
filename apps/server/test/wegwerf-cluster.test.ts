import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
    liesProzesse,
    MINDESTALTER_MS,
    raeumeWegwerfClusterAuf,
    verwaisteCluster,
    type Prozess,
} from "../../../scripts/dev/wegwerf-cluster.ts";

/**
 * Übrig gebliebene Wegwerf-Postgres abgebrochener Läufe (`scripts/dev/wegwerf-cluster.ts`, Hauptorchestrierung 2026-10-17). Problemfälle:
 * ein Cluster mit lebendem Besitzer, mit offener Verbindung, im Scratchpad einer Sitzung oder der Entwicklungscluster werden beendet;
 * dazu (2026-10-18) der junge Cluster einer laufenden Testdatei, gestartet über `pg_ctl start`, dessen Besitzer darum schon tot ist.
 */
const TEMP = "C:\\Users\\mail\\AppData\\Local\\Temp";
const PG = '"C:/tools/pgsql-18/bin/postgres.exe"';
const JETZT = Date.parse("2026-10-18T15:30:00Z");
/** Ein Postmaster, standardmäßig seit einem Tag am Laufen (so alt wie die liegengebliebenen Cluster des Anlasses). */
const postmaster = (
    pid: number,
    ppid: number,
    daten: string,
    port = 60001,
    start: number | null = JETZT - 86_400_000,
): Prozess => ({
    pid,
    ppid,
    name: "postgres.exe",
    befehl: `${PG}  -D "${daten}" -p ${String(port)} -c listen_addresses=127.0.0.1 -c fsync=off`,
    ...(start === null ? {} : { start }),
});
const cmd = (pid: number, ppid: number): Prozess => ({ pid, ppid, name: "cmd.exe", befehl: "cmd.exe /C postgres" });
const lebend = (pid: number, name = "node.exe"): Prozess => ({ pid, ppid: 1, name, befehl: name });
const keine = { temp: TEMP, verbindungen: () => 0, jetzt: JETZT };

describe("verwaiste Wegwerf-Cluster", () => {
    it("🔴 Besitzer tot (der Prozess hinter der cmd.exe läuft nicht mehr), keine Verbindung: verwaist", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-rechtetafel-MONe9T/data";
        const tabelle = [cmd(200, 999), postmaster(300, 200, daten, 53978)];
        expect(verwaisteCluster(tabelle, keine)).toEqual([
            {
                pid: 300,
                datenverzeichnis: daten,
                port: 53978,
                pgCtl: join(dirname("C:/tools/pgsql-18/bin/postgres.exe"), "pg_ctl.exe"),
            },
        ]);
    });

    it("🔴 Besitzer lebt: nie anfassen", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-sysstats-NjWbAZ/data";
        const tabelle = [lebend(999), cmd(200, 999), postmaster(300, 200, daten)];
        expect(verwaisteCluster(tabelle, keine)).toEqual([]);
    });

    it("🔴 offene Verbindung am Port: nie anfassen, auch bei totem Besitzer", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-landrev-Cka39C/data";
        const tabelle = [cmd(200, 999), postmaster(300, 200, daten, 53994)];
        expect(
            verwaisteCluster(tabelle, { temp: TEMP, verbindungen: (port) => (port === 53994 ? 2 : 0), jetzt: JETZT }),
        ).toEqual([]);
    });

    it("🔴 der Cluster einer lebenden Sitzung im Scratchpad und der Entwicklungscluster bleiben unberührt", () => {
        const scratch =
            "C:/Users/mail/AppData/Local/Temp/claude/C--GIT-avesmaps3D--claude-worktrees-jolly-babbage-a522ef/x/scratchpad/pgt49";
        const dev = "C:/tools/pgdata-18";
        const fremd = "D:/anderswo/avesmaps3d-x/data";
        const tabelle = [
            cmd(200, 999),
            postmaster(300, 200, scratch),
            postmaster(301, 200, dev, 5433),
            postmaster(302, 200, fremd),
        ];
        expect(verwaisteCluster(tabelle, keine)).toEqual([]);
    });

    it("🔴 junger Cluster einer laufenden Testdatei (pg_ctl start: Besitzer schon tot, gerade keine Verbindung): nie anfassen", () => {
        // Der Fall vom 2026-10-18: `landscape-update` der Kamera-Sitzung, beendet vom `vor-dem-push` der Derographie.
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-landupdate-FIvmRq/data";
        const tabelle = [cmd(200, 999), postmaster(300, 200, daten, 53991, JETZT - 3 * 60_000)];
        expect(verwaisteCluster(tabelle, keine)).toEqual([]);
        // Knapp unter der Grenze bleibt er stehen, darüber gilt er als liegengeblieben.
        expect(
            verwaisteCluster([cmd(200, 999), postmaster(300, 200, daten, 53991, JETZT - MINDESTALTER_MS + 1)], keine),
        ).toEqual([]);
        expect(
            verwaisteCluster([cmd(200, 999), postmaster(300, 200, daten, 53991, JETZT - MINDESTALTER_MS - 1)], keine),
        ).toHaveLength(1);
    });

    it("ohne bekannte Startzeit bleibt ein Postmaster stehen", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-x-CCCCCC/data";
        expect(verwaisteCluster([cmd(200, 999), postmaster(300, 200, daten, 60001, null)], keine)).toEqual([]);
    });

    it.runIf(process.platform === "win32")(
        "liesProzesse liefert die Startzeit jedes Prozesses (ohne sie bliebe jeder Cluster stehen)",
        () => {
            const ich = liesProzesse().find((p) => p.pid === process.pid);
            expect(ich?.start).toBeTypeOf("number");
            expect(ich?.start ?? Infinity).toBeLessThanOrEqual(Date.now());
        },
    );

    it("Kindprozesse eines Postmasters (--forkchild) und fremde Programme zählen nicht", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-x-AAAAAA/data";
        const kind: Prozess = { pid: 400, ppid: 300, name: "postgres.exe", befehl: `${PG} --forkchild="backend" 4912` };
        const fremd: Prozess = { pid: 401, ppid: 1, name: "node.exe", befehl: `node -D "${daten}"` };
        expect(verwaisteCluster([kind, fremd], keine)).toEqual([]);
    });

    it("ohne vorgeschaltete cmd.exe zählt der direkte Elternprozess als Besitzer", () => {
        const daten = "C:/Users/mail/AppData/Local/Temp/avesmaps3d-x-BBBBBB/data";
        expect(verwaisteCluster([postmaster(300, 999, daten)], keine)).toHaveLength(1);
        expect(verwaisteCluster([lebend(999), postmaster(300, 999, daten)], keine)).toEqual([]);
    });

    it("raeumeWegwerfClusterAuf beendet nichts, was nicht verwaist ist, und meldet je Cluster eine Zeile", () => {
        const gestoppt: number[] = [];
        const zeilen: string[] = [];
        // Auf dieser Maschine gibt es echte Prozesse; ein Temp-Ordner ohne Treffer beendet nichts, auch ohne Besitzer-Lage.
        const weg = raeumeWegwerfClusterAuf(
            (z) => zeilen.push(z),
            "Z:\\gibt-es-nicht",
            (c) => {
                gestoppt.push(c.pid);
                return true;
            },
        );
        expect(weg).toBe(0);
        expect(gestoppt).toEqual([]);
        expect(zeilen).toEqual([]);
    });
});
