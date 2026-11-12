import { catalogLinkMeta, catalogLinks } from "@avesmaps3d/shared";
import type { CitymapEntry, MediaPublicView, SubjectDetailKind } from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import {
    firstCitymapFull,
    resolveCitymapPreviews,
    resolveCitymapVersions,
    type CitymapVersionView,
} from "../../media/resolver.ts";
import { CARRIER_TABLES } from "../carrier-tables.ts";

/**
 * Die Sektion „Kartensammlung“ eines Subjects (WI-0063 P8, Vertrag `citymaps.yaml`, D2; Legacy `buildCityMapsSectionMarkup`/
 * `cityMapCardMarkup`/`buildCityMapRowMarkup`, Mirror `cbe278210`): die Karten, die GENAU diesen Gegenstand abbilden - nie
 * vererbt. Eine Gruppe (Weg, Landschaft) liest die VEREINIGUNG ihrer Mitglieder, jede Karte einmal.
 *
 * 🔴 Die Reihenfolge ist die des Katalogs, und das ist der TITEL (`ORDER BY title ASC` in Legacys `avesmapsCitymapsReadCatalog`); der
 * Streifen sortiert nicht nach. 🪤 `is_spoiler` ist dreiwertig, und UNBEKANNT ist KEIN Spoiler: nur ein ausdrückliches `true` wird
 * zum Deckel (Legacy `cityMapIsSpoiler`). `paid` hängt an der FUNDSTELLE, nicht an der Karte - dieselbe Ausgabe ist im Laden bezahlt
 * und auf der Wiki-Seite frei.
 *
 * Die Kachel des Streifens zeigt Vorschau und Titel. Das Fenster „Kartensammlung von …“ und sein vergrößerter Eintrag (WI-0118)
 * zeigen dazu ALLES, was der Bestand führt: Band, Typen, Art, Farbmodus, die dreiwertigen Eigenschaften, Zeitraum, Format, Zeichner,
 * Verlag, Auflösung, Notiz, ALLE Fundstellen und das Vollbild. 🔴 Was unbekannt ist, FEHLT - nie als `false` oder leerer Text erfunden.
 * Ein Prüfzustand der Links (online, offline) gehört nicht dazu.
 *
 * 🔴 `preview` und `full` kommen über den Media Core (MEDIA-M14), nicht über eine eigene Abfrage mit eigener Liste: EINE Frage je Rolle
 * für alle Karten der Sektion, und was öffentlich sein darf, hat die Policy beim Import entschieden. Eine Karte OHNE veröffentlichte
 * Datei bekommt kein Feld - und das ist kein Fehler, sondern der Normalfall an einem Teil des Bestands.
 *
 * WI-0287 Stufe 2: Eine Karte kann mehrere Versionen haben (Spieler- und SL-Fassung). `fulls` nennt alle in ihrer Reihenfolge, je mit Bezeichnung und, wo die Policy es
 * erlaubt, dem Vollbild; `full` bleibt das der ersten Version, die eines hat. Beides kommt aus EINER Frage (`resolveCitymapVersions`).
 */

interface MapRow {
    id: string;
    public_id: string;
    title: string;
    is_spoiler: boolean | null;
    art: string | null;
    color_mode: string | null;
    is_official: boolean | null;
    is_labeled: boolean | null;
    is_multilevel: boolean | null;
    has_scale: boolean | null;
    valid_from_bf: number | null;
    valid_to_bf: number | null;
    format: string | null;
    author: string | null;
    publisher: string | null;
    width_px: number | null;
    height_px: number | null;
    note: string | null;
    find_label: string | null;
    find_url: string | null;
    find_paid: boolean | null;
}

interface LinkRow {
    citymap_id: string;
    url: string;
    label: string;
    is_paid: boolean | null;
}

/** Die Zeilen zu einer Liste von Karten (`citymap.id`), nach Karte gruppiert, in der Reihenfolge, die die Abfrage liefert. */
function groupBy<Row extends { citymap_id: string }>(rows: readonly Row[]): Map<string, Row[]> {
    const grouped = new Map<string, Row[]>();
    for (const row of rows) {
        const list = grouped.get(row.citymap_id);
        if (list) list.push(row);
        else grouped.set(row.citymap_id, [row]);
    }
    return grouped;
}

/** Die Karten der Träger `publicIds` (ein Träger oder alle Mitglieder einer Gruppe), jede einmal, nach Titel. */
export async function listCitymaps(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
): Promise<CitymapEntry[]> {
    const tables = CARRIER_TABLES[kind];
    if (tables.catalogKey === null) return [];
    const rows = await database.unsafe<MapRow[]>(
        `SELECT DISTINCT ON (m.id)
                m.id::text AS id, m.public_id::text AS public_id, m.title, m.is_spoiler, m.art, m.color_mode, m.is_official,
                m.is_labeled, m.is_multilevel, m.has_scale, m.valid_from_bf, m.valid_to_bf, m.format, m.author, m.publisher,
                m.width_px, m.height_px, m.note,
                l.label AS find_label, l.url AS find_url, l.is_paid AS find_paid
         FROM citymap_place p
         JOIN citymap m ON m.id = p.citymap_id AND m.is_active
         JOIN ${tables.carrier} c ON c.id = p.${tables.catalogKey}
         LEFT JOIN citymap_link l ON l.citymap_id = m.id AND l.link_role = 'primary' AND l.is_active
         WHERE c.public_id = ANY($1::uuid[]) AND p.is_active
         ORDER BY m.id, l.position`,
        [[...publicIds]],
    );
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const publicMapIds = rows.map((row) => row.public_id);
    // EINE Frage je Art für alle Karten der Sektion, erst nachdem die Liste steht - kein N+1.
    const [typeRows, bandRows, linkRows, previews, versions] = await Promise.all([
        database.unsafe<{ citymap_id: string; type_key: string }[]>(
            `SELECT citymap_id::text AS citymap_id, type_key FROM citymap_type
             WHERE citymap_id = ANY($1::bigint[]) AND is_active ORDER BY type_key`,
            [ids],
        ),
        // Der Band ist die ERSTE Quelle (Legacy `cityMapBandLabel`: `sources[0].label`), in der Reihenfolge der Verknüpfung; `bands` sind alle (WI-0287).
        database.unsafe<{ citymap_id: string; title: string }[]>(
            `SELECT s.citymap_id::text AS citymap_id, f.title
             FROM citymap_source s
             JOIN feature_source f ON f.id = s.source_id AND f.is_active
             WHERE s.citymap_id = ANY($1::bigint[]) AND s.is_active
             ORDER BY s.citymap_id, s.position, s.id`,
            [ids],
        ),
        // ALLE Fundstellen: der Karten-Link zuerst, dann die weiteren in ihrer Reihenfolge.
        database.unsafe<LinkRow[]>(
            `SELECT citymap_id::text AS citymap_id, url, label, is_paid FROM citymap_link
             WHERE citymap_id = ANY($1::bigint[]) AND is_active
             ORDER BY citymap_id, (link_role = 'primary') DESC, position`,
            [ids],
        ),
        resolveCitymapPreviews(database, publicMapIds),
        resolveCitymapVersions(database, publicMapIds),
    ]);
    const types = groupBy(typeRows);
    const bands = new Map([...groupBy(bandRows)].map(([id, rows]) => [id, rows.map((row) => row.title)] as const));
    const links = groupBy(linkRows);
    return rows
        .map((row) => entryOf(row, { types, bands, links, previews, versions }))
        .sort((left, right) => left.title.localeCompare(right.title, "de"));
}

interface Attachments {
    types: ReadonlyMap<string, readonly { type_key: string }[]>;
    /** Je Karte die Titel ihrer aktiven Quellen in der Reihenfolge am Eintrag; der erste ist der Band. */
    bands: ReadonlyMap<string, readonly string[]>;
    links: ReadonlyMap<string, readonly LinkRow[]>;
    previews: ReadonlyMap<string, MediaPublicView>;
    /** Je Karte ihre Versionen in Reihenfolge (WI-0287 Stufe 2). */
    versions: ReadonlyMap<string, readonly CitymapVersionView[]>;
}

/** Ein Wert nur, wo er gesetzt ist: ein Feld ohne Wert fehlt (WI-0063 5.3). */
const when = <Key extends string, Value>(key: Key, value: Value | null | undefined): { [Name in Key]?: Value } =>
    value === null || value === undefined ? {} : ({ [key]: value } as { [Name in Key]: Value });

function entryOf(row: MapRow, attached: Attachments): CitymapEntry {
    const find =
        row.find_url === null || row.find_label === null || !/^https?:\/\//i.test(row.find_url)
            ? undefined
            : (() => {
                  // Dieselbe Beschriftung wie in der Liste aller Fundstellen: Der Host benennt den Link, nicht das Wort „Karte“.
                  const meta = catalogLinkMeta(row.find_url, { label: row.find_label, paid: row.find_paid });
                  return {
                      label: meta.label,
                      url: row.find_url,
                      ...(meta.paid === undefined ? {} : { paid: meta.paid }),
                  };
              })();
    const preview = attached.previews.get(row.public_id);
    const versions = attached.versions.get(row.public_id) ?? [];
    const full = firstCitymapFull(versions);
    const types = (attached.types.get(row.id) ?? []).map((entry) => entry.type_key);
    const bands = attached.bands.get(row.id) ?? [];
    const links = catalogLinks(
        (attached.links.get(row.id) ?? []).map((link) => ({ url: link.url, label: link.label, paid: link.is_paid })),
    );
    return {
        id: row.public_id,
        title: row.title,
        ...(row.is_spoiler === true ? { spoiler: true as const } : {}),
        ...(find === undefined ? {} : { find }),
        ...(preview === undefined ? {} : { preview }),
        ...(full === undefined ? {} : { full }),
        ...(versions.length === 0 ? {} : { fulls: versions.map((version) => ({ ...version })) }),
        ...when("band", bands[0]),
        ...(bands.length === 0 ? {} : { bands: [...bands] }),
        ...(types.length === 0 ? {} : { types }),
        ...when("art", row.art),
        ...when("colorMode", row.color_mode),
        ...when("official", row.is_official),
        ...when("labeled", row.is_labeled),
        ...when("multilevel", row.is_multilevel),
        ...when("hasScale", row.has_scale),
        ...when("validFrom", row.valid_from_bf),
        ...when("validTo", row.valid_to_bf),
        ...when("format", row.format),
        ...when("author", row.author),
        ...when("publisher", row.publisher),
        ...when("widthPx", row.width_px),
        ...when("heightPx", row.height_px),
        ...when("note", row.note),
        ...(links.length === 0 ? {} : { links }),
    };
}
