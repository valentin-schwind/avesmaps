/**
 * Orte des Terrain-Labs (WI-0250 Phase B): die Wurzel des Checkouts, in dem der Adapter liegt, die Datenwurzel außerhalb von Git und die
 * Pfade, die den Generator ausmachen. Alles andere (Auftrag, Messung, Ausgabe) kennt diese Datei nicht.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Wurzel des Checkouts, in dem dieser Adapter liegt (`scripts/dev/terrain-lab/` drei Ebenen höher). */
export const ADAPTER_WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** `AVESMAPS_TERRAIN_LAB`, sonst `C:\avesmaps3d-data\terrain-lab` (wie `terrainlab.daten_wurzel()`). */
export function laborWurzel(umgebung: NodeJS.ProcessEnv = process.env): string {
    return umgebung["AVESMAPS_TERRAIN_LAB"] || "C:\\avesmaps3d-data\\terrain-lab";
}

/** Die abgelösten Arbeitskopien einzelner Commits (`--commit`). */
export function standOrdner(laborDir: string = laborWurzel()): string {
    return join(laborDir, "staende");
}

/**
 * Was „Generator“ ist: Wer hier etwas ändert, ändert das Ergebnis. Ein Messlauf im Arbeitsbaum wird verweigert, solange eines dieser
 * Verzeichnisse von seinem Commit abweicht (geändert oder ungetrackt); gemessen wird nur ein festgelegter Stand.
 */
export const GENERATOR_PFADE = [
    "packages/shared/src",
    "apps/server/src/terrain",
    "apps/web/src/gebirge-vorschau",
    "config/terrain",
] as const;

/** Was ein Stand aus einem Commit braucht (ohne den Rest des Repositorys); fehlende Pfade älterer Commits werden übersprungen. */
export const STAND_PFADE = [
    "packages/shared",
    "apps/server/src",
    "apps/server/package.json",
    "apps/server/test/fixtures/rueckennetz",
    "apps/web/src/gebirge-vorschau",
    "apps/web/package.json",
    // Das Paket `shared` liest beim Laden viele Dateien unter `config/` (Registries); sie sind klein (rund 0,7 MB).
    "config",
    "package-lock.json",
] as const;

/** Die Drittpakete, die der Generator zur Laufzeit lädt; ihre Fassung steht in der `package-lock.json` des Commits. */
export const STAND_ABHAENGIGKEITEN = ["@sinclair/typebox", "postgres"] as const;

/** Ordner der Gebirgs-Fixtures im Checkout (Rückennetz-Fälle aus dem Entwurf). */
export const FIXTURE_ORDNER = "apps/server/test/fixtures/rueckennetz";
