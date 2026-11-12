import {
    SOURCE_REFERENCE_KINDS,
    SOURCE_TYPES,
    type SourceEntry,
    type SourceReferenceKind,
    type SourceType,
    type SubjectDetailKind,
} from "@avesmaps3d/shared";
import type { Queryable } from "../../database.ts";
import { CARRIER_TABLES } from "../carrier-tables.ts";

/**
 * Die Sektion „Quellen“ eines Subjects (WI-0063 5.5, Vertrag `sources.yaml`): die Quellen des Subjects SELBST, nie
 * vererbt. Eine Quelle der umgebenden Region wird nicht zur Quelle des Orts; eine Gruppe (Weg, Landschaft) liest die
 * VEREINIGUNG der Verknüpfungen ihrer Mitglieder, jede Quelle einmal.
 *
 * Reihenfolge ist Legacys Anzeigereihenfolge (`position`: offizielle zuerst, dann nach Anlage); bei einer Gruppe zählt die
 * frühste Position einer Quelle. Lizenz und Namensnennung bleiben getrennt; was nicht erfasst ist (`unrecorded`, leere
 * Titel, fehlende Seiten), fehlt in der Antwort, statt als leer zu erscheinen. Was die Antwort NIE enthält: den internen
 * Schlüssel, die Legacy-Nummer, die Herkunft der Verknüpfung und ihren Zustand.
 */

interface SourceRow {
    title: string | null;
    url: string | null;
    source_type: string;
    is_official: boolean;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    license_statement: string;
    license_name: string | null;
    license_uri: string | null;
    attribution: string | null;
    corpus_key: string | null;
    corpus_label: string | null;
}

const isOf = <T extends string>(list: readonly T[], value: string | null): value is T =>
    value !== null && (list as readonly string[]).includes(value);

function entryOf(row: SourceRow, mitNotiz = true): SourceEntry {
    const type: SourceType = isOf(SOURCE_TYPES, row.source_type) ? row.source_type : "sonstiges";
    const referenceKind: SourceReferenceKind | undefined = isOf(SOURCE_REFERENCE_KINDS, row.reference_kind)
        ? row.reference_kind
        : undefined;
    const statement = row.license_statement;
    const license: SourceEntry["license"] =
        statement === "license" && row.license_name !== null
            ? { statement, name: row.license_name, ...(row.license_uri === null ? {} : { uri: row.license_uri }) }
            : statement === "public_domain" || statement === "unfree"
              ? { statement }
              : undefined;
    return {
        ...(row.title === null || row.title.trim() === "" ? {} : { title: row.title }),
        ...(row.url !== null && /^https?:\/\//i.test(row.url) ? { url: row.url } : {}),
        type,
        official: row.is_official,
        ...(referenceKind === undefined ? {} : { referenceKind }),
        ...(row.pages === null ? {} : { pages: row.pages }),
        ...(row.note === null || !mitNotiz ? {} : { note: row.note }),
        ...(license === undefined ? {} : { license }),
        ...(row.attribution === null ? {} : { attribution: row.attribution }),
        ...(row.corpus_key === null
            ? {}
            : {
                  corpus: {
                      key: row.corpus_key,
                      ...(row.corpus_label === null || row.corpus_label === "" ? {} : { label: row.corpus_label }),
                  },
              }),
    };
}

/** Die Tafeln, aus denen die Quellen eines Trägers kommen: Verknüpfungstabelle, Tafel des Trägers und der Fremdschlüssel der Verknüpfung (feste Namen aus `CARRIER_TABLES`, nie eine Eingabe). */
interface QuellenTafeln {
    link: string;
    carrier: string;
    foreignKey: string;
}

/** Die Quellen der Träger `publicIds` aus den Tafeln `tables`, jede Quelle einmal, in Legacys Reihenfolge. */
async function listSourcesVia(
    database: Queryable,
    tables: QuellenTafeln,
    publicIds: readonly string[],
    mitNotiz = true,
): Promise<SourceEntry[]> {
    const rows = await database.unsafe<SourceRow[]>(
        `SELECT q.title, q.url, q.source_type, q.is_official, q.reference_kind, q.pages, q.note, q.license_statement,
                q.license_name, q.license_uri, q.attribution, q.corpus_key, q.corpus_label
         FROM (
             SELECT DISTINCT ON (f.id)
                    f.id, s.position, f.title, f.url, f.source_type, f.is_official, s.reference_kind, s.pages, s.note,
                    f.license_statement, l.display_name AS license_name, l.canonical_uri AS license_uri, f.attribution,
                    f.corpus_key, c.label AS corpus_label
             FROM ${tables.link} s
             JOIN ${tables.carrier} t ON t.id = s.${tables.foreignKey}
             JOIN feature_source f ON f.id = s.source_id AND f.is_active
             LEFT JOIN license_catalog l ON l.key = f.license_key
             LEFT JOIN source_corpus c ON c.corpus_key = f.corpus_key
             WHERE t.public_id = ANY($1::uuid[]) AND s.is_active AND s.state = 'active'
             ORDER BY f.id, s.position
         ) q
         ORDER BY q.position, q.id`,
        [[...publicIds]],
    );
    return rows.map((row) => entryOf(row, mitNotiz));
}

/** Die Quellen der Träger `publicIds` (ein Träger oder alle Mitglieder einer Gruppe), jede Quelle einmal, in Legacys Reihenfolge. */
export async function listSources(
    database: Queryable,
    kind: SubjectDetailKind,
    publicIds: readonly string[],
): Promise<SourceEntry[]> {
    const tables = CARRIER_TABLES[kind];
    if (tables.link === null) return [];
    return listSourcesVia(
        database,
        { link: tables.link, carrier: tables.carrier, foreignKey: tables.foreignKey },
        publicIds,
    );
}

/**
 * Die Quellen des Eintrags eines Vorkommens (`lore_entry.public_id`, Verknüpfung `lore_entry_source`, WI-0260): dieselbe Abfrage und derselbe Typ wie die Quellen der Kartenobjekte,
 * damit der Quellenkasten der Infoboxen sie ohne Umbau zeigt. Fast alle Verknüpfungen sind Publikationen (`referenceKind` gesetzt); die Reihenfolge ist die des Wikis (`position`).
 *
 * 🪤 Ohne die Notiz (`note`, im Vertrag optional): Bei den Publikationen trägt sie Reste des Wikitexts („{{R5}} Beschreibung und Werte“, „[[Pforte des Grauens (DSG)]]“), und das Panel zeigt sie nie
 * (Legacy zeigt sie im Infopanel auch nicht). Ein Eintrag hat bis zu 200 Publikationen; die Antwort braucht den Text nicht.
 */
export function listLoreEntrySources(database: Queryable, entryPublicId: string): Promise<SourceEntry[]> {
    return listSourcesVia(
        database,
        { link: "lore_entry_source", carrier: "lore_entry", foreignKey: "lore_entry_id" },
        [entryPublicId],
        false,
    );
}
