import type { Database } from "../database.ts";
import { BORDER_RUN_KEY, SHAPE_RUN_KEY } from "./derive-band-runs.ts";

/**
 * Prüfer der Durchläufe gleicher Zeilen (`derive-band-runs.ts`): Jede Zeile gehört zu genau einem Durchlauf, der Durchlauf
 * hat keine Lücke, alle seine Zeilen sind gleich, und er ist so lang wie möglich (die Zeile davor und danach unterscheidet
 * sich). Nur dann darf die Kachel eine Zeile für alle Bänder des Durchlaufs liefern.
 */

export interface RunCheck {
    name: string;
    passed: boolean;
    detail: string;
    offenders: string[];
}

const SAMPLE = 5;

interface RunTable {
    name: string;
    alias: string;
    label: string;
    /** Die Spalten, die zusammen mit dem Gebiet einen Durchlauf bilden (die Grenzart gehört bei Linien dazu). */
    partition: string;
    key: string;
}

const TABLES: RunTable[] = [
    { name: "territory_shape", alias: "s", label: "Formen", partition: "territory_id", key: SHAPE_RUN_KEY },
    {
        name: "territory_border",
        alias: "b",
        label: "Grenzlinien",
        partition: "territory_id, kind",
        key: BORDER_RUN_KEY,
    },
];

export async function verifyBandRuns(database: Database, mapDomainId: string): Promise<RunCheck[]> {
    const checks: RunCheck[] = [];
    for (const table of TABLES) {
        const columns = table.partition.split(", ");
        const same = columns.map((column) => `y.${column} = x.${column}`).join(" AND ");
        const rows = await database.unsafe<{ band: number; id: string; why: string | null }[]>(
            `
            WITH x AS (
                SELECT ${table.alias}.band, ${columns.map((column) => `${table.alias}.${column}`).join(", ")},
                       ${table.alias}.run_from, ${table.alias}.run_to, ${table.key} AS key
                FROM ${table.name} ${table.alias}
                JOIN territory t ON t.id = ${table.alias}.territory_id
                WHERE t.map_domain_id = $1
            )
            SELECT x.band::int AS band, concat_ws('/', ${columns.map((column) => `x.${column}`).join(", ")}) AS id,
                   CASE
                     WHEN x.run_from IS NULL OR x.run_to IS NULL THEN 'kein Durchlauf abgeleitet'
                     WHEN x.band < x.run_from OR x.band > x.run_to THEN 'Band liegt außerhalb ihres Durchlaufs'
                     WHEN EXISTS (
                         SELECT 1 FROM generate_series(x.run_from::int, x.run_to::int) AS g(b)
                         WHERE NOT EXISTS (
                             SELECT 1 FROM x y WHERE ${same} AND y.band = g.b::smallint
                                 AND y.key = x.key AND y.run_from = x.run_from AND y.run_to = x.run_to
                         )
                     ) THEN 'Lücke oder ungleiche Zeile im Durchlauf'
                     WHEN EXISTS (
                         SELECT 1 FROM x y WHERE ${same} AND y.key = x.key AND y.band IN (x.run_from - 1, x.run_to + 1)
                     ) THEN 'Durchlauf nicht so lang wie möglich'
                   END AS why
            FROM x
            `,
            [mapDomainId],
        );
        const bad = rows.filter((row) => row.why !== null);
        checks.push({
            name: `band_runs_${table.name.replace("territory_", "")}`,
            passed: bad.length === 0,
            detail:
                bad.length === 0
                    ? `${String(rows.length)} ${table.label}: jede in genau einem lückenlosen, maximalen Durchlauf gleicher Zeilen`
                    : `${String(bad.length)} Zeilen mit fehlerhaftem Durchlauf`,
            offenders: bad.map((row) => `Band ${String(row.band)} ${row.id}: ${row.why ?? ""}`).slice(0, SAMPLE),
        });
    }
    return checks;
}
