import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { deriveSeaRoutes } from "../routing/sea-derive.ts";
import type { JobContext } from "./handlers.ts";
import { jobDomain, withJobDatabase } from "./job-database.ts";

/**
 * Der Seegraph als Auftrag der Warteschlange (WI-0153 Schnitt 7b; Claudios Einschätzung
 * `project-control/handovers/2026-10-17-seegraph-auftrag-und-0148-antwort-an-claudia.md`). Eingereiht vom Knopf „Seewege neu
 * rechnen“ und von der Freigabe der Wegfindung, wenn sie Werte des Seegraphen freigibt; danach jeweils `routing_reload`, der wartet,
 * bis jede Instanz den neuen Stand geladen hat. Gerechnet als Jobs-Rolle, deren Schreibrecht an `sea_route_graph` in
 * `apps/server/src/db/map-grants.psql` steht.
 *
 * - **Dieselbe Ableitung wie im Zug** (`deriveSeaRoutes`): Sie liest Wasser, Häfen, Sperrgebiete, das Reisemodell und die
 *   FREIGEGEBENEN Werte des Seegraphen (7a, 7c) und schreibt in einer Anweisung; Leser sehen bis dahin den alten Graphen.
 * - **Überholt:** Stimmen Algorithmus und Fingerabdruck der Quellen, rechnet sie nicht und endet mit `ueberholt`. Der Auftrag ist
 *   trotzdem erfolgreich: 🔴 Ein `routing_reload` dahinter läuft dann sofort durch, statt hängen zu bleiben (Claudio 2026-10-17).
 *   Scheitert die Ableitung, entfällt der Reload (`dependency_failed`), und der alte Graph gilt weiter.
 * - **Danach** nichts weiter: Die Worker holen den neuen Graphen über die Revision der Wegfindung (Teil `seaGraph`) von selbst.
 */

type Ableitung = typeof deriveSeaRoutes;

/** Rechnet, wenn sich etwas geändert hat, und sagt, was herauskam. */
export async function leiteSeegraphAb(
    database: Queryable,
    mapDomainId: string,
    ableitung: Ableitung = deriveSeaRoutes,
): Promise<Record<string, unknown>> {
    const report = await ableitung(database, mapDomainId, AVENTURIA_TRAVEL_MODEL);
    const zahlen = {
        fingerprint: report.fingerprint,
        haefen: report.ports,
        ohneAnlegestelle: report.withoutLanding.length,
        knoten: report.nodes,
        kanten: report.edges,
    };
    if (!report.written) return { status: "ueberholt", ...zahlen };
    return { status: "abgeleitet", ...zahlen, ms: Math.round(report.ms.total) };
}

export async function runSeaDeriveJob(context: JobContext): Promise<Record<string, unknown>> {
    const domain = jobDomain(context.job.mapDomainId);
    return withJobDatabase(async (database) => {
        await context.beginPhase("derive", 0);
        return leiteSeegraphAb(database, domain);
    });
}
