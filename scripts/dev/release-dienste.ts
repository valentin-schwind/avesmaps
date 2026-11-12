// Hilfsdienste des Release-Runners (WI-0248 R1): ein eigener Martin gegen den Korpus und das sichere Beenden von Prozessbäumen.
//
// 🔴 Martin liefert die Vektorkacheln (`/tiles/vector`); die Test-Vite proxyt darauf mit `MARTIN_PORT` (Standard 3010). Auf 3010 hört auf dem
// Entwicklungsrechner der Martin des Entwicklungsstapels gegen die Entwicklungsdatenbank: Die Browserteile würden an fremden Daten messen. Der
// Runner startet deshalb einen eigenen Martin auf einem freien Port gegen den Wegwerf-Korpus und setzt `MARTIN_PORT` für die Browserteile.
// Die Argumente stehen wie in `start-martin.mjs` (kein Kachelspeicher: jede Kachel kommt frisch aus der Datenbank).
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

const exe = process.platform === "win32" ? ".exe" : "";

/** Der Ort von Martin auf dem Entwicklungsrechner (`install-toolchain.ps1`). */
export const MARTIN_STANDARD = "C:/tools/martin/martin.exe";

/** Die Martin-Programmdatei: `MARTIN_BIN`, der Windows-Standard, dann der Suchpfad; `undefined`, wenn keine existiert. */
export function findeMartin(
    env: NodeJS.ProcessEnv = process.env,
    gibtEs: (pfad: string) => boolean = existsSync,
): string | undefined {
    const kandidaten = [
        env["MARTIN_BIN"],
        MARTIN_STANDARD,
        ...(env["PATH"] ?? "").split(delimiter).map((ordner) => (ordner === "" ? "" : join(ordner, `martin${exe}`))),
    ];
    return kandidaten.find((pfad) => pfad !== undefined && pfad !== "" && gibtEs(pfad));
}

/** Die Kommandozeile von Martin gegen eine Datenbank (wie `start-martin.mjs`). */
export function martinArgumente(port: number, datenbankUrl: string, poolSize: string | undefined): string[] {
    return [
        "--listen-addresses",
        `127.0.0.1:${String(port)}`,
        "--pool-size",
        poolSize ?? "8",
        "--cache-size",
        "0",
        datenbankUrl,
    ];
}

/** Beendet einen Prozess samt allen Kindern; Windows über `taskkill /T`, sonst die Prozessgruppe (der Prozess startete mit `detached`). */
export function beendeProzessbaum(pid: number | undefined): void {
    if (pid === undefined) return;
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
            windowsHide: true,
            timeout: 10_000,
            stdio: "ignore",
        });
        return;
    }
    try {
        process.kill(-pid, "SIGKILL");
    } catch {
        try {
            process.kill(pid, "SIGKILL");
        } catch {
            /* schon beendet */
        }
    }
}

export interface Dienst {
    readonly pid: number | undefined;
    /** Beendet den Dienst samt Kindern; mehrfach aufrufbar. */
    beende(): void;
}

function logEnde(datei: string): string {
    try {
        return (
            readFileSync(datei, "utf8")
                .split(/\r?\n/)
                .filter((zeile) => zeile.trim() !== "")
                .slice(-6)
                .join(" | ") || "(Protokoll leer)"
        );
    } catch {
        return "(kein Protokoll)";
    }
}

const warte = (ms: number): Promise<void> => new Promise((erfuellt) => setTimeout(erfuellt, ms));

/**
 * Startet Martin gegen `url` auf `127.0.0.1:port`, wartet auf `/health` und gibt den Dienst zurück. Wirft (und beendet Martin), wenn er vor der
 * Bereitschaft endet oder in `bereitMs` nicht antwortet; die Meldung nennt das Ende des Protokolls. `vorArgumente` stehen vor den
 * Martin-Argumenten (nur für Proben mit einem Ersatzprogramm).
 */
export async function starteMartin(optionen: {
    readonly bin: string;
    readonly port: number;
    readonly url: string;
    readonly log: string;
    readonly env: NodeJS.ProcessEnv;
    readonly poolSize?: string;
    readonly bereitMs?: number;
    readonly vorArgumente?: readonly string[];
}): Promise<Dienst> {
    const fd = openSync(optionen.log, "a");
    let kind: ReturnType<typeof spawn>;
    try {
        kind = spawn(
            optionen.bin,
            [
                ...(optionen.vorArgumente ?? []),
                ...martinArgumente(optionen.port, optionen.url, optionen.poolSize ?? optionen.env["MARTIN_POOL_SIZE"]),
            ],
            {
                env: optionen.env,
                stdio: ["ignore", fd, fd],
                windowsHide: true,
                detached: process.platform !== "win32",
            },
        );
    } finally {
        closeSync(fd);
    }
    let beendet = false;
    let startFehler: Error | undefined;
    kind.once("error", (fehler) => {
        startFehler = fehler;
    });
    const dienst: Dienst = {
        pid: kind.pid,
        beende: () => {
            if (beendet) return;
            beendet = true;
            beendeProzessbaum(kind.pid);
        },
    };
    kind.unref();
    const grenze = Date.now() + (optionen.bereitMs ?? 60_000);
    try {
        for (;;) {
            if (startFehler !== undefined) throw new Error(`Martin lässt sich nicht starten: ${startFehler.message}`);
            if (kind.exitCode !== null || kind.signalCode !== null)
                throw new Error(
                    `Martin endete vor der Bereitschaft (Exit ${String(kind.exitCode ?? kind.signalCode)}): ${logEnde(optionen.log)}`,
                );
            try {
                const antwort = await fetch(`http://127.0.0.1:${String(optionen.port)}/health`, {
                    signal: AbortSignal.timeout(2000),
                });
                if (antwort.ok) return dienst;
            } catch {
                /* noch nicht bereit */
            }
            if (Date.now() > grenze)
                throw new Error(
                    `Martin antwortete in ${String(Math.round((optionen.bereitMs ?? 60_000) / 1000))} s nicht auf /health: ${logEnde(optionen.log)}`,
                );
            await warte(250);
        }
    } catch (fehler) {
        dienst.beende();
        throw fehler;
    }
}
