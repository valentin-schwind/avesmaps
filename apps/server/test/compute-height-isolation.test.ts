import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * M4 (Architecture Hardening Review 2026-09-28; Anhang D; Kap. 5.32a Regel 5): Die fachliche Höhe
 * (Rechenpfad: Routing, Wegprofile, Gipfelkegel; Generator: Terrain-Ableitung, V12) darf niemals ein
 * Darstellungsprodukt (Visual Relief, Display Height) lesen. Dieser Test sichert die Trennung
 * mechanisch ab, damit ein künftiger Import oder eine künftige Tabelle sie nicht still unterläuft.
 *
 * **Methode und Begründung** (der Befund erlaubt "textuell über die SQL-Strings … oder über eine
 * explizite Liste mit Abgleich — wähle das Robusteste"):
 *
 * 1. **Namen** (`terrain_[a-z_]+`) und **verbotene Vokabeln** werden direkt im Quelltext der
 *    Scope-Dateien gesucht, NACH Entfernen von Blockkommentaren (`/* … *\/`). Ohne das schlägt der
 *    Test an einer bloßen Doku-Querverweisung fehl: `derive.ts` erklärt seine Aufräumregel im
 *    Vergleich zu `pruneVisualRelief`, `ridge.ts` und `gebirge/types.ts` nennen Legacys Spaltennamen
 *    `terrain_ridge_line`/`terrain_avg_height` in einem JSDoc-Kommentar. Das ist Prosa, kein Code,
 *    und keine der drei Stellen berechnet oder importiert etwas. Zeilenkommentare und SQL-Kommentare
 *    (`--`) bleiben unangetastet, weil heute keine Falschtreffer von dort kommen.
 * 2. **Importe** werden dagegen NICHT nur in den Scope-Dateien selbst, sondern transitiv über den
 *    ganzen erreichbaren Graphen relativer Importe verfolgt (Breitensuche innerhalb von `src/`) —
 *    ein Leck über eine dritte Datei wäre sonst unsichtbar. Node-Module und `@avesmaps3d/shared`
 *    beenden einen Pfad, sie liegen außerhalb der verbotenen Ordner.
 * 3. **`dem-tiles.ts`-Sonderfall:** Der Generator erzeugt die Renderform der fachlichen Höhe selbst
 *    (`terrain_dem(_tile)`, 5.32a) und ruft dafür `composeDem`/`demTiles` aus `dem-tiles.ts` regulär
 *    auf (`derive.ts:16`) — das ist keine Verletzung, sondern die Definition seiner Aufgabe. Der
 *    Rechenpfad dagegen darf von dort nur den TYP importieren (`path-profiles.ts:5`,
 *    `import type { StoredRaster }`), nie die Lese-/Dekodierfunktion `decodeDemTile` als
 *    Rechengrundlage — genau das verbietet Regel 1 schon namentlich.
 *
 * Beide Prüfungen sind unabhängig: Eine neue Tabelle ohne erlaubten Namen fällt durch Prüfung A,
 * ein neuer Import in die Darstellungsprodukte fällt durch Prüfung B, auch wenn er über zwei
 * Zwischendateien führt.
 */

const SRC = resolve(import.meta.dirname, "..", "src");
const FORBIDDEN_PATTERN =
    /visual[-_]?relief|display[-_]?height|contour|height[-_]?band|terrain_water_(render|smooth)|decodeDemTile/i;
const TERRAIN_NAME = /\bterrain_[a-z_]+\b/g;

// `terrain_revision` ist keine Tabelle, sondern das Antwortfeld mit dem Kurzschlüssel des Geländeteils der
// Routing-Revision (Plan 6.48) - es liest nichts, deshalb erlaubt.
const COMPUTE_ALLOWED_NAMES = new Set([
    "terrain_raster",
    "terrain_peak",
    // Die Gelände-Sicht der Gipfel (WI-0271, Migration 0268): dieselben Zeilen, nur Berggipfel und Vulkan.
    "terrain_peak_gelaende",
    "terrain_control",
    "terrain_path_profile",
    "terrain_revision",
    "terrain_continental_base",
    // Nur Revisionsbindung, keine Renderkacheln als Rechenhöhe.
    "terrain_dem",
    "terrain_domain_raster",
]);
const GENERATOR_ALLOWED_NAMES = new Set([...COMPUTE_ALLOWED_NAMES, "terrain_dem", "terrain_dem_tile"]);

const FORBIDDEN_IMPORT_DIRS = [
    resolve(SRC, "terrain", "visual-relief"),
    resolve(SRC, "terrain", "display-height"),
    resolve(SRC, "routes"),
];
const DEM_TILES = resolve(SRC, "terrain", "dem-tiles.ts");

function listTsFiles(root: string): string[] {
    return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) return listTsFiles(path);
        return entry.name.endsWith(".ts") ? [path] : [];
    });
}

/** Entfernt Blockkommentare (`/* … *\/`, auch `/** … *\/`), siehe Begründung oben. */
function withoutBlockComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

const computeScopeFiles = [
    ...listTsFiles(resolve(SRC, "routing")),
    resolve(SRC, "terrain", "path-profiles.ts"),
    resolve(SRC, "terrain", "domain", "read.ts"),
    resolve(SRC, "terrain", "peak-cone.ts"),
];

const generatorScopeFiles = [
    resolve(SRC, "terrain", "derive.ts"),
    resolve(SRC, "terrain", "inputs.ts"),
    resolve(SRC, "terrain", "ridge.ts"),
    // Die Gebirgsrechnung V12 liegt seit WI-0226 im gemeinsamen Code (dieselbe Rechnung für die Vorschau im Browser).
    ...listTsFiles(resolve(SRC, "..", "..", "..", "packages", "shared", "src", "gebirge")),
    ...["generate.ts", "inputs.ts", "shape.ts", "materials.ts", "constraints.ts", "lakes.ts"].map((file) =>
        resolve(SRC, "terrain", "domain", file),
    ),
];

interface NameViolation {
    file: string;
    name: string;
}

/** Prüfung A: verbotene Vokabeln und nicht erlaubte `terrain_*`-Namen, im eigenen Quelltext der Scope-Dateien. */
function nameViolations(
    files: string[],
    allowedNames: ReadonlySet<string>,
): { forbidden: string[]; names: NameViolation[] } {
    const forbidden: string[] = [];
    const names: NameViolation[] = [];
    for (const file of files) {
        const text = withoutBlockComments(readFileSync(file, "utf8"));
        if (FORBIDDEN_PATTERN.test(text)) forbidden.push(file);
        for (const match of text.matchAll(TERRAIN_NAME)) {
            const name = match[0];
            if (!allowedNames.has(name)) names.push({ file, name });
        }
    }
    return { forbidden, names };
}

interface ImportEdge {
    from: string;
    to: string;
    typeOnly: boolean;
}

/** Jede relative `import`/`export … from`-Anweisung einer Datei, mit Angabe, ob sie reine Typen sind. */
function importEdgesOf(file: string): ImportEdge[] {
    const text = readFileSync(file, "utf8");
    const edges: ImportEdge[] = [];
    for (const match of text.matchAll(/\b(?:import|export)\s+(type\s+)?[\s\S]*?\sfrom\s+["']([^"']+)["']/g)) {
        const specifier = match[2] as string;
        if (!specifier.startsWith(".")) continue; // node:*, @avesmaps3d/shared, … verlassen src/
        edges.push({ from: file, to: resolve(dirname(file), specifier), typeOnly: Boolean(match[1]) });
    }
    return edges;
}

interface ImportViolation {
    from: string;
    to: string;
    reason: string;
}

/**
 * Prüfung B: Breitensuche über relative Importe, beginnend an den Scope-Dateien. `allowFullDemTiles`
 * gilt für den Generator (er erzeugt `terrain_dem(_tile)` selbst, siehe Begründung oben).
 */
function transitiveImportViolations(entryFiles: readonly string[], allowFullDemTiles: boolean): ImportViolation[] {
    const violations: ImportViolation[] = [];
    const visited = new Set<string>();
    const queue = [...entryFiles];
    while (queue.length > 0) {
        const file = queue.shift() as string;
        if (visited.has(file) || !file.startsWith(SRC + sep)) continue;
        visited.add(file);
        for (const edge of importEdgesOf(file)) {
            const inForbiddenDir = FORBIDDEN_IMPORT_DIRS.some(
                (dir) => edge.to === dir || edge.to.startsWith(dir + sep),
            );
            const isDemTiles = edge.to === DEM_TILES;
            if (inForbiddenDir) {
                violations.push({
                    from: edge.from,
                    to: edge.to,
                    reason: "verbotener Ordner (Darstellungsprodukt oder routes/)",
                });
            } else if (isDemTiles && !edge.typeOnly && !allowFullDemTiles) {
                violations.push({
                    from: edge.from,
                    to: edge.to,
                    reason: "voller Import aus dem-tiles.ts statt `import type`",
                });
            } else if (edge.to.startsWith(SRC + sep) && !visited.has(edge.to)) {
                queue.push(edge.to);
            }
        }
    }
    return violations;
}

function short(path: string): string {
    return path
        .slice(SRC.length + 1)
        .split(sep)
        .join("/");
}

describe("Isolation der fachlichen Höhe (M4, 5.32a Regel 5)", () => {
    it("Rechenpfad (routing/**, path-profiles.ts, peak-cone.ts): keine verbotenen Namen oder Vokabeln", () => {
        const { forbidden, names } = nameViolations(computeScopeFiles, COMPUTE_ALLOWED_NAMES);
        expect(forbidden.map(short)).toEqual([]);
        expect(names.map((v) => `${short(v.file)}: ${v.name}`)).toEqual([]);
    });

    it("Rechenpfad: keine transitiven Importe in Darstellungsprodukte oder routes/, dem-tiles.ts nur als Typ", () => {
        const violations = transitiveImportViolations(computeScopeFiles, false);
        expect(violations.map((v) => `${short(v.from)} -> ${short(v.to)} (${v.reason})`)).toEqual([]);
    });

    it("Generator (derive.ts, inputs.ts, ridge.ts, shared gebirge/**): keine verbotenen Namen oder Vokabeln", () => {
        const { forbidden, names } = nameViolations(generatorScopeFiles, GENERATOR_ALLOWED_NAMES);
        expect(forbidden.map(short)).toEqual([]);
        expect(names.map((v) => `${short(v.file)}: ${v.name}`)).toEqual([]);
    });

    it("Generator: keine transitiven Importe in Darstellungsprodukte oder routes/ (dem-tiles.ts voll erlaubt, er erzeugt es selbst)", () => {
        const violations = transitiveImportViolations(generatorScopeFiles, true);
        expect(violations.map((v) => `${short(v.from)} -> ${short(v.to)} (${v.reason})`)).toEqual([]);
    });
});
