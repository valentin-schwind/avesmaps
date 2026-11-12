import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    EDITOR_TERRITORIES_URL,
    EDITOR_TERRITORIES_VEREINIGEN_URL,
    FlaechenVereinigenBody,
    FlaechenVereinigenPruefung,
    FlaechenVereinigenQuery,
    FlaechenVereinigenReceipt,
    EDITOR_TERRITORY_DISPLAY_URL,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    rechteVon,
    editorTerritoryRestoreSeriesPreviewUrl,
    editorTerritoryRestoreSeriesUrl,
    EDITOR_TERRITORY_SAMMEL_URL,
    EDITOR_TERRITORY_SAMMEL_STAND_URL,
    EDITOR_TERRITORY_SAMMEL_RETIRE_URL,
    TerritorySammelRetireBody,
    EDITOR_TERRITORY_OBERGEBIET_URL,
    TerritoryObergebietBody,
    TerritoryObergebietReceipt,
    EditorTerritorySammelStand,
    TerritorySammelStandBody,
    EDITOR_TERRITORY_FINDINGS_URL,
    EDITOR_TERRITORY_TARGETS_URL,
    EditorTerritoryTargets,
    TerritoryAreaCreateBody,
    TerritoryAreaCreateReceipt,
    TerritoryCreateBody,
    TerritoryCreateReceipt,
    TerritoryTargetsQuery,
    editorTerritoryAreasUrl,
    EditorTerritoryDetail,
    EditorTerritoryForm,
    EditorTerritoryParentConsequences,
    MapHistoryPage,
    MapHistoryQuery,
    editorTerritoryHistoryUrl,
    TerritoryDisplayBody,
    TerritoryDisplayReceipt,
    TerritorySammelBody,
    TerritoryRestoreBody,
    TerritoryRetireBody,
    TerritoryUpdateBody,
    TerritoryUpdateReceipt,
    OperationReceipt,
    editorTerritoryRestoreUrl,
    editorTerritoryRetireUrl,
    UUID_PATTERN,
    editorTerritoryUrl,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { demand, protect } from "../auth/plugin.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import { ruecknehmenGebiet, vorschauGebiet } from "../editor/ruecknahme-gebiet.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import type { MapActor } from "../editor/map-operation.ts";
import {
    listEditorTerritories,
    readEditorTerritory,
    readEditorTerritoryHierarchy,
    readTerritorySammelStand,
} from "../editor/territories.ts";
import {
    createParentTerritory,
    createTerritory,
    createTerritoryArea,
    readTerritoryTargets,
} from "../editor/territory-create.ts";
import { changeTerritoryDisplay } from "../editor/territory-display.ts";
import { changeTerritoriesTogether } from "../editor/territory-sammel.ts";
import { readTerritoryFindings } from "../editor/territory-findings.ts";
import { readParentConsequences } from "../editor/territory-reparent.ts";
import { restoreTerritory, retireTerritories, retireTerritory } from "../editor/territory-retire.ts";
import { territoryHistory } from "../editor/history.ts";
import { updateTerritory } from "../editor/territory-update.ts";
import { pruefeGebieteVereinigen, vereinigeGebiete } from "../editor/territory-vereinigen.ts";
import { readEditorTerritoryForm } from "../editor/territory-form.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";
import { rechteHier } from "../kanal/schalter.ts";

/**
 * Die Routen des Herrschaftsgebiete-Editors (WI-0209, EDIT-0005 §6). Die Pakete A1 und A3 lesen nur:
 *
 * - `GET /api/editor/territories` — der Baum als Liste (`use_editor_menu`), mit schwachem ETag und 304 wie die Landschaften.
 * - `GET /api/editor/territories/:id` — Felder, Detailfelder mit Herkunft, Kette, Kinder, Hauptstadt und Sitz, Flächen ohne Geometrie,
 *   Ansprüche, Wappen (`use_editor_menu`).
 * - `GET /api/editor/territories/:id/hierarchy` — die Eingabe der Anzeigeregel für den Reiter „Hierarchie“ (A3): das Gebiet, seine
 *   Kette und alle Nachfahren samt Flächen, mit ETag wie die Liste (ein Reich trägt einige hundert Gebiete).
 * - `GET /api/editor/territories/:id/form?x=&y=` — der Modus „Grenzen bearbeiten“ (C1, `edit_map_geometry`): eckige Flächen mit Revision,
 *   Kette, Nachbarn mit gemeinsamen Ecken und Kanten im Kasten; mit Punkt bei einem abgeleiteten Gebiet die Baronie darunter. Mit
 *   `nur=flaechen` nur die eigenen Flächen (ohne Nachbarn und Kanten): das Kartenmenü liest so die Teile für „Unterpolygone löschen …“
 *   (OPS-000075); geschrieben wird dann mit dem PATCH unten, kein eigener Schreibweg.
 * - `PATCH /api/editor/territories/:id` — „Fertig“ im Gebietseditor (B2): `territory.update`, Felder und Form EINES Gebiets
 *   (`edit_map_objects`, mit Form dazu `edit_map_geometry`), danach der Auftrag `territory_derive`.
 * - `POST /api/editor/territories/:id/retire` — „Entfernen“ (D3, `territory.retire`): „Von der Karte nehmen“ oder „Ganz löschen“ mit
 *   den Untergebieten; `POST …/:id/restore` nimmt es zurück (↺ im Verlauf, `territory.restore`). Beide Rechte, Klasse `map`.
 * - `GET /api/editor/territories/:id/history` — der Verlauf des Gebiets (D5, `use_editor_menu`): jede Operation an ihm oder einer
 *   seiner Flächen, neueste zuerst, seitenweise (`editor/history.ts`); ↺ schreibt `territory.update` oder `territory.display` mit
 *   `reverts`.
 * - `POST /api/editor/territories/:id/restore-series[/preview]` — Gebiete zurücknehmen (WI-0265 B6b): Felder, Darstellung, Entfernen, Obergebiet anlegen und Vereinigen als EINE Operation (`ruecknahme-gebiet.ts`).
 * - `GET /api/editor/territories/:id/reparent?parent=` — die Folgen von „Umhängen“ je Band vorher (D1, R13, `use_editor_menu`), nur
 *   lesend; geschrieben wird das Obergebiet mit `territory.update`.
 * - `GET /api/editor/territories/findings` — „Prüfen“ (D6, `use_editor_menu`): die Befunde aller Gebiete, nie eine Sperre; mit ETag.
 * - `POST /api/editor/territories/display` — „Fertig“ in „Farben und Zoombänder“: `territory.display` mit Spanne und Farbe aller
 *   geänderten Gebiete (D2, D4, `edit_map_objects`); mit einer Spanne danach der Auftrag `territory_derive`.
 * - `POST /api/editor/territories/sammel` — „Fertig“ der Mehrfachauswahl (EDIT-0003 T57): `territory.sammel` mit Art, Status,
 *   Obergebiet, Farbe, Spanne und ↺ der Wiki-Felder für alle gewählten Gebiete in EINER Operation (`territory-sammel.ts`).
 * - `POST /api/editor/territories` — „Neue Fläche“ (C3, `territory.create`): ein neues Gebiet samt erster Fläche; `POST …/:id/areas`
 *   — „Grenze zeichnen“ (`territory_area.create`); `GET …/targets?x0=&y0=&x1=&y1=` — die Ziele im Kasten. Beide Rechte, Klasse `map`.
 * - `GET /api/editor/territories/vereinigen?ids=…` — „Flächen vereinigen ›“ (WI-0252): geht es, sonst der Grund (`use_editor_menu`);
 *   `POST …/vereinigen` schreibt `territory.merge` (beide Rechte, Klasse `map`), ↺ über `…/:id/restore`.
 *
 * Die übrigen schreibenden Routen (`territory.update`, `territory.reparent` …) kommen mit den Paketen B2, D1, D3 und D4, alle mit
 * `writeClass: "map"` und `requireMapEditing` wie `editor-places.ts`.
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

/** Der Klickpunkt in Karteneinheiten; beide oder keiner. */
const Punkt = Type.Object(
    { x: Type.Optional(Type.Number()), y: Type.Optional(Type.Number()), nur: Type.Optional(Type.Literal("flaechen")) },
    { additionalProperties: false },
);
/** Das neue Obergebiet für das Blatt der Folgen (D1); `""` heißt Wurzel. */
const NeuesObergebiet = Type.Object(
    { parent: Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Literal("")]) },
    { additionalProperties: false },
);

export const editorTerritoriesRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // „Flächen vereinigen ›“ (WI-0252): Geht es? Rein lesend, für das Untermenü im Kartenmenü.
    app.get(
        EDITOR_TERRITORIES_VEREINIGEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: FlaechenVereinigenQuery,
                response: { 200: FlaechenVereinigenPruefung, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return pruefeGebieteVereinigen(app.database!, request.query.ids.split(","));
        },
    );
    // „Flächen vereinigen ›“: die Form der Vorlage, die Flächen der übrigen von der Karte; beide Rechte, danach `territory_derive`.
    app.post(
        EDITOR_TERRITORIES_VEREINIGEN_URL,
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: FlaechenVereinigenBody, response: { 200: FlaechenVereinigenReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return vereinigeGebiete(app.database!, await actorOf(request), request.body);
        },
    );

    app.get(EDITOR_TERRITORIES_URL, { ...protect("use_editor_menu") }, async (request, reply) =>
        sendeMitEtag(request, reply, await listEditorTerritories(app.database!)),
    );

    app.get(
        `${EDITOR_TERRITORIES_URL}/:id`,
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: EditorTerritoryDetail, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const detail = await readEditorTerritory(app.database!, request.params.id);
            if (detail === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        `${EDITOR_TERRITORIES_URL}/:id/hierarchy`,
        { ...protect("use_editor_menu"), schema: { params: ById } },
        async (request, reply) => {
            const hierarchie = await readEditorTerritoryHierarchy(app.database!, request.params.id);
            if (hierarchie === undefined)
                throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            return sendeMitEtag(request, reply, hierarchie);
        },
    );

    app.get(
        editorTerritoryHistoryUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, querystring: MapHistoryQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            const [da] = await app.database!<{ da: boolean }[]>`
                SELECT EXISTS (SELECT 1 FROM territory WHERE public_id = ${request.params.id}::uuid) AS da
            `;
            if (da?.da !== true) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return territoryHistory(app.database!, request.params.id, { ...request.query, personId: session.personId });
        },
    );

    app.get(
        `${EDITOR_TERRITORIES_URL}/:id/reparent`,
        {
            ...protect("use_editor_menu"),
            schema: {
                params: ById,
                querystring: NeuesObergebiet,
                response: { 200: EditorTerritoryParentConsequences, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const folgen = await readParentConsequences(app.database!, request.params.id, request.query.parent);
            if (folgen === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return folgen;
        },
    );

    app.get(
        `${EDITOR_TERRITORIES_URL}/:id/form`,
        {
            ...protect("edit_territory_form"),
            schema: { params: ById, querystring: Punkt, response: { 200: EditorTerritoryForm, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const { x, y, nur } = request.query;
            const at = x !== undefined && y !== undefined ? { x, y } : undefined;
            const form = await readEditorTerritoryForm(
                app.database!,
                request.params.id,
                at,
                undefined,
                undefined,
                nur === "flaechen",
            );
            if (form === undefined) throw new ApiError(404, "not_found", "Dieses Herrschaftsgebiet gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return form;
        },
    );

    app.get(
        EDITOR_TERRITORY_FINDINGS_URL,
        // Wie die Liste ohne Antwortschema: mitEtag schickt den fertigen Text (Vertrag EditorTerritoryFindings, im Test geprüft).
        { ...protect("use_editor_menu") },
        async (request, reply) => sendeMitEtag(request, reply, await readTerritoryFindings(app.database!)),
    );

    app.patch(
        editorTerritoryUrl(":id"),
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: TerritoryUpdateBody,
                response: { 200: TerritoryUpdateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            // Die Form ist Geometrie: Dafür braucht es auch `edit_map_geometry` (WI-0209 B2; der eigene Schreibweg der Form entfiel).
            // Dasselbe gilt für das Obergebiet: Die Hierarchie zählt zur Form (WI-0279, E2a).
            if ((request.body.areas ?? []).length > 0 || request.body.changes?.parent !== undefined)
                demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return updateTerritory(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // „Entfernen“ (D3): die Flächen oder das Gebiet gehen weich; beides ist Geometrie der Karte und braucht beide Rechte.
    app.post(
        editorTerritoryRetireUrl(":id"),
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: TerritoryRetireBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return retireTerritory(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // „Unter neues Obergebiet …“ (T57, A): ein Gebiet ohne Fläche und das Umhängen der gewählten, EINE Operation.
    app.post(
        EDITOR_TERRITORY_OBERGEBIET_URL,
        {
            ...protect("edit_territory_form", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: TerritoryObergebietBody, response: { 200: TerritoryObergebietReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => createParentTerritory(app.database!, await actorOf(request), request.body),
    );

    // „Entfernen …“ der Mehrfachauswahl (T57): EINE Operation für alle gewählten, Rechte wie oben.
    app.post(
        EDITOR_TERRITORY_SAMMEL_RETIRE_URL,
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: TerritorySammelRetireBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return retireTerritories(app.database!, await actorOf(request), request.body);
        },
    );

    app.post(
        editorTerritoryRestoreUrl(":id"),
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: TerritoryRestoreBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return restoreTerritory(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    // Gebiete zurücknehmen (WI-0265 B6b, Fachvertrag C.2): die Vorprüfung liest nur (wie die der Orte und Gebirge steht sie unter der Kartensperre), die Rücknahme schreibt EINE Operation mit der Quelle
    // restore. Das Recht der Vorwärtsoperation (Felder und Darstellung: edit_map_objects; Entfernen, Obergebiet anlegen, Vereinigen: zusätzlich edit_map_geometry, im gemeinsamen Ablauf je Art);
    // bei einer fremden Person Pflichtgrund.
    app.post(
        editorTerritoryRestoreSeriesPreviewUrl(":id"),
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
            return vorschauGebiet(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorTerritoryRestoreSeriesUrl(":id"),
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenGebiet(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    // „Neue Fläche“ (C3): Ziele im Kasten, ein neues Gebiet, eine Grenze an einem Gebiet ohne Fläche; beides ist Geometrie der Karte.
    app.get(
        EDITOR_TERRITORY_TARGETS_URL,
        {
            ...protect("edit_territory_form"),
            schema: { querystring: TerritoryTargetsQuery, response: { 200: EditorTerritoryTargets, ...ADMIN_ERRORS } },
        },
        async (request) => readTerritoryTargets(app.database!, request.query),
    );

    app.post(
        EDITOR_TERRITORIES_URL,
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: TerritoryCreateBody, response: { 200: TerritoryCreateReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return createTerritory(app.database!, await actorOf(request), request.body);
        },
    );

    app.post(
        editorTerritoryAreasUrl(":id"),
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: TerritoryAreaCreateBody,
                response: { 200: TerritoryAreaCreateReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return createTerritoryArea(app.database!, await actorOf(request), request.params.id, request.body);
        },
    );

    app.post(
        EDITOR_TERRITORY_DISPLAY_URL,
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: TerritoryDisplayBody, response: { 200: TerritoryDisplayReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Die Zoombänder zählen zur Form (WI-0279, E1); die Farbe bleibt Eigenschaft.
            if (request.body.territories.some((gebiet) => gebiet.zoom !== undefined))
                demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return changeTerritoryDisplay(app.database!, await actorOf(request), request.body);
        },
    );

    app.post(
        EDITOR_TERRITORY_SAMMEL_URL,
        {
            ...protect("edit_territories", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: TerritorySammelBody, response: { 200: TerritoryDisplayReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Obergebiet und Zoombänder der Mehrfachauswahl sind Form, wie am einzelnen Gebiet (WI-0279).
            if (request.body.changes?.parent !== undefined || request.body.zoom !== undefined)
                demand(await adminSession(request), "edit_territory_form", app.authConfig);
            return changeTerritoriesTogether(app.database!, await actorOf(request), request.body);
        },
    );

    // Liest nur (POST wegen der Länge der Kennungen): der Stand der Mehrfachauswahl. Klasse wie die Sperren des Editors (`account`):
    // Lesen hängt an keiner Sperre.
    app.post(
        EDITOR_TERRITORY_SAMMEL_STAND_URL,
        {
            ...protect("use_editor_menu", { writeClass: "account" }),
            schema: { body: TerritorySammelStandBody, response: { 200: EditorTerritorySammelStand, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return readTerritorySammelStand(app.database!, request.body.ids);
        },
    );
};
