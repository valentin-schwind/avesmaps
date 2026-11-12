import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { EDITOR_GEBIRGE_URL, EditorGebirge, EditorGebirgeProfile, UUID_PATTERN } from "@avesmaps3d/shared";
import { ADMIN_ERRORS } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { readEditorGebirge } from "../terrain/gebirge-editor.ts";
import { leseGebirgsObjekte } from "../terrain/gebirge-objekte.ts";

/**
 * Der Lesepfad des Gebirge-Editors (WI-0226, Vertrag `packages/shared/src/gebirge/vertrag.ts`): je Teilfläche eines Gebirges die
 * Eingabe der Vorschau, Typ und Abweichungen, die Grundhöhe und die Presets der gültigen Fassung (oder ihre Vorgabe aus dem Code).
 * Recht `use_editor_menu` wie der Lesepfad der Landschaften. Geschrieben wird über `gebirgSchreiben` im `landscape.update` (WI-0178).
 */
/** Höchstens so viele Linien je Anfrage nach Profilen (Flüsse und Pässe zusammen); je Linie tastet der Worker höchstens 256 Punkte ab. */
const PROFILE_MAX = 64;

const ByArea = Type.Object({ area: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

export const editorGebirgeRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        `${EDITOR_GEBIRGE_URL}/:area`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ByArea, response: { 200: EditorGebirge, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const gebirge = await readEditorGebirge(app.database!, request.params.area);
            if (gebirge === undefined) throw new ApiError(404, "not_found", "Dieses Gebirge gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return gebirge;
        },
    );
    // Die Höhenprofile der Flüsse und Pässe (WI-0245): im Höhenmodell, das der Routing-Worker ohnehin hält; nichts wird dafür geladen.
    app.get(
        `${EDITOR_GEBIRGE_URL}/:area/profile`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ByArea, response: { 200: EditorGebirgeProfile, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const gebirge = await readEditorGebirge(app.database!, request.params.area);
            if (gebirge === undefined) throw new ApiError(404, "not_found", "Dieses Gebirge gibt es nicht.");
            const fluesse = gebirge.eingabe.fluesse.map((fluss) => fluss.p);
            const paesse = (gebirge.eingabe.paesse ?? []).map((pass) => pass.punkte);
            // Gedeckelt: Was darüber liegt, steht ohne Profil (null), nie mit einem erfundenen.
            const linien = [...fluesse, ...paesse].slice(0, PROFILE_MAX);
            const [hoehen, objekte] = await Promise.all([
                app.routeRunner?.hoehen?.(linien, request.ip) ?? Promise.resolve(null),
                leseGebirgsObjekte(app.database!, request.params.area, gebirge.eingabe),
            ]);
            const profil = (i: number) => {
                const linie = hoehen?.[i];
                return linie ? { at: linie.at, h: linie.height.map((h) => (Number.isFinite(h) ? h : null)) } : null;
            };
            void reply.header("cache-control", "private, no-cache");
            return {
                verfuegbar: hoehen !== null,
                fluesse: fluesse.map((_, i) => profil(i)),
                paesse: paesse.map((_, i) => profil(fluesse.length + i)),
                objekte,
            };
        },
    );
};
