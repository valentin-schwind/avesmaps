import { MEDIA_ROLES } from "@avesmaps3d/shared";
import { PUBLISHED_VARIANT, oeffentlicheVarianten } from "../media/roles.ts";

/**
 * Die aktiven Verwendungen von Medien als EINE Abfrage über die vier Bindungstabellen, die Galerieeinträge, die Typbilder und die
 * Reisebilder (WI-0068 §8, Reverse Usage). Keine gespeicherte „used by“-Tafel: die Wahrheit sind die typisierten Bindungen, diese
 * Abfrage liest sie nur.
 *
 * Eine Zeile je Verwendung:
 * - `binding`: Ort, Gebiet, Werk oder Karte bindet das Asset direkt in einer Rolle;
 * - `gallery`: ein Eintrag einer Galerie, je aktiver Bindung der Galerie eine Zeile (die Einträge erben deren Rolle); ein Eintrag
 *   einer Galerie ohne aktive Bindung steht einmal mit `subject_kind`/`role` NULL da.
 * - `type_image`: der ★ einer Typbild-Kategorie (`media_type_image`, Migration 0113), Rolle `header`, ohne Fachobjekt; die Kategorie
 *   steht in `type_category` (Code-Review 2026-10-16 S8-03: ohne diesen Zweig galt ein Typbild als unbenutzt, und ein Inhaltsschalter
 *   nahm seine Datei nicht in Quarantäne), die Variante (`ki`, `ohne_ki`, WI-0281) in `type_variant`.
 * - Reisebild (`photobox_media`, Migration 0293, WI-0272 S3): `via: "binding"`, Rolle `photobox`, ohne Fachobjekt und ohne Unterdrückung;
 *   das Bild hängt an einer Kartenstelle, die an der Einreichung steht, nicht an einem Ort.
 * - Bild der Kategorie „Social Media Posts“ (WI-0278): `via: "binding"`, Rolle `social_post`, ohne Fachobjekt und ohne eigene Tafel; die Verwendung folgt aus dem Asset-Typ. Der Beitrag verweist
 *   nur weich auf das Asset (`beitrag.bild_id`, Migration 0269), und das Community-Schema wandert nicht mit dem Abzug. Darum steht sie nicht in `MEDIA_USAGE_TABLES`: Das Löschen bleibt möglich.
 *
 * Zurückgezogene Bindungen und Einträge zählen nicht (`retiredUsagesSql` zählt sie). `assetFilter` grenzt auf Assets ein (etwa
 * `= ANY($1::bigint[])`), leer heißt: alle. Die Spalten sind für Liste, Reverse Usage, Entscheidung und Namen dieselben; `bound_at`
 * (Anlage der Bindung oder des Galerieeintrags) wählt die älteste Bindung als Quelle des Namens (`titles.ts`).
 */
export function activeUsagesSql(assetFilter: string): string {
    const and = (column: string): string => (assetFilter === "" ? "" : ` AND ${column} ${assetFilter}`);
    const direct = (input: {
        table: string;
        subject: string;
        key: string;
        name: string;
        kind: string;
        suppression: string | null;
    }): string => `
        SELECT m.media_asset_id AS asset_id, 'binding'::text AS via, '${input.kind}'::text AS subject_kind,
               s.public_id::text AS subject_id, s.${input.name} AS subject_name, s.is_active AS subject_active, m.role,
               m.origin, m.revision::int AS revision, m.publication_override AS override,
               to_char(m.override_decided_on, 'YYYY-MM-DD') AS override_decided_on, m.override_decided_by,
               m.override_reason, m.override_operator_quote,
               ${
                   input.suppression === null
                       ? "FALSE"
                       : `EXISTS (SELECT 1 FROM ${input.suppression} x WHERE x.${input.key} = m.${input.key} AND x.role = m.role)`
               } AS suppressed,
               NULL::text AS gallery_id, NULL::text AS gallery_title, NULL::text AS gallery_kind, NULL::int AS position,
               m.created_at AS bound_at, NULL::text AS type_category, NULL::text AS type_variant
          FROM ${input.table} m
          JOIN ${input.subject} s ON s.id = m.${input.key}
         WHERE m.retired_at IS NULL${and("m.media_asset_id")}`;
    const item = (bound: boolean): string => `
        SELECT i.media_asset_id AS asset_id, 'gallery'::text AS via,
               ${bound ? "'place'::text" : "NULL::text"} AS subject_kind, ${bound ? "s.public_id::text" : "NULL::text"} AS subject_id,
               ${bound ? "s.name" : "NULL::text"} AS subject_name, ${bound ? "s.is_active" : "NULL::boolean"} AS subject_active,
               ${bound ? "b.role" : "NULL::text"} AS role, ${bound ? "b.origin" : "NULL::text"} AS origin,
               i.revision::int AS revision, i.publication_override AS override,
               to_char(i.override_decided_on, 'YYYY-MM-DD') AS override_decided_on, i.override_decided_by,
               i.override_reason, i.override_operator_quote,
               ${
                   bound
                       ? "EXISTS (SELECT 1 FROM place_media_suppression x WHERE x.place_id = b.place_id AND x.role = b.role)"
                       : "FALSE"
               } AS suppressed,
               g.public_id::text AS gallery_id, g.title AS gallery_title, g.gallery_kind, i.sort_order AS position,
               i.created_at AS bound_at, NULL::text AS type_category, NULL::text AS type_variant
          FROM media_gallery_item i
          JOIN media_gallery g ON g.id = i.gallery_id
          ${
              bound
                  ? "JOIN place_media_gallery b ON b.media_gallery_id = i.gallery_id AND b.retired_at IS NULL JOIN place s ON s.id = b.place_id"
                  : ""
          }
         WHERE i.retired_at IS NULL${and("i.media_asset_id")}${
             bound
                 ? ""
                 : " AND NOT EXISTS (SELECT 1 FROM place_media_gallery b WHERE b.media_gallery_id = i.gallery_id AND b.retired_at IS NULL)"
         }`;
    // Ein Typbild hat weder Unterdrückung noch Einzelentscheid mit Datum; seine Herkunft `release` ist keine Herkunft einer Bindung.
    const typeImage = `
        SELECT t.media_asset_id AS asset_id, 'type_image'::text AS via, NULL::text AS subject_kind, NULL::text AS subject_id,
               NULL::text AS subject_name, NULL::boolean AS subject_active, 'header'::text AS role,
               CASE WHEN t.origin = 'editor' THEN 'editor' END AS origin, t.revision::int AS revision,
               t.publication_override AS override, NULL::text AS override_decided_on, NULL::uuid AS override_decided_by,
               NULL::text AS override_reason, NULL::text AS override_operator_quote, FALSE AS suppressed,
               NULL::text AS gallery_id, NULL::text AS gallery_title, NULL::text AS gallery_kind, NULL::int AS position,
               t.created_at AS bound_at, t.category AS type_category, t.variant AS type_variant
          FROM media_type_image t
         WHERE t.retired_at IS NULL${and("t.media_asset_id")}`;
    // Ein Reisebild hängt an keinem Fachobjekt (die Stelle steht an der Einreichung) und kennt keine Unterdrückung.
    const photobox = `
        SELECT p.media_asset_id AS asset_id, 'binding'::text AS via, NULL::text AS subject_kind, NULL::text AS subject_id,
               NULL::text AS subject_name, NULL::boolean AS subject_active, p.role, NULL::text AS origin, p.revision::int AS revision,
               p.publication_override AS override, to_char(p.override_decided_on, 'YYYY-MM-DD') AS override_decided_on,
               p.override_decided_by, p.override_reason, p.override_operator_quote, FALSE AS suppressed,
               NULL::text AS gallery_id, NULL::text AS gallery_title, NULL::text AS gallery_kind, NULL::int AS position,
               p.created_at AS bound_at, NULL::text AS type_category, NULL::text AS type_variant
          FROM photobox_media p
         WHERE p.retired_at IS NULL${and("p.media_asset_id")}`;
    // Bestätigte Rechte sind die Einzelfreigabe eines Bildes dieser Kategorie (`readUsages`, `media-publication.ts`).
    const socialPost = `
        SELECT a.id AS asset_id, 'binding'::text AS via, NULL::text AS subject_kind, NULL::text AS subject_id,
               NULL::text AS subject_name, NULL::boolean AS subject_active, 'social_post'::text AS role, NULL::text AS origin, a.revision::int AS revision,
               CASE WHEN r.clearance_state = 'cleared' THEN 'approved' ELSE 'none' END AS override,
               CASE WHEN r.clearance_state = 'cleared' THEN to_char(r.reviewed_at, 'YYYY-MM-DD') END AS override_decided_on,
               CASE WHEN r.clearance_state = 'cleared' THEN r.reviewed_by_person END AS override_decided_by,
               NULL::text AS override_reason, NULL::text AS override_operator_quote, FALSE AS suppressed,
               NULL::text AS gallery_id, NULL::text AS gallery_title, NULL::text AS gallery_kind, NULL::int AS position,
               a.created_at AS bound_at, NULL::text AS type_category, NULL::text AS type_variant
          FROM media_asset a
          LEFT JOIN media_rights r ON r.media_asset_id = a.id
         WHERE a.asset_type = 'social_post'${and("a.id")}`;
    return [
        direct({
            table: "place_media",
            subject: "place",
            key: "place_id",
            name: "name",
            kind: "place",
            suppression: "place_media_suppression",
        }),
        direct({
            table: "territory_media",
            subject: "territory",
            key: "territory_id",
            name: "name",
            kind: "territory",
            suppression: "territory_media_suppression",
        }),
        direct({
            table: "adventure_media",
            subject: "adventure",
            key: "adventure_id",
            name: "title",
            kind: "adventure",
            suppression: null,
        }),
        direct({
            table: "citymap_media",
            subject: "citymap",
            key: "citymap_id",
            name: "title",
            kind: "citymap",
            suppression: null,
        }),
        item(true),
        item(false),
        typeImage,
        photobox,
        socialPost,
    ].join("\n        UNION ALL");
}

/**
 * 🔴 Die Tafeln, deren Zeilen ein Asset VERWENDEN (WI-0068 R4), als EINE Liste: `activeUsagesSql` liest ihre aktiven Zeilen,
 * `retiredUsagesSql` ihre zurückgezogenen, und das endgültige Löschen (`asset-delete.ts`) zählt beide. Der Wächter
 * `media-asset-referenzen.test.ts` hält sie gegen die Fremdschlüssel der Datenbank und gegen das Zusammenführen.
 */
export const MEDIA_USAGE_TABLES = [
    "place_media",
    "territory_media",
    "adventure_media",
    "citymap_media",
    "media_gallery_item",
    "media_type_image",
    // Reisebilder (WI-0272 S3, Migration 0293): die Verwendung der Rolle photobox.
    "photobox_media",
] as const;

/** Zurückgezogene Bindungen, Galerieeinträge und Typbilder je Asset: sie zeigen noch auf das Asset (ein endgültiges Löschen sähe sie). */
export function retiredUsagesSql(assetFilter: string): string {
    const and = (column: string): string => (assetFilter === "" ? "" : ` AND ${column} ${assetFilter}`);
    return MEDIA_USAGE_TABLES.map(
        (table) =>
            `SELECT media_asset_id AS asset_id FROM ${table} WHERE retired_at IS NOT NULL${and("media_asset_id")}`,
    ).join(" UNION ALL ");
}

/**
 * Die veröffentlichte Variante der Rolle einer Verwendung (`roles.ts`, EINE Stelle) als `CASE`. Die Namen sind Konstanten des
 * Codes, keine Eingabe; sie stehen deshalb als Text in der Abfrage, geprüft auf ihre Form.
 */
export function publishedVariantCase(roleColumn: string): string {
    const quoted = (value: string): string => {
        if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Variante ${value} hat keine sichere Form`);
        return `'${value}'`;
    };
    return `CASE ${roleColumn} ${MEDIA_ROLES.map((role) => `WHEN ${quoted(role)} THEN ${quoted(PUBLISHED_VARIANT[role])}`).join(" ")} END`;
}

/**
 * ALLE öffentlichen Varianten der Rolle einer Verwendung als Feld (`CASE … THEN ARRAY[…]`, `roles.ts` `oeffentlicheVarianten`): die Hauptvariante und, beim
 * Reisebild, die Kachel (WI-0272 S4, Aufgabe 22). Die Quarantäne fragt damit `f.variant = ANY(…)`, damit ein Schalter beide Dateien sperrt. Die Namen sind
 * Konstanten des Codes, keine Eingabe; sie stehen als Text in der Abfrage, geprüft auf ihre Form.
 */
export function publishedVariantsArray(roleColumn: string): string {
    const quoted = (value: string): string => {
        if (!/^[a-z0-9_]+$/.test(value)) throw new Error(`Variante ${value} hat keine sichere Form`);
        return `'${value}'`;
    };
    return `CASE ${roleColumn} ${MEDIA_ROLES.map((role) => `WHEN ${quoted(role)} THEN ARRAY[${oeffentlicheVarianten(role).map(quoted).join(",")}]`).join(" ")} END`;
}

/** Eine Person als JSON `{ id, displayName }` oder NULL; `alias` ist ein Join auf `avesmaps_auth.person`. */
export function personJson(alias: string): string {
    return `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE jsonb_build_object('id', ${alias}.id, 'displayName', ${alias}.display_name) END`;
}
