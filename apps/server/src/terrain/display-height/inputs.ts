import { createHash } from "node:crypto";
import { DESIGN_CANON } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { loadPublishedDomainSource } from "../domain/read.ts";
import { CONTOUR_OPTIONS, WATER_SMOOTHING, type ContourOptions } from "./contours.ts";
import { DISPLAY_HEIGHT_GENERATOR, type DisplayHeightInput, type DisplayHeightParams } from "./generate.ts";

export interface DisplayHeightInputs {
    input: DisplayHeightInput;
    demRevision: string;
    /** Historical schema column: mirrors demRevision; no separate relief input. */
    reliefRevision: string;
    fingerprint: string;
}

export async function loadDisplayHeightInputs(
    database: Queryable,
    mapDomainId: string,
    params: Readonly<DisplayHeightParams>,
    contours: Readonly<ContourOptions> = CONTOUR_OPTIONS,
): Promise<DisplayHeightInputs> {
    const [current] = await database<{ revision: string; domain_fingerprint: string | null }[]>`
        SELECT revision, domain_fingerprint FROM terrain_dem WHERE map_domain_id = ${mapDomainId} AND is_current
    `;
    if (!current?.domain_fingerprint) throw new Error("Zuerst das Domain-DEM ableiten, verifizieren und aktivieren.");
    const domain = await loadPublishedDomainSource(database, mapDomainId, current.domain_fingerprint);
    if (!domain || domain.revision !== current.revision) throw new Error("Aktuelles Domain-DEM ist nicht lesbar.");
    const areas = await database<{ type: string; geometry: string; area: number }[]>`
        SELECT r.region_type AS type,
            ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(a.geom,'method=structure'),3),15) AS geometry,
            ST_Area(a.geom)::float8 AS area
        FROM region_area a JOIN region r ON r.id = a.region_id AND r.is_active
        WHERE a.map_domain_id = ${mapDomainId} AND a.is_active
            AND r.region_layer = 'topographie' AND r.region_type IN ('meer','see','insel')
        ORDER BY a.public_id
    `;
    const cores = await database<{ x: number; y: number }[]>`
        SELECT ST_X(geom) AS x, ST_Y(geom) AS y FROM terrain_peak_gelaende
        WHERE map_domain_id = ${mapDomainId} AND is_active AND height_schritt > 0
        ORDER BY public_id
    `;
    const fingerprint = createHash("sha256")
        .update(
            `generator:${DISPLAY_HEIGHT_GENERATOR}|params:${JSON.stringify(params)}|contours:${JSON.stringify(contours)}`,
        )
        .update(`|steps:${JSON.stringify(DESIGN_CANON.topography.heightSteps)}|ufer:${String(WATER_SMOOTHING)}`)
        // 🔴 Der Master, nicht seine Kachelrevision (WI-0149): Gerechnet wird aus `terrain_domain_raster`. Stünde
        // hier `domain.revision` - der Hash der Kachelbytes -, wäre jede Änderung an der KODIERUNG eine geänderte
        // Eingabe und löste einen vollen Lauf über die ganze Landfläche aus, der dieselben Linien ergibt (WI-0142:
        // Höhen auf einen Schritt gerundet). Die Bindung an das veröffentlichte Gelände hält der Zeiger.
        .update(`|dem:${domain.fingerprint}|membership:${domain.membershipFingerprint}`)
        .update(JSON.stringify(areas))
        .update(JSON.stringify(cores))
        .digest("hex");
    return {
        input: {
            domain,
            cores: cores.map(({ x, y }) => ({ x, y })),
            water: areas
                .filter((area) => area.type === "meer" || area.type === "see")
                .map((area) => ({ kind: area.type as "meer" | "see", geometry: JSON.parse(area.geometry) })),
            landscapes: areas
                .filter((area) => area.type === "insel")
                .map((area) => ({
                    layer: "topographie",
                    type: "insel",
                    area: area.area,
                    geometry: JSON.parse(area.geometry),
                })),
        },
        demRevision: domain.revision,
        reliefRevision: domain.revision,
        fingerprint,
    };
}
