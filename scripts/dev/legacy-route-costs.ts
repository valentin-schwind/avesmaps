/**
 * Legacys Zollzählung als AUSGEFÜHRTER Code (WI-0065 U1 und U6): `avesmapsCountRouteStateBorders` und
 * `avesmapsTravelCostPrepareTerritory` aus `js/routing/route-costs.js`, unverändert in einem leeren `vm`-Kontext.
 * Es gibt so keine zweite Formel, die auseinanderlaufen könnte; ein Paritätstest (`packages/shared/test/
 * travel-borders-legacy.test.ts`) und der Oracle-Test gegen zwei Implementierungen (`apps/server/test/
 * toll-borders-oracle.test.ts`, `npm run compare:tolls`) führen dieselbe Datei aus.
 *
 * 🔴 Gelesen wird ausschließlich der Discovery-Mirror `C:\GIT\.discovery\avesmaps.git` (`git cat-file`, `git show`),
 * nie das lokale Legacy-Repository. Ohne Mirror (CI, ein anderer Rechner) sind die Tests SICHTBAR übersprungen,
 * nicht grün. Pfad überschreibbar mit `AVESMAPS_LEGACY_MIRROR`.
 *
 * Der Stand ist als Git-Blob festgehalten (`LEGACY_BLOB`), damit er unveränderlich ist. Ob Legacy die Regel seither
 * geändert hat, prüft `checkLegacyDrift` gegen den Mirror-`master` (Drift-Wächter der CLI).
 */

import { execFileSync } from "node:child_process";
import vm from "node:vm";

export const LEGACY_MIRROR = process.env["AVESMAPS_LEGACY_MIRROR"] ?? "C:/GIT/.discovery/avesmaps.git";
export const LEGACY_FILE = "js/routing/route-costs.js";
/** `avesmaps@00b3d7d:js/routing/route-costs.js`; der letzte Commit, der die Datei berührt, ist 2d2f4af. */
export const LEGACY_BLOB = "339373891f056d4f8d392cb4e01a4aec142dcc98";
/** Wo im festgehaltenen Blob die Zählung steht (Konstanten bis zum Ende von `avesmapsCountRouteStateBorders`). */
export const LEGACY_FIRST_LINE = 16;
export const LEGACY_LAST_LINE = 230;

function git(mirror: string, args: readonly string[]): string | null {
    try {
        return execFileSync("git", ["--git-dir", mirror, ...args], {
            encoding: "utf8",
            maxBuffer: 16 * 1024 * 1024,
            stdio: ["ignore", "pipe", "ignore"],
        });
    } catch {
        return null;
    }
}

/** Der festgehaltene Stand der Datei, oder `null` ohne lesbaren Mirror. */
export function readPinnedLegacySource(mirror: string = LEGACY_MIRROR): string | null {
    return git(mirror, ["cat-file", "blob", LEGACY_BLOB]);
}

/** Die Datei an einem Stand des Mirrors (`master` oder ein Commit), oder `null`. */
export function readMirrorLegacySource(mirror: string, ref: string): string | null {
    return git(mirror, ["show", `${ref}:${LEGACY_FILE}`]);
}

/**
 * Der Teil der Datei, der die Regel trägt: von den Konstanten der Abtastung bis zum Ende von
 * `avesmapsCountRouteStateBorders` (Zeile 16 bis 230 im festgehaltenen Blob). Gefunden über die Anker, nicht über
 * Zeilennummern, damit eine verschobene Datei erkannt wird und nicht stillschweigend etwas anderes läuft. Wirft, wenn
 * ein Anker fehlt.
 */
export function borderCode(text: string): string {
    const lines = text.split(/\r?\n/);
    const first = lines.findIndex((line) => line.startsWith("// Schrittweite der Grenz-Abtastung"));
    const functionStart = lines.findIndex((line) => line.startsWith("function avesmapsCountRouteStateBorders("));
    if (first < 0 || functionStart < first) {
        throw new Error(`${LEGACY_FILE} enthält die Zählung der Landesgrenzen nicht mehr an der bekannten Stelle`);
    }
    const last = lines.findIndex((line, index) => index > functionStart && line === "}");
    if (last < 0) throw new Error(`${LEGACY_FILE}: das Ende von avesmapsCountRouteStateBorders fehlt`);
    return lines.slice(first, last + 1).join("\n");
}

/** Was aus Legacys Code kommt: die zwei Funktionen und die zwei Konstanten der Regel. */
export interface LegacyBorders {
    prepare: (feature: unknown) => unknown;
    count: (segments: unknown, territories: unknown[]) => number | null;
    sampleStep: number;
    minRunMiles: number;
}

/**
 * Führt Legacys Zählung aus. Der Code hat kein `require`, kein `process` und kein Netz; in Legacy kommt der Maßstab
 * (`DISTANCE_SCALING_FACTOR`) aus `js/config.js`, hier aus `milesPerUnit`.
 */
export function loadLegacyBorders(text: string, milesPerUnit: number): LegacyBorders {
    const code = borderCode(text);
    const context = vm.createContext({ DISTANCE_SCALING_FACTOR: milesPerUnit });
    vm.runInContext(code, context, { timeout: 2000, filename: "route-costs.js" });
    // Die Konstanten und Funktionen stehen auf der obersten Ebene des Skripts; ein weiteres Skript im selben
    // Kontext sieht sie, wie klassische <script>-Bausteine im Browser.
    const read = <T>(name: string): T => vm.runInContext(name, context) as T;
    return {
        prepare: read("avesmapsTravelCostPrepareTerritory"),
        count: read("avesmapsCountRouteStateBorders"),
        sampleStep: read("TRAVEL_COST_BORDER_SAMPLE_STEP"),
        minRunMiles: read("TRAVEL_COST_BORDER_MIN_RUN_MILES"),
    };
}

/** Der Befund des Drift-Wächters. */
export interface LegacyDrift {
    /**
     * `same-file`: die Datei am Mirror-`master` ist der festgehaltene Blob. `same-code`: die Datei hat sich geändert,
     * die Zählung nicht. `drifted`: die Regel hat sich geändert (oder ist nicht mehr auffindbar): Port und Tests prüfen.
     * `unreadable`: der Mirror ist nicht lesbar.
     */
    state: "same-file" | "same-code" | "drifted" | "unreadable";
    /** Der Blob der Datei am Mirror-`master`. */
    masterBlob: string | null;
    /** Der letzte Commit auf `master`, der die Datei berührt. */
    masterCommit: string | null;
    detail: string;
}

/**
 * Hat Legacy die Zählung seit dem festgehaltenen Stand geändert? Verglichen wird der TEXT der Funktionen am
 * Mirror-`master` (`ref`), nicht die ganze Datei: Die Kostenzeilen daneben ändern sich öfter und gehen uns hier nichts an.
 */
export function checkLegacyDrift(mirror: string = LEGACY_MIRROR, ref = "master"): LegacyDrift {
    const pinned = readPinnedLegacySource(mirror);
    const current = readMirrorLegacySource(mirror, ref);
    if (pinned === null || current === null) {
        return {
            state: "unreadable",
            masterBlob: null,
            masterCommit: null,
            detail: `Mirror ${mirror} oder ${LEGACY_FILE}@${ref} nicht lesbar`,
        };
    }
    const masterBlob = git(mirror, ["rev-parse", `${ref}:${LEGACY_FILE}`])?.trim() ?? null;
    const masterCommit = git(mirror, ["log", "-1", "--format=%H", ref, "--", LEGACY_FILE])?.trim() ?? null;
    return { ...compareCode(pinned, current), masterBlob, masterCommit };
}

/** Der reine Textvergleich hinter `checkLegacyDrift`, ohne Mirror prüfbar. */
export function compareCode(pinned: string, current: string): Pick<LegacyDrift, "state" | "detail"> {
    if (pinned === current) return { state: "same-file", detail: "die Datei ist der festgehaltene Stand" };
    try {
        if (borderCode(pinned) === borderCode(current)) {
            return { state: "same-code", detail: "die Datei hat sich geändert, die Zählung der Landesgrenzen nicht" };
        }
    } catch (error) {
        return { state: "drifted", detail: error instanceof Error ? error.message : "Zählung nicht auffindbar" };
    }
    return { state: "drifted", detail: "der Text der Zählung der Landesgrenzen weicht vom festgehaltenen Stand ab" };
}
