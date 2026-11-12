import {
    SUBJECT_LIMITS,
    landscapeReaderName,
    ordneGefahren,
    renderZoomForBand,
    wirksameGefahren,
    type SubjectDetail,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { sprachenAbschnitt } from "./sections/sprachen.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { areaGeometry, isGeosTopologyError, type AreaGeometry } from "./context.ts";
import { wikiLine } from "./facts.ts";
import { loadLinkSource } from "./link-pieces.ts";
import { loadRegionSnapshot, regionSnapshotFacts } from "./region-snapshot.ts";
import { loreCarriersOf, loreCounts } from "./sections/lore.ts";
import { areaGroupMembers, canonicalAreaRef, type SubjectIndex } from "./subject-index.ts";
import { pageKeysOf } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Fläche“ (Landschaft, See, Gewässer; `region`): Waldwildnis als reicher Fall, der Hügel der Brinaskquelle als Fall
 * ohne eigene Detaildaten - er trägt Art, Ebene und den KONTEXT seiner ganzen Fläche (Gebiete mit Anteil, überlappende Landschaften,
 * Klima), statt als Box mit nur einem Titel zu erscheinen (WI-0063 5.1, 14). Gleichnamige Regionen gleicher Art und Ebene sind
 * EIN Subject (WI-0047): die Antwort nennt die ganze Gruppe.
 *
 * Eine Landschaft hat keine direkten Textfelder: Beschreibung und Daten kommen aus dem Wiki-Schnappschuss (D6), nie aus einer
 * Beschriftung - die Kennung ist die der Region, nie die eines Labels.
 */

interface AreaRow {
    wiki_url: string | null;
    wiki_region_key: string | null;
}

interface GefahrRow {
    region_layer: string;
    hazards: string[];
}

/** Wie weit man an eine Landschaft heranfährt: wie ein Landschaftstreffer der Suche. */
const AREA_ZOOM = renderZoomForBand(3);

export async function areaDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    const members = areaGroupMembers(index.regions, publicId);
    const ref = canonicalAreaRef(index.regions, publicId);
    const record = index.regions.byPublicId.get(publicId);
    if (!ref || !record || members.length === 0) return null;

    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        // Die Zuordnung der Gruppe: das erste Mitglied mit Schnappschuss-Schlüssel, sonst das erste mit Adresse.
        const [row] = await transaction<AreaRow[]>`
            SELECT wiki_url, wiki_region_key
            FROM region
            WHERE public_id = ANY(${[...members]}::uuid[]) AND is_active
            ORDER BY (wiki_region_key IS NOT NULL) DESC, (wiki_url IS NOT NULL) DESC, public_id
            LIMIT 1
        `;
        // Die Gefahrenlage der Gruppe (WI-0308): jede Art, die ein Mitglied in einer wirksamen Ebene trägt.
        const gefahren = await transaction<GefahrRow[]>`
            SELECT region_layer, hazards FROM region WHERE public_id = ANY(${[...members]}::uuid[]) AND is_active
        `;
        return {
            gefahr: ordneGefahren(gefahren.flatMap((zeile) => wirksameGefahren(zeile.region_layer, zeile.hazards))),
            assignment: row,
            snapshot: row?.wiki_region_key ? await loadRegionSnapshot(transaction, { key: row.wiki_region_key }) : null,
            // Die Linkziele des Artikels dieser Gruppe (Export X1), über den Key der Zuordnung (X2), nie über den Namen.
            linkSource: await loadLinkSource(transaction, index.wikiKeys, pageKeysOf(index.wikiKeys, "area", members)),
            // 🔍 Die Landschaft ist der HAUPTträger der Vorkommen, nicht der Ort (gemessen: 253 Landschaften gegen 141 Orte).
            counts: await readCounts(
                transaction,
                "area",
                members,
                await loreCounts(transaction, index, await loreCarriersOf(transaction, index, "area", members), ref),
            ),
            canon: await readCanon(transaction, "area", members),
        };
    });
    const geometry: AreaGeometry = await areaGeometry(database, index, members).catch((error: unknown) => {
        // Ein Schnittfehler von GEOS lässt den Kontext fehlen, nicht die ganze Auskunft; ein Abbruch durch die Zeitgrenze
        // (503) bleibt ein Abbruch.
        if (isGeosTopologyError(error)) return { context: undefined, extent: null };
        throw error;
    });

    const wikiUrl = loaded.assignment?.wiki_url ?? null;
    const facts = regionSnapshotFacts(loaded.snapshot, wikiUrl, loaded.linkSource);
    const wiki = wikiLine(index, wikiUrl, loaded.snapshot?.name);
    const name = landscapeReaderName(record.name, record.type);
    return {
        subject: ref,
        revision: index.revision,
        ...(name === null ? {} : { title: name }),
        subtitle: [
            ...(record.type === "" ? [] : [{ part: "type" as const, key: record.type }]),
            { part: "layer", key: record.layer },
        ],
        ...(facts.length === 0 ? {} : { facts }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(geometry.context === undefined ? {} : { context: geometry.context }),
        ...(loaded.canon === undefined ? {} : { canon: loaded.canon }),
        ...(loaded.gefahr.length === 0 ? {} : { gefahr: { arten: loaded.gefahr } }),
        ...(loaded.counts === undefined ? {} : { counts: loaded.counts }),
        ...(await sprachenAbschnitt(database, "region", members)),
        ...(geometry.extent === null
            ? {}
            : {
                  target: {
                      x: geometry.extent.x,
                      y: geometry.extent.y,
                      zoom: AREA_ZOOM,
                      bounds: geometry.extent.bounds,
                  },
              }),
    };
}
