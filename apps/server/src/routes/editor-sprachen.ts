import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    EDITOR_SPRACHEN_ARTIKEL_URL,
    EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL,
    EDITOR_SPRACHEN_URL,
    MapHistoryPage,
    MapHistoryQuery,
    OperationReceipt,
    PinselErgebnis,
    PinselStrich,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    SpracheAendernBody,
    SpracheAngelegt,
    SpracheAnlegenBody,
    SpracheAusLandschaftBody,
    SpracheEditorArtikelAnfrage,
    SpracheEditorArtikelListe,
    SpracheEditorDetail,
    SpracheEditorDetailAnfrage,
    SpracheEditorFlaecheForm,
    SpracheEditorListe,
    SpracheEditorListeAnfrage,
    SpracheFlaecheAngelegt,
    SpracheFlaecheAnlegenBody,
    SpracheFlaecheBooleanBody,
    SpracheFlaecheBooleanVorschau,
    SpracheFlaecheBooleanVorschauBody,
    SpracheFlaecheKopierenBody,
    SpracheFlaecheNeuQuittung,
    SpracheFlaecheSchneidenBody,
    SpracheFlaecheTeileBody,
    SpracheFlaecheTeileQuittung,
    SpracheFlaecheUmformenBody,
    SpracheStandBody,
    SpracheTrefferAuftrag,
    SpracheWikiBody,
    UUID_PATTERN,
    rechteVon,
    editorSpracheAendernUrl,
    editorSpracheFlaecheBooleanUrl,
    editorSpracheFlaecheBooleanVorschauUrl,
    editorSpracheFlaecheKopierenUrl,
    editorSpracheFlaecheSchneidenUrl,
    editorSpracheFlaecheTeileUrl,
    editorSpracheFlaechePinselUrl,
    editorSpracheFlaecheStilllegenUrl,
    editorSpracheFlaecheUmformenUrl,
    editorSpracheFlaecheUrl,
    editorSpracheFlaecheZurueckholenUrl,
    editorSpracheFlaechenUrl,
    editorSpracheRestoreSeriesPreviewUrl,
    editorSpracheRestoreSeriesUrl,
    editorSpracheStilllegenUrl,
    editorSpracheTrefferUrl,
    editorSpracheUrl,
    editorSpracheVerlaufUrl,
    editorSpracheWikiUrl,
    editorSpracheZurueckholenUrl,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { protect } from "../auth/plugin.ts";
import { spracheHistory } from "../editor/history.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { ruecknehmenSprache, vorschauSprache } from "../editor/ruecknahme-sprache.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { ApiError } from "../http/api-error.ts";
import { sendeMitEtag } from "../http/json-mit-etag.ts";
import { rechteHier } from "../kanal/schalter.ts";
import {
    formeSprachflaecheUm,
    legeSprachflaecheAn,
    maleSprachStrich,
    setzeSprachflaecheStand,
} from "../sprachen/editor-flaechen.ts";
import {
    kopiereAusLandschaft,
    kopiereSprachflaeche,
    schneideSprachflaeche,
    teileSprachflaeche,
    verknuepfeSprachflaeche,
    vorschauSprachflaechen,
} from "../sprachen/editor-flaechen-werkzeuge.ts";
import {
    leseSprachEditorDetail,
    leseSprachEditorListe,
    leseSprachflaecheForm,
    sucheSprachArtikel,
} from "../sprachen/editor-lesen.ts";
import { SPRACHEN_DOMAENE, leseSpracheZeile } from "../sprachen/editor-naht.ts";
import { aendereSprache, legeSpracheAn, setzeSpracheStand, setzeSpracheWiki } from "../sprachen/editor-schreiben.ts";
import { sprachTrefferNeuRechnenLassen } from "../sprachen/treffer-auftrag.ts";

/**
 * Die Routen des Spracheditors (WI-0261 S5d; Inhalte › Auf der Karte › Sprachen). Vertrag, Rechte und Regeln im Kopf von
 * `packages/shared/src/sprachen-editor.ts`; Lesen `sprachen/editor-lesen.ts`, Schreiben `sprachen/editor-schreiben.ts` und `sprachen/editor-flaechen.ts`.
 *
 * - Lesen (Liste, Sprache, Form einer Teilfläche, Verlauf, Artikelsuche): `use_editor_menu`, wie alle Fenster des Editorpanels; die Liste mit schwachem
 *   ETag (304), die übrigen `private, no-cache`.
 * - 🔴 Schreiben: `edit_languages` (ab Admin und über die Sonderrolle Linguist; WI-0279 E17a, Betreiber 2026-11-08; bis dahin `manage_sources` wie die übrigen
 *   Inhalte, O6), Klasse `map` (423 `map_locked`) und der Schalter `MAP_EDITING` (423 `map_editing_off`), beide vor
 *   dem Handler; die Sperre gegen den laufenden Zug sitzt in der Schreibnaht (503 `map_import_running`), die Sperre der Sprache im Schreibweg (409
 *   `lock_required`, `object_locked`).
 * - „↻ Jetzt neu berechnen“ (`…/treffer`) reiht nur den Auftrag `sprache_treffer` für die Sprache ein (oder legt sie zum wartenden); es ändert keinen
 *   Fachbestand und braucht deshalb keine Sperre und kein Protokoll.
 * - Der Pinselstrich (`…/flaechen/:flaeche/brush`, WI-0261 Stufe 2) rechnet nur; geschützt wie das Umformen, dem er zuarbeitet (Recht, Klasse `map`,
 *   Schalter), aber ohne Sperre und ohne Protokoll, wie an der Landschaft.
 * - Die Rücknahme (`…/restore-series[/preview]`, WI-0265 B6e) nimmt alles zurück, was der Verlauf der Sprache zeigt und der Server kennt (`editor/ruecknahme-sprache.ts`): Felder, Wiki-Artikel,
 *   Stilllegen und Zurückholen, Form und Werkzeuge an Teilflächen, auch das Kopieren in eine neue Sprache. Die Vorprüfung liest nur (Recht der Vorwärtsoperation, `edit_languages`, im
 *   gemeinsamen Ablauf; wie die Vorschau der Flächenwerkzeuge unter der Kartensperre), die Rücknahme schreibt EINE Operation und verlangt, anders als die Vorwärtswege, nicht die eigene Sperre
 *   der Sprache, nur dass kein anderer sie (oder die einer anderen berührten Sprache) hält.
 * - Die Werkzeuge der Stufe 3 (`…/flaechen/:flaeche/parts`, `split`, `boolean`, `copy`; `sprachen/editor-flaechen-werkzeuge.ts`) schreiben wie das Umformen;
 *   die Vorschau von „Mit anderer Fläche“ (`boolean-preview`) rechnet nur, geschützt wie der Pinselstrich.
 */

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });
const ByFlaeche = Type.Object(
    { id: Type.String({ pattern: UUID_PATTERN }), flaeche: Type.String({ pattern: UUID_PATTERN }) },
    { additionalProperties: false },
);

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

/** Schreiben: das Recht am Sprachmodul (`edit_languages`), Klasse `map`, Schalter `MAP_EDITING`. */
const SCHREIBEN = { ...protect("edit_languages", { writeClass: "map" }), preHandler: requireMapEditing } as const;

export const editorSprachenRoutes: FastifyPluginAsyncTypebox = async (app) => {
    app.get(
        EDITOR_SPRACHEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: SpracheEditorListeAnfrage,
                response: { 200: SpracheEditorListe, 304: Type.Null(), ...ADMIN_ERRORS },
            },
        },
        async (request, reply) =>
            sendeMitEtag(request, reply, await leseSprachEditorListe(app.database!, request.query)),
    );

    app.get(
        EDITOR_SPRACHEN_ARTIKEL_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: SpracheEditorArtikelAnfrage,
                response: { 200: SpracheEditorArtikelListe, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return sucheSprachArtikel(app.database!, request.query);
        },
    );

    app.get(
        editorSpracheUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: {
                params: ById,
                querystring: SpracheEditorDetailAnfrage,
                response: { 200: SpracheEditorDetail, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const detail = await leseSprachEditorDetail(app.database!, request.params.id, request.query.run);
            if (detail === undefined) throw new ApiError(404, "not_found", "Diese Sprache gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return detail;
        },
    );

    app.get(
        editorSpracheFlaecheUrl(":id", ":flaeche"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ByFlaeche, response: { 200: SpracheEditorFlaecheForm, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const form = await leseSprachflaecheForm(app.database!, request.params.id, request.params.flaeche);
            if (form === undefined)
                throw new ApiError(404, "not_found", "Diese Teilfläche gibt es an dieser Sprache nicht.");
            void reply.header("cache-control", "private, no-cache");
            return form;
        },
    );

    app.get(
        editorSpracheVerlaufUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, querystring: MapHistoryQuery, response: { 200: MapHistoryPage, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const session = await adminSession(request);
            if ((await leseSpracheZeile(app.database!, request.params.id)) === undefined)
                throw new ApiError(404, "not_found", "Diese Sprache gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return spracheHistory(app.database!, request.params.id, { ...request.query, personId: session.personId });
        },
    );

    app.post(
        EDITOR_SPRACHEN_URL,
        { ...SCHREIBEN, schema: { body: SpracheAnlegenBody, response: { 200: SpracheAngelegt, ...ADMIN_ERRORS } } },
        async (request) => legeSpracheAn(app.database!, await actorOf(request), request.body),
    );

    // Eine Fläche der Derographie in eine Sprache (WI-0261, Betreiber 2026-10-31: „Ja, bauen“): EINE Operation, geschützt wie das Kopieren einer Teilfläche.
    app.post(
        EDITOR_SPRACHEN_AUS_LANDSCHAFT_URL,
        {
            ...SCHREIBEN,
            schema: { body: SpracheAusLandschaftBody, response: { 200: SpracheFlaecheNeuQuittung, ...ADMIN_ERRORS } },
        },
        async (request) => kopiereAusLandschaft(app.database!, await actorOf(request), request.body),
    );

    app.post(
        editorSpracheAendernUrl(":id"),
        {
            ...SCHREIBEN,
            schema: { params: ById, body: SpracheAendernBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => aendereSprache(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        editorSpracheWikiUrl(":id"),
        {
            ...SCHREIBEN,
            schema: { params: ById, body: SpracheWikiBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
        },
        async (request) => setzeSpracheWiki(app.database!, await actorOf(request), request.params.id, request.body),
    );

    for (const [url, wechsel] of [
        [editorSpracheStilllegenUrl, "sprache.retire"],
        [editorSpracheZurueckholenUrl, "sprache.restore"],
    ] as const)
        app.post(
            url(":id"),
            {
                ...SCHREIBEN,
                schema: { params: ById, body: SpracheStandBody, response: { 200: OperationReceipt, ...ADMIN_ERRORS } },
            },
            async (request) =>
                setzeSpracheStand(app.database!, await actorOf(request), request.params.id, request.body, wechsel),
        );

    // Die Rücknahme (WI-0265 B6e, Fachvertrag C.2): die Vorprüfung liest nur, die Rücknahme schreibt EINE Operation mit der Quelle restore und stößt die Ableitung einmal an. Das Recht der
    // Vorwärtsoperation (`edit_languages`) prüft der gemeinsame Ablauf; bei einer fremden Person Pflichtgrund.
    app.post(
        editorSpracheRestoreSeriesPreviewUrl(":id"),
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
            return vorschauSprache(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorSpracheRestoreSeriesUrl(":id"),
        {
            ...SCHREIBEN,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenSprache(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    app.post(
        editorSpracheTrefferUrl(":id"),
        { ...SCHREIBEN, schema: { params: ById, response: { 200: SpracheTrefferAuftrag, ...ADMIN_ERRORS } } },
        async (request) => {
            const actor = await actorOf(request);
            if ((await leseSpracheZeile(app.database!, request.params.id)) === undefined)
                throw new ApiError(404, "not_found", "Diese Sprache gibt es nicht.");
            const personId = actor.kind === "person" ? actor.personId : "";
            const jobId = await sprachTrefferNeuRechnenLassen(app.database!, personId, SPRACHEN_DOMAENE, [
                request.params.id,
            ]);
            return { jobId };
        },
    );

    app.post(
        editorSpracheFlaechenUrl(":id"),
        {
            ...SCHREIBEN,
            schema: {
                params: ById,
                body: SpracheFlaecheAnlegenBody,
                response: { 200: SpracheFlaecheAngelegt, ...ADMIN_ERRORS },
            },
        },
        async (request) => legeSprachflaecheAn(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        editorSpracheFlaecheUmformenUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheUmformenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            formeSprachflaecheUm(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.flaeche,
                request.body,
            ),
    );

    app.post(
        editorSpracheFlaechePinselUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: { params: ByFlaeche, body: PinselStrich, response: { 200: PinselErgebnis, ...ADMIN_ERRORS } },
        },
        async (request) => maleSprachStrich(app.database!, request.params.id, request.params.flaeche, request.body),
    );

    // Die Werkzeuge der Stufe 3 (WI-0261): je EINE Operation, sofort geschrieben; die Vorschau rechnet nur.
    app.post(
        editorSpracheFlaecheTeileUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheTeileBody,
                response: { 200: SpracheFlaecheTeileQuittung, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            teileSprachflaeche(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.flaeche,
                request.body,
            ),
    );

    app.post(
        editorSpracheFlaecheSchneidenUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheSchneidenBody,
                response: { 200: SpracheFlaecheNeuQuittung, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            schneideSprachflaeche(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.flaeche,
                request.body,
            ),
    );

    app.post(
        editorSpracheFlaecheBooleanVorschauUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheBooleanVorschauBody,
                response: { 200: SpracheFlaecheBooleanVorschau, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            vorschauSprachflaechen(app.database!, request.params.id, request.params.flaeche, request.body),
    );

    app.post(
        editorSpracheFlaecheBooleanUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheBooleanBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            verknuepfeSprachflaeche(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.flaeche,
                request.body,
            ),
    );

    app.post(
        editorSpracheFlaecheKopierenUrl(":id", ":flaeche"),
        {
            ...SCHREIBEN,
            schema: {
                params: ByFlaeche,
                body: SpracheFlaecheKopierenBody,
                response: { 200: SpracheFlaecheNeuQuittung, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            kopiereSprachflaeche(
                app.database!,
                await actorOf(request),
                request.params.id,
                request.params.flaeche,
                request.body,
            ),
    );

    for (const [url, wechsel] of [
        [editorSpracheFlaecheStilllegenUrl, "sprache_flaeche.retire"],
        [editorSpracheFlaecheZurueckholenUrl, "sprache_flaeche.restore"],
    ] as const)
        app.post(
            url(":id", ":flaeche"),
            {
                ...SCHREIBEN,
                schema: {
                    params: ByFlaeche,
                    body: SpracheStandBody,
                    response: { 200: OperationReceipt, ...ADMIN_ERRORS },
                },
            },
            async (request) =>
                setzeSprachflaecheStand(
                    app.database!,
                    await actorOf(request),
                    request.params.id,
                    request.params.flaeche,
                    request.body,
                    wechsel,
                ),
        );
};
