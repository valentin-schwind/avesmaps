import type { Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { AVENTURIA_TERRAIN_RECIPES } from "./domain/recipes.ts";
import { mitAenderungen, type Handelnde } from "./hoehenmodell.ts";

/**
 * Entwürfe einer neuen Fassung (WI-0127 SYS-13, SYS-0001 §9c.5 Schritte 1 und 2; §9c.12 Frage 2 „A plus“): eine vorhandene Fassung als
 * Basis, nur die freigegebenen Regler geändert, Grund Pflicht. Gemessen wird als Job `terrain_preview` (`jobs/terrain-preview-job.ts`),
 * nie veröffentlicht und nie auf der gültigen Fassung. Zur Fassung wird ein Entwurf, wenn Claudia ihn als Datei einträgt (Option C).
 */

export async function legeEntwurfAn(
    tx: Queryable,
    input: {
        domain: string;
        basis: number;
        aenderungen: Readonly<Record<string, number>>;
        reason: string;
        actor: Handelnde;
    },
): Promise<string> {
    const basis = AVENTURIA_TERRAIN_RECIPES.get(input.basis);
    if (!basis)
        throw new ApiError(
            400,
            "terrain_version_unknown",
            `Fassung ${String(input.basis)} gibt es in diesem Release nicht.`,
        );
    // Prüft Freigabe, Grenzen und das ganze Rezept; wirft 400 `terrain_draft_invalid`.
    mitAenderungen(basis, input.aenderungen);
    const [row] = await tx<{ id: string }[]>`
        INSERT INTO terrain_recipe_draft (map_domain_id, base_version, changes, reason, created_by, created_by_label)
        VALUES (${input.domain}, ${input.basis}, ${tx.json({ ...input.aenderungen })}, ${input.reason},
                ${input.actor.personId}::uuid, ${input.actor.label})
        RETURNING id::text AS id
    `;
    return row!.id;
}

async function offenerEntwurf(
    tx: Queryable,
    domain: string,
    draft: string,
): Promise<{ id: string; measure_job: string | null }> {
    const [row] = await tx<{ id: string; measure_job: string | null }[]>`
        SELECT id::text AS id, measure_job::text AS measure_job FROM terrain_recipe_draft
         WHERE id = ${draft}::uuid AND map_domain_id = ${domain} AND state = 'entwurf'
           FOR UPDATE
    `;
    if (!row) throw new ApiError(404, "terrain_draft_not_found", "Diesen Entwurf gibt es nicht (mehr).");
    return row;
}

/** Reiht die Messung ein (`job_enqueue`, Migration 0100); wartet oder läuft schon eine, 409. */
export async function reiheMessungEin(
    tx: Queryable,
    input: { domain: string; draft: string; actor: Handelnde },
): Promise<string> {
    const row = await offenerEntwurf(tx, input.domain, input.draft);
    if (row.measure_job !== null) {
        const [running] = await tx<{ state: string }[]>`
            SELECT state FROM job WHERE public_id = ${row.measure_job}::uuid AND state IN ('QUEUED', 'RUNNING')
        `;
        if (running)
            throw new ApiError(409, "terrain_measure_running", "Eine Messung dieses Entwurfs wartet oder läuft schon.");
    }
    const [job] = await tx<{ public_id: string }[]>`
        SELECT public_id::text AS public_id
          FROM job_enqueue('terrain_preview', 1::smallint, ${input.domain}, ${input.actor.actorRef}, ${tx.json({ draft: input.draft })})
    `;
    await tx`UPDATE terrain_recipe_draft SET measure_job = ${job!.public_id}::uuid WHERE id = ${input.draft}::uuid`;
    return job!.public_id;
}

export async function verwirfEntwurf(tx: Queryable, input: { domain: string; draft: string }): Promise<void> {
    await offenerEntwurf(tx, input.domain, input.draft);
    await tx`UPDATE terrain_recipe_draft SET state = 'verworfen', discarded_at = now() WHERE id = ${input.draft}::uuid`;
}
