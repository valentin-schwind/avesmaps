import type { Queryable } from "../database.ts";

/**
 * Das tatsächliche Schema, wie der Plan und der Wächter es brauchen (WI-0251): Tafeln mit Spalten, Fremdschlüssel, Schlüssel- und
 * Prüfspalten, die Folgen (Sequenzen) der Zähler. Gelesen wird nur aus `pg_catalog`; das darf jede Rolle, und es schreibt nichts.
 *
 * Erweiterungstafeln (`spatial_ref_sys` von PostGIS) gehören der Erweiterung, nicht den Kartendaten: Sie stehen nicht im Katalog.
 */
export interface KatalogSpalte {
    readonly name: string;
    /** So schreibt `format_type` den Typ (`bigint`, `character varying(80)`, `geometry(Polygon,0)`). */
    readonly typ: string;
    readonly nichtNull: boolean;
    /** `s` gespeichert, `v` virtuell: Die Datenbank rechnet den Wert selbst, er gehört nicht in einen Abzug. */
    readonly generiert: boolean;
    /** `a` immer, `d` vorgabeweise: ein Zähler, dessen Folge nach dem Laden nachgezogen wird. */
    readonly identitaet: "a" | "d" | null;
    /** Ein Array, dessen Elementtyp nicht eingebaut ist (zum Beispiel `geometry[]`): Das Binärformat trägt dessen OID und wäre nicht übertragbar. */
    readonly arrayMitEigenemTyp: boolean;
    readonly imPrimaerschluessel: boolean;
    /** Steht die Spalte in einer CHECK-Bedingung der Tafel? Dann darf sie nicht einfach leer werden. */
    readonly inPruefung: boolean;
    /** Steht die Spalte in einem eindeutigen Schlüssel oder Index (der Primärschlüssel eingeschlossen)? Ein Platzhalter machte Werte gleich. */
    readonly inEindeutigem: boolean;
    /** Hat die Spalte eine Vorgabe (`DEFAULT`)? Eine lokal neuere Spalte ohne Vorgabe und mit NOT NULL kann der Abzug nicht füllen. */
    readonly hatVorgabe: boolean;
}

export interface KatalogTafel {
    readonly schema: string;
    readonly name: string;
    /** `schema.tafel`, so wie die Regeln sie nennen. */
    readonly voll: string;
    readonly spalten: readonly KatalogSpalte[];
}

export interface KatalogFremdschluessel {
    readonly name: string;
    readonly von: string;
    readonly nach: string;
    readonly spalten: readonly string[];
    readonly aufschiebbar: boolean;
}

export interface KatalogFolge {
    readonly tafel: string;
    readonly spalte: string;
    readonly folge: string;
}

export interface Katalog {
    readonly tafeln: ReadonlyMap<string, KatalogTafel>;
    readonly fremdschluessel: readonly KatalogFremdschluessel[];
    readonly folgen: readonly KatalogFolge[];
}

interface SpaltenZeile {
    schema: string;
    tafel: string;
    spalte: string;
    typ: string;
    nicht_null: boolean;
    generiert: string;
    identitaet: string;
    eigener_array_typ: boolean;
    im_schluessel: boolean;
    in_pruefung: boolean;
    in_eindeutigem: boolean;
    hat_vorgabe: boolean;
}

const KEIN_SYSTEMSCHEMA = `n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_%'`;

export async function leseKatalog(db: Queryable): Promise<Katalog> {
    const spalten = await db<SpaltenZeile[]>`
        SELECT n.nspname AS schema, c.relname AS tafel, a.attname AS spalte,
               format_type(a.atttypid, a.atttypmod) AS typ, a.attnotnull AS nicht_null,
               a.attgenerated::text AS generiert, a.attidentity::text AS identitaet,
               COALESCE(t.typcategory = 'A' AND et.typnamespace <> 'pg_catalog'::regnamespace, FALSE) AS eigener_array_typ,
               COALESCE(a.attnum = ANY (pk.conkey), FALSE) AS im_schluessel,
               COALESCE(a.attnum = ANY (ck.spalten), FALSE) AS in_pruefung,
               EXISTS (SELECT 1 FROM pg_index i
                        WHERE i.indrelid = c.oid AND i.indisunique AND a.attnum = ANY (i.indkey::int2[])) AS in_eindeutigem,
               a.atthasdef AS hat_vorgabe
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          JOIN pg_type t ON t.oid = a.atttypid
          LEFT JOIN pg_type et ON et.oid = t.typelem AND t.typcategory = 'A'
          LEFT JOIN pg_constraint pk ON pk.conrelid = c.oid AND pk.contype = 'p'
          LEFT JOIN LATERAL (
              SELECT array_agg(k) AS spalten
                FROM pg_constraint cc, unnest(cc.conkey) AS k
               WHERE cc.conrelid = c.oid AND cc.contype = 'c'
          ) ck ON TRUE
         WHERE c.relkind IN ('r', 'p') AND ${db.unsafe(KEIN_SYSTEMSCHEMA)}
           AND NOT EXISTS (
               SELECT 1 FROM pg_depend d
                WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e')
         ORDER BY n.nspname, c.relname, a.attnum
    `;
    const gruppiert = new Map<string, { schema: string; name: string; spalten: KatalogSpalte[] }>();
    for (const zeile of spalten) {
        const voll = `${zeile.schema}.${zeile.tafel}`;
        let tafel = gruppiert.get(voll);
        if (tafel === undefined) {
            tafel = { schema: zeile.schema, name: zeile.tafel, spalten: [] };
            gruppiert.set(voll, tafel);
        }
        tafel.spalten.push({
            name: zeile.spalte,
            typ: zeile.typ,
            nichtNull: zeile.nicht_null,
            generiert: zeile.generiert !== "",
            identitaet: zeile.identitaet === "a" || zeile.identitaet === "d" ? zeile.identitaet : null,
            arrayMitEigenemTyp: zeile.eigener_array_typ,
            imPrimaerschluessel: zeile.im_schluessel,
            inPruefung: zeile.in_pruefung,
            inEindeutigem: zeile.in_eindeutigem,
            hatVorgabe: zeile.hat_vorgabe,
        });
    }
    const tafeln = new Map<string, KatalogTafel>(
        [...gruppiert.entries()].map(([voll, tafel]) => [voll, { ...tafel, voll }]),
    );

    const fks = await db<{ name: string; von: string; nach: string; spalten: string[]; aufschiebbar: boolean }[]>`
        SELECT k.conname AS name,
               vn.nspname || '.' || vc.relname AS von, nn.nspname || '.' || nc.relname AS nach,
               ARRAY(SELECT a.attname FROM unnest(k.conkey) WITH ORDINALITY AS u(attnum, o)
                       JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = u.attnum ORDER BY u.o) AS spalten,
               k.condeferrable AS aufschiebbar
          FROM pg_constraint k
          JOIN pg_class vc ON vc.oid = k.conrelid JOIN pg_namespace vn ON vn.oid = vc.relnamespace
          JOIN pg_class nc ON nc.oid = k.confrelid JOIN pg_namespace nn ON nn.oid = nc.relnamespace
         WHERE k.contype = 'f' AND vc.relkind IN ('r', 'p')
         ORDER BY 2, 3, 1
    `;
    const folgen = await db<{ tafel: string; spalte: string; folge: string }[]>`
        SELECT n.nspname || '.' || c.relname AS tafel, a.attname AS spalte, sn.nspname || '.' || s.relname AS folge
          FROM pg_class s
          JOIN pg_namespace sn ON sn.oid = s.relnamespace
          JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass
                          AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
          JOIN pg_class c ON c.oid = d.refobjid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.refobjsubid
         WHERE s.relkind = 'S'
         ORDER BY 1, 2
    `;
    return {
        tafeln,
        fremdschluessel: fks
            .filter((fk) => tafeln.has(fk.von) && tafeln.has(fk.nach))
            .map((fk) => ({ ...fk, spalten: [...fk.spalten] })),
        folgen: folgen.map((folge) => ({ ...folge })),
    };
}

/** Die Spalten, die in einen Abzug gehören: alles, was die Datenbank nicht selbst rechnet, in der Reihenfolge der Tafel. */
export function abzugsSpalten(tafel: KatalogTafel): KatalogSpalte[] {
    return tafel.spalten.filter((spalte) => !spalte.generiert);
}
