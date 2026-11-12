import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
    authoredByRole,
    concernsRole,
    OPEN_STATUSES,
    dedupeKey,
    defaultStateFile,
    formatEvent,
    localTimestamp,
    parseHandover,
    type Handover,
} from "../../../scripts/coordination/handover-protocol.ts";

/**
 * Die Agentenkoordination (Kapitel 2.11).
 *
 * Geprüft wird das, was schiefgehen kann, wenn zwei Agenten sich gegenseitig aufwecken: der
 * falsche wird geweckt, dasselbe wird endlos gemeldet, ein Betreibergate wird übersehen, oder ein
 * Prozess überlebt die Session, die ihn gestartet hat.
 */

const watcher = fileURLToPath(new URL("../../../scripts/coordination/watch-handovers.ts", import.meta.url));

/**
 * Beendet den Listener und wartet auf sein Ende. 🪤 Unter Windows hält ein noch laufender Prozess (oder sein `git fetch`) den Arbeitsordner
 * offen; ohne Warten scheiterte das Aufräumen unter Last mit `EBUSY: resource busy or locked, rmdir …\listener` (Hauptorchestrierung 2026-10-19).
 */
async function beende(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ende = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    child.kill();
    await Promise.race([ende, new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}

/** Räumt einen Probeordner, mit Wiederholung: Ein Kindprozess von `git` kann ihn unter Windows einen Moment länger halten. */
const raeume = (ordner: string): Promise<void> =>
    rm(ordner, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });

function handover(fields: Record<string, string>, body = "## Kontext\n\nEgal.\n"): string {
    const rows = Object.entries(fields)
        .map(([key, value]) => `| ${key} | ${value} |`)
        .join("\n");
    return `# Betreff\n\n| Feld | Wert |\n|---|---|\n${rows}\n\n${body}`;
}

describe("Handover lesen", () => {
    it("liest Rollen, Status und Betreibergate aus der Kopftabelle", () => {
        const parsed = parseHandover(
            handover({ from: "claudia", to: "claudio", status: "ACTION_REQUIRED", operator_decision_required: "no" }),
        );
        expect(parsed).toMatchObject({
            from: "claudia",
            to: "claudio",
            status: "ACTION_REQUIRED",
            operatorGate: false,
        });
        expect(parsed.valid).toBe(true);
    });

    it("kommt mit der gewachsenen Schreibweise zurecht", () => {
        // In den echten Dateien steht regelmäßig `**ACTION_REQUIRED** (2026-09-21, zweite Fassung)`.
        const parsed = parseHandover(
            handover({
                from: "claudio",
                to: "claudia",
                status: "**ACTION_REQUIRED** (2026-09-21, zweite Fassung)",
                operator_decision_required: "no (Empfehlung A ist rollemodell-neutral)",
            }),
        );
        expect(parsed.status).toBe("ACTION_REQUIRED");
        expect(parsed.operatorGate).toBe(false);
    });

    it("💣 schließt das Betreibergate, wenn das Feld fehlt oder unklar ist", () => {
        // Ein fehlendes Feld heißt NICHT "nein, mach nur". Wer das umdreht, lässt einen Agenten
        // autonom arbeiten, weil jemand eine Zeile vergessen hat.
        for (const fields of [
            { from: "claudia", to: "claudio", status: "ACTION_REQUIRED" },
            { from: "claudia", to: "claudio", status: "ACTION_REQUIRED", operator_decision_required: "yes: Freigabe" },
            { from: "claudia", to: "claudio", status: "ACTION_REQUIRED", operator_decision_required: "" },
        ]) {
            expect(parseHandover(handover(fields)).operatorGate, JSON.stringify(fields)).toBe(true);
        }
    });

    it("🪤 liest nur den eigenen Kopf, nicht eine zitierte Tabelle im Fließtext", () => {
        // Handovers zitieren einander samt Kopftabelle. Wer die ganze Datei durchsucht, weckt den
        // Falschen - hier steht im Zitat `to | claudia`, gemeint ist aber claudio.
        const parsed = parseHandover(
            handover(
                { from: "claudia", to: "claudio", status: "ACTION_REQUIRED", operator_decision_required: "no" },
                "## Bezug\n\n| Feld | Wert |\n|---|---|\n| from | claudio |\n| to | claudia |\n| status | DONE |\n",
            ),
        );
        expect(parsed.to).toBe("claudio");
        expect(parsed.status).toBe("ACTION_REQUIRED");
    });

    it("verwirft eine Datei ohne brauchbaren Kopf, statt zu raten", () => {
        expect(parseHandover("# Nur Text\n\nKeine Tabelle.\n").valid).toBe(false);
        expect(parseHandover(handover({ from: "jemand", to: "claudio", status: "ACTION_REQUIRED" })).valid).toBe(false);
    });
});

describe("Stand des Listeners", () => {
    it("🔴 je Rolle und Arbeitskopie eine eigene Datei: der Neustart einer Sitzung setzt nie beim Stand einer anderen auf", () => {
        const eins = defaultStateFile("claudia", "C:/GIT/avesmaps3D/.claude/worktrees/eins", "T");
        const zwei = defaultStateFile("claudia", "C:/GIT/avesmaps3D/.claude/worktrees/zwei", "T");
        expect(eins).not.toBe(zwei);
        // Windows unterscheidet die Schreibweise nicht.
        expect(defaultStateFile("claudia", "C:/GIT/AVESMAPS3D/.claude/worktrees/eins", "T")).toBe(eins);
        expect(defaultStateFile("claudio", "C:/GIT/avesmaps3D/.claude/worktrees/eins", "T")).not.toBe(eins);
        expect(eins).toMatch(/avesmaps3d-handover-claudia-[0-9a-f]{12}\.state$/);
    });
});

describe("Rollenfilter", () => {
    const base: Omit<Handover, "status"> = { from: "claudia", to: "claudio", operatorGate: false, valid: true };

    it("weckt den Empfänger bei ACTION_REQUIRED, DONE, BLOCKED und INFO (Betreiber 2026-10-18)", () => {
        for (const status of ["ACTION_REQUIRED", "DONE", "BLOCKED", "INFO"]) {
            expect(concernsRole({ ...base, status }, "claudio"), status).toBe(true);
        }
    });

    it("🔴 ein INFO weckt nur im laufenden Betrieb, nicht beim Start", () => {
        expect(concernsRole({ ...base, status: "INFO" }, "claudio")).toBe(true);
        expect(concernsRole({ ...base, status: "INFO" }, "claudio", { startup: true })).toBe(false);
    });

    it("ein unbekanntes Statuswort weckt weiter niemanden", () => {
        expect(concernsRole({ ...base, status: "FYI" }, "claudio")).toBe(false);
    });

    it("weckt nicht den Absender", () => {
        expect(concernsRole({ ...base, status: "ACTION_REQUIRED" }, "claudia")).toBe(false);
    });

    it("🪤 weckt nicht bei einem Handover an sich selbst", () => {
        // Sonst weckt jeder eigene Push die eigene Session, und die beiden Listener schaukeln sich
        // gegenseitig hoch.
        const selfAddressed: Handover = {
            from: "claudio",
            to: "claudio",
            status: "ACTION_REQUIRED",
            operatorGate: false,
            valid: true,
        };
        expect(concernsRole(selfAddressed, "claudio")).toBe(false);
    });

    it("weckt auch mit gesetztem Betreibergate - aber der Hinweis sagt es", () => {
        // Der Empfänger SOLL davon erfahren; er darf nur nicht autonom entscheiden. Diese Trennung
        // steht im Ereignis (`operator_gate=yes`), nicht im Filter.
        const gated = { ...base, status: "ACTION_REQUIRED", operatorGate: true };
        expect(concernsRole(gated, "claudio")).toBe(true);
        expect(formatEvent("project-control/handovers/2026-09-21-x.md", gated, "abc1234", "t")).toContain(
            "operator_gate=yes",
        );
    });
});

describe("Statusauswertung", () => {
    it("💣 liest den Status nur am ANFANG des Feldes", () => {
        // Von Claudio am Bestand gefunden: `ANSWERED (Abschluss steht als DONE in Handover x)`
        // weckte als DONE, weil das Schluesselwort irgendwo im Text stand. Unsere eigenen Dateien
        // haben genau solche Statuszeilen.
        const gefaelscht = parseHandover(
            handover({ from: "claudio", to: "claudia", status: "ANSWERED (Abschluss steht als DONE in Handover x)" }),
        );
        expect(gefaelscht.status).toBeUndefined();
        expect(gefaelscht.valid).toBe(false);
    });

    it("liest weiterhin den Status mit Erläuterung dahinter", () => {
        expect(
            parseHandover(handover({ from: "claudio", to: "claudia", status: "**DONE** (2026-09-21)" })).status,
        ).toBe("DONE");
    });
});

describe("Startbestand", () => {
    const offen: Omit<Handover, "status"> = { from: "claudio", to: "claudia", operatorGate: false, valid: true };

    it("🪤 meldet beim Start nur wirklich Offenes, kein erledigtes DONE von gestern", () => {
        // Sonst beginnt jede Sitzung mit erledigten Meldungen - und ein Listener, dessen Zeilen man
        // überliest, ist so gut wie keiner.
        expect(concernsRole({ ...offen, status: "DONE" }, "claudia", { startup: true })).toBe(false);
        expect(concernsRole({ ...offen, status: "ACTION_REQUIRED" }, "claudia", { startup: true })).toBe(true);
        expect(concernsRole({ ...offen, status: "BLOCKED" }, "claudia", { startup: true })).toBe(true);
        expect(OPEN_STATUSES).not.toContain("DONE");
    });

    it("weckt im laufenden Betrieb weiterhin bei DONE", () => {
        // Dort ist es die Nachricht „du kannst weiterarbeiten".
        expect(concernsRole({ ...offen, status: "DONE" }, "claudia")).toBe(true);
    });
});

describe("Urheberschaft", () => {
    it("💣 erkennt die eigene Änderung an der Autorenzeile", () => {
        // Der Kopf einer Datei sagt „von ihm an mich" auch dann noch, wenn ICH sie zuletzt
        // geändert habe - beim Abschluss auf `DONE` ist das der Normalfall.
        expect(authoredByRole("Claudia <claudia@avesmaps3d.local>", "claudia")).toBe(true);
        expect(authoredByRole("Claudia <claudia@avesmaps3d.local>", "claudio")).toBe(false);
        expect(authoredByRole("Claudio <claudio@avesmaps3d.local>", "claudio")).toBe(true);
    });

    it("🪤 weckt bei unbekanntem Autor - fail-open", () => {
        // Committet der Betreiber selbst, ist das kein Grund, eine Übergabe zu verschlucken.
        expect(authoredByRole("", "claudia")).toBe(false);
        expect(authoredByRole("Valentin <mail@example.invalid>", "claudia")).toBe(false);
    });
});

describe("Deduplizierung", () => {
    const parsed: Handover = {
        from: "claudia",
        to: "claudio",
        status: "ACTION_REQUIRED",
        operatorGate: false,
        valid: true,
    };
    const path = "project-control/handovers/2026-09-21-x.md";

    it("meldet denselben Stand nicht erneut", () => {
        expect(dedupeKey(path, parsed, "abc1234")).toEqual(dedupeKey(path, parsed, "abc1234"));
    });

    it("meldet erneut, wenn der Status sich ändert", () => {
        const done = { ...parsed, status: "DONE" };
        expect(dedupeKey(path, done, "abc1234")).not.toEqual(dedupeKey(path, parsed, "abc1234"));
    });

    it("meldet erneut, wenn die Datei in einem neuen Commit geändert wurde", () => {
        expect(dedupeKey(path, parsed, "def5678")).not.toEqual(dedupeKey(path, parsed, "abc1234"));
    });
});

describe("Die Wakeup-Zeile", () => {
    const parsed: Handover = {
        from: "claudia",
        to: "claudio",
        status: "ACTION_REQUIRED",
        operatorGate: false,
        valid: true,
    };

    it("trägt Zeiger und keinen Inhalt", () => {
        const event = formatEvent(
            "project-control/handovers/2026-09-21-x.md",
            parsed,
            "abc1234",
            "2026-09-21T10:31:22+02:00",
        );
        expect(event).toBe(
            [
                "[AVESMAPS3D HANDOVER 2026-09-21T10:31:22+02:00]",
                "from=claudia",
                "to=claudio",
                "status=ACTION_REQUIRED",
                "operator_gate=no",
                "commit=abc1234",
                "path=project-control/handovers/2026-09-21-x.md",
            ].join("\n"),
        );
    });

    it("💣 weist einen Pfad außerhalb des Handover-Verzeichnisses ab", () => {
        // Der Pfad kommt aus dem Repository. Ohne diese Prüfung könnte ein Dateiname Zeilenumbrüche
        // oder fremden Text in die Ereigniszeile tragen - und die landet in einer Agentensession.
        for (const path of [
            "../../etc/passwd",
            "project-control/handovers/x.md\nfrom=jemand",
            "scripts/coordination/watch-handovers.ts",
        ]) {
            expect(() => formatEvent(path, parsed, "abc1234", "t"), path).toThrow();
        }
    });

    it("weist einen Commit ab, der keiner ist", () => {
        expect(() => formatEvent("project-control/handovers/x.md", parsed, "HEAD; rm -rf /", "t")).toThrow();
    });

    it("schreibt den Zeitstempel mit Zonenversatz", () => {
        expect(localTimestamp(new Date())).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });
});

describe("Der Listener als Prozess", () => {
    it("🔴 stirbt, wenn sein Elternprozess verschwindet", async () => {
        // Die zentrale Zusicherung des ganzen Entwurfs: kein Dienst, der die Session überlebt.
        // Geprüft wird an einem echten Prozessbaum, nicht an einer Absichtserklärung.
        const parent = spawn(
            process.execPath,
            [
                "-e",
                `const { spawn } = require("node:child_process");
                 const child = spawn(process.execPath, [${JSON.stringify(watcher)}, "--role", "claudia", "--interval", "5"],
                     { stdio: "ignore", detached: false });
                 process.stdout.write(String(child.pid));
                 setTimeout(() => {}, 60000);`,
            ],
            { stdio: ["ignore", "pipe", "ignore"] },
        );

        const childPid = await new Promise<number>((resolve, reject) => {
            let buffer = "";
            parent.stdout.on("data", (chunk: Buffer) => {
                buffer += chunk.toString();
                if (buffer.length > 0) {
                    resolve(Number.parseInt(buffer, 10));
                }
            });
            parent.on("error", reject);
            setTimeout(() => reject(new Error("kein Kindprozess gemeldet")), 15_000);
        });
        expect(Number.isInteger(childPid)).toBe(true);

        const alive = (pid: number): boolean => {
            try {
                process.kill(pid, 0);
                return true;
            } catch {
                return false;
            }
        };
        expect(alive(childPid), "Listener läuft, solange der Elternprozess lebt").toBe(true);

        parent.kill();

        // Der Listener prüft alle zwei Sekunden; großzügig gewartet, dann muss er weg sein.
        const deadline = Date.now() + 20_000;
        while (alive(childPid) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
        expect(alive(childPid), "Listener ist mit dem Elternprozess gestorben").toBe(false);
    }, 45_000);

    it("🔴 meldet einen Handover, der erst WÄHREND des Laufs gepusht wird - und nicht die eigene Antwort darauf", async () => {
        // Die eigentliche Zusage des Entwurfs: nicht der Startbestand, sondern die laufende
        // Erkennung. Geprüft an einem echten Wegwerf-Repository mit Remote, nicht an `origin`.
        const root = await mkdtemp(join(tmpdir(), "coord-live-"));
        const bare = join(root, "bare.git");
        const writer = join(root, "writer");
        const listener = join(root, "listener");
        const relativePath = "project-control/handovers/2026-09-21-probe.md";

        const run = (cwd: string, ...args: string[]): void => {
            const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
            if (result.status !== 0) {
                throw new Error(`git ${args.join(" ")}: ${String(result.stderr)}`);
            }
        };
        const commitAs = async (author: string, markdown: string, message: string): Promise<void> => {
            const file = join(writer, relativePath);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(file, markdown, "utf8");
            run(writer, "add", "-A");
            run(
                writer,
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@t.invalid",
                "commit",
                `--author=${author}`,
                "-m",
                message,
            );
            run(writer, "push", "--quiet", "origin", "master");
        };

        try {
            run(root, "init", "--quiet", "--bare", "--initial-branch=master", bare);
            run(root, "clone", "--quiet", bare, writer);
            await writeFile(join(writer, "README.md"), "Probe" + String.fromCharCode(10), "utf8");
            run(writer, "add", "-A");
            run(writer, "-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-m", "Start");
            run(writer, "push", "--quiet", "origin", "master");
            run(root, "clone", "--quiet", bare, listener);

            const child = spawn(
                process.execPath,
                [watcher, "--role", "claudia", "--repo", listener, "--remote", "origin", "--interval", "5"],
                { stdio: ["ignore", "pipe", "ignore"] },
            );
            let output = "";
            child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
            const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

            try {
                await settle(3000);
                expect(output, "vor dem Push gibt es nichts zu melden").toBe("");

                // Claudio schreibt und pusht - das muss ankommen.
                await commitAs(
                    "Claudio <claudio@avesmaps3d.local>",
                    handover({
                        from: "claudio",
                        to: "claudia",
                        status: "ACTION_REQUIRED",
                        operator_decision_required: "no",
                    }),
                    "Handover an Claudia",
                );
                for (let waited = 0; waited < 30_000 && !output.includes("2026-09-21-probe.md"); waited += 500) {
                    await settle(500);
                }
                expect(output, "live gepushter Handover wurde gemeldet").toContain("path=" + relativePath);
                expect(output).toContain("from=claudio");
                const nachErstemEreignis = output;

                // 💣 Und jetzt schliesst CLAUDIA ihn ab. Der Kopf sagt weiterhin „von claudio an
                // claudia"; ohne die Urheberprüfung meldet der eigene Push die eigene Arbeit zurück.
                await commitAs(
                    "Claudia <claudia@avesmaps3d.local>",
                    handover({
                        from: "claudio",
                        to: "claudia",
                        status: "DONE",
                        operator_decision_required: "no",
                    }),
                    "Abschluss durch Claudia",
                );
                await settle(12_000);
                expect(output, "der eigene Abschluss weckt nicht").toBe(nachErstemEreignis);
            } finally {
                await beende(child);
            }
        } finally {
            await raeume(root);
        }
    }, 90_000);

    it("🔴 holt nach, was zwischen zwei Listenern gepusht wurde", async () => {
        // 💣 Die Lücke, die ich mir selbst gebaut hatte: ein Monitor läuft nach dreissig Minuten ab
        // und wird neu gestartet. Der Startbestand meldet nur OFFENES - und die Antwort des anderen
        // Agenten ist ein `DONE`. Genau die Nachricht, auf die man wartet, wäre die, die man nie
        // bekommt. Der gemerkte Stand schliesst die Lücke.
        const root = await mkdtemp(join(tmpdir(), "coord-gap-"));
        const bare = join(root, "bare.git");
        const writer = join(root, "writer");
        const listener = join(root, "listener");
        const stateFile = join(root, "stand.txt");
        const relativePath = "project-control/handovers/2026-09-21-luecke.md";

        const run = (cwd: string, ...args: string[]): void => {
            const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
            if (result.status !== 0) {
                throw new Error(`git ${args.join(" ")}: ${String(result.stderr)}`);
            }
        };
        const runListener = (extra: string[]): Promise<string> =>
            new Promise((resolve) => {
                const child = spawn(
                    process.execPath,
                    [watcher, "--role", "claudia", "--repo", listener, "--remote", "origin", "--once", ...extra],
                    { stdio: ["ignore", "pipe", "ignore"] },
                );
                let buffer = "";
                child.stdout.on("data", (chunk: Buffer) => (buffer += chunk.toString()));
                child.on("close", () => resolve(buffer));
                setTimeout(() => {
                    child.kill();
                    resolve(buffer);
                }, 30_000);
            });

        try {
            run(root, "init", "--quiet", "--bare", "--initial-branch=master", bare);
            run(root, "clone", "--quiet", bare, writer);
            await writeFile(join(writer, "README.md"), "Probe" + String.fromCharCode(10), "utf8");
            run(writer, "add", "-A");
            run(writer, "-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-m", "Start");
            run(writer, "push", "--quiet", "origin", "master");
            run(root, "clone", "--quiet", bare, listener);

            // Erster Listener: merkt sich den Stand und endet - wie ein abgelaufener Monitor.
            await runListener(["--state", stateFile]);

            // In der Lücke antwortet Claudio mit einem DONE.
            const file = join(writer, relativePath);
            await mkdir(dirname(file), { recursive: true });
            await writeFile(
                file,
                handover({ from: "claudio", to: "claudia", status: "DONE", operator_decision_required: "no" }),
                "utf8",
            );
            run(writer, "add", "-A");
            run(
                writer,
                "-c",
                "user.name=T",
                "-c",
                "user.email=t@t.invalid",
                "commit",
                "--author=Claudio <claudio@avesmaps3d.local>",
                "-m",
                "Antwort in der Luecke",
            );
            run(writer, "push", "--quiet", "origin", "master");

            // Ohne gemerkten Stand zählt nur Offenes - ein DONE fiele durch.
            const ohneStand = await runListener(["--state", join(root, "unbenutzt.txt")]);
            expect(ohneStand, "ohne Stand meldet die Startaufnahme kein DONE").not.toContain("2026-09-21-luecke.md");

            // Mit gemerktem Stand wird die Lücke als Unterschied gelesen - das DONE kommt an.
            const mitStand = await runListener(["--state", stateFile]);
            expect(mitStand, "die Antwort aus der Lücke wird nachgeholt").toContain("path=" + relativePath);
            expect(mitStand).toContain("status=DONE");
        } finally {
            await raeume(root);
        }
    }, 120_000);

    it("💣 verschluckt keine Übergabe, wenn ein fetch fehlschlägt", async () => {
        // Von Claudio gemessen: schlägt EIN fetch fehl, sind die Objekte nicht da, jede Datei gilt
        // als unlesbar - und wenn der Stand trotzdem vorrückt, wird dieser Handover NIE gemeldet,
        // auch bei späteren Pushes nicht. Ein Listener, der still nichts meldet, sieht aus wie ein
        // ruhiger Tag.
        //
        // 🪤 Der Ausfall wird so nachgestellt, dass `ls-remote` GELINGT und nur `fetch` scheitert -
        // ein Verzeichnis anstelle von `.git/FETCH_HEAD`. Bräche auch `ls-remote`, liefe der
        // Listener ohnehin in seine Netzausfall-Behandlung und der Befund bliebe ungeprüft.
        const root = await mkdtemp(join(tmpdir(), "coord-fetch-"));
        const bare = join(root, "bare.git");
        const writer = join(root, "writer");
        const listener = join(root, "listener");
        const relativePath = "project-control/handovers/2026-09-21-fetchprobe.md";

        const run = (cwd: string, ...args: string[]): void => {
            const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
            if (result.status !== 0) {
                throw new Error(`git ${args.join(" ")}: ${String(result.stderr)}`);
            }
        };

        try {
            run(root, "init", "--quiet", "--bare", "--initial-branch=master", bare);
            run(root, "clone", "--quiet", bare, writer);
            await writeFile(join(writer, "README.md"), "Probe" + String.fromCharCode(10), "utf8");
            run(writer, "add", "-A");
            run(writer, "-c", "user.name=T", "-c", "user.email=t@t.invalid", "commit", "-m", "Start");
            run(writer, "push", "--quiet", "origin", "master");
            run(root, "clone", "--quiet", bare, listener);

            const child = spawn(
                process.execPath,
                [watcher, "--role", "claudia", "--repo", listener, "--remote", "origin", "--interval", "5"],
                { stdio: ["ignore", "pipe", "ignore"] },
            );
            let output = "";
            child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
            const settle = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

            try {
                await settle(3000);

                // fetch unbrauchbar machen, dann pushen: der Listener SIEHT den neuen Stand, kann
                // ihn aber nicht holen.
                const fetchHead = join(listener, ".git", "FETCH_HEAD");
                await rm(fetchHead, { force: true });
                await mkdir(fetchHead, { recursive: true });

                const file = join(writer, relativePath);
                await mkdir(dirname(file), { recursive: true });
                await writeFile(
                    file,
                    handover({
                        from: "claudio",
                        to: "claudia",
                        status: "ACTION_REQUIRED",
                        operator_decision_required: "no",
                    }),
                    "utf8",
                );
                run(writer, "add", "-A");
                run(
                    writer,
                    "-c",
                    "user.name=T",
                    "-c",
                    "user.email=t@t.invalid",
                    "commit",
                    "--author=Claudio <claudio@avesmaps3d.local>",
                    "-m",
                    "Handover waehrend des Ausfalls",
                );
                run(writer, "push", "--quiet", "origin", "master");

                await settle(13_000);
                expect(output, "waehrend des Ausfalls wird nichts gemeldet").not.toContain("2026-09-21-fetchprobe.md");

                // Netz wieder da - und JETZT muss die Übergabe ankommen.
                await rm(fetchHead, { recursive: true, force: true });
                for (let waited = 0; waited < 30_000 && !output.includes("2026-09-21-fetchprobe.md"); waited += 500) {
                    await settle(500);
                }
                expect(output, "nach dem Aussetzer wird sie nachgeholt").toContain("path=" + relativePath);
            } finally {
                await beende(child);
            }
        } finally {
            await raeume(root);
        }
    }, 120_000);

    it("🔴 liest NUR den gepushten Stand, nie die Arbeitskopie", async () => {
        // Ein lokal geschriebener, nicht committeter Handover darf nichts auslösen - sonst setzt
        // ein halbfertiger Entwurf auf der eigenen Platte die Gegenseite in Bewegung.
        const directory = await mkdtemp(join(tmpdir(), "coord-"));
        try {
            const path = join(
                fileURLToPath(new URL("../../../project-control/handovers/", import.meta.url)),
                "zz-nicht-committet.md",
            );
            await writeFile(
                path,
                handover({
                    from: "claudio",
                    to: "claudia",
                    status: "ACTION_REQUIRED",
                    operator_decision_required: "no",
                }),
                "utf8",
            );
            try {
                const output = await new Promise<string>((resolve) => {
                    const child = spawn(process.execPath, [watcher, "--role", "claudia", "--once"], {
                        stdio: ["ignore", "pipe", "ignore"],
                    });
                    let buffer = "";
                    child.stdout.on("data", (chunk: Buffer) => (buffer += chunk.toString()));
                    child.on("close", () => resolve(buffer));
                    setTimeout(() => {
                        child.kill();
                        resolve(buffer);
                    }, 30_000);
                });
                expect(output).not.toContain("zz-nicht-committet");
            } finally {
                await rm(path, { force: true });
            }
        } finally {
            await raeume(directory);
        }
    }, 45_000);
});
