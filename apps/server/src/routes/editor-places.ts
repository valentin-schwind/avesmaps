import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    AVENTURIA,
    EDITOR_CHANGES_URL,
    EDITOR_PLACES_SAMMEL_DELETE_URL,
    EDITOR_PLACES_SAMMEL_URL,
    EDITOR_PLACES_URL,
    EDITOR_PLACE_KINDS_URL,
    EditorMoveTargets,
    EditorPlaceDetail,
    EditorPlaceSites,
    EditorSiteCandidates,
    MapChangeLage,
    MapChangeLageQuery,
    MapChangeParams,
    MapChangesQuery,
    MapHistoryEntry,
    MapHistoryPage,
    MapHistoryQuery,
    OperationReceipt,
    PlaceCreateBody,
    PlaceMoveBody,
    PlaceDeleteBody,
    PlaceInLandmarkeBody,
    PlaceInLandmarkeReceipt,
    editorPlaceInLandmarkeUrl,
    PlaceDeleteManyBody,
    PlaceRemoval,
    PlaceRestoreBody,
    PlaceSammelBody,
    PlaceTakeOffMapBody,
    PlaceUpdateBody,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    SiteAddBody,
    SiteRelationBody,
    UUID_PATTERN,
    rechteVon,
    editorPlaceRestoreSeriesPreviewUrl,
    editorPlaceRestoreSeriesUrl,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, protect } from "../auth/plugin.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import type { MapActor } from "../editor/map-operation.ts";
import {
    createPlace,
    movePlace,
    readEditorPlace,
    readMoveTargets,
    takePlaceOffMap,
    updatePlace,
} from "../editor/place-edit.ts";
import { aenderungLage } from "../editor/aenderung-lage.ts";
import { wandleOrtInLandmarke } from "../editor/ort-in-landmarke.ts";
import { deletePlace, readPlaceRemoval, restorePlace } from "../editor/place-removal.ts";
import { deletePlaces, sammelPlaces } from "../editor/place-sammel.ts";
import { listEditorPlaceKinds } from "../editor/ortsarten.ts";
import { listEditorPlaces } from "../editor/places.ts";
import { ruecknehmenOrt, vorschauOrt } from "../editor/ruecknahme-ort.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { addSites, relateSite } from "../editor/site-edit.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { readSiteCandidates } from "../editor/site-kandidaten.ts";
import { readPlaceSites } from "../editor/site-rows.ts";
import { mapChange, mapChanges, placeHistory } from "../editor/history.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";

/**
 * Lesen und Schreiben des Ortseditors (WI-0128 E4, E10; EDIT-0001 §6.2).
 *
 *     GET   /api/editor/places            die Ortsliste (Alle · Platziert · Fehlt), mit ETag            use_editor_menu (R)
 *     GET   /api/editor/places/kinds      die Ortsarten zur Wahl im Feld „Art“, mit ETag (WI-0295)    use_editor_menu (R)
 *     GET   /api/editor/places/:id        ein Ort mit Revision, Herkunft, Wiki-Werten, Wegenden          use_editor_menu (R)
 *     PATCH /api/editor/places/:id        place.update                                               edit_map_objects (R)
 *     POST  /api/editor/places/:id/move   place.move samt Wegenden                                   edit_map_geometry (R)
 *     GET   /api/editor/places/:id/move-targets  freie Wegenden im Umkreis (Einrastziele, E12)      edit_map_geometry (R)
 *     GET   /api/editor/places/:id/sites  die Stätten am Ort über Kennungen (E18)                      use_editor_menu (R)
 *     POST  /api/editor/places/:id/sites/relation  site.relate: zuordnen, verlagern, lösen (E10b)    edit_map_objects (R)
 *     GET   /api/editor/places/:id/history  der Verlauf des Orts, neueste zuerst (E17)                use_editor_menu (R)
 *     GET   /api/editor/changes           „Änderungen“: alle Operationen, `mine` nur die eigenen, Filter, Serien (E17, WI-0265)  use_editor_menu (R)
 *     GET   /api/editor/changes/:operationId  eine Operation mit Vorher/Nachher-Nutzlast (Geometrie), lazy (WI-0265)  use_editor_menu (R)
 *     GET   /api/editor/changes/:operationId/lage  wo die Gegenstände der Änderung HEUTE liegen: ein Kasten (WI-0265 B9)  use_editor_menu (R)
 *     GET   /api/editor/places/:id/removal       was „Ort entfernen“ trifft (E22)                       use_editor_menu (R)
 *     POST  /api/editor/places/:id/take-off-map  place.take_off_map                                  edit_map_geometry (R)
 *     POST  /api/editor/places/:id/delete        place.delete, weich (E22)                           edit_map_objects (R)
 *     POST  /api/editor/places/:id/in-landmarke  landmarke.umwandeln, gesperrt bis zum Cutoff (WI-0271 L8)  edit_map_objects; ergibt nie Berggipfel oder Vulkan (WI-0279, E2a)
 *     POST  /api/editor/places/:id/restore       place.restore, ↺ eines place.delete (E22)           edit_map_objects (R)
 *     POST  /api/editor/places/:id/restore-series/preview  Orte zurücknehmen: Vorprüfung, liest nur (WI-0265 B4)   use_editor_menu (R)
 *     POST  /api/editor/places/:id/restore-series          Felder einer Serie, EINE Verschiebung oder EIN Löschen (auch mehrerer Orte) in EINER Operation   edit_map_objects (R)
 *     POST  /api/editor/places            place.create (mit Lage, ohne Lage E16, aus einem Wiki-Eintrag)
 *                                                                     edit_map_objects, mit Lage auch edit_map_geometry
 *
 * 🔴 Die Schreibrouten tragen die Klasse `map` (423 `map_locked`, SYS-4) und den Schalter `MAP_EDITING` (423 `map_editing_off`,
 * E9), beide vor dem Handler; dazu die Sperre gegen den laufenden Zug in der Schreibnaht (503 `map_import_running`, `mapOperation`).
 *
 * 🔴 Ohne Anmeldung 401, ohne Recht 403, beides vor jeder Abfrage (`protect`). Die Antwort ist privat und wird bei jedem Aufruf
 * neu geprüft (`private, no-cache`): Mit dem ETag kommt ein unveränderter Stand als 304 ohne Körper zurück, und ein anderer
 * Editor sieht eine Änderung beim nächsten Laden. Fehler stehen im Umschlag (ADR-0018).
 *
 * Rund 5.000 Zeilen sind ungepackt etwa ein Megabyte, gepackt rund 250 KB (gemessen 2026-10-10). Packen tut seit 2026-10-17 Nginx
 * vor der API auf Stage und Production (Block E, `gzip_proxied any`); die Route packte vorher selbst, mit `gzipSync` mitten im
 * Ereignisschleifen-Takt. Wie die anderen Routen mit ETag (`territories.ts`) schreibt sie den Körper selbst: Er entsteht aus der
 * typisierten Liste (`EditorPlaceList`), und der Test prüft ihn gegen den Vertrag.
 */
const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });
const receipt = { 200: OperationReceipt, ...ADMIN_ERRORS };

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

export const editorPlacesRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(EDITOR_PLACES_URL, { ...protect("use_editor_menu") }, async (request, reply) => {
        return sendeMitEtag(request, reply, await listEditorPlaces(app.database!));
    });

    // Die Ortsarten zur Wahl im Feld „Art“ (WI-0295, Legacys „Ortsarten aus dem Wiki“): der Katalog mit der Zahl der Zeilen der Ortsliste je Art.
    app.get(EDITOR_PLACE_KINDS_URL, { ...protect("use_editor_menu") }, async (request, reply) => {
        return sendeMitEtag(request, reply, await listEditorPlaceKinds(app.database!));
    });

    app.get(
        `${EDITOR_PLACES_URL}/:id`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPlaceDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const detail = await readEditorPlace(app.database!, request.params.id);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        `${EDITOR_PLACES_URL}/:id/move-targets`,
        {
            ...protect("edit_map_geometry"),
            schema: { params: ById, response: { 200: EditorMoveTargets, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const ziele = await readMoveTargets(app.database!, request.params.id);
            if (ziele === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return ziele;
        },
    );

    // Die Stätten am Ort über Kennungen (E18): belegt, offen genannt, dazu die Vergleichszahl des heutigen sichtbaren Lesers.
    app.get(
        `${EDITOR_PLACES_URL}/:id/sites`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPlaceSites, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const sites = await readPlaceSites(app.database!, request.params.id);
            if (sites === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return sites;
        },
    );

    // E10b: eine Stätte diesem Ort zuordnen, von einem anderen her verlagern oder die Beziehung lösen. Die Sache, nicht die
    // Geometrie: `edit_map_objects`, wie `place.update`.
    app.post(
        `${EDITOR_PLACES_URL}/:id/sites/relation`,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: SiteRelationBody, response: receipt },
        },
        async (request) => relateSite(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // WI-0196 (EDIT-0003 T33 (3)) „Innerorts hinzufügen“: was noch nirgends innerorts ist, mit Abstand in Meilen.
    app.get(
        `${EDITOR_PLACES_URL}/:id/sites/candidates`,
        {
            ...protect("edit_map_objects"),
            schema: { params: ById, response: { 200: EditorSiteCandidates, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const kandidaten = await readSiteCandidates(app.database!, request.params.id);
            if (kandidaten === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return kandidaten;
        },
    );

    // Die gewählten Einträge in EINER Operation an diesen Ort binden, erst mit „Fertig“ (`site.add`).
    app.post(
        `${EDITOR_PLACES_URL}/:id/sites/add`,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: SiteAddBody, response: receipt },
        },
        async (request) => addSites(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.get(
        `${EDITOR_PLACES_URL}/:id/history`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, querystring: MapHistoryQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            void reply.header("cache-control", "private, no-cache");
            return placeHistory(app.database!, request.params.id, { ...request.query, personId: session.personId });
        },
    );

    app.get(
        EDITOR_CHANGES_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: MapChangesQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            void reply.header("cache-control", "private, no-cache");
            return mapChanges(app.database!, {
                ...request.query,
                mapDomainId: AVENTURIA.mapDomain,
                personId: session.personId,
            });
        },
    );

    // Die Nutzlast EINER Operation (WI-0265 B2a): Felder und Geometrie so, wie das Protokoll sie führt; die Liste trägt sie nicht.
    app.get(
        `${EDITOR_CHANGES_URL}/:operationId`,
        {
            ...protect("use_editor_menu"),
            schema: { params: MapChangeParams, response: { 200: MapHistoryEntry, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const eintrag = await mapChange(app.database!, request.params.operationId, {
                mapDomainId: AVENTURIA.mapDomain,
                personId: session.personId,
            });
            if (eintrag === undefined) throw new ApiError(404, "not_found", "Diese Änderung gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return eintrag;
        },
    );

    // Der heutige Ort der Gegenstände einer Operation (oder mehrerer, eine Arbeitsserie) als ein Kasten (WI-0265 B9): für „Auf der Karte zeigen“ bei einer Änderung, die keine Geometrie im Protokoll trägt.
    app.get(
        `${EDITOR_CHANGES_URL}/:operationId/lage`,
        {
            ...protect("use_editor_menu"),
            schema: {
                params: MapChangeParams,
                querystring: MapChangeLageQuery,
                response: { 200: MapChangeLage, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const lage = await aenderungLage(app.database!, request.params.operationId, {
                mapDomainId: AVENTURIA.mapDomain,
                mit: request.query.mit === undefined ? [] : request.query.mit.split(","),
            });
            if (lage === undefined) throw new ApiError(404, "not_found", "Diese Änderung gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return lage;
        },
    );

    // Ein neuer Ort mit Lage braucht beide Rechte: die Sache (`edit_map_objects`) und die Lage (`edit_map_geometry`).
    app.post(
        EDITOR_PLACES_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PlaceCreateBody, response: receipt },
        },
        async (request) => {
            // Ohne Lage berührt der neue Ort keine Geometrie (E16).
            if (request.body.position !== undefined)
                demand(await adminSession(request), "edit_map_geometry", app.authConfig);
            return createPlace(app.database!, await actorOf(request), request.body);
        },
    );

    app.patch(
        `${EDITOR_PLACES_URL}/:id`,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PlaceUpdateBody, response: receipt },
        },
        async (request) => updatePlace(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${EDITOR_PLACES_URL}/:id/move`,
        {
            ...protect("edit_map_geometry", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PlaceMoveBody, response: receipt },
        },
        async (request) => movePlace(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // „⊖ Von der Karte nehmen“ (D20): wie das Verschieben ein Eingriff in die Lage, also `edit_map_geometry`.
    app.post(
        `${EDITOR_PLACES_URL}/:id/take-off-map`,
        {
            ...protect("edit_map_geometry", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PlaceTakeOffMapBody, response: receipt },
        },
        async (request) => takePlaceOffMap(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // „Ort entfernen“ (E22): was es trifft, „Ganz löschen“ (weich) und ↺ unter „Änderungen“.
    app.get(
        `${EDITOR_PLACES_URL}/:id/removal`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: PlaceRemoval, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const removal = await readPlaceRemoval(app.database!, request.params.id);
            if (removal === undefined) throw new ApiError(404, "not_found", "Diesen Ort gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return removal;
        },
    );

    app.post(
        `${EDITOR_PLACES_URL}/:id/delete`,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PlaceDeleteBody, response: receipt },
        },
        async (request) => deletePlace(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        editorPlaceInLandmarkeUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: PlaceInLandmarkeBody,
                response: { 200: PlaceInLandmarkeReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => wandleOrtInLandmarke(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${EDITOR_PLACES_URL}/:id/restore`,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PlaceRestoreBody, response: receipt },
        },
        async (request) => restorePlace(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Orte zurücknehmen (WI-0265 B4, Fachvertrag C.2): die Felder einer Serie, EINE Verschiebung samt Wegenden oder EIN Löschen (auch für mehrere Orte) in EINER Operation. Die
    // Vorprüfung liest nur (wie die Vorschau der Flächenwerkzeuge unter der Kartensperre); das Recht der Vorwärtsoperation, bei einer fremden Person Pflichtgrund.
    app.post(
        editorPlaceRestoreSeriesPreviewUrl(":id"),
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
            return vorschauOrt(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorPlaceRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenOrt(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    // Die Mehrfachauswahl der Ortsliste (WI-0237, EDIT-0003 T57): ↺ auf Wiki-Werte und „Ganz löschen“ für mehrere, je EINE Operation.
    app.post(
        EDITOR_PLACES_SAMMEL_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PlaceSammelBody, response: receipt },
        },
        async (request) => sammelPlaces(app.database!, await actorOf(request), request.body),
    );

    app.post(
        EDITOR_PLACES_SAMMEL_DELETE_URL,
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PlaceDeleteManyBody, response: receipt },
        },
        async (request) => deletePlaces(app.database!, await actorOf(request), request.body),
    );
};
