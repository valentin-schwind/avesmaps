import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { LEGACY_ZUG_KATEGORIEN, istLegacyZugKategorie } from "@avesmaps3d/shared";
import { sanitizeSummary } from "../jobs/child-protocol.ts";
import { JobFailure, type JobContext } from "../jobs/handlers.ts";
import { DEFAULT_SNAPSHOT_DIR, PUBLIC_MEDIA_EXPORT_ENDPOINT } from "../migration/legacy-update.ts";
import { leseMeldung, zugAnteil, type AbgleichErgebnis } from "./protokoll.ts";

/**
 * Was ein Auftrag der Abgleiche im Job-Prozess tut (WI-0127 SYS-14 §13.4 Nr. 4): Er startet das vorhandene Werkzeug als eigenen Prozess
 * mit `--auftrag <Job>` und meldet dessen Schritte als Phasen. Das Werkzeug bleibt die EINE Stelle für den Zuruf an einen Agenten und für
 * den Knopf; hier entsteht kein zweiter Zug.
 *
 * - **Abbruch** kommt wie bei jedem Job nur an einer Phasengrenze an (`beginPhase` prüft ihn): dann wird der Prozess des Werkzeugs
 *   beendet. Ein Zug, der zwischen zwei Schritten endet, ist beim nächsten Zug wieder ganz (die Schritte sind idempotent).
 * - **Kein Wiederholen von selbst:** Scheitert ein Werkzeug, endet der Auftrag mit Fehler; der Betreiber drückt neu. Ein Zug holt bei
 *   jedem Lauf von Legacy, ein stilles Nachholen ginge auf deren Kosten.
 * - Die Ausgabe des Werkzeugs geht unverändert ins Journal des Workers, die Meldungen (`::abgleich-…`) nicht.
 */

/** Aus `src/` laufen die Werkzeuge als `.ts`, aus `dist/` als `.js`: dieselbe Endung wie diese Datei. */
const EXTENSION = extname(fileURLToPath(import.meta.url));
const SERVER_DIR = fileURLToPath(new URL("../..", import.meta.url));

export function toolFile(name: string): string {
    return fileURLToPath(new URL(`../migration/${name}${EXTENSION}`, import.meta.url));
}

export interface AbgleichDeps {
    /** Startet ein Werkzeug (Tests setzen einen Nachbau). */
    spawnTool?: (file: string, args: readonly string[]) => ChildProcess;
    /** Holt das Medien-Manifest (Tests setzen einen Nachbau). */
    fetchManifest?: (url: string) => Promise<Response>;
    snapshotDir?: string;
    mediaRoot?: string | undefined;
    /** Wohin die Ausgabe des Werkzeugs geht; Vorgabe das Journal des Workers. */
    log?: (line: string) => void;
}

const defaultSpawn = (file: string, args: readonly string[]): ChildProcess =>
    spawn(process.execPath, ["--expose-gc", file, ...args], {
        cwd: SERVER_DIR,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

/** So lange darf ein beendetes Werkzeug selbst enden, bevor es hart beendet wird. */
const KILL_GRACE_MS = 10_000;

interface ToolOutcome {
    code: number | null;
    ergebnis: AbgleichErgebnis | null;
    /** Die letzte Zeile, mit der das Werkzeug einen Abbruch meldet („❌ …“), für die Fehlerzeile des Jobs. */
    abbruch: string | null;
}

async function runTool(
    file: string,
    args: readonly string[],
    deps: AbgleichDeps,
    onPhase: (phase: string) => Promise<void>,
): Promise<ToolOutcome> {
    const log = deps.log ?? ((text: string) => void process.stdout.write(`${text}\n`));
    const child = (deps.spawnTool ?? defaultSpawn)(file, args);
    const exited = new Promise<number | null>((resolve) => {
        child.once("close", (code) => resolve(code));
        child.once("error", () => resolve(null));
    });
    child.stderr?.on("data", (chunk: Buffer) => void process.stderr.write(chunk));
    let ergebnis: AbgleichErgebnis | null = null;
    let abbruch: string | null = null;
    let stopped: unknown = null;
    if (child.stdout !== null) {
        for await (const line of createInterface({ input: child.stdout, crlfDelay: Infinity })) {
            const meldung = leseMeldung(line);
            if (meldung === null) {
                if (line.startsWith("❌")) abbruch = line.replace(/^❌\s*/u, "");
                log(line);
                continue;
            }
            if (meldung.art === "ergebnis") {
                ergebnis = meldung.ergebnis;
                continue;
            }
            if (stopped !== null) continue;
            try {
                await onPhase(meldung.phase);
            } catch (error) {
                // Abbruch oder Ablösen an der Phasengrenze: das Werkzeug beenden, dann den Grund weitergeben.
                stopped = error;
                child.kill();
                setTimeout(() => child.kill("SIGKILL"), KILL_GRACE_MS).unref();
            }
        }
    }
    const code = await exited;
    if (stopped !== null) throw stopped;
    return { code, ergebnis, abbruch };
}

function failure(code: string, what: string, outcome: ToolOutcome): JobFailure {
    const reason = outcome.abbruch ?? `Exit ${outcome.code === null ? "ohne Code" : String(outcome.code)}`;
    return new JobFailure(code, sanitizeSummary(`${what}: ${reason}`), false);
}

/** Der Zug (`legacy_pull`): `legacy:update --auftrag <Job>`, Phasen I1 bis I28, dann der zweite Lauf zur Idempotenzprobe. */
export async function runLegacyPullJob(context: JobContext, deps: AbgleichDeps = {}): Promise<Record<string, unknown>> {
    await context.beginPhase("holen", 0);
    let second = false;
    const outcome = await runTool(
        toolFile("legacy-update-cli"),
        ["--auftrag", context.job.publicId],
        deps,
        async (phase) => {
            if (phase === "zweiter-lauf") {
                second = true;
                await context.beginPhase(phase, 0.8);
                return;
            }
            await context.beginPhase(second ? `2-${phase}` : phase, zugAnteil(phase, second));
        },
    );
    if (outcome.code !== 0) throw failure("zug_gescheitert", "Der Legacy-Zug hat angehalten", outcome);
    return {
        luecken: outcome.ergebnis?.luecken ?? null,
        befunde: outcome.ergebnis?.befunde ?? null,
        satz: outcome.ergebnis?.satz ?? null,
    };
}

/**
 * Der Zug EINER Kategorie (`legacy_zug`, WI-0141): `legacy:update --kategorie <k> --auftrag <Job>`. Dieselbe Mechanik wie der ganze
 * Zug, nur mit den Schritten dieser Kategorie (`config/legacy-zug-kategorien.json`).
 *
 * 🔴 Die Kategorie kommt aus der Eingabe des Auftrags, nicht aus einer Umgebungsvariablen: Wer den Knopf gedrückt hat, hat sie
 * gewählt. Eine unbekannte Kategorie (etwa `herrschaftsgebiete`) lässt den Auftrag scheitern, ohne das Werkzeug zu starten.
 */
export async function runLegacyZugJob(context: JobContext, deps: AbgleichDeps = {}): Promise<Record<string, unknown>> {
    const kategorie = context.input["kategorie"];
    if (typeof kategorie !== "string" || !istLegacyZugKategorie(kategorie)) {
        throw new JobFailure(
            "kategorie_unzulaessig",
            sanitizeSummary(
                `Der Auftrag nennt keine zulässige Kategorie (${LEGACY_ZUG_KATEGORIEN.join(", ")}): ${String(kategorie)}`,
            ),
            false,
        );
    }
    await context.beginPhase("holen", 0);
    let second = false;
    const outcome = await runTool(
        toolFile("legacy-update-cli"),
        ["--kategorie", kategorie, "--auftrag", context.job.publicId],
        deps,
        async (phase) => {
            if (phase === "zweiter-lauf") {
                second = true;
                await context.beginPhase(phase, 0.8);
                return;
            }
            await context.beginPhase(second ? `2-${phase}` : phase, zugAnteil(phase, second));
        },
    );
    if (outcome.code !== 0) throw failure("zug_gescheitert", `Der Legacy-Zug (${kategorie}) hat angehalten`, outcome);
    return {
        kategorie,
        luecken: outcome.ergebnis?.luecken ?? null,
        befunde: outcome.ergebnis?.befunde ?? null,
        satz: outcome.ergebnis?.satz ?? null,
    };
}

/**
 * Die Medien aus Legacy (`legacy_media`): das öffentliche Manifest A frisch holen (ein GET, wie I26 im Zug), die Metadaten einspielen
 * (`migrate:media`), die fehlenden Dateien holen (`legacy:media-fetch`, 350 ms Pause, Schluss bei 429 und 503) und verarbeiten
 * (`migrate:media-files`). Jeder Schritt eine Phase. Das private Manifest B kommt weiter nur als Datei vom Betreiber.
 */
export async function runLegacyMediaJob(
    context: JobContext,
    deps: AbgleichDeps = {},
): Promise<Record<string, unknown>> {
    const mediaRoot = deps.mediaRoot ?? process.env["MEDIA_ROOT"];
    if (mediaRoot === undefined || mediaRoot === "" || !isAbsolute(mediaRoot))
        throw new JobFailure("media_root_fehlt", "MEDIA_ROOT fehlt oder ist nicht absolut", false);
    const auftrag = ["--auftrag", context.job.publicId];

    await context.beginPhase("manifest", 0);
    const snapshotDir = deps.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
    const manifest = join(snapshotDir, "media-export.json");
    try {
        const response = await (deps.fetchManifest ?? ((url) => fetch(url, { signal: AbortSignal.timeout(120_000) })))(
            PUBLIC_MEDIA_EXPORT_ENDPOINT,
        );
        if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        JSON.parse(bytes.toString("utf8"));
        await mkdir(snapshotDir, { recursive: true });
        await writeFile(manifest, bytes);
    } catch (error) {
        throw new JobFailure(
            "manifest_gescheitert",
            sanitizeSummary(`Das Medien-Manifest kam nicht: ${error instanceof Error ? error.message : String(error)}`),
            false,
        );
    }

    const merged: AbgleichErgebnis = { luecken: [], befunde: 0 };
    const steps: { phase: string; progress: number; tool: string; args: string[] }[] = [
        { phase: "metadaten", progress: 0.1, tool: "media-cli", args: ["--source", manifest, ...auftrag] },
        { phase: "dateien", progress: 0.3, tool: "media-fetch-cli", args: ["--source", manifest, ...auftrag] },
        { phase: "verarbeiten", progress: 0.7, tool: "media-files-cli", args: ["--media-root", mediaRoot, ...auftrag] },
    ];
    for (const step of steps) {
        await context.beginPhase(step.phase, step.progress);
        const outcome = await runTool(toolFile(step.tool), step.args, deps, async () => {
            context.checkpoint();
        });
        if (outcome.code !== 0) throw failure("medien_gescheitert", `Medien, Schritt ${step.phase}`, outcome);
        if (outcome.ergebnis !== null) {
            merged.luecken.push(...outcome.ergebnis.luecken.filter((gap) => !merged.luecken.includes(gap)));
            merged.befunde += outcome.ergebnis.befunde;
        }
    }
    return { luecken: merged.luecken, befunde: merged.befunde, satz: null };
}
