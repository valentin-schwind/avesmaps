// Übrig gebliebene Wegwerf-Postgres abgebrochener Testläufe aufräumen.
//
// 🔴 Anlass (Arbeitshygiene 2026-10-17, Go der Hauptorchestrierung): Tests, die einen eigenen Datenbankcluster brauchen (`vps-cluster.ts`,
// `media-mam-grants`, `public-rechte-app-rolle` u. a.), starten `postgres.exe -D %TEMP%\avesmaps3d-<name>-<zufall>\data`. Bricht man den
// Lauf hart ab (TaskStop, Stop-Process), bleibt der Postmaster stehen: drei Cluster liefen seit dem Vortag, zwei davon mit je 0,55 Kernen
// Dauerlast (rund 47.000 CPU-Sekunden), ohne dass je eine Verbindung offen war.
//
// Sauber beenden darf nur, wessen Besitzer nachweislich tot ist. Ein Cluster gilt als verwaist, wenn
//   - sein Datenverzeichnis unter `<Temp>\avesmaps3d-*` liegt, NICHT unter dem Scratchpad einer Sitzung (`\claude\`),
//   - der Prozess, der ihn gestartet hat (der Eltern-Prozess der `cmd.exe`, die Windows davorschaltet), nicht mehr läuft,
//   - keine Verbindung an seinem Port offen ist
//   - und der Postmaster älter als `MINDESTALTER_MS` ist.
// 🪤 Die letzte Bedingung kam nach (Arbeitshygiene 2026-10-18): `vps-cluster.ts` startet seine Cluster über `pg_ctl start`. Dessen
// Prozess endet gleich nach dem Start, der Besitzer gilt also sofort als tot; zwischen zwei Testfällen ist keine Verbindung offen. Ein
// `vor-dem-push`, der in diesem Augenblick irgendwo anlief, beendete so den LEBENDEN Cluster eines anderen Laufs (Beleg: Derographie
// beendete `avesmaps3d-landupdate-…` der Kamera-Sitzung, deren Lauf daran rot wurde: ECONNRESET, danach scheiterte `pg_ctl stop`).
// Ein Testcluster lebt so lange wie seine Testdatei (Minuten), ein liegengebliebener Stunden bis Tage.
// Das Beenden ist `pg_ctl stop -m fast`, nie `taskkill`. Der Entwicklungscluster (`pgdata-18`, Port 5433) und jeder Cluster einer
// lebenden Sitzung bleiben unberührt, schon weil sie nicht unter `<Temp>\avesmaps3d-*` liegen oder einen lebenden Besitzer haben.
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface Prozess {
    readonly pid: number;
    readonly ppid: number;
    readonly name: string;
    readonly befehl: string;
    /** Startzeit des Prozesses (ms seit 1970); ohne sie gilt ein Postmaster als jung und bleibt stehen. */
    readonly start?: number;
}

export interface VerwaistesCluster {
    readonly pid: number;
    readonly datenverzeichnis: string;
    readonly port: number | undefined;
    readonly pgCtl: string;
}

/** Jünger als das ist ein Postmaster nie verwaist: Er kann der Cluster einer laufenden Testdatei sein (siehe Kopf). */
export const MINDESTALTER_MS = 2 * 60 * 60 * 1000;

const normal = (pfad: string): string => pfad.replace(/\\/g, "/").replace(/\/+$/, "");

/** Das Datenverzeichnis und der Port aus der Befehlszeile eines Postmasters; `undefined` für Kindprozesse und Fremdes. */
function postmaster(befehl: string): { daten: string; port: number | undefined; programm: string } | undefined {
    if (befehl.includes("--forkchild")) return undefined;
    const daten = /\s-D\s+"([^"]+)"/.exec(befehl) ?? /\s-D\s+(\S+)/.exec(befehl);
    if (daten?.[1] === undefined) return undefined;
    const programm = /^\s*"([^"]+)"/.exec(befehl)?.[1] ?? /^\s*(\S+)/.exec(befehl)?.[1] ?? "";
    const port = /\s-p\s+(\d+)/.exec(befehl)?.[1];
    return { daten: normal(daten[1]), port: port === undefined ? undefined : Number(port), programm };
}

/**
 * Welche Wegwerf-Cluster verwaist sind. `verbindungen(port)` zählt die offenen Verbindungen am Port. Rein: nichts wird beendet.
 */
export function verwaisteCluster(
    prozesse: readonly Prozess[],
    optionen: { readonly temp: string; readonly verbindungen: (port: number) => number; readonly jetzt?: number },
): VerwaistesCluster[] {
    const lebende = new Set(prozesse.map((p) => p.pid));
    const jetzt = optionen.jetzt ?? Date.now();
    const temp = normal(optionen.temp).toLowerCase();
    const gefunden: VerwaistesCluster[] = [];
    for (const p of prozesse) {
        if (p.name.toLowerCase() !== "postgres.exe") continue;
        const pm = postmaster(p.befehl);
        if (pm === undefined) continue;
        const daten = pm.daten.toLowerCase();
        if (!daten.startsWith(`${temp}/avesmaps3d-`) || daten.includes("/claude/")) continue;
        // Der Besitzer ist der Prozess, der die vorgeschaltete `cmd.exe` gestartet hat; fehlt die `cmd.exe`, der direkte Elternprozess.
        const eltern = prozesse.find((q) => q.pid === p.ppid);
        const besitzerPid = eltern !== undefined && eltern.name.toLowerCase() === "cmd.exe" ? eltern.ppid : p.ppid;
        if (lebende.has(besitzerPid)) continue;
        if (p.start === undefined || jetzt - p.start < MINDESTALTER_MS) continue;
        if (pm.port !== undefined && optionen.verbindungen(pm.port) > 0) continue;
        gefunden.push({
            pid: p.pid,
            datenverzeichnis: pm.daten,
            port: pm.port,
            pgCtl: join(dirname(pm.programm), "pg_ctl.exe"),
        });
    }
    return gefunden;
}

/** Windows: alle Prozesse mit Eltern, Name und Befehlszeile; leer, wenn das System sie nicht hergibt. */
export function liesProzesse(): Prozess[] {
    const lauf = spawnSync(
        "powershell",
        [
            "-NoProfile",
            "-Command",
            "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n='Start';e={if ($_.CreationDate) { $_.CreationDate.ToUniversalTime().ToString('o') }}} | ConvertTo-Json -Compress",
        ],
        { encoding: "utf8", maxBuffer: 2 ** 26 },
    );
    if (lauf.status !== 0 || lauf.stdout.trim() === "") return [];
    try {
        // 🪤 Zwei Gründe, aus denen JSON.parse warf und die Liste still leer zurückkam, der Aufräumer also nichts sah (2026-10-18):
        // PowerShell 5.1 schreibt Steuerzeichen einer Befehlszeile roh ins JSON (die Zeilenumbrüche eines mehrzeiligen Bash-Befehls einer
        // Sitzung; als Leerzeichen harmlos), und ohne UTF-8-Ausgabe (oben) wird ein typografisches Anführungszeichen zu einem rohen `"`.
        const roh = JSON.parse(Array.from(lauf.stdout, (z) => (z < " " ? " " : z)).join("")) as {
            ProcessId: number;
            ParentProcessId: number;
            Name: string;
            CommandLine: string | null;
            Start: string | null;
        }[];
        return roh.map((r) => ({
            pid: r.ProcessId,
            ppid: r.ParentProcessId,
            name: r.Name,
            befehl: r.CommandLine ?? "",
            ...(r.Start === null || Number.isNaN(Date.parse(r.Start)) ? {} : { start: Date.parse(r.Start) }),
        }));
    } catch {
        return [];
    }
}

/** Offene Verbindungen je lokalem Port (`netstat`, nur ESTABLISHED), einmal gelesen. */
export function liesVerbindungen(): (port: number) => number {
    const lauf = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8", maxBuffer: 2 ** 26 });
    const je = new Map<number, number>();
    for (const zeile of lauf.stdout.split(/\r?\n/)) {
        const t = /^\s*TCP\s+\S+:(\d+)\s+\S+:\d+\s+ESTABLISHED\s+\d+/.exec(zeile);
        if (t?.[1] !== undefined) je.set(Number(t[1]), (je.get(Number(t[1])) ?? 0) + 1);
    }
    return (port) => je.get(port) ?? 0;
}

/** Beendet jeden verwaisten Wegwerf-Cluster mit `pg_ctl stop -m fast`; gibt je Cluster eine Zeile zurück. Nur Windows. */
export function raeumeWegwerfClusterAuf(
    zeile: (text: string) => void,
    temp: string = tmpdir(),
    stoppe: (cluster: VerwaistesCluster) => boolean = (c) =>
        spawnSync(c.pgCtl, ["stop", "-D", c.datenverzeichnis, "-m", "fast", "-t", "30"], { encoding: "utf8" })
            .status === 0,
): number {
    if (process.platform !== "win32") return 0;
    let weg = 0;
    for (const cluster of verwaisteCluster(liesProzesse(), { temp, verbindungen: liesVerbindungen() })) {
        const ok = stoppe(cluster);
        zeile(
            ok
                ? `  Wegwerf-Cluster eines toten Laufs beendet: ${cluster.datenverzeichnis} (PID ${String(cluster.pid)}${cluster.port === undefined ? "" : `, Port ${String(cluster.port)}`})`
                : `  Wegwerf-Cluster eines toten Laufs bleibt laufen (pg_ctl scheiterte): ${cluster.datenverzeichnis}`,
        );
        if (ok) weg += 1;
    }
    return weg;
}
