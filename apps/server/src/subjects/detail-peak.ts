import { SUBJECT_LIMITS, renderZoomForBand, type SubjectDetail } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { resolvePlaceMedia } from "../media/resolver.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { pointContext } from "./context.ts";
import { subjectMedia, wikiLine } from "./facts.ts";
import { loadLinkSource } from "./link-pieces.ts";
import { loadRegionSnapshot, regionSnapshotFacts } from "./region-snapshot.ts";
import { loreCarriersOf, loreCounts } from "./sections/lore.ts";
import type { SubjectIndex } from "./subject-index.ts";
import { pageKeysOf } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Gipfel“ (Gipfel und Vulkane, `terrain_peak`): D6 trägt ihren Wiki-Text (derselbe Schnappschuss wie die
 * Landschaft), D1 ihre Quellen und ihren Kanon. Der Kontext liegt AM Punkt des Gipfels (Gebiete, Landschaften, Klima).
 */

interface PeakRow {
    public_id: string;
    name: string;
    subtype: string;
    merkmale: string[];
    x: number;
    y: number;
    wiki_url: string | null;
    snapshot_id: string | null;
}

/** Wie weit man an einen Gipfel heranfährt: wie bei einem Landschaftstreffer der Suche. */
const PEAK_ZOOM = renderZoomForBand(3);

export async function peakDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        const [row] = await transaction<PeakRow[]>`
            SELECT t.public_id::text AS public_id, t.name, t.subtype, t.merkmale, ST_X(t.geom) AS x, ST_Y(t.geom) AS y,
                   a.wiki_url, a.snapshot_id::text AS snapshot_id
            FROM terrain_peak t
            LEFT JOIN terrain_peak_wiki_assignment a ON a.terrain_peak_id = t.id AND a.is_active
            WHERE t.public_id = ${publicId}::uuid AND t.is_active AND t.map_domain_id = ${index.mapDomainId}
        `;
        if (!row) return null;
        // Eine Landmarke aus einem Ort (WI-0271 L8) zeigt seine Bilder: Sie bleiben am Ort, der Verweis führt zu ihnen.
        const [ausOrt] = await transaction<{ id: string }[]>`
            SELECT b.ziel_public_id::text AS id FROM terrain_peak_bezug b JOIN terrain_peak t ON t.id = b.terrain_peak_id
             WHERE t.public_id = ${publicId}::uuid AND b.is_active AND b.ziel_art = 'place' AND b.rolle = 'umgewandelt_aus'
             LIMIT 1
        `;
        return {
            row,
            media: ausOrt === undefined ? [] : await resolvePlaceMedia(transaction, ausOrt.id),
            snapshot: row.snapshot_id ? await loadRegionSnapshot(transaction, { id: row.snapshot_id }) : null,
            linkSource: await loadLinkSource(
                transaction,
                index.wikiKeys,
                pageKeysOf(index.wikiKeys, "peak", [publicId]),
            ),
            // 🔍 Gipfel tragen Vorkommen, und zwar fünf von ihnen (gemessen: Plateau des Feuers, Schlund, Visra, Wyrmenhorn,
            // Zwanfirszahn mit zusammen neun Einträgen). Dass sie welche haben, war vor WI-0091 nicht gemessen.
            counts: await readCounts(
                transaction,
                "peak",
                [publicId],
                await loreCounts(transaction, index, await loreCarriersOf(transaction, index, "peak", [publicId]), {
                    kind: "peak",
                    id: publicId,
                }),
            ),
            canon: await readCanon(transaction, "peak", [publicId]),
        };
    });
    if (!loaded) return null;
    const { row, media, snapshot, linkSource, counts, canon } = loaded;
    const mediaBlock = subjectMedia(media);

    const facts = regionSnapshotFacts(snapshot, row.wiki_url, linkSource);
    const context = await pointContext(database, index, { x: row.x, y: row.y }, "lies_in", { rivers: false });
    const wiki = wikiLine(index, row.wiki_url, snapshot?.name);
    return {
        subject: { kind: "peak", id: row.public_id },
        revision: index.revision,
        title: row.name,
        // Unterirdisch und ungefähre Lage nennt das Panel hinter der Art, wie am Ort (WI-0271 §17). Verborgen: das Panel steht offen wie beim Ort, wer sie auf der Karte findet, sieht alles (`detail-place.ts`).
        subtitle: [
            { part: "type", key: row.subtype },
            ...(row.merkmale.includes("unterirdisch") ? [{ part: "underground" as const }] : []),
            ...(row.merkmale.includes("ungefaehr") ? [{ part: "approximate" as const }] : []),
        ],
        ...(row.merkmale.includes("verborgen") ? { hidden: true as const } : {}),
        ...(facts.length === 0 ? {} : { facts }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(context === undefined ? {} : { context }),
        ...(mediaBlock === undefined ? {} : { media: mediaBlock }),
        ...(canon === undefined ? {} : { canon }),
        ...(counts === undefined ? {} : { counts }),
        target: { x: row.x, y: row.y, zoom: PEAK_ZOOM },
    };
}
