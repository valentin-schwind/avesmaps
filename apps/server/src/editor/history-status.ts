import type { MapHistoryActor, MapHistoryEntry, MapHistoryStatus } from "@avesmaps3d/shared";
import type { Queryable } from "../database.ts";
import {
    WIKISYNC_FLAECHE_OPERATION,
    WIKISYNC_FLAECHE_RUECKNAHME_OPERATION,
    WIKISYNC_FLAECHE_WIEDER_OPERATION,
    WIKISYNC_LANDMARKE_ANBIETEN_OPERATION,
    WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION,
    WIKISYNC_OBJEKT_OPERATIONEN,
    WIKISYNC_OBJEKT_RUECKNAHME_OPERATION,
    WIKISYNC_OPERATIONEN,
    WIKISYNC_OPERATION_ART,
    WIKISYNC_QUELLE,
    WIKISYNC_REGELN_OPERATION,
    WIKISYNC_REGELN_REDO_OPERATION,
    WIKISYNC_REGELN_UNDO_OPERATION,
    WIKISYNC_RUECKNAHMEN,
    istRuecknehmbareOperation,
} from "./ruecknahme-arten.ts";

/**
 * Der Zustand einer Operation in der Liste (WI-0265 B2a; Fachvertrag A.3, C.4): aus der Link-Tafel `map_operation_revert_link` (Migration 0262) und der Quelle
 * abgeleitet, nie gespeichert.
 *
 * - Ein Original ist `bereits_zurueckgenommen`, wenn eine Rücknahme es nennt, die **selbst noch gilt**. Rücknahme einer Rücknahme ist eine Rücknahme mit
 *   Verknüpfung auf die Rücknahme: Sie hebt die erste auf, das Original gilt wieder (`ruecknehmbar`). Die Kette endet immer bei einer jüngeren Operation
 *   (eine Rücknahme nennt nur, was es schon gab), also ohne Zyklus.
 * - Import und das Zurücksetzen der Testwelt sind `nicht_ruecknehmbar` (Grund `quelle`): eigene Wege, nie die Link-Tafel.
 * - **Der WikiSync** (WI-0265 B8d, B8e) hat eine eigene Rücknahme je Lauf und Bereich (`wikisync_uebernahme.zurueckgenommen_am`, `wikisync.zuruecknehmen`) und je Übernahme von Regelvorschlägen
 *   (`wikisync_regel_uebernahme.zurueckgenommen_am`, `lore.rules_wikisync_undo`, dazu die Gegenrichtung `lore.rules_wikisync_redo`); das ↺ in „Änderungen“ ruft genau sie auf (`ruecknahme-wikisync.ts`). Eine
 *   Übernahme (`wikisync.uebernehmen`, `lore.rules_wikisync`) ist darum `ruecknehmbar`, bis diese Spalte gesetzt ist, danach `bereits_zurueckgenommen` mit `revertedBy` (die Rücknahme, samt Grund). Eine
 *   Rücknahme ist selbst `ruecknehmbar`, solange keine Rücknahme von ihr gilt; ist sie zurückgenommen, gilt die Übernahme wieder. Die Zeilen eines Laufs halten das in `ordneRuecknahmenNeu`, die Regelübernahmen
 *   in der Kette ihrer Operationen (Übernahme, Rücknahme, Gegenrichtung, …), der Sync eines Objekts wie die Operationen der Editoren in einer Kette, die aber die Quittungen tragen (`affected`), die Zuweisung einer
 *   Fläche am nächsten Ereignis der Fläche.
 *   Was sonst der WikiSync schreibt (`wikisync.objekt_sync` und die Zuweisung offener Flächen sind seit B8e dabei, die Rücknahme der Zuweisung nicht), ist `nicht_ruecknehmbar` mit Grund `art`.
 *   Die Rücknahmen liefern `reverts` (das, was sie zurücknahmen).
 * - Ältere Etikett-Rücknahmen (`source = restore` ohne Verknüpfung) tragen kein `reverts`; die Oberfläche nennt sie „Rücknahme ohne Bezug zum Original“. Ob
 *   ein Original durch eine solche zurückgenommen wurde, weiß die Tafel nicht: Es gibt keinen Backfill nach Vermutung, und das Original gilt als `ruecknehmbar`
 *   (der Feldvergleich der Vorprüfung schützt dort weiter).
 * - **Die Art** (WI-0265 B6f, Fachvertrag A.3 `nicht_ruecknehmbar(art)`): Eine Operation von Person oder Wiederherstellung, die keine Familie zurücknimmt (Anlegen, Weg teilen,
 *   Gebiet-Form, die Stammdaten der Inhalte …), ist `nicht_ruecknehmbar` mit `statusReason: "art"`. Maßgeblich ist der Katalog der Operationsnamen (`ruecknahme-arten.ts`), aus dem
 *   auch die Adapter ihr `pruefeArt` nehmen; die Nutzlast (die Aktionen der Einträge) prüft erst der Adapter in der Vorprüfung. Im Zweifel bleibt eine Operation `ruecknehmbar`:
 *   lieber ein ↺, das sauber ablehnt (`not_revertable`), als ein fälschlich verstecktes. Eine geltende Rücknahme geht der Art vor (`bereits_zurueckgenommen`); Links gibt es
 *   aber nur für Operationen, die ein Adapter annahm, also nie für eine Art-Operation.
 * - 🔴 `ruecknehmbar` ist eine Anzeige, keine Zusage (Fachvertrag A.3): `konflikt` entsteht erst in der Vorprüfung (`ruecknahme.ts`).
 */

/** Die Quellen, die eine Rücknahme aus „Änderungen“ zulassen (`source`); alles andere hat einen eigenen Weg. */
export const RUECKNEHMBARE_QUELLEN: readonly string[] = ["editor", "restore"];

/** So tief folgt die Ableitung der Rücknahme einer Rücknahme einer Rücknahme …; tiefer gibt es sie nicht (ein Wächter gegen eine Endlosschleife). */
const MAX_TIEFE = 40;

export interface ZustandsEingabe {
    operationId: string;
    source: string;
    /** Der Name der Operation (`map_operation.action`, etwa `place.update`): Der Katalog der Arten fragt nach ihm. */
    operation: string;
}

/** Eine Zeile `map_operation`, soweit eine Person oder ein Agent als Handelnder daraus angezeigt wird. */
export interface AkteurZeile {
    actor_kind: MapHistoryActor["kind"];
    actor_person_id: string | null;
    actor_label: string | null;
    approval_ref: string | null;
    display_name: string | null;
}

/** Der Handelnde einer Operation für die Antwort (`self` markiert die Person der Sitzung; `id` nur bei einer Person, siehe `MapHistoryActor.id`). */
export function akteurVon(zeile: AkteurZeile, personId: string | undefined): MapHistoryActor {
    const name = zeile.actor_kind === "person" ? (zeile.display_name ?? undefined) : (zeile.actor_label ?? undefined);
    return {
        kind: zeile.actor_kind,
        ...(zeile.actor_kind === "person" && zeile.actor_person_id !== null ? { id: zeile.actor_person_id } : {}),
        ...(name !== undefined ? { name } : {}),
        ...(personId !== undefined && zeile.actor_person_id === personId ? { self: true as const } : {}),
        ...(zeile.approval_ref !== null ? { approvalRef: zeile.approval_ref } : {}),
    };
}

export type Zustand = Pick<MapHistoryEntry, "status" | "statusReason" | "revertedBy" | "reverts" | "reason">;

interface ReverterRow extends AkteurZeile {
    reverted_id: string;
    restore_id: string;
    seq: string;
    at: Date;
}

interface LinkRow {
    restore_id: string;
    reverted_id: string;
}

interface WikiSyncRow {
    operation_id: string;
    rueck_operation_id: string | null;
    seq: string | null;
    at: Date | null;
    actor_kind: MapHistoryActor["kind"] | null;
    actor_person_id: string | null;
    actor_label: string | null;
    approval_ref: string | null;
    display_name: string | null;
    zurueck_von_operation_id: string | null;
}

/**
 * Der Zustand je Operation: `status`, `statusReason`, `revertedBy` und `reverts`. `personId` ist die Person der Sitzung (nur für `self` am Handelnden der
 * Rücknahme). Liest nur; eine bis drei Abfragen je Tiefe der Rücknahme-Kette (meist eine), dazu eine für den WikiSync, wenn Operationen von ihm dabei sind.
 */
export async function ladeZustaende(
    database: Queryable,
    operationen: readonly ZustandsEingabe[],
    personId: string | undefined,
): Promise<Map<string, Zustand>> {
    const ergebnis = new Map<string, Zustand>();
    if (operationen.length === 0) return ergebnis;
    const quelleVon = new Map(operationen.map((op) => [op.operationId, op.source] as const));
    const nameVon = new Map(operationen.map((op) => [op.operationId, op.operation] as const));

    // 1. Was eine Rücknahme der Liste zurücknimmt (`reverts`), in der Reihenfolge der Anfrage.
    const rueckIds = operationen.filter((op) => op.source === "restore").map((op) => op.operationId);
    const revertsJeRuecknahme = new Map<string, string[]>();
    if (rueckIds.length > 0) {
        const links = await database<LinkRow[]>`
            SELECT restore_operation_id::text AS restore_id, reverted_operation_id::text AS reverted_id
              FROM map_operation_revert_link
             WHERE restore_operation_id = ANY(${rueckIds}::uuid[])
             ORDER BY restore_operation_id, position
        `;
        for (const link of links) {
            const liste = revertsJeRuecknahme.get(link.restore_id);
            if (liste === undefined) revertsJeRuecknahme.set(link.restore_id, [link.reverted_id]);
            else liste.push(link.reverted_id);
        }
    }

    // 2. Wer die Operationen der Liste zurücknahm, und wer diese Rücknahmen wiederum: die Hülle, Stufe für Stufe.
    const reverterJe = new Map<string, ReverterRow[]>();
    // Der Sync eines Objekts und seine Rücknahme stehen in einer eigenen Kette (die Quittung der Rücknahme nennt die Operation davor), nicht in der Link-Tafel.
    const objektOperationen = operationen.filter(
        (op) => op.source === WIKISYNC_QUELLE && WIKISYNC_OBJEKT_OPERATIONEN.has(op.operation),
    );
    let stufe: string[] = [
        ...operationen.filter((op) => RUECKNEHMBARE_QUELLEN.includes(op.source)),
        ...objektOperationen,
    ].map((op) => op.operationId);
    for (const zeile of await ladeObjektRuecknahmen(
        database,
        objektOperationen
            .filter((op) => op.operation === WIKISYNC_OBJEKT_RUECKNAHME_OPERATION)
            .map((op) => op.operationId),
        "reverts",
    )) {
        revertsJeRuecknahme.set(zeile.restore_id, [
            ...(revertsJeRuecknahme.get(zeile.restore_id) ?? []),
            zeile.reverted_id,
        ]);
    }
    const gesehen = new Set<string>(stufe);
    for (let tiefe = 0; stufe.length > 0 && tiefe < MAX_TIEFE; tiefe += 1) {
        const zeilen = await database<ReverterRow[]>`
            SELECT l.reverted_operation_id::text AS reverted_id, o.operation_id::text AS restore_id, o.seq::text AS seq, o.at,
                   o.actor_kind, o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
              FROM map_operation_revert_link l
              JOIN map_operation o ON o.operation_id = l.restore_operation_id
              LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
             WHERE l.reverted_operation_id = ANY(${stufe}::uuid[])
        `;
        if (objektOperationen.length > 0) zeilen.push(...(await ladeObjektRuecknahmen(database, stufe, "reverter")));
        const naechste: string[] = [];
        for (const zeile of zeilen) {
            const liste = reverterJe.get(zeile.reverted_id);
            if (liste === undefined) reverterJe.set(zeile.reverted_id, [zeile]);
            else liste.push(zeile);
            if (!gesehen.has(zeile.restore_id)) {
                gesehen.add(zeile.restore_id);
                naechste.push(zeile.restore_id);
            }
        }
        stufe = naechste;
    }

    // Die Übernahmen und Rücknahmen des WikiSync (eigene Tafeln, nicht die Link-Tafel).
    const wiki = await ladeWikiSync(
        database,
        operationen.filter((op) => op.source === WIKISYNC_QUELLE),
        personId,
    );

    // Der Grund der Rücknahmen (`restoreReason` im Fachprotokoll): die der Liste, die, die ein Original aufhoben, und die des WikiSync (WI-0265 B8d). Eine Abfrage, nur wenn es Rücknahmen gibt.
    const grundVon = await ladeGruende(database, [
        ...new Set([
            ...rueckIds,
            ...[...reverterJe.values()].flatMap((liste) => liste.map((r) => r.restore_id)),
            ...[...wiki.revertedBy.values()].map((rueck) => rueck.operationId),
            ...operationen
                .filter((op) => op.source === WIKISYNC_QUELLE && WIKISYNC_RUECKNAHMEN.has(op.operation))
                .map((op) => op.operationId),
        ]),
    ]);

    // 3. Eine Operation gilt, wenn keine ihrer Rücknahmen gilt. Die Kette führt immer zu jüngeren Operationen; `weg` hält trotzdem eine Schleife an.
    const gilt = new Map<string, boolean>();
    const giltOperation = (id: string, weg: ReadonlySet<string>): boolean => {
        const bekannt = gilt.get(id);
        if (bekannt !== undefined) return bekannt;
        if (weg.has(id)) return true;
        const neuerWeg = new Set(weg).add(id);
        const wert = !(reverterJe.get(id) ?? []).some((r) => giltOperation(r.restore_id, neuerWeg));
        gilt.set(id, wert);
        return wert;
    };

    // Der Sync eines Objekts hat ein Protokoll, aus dem er sich zurücknehmen lässt, wenn mindestens ein Eintrag Vorher und Nachher trägt.
    const objektMitProtokoll = new Set<string>();
    if (objektOperationen.length > 0) {
        const mitProtokoll = await database<{ operation_id: string }[]>`
            SELECT DISTINCT e.operation_id::text AS operation_id FROM map_audit_event e
             WHERE e.operation_id = ANY(${objektOperationen.map((op) => op.operationId)}::uuid[])
               AND (e.action LIKE '%.wikisync_uebernommen' OR e.action LIKE '%.wikisync_zurueckgenommen') AND e.changes <> '{}'::jsonb
        `;
        for (const zeile of mitProtokoll) objektMitProtokoll.add(zeile.operation_id);
    }

    for (const op of operationen) {
        const zustand: Zustand = {};
        const reverts = revertsJeRuecknahme.get(op.operationId) ?? wiki.reverts.get(op.operationId);
        if (reverts !== undefined && reverts.length > 0) zustand.reverts = reverts;
        const grund = grundVon.get(op.operationId);
        const quelle = quelleVon.get(op.operationId) ?? "";
        if (
            grund !== undefined &&
            (quelle === "restore" || (quelle === WIKISYNC_QUELLE && WIKISYNC_RUECKNAHMEN.has(op.operation)))
        )
            zustand.reason = grund;
        if (quelle === WIKISYNC_QUELLE) {
            // WI-0265 B8d, B8e: Was der WikiSync zurücknimmt, steht im Katalog; alles andere, was er schreibt, ist keine Art, die „Änderungen“ zurücknimmt.
            if (!WIKISYNC_OPERATIONEN.has(op.operation)) {
                zustand.status = "nicht_ruecknehmbar" satisfies MapHistoryStatus;
                zustand.statusReason = "art";
            } else if (WIKISYNC_OBJEKT_OPERATIONEN.has(op.operation) && !objektMitProtokoll.has(op.operationId)) {
                // Ohne Vorher und Nachher im Fachprotokoll (eine Operation aus der Zeit davor) lässt sich der Sync nicht aus dem Protokoll zurücknehmen: ehrlich ohne ↺.
                zustand.status = "nicht_ruecknehmbar" satisfies MapHistoryStatus;
                zustand.statusReason = "art";
            } else if (WIKISYNC_OBJEKT_OPERATIONEN.has(op.operation)) {
                // Der Sync eines Objekts und seine Rücknahme: die Kette der Quittungen, wie bei den Operationen der Editoren die Link-Tafel.
                const geltende = (reverterJe.get(op.operationId) ?? [])
                    .filter((r) => giltOperation(r.restore_id, new Set([op.operationId])))
                    .sort((a, b) => Number(b.seq) - Number(a.seq))[0];
                if (geltende === undefined) zustand.status = "ruecknehmbar";
                else {
                    zustand.status = "bereits_zurueckgenommen";
                    zustand.revertedBy = {
                        operationId: geltende.restore_id,
                        at: geltende.at.toISOString(),
                        actor: akteurVon(geltende, personId),
                        ...(grundVon.get(geltende.restore_id) !== undefined
                            ? { reason: grundVon.get(geltende.restore_id)! }
                            : {}),
                    };
                }
            } else if (wiki.zurueckgenommen.has(op.operationId)) {
                zustand.status = "bereits_zurueckgenommen";
                const rueck = wiki.revertedBy.get(op.operationId);
                if (rueck !== undefined) {
                    const rueckGrund = grundVon.get(rueck.operationId);
                    zustand.revertedBy = rueckGrund === undefined ? rueck : { ...rueck, reason: rueckGrund };
                }
            } else zustand.status = "ruecknehmbar";
        } else if (!RUECKNEHMBARE_QUELLEN.includes(quelle)) {
            zustand.status = "nicht_ruecknehmbar" satisfies MapHistoryStatus;
            zustand.statusReason = "quelle";
        } else {
            const geltende = (reverterJe.get(op.operationId) ?? [])
                .filter((r) => giltOperation(r.restore_id, new Set([op.operationId])))
                .sort((a, b) => Number(b.seq) - Number(a.seq))[0];
            if (geltende === undefined) {
                if (istRuecknehmbareOperation(nameVon.get(op.operationId) ?? "")) zustand.status = "ruecknehmbar";
                else {
                    zustand.status = "nicht_ruecknehmbar" satisfies MapHistoryStatus;
                    zustand.statusReason = "art";
                }
            } else {
                zustand.status = "bereits_zurueckgenommen";
                zustand.revertedBy = {
                    operationId: geltende.restore_id,
                    at: geltende.at.toISOString(),
                    actor: akteurVon(geltende, personId),
                    ...(grundVon.get(geltende.restore_id) !== undefined
                        ? { reason: grundVon.get(geltende.restore_id)! }
                        : {}),
                };
            }
        }
        ergebnis.set(op.operationId, zustand);
    }
    return ergebnis;
}

/**
 * Die Rücknahmen des Syncs eines Objekts aus den Quittungen (`affected`, Art `wikisync_operation`; WI-0265 B8e). `reverts`: was die Rücknahmen `ids` zurücknahmen; `reverter`: wer die Operationen `ids` zurücknahm
 * (mit Zeit und Handelndem, in der Form der Link-Tafel).
 */
async function ladeObjektRuecknahmen(
    database: Queryable,
    ids: readonly string[],
    richtung: "reverts" | "reverter",
): Promise<ReverterRow[]> {
    if (ids.length === 0) return [];
    if (richtung === "reverts")
        return database<ReverterRow[]>`
            SELECT (a ->> 'id') AS reverted_id, o.operation_id::text AS restore_id, o.seq::text AS seq, o.at,
                   o.actor_kind, o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
              FROM map_operation o
              CROSS JOIN LATERAL jsonb_array_elements(o.receipt -> 'affected') a
              LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
             WHERE o.action = ${WIKISYNC_OBJEKT_RUECKNAHME_OPERATION} AND a ->> 'kind' = ${WIKISYNC_OPERATION_ART}
               AND o.operation_id = ANY(${ids as string[]}::uuid[])
        `;
    return database<ReverterRow[]>`
        SELECT (a ->> 'id') AS reverted_id, o.operation_id::text AS restore_id, o.seq::text AS seq, o.at,
               o.actor_kind, o.actor_person_id::text AS actor_person_id, o.actor_label, o.approval_ref, p.display_name
          FROM map_operation o
          CROSS JOIN LATERAL jsonb_array_elements(o.receipt -> 'affected') a
          LEFT JOIN avesmaps_auth.person p ON p.id = o.actor_person_id
         WHERE o.action = ${WIKISYNC_OBJEKT_RUECKNAHME_OPERATION} AND a ->> 'kind' = ${WIKISYNC_OPERATION_ART}
           AND (a ->> 'id') = ANY(${ids as string[]}::text[])
    `;
}

/**
 * Der Grund je Rücknahme: `restoreReason` (nur `after`) im Fachprotokoll, an jedem Eintrag der Rücknahme gleich (Gate 2, WI-0265 B3/B4); der erste genügt. Eine Rücknahme
 * ohne Grund (eigene Änderungen, ältere Etikett-Rücknahmen) kommt nicht vor.
 */
async function ladeGruende(database: Queryable, operationIds: readonly string[]): Promise<Map<string, string>> {
    const gruende = new Map<string, string>();
    if (operationIds.length === 0) return gruende;
    const zeilen = await database<{ operation_id: string; grund: string }[]>`
        SELECT DISTINCT ON (e.operation_id) e.operation_id::text AS operation_id, e.changes -> 'restoreReason' ->> 'after' AS grund
          FROM map_audit_event e
         WHERE e.operation_id = ANY(${operationIds as string[]}::uuid[]) AND e.changes ? 'restoreReason'
         ORDER BY e.operation_id, e.id
    `;
    for (const zeile of zeilen)
        if (typeof zeile.grund === "string" && zeile.grund !== "") gruende.set(zeile.operation_id, zeile.grund);
    return gruende;
}

/**
 * Die Rücknahmen des WikiSync, getrennt von der Link-Tafel (WI-0253 §9; `wikisync_uebernahme`, `wikisync_regel_uebernahme`): Eine Übernahme, die eine Rücknahme aufhob (`zurueckgenommen_am`), nennt sie in `revertedBy`;
 * die Operation der Rücknahme nennt die Übernahme in `reverts`. Seit WI-0265 B8d ist die Übernahme davon `ruecknehmbar` oder `bereits_zurueckgenommen` (`zurueckgenommen`): Das ↺ in „Änderungen“ ruft die
 * Rücknahme des WikiSync selbst auf (`undo_wikisync_run`, Admin mit Passkey), nie eine zweite. Seit B8e gilt dasselbe für die Rücknahme einer Rücknahme (die Zeilen eines Laufs halten ihren Stand in
 * `ordneRuecknahmenNeu`), für die Gegenrichtung der Regelübernahme (die Kette der Operationen einer Übernahme von Regelvorschlägen) und für die Zuweisung einer Fläche (ihr nächstes Ereignis).
 */
async function ladeWikiSync(
    database: Queryable,
    operationen: readonly ZustandsEingabe[],
    personId: string | undefined,
): Promise<{
    revertedBy: Map<string, NonNullable<Zustand["revertedBy"]>>;
    reverts: Map<string, string[]>;
    zurueckgenommen: Set<string>;
}> {
    const revertedBy = new Map<string, NonNullable<Zustand["revertedBy"]>>();
    const reverts = new Map<string, string[]>();
    const zurueckgenommen = new Set<string>();
    const operationIds = operationen.map((op) => op.operationId);
    if (operationIds.length === 0) return { revertedBy, reverts, zurueckgenommen };
    const nenne = (zeile: WikiSyncRow): void => {
        if (zeile.zurueck_von_operation_id !== null) {
            reverts.set(zeile.operation_id, [zeile.zurueck_von_operation_id]);
        } else if (
            zeile.rueck_operation_id !== null &&
            zeile.at !== null &&
            zeile.actor_kind !== null &&
            zeile.operation_id !== null
        ) {
            revertedBy.set(zeile.operation_id, {
                operationId: zeile.rueck_operation_id,
                at: zeile.at.toISOString(),
                actor: akteurVon(
                    {
                        actor_kind: zeile.actor_kind,
                        actor_person_id: zeile.actor_person_id,
                        actor_label: zeile.actor_label,
                        approval_ref: zeile.approval_ref,
                        display_name: zeile.display_name,
                    },
                    personId,
                ),
            });
            zurueckgenommen.add(zeile.operation_id);
        }
    };
    // Die Läufe: Übernahme und Rücknahme sind Zeilen derselben Tafel; eine Rücknahme kann ihrerseits zurückgenommen sein.
    const zeilen = await database<WikiSyncRow[]>`
        SELECT u.operation_id::text AS operation_id, r.operation_id::text AS rueck_operation_id, ro.seq::text AS seq, ro.at,
               ro.actor_kind, ro.actor_person_id::text AS actor_person_id, ro.actor_label, ro.approval_ref, rp.display_name,
               NULL::text AS zurueck_von_operation_id
          FROM wikisync_uebernahme u
          JOIN wikisync_uebernahme r ON r.id = u.zurueckgenommen_durch
          JOIN map_operation ro ON ro.operation_id = r.operation_id
          LEFT JOIN avesmaps_auth.person rp ON rp.id = ro.actor_person_id
         WHERE u.operation_id = ANY(${operationIds}::uuid[])
        UNION ALL
        SELECT r.operation_id::text, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, u.operation_id::text
          FROM wikisync_uebernahme r
          JOIN wikisync_uebernahme u ON u.id = r.zurueck_von
         WHERE r.art = 'zuruecknahme' AND r.operation_id = ANY(${operationIds}::uuid[]) AND u.operation_id IS NOT NULL
    `;
    for (const zeile of zeilen) nenne(zeile);
    // Die Übernahmen von Regelvorschlägen und die Flächen, denen der Regelvorschlag einen Artikel zuwies.
    const regeln = operationen.filter(
        (op) =>
            op.operation === WIKISYNC_REGELN_OPERATION ||
            op.operation === WIKISYNC_REGELN_UNDO_OPERATION ||
            op.operation === WIKISYNC_REGELN_REDO_OPERATION,
    );
    if (regeln.length > 0) await ladeRegelKetten(database, regeln, personId, { revertedBy, reverts, zurueckgenommen });
    const flaechen = operationen.filter(
        (op) =>
            op.operation === WIKISYNC_FLAECHE_OPERATION ||
            op.operation === WIKISYNC_FLAECHE_RUECKNAHME_OPERATION ||
            op.operation === WIKISYNC_FLAECHE_WIEDER_OPERATION,
    );
    if (flaechen.length > 0) {
        for (const zeile of await ladeFlaechenKetten(database, flaechen)) nenne(zeile);
    }
    // „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7).
    const landmarken = operationen.filter(
        (op) =>
            op.operation === WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION ||
            op.operation === WIKISYNC_LANDMARKE_ANBIETEN_OPERATION,
    );
    if (landmarken.length > 0) {
        for (const zeile of await ladeLandmarkenKetten(database, landmarken)) nenne(zeile);
    }
    return { revertedBy, reverts, zurueckgenommen };
}

/**
 * „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7): `wikisync.landmarke_unterdruecken` und `wikisync.landmarke_anbieten` wechseln einander ab (ein Schreiben in denselben Zustand
 * ist 409), darum ist jede die Rücknahme der davor: Eine gilt, bis das nächste Ereignis dieses Kandidaten kommt, und nennt die davor (`reverts`). Wie bei den Flächen ohne Link-Tafel.
 */
async function ladeLandmarkenKetten(
    database: Queryable,
    operationen: readonly ZustandsEingabe[],
): Promise<WikiSyncRow[]> {
    const alle = operationen.map((op) => op.operationId);
    const aktionen = ["landmarke_artikel.unterdrueckt", "landmarke_artikel.angeboten"];
    const ops = [WIKISYNC_LANDMARKE_UNTERDRUECKEN_OPERATION, WIKISYNC_LANDMARKE_ANBIETEN_OPERATION];
    return [
        ...(await database<WikiSyncRow[]>`
            SELECT s.operation_id::text AS operation_id, ro.operation_id::text AS rueck_operation_id, ro.seq::text AS seq, ro.at,
                   ro.actor_kind, ro.actor_person_id::text AS actor_person_id, ro.actor_label, ro.approval_ref, rp.display_name,
                   NULL::text AS zurueck_von_operation_id
              FROM map_audit_event s
              JOIN LATERAL (
                  SELECT e2.operation_id FROM map_audit_event e2
                   WHERE e2.landmarke_artikel_public_id = s.landmarke_artikel_public_id AND e2.id > s.id AND e2.action = ANY(${aktionen}::text[])
                   ORDER BY e2.id LIMIT 1
              ) n ON TRUE
              JOIN map_operation ro ON ro.operation_id = n.operation_id AND ro.action = ANY(${ops}::text[])
              LEFT JOIN avesmaps_auth.person rp ON rp.id = ro.actor_person_id
             WHERE s.operation_id = ANY(${alle}::uuid[]) AND s.action = ANY(${aktionen}::text[])
        `),
        ...(await database<WikiSyncRow[]>`
            SELECT r.operation_id::text AS operation_id, p.operation_id::text AS zurueck_von_operation_id
              FROM map_audit_event r
              JOIN LATERAL (
                  SELECT e0.operation_id FROM map_audit_event e0
                   WHERE e0.landmarke_artikel_public_id = r.landmarke_artikel_public_id AND e0.id < r.id AND e0.action = ANY(${aktionen}::text[])
                   ORDER BY e0.id DESC LIMIT 1
              ) p ON TRUE
             WHERE r.operation_id = ANY(${alle}::uuid[]) AND r.action = ANY(${aktionen}::text[])
        `),
    ];
}

interface KettenOperation extends AkteurZeile {
    kopf: number;
    operation_id: string;
    action: string;
    seq: string;
    at: Date;
}

/**
 * Die Kette der Operationen einer Übernahme von Regelvorschlägen (WI-0265 B8e): die Übernahme, dann abwechselnd Rücknahme (`lore.rules_wikisync_undo`) und Gegenrichtung (`…_redo`), je nach Zeit. Jede Operation
 * nimmt die davor zurück (`reverts`) und wird von der danach zurückgenommen (`revertedBy`); die Übernahme selbst gilt, solange der Kopf nicht zurückgenommen ist, und nennt sonst die jüngste Rücknahme. Ein
 * Kopf, der zurückgenommen ist, dessen Rücknahme sich aber nicht finden lässt (ältere Quittung), lässt die Übernahme trotzdem `bereits_zurueckgenommen` sein, nur ohne `revertedBy`.
 */
async function ladeRegelKetten(
    database: Queryable,
    operationen: readonly ZustandsEingabe[],
    personId: string | undefined,
    ziel: {
        revertedBy: Map<string, NonNullable<Zustand["revertedBy"]>>;
        reverts: Map<string, string[]>;
        zurueckgenommen: Set<string>;
    },
): Promise<void> {
    const ids = operationen.map((op) => op.operationId);
    // Der Kopf je Operation: die Übernahme über ihre Tafel, die Rücknahmen über die Quittung (`affected` nennt den Kopf).
    const koepfe = await database<{ operation_id: string; kopf: number }[]>`
        SELECT u.operation_id::text AS operation_id, u.id::int AS kopf FROM wikisync_regel_uebernahme u WHERE u.operation_id = ANY(${ids}::uuid[])
        UNION ALL
        SELECT m.operation_id::text, (a ->> 'id')::int
          FROM map_operation m, jsonb_array_elements(m.receipt -> 'affected') a
         WHERE m.operation_id = ANY(${ids}::uuid[]) AND m.action IN (${WIKISYNC_REGELN_UNDO_OPERATION}, ${WIKISYNC_REGELN_REDO_OPERATION})
           AND a ->> 'kind' = 'wikisync_regel_uebernahme'
    `;
    const koepfeIds = [...new Set(koepfe.map((zeile) => zeile.kopf))];
    if (koepfeIds.length === 0) return;
    const stand = await database<{ id: number; operation_id: string | null; zurueckgenommen: boolean }[]>`
        SELECT id::int AS id, operation_id::text AS operation_id, (zurueckgenommen_am IS NOT NULL) AS zurueckgenommen
          FROM wikisync_regel_uebernahme WHERE id = ANY(${koepfeIds}::int[])
    `;
    const folgen = await database<KettenOperation[]>`
        SELECT h.id::int AS kopf, m.operation_id::text AS operation_id, m.action, m.seq::text AS seq, m.at,
               m.actor_kind, m.actor_person_id::text AS actor_person_id, m.actor_label, m.approval_ref, p.display_name
          FROM unnest(${koepfeIds}::int[]) AS h(id)
          JOIN map_operation m
            ON m.action IN (${WIKISYNC_REGELN_UNDO_OPERATION}, ${WIKISYNC_REGELN_REDO_OPERATION})
           AND m.receipt -> 'affected' @> jsonb_build_array(jsonb_build_object('kind', 'wikisync_regel_uebernahme', 'id', h.id::text))
          LEFT JOIN avesmaps_auth.person p ON p.id = m.actor_person_id
         ORDER BY h.id, m.seq
    `;
    const benennung = (op: KettenOperation): NonNullable<Zustand["revertedBy"]> => ({
        operationId: op.operation_id,
        at: op.at.toISOString(),
        actor: akteurVon(op, personId),
    });
    for (const kopf of stand) {
        const kette = folgen.filter((op) => op.kopf === kopf.id);
        // Die Glieder der Kette in der Reihenfolge der Zeit: die Übernahme zuerst.
        const glieder: { id: string; op?: KettenOperation }[] = [
            ...(kopf.operation_id === null ? [] : [{ id: kopf.operation_id }]),
            ...kette.map((op) => ({ id: op.operation_id, op })),
        ];
        for (const [index, glied] of glieder.entries()) {
            if (index > 0) ziel.reverts.set(glied.id, [glieder[index - 1]!.id]);
            if (glied.op === undefined) {
                // Die Übernahme selbst: zurückgenommen, solange der Kopf es ist; die jüngste Rücknahme nennt sie.
                if (!kopf.zurueckgenommen) continue;
                ziel.zurueckgenommen.add(glied.id);
                const juengste = [...kette].reverse().find((op) => op.action === WIKISYNC_REGELN_UNDO_OPERATION);
                if (juengste !== undefined) ziel.revertedBy.set(glied.id, benennung(juengste));
                continue;
            }
            const naechste = glieder[index + 1]?.op;
            if (naechste === undefined) continue;
            ziel.zurueckgenommen.add(glied.id);
            ziel.revertedBy.set(glied.id, benennung(naechste));
        }
    }
}

/**
 * Die Zuweisung eines Wiki-Artikels an eine Fläche (`wikisync.flaeche_zuweisen`; WI-0265 B8e) und ihre Rücknahme und Wiederherstellung (`…zuruecknehmen`, `…wiederherstellen`; B8e2): Eine Zuweisung gilt, bis das nächste
 * Ereignis dieser Fläche ein Entfernen durch die Rücknahme des Regelfensters ist (das Regelfenster schrieb sie schon vor B8e, ohne Link-Tafel); eine Rücknahme gilt, bis das nächste Ereignis die Wiederherstellung ist. Jede
 * nennt die davor (`reverts`): die Rücknahme die Zuweisung, die Wiederherstellung die Rücknahme. Ein anderes nächstes Ereignis (eine spätere Zuweisung aus der Wiki-Box) lässt die Operation `ruecknehmbar`; der Konflikt
 * kommt in der Vorprüfung.
 */
async function ladeFlaechenKetten(
    database: Queryable,
    operationen: readonly ZustandsEingabe[],
): Promise<WikiSyncRow[]> {
    const alle = operationen.map((op) => op.operationId);
    const rueck = operationen
        .filter(
            (op) =>
                op.operation === WIKISYNC_FLAECHE_RUECKNAHME_OPERATION ||
                op.operation === WIKISYNC_FLAECHE_WIEDER_OPERATION,
        )
        .map((op) => op.operationId);
    const zeilen: WikiSyncRow[] = [];
    if (alle.length > 0) {
        zeilen.push(
            ...(await database<WikiSyncRow[]>`
                SELECT s.operation_id::text AS operation_id, ro.operation_id::text AS rueck_operation_id, ro.seq::text AS seq, ro.at,
                       ro.actor_kind, ro.actor_person_id::text AS actor_person_id, ro.actor_label, ro.approval_ref, rp.display_name,
                       NULL::text AS zurueck_von_operation_id
                  FROM map_audit_event s
                  JOIN LATERAL (
                      SELECT e2.operation_id, e2.action FROM map_audit_event e2
                       WHERE e2.region_public_id = s.region_public_id AND e2.id > s.id
                         AND e2.action IN ('region.wiki_zugewiesen', 'region.wiki_entfernt')
                       ORDER BY e2.id LIMIT 1
                  ) n ON TRUE
                  JOIN map_operation ro ON ro.operation_id = n.operation_id
                  LEFT JOIN avesmaps_auth.person rp ON rp.id = ro.actor_person_id
                 WHERE s.operation_id = ANY(${alle}::uuid[]) AND s.action IN ('region.wiki_zugewiesen', 'region.wiki_entfernt')
                   AND ((s.action = 'region.wiki_zugewiesen' AND n.action = 'region.wiki_entfernt' AND ro.action = ${WIKISYNC_FLAECHE_RUECKNAHME_OPERATION})
                     OR (s.action = 'region.wiki_entfernt' AND n.action = 'region.wiki_zugewiesen' AND ro.action = ${WIKISYNC_FLAECHE_WIEDER_OPERATION}))
            `),
        );
    }
    if (rueck.length > 0) {
        zeilen.push(
            ...(await database<WikiSyncRow[]>`
                SELECT r.operation_id::text AS operation_id, p.operation_id::text AS zurueck_von_operation_id
                  FROM map_audit_event r
                  JOIN LATERAL (
                      SELECT e0.operation_id, e0.action FROM map_audit_event e0
                       WHERE e0.region_public_id = r.region_public_id AND e0.id < r.id
                         AND e0.action IN ('region.wiki_zugewiesen', 'region.wiki_entfernt')
                       ORDER BY e0.id DESC LIMIT 1
                  ) p ON TRUE
                 WHERE r.operation_id = ANY(${rueck}::uuid[])
                   AND ((r.action = 'region.wiki_entfernt' AND p.action = 'region.wiki_zugewiesen')
                     OR (r.action = 'region.wiki_zugewiesen' AND p.action = 'region.wiki_entfernt'))
            `),
        );
    }
    return zeilen;
}
