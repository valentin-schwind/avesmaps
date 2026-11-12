import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { loadPublishedDomainSource } from "../terrain/domain/read.ts";
import { DEFAULT_CONE } from "../terrain/peak-cone.ts";
import { derivePathProfiles } from "../terrain/path-profiles.ts";
import type { JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";

/**
 * `path_profile` (WI-0128 E13; EDIT-0001 §6.3, N6, W9): die Wegprofile nach einer Kartenoperation. Ein verschobenes Wegende ändert die
 * Geometrie des Wegs; sein gespeichertes Profil passt dann nicht mehr (`geometry_md5`, 0049), und die Route ist bis zur Neuberechnung
 * steigungslos.
 *
 * - Eingereiht von der Schreibnaht (`editor/map-operation.ts`) in der Transaktion der Operation, mit kurzer Wartezeit: Speichervorgänge
 *   kurz nacheinander nehmen den wartenden Job mit, statt einen zweiten anzulegen.
 * - Er rechnet, was `derive:terrain` auch rechnet, gegen den geltenden Master der Domäne (`derivePathProfiles`): nur die Wege, deren
 *   Geometrie oder Höhenstand sich geändert hat; alle anderen bleiben. Deshalb braucht er keine Liste der Wege: Was die Operation
 *   bewegt hat, ist genau das, was nicht mehr passt.
 * - Ohne geltenden Master (eine frische Installation ohne Gelände) gibt es keine Profile; er endet mit dem Befund `kein_master`.
 * - Er hält die geteilte Sperre der Domäne (`kinds.ts`): Ein Import oder eine volle Ableitung wartet, er wartet auf sie.
 */
export async function runPathProfileJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    return withJobDatabase(async (database) => {
        await context.beginPhase("load", 0);
        const source = await loadPublishedDomainSource(database, domain);
        if (source === null) return { finding: "kein_master", computed: 0 };
        await context.beginPhase("profiles", 0.4);
        const report = await derivePathProfiles(
            database,
            domain,
            { domain: source, rasters: [], peaks: [], rule: DEFAULT_CONE },
            AVENTURIA_TRAVEL_MODEL,
        );
        return {
            paths: report.paths,
            computed: report.computed,
            unchanged: report.unchanged,
            removed: report.removed,
            master: source.fingerprint,
        };
    });
}
