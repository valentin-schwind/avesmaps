import { createHash } from "node:crypto";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { Type } from "@sinclair/typebox";
import {
    OperationReceipt,
    WETTERMODELL_URL,
    WETTER_PRESETS_URL,
    WETTER_SYMBOLE_URL,
    WETTER_URL,
    WETTER_WIKI_URL,
    WetterDatenAntwort,
    WetterPresetAnlegenBody,
    WetterPresetEntfernenBody,
    WetterPresetParams,
    WetterPresetWerteBody,
    WetterPresetZeitpunktBody,
    WetterSymbolAendernBody,
    WetterSymbolAnlegenBody,
    WetterSymbolEntfernenBody,
    WetterSymbolParams,
    WetterWikiArtikelAntwort,
    WettermodellBody,
    type AffectedEntity,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, actorFields, adminOperation, adminSession, editConflict } from "../auth/admin-guard.ts";
import type { AuditAction } from "../auth/audit.ts";
import { protect } from "../auth/plugin.ts";
import type { SessionRecord } from "../auth/session-store.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import {
    aenderePresetWerte,
    aendereSymbol,
    entfernePreset,
    entferneSymbol,
    legePresetAn,
    legeSymbolAn,
    leseWetter,
    setzePresetZeitpunkt,
    verstelleWettermodell,
    type Akteur,
} from "../wetter/stand.ts";
import { ladeWetterWikiArtikel } from "../wetter/wiki.ts";

/**
 * Die Wege des Wetters (WI-0288 Stufe 2; Tafeln und Formen in `packages/shared/src/wetter/`):
 *
 *     GET   /api/wetter                               alles, mit Vorgaben aufgefüllt (öffentlich, ETag)                keine
 *     POST  /api/editor/wetter/presets                { operationId, tag }                                         edit_weather (R)
 *     PATCH /api/editor/wetter/presets/:id            { operationId, baseRevision, werte }                         edit_weather (R)
 *     POST  /api/editor/wetter/presets/:id/zeitpunkt  { operationId, baseRevision, tag }                           edit_weather (R)
 *     POST  /api/editor/wetter/presets/:id/entfernen  { operationId, baseRevision }                                edit_weather (R)
 *     POST  /api/editor/wetter/symbole                { operationId, art, … }                                      edit_weather (R)
 *     PATCH /api/editor/wetter/symbole/:id            { operationId, baseRevision, aenderungen }                   edit_weather (R)
 *     POST  /api/editor/wetter/symbole/:id/entfernen  { operationId, baseRevision }                                edit_weather (R)
 *     GET   /api/editor/wetter/wiki-artikel           Winde, Strömungen, Mahlströme für den Verweis am Icon        edit_weather
 *     POST  /api/admin/system/wettermodell            { operationId, baseRevision, id, value }      manage_weather_model + Passkey (S)
 *
 * - **Presets und Icons sind Karteninhalt:** Schreibklasse `map` (unter Kartensperre 423) und der Schalter `MAP_EDITING` wie jeder Editor;
 *   kein Passkey (Stufe R wie `edit_map_objects`). Jede Handlung genau ein Ereignis im Protokoll, in derselben Transaktion.
 * - **Das Wettermodell ist eine Einstellung:** Schreibklasse `system` (unter Systemsperre 423), frischer Passkey wie Wegfindung und
 *   Karteneinstellungen; ein Ereignis `system.wettermodell_geaendert` (`key`, `from`, `to`; `null` heißt Vorgabe).
 * - **Angelegte Presets** (Betreiber 2026-11-08): `POST …/presets` legt eines an einem freien Tag an (Werte: die am Tag übergeblendeten), `…/entfernen`
 *   löscht ein angelegtes hart (die Werte stehen im Ereignis); beides ist `system.wetter_preset_geaendert` mit `aktion` „angelegt“ bzw. „entfernt“,
 *   kein eigenes Ereignis. Die Quittung des Entfernens nennt das Preset mit der Revision, die es danach gehabt hätte.
 * - `GET /api/wetter` antwortet `no-cache` mit ETag (ein Abdruck der Antwort), wie `GET /api/map-settings`: Das Wetter liest es beim
 *   Einschalten, ein unveränderter Stand kostet ein 304. Wer etwas geändert hat, steht nicht darin.
 * - Die Quittung nennt in `affected` jedes berührte Preset oder Icon mit seiner neuen Revision (`wetter_preset`, `wetter_symbol`); das
 *   Wettermodell die neue Revision der Tafel (`wettermodell`).
 * - **Der Wiki-Artikel am Icon** (Stufe 6): Die Liste liest nur, was der Derographie-Zug führt (`wetter/wiki.ts`); gesetzt wird der Verweis über
 *   `wikiTitel` beim Anlegen und Ändern, im Protokoll steht nur der Feldname wie bei jedem Feld.
 */
const PRESET_EVENT = "system.wetter_preset_geaendert" as const;
const SYMBOL_EVENT = "system.wetter_symbol_geaendert" as const;
const MODELL_EVENT = "system.wettermodell_geaendert" as const;
const MODELL_TARGET = "wetter:modell" as const;

const presetTarget = (id: string): string => `wetter:preset:${id}`;
const symbolTarget = (id: string): string => `wetter:symbol:${id}`;

const SCHREIBEN = { ...protect("edit_weather", { writeClass: "map" }), preHandler: requireMapEditing } as const;
const QUITTUNG = { 200: OperationReceipt, ...ADMIN_ERRORS };

const akteurVon = (session: SessionRecord): Akteur => ({ personId: session.personId, label: session.displayName });

export const wetterRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const konflikt =
        (targetRef: string, actions: readonly AuditAction[]) => (current: { revision: number; changedAt: Date }) =>
            editConflict(app.database!, {
                currentRevision: current.revision,
                changedAt: current.changedAt,
                targetRef,
                actions,
            });

    /** Eine Handlung an Presets oder Icons: höchstens einmal je `operationId`, ein Ereignis, die Quittung mit den berührten Objekten. */
    const handlung = (
        request: FastifyRequest,
        session: SessionRecord,
        input: { operationId: string; body: unknown },
        arbeit: (tx: Parameters<Parameters<typeof adminOperation>[3]>[0]) => Promise<{
            affected: AffectedEntity[];
            event: { action: AuditAction; targetRef: string; details: Record<string, unknown> };
        }>,
    ) =>
        adminOperation(app.database!, session, input, async (tx) => {
            const { affected, event } = await arbeit(tx);
            return {
                receipt: { environment: session.environment, affected, derivedWork: [], warnings: [] },
                event: { ...actorFields(session, request), ...event },
            };
        });

    app.get(
        WETTER_URL,
        { config: { auth: "public" }, schema: { response: { 200: WetterDatenAntwort, 304: Type.Null() } } },
        async (request, reply) => {
            const daten = await leseWetter(app.database);
            const abdruck = createHash("sha256").update(JSON.stringify(daten)).digest("base64url").slice(0, 22);
            const etag = `"w${abdruck}"`;
            reply.header("cache-control", "no-cache");
            reply.header("etag", etag);
            if (request.headers["if-none-match"] === etag) return reply.code(304).send(null);
            return daten;
        },
    );

    app.get(
        WETTER_WIKI_URL,
        { ...protect("edit_weather"), schema: { response: { 200: WetterWikiArtikelAntwort, ...ADMIN_ERRORS } } },
        async () => ({ artikel: await ladeWetterWikiArtikel(app.database!) }),
    );

    app.post(
        WETTER_PRESETS_URL,
        { ...SCHREIBEN, schema: { body: WetterPresetAnlegenBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, tag } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.preset.anlegen", tag } },
                async (tx) => {
                    const ergebnis = await legePresetAn(tx, { tag, akteur: akteurVon(session) });
                    return {
                        affected: [{ kind: "wetter_preset", id: ergebnis.id, revision: ergebnis.revision }],
                        event: {
                            action: PRESET_EVENT,
                            targetRef: presetTarget(ergebnis.id),
                            details: {
                                preset: ergebnis.id,
                                aktion: "angelegt",
                                tag: ergebnis.tag,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.patch(
        "/api/editor/wetter/presets/:id",
        { ...SCHREIBEN, schema: { params: WetterPresetParams, body: WetterPresetWerteBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, baseRevision, werte } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.preset.werte", id, baseRevision, werte } },
                async (tx) => {
                    const ergebnis = await aenderePresetWerte(tx, {
                        id,
                        baseRevision,
                        werte,
                        akteur: akteurVon(session),
                        conflict: konflikt(presetTarget(id), [PRESET_EVENT]),
                    });
                    return {
                        affected: [{ kind: "wetter_preset", id, revision: ergebnis.revision }],
                        event: {
                            action: PRESET_EVENT,
                            targetRef: presetTarget(id),
                            details: {
                                preset: id,
                                aktion: "werte",
                                werte: ergebnis.werte,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/editor/wetter/presets/:id/zeitpunkt",
        { ...SCHREIBEN, schema: { params: WetterPresetParams, body: WetterPresetZeitpunktBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, baseRevision, tag } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.preset.zeitpunkt", id, baseRevision, tag } },
                async (tx) => {
                    const ergebnis = await setzePresetZeitpunkt(tx, {
                        id,
                        baseRevision,
                        tag,
                        akteur: akteurVon(session),
                        conflict: konflikt(presetTarget(id), [PRESET_EVENT]),
                    });
                    const affected: AffectedEntity[] = [{ kind: "wetter_preset", id, revision: ergebnis.revision }];
                    if (ergebnis.getauscht !== null)
                        affected.push({
                            kind: "wetter_preset",
                            id: ergebnis.getauscht.id,
                            revision: ergebnis.getauscht.revision,
                        });
                    return {
                        affected,
                        event: {
                            action: PRESET_EVENT,
                            targetRef: presetTarget(id),
                            details: {
                                preset: id,
                                aktion: "zeitpunkt",
                                tag: ergebnis.tag,
                                getauscht: ergebnis.getauscht?.id ?? null,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/editor/wetter/presets/:id/entfernen",
        { ...SCHREIBEN, schema: { params: WetterPresetParams, body: WetterPresetEntfernenBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, baseRevision } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.preset.entfernen", id, baseRevision } },
                async (tx) => {
                    const ergebnis = await entfernePreset(tx, {
                        id,
                        baseRevision,
                        akteur: akteurVon(session),
                        conflict: konflikt(presetTarget(id), [PRESET_EVENT]),
                    });
                    return {
                        affected: [{ kind: "wetter_preset", id, revision: ergebnis.revision }],
                        event: {
                            action: PRESET_EVENT,
                            targetRef: presetTarget(id),
                            details: {
                                preset: id,
                                aktion: "entfernt",
                                tag: ergebnis.tag,
                                werte: ergebnis.werte,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        WETTER_SYMBOLE_URL,
        { ...SCHREIBEN, schema: { body: WetterSymbolAnlegenBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, ...body } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.symbol.anlegen", ...body } },
                async (tx) => {
                    const ergebnis = await legeSymbolAn(tx, { body, akteur: akteurVon(session) });
                    return {
                        affected: [{ kind: "wetter_symbol", id: ergebnis.id, revision: ergebnis.revision }],
                        event: {
                            action: SYMBOL_EVENT,
                            targetRef: symbolTarget(ergebnis.id),
                            details: {
                                symbol: ergebnis.id,
                                aktion: "angelegt",
                                art: body.art,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.patch(
        "/api/editor/wetter/symbole/:id",
        { ...SCHREIBEN, schema: { params: WetterSymbolParams, body: WetterSymbolAendernBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, baseRevision, aenderungen } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.symbol.aendern", id, baseRevision, aenderungen } },
                async (tx) => {
                    const ergebnis = await aendereSymbol(tx, {
                        id,
                        baseRevision,
                        aenderungen,
                        akteur: akteurVon(session),
                        conflict: konflikt(symbolTarget(id), [SYMBOL_EVENT]),
                    });
                    return {
                        affected: [{ kind: "wetter_symbol", id, revision: ergebnis.revision }],
                        event: {
                            action: SYMBOL_EVENT,
                            targetRef: symbolTarget(id),
                            details: {
                                symbol: id,
                                aktion: "geaendert",
                                felder: ergebnis.felder,
                                materialisiert: ergebnis.materialisiert,
                            },
                        },
                    };
                },
            );
        },
    );

    app.post(
        "/api/editor/wetter/symbole/:id/entfernen",
        { ...SCHREIBEN, schema: { params: WetterSymbolParams, body: WetterSymbolEntfernenBody, response: QUITTUNG } },
        async (request) => {
            const session = await adminSession(request);
            const { id } = request.params;
            const { operationId, baseRevision } = request.body;
            return handlung(
                request,
                session,
                { operationId, body: { action: "wetter.symbol.entfernen", id, baseRevision } },
                async (tx) => {
                    const ergebnis = await entferneSymbol(tx, {
                        id,
                        baseRevision,
                        akteur: akteurVon(session),
                        conflict: konflikt(symbolTarget(id), [SYMBOL_EVENT]),
                    });
                    return {
                        affected: [{ kind: "wetter_symbol", id, revision: ergebnis.revision }],
                        event: {
                            action: SYMBOL_EVENT,
                            targetRef: symbolTarget(id),
                            details: { symbol: id, aktion: "entfernt", materialisiert: ergebnis.materialisiert },
                        },
                    };
                },
            );
        },
    );
};

/** Das Wettermodell, unter `/api/admin` (dort gilt `no-store`). */
export const adminWettermodellRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        WETTERMODELL_URL,
        {
            ...protect("manage_weather_model", { confirm: "passkey", writeClass: "system" }),
            schema: { body: WettermodellBody, response: QUITTUNG },
        },
        async (request) => {
            const session = await adminSession(request);
            const { operationId, baseRevision, id, value } = request.body;
            return adminOperation(
                app.database!,
                session,
                { operationId, body: { action: "wettermodell.set", id, value, baseRevision } },
                async (tx) => {
                    const ergebnis = await verstelleWettermodell(tx, {
                        id,
                        value,
                        baseRevision,
                        akteur: akteurVon(session),
                        conflict: (current) =>
                            editConflict(app.database!, {
                                currentRevision: current.revision,
                                changedAt: current.changedAt,
                                targetRef: MODELL_TARGET,
                                actions: [MODELL_EVENT],
                            }),
                    });
                    return {
                        receipt: {
                            environment: session.environment,
                            affected: [{ kind: "wettermodell", id, revision: ergebnis.revision }],
                            derivedWork: [],
                            warnings: [],
                        },
                        event: {
                            ...actorFields(session, request),
                            action: MODELL_EVENT,
                            targetRef: MODELL_TARGET,
                            details: { key: id, from: ergebnis.from, to: ergebnis.to },
                        },
                    };
                },
            );
        },
    );
};
