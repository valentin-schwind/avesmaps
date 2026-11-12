import type { EditorPlaceSites, EditorSite, EditorSiteOrigin, EditorSiteSourceKind } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { nachfolgerSql } from "./nachfolgesitz.ts";
import { staettenSichtSql } from "../subjects/sections/staetten-sicht.ts";

/**
 * Die Stätten an einem Ort über Kennungen (WI-0128 E18, WI-0134, Migration 0099; Vertrag `packages/shared/src/editor-sites.ts`).
 *
 * 🔴 **Seit dem Betreiberentscheid vom 2026-10-13 („ja zu allen drei“) gilt Lesart B** (`subjects/sections/staetten-sicht.ts`):
 * Beziehung, sonst der ERSTE genannte Ort. Dieser Leser zeigt dem Editor, woran eine Zeile hängt: `bound` trägt eine
 * gespeicherte Beziehung, `open` steht nur über die Kette da. `sichtbar.count` ist die Zahl, die das Infopanel zeigt - sie ist
 * größer, weil die Wiki-Registry mitzählt, die keine `site`-Objekte liefert und darum nicht bindbar ist.
 *
 * 🔴 **Nie aus Namen binden.** `bound` kommt ausschließlich aus `site_settlement` (Legacys gespeicherte Kennung oder der
 * Entscheid eines Menschen). `open` ist Evidenz über `site_named_place.target_key` → Zuordnung X2 (`wiki_key_assignment`) →
 * aktiver Ort: ein Link auf einen Artikel, mehr nicht. Die 603 Wege-Rohkandidaten des Zugs 0028 stehen darum unter `open` und
 * zählen nirgends als „innerorts“.
 *
 * 🪤 **B2: Nur ein Mensch hält eine Stätte aus `open` heraus.** Eine gespeicherte Beziehung ohne Ort („keine Stadt“) mit
 * Herkunft `wiki` oder `gespeichert` ist kein Entscheid, sondern das Protokoll eines Laufs, der nichts fand - 43 Punkte tragen
 * sie, einer trägt `manual`. Darum schließen nur `place_id IS NOT NULL` und die Herkünfte `manual`/`editor` aus. Die Herkunft
 * reist an der Zeile mit (`relation.origin` ohne `placePublicId`), damit der Reiter sagen kann, woran man ist.
 *
 * 🪤 Und `open` nennt nur, was die Kette an ERSTER Stelle hierher legt. Eine Stätte, deren Kette diesen Ort erst an zweiter
 * Stelle nennt, gehört dem zuerst genannten und steht dort - sonst stünde sie in zwei Arbeitslisten, und zwei Editoren bänden
 * sie an zwei Orte.
 */

interface SiteRow {
    id: string;
    name: string;
    source_kind: string;
    source_key: string;
    site_type: string | null;
    site_class: string | null;
    seat_role: string | null;
    seat_order: number | null;
    wiki_url: string | null;
    wiki_key: string | null;
    raw_location: string | null;
    on_map: boolean;
    jump: string | null;
    relation_origin?: string | null;
    relation_legacy_id?: string | null;
    relation_place?: string | null;
    site_active?: boolean;
    successor_id?: string | null;
    successor_name?: string | null;
    successor_location?: string | null;
}

interface NamedRow {
    site_id: string;
    position: number;
    target_raw: string;
    target_key: string | null;
    place_public_id: string | null;
    place_name: string | null;
}

function siteOf(row: SiteRow, named: readonly NamedRow[] = []): EditorSite {
    const wiki =
        row.wiki_url !== null || row.wiki_key !== null
            ? {
                  ...(row.wiki_url !== null ? { url: row.wiki_url } : {}),
                  ...(row.wiki_key !== null ? { key: row.wiki_key } : {}),
              }
            : undefined;
    const origin = row.relation_origin ?? null;
    return {
        id: row.id,
        name: row.name,
        sourceKind: row.source_kind as EditorSiteSourceKind,
        sourceKey: row.source_key,
        ...(row.site_type !== null ? { type: row.site_type } : {}),
        ...(row.site_class !== null ? { siteClass: row.site_class } : {}),
        ...(row.seat_role !== null && row.seat_order !== null
            ? { seat: { role: row.seat_role, order: row.seat_order } }
            : {}),
        ...(wiki ? { wiki } : {}),
        ...(row.raw_location !== null ? { rawLocation: row.raw_location } : {}),
        ...(row.on_map ? { onMap: true as const } : {}),
        ...(row.jump != null ? { jump: { kind: "place" as const, id: row.jump } } : {}),
        ...(row.site_active === false ? { retired: true as const } : {}),
        ...(row.successor_id != null && row.successor_name != null
            ? {
                  successor: {
                      id: row.successor_id,
                      name: row.successor_name,
                      ...(row.successor_location != null ? { rawLocation: row.successor_location } : {}),
                  },
              }
            : {}),
        ...(origin !== null
            ? {
                  relation: {
                      origin: origin as EditorSiteOrigin,
                      ...(row.relation_legacy_id != null ? { legacyPublicId: row.relation_legacy_id } : {}),
                      ...(row.relation_place != null ? { placePublicId: row.relation_place } : {}),
                  },
              }
            : {}),
        ...(named.length > 0
            ? {
                  named: named.map((zeile) => ({
                      raw: zeile.target_raw,
                      ...(zeile.target_key !== null ? { key: zeile.target_key } : {}),
                      ...(zeile.place_public_id !== null ? { placePublicId: zeile.place_public_id } : {}),
                      ...(zeile.place_name !== null ? { placeName: zeile.place_name } : {}),
                  })),
              }
            : {}),
    };
}

/**
 * Die Stätten eines Orts: belegt, offen genannt, dazu die Vergleichszahl des heutigen sichtbaren Lesers. `undefined`, wenn es
 * den Ort nicht (mehr) gibt.
 */
export async function readPlaceSites(database: Queryable, publicId: string): Promise<EditorPlaceSites | undefined> {
    const [ort] = await database<{ id: string; name: string; wiki_keys: string[] }[]>`
        SELECT p.id::text AS id, p.name,
               coalesce(array_agg(DISTINCT a.wiki_key) FILTER (WHERE a.wiki_key IS NOT NULL), '{}') AS wiki_keys
          FROM place p
          LEFT JOIN wiki_key_assignment a
                 ON a.is_active AND a.legacy_art = 'siedlung' AND a.object_public_id = p.public_id
         WHERE p.public_id = ${publicId}::uuid AND p.is_active
         GROUP BY p.id, p.name
    `;
    if (!ort) return undefined;

    // 🪤 Der Sprung ⊕ gilt nur für `punkt`: Nur dort IST Legacys Kennung eine `public_id`. Ein Sitz trägt „Organisation U+001F
    // Ortsangabe“, und `::uuid` darauf ist ein Laufzeitfehler (22P02), kein leeres Ergebnis - auch dann, wenn daneben
    // `source_kind = 'punkt'` steht: Die Reihenfolge der Bedingungen ist nicht zugesichert. Das CASE sichert sie zu.
    const jump = database.unsafe(
        `LEFT JOIN place j ON j.is_active AND j.public_id =
             (CASE WHEN s.source_kind = 'punkt' THEN s.source_key END)::uuid`,
    );

    /*
     * 🔴 B4: Eine STILLGELEGTE Stätte mit hängender Beziehung steht hier mit, nicht nur die aktiven. Sonst verschwände die
     * Zeile still, sobald ein Zug den Sitz ablöst - samt der Entscheidung, die ein Mensch daran gehängt hat.
     * 🔴 Der Nachfolgesitz kommt aus `nachfolgesitz.ts` - demselben Ausdruck, den das Umhängen selbst benutzt.
     */
    // Dieselbe Regel wie beim Umhängen selbst, aus EINEM Ausdruck: Sonst erschiene ein Knopf, den der Schreiber ablehnt.
    const nachfolger = database.unsafe(`LEFT JOIN LATERAL (${nachfolgerSql("s", "ss.place_id")}) n ON n.treffer = 1`);

    const bound = await database<SiteRow[]>`
        SELECT s.id::text AS id, s.name, s.source_kind, s.source_key, s.site_type, s.site_class, s.seat_role, s.seat_order,
               s.wiki_url, s.wiki_key, s.raw_location, s.on_map, s.is_active AS site_active, j.public_id::text AS jump,
               ss.origin AS relation_origin, ss.settlement_legacy_public_id::text AS relation_legacy_id,
               rp.public_id::text AS relation_place,
               n.id::text AS successor_id, n.name AS successor_name, n.raw_location AS successor_location
          FROM site s
          JOIN site_settlement ss ON ss.site_id = s.id AND ss.is_active
          LEFT JOIN place rp ON rp.id = ss.place_id
          ${jump}
          ${nachfolger}
         WHERE ss.place_id = ${ort.id}::bigint
         ORDER BY lower(s.name), s.id
    `;

    const open =
        ort.wiki_keys.length === 0
            ? []
            : await database<SiteRow[]>`
                  SELECT DISTINCT ON (s.id)
                         s.id::text AS id, s.name, s.source_kind, s.source_key, s.site_type, s.site_class, s.seat_role,
                         s.seat_order, s.wiki_url, s.wiki_key, s.raw_location, s.on_map, j.public_id::text AS jump,
                         ss.origin AS relation_origin
                    FROM site s
                    JOIN site_named_place np ON np.site_id = s.id AND np.target_key = ANY(${ort.wiki_keys}::text[])
                    LEFT JOIN site_settlement ss ON ss.site_id = s.id AND ss.is_active
                    ${jump}
                   WHERE s.is_active
                     AND NOT EXISTS (
                         SELECT 1 FROM site_settlement x
                          WHERE x.site_id = s.id AND x.is_active
                            AND (x.place_id IS NOT NULL OR x.origin IN ('manual', 'editor'))
                     )
                     AND NOT EXISTS (
                         SELECT 1 FROM site_named_place frueher
                           JOIN wiki_key_assignment a ON a.is_active AND a.legacy_art = 'siedlung'
                                AND a.wiki_key = frueher.target_key
                           JOIN place fp ON fp.public_id = a.object_public_id AND fp.is_active
                                AND fp.subtype IN ('dorf', 'kleinstadt', 'stadt', 'grossstadt', 'metropole')
                          WHERE frueher.site_id = s.id AND frueher.position < np.position
                     )
                   ORDER BY s.id
              `;
    open.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || Number(a.id) - Number(b.id));

    const named =
        open.length === 0
            ? []
            : await database<NamedRow[]>`
                  SELECT np.site_id::text AS site_id, np.position, np.target_raw, np.target_key,
                         p.public_id::text AS place_public_id, p.name AS place_name
                    FROM site_named_place np
                    LEFT JOIN wiki_key_assignment a
                           ON a.is_active AND a.legacy_art = 'siedlung' AND a.wiki_key = np.target_key
                    LEFT JOIN place p ON p.is_active AND p.public_id = a.object_public_id
                   WHERE np.site_id = ANY(${open.map((row) => Number(row.id))}::bigint[])
                   ORDER BY np.site_id, np.position
              `;
    const jeStaette = new Map<string, NamedRow[]>();
    for (const zeile of named) {
        const liste = jeStaette.get(zeile.site_id);
        if (liste === undefined) jeStaette.set(zeile.site_id, [zeile]);
        else liste.push(zeile);
    }

    const [sichtbar] = await database.unsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM (${staettenSichtSql("SELECT id FROM place WHERE public_id = $1::uuid AND is_active")}) z`,
        [publicId],
    );

    return {
        bound: bound.map((row) => siteOf(row)),
        open: open.map((row) => siteOf(row, jeStaette.get(row.id) ?? [])),
        sichtbar: { count: sichtbar?.count ?? 0 },
    };
}
