import { randomUUID } from "node:crypto";
import {
    EDITOR_LOCK_ERROR_STATUS,
    POWERLINE_STATE_CHANGES,
    type FeldHerkunft,
    type EditorLock,
    type EditorPowerlineTargets,
    type NodixRetireBody,
    type OperationReceipt,
    type PowerlineRetireBody,
    type PowerlineState,
    type PowerlineStateBody,
    type PowerlineStateChange,
    type PowerlineUpdateBody,
    type PowerlineWikiWahl,
    selberNodix,
} from "@avesmaps3d/shared";
import { raumDerAdresseInUmgebung } from "../kanon/namensraum.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database, Queryable } from "../database.ts";
import { zieheKraftlinienNach } from "../derive/powerline-bahn.ts";
import { ApiError } from "../http/api-error.ts";
import { listEditorLocks } from "./editor-lock.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { mapEditConflict } from "./place-edit.ts";

/**
 * Der Schreibweg des Kraftlinien-Editors (WI-0205; Vertrag `packages/shared/src/powerline-editor-ops.ts`): `powerline.update_line`
 * schreibt Felder (K6, Legacy `update_powerline_line`) und Form (K8: Bogen und umgehängte Enden je Abschnitt) in EINER Operation
 * (EDIT-0003 T27 (4)). Anlegen (K9) steht in `kraftlinien-anlegen.ts`, Entfernen (K10) kommt hierher.
 *
 * - **Die Linie ist die Gruppe gleichen Namens**; ein Abschnitt ohne Namen ist eine Linie für sich (wie der Lesepfad, `kraftlinien.ts`).
 *   Die Operation sperrt alle Abschnitte der Gruppe (`FOR UPDATE`) und vergleicht sie mit dem Entwurf: dieselben Abschnitte, dieselben
 *   Revisionen, sonst 409 mit wer und wann (`mapEditConflict`).
 * - Jeder Abschnitt wird mit `revision = revision` berührt, auch ohne geänderte Spalte: Das zählt (Trigger, 0143) und hält die Linie
 *   als Ganzes zusammen; die Quittung nennt jede neue Revision.
 * - **Umbenennen** auf einen Namen, den schon eine andere Linie trägt, verschmilzt beide (Legacy); die Quittung sagt es als Warnung
 *   `merged`. Die Abschnitte der anderen Linie bleiben unberührt.
 * - Ein Feld, das fehlt, bleibt (Vertrag). Ändert sich gar nichts, ist das kein Fehler: Es zählt nur die Revisionen.
 * - **Ein umgehängtes Ende** (R6) muss ein Nodix sein: ein aktiver Ort oder eine Beschriftung mit dem Merkmal, oder ein Kraftlinienpunkt.
 *   Die Bahn der umgeformten Abschnitte rechnet `zieheKraftlinienNach` in derselben Transaktion (K5).
 * - **Nodix anfügen und herausnehmen** (T28 (5), R5): `add` legt Abschnitte an, die Name, Beschriftung und Beschreibung der Linie
 *   erben (Herkunft `avesmaps3d`); `remove` legt einen still. Es bleibt mindestens einer.
 * - **Stand** (K10, Migration 0154, EDIT-0003 T43): `powerline.take_off_map`, `.put_on_map`, `.retire` („Ganz löschen“, weich) und
 *   `.restore` wechseln ALLE Abschnitte der Linie in ihrem Stand, gegen ihre Revisionen; zurück auf die Karte geht eine Linie nur, wenn
 *   beide Enden jedes Abschnitts noch ein Nodix sind, und ihre Bahn wird neu gerechnet. `nodix.retire` legt einen Kraftlinienpunkt still,
 *   nur wenn keine Linie mehr an ihm endet, auch keine abgenommene.
 * - **Wiki-Artikel** (`wiki`, je LINIE wie Legacy): Zuweisen schreibt an allen Abschnitten, die die Linie danach hat, die Zuordnung
 *   (`powerline_wiki_assignment`) und den Schlüssel (`wiki_key_assignment`, Art `kraftlinie`) mit Herkunft `editor`; Lösen legt beide
 *   still (`retired_origin editor`). Beides fasst der Import nie an; die Testwelt gibt es für ihn frei. Das Protokoll nennt je Abschnitt
 *   den Schlüssel vorher und nachher (`wiki`).
 * - **Fremde Sperre** (EDIT-0003 §4, WI-0205 K11): Hält ein anderer die Linie (am Anker oder an einem ihrer Abschnitte, `sections`),
 *   schreibt keine Operation über seinen Entwurf hinweg (409 `object_locked`, wer steht in `details.lock`); die eigene Sperre zählt nicht.
 */

export interface AbschnittZeile {
    public_id: string;
    name: string;
    label_visible: boolean;
    description: string | null;
    curve: number | null;
    from_public_id: string;
    to_public_id: string;
    revision: number;
    updated_at: Date;
    map_domain_id: string;
}

const leer = (text: string | null | undefined): string | null => {
    const t = (text ?? "").trim();
    return t === "" ? null : t;
};

/** Hält ein anderer eine Linie mit einem dieser Abschnitte, schreibt diese Operation nicht über seinen Entwurf hinweg (409). */
export async function pruefeLinienSperre(tx: Queryable, actor: MapActor, abschnitte: readonly string[]): Promise<void> {
    const ids = new Set(abschnitte);
    const fremd = (await listEditorLocks(tx, "powerline", undefined)).find(
        (sperre: EditorLock) =>
            (ids.has(sperre.id) || (sperre.sections ?? []).some((id) => ids.has(id))) &&
            (actor.kind !== "person" || sperre.person.id !== actor.personId),
    );
    if (fremd !== undefined)
        throw new ApiError(
            EDITOR_LOCK_ERROR_STATUS.object_locked,
            "object_locked",
            `${fremd.person.name} bearbeitet das gerade.`,
            { lock: fremd },
        );
}

/** Der Artikel der Linie an diesen Abschnitten: zuweisen (der Schlüssel eines Artikels aus dem Abzug) oder lösen (`null`). */
async function schreibeArtikel(tx: Sql, ids: readonly string[], wahl: PowerlineWikiWahl): Promise<void> {
    if (ids.length === 0) return;
    if (wahl === null) {
        await tx`
            UPDATE powerline_wiki_assignment w
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor'
              FROM powerline p
             WHERE p.id = w.powerline_id AND p.public_id = ANY(${[...ids]}::uuid[]) AND w.is_active
        `;
        await tx`
            UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE legacy_art = 'kraftlinie' AND object_public_id = ANY(${[...ids]}::uuid[]) AND is_active
        `;
        return;
    }
    const [artikel] = await tx<{ id: string; wiki_url: string; name: string | null }[]>`
        SELECT id::text AS id, wiki_url, name FROM wiki_powerline_snapshot WHERE wiki_key = ${wahl.key} AND is_active
    `;
    if (artikel === undefined)
        throw new ApiError(400, "validation_failed", "Diesen Wiki-Artikel gibt es nicht.", { field: "wiki" });
    await tx`
        INSERT INTO powerline_wiki_assignment (powerline_id, wiki_url, snapshot_id, assignment_state, assignment_origin, source_system, is_active)
        SELECT id, ${artikel.wiki_url}, ${artikel.id}::bigint, 'assigned', 'editor', 'avesmaps3d', TRUE
          FROM powerline WHERE public_id = ANY(${[...ids]}::uuid[])
        ON CONFLICT (powerline_id) DO UPDATE
           SET wiki_url = EXCLUDED.wiki_url, snapshot_id = EXCLUDED.snapshot_id, assignment_state = 'assigned',
               assignment_origin = 'editor', source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL
    `;
    // Der Namensraum aus dem Präfix des Titels hinter der Adresse (Namensraum-Tafel der Umgebung), nie aus dem Schlüssel geraten.
    const raum = await raumDerAdresseInUmgebung(tx, artikel.wiki_url);
    await tx`
        INSERT INTO wiki_key_assignment (legacy_art, object_public_id, wiki_key, wiki_url, wiki_title, ns, ns_name, source_system)
        SELECT 'kraftlinie', t.id, ${wahl.key}, ${artikel.wiki_url}, ${artikel.name}, ${raum.ns}, ${raum.nsName}, 'avesmaps3d'
          FROM unnest(${[...ids]}::uuid[]) AS t(id)
        ON CONFLICT (legacy_art, object_public_id) DO UPDATE
           SET wiki_key = EXCLUDED.wiki_key, wiki_url = EXCLUDED.wiki_url, wiki_title = EXCLUDED.wiki_title,
               ns = EXCLUDED.ns, ns_name = EXCLUDED.ns_name,
               source_system = 'avesmaps3d', is_active = TRUE, retired_at = NULL, retired_origin = NULL
    `;
}

/**
 * Der Wiki-Name für ↺ am Namen: der des Artikels, den die Linie nach der Operation trägt (die neue Wahl, sonst der des ersten
 * Abschnitts mit Artikel). Ohne Artikel oder ohne Namen im Wiki 400: Ein leerer Name wird nie geschrieben.
 */
export async function wikiName(
    tx: Queryable,
    abschnitte: readonly AbschnittZeile[],
    wahl: PowerlineWikiWahl | undefined,
): Promise<string> {
    const [artikel] =
        wahl === null
            ? []
            : wahl !== undefined
              ? await tx<{ name: string | null }[]>`
                    SELECT name FROM wiki_powerline_snapshot WHERE wiki_key = ${wahl.key} AND is_active
                `
              : await tx<{ name: string | null }[]>`
                    SELECT s.name
                      FROM powerline p
                      JOIN powerline_wiki_assignment w ON w.powerline_id = p.id AND w.is_active
                      JOIN wiki_powerline_snapshot s ON s.id = w.snapshot_id AND s.is_active
                     WHERE p.public_id = ANY(${abschnitte.map((a) => a.public_id)}::uuid[])
                     ORDER BY p.public_id
                     LIMIT 1
                `;
    const name = artikel?.name?.trim() ?? "";
    if (name === "")
        throw new ApiError(400, "validation_failed", "Das Wiki kennt keinen Namen für diese Kraftlinie.", {
            field: "name",
        });
    return name;
}

/** Der Stand eines Abschnitts aus `is_active` und `off_map`. */
export const standVon = (row: { is_active: boolean; off_map: boolean }): PowerlineState =>
    row.is_active ? "karte" : row.off_map ? "abgenommen" : "geloescht";

/** Die Bedingung eines Stands über die Spalten (für die Gruppe einer Linie im selben Stand). */
const imStand = (sql: Queryable, stand: PowerlineState) =>
    stand === "karte"
        ? sql`is_active`
        : stand === "abgenommen"
          ? sql`NOT is_active AND off_map`
          : sql`NOT is_active AND NOT off_map`;

/** Die Abschnitte der Linie, zu der `anker` gehört, in ihrem Stand (ohne Angabe: auf der Karte), gesperrt; leer ohne sie. */
export async function sperreLinie(tx: Sql, anker: string, stand: PowerlineState = "karte"): Promise<AbschnittZeile[]> {
    const [kopf] = await tx<{ name: string; map_domain_id: string }[]>`
        SELECT name, map_domain_id FROM powerline WHERE public_id = ${anker} AND ${imStand(tx, stand)}
    `;
    if (kopf === undefined) return [];
    return kopf.name.trim() === ""
        ? tx<AbschnittZeile[]>`
              SELECT public_id::text AS public_id, name, label_visible, description, curve, from_public_id::text AS from_public_id,
                     to_public_id::text AS to_public_id, revision::int AS revision, updated_at, map_domain_id
                FROM powerline WHERE public_id = ${anker} AND ${imStand(tx, stand)}
                 FOR UPDATE
          `
        : tx<AbschnittZeile[]>`
              SELECT public_id::text AS public_id, name, label_visible, description, curve, from_public_id::text AS from_public_id,
                     to_public_id::text AS to_public_id, revision::int AS revision, updated_at, map_domain_id
                FROM powerline
               WHERE map_domain_id = ${kopf.map_domain_id} AND name = ${kopf.name} AND ${imStand(tx, stand)}
               ORDER BY public_id
                 FOR UPDATE
          `;
}

/**
 * Die heutigen Abschnitte der Linie, zu der `anker` gehört, in ihrem Stand (wie `sperreLinie`, ohne Sperre; K10: auch abgenommen
 * oder gelöscht), für ihren Verlauf; leer ohne Linie.
 */
export async function linienAbschnitte(database: Queryable, anker: string): Promise<string[]> {
    const [kopf] = await database<{ name: string; map_domain_id: string; is_active: boolean; off_map: boolean }[]>`
        SELECT name, map_domain_id, is_active, off_map FROM powerline WHERE public_id = ${anker}
    `;
    if (kopf === undefined) return [];
    if (kopf.name.trim() === "") return [anker];
    const zeilen = await database<{ id: string }[]>`
        SELECT public_id::text AS id FROM powerline
         WHERE map_domain_id = ${kopf.map_domain_id} AND name = ${kopf.name} AND ${imStand(database, standVon(kopf))}
         ORDER BY public_id
    `;
    return zeilen.map((z) => z.id);
}

/** Welche der Kennungen ein Nodix ist: ein aktiver Ort, eine Beschriftung oder eine Landmarke mit dem Merkmal, oder ein aktiver Kraftlinienpunkt. */
async function nodixKennungen(sql: Queryable, domain: string, ids: readonly string[]): Promise<string[]> {
    const zeilen = await sql<{ id: string }[]>`
        SELECT public_id::text AS id FROM place
         WHERE map_domain_id = ${domain} AND is_active AND is_nodix AND public_id = ANY(${ids as string[]}::uuid[])
        UNION SELECT public_id::text FROM map_label
         WHERE map_domain_id = ${domain} AND is_active AND is_nodix AND public_id = ANY(${ids as string[]}::uuid[])
        UNION SELECT public_id::text FROM terrain_peak
         WHERE map_domain_id = ${domain} AND is_active AND 'nodix' = ANY (merkmale) AND public_id = ANY(${ids as string[]}::uuid[])
        UNION SELECT public_id::text FROM nodix
         WHERE map_domain_id = ${domain} AND is_active AND public_id = ANY(${ids as string[]}::uuid[])
    `;
    return zeilen.map((z) => z.id);
}

/**
 * Die Nodices einer Domäne mit Lage (Ziele der Modi „Kurve bearbeiten“ und „Anlegen“): Orte, Beschriftungen und Landmarken mit dem Merkmal Nodix und
 * die Kraftlinienpunkte. Heute einige Dutzend; ein Modus fragt sie einmal beim Start, nie während einer Geste. Mit `ids` nur diese.
 */
export async function leseNodices(
    sql: Queryable,
    domain: string,
    ids?: readonly string[],
): Promise<EditorPowerlineTargets["targets"]> {
    const nur = ids === undefined ? null : [...ids];
    const zeilen = await sql<
        {
            id: string;
            kind: "place" | "label" | "nodix" | "landmark";
            name: string | null;
            x: number;
            y: number;
            revision: number | null;
        }[]
    >`
        SELECT * FROM (
            SELECT public_id::text AS id, 'place' AS kind, name, ST_X(geom) AS x, ST_Y(geom) AS y, NULL::int AS revision FROM place
             WHERE map_domain_id = ${domain} AND is_active AND is_nodix
            UNION ALL SELECT public_id::text, 'label', name, ST_X(geom), ST_Y(geom), NULL FROM map_label
             WHERE map_domain_id = ${domain} AND is_active AND is_nodix
            UNION ALL SELECT public_id::text, 'landmark', name, ST_X(geom), ST_Y(geom), NULL FROM terrain_peak
             WHERE map_domain_id = ${domain} AND is_active AND 'nodix' = ANY (merkmale)
            UNION ALL SELECT public_id::text, 'nodix', NULL, ST_X(geom), ST_Y(geom), revision::int FROM nodix
             WHERE map_domain_id = ${domain} AND is_active
        ) AS k
         WHERE ${nur}::text[] IS NULL OR k.id = ANY(${nur}::text[])
         ORDER BY id
    `;
    return zeilen.map((z) => ({
        id: z.id,
        kind: z.kind,
        ...(z.name !== null ? { name: z.name } : {}),
        x: z.x,
        y: z.y,
        ...(z.revision !== null ? { revision: z.revision } : {}),
    }));
}

/** Die Andockziele beim Umhängen eines Endes (K8, R6): jeder Nodix der Domäne der Linie. `undefined`, wenn es die Linie nicht gibt. */
export async function readPowerlineTargets(
    database: Queryable,
    anker: string,
): Promise<EditorPowerlineTargets | undefined> {
    const [linie] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM powerline WHERE public_id = ${anker} AND is_active
    `;
    if (linie === undefined) return undefined;
    return { targets: await leseNodices(database, linie.map_domain_id) };
}

/**
 * Name, Beschreibung und ihre Herkunft einer Änderung an der Linie, vorab geprüft (WI-0225, Modell c): ein Wert ist manual, ↺ (`{ revert: "wiki" }`) wiki. Den Wiki-Namen holt die
 * Transaktion aus dem Artikel, den die Linie nach der Operation trägt; die Beschreibung wird bei ↺ geleert und folgt dem Wiki. Ein leerer Name ist 400.
 */
export interface LinienKopf {
    nameZurueck: boolean;
    name: string | undefined;
    beschreibung: string | null | undefined;
    herkunft: Partial<Record<"name" | "description", FeldHerkunft>>;
}

export function linienKopf(body: Pick<PowerlineUpdateBody, "name" | "description">): LinienKopf {
    const nameZurueck = typeof body.name === "object";
    const name = body.name === undefined || typeof body.name === "object" ? undefined : body.name.trim();
    if (name === "")
        throw new ApiError(400, "validation_failed", "Eine Kraftlinie braucht einen Namen.", { field: "name" });
    const beschreibung =
        body.description === undefined
            ? undefined
            : body.description !== null && typeof body.description === "object"
              ? null
              : leer(body.description);
    const herkunft: LinienKopf["herkunft"] = {
        ...(body.name === undefined ? {} : { name: nameZurueck ? "wiki" : "manual" }),
        ...(body.description === undefined
            ? {}
            : { description: body.description !== null && typeof body.description === "object" ? "wiki" : "manual" }),
    };
    return { nameZurueck, name, beschreibung, herkunft };
}

/** `powerline.update_line` (K6, K8): Felder und Form an den Abschnitten der Linie, gegen ihre Revisionen, in EINER Operation. */
export async function updatePowerlineLine(
    database: Database,
    actor: MapActor,
    anker: string,
    body: PowerlineUpdateBody,
): Promise<OperationReceipt> {
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM powerline WHERE public_id = ${anker} AND is_active
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
    const kopf = linienKopf(body);

    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "powerline.update_line",
            mapDomainId: vorab.map_domain_id,
            body: { anker, ...body },
            // ↺ im Verlauf: eine neue Operation, nichts wird gelöscht.
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        (tx) => schreibeLinieImTx(tx, actor, anker, body, kopf),
    );
}

/**
 * Felder und Form an den Abschnitten der Linie in einer laufenden Transaktion (geteilt von `powerline.update_line` und der Rücknahme einer Serie, `ruecknahme-kraftlinie.ts`, WI-0265 B6b):
 * sperren, Sperre anderer prüfen, Revisionen vergleichen (409), schreiben, Bahn neu rechnen. `body.reverts` macht nur den Satz der Zusammenfassung.
 */
export async function schreibeLinieImTx(
    tx: Sql,
    actor: MapActor,
    anker: string,
    body: PowerlineUpdateBody,
    kopf: LinienKopf,
): Promise<Awaited<ReturnType<Parameters<typeof mapOperation>[3]>>> {
    const { nameZurueck, beschreibung, herkunft } = kopf;
    let name = kopf.name;
    const abschnitte = await sperreLinie(tx, anker);
    if (abschnitte.length === 0) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
    await pruefeLinienSperre(
        tx,
        actor,
        abschnitte.map((a) => a.public_id),
    );
    const basis = new Map(body.segments.map((s) => [s.id, s.baseRevision]));
    // Derselbe Satz Abschnitte mit denselben Revisionen, sonst hat jemand die Linie inzwischen geändert.
    const abweichend =
        abschnitte.find((a) => basis.get(a.public_id) !== a.revision) ??
        (basis.size !== abschnitte.length ? abschnitte[0] : undefined);
    if (abweichend !== undefined)
        throw await mapEditConflict(
            tx,
            { kind: "powerline", publicId: abweichend.public_id },
            { revision: abweichend.revision, changedAt: abweichend.updated_at },
        );

    const alt = abschnitte[0] as AbschnittZeile;
    if (nameZurueck) name = await wikiName(tx, abschnitte, body.wiki);
    const neuerName = name !== undefined && name !== alt.name ? name : undefined;
    let verschmolzen = 0;
    if (neuerName !== undefined) {
        const [andere] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM powerline
                 WHERE map_domain_id = ${alt.map_domain_id} AND name = ${neuerName} AND is_active
            `;
        verschmolzen = andere?.n ?? 0;
    }
    // Die Form je Abschnitt (K8): ein umgehängtes Ende muss ein Nodix sein, und Anfang und Ende bleiben verschieden.
    const form = new Map(body.segments.map((s) => [s.id, s]));
    // Nodix anfügen und herausnehmen (T28 (5)): Es bleibt mindestens ein Abschnitt.
    const entfallen = new Set(body.segments.filter((s) => s.remove === true).map((s) => s.id));
    const neue = body.add ?? [];
    const wieder = body.revive ?? [];
    if (entfallen.size === abschnitte.length && neue.length === 0 && wieder.length === 0)
        throw new ApiError(
            400,
            "validation_failed",
            "Eine Kraftlinie behält mindestens einen Abschnitt; ganz geht sie mit „Kraftlinie entfernen“.",
            { field: "segments" },
        );
    // Zurück an die Linie (↺ im Verlauf): gelöschte Abschnitte derselben Karte, mit der Revision nach dem Herausnehmen.
    const zurueck =
        wieder.length === 0
            ? []
            : await tx<(AbschnittZeile & { is_active: boolean; off_map: boolean })[]>`
                      SELECT public_id::text AS public_id, name, label_visible, description, curve,
                             from_public_id::text AS from_public_id, to_public_id::text AS to_public_id,
                             revision::int AS revision, updated_at, map_domain_id, is_active, off_map
                        FROM powerline
                       WHERE public_id = ANY(${wieder.map((w) => w.id)}::uuid[]) AND map_domain_id = ${alt.map_domain_id}
                       ORDER BY public_id
                         FOR UPDATE
                  `;
    for (const w of wieder) {
        const z = zurueck.find((r) => r.public_id === w.id);
        if (z === undefined) throw new ApiError(404, "not_found", "Diesen Abschnitt gibt es nicht.", { segment: w.id });
        if (standVon(z) !== "geloescht")
            throw new ApiError(400, "validation_failed", "Dieser Abschnitt ist nicht herausgenommen.", {
                segment: w.id,
            });
        if (z.revision !== w.baseRevision)
            throw await mapEditConflict(
                tx,
                { kind: "powerline", publicId: z.public_id },
                { revision: z.revision, changedAt: z.updated_at },
            );
    }
    const neueEnden = [
        ...new Set(
            [
                ...body.segments.flatMap((s) => [s.from, s.to]),
                ...neue.flatMap((n) => [n.from, n.to]),
                ...zurueck.flatMap((z) => [z.from_public_id, z.to_public_id]),
            ].filter((id) => id !== undefined),
        ),
    ];
    const nodexLage = new Map(
        neueEnden.length === 0
            ? []
            : (await leseNodices(tx, alt.map_domain_id, neueEnden)).map((n) => [n.id, n] as const),
    );
    const fremd = neueEnden.find((id) => !nodexLage.has(id));
    if (fremd !== undefined)
        throw new ApiError(400, "validation_failed", "Ein Ende hängt nur an einem Nodix.", { node: fremd });
    const gleich = neue.find((n) => selberNodix(n.from, n.to));
    if (gleich !== undefined)
        throw new ApiError(400, "validation_failed", "Anfang und Ende eines Abschnitts liegen am selben Nodix.", {
            node: gleich.from,
        });
    for (const a of abschnitte) {
        if (entfallen.has(a.public_id)) continue;
        const s = form.get(a.public_id);
        if (selberNodix(s?.from ?? a.from_public_id, s?.to ?? a.to_public_id))
            throw new ApiError(400, "validation_failed", "Anfang und Ende eines Abschnitts liegen am selben Nodix.", {
                segment: a.public_id,
            });
    }

    // EIN Update je Abschnitt: Felder und Form zusammen, damit die Revision genau einmal zählt.
    const revisionNach = new Map<string, number>();
    const umgeformt: string[] = [];
    for (const a of abschnitte) {
        const s = form.get(a.public_id);
        if (entfallen.has(a.public_id)) {
            // Herausgenommen: still wie „Ganz löschen“, die Zeile und ihre Wiki-Zuordnung bleiben.
            const [weg] = await tx<{ revision: number }[]>`
                    UPDATE powerline SET is_active = FALSE, off_map = FALSE WHERE public_id = ${a.public_id}::uuid
                 RETURNING revision::int AS revision
                `;
            revisionNach.set(a.public_id, weg!.revision);
            continue;
        }
        const kurve = s !== undefined && "curve" in s ? s.curve : undefined;
        const [zeile] = await tx<{ revision: number }[]>`
                UPDATE powerline
                   SET name = coalesce(${neuerName ?? null}::text, name),
                       label_visible = coalesce(${body.labelVisible ?? null}::boolean, label_visible),
                       description = CASE WHEN ${beschreibung !== undefined} THEN ${beschreibung ?? null}::text ELSE description END,
                       curve = CASE WHEN ${kurve !== undefined} THEN ${kurve ?? null}::double precision ELSE curve END,
                       from_public_id = coalesce(${s?.from ?? null}::uuid, from_public_id),
                       to_public_id = coalesce(${s?.to ?? null}::uuid, to_public_id),
                       revision = revision
                 WHERE public_id = ${a.public_id}::uuid
             RETURNING revision::int AS revision
            `;
        revisionNach.set(a.public_id, zeile!.revision);
        if (
            (kurve !== undefined && kurve !== a.curve) ||
            (s?.from !== undefined && s.from !== a.from_public_id) ||
            (s?.to !== undefined && s.to !== a.to_public_id)
        )
            umgeformt.push(a.public_id);
    }
    // Angefügt (Nodix anfügen): ein gerader Abschnitt von Nodix zu Nodix mit den Feldern der Linie, auf Wunsch gebogen.
    const angefuegt: { id: string; revision: number; from: string; to: string; curve: number | null }[] = [];
    for (const n of neue) {
        const von = nodexLage.get(n.from)!;
        const nach = nodexLage.get(n.to)!;
        const id = randomUUID();
        const [zeile] = await tx<{ revision: number }[]>`
                INSERT INTO powerline (public_id, map_domain_id, name, label_visible, description, from_public_id, to_public_id,
                                       curve, geom, drawn_geom, source_system, is_active)
                VALUES (${id}::uuid, ${alt.map_domain_id}, ${neuerName ?? alt.name},
                        ${body.labelVisible ?? alt.label_visible},
                        ${beschreibung !== undefined ? beschreibung : alt.description}, ${n.from}::uuid, ${n.to}::uuid,
                        ${n.curve ?? null}::double precision,
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${von.x}, ${von.y}), ST_MakePoint(${nach.x}, ${nach.y})), 0),
                        ST_SetSRID(ST_MakeLine(ST_MakePoint(${von.x}, ${von.y}), ST_MakePoint(${nach.x}, ${nach.y})), 0),
                        'avesmaps3d', TRUE)
             RETURNING revision::int AS revision
            `;
        angefuegt.push({ id, revision: zeile!.revision, from: n.from, to: n.to, curve: n.curve ?? null });
    }
    // Zurückgekommen: wieder auf der Karte, mit den Feldern, die die Linie jetzt trägt.
    const linienName = neuerName ?? alt.name;
    const linienBeschriftung = body.labelVisible ?? alt.label_visible;
    const linienBeschreibung = beschreibung !== undefined ? beschreibung : alt.description;
    const zurueckgekommen: { zeile: AbschnittZeile; revision: number }[] = [];
    for (const z of zurueck) {
        const [zeile] = await tx<{ revision: number }[]>`
                UPDATE powerline
                   SET is_active = TRUE, off_map = FALSE, name = ${linienName}, label_visible = ${linienBeschriftung},
                       description = ${linienBeschreibung}
                 WHERE public_id = ${z.public_id}::uuid
             RETURNING revision::int AS revision
            `;
        zurueckgekommen.push({ zeile: z, revision: zeile!.revision });
    }
    const neuGezeichnet = await zieheKraftlinienNach(tx, {
        abschnitte: [...umgeformt, ...angefuegt.map((n) => n.id), ...zurueck.map((z) => z.public_id)],
    });
    // Der Artikel der ganzen Linie (je LINIE wie Legacy): an jedem Abschnitt, den sie danach hat.
    const wikiVorher = new Map<string, string | null>();
    if (body.wiki !== undefined) {
        const ziel = [
            ...abschnitte.filter((a) => !entfallen.has(a.public_id)).map((a) => a.public_id),
            ...angefuegt.map((n) => n.id),
            ...zurueck.map((z) => z.public_id),
        ];
        for (const z of await tx<{ id: string; key: string | null }[]>`
                SELECT p.public_id::text AS id, coalesce(k.wiki_key, s.wiki_key) AS key
                  FROM powerline p
                  LEFT JOIN wiki_key_assignment k
                         ON k.legacy_art = 'kraftlinie' AND k.object_public_id = p.public_id AND k.is_active
                  LEFT JOIN powerline_wiki_assignment w ON w.powerline_id = p.id AND w.is_active
                  LEFT JOIN wiki_powerline_snapshot s ON s.id = w.snapshot_id
                 WHERE p.public_id = ANY(${ziel}::uuid[])
            `)
            wikiVorher.set(z.id, z.key);
        await schreibeArtikel(tx, ziel, body.wiki);
    }
    const wikiNachher = body.wiki === undefined ? undefined : body.wiki === null ? null : body.wiki.key;
    // Die Herkunft an ALLEN Abschnitten, die die Linie danach hat (Orchestrierung 2026-10-18); die von vorher fürs Protokoll.
    const linieDanach = [
        ...abschnitte.filter((a) => !entfallen.has(a.public_id)).map((a) => a.public_id),
        ...angefuegt.map((n) => n.id),
        ...zurueck.map((z) => z.public_id),
    ];
    const herkunftVorher =
        Object.keys(herkunft).length === 0 ? new Map() : await leseHerkunft(tx, "powerline", linieDanach);
    await setzeHerkunft(tx, "powerline", linieDanach, herkunft);

    const entries: MapAuditEntry[] = abschnitte.map((a) => {
        if (entfallen.has(a.public_id))
            return {
                action: "powerline.removed",
                powerlineId: a.public_id,
                revisionBefore: a.revision,
                revisionAfter: revisionNach.get(a.public_id) ?? null,
                changes: { active: { before: true, after: false } },
            };
        const changes: Record<string, MapChange> = {};
        const s = form.get(a.public_id);
        if (neuerName !== undefined) changes["name"] = { before: a.name, after: neuerName };
        if (body.labelVisible !== undefined && body.labelVisible !== a.label_visible)
            changes["labelVisible"] = { before: a.label_visible, after: body.labelVisible };
        if (beschreibung !== undefined && beschreibung !== a.description)
            changes["description"] = { before: a.description, after: beschreibung };
        if (s !== undefined && "curve" in s && s.curve !== undefined && s.curve !== a.curve)
            changes["curve"] = { before: a.curve, after: s.curve };
        if (s?.from !== undefined && s.from !== a.from_public_id)
            changes["from"] = { before: a.from_public_id, after: s.from };
        if (s?.to !== undefined && s.to !== a.to_public_id) changes["to"] = { before: a.to_public_id, after: s.to };
        // Die Herkunft wie am Ort (`nameOrigin`): Der Verlauf nimmt sie beim ↺ mit (WI-0225 Nachtrag 2).
        for (const feld of ["name", "description"] as const) {
            const nachher = herkunft[feld];
            if (nachher === undefined) continue;
            const vorher = herkunftVorher.get(a.public_id)?.[feld] ?? null;
            if (vorher !== nachher) changes[`${feld}Origin`] = { before: vorher, after: nachher };
        }
        return {
            action: "powerline.updated",
            powerlineId: a.public_id,
            revisionBefore: a.revision,
            revisionAfter: revisionNach.get(a.public_id) ?? null,
            changes,
        };
    });
    for (const n of angefuegt)
        entries.push({
            action: "powerline.created",
            powerlineId: n.id,
            revisionBefore: null,
            revisionAfter: n.revision,
            changes: {
                name: { after: neuerName ?? alt.name },
                from: { after: n.from },
                to: { after: n.to },
                ...(n.curve !== null ? { curve: { after: n.curve } } : {}),
                active: { after: true },
            },
        });
    for (const { zeile: z, revision } of zurueckgekommen) {
        const changes: Record<string, MapChange> = { active: { before: false, after: true } };
        if (z.name !== linienName) changes["name"] = { before: z.name, after: linienName };
        if (z.label_visible !== linienBeschriftung)
            changes["labelVisible"] = { before: z.label_visible, after: linienBeschriftung };
        if (z.description !== linienBeschreibung)
            changes["description"] = { before: z.description, after: linienBeschreibung };
        entries.push({
            action: "powerline.revived",
            powerlineId: z.public_id,
            revisionBefore: z.revision,
            revisionAfter: revision,
            changes,
        });
    }
    // Der Artikel im Protokoll: je Abschnitt der Schlüssel vorher und nachher, nur wo er sich ändert.
    if (wikiNachher !== undefined)
        for (const eintrag of entries) {
            const id = eintrag.powerlineId;
            if (id === undefined || !wikiVorher.has(id)) continue;
            const vorher = wikiVorher.get(id) ?? null;
            if (vorher !== wikiNachher)
                eintrag.changes = { ...eintrag.changes, wiki: { before: vorher, after: wikiNachher } };
        }
    return {
        receipt: {
            // Die Abschnitte, die die Linie danach hat: ohne die herausgenommenen, mit den angefügten und zurückgekommenen.
            affected: [
                ...abschnitte
                    .filter((a) => !entfallen.has(a.public_id))
                    .map((a) => ({
                        kind: "powerline" as const,
                        id: a.public_id,
                        revision: revisionNach.get(a.public_id) ?? a.revision,
                    })),
                ...angefuegt.map((n) => ({ kind: "powerline" as const, id: n.id, revision: n.revision })),
                ...zurueckgekommen.map(({ zeile, revision }) => ({
                    kind: "powerline" as const,
                    id: zeile.public_id,
                    revision,
                })),
            ],
            derivedWork: neuGezeichnet > 0 ? [{ kind: "powerline_path", state: "done" }] : [],
            warnings:
                verschmolzen > 0
                    ? [
                          {
                              code: "merged",
                              message: `„${neuerName ?? ""}“ gab es schon; beide Linien sind jetzt eine.`,
                          },
                      ]
                    : [],
        },
        entries,
        summary:
            body.reverts !== undefined
                ? `Kraftlinie „${neuerName ?? alt.name}“: Änderung zurückgenommen`
                : `Kraftlinie „${neuerName ?? alt.name}“: ${
                      umgeformt.length > 0 || entfallen.size > 0 || angefuegt.length > 0 || zurueck.length > 0
                          ? "Form und Felder"
                          : "Felder"
                  }`,
    };
}

/** Was der Verlauf je Wechsel sagt. */
export const WECHSEL_TEXT: Record<PowerlineStateChange, { eintrag: `powerline.${string}`; satz: string }> = {
    "powerline.take_off_map": { eintrag: "powerline.taken_off_map", satz: "von der Karte genommen" },
    "powerline.put_on_map": { eintrag: "powerline.put_on_map", satz: "zurück auf der Karte" },
    "powerline.retire": { eintrag: "powerline.retired", satz: "entfernt" },
    "powerline.restore": { eintrag: "powerline.restored", satz: "zurückgeholt" },
};

/** Warum ein Wechsel nicht geht: der Stand, in dem die Linie gerade ist. */
export const STEHT: Record<PowerlineState, string> = {
    karte: "Diese Kraftlinie ist auf der Karte.",
    abgenommen: "Diese Kraftlinie ist von der Karte genommen.",
    geloescht: "Diese Kraftlinie ist gelöscht.",
};

/**
 * Ein Wechsel des Stands (K10, EDIT-0003 T43; `powerline.retire` auch für „Kraftlinie entfernen“ am Nodix, T39): ALLE Abschnitte der
 * Linie in ihrem Stand, gegen ihre Revisionen (409 wie beim Schreiben). Weich über `is_active` und `off_map`: Die App darf an
 * `powerline` nicht löschen (`map-grants.psql`); Wiki-Zuordnung und Protokoll bleiben. Zurück auf die Karte nur, wenn jedes Ende noch
 * ein Nodix ist; die Bahn wird neu gerechnet. Die Knoten bleiben, wie sie sind.
 */
export async function setPowerlineState(
    database: Database,
    actor: MapActor,
    anker: string,
    body: PowerlineStateBody,
    wechsel: PowerlineStateChange,
): Promise<OperationReceipt> {
    const regel = POWERLINE_STATE_CHANGES[wechsel];
    const [vorab] = await database<{ map_domain_id: string; name: string; is_active: boolean; off_map: boolean }[]>`
        SELECT map_domain_id, name, is_active, off_map FROM powerline WHERE public_id = ${anker}
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
    const vorher = standVon(vorab);
    if (!(regel.from as readonly PowerlineState[]).includes(vorher))
        throw new ApiError(400, "validation_failed", STEHT[vorher], { field: "state" });
    const text = WECHSEL_TEXT[wechsel];
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: wechsel,
            mapDomainId: vorab.map_domain_id,
            body: { anker, ...body },
            ...(body.reverts !== undefined ? { source: "restore" as const } : {}),
        },
        async (tx) => {
            const ergebnis = await wechsleStandImTx(tx, actor, anker, body.segments, wechsel, vorab);
            return {
                receipt: { affected: ergebnis.affected, derivedWork: ergebnis.derivedWork, warnings: [] },
                entries: ergebnis.entries,
                summary: `Kraftlinie „${vorab.name}“ ${text.satz}`,
            };
        },
    );
}

/**
 * Der Wechsel des Stands EINER Linie in einer laufenden Transaktion (K10; geteilt von `setPowerlineState` und der Mehrfachauswahl,
 * WI-0238 `kraftlinien-sammel.ts`): sperren, Sperre anderer prüfen, Revisionen vergleichen (409), Stand setzen, Bahn neu rechnen.
 */
export async function wechsleStandImTx(
    tx: Sql,
    actor: MapActor,
    anker: string,
    segments: readonly { id: string; baseRevision: number }[],
    wechsel: PowerlineStateChange,
    vorab: { is_active: boolean; off_map: boolean },
): Promise<{
    affected: OperationReceipt["affected"];
    derivedWork: OperationReceipt["derivedWork"];
    entries: MapAuditEntry[];
}> {
    const regel = POWERLINE_STATE_CHANGES[wechsel];
    const text = WECHSEL_TEXT[wechsel];
    const abschnitte = await sperreLinie(tx, anker, standVon(vorab));
    if (abschnitte.length === 0) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
    await pruefeLinienSperre(
        tx,
        actor,
        abschnitte.map((a) => a.public_id),
    );
    const basis = new Map(segments.map((s) => [s.id, s.baseRevision]));
    const abweichend =
        abschnitte.find((a) => basis.get(a.public_id) !== a.revision) ??
        (basis.size !== abschnitte.length ? abschnitte[0] : undefined);
    if (abweichend !== undefined)
        throw await mapEditConflict(
            tx,
            { kind: "powerline", publicId: abweichend.public_id },
            { revision: abweichend.revision, changedAt: abweichend.updated_at },
        );
    const ziel = { is_active: regel.to === "karte", off_map: regel.to === "abgenommen" };
    if (ziel.is_active) {
        const enden = [...new Set(abschnitte.flatMap((a) => [a.from_public_id, a.to_public_id]))];
        const nodices = new Set(await nodixKennungen(tx, abschnitte[0]!.map_domain_id, enden));
        const fehlt = enden.find((id) => !nodices.has(id));
        if (fehlt !== undefined)
            throw new ApiError(
                400,
                "validation_failed",
                "Ein Ende der Kraftlinie hängt an keinem Nodix mehr; so kommt sie nicht zurück auf die Karte.",
                { node: fehlt },
            );
    }
    const ids = abschnitte.map((a) => a.public_id);
    const neu = await tx<{ public_id: string; revision: number }[]>`
        UPDATE powerline SET is_active = ${ziel.is_active}, off_map = ${ziel.off_map}
         WHERE public_id = ANY(${ids}::uuid[])
     RETURNING public_id::text AS public_id, revision::int AS revision
    `;
    const neuGezeichnet = ziel.is_active ? await zieheKraftlinienNach(tx, { abschnitte: ids }) : 0;
    const revisionNach = new Map(neu.map((r) => [r.public_id, r.revision]));
    const changes: Record<string, MapChange> = {};
    if (ziel.is_active !== vorab.is_active) changes["active"] = { before: vorab.is_active, after: ziel.is_active };
    if (ziel.off_map !== vorab.off_map) changes["offMap"] = { before: vorab.off_map, after: ziel.off_map };
    return {
        affected: abschnitte.map((a) => ({
            kind: "powerline" as const,
            id: a.public_id,
            revision: revisionNach.get(a.public_id) ?? a.revision,
        })),
        derivedWork: neuGezeichnet > 0 ? [{ kind: "powerline_path", state: "done" }] : [],
        entries: abschnitte.map((a) => ({
            action: text.eintrag,
            powerlineId: a.public_id,
            revisionBefore: a.revision,
            revisionAfter: revisionNach.get(a.public_id) ?? null,
            changes,
        })),
    };
}

/** `powerline.retire` („Ganz löschen“, weich; T39 am Nodix): der Wechsel des Stands nach „gelöscht“. */
export const retirePowerlineLine = (
    database: Database,
    actor: MapActor,
    anker: string,
    body: PowerlineRetireBody,
): Promise<OperationReceipt> => setPowerlineState(database, actor, anker, body, "powerline.retire");

/**
 * `nodix.retire` (K10): ein Kraftlinienpunkt geht weich (`is_active`), nur wenn keine Linie mehr an ihm endet, auch keine von der Karte
 * genommene (sie käme sonst ohne Ende zurück). Gegen seine Revision.
 */
export async function retireNodix(
    database: Database,
    actor: MapActor,
    publicId: string,
    body: NodixRetireBody,
): Promise<OperationReceipt> {
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM nodix WHERE public_id = ${publicId} AND is_active
    `;
    if (vorab === undefined) throw new ApiError(404, "not_found", "Diesen Kraftlinienpunkt gibt es nicht.");
    return mapOperation(
        database,
        actor,
        {
            operationId: body.operationId,
            operation: "nodix.retire",
            mapDomainId: vorab.map_domain_id,
            body: { publicId, ...body },
        },
        async (tx) => {
            const [punkt] = await tx<{ revision: number }[]>`
                SELECT revision::int AS revision FROM nodix WHERE public_id = ${publicId} AND is_active FOR UPDATE
            `;
            if (punkt === undefined) throw new ApiError(404, "not_found", "Diesen Kraftlinienpunkt gibt es nicht.");
            if (punkt.revision !== body.baseRevision)
                throw new ApiError(409, "edit_conflict", "Der Kraftlinienpunkt wurde inzwischen geändert.", {
                    revision: punkt.revision,
                });
            const [enden] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM powerline
                 WHERE (is_active OR off_map) AND (from_public_id = ${publicId}::uuid OR to_public_id = ${publicId}::uuid)
            `;
            if ((enden?.n ?? 0) > 0)
                throw new ApiError(
                    400,
                    "validation_failed",
                    `An diesem Kraftlinienpunkt enden noch ${String(enden!.n)} Abschnitte von Kraftlinien.`,
                    { segments: enden!.n },
                );
            const [neu] = await tx<{ revision: number }[]>`
                UPDATE nodix SET is_active = FALSE WHERE public_id = ${publicId}::uuid RETURNING revision::int AS revision
            `;
            return {
                receipt: {
                    affected: [{ kind: "nodix", id: publicId, revision: neu!.revision }],
                    derivedWork: [],
                    warnings: [],
                },
                entries: [
                    {
                        action: "nodix.retired",
                        nodixId: publicId,
                        revisionBefore: punkt.revision,
                        revisionAfter: neu!.revision,
                        changes: { active: { before: true, after: false } },
                    },
                ],
                summary: "Kraftlinienpunkt entfernt",
            };
        },
    );
}
