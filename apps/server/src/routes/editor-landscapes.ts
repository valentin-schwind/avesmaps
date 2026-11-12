import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    AVENTURIA,
    EDITOR_LANDSCAPE_BOX_TARGETS_URL,
    EDITOR_LANDSCAPE_NAEHTE_URL,
    EditorGebirgsNaehte,
    EDITOR_LANDSCAPE_LAYERS,
    EDITOR_LANDSCAPES_VEREINIGEN_URL,
    FlaechenVereinigenBody,
    FlaechenVereinigenPruefung,
    FlaechenVereinigenQuery,
    FlaechenVereinigenReceipt,
    EDITOR_LANDSCAPES_HIDDEN_URL,
    EDITOR_LANDSCAPES_URL,
    EditorHiddenLandscapes,
    EditorLandscapeDetail,
    EditorLandscapeTargets,
    EDITOR_PEAKS_URL,
    EditorPeakDetail,
    LandscapeBoxTargetsQuery,
    OperationReceipt,
    PeakCreateBody,
    LandmarkenKandidatUnterdrueckenBody,
    editorLandmarkenKandidatUnterdrueckenUrl,
    PeakCreateReceipt,
    PeakRetireBody,
    PeakUpdateBody,
    PeakUpdateReceipt,
    editorPeakHistoryUrl,
    editorPeakRetireUrl,
    editorPeakUrl,
    LandscapeBooleanBody,
    LandscapeBooleanPreview,
    LandscapeBooleanPreviewBody,
    LandscapeCreateBody,
    LandscapeCreateReceipt,
    LandscapeLabelCreateBody,
    LandscapeLabelCreateReceipt,
    LandscapeLabelRetireBody,
    LandscapeRetireBody,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    LandscapeUpdateBody,
    LandscapeUpdateReceipt,
    MapHistoryPage,
    MapHistoryQuery,
    UUID_PATTERN,
    editorLandscapeBooleanPreviewUrl,
    editorLandscapeBooleanUrl,
    editorLandscapePartsUrl,
    LandscapePartsBody,
    LandscapePartsReceipt,
    editorLandscapeSplitUrl,
    LandscapeSplitBody,
    LandscapeSplitReceipt,
    editorLandscapeCopyUrl,
    LandscapeCopyBody,
    LandscapeCopyReceipt,
    editorLandscapeBrushUrl,
    LandscapeBrushBody,
    LandscapeBrushResult,
    editorLandscapesBatchUrl,
    LandscapeBatchBody,
    editorLandscapesBatchRetireUrl,
    LandscapeBatchRetireBody,
    editorLandscapeHistoryUrl,
    editorLandscapeLabelRetireUrl,
    editorLandscapeLabelsUrl,
    editorLandscapeRestoreSeriesPreviewUrl,
    editorLandscapeRestoreSeriesUrl,
    editorPeakRestoreSeriesPreviewUrl,
    editorPeakRestoreSeriesUrl,
    editorLandscapeRetireUrl,
    editorLandscapeUrl,
    editorUmwandlungRestoreSeriesPreviewUrl,
    editorUmwandlungRestoreSeriesUrl,
    rechteVon,
    type EditorLandscapeLayer,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import { resolveTerrainRecipe } from "../terrain/auswahl.ts";
import { ladeNahtLinien } from "../terrain/gebirgs-naehte.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, demandEines, protect, protectEines } from "../auth/plugin.ts";
import {
    listEditorLandscapes,
    listHiddenLandscapes,
    readEditorLandscape,
    readEditorLandscapeTargets,
    readLandscapeTargetsInBox,
} from "../editor/landscapes.ts";
import { einzelnLaden } from "../editor/einzeln-laden.ts";
import { landscapeHistory, peakHistory } from "../editor/history.ts";
import { retirePeak } from "../editor/peak-retire.ts";
import { ruecknehmenUmwandlung, vorschauUmwandlung } from "../editor/ruecknahme-umwandlung.ts";
import { createLandscape } from "../editor/landscape-create.ts";
import { createLandscapeLabel, retireLandscapeLabel } from "../editor/landscape-labels.ts";
import { createPeak } from "../editor/peak-create.ts";
import { setzeUnterdrueckung } from "../editor/landmarken-kandidaten.ts";
import { readEditorPeak, updatePeak } from "../editor/peak-update.ts";
import { booleanLandscape, vorschauFlaechen } from "../editor/landscape-boolean.ts";
import { partsLandscape } from "../editor/landscape-parts.ts";
import { retireLandscape, retireLandscapes } from "../editor/landscape-retire.ts";
import { batchLandscapes } from "../editor/landscape-batch.ts";
import { splitLandscape } from "../editor/landscape-split.ts";
import { pruefeLandschaftenVereinigen, vereinigeLandschaften } from "../editor/landscape-vereinigen.ts";
import { copyLandscape } from "../editor/landscape-copy.ts";
import { maleStrich } from "../editor/landscape-brush.ts";
import { updateLandscape } from "../editor/landscape-update.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { ruecknehmenFlaeche, vorschauFlaeche } from "../editor/ruecknahme-flaeche.ts";
import { ruecknehmenGipfel, vorschauGipfel } from "../editor/ruecknahme-gipfel.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { formtGelaende } from "@avesmaps3d/shared";
import { rechteHier } from "../kanal/schalter.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";

/**
 * Die Routen des Landschaftseditors, heute Derographie-Editor (WI-0178, EDIT-0004 §5), samt Gipfel und Vulkane (P1, T55:
 * `GET` und `PATCH /api/editor/peaks/:id`). Paket A1 liest nur:
 *
 * - `GET /api/editor/landscapes` — die Liste (`use_editor_menu`), mit schwachem ETag und 304 wie die Ortsliste.
 * - `GET /api/editor/landscapes/:id` — Felder, Teilflächen eckig, Beschriftungen, Nachbarn mit gemeinsamen Ecken (`use_editor_menu`).
 * - `GET /api/editor/landscapes/:id/targets?layers=…` — die Andockziele des Modus „Ecken bearbeiten“ (C1, `edit_map_geometry`).
 * - `PATCH /api/editor/landscapes/:id` — „Fertig“ im Landschaftseditor (B2, O3): `landscape.update`, Felder, Beschriftungen und Form
 *   (auch aus „Ecken bearbeiten“, mit den mitgezogenen Nachbarn) in EINER Operation (`edit_map_objects`, mit `areas` auch
 *   `edit_map_geometry`). Das frühere `POST …/reshape` (C2) ist darin aufgegangen.
 * - `GET /api/editor/landscapes/vereinigen?ids=…` — „Flächen vereinigen ›“ (WI-0252): geht es, sonst der Grund (`use_editor_menu`);
 *   `POST …/vereinigen` schreibt `landscape.merge` (beide Rechte), ↺ über `…/:id/restore-series` (WI-0265 B6c).
 *
 * 🔴 Wie Ortseditor und Wegeditor trägt jede schreibende Route die Klasse `map` (423 `map_locked`) und den Schalter `MAP_EDITING` (423
 * `map_editing_off`), beide vor dem Handler; die Sperre gegen den laufenden Zug sitzt in der Schreibnaht (503). Die übrigen schreibenden
 * Routen kommen mit C3 bis D2.
 */

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}
/**
 * Die Punkte teilen sich eine Tafel (`terrain_peak`): Berggipfel und Vulkan formen Gelände und gehören dem Topographen (WI-0279, E2a); alle anderen Landmarken bleiben bei
 * jedem Editor (E12), ohne Grundrolle beim Derographen. `lage`: Die Handlung setzt, verschiebt oder entfernt den Punkt.
 */
function pruefePunkt(
    session: Awaited<ReturnType<typeof adminSession>>,
    config: AuthConfig,
    arten: readonly string[],
    lage: boolean,
): void {
    if (arten.some(formtGelaende)) {
        demand(session, "edit_mountains", config);
        return;
    }
    demandEines(session, ["edit_map_objects", "edit_landscapes"], config);
    if (lage) demandEines(session, ["edit_map_geometry", "edit_landscape_form"], config);
}

/**
 * Die Rücknahme an einem Punkt fragt die Rechte der Derographie (`FLAECHE_ADAPTER`); die Route hat das Fachrecht schon geprüft. Wer den Punkt ändern durfte, darf ihn auch
 * zurücknehmen: Die Sammelrechte und das Gebirge zählen hier wie die Rechte der Derographie.
 */
function leserAmPunkt(leser: RuecknahmeLeser, art: string): RuecknahmeLeser {
    const rechte = new Set(leser.rechte);
    if (formtGelaende(art) ? rechte.has("edit_mountains") : rechte.has("edit_map_objects"))
        rechte.add("edit_landscapes");
    if (formtGelaende(art) ? rechte.has("edit_mountains") : rechte.has("edit_map_geometry")) {
        rechte.add("edit_landscape_form");
    }
    return { ...leser, rechte };
}

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});
/** Die sichtbaren Ebenen als Liste mit Komma; ohne Angabe alle drei. */
const Ebenen = Type.Object(
    {
        layers: Type.Optional(
            Type.String({
                pattern: `^(${EDITOR_LANDSCAPE_LAYERS.join("|")})(,(${EDITOR_LANDSCAPE_LAYERS.join("|")}))*$`,
            }),
        ),
    },
    { additionalProperties: false },
);

export const editorLandscapesRoutes: FastifyPluginAsyncTypebox = async (app) => {
    /** Andockziele um eine Landschaft: gleiche Anfragen teilen sich ein Ergebnis, sonst eine nach der anderen (WI-0298 Stufe 5). */
    const zieleEinzeln = einzelnLaden<Buffer | undefined>();
    const verlangePunkt = (
        session: Awaited<ReturnType<typeof adminSession>>,
        arten: readonly string[],
        lage: boolean,
    ): void => pruefePunkt(session, app.authConfig, arten, lage);
    /** Die Art eines Punkts; ein unbekannter zählt als Berggipfel, die Antwort 404 kommt vom Schreibweg. */
    const artDesPunkts = async (id: string): Promise<string> => {
        const [zeile] = await app.database!<
            { subtype: string }[]
        >`SELECT subtype FROM terrain_peak WHERE public_id = ${id}::uuid`;
        return zeile?.subtype ?? "berggipfel";
    };
    const artenDerPunkte = async (ids: readonly string[]): Promise<string[]> => {
        const zeilen = await app.database!<
            { subtype: string }[]
        >`SELECT subtype FROM terrain_peak WHERE public_id = ANY(${[...ids]}::uuid[])`;
        return zeilen.map((zeile) => zeile.subtype);
    };
    /** Wird eine der Flächen zum Gebirge, oder ist sie eines und wechselt Art oder Ebene? */
    const wechseltGebirge = async (
        ids: readonly string[],
        changes: { layer?: string | undefined; type?: string | undefined } | undefined,
    ): Promise<boolean> => {
        if (changes?.layer === undefined && changes?.type === undefined) return false;
        if (changes.type === "gebirge") return true;
        const [zeile] = await app.database!<{ gebirge: boolean }[]>`
            SELECT EXISTS (SELECT 1 FROM region WHERE public_id = ANY(${[...ids]}::uuid[]) AND region_layer = 'topographie' AND region_type = 'gebirge') AS gebirge
        `;
        return zeile?.gebirge === true;
    };
    // Die Verborgenen für Editoren (T41): eine kleine Zusatzschicht, nie aus einem Zwischenspeicher (Claudio 2026-10-18).
    app.get(
        EDITOR_LANDSCAPES_HIDDEN_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: EditorHiddenLandscapes, ...ADMIN_ERRORS } } },
        async (_request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return listHiddenLandscapes(app.database!);
        },
    );

    // Die Andockziele im Kasten für „Neue Fläche“ (T47, C3): Kanten derselben Ebene und Flusspunkte.
    app.get(
        EDITOR_LANDSCAPE_BOX_TARGETS_URL,
        {
            ...protect("edit_landscape_form"),
            schema: {
                querystring: LandscapeBoxTargetsQuery,
                response: { 200: EditorLandscapeTargets, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return readLandscapeTargetsInBox(app.database!, request.query);
        },
    );

    app.get(EDITOR_LANDSCAPES_URL, { ...protect("use_editor_menu") }, async (request, reply) => {
        return sendeMitEtag(request, reply, await listEditorLandscapes(app.database!));
    });

    // Gemeinsame Grenzen (OPS-000089): nur, wo die Fassung sie kennt; sonst wäre die Linie auf der Karte ein falsches Versprechen.
    app.get(
        EDITOR_LANDSCAPE_NAEHTE_URL,
        { ...protect("use_editor_menu"), schema: { response: { 200: EditorGebirgsNaehte, ...ADMIN_ERRORS } } },
        async (_request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            const rezept = await resolveTerrainRecipe(app.database!, AVENTURIA.mapDomain);
            if (!rezept.mountainMorphology.andock) return { kanten: [] };
            return { kanten: await ladeNahtLinien(app.database!, AVENTURIA.mapDomain) };
        },
    );

    app.get(
        `${EDITOR_LANDSCAPES_URL}/:id`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorLandscapeDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const detail = await readEditorLandscape(app.database!, request.params.id);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diese Landschaft gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        editorLandscapeHistoryUrl(":id"),
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
            const [da] = await app.database!<{ n: number }[]>`
                SELECT 1 AS n FROM region WHERE public_id = ${request.params.id}::uuid AND region_layer <> 'klima'
            `;
            if (da === undefined) throw new ApiError(404, "not_found", "Diese Fläche gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return landscapeHistory(app.database!, request.params.id, { ...request.query, personId: session.personId });
        },
    );

    app.get(
        `${EDITOR_LANDSCAPES_URL}/:id/targets`,
        {
            ...protect("edit_landscape_form"),
            schema: { params: ById, querystring: Ebenen, response: { 200: EditorLandscapeTargets, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const layers = request.query.layers?.split(",") as EditorLandscapeLayer[] | undefined;
            const schluessel = `${request.params.id}|${[...(layers ?? EDITOR_LANDSCAPE_LAYERS)].sort().join(",")}`;
            const targets = await zieleEinzeln(schluessel, () =>
                readEditorLandscapeTargets(app.database!, request.params.id, layers),
            );
            if (targets === undefined) throw new ApiError(404, "not_found", "Diese Landschaft gibt es nicht.");
            void reply.header("cache-control", "private, no-cache").type("application/json; charset=utf-8");
            // Fertiges JSON in der Form des Schemas: Fastify reicht Bytes unverändert durch.
            return reply.send(targets as unknown as EditorLandscapeTargets);
        },
    );
    app.patch(
        editorLandscapeUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeUpdateBody,
                response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            // Die Form ist Geometrie: Dafür braucht es auch `edit_landscape_form`.
            const session = await adminSession(request);
            if ((request.body.areas ?? []).length > 0) demand(session, "edit_landscape_form", app.authConfig);
            // Gebirge (WI-0279, E2): Werte, Gipfel und jeder Wechsel zu oder von Gebirge gehören dem Topographen.
            if (
                (request.body.gebirge ?? []).length > 0 ||
                (request.body.peaks ?? []).length > 0 ||
                (await wechseltGebirge([request.params.id], request.body.changes))
            ) {
                demand(session, "edit_mountains", app.authConfig);
            }
            return updateLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Gipfel und Vulkane (WI-0178 P1, T55): lesen und `peak.update`; die Lage ist Geometrie, darum dann auch `edit_map_geometry`.
    app.get(
        editorPeakUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorPeakDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const gipfel = await readEditorPeak(app.database!, request.params.id);
            if (gipfel === undefined) throw new ApiError(404, "not_found", "Diesen Gipfel gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return gipfel;
        },
    );
    app.patch(
        editorPeakUrl(":id"),
        {
            ...protectEines(["edit_map_objects", "edit_landscapes", "edit_mountains"], { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PeakUpdateBody, response: { 200: PeakUpdateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const { changes } = request.body;
            const arten = [
                await artDesPunkts(request.params.id),
                ...(changes.subtype === undefined ? [] : [changes.subtype]),
            ];
            verlangePunkt(await adminSession(request), arten, changes.position !== undefined);
            return updatePeak(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );
    // „Gipfel entfernen …“ (Editor-Orchestrierung 2026-10-19): weich, ↺ über `…/restore-series` (WI-0265 B6c); der Punkt ist Geometrie, darum auch
    // `edit_map_geometry` wie beim Entfernen einer Fläche. Der Verlauf liest auch einen Gelöschten.
    app.get(
        editorPeakHistoryUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, querystring: MapHistoryQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const [da] = await app.database!<{ n: number }[]>`
                SELECT 1 AS n FROM terrain_peak WHERE public_id = ${request.params.id}::uuid
            `;
            if (da === undefined) throw new ApiError(404, "not_found", "Diesen Gipfel gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return peakHistory(app.database!, request.params.id, { ...request.query, personId: session.personId });
        },
    );
    app.post(
        editorPeakRetireUrl(":id"),
        {
            ...protectEines(["edit_map_objects", "edit_landscapes", "edit_mountains"], { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: PeakRetireBody, response: { 200: PeakUpdateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            verlangePunkt(await adminSession(request), [await artDesPunkts(request.params.id)], true);
            return retirePeak(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );
    // „▲ Gipfel setzen …“ (P7): ein Gipfel an einer Stelle, darum auch `edit_map_geometry`.
    app.post(
        EDITOR_PEAKS_URL,
        {
            ...protectEines(["edit_map_objects", "edit_landscapes", "edit_mountains"], { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: PeakCreateBody, response: { 200: PeakCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Ohne `subtype` entsteht ein Berggipfel.
            verlangePunkt(await adminSession(request), [request.body.subtype ?? "berggipfel"], true);
            return createPeak(app.database!, await actorOf(request), request.body);
        },
    );

    // Die Kandidaten sind Landmarken: bei jedem Editor (E12), ohne Grundrolle beim Derographen.
    // „Nicht auf die Karte“ an einem Landmarken-Kandidaten (WI-0271 L7): nur die Unterdrückung, keine Geometrie; Recht und Schalter wie jeder Schreibweg der Editoren.
    app.post(
        editorLandmarkenKandidatUnterdrueckenUrl(":id"),
        {
            ...protectEines(["edit_map_objects", "edit_landscapes"], { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandmarkenKandidatUnterdrueckenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => setzeUnterdrueckung(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // „Neue Fläche“ (T47, gemeinsamer Ablauf C3): Fläche samt erster Teilfläche, darum auch `edit_map_geometry`.
    app.post(
        EDITOR_LANDSCAPES_URL,
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: LandscapeCreateBody, response: { 200: LandscapeCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return createLandscape(app.database!, await actorOf(request), request.body);
        },
    );

    // „Fläche entfernen …“ und sein ↺ (D2): Die Teilflächen gehen mit, darum auch `edit_map_geometry`.
    app.post(
        editorLandscapeRetireUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeRetireBody,
                response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return retireLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Die Derographie zurücknehmen (WI-0265 B3 Gebirge, B6c alle übrigen Arten: Felder, Beschriftungen, Form, Stilllegen, die Werkzeuge an Flächen; Fachvertrag C.2): die Vorprüfung liest
    // nur (wie die Vorschau der Flächenwerkzeuge steht sie unter der Kartensperre), die Rücknahme schreibt EINE Operation mit der Quelle restore und stößt die Ableitung einmal an.
    // Das Recht der Vorwärtsoperation (je Art, im gemeinsamen Ablauf); bei einer fremden Person Pflichtgrund.
    app.post(
        editorLandscapeRestoreSeriesPreviewUrl(":id"),
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
            return vorschauFlaeche(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorLandscapeRestoreSeriesUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: RuecknahmeBody,
                response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            ruecknehmenFlaeche(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );
    // Dasselbe am Gipfel (WI-0265 B6c): Name, Höhe, Anzeige, Lage, Stilllegen und Zurückholen; `:id` ist ein Gipfel, den jedes Mitglied berührt.
    // Die Umwandlung eines Orts in eine Landmarke zurücknehmen (WI-0271 L8): an der Landmarke, eine eigene Familie.
    app.post(
        editorUmwandlungRestoreSeriesPreviewUrl(":id"),
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
            return vorschauUmwandlung(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorUmwandlungRestoreSeriesUrl(":id"),
        {
            ...protect("edit_map_objects", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: RuecknahmeBody,
                response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            ruecknehmenUmwandlung(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    app.post(
        editorPeakRestoreSeriesPreviewUrl(":id"),
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
            return vorschauGipfel(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorPeakRestoreSeriesUrl(":id"),
        {
            ...protectEines(["edit_map_objects", "edit_landscapes", "edit_mountains"], { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: RuecknahmeBody,
                response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const session = await adminSession(request);
            const art = await artDesPunkts(request.params.id);
            verlangePunkt(session, [art], false);
            return ruecknehmenGipfel(
                app.database!,
                await actorOf(request),
                leserAmPunkt(leserVon(session, app.authConfig.kanal), art),
                request.params.id,
                request.body,
            );
        },
    );
    // Beschriftungen anlegen, duplizieren und löschen (WI-0232): je eine Sofort-Operation gegen die Revision der Landschaft.
    app.post(
        editorLandscapeLabelsUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeLabelCreateBody,
                response: { 200: LandscapeLabelCreateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => createLandscapeLabel(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        editorLandscapeLabelRetireUrl(":id", ":labelId"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: Type.Object(
                    {
                        id: Type.String({ pattern: UUID_PATTERN }),
                        labelId: Type.String({ pattern: UUID_PATTERN }),
                    },
                    { additionalProperties: false },
                ),
                body: LandscapeLabelRetireBody,
                response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            retireLandscapeLabel(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.labelId,
                request.body,
            ),
    );

    // „Mit anderer Fläche ›“ (Werkzeug 1, Thomas 4.1): die Vorschau rechnet nur, das Schreiben ist EINE Operation an zwei Teilflächen.
    app.post(
        editorLandscapeBooleanPreviewUrl(":id"),
        {
            ...protect("edit_landscape_form", { writeClass: "map" }),
            schema: {
                params: ById,
                body: LandscapeBooleanPreviewBody,
                response: { 200: LandscapeBooleanPreview, ...ADMIN_ERRORS },
            },
        },
        async (request) => vorschauFlaechen(app.database!, request.params.id, request.body),
    );
    app.post(
        editorLandscapeBooleanUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeBooleanBody,
                response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return booleanLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // „Flächen vereinigen ›“ (WI-0252): Geht es, und wer kann Vorlage sein? Rein lesend, für das Untermenü im Kartenmenü.
    app.get(
        EDITOR_LANDSCAPES_VEREINIGEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: FlaechenVereinigenQuery,
                response: { 200: FlaechenVereinigenPruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return pruefeLandschaftenVereinigen(app.database!, request.query.ids.split(","));
        },
    );
    // „Flächen vereinigen ›“: Form und Landschaften von der Karte, also beide Rechte wie „Mit anderer Fläche“; ↺ über …/restore-series.
    app.post(
        EDITOR_LANDSCAPES_VEREINIGEN_URL,
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: FlaechenVereinigenBody, response: { 200: FlaechenVereinigenReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return vereinigeLandschaften(app.database!, await actorOf(request), request.body);
        },
    );
    // „Unterflächen ›“ (Werkzeug 3, Thomas 4.1): vereinigen, herauslösen, löschen, als EINE Operation; ↺ über …/restore-series.
    app.post(
        editorLandscapePartsUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapePartsBody,
                response: { 200: LandscapePartsReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return partsLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // „Zerschneiden“ (Werkzeug 5, Betreiber 2026-10-19): die Schnittlinie teilt exakt, das Stück wird eine neue Landschaft; ↺ über …/restore-series.
    app.post(
        editorLandscapeSplitUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeSplitBody,
                response: { 200: LandscapeSplitReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return splitLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Die Mehrfachauswahl (EDIT-0003 T57): Ebene, Art und „Verbergen“ für alle gewählten Landschaften als EINE Operation.
    app.post(
        editorLandscapesBatchUrl,
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: LandscapeBatchBody, response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Dieselbe Regel wie am einzelnen: Berggipfel und Vulkane in der Auswahl und jeder Wechsel zu oder von Gebirge gehören dem Topographen, andere Landmarken nicht (E12).
            const session = await adminSession(request);
            const { peaks = [] } = request.body;
            if (peaks.length > 0) verlangePunkt(session, await artenDerPunkte(peaks), false);
            if (await wechseltGebirge(request.body.ids, request.body.changes)) {
                demand(session, "edit_mountains", app.authConfig);
            }
            return batchLandscapes(app.database!, await actorOf(request), request.body);
        },
    );
    // … und „Entfernen …“ für alle: `landscape.retire` über mehrere, ↺ an einer holt alle zurück.
    app.post(
        editorLandscapesBatchRetireUrl,
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: LandscapeBatchRetireBody, response: { 200: LandscapeUpdateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Flächen verlangen die Form, Punkte das Recht ihrer Art: Landmarken ohne Fläche in der Auswahl darf jeder Editor entfernen (E12).
            const session = await adminSession(request);
            const { ids, peaks = [] } = request.body;
            if (ids.length > 0) demand(session, "edit_landscape_form", app.authConfig);
            if (peaks.length > 0) verlangePunkt(session, await artenDerPunkte(peaks), true);
            return retireLandscapes(app.database!, await actorOf(request), request.body);
        },
    );

    // „Fläche malen“ und „Fläche radieren“ (Werkzeug 6): EIN Strich, gerechnet, nichts geschrieben; das Ergebnis geht in den Entwurf.
    app.post(
        editorLandscapeBrushUrl(":id"),
        {
            ...protect("edit_landscape_form", { writeClass: "map" }),
            schema: {
                params: ById,
                body: LandscapeBrushBody,
                response: { 200: LandscapeBrushResult, ...ADMIN_ERRORS },
            },
        },
        async (request) => maleStrich(app.database!, request.params.id, request.body),
    );

    // „Kopieren …“ (Werkzeug 8, Betreiber 2026-10-19 „wie legacy B mit haken“): die Teilfläche als Kopie in eine Zielebene, mit dem Haken
    // „Originalfläche löschen“ als Umziehen; EINE Operation, ↺ über …/restore-series der Ziellandschaft.
    app.post(
        editorLandscapeCopyUrl(":id"),
        {
            ...protect("edit_landscapes", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: LandscapeCopyBody,
                response: { 200: LandscapeCopyReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_landscape_form", app.authConfig);
            return copyLandscape(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );
};
