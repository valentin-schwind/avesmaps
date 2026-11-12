/**
 * Der Handover-Listener: weckt die eigene Agentensession, wenn der andere Agent etwas gepusht hat.
 *
 *   node scripts/coordination/watch-handovers.ts --role claudia
 *   node scripts/coordination/watch-handovers.ts --role claudio --interval 15
 *
 * Jede ausgegebene Zeile ist ein Ereignis für die Session, die diesen Prozess gestartet hat. Was
 * die Zeile bedeutet und warum sie keinen Inhalt trägt, steht in `handover-protocol.ts`.
 *
 * 🔴 SESSION-SCOPED, und das ist keine Empfehlung, sondern die Bauart. Es gibt keinen Dienst, keine
 * geplante Aufgabe, keinen Autostart. Der Prozess lebt, solange die Session ihn am Leben hält, und
 * stirbt mit ihr — siehe `watchParent()`. Nach dem Ende der Session passiert nichts mehr.
 *
 * 🔴 NUR `origin/master` IST WAHRHEIT. Der Listener liest ausschliesslich den gepushten Stand. Ein
 * lokal geänderter, nicht committeter oder nicht gepushter Handover loest nichts aus — sonst
 * koennte ein halbfertiger Entwurf auf der eigenen Platte die Gegenseite in Bewegung setzen.
 *
 * 🔴 ER FUEHRT NICHTS AUS. Er liest Dateien und gibt Zeiger aus. Kein Text aus einem Handover
 * erreicht jemals eine Shell: Git wird ausschliesslich mit festen Argumentlisten und ohne Shell
 * aufgerufen, und die Ereigniszeile besteht aus Werten einer geschlossenen Menge.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
    ROLES,
    authoredByRole,
    concernsRole,
    dedupeKey,
    defaultStateFile,
    formatEvent,
    localTimestamp,
    parseHandover,
    type Handover,
    type Role,
} from "./handover-protocol.ts";

const HANDOVER_PREFIX = "project-control/handovers/";

const { values } = parseArgs({
    options: {
        role: { type: "string" },
        interval: { type: "string", default: "12" },
        remote: { type: "string", default: "origin" },
        branch: { type: "string", default: "master" },
        once: { type: "boolean", default: false },
        repo: { type: "string" },
        state: { type: "string" },
    },
});

// Voreingestellt ist dieses Repository. `--repo` gibt es, damit der Listener gegen ein
// Wegwerf-Repository geprüft werden kann, ohne dafür nach `origin/master` zu pushen.
const repositoryRoot = values.repo ?? fileURLToPath(new URL("../../", import.meta.url));

if (!values.role || !(ROLES as readonly string[]).includes(values.role)) {
    console.error(`usage: --role <${ROLES.join("|")}> [--interval <sekunden>] [--once]`);
    process.exit(1);
}
const role = values.role as Role;
const intervalMs = Math.max(5, Number.parseInt(values.interval ?? "12", 10) || 12) * 1000;

/**
 * Git ohne Shell. Die Argumente sind immer eine feste Liste, nie eine zusammengebaute Zeile.
 *
 * 💣 Das ist die Stelle, an der ein Listener gefährlich würde. Ein Dateiname oder Betreff aus dem
 * Repository, der in eine Shell-Zeile geriete, wäre Codeausführung aus Repositoriumsinhalt. Mit
 * `shell: false` und Argumentlisten gibt es diese Möglichkeit nicht.
 */
function git(args: string[], { allowFailure = false }: { allowFailure?: boolean } = {}): string | null {
    const result = spawnSync("git", args, {
        cwd: repositoryRoot,
        shell: false,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        // 💣 Ohne Zeitgrenze überlebt der Listener die Session. `spawnSync` blockiert den
        // Event-Loop, also läuft auch `watchParent()` nicht mehr; hängt das Netz (ein ssh ohne
        // Antwort), wartet git unbegrenzt, und der Prozess lebt samt hängendem Kind weiter,
        // nachdem die Session zu ist. Von Claudio an einem echten Prozessbaum gemessen: zwölf
        // Sekunden nach dem Tod des Elternprozesses noch da. Genau der Fall, in dem das Versprechen
        // „endet mit der Session" am meisten zählt - Netz weg, Session zu.
        timeout: 15_000,
        killSignal: "SIGKILL",
    });
    if (result.status !== 0 || result.error) {
        if (allowFailure) {
            return null;
        }
        throw new Error(`git ${String(args[0])} fehlgeschlagen: ${(result.stderr || "").trim().slice(0, 200)}`);
    }
    return result.stdout;
}

/** Der Kopf von `origin/master` beim Remote - ein Netzaufruf ohne Objekttransfer. */
function remoteHead(): string | null {
    const output = git(["ls-remote", values.remote as string, `refs/heads/${String(values.branch)}`], {
        allowFailure: true,
    });
    const match = output && /^([0-9a-f]{40})\s/.exec(output);
    return match ? (match[1] as string) : null;
}

/** Holt den Stand, ohne den Arbeitsbaum anzufassen. Kein Checkout, kein Merge, kein Rebase. */
function fetchRemote(): void {
    git(["fetch", "--quiet", values.remote as string, values.branch as string], { allowFailure: true });
}

/**
 * Liegt dieser Commit wirklich lokal?
 *
 * 💣 Die Frage entscheidet, ob eine Übergabe ankommt oder spurlos verschwindet. Schlägt ein
 * einziger `fetch` fehl, sind die Objekte nicht da: `git show` und `git diff` scheitern, das gilt
 * als „gelöscht oder unlesbar" und wird still übersprungen — und wenn der Stand danach trotzdem
 * vorrückt, wird dieser Handover NIE gemeldet, auch bei späteren Pushes nicht. Claudio hat es
 * gemessen: ein simulierter Fetch-Fehler, null Ereignisse, auch nach einem zweiten Push.
 *
 * Ein Listener, der still nichts meldet, sieht aus wie ein ruhiger Tag. Deshalb rückt der Stand nur
 * vor, wenn der Commit da ist.
 */
function commitExists(commit: string): boolean {
    return git(["cat-file", "-e", `${commit}^{commit}`], { allowFailure: true }) !== null;
}

/** Die Handover-Dateien, die zwischen zwei Ständen geändert wurden. */
function changedHandovers(fromCommit: string | null, toCommit: string): string[] {
    const output = fromCommit
        ? git(["diff", "--name-only", `${fromCommit}..${toCommit}`, "--", HANDOVER_PREFIX], { allowFailure: true })
        : git(["ls-tree", "-r", "--name-only", toCommit, "--", HANDOVER_PREFIX], { allowFailure: true });
    if (!output) {
        return [];
    }
    return output
        .split(/\r?\n/)
        .filter((line) => line.startsWith(HANDOVER_PREFIX) && line.endsWith(".md"))
        .filter((line) => !line.endsWith("README.md"));
}

/** Liest eine Datei aus dem gepushten Stand - nicht von der Platte. */
function readAtCommit(commit: string, path: string): string | null {
    return git(["show", `${commit}:${path}`], { allowFailure: true });
}

/**
 * Wer hat diese Datei zuletzt geändert?
 *
 * Nicht der Kopf der Datei, sondern die Urheberschaft der Änderung. Gefragt wird nach dem
 * betrachteten Bereich, damit die Antwort zu dem passt, was gerade gemeldet werden soll.
 */
function lastAuthorOf(fromCommit: string | null, toCommit: string, path: string): string {
    const range = fromCommit ? `${fromCommit}..${toCommit}` : toCommit;
    const output = git(["log", "-1", "--format=%an <%ae>", range, "--", path], { allowFailure: true });
    return (output ?? "").trim();
}

/**
 * Der zuletzt verarbeitete Stand, damit ein Listenerwechsel keine Luecke reisst.
 *
 * Die Datei liegt AUSSERHALB des Repositoriums: sie ist fluechtiger Sitzungszustand, kein Inhalt
 * (Kap. 10.150). Fehlt sie oder ist sie unbrauchbar, faellt der Start auf den Bestandsscan zurueck -
 * schlimmstenfalls eine Meldung zu wenig, nie eine falsche.
 */
const stateFile = values.state ?? defaultStateFile(role, process.cwd(), tmpdir());

function readState(): string | null {
    try {
        const value = readFileSync(stateFile, "utf8").trim();
        return /^[0-9a-f]{40}$/.test(value) ? value : null;
    } catch {
        return null;
    }
}

function writeState(commit: string): void {
    try {
        writeFileSync(stateFile, `${commit}\n`, "utf8");
    } catch {
        // Ein nicht schreibbarer Zustand kostet beim naechsten Start eine Meldung, nicht mehr.
    }
}

const reported = new Set<string>();

/**
 * Ereignisse ausgeben, aber gedeckelt.
 *
 * 🪤 Ein Push mit fünfzig geänderten Handovers erzeugt sonst fünfzig Ereignisse, und die
 * Agentenumgebung beendet einen zu lauten Monitor **still**. Ein Listener, der wegen Übereifer
 * abgeschaltet wird, meldet ab da gar nichts mehr - und niemand merkt es. Lieber zehn Zeilen je
 * Minute und eine Sammelzeile, die sagt, dass etwas fehlt. Die Sammelzeile trägt keine Pfade.
 */
const EVENTS_PER_MINUTE = 10;
let windowStart = Date.now();
let emittedInWindow = 0;
let withheld = 0;

function emitEvent(line: string): void {
    if (Date.now() - windowStart >= 60_000) {
        windowStart = Date.now();
        emittedInWindow = 0;
    }
    if (emittedInWindow >= EVENTS_PER_MINUTE) {
        withheld += 1;
        return;
    }
    emittedInWindow += 1;
    process.stdout.write(`${line}\n`);
}

function flushWithheld(): void {
    if (withheld === 0) {
        return;
    }
    process.stdout.write(`[AVESMAPS3D HANDOVER] ${String(withheld)} weitere Ereignisse zurueckgehalten\n`);
    withheld = 0;
}

function scan(previousCommit: string | null, currentCommit: string, { startup = false } = {}): void {
    for (const path of changedHandovers(previousCommit, currentCommit)) {
        const markdown = readAtCommit(currentCommit, path);
        if (!markdown) {
            continue; // geloescht oder unlesbar - kein Ereignis, aber auch kein Abbruch
        }
        let handover: Handover;
        try {
            handover = parseHandover(markdown);
        } catch {
            continue;
        }
        if (!concernsRole(handover, role, { startup })) {
            continue;
        }
        // 💣 Der Kopf sagt „von ihm an mich" auch dann noch, wenn ICH die Datei zuletzt angefasst
        // habe - beim Abschluss eines fremden Handovers auf `DONE` ist das der Normalfall. Ohne
        // diese Prüfung meldet der eigene Push die eigene Arbeit zurück.
        if (authoredByRole(lastAuthorOf(previousCommit, currentCommit, path), role)) {
            continue;
        }
        const key = dedupeKey(path, handover, currentCommit);
        if (reported.has(key)) {
            continue;
        }
        reported.add(key);
        try {
            // 🪤 stdout, nicht `console.log`: stdout ist hier kein Log, sondern der EREIGNISKANAL
            // zur Session. `console.warn`/`console.error` gehen nach stderr und wecken niemanden -
            // was den Listener still und nutzlos machen wuerde.
            emitEvent(formatEvent(path, handover, currentCommit.slice(0, 12), localTimestamp()));
        } catch (error) {
            // Ein Pfad oder Commit ausserhalb des erwarteten Musters wird NICHT ausgegeben. Lieber
            // ein verschwiegenes Ereignis als eine Zeile, deren Form niemand geprueft hat.
            console.error(`verworfen: ${error instanceof Error ? error.message : "unbekannt"}`);
        }
    }
    flushWithheld();
}

/**
 * Bindet die Lebensdauer an die Session.
 *
 * 🪤 Auf Windows gibt es kein `getppid`-Signal und kein Prozessgruppen-Kill wie unter POSIX. Ein
 * verwaister Listener liefe dort weiter, nachdem die Session zu ist - genau das, was hier
 * ausgeschlossen sein soll. Deshalb wird der Elternprozess aktiv beobachtet: verschwindet er,
 * endet dieser Prozess. `process.kill(pid, 0)` sendet kein Signal, es prueft nur die Existenz.
 */
function watchParent(): void {
    const parent = process.ppid;
    if (!parent) {
        return;
    }
    setInterval(() => {
        try {
            process.kill(parent, 0);
        } catch {
            console.error("Elternprozess beendet - Listener endet mit ihm");
            process.exit(0);
        }
    }, 2000).unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(signal, () => process.exit(0));
}
watchParent();

let seenCommit: string | null = null;
try {
    fetchRemote();
    const head = remoteHead();
    if (!head) {
        console.error(`kein Zugriff auf ${String(values.remote)}/${String(values.branch)}`);
        process.exit(1);
    }
    // 💣 Erst pruefen, ob die Objekte wirklich da sind. Ein stillschweigend fehlgeschlagener Fetch
    // ergaebe sonst einen LEEREN Startbestand, der aussieht wie „nichts offen".
    if (!commitExists(head)) {
        console.error(`Start fehlgeschlagen: ${head.slice(0, 12)} liegt nicht lokal vor (fetch?)`);
        process.exit(1);
    }

    const resumeFrom = readState();
    if (resumeFrom && resumeFrom !== head && commitExists(resumeFrom)) {
        // 💣 Die LUECKE zwischen zwei Listenern. Ein Monitor laeuft nach dreissig Minuten ab und
        // wird neu gestartet; was dazwischen gepusht wurde, faellt sonst durch: der Startbestand
        // meldet nur Offenes, und die Antwort des anderen Agenten ist ein `DONE`. Genau die
        // Nachricht, auf die man wartet, waere die, die man nie bekommt.
        scan(resumeFrom, head);
    } else {
        // Ohne verwertbaren Stand zaehlt der volle Bestand, aber nur das wirklich OFFENE: ein
        // `ACTION_REQUIRED` von gestern ist beim Aufwachen genauso offen wie ein frisches, ein
        // `DONE` von gestern ist es nicht.
        scan(null, head, { startup: true });
    }
    seenCommit = head;
    writeState(head);
} catch (error) {
    console.error(`Start fehlgeschlagen: ${error instanceof Error ? error.message : "unbekannt"}`);
    process.exit(1);
}

if (values.once) {
    process.exit(0);
}

setInterval(() => {
    try {
        const head = remoteHead();
        if (!head || head === seenCommit) {
            return; // Der Normalfall: nichts Neues, kein Objekttransfer, kein Ereignis.
        }
        fetchRemote();
        // 💣 Nur vorruecken, wenn der Stand wirklich angekommen ist. Sonst verschluckt EIN
        // fehlgeschlagener Fetch die Uebergabe dauerhaft: die Objekte fehlen, jede Datei gilt als
        // unlesbar, und mit dem vorgerueckten Stand wird sie nie wieder betrachtet.
        if (!commitExists(head)) {
            console.error(`Runde uebersprungen: ${head.slice(0, 12)} nicht lokal (fetch fehlgeschlagen?)`);
            return;
        }
        scan(seenCommit, head);
        seenCommit = head;
        writeState(head);
    } catch (error) {
        // Ein Netzaussetzer darf den Listener nicht beenden - er darf nur diese Runde kosten.
        console.error(`Runde uebersprungen: ${error instanceof Error ? error.message : "unbekannt"}`);
    }
}, intervalMs);
