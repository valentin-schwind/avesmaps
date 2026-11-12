import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    EDITOR_NODICES_URL,
    EDITOR_POWERLINE_TARGETS_URL,
    EDITOR_POWERLINE_WIKI_URL,
    EDITOR_POWERLINES_SAMMEL_STAND_URL,
    EDITOR_POWERLINES_SAMMEL_WIKI_URL,
    EDITOR_POWERLINES_URL,
    EditorPowerlineDetail,
    OperationReceipt,
    EditorPowerlineTargets,
    WikiTrefferListe,
    NodixCreateBody,
    NodixCreateReceipt,
    NodixMoveBody,
    NodixRetireBody,
    PowerlineCreateBody,
    PowerlineCreateReceipt,
    PowerlineRetireBody,
    PowerlineSammelStandBody,
    PowerlineSammelWikiBody,
    PowerlineStateBody,
    PowerlineUpdateBody,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    rechteVon,
    editorNodixRestoreSeriesPreviewUrl,
    editorNodixRestoreSeriesUrl,
    editorPowerlineRestoreSeriesPreviewUrl,
    editorPowerlineRestoreSeriesUrl,
    type PowerlineStateChange,
    UUID_PATTERN,
    MapHistoryPage,
    MapHistoryQuery,
    editorNodixMoveUrl,
    editorNodixRetireUrl,
    editorPowerlineHistoryUrl,
    editorPowerlinePutOnMapUrl,
    editorPowerlineRestoreUrl,
    editorPowerlineRetireUrl,
    editorPowerlineTakeOffMapUrl,
    editorPowerlineTargetsUrl,
    editorPowerlineUpdateUrl,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, protect } from "../auth/plugin.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import type { MapActor } from "../editor/map-operation.ts";
import {
    ruecknehmenKraftlinie,
    ruecknehmenNodix,
    vorschauKraftlinie,
    vorschauNodix,
} from "../editor/ruecknahme-kraftlinie.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { createNodix, createPowerline, moveNodix, readCreateTargets } from "../editor/kraftlinien-anlegen.ts";
import { powerlineHistory } from "../editor/history.ts";
import {
    linienAbschnitte,
    readPowerlineTargets,
    retireNodix,
    setPowerlineState,
    updatePowerlineLine,
} from "../editor/kraftlinien-schreiben.ts";
import { revertPowerlinesToWiki, setPowerlinesState } from "../editor/kraftlinien-sammel.ts";
import { listEditorPowerlines, readEditorPowerline, readPowerlineWiki } from "../editor/kraftlinien.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";
import { rechteHier } from "../kanal/schalter.ts";

/**
 * Die Routen des Kraftlinien-Editors (WI-0205): Lesen (K1) wie die Landschaften (`editor-landscapes.ts`), Schreiben ab K6.
 *
 * - `GET /api/editor/powerlines` — die Linien (`use_editor_menu`), mit schwachem ETag und 304 (packen tut Nginx, Block E).
 * - `GET /api/editor/powerlines/:id` — eine Linie über einen ihrer Abschnitte (`use_editor_menu`): Abschnitte, Knoten, Treffpunkte.
 *
 * - `GET /api/editor/powerlines/:id/history` — der Verlauf der Linie (`use_editor_menu`): jede Operation an einem ihrer heutigen
 *   Abschnitte, neueste zuerst, seitenweise (`editor/history.ts`); ↺ schreibt `update` mit `reverts`.
 * - `GET /api/editor/powerlines/:id/targets` — die Nodices zum Umhängen eines Endes (K8, `edit_map_geometry`).
 * - `POST /api/editor/powerlines/:id/update` — `powerline.update_line` (K6, K8): Name, Beschriftung, Beschreibung an alle Abschnitte
 *   und die Form je Abschnitt, gegen ihre Revisionen; `edit_map_objects`, mit Kurve oder Ende auch `edit_map_geometry`.
 * - `POST /api/editor/powerlines/:id/take-off-map`, `/put-on-map` (`edit_map_geometry`), `/restore` (`edit_map_objects`): der Stand
 *   der Linie (K10, EDIT-0003 T43); `POST /api/editor/nodices/:id/retire` (beide Rechte): ein Kraftlinienpunkt ohne Linie still.
 * - `POST /api/editor/powerlines/:id/restore-series[/preview]` — Kraftlinien zurücknehmen (WI-0265 B6b): Felder, Form, Abschnitte und Stand als EINE Operation (`ruecknahme-kraftlinie.ts`); seit B8b auch das Anlegen.
 * - `POST /api/editor/nodices/:id/restore-series[/preview]` — Kraftlinienpunkte zurücknehmen (WI-0265 B8b): Anlegen, Verschieben und Entfernen als EINE Operation.
 * - `POST /api/editor/powerlines/:id/retire` — `powerline.retire` (K10 knapp, EDIT-0003 T39, `edit_map_objects`): die Linie still.
 * - `GET /api/editor/powerline-targets` — die Nodices für eine neue Kraftlinie (K9, `edit_map_geometry`).
 * - `POST /api/editor/powerlines` — `powerline.create` (K9): ein Abschnitt von Nodix zu Nodix; wie ein neuer Weg beide Rechte.
 * - `POST /api/editor/nodices` — `nodix.create` (K9, R7): ein neuer Kraftlinienpunkt an einer Stelle; beide Rechte.
 *
 * 🔴 Wie beim Ortseditor (`editor-places.ts`): Jede schreibende Route trägt die Klasse `map` (423 `map_locked`) und den Schalter
 * `MAP_EDITING` (423 `map_editing_off`), beide vor dem Handler; die Sperre gegen den laufenden Zug sitzt in der Schreibnaht (503).
 * Entfernen in zwei Stufen kommt mit K10.
 */

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

export const editorKraftlinienRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(EDITOR_POWERLINES_URL, { ...protect("use_editor_menu") }, async (request, reply) => {
        return sendeMitEtag(request, reply, await listEditorPowerlines(app.database!));
    });

    app.get(
        `${EDITOR_POWERLINES_URL}/:id`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPowerlineDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const detail = await readEditorPowerline(app.database!, request.params.id);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        editorPowerlineHistoryUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: {
                params: ById,
                querystring: MapHistoryQuery,
                response: { 200: MapHistoryPage, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const abschnitte = await linienAbschnitte(app.database!, request.params.id);
            if (abschnitte.length === 0) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return powerlineHistory(app.database!, abschnitte, { ...request.query, personId: session.personId });
        },
    );

    app.get(
        editorPowerlineTargetsUrl(":id"),
        {
            ...protect("edit_map_geometry"),
            schema: { params: ById, response: { 200: EditorPowerlineTargets, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const ziele = await readPowerlineTargets(app.database!, request.params.id);
            if (ziele === undefined) throw new ApiError(404, "not_found", "Diese Kraftlinie gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return ziele;
        },
    );

    app.post(
        editorPowerlineUpdateUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PowerlineUpdateBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Die Form (Bogen, Ende, angefügt, herausgenommen, zurückgekommen) ist Geometrie: Dafür braucht es auch `edit_map_geometry`,
            // wie die Lage eines neuen Orts.
            if (
                request.body.add !== undefined ||
                request.body.revive !== undefined ||
                request.body.segments.some(
                    (s) => s.curve !== undefined || s.from !== undefined || s.to !== undefined || s.remove === true,
                )
            )
                demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            return updatePowerlineLine(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Kraftlinien zurücknehmen (WI-0265 B6b, Fachvertrag C.2): die Vorprüfung liest nur (wie die der Orte und Gebirge steht sie unter der Kartensperre), die Rücknahme schreibt EINE Operation mit der
    // Quelle restore. Das Recht der Vorwärtsoperation je Art im gemeinsamen Ablauf (Felder und Löschen: edit_map_objects; Bogen, Enden, Abschnitte, Abnehmen: edit_map_geometry); bei einer fremden
    // Person Pflichtgrund. `:id` ist ein Abschnitt der Linie.
    app.post(
        editorPowerlineRestoreSeriesPreviewUrl(":id"),
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                params: ById,
                body: RuecknahmeVorschauBody,
                response: { 200: RuecknahmePruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return vorschauKraftlinie(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorPowerlineRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenKraftlinie(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    // Kraftlinienpunkte zurücknehmen (WI-0265 B8b): wie die Linie; das Recht der Vorwärtsoperation (Sache durch die Route, Lage durch den Adapter), bei einer fremden Person Pflichtgrund.
    app.post(
        editorNodixRestoreSeriesPreviewUrl(":id"),
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                params: ById,
                body: RuecknahmeVorschauBody,
                response: { 200: RuecknahmePruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return vorschauNodix(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorNodixRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenNodix(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    // Der Stand der Linie (K10): Löschen und Zurückholen sind die Sache (`edit_map_objects`), von der Karte nehmen und zurück die Lage
    // (`edit_map_geometry`), wie bei Wegen.
    const WECHSEL: readonly [
        (anker: string) => string,
        PowerlineStateChange,
        "edit_map_objects" | "edit_map_geometry",
    ][] = [
        [editorPowerlineRetireUrl, "powerline.retire", "edit_map_objects"],
        [editorPowerlineRestoreUrl, "powerline.restore", "edit_map_objects"],
        [editorPowerlineTakeOffMapUrl, "powerline.take_off_map", "edit_map_geometry"],
        [editorPowerlinePutOnMapUrl, "powerline.put_on_map", "edit_map_geometry"],
    ];
    for (const [url, wechsel, recht] of WECHSEL)
        app.post(
            url(":id"),
            {
                ...protect(recht, { writeClass: "map" }),
                preHandler: requireMapEditing,
                schema: {
                    params: ById,
                    body: wechsel === "powerline.retire" ? PowerlineRetireBody : PowerlineStateBody,
                    response: { 200: OperationReceipt, ...ADMIN_ERRORS },
                },
            },
            async (request) =>
                setPowerlineState(app.database!, await actorOf(request), request.params.id, request.body, wechsel),
        );

    // Mehrere Linien auf einmal (WI-0238, EDIT-0003 T57): derselbe Wechsel des Stands mit denselben Rechten wie je Linie, und ↺ auf die
    // Wiki-Werte (die Sache). Je EINE Operation über alle gewählten Linien.
    app.post(
        EDITOR_POWERLINES_SAMMEL_STAND_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PowerlineSammelStandBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const recht = WECHSEL.find(([, wechsel]) => wechsel === request.body.wechsel)?.[2] ?? "edit_map_objects";
            if (recht === "edit_map_geometry") demand(await adminSession(request), recht, app.authConfig);
            return setPowerlinesState(app.database!, await actorOf(request), request.body);
        },
    );
    app.post(
        EDITOR_POWERLINES_SAMMEL_WIKI_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PowerlineSammelWikiBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => revertPowerlinesToWiki(app.database!, await actorOf(request), request.body),
    );

    // Die Artikel für die Wiki-Zuordnung im Fenster (WI-0205): lesen darf jeder mit dem Menü der Editoren, zuweisen nur mit Schreibrecht.
    app.get(
        EDITOR_POWERLINE_WIKI_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: WikiTrefferListe, ...ADMIN_ERRORS } } },
        async (_request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return readPowerlineWiki(app.database!);
        },
    );

    app.get(
        EDITOR_POWERLINE_TARGETS_URL,
        { ...protect("edit_map_geometry"), schema: { response: { 200: EditorPowerlineTargets, ...ADMIN_ERRORS } } },
        async (_request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return readCreateTargets(app.database!);
        },
    );

    // Eine neue Kraftlinie braucht wie ein neuer Weg beide Rechte: die Sache (`edit_map_objects`) und die Lage (`edit_map_geometry`).
    app.post(
        EDITOR_POWERLINES_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PowerlineCreateBody, response: { 200: PowerlineCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            const angelegt = await createPowerline(app.database!, await actorOf(request), request.body);
            return { ...angelegt.receipt, publicId: angelegt.publicId, name: angelegt.name };
        },
    );

    // Ein Kraftlinienpunkt hat eine Lage: wie ein neuer Ort beide Rechte.
    app.post(
        EDITOR_NODICES_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: NodixCreateBody, response: { 200: NodixCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            const angelegt = await createNodix(app.database!, await actorOf(request), request.body);
            return { ...angelegt.receipt, publicId: angelegt.publicId };
        },
    );

    // Einen Kraftlinienpunkt entfernen (K10): wie das Anlegen beide Rechte; nur ohne Linie.
    app.post(
        editorNodixRetireUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: NodixRetireBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            return retireNodix(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Einen Kraftlinienpunkt verschieben (K5): wie das Anlegen beide Rechte; die Bahnen an ihm folgen.
    app.post(
        editorNodixMoveUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: NodixMoveBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            return moveNodix(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );
};
