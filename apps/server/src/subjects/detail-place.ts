import {
    SUBJECT_LIMITS,
    placeNearZoom,
    type SubjectDetail,
    type SubjectFact,
    type SubjectSubtitlePart,
} from "@avesmaps3d/shared";
import { withStatementTimeout, type Database } from "../database.ts";
import { sprachenAbschnitt } from "./sections/sprachen.ts";
import { resolvePlaceMediaParts } from "../media/resolver.ts";
import { readCanon, readCounts } from "./carrier-tables.ts";
import { pointContext } from "./context.ts";
import { composeLage, directFact, subjectMedia, wikiFact, wikiLine, type DirectValue } from "./facts.ts";
import { loadLinkSource, textLinks } from "./link-pieces.ts";
import { loreCarriersOf, loreCounts } from "./sections/lore.ts";
import { territoryChain, type SubjectIndex, type TerritoryRecord } from "./subject-index.ts";
import { pageKeysOf } from "./wiki-key-lookup.ts";

/**
 * Das Subject „Ort“ (WI-0063 13: Gareth als reicher Referenzfall, ein Dorf ohne Wikiartikel als bewusst knapper): Kopf,
 * Medien, Felder mit Provenienz, Wikizeile, Kontext AM Ort, Kanon und Zähler. Ein Dorf ohne Wiki zeigt in derselben Struktur
 * nur, was bekannt ist - keine leere Zeile, kein erfundener Text (WI-0063 5.1, 14).
 *
 * 🔴 Die Felder folgen Legacys Anzeige (WI-0063 27.8, Betreiber 2026-10-04: „aussehn wie legacy“), aber der Server liefert den
 * vollen Bestand: Nest- und direkte Werte sind GETRENNTE Fakten, nie zu einem verschmolzen.
 * - Ort MIT Nest: Legacy zeigt nur die Nestwerte. Die eigenen Werte (`description`, `einwohner`, `lage`, `oberhaupt`) kommen
 *   zusätzlich als `layer: "direct"`, `legacyHidden: true`, hinter den Nestfakten.
 * - Ort OHNE Nest: Legacy zeigt die eigene Beschreibung vollständig (`layer: "direct"`, sichtbar); eigene `einwohner`, `lage` und
 *   `oberhaupt` zeigt Legacy nirgends (`legacyHidden: true`).
 * Die Beschreibung bleibt hier vollständig; den ersten Satz bildet die Anzeigeregel (`displayDescription`).
 */

interface PlaceRow {
    public_id: string;
    name: string;
    subtype: string;
    is_ruined: boolean;
    is_hidden: boolean;
    is_underground: boolean;
    is_approximate: boolean;
    place_kind: string | null;
    x: number;
    y: number;
    wiki_url: string | null;
    snapshot_id: string | null;
    wiki_title: string | null;
    wiki_name: string | null;
    s_description: string | null;
    s_einwohner: string | null;
    s_oberhaupt: string | null;
    region_text: string | null;
    staat_text: string | null;
    handelszone: string | null;
    verkehrswege: string | null;
    bevoelkerung: string | null;
    tempel: string | null;
    building_type: string | null;
    s_ruined: boolean | null;
    synced_at: Date | null;
    d_description: string | null;
    d_einwohner: string | null;
    d_lage: string | null;
    d_oberhaupt: string | null;
    einwohner_origin: "wiki" | "manual" | null;
    lage_origin: "wiki" | "manual" | null;
    oberhaupt_origin: "wiki" | "manual" | null;
}

/**
 * Welche Felder des Wiki-Artikels (Legacys Positivliste, Export X1) den angezeigten Text eines Faktes bilden, in der Reihenfolge, in der er sie
 * zusammensetzt. Ein Teilstück wird nur ein Link, wenn sein Linkziel über den Wiki-Key genau ein Objekt der Karte trägt (`link-pieces.ts`,
 * `wiki-key-lookup.ts`); der Name eines Objekts ist nie Schlüssel. Die Lage ist Region, dann Staat (bei einem Bauwerk der Standort). Felder ohne
 * Eintrag (Beschreibung, Einwohner, Bauwerksart) und die Nachbarn eines Ortes (das Panel zeigt sie nicht) tragen keine Links.
 */
const LINK_FIELDS = {
    lage: ["region", "staat", "standort"],
    oberhaupt: ["oberhaupt"],
    verkehrswege: ["verkehrswege"],
    handelszone: ["handelszone"],
    bevoelkerung: ["bevoelkerungsmehrheit"],
    tempel: ["tempel"],
} as const;

function territoryLink(record: TerritoryRecord): { ref: { kind: "territory"; id: string }; name: string } {
    return { ref: { kind: "territory", id: record.publicId }, name: record.name };
}

/** Hauptstadt und Sitz im Anzeigejahr: je Gebiet ein Teil, die Wurzeln zuerst. */
function rolesOf(index: SubjectIndex, publicId: string): SubjectSubtitlePart[] {
    const byDepth = (left: TerritoryRecord, right: TerritoryRecord): number =>
        territoryChain(index.territories, left.id).length - territoryChain(index.territories, right.id).length ||
        left.name.localeCompare(right.name, "de");
    return [
        ...[...(index.territories.capitalOf.get(publicId) ?? [])]
            .sort(byDepth)
            .map((record): SubjectSubtitlePart => ({ part: "capitalOf", territory: territoryLink(record) })),
        ...[...(index.territories.seatOf.get(publicId) ?? [])]
            .sort(byDepth)
            .map((record): SubjectSubtitlePart => ({ part: "seatOf", territory: territoryLink(record) })),
    ];
}

export async function placeDetail(
    database: Database,
    index: SubjectIndex,
    publicId: string,
): Promise<SubjectDetail | null> {
    const loaded = await withStatementTimeout(database, SUBJECT_LIMITS.statementMs, async (transaction) => {
        const [row] = await transaction<PlaceRow[]>`
            SELECT p.public_id::text AS public_id, p.name, p.subtype, p.is_ruined, p.is_hidden, p.is_underground, p.is_approximate,
                   p.place_kind,
                   ST_X(p.geom) AS x, ST_Y(p.geom) AS y,
                   a.wiki_url, a.snapshot_id::text AS snapshot_id, s.wiki_title, s.wiki_name,
                   s.description AS s_description, s.einwohner AS s_einwohner, s.oberhaupt AS s_oberhaupt,
                   s.region_text, s.staat_text, s.handelszone, s.verkehrswege, s.bevoelkerung, s.tempel,
                   s.building_type, s.is_ruined AS s_ruined, s.synced_at,
                   d.description AS d_description, d.einwohner AS d_einwohner, d.lage AS d_lage, d.oberhaupt AS d_oberhaupt,
                   d.einwohner_origin, d.lage_origin, d.oberhaupt_origin
            FROM place p
            LEFT JOIN place_wiki_assignment a ON a.place_id = p.id AND a.is_active
            LEFT JOIN wiki_settlement_snapshot s ON s.id = a.snapshot_id AND s.is_active
            LEFT JOIN place_detail d ON d.place_id = p.id AND d.is_active
            -- 🔴 KEIN Riegel auf is_hidden (WI-0080, Betreiber 2026-10-05): Ein verborgener Ort wird auf der
            -- Karte gefunden und ist danach „ganz normal" - wer ihn anklickt, bekommt sein volles Panel.
            -- Verborgen bleibt er in der Suche (search.ts), in den Listen anderer Objekte (nearby.ts,
            -- powerline-shape.ts, path-route.ts) und bei den Objektlinks aus dem Wiki (resolve-link.ts,
            -- link-index.ts); dort steht der Riegel weiter und gehört dorthin.
            WHERE p.public_id = ${publicId}::uuid AND p.is_active AND p.map_domain_id = ${index.mapDomainId}
        `;
        if (!row) return null;
        return {
            row,
            linkSource: await loadLinkSource(
                transaction,
                index.wikiKeys,
                pageKeysOf(index.wikiKeys, "place", [publicId]),
            ),
            // Mit den freigegebenen Reisebildern des Ortes (WI-0272 S5): Sie stehen im Kopf, in jeder Kartenansicht, hinter einer Ortsansicht oder statt der Typbilder.
            media: await resolvePlaceMediaParts(transaction, publicId, { reisebilder: true }),
            // Die Vorkommen brauchen das tiefste Gebiet am Punkt des Orts (D5, `lore.yaml` -> `ortsbezug.lesebezug`); darum
            // stehen sie nicht in der gemeinsamen Zählabfrage. In der Antwort sind es NUR die vier Zahlen - die Namen holt
            // die Sektion `lore` beim Aufklappen (WI-0091 §4.1).
            counts: await readCounts(
                transaction,
                "place",
                [publicId],
                await loreCounts(
                    transaction,
                    index,
                    await loreCarriersOf(transaction, index, "place", [publicId], { x: row.x, y: row.y }),
                    { kind: "place", id: publicId },
                ),
            ),
            canon: await readCanon(transaction, "place", [publicId]),
        };
    });
    if (!loaded) return null;
    const { row, linkSource, media, counts, canon } = loaded;

    const direct = (value: string | null, origin: DirectValue["origin"]): DirectValue => ({ value, origin });
    const wiki = (value: string | null): { value: string | null; wikiUrl: string | null; syncedAt: Date | null } => ({
        value,
        wikiUrl: row.wiki_url,
        syncedAt: row.synced_at,
    });
    const hasNest = row.snapshot_id !== null;
    const lage = composeLage(row.region_text, row.staat_text);
    // Das Wiki-Nest: nur, was Legacy zeigt (Ort MIT Nest).
    const nestFacts: SubjectFact[] = hasNest
        ? [
              ...wikiFact("description", wiki(row.s_description)),
              ...wikiFact("oberhaupt", wiki(row.s_oberhaupt), {
                  links: textLinks(linkSource, LINK_FIELDS.oberhaupt, row.s_oberhaupt),
              }),
              ...wikiFact("einwohner", wiki(row.s_einwohner)),
              // Die Lage setzt der Leser aus Region und Staat zusammen; die Linkziele beider Felder stehen im Artikel (Export X1), der Name macht keinen Link.
              ...wikiFact("lage", wiki(lage), { links: textLinks(linkSource, LINK_FIELDS.lage, lage) }),
              ...wikiFact("verkehrswege", wiki(row.verkehrswege), {
                  links: textLinks(linkSource, LINK_FIELDS.verkehrswege, row.verkehrswege),
              }),
              ...wikiFact("handelszone", wiki(row.handelszone), {
                  links: textLinks(linkSource, LINK_FIELDS.handelszone, row.handelszone),
              }),
              ...wikiFact("bevoelkerung", wiki(row.bevoelkerung), {
                  links: textLinks(linkSource, LINK_FIELDS.bevoelkerung, row.bevoelkerung),
              }),
              ...wikiFact("tempel", wiki(row.tempel), {
                  links: textLinks(linkSource, LINK_FIELDS.tempel, row.tempel),
              }),
              ...wikiFact("buildingType", wiki(row.building_type)),
          ]
        : [];
    // Die eigenen Werte (`place_detail`): die Beschreibung zeigt Legacy nur ohne Nest, die übrigen drei nirgends. Die Beschreibung
    // ist ein redaktioneller Text ohne Herkunft.
    const directFacts: SubjectFact[] = [
        ...directFact("description", direct(row.d_description, null), row.wiki_url, hasNest),
        ...directFact("oberhaupt", direct(row.d_oberhaupt, row.oberhaupt_origin), row.wiki_url, true),
        ...directFact("einwohner", direct(row.d_einwohner, row.einwohner_origin), row.wiki_url, true),
        ...directFact("lage", direct(row.d_lage, row.lage_origin), row.wiki_url, true),
    ];
    const facts: SubjectFact[] = [...nestFacts, ...directFacts];

    const subtitle: SubjectSubtitlePart[] = [
        { part: "type", key: row.subtype },
        ...(row.place_kind !== null && row.place_kind.trim() !== ""
            ? [{ part: "kind" as const, text: row.place_kind }]
            : []),
        // Ruine: das Merkmal des Orts ODER des Wiki-Nests (Legacy `locationTypeLabelForDisplay`).
        ...(row.is_ruined || row.s_ruined === true ? [{ part: "ruin" as const }] : []),
        // Unterirdisch (WI-0128 E21, EDIT-0001 D21): ein Merkmal, das nur der Editor setzt; das Panel nennt es hinter dem Ortstyp.
        ...(row.is_underground ? [{ part: "underground" as const }] : []),
        // Ungefähre Lage (WI-0267, Kanal OPS-000067): ebenso ein Merkmal des Editors, hinter dem Ortstyp.
        ...(row.is_approximate ? [{ part: "approximate" as const }] : []),
        ...rolesOf(index, row.public_id),
    ];

    const context = await pointContext(database, index, { x: row.x, y: row.y }, "lies_in", { rivers: false });
    const wikiUrl = wikiLine(index, row.wiki_url, row.wiki_title ?? row.wiki_name);
    const mediaBlock = subjectMedia(media.delivered, media.withheld);
    return {
        subject: { kind: "place", id: row.public_id },
        revision: index.revision,
        title: row.name,
        subtitle,
        ...(mediaBlock === undefined ? {} : { media: mediaBlock }),
        ...(facts.length === 0 ? {} : { facts }),
        ...(wikiUrl === undefined ? {} : { wiki: wikiUrl }),
        ...(context === undefined ? {} : { context }),
        ...(canon === undefined ? {} : { canon }),
        // Verborgen (WI-0080): Der Kopf des Panels stellt dafür die Pille „Verborgen“ neben das Kanon-Etikett. Das Merkmal steht nur
        // da, wo es zutrifft - der Client liest den Vertrag, er fragt nicht die Karte.
        ...(row.is_hidden ? { hidden: true as const } : {}),
        ...(counts === undefined ? {} : { counts }),
        target: { x: row.x, y: row.y, zoom: placeNearZoom(row.subtype) },
        ...(await sprachenAbschnitt(database, "place", [row.public_id])),
    };
}
