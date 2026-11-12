import {
    FELD_HERKUENFTE,
    pathReaderName,
    STRASSEN_ASSISTENT_MAX,
    type FeldHerkunft,
    type StrasseZuweisenBody,
    type StrasseZuweisenReceipt,
} from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { aktualisiereKanon } from "../inhalte/kanon-folgen.ts";
import { legeX2Still, schreibeX2, titelOderAdresse } from "../wiki/objekt/anschluss.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { konflikt, pruefeSperren, type TxErgebnis } from "./path-split.ts";
import type { VorKonflikt } from "./ruecknahme.ts";

/**
 * Zuweisen im Straßen-Assistenten (WI-0310, `path.assign_street`; Vertrag `packages/shared/src/editor-strassen-assistent.ts`): vorhandene Abschnitte bekommen Name, Hauptartikel und Quellen einer
 * Straße in EINER Operation, wie „Auswahl zu neuem Weg“ (`path-neuer-weg.ts`, `path.regroup`). Keine Linie, kein Wegtyp, kein Reisemittel ändert sich; die Wegfindung rechnet nicht neu.
 *
 * - **`sections`:** der Name der Straße (ein echter Name, kein Griff: 400), Herkunft `manual`, wo der Name wechselt. Mit `key` der Hauptartikel wie `wegAnschluss.weise`: die Zeile `main` des
 *   Abschnitts an Ort und Stelle belegt oder angelegt (Herkunft `editor`, System `avesmaps3d`), eine weitere Zuweisung desselben Artikels still gelegt, die Tafel X2 (`schreibeX2`). Mit `quellen` die
 *   Quellen der Straße (`quellenDerStrasse`) an jeden Abschnitt, dem sie fehlen: angelegt oder belebt, `source_system = 'editor'`, mit den Angaben des ersten Abschnitts, der sie trägt.
 * - **`entfernen`:** kein Name mehr (`""`), Herkunft `manual`, Hauptartikel und X2 still gelegt (wie `path.regroup`); weitere Artikel und Quellen bleiben.
 * - Ein Abschnitt, an dem sich nichts ändert, wird nicht geschrieben; einer, an dem sich nur Artikel oder Quellen ändern, zählt trotzdem seine Revision (`UPDATE path SET name = name`). Danach das
 *   Etikett der geschriebenen Abschnitte (`path_canon`, `aktualisiereKanon`): Name, Artikel und Quellen gehen in die Kanon-Regel ein.
 * - Streng wie `path.regroup`: jeder Abschnitt gegen seine Revision (409 `edit_conflict`), nie über eine fremde Sperre (409 `object_locked`), alle auf einer Karte und auf der Karte (400), ganz oder
 *   gar nicht.
 *
 * **Protokoll** je Abschnitt `path.street_assigned`: `name`, `nameOrigin`, `wiki` (Titel und Adresse vorher und nachher, zum Lesen) mit `wikiOrigin` (die Zeilen der Hauptzuweisung, der weiteren
 * Zuweisungen und der Tafel X2, je vorher und nachher, samt Zustand, Herkunft und System), `quellen` (die Titel der angehängten Quellen) mit `quellenOrigin` (die Zeilen in `path_source` vorher und
 * nachher). Eine Zeile, die es vorher nicht gab, steht vorher als `{ id, neu: true }`. Die `…Origin`-Felder zeigt der Verlauf nicht als eigene Zeile.
 *
 * **↺** in der Rücknahme der Wege (`ruecknahme-weg.ts`): `schreibeStrasseZurueckIn` setzt genau die Abschnitte und Zeilen der Operation auf den Stand davor, jede noch so, wie die Operation sie
 * hinterließ (sonst 409); eine Zeile, die es vorher nicht gab, wird still gelegt (gelöscht wird nie). Die Rücknahme davon weist wieder zu (`schreibeStrasseWiederIn`, Aktion
 * `path.street_assigned_again`), deren Rücknahme ist dieselbe wie die des Originals, beliebig oft. Beide sind EINE Rechnung (`kehreUm`): Jeder Eintrag hält vorher und nachher fest, die Gegenrichtung
 * tauscht sie.
 */

/** Die Wegarten, die nicht zur Straße gehören (das Netz der Strecke und die Quellen der Straße kennen nur Landwege). */
export const KEINE_LANDWEGE: readonly string[] = ["Flussweg", "Seeweg"];

interface Zeile {
    id: string;
    public_id: string;
    map_domain_id: string;
    name: string;
    subtype: string;
    is_active: boolean;
    revision: number;
}

type Abschnitt = { publicId: string; baseRevision: number };

/** Eine Zeile der Wiki-Zuordnung (`path_wiki_assignment`, Haupt- oder weitere Zuweisung), wie das Protokoll sie festhält. */
export interface ZuordnungsZeile {
    id: string;
    aktiv: boolean;
    /** `snapshot_id`. */
    stand: string | null;
    url: string | null;
    zustand: string;
    herkunft: string;
    system: string;
    stillVon: string | null;
}

/** Eine Zeile der Tafel X2 (`wiki_key_assignment`, Art `weg`). */
export interface SchluesselZeile {
    id: string;
    aktiv: boolean;
    key: string;
    url: string | null;
    titel: string | null;
    ns: number | null;
    nsName: string | null;
    system: string;
    stillVon: string | null;
}

/** Eine Zeile in `path_source`. */
export interface QuellenZeile {
    id: string;
    /** Die Katalogquelle (`feature_source.public_id`). */
    quelle: string;
    zustand: string;
    art: string | null;
    seiten: string | null;
    notiz: string | null;
    system: string;
    stillVon: string | null;
}

/** Vorher: eine Zeile, die es noch nicht gab. */
interface Neu {
    id: string;
    neu: true;
}
type Vorher<Z> = Z | Neu;
const istNeu = (zeile: object): zeile is Neu => (zeile as Partial<Neu>).neu === true;

interface WikiZeilen<Z, S> {
    zuordnungen: Z[];
    x2: S[];
}

/** Eine Quelle der Straße: die Katalogquelle und ihre Angaben am ersten Abschnitt (kleinste Kennung), der sie trägt. */
export interface StrassenQuelle {
    /** `feature_source.public_id`. */
    id: string;
    /** `feature_source.id`. */
    quelleId: string;
    titel: string;
    art: string | null;
    seiten: string | null;
    notiz: string | null;
}

/**
 * Die Quellen der Straße: die aktiven Quellen an den Landwegen auf der Karte mit ihrem Namen (ein echter) oder ihrem Artikel, je Quelle einmal, nach Titel. Liest nur; die Strecke zeigt sie, das
 * Zuweisen gibt sie den Abschnitten, denen sie fehlen.
 */
export async function quellenDerStrasse(
    db: Queryable,
    strasse: { mapDomainId: string; name: string; key: string | null },
): Promise<StrassenQuelle[]> {
    const name = strasse.name.trim();
    if (name === "" && strasse.key === null) return [];
    const zeilen = await db<StrassenQuelle[]>`
        SELECT DISTINCT ON (f.id) f.public_id::text AS id, f.id::text AS "quelleId", f.title AS titel,
               v.reference_kind AS art, v.pages AS seiten, v.note AS notiz
          FROM path_source v
          JOIN path p ON p.id = v.path_id
          JOIN feature_source f ON f.id = v.source_id AND f.is_active
         WHERE v.is_active AND p.is_active AND p.map_domain_id = ${strasse.mapDomainId} AND NOT (p.subtype = ANY(${KEINE_LANDWEGE}))
           AND ((${name}::text <> '' AND btrim(p.name) = ${name}::text AND btrim(p.name) <> p.subtype)
                OR (${strasse.key}::text IS NOT NULL AND EXISTS (
                    SELECT 1 FROM path_wiki_assignment w JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                     WHERE w.path_id = p.id AND w.role = 'main' AND w.is_active AND s.wiki_key = ${strasse.key})))
         ORDER BY f.id, p.public_id
    `;
    return [...zeilen].sort((a, b) => a.titel.localeCompare(b.titel, "de") || (a.id < b.id ? -1 : 1));
}

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Einen der gewählten Abschnitte gibt es nicht.");
const geaendert = (): ApiError =>
    new ApiError(409, "edit_conflict", "Eine Zuordnung am Abschnitt hat sich inzwischen geändert.", {
        currentRevision: 0,
    });
const nachKennung = (a: { publicId: string }, b: { publicId: string }): number =>
    a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0;

/** Die Abschnitte, gesperrt, geprüft: es gibt sie, alle auf einer Karte und auf der Karte, jeder mit seiner Revision, keiner fremd gehalten (wie `path-neuer-weg.ts`). */
async function leseAbschnitte(tx: Sql, actor: MapActor, abschnitte: readonly Abschnitt[]): Promise<Zeile[]> {
    // FOR NO KEY UPDATE wie `path.update`: Die Operation ändert nie eine Kennung des Wegs.
    const zeilen = await tx<Zeile[]>`
        SELECT id::text, public_id::text AS public_id, map_domain_id, name, subtype, is_active, revision::int AS revision
          FROM path WHERE public_id = ANY(${abschnitte.map((a) => a.publicId)}::uuid[])
         ORDER BY public_id
           FOR NO KEY UPDATE
    `;
    if (zeilen.length !== abschnitte.length) throw nichtDa();
    if (new Set(zeilen.map((z) => z.map_domain_id)).size > 1)
        throw new ApiError(400, "validation_failed", "Die Abschnitte liegen auf verschiedenen Karten.", {
            field: "sections",
        });
    const weg = zeilen.find((z) => !z.is_active);
    if (weg !== undefined)
        throw new ApiError(400, "validation_failed", "Ein Abschnitt ist nicht auf der Karte.", {
            field: "sections",
            publicId: weg.public_id,
        });
    const basis = new Map(abschnitte.map((a) => [a.publicId, a.baseRevision] as const));
    const anders = zeilen.find((z) => basis.get(z.public_id) !== z.revision);
    if (anders !== undefined) throw await konflikt(tx, anders.public_id);
    await pruefeSperren(
        tx,
        actor,
        zeilen.map((z) => z.public_id),
    );
    return zeilen;
}

/** Den Namen schreiben (die Revision zählt der Trigger, auch bei demselben Namen). */
async function schreibeName(tx: Sql, zeile: Zeile, name: string): Promise<number> {
    const [neu] = await tx<{ revision: number }[]>`
        UPDATE path SET name = ${name} WHERE public_id = ${zeile.public_id}::uuid AND revision = ${zeile.revision}
        RETURNING revision::int AS revision
    `;
    if (neu === undefined) throw await konflikt(tx, zeile.public_id);
    return neu.revision;
}

// --- Zeilen lesen und setzen ------------------------------------------------------------------------------------------------

const ZUORDNUNG_SPALTEN = `w.id::text AS id, w.is_active AS aktiv, w.snapshot_id::text AS stand, w.wiki_url AS url,
    w.assignment_state AS zustand, w.assignment_origin AS herkunft, w.source_system AS system, w.retired_origin AS "stillVon"`;
const X2_SPALTEN = `id::text AS id, is_active AS aktiv, wiki_key AS key, wiki_url AS url, wiki_title AS titel, ns, ns_name AS "nsName",
    source_system AS system, retired_origin AS "stillVon"`;
const QUELLE_SPALTEN = `v.id::text AS id, f.public_id::text AS quelle, v.state AS zustand, v.reference_kind AS art, v.pages AS seiten,
    v.note AS notiz, v.source_system AS system, v.retired_origin AS "stillVon"`;

/** Die Hauptzeile je Abschnitt (in jedem Zustand; es gibt je Abschnitt höchstens eine), mit Titel und Schlüssel ihres Wiki-Stands. */
async function leseHauptzeilen(
    tx: Queryable,
    ids: readonly string[],
): Promise<Map<string, ZuordnungsZeile & { key: string | null; titel: string | null }>> {
    const zeilen = await tx.unsafe<(ZuordnungsZeile & { weg: string; key: string | null; titel: string | null })[]>(
        `SELECT ${ZUORDNUNG_SPALTEN}, p.public_id::text AS weg, s.wiki_key AS key, s.name AS titel
           FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
          WHERE p.public_id = ANY($1::uuid[]) AND w.role = 'main'`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map(({ weg, ...zeile }) => [weg, zeile] as const));
}

async function leseZuordnungenNachId(
    tx: Queryable,
    ids: readonly string[],
): Promise<Map<string, ZuordnungsZeile & { weg: string }>> {
    if (ids.length === 0) return new Map();
    const zeilen = await tx.unsafe<(ZuordnungsZeile & { weg: string })[]>(
        `SELECT ${ZUORDNUNG_SPALTEN}, w.path_id::text AS weg FROM path_wiki_assignment w WHERE w.id = ANY($1::bigint[])`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map(({ weg, ...zeile }) => [zeile.id, { ...zeile, weg }] as const));
}

async function leseX2(tx: Queryable, ids: readonly string[]): Promise<Map<string, SchluesselZeile>> {
    const zeilen = await tx.unsafe<(SchluesselZeile & { weg: string })[]>(
        `SELECT ${X2_SPALTEN}, object_public_id::text AS weg FROM wiki_key_assignment WHERE legacy_art = 'weg' AND object_public_id = ANY($1::uuid[])`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map(({ weg, ...zeile }) => [weg, zeile] as const));
}

async function leseX2NachId(tx: Queryable, ids: readonly string[]): Promise<Map<string, SchluesselZeile>> {
    if (ids.length === 0) return new Map();
    const zeilen = await tx.unsafe<SchluesselZeile[]>(
        `SELECT ${X2_SPALTEN} FROM wiki_key_assignment WHERE id = ANY($1::bigint[])`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map((zeile) => [zeile.id, zeile] as const));
}

/** Die Zeilen in `path_source` je Abschnitt und Quelle (`<Abschnitt>|<feature_source.id>`), gesperrt. */
async function leseQuellenZeilen(
    tx: Queryable,
    ids: readonly string[],
    quellen: readonly string[],
): Promise<Map<string, QuellenZeile>> {
    if (ids.length === 0 || quellen.length === 0) return new Map();
    const zeilen = await tx.unsafe<(QuellenZeile & { weg: string; quelle_id: string })[]>(
        `SELECT ${QUELLE_SPALTEN}, p.public_id::text AS weg, v.source_id::text AS quelle_id
           FROM path_source v JOIN path p ON p.id = v.path_id JOIN feature_source f ON f.id = v.source_id
          WHERE p.public_id = ANY($1::uuid[]) AND v.source_id = ANY($2::bigint[])
          ORDER BY v.id FOR UPDATE OF v`,
        [[...ids], [...quellen]] as never[],
    );
    return new Map(zeilen.map(({ weg, quelle_id, ...zeile }) => [`${weg}|${quelle_id}`, zeile] as const));
}

async function leseQuellenNachId(tx: Queryable, ids: readonly string[]): Promise<Map<string, QuellenZeile>> {
    if (ids.length === 0) return new Map();
    const zeilen = await tx.unsafe<QuellenZeile[]>(
        `SELECT ${QUELLE_SPALTEN} FROM path_source v JOIN feature_source f ON f.id = v.source_id
          WHERE v.id = ANY($1::bigint[]) ORDER BY v.id FOR UPDATE OF v`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map((zeile) => [zeile.id, zeile] as const));
}

/** Eine Zeile der Zuordnung auf genau diesen Stand (die Rücknahme). */
async function setzeZuordnung(tx: Queryable, ziel: ZuordnungsZeile): Promise<void> {
    await tx`
        UPDATE path_wiki_assignment
           SET is_active = ${ziel.aktiv}, snapshot_id = ${ziel.stand}::bigint, wiki_url = ${ziel.url}, assignment_state = ${ziel.zustand},
               assignment_origin = ${ziel.herkunft}, source_system = ${ziel.system},
               retired_at = CASE WHEN ${ziel.aktiv} THEN NULL ELSE coalesce(retired_at, now()) END, retired_origin = ${ziel.stillVon},
               updated_at = now()
         WHERE id = ${ziel.id}::bigint
    `;
}

async function setzeX2(tx: Queryable, ziel: SchluesselZeile): Promise<void> {
    await tx`
        UPDATE wiki_key_assignment
           SET is_active = ${ziel.aktiv}, wiki_key = ${ziel.key}, wiki_url = ${ziel.url}, wiki_title = ${ziel.titel}, ns = ${ziel.ns},
               ns_name = ${ziel.nsName}, source_system = ${ziel.system},
               retired_at = CASE WHEN ${ziel.aktiv} THEN NULL ELSE coalesce(retired_at, now()) END, retired_origin = ${ziel.stillVon},
               updated_at = now()
         WHERE id = ${ziel.id}::bigint
    `;
}

async function setzeQuelle(tx: Queryable, ziel: QuellenZeile): Promise<void> {
    const aktiv = ziel.zustand === "active";
    await tx`
        UPDATE path_source
           SET state = ${ziel.zustand}, is_active = ${aktiv}, reference_kind = ${ziel.art}, pages = ${ziel.seiten}, note = ${ziel.notiz},
               source_system = ${ziel.system},
               retired_at = CASE WHEN ${aktiv} THEN NULL ELSE coalesce(retired_at, now()) END, retired_origin = ${ziel.stillVon},
               updated_at = now()
         WHERE id = ${ziel.id}::bigint
    `;
}

/** Was eine Zeile, die es vorher nicht gab, bei der Rücknahme wird: still gelegt von der Redaktion (gelöscht wird nie). */
const stillZuordnung = (z: ZuordnungsZeile): ZuordnungsZeile => ({
    ...z,
    aktiv: false,
    stillVon: "editor",
    herkunft: "editor",
});
const stillX2 = (z: SchluesselZeile): SchluesselZeile => ({ ...z, aktiv: false, stillVon: "editor" });
const stillQuelle = (z: QuellenZeile): QuellenZeile => ({
    ...z,
    zustand: "retired",
    stillVon: "editor",
    system: "editor",
});

/** Steht die Zeile heute so, wie das Protokoll sie nach dem Schritt festhält? Verglichen wird, was die Zuordnung ausmacht. */
const gleicheZuordnung = (a: ZuordnungsZeile | undefined, b: ZuordnungsZeile): boolean =>
    a !== undefined && a.aktiv === b.aktiv && a.stand === b.stand && a.zustand === b.zustand;
const gleicherSchluessel = (a: SchluesselZeile | undefined, b: SchluesselZeile): boolean =>
    a !== undefined && a.aktiv === b.aktiv && a.key === b.key;
const gleicheQuelle = (a: QuellenZeile | undefined, b: QuellenZeile): boolean =>
    a !== undefined && a.zustand === b.zustand;

// --- Vorwärts ---------------------------------------------------------------------------------------------------------------

/** Jeder Abschnitt einmal, in der Folge seiner Kennung; doppelt genannt ist ein Fehler (400). */
function pruefeListen(body: StrasseZuweisenBody): { setzen: Abschnitt[]; entfernen: Abschnitt[] } {
    const doppelt = (liste: readonly Abschnitt[]): boolean =>
        new Set(liste.map((a) => a.publicId.toLowerCase())).size !== liste.length;
    if (body.sections.length + body.entfernen.length === 0)
        throw new ApiError(400, "validation_failed", "Es ist kein Abschnitt gewählt.", { field: "sections" });
    if (doppelt(body.sections))
        throw new ApiError(400, "validation_failed", "Ein Abschnitt ist doppelt genannt.", { field: "sections" });
    if (doppelt(body.entfernen))
        throw new ApiError(400, "validation_failed", "Ein Abschnitt ist doppelt genannt.", { field: "entfernen" });
    const setzen = body.sections.map((a) => ({ ...a, publicId: a.publicId.toLowerCase() })).sort(nachKennung);
    const entfernen = body.entfernen.map((a) => ({ ...a, publicId: a.publicId.toLowerCase() })).sort(nachKennung);
    const beide = new Set(setzen.map((a) => a.publicId));
    if (entfernen.some((a) => beide.has(a.publicId)))
        throw new ApiError(400, "validation_failed", "Ein Abschnitt soll den Namen zugleich bekommen und verlieren.", {
            field: "entfernen",
        });
    if (setzen.length + entfernen.length > STRASSEN_ASSISTENT_MAX)
        throw new ApiError(400, "validation_failed", "Zu viele Abschnitte auf einmal.", { field: "sections" });
    return { setzen, entfernen };
}

interface Stand {
    id: string;
    wiki_key: string;
    wiki_url: string;
    name: string | null;
}

/** Was an einem Abschnitt zu schreiben ist. */
interface Plan {
    zeile: Zeile;
    name: string;
    haupt: "setzen" | "loesen" | undefined;
    x2: "setzen" | "loesen" | undefined;
    weitere: ZuordnungsZeile[];
    neu: StrassenQuelle[];
    beleben: { zeile: QuellenZeile; quelle: StrassenQuelle }[];
}

const tutEtwas = (plan: Plan): boolean =>
    plan.zeile.name !== plan.name ||
    plan.haupt !== undefined ||
    plan.x2 !== undefined ||
    plan.weitere.length > 0 ||
    plan.neu.length > 0 ||
    plan.beleben.length > 0;

const wikiTitel = (
    zeile: { titel: string | null; url: string | null } | undefined,
): { titel: string; url: string | null } | null =>
    zeile === undefined || zeile.url === null
        ? null
        : { titel: zeile.titel ?? titelOderAdresse(zeile.url), url: zeile.url };

/** Der Anker einer Straße dieses Namens danach: die kleinste Kennung ihrer Abschnitte auf der Karte (wie die Wegeliste). */
async function ankerDes(tx: Sql, mapDomainId: string, name: string): Promise<string | undefined> {
    if (name === "") return undefined;
    const [anker] = await tx<{ id: string | null }[]>`
        SELECT min(public_id::text) AS id FROM path
         WHERE map_domain_id = ${mapDomainId} AND name = ${name} AND btrim(name) <> subtype AND is_active
    `;
    return anker?.id ?? undefined;
}

export async function strasseZuweisen(
    database: Database,
    actor: MapActor,
    body: StrasseZuweisenBody,
): Promise<StrasseZuweisenReceipt> {
    const { setzen, entfernen } = pruefeListen(body);
    const name = body.name.trim();
    if (name === "") throw new ApiError(400, "validation_failed", "Die Straße braucht einen Namen.", { field: "name" });
    const alle = [...setzen, ...entfernen].sort(nachKennung);
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM path WHERE public_id = ${alle[0]!.publicId}::uuid
    `;
    if (vorab === undefined) throw nichtDa();
    const domain = vorab.map_domain_id;
    let anker = (setzen[0] ?? alle[0]!).publicId;
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "path.assign_street", mapDomainId: domain, body },
        async (tx) => {
            const zeilen = await leseAbschnitte(tx, actor, alle);
            const mitName = new Set(setzen.map((a) => a.publicId));
            // Ein Griff („Strasse-11192“) oder der Name der eigenen Wegart ist kein Name (WI-0105): Die Straße wäre danach keine.
            const griff = zeilen.find((z) => mitName.has(z.public_id) && pathReaderName(name, z.subtype) === null);
            if (griff !== undefined)
                throw new ApiError(400, "validation_failed", "Das ist kein Name, sondern ein Griff.", {
                    field: "name",
                    publicId: griff.public_id,
                });
            let stand: Stand | undefined;
            if (body.key !== null) {
                [stand] = await tx<Stand[]>`
                    SELECT id::text AS id, wiki_key, wiki_url, name FROM wiki_path_snapshot WHERE wiki_key = ${body.key} AND is_active
                `;
                if (stand === undefined)
                    throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", {
                        field: "key",
                    });
            }
            const kanonisch =
                stand === undefined
                    ? undefined
                    : stand.wiki_key.startsWith("wiki:")
                      ? stand.wiki_key
                      : `wiki:${stand.wiki_key}`;
            const ids = zeilen.map((z) => z.public_id);
            const setzIds = ids.filter((id) => mitName.has(id));
            const haupt = await leseHauptzeilen(tx, ids);
            const x2 = await leseX2(tx, ids);
            const zwillinge =
                stand === undefined || setzIds.length === 0
                    ? []
                    : await tx.unsafe<(ZuordnungsZeile & { weg: string })[]>(
                          `SELECT ${ZUORDNUNG_SPALTEN}, p.public_id::text AS weg
                             FROM path_wiki_assignment w JOIN path p ON p.id = w.path_id
                            WHERE p.public_id = ANY($1::uuid[]) AND w.role = 'further' AND w.is_active AND w.snapshot_id = $2::bigint
                            ORDER BY w.id`,
                          [setzIds, stand.id] as never[],
                      );
            // Die Quellen der Straße, gelesen vor dem Schreiben: was die Strecke zeigte.
            const quellen = body.quellen
                ? await quellenDerStrasse(tx, { mapDomainId: domain, name, key: body.key })
                : [];
            const quellenHeute = await leseQuellenZeilen(
                tx,
                setzIds,
                quellen.map((q) => q.quelleId),
            );

            const plaene: Plan[] = zeilen.map((zeile) => {
                const h = haupt.get(zeile.public_id);
                const x = x2.get(zeile.public_id);
                if (!mitName.has(zeile.public_id))
                    return {
                        zeile,
                        name: "",
                        haupt: h?.aktiv === true ? "loesen" : undefined,
                        x2: x?.aktiv === true ? "loesen" : undefined,
                        weitere: [],
                        neu: [],
                        beleben: [],
                    };
                const hauptSetzen =
                    stand !== undefined && !(h?.aktiv === true && h.stand === stand.id && h.zustand === "assigned");
                const x2Setzen = kanonisch !== undefined && !(x?.aktiv === true && x.key === kanonisch);
                const neu: StrassenQuelle[] = [];
                const beleben: Plan["beleben"] = [];
                for (const quelle of quellen) {
                    const da = quellenHeute.get(`${zeile.public_id}|${quelle.quelleId}`);
                    if (da === undefined) neu.push(quelle);
                    else if (da.zustand !== "active") beleben.push({ zeile: da, quelle });
                }
                return {
                    zeile,
                    name,
                    haupt: hauptSetzen ? "setzen" : undefined,
                    x2: x2Setzen ? "setzen" : undefined,
                    weitere: hauptSetzen ? zwillinge.filter((w) => w.weg === zeile.public_id).map(ohneWeg) : [],
                    neu,
                    beleben,
                };
            });
            const schreiben = plaene.filter(tutEtwas);
            if (schreiben.length === 0)
                throw new ApiError(
                    400,
                    "validation_failed",
                    "Die Abschnitte tragen Name, Artikel und Quellen der Straße schon.",
                    {
                        field: "sections",
                    },
                );

            // 1. Eine weitere Zuweisung desselben Artikels still legen (sie hielte die Tafel doppelt), wie `wegAnschluss.weise`.
            const weitereIds = schreiben.flatMap((plan) => plan.weitere.map((w) => w.id));
            if (weitereIds.length > 0)
                await tx`
                    UPDATE path_wiki_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', updated_at = now()
                     WHERE id = ANY(${weitereIds}::bigint[]) AND is_active
                `;
            // 2. Die Hauptzeile belegen (an Ort und Stelle oder neu) oder still legen; die Tafel X2 ebenso.
            const hauptSetzen = schreiben.filter((plan) => plan.haupt === "setzen").map((plan) => plan.zeile.public_id);
            if (stand !== undefined && hauptSetzen.length > 0)
                await tx`
                    INSERT INTO path_wiki_assignment (path_id, role, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
                    SELECT id, 'main', ${stand.wiki_url}, ${stand.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE
                      FROM path WHERE public_id = ANY(${hauptSetzen}::uuid[])
                    ON CONFLICT (path_id) WHERE role = 'main' DO UPDATE
                       SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned', assignment_origin = 'editor',
                           source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL, updated_at = now()
                `;
            const hauptLoesen = schreiben.flatMap((plan) =>
                plan.haupt === "loesen" ? [haupt.get(plan.zeile.public_id)!.id] : [],
            );
            if (hauptLoesen.length > 0)
                await tx`
                    UPDATE path_wiki_assignment
                       SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor', updated_at = now()
                     WHERE id = ANY(${hauptLoesen}::bigint[]) AND is_active
                `;
            const x2Setzen = schreiben.filter((plan) => plan.x2 === "setzen").map((plan) => plan.zeile.public_id);
            if (stand !== undefined && x2Setzen.length > 0)
                await schreibeX2(tx, "weg", x2Setzen, { key: stand.wiki_key, url: stand.wiki_url, name: stand.name });
            await legeX2Still(
                tx,
                "weg",
                schreiben.filter((plan) => plan.x2 === "loesen").map((plan) => plan.zeile.public_id),
            );
            // 3. Die Quellen der Straße: angelegt, wo die Zeile fehlt (Folge hinter den vorhandenen), belebt, wo sie still liegt.
            const neu = schreiben.flatMap((plan) => plan.neu.map((quelle) => ({ weg: plan.zeile.id, quelle })));
            if (neu.length > 0) {
                const angelegt = await tx`
                    INSERT INTO path_source (path_id, source_id, reference_kind, pages, note, position, state, is_active, source_system)
                    SELECT t.weg, t.quelle, t.art, t.seiten, t.notiz,
                           coalesce((SELECT max(s.position) FROM path_source s WHERE s.path_id = t.weg), -1)
                               + row_number() OVER (PARTITION BY t.weg ORDER BY t.n),
                           'active', TRUE, 'editor'
                      FROM unnest(${neu.map((n) => n.weg)}::bigint[], ${neu.map((n) => n.quelle.quelleId)}::bigint[],
                                  ${neu.map((n) => n.quelle.art)}::text[], ${neu.map((n) => n.quelle.seiten)}::text[],
                                  ${neu.map((n) => n.quelle.notiz)}::text[]) WITH ORDINALITY AS t(weg, quelle, art, seiten, notiz, n)
                    ON CONFLICT (path_id, source_id) DO NOTHING
                    RETURNING id
                `;
                // Hat eine gleichzeitige Änderung die Zeile schon angelegt, gilt der gesehene Stand nicht mehr.
                if (angelegt.length !== neu.length) throw geaendert();
            }
            for (const { zeile, quelle } of schreiben.flatMap((plan) => plan.beleben))
                await setzeQuelle(tx, {
                    ...zeile,
                    zustand: "active",
                    art: quelle.art,
                    seiten: quelle.seiten,
                    notiz: quelle.notiz,
                    system: "editor",
                    stillVon: null,
                });

            // 4. Name und Revision; die Herkunft „manual“, wo der Name wechselt.
            const herkunft = await leseHerkunft(
                tx,
                "path",
                schreiben.map((plan) => plan.zeile.public_id),
            );
            const revisionen = new Map<string, number>();
            for (const plan of schreiben)
                revisionen.set(plan.zeile.public_id, await schreibeName(tx, plan.zeile, plan.name));
            const umbenannt = schreiben
                .filter((plan) => plan.zeile.name !== plan.name)
                .map((plan) => plan.zeile.public_id);
            await setzeHerkunft(tx, "path", umbenannt, { name: "manual" });

            // 5. Was danach steht, für das Protokoll.
            const geschrieben = schreiben.map((plan) => plan.zeile.public_id);
            const hauptDanach = await leseHauptzeilen(tx, geschrieben);
            const x2Danach = await leseX2(tx, geschrieben);
            const weitereDanach = await leseZuordnungenNachId(tx, weitereIds);
            const quellenDanach = await leseQuellenZeilen(
                tx,
                geschrieben,
                quellen.map((q) => q.quelleId),
            );
            await aktualisiereKanon(tx, { path: new Set(schreiben.map((plan) => plan.zeile.id)) });

            const affected: StrasseZuweisenReceipt["affected"][number][] = [];
            const entries: MapAuditEntry[] = [];
            for (const plan of schreiben) {
                const id = plan.zeile.public_id;
                const changes: Record<string, MapChange> = {};
                if (plan.zeile.name !== plan.name) {
                    changes["name"] = { before: plan.zeile.name, after: plan.name };
                    const vorher = herkunft.get(id)?.["name"] ?? null;
                    if (vorher !== "manual") changes["nameOrigin"] = { before: vorher, after: "manual" };
                }
                if (plan.haupt !== undefined || plan.x2 !== undefined || plan.weitere.length > 0) {
                    const hVorher = haupt.get(id);
                    const hNachher = hauptDanach.get(id);
                    const xVorher = x2.get(id);
                    const xNachher = x2Danach.get(id);
                    const vorher: WikiZeilen<Vorher<ZuordnungsZeile>, Vorher<SchluesselZeile>> = {
                        zuordnungen: [],
                        x2: [],
                    };
                    const nachher: WikiZeilen<ZuordnungsZeile, SchluesselZeile> = { zuordnungen: [], x2: [] };
                    if (plan.haupt !== undefined && hNachher !== undefined) {
                        vorher.zuordnungen.push(
                            hVorher === undefined ? { id: hNachher.id, neu: true } : ohneStand(hVorher),
                        );
                        nachher.zuordnungen.push(ohneStand(hNachher));
                    }
                    for (const w of plan.weitere) {
                        const danach = weitereDanach.get(w.id);
                        if (danach === undefined) continue;
                        vorher.zuordnungen.push(w);
                        nachher.zuordnungen.push(ohneWeg(danach));
                    }
                    if (plan.x2 !== undefined && xNachher !== undefined) {
                        vorher.x2.push(xVorher ?? { id: xNachher.id, neu: true });
                        nachher.x2.push(xNachher);
                    }
                    changes["wiki"] = {
                        before: hVorher?.aktiv === true ? wikiTitel(hVorher) : null,
                        after: hNachher?.aktiv === true ? wikiTitel(hNachher) : null,
                    };
                    changes["wikiOrigin"] = { before: vorher, after: nachher };
                }
                const angehaengt = [...plan.neu, ...plan.beleben.map((b) => b.quelle)];
                if (angehaengt.length > 0) {
                    const vorher: Vorher<QuellenZeile>[] = [];
                    const nachher: QuellenZeile[] = [];
                    for (const quelle of angehaengt) {
                        const danach = quellenDanach.get(`${id}|${quelle.quelleId}`);
                        if (danach === undefined) continue;
                        const alt = plan.beleben.find((b) => b.quelle.quelleId === quelle.quelleId)?.zeile;
                        vorher.push(alt ?? { id: danach.id, neu: true });
                        nachher.push(danach);
                    }
                    changes["quellen"] = {
                        before: [],
                        after: angehaengt.map((quelle) => ({ sourceId: quelle.id, title: quelle.titel })),
                    };
                    changes["quellenOrigin"] = { before: vorher, after: nachher };
                }
                const revision = revisionen.get(id)!;
                affected.push({ kind: "path", id, revision });
                entries.push({
                    action: "path.street_assigned",
                    pathId: id,
                    revisionBefore: plan.zeile.revision,
                    revisionAfter: revision,
                    changes,
                });
            }
            anker = (await ankerDes(tx, domain, name)) ?? anker;
            return {
                receipt: { affected, derivedWork: [], warnings: [] },
                summary: `${name}: ${String(schreiben.length)} ${schreiben.length === 1 ? "Abschnitt" : "Abschnitte"} zugewiesen`,
                entries,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung ohne neuen Lauf: Der Anker ist dann der kleinste gewählte Abschnitt.
    return { ...quittung, anker };
}

const ohneStand = (z: ZuordnungsZeile & { key?: string | null; titel?: string | null }): ZuordnungsZeile => ({
    id: z.id,
    aktiv: z.aktiv,
    stand: z.stand,
    url: z.url,
    zustand: z.zustand,
    herkunft: z.herkunft,
    system: z.system,
    stillVon: z.stillVon,
});
const ohneWeg = (z: ZuordnungsZeile & { weg?: string }): ZuordnungsZeile => ohneStand(z);

// --- Rücknahme --------------------------------------------------------------------------------------------------------------

/** Was eine Operation des Assistenten an jedem ihrer Abschnitte schrieb (`changes` des Protokolls, `path.street_assigned` oder `path.street_assigned_again`). */
export type StrassenProtokoll = ReadonlyMap<string, Record<string, MapChange>>;

const istObjekt = (wert: unknown): wert is Record<string, unknown> => typeof wert === "object" && wert !== null;
const istHerkunft = (wert: unknown): wert is FeldHerkunft => (FELD_HERKUENFTE as readonly unknown[]).includes(wert);
const liste = <Z>(wert: unknown): Z[] => (Array.isArray(wert) ? (wert.filter(istObjekt) as Z[]) : []);
const wikiZeilen = <Z, S>(wert: unknown): WikiZeilen<Z, S> =>
    istObjekt(wert)
        ? { zuordnungen: liste<Z>(wert["zuordnungen"]), x2: liste<S>(wert["x2"]) }
        : { zuordnungen: [], x2: [] };

/** Je Zeile der Stand, den die Operation hinterließ (`nachher`), und der, auf den die Gegenrichtung sie setzt (`ziel`). */
interface Umkehr<Z> {
    nachher: Z;
    ziel: Z;
}
function paare<Z extends { id: string }>(vorher: Vorher<Z>[], nachher: Z[], still: (z: Z) => Z): Umkehr<Z>[] {
    return nachher.flatMap((danach, i) => {
        const davor = vorher[i];
        if (davor === undefined || davor.id !== danach.id) return [];
        return [{ nachher: danach, ziel: istNeu(davor) ? still(danach) : (davor as Z) }];
    });
}

/** Die Umkehr eines Abschnitts: die Zeilen mit ihrem Stand nachher und ihrem Ziel. */
interface AbschnittsUmkehr {
    zuordnungen: Umkehr<ZuordnungsZeile>[];
    x2: Umkehr<SchluesselZeile>[];
    quellen: Umkehr<QuellenZeile>[];
}

function umkehrVon(changes: Record<string, MapChange>): AbschnittsUmkehr {
    const wikiVorher = wikiZeilen<Vorher<ZuordnungsZeile>, Vorher<SchluesselZeile>>(changes["wikiOrigin"]?.before);
    const wikiNachher = wikiZeilen<ZuordnungsZeile, SchluesselZeile>(changes["wikiOrigin"]?.after);
    return {
        zuordnungen: paare(wikiVorher.zuordnungen, wikiNachher.zuordnungen, stillZuordnung),
        x2: paare(wikiVorher.x2, wikiNachher.x2, stillX2),
        quellen: paare(
            liste<Vorher<QuellenZeile>>(changes["quellenOrigin"]?.before),
            liste<QuellenZeile>(changes["quellenOrigin"]?.after),
            stillQuelle,
        ),
    };
}

/** Was heute anders steht, als die Operation es hinterließ, je Abschnitt die Felder (`name`, `wiki`, `quellen`); leer: die Gegenrichtung geht. Liest nur. */
async function abweichungen(
    db: Queryable,
    eintraege: StrassenProtokoll,
): Promise<{ id: string; name: string; felder: string[] }[]> {
    const ids = [...eintraege.keys()];
    const wege = new Map(
        (
            await db<{ id: string; name: string }[]>`
                SELECT public_id::text AS id, name FROM path WHERE public_id = ANY(${ids}::uuid[])
            `
        ).map((zeile) => [zeile.id, zeile] as const),
    );
    const umkehr = new Map([...eintraege].map(([id, changes]) => [id, umkehrVon(changes)] as const));
    const alle = [...umkehr.values()];
    const zuordnungen = await leseZuordnungenNachId(
        db,
        alle.flatMap((u) => u.zuordnungen.map((z) => z.nachher.id)),
    );
    const x2 = await leseX2NachId(
        db,
        alle.flatMap((u) => u.x2.map((z) => z.nachher.id)),
    );
    const quellen = await leseQuellenNachIdLesend(
        db,
        alle.flatMap((u) => u.quellen.map((z) => z.nachher.id)),
    );
    // Eine Zuweisung, die wieder aktiv würde, darf ihren Artikel am Abschnitt nicht schon in einer fremden Zeile finden (die Tafel hielte ihn doppelt).
    const eigene = alle.flatMap((u) => u.zuordnungen.map((z) => z.nachher.id));
    const belebt = alle.flatMap((u) =>
        u.zuordnungen
            .filter((z) => z.ziel.aktiv && z.ziel.stand !== null)
            .map((z) => ({ id: z.nachher.id, stand: z.ziel.stand! })),
    );
    const zwillinge = new Set(
        belebt.length === 0
            ? []
            : (
                  await db<{ id: string }[]>`
                      SELECT z.id FROM unnest(${belebt.map((b) => b.id)}::bigint[], ${belebt.map((b) => b.stand)}::bigint[]) AS z(id, stand)
                        JOIN path_wiki_assignment mein ON mein.id = z.id
                       WHERE EXISTS (SELECT 1 FROM path_wiki_assignment a
                                      WHERE a.path_id = mein.path_id AND a.is_active AND a.snapshot_id = z.stand AND NOT (a.id = ANY(${eigene}::bigint[])))
                  `
              ).map((zeile) => String(zeile.id)),
    );
    const befunde: { id: string; name: string; felder: string[] }[] = [];
    for (const [id, changes] of eintraege) {
        const weg = wege.get(id);
        const u = umkehr.get(id)!;
        const felder: string[] = [];
        const nameNachher = changes["name"]?.after;
        if (weg === undefined || (typeof nameNachher === "string" && weg.name !== nameNachher)) felder.push("name");
        const wikiAnders =
            u.zuordnungen.some(
                (z) => !gleicheZuordnung(zuordnungen.get(z.nachher.id), z.nachher) || zwillinge.has(z.nachher.id),
            ) || u.x2.some((z) => !gleicherSchluessel(x2.get(z.nachher.id), z.nachher));
        if (wikiAnders) felder.push("wiki");
        if (u.quellen.some((z) => !gleicheQuelle(quellen.get(z.nachher.id), z.nachher))) felder.push("quellen");
        if (felder.length > 0) befunde.push({ id, name: weg?.name ?? "", felder });
    }
    return befunde;
}

async function leseQuellenNachIdLesend(db: Queryable, ids: readonly string[]): Promise<Map<string, QuellenZeile>> {
    if (ids.length === 0) return new Map();
    const zeilen = await db.unsafe<QuellenZeile[]>(
        `SELECT ${QUELLE_SPALTEN} FROM path_source v JOIN feature_source f ON f.id = v.source_id WHERE v.id = ANY($1::bigint[])`,
        [[...ids]] as never[],
    );
    return new Map(zeilen.map((zeile) => [zeile.id, zeile] as const));
}

/**
 * Für die Vorprüfung der Rücknahme (`ruecknahme-weg.ts`, `pruefeWerte`): steht heute jeder Abschnitt und jede Zeile so, wie die Operation sie hinterließ? Sonst je Abschnitt ein Konflikt `wert`
 * mit den Feldern. Liest nur.
 */
export async function pruefeStrassenZuweisung(
    db: Queryable,
    objekte: readonly { kind: string; id: string; changes: Record<string, MapChange> }[],
): Promise<VorKonflikt[]> {
    const eintraege = new Map(objekte.filter((o) => o.kind === "path").map((o) => [o.id, o.changes] as const));
    return (await abweichungen(db, eintraege)).map((befund) => ({
        art: "wert",
        kind: "path",
        id: befund.id,
        ...(befund.name !== "" ? { name: befund.name } : {}),
        felder: befund.felder,
        abweichung: { was: "felder" },
        detail: "Der Abschnitt steht nicht mehr so, wie der Straßen-Assistent ihn hinterließ.",
    }));
}

/**
 * Die Gegenrichtung eines Eintrags des Assistenten in einer laufenden Transaktion: jeder Abschnitt gegen seine heutige Revision, noch so, wie der Eintrag ihn hinterließ (sonst 409), ganz oder gar
 * nicht. Name und Herkunft gehen auf den Stand davor (eine Herkunft, die es vorher nicht gab, bleibt `manual`: gelöscht wird ein Vermerk nie), jede Zeile auf ihren Stand davor; eine Zeile, die es vorher
 * nicht gab, wird still gelegt. Die neuen Einträge (`aktion`) halten vorher und nachher wieder fest, sodass ihre Gegenrichtung dieselbe Rechnung ist.
 */
async function kehreUm(
    tx: Sql,
    actor: MapActor,
    p: {
        readonly abschnitte: readonly Abschnitt[];
        readonly eintraege: StrassenProtokoll;
        readonly aktion: "path.street_assigned" | "path.street_assigned_again";
    },
): Promise<TxErgebnis> {
    const zeilen = await leseAbschnitte(tx, actor, [...p.abschnitte].sort(nachKennung));
    const umkehr = new Map([...p.eintraege].map(([id, changes]) => [id, umkehrVon(changes)] as const));
    const alle = [...umkehr.values()];
    // Die Quellen sperren, bevor sie geprüft werden: Die Quellen der Straße schreibt `traeger.sources` ohne Sperre am Weg (die Wege sind schon gesperrt).
    await leseQuellenNachId(
        tx,
        alle.flatMap((u) => u.quellen.map((z) => z.nachher.id)),
    );
    const befunde = await abweichungen(tx, p.eintraege);
    const nameAnders = befunde.find((befund) => befund.felder.includes("name"));
    if (nameAnders !== undefined) throw await konflikt(tx, nameAnders.id);
    if (befunde.length > 0) throw geaendert();
    // Erst, was still wird, dann was aktiv bleibt, dann was aktiv wird: So hält die Tafel keinen Artikel je doppelt.
    const zuordnungen = alle.flatMap((u) => u.zuordnungen);
    for (const schritt of [
        zuordnungen.filter((z) => !z.ziel.aktiv),
        zuordnungen.filter((z) => z.ziel.aktiv && z.nachher.aktiv),
        zuordnungen.filter((z) => z.ziel.aktiv && !z.nachher.aktiv),
    ])
        for (const z of schritt) await setzeZuordnung(tx, z.ziel);
    for (const z of alle.flatMap((u) => u.x2)) await setzeX2(tx, z.ziel);
    for (const z of alle.flatMap((u) => u.quellen)) await setzeQuelle(tx, z.ziel);

    const herkunft = await leseHerkunft(
        tx,
        "path",
        zeilen.map((z) => z.public_id),
    );
    const affected: StrasseZuweisenReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    const herkunftZiel = new Map<FeldHerkunft, string[]>();
    for (const zeile of zeilen) {
        const vorher = p.eintraege.get(zeile.public_id)!;
        const u = umkehr.get(zeile.public_id)!;
        const changes: Record<string, MapChange> = {};
        const nameZiel = vorher["name"]?.before;
        const name = typeof nameZiel === "string" ? nameZiel : zeile.name;
        if (name !== zeile.name) changes["name"] = { before: zeile.name, after: name };
        const ursprung = vorher["nameOrigin"]?.before;
        const heute = herkunft.get(zeile.public_id)?.["name"] ?? null;
        if (istHerkunft(ursprung) && ursprung !== heute) {
            herkunftZiel.set(ursprung, [...(herkunftZiel.get(ursprung) ?? []), zeile.public_id]);
            changes["nameOrigin"] = { before: heute, after: ursprung };
        }
        if (vorher["wikiOrigin"] !== undefined) {
            changes["wiki"] = { before: vorher["wiki"]?.after ?? null, after: vorher["wiki"]?.before ?? null };
            changes["wikiOrigin"] = {
                before: { zuordnungen: u.zuordnungen.map((z) => z.nachher), x2: u.x2.map((z) => z.nachher) },
                after: { zuordnungen: u.zuordnungen.map((z) => z.ziel), x2: u.x2.map((z) => z.ziel) },
            };
        }
        if (vorher["quellenOrigin"] !== undefined) {
            changes["quellen"] = { before: vorher["quellen"]?.after ?? [], after: vorher["quellen"]?.before ?? [] };
            changes["quellenOrigin"] = { before: u.quellen.map((z) => z.nachher), after: u.quellen.map((z) => z.ziel) };
        }
        const revision = await schreibeName(tx, zeile, name);
        affected.push({ kind: "path", id: zeile.public_id, revision });
        entries.push({
            action: p.aktion,
            pathId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: revision,
            changes,
        });
    }
    for (const [ursprung, ids] of herkunftZiel) await setzeHerkunft(tx, "path", ids, { name: ursprung });
    await aktualisiereKanon(tx, { path: new Set(zeilen.map((z) => z.id)) });
    return {
        receipt: { affected, derivedWork: [], warnings: [] },
        summary:
            p.aktion === "path.street_assigned"
                ? `${String(zeilen.length)} Abschnitte zurück auf den Stand vor dem Straßen-Assistenten`
                : `${String(zeilen.length)} Abschnitte wieder der Straße zugewiesen`,
        entries,
    };
}

/** ↺ des Zuweisens (und der Wiederholung): zurück auf den Stand davor. Schreibt `path.street_assigned`. */
export const schreibeStrasseZurueckIn = (
    tx: Sql,
    actor: MapActor,
    p: { readonly abschnitte: readonly Abschnitt[]; readonly eintraege: StrassenProtokoll },
): Promise<TxErgebnis> => kehreUm(tx, actor, { ...p, aktion: "path.street_assigned" });

/** ↺ der Rücknahme: wieder zugewiesen, wie die Operation es tat. Schreibt `path.street_assigned_again`. */
export const schreibeStrasseWiederIn = (
    tx: Sql,
    actor: MapActor,
    p: { readonly abschnitte: readonly Abschnitt[]; readonly eintraege: StrassenProtokoll },
): Promise<TxErgebnis> => kehreUm(tx, actor, { ...p, aktion: "path.street_assigned_again" });
