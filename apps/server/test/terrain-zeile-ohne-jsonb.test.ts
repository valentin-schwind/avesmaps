import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Die Zeilen der Gelände-Master nie ganz in jsonb wandeln (Stage-Job 2355, 2026-10-19).
 *
 * 🪤 `to_jsonb(t) ->> 'recipe_fingerprint'` sollte eine Spalte lesen, die es vor `migrate` noch nicht gibt. Die Zeile von
 * `terrain_domain_raster` trägt aber den Master (`samples`, size² · 2 Byte); als jsonb-Hex lag er nach dem vollen Lauf unter Fassung 19
 * über der Grenze von 256 MB, und jeder lokale Lauf scheiterte mit „string too long to represent as jsonb string“. Eine fehlende Spalte
 * fragt man über `information_schema.columns` ab, nicht über die ganze Zeile. Dasselbe gilt für `terrain_dem`.
 */
const wurzel = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");
const GROSSE_TAFELN = ["terrain_domain_raster", "terrain_dem"];

describe("Gelände-Master und jsonb", () => {
    it("🔴 keine Datei wandelt eine Zeile von terrain_domain_raster oder terrain_dem mit to_jsonb", () => {
        const funde: string[] = [];
        for (const pfad of readdirSync(wurzel, { recursive: true, encoding: "utf8" })) {
            if (!pfad.endsWith(".ts")) continue;
            const text = readFileSync(join(wurzel, pfad), "utf8");
            for (const tafel of GROSSE_TAFELN) {
                for (const treffer of text.matchAll(new RegExp(`\\b${tafel}\\s+(?:AS\\s+)?([a-z_]\\w*)`, "giu"))) {
                    const alias = treffer[1]!;
                    if (
                        ["on", "where", "set", "join", "using", "group", "order", "limit"].includes(alias.toLowerCase())
                    )
                        continue;
                    if (new RegExp(`(?:to_jsonb|row_to_json|to_json)\\(\\s*${alias}\\s*\\)`, "u").test(text))
                        funde.push(`${pfad.replace(/\\/gu, "/")}: ${tafel} ${alias}`);
                }
            }
        }
        expect(funde).toEqual([]);
    });
});
