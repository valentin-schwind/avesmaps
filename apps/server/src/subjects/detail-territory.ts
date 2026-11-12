import { SUBJECT_LIMITS, renderZoomForBand, type SubjectClaimant, type SubjectDetail } from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { sprachenAbschnitt } from "./sections/sprachen.ts";
import { resolveTerritoryMedia } from "../media/resolver.ts";
import { effectiveChain } from "../territories/resolve.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { isGeosTopologyError, territoryClimate } from "./context.ts";
import { subjectMedia, wikiLine } from "./facts.ts";
import { loreCarriersOf, loreCounts } from "./sections/lore.ts";
import { territoryChain, type SubjectIndex } from "./subject-index.ts";
import { readTerritoryDetail, spacedParenthesis, territoryFacts } from "./territory-detail-facts.ts";

/**
 * Das Subject „Herrschaftsgebiet“ (`territory`, Daten aus WI-0062): Name, Art, Status, Gültigkeit, Hauptstadt und Sitz, Wappen,
 * Wikizeile, Kanon, Zähler, die Obergebiete über den Baum, dazu (WI-0063 P7, Legacy `createRegionWikiInfoBoxMarkup`) die Anspruchsteller
 * umstrittener Teile („Umstritten mit“) und das Klima. Die Detailfelder des Gebietsexports (E4: Herrschaftsform, Oberhaupt, Gründung,
 * Sprache, Währung, Einwohnerzahl …) liest `territory-detail-facts.ts` aus `territory_detail` (WI-0063 27.18): das Subject zeigt, was da
 * ist, und nimmt keine Zeile ohne Inhalt auf.
 *
 * Der Kontext sind die OBERGEBIETE im Anzeigejahr (Legacys wirksame Kette) und das Klima der Form; ein Gebiet erbt weder Quellen noch
 * Bilder von ihnen.
 */

interface ClaimantRow {
    id: string;
    name: string;
    color: string;
}

/** Das Gebiet und alle, in deren wirksamer Kette es steht: Umstritten sind auch Teile darunter (Legacy `contested_pieces`). */
function subtreeIds(index: SubjectIndex, id: number): number[] {
    const ids = new Set<number>([id]);
    const { nodes, yearBf } = index.territories;
    for (const node of nodes.values()) {
        if (effectiveChain(node.id, nodes, yearBf).some((member) => member.id === id)) ids.add(node.id);
    }
    return [...ids];
}

interface TerritoryRow {
    public_id: string;
    name: string;
    territory_type: string | null;
    wiki_type: string | null;
    status_text: string | null;
    valid_label: string | null;
    wiki_url: string | null;
    capital_id: string | null;
    capital_name: string | null;
    seat_id: string | null;
    seat_name: string | null;
    band: number | null;
    x: number | null;
    y: number | null;
    min_x: number | null;
    min_y: number | null;
    max_x: number | null;
    max_y: number | null;
}

export async function territoryDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    const record = index.territories.byPublicId.get(publicId);
    if (!record) return null;
    const subtree = subtreeIds(index, record.id);
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        const [row] = await transaction<TerritoryRow[]>`
            SELECT t.public_id::text AS public_id, t.name, t.territory_type, t.wiki_type, t.status_text, t.valid_label, t.wiki_url,
                   capital.public_id::text AS capital_id, capital.name AS capital_name,
                   seat.public_id::text AS seat_id, seat.name AS seat_name,
                   shape.band, ST_X(shape.label_geom) AS x, ST_Y(shape.label_geom) AS y,
                   ST_XMin(shape.geom) AS min_x, ST_YMin(shape.geom) AS min_y, ST_XMax(shape.geom) AS max_x, ST_YMax(shape.geom) AS max_y
            FROM territory t
            LEFT JOIN place capital ON capital.public_id = t.capital_place_public_id AND capital.is_active AND NOT capital.is_hidden
            LEFT JOIN place seat ON seat.public_id = t.seat_place_public_id AND seat.is_active AND NOT seat.is_hidden
            LEFT JOIN LATERAL (
                SELECT s.band, s.label_geom, s.geom FROM territory_shape s WHERE s.territory_id = t.id ORDER BY s.band LIMIT 1
            ) shape ON TRUE
            WHERE t.public_id = ${publicId}::uuid AND t.is_active AND t.map_domain_id = ${index.mapDomainId}
        `;
        if (!row) return null;
        return {
            row,
            media: await resolveTerritoryMedia(transaction, publicId),
            // Die Staatsinfobox aus E4 (27.18): die aktive Detailzeile mit der Herkunft je Feld, oder nichts.
            detail: await readTerritoryDetail(transaction, publicId),
            // Die Vorkommen des Gebiets und der Gebiete unter ihm (D5, WI-0091): nur die vier Zahlen, die Namen holt die Sektion.
            counts: await readCounts(
                transaction,
                "territory",
                [publicId],
                await loreCounts(
                    transaction,
                    index,
                    await loreCarriersOf(transaction, index, "territory", [publicId]),
                    {
                        kind: "territory",
                        id: publicId,
                    },
                ),
            ),
            canon: await readCanon(transaction, "territory", [publicId]),
            // Wer das Gebiet oder einen Teil darunter beansprucht, in der Reihenfolge des Anspruchs (Legacy `ORDER BY sort_order, id`).
            claimants: await transaction<ClaimantRow[]>`
                SELECT k.public_id::text AS id, k.name, k.color
                FROM territory_claim c
                JOIN territory k ON k.id = c.claimant_id AND k.is_active
                WHERE c.is_active AND c.territory_id = ANY(${subtree}::bigint[])
                ORDER BY c.sort_order, c.id
            `,
        };
    });
    if (!loaded) return null;
    const { row, media, counts, canon, detail } = loaded;

    // „Umstritten mit“ (Legacy `collectRegionContestedClaimants`): jeder Anspruchsteller einmal, nach Namen; das Gebiet selbst nie.
    const claimants: SubjectClaimant[] = [];
    const seen = new Set<string>([row.name.trim().toLowerCase()]);
    for (const claimant of loaded.claimants) {
        const name = spacedParenthesis(claimant.name).trim();
        const key = name.toLowerCase();
        if (name === "" || seen.has(key) || claimant.id === row.public_id) continue;
        seen.add(key);
        claimants.push({ ref: { kind: "territory", id: claimant.id }, name, color: claimant.color });
    }

    // Das Klima der Form; ein Schnittfehler von GEOS lässt es fehlen, nicht die Auskunft (wie bei einer Fläche).
    let climate: Awaited<ReturnType<typeof territoryClimate>>;
    if (index.territories.derived) {
        try {
            climate = await territoryClimate(database, record.id);
        } catch (error) {
            if (!isGeosTopologyError(error)) throw error;
        }
    }

    // Die Art, wie Legacy sie nennt: erst die des Wikis (mit Klammerzusatz), dann die eigene.
    const typeText = spacedParenthesis(row.wiki_type?.trim() || row.territory_type?.trim() || "");

    // Die Faktenzeilen in Legacys Folge: die eigenen Angaben des Gebiets und die Felder der Staatsinfobox (E4, 27.18).
    const facts = territoryFacts({
        status: row.status_text,
        validity: row.valid_label,
        capital: { id: row.capital_id, name: row.capital_name },
        seat: { id: row.seat_id, name: row.seat_name },
        wikiUrl: row.wiki_url,
        detail,
    });

    // Die Obergebiete: die wirksame Kette ohne das Gebiet selbst, von der Wurzel her.
    const ancestors = territoryChain(index.territories, record.id).filter((member) => member.id !== record.id);
    const wiki = wikiLine(index, row.wiki_url);
    const mediaBlock = subjectMedia(media);
    // Eine Form gibt es nur mit gültiger Ableitung; nach einem Import bleiben alte Zeilen stehen, bis neu abgeleitet ist.
    const hasShape = index.territories.derived && row.band !== null && row.x !== null && row.y !== null;
    return {
        subject: { kind: "territory", id: row.public_id },
        revision: index.revision,
        title: row.name,
        ...(await sprachenAbschnitt(database, "territory", [row.public_id])),
        ...(typeText === "" ? {} : { subtitle: [{ part: "kind" as const, text: typeText }] }),
        ...(mediaBlock === undefined ? {} : { media: mediaBlock }),
        ...(facts.length === 0 ? {} : { facts }),
        ...(wiki === undefined ? {} : { wiki }),
        ...(ancestors.length === 0 && climate === undefined
            ? {}
            : {
                  context: {
                      ...(ancestors.length === 0
                          ? {}
                          : {
                                territories: {
                                    relation: "lies_in" as const,
                                    chains: [
                                        ancestors.map((member) => ({
                                            ref: { kind: "territory" as const, id: member.publicId },
                                            name: member.name,
                                            ...(member.type === null || member.type === ""
                                                ? {}
                                                : { type: member.type }),
                                        })),
                                    ],
                                },
                            }),
                      ...(climate === undefined ? {} : { climate }),
                  },
              }),
        ...(claimants.length === 0 ? {} : { claimants }),
        ...(canon === undefined ? {} : { canon }),
        ...(counts === undefined ? {} : { counts }),
        ...(hasShape
            ? {
                  target: {
                      x: row.x as number,
                      y: row.y as number,
                      zoom: renderZoomForBand(row.band as number),
                      ...(row.min_x === null || row.min_y === null || row.max_x === null || row.max_y === null
                          ? {}
                          : {
                                bounds: [row.min_x, row.min_y, row.max_x, row.max_y] as [
                                    number,
                                    number,
                                    number,
                                    number,
                                ],
                            }),
                  },
              }
            : {}),
    };
}
