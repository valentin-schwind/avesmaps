import { spawn } from "node:child_process";
import { extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isChildMessage, type ChildMessage, type ParentMessage } from "./child-protocol.ts";

/**
 * Der Job-Prozess aus Sicht des Aufsehers. Eine Schnittstelle statt `ChildProcess`, damit die Tests des Workers einen
 * gesteuerten Ersatz einsetzen können (Absturz zu einem bestimmten Zeitpunkt, Nachrichten in bestimmter Reihenfolge).
 */
export interface JobChild {
    readonly pid: number | undefined;
    send(message: ParentMessage): void;
    onMessage(listener: (message: ChildMessage) => void): void;
    onExit(listener: (code: number | null, signal: string | null) => void): void;
    kill(signal?: NodeJS.Signals): void;
}

export interface SpawnOptions {
    /** Vorgabewerte der Jobart für die Umgebung des Prozesses (`JobKindSpec.childEnv`). */
    env?: Readonly<Record<string, string>> | undefined;
}

export type ChildSpawner = (options?: SpawnOptions) => JobChild;

/** Die Umgebung des Job-Prozesses: die Vorgaben der Jobart zuerst, was der Aufseher selbst gesetzt hat gewinnt. */
export function childEnvironment(base: NodeJS.ProcessEnv, kindEnv: SpawnOptions["env"]): NodeJS.ProcessEnv {
    return { ...kindEnv, ...base };
}

/**
 * Die `--import`-Lader dieses Prozesses, für seine Kinder (Vali 2026-10-26, „Gelände im Bereich rechnen“ lokal gescheitert: `does not provide
 * an export named 'TREFFEN_QUELLE'`). Läuft der lokale Dirigent mit dem Quell-Lader (`npm run jobs:worker:dev`, `scripts/dev/shared-aus-quellen.mjs`),
 * lesen auch Auftrag und Job-Prozess `@avesmaps3d/shared` aus den Quellen statt aus einem `dist`, das nach einem Pull noch alt ist. Ohne Lader
 * (Release, VPS) ist die Liste leer und alles bleibt bei `dist`. Relative Pfade werden zur Datei-URL, damit das Kind sie unabhängig vom
 * Arbeitsverzeichnis findet.
 */
export function vererbteLader(execArgv: readonly string[] = process.execArgv): string[] {
    const lader: string[] = [];
    execArgv.forEach((arg, i) => {
        const wert = arg.startsWith("--import=")
            ? arg.slice("--import=".length)
            : arg === "--import"
              ? execArgv[i + 1]
              : undefined;
        if (wert === undefined) return;
        const url =
            /^[a-z][a-z0-9+.-]*:/iu.test(wert) && !/^[a-z]:[\\/]/iu.test(wert)
                ? wert
                : pathToFileURL(resolve(wert)).href;
        lader.push(`--import=${url}`);
    });
    return lader;
}

/** Aus `src/` läuft der Job-Prozess als `.ts`, aus `dist/` als `.js` - dieselbe Endung wie diese Datei. */
const childFile = fileURLToPath(new URL(`./child${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

/**
 * Startet den echten Job-Prozess: `node --expose-gc child`, mit eigenem Kanal. Standardausgabe und Fehler gehen ins Journal des
 * Workers. Gerechnet wird nie im Fastify-Prozess und nie im Worker selbst.
 */
export const spawnJobProcess: ChildSpawner = (options) => {
    const proc = spawn(process.execPath, [...vererbteLader(), "--expose-gc", childFile], {
        stdio: ["ignore", "inherit", "inherit", "ipc"],
        env: childEnvironment(process.env, options?.env),
    });
    const messageListeners: ((message: ChildMessage) => void)[] = [];
    const exitListeners: ((code: number | null, signal: string | null) => void)[] = [];
    let exited = false;
    proc.on("message", (message: unknown) => {
        if (isChildMessage(message)) for (const listener of messageListeners) listener(message);
    });
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
        if (exited) return;
        exited = true;
        for (const listener of exitListeners) listener(code, signal);
    };
    proc.on("exit", onExit);
    // Ein Start, der scheitert (kein `node`, kein Speicher), ist ein Tod ohne Nachricht.
    proc.on("error", () => onExit(null, null));
    return {
        get pid() {
            return proc.pid;
        },
        send: (message) => {
            if (proc.connected) proc.send(message);
        },
        onMessage: (listener) => {
            messageListeners.push(listener);
        },
        onExit: (listener) => {
            exitListeners.push(listener);
        },
        kill: (signal = "SIGTERM") => {
            if (!exited) proc.kill(signal);
        },
    };
};
