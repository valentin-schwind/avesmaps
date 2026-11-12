import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { RepoBeleg, RepoOverview } from "@avesmaps3d/shared";

/**
 * Der Reiter „Überblick“ der Statusseite (JOBS-0001 5.1, D2 A, D3 A/A; Betreiber 2026-10-04: „alles wie empfohlen“).
 *
 * 🔴 DIE SEITE BESITZT KEINE DATEN UND PFLEGT NICHTS SELBST (AGENTS.md, Orientation Gate: „keine zweite Roadmap mit paralleler
 * Statuspflege“; `current.md` bleibt die einzige Quelle des dynamischen Stands). Sie LIEST das Repository und nennt zu jeder Zeile die
 * Fundstelle, Datei und Zeile. Wo eine Quelle fehlt, sagt sie es.
 *
 * D2 A: Nur LOKAL, aus dem Arbeitsbaum. Die Stage hat das Repository nicht; dort kommt `available: false`, und die Seite blendet
 * den Reiter sauber aus.
 *
 * D3 A/A: Es gibt keine Quelle für „laufende Sitzungen“ (der Handover-Listener speichert bewusst nichts), also werden sie aus dem
 * Repository abgeleitet (wer ein Work Item besitzt, das in Arbeit ist). „Heute entschieden“ sind Zeilen der Form
 * `Betreiber 2026-MM-TT: „…“`, „selbst entschieden“ sind die Markierungen `IMPLEMENTATION DETAIL` und „selbst entschieden“ in heute
 * geänderten Dateien: die Konvention, nach der Agenten heute schon suchen. Eine anders formulierte Zeile wird verfehlt; der Fehler
 * ist sichtbar, weil die Fundstelle dabeisteht.
 */

export interface RepoOverviewOptions {
    /** Wurzel des Repositorys (dort liegen `AGENTS.md` und `project-control/`). */
    root: string;
    /** Für Tests: der Zeitpunkt „jetzt“. */
    now?: Date;
    /** Wie viele Einträge je Liste höchstens. */
    limit?: number;
}

/** Findet die Wurzel des Repositorys oberhalb von `startDirectory`; `null`, wo es keine gibt (die Stage). */
export function findRepoRoot(startDirectory: string): string | null {
    let current = startDirectory;
    for (;;) {
        if (
            existsSync(join(current, "AGENTS.md")) &&
            existsSync(join(current, "project-control", "state", "current.md"))
        ) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) return null;
        current = parent;
    }
}

/** `YYYY-MM-DD` in der Ortszeit des Rechners. */
export function localDate(date: Date): string {
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

interface SourceFile {
    path: string;
    /** Pfad relativ zur Wurzel, mit `/`. */
    file: string;
    lines: string[];
    modifiedToday: boolean;
    /** Wann die Datei zuletzt geändert wurde (ms): die jüngste steht in „selbst entschieden“ oben. */
    modifiedMs: number;
}

const BELEG_DIRECTORIES = ["work-items", "handovers", "planning", "decisions"];

async function readMarkdownFiles(root: string, directory: string, today: string): Promise<SourceFile[]> {
    const base = join(root, "project-control", directory);
    let names: string[];
    try {
        names = (await readdir(base)).filter((name) => name.endsWith(".md")).sort();
    } catch {
        return [];
    }
    const files: SourceFile[] = [];
    for (const name of names) {
        const path = join(base, name);
        try {
            const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
            files.push({
                path,
                file: relative(root, path).split(sep).join("/"),
                lines: text.split(/\r?\n/),
                modifiedToday: localDate(info.mtime) === today,
                modifiedMs: info.mtimeMs,
            });
        } catch {
            // Eine Datei, die gerade geschrieben wird oder fehlt: die Seite zeigt den Rest.
        }
    }
    return files;
}

/** Zerlegt eine Tabellenzeile `| a | b |` in ihre Zellen; `null`, wo die Zeile keine ist. */
export function tableCells(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) return null;
    const cells: string[] = [];
    let current = "";
    for (let index = 1; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (char === "\\" && trimmed[index + 1] === "|") {
            current += "|";
            index += 1;
        } else if (char === "|") {
            cells.push(current.trim());
            current = "";
        } else {
            current += char;
        }
    }
    if (current.trim().length > 0) cells.push(current.trim());
    return cells;
}

const isSeparator = (cells: string[]): boolean => cells.every((cell) => /^:?-{2,}:?$/.test(cell));

/** Fettdruck, Code und Verweise aus einer Zelle nehmen: die Seite zeigt Text. */
export function plain(text: string, maxLength = 240): string {
    const cleaned = text
        .replace(/\*\*/g, "")
        .replace(/`/g, "")
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\s+/g, " ")
        .trim();
    return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}…` : cleaned;
}

/** Eine Tabelle mit dem Schlüssel in der ersten Spalte (`| status | … |`) als Zuordnung samt Zeilennummer. */
function keyValueRows(lines: string[], limit = 40): Map<string, { value: string; line: number }> {
    const rows = new Map<string, { value: string; line: number }>();
    for (let index = 0; index < Math.min(lines.length, limit); index += 1) {
        const cells = tableCells(lines[index] ?? "");
        if (!cells || cells.length < 2 || isSeparator(cells)) continue;
        const key = (cells[0] ?? "").toLowerCase();
        if (key.length > 0 && !rows.has(key)) rows.set(key, { value: cells.slice(1).join(" | "), line: index + 1 });
    }
    return rows;
}

function title(lines: string[], fallback: string): string {
    const heading = lines.find((line) => line.startsWith("# "));
    return heading ? plain(heading.slice(2), 160) : fallback;
}

/** Was auf den Betreiber wartet: Handovers an ihn und die Tabelle „Offene Betreiberentscheidungen“ in `current.md`. */
function waitingForOperator(handovers: SourceFile[], current: SourceFile | undefined): RepoOverview["waiting"] {
    const entries: RepoOverview["waiting"] = [];
    for (const file of handovers) {
        const rows = keyValueRows(file.lines);
        const status = rows.get("status");
        if (!status) continue;
        const state = plain(status.value, 80);
        if (!/^(ACTION_REQUIRED|BLOCKED)\b/.test(state)) continue;
        const decision = rows.get("operator_decision_required");
        const needsOperator = decision === undefined || /\byes\b/i.test(decision.value);
        if (!needsOperator) continue;
        entries.push({
            text: title(file.lines, file.file),
            detail:
                decision === undefined
                    ? `${state}; Feld operator_decision_required fehlt (gilt als yes)`
                    : `${state}; ${plain(decision.value, 160)}`,
            beleg: { file: file.file, line: (decision ?? status).line },
        });
    }
    if (current) {
        const start = current.lines.findIndex((line) => /^##\s+\d+\.\s+Offene Betreiberentscheidungen/.test(line));
        if (start >= 0) {
            for (let index = start + 1; index < current.lines.length; index += 1) {
                const line = current.lines[index] ?? "";
                if (line.startsWith("## ")) break;
                const cells = tableCells(line);
                if (!cells || cells.length < 2 || isSeparator(cells)) continue;
                if ((cells[0] ?? "").toLowerCase() === "frage") continue;
                entries.push({
                    text: plain(cells[0] ?? "", 200),
                    detail: plain(cells.slice(1).join(" | "), 240),
                    beleg: { file: current.file, line: index + 1 },
                });
            }
        }
    }
    return entries;
}

/** Das Zitat nach `„`, mit verschachtelten `„…“` im Gleichgewicht. */
function quoteFrom(line: string, open: number): string | null {
    let depth = 0;
    for (let index = open; index < line.length; index += 1) {
        const char = line[index];
        if (char === "„" || (char === '"' && depth === 0)) depth += 1;
        else if (char === "“" || (char === '"' && depth > 0)) {
            depth -= 1;
            if (depth === 0) return line.slice(open + 1, index);
        }
    }
    return null;
}

const DECISION = /Betreiber\s+(\d{4}-\d{2}-\d{2})\b([^„"\n]{0,80})([„"])/g;

/** Zeilen der Form `Betreiber 2026-MM-TT: „…“` mit dem heutigen Datum, gleiche Zitate zusammengefasst. */
function decidedToday(
    files: SourceFile[],
    current: SourceFile | undefined,
    today: string,
): RepoOverview["decidedToday"] {
    const byQuote = new Map<string, { beleg: RepoBeleg; count: number }>();
    for (const file of [...files, ...(current ? [current] : [])]) {
        for (const [index, line] of file.lines.entries()) {
            if (!line.includes(today)) continue;
            for (const match of line.matchAll(DECISION)) {
                if (match[1] !== today || match.index === undefined) continue;
                const opening = match.index + match[0].length - 1;
                const quote = quoteFrom(line, opening);
                if (!quote || quote.trim().length < 3) continue;
                const text = plain(quote, 280);
                const known = byQuote.get(text);
                if (known) known.count += 1;
                else byQuote.set(text, { beleg: { file: file.file, line: index + 1 }, count: 1 });
            }
        }
    }
    return [...byQuote.entries()].map(([text, found]) => ({
        text,
        detail: found.count > 1 ? `an ${String(found.count)} Stellen` : null,
        beleg: found.beleg,
    }));
}

/** Markierungen für Entscheidungen der Entwicklung selbst, in heute geänderten Dateien. */
function selfDecided(files: SourceFile[], limit: number): RepoOverview["selfDecided"] {
    const entries: RepoOverview["selfDecided"] = [];
    for (const file of files) {
        if (!file.modifiedToday) continue;
        for (const [index, line] of file.lines.entries()) {
            if (!/IMPLEMENTATION DETAIL|selbst entschieden/i.test(line)) continue;
            // Zeilen, die die Markierung nur ERKLÄREN (die Planung nennt sie), sind keine Entscheidung.
            if (/Markierung/i.test(line)) continue;
            entries.push({
                text: plain(line.replace(/^[\s>|*-]+/, ""), 240),
                detail: null,
                beleg: { file: file.file, line: index + 1 },
            });
            if (entries.length >= limit * 3) return entries;
        }
    }
    return entries;
}

/** Work Items in Arbeit samt Besitzer (D3 A: aus dem Repository abgeleitet, keine Live-Sitzungen). */
function sessions(workItems: SourceFile[]): RepoOverview["sessions"] {
    const entries: RepoOverview["sessions"] = [];
    for (const file of workItems) {
        const rows = keyValueRows(file.lines);
        const status = rows.get("status");
        if (!status || !/IN_PROGRESS|in Arbeit/i.test(status.value)) continue;
        const owner = rows.get("owner");
        const id = /^(WI-\d{4})/.exec(file.file.split("/").pop() ?? "")?.[1] ?? file.file;
        const heading = title(file.lines, id).replace(/^WI-\d{4}:?\s*/, "");
        entries.push({
            text: `${id} ${heading}`,
            detail: `${owner ? `Besitz: ${plain(owner.value, 120)}; ` : ""}${plain(status.value, 140)}`,
            beleg: { file: file.file, line: status.line },
        });
    }
    return entries;
}

/** Die Tabelle „Datenstand“ aus `current.md` (Stage gegen lokal): laut Dokumentation, nicht gemessen. */
function dataStand(current: SourceFile | undefined): RepoOverview["dataStand"] {
    if (!current) return [];
    const start = current.lines.findIndex((line) => /^##\s+\d+\.\s+Datenstand/.test(line));
    if (start < 0) return [];
    const rows: RepoOverview["dataStand"] = [];
    // Die Kopfzeile steht vor der Trennzeile und ist kein Eintrag.
    let kopfVorbei = false;
    for (let index = start + 1; index < current.lines.length; index += 1) {
        const line = current.lines[index] ?? "";
        if (line.startsWith("## ")) break;
        const cells = tableCells(line);
        if (!cells || cells.length < 3) continue;
        if (isSeparator(cells)) {
            kopfVorbei = true;
            continue;
        }
        if (!kopfVorbei) continue;
        const label = plain(cells[0] ?? "", 80);
        if (label.length === 0) continue;
        rows.push({
            label,
            local: plain(cells[1] ?? "", 200),
            stage: plain(cells[2] ?? "", 200),
            beleg: { file: current.file, line: index + 1 },
        });
    }
    return rows;
}

const UNAVAILABLE = (generatedAt: string, today: string, reason: "not_local" | "no_repository"): RepoOverview => ({
    available: false,
    reason,
    generatedAt,
    today,
    waiting: [],
    decidedToday: [],
    selfDecided: [],
    sessions: [],
    dataStand: [],
});

export async function buildRepoOverview(options: RepoOverviewOptions): Promise<RepoOverview> {
    const now = options.now ?? new Date();
    const today = localDate(now);
    const limit = options.limit ?? 40;
    const root = options.root;
    if (!existsSync(join(root, "project-control"))) return UNAVAILABLE(now.toISOString(), today, "no_repository");

    const directories = await Promise.all(
        BELEG_DIRECTORIES.map((directory) => readMarkdownFiles(root, directory, today)),
    );
    const byName = new Map(BELEG_DIRECTORIES.map((directory, index) => [directory, directories[index] ?? []]));
    const stateFiles = await readMarkdownFiles(root, "state", today);
    const current = stateFiles.find((file) => file.file.endsWith("state/current.md"));
    const everything = [...directories.flat()];

    return {
        available: true,
        reason: null,
        generatedAt: now.toISOString(),
        today,
        waiting: waitingForOperator(byName.get("handovers") ?? [], current).slice(0, limit),
        decidedToday: decidedToday(everything, current, today).slice(0, limit),
        selfDecided: selfDecided(everything, limit).slice(0, limit),
        sessions: sessions(byName.get("work-items") ?? []).slice(0, limit),
        dataStand: dataStand(current).slice(0, limit),
    };
}

export { UNAVAILABLE as unavailableRepoOverview };
