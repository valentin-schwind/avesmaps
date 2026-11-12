import { AVENTURIA_TRAVEL_MODEL } from "@avesmaps3d/shared";
import { settleChecks } from "../../blocking-checks.ts";
import type { Queryable } from "../../database.ts";
import { LAND_TYPES, leseMassstab, pathHeightFingerprint } from "../path-profiles.ts";
import { DEFAULT_CONE } from "../peak-cone.ts";
import { constraintLines } from "./constraint-findings.ts";
import { ignoredMarinePeaks } from "./constraints.ts";
import { domainInputFingerprint } from "./fingerprint.ts";
import { loadDomainInputs } from "./inputs.ts";
import { verifyDomainPublication } from "./publish.ts";
import { loadPublishedDomainSource } from "./read.ts";
import { verifyDomainRaster } from "./verify.ts";
import { terrainRecipeCoverage } from "./coverage.ts";
import { resolveTerrainRecipe } from "../auswahl.ts";
import { manifestChecks } from "./verify-manifest.ts";
import { PROVISIONAL_INPUT_PREFIX } from "./provisional.ts";

export interface DomainCheck {
    name: string;
    passed: boolean;
    detail: string;
    /** Die betroffenen Objekte in Klartext (Seen, Gipfel, Flüsse), wenn die Prüfung welche nennt. */
    offenders?: string[];
    /** Hält ein Ausfall das Urteil an? Sonst ist er ein Befund (`blocking-checks.ts`). */
    blocking?: boolean;
}

export async function verifyCurrentDomain(
    database: Queryable,
    domain: string,
): Promise<{ passed: boolean; checks: DomainCheck[] }> {
    const checks: DomainCheck[] = [];
    const [current] = await database<{ revision: string; domain_fingerprint: string | null }[]>`
        SELECT revision, domain_fingerprint FROM terrain_dem WHERE map_domain_id = ${domain} AND is_current
    `;
    if (!current?.domain_fingerprint)
        return {
            passed: false,
            checks: [{ name: "Domain-DEM aktiv", passed: false, detail: "kein aktives Domain-DEM" }],
        };
    const source = await loadPublishedDomainSource(database, domain, current.domain_fingerprint);
    if (!source) throw new Error("Aktives Domain-DEM nicht lesbar");
    const input = await loadDomainInputs(database, domain);
    const recipe = await resolveTerrainRecipe(database, domain);
    const coverage = terrainRecipeCoverage(input.landscapes, recipe);
    checks.push({
        name: "Terrain-Recipe-Inventar (Lücken bleiben neutral und sichtbar)",
        passed: true,
        detail: JSON.stringify(coverage),
    });
    const [stored] = await database<{ input_fingerprint: string; provisional: boolean }[]>`
        SELECT input_fingerprint, provisional FROM terrain_domain_raster
        WHERE map_domain_id = ${domain} AND fingerprint = ${source.fingerprint}
    `;
    const wanted = domainInputFingerprint(input.fingerprint, undefined, recipe);
    // Ein vorläufiger Master (WI-0125, D6 = B) trägt die Eingaben, mit denen sein Fußabdruck gerechnet wurde.
    const localCurrent = stored?.provisional === true && stored.input_fingerprint === PROVISIONAL_INPUT_PREFIX + wanted;
    checks.push({
        name: "Domain-Eingaben aktuell",
        passed: stored?.input_fingerprint === wanted || localCurrent,
        detail: localCurrent
            ? `${source.fingerprint} (vorläufig, im Fußabdruck mit den heutigen Eingaben)`
            : source.fingerprint,
    });
    const constraints = verifyDomainRaster(source.raster, input, ignoredMarinePeaks(input));
    checks.push({
        name: "Domain-Constraints",
        passed: constraints.errors.length === 0,
        detail: JSON.stringify(constraints),
        // Betreiber 2026-10-03: ein Befund, der Seen, Gipfel und Flüsse mit Namen nennt, kein Abbruch.
        ...(constraints.errors.length > 0 ? { offenders: constraintLines(constraints.errors, input) } : {}),
    });
    // Die aktive Revision, gleich in welchem Format sie abgelegt ist (PNG bis zum ersten Lauf nach WI-0073).
    const publication = await verifyDomainPublication(
        database,
        domain,
        source.fingerprint,
        source.raster,
        current.revision,
    );
    checks.push({
        name: "Published DEM bytegleich",
        passed: publication.length === 0,
        detail: JSON.stringify(publication),
    });
    // Das Manifest der Revision (WI-0125): Kachelrevisionen, Vollständigkeit, bei vorläufigem Master der Fußabdruck.
    checks.push(...(await manifestChecks(database, domain, current.revision, source.fingerprint)));
    const paths = await database<
        {
            min_x: number;
            min_y: number;
            max_x: number;
            max_y: number;
            height_fingerprint: string | null;
            geometry_md5: string | null;
            md5: string;
        }[]
    >`
        SELECT ST_XMin(p.geom) AS min_x, ST_YMin(p.geom) AS min_y, ST_XMax(p.geom) AS max_x, ST_YMax(p.geom) AS max_y,
            h.height_fingerprint, h.geometry_md5, md5(ST_AsBinary(p.geom)) AS md5
        FROM path p LEFT JOIN terrain_path_profile h ON h.path_id = p.id
        WHERE p.map_domain_id = ${domain} AND p.is_active AND p.subtype = ANY(${LAND_TYPES})
    `;
    const heightSource = { domain: source, rasters: [], peaks: [], rule: DEFAULT_CONE };
    // Derselbe Maßstab wie die Ableitung (WI-0153 Schnitt 7d), sonst wäre jedes Profil eines eingestellten Maßstabs „veraltet“.
    const schritt = await leseMassstab(database);
    const stale = paths.filter(
        (path) =>
            path.geometry_md5 !== path.md5 ||
            path.height_fingerprint !==
                pathHeightFingerprint(
                    { minX: path.min_x, minY: path.min_y, maxX: path.max_x, maxY: path.max_y },
                    heightSource,
                    AVENTURIA_TRAVEL_MODEL,
                    schritt,
                ),
    );
    checks.push({
        name: "Domain-Wegprofile aktuell",
        passed: stale.length === 0,
        detail: `${stale.length} von ${paths.length} veraltet`,
    });
    // Betreiber 2026-10-03: Nur Prüfungen aus `BLOCKING_CHECKS` lassen das Urteil scheitern; die übrigen sind Befunde.
    return settleChecks("verify:domain-terrain", checks);
}
