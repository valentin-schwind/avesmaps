import type { Queryable } from "../../database.ts";

/**
 * Die Prüfungen des Manifests (JOBS-0001 V2, WI-0125) für `verify:terrain-dem` und `verify:domain-terrain`: Jede Kachel der aktuellen
 * Revision trägt ihre Revision, und die ist der Inhalts-Hash ihrer Bytes; die Pyramide ist vollständig. Bei einem vorläufigen Master
 * (lokal veröffentlicht, D6 = B) dazu: Außerhalb seines Fußabdrucks haben alle Kacheln dieselbe Revision wie die Pyramide, auf
 * die er aufgesetzt wurde, solange die noch steht; und der Master ist ausdrücklich als vorläufig benannt (ein Befund, kein Fehler:
 * der gesammelte volle Lauf ist die Wahrheit).
 *
 * Nur lesend; was hier scheitert, ist ein Befund (`blocking-checks.ts`, Betreiber 2026-10-03), nie ein Abbruch.
 */

export interface ManifestCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders?: string[];
}

/** So viele Kacheln hat eine vollständige Pyramide bis `maxZoom`. */
export function pyramidTileCount(maxZoom: number): number {
    let total = 0;
    for (let z = 0; z <= maxZoom; z += 1) total += 4 ** z;
    return total;
}

/** Die z4-Kacheln (512²) einer Rechenkachel (1024², Index ty * 8 + tx), und die gröberen Kacheln darüber. */
export function demTilesOfComputeTiles(computeTiles: readonly number[], maxZoom: number, perSide = 8): Set<string> {
    const keys = new Set<string>();
    const finestPerCompute = (1 << maxZoom) / perSide;
    for (const index of computeTiles) {
        const tx = index % perSide;
        const ty = Math.floor(index / perSide);
        for (let dy = 0; dy < finestPerCompute; dy += 1)
            for (let dx = 0; dx < finestPerCompute; dx += 1) {
                let x = tx * finestPerCompute + dx;
                let y = ty * finestPerCompute + dy;
                for (let z = maxZoom; z >= 0; z -= 1) {
                    keys.add(`${String(z)}/${String(x)}/${String(y)}`);
                    x >>= 1;
                    y >>= 1;
                }
            }
    }
    return keys;
}

export async function manifestChecks(
    database: Queryable,
    domain: string,
    revision: string,
    masterFingerprint: string,
): Promise<ManifestCheck[]> {
    const checks: ManifestCheck[] = [];
    const [pyramid] = await database<{ max_zoom: number }[]>`
        SELECT max_zoom FROM terrain_dem WHERE map_domain_id = ${domain} AND revision = ${revision}
    `;
    const [counts] = await database<{ total: number; wrong: number; missing: number }[]>`
        SELECT count(*)::int AS total,
            count(*) FILTER (WHERE tile_revision IS DISTINCT FROM left(encode(sha256(png), 'hex'), 16))::int AS wrong,
            count(*) FILTER (WHERE tile_revision IS NULL)::int AS missing
        FROM terrain_dem_tile WHERE revision = ${revision}
    `;
    const expected = pyramid ? pyramidTileCount(pyramid.max_zoom) : 0;
    checks.push({
        name: "Manifest: jede Kachel trägt ihre Revision",
        passed: counts !== undefined && counts.total === expected && counts.wrong === 0,
        detail: `${String(counts?.total ?? 0)} von ${String(expected)} Kacheln, ${String(counts?.wrong ?? 0)} mit falscher und ${String(counts?.missing ?? 0)} ohne Kachelrevision`,
    });

    const [master] = await database<
        { provisional: boolean; base_fingerprint: string | null; local_tiles: number[] | null }[]
    >`
        SELECT provisional, base_fingerprint, local_tiles FROM terrain_domain_raster
        WHERE map_domain_id = ${domain} AND fingerprint = ${masterFingerprint}
    `;
    if (!master?.provisional) return checks;
    const tiles = master.local_tiles ?? [];
    checks.push({
        name: "Master vorläufig (lokal veröffentlicht, voller Lauf ausstehend)",
        // D6 = B: kein Fehler, aber sichtbar, bis der gesammelte volle Lauf ihn ablöst.
        passed: false,
        detail: `Rechenkacheln ${tiles.join(", ")} eingesetzt in ${master.base_fingerprint?.slice(0, 12) ?? "?"}`,
    });
    const [base] = master.base_fingerprint
        ? await database<{ revision: string }[]>`
              SELECT revision FROM terrain_dem
              WHERE map_domain_id = ${domain} AND domain_fingerprint = ${master.base_fingerprint}
              ORDER BY created_at DESC LIMIT 1
          `
        : [];
    if (!base || !pyramid) return checks;
    const inside = demTilesOfComputeTiles(tiles, pyramid.max_zoom);
    const differing = await database<{ z: number; x: number; y: number }[]>`
        SELECT n.z, n.x, n.y FROM terrain_dem_tile n
        LEFT JOIN terrain_dem_tile b ON b.revision = ${base.revision} AND b.z = n.z AND b.x = n.x AND b.y = n.y
        WHERE n.revision = ${revision} AND n.tile_revision IS DISTINCT FROM b.tile_revision
        ORDER BY n.z, n.y, n.x
    `;
    const outside = differing
        .map((tile) => `${String(tile.z)}/${String(tile.x)}/${String(tile.y)}`)
        .filter((key) => !inside.has(key));
    checks.push({
        name: "Kacheln außerhalb des Fußabdrucks unverändert",
        passed: outside.length === 0,
        detail: `${String(differing.length)} Kacheln anders als in ${base.revision}, davon ${String(outside.length)} außerhalb des Fußabdrucks`,
        ...(outside.length > 0 ? { offenders: outside.slice(0, 10) } : {}),
    });
    return checks;
}
