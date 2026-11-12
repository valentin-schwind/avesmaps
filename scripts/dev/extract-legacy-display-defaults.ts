/**
 * Zieht die VORGABEN der Landschafts-Darstellungstafel aus Legacys Code (WI-0064).
 *
 *   node scripts/dev/extract-legacy-display-defaults.ts                      prueft: stimmt die Datei im Repo mit Legacy master ueberein?
 *   node scripts/dev/extract-legacy-display-defaults.ts --fetch              vorher `git fetch` im Discovery-Mirror
 *   node scripts/dev/extract-legacy-display-defaults.ts --write              schreibt config/landscape-display/aventuria.json neu
 *   node scripts/dev/extract-legacy-display-defaults.ts --ref <commit>       ein bestimmter Stand statt master
 *
 * Warum es das gibt: Legacys Endpunkt `ecosystem-display.php` liefert nur die UEBERSTEUERUNGEN der Redaktion. Die Vorgaben
 * stehen in `js/map-features/ecosystem-display.js` (Konstanten `AVESMAPS_ECOSYSTEM_DISPLAY_*`) und ihr Server kennt sie
 * ausdruecklich nicht. Die wirksame Tafel entsteht erst aus beiden; die Vorgaben liegen deshalb versioniert im Repo
 * (`config/landscape-display/aventuria.json`, mit Commit und Blob), und dieses Werkzeug haelt sie ehrlich.
 *
 * 🔴 Gelesen wird ausschliesslich der Discovery-Mirror `C:\GIT\.discovery\avesmaps.git` (`git show`), nie das lokale
 * Legacy-Repository. `--fetch` ist im Mirror erlaubt und der einzige Netzzugriff.
 *
 * 🔴 Die Datei wird nicht abgeschrieben, sondern AUSGEFUEHRT: die Legacy-Datei haengt ihre Konstanten am Ende selbst an
 * `globalThis` (fuer ihre Node-Tests), und die Vorgabegroesse rechnet Legacys eigene Funktion. So gibt es keine zweite
 * Formel, die auseinanderlaufen koennte. Ausgefuehrt wird in einem leeren `vm`-Kontext ohne `require`, `process` oder
 * Netz (Zeitgrenze 2 s); die Datei ist Code des Betreibers aus dessen eigenem Repository.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { format, resolveConfig } from "prettier";

export const LEGACY_DISPLAY_FILE = "js/map-features/ecosystem-display.js";
export const LEGACY_REPOSITORY = "https://github.com/valentin-schwind/avesmaps";
export const DEFAULT_MIRROR = "C:/GIT/.discovery/avesmaps.git";
/** Die Tafel hat neun Schriftgroessen je Art: z0 bis z8 (z8 erbt z7, Legacys Karte endet bei 7). */
export const SIZE_BANDS = 9;

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DEFAULTS_FILE = resolve(REPOSITORY_ROOT, "config", "landscape-display", "aventuria.json");

/** Was aus Legacys Code kommt, ohne den Herkunftsblock. */
export interface ExtractedDefaults {
    bandMax: number;
    base: { ab: number; bis: number; curveMax: number; prio: number };
    perArt: Record<string, Partial<{ ab: number; bis: number; curveMax: number; prio: number }>>;
    sizeByBand: number[];
    sizeLimits: { min: number; max: number };
    collision: {
        base: { teil: boolean; fest: boolean };
        perArt: Record<string, Partial<{ teil: boolean; fest: boolean }>>;
    };
    opacity: {
        perLayer: Record<string, number>;
        perArea: Record<string, number>;
        waterAreas: string[];
    };
    spacing: {
        defaults: { repel: number; versatz: number; drift: number };
        limits: Record<string, { min: number; max: number }>;
    };
}

/** Legacy legt seine Konstanten in einem Kontext aus einem anderen Realm ab: einmal durch JSON, dann sind es unsere Objekte. */
function plain<T>(value: unknown): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

/** Fuehrt Legacys Datei aus und liest, was sie hergibt. Wirft, wenn eine erwartete Konstante fehlt. */
export function extractDefaults(sourceText: string): ExtractedDefaults {
    const context = vm.createContext({});
    vm.runInContext(sourceText, context, { timeout: 2000, filename: "ecosystem-display.js" });
    // Auch die Konstanten, die Legacy nicht an globalThis haengt (`const` auf der obersten Ebene): Skripte im selben
    // `vm`-Kontext teilen sich die globale lexikalische Umgebung, genau wie klassische <script>-Bausteine im Browser.
    const read = (name: string): unknown => {
        if (vm.runInContext(`typeof ${name}`, context) === "undefined") {
            throw new Error(
                `${LEGACY_DISPLAY_FILE} kennt ${name} nicht mehr: die Datei hat sich veraendert, das Werkzeug ist anzupassen`,
            );
        }
        return vm.runInContext(name, context) as unknown;
    };
    const groesse = read("avesmapsEcosystemDisplayVorgabeGroesse");
    if (typeof groesse !== "function") {
        throw new Error(`${LEGACY_DISPLAY_FILE}: avesmapsEcosystemDisplayVorgabeGroesse ist keine Funktion mehr`);
    }
    const sizeByBand = Array.from({ length: SIZE_BANDS }, (_, band) => Number(groesse(band)));
    return {
        bandMax: Number(read("AVESMAPS_ECOSYSTEM_DISPLAY_BAND_MAX")),
        base: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE")),
        perArt: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_VORGABE_JE_ART")),
        sizeByBand,
        sizeLimits: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_GROESSE_LIMITS")),
        collision: {
            base: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE")),
            perArt: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_KOLLISION_VORGABE_JE_ART")),
        },
        opacity: {
            perLayer: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT")),
            perArea: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_DECKKRAFT_JE_ART")),
            waterAreas: [...(read("AVESMAPS_ECOSYSTEM_DISPLAY_WASSERFLAECHEN") as Set<string>)].sort(),
        },
        spacing: {
            defaults: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_VORGABE")),
            limits: plain(read("AVESMAPS_ECOSYSTEM_DISPLAY_ABSTAND_LIMITS")),
        },
    };
}

export interface DefaultsSource {
    repository: string;
    file: string;
    commit: string;
    blob: string;
}

const COMMENT =
    "Die VORGABEN der Landschafts-Darstellungstafel, wie Legacys Code sie fuehrt (js/map-features/ecosystem-display.js, WI-0064). " +
    "ERZEUGT von scripts/dev/extract-legacy-display-defaults.ts - nicht von Hand aendern. Legacys Endpunkt ecosystem-display.php liefert " +
    "nur die UEBERSTEUERUNGEN; die wirksame Tafel ist beides zusammen (packages/shared/src/landscape-display.ts). " +
    "`commit` ist der letzte Commit, der die Datei beruehrt, `blob` ihr Git-Blob: an ihm erkennt `--check`, ob Legacy sie geaendert hat. " +
    "Schriftgroessen: 9 Werte je Art, z0 bis z8 in PIXELN (nicht Punkt, siehe config/zoom-bands). Ein Band mit bis < ab heisst 'aus'.";

/** Das Dokument, wie es im Repo liegt. Die Reihenfolge der Schluessel ist fest, damit zwei Laeufe bytegleich sind. */
export function buildDocument(extracted: ExtractedDefaults, source: DefaultsSource): Record<string, unknown> {
    return {
        $comment: COMMENT,
        schemaVersion: 1,
        mapDomain: "aventuria",
        source,
        ...extracted,
    };
}

function git(mirror: string, args: string[]): string {
    return execFileSync("git", ["--git-dir", mirror, ...args], { encoding: "utf8" }).trim();
}

/** Liest die Legacy-Datei aus dem Mirror und ihre Herkunft. `ref` ist ein Commit oder `master`. */
export function readFromMirror(mirror: string, ref: string): { text: string; source: DefaultsSource } {
    const text = execFileSync("git", ["--git-dir", mirror, "show", `${ref}:${LEGACY_DISPLAY_FILE}`], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
    });
    return {
        text,
        source: {
            repository: LEGACY_REPOSITORY,
            file: LEGACY_DISPLAY_FILE,
            commit: git(mirror, ["log", "-1", "--format=%H", ref, "--", LEGACY_DISPLAY_FILE]),
            blob: git(mirror, ["rev-parse", `${ref}:${LEGACY_DISPLAY_FILE}`]),
        },
    };
}

/** So, wie Prettier die Datei haben will: `format:check` prueft config/ mit, und ein handformatiertes JSON faellt dort durch. */
export async function serialize(document: Record<string, unknown>): Promise<string> {
    const options = (await resolveConfig(DEFAULTS_FILE)) ?? {};
    return format(JSON.stringify(document), { ...options, filepath: DEFAULTS_FILE });
}

/** Inhaltlich gleich, unabhaengig von der Formatierung. */
export function sameDocument(recordedText: string, document: Record<string, unknown>): boolean {
    try {
        return JSON.stringify(JSON.parse(recordedText)) === JSON.stringify(document);
    } catch {
        return false;
    }
}

async function main(): Promise<void> {
    const { values } = parseArgs({
        options: {
            mirror: { type: "string", default: DEFAULT_MIRROR },
            ref: { type: "string", default: "master" },
            fetch: { type: "boolean", default: false },
            write: { type: "boolean", default: false },
        },
    });
    if (!existsSync(values.mirror)) {
        console.error(
            `Discovery-Mirror ${values.mirror} fehlt (git clone --mirror ${LEGACY_REPOSITORY} ${values.mirror})`,
        );
        process.exit(2);
    }
    if (values.fetch) {
        console.warn(`git fetch im Mirror ${values.mirror} ...`);
        execFileSync("git", ["--git-dir", values.mirror, "fetch", "--quiet"], { stdio: "inherit" });
    }
    const { text, source } = readFromMirror(values.mirror, values.ref);
    const document = buildDocument(extractDefaults(text), source);
    if (values.write) {
        writeFileSync(DEFAULTS_FILE, await serialize(document));
        console.warn(
            `geschrieben: ${DEFAULTS_FILE} (Legacy ${source.commit.slice(0, 9)}, Blob ${source.blob.slice(0, 9)})`,
        );
        return;
    }
    const recorded = existsSync(DEFAULTS_FILE) ? readFileSync(DEFAULTS_FILE, "utf8") : "";
    if (sameDocument(recorded, document)) {
        console.warn(
            `gleich: die Vorgaben im Repo entsprechen Legacy ${source.commit.slice(0, 9)} (Blob ${source.blob.slice(0, 9)})`,
        );
        return;
    }
    const recordedBlob = /"blob": "([0-9a-f]{40})"/.exec(recorded)?.[1] ?? "(keiner)";
    console.error(
        recordedBlob === source.blob
            ? "ABWEICHUNG: derselbe Blob, aber ein anderes Ergebnis - das Werkzeug hat sich geaendert. Mit --write neu erzeugen."
            : `ABWEICHUNG: Legacy hat ecosystem-display.js geaendert (im Repo Blob ${recordedBlob.slice(0, 9)}, Legacy ${source.blob.slice(0, 9)}, ` +
                  `Commit ${source.commit.slice(0, 9)}). Mit --write neu erzeugen, dann den Diff der Vorgaben lesen und die Abweichungsliste in WI-0064 pruefen.`,
    );
    process.exit(1);
}

// 🪤 Nur als Programm laufen, nie beim bloßen import(): die Tests laden dieses Modul, um `extractDefaults` zu pruefen.
if (import.meta.main) {
    await main();
}
