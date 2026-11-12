import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    OperationReceipt,
    WIKISYNC_BEGRIFFE_URL,
    WIKISYNC_REGELN_FLAECHEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
    WIKISYNC_REGELN_FLAECHE_ZURUECK_URL,
    WIKISYNC_REGELN_UEBERNEHMEN_URL,
    WIKISYNC_REGELN_URL,
    WIKISYNC_REGELN_ZURUECK_URL,
    WikisyncBegriffe,
    WikisyncBegriffeAbfrage,
    WikisyncBegriffeBody,
    WikisyncRegelAbfrage,
    WikisyncRegelFlaechen,
    WikisyncRegelListe,
    WikisyncRegelnFlaecheZuruecknehmenBody,
    WikisyncRegelnFlaecheZuweisenBody,
    WikisyncRegelnUebernehmenBody,
    WikisyncRegelnZuruecknehmenBody,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import { protect, protectEines } from "../auth/plugin.ts";
import type { Sql } from "../auth/session-store.ts";
import type { Database } from "../database.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { mapOperation, type MapActor } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { inhalteOperation } from "../inhalte/operation.ts";
import { wikisyncBereiche } from "../wiki/abgleich/schalter-lesen.ts";
import { aendereBegriffe, leseBegriffe, leseRegelListe } from "../wiki/regeln/anzeige.ts";
import {
    OPERATION_ZUWEISEN,
    OPERATION_ZURUECK,
    leseOffeneFlaechen,
    nimmFlaecheZuweisungZurueck,
    weiseFlaecheZu,
} from "../wiki/regeln/flaechen.ts";
import { nimmRegelnZurueck, stelleRegelnWiederHer, uebernimmRegeln } from "../wiki/regeln/uebernehmen.ts";

/**
 * Die Regelvorschläge der Vorkommen und die Begriffstafel im Reiter „WikiSync“ (WI-0253 Scheibe Regelvorschläge, §24; Vertrag `system/wikisync-regeln.ts`):
 *
 *     GET  /api/admin/wikisync/regeln                 die Vorschläge des jüngsten Laufs, gefiltert nach Art, Typ, Status und Freitext     view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/regeln/uebernehmen     { operationId, lauf, vorschlaege }   nur die Ausgewählten                           apply_wiki_lore_rules (`editor`) + Passkey
 *     POST /api/admin/wikisync/regeln/zuruecknehmen   { operationId, uebernahme }          eine Übernahme zurücknehmen                    undo_wikisync_run (`admin`) + Passkey
 *     GET  /api/admin/wikisync/regeln/flaechen        die offenen Flächen, zu denen es eine gleichnamige Fläche ohne Wiki-Schlüssel gibt      view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/regeln/flaeche-zuweisen       { operationId, flaeche, titel }   der Fläche den Wiki-Artikel zuweisen          edit_map_objects (`editor`), in Production + Passkey
 *     POST /api/admin/wikisync/regeln/flaeche-zuruecknehmen  { operationId, flaeche }          diese Zuweisung zurücknehmen                  edit_map_objects (`editor`), in Production + Passkey
 *     GET  /api/admin/wikisync/begriffe               die Begriffstafel: jede Wortfamilie mit ihren Formen und Pillen (Filter, Freitext, Seite)   view_wikisync (ab `tester`)
 *     POST /api/admin/wikisync/begriffe               { operationId, baseRevision, aenderungen }   jede Änderung sofort, unter dem Kopfwort der Familie   manage_canon_tables (`admin`), in Production + Passkey
 *
 * - **Berechnet wird hier nichts.** Die Vorschläge sind das Protokoll des Auftrags `wiki_vorschau` (Bereich `vorkommen`); „neu ableiten“ ist dieser Auftrag (`POST …/vorschau`). Die Begriffstafel
 *   liest die nächste Ableitung; hat sie sich seit dem Lauf geändert, sagt die Liste `veraltet`, und die Übernahme verweigert die Vorschläge (409 `begriffe_geaendert`).
 * - **Übernehmen** schreibt nur `lore_rule` mit Herkunft `wiki_verbreitung`, nur für die ausgewählten Vorschläge, nie über die Regel der Redaktion (`wiki/regeln/uebernehmen.ts`). Die Vorkommen müssen dem WikiSync
 *   gehören (409 `gehoert_legacy`, fest: sobald ihre Übernahme angeschlossen ist). Klasse `map` (die Kartensperre hält sie an), dieselbe Naht und dasselbe Fachprotokoll wie der Editor der Inhalte, Quelle `wikisync`.
 * - **Eine Fläche ohne Wiki-Schlüssel bekommt ihren Artikel** (§25, Vali 2026-10-27): Eine Regel wartet auf einen Artikel, den keine Fläche trägt; gibt es eine Fläche GLEICHEN NAMENS ohne Schlüssel, weist der
 *   Knopf ihr den Artikel zu (`wiki/regeln/flaechen.ts`). Der Server prüft alles selbst (kein vorhandener Schlüssel wird überschrieben, Name und Titel müssen zum Protokoll des jüngsten Laufs passen). Klasse `map`,
 *   Quelle `wikisync`, Fachprotokoll `region.wiki_zugewiesen`; der Passkey nur in Production (wie die Kanon-Tafeln). Der Legacy-Zug lässt die Zuweisung stehen (Tafel X2, Herkunft `avesmaps3d`).
 * - **Die Begriffstafel speichert jede Änderung sofort** (Klasse `system`, wie die Kanon-Tafeln): Der frische Passkey gilt nur in Production (Vali 2026-10-27).
 */

const EVENT_BEGRIFFE = "system.wikisync_begriffe_geaendert" as const;
const TARGET_BEGRIFFE = "wikisync:begriffe" as const;

/**
 * Die Rücknahme einer Übernahme von Regelvorschlägen als Operation (`lore.rules_wikisync_undo`, Quelle `wikisync`, Naht der Inhalte): EINE Funktion für `POST …/regeln/zuruecknehmen` und das ↺ in „Änderungen“
 * (WI-0265 B8d, `routes/admin-wikisync.ts`), damit es keinen zweiten Weg gibt. `vorher` läuft in der Transaktion vor der Rücknahme (die Vorprüfung des Reiters wiederholt sich dort); `grund` steht danach als
 * `restoreReason` an jedem Eintrag. Seit WI-0265 B8e kann `richtung: "redo"` die Rücknahme zurücknehmen (`lore.rules_wikisync_redo`, `stelleRegelnWiederHer`): Die Übernahme gilt wieder.
 */
export function regelUebernahmeZuruecknehmen(
    database: Database,
    session: Awaited<ReturnType<typeof adminSession>>,
    eingabe: {
        operationId: string;
        uebernahme: number;
        grund?: string;
        vorher?: (tx: Sql) => Promise<void>;
        richtung?: "undo" | "redo";
    },
): Promise<OperationReceipt> {
    const actor: MapActor = { kind: "person", personId: session.personId, environment: session.environment };
    const wiederherstellen = eingabe.richtung === "redo";
    return inhalteOperation(
        database,
        actor,
        {
            operationId: eingabe.operationId,
            operation: wiederherstellen ? "lore.rules_wikisync_redo" : "lore.rules_wikisync_undo",
            body: { uebernahme: eingabe.uebernahme, ...(eingabe.grund === undefined ? {} : { grund: eingabe.grund }) },
            source: "wikisync",
        },
        async (tx) => {
            await eingabe.vorher?.(tx);
            const arbeit = await (wiederherstellen ? stelleRegelnWiederHer : nimmRegelnZurueck)(tx, {
                uebernahme: eingabe.uebernahme,
                actor: { personId: session.personId, label: session.displayName },
            });
            const grund = eingabe.grund;
            return grund === undefined
                ? arbeit
                : {
                      ...arbeit,
                      entries: arbeit.entries.map((eintrag) => ({
                          ...eintrag,
                          changes: { ...eintrag.changes, restoreReason: { after: grund } },
                      })),
                  };
        },
    );
}

export const adminWikisyncRegelnRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        WIKISYNC_REGELN_URL,
        {
            ...protect("view_wikisync"),
            schema: { querystring: WikisyncRegelAbfrage, response: { 200: WikisyncRegelListe, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return leseRegelListe(app.database!, request.query, new Date());
        },
    );

    app.post(
        WIKISYNC_REGELN_UEBERNEHMEN_URL,
        {
            ...protect("apply_wiki_lore_rules", { confirm: "passkey", writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: WikisyncRegelnUebernehmenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const database = app.database!;
            // Die Vorkommen müssen dem WikiSync gehören (fest, sobald ihre Übernahme angeschlossen ist); sonst schreibt der WikiSync nichts an ihnen.
            if (!(await wikisyncBereiche(database)).has("vorkommen")) {
                throw new ApiError(409, "gehoert_legacy", "Für die Vorkommen gibt es noch keine Übernahme.", {
                    bereich: "vorkommen",
                });
            }
            const actor: MapActor = { kind: "person", personId: session.personId, environment: session.environment };
            const { operationId, lauf, vorschlaege } = request.body;
            return inhalteOperation(
                database,
                actor,
                { operationId, operation: "lore.rules_wikisync", body: { lauf, vorschlaege }, source: "wikisync" },
                (tx) =>
                    uebernimmRegeln(tx, {
                        lauf,
                        vorschlaege,
                        operationId,
                        actor: { personId: session.personId, label: session.displayName },
                    }),
            );
        },
    );

    app.post(
        WIKISYNC_REGELN_ZURUECK_URL,
        {
            ...protect("undo_wikisync_run", { confirm: "passkey", writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: WikisyncRegelnZuruecknehmenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, uebernahme } = request.body;
            return regelUebernahmeZuruecknehmen(app.database!, session, { operationId, uebernahme });
        },
    );

    app.get(
        WIKISYNC_REGELN_FLAECHEN_URL,
        {
            ...protect("view_wikisync"),
            schema: { response: { 200: WikisyncRegelFlaechen, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return leseOffeneFlaechen(app.database!, new Date());
        },
    );

    // Der frische Passkey nur in Production (Vali 2026-10-27, wie bei den Kanon-Tafeln und der Begriffstafel): Auf der Stage und lokal genügt das Recht.
    const passkeyInProduction = (): { confirm?: "passkey" } =>
        app.authConfig.environment === "production" ? { confirm: "passkey" as const } : {};

    app.post(
        WIKISYNC_REGELN_FLAECHE_ZUWEISEN_URL,
        {
            ...protectEines(["edit_map_objects", "edit_landscapes"], { ...passkeyInProduction(), writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: WikisyncRegelnFlaecheZuweisenBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const database = app.database!;
            const actor: MapActor = { kind: "person", personId: session.personId, environment: session.environment };
            const { operationId, flaeche, titel } = request.body;
            const [region] = await database<
                { map_domain_id: string }[]
            >`SELECT map_domain_id FROM region WHERE public_id = ${flaeche}::uuid AND is_active`;
            if (region === undefined) throw new ApiError(404, "flaeche_weg", "Diese Fläche gibt es nicht (mehr).");
            return mapOperation(
                database,
                actor,
                {
                    operationId,
                    operation: OPERATION_ZUWEISEN,
                    mapDomainId: region.map_domain_id,
                    body: { flaeche, titel },
                    source: "wikisync",
                },
                (tx) => weiseFlaecheZu(tx, { kennung: flaeche, titel }),
            );
        },
    );

    app.post(
        WIKISYNC_REGELN_FLAECHE_ZURUECK_URL,
        {
            ...protectEines(["edit_map_objects", "edit_landscapes"], { ...passkeyInProduction(), writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                body: WikisyncRegelnFlaecheZuruecknehmenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const database = app.database!;
            const actor: MapActor = { kind: "person", personId: session.personId, environment: session.environment };
            const { operationId, flaeche } = request.body;
            const [region] = await database<
                { map_domain_id: string }[]
            >`SELECT map_domain_id FROM region WHERE public_id = ${flaeche}::uuid AND is_active`;
            if (region === undefined) throw new ApiError(404, "flaeche_weg", "Diese Fläche gibt es nicht (mehr).");
            return mapOperation(
                database,
                actor,
                {
                    operationId,
                    operation: OPERATION_ZURUECK,
                    mapDomainId: region.map_domain_id,
                    body: { flaeche },
                    source: "wikisync",
                },
                (tx) => nimmFlaecheZuweisungZurueck(tx, { kennung: flaeche }),
            );
        },
    );

    app.get(
        WIKISYNC_BEGRIFFE_URL,
        {
            ...protect("view_wikisync"),
            schema: { querystring: WikisyncBegriffeAbfrage, response: { 200: WikisyncBegriffe, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await adminSession(request);
            return leseBegriffe(app.database!, request.query, new Date());
        },
    );

    app.post(
        WIKISYNC_BEGRIFFE_URL,
        {
            // Der frische Passkey nur in Production (Vali 2026-10-27, wie bei den Kanon-Tafeln): Auf der Stage und lokal speichert jeder Klick sofort.
            ...protect("manage_canon_tables", {
                ...(app.authConfig.environment === "production" ? { confirm: "passkey" as const } : {}),
                writeClass: "system",
            }),
            schema: { body: WikisyncBegriffeBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, aenderungen } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wikisync_begriffe.set", aenderungen, baseRevision } },
                async (tx) => {
                    const ergebnis = await aendereBegriffe(tx, {
                        aenderungen,
                        baseRevision,
                        actor: { personId: session.personId, label: session.displayName },
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: TARGET_BEGRIFFE,
                                actions: [EVENT_BEGRIFFE],
                            }),
                    });
                    return {
                        receipt: { environment: session.environment, affected: [], derivedWork: [], warnings: [] },
                        event: {
                            ...actorFields(session, request),
                            action: EVENT_BEGRIFFE,
                            targetRef: TARGET_BEGRIFFE,
                            details: { anzahl: ergebnis.geaendert.length, woerter: ergebnis.geaendert.slice(0, 50) },
                        },
                    };
                },
            );
        },
    );
};
