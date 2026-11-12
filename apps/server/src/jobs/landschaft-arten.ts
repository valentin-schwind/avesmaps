/**
 * Die Jobarten der Landschaften (WI-0178 B3) und der Wegnamen (WI-0177): eingereiht von der Schreibnaht (`editor/map-operation.ts`),
 * gerechnet in `jobs/landschaft-folgen-job.ts` und `jobs/weg-folgen-job.ts`. Eine eigene kleine Datei, damit die Schreibnaht die
 * Rechnung nicht mitlädt.
 */
export const LAND_SMOOTH_JOB_KIND = "land_smooth";
export const LABEL_RUNS_JOB_KIND = "label_runs";
export const PATH_LABEL_RUNS_JOB_KIND = "path_label_runs";
