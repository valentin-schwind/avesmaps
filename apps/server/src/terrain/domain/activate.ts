import type { Database } from "../../database.ts";
import { loadPublishedDomainSource } from "./read.ts";
import { loadDomainInputs } from "./inputs.ts";
import { verifyDomainPublication } from "./publish.ts";
import { domainInputFingerprint } from "./fingerprint.ts";
import { DEM_TILE_FORMAT } from "../dem-tiles.ts";
import { resolveTerrainRecipe } from "../auswahl.ts";

/** Changes only the derived publication pointer after independent master and tile verification. */
export async function activateDomainDem(database: Database, domain: string, fingerprint: string): Promise<boolean> {
    return database.begin(async (tx) => {
        const source = await loadPublishedDomainSource(tx, domain, fingerprint);
        if (!source) throw new Error("Missing domain publication for activation");
        const input = await loadDomainInputs(tx, domain);
        const [stored] = await tx<{ input_fingerprint: string }[]>`
            SELECT input_fingerprint FROM terrain_domain_raster WHERE map_domain_id = ${domain} AND fingerprint = ${fingerprint}
        `;
        // Gegen die Fassung dieser Umgebung (WI-0127 SYS-13): Ein Master einer anderen Fassung wird nie aktiviert.
        const recipe = await resolveTerrainRecipe(tx, domain);
        if (stored?.input_fingerprint !== domainInputFingerprint(input.fingerprint, undefined, recipe))
            throw new Error("Domain activation refused: stale inputs or recipe");
        // Die Revision im heutigen Format: Zu einem Master kann zeitweise auch eine PNG-Revision stehen (vor WI-0073).
        const [publication] = await tx<{ revision: string }[]>`
            SELECT revision FROM terrain_dem
            WHERE map_domain_id = ${domain} AND domain_fingerprint = ${fingerprint} AND format = ${DEM_TILE_FORMAT}
            ORDER BY revision LIMIT 1
        `;
        if (!publication) throw new Error("Domain activation refused: publication:missing");
        // Operator 2026-10-03 („A auch für die Prüfungen“): The height constraints (lakes level, summits exact, sea 0,
        // rivers not uphill) no longer refuse the activation; they are findings of the generator report
        // (`report.findings`) and of `verify:domain-terrain`. The publication itself must still be byte-identical to
        // the master: a pointer never goes to tiles that are not the verified master.
        const errors = await verifyDomainPublication(tx, domain, fingerprint, source.raster, publication.revision);
        if (errors.length > 0) throw new Error(`Domain activation refused: ${errors.join(", ")}`);
        const [current] = await tx<{ revision: string }[]>`
            SELECT revision FROM terrain_dem WHERE map_domain_id = ${domain} AND is_current FOR UPDATE
        `;
        if (current?.revision === publication.revision) return false;
        await tx`UPDATE terrain_dem SET is_current = FALSE, superseded_at = now()
            WHERE map_domain_id = ${domain} AND is_current`;
        await tx`UPDATE terrain_dem SET is_current = TRUE, superseded_at = NULL
            WHERE map_domain_id = ${domain} AND revision = ${publication.revision} AND domain_fingerprint = ${fingerprint}`;
        return true;
    });
}
