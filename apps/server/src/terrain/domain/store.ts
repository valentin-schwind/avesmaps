import type { Queryable } from "../../database.ts";
import { DOMAIN_GENERATOR_VERSION, type DomainTerrainResult } from "./generate.ts";
import type { InputIndex } from "./input-index.ts";

/** Bytes per upload statement; IMPLEMENTATION DETAIL. */
const UPLOAD_SLICE = 8 * 1024 * 1024;

/** Ein vorläufiger Master (WI-0125, D6 = B): der vorige, in den die Rechenkacheln des Fußabdrucks eingesetzt sind. */
export interface ProvisionalOf {
    baseFingerprint: string;
    localTiles: readonly number[];
}

/**
 * Store the master. The driver sends a `bytea` parameter as hexadecimal text: a 128-MiB 8k master in one statement
 * costs several hundred MiB of strings and buffers in this process (WI-0070). It goes up in 8-MiB slices into a
 * temporary row instead and is copied over on the server; the caller's transaction drops the helper table.
 *
 * 🔴 The helper column is `STORAGE EXTERNAL`, like the target column (migration 0062). With the default `EXTENDED` the
 * helper compresses the master (pglz, 128 -> 42 MiB), and `INSERT ... SELECT` keeps the compressed value in the
 * `EXTERNAL` target column: `EXTERNAL` neither compresses nor decompresses. Every `substring()` of the routing
 * loader then has to unpack everything before its slice, so reading 128 slices took 17.8 s on Stage instead of 0.9 s
 * (WI-0071 addendum 3). `domain-raster-storage.test.ts` pins the stored row as uncompressed.
 *
 * Seit WI-0125 trägt die Zeile den Eingabeindex (`input-index.ts`), aus dem `terrain_local` den Fußabdruck einer Änderung bestimmt,
 * und bei einer lokalen Veröffentlichung die Kennzeichen des vorläufigen Masters (`provisional`, Migration 0085).
 */
/** Eine Spalte am Master setzen, die ein älteres Schema noch nicht kennt (Fastify vor `migrate`): dann entfällt sie still. */
async function setzeWennDa(database: Queryable, setze: () => Promise<unknown>): Promise<void> {
    try {
        await database`SAVEPOINT recipe_version`;
        await setze();
        await database`RELEASE SAVEPOINT recipe_version`;
    } catch (error) {
        await database`ROLLBACK TO SAVEPOINT recipe_version`;
        if ((error as { code?: unknown }).code !== "42703") throw error;
    }
}

/**
 * Trägt die Fassung des Rezepts am Master ein (Migration 0100) und den Stand ihres Inhalts (Migration 0209, WI-0239: eine offene Fassung
 * ändert sich in sich). Vor der jeweiligen Migration entfällt der Wert still: Die Fassung steckt dann nur im Eingabe-Fingerabdruck. Je ein
 * SAVEPOINT, damit eine fehlende Spalte weder die Transaktion noch die andere Spalte kostet.
 */
export async function recordRecipeVersion(
    database: Queryable,
    domain: string,
    fingerprint: string,
    recipe: { version: number; fingerprint: string },
): Promise<void> {
    await setzeWennDa(
        database,
        () => database`
            UPDATE terrain_domain_raster SET recipe_version = ${recipe.version}
             WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
        `,
    );
    await setzeWennDa(
        database,
        () => database`
            UPDATE terrain_domain_raster SET recipe_fingerprint = ${recipe.fingerprint}
             WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
        `,
    );
}

/** Ein vorläufiger Master rechnet mit der Fassung seiner Basis weiter, im selben Stand (der lokale Job weigert sich bei einem anderen). */
export async function inheritRecipeVersion(
    database: Queryable,
    domain: string,
    fingerprint: string,
    baseFingerprint: string,
): Promise<void> {
    await setzeWennDa(
        database,
        () => database`
            UPDATE terrain_domain_raster t SET recipe_version = b.recipe_version
              FROM terrain_domain_raster b
             WHERE t.map_domain_id = ${domain} AND t.fingerprint = ${fingerprint}
               AND b.map_domain_id = ${domain} AND b.fingerprint = ${baseFingerprint}
        `,
    );
    await setzeWennDa(
        database,
        () => database`
            UPDATE terrain_domain_raster t SET recipe_fingerprint = b.recipe_fingerprint
              FROM terrain_domain_raster b
             WHERE t.map_domain_id = ${domain} AND t.fingerprint = ${fingerprint}
               AND b.map_domain_id = ${domain} AND b.fingerprint = ${baseFingerprint}
        `,
    );
}

export async function storeDomainRaster(
    database: Queryable,
    domain: string,
    inputFingerprint: string,
    /** Der Master; `report` ist der Bericht des Generators (bei einem vorläufigen Master der der lokalen Veröffentlichung). */
    result: Pick<DomainTerrainResult, "raster" | "fingerprint"> & { report: unknown },
    inputIndex: InputIndex | null = null,
    provisional: ProvisionalOf | null = null,
    /**
     * Die Fassung des Geländerezepts, die diesen Master rechnete, mit dem Stand ihres Inhalts (WI-0127 SYS-13, Migration 0100; WI-0239,
     * Migration 0209); `null`: unbekannt.
     */
    recipe: { version: number; fingerprint: string } | null = null,
): Promise<void> {
    const samples = result.raster.samples;
    const bytes = Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength);
    await database`CREATE TEMP TABLE IF NOT EXISTS domain_raster_upload (samples BYTEA NOT NULL) ON COMMIT DROP`;
    await database`ALTER TABLE domain_raster_upload ALTER COLUMN samples SET STORAGE EXTERNAL`;
    await database`DELETE FROM domain_raster_upload`;
    await database`INSERT INTO domain_raster_upload (samples) VALUES (''::bytea)`;
    for (let offset = 0; offset < bytes.byteLength; offset += UPLOAD_SLICE)
        await database`
            UPDATE domain_raster_upload SET samples = samples || ${bytes.subarray(offset, Math.min(bytes.byteLength, offset + UPLOAD_SLICE))}
        `;
    const index = inputIndex === null ? null : database.json(JSON.parse(JSON.stringify(inputIndex)));
    await database`
        INSERT INTO terrain_domain_raster (map_domain_id, fingerprint, input_fingerprint, generator_version, size, samples, report,
            input_index, provisional, base_fingerprint, local_tiles)
        SELECT ${domain}, ${result.fingerprint}, ${inputFingerprint}, ${DOMAIN_GENERATOR_VERSION}, ${result.raster.width},
            u.samples, ${database.json(JSON.parse(JSON.stringify(result.report)))}, ${index}::jsonb,
            ${provisional !== null}, ${provisional?.baseFingerprint ?? null},
            ${provisional === null ? null : database.array([...provisional.localTiles], 21)}::smallint[]
        FROM domain_raster_upload u
        ON CONFLICT (map_domain_id, fingerprint) DO UPDATE SET input_fingerprint = EXCLUDED.input_fingerprint, report = EXCLUDED.report,
            input_index = COALESCE(EXCLUDED.input_index, terrain_domain_raster.input_index)
    `;
    if (recipe !== null) await recordRecipeVersion(database, domain, result.fingerprint, recipe);
}

/**
 * Trägt den Eingabeindex an einem Master nach, der ohne ihn gespeichert wurde (vor WI-0125). Nur gerufen, wenn die heutigen Eingaben
 * genau die des Masters sind (gleiche `input_fingerprint`): Dann beschreibt der heutige Index ihn.
 */
export async function backfillInputIndex(
    database: Queryable,
    domain: string,
    fingerprint: string,
    inputIndex: InputIndex,
): Promise<boolean> {
    const rows = await database`
        UPDATE terrain_domain_raster SET input_index = ${database.json(JSON.parse(JSON.stringify(inputIndex)))}::jsonb
        WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint} AND input_index IS NULL
        RETURNING fingerprint
    `;
    return rows.length > 0;
}
