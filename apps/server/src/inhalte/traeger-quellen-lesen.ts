import {
    gleichDemWiki,
    type InhalteQuellenWiki,
    type InhalteTraegerAbschnitte,
    type InhalteTraegerQuelle,
    type InhalteTraegerQuellen,
    type InhalteTraegerQuellenArt,
    type InhalteTraegerWikiStand,
    type InhalteVerwendungState,
} from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import { readEditorPathStreet } from "../editor/path-list.ts";
import { bezugsArt, quellenTyp } from "./quellen-lesen.ts";
import { TRAEGER } from "./traeger.ts";
import { fasseWegQuelleZusammen } from "./weg-sicht.ts";

/**
 * Lesen der Quellen eines Kartenobjekts für die Klappbox der Karteneditoren (WI-0254 §12; Vertrag `packages/shared/src/inhalte-traeger-quellen.ts`): Ort, Herrschaftsgebiet,
 * Landschaft und die Straße eines Wegs. Geschrieben wird in `traeger-quellen-schreiben.ts` (beim Weg in `traeger-quellen-weg.ts`).
 *
 * - **Alle Zustände**, die aktiven zuerst, dann nach der Reihenfolge am Objekt (`position`). Eine Quelle, die die Redaktion stillgelegt hat (`feature_source.is_active`), fehlt wie im
 *   Infopanel (`subjects/sections/sources.ts`).
 * - 🔴 **Herkunft ist der Vergleich mit dem Wiki.** Das Zitat des Wikis je Quelle und Objekt liegt in `wikisync_quelle_zitat` (Migration 0251, geschrieben vom Lauf der Quellen, gelesen von
 *   der App). Die Tafel ist ein späterer Release als dieser Code und braucht ein Recht, das Claudio vergibt: Fehlt sie oder darf die App sie noch nicht lesen, sind `wiki` oben und je Quelle
 *   `null` (der Kreis bleibt leer, es steht nichts Falsches da). Der Lauf, der oben steht, ist der jüngste fertige mit dem Bereich „Quellen“, der Zitate abgelegt hat: Ein jüngerer, der
 *   sie wegen eines fehlenden Rechts übersprang, würde jede Quelle zu „weicht ab“ machen.
 * - **Wege:** Quellen hängen je Abschnitt (Legacy führt sie so), aber ein Weg ist in den Quellen und im Wiki ein Ganzes (Betreiber 2026-10-28). Die Antwort fasst sie über die Abschnitte der
 *   Straße zusammen, wie das Wege-Fenster sie gruppiert (`readEditorPathStreet`; `fasseWegQuelleZusammen` in `weg-sicht.ts`, dieselbe Rechnung prüft der Schreibweg gegen `vorher`). Eine Straße auf der Karte
 *   ist `aenderbar`; `abschnitte` bleibt für den Kreis (voll nur, wenn jeder Abschnitt seinem Zitat gleicht).
 */

/** Wie die Zeilen beider Arten von Träger aus der Datenbank kommen. */
interface LinkRow {
    carrier_id: string;
    source_id: string;
    source_key: string;
    title: string;
    source_type: string;
    is_official: boolean;
    url: string | null;
    reference_kind: string | null;
    pages: string | null;
    note: string | null;
    state: string;
    updated_at: Date;
    corpus_label: string | null;
}

const zustand = (wert: string): InhalteVerwendungState =>
    wert === "retired" || wert === "suppressed" ? wert : "active";

interface Zitate {
    stand: InhalteTraegerWikiStand;
    /** `<Kennung des Objekts>|<Schlüssel der Quelle>` → das Zitat. */
    werte: Map<string, InhalteQuellenWiki>;
}

const zitatSchluessel = (traegerId: string, quelleKey: string): string => `${traegerId}|${quelleKey}`;

/** Kann die App die Tafel der Zitate lesen? Sie fehlt vor Migration 0251, und das Recht kommt mit dem Rechtelauf (Claudio). */
export async function zitateLesbar(database: Queryable): Promise<boolean> {
    const [zeile] = await database<{ ok: boolean | null }[]>`
        SELECT has_table_privilege(to_regclass('wikisync_quelle_zitat'), 'SELECT') AS ok
    `;
    return zeile?.ok === true;
}

/** Der jüngste fertige Lauf der Quellen mit abgelegten Zitaten und die Zitate der übergebenen Objekte; `undefined`, wo es sie nicht gibt. */
async function leseZitate(
    database: Queryable,
    traegerArt: InhalteTraegerQuellenArt,
    traegerIds: readonly string[],
): Promise<Zitate | undefined> {
    if (!(await zitateLesbar(database))) return undefined;
    const [lauf] = await database<{ id: number; dump_stand: string | null; beendet_am: Date | null }[]>`
        SELECT l.id::int AS id, l.dump_stand, l.beendet_am
          FROM wikisync_lauf l
         WHERE l.status = 'fertig' AND 'quelle' = ANY(l.bereiche)
           AND EXISTS (SELECT 1 FROM wikisync_quelle_zitat z WHERE z.lauf_id = l.id)
         ORDER BY l.id DESC
         LIMIT 1
    `;
    if (lauf === undefined) return undefined;
    const zeilen = await database<
        { traeger_id: string; quelle_key: string; art: string | null; seiten: string | null; notiz: string | null }[]
    >`
        SELECT z.traeger_id::text AS traeger_id, z.quelle_key, z.art, z.seiten, z.notiz
          FROM wikisync_quelle_zitat z
         WHERE z.lauf_id = ${lauf.id}::bigint AND z.traeger_art = ${traegerArt} AND z.traeger_id = ANY(${traegerIds as string[]}::uuid[])
    `;
    return {
        stand: { laufId: lauf.id, dumpStand: lauf.dump_stand, beendetAm: lauf.beendet_am?.toISOString() ?? null },
        werte: new Map(
            zeilen.map((zeile) => [
                zitatSchluessel(zeile.traeger_id, zeile.quelle_key),
                { art: bezugsArt(zeile.art), seiten: zeile.seiten, notiz: zeile.notiz },
            ]),
        ),
    };
}

/** Die Angaben einer Verknüpfung in der Form des Vergleichs. */
const wertVon = (zeile: Pick<LinkRow, "reference_kind" | "pages" | "note">) => ({
    art: zeile.reference_kind,
    seiten: zeile.pages,
    notiz: zeile.note,
});

const quelleVon = (zeile: LinkRow): Omit<InhalteTraegerQuelle, "state" | "updatedAt" | "wiki" | "abschnitte"> => ({
    sourceId: zeile.source_id,
    title: zeile.title,
    sourceType: quellenTyp(zeile.source_type),
    offiziell: zeile.is_official,
    url: zeile.url,
    referenceKind: bezugsArt(zeile.reference_kind),
    pages: zeile.pages,
    note: zeile.note,
    korpus: zeile.corpus_label === null || zeile.corpus_label === "" ? null : { label: zeile.corpus_label },
});

const LINK_SPALTEN = `f.public_id::text AS source_id, f.source_key, f.title, f.source_type, f.is_official, f.url,
                v.reference_kind, v.pages, v.note, v.state, v.updated_at, c.label AS corpus_label`;

/**
 * Die Quellen eines Objekts; `undefined`, wo es das Objekt nicht gibt (beim Weg: keine Straße, auch kein Seeweg: Der Wegeditor führt keine).
 * `kennung` ist die öffentliche Kennung des Objekts, beim Weg die eines Abschnitts der Straße.
 */
export async function leseTraegerQuellen(
    database: Queryable,
    art: InhalteTraegerQuellenArt,
    kennung: string,
): Promise<InhalteTraegerQuellen | undefined> {
    if (art === "path") return leseWegQuellen(database, kennung);
    const tafeln = TRAEGER[art];
    const [traeger] = await database.unsafe<{ id: string; name: string; is_active: boolean }[]>(
        `SELECT id::text AS id, name, is_active FROM ${tafeln.carrier} WHERE public_id = $1::uuid`,
        [kennung],
    );
    if (traeger === undefined) return undefined;
    const zeilen = await database.unsafe<LinkRow[]>(
        `SELECT $2::text AS carrier_id, ${LINK_SPALTEN}
           FROM ${tafeln.link} v
           JOIN feature_source f ON f.id = v.source_id AND f.is_active
           LEFT JOIN source_corpus c ON c.corpus_key = f.corpus_key
          WHERE v.${tafeln.foreignKey} = $1::bigint
          ORDER BY (v.state = 'active') DESC, v.position, v.id`,
        [traeger.id, kennung],
    );
    const zitate = await leseZitate(database, art, [kennung]);
    return {
        traeger: { kind: art, id: kennung, name: traeger.name, aktiv: traeger.is_active },
        aenderbar: traeger.is_active,
        ...(traeger.is_active ? {} : { grund: "still" as const }),
        wiki: zitate?.stand ?? null,
        quellen: zeilen.map((zeile): InhalteTraegerQuelle => ({
            ...quelleVon(zeile),
            state: zustand(zeile.state),
            updatedAt: zeile.updated_at.toISOString(),
            wiki: zitate?.werte.get(zitatSchluessel(kennung, zeile.source_key)) ?? null,
        })),
    };
}

/**
 * Die Quellen einer Straße: die Vereinigung über ihre Abschnitte. Eine Quelle steht einmal da; ihre Angaben sind die des ersten Abschnitts entlang der Straße, der sie aktiv trägt
 * (`abschnitte.einheitlich` sagt, ob die anderen dasselbe sagen). Der Zustand ist aktiv, wenn ein Abschnitt sie aktiv trägt, sonst gelöst, wenn einer sie gelöst hat, sonst unterdrückt.
 */
async function leseWegQuellen(database: Queryable, kennung: string): Promise<InhalteTraegerQuellen | undefined> {
    const strasse = await readEditorPathStreet(database, kennung);
    if (strasse === undefined) return undefined;
    // Die Folge der Abschnitte entlang der Straße (wie das Wege-Fenster sie zeigt) bestimmt, welcher Abschnitt zuerst gilt.
    const abschnittIds = strasse.segments.map((abschnitt) => abschnitt.id);
    const folge = new Map(abschnittIds.map((id, index) => [id, index] as const));
    const zeilen = await database.unsafe<LinkRow[]>(
        `SELECT p.public_id::text AS carrier_id, ${LINK_SPALTEN}
           FROM path_source v
           JOIN path p ON p.id = v.path_id
           JOIN feature_source f ON f.id = v.source_id AND f.is_active
           LEFT JOIN source_corpus c ON c.corpus_key = f.corpus_key
          WHERE p.public_id = ANY($1::uuid[])
          ORDER BY (v.state = 'active') DESC, v.position, v.id`,
        [abschnittIds],
    );
    const zitate = await leseZitate(database, "path", abschnittIds);

    // Je Quelle ihre Zeilen, in der Reihenfolge der ersten Nennung (aktive zuerst, dann `position`).
    const jeQuelle = new Map<string, LinkRow[]>();
    for (const zeile of zeilen) jeQuelle.set(zeile.source_id, [...(jeQuelle.get(zeile.source_id) ?? []), zeile]);

    const quellen: InhalteTraegerQuelle[] = [];
    for (const [, teil] of jeQuelle) {
        const { state, aktiv, massgebend, erste } = fasseWegQuelleZusammen(teil, folge);
        const abschnitte: InhalteTraegerAbschnitte = {
            mit: aktiv.length,
            von: abschnittIds.length,
            einheitlich: massgebend.every((zeile) => gleichDemWiki(wertVon(zeile), wertVon(erste))),
            gleichDemWiki:
                aktiv.length > 0 &&
                aktiv.every((zeile) => {
                    const zitat = zitate?.werte.get(zitatSchluessel(zeile.carrier_id, zeile.source_key));
                    return (
                        zitat !== undefined &&
                        gleichDemWiki(wertVon(zeile), { art: zitat.art, seiten: zitat.seiten, notiz: zitat.notiz })
                    );
                }),
        };
        const zitat = massgebend
            .map((zeile) => zitate?.werte.get(zitatSchluessel(zeile.carrier_id, zeile.source_key)))
            .find((eines) => eines !== undefined);
        quellen.push({
            ...quelleVon(erste),
            state,
            updatedAt: new Date(Math.max(...teil.map((zeile) => zeile.updated_at.getTime()))).toISOString(),
            wiki: zitat ?? null,
            abschnitte,
        });
    }

    const aufDerKarte = strasse.offMap !== true && strasse.deleted !== true;
    return {
        traeger: { kind: "path", id: kennung, name: strasse.name, aktiv: aufDerKarte },
        aenderbar: aufDerKarte,
        ...(aufDerKarte ? {} : { grund: "still" as const }),
        wiki: zitate?.stand ?? null,
        quellen,
    };
}
