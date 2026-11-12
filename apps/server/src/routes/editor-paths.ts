import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    EDITOR_PATH_TARGETS_URL,
    EDITOR_PATHS_NEUER_WEG_URL,
    EDITOR_PATHS_SAMMEL_DELETE_URL,
    EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL,
    EDITOR_PATHS_URL,
    EDITOR_PATHS_VERBINDEN_URL,
    EDITOR_STRASSEN_ASSISTENT_STRECKE_URL,
    EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL,
    StrasseStreckeAntwort,
    StrasseStreckeBody,
    StrasseZuweisenBody,
    StrasseZuweisenReceipt,
    PathSammelRemovalBody,
    PathVerbindenBody,
    PathVerbindenPruefung,
    PathVerbindenQuery,
    PathVerbindenReceipt,
    EditorPathDetail,
    EditorPathFlussnetz,
    EditorPathStreet,
    EditorPathTargets,
    MapHistoryPage,
    MapHistoryQuery,
    OperationReceipt,
    PathCreateBody,
    PathCreateReceipt,
    PathNeuerWegBody,
    PathNeuerWegReceipt,
    PathRemovalBody,
    PathStreetRemovalBody,
    PathSplitBody,
    PathSplitReceipt,
    PathTargetsQuery,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    UUID_PATTERN,
    rechteVon,
    editorPathDeleteUrl,
    editorPathHistoryUrl,
    editorPathRestoreUrl,
    editorPathPutOnMapUrl,
    editorPathRestoreSeriesPreviewUrl,
    editorPathRestoreSeriesUrl,
    editorPathTakeOffMapUrl,
    editorPathStreetDeleteUrl,
    editorPathStreetTakeOffMapUrl,
    editorPathSplitUrl,
    editorPathFlussnetzUrl,
    editorPathStreetUrl,
    editorPathTargetsUrl,
    editorPathUpdateUrl,
    PATH_TARGET_LAYERS_PATTERN,
    pathTargetLayers,
    editorPathUrl,
    PathUpdateBody,
    PathUpdateReceipt,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, protect } from "../auth/plugin.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { createPath, readTargetsInBox } from "../editor/path-create.ts";
import { pathHistory } from "../editor/history.ts";
import { setPathState, setPathsStateSammel, setStreetState, splitPath } from "../editor/path-split.ts";
import { currentEnds, readEditorPath, readPathTargets } from "../editor/path-edit.ts";
import { leseFlussnetz } from "../editor/path-flussnetz.ts";
import { updatePathStreet } from "../editor/path-update.ts";
import { neuerWeg } from "../editor/path-neuer-weg.ts";
import { pruefeVerbinden, verbindeWege } from "../editor/path-verbinden.ts";
import { listEditorPaths, readEditorPathStreet } from "../editor/path-list.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { ruecknehmenWeg, vorschauWeg } from "../editor/ruecknahme-weg.ts";
import { strasseStrecke } from "../editor/strasse-strecke.ts";
import { strasseZuweisen } from "../editor/strasse-zuweisen.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";
import { rechteHier } from "../kanal/schalter.ts";

/**
 * Lesen und Schreiben des Wegeditors (WI-0177 Stufe 1, „Wegkurve bearbeiten“).
 *
 *     GET   /api/editor/paths               die Wegeliste des Fensters, je Straße eine Zeile (W5a)                use_editor_menu (R)
 *     GET   /api/editor/paths/:id           ein Weg mit Kontrollpolygon, Revision und den Anschlüssen der Enden   use_editor_menu (R)
 *     GET   /api/editor/paths/:id/street    die Straße des Abschnitts mit allen Abschnitten (W5a)                use_editor_menu (R)
 *     GET   /api/editor/paths/:id/street/flussnetz  ihre Flussabschnitte als Knoten der Wegfindung (OPS-000112)  use_editor_menu (R)
 *     GET   /api/editor/paths/:id/targets   Andockziele um den Weg (Orte, Stützpunkte anderer Wege; am Fluss dazu
 *                                           Flächenkanten der Ebenen `?layers=` und Abschnitte anderer Flüsse) edit_map_geometry (R)
 *     GET   /api/editor/path-targets        Andockziele im Kasten, für „Neuer Weg“ (`art` Fluss oder Bach wie oben) edit_map_geometry (R)
 *     POST  /api/editor/paths               path.create, ein neuer Weg                         edit_map_objects + edit_map_geometry
 *     POST  /api/editor/paths/:id/split     path.split am inneren Stützpunkt                   edit_map_objects + edit_map_geometry
 *     POST  /api/editor/paths/:id/delete    path.delete („Ganz löschen“, weich)                edit_map_objects
 *     POST  /api/editor/paths/:id/restore   path.restore (↺)                                   edit_map_objects
 *     POST  /api/editor/paths/:id/take-off-map  path.take_off_map („Von der Karte nehmen“)     edit_map_geometry
 *     POST  /api/editor/paths/:id/put-on-map    path.put_on_map („Zurück auf die Karte“)       edit_map_geometry
 *     POST  /api/editor/paths/:id/street/delete        die ganze Straße ganz löschen (T49)      edit_map_objects
 *     POST  /api/editor/paths/:id/street/take-off-map  die ganze Straße von der Karte nehmen    edit_map_geometry
 *     POST  /api/editor/paths/sammel/delete        mehrere Wege ganz löschen, EINE Operation (WI-0252)   edit_map_objects
 *     POST  /api/editor/paths/sammel/take-off-map  mehrere Wege von der Karte nehmen (WI-0252)           edit_map_geometry
 *     GET   /api/editor/paths/:id/history       der Verlauf der Straße (T54)                     use_editor_menu
 *     POST  /api/editor/paths/:id/update                path.update: Felder der ganzen Straße und die Kurve eines Abschnitts
 *                                                       (W5b)                         edit_map_objects, mit Kurve edit_map_geometry
 *     POST  /api/editor/paths/:id/restore-series/preview  Wege zurücknehmen: Vorprüfung, liest nur (WI-0265 B6a)      use_editor_menu (R)
 *     POST  /api/editor/paths/:id/restore-series          Felder (auch eine Serie), die Kurve oder EINEN Wechsel des Stands in EINER Operation   edit_map_objects (R)
 *     POST  /api/editor/paths/neuer-weg   path.regroup: „Auswahl zu neuem Weg“, auch ↺ (WI-0252)          edit_map_objects
 *     GET   /api/editor/paths/verbinden?ids=…   „Wege verbinden“: geht es, die Kette (WI-0252)         use_editor_menu (R)
 *     POST  /api/editor/paths/verbinden   path.join: die Kette wird EIN Abschnitt, auch ↺    edit_map_objects + edit_map_geometry
 *     POST  /api/editor/paths/strassen-assistent/strecke   Straßen-Assistent: Orte, Strecke, Zustand je Abschnitt; liest nur (WI-0310)   use_editor_menu (R)
 *     POST  /api/editor/paths/strassen-assistent/zuweisen  path.assign_street: Name, Artikel, Quellen in EINER Operation, ↺ über restore-series   edit_map_objects
 *
 * 🔴 Wie beim Ortseditor (`editor-places.ts`): die Schreibroute trägt die Klasse `map` (423 `map_locked`) und den Schalter
 * `MAP_EDITING` (423 `map_editing_off`), beide vor dem Handler; die Sperre gegen den laufenden Zug sitzt in der Schreibnaht (503).
 * Ohne Anmeldung 401, ohne Recht 403, vor jeder Abfrage. Die Quittung trägt zusätzlich, woran die Enden NACH dem Speichern hängen:
 * gelesen nach dem Commit, also nie eine Bestätigung für etwas, das nicht gespeichert ist.
 */
const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

/** Die Ebenen, deren Flächenkanten ein Fluss als Andockziel bekommt (`?layers=`, leer: keine, ohne Angabe alle drei). */
const ZielEbenen = Type.Object(
    { layers: Type.Optional(Type.String({ pattern: PATH_TARGET_LAYERS_PATTERN })) },
    { additionalProperties: false },
);

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

export const editorPathsRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Die Wegeliste des Fensters (W5a): je Straße eine Zeile, mit ETag wie die Kraftlinien.
    app.get(EDITOR_PATHS_URL, { ...protect("use_editor_menu") }, async (request, reply) => {
        return sendeMitEtag(request, reply, await listEditorPaths(app.database!));
    });

    app.get(
        editorPathStreetUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPathStreet, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const strasse = await readEditorPathStreet(app.database!, request.params.id);
            if (strasse === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return strasse;
        },
    );

    // Das Flussnetz der Straße (OPS-000112): wie die Wegfindung ihre Flussabschnitte verbindet, für „Fließrichtung auf alle Abschnitte
    // übernehmen“. Rein lesend; die Richtung rechnet der Browser im Entwurf.
    app.get(
        editorPathFlussnetzUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPathFlussnetz, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const strasse = await readEditorPathStreet(app.database!, request.params.id);
            if (strasse === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return leseFlussnetz(
                app.database!,
                strasse.segments.map((teil) => teil.id),
            );
        },
    );

    // Der Verlauf der Straße (EDIT-0003 T54): jede Operation an einem ihrer Abschnitte, auch einer gelöschten Straße.
    app.get(
        editorPathHistoryUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, querystring: MapHistoryQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const strasse = await readEditorPathStreet(app.database!, request.params.id);
            if (strasse === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return pathHistory(
                app.database!,
                strasse.segments.map((teil) => teil.id),
                { ...request.query, personId: session.personId },
            );
        },
    );

    // Wege zurücknehmen (WI-0265 B6a, Fachvertrag C.2): die Felder der Straße (auch als Serie), die Kurve oder EIN Wechsel des Stands in EINER Operation. Die Vorprüfung liest nur;
    // das Recht der Vorwärtsoperation (Felder, Löschen: `edit_map_objects`, Kurve, Abnehmen: `edit_map_geometry`), bei einer fremden Person Pflichtgrund.
    app.post(
        editorPathRestoreSeriesPreviewUrl(":id"),
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
            return vorschauWeg(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorPathRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenWeg(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    app.get(
        editorPathUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPathDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const detail = await readEditorPath(app.database!, request.params.id);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        editorPathTargetsUrl(":id"),
        {
            ...protect("edit_map_geometry"),
            schema: { params: ById, querystring: ZielEbenen, response: { 200: EditorPathTargets, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const ziele = await readPathTargets(
                app.database!,
                request.params.id,
                pathTargetLayers(request.query.layers),
            );
            if (ziele === undefined) throw new ApiError(404, "not_found", "Diesen Weg gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return ziele;
        },
    );

    // „Neuer Weg“: die Ziele im Kasten um den sichtbaren Ausschnitt, geholt zwischen den Gesten (`map/geometrie/anlegen.ts`).
    app.get(
        EDITOR_PATH_TARGETS_URL,
        {
            ...protect("edit_map_geometry"),
            schema: { querystring: PathTargetsQuery, response: { 200: EditorPathTargets, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return readTargetsInBox(app.database!, request.query);
        },
    );

    // Ein neuer Weg braucht wie ein neuer Ort beide Rechte: die Sache (`edit_map_objects`) und die Lage (`edit_map_geometry`).
    app.post(
        EDITOR_PATHS_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PathCreateBody, response: { 200: PathCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            const angelegt = await createPath(app.database!, await actorOf(request), request.body);
            return {
                ...angelegt.receipt,
                publicId: angelegt.publicId,
                name: angelegt.name,
                subtype: angelegt.subtype,
                ...(angelegt.isBach ? { isBach: true as const } : {}),
                ends: await currentEnds(app.database!, angelegt.publicId),
            };
        },
    );

    // Teilen legt einen Weg an und ändert die Linie: beide Rechte wie „Neuer Weg“.
    app.post(
        editorPathSplitUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PathSplitBody, response: { 200: PathSplitReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            const geteilt = await splitPath(app.database!, await actorOf(request), request.params.id, request.body);
            return {
                ...geteilt.receipt,
                publicId: geteilt.hinten,
                ends: {
                    vorne: await currentEnds(app.database!, request.params.id),
                    hinten: await currentEnds(app.database!, geteilt.hinten),
                },
            };
        },
    );

    // Die Felder der Straße (W5b): Name, Wegart, „Name auf der Karte“ für alle Abschnitte in EINER Operation.
    app.post(
        editorPathUpdateUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PathUpdateBody, response: { 200: PathUpdateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Die Kurve ist Geometrie: Dafür braucht es auch `edit_map_geometry`, wie bei der Kraftlinie.
            if (request.body.shape !== undefined)
                demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            const quittung = await updatePathStreet(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.body,
            );
            // Mit Kurve: woran die Enden JETZT hängen, nach dem Commit gelesen (Entscheid 2026-10-10: sichtbar bestätigen).
            return request.body.shape === undefined
                ? quittung
                : { ...quittung, ends: await currentEnds(app.database!, request.body.shape.publicId) };
        },
    );

    // „Wege verbinden“ (WI-0252): Geht es, und wie liegt die Kette? Rein lesend, für das Untermenü.
    app.get(
        EDITOR_PATHS_VERBINDEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: PathVerbindenQuery, response: { 200: PathVerbindenPruefung, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return pruefeVerbinden(app.database!, request.query.ids.split(","));
        },
    );

    // „Wege verbinden“: eine neue Linie und Abschnitte still gelegt, also beide Rechte wie Teilen.
    app.post(
        EDITOR_PATHS_VERBINDEN_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PathVerbindenBody, response: { 200: PathVerbindenReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            return verbindeWege(app.database!, await actorOf(request), request.body);
        },
    );

    // „Auswahl zu neuem Weg“ (WI-0252): Name und Zuordnung der gewählten Abschnitte, eine Operation; ↺ ist die Rücknahme der Wege (`restore-series`).
    app.post(
        EDITOR_PATHS_NEUER_WEG_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PathNeuerWegBody, response: { 200: PathNeuerWegReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => neuerWeg(app.database!, await actorOf(request), request.body),
    );

    // Der Straßen-Assistent (WI-0310): die Strecke liest nur (wie die Vorprüfung der Rücknahme ein POST mit Klasse `map`), Zuweisen ist EINE Operation; ↺ ist die Rücknahme der Wege.
    app.post(
        EDITOR_STRASSEN_ASSISTENT_STRECKE_URL,
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: { body: StrasseStreckeBody, response: { 200: StrasseStreckeAntwort, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return strasseStrecke(app.database!, request.body);
        },
    );
    app.post(
        EDITOR_STRASSEN_ASSISTENT_ZUWEISEN_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: StrasseZuweisenBody, response: { 200: StrasseZuweisenReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => strasseZuweisen(app.database!, await actorOf(request), request.body),
    );

    // Der Stand des Wegs: löschen und ↺ mit dem Recht an Objekten, abnehmen und zurück auf die Karte mit dem der Lage (wie am Ort).
    for (const [url, wechsel, recht] of [
        [editorPathDeleteUrl(":id"), "path.delete", "edit_map_objects"],
        [editorPathRestoreUrl(":id"), "path.restore", "edit_map_objects"],
        [editorPathTakeOffMapUrl(":id"), "path.take_off_map", "edit_map_geometry"],
        [editorPathPutOnMapUrl(":id"), "path.put_on_map", "edit_map_geometry"],
    ] as const)
        app.post(
            url,
            {
                ...protect(recht, { writeClass: "map" }),
                preHandler: requireMapEditing,
                schema: { params: ById, body: PathRemovalBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
            },
            async (request) =>
                setPathState(app.database!, await actorOf(request), request.params.id, request.body, wechsel),
        );

    // Die ganze Straße (EDIT-0003 T49): alle Abschnitte in EINER Operation, mit denselben Rechten wie je Abschnitt.
    for (const [url, wechsel, recht] of [
        [editorPathStreetDeleteUrl(":id"), "path.delete", "edit_map_objects"],
        [editorPathStreetTakeOffMapUrl(":id"), "path.take_off_map", "edit_map_geometry"],
    ] as const)
        app.post(
            url,
            {
                ...protect(recht, { writeClass: "map" }),
                preHandler: requireMapEditing,
                schema: {
                    params: ById,
                    body: PathStreetRemovalBody,
                    response: { 200: OperationReceipt, ...ADMIN_ERRORS },
                },
            },
            async (request) =>
                setStreetState(app.database!, await actorOf(request), request.params.id, request.body, wechsel),
        );

    // Mehrere Wege auf einmal (WI-0252, „Weg entfernen …“ an der Mehrfachauswahl): derselbe Wechsel mit denselben Rechten wie je
    // Abschnitt, alle Abschnitte aller gewählten Wege in EINER Operation.
    for (const [url, wechsel, recht] of [
        [EDITOR_PATHS_SAMMEL_DELETE_URL, "path.delete", "edit_map_objects"],
        [EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL, "path.take_off_map", "edit_map_geometry"],
    ] as const)
        app.post(
            url,
            {
                ...protect(recht, { writeClass: "map" }),
                preHandler: requireMapEditing,
                schema: { body: PathSammelRemovalBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
            },
            async (request) => setPathsStateSammel(app.database!, await actorOf(request), request.body, wechsel),
        );
};
