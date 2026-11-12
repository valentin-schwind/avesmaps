import { randomUUID } from "node:crypto";
import type { MediaRole } from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { createFinding, type Finding, type FindingObject } from "../findings.ts";
import { MEDIA_EDITOR_SOURCE_SYSTEM } from "../media-editor/upload.ts";
import { loadUsages } from "../media-editor/usage.ts";
import { MEDIA_CONTRACT_VERSION } from "./media-legacy.ts";
import {
    ruleKeyLabel,
    ruleSeedStates,
    seedPublicationRules,
    type RuleSeedResult,
    type RuleSeedState,
} from "./media-rules.ts";

/**
 * Was ein Wechsel der Freigaberegeln an der Öffentlichkeit ändert, Verwendung für Verwendung (WI-0068, Betreiber 2026-10-10): vorher und
 * nachher dieselbe Entscheidung wie Resolver und MAM (`loadUsages` → `decidePublication`), im selben Zustand der Tafeln, nur mit den
 * Regeln vor und nach `seedPublicationRules`. Der Import und das Werkzeug `media:regeln` zeigen damit dieselben Zahlen.
 *
 * 🔴 „Nicht still wegnehmen“: Fällt eine Verwendung aus der Öffentlichkeit (Befund `ki_annahme_entfallen`), steht sie mit Asset und
 * Fachobjekt im Bericht, und das Asset liegt im Korb „Rechte prüfen: früher als KI angenommen“ (`former_ai_assumption`). Ob es bis zur
 * Prüfung öffentlich bleibt, entscheidet der Betreiber (eine Einzelfreigabe `approved` mit seinem Zitat); kein Lauf hält deshalb an.
 */

export interface UsageDecision {
    assetId: string;
    publicId: string;
    role: MediaRole;
    subject: string;
    subjectName: string;
    public: boolean;
    reason: string;
}

/** Je aktiver Verwendung mit Rolle die Entscheidung von jetzt (Schlüssel: Asset, Weg, Fachobjekt, Rolle, Galerie). */
export async function publicationSnapshot(tx: Queryable): Promise<Map<string, UsageDecision>> {
    const assets = await tx<{ id: string; public_id: string }[]>`
        SELECT id::text AS id, public_id::text AS public_id FROM media_asset ORDER BY id
    `;
    const publicIdOf = new Map(assets.map((asset) => [asset.id, asset.public_id]));
    // Ohne Inhaltsschalter: verglichen werden die Regeln, nicht, was die Systemsteuerung gerade zurückhält (WI-0127 SYS-10).
    const usages = await loadUsages(
        tx,
        assets.map((asset) => asset.id),
        { schalter: false },
    );
    const snapshot = new Map<string, UsageDecision>();
    for (const [assetId, list] of usages) {
        for (const usage of list) {
            if (usage.role === null || usage.publication === null) continue;
            const subject = usage.subject === null ? "" : `${usage.subject.kind}:${usage.subject.id}`;
            const key = [assetId, usage.via, subject, usage.role, usage.gallery?.id ?? ""].join("|");
            snapshot.set(key, {
                assetId,
                publicId: publicIdOf.get(assetId) ?? assetId,
                role: usage.role,
                subject,
                subjectName: usage.subject?.name ?? "",
                public: usage.publication.public,
                reason: usage.publication.reason,
            });
        }
    }
    return snapshot;
}

export interface DecisionChange {
    before: UsageDecision;
    after: UsageDecision;
}

/** Die Verwendungen, deren Entscheidung (öffentlich oder Grund) sich geändert hat. */
export function diffSnapshots(
    before: ReadonlyMap<string, UsageDecision>,
    after: ReadonlyMap<string, UsageDecision>,
): DecisionChange[] {
    const changes: DecisionChange[] = [];
    for (const [key, then] of before) {
        const now = after.get(key);
        if (now === undefined) continue;
        if (now.public !== then.public || now.reason !== then.reason) changes.push({ before: then, after: now });
    }
    return changes.sort((a, b) => Number(a.before.assetId) - Number(b.before.assetId));
}

const objectOf = (change: DecisionChange): FindingObject => ({
    table: "media_asset",
    publicId: change.before.publicId,
    name: `${change.before.role} ${change.before.subjectName} (${change.before.reason} → ${change.after.reason})`,
});

/**
 * Die Befunde eines Regelwechsels: was aus der Öffentlichkeit fällt (`ki_annahme_entfallen`), was neu öffentlich wird
 * (`regelwechsel_neu_oeffentlich`), und wie viele öffentlich bleiben, aber über einen anderen Weg (Zahl, kein Befund).
 */
export function ruleSwitchFindings(changes: readonly DecisionChange[]): Finding[] {
    const lost = changes.filter((change) => change.before.public && !change.after.public);
    const gained = changes.filter((change) => !change.before.public && change.after.public);
    const findings: Finding[] = [];
    if (lost.length > 0) {
        findings.push(
            createFinding(
                "ki_annahme_entfallen",
                `Regelwechsel: ${String(lost.length)} Verwendungen waren über die alte Klassenregel öffentlich und sind es nicht mehr (nicht KI-generiert); die Assets liegen im Korb „Rechte prüfen: früher als KI angenommen“. Ob sie bis zur Prüfung öffentlich bleiben, entscheidet der Betreiber`,
                { verwendungen: lost.length, assets: new Set(lost.map((change) => change.before.assetId)).size },
                lost.map(objectOf),
            ),
        );
    }
    if (gained.length > 0) {
        findings.push(
            createFinding(
                "regelwechsel_neu_oeffentlich",
                `Regelwechsel: ${String(gained.length)} Verwendungen werden neu öffentlich`,
                { verwendungen: gained.length },
                gained.map(objectOf),
            ),
        );
    }
    return findings;
}

class DryRunRollback extends Error {}

export interface RuleSwitchReport {
    runId: string;
    dryRun: boolean;
    /** Stand der Regeln des Skripts vor dem Lauf. */
    statesBefore: { rule: string; state: RuleSeedState }[];
    rules: RuleSeedResult;
    /** Verwendungen, deren Entscheidung sich durch den Wechsel ändert (öffentlich oder Grund). */
    changes: DecisionChange[];
    /** Öffentliche Verwendungen vor und nach dem Wechsel, und wie viele davon über eine Regel. */
    before: { public: number; byRule: number };
    after: { public: number; byRule: number };
    findings: Finding[];
}

const tally = (snapshot: ReadonlyMap<string, UsageDecision>): { public: number; byRule: number } => {
    const shown = [...snapshot.values()].filter((decision) => decision.public);
    return { public: shown.length, byRule: shown.filter((decision) => decision.reason === "rule").length };
};

/**
 * Das Werkzeug `media:regeln` (WI-0068): wendet die Regeln des Skripts an (`seedPublicationRules`: anlegen, was fehlt, und abgelöste
 * Vorgängerinnen in DERSELBEN Transaktion widerrufen) und misst davor und danach jede Verwendung. Ohne Zitat (`dryRun`) rollt es zurück,
 * auch das Journal; mit Zitat steht der Lauf in `migration_run` (Domäne `media`, Quelle `media:regeln`) samt Zitat und Zahlen.
 */
export async function switchPublicationRules(
    database: Database,
    options: { dryRun: boolean; operatorSaid?: string | undefined },
): Promise<RuleSwitchReport> {
    const runId = randomUUID();
    const report: RuleSwitchReport = {
        runId,
        dryRun: options.dryRun,
        statesBefore: [],
        rules: { created: 0, present: 0, evidence: 0, superseded: 0, held: [] },
        changes: [],
        before: { public: 0, byRule: 0 },
        after: { public: 0, byRule: 0 },
        findings: [],
    };
    try {
        await database.begin(async (tx) => {
            report.statesBefore = (await ruleSeedStates(tx)).map(({ seed, state }) => ({
                rule: ruleKeyLabel(seed),
                state,
            }));
            await tx`
                INSERT INTO migration_run (id, data_domain, source_system, source_ref, contract_version)
                VALUES (${runId}, 'media', ${MEDIA_EDITOR_SOURCE_SYSTEM}, 'media:regeln', ${MEDIA_CONTRACT_VERSION})
            `;
            const before = await publicationSnapshot(tx);
            report.rules = await seedPublicationRules(tx);
            const after = await publicationSnapshot(tx);
            report.before = tally(before);
            report.after = tally(after);
            report.changes = diffSnapshots(before, after);
            report.findings = ruleSwitchFindings(report.changes);
            await tx`
                UPDATE migration_run
                   SET completed_at = now(), status = 'completed', journal = ${
                       {
                           tool: "media:regeln",
                           operator_said: options.operatorSaid ?? null,
                           rules: report.rules,
                           before: report.before,
                           after: report.after,
                           changes: report.changes.length,
                           findings: report.findings.map((finding) => finding.code),
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
