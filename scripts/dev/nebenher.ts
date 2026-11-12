// Ein Prozess neben den synchronen Schritten eines Laufs (WI-0224: der Datenbank-Durchgang von `vor-dem-push` läuft neben den anderen
// Durchgängen, wenn der Arbeitsspeicher reicht).
//
// 🪤 Die synchronen Schritte (`spawnSync`) blockieren die Ereignisschleife. Eine Pipe zum Nebenprozess liefe voll (64 KB), und er stünde.
// Darum geht seine Ausgabe in eine Datei, die erst gelesen wird, wenn er fertig ist. 🪤 Abgebrochen wird der ganze Baum: Vitest startet
// Arbeitsprozesse, ein `kill` des Elternprozesses ließe sie stehen (Windows: `taskkill /T /F`, Linux: die Prozessgruppe, dafür startet der Prozess `detached`).
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface NebenherErgebnis {
    /** Der Exit-Status; `null`, wenn der Prozess durch ein Signal oder den Abbruch endete. */
    readonly status: number | null;
    /** Stdout und stderr zusammen, in der Reihenfolge der Ausgabe. */
    readonly text: string;
    readonly dauerSekunden: number;
}

export interface NebenherLauf {
    readonly fertig: Promise<NebenherErgebnis>;
    /** Beendet den Prozess samt Kindern; harmlos, wenn er schon fertig ist. */
    abbrechen(): void;
}

/**
 * Beendet einen Prozess samt Kindern. Windows: `taskkill /T /F`. Linux: die ganze Prozessgruppe (`-pid`), die `starteNebenher` dem Prozess mit
 * `detached` gibt; ein `kill` des Elternprozesses allein ließe die Kinder an `init` hängen und weiterlaufen (Prüfung nach dem Push auf dem VPS,
 * 2026-10-18). Fehlt die Gruppe, bleibt der einzelne Prozess als Rückfall.
 */
export function beendeBaum(pid: number | undefined): void {
    if (pid === undefined) return;
    if (process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
        return;
    }
    for (const ziel of [-pid, pid]) {
        try {
            process.kill(ziel, "SIGKILL");
            return;
        } catch {
            // keine Gruppe oder schon beendet: der nächste Versuch
        }
    }
}

/** Startet `programm` mit `args` neben dem Aufrufer; die Ausgabe wartet in einer Datei auf das Ende. */
export function starteNebenher(optionen: {
    readonly programm: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: NodeJS.ProcessEnv;
}): NebenherLauf {
    const ordner = mkdtempSync(join(tmpdir(), "avesmaps3d-nebenher-"));
    const ausgabe = join(ordner, "ausgabe.txt");
    const datei = openSync(ausgabe, "w");
    const start = Date.now();
    const kind = spawn(optionen.programm, [...optionen.args], {
        cwd: optionen.cwd,
        env: optionen.env,
        stdio: ["ignore", datei, datei],
        windowsHide: true,
        // Linux: eigene Prozessgruppe, damit `beendeBaum` den ganzen Baum trifft. Ohne `unref()`: `exit` und `fertig` bleiben.
        detached: process.platform !== "win32",
    });
    closeSync(datei);
    const fertig = new Promise<NebenherErgebnis>((erfuellt) => {
        let gemeldet = false;
        const ende = (status: number | null): void => {
            if (gemeldet) return;
            gemeldet = true;
            let text = "";
            // Das Ende des Prozesses: der letzte Schreibzugriff auf die Ausgabe. Das Ereignis `exit` kommt erst an, wenn der Aufrufer die Schleife freigibt
            // (die synchronen Schritte laufen Minuten): `Date.now()` hier zeigte 440 s für einen Prozess, der nach einer Minute fertig war.
            let ende = Date.now();
            try {
                text = readFileSync(ausgabe, "utf8");
                if (text.length > 0) ende = Math.min(ende, statSync(ausgabe).mtimeMs);
            } catch {
                // keine Ausgabe gelesen: der Status entscheidet
            }
            try {
                rmSync(ordner, { recursive: true, force: true });
            } catch {
                // ein Rest im Temp-Ordner ist harmlos
            }
            erfuellt({ status, text, dauerSekunden: Math.max(0, Math.round((ende - start) / 1000)) });
        };
        kind.once("exit", (status) => ende(status));
        kind.once("error", () => ende(1));
    });
    return {
        fertig,
        abbrechen: () => {
            if (kind.exitCode === null && kind.signalCode === null) beendeBaum(kind.pid);
        },
    };
}
