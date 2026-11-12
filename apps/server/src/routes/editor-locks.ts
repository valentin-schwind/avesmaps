import type { Capability } from "@avesmaps3d/shared";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    EDITOR_LOCK_ERROR_STATUS,
    EDITOR_LOCK_KINDS,
    EDITOR_LOCKS_URL,
    EditorLockAsk,
    EditorLockAsked,
    EditorLockBeat,
    EditorLockBeatAnswer,
    EditorLockList,
    EditorLockRelease,
    EditorLockRequestReply,
    EditorLockTake,
    EditorLockTaken,
    EditorLockTarget,
    UUID_PATTERN,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import { demandEines, protect, protectEines } from "../auth/plugin.ts";
import {
    beatEditorLocks,
    liftEditorLock,
    listEditorLocks,
    releaseEditorLock,
    takeEditorLock,
} from "../editor/editor-lock.ts";
import {
    answerEditorLockRequest,
    askEditorLockRelease,
    incomingEditorLockRequests,
    ownEditorLockRequests,
} from "../editor/editor-lock-request.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { ApiError } from "../http/api-error.ts";

/**
 * Die Sperre während der Bearbeitung (EDIT-0003 §4; Vertrag `packages/shared/src/editor-lock.ts`, Logik `editor/editor-lock.ts`):
 *
 *     POST  /api/editor/locks             nehmen; 409 `object_locked` mit der Sperre, wenn eine andere Person sie hält
 *                                         Form: edit_map_geometry, Felder: edit_map_objects; Sprachen beides edit_languages
 *     POST  /api/editor/locks/heartbeat   Herzschlag eines Laufs; nennt, was er nicht mehr hält      use_editor_menu
 *     POST  /api/editor/locks/release     freigeben, was der Lauf hält                                use_editor_menu
 *     POST  /api/editor/locks/lift        die Sperre eines anderen aufheben (Admin, mit Bestätigung)  manage_people
 *     GET   /api/editor/locks?kind=…      die geltenden Sperren einer Art (Schraffur, Schild, Kasten)  use_editor_menu
 *     POST  /api/editor/locks/request     um Freigabe einer fremden Sperre bitten (WI-0262)           edit_map_objects
 *     POST  /api/editor/locks/request/answer  der Inhaber antwortet „freigegeben“ oder „später“       use_editor_menu
 *
 * 🔴 Nehmen trägt die Klasse `map` (423 `map_locked`, SYS-4) und den Schalter `MAP_EDITING` (423 `map_editing_off`): Wo niemand die Karte
 * bearbeiten darf, sperrt auch niemand. Herzschlag und Freigeben gehen immer (Klasse `account`, unter jeder Sperre offen wie das
 * Abmelden), damit ein Lauf nach dem Umschalten sauber endet; Aufheben ist eine Sache der Verwaltung (`system`). Der
 * Herzschlag kommt einmal je Minute und Person: Er schreibt nichts ins Protokoll (`logLevel: "warn"`).
 *
 * **Freigabe erbitten** (WI-0262; Logik `editor/editor-lock-request.ts`): Bitten trägt dasselbe Recht und dieselben Schalter wie Nehmen
 * (wer nicht sperren darf, bittet auch nicht). Antworten geht wie Freigeben immer (Klasse `account`): Der Inhaber soll eine Bitte auch dann
 * beantworten können, wenn die Karte unterdessen gesperrt wurde. Geliefert wird im vorhandenen Takt: dem Inhaber mit der Antwort des
 * Herzschlags, dem Bittenden mit der Liste. Die Sperren haben kein Protokoll (`editor_lock` trägt nur den Stand); die Bitten auch nicht.
 */
const ListQuery = Type.Object(
    {
        kind: Type.Union(EDITOR_LOCK_KINDS.map((kind) => Type.Literal(kind))),
        run: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
    },
    { additionalProperties: false },
);

/**
 * Wer eine Sperre nimmt, braucht das Recht an der Art (WI-0279): Gebiete, Flächen, Punkte und Sprachen haben Fachrechte, alles andere die
 * Sammelrechte. Eine Sprache sperrt, wer sie schreibt (`edit_languages`, auch der Linguist), für Felder und Form gleich: Der Spracheditor trennt sie nicht.
 */
const SPERREN_RECHTE = [
    "edit_map_objects",
    "edit_territories",
    "edit_landscapes",
    "edit_mountains",
    "edit_languages",
] as const;
type Rechte = readonly [Capability, ...Capability[]];
function rechteDerArt(kind: string): { felder: Rechte; form: Rechte } {
    if (kind === "territory") return { felder: ["edit_territories"], form: ["edit_territory_form"] };
    if (kind === "landscape") return { felder: ["edit_landscapes"], form: ["edit_landscape_form"] };
    if (kind === "sprache") return { felder: ["edit_languages"], form: ["edit_languages"] };
    if (kind === "peak") {
        return {
            felder: ["edit_map_objects", "edit_landscapes", "edit_mountains"],
            form: ["edit_map_geometry", "edit_landscape_form", "edit_mountains"],
        };
    }
    return { felder: ["edit_map_objects"], form: ["edit_map_geometry"] };
}

export const editorLocksRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.post(
        EDITOR_LOCKS_URL,
        {
            ...protectEines(SPERREN_RECHTE, { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: EditorLockTake, response: { 200: EditorLockTaken, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            const rechte = rechteDerArt(request.body.kind);
            demandEines(session, rechte.felder, app.authConfig);
            // Die Form eines Objekts ist seine Lage (wie `place.move`): dazu das Recht an der Form.
            if (request.body.part === "form") demandEines(session, rechte.form, app.authConfig);
            const result = await takeEditorLock(app.database!, {
                ...request.body,
                personId: session.personId,
                personName: session.displayName,
            });
            if (!result.taken)
                throw new ApiError(
                    EDITOR_LOCK_ERROR_STATUS.object_locked,
                    "object_locked",
                    `${result.lock.person.name} bearbeitet das gerade.`,
                    { lock: result.lock },
                );
            return { lock: result.lock };
        },
    );

    app.post(
        `${EDITOR_LOCKS_URL}/heartbeat`,
        {
            ...protect("use_editor_menu", { writeClass: "account" }),
            logLevel: "warn",
            schema: { body: EditorLockBeat, response: { 200: EditorLockBeatAnswer, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const lost = await beatEditorLocks(app.database!, request.body.run, request.body.locks);
            // Die Bitten stehen nur in der Antwort, wenn es welche gibt: Der Herzschlag bleibt so klein wie zuvor.
            const requests = await incomingEditorLockRequests(app.database!, request.body.run);
            return requests.length === 0 ? { lost } : { lost, requests };
        },
    );

    app.post(
        `${EDITOR_LOCKS_URL}/release`,
        {
            ...protect("use_editor_menu", { writeClass: "account" }),
            schema: { body: EditorLockRelease, response: { 204: Type.Null(), ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            await releaseEditorLock(app.database!, request.body.run, request.body);
            return reply.code(204).send(null);
        },
    );

    // Der Betreiber antwortete „ja“ auf „Soll ein Admin die Sperre eines anderen aufheben können?“ (2026-10-16), mit einem vorhandenen
    // Admin-Recht: Wer Menschen verwaltet, darf auch ihre Sperre lösen.
    app.post(
        `${EDITOR_LOCKS_URL}/lift`,
        {
            ...protect("manage_people", { writeClass: "system" }),
            schema: { body: EditorLockTarget, response: { 204: Type.Null(), ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            await liftEditorLock(app.database!, request.body);
            return reply.code(204).send(null);
        },
    );

    app.get(
        EDITOR_LOCKS_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: ListQuery, response: { 200: EditorLockList, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            const session = await adminSession(request);
            const locks = await listEditorLocks(app.database!, request.query.kind, request.query.run, session.personId);
            // Die eigenen Bitten dieser Person an Objekte der Art (WI-0262); ohne welche fehlt das Feld.
            const requests = await ownEditorLockRequests(app.database!, session.personId, request.query.kind);
            return requests.length === 0 ? { locks } : { locks, requests };
        },
    );

    // Die Bitte um Freigabe (WI-0262, OPS-000059). Das Objekt muss gerade von einem anderen Lauf gesperrt sein; je Person und Sperre
    // gibt es höchstens eine offene Bitte, sie läuft nach 5 Minuten ab.
    app.post(
        `${EDITOR_LOCKS_URL}/request`,
        {
            ...protectEines(SPERREN_RECHTE, { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: EditorLockAsk, response: { 200: EditorLockAsked, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const session = await adminSession(request);
            demandEines(session, rechteDerArt(request.body.kind).felder, app.authConfig);
            const result = await askEditorLockRelease(app.database!, {
                ...request.body,
                personId: session.personId,
                personName: session.displayName,
            });
            switch (result.art) {
                case "gestellt":
                    return { request: result.request };
                case "nicht_gesperrt":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.not_locked,
                        "not_locked",
                        "Das Objekt ist nicht gesperrt.",
                    );
                case "eigene_sperre":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.own_lock,
                        "own_lock",
                        "Die Sperre gehört dem Bittenden selbst.",
                    );
                case "offen":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.request_open,
                        "request_open",
                        "Eine Bitte um Freigabe ist schon offen.",
                        { request: result.request },
                    );
            }
        },
    );

    // Die Antwort des Inhabers: nur er, am Lauf und an der Person geprüft. „Freigegeben“ gibt die Sperre in derselben Anweisung frei.
    app.post(
        `${EDITOR_LOCKS_URL}/request/answer`,
        {
            ...protect("use_editor_menu", { writeClass: "account" }),
            schema: { body: EditorLockRequestReply, response: { 204: Type.Null(), ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const result = await answerEditorLockRequest(app.database!, {
                requestId: request.body.requestId,
                run: request.body.run,
                personId: session.personId,
                answer: request.body.answer,
            });
            switch (result) {
                case "ok":
                    return reply.code(204).send(null);
                case "unbekannt":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.request_not_found,
                        "request_not_found",
                        "Die Bitte gibt es nicht.",
                    );
                case "nicht_halter":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.not_lock_holder,
                        "not_lock_holder",
                        "Nur der Inhaber der Sperre antwortet.",
                    );
                case "geschlossen":
                    throw new ApiError(
                        EDITOR_LOCK_ERROR_STATUS.request_closed,
                        "request_closed",
                        "Die Bitte ist abgelaufen oder schon beantwortet.",
                    );
            }
        },
    );
};
