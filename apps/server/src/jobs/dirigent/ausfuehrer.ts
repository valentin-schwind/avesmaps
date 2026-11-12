import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import type { WarteschlangeUmgebung } from "@avesmaps3d/shared";
import { AUFTRAG_EXIT } from "../ausfuehrer.ts";
import { vererbteLader } from "../child-process.ts";

/**
 * Der Ausführer aus Sicht des Dirigenten (WI-0163 §1.3, §5.2): Er startet genau EINEN Auftrag mit den Rechten seiner Umgebung und
 * meldet mit dem Exitcode, wie es ausging. Der Dirigent selbst hält keine Schreibrechte.
 *
 * Die Exitcodes sind die des Ausführers selbst (`AUFTRAG_EXIT` in `jobs/ausfuehrer.ts`, Vertrag §5.2): **0** erledigt oder nichts
 * mehr zu tun, **1** technischer Fehler, **2** Aufruffehler, **3** die Umgebung kann den Auftrag nicht ausführen (Art unbekannt,
 * kein `auftrag-cli` im Release), **75** vorübergehend nicht. Was der Dirigent daraus macht, steht in `dirigent.ts`.
 *
 * Zwei Fassungen, gewählt mit `DIRIGENT_AUSFUEHRER`:
 *
 * - **`lokal`** (Vorgabe): startet `auftrag-cli` neben dieser Datei als Kindprozess mit `process.execPath`, als derselbe Benutzer
 *   und mit der Umgebung des Dirigenten. Endung wie diese Datei: `.ts` aus `src/` (Node streicht die Typen selbst, wie bei
 *   `npm run jobs:worker`), `.js` aus `dist/`. Beim Beenden des Dirigenten bekommen die Kinder SIGTERM: Ihr eigenes Ablösen
 *   (drain) gibt den Auftrag ohne Versuchszähler zurück, und der Dirigent wartet darauf.
 * - **`sudo`** (der Host-Dirigent auf dem VPS): `sudo -n /usr/local/sbin/avesmaps3d-auftrag <umgebung> <id> <art>` bzw.
 *   `… <umgebung> --pflege`, Claudios gepinnter Wrapper. Er führt den Auftrag als Dienstbenutzer der Umgebung aus, mit deren
 *   `.env`, aus deren `current`, in eigenem Scope. 🔴 Beim Beenden des Dirigenten wird dort NICHTS beendet: Ein Neustart des
 *   Dirigenten (Stage-Rollout) darf keinen laufenden Auftrag abbrechen (A6).
 */

export type AusfuehrerArt = "lokal" | "sudo";
export const AUSFUEHRER_ARTEN: readonly AusfuehrerArt[] = ["lokal", "sudo"];

/** Claudios Wrapper auf dem VPS (gepinnt, sudoers). */
export const AUFTRAG_WRAPPER = "/usr/local/sbin/avesmaps3d-auftrag";

export interface Ausfuehrer {
    readonly art: AusfuehrerArt;
    /** Startet den Auftrag; das Versprechen erfüllt sich mit dem Exitcode, sobald der Prozess endet (`null`: Signal, kein Start). */
    start(umgebung: WarteschlangeUmgebung, id: number, kind: string): Promise<number | null>;
    /** Räumt die Tafel der Umgebung auf (abgelaufene Leases einsammeln, Aufbewahrung). */
    pflege(umgebung: WarteschlangeUmgebung): Promise<number | null>;
    /** Der Dirigent wird beendet: `lokal` löst die Kinder ab und wartet auf sie, `sudo` lässt alles laufen. */
    beenden(): Promise<void>;
}

export interface Befehl {
    command: string;
    args: string[];
}

export type Aufgabe = { id: number; kind: string } | "pflege";

/** `auftrag-cli` neben diesem Verzeichnis, mit derselben Endung wie diese Datei. */
const AUFTRAG_CLI = fileURLToPath(new URL(`../auftrag-cli${extname(fileURLToPath(import.meta.url))}`, import.meta.url));

export function lokalerBefehl(aufgabe: Aufgabe): Befehl {
    return {
        command: process.execPath,
        args:
            aufgabe === "pflege"
                ? [...vererbteLader(), AUFTRAG_CLI, "--pflege"]
                : [...vererbteLader(), AUFTRAG_CLI, "--job", String(aufgabe.id), "--art", aufgabe.kind],
    };
}

export function sudoBefehl(umgebung: WarteschlangeUmgebung, aufgabe: Aufgabe): Befehl {
    return {
        command: "sudo",
        args: [
            "-n",
            AUFTRAG_WRAPPER,
            umgebung,
            ...(aufgabe === "pflege" ? ["--pflege"] : [String(aufgabe.id), aufgabe.kind]),
        ],
    };
}

/** Startet einen Prozess und erfüllt sich mit seinem Exitcode; ein Start, der scheitert, ist `null`. Ausgaben gehen ins Journal. */
function laufen(befehl: Befehl, env: NodeJS.ProcessEnv, kinder: Set<ChildProcess>): Promise<number | null> {
    return new Promise((resolve) => {
        let proc: ChildProcess;
        try {
            proc = spawn(befehl.command, befehl.args, { stdio: ["ignore", "inherit", "inherit"], env });
        } catch {
            resolve(null);
            return;
        }
        kinder.add(proc);
        let fertig = false;
        const ende = (code: number | null): void => {
            if (fertig) return;
            fertig = true;
            kinder.delete(proc);
            resolve(code);
        };
        proc.on("exit", (code) => ende(code));
        proc.on("error", () => ende(null));
    });
}

export interface LokalOptionen {
    /**
     * Zusätzliche Umgebung je Umgebung des Auftrags. Mit genau einer Umgebung (der Regelfall) leer: Das Kind erbt `DATABASE_URL`
     * und `JOBS_DATABASE_URL` des Dirigenten. Mit `DIRIGENT_UMGEBUNGEN` setzt `worker-cli.ts` dort `AVESMAPS_ENV` und die Verbindung.
     */
    umgebungEnv?: (umgebung: WarteschlangeUmgebung) => Readonly<Record<string, string>>;
}

export function lokalerAusfuehrer(options: LokalOptionen = {}): Ausfuehrer {
    const kinder = new Set<ChildProcess>();
    const env = (umgebung: WarteschlangeUmgebung): NodeJS.ProcessEnv => ({
        ...process.env,
        ...options.umgebungEnv?.(umgebung),
    });
    // Ein Release ohne `auftrag-cli` kann nichts ausführen: Exit 3 wie beim Wrapper, statt eines Absturzes von `node` (Exit 1).
    const fehlt = (): Promise<number | null> | null =>
        existsSync(AUFTRAG_CLI) ? null : Promise.resolve(AUFTRAG_EXIT.ausfuehrungFehlt);
    return {
        art: "lokal",
        start: (umgebung, id, kind) => fehlt() ?? laufen(lokalerBefehl({ id, kind }), env(umgebung), kinder),
        pflege: (umgebung) => fehlt() ?? laufen(lokalerBefehl("pflege"), env(umgebung), kinder),
        beenden: async () => {
            const offen = [...kinder].map(
                (proc) =>
                    new Promise<void>((resolve) => {
                        if (proc.exitCode !== null || proc.signalCode !== null) resolve();
                        else proc.once("exit", () => resolve());
                    }),
            );
            for (const proc of kinder) proc.kill("SIGTERM");
            await Promise.all(offen);
        },
    };
}

/**
 * 🪤 Die Umgebung des `sudo`-Aufrufs ist bewusst knapp: Die Verbindungen der Leserolle (`DIRIGENT_DB_*`) gehören nicht in den
 * Wrapper, er liest die `.env` seiner Umgebung selbst (und `sudo` setzt die Umgebung ohnehin zurück).
 */
export function sudoAusfuehrer(): Ausfuehrer {
    const kinder = new Set<ChildProcess>();
    const env: NodeJS.ProcessEnv = { PATH: process.env["PATH"] ?? "/usr/sbin:/usr/bin:/sbin:/bin", LANG: "C.UTF-8" };
    return {
        art: "sudo",
        start: (umgebung, id, kind) => laufen(sudoBefehl(umgebung, { id, kind }), env, kinder),
        pflege: (umgebung) => laufen(sudoBefehl(umgebung, "pflege"), env, kinder),
        // 🔴 Nichts beenden: Die Aufträge laufen in Claudios Scope weiter, ein Neustart des Dirigenten bricht keinen ab.
        beenden: () => Promise.resolve(),
    };
}
