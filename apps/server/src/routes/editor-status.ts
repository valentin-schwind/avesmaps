import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { EDITOR_STATUS_URL, EditorStatus } from "@avesmaps3d/shared";
import { protect } from "../auth/plugin.ts";
import { vorDemCutoff } from "../editor/legacy-cutoff.ts";
import { mapEditingOf } from "../editor/map-editing.ts";

/**
 * Der Stand des Bearbeitens (WI-0128 E9, EDIT-0001 §6.2):
 *
 *     GET /api/editor/status      Modus des Schalters MAP_EDITING (off, testwelt) und Umgebung      use_editor_menu (R)
 *
 * Der Ortseditor liest danach, welchen Hinweis er zeigt („Testwelt: …“, „gesperrt“). Die Kartensperre der Systemsteuerung (SYS-4)
 * steht nicht hier: Sie kann sich jeden Augenblick ändern, und eine Schreibroute nennt sie mit 423 `map_locked`.
 */
export const editorStatusRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        EDITOR_STATUS_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: EditorStatus } } },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            const environment = app.config.auth?.environment;
            return {
                mapEditing: mapEditingOf(request),
                ...(environment === undefined ? {} : { environment }),
                // „In Landmarke umwandeln …“ (WI-0271 L8): Der Griff steht gesperrt, solange der Server es ablehnte.
                umwandelnFrei: !vorDemCutoff(environment, process.env, "orte"),
            };
        },
    );
};
