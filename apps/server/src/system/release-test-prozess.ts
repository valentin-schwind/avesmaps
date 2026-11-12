import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Ein Prozess, der den Server überlebt (Release-Test, WI-0248 L). Eigene Datei, nur Bordmittel von Node: Ein Test startet sie in einem eigenen
 * Prozess, beendet diesen hart und prüft, dass das Kind weiterlebt.
 *
 * 🔴 **Warum `detached`.** Unter Windows legt Node jedes Kind, das nicht abgelöst ist, in einen Job des Elternprozesses, der beim Ende des Elternprozesses
 * alle seine Mitglieder beendet. Der Server läuft lokal unter `node --watch` und wird bei jeder Änderung einer beobachteten Datei hart neu gestartet
 * (gemessen: rund hundertmal an einem Arbeitstag, auch ohne eine Änderung am Inhalt: ein Durchlauf des Betriebssystems über den Baum genügt). Ein
 * nicht abgelöster Starter starb mit, samt Testpaket-Bau, ohne eine Zeile zu hinterlassen. Abgelöst (`detached`, `unref`, eigene Prozessgruppe, kein
 * Pipe-Erbe, Ausgabe in eine Datei) überlebt er den Server, den Neustart und den Absturz des Servers.
 */

export interface AbgeloestesEnde {
    /** Der Exitcode; `null`, wenn der Prozess durch ein Signal endete. */
    readonly code: number | null;
    /** Das Ende der Ausgabedatei (höchstens 64 KiB), soweit lesbar; sonst leer. */
    readonly ausgabe: string;
}

export interface AbgeloesterStart {
    /** Die Prozessnummer; `undefined`, wenn der Prozess nicht startete (dann lehnt `ende` ab). */
    readonly pid: number | undefined;
    /** Wird erfüllt, wenn der Prozess endet, solange der Server dann noch lebt; lehnt ab, wenn er sich nicht starten ließ. Hängt den Server nicht fest. */
    readonly ende: Promise<AbgeloestesEnde>;
}

const AUSGABE_ENDE = 64 * 1024;

function leseEnde(datei: string): string {
    try {
        const inhalt = readFileSync(datei);
        return inhalt.subarray(Math.max(0, inhalt.length - AUSGABE_ENDE)).toString("utf8");
    } catch {
        return "";
    }
}

/**
 * Startet `programm argumente…` als eigenen, vom Server abgelösten Prozess. Stdout und Stderr gehen in `ausgabeDatei` (neu angelegt), Stdin ist zu.
 * `env` ist die ganze Umgebung des Kindes, nie die des Servers. Wirft, wenn die Ausgabedatei nicht angelegt werden kann; ein Prozess, der sich
 * nicht starten lässt, lehnt `ende` ab. Der Aufrufer muss `ende` immer behandeln (ein liegen gelassenes Ablehnen beendet den Server).
 */
export function starteAbgeloest(
    programm: string,
    argumente: readonly string[],
    optionen: { readonly ausgabeDatei: string; readonly env: NodeJS.ProcessEnv },
): AbgeloesterStart {
    mkdirSync(dirname(optionen.ausgabeDatei), { recursive: true });
    const ausgabe = openSync(optionen.ausgabeDatei, "w");
    try {
        const kind = spawn(programm, [...argumente], {
            detached: true,
            stdio: ["ignore", ausgabe, ausgabe],
            env: optionen.env,
            windowsHide: true,
        });
        const ende = new Promise<AbgeloestesEnde>((fertig, fehler) => {
            kind.once("error", fehler);
            kind.once("exit", (code) => {
                fertig({ code, ausgabe: leseEnde(optionen.ausgabeDatei) });
            });
        });
        // Der Server wartet nicht auf das Kind: Er kann enden, das Kind läuft weiter.
        kind.unref();
        return { pid: kind.pid, ende };
    } finally {
        // Das Kind hat seine eigene Kopie des Handles; unsere schließen, damit die Datei nicht an diesem Prozess hängt.
        closeSync(ausgabe);
    }
}
