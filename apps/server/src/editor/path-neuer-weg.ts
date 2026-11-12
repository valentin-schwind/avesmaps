import { pathReaderName, type PathNeuerWegBody, type PathNeuerWegReceipt } from "@avesmaps3d/shared";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { ApiError } from "../http/api-error.ts";
import { leseHerkunft, setzeHerkunft } from "./feld-herkunft.ts";
import { mapOperation, type MapActor, type MapAuditEntry, type MapChange } from "./map-operation.ts";
import { konflikt, pruefeSperren, type TxErgebnis } from "./path-split.ts";

/**
 * „Auswahl zu neuem Weg“ (WI-0252, `path.regroup`; Vertrag `packages/shared/src/editor-path-sammel.ts`): die gewählten Abschnitte werden
 * EIN Weg unter einem Namen, ihre Wiki-Zuordnung wird aufgehoben. Die Namens- und Zuweisungsaktion; Geometrie und Abschnittseinstellungen
 * bleiben, die Wegfindung rechnet nicht neu (sie liest keinen Namen).
 *
 * - **Zuweisung aufheben** wie „Artikel lösen“ an der Kraftlinie (`kraftlinien-schreiben.ts`, `schreibeArtikel(null)`): jede aktive
 *   Hauptzuweisung in `path_wiki_assignment` und jede Zeile in `wiki_key_assignment` (X2, `weg`) wird still gelegt, mit
 *   `retired_origin editor`. Solche Zeilen fasst kein Import an (`sync-table.ts`, `PROTECTED_ASSIGNMENT`). Das Protokoll führt sie als
 *   `wiki` mit ihren Kennungen, damit ↺ genau sie zurückholt. Die weiteren Artikel (Rolle `further`) bleiben stehen (WI-0300, OPS-000108; Option „Anlegen und lösen“ von
 *   Vali gewählt am 2026-11-09): Sie ändern nie Name oder Gruppe, also hat ein neuer Name keinen Grund, sie zu lösen.
 * - **Name**: ein echter Name (kein Griff, `pathReaderName`) für jeden Abschnitt, Herkunft manual (`field_origin`). Jeder Abschnitt wird
 *   geschrieben, auch einer, der schon so heißt: Seine Zuordnung ändert sich, und ein Entwurf darauf soll es merken (Revision).
 * - **↺** nimmt der Server in der Rücknahme der Wege zurück (`ruecknahme-weg.ts`, `schreibeNeuerWegZurueckIn`): genau die Abschnitte der Operation, jeder noch unter dem Namen, den sie ihm gab;
 *   Name, Herkunft und die stillgelegten Zuordnungen kommen zurück. Kommt eine derselben Zuordnungen inzwischen wieder vor (ein neuer Artikel am Abschnitt), 409. Die Rücknahme davon gruppiert wieder
 *   (WI-0265 B8a2, `schreibeNeuerWegWiederIn`).
 */

interface Zeile {
    id: string;
    public_id: string;
    map_domain_id: string;
    name: string;
    subtype: string;
    is_active: boolean;
    revision: number;
}

/** Eine stillgelegte Zuordnung im Protokoll: ihre Kennung und die Herkunft, die sie vorher trug. */
interface Zuordnung {
    id: string;
    origin: string;
}

/** Was `wiki` im Protokoll vor der Operation festhält: der Artikel, seine Zeilen und die X2-Zeile. */
interface WikiVorher {
    titel: string | null;
    url: string | null;
    zeilen: Zuordnung[];
    x2: string | null;
}

const nichtDa = (): ApiError => new ApiError(404, "not_found", "Einen der gewählten Abschnitte gibt es nicht.");

/** Jeder Abschnitt einmal, in der Folge seiner Kennung (dieselbe Sperrfolge für jede Auswahl). */
function abschnitteVon(body: PathNeuerWegBody): { publicId: string; baseRevision: number }[] {
    const je = new Map(body.sections.map((teil) => [teil.publicId, teil] as const));
    return [...je.values()].sort((a, b) => (a.publicId < b.publicId ? -1 : a.publicId > b.publicId ? 1 : 0));
}

/** Die Abschnitte, gesperrt, geprüft: es gibt sie, alle auf einer Karte und auf der Karte, jeder mit seiner Revision, keiner fremd gehalten. */
async function leseAbschnitte(
    tx: Sql,
    actor: MapActor,
    abschnitte: readonly { publicId: string; baseRevision: number }[],
): Promise<Zeile[]> {
    // FOR NO KEY UPDATE wie `path.update` (Befund Claudio 2026-10-19): Die Operation ändert nie eine Kennung des Wegs.
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

/** Den Namen schreiben (die Revision zählt der Trigger); `undefined` heißt: die Revision hat sich inzwischen bewegt. */
async function schreibeName(tx: Sql, zeile: Zeile, name: string): Promise<number> {
    const [neu] = await tx<{ revision: number }[]>`
        UPDATE path SET name = ${name} WHERE public_id = ${zeile.public_id}::uuid AND revision = ${zeile.revision}
        RETURNING revision::int AS revision
    `;
    if (neu === undefined) throw await konflikt(tx, zeile.public_id);
    return neu.revision;
}

/** Der Anker eines Wegs dieses Namens: die kleinste Kennung seiner Abschnitte auf der Karte (wie die Wegeliste, `path-list.ts`). */
async function ankerDes(tx: Sql, mapDomainId: string, name: string, abschnitte: readonly Zeile[]): Promise<string> {
    const [anker] = await tx<{ id: string | null }[]>`
        SELECT min(public_id::text) AS id FROM path
         WHERE map_domain_id = ${mapDomainId} AND name = ${name} AND btrim(name) <> subtype AND is_active
    `;
    return anker?.id ?? abschnitte[0]!.public_id;
}

export async function neuerWeg(
    database: Database,
    actor: MapActor,
    body: PathNeuerWegBody,
): Promise<PathNeuerWegReceipt> {
    const abschnitte = abschnitteVon(body);
    const name = body.name?.trim() ?? "";
    if (name === "")
        throw new ApiError(400, "validation_failed", "Der neue Weg braucht einen Namen.", { field: "name" });
    const [vorab] = await database<{ map_domain_id: string }[]>`
        SELECT map_domain_id FROM path WHERE public_id = ${abschnitte[0]!.publicId}::uuid
    `;
    if (vorab === undefined) throw nichtDa();
    let anker = abschnitte[0]!.publicId;
    const quittung = await mapOperation(
        database,
        actor,
        { operationId: body.operationId, operation: "path.regroup", mapDomainId: vorab.map_domain_id, body },
        async (tx) => {
            const zeilen = await leseAbschnitte(tx, actor, abschnitte);
            // Ein Griff („Pfad-3443“) oder der Name der eigenen Wegart ist kein Name (WI-0105): Der Weg wäre danach keiner.
            const griff = zeilen.find((z) => pathReaderName(name, z.subtype) === null);
            if (griff !== undefined)
                throw new ApiError(400, "validation_failed", "Das ist kein Name, sondern ein Griff.", {
                    field: "name",
                    publicId: griff.public_id,
                });
            const ids = zeilen.map((z) => z.public_id);
            const zuordnungen = await tx<
                { id: string; path_id: string; origin: string; titel: string | null; url: string | null }[]
            >`
                SELECT w.id::text, p.public_id::text AS path_id, w.assignment_origin AS origin, s.name AS titel, w.wiki_url AS url
                  FROM path_wiki_assignment w
                  JOIN path p ON p.id = w.path_id
                  LEFT JOIN wiki_path_snapshot s ON s.id = w.snapshot_id
                 WHERE p.public_id = ANY(${ids}::uuid[]) AND w.is_active AND w.role = 'main'
                 ORDER BY w.id
            `;
            const x2 = await tx<{ id: string; path_id: string }[]>`
                SELECT id::text, object_public_id::text AS path_id FROM wiki_key_assignment
                 WHERE legacy_art = 'weg' AND object_public_id = ANY(${ids}::uuid[]) AND is_active
            `;
            const herkunft = await leseHerkunft(tx, "path", ids);
            const affected: PathNeuerWegReceipt["affected"][number][] = [];
            const entries: MapAuditEntry[] = [];
            for (const zeile of zeilen) {
                const changes: Record<string, MapChange> = {};
                if (zeile.name !== name) changes["name"] = { before: zeile.name, after: name };
                const vorherHerkunft = herkunft.get(zeile.public_id)?.["name"] ?? null;
                if (vorherHerkunft !== "manual") changes["nameOrigin"] = { before: vorherHerkunft, after: "manual" };
                const eigene = zuordnungen.filter((w) => w.path_id === zeile.public_id);
                const schluessel = x2.find((x) => x.path_id === zeile.public_id);
                if (eigene.length > 0 || schluessel !== undefined) {
                    const wiki: WikiVorher = {
                        titel: eigene[0]?.titel ?? null,
                        url: eigene[0]?.url ?? null,
                        zeilen: eigene.map((w) => ({ id: w.id, origin: w.origin })),
                        x2: schluessel?.id ?? null,
                    };
                    changes["wiki"] = { before: wiki, after: null };
                }
                const revision = await schreibeName(tx, zeile, name);
                affected.push({ kind: "path", id: zeile.public_id, revision });
                entries.push({
                    action: "path.regrouped",
                    pathId: zeile.public_id,
                    revisionBefore: zeile.revision,
                    revisionAfter: revision,
                    changes,
                });
            }
            const zeilenIds = zuordnungen.map((w) => w.id);
            if (zeilenIds.length > 0)
                await tx`
                    UPDATE path_wiki_assignment
                       SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor'
                     WHERE id = ANY(${zeilenIds}::bigint[])
                `;
            if (x2.length > 0)
                await tx`
                    UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
                     WHERE id = ANY(${x2.map((x) => x.id)}::bigint[])
                `;
            await setzeHerkunft(tx, "path", ids, { name: "manual" });
            // Ein Weg ist sein Name: Heißt danach auch ein anderer Abschnitt so, sind beide ein Weg (wie `path.update`, `merged`).
            const [andere] = await tx<{ n: number }[]>`
                SELECT count(*)::int AS n FROM path
                 WHERE map_domain_id = ${vorab.map_domain_id} AND name = ${name} AND btrim(name) <> subtype AND is_active
                   AND NOT (public_id = ANY(${ids}::uuid[]))
            `;
            anker = await ankerDes(tx, vorab.map_domain_id, name, zeilen);
            return {
                receipt: {
                    affected,
                    derivedWork: [],
                    warnings:
                        (andere?.n ?? 0) > 0
                            ? [{ code: "merged", message: `„${name}“ gab es schon; beide Wege sind jetzt einer.` }]
                            : [],
                },
                summary: `${name}: ${String(zeilen.length)} Abschnitte zu einem Weg`,
                entries,
            };
        },
    );
    // Eine wiederholte Kennung bekommt die erste Quittung ohne neuen Lauf: Der Anker ist dann der kleinste genannte Abschnitt.
    return { ...quittung, anker };
}

/** Was die Operation „Auswahl zu neuem Weg“ an jedem ihrer Abschnitte schrieb (`changes` des Protokolls, `path.regrouped`). */
export type NeuerWegProtokoll = ReadonlyMap<string, Record<string, MapChange>>;

/**
 * ↺ in einer laufenden Transaktion (WI-0265 B6a2, die Rücknahme am Server `ruecknahme-weg.ts`): Name, Herkunft und die stillgelegten Zuordnungen genau der Abschnitte der Operation zurück,
 * jeder Abschnitt gegen seine heutige Revision. Heißt ein Abschnitt inzwischen anders, hat ihn jemand umbenannt (409); kommt eine der Zuordnungen wieder vor (ein neuer Artikel am Abschnitt), ebenso.
 */
export async function schreibeNeuerWegZurueckIn(
    tx: Sql,
    actor: MapActor,
    p: {
        readonly abschnitte: readonly { publicId: string; baseRevision: number }[];
        readonly eintraege: NeuerWegProtokoll;
    },
): Promise<TxErgebnis> {
    const zeilen = await leseAbschnitte(tx, actor, p.abschnitte);
    const affected: PathNeuerWegReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    const zurueckZeilen: Zuordnung[] = [];
    const zurueckX2: string[] = [];
    const herkunftZurueck: string[] = [];
    for (const zeile of zeilen) {
        const vorher = p.eintraege.get(zeile.public_id)!;
        const nameNachher = vorher["name"]?.after;
        // Heißt der Abschnitt inzwischen anders, hat ihn jemand umbenannt: Das ↺ legte sonst einen fremden Namen um.
        if (typeof nameNachher === "string" && zeile.name !== nameNachher) throw await konflikt(tx, zeile.public_id);
        const changes: Record<string, MapChange> = {};
        const nameVorher = vorher["name"]?.before;
        const name = typeof nameVorher === "string" ? nameVorher : zeile.name;
        if (name !== zeile.name) changes["name"] = { before: zeile.name, after: name };
        // Die Herkunft „manual“ von vorher bleibt; war sie wiki, kommt sie zurück. Gelöscht wird ein Vermerk nie (`feld-herkunft.ts`).
        if (vorher["nameOrigin"]?.before === "wiki") {
            herkunftZurueck.push(zeile.public_id);
            changes["nameOrigin"] = { before: "manual", after: "wiki" };
        }
        const wiki = vorher["wiki"]?.before as WikiVorher | null | undefined;
        if (wiki !== undefined && wiki !== null) {
            zurueckZeilen.push(...wiki.zeilen);
            if (wiki.x2 !== null) zurueckX2.push(wiki.x2);
            changes["wiki"] = { before: null, after: wiki };
        }
        const revision = await schreibeName(tx, zeile, name);
        affected.push({ kind: "path", id: zeile.public_id, revision });
        entries.push({
            action: "path.regrouped",
            pathId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: revision,
            changes,
        });
    }
    // Dieselben Zeilen wieder aktiv, mit der Herkunft von vorher; eine, die inzwischen ein anderer Artikel ersetzt hat, nicht.
    for (const zuordnung of zurueckZeilen) {
        const [zeile] = await tx<{ id: string }[]>`
            UPDATE path_wiki_assignment w
               SET is_active = TRUE, retired_at = NULL, retired_origin = NULL, assignment_origin = ${zuordnung.origin}
             WHERE w.id = ${zuordnung.id}::bigint AND NOT w.is_active
               AND NOT EXISTS (
                   SELECT 1 FROM path_wiki_assignment a
                    WHERE a.path_id = w.path_id AND a.is_active
                      AND (a.role = w.role AND w.role = 'main' OR a.snapshot_id = w.snapshot_id)
               )
            RETURNING w.id::text
        `;
        if (zeile === undefined)
            throw new ApiError(409, "edit_conflict", "Am Abschnitt hängt inzwischen ein anderer Artikel.", {
                currentRevision: 0,
            });
    }
    if (zurueckX2.length > 0)
        await tx`
            UPDATE wiki_key_assignment SET is_active = TRUE, retired_at = NULL, retired_origin = NULL
             WHERE id = ANY(${zurueckX2}::bigint[]) AND NOT is_active
        `;
    await setzeHerkunft(tx, "path", herkunftZurueck, { name: "wiki" });
    return {
        receipt: { affected, derivedWork: [], warnings: [] },
        summary: `${String(zeilen.length)} Abschnitte zurück in ihre Wege`,
        entries,
    };
}

/**
 * Die Rücknahme der Rücknahme von „Auswahl zu neuem Weg“ (WI-0265 B8a2): die Auswahl wird wieder EIN Weg. Die Einträge der Rücknahme (`path.regrouped`, Gegenrichtung: Name und Herkunft von vorher,
 * die Zuordnungen wieder aktiv) werden umgekehrt: jeder Abschnitt wieder unter dem Namen, den die Operation ihm gab (Herkunft manual), dieselben Zuordnungen wieder still gelegt. Streng wie die Rücknahme:
 * jeder Abschnitt gegen seine heutige Revision und noch unter dem Namen von vorher, jede Zuordnung noch aktiv (sonst 409), ganz oder gar nicht.
 *
 * Geschrieben werden die Einträge `path.regrouped_again`, nicht `path.regrouped`: Name und Aktion des Eintrags sagen, in welche Richtung er ging, sodass seine Rücknahme
 * (`schreibeNeuerWegZurueckIn`, dieselbe wie für das Original) die richtige ist und sich beliebig oft wiederholen lässt.
 */
export async function schreibeNeuerWegWiederIn(
    tx: Sql,
    actor: MapActor,
    p: {
        readonly abschnitte: readonly { publicId: string; baseRevision: number }[];
        readonly eintraege: NeuerWegProtokoll;
    },
): Promise<TxErgebnis> {
    const zeilen = await leseAbschnitte(tx, actor, p.abschnitte);
    const herkunft = await leseHerkunft(
        tx,
        "path",
        zeilen.map((z) => z.public_id),
    );
    const affected: PathNeuerWegReceipt["affected"][number][] = [];
    const entries: MapAuditEntry[] = [];
    const stillZeilen: string[] = [];
    const stillX2: string[] = [];
    for (const zeile of zeilen) {
        const vorher = p.eintraege.get(zeile.public_id)!;
        // Die Rücknahme gab dem Abschnitt seinen früheren Namen (`after`); heißt er inzwischen anders, hat ihn jemand umbenannt.
        const nameAlt = vorher["name"]?.after;
        if (typeof nameAlt === "string" && zeile.name !== nameAlt) throw await konflikt(tx, zeile.public_id);
        const nameNeu = vorher["name"]?.before;
        const name = typeof nameNeu === "string" ? nameNeu : zeile.name;
        const changes: Record<string, MapChange> = {};
        if (name !== zeile.name) changes["name"] = { before: zeile.name, after: name };
        const vorherHerkunft = herkunft.get(zeile.public_id)?.["name"] ?? null;
        if (vorherHerkunft !== "manual") changes["nameOrigin"] = { before: vorherHerkunft, after: "manual" };
        const wiki = vorher["wiki"]?.after as WikiVorher | null | undefined;
        if (wiki !== undefined && wiki !== null) {
            stillZeilen.push(...wiki.zeilen.map((w) => w.id));
            if (wiki.x2 !== null) stillX2.push(wiki.x2);
            changes["wiki"] = { before: wiki, after: null };
        }
        const revision = await schreibeName(tx, zeile, name);
        affected.push({ kind: "path", id: zeile.public_id, revision });
        entries.push({
            action: "path.regrouped_again",
            pathId: zeile.public_id,
            revisionBefore: zeile.revision,
            revisionAfter: revision,
            changes,
        });
    }
    // Dieselben Zeilen wieder still gelegt (wie die Operation): Jede muss noch aktiv sein, sonst hat sie inzwischen jemand anders angefasst.
    if (stillZeilen.length > 0) {
        const still = await tx<{ id: string }[]>`
            UPDATE path_wiki_assignment
               SET is_active = FALSE, retired_at = now(), retired_origin = 'editor', assignment_origin = 'editor'
             WHERE id = ANY(${stillZeilen}::bigint[]) AND is_active
            RETURNING id::text
        `;
        if (still.length !== stillZeilen.length)
            throw new ApiError(409, "edit_conflict", "Eine Zuordnung am Abschnitt hat sich inzwischen geändert.", {
                currentRevision: 0,
            });
    }
    if (stillX2.length > 0) {
        const still = await tx<{ id: string }[]>`
            UPDATE wiki_key_assignment SET is_active = FALSE, retired_at = now(), retired_origin = 'editor'
             WHERE id = ANY(${stillX2}::bigint[]) AND is_active
            RETURNING id::text
        `;
        if (still.length !== stillX2.length)
            throw new ApiError(409, "edit_conflict", "Eine Zuordnung am Abschnitt hat sich inzwischen geändert.", {
                currentRevision: 0,
            });
    }
    await setzeHerkunft(
        tx,
        "path",
        zeilen.map((z) => z.public_id),
        { name: "manual" },
    );
    return {
        receipt: { affected, derivedWork: [], warnings: [] },
        summary: `${String(zeilen.length)} Abschnitte wieder zu einem Weg`,
        entries,
    };
}
