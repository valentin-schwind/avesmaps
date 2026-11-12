import { randomUUID } from "node:crypto";
import type { MediaRole } from "@avesmaps3d/shared";
import type { Database } from "../database.ts";
import { nameUntitledAssets, type NamedAsset, type RenamedAsset } from "../media-editor/titles.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "../media-editor/upload.ts";
import { MEDIA_CONTRACT_VERSION } from "./media-legacy.ts";

/**
 * Der Nachtrag der Namen für den Bestand (`media:titel`, WI-0068, Betreiber 2026-10-10): jedes Asset ohne Titel bekommt den Namen aus
 * dem Fachobjekt, an dem es hängt, nach derselben Regel wie Import und Bindungen (`media-editor/titles.ts`). Ein Titel, den ein Mensch
 * gesetzt oder bewusst geleert hat, bleibt. Dazu benennt er Namen des Systems neu, die gleich sind, obwohl sie verschiedene Objekte
 * meinen („Wappen von Fasar“ für Stadt und Gebiet → „Wappen von Fasar, Stadt“, Betreiber 2026-10-11). Ohne Zitat (`dryRun`) rollt der
 * Lauf zurück, auch das Journal; mit Zitat steht er in `migration_run` (Domäne `media`, Quelle `media:titel`). Ein zweiter Lauf findet
 * nichts mehr.
 */

class DryRunRollback extends Error {}

export interface TitleBackfillReport {
    runId: string;
    dryRun: boolean;
    /** Assets ohne Titel vor dem Lauf. */
    untitledBefore: number;
    named: NamedAsset[];
    byRole: Record<MediaRole, number>;
    /** Namen des Systems, die eine Unterscheidung bekommen. */
    renamed: RenamedAsset[];
    renamedByRole: Record<MediaRole, number>;
    /** Namen, die mehrere Assets tragen, vor und nach dem Lauf (verschiedene Objekte gleichen Namens). */
    sharedNamesBefore: number;
    sharedNamesAfter: number;
    keptHuman: number;
    withoutSubject: number;
}

export async function backfillAssetTitles(
    database: Database,
    options: { dryRun: boolean; operatorSaid?: string | undefined },
): Promise<TitleBackfillReport> {
    const runId = randomUUID();
    const report: TitleBackfillReport = {
        runId,
        dryRun: options.dryRun,
        untitledBefore: 0,
        named: [],
        byRole: { coat: 0, header: 0, map_full: 0, map_preview: 0, literature_cover: 0, photobox: 0, social_post: 0 },
        renamed: [],
        renamedByRole: {
            coat: 0,
            header: 0,
            map_full: 0,
            map_preview: 0,
            literature_cover: 0,
            photobox: 0,
            social_post: 0,
        },
        sharedNamesBefore: 0,
        sharedNamesAfter: 0,
        keptHuman: 0,
        withoutSubject: 0,
    };
    try {
        await database.begin(async (tx) => {
            const [untitled] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM media_asset WHERE title IS NULL OR btrim(title) = ''
            `;
            report.untitledBefore = untitled?.n ?? 0;
            const sharedNames = async (): Promise<number> => {
                const [row] = await tx<{ n: number }[]>`
                    SELECT count(*)::int AS n
                      FROM (SELECT title FROM media_asset WHERE btrim(coalesce(title, '')) <> '' GROUP BY title HAVING count(*) > 1) s
                `;
                return row?.n ?? 0;
            };
            report.sharedNamesBefore = await sharedNames();
            await tx`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'media', ${MEDIA_EDITOR_SOURCE_SYSTEM}, 'media:titel', ${MEDIA_CONTRACT_VERSION})
            `;
            const result = await nameUntitledAssets(tx, { renameSystem: true });
            report.named = result.named;
            report.renamed = result.renamed;
            for (const asset of result.renamed) report.renamedByRole[asset.role] += 1;
            report.sharedNamesAfter = await sharedNames();
            report.keptHuman = result.keptHuman;
            report.withoutSubject = result.withoutSubject;
            for (const asset of result.named) report.byRole[asset.role] += 1;
            await tx`
                UPDATE migration_run
                   SET completed_at = now(), status = 'completed', journal = ${
                       {
                           tool: "media:titel",
                           operator_said: options.operatorSaid ?? null,
                           untitled_before: report.untitledBefore,
                           named: report.named.length,
                           by_role: report.byRole,
                           renamed: report.renamed.length,
                           renamed_by_role: report.renamedByRole,
                           renamed_titles: report.renamed.map((asset) => ({
                               asset: asset.publicId,
                               before: asset.before,
                               after: asset.title,
                           })),
                           shared_names_before: report.sharedNamesBefore,
                           shared_names_after: report.sharedNamesAfter,
                           kept_human: report.keptHuman,
                           without_subject: report.withoutSubject,
                       } as unknown as string
                   }
                 WHERE id = ${runId}
            `;
            if (options.dryRun) throw new DryRunRollback();
        });
    } catch (error) {
        if (!(error instanceof DryRunRollback)) throw error;
    }
    return report;
}
