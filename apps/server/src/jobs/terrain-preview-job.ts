import { ApiError } from "../http/api-error.ts";
import { generateDomainTerrain } from "../terrain/domain/generate.ts";
import { loadDomainInputs } from "../terrain/domain/inputs.ts";
import { readDomainSamples } from "../terrain/domain/read.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "../terrain/domain/recipes.ts";
import { mitAenderungen } from "../terrain/hoehenmodell.ts";
import { JobFailure, type JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";

/**
 * Die Jobart `terrain_preview` (WI-0127 SYS-13, SYS-0001 §9c.5 Schritt 2): einen Entwurf des Geländerezepts MESSEN. Ein voller
 * Generatorlauf im Speicher wie die Messskripte der Discovery (`project-control/discovery/d-regionale-erosion/run.mjs`), verglichen mit
 * dem veröffentlichten Master. 🔴 Schreibt keinen Master, keine Kachel, keine Wegprofile, keinen feinen Zwischenspeicher, und rechnet nie
 * auf der gültigen Fassung (Koordination 2026-10-10): Das Rezept ist immer der Entwurf.
 *
 * Eingabe (`input_ref`): `{ draft }`. Ergebnis (klein, in der Jobzeile): Änderung über Land (typisch, Mittel, größter Anstieg und Fall),
 * Tiefland und Gebirge (typisch), Nord, Mitte, Süd (Mittel), höchster Punkt vorher und nachher, Anteil der Landpixel mit anderer
 * Höhenstufe, Laufzeit und Spitze. Höhen in Schritt, ohne Überhöhung (§9c.2 Nr. 3). Eine Messung hält nichts an; entscheiden tut der
 * Betreiber.
 */

/** Grenzen der Höhenstufen für „andere Höhenstufe“ (Schritt). */
const STUFEN = [0, 100, 200, 500, 1000, 1500, 2000, 3000];
const TIEFLAND_BIS = 200;
const GEBIRGE_AB = 1500;
const HIST = 8192;

function stufe(height: number): number {
    let index = 0;
    while (index < STUFEN.length && height >= STUFEN[index]!) index += 1;
    return index;
}

/** Ein Histogramm der Beträge (ganze Schritt) für den Median ohne Sortieren von 67 Millionen Werten. */
class Betraege {
    private readonly counts = new Float64Array(HIST + 1);
    count = 0;
    add(value: number): void {
        this.counts[Math.min(HIST, Math.round(Math.abs(value)))]! += 1;
        this.count += 1;
    }
    median(): number | null {
        if (this.count === 0) return null;
        let seen = 0;
        for (let bin = 0; bin <= HIST; bin += 1) {
            seen += this.counts[bin]!;
            if (seen >= this.count / 2) return bin;
        }
        return HIST;
    }
}

export interface PreviewMeasurement {
    land: { typisch: number | null; mittel: number | null; anstieg: number; fall: number };
    tiefland: { typisch: number | null };
    gebirge: { typisch: number | null };
    streifen: { nord: number | null; mitte: number | null; sued: number | null };
    hoechster: { vorher: number; nachher: number };
    stufenWechsel: number | null;
}

/**
 * Vergleicht zwei Raster (Zeilen von Süden nach Norden gespeichert, Meer = 0). Hat der Entwurf eine andere Größe als der Master, wird
 * je Entwurfspixel der nächste Masterpixel genommen.
 */
export function measure(
    nachher: Uint16Array,
    width: number,
    vorher: Uint16Array,
    widthVorher: number,
): PreviewMeasurement {
    const all = new Betraege();
    const low = new Betraege();
    const high = new Betraege();
    let sum = 0;
    let rise = 0;
    let fall = 0;
    let maxBefore = 0;
    let maxAfter = 0;
    let changedBand = 0;
    const bands = [
        { sum: 0, n: 0 },
        { sum: 0, n: 0 },
        { sum: 0, n: 0 },
    ];
    const scale = widthVorher / width;
    for (let row = 0; row < width; row += 1) {
        // Gespeichert von Süden: die letzte Zeile ist der Norden.
        const fromNorth = width - 1 - row;
        const band = fromNorth < width / 3 ? 0 : fromNorth < (2 * width) / 3 ? 1 : 2;
        const rowBefore = Math.min(widthVorher - 1, Math.floor(row * scale));
        for (let col = 0; col < width; col += 1) {
            const after = nachher[row * width + col]!;
            const before = vorher[rowBefore * widthVorher + Math.min(widthVorher - 1, Math.floor(col * scale))]!;
            if (after > maxAfter) maxAfter = after;
            if (before > maxBefore) maxBefore = before;
            if (after === 0 && before === 0) continue;
            const delta = after - before;
            all.add(delta);
            sum += delta;
            if (delta > rise) rise = delta;
            if (delta < fall) fall = delta;
            if (before < TIEFLAND_BIS) low.add(delta);
            if (before >= GEBIRGE_AB) high.add(delta);
            if (stufe(before) !== stufe(after)) changedBand += 1;
            bands[band]!.sum += delta;
            bands[band]!.n += 1;
        }
    }
    const mean = (entry: { sum: number; n: number }): number | null =>
        entry.n === 0 ? null : Math.round((entry.sum / entry.n) * 10) / 10;
    return {
        land: {
            typisch: all.median(),
            mittel: all.count === 0 ? null : Math.round((sum / all.count) * 10) / 10,
            anstieg: rise,
            fall,
        },
        tiefland: { typisch: low.median() },
        gebirge: { typisch: high.median() },
        streifen: { nord: mean(bands[0]!), mitte: mean(bands[1]!), sued: mean(bands[2]!) },
        hoechster: { vorher: maxBefore, nachher: maxAfter },
        stufenWechsel: all.count === 0 ? null : Math.round((changedBand / all.count) * 10_000) / 10_000,
    };
}

export async function runTerrainPreviewJob(context: JobContext): Promise<Record<string, unknown>> {
    const draft = context.input["draft"];
    if (typeof draft !== "string")
        throw new JobFailure("invalid_input", "draft: die Kennung eines Entwurfs fehlt", false);
    const domain = jobDomain(context.job.mapDomainId);
    await context.beginPhase("eingaben", 0.02);
    const started = performance.now();
    return withJobDatabase(async (database) => {
        const [row] = await database<{ base_version: number; changes: Record<string, number> }[]>`
            SELECT base_version, changes FROM terrain_recipe_draft WHERE id = ${draft}::uuid AND map_domain_id = ${domain}
        `;
        if (!row) throw new JobFailure("draft_missing", "Den Entwurf gibt es nicht", false);
        const basis = AVENTURIA_TERRAIN_RECIPES.get(row.base_version);
        if (!basis)
            throw new JobFailure(
                "version_unknown",
                `Fassung ${String(row.base_version)} fehlt in diesem Release`,
                false,
            );
        let recipe;
        try {
            recipe = mitAenderungen(basis, row.changes);
        } catch (error) {
            throw new JobFailure("invalid_draft", error instanceof ApiError ? error.message : String(error), false);
        }
        const { input, current } = await database.begin("isolation level repeatable read read only", async (tx) => {
            const [master] = await tx<{ fingerprint: string; size: number }[]>`
                SELECT t.fingerprint, t.size
                  FROM terrain_dem d
                  JOIN terrain_domain_raster t ON t.map_domain_id = d.map_domain_id AND t.fingerprint = d.domain_fingerprint
                 WHERE d.map_domain_id = ${domain} AND d.is_current
            `;
            return { input: await loadDomainInputs(tx, domain), current: master ?? null };
        });
        if (current === null)
            throw new JobFailure("no_master", "Es gibt keinen veröffentlichten Master zum Vergleich", false);
        await context.beginPhase("rechnen", 0.1);
        globalThis.gc?.();
        // Ohne feinen Zwischenspeicher: Er gehört der gültigen Fassung, und der Entwurf schreibt nichts.
        const result = generateDomainTerrain(input, recipe, recipe.generator.size);
        await context.beginPhase("messen", 0.9);
        const before = await readDomainSamples(database, domain, current.fingerprint, current.size);
        const measurement = measure(result.raster.samples, result.raster.width, before, current.size);
        return {
            basis: row.base_version,
            aenderungen: row.changes,
            ...measurement,
            ms: Math.round(performance.now() - started),
            rssMb: Math.round(process.resourceUsage().maxRSS / 1024),
            befunde: result.report.findings?.length ?? 0,
        };
    });
}
