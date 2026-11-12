import { randomUUID } from "node:crypto";
import {
    AVENTURIA,
    LANDSCAPE_CREATE_DIGITS,
    LANDSCAPE_CREATE_HANDLE,
    type EditorLandscapeLayer,
    type LandscapeCreateBody,
    type LandscapeCreateReceipt,
    type OperationReceipt,
} from "@avesmaps3d/shared";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { schreibeX2 } from "../wiki/objekt/anschluss.ts";
import { LANDSCHAFT_ART, TEILFLAECHE_ART, mapOperation, type MapActor, type MapAuditEntry } from "./map-operation.ts";
import { wikiEintragZumAnlegen } from "./wiki-eintraege.ts";
import { bereinige, geojsonAus, polygoneVon, ringe, type Punkt } from "./ring-form.ts";

/**
 * „Neue Fläche“ der Derographie (WI-0178 T47, gemeinsamer Ablauf C3): `landscape.create`, eine Fläche samt erster Teilfläche als EINE
 * Operation (Vertrag `LandscapeCreateBody` in `packages/shared/src/landscape-editor.ts`).
 *
 * - **Wie Legacy** (`saveEcosystemAreaRing` in `js/map-features/map-features-ecosystem-draw.js`, `avesmapsCreateEcosystemRegion` in
 *   `api/_internal/app/ecosystem.php`, Mirror a7f2dac8): der Griff „Fläche-001“, die nächste freie Nummer über alle Flächen
 *   (`nextEcosystemRegionAutoName` ohne Art), noch ohne Art und ohne Beschriftung (Owner 26.08.2026: „zeichnen -> Name und Art vergeben
 *   -> Beschriftung anlegen“); ganz vorn in ihrer Ebene (Legacy 19.08.2026 „Das Neueste liegt obenauf“, bei uns Rang +1 wie D1). Ein
 *   Ring, der sich selbst kreuzt, wird repariert (Legacy `repairEcosystemGeometry`); bleibt keine Fläche übrig, 400.
 * - **Eine Operation:** Fläche, Teilfläche und Protokoll (`region.created`, `area.created`) in EINER Transaktion; die Glättung
 *   (`land_smooth`) und die Kacheln stößt die Schreibnaht an (`map-operation.ts`). Ohne Art speist sie kein Gelände.
 * - **Herkunft `avesmaps3d`:** Der Regionsimport (I2) kennt nur `legacy`, die Testwelt legt sie still (`testwelt.ts`).
 * - Läuft der Zug, 503 (`mapOperation`); eine wiederholte Kennung bekommt die erste Quittung samt ihrer Fläche.
 */

const ungueltig = (satz: string): ApiError => new ApiError(400, "validation_failed", satz, { field: "ring" });

/** Der Griff zur Nummer, wie Legacy mit drei Stellen; jenseits von 999 wächst er weiter. */
export const griffMit = (nummer: number): string =>
    `${LANDSCAPE_CREATE_HANDLE}-${String(nummer).padStart(LANDSCAPE_CREATE_DIGITS, "0")}`;

export async function createLandscape(
    database: Database,
    actor: MapActor,
    body: LandscapeCreateBody,
): Promise<LandscapeCreateReceipt> {
    const ring = bereinige([[body.ring as readonly Punkt[]]])[0]![0]!;
    if (ring.length < 3) throw ungueltig("Eine Fläche braucht mindestens drei Ecken.");
    const domain = AVENTURIA.mapDomain;
    const publicId = randomUUID();
    const areaId = randomUUID();
    let name = "";
    const receipt = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "landscape.create", mapDomainId: domain, body },
        async (tx) => {
            const [lage] = await tx<{ inside: boolean | null }[]>`
                SELECT bool_and(map_domain_contains(${domain}, ST_SetSRID(ST_MakePoint(t.x, t.y), 0))) AS inside
                  FROM unnest(${ring.map((p) => p[0])}::float8[], ${ring.map((p) => p[1])}::float8[]) AS t(x, y)
            `;
            if (lage?.inside !== true) throw ungueltig("Eine Ecke liegt außerhalb der Karte.");
            // Kreuzt sich der Ring, bleibt seine reparierte Fläche (ein Polygon oder mehrere); Linien und Punkte daraus fallen weg.
            const [form] = await tx<{ geojson: string | null }[]>`
                SELECT ST_AsGeoJSON(ST_CollectionExtract(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus([[ring]])}), 0)), 3))
                       AS geojson
            `;
            const polygone = form?.geojson ? bereinige(polygoneVon(form.geojson)) : [];
            if (polygone.length === 0 || polygone.every((polygon) => (polygon[0]?.length ?? 0) < 3))
                throw ungueltig("Aus dem Umriss entsteht keine Fläche.");

            // Für einen Wiki-Eintrag (WI-0284): Name, Flächenart und Artikel kommen von ihm, die Tafel X2 schützt die Zuordnung wie in der Wiki-Box.
            const eintrag =
                body.wikiEintrag === undefined
                    ? undefined
                    : await wikiEintragZumAnlegen(tx, body.wikiEintrag, body.layer);
            const neu = await legeLandschaftAn(tx, {
                domain,
                publicId,
                areaId,
                layer: body.layer,
                type: eintrag?.type ?? null,
                polygone,
                ...(eintrag === undefined ? {} : { name: eintrag.name, wiki: { url: eintrag.url, key: eintrag.key } }),
            });
            if (eintrag !== undefined) {
                await schreibeX2(tx, "landschaft", [publicId], {
                    key: eintrag.key,
                    url: eintrag.url,
                    name: eintrag.name,
                });
            }
            name = neu.name;
            return {
                receipt: { affected: neu.affected, derivedWork: [], warnings: [] },
                summary: `${name}: neue Fläche in der Ebene ${body.layer}`,
                entries: neu.entries,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung (`runOperation`): Ihre Fläche ist die aus der Quittung.
    const angelegt = receipt.affected.find((entity) => entity.kind === LANDSCHAFT_ART)?.id ?? publicId;
    if (angelegt !== publicId || name === "") {
        const [vorhanden] = await database<
            { name: string }[]
        >`SELECT name FROM region WHERE public_id = ${angelegt}::uuid`;
        name = vorhanden?.name ?? name;
    }
    return { ...receipt, publicId: angelegt, name };
}

/**
 * Legt eine Landschaft samt erster Teilfläche an, wie „Neue Fläche“ (Griff „Fläche-NNN“, ganz vorn in ihrer Ebene, Herkunft
 * `avesmaps3d`), in der Transaktion des Aufrufers; auch für „herauslösen“ und „zerschneiden“ (Werkzeuge 3 und 5, Legacy `createArea`
 * mit Art und Ebene der Quelle). Mit `name` trägt sie diesen statt des Griffs: Legacy gab dem neuen Stück einen Platzhalter, und
 * Platzhalter will der Betreiber nicht in der Datenbank (Editor-Orchestrierung 2026-10-19: Das Stück übernimmt Name und Art der
 * Quelle, „teilen und trennen“ meint dieselbe Landschaft in zwei Teilen). Gibt Quittungsteile und Protokoll zurück.
 */
/** Der Griff wie Legacy: die nächste freie Nummer. Zwei gleichzeitige Anlagen warten hier aufeinander. */
async function naechsterGriff(tx: Queryable, domain: string): Promise<string> {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`landscape.create:${domain}`}))`;
    const muster = `^${LANDSCAPE_CREATE_HANDLE}-([0-9]+)$`;
    const [nummer] = await tx<{ n: string }[]>`
        SELECT (coalesce(max((substring(name FROM ${muster}))::bigint), 0) + 1)::text AS n
          FROM region WHERE map_domain_id = ${domain} AND name ~ ${muster}
    `;
    return griffMit(Number(nummer?.n ?? 1));
}

export async function legeLandschaftAn(
    tx: Queryable,
    neu: {
        domain: string;
        publicId: string;
        areaId: string;
        layer: EditorLandscapeLayer;
        type: string | null;
        polygone: readonly (readonly (readonly Punkt[])[])[];
        name?: string | undefined;
        /** Der Wiki-Artikel (beim Kopieren unter demselben Namen wie die Quelle, Legacy `ecosystemTransferCarriesWiki`). */
        wiki?: { url: string | null; key: string | null } | undefined;
    },
): Promise<{ name: string; affected: OperationReceipt["affected"]; entries: MapAuditEntry[] }> {
    const { domain, publicId, areaId, layer, type } = neu;
    const name = neu.name ?? (await naechsterGriff(tx, domain));
    const wikiUrl = neu.wiki?.url ?? null;
    const wikiKey = neu.wiki?.key ?? null;
    const [region] = await tx<{ id: string; revision: number; stack_order: number }[]>`
        INSERT INTO region (public_id, map_domain_id, name, region_layer, region_type, stack_order, source_system, is_active,
                            wiki_url, wiki_region_key)
        SELECT ${publicId}::uuid, ${domain}, ${name}, ${layer}, ${type},
               coalesce(max(stack_order), 0) + 1, 'avesmaps3d', TRUE, ${wikiUrl}, ${wikiKey}
          FROM region WHERE map_domain_id = ${domain} AND region_layer = ${layer} AND is_active
        RETURNING id::text, revision::int AS revision, stack_order::int AS stack_order
    `;
    const teil = await legeTeilflaecheAn(tx, {
        domain,
        region: { id: region!.id, publicId },
        areaId,
        polygone: neu.polygone,
    });
    return {
        name,
        affected: [{ kind: LANDSCHAFT_ART, id: publicId, revision: region!.revision }, teil.affected],
        entries: [
            {
                action: "region.created",
                regionId: publicId,
                revisionBefore: null,
                revisionAfter: region!.revision,
                changes: {
                    name: { after: name },
                    layer: { after: layer },
                    ...(type === null ? {} : { type: { after: type } }),
                    order: { after: region!.stack_order },
                    active: { after: true },
                    ...(wikiUrl === null && wikiKey === null ? {} : { wiki: { after: wikiUrl ?? wikiKey } }),
                },
            },
            teil.entry,
        ],
    };
}

/** Eine Teilfläche in einer bestehenden Landschaft, in der Transaktion des Aufrufers (auch für `legeLandschaftAn` und „Kopieren …“). */
export async function legeTeilflaecheAn(
    tx: Queryable,
    neu: {
        domain: string;
        region: { id: string; publicId: string };
        areaId: string;
        polygone: readonly (readonly (readonly Punkt[])[])[];
    },
): Promise<{ affected: OperationReceipt["affected"][number]; entry: MapAuditEntry }> {
    const polygone = neu.polygone as Punkt[][][];
    const [teil] = await tx<{ revision: number }[]>`
        INSERT INTO region_area (public_id, region_id, map_domain_id, geom, geometry_revision, source_system, is_active)
        VALUES (${neu.areaId}::uuid, ${neu.region.id}::bigint, ${neu.domain},
                ST_SetSRID(ST_GeomFromGeoJSON(${geojsonAus(polygone)}), 0), 1, 'avesmaps3d', TRUE)
        RETURNING revision::int AS revision
    `;
    return {
        affected: { kind: TEILFLAECHE_ART, id: neu.areaId, revision: teil!.revision },
        entry: {
            action: "area.created",
            regionId: neu.region.publicId,
            areaId: neu.areaId,
            revisionBefore: null,
            revisionAfter: teil!.revision,
            changes: { geometry: { after: ringe(polygone) }, active: { after: true } },
        },
    };
}
