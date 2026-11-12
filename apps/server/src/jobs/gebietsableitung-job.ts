import type { Database } from "../database.ts";
import { deriveTerritories } from "../territories/derive.ts";
import { verifyOwnBands } from "../territories/verify-legacy-bands.ts";
import { addAreaEvent, type AreaEventJob } from "./area-events.ts";
import { TERRITORY_DERIVE_JOB_KIND } from "./gebiets-arten.ts";
import type { JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";

/**
 * Die Ableitung der Herrschaftsgebiete als Auftrag der Warteschlange (WI-0209 B3; EDIT-0005 §5; Claudios Einschätzung
 * `project-control/handovers/2026-10-17-herrschaftsgebiete-ableitung-einschaetzung-an-claudia.md`). Eingereiht von der Schreibnaht
 * (`editor/map-operation.ts`) in der Transaktion einer Operation an Gebieten oder Flächen, mit zwei Minuten Sammelzeit; gerechnet als
 * Jobs-Rolle, deren Rechte in `apps/server/src/db/map-grants.psql` stehen.
 *
 * - 🔴 **Der Editor leitet nie selbst ab.** Die App-Rolle liest die Ableitungstafeln nur; eine Operation reiht ein, mehr nicht.
 * - **Eine Transaktion** wie im Zug (`deriveTerritories`): Leser sehen bis zum Ende die alte Ableitung, die Karte zeigt nie „keine
 *   Gebiete“. Der Auftrag setzt `derived_revision` nie auf NULL.
 * - **Nur der betroffene Bereich** (WI-0283): Der Auftrag rechnet als Teillauf; ob das geht, entscheidet der Vergleich mit dem Abdruck des letzten Laufs. Züge und
 *   Importe rechnen voll.
 * - **Überholt:** Hat sich die Eingabe seit der letzten Ableitung nicht geändert (ein Zug hat schon abgeleitet, oder die Operation
 *   änderte nichts, was die Ableitung liest), rechnet er nicht und endet mit `ueberholt` (Inhalts-Hash der Ableitung).
 * - **Danach:** der Nachweis je Band auf unseren Tafeln (N2, `verifyOwnBands`) als Befund im Ergebnis, nie als Abbruch; dann
 *   `map.changed`, damit die Karten den Gebietszeiger neu holen. Die Wegfindung lädt über ihre Revision von selbst nach (die Zollgebiete
 *   stehen darin); die Sammelzeit bündelt das auf höchstens einen Netzaufbau je Ableitung.
 */

/** Rechnet, prüft und meldet; ohne geänderte Eingabe rechnet er nichts und meldet nichts. */
export async function leiteGebieteAb(database: Database, job: AreaEventJob): Promise<Record<string, unknown>> {
    const report = await deriveTerritories(database, { mapDomainId: job.mapDomainId, teilweise: true });
    if (!report.computed) return { status: "ueberholt", revision: report.revision };
    const nachweis = await verifyOwnBands(database, { mapDomainId: job.mapDomainId });
    const abweichend = nachweis.bands.reduce((summe, band) => summe + band.differences.length, 0);
    await addAreaEvent(database, "map.changed", job, {
        operation: TERRITORY_DERIVE_JOB_KIND,
        affected: [{ kind: "territories", revision: report.revision }],
    });
    return {
        status: "abgeleitet",
        // Teillauf oder voller Lauf und warum (WI-0283): die Zahl, an der Claudio die Wirkung misst.
        modus: report.modus,
        vollGrund: report.vollGrund,
        geaenderteFormen: report.geaenderteFormen,
        revision: report.revision,
        territories: report.territories,
        areas: report.areas,
        // Wohin die Zeit geht (WI-0229 S0): die Abschnitte des Laufs und je Band.
        phasesMs: report.phasesMs,
        bandMs: report.bands.map((band) => band.ms),
        nachweis: {
            passed: nachweis.passed,
            derivedMaxBand: nachweis.derivedMaxBand,
            abweichend,
            hierarchie: nachweis.hierarchy.effectiveMismatches.length,
        },
        ...(nachweis.passed ? {} : { finding: "nachweis_abweichend" }),
    };
}

export async function runTerritoryDeriveJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    return withJobDatabase(async (database) => {
        await context.beginPhase("derive", 0);
        return leiteGebieteAb(database, {
            id: context.job.id,
            publicId: context.job.publicId,
            kind: TERRITORY_DERIVE_JOB_KIND,
            mapDomainId: domain,
        });
    });
}
