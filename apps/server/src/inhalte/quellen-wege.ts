import { AVENTURIA, gleichDemWiki, type InhalteVerwendungState } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { readEditorPathStreet, untergrundVon } from "../editor/path-list.ts";
import { likeMuster } from "../db/like-muster.ts";
import { fasseWegQuelleZusammen, type WegSicht, type WegZeile } from "./weg-sicht.ts";

/**
 * Die Wege im Reiter „Quellen“ des Fensters „Inhalte bearbeiten“ (WI-0254 §12): die Verwendungen einer Quelle, die Wege sind, und die Suche nach Wegen zum Anhängen. Nur lesend; geschrieben wird
 * über denselben Kern wie im Wegeditor (`traeger-quellen-weg.ts`).
 *
 * 🔴 **Ein Weg ist immer die ganze Straße** (Betreiber 2026-10-28: „wege sind in den quellen oder im wiki als ganzes beschrieben, einzelne abschnitte sind technische details von uns“). Legacy führt die
 * Quelle je Abschnitt (`path_source`); hier steht EINE Zeile je Straße, so gruppiert, wie das Wege-Fenster sie gruppiert (`readEditorPathStreet`): Abschnitte auf der Karte mit demselben echten Namen,
 * über Wegtypen hinweg; ein Abschnitt ohne echten Namen (ein Griff: leer, blank seine Art, `<Wort>-<Zahl>`, `isPathHandle`) ist seine eigene Straße. Seewege führt der Wegeditor nicht, und was nicht auf
 * der Karte ist (von der Karte genommen, gelöscht), steht hier nicht. Der Anker der Straße (ihre Kennung) ist die kleinste öffentliche Kennung ALLER ihrer Abschnitte auf der Karte, nicht nur derer,
 * die die Quelle tragen: die Kennung der Straße im Wege-Fenster, und die, an der der Schreibweg sperrt.
 *
 * - **Die Sicht** einer Quelle auf der Straße ist `fasseWegQuelleZusammen` (`weg-sicht.ts`): aktiv, wenn ein Abschnitt sie aktiv trägt; Art, Fundstelle und Notiz des ersten Abschnitts entlang der
 *   Straße, der sie aktiv trägt. Der Schreibweg misst `vorher` an genau dieser Sicht. Die Folge entlang der Straße braucht die Geometrie (`readEditorPathStreet`) und wird NUR gelesen, wo die
 *   Abschnitte verschieden sagen; sagen alle dasselbe (der Regelfall), ist der Anfang gleichgültig.
 * - Gerechnet wird in der Datenbank (eine Straße hat bis zu Hunderte Abschnitte, die Quelle „Wiki Aventurica“ Tausende Verknüpfungen): je Straße und Zustand/Angabe EINE Zeile mit den Kennungen.
 */

/**
 * Ist der Abschnitt `a` nur ein Griff statt eines Namens (`isPathHandle`, `path-names.ts`)? Leer, blank seine Art oder `<Wort>-<Zahl>`; ein solcher Abschnitt ist seine eigene Straße.
 * Als SQL ohne Parameter, denn auch die Liste der Quellen zählt damit (`quellen-lesen.ts`).
 */
export const GRIFF_SQL = (a: string): string =>
    `(btrim(${a}.name) = '' OR btrim(${a}.name) = ${a}.subtype OR btrim(${a}.name) ~ '^\\S+-\\d+$')`;

/** Der Schlüssel der Straße eines Abschnitts `a`: `n:<Name>`, für einen Griff `#<Kennung>`. EINE Straße ist, was denselben Schlüssel hat. */
export const STRASSEN_SCHLUESSEL_SQL = (a: string): string =>
    `CASE WHEN ${GRIFF_SQL(a)} THEN '#' || ${a}.public_id::text ELSE 'n:' || ${a}.name END`;

/** Die Verknüpfungen der Quelle (`$1`) an Abschnitten auf der Karte der Domäne (`$2`), mit dem Schlüssel der Straße. */
const VERKNUEPFUNGEN = `
    v AS (
        SELECT p.public_id, p.name, p.subtype, ${STRASSEN_SCHLUESSEL_SQL("p")} AS gkey,
               l.state, l.reference_kind, l.pages, l.note, l.source_system
          FROM path_source l
          JOIN path p ON p.id = l.path_id
         WHERE l.source_id = $1::bigint AND p.is_active AND p.map_domain_id = $2 AND p.subtype <> 'Seeweg'
    )`;

interface VarianteRow {
    gkey: string;
    name: string;
    state: string;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    editor: boolean;
    ids: string[];
    subtypes: string[];
}

/** Die Verwendung einer Quelle an einer Straße, so wie der Reiter sie zeigt. `referenceKind` ist roh (der Aufrufer prüft die Art des Belegs). */
export interface WegGruppe {
    /** Der Anker der Straße: die Kennung der Verwendung. */
    anker: string;
    name: string;
    /** Der häufigste Wegtyp der Straße. */
    subtype: string | undefined;
    state: InhalteVerwendungState;
    referenceKind: string | null;
    pages: string | null;
    note: string | null;
    /** Trägt irgendeine maßgebende Verknüpfung die Marke des Editors (sonst kommt sie aus Legacy)? */
    editor: boolean;
}

interface VarianteZeile extends WegZeile {
    editor: boolean;
}

/** Die Folge der Abschnitte entlang der Straße (Kennung → Platz), wie das Wege-Fenster sie ordnet; leer, wo die Straße nicht mehr zu lesen ist. */
async function folgeDerStrasse(database: Queryable, kennung: string): Promise<Map<string, number>> {
    const strasse = await readEditorPathStreet(database, kennung);
    return new Map((strasse?.segments ?? []).map((abschnitt, index) => [abschnitt.id, index] as const));
}

const wertVon = (zeile: Pick<WegZeile, "reference_kind" | "pages" | "note">) => ({
    art: zeile.reference_kind,
    seiten: zeile.pages,
    notiz: zeile.note,
});

/** Sagen alle maßgebenden Abschnitte dasselbe (nach dem Kürzen wie beim Wiki)? Dann ist gleichgültig, welcher der erste ist. */
const einheitlich = (sicht: WegSicht<VarianteZeile>): boolean =>
    sicht.massgebend.every((zeile) => gleichDemWiki(wertVon(zeile), wertVon(sicht.erste)));

/**
 * Die Wege einer Quelle, je Straße eine Gruppe, höchstens `grenze`: erst die mit aktiver Verknüpfung, dann nach Namen. `gesamt` zählt alle Straßen, die die Quelle aktiv tragen. Gelöste und
 * unterdrückte Straßen stehen mit ihrem Zustand da (sie lassen sich holen).
 */
export async function leseWegGruppen(
    database: Queryable,
    quelleId: string,
    grenze: number,
): Promise<{ gruppen: WegGruppe[]; gesamt: number }> {
    const zeilen = await database.unsafe<(VarianteRow & { rang: number })[]>(
        `WITH ${VERKNUEPFUNGEN},
         g AS (
             SELECT gkey, min(name) AS name,
                    row_number() OVER (ORDER BY bool_or(state = 'active') DESC, lower(min(name)), gkey) AS rang
               FROM v GROUP BY gkey ORDER BY rang LIMIT $3
         )
         SELECT v.gkey, g.name, g.rang::int AS rang, v.state, v.reference_kind, v.pages, v.note,
                bool_or(v.source_system <> 'legacy') AS editor,
                array_agg(v.public_id::text ORDER BY v.public_id) AS ids,
                array_agg(v.subtype ORDER BY v.public_id) AS subtypes
           FROM v JOIN g USING (gkey)
          GROUP BY v.gkey, g.name, g.rang, v.state, v.reference_kind, v.pages, v.note
          ORDER BY g.rang, v.state, v.pages NULLS FIRST, v.note NULLS FIRST, v.reference_kind NULLS FIRST`,
        [quelleId, AVENTURIA.mapDomain, grenze],
    );
    const [summe] = await database.unsafe<{ gesamt: number }[]>(
        `WITH ${VERKNUEPFUNGEN}
         SELECT count(*)::int AS gesamt FROM (SELECT 1 FROM v GROUP BY gkey HAVING bool_or(state = 'active')) g`,
        [quelleId, AVENTURIA.mapDomain],
    );
    if (zeilen.length === 0) return { gruppen: [], gesamt: summe?.gesamt ?? 0 };

    // Je Straße ihre Zeilen (Gruppen in der Folge der Abfrage).
    const jeStrasse = new Map<string, (VarianteRow & { rang: number })[]>();
    for (const zeile of zeilen) jeStrasse.set(zeile.gkey, [...(jeStrasse.get(zeile.gkey) ?? []), zeile]);

    // Der Anker und der Wegtyp einer Straße mit Namen: über ALLE Abschnitte auf der Karte (nicht nur die mit der Quelle).
    const namen = [...jeStrasse.keys()].filter((schluessel) => schluessel.startsWith("n:")).map((s) => s.slice(2));
    const strassen =
        namen.length === 0
            ? []
            : await database.unsafe<{ name: string; ids: string[]; subtypes: string[] }[]>(
                  `SELECT p.name, array_agg(p.public_id::text ORDER BY p.public_id) AS ids, array_agg(p.subtype ORDER BY p.public_id) AS subtypes
                     FROM path p
                    WHERE p.is_active AND p.map_domain_id = $2 AND p.subtype <> 'Seeweg'
                      AND p.name = ANY($1::text[]) AND btrim(p.name) <> p.subtype
                    GROUP BY p.name`,
                  [namen, AVENTURIA.mapDomain],
              );
    const ankerVon = new Map(strassen.map((strasse) => [strasse.name, strasse] as const));

    const gruppen: WegGruppe[] = [];
    for (const [schluessel, varianten] of jeStrasse) {
        const erster = varianten[0]!;
        const ganze = schluessel.startsWith("n:") ? ankerVon.get(erster.name) : undefined;
        const anker = ganze?.ids[0] ?? erster.ids[0]!;
        const subtype =
            ganze === undefined
                ? erster.subtypes[0]
                : untergrundVon(ganze.subtypes.map((s) => ({ subtype: s }))).subtype;
        // Erst mit einer Zeile je Zustand und Angabe; sagen die maßgebenden Zeilen verschieden, entscheidet die Folge entlang der Straße (dann mit einer Zeile je Abschnitt).
        const alsZeilen = (mitAllen: boolean): VarianteZeile[] =>
            varianten.flatMap((variante) =>
                (mitAllen ? variante.ids : [variante.ids[0]!]).map((id) => ({
                    carrier_id: id,
                    state: variante.state,
                    reference_kind: variante.reference_kind,
                    pages: variante.pages,
                    note: variante.note,
                    editor: variante.editor,
                })),
            );
        let sicht = fasseWegQuelleZusammen(alsZeilen(false), new Map());
        if (!einheitlich(sicht))
            sicht = fasseWegQuelleZusammen(alsZeilen(true), await folgeDerStrasse(database, anker));
        gruppen.push({
            anker,
            name: erster.name,
            subtype,
            state: sicht.state,
            referenceKind: sicht.erste.reference_kind,
            pages: sicht.erste.pages,
            note: sicht.erste.note,
            editor: sicht.massgebend.some((zeile) => zeile.editor),
        });
    }
    return { gruppen, gesamt: summe?.gesamt ?? 0 };
}

/** Eine Straße als Treffer der Suche: Anker, Name, häufigster Wegtyp. */
export interface StrassenTreffer {
    anker: string;
    name: string;
    subtype: string | undefined;
}

/**
 * Straßen zum Anhängen: aktive Wege auf der Karte mit echtem Namen (ein Griff ist kein Name, nach dem jemand sucht), die der Text im Namen enthält, je Straße ein Treffer. Der Treffer trägt den
 * Anker der Straße, nie einen Namen als Schlüssel; Seewege führt der Wegeditor nicht.
 */
export async function sucheStrassen(database: Queryable, text: string, limit: number): Promise<StrassenTreffer[]> {
    const zeilen = await database.unsafe<{ name: string; ids: string[]; subtypes: string[] }[]>(
        `SELECT p.name, array_agg(p.public_id::text ORDER BY p.public_id) AS ids, array_agg(p.subtype ORDER BY p.public_id) AS subtypes
           FROM path p
          WHERE p.is_active AND p.map_domain_id = $4 AND p.subtype <> 'Seeweg'
            AND p.name ILIKE $1 ESCAPE '\\' AND NOT ${GRIFF_SQL("p")}
          GROUP BY p.name
          ORDER BY (lower(p.name) = lower($2)) DESC, (lower(p.name) LIKE lower($2) || '%') DESC, lower(p.name), p.name
          LIMIT $3`,
        [likeMuster(text.trim()), text.trim(), limit, AVENTURIA.mapDomain],
    );
    return zeilen.map((zeile) => ({
        anker: zeile.ids[0]!,
        name: zeile.name,
        subtype: untergrundVon(zeile.subtypes.map((subtype) => ({ subtype }))).subtype || undefined,
    }));
}
