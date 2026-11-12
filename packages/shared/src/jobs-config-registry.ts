import { Value } from "@sinclair/typebox/value";
import { JobsProfile, resolveJobsConfig, type JobsConfig } from "./jobs-config.ts";
import localProfile from "../../../config/jobs/local.json" with { type: "json" };
import stagingProfile from "../../../config/jobs/staging.json" with { type: "json" };

/** Lädt ein Profil aus config/jobs, einmal validiert (WI-0074). */
function parseProfile(candidate: unknown, fileName: string): JobsProfile {
    if (!Value.Check(JobsProfile, candidate)) {
        const [firstError] = [...Value.Errors(JobsProfile, candidate)];
        const detail = firstError ? `${firstError.path}: ${firstError.message}` : "unknown validation error";
        throw new Error(`invalid jobs profile in ${fileName} (${detail})`);
    }
    return candidate;
}

/** Die Profile, die es gibt. `production` fehlt absichtlich, bis dort gemessen ist: es läuft dann jede Jobart allein. */
export const JOBS_PROFILES: Readonly<Record<string, JobsProfile>> = {
    local: parseProfile(localProfile, "local.json"),
    staging: parseProfile(stagingProfile, "staging.json"),
};

/** Die aufgelösten Variablen eines Profils; ein unbekannter Name ergibt den Rückfall (alles allein). */
export function getJobsConfig(name: string): JobsConfig {
    return resolveJobsConfig(JOBS_PROFILES[name], name);
}
