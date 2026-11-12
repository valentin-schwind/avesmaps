import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
    ApiErrorBody,
    INHALTE_KORPORA_URL,
    INHALTE_LITERATUR_URL,
    INHALTE_VORKOMMEN_FLAECHEN_URL,
    INHALTE_VORKOMMEN_ORTE_URL,
    INHALTE_VORKOMMEN_UMRISS_URL,
    INHALTE_VORKOMMEN_URL,
    INHALTE_VORKOMMEN_ZIELE_URL,
    INHALTE_QUELLEN_ADRESSE_URL,
    INHALTE_QUELLEN_URL,
    INHALTE_REGELTEXT_PRUEFEN_URL,
    INHALTE_REGELTEXT_UEBERNEHMEN_URL,
    INHALTE_ZIELE_URL,
    InhalteAdressAnfrage,
    InhalteAdressAuskunft,
    InhalteKorporaAnfrage,
    InhalteKorporaListe,
    InhalteKorpusAendernBody,
    InhalteKorpusAngelegt,
    InhalteKorpusAnlegenBody,
    InhalteKorpusEintrag,
    InhalteKorpusWirkung,
    InhalteKorpusWirkungBody,
    InhalteWerk,
    InhalteWerkAendernBody,
    InhalteWerkAngelegt,
    InhalteWerkAnlegenBody,
    InhalteWerkListe,
    InhalteWerkeAnfrage,
    InhalteVorkommen,
    InhalteVorkommenAendernBody,
    InhalteVorkommenAngelegt,
    InhalteVorkommenAnfrage,
    InhalteVorkommenAnlegenBody,
    InhalteVorkommenFlaechen,
    InhalteVorkommenFlaechenAnfrage,
    InhalteVorkommenLageOrte,
    InhalteVorkommenLageOrteAnfrage,
    InhalteVorkommenListe,
    InhalteVorkommenUmriss,
    InhalteVorkommenZieleAnfrage,
    InhalteVorkommenZiele,
    InhalteRegelTextAlsText,
    InhalteRegelTextErgebnis,
    InhalteRegelTextPruefenBody,
    InhalteRegelTextUebernehmenBody,
    InhalteRegelTextUebernommen,
    InhalteQuelle,
    InhalteQuelleAendernBody,
    InhalteQuelleAngelegt,
    InhalteQuelleAnlegenBody,
    InhalteQuellenAnfrage,
    InhalteQuellenListe,
    InhalteTraegerQuellen,
    InhalteTraegerQuellenBody,
    InhalteTraegerQuellenParams,
    InhalteZieleAnfrage,
    InhalteZiele,
    OperationReceipt,
    RuecknahmeBody,
    RuecknahmePruefung,
    RuecknahmeReceipt,
    RuecknahmeVorschauBody,
    UUID_PATTERN,
    rechteVon,
    editorKorpusRestoreSeriesPreviewUrl,
    editorKorpusRestoreSeriesUrl,
    editorQuelleRestoreSeriesPreviewUrl,
    editorQuelleRestoreSeriesUrl,
    editorVorkommenRestoreSeriesPreviewUrl,
    editorVorkommenRestoreSeriesUrl,
    editorWerkRestoreSeriesPreviewUrl,
    editorWerkRestoreSeriesUrl,
    inhalteKorpusAendernUrl,
    inhalteKorpusUrl,
    inhalteKorpusWirkungUrl,
    inhalteQuelleAendernUrl,
    inhalteQuelleUrl,
    inhalteTraegerQuellenUrl,
    inhalteVorkommenAlsTextUrl,
    inhalteWerkAendernUrl,
    inhalteVorkommenAendernUrl,
    inhalteVorkommenUrl,
    inhalteWerkUrl,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import type { AuthConfig } from "../auth/config.ts";
import { protect } from "../auth/plugin.ts";
import { requireMapEditing } from "../editor/map-editing.ts";
import type { MapActor } from "../editor/map-operation.ts";
import { ruecknehmenKorpus, vorschauKorpus } from "../editor/ruecknahme-korpus.ts";
import { ruecknehmenQuelle, vorschauQuelle } from "../editor/ruecknahme-quelle.ts";
import { ruecknehmenVorkommen, vorschauVorkommen } from "../editor/ruecknahme-vorkommen.ts";
import { ruecknehmenWerk, vorschauWerk } from "../editor/ruecknahme-werk.ts";
import type { RuecknahmeLeser } from "../editor/ruecknahme.ts";
import { ApiError } from "../http/api-error.ts";
import { leseQuelle, listeQuellen, sucheZiele } from "../inhalte/quellen-lesen.ts";
import { leseKorpus, listeKorpora } from "../inhalte/korpora-lesen.ts";
import { aendereKorpus, legeKorpusAn, pruefeWirkung } from "../inhalte/korpora-schreiben.ts";
import { adressAuskunft } from "../inhalte/quellen-adresse.ts";
import { aendereQuelle, legeQuelleAn } from "../inhalte/quellen-schreiben.ts";
import { leseTraegerQuellen } from "../inhalte/traeger-quellen-lesen.ts";
import { aendereTraegerQuellen } from "../inhalte/traeger-quellen-schreiben.ts";
import { leseWerk, listeWerke } from "../inhalte/werke-lesen.ts";
import { leseRegelTextAlsText, pruefeRegelText } from "../inhalte/regeln-text/lesen.ts";
import { uebernehmeRegelText } from "../inhalte/regeln-text/schreiben.ts";
import { aendereVorkommen, legeVorkommenAn } from "../inhalte/vorkommen-schreiben.ts";
import { leseVorkommen, listeVorkommen, sucheVorkommenZiele } from "../inhalte/vorkommen-lesen.ts";
import { leseUmriss, sucheVorkommenFlaechen, sucheVorkommenOrte } from "../inhalte/vorkommen-regeln-lesen.ts";
import { aendereWerk, legeWerkAn } from "../inhalte/werke-schreiben.ts";
import { rechteHier } from "../kanal/schalter.ts";
import { createRateLimiter } from "../share/rate-limiter.ts";
import { etagMatches } from "../media/delivery.ts";

/**
 * Die Routen des Fensters „Inhalte bearbeiten“, Reiter „Quellen“ und „Literatur“ (WI-0254); Vertrag und Regeln in
 * `packages/shared/src/inhalte-quellen.ts` und `packages/shared/src/inhalte-literatur.ts`.
 *
 * - `GET /api/editor/inhalte/quellen` · `GET /api/editor/inhalte/quellen/:id` · `GET /api/editor/inhalte/ziele`: `use_editor_menu`
 *   (Reviewer lesen, wie alle Fenster des Editorpanels).
 * - `POST /api/editor/inhalte/quellen` (`source.create`) und `POST /api/editor/inhalte/quellen/:id/update` (`source.update`):
 *   `manage_sources` (Editor, Stufe R). Die Oberfläche fragt dieses Recht nicht selbst ab; der Server prüft es an jeder Route.
 * - `GET /api/editor/inhalte/quellen/adresse` (die Auskunft zu einem Link, WI-0277): `manage_sources`, denn nur wer anlegen darf, lässt den Server eine fremde Seite abrufen; 30 Abrufe je Person und Minute (429).
 * - `GET /api/editor/inhalte/vorkommen`, `…/:id`, `…/vorkommen-ziele` und `…/vorkommen-flaechen` (Flächen für die Bedingung einer Regel, Regeleditor): `use_editor_menu`; ebenso `…/vorkommen-orte` (Siedlungen für
 *   die Lage zu einer Linie) und `…/vorkommen-umriss` (der Umriss Aventuriens für ihre Skizze, mit `ETag` und `private, max-age=3600`); `POST …/vorkommen` (`lore.create`, ein Eintrag OHNE Wiki-Artikel,
 *   Vali wählte B am Gate WI-0254 §10) und `POST …/vorkommen/:id/update` (`lore.update`, auch die Regeln des Eintrags): `manage_sources`, Klasse `map`, `requireMapEditing`.
 * - „Regeln als Text“ (WI-0254 §13 und §14, Vertrag `packages/shared/src/inhalte-regeln-text.ts`): `POST …/vorkommen-text/pruefen` (`use_editor_menu`, nur lesend, Klasse `map` wie eine Vorschau), `POST …/vorkommen-text/uebernehmen`
 *   (`lore.rules_text`, EINE Operation über alle Einträge des Texts: `manage_sources`, Klasse `map`, `requireMapEditing`) und `GET …/vorkommen/:id/als-text` (der Rückweg, `use_editor_menu`).
 * - `GET /api/editor/inhalte/traeger/:kind/:id/quellen` (die Quellen eines Orts, Gebiets, einer Landschaft, eines Gipfels oder einer Landmarke oder der Straße eines Wegs, mit dem Zitat des Wikis): `use_editor_menu`;
 *   `POST` auf dieselbe Adresse (`traeger.sources`, Ort, Gebiet, Landschaft, Gipfel und die ganze Straße eines Wegs; `:id` ist dort irgendein Abschnitt): `manage_sources`, Klasse `map`, `requireMapEditing`. Die Klappbox der Karteneditoren
 *   (WI-0254 §12); Vertrag in `packages/shared/src/inhalte-traeger-quellen.ts`.
 * - `GET /api/editor/inhalte/korpora` und `…/:id`: `use_editor_menu`; `POST …/korpora` (`corpus.create`), `POST …/korpora/:id/wirkung` („Wirkung prüfen“, nur rechnen) und
 *   `POST …/korpora/:id/update` (`corpus.update`): `manage_sources`, Klasse `map`, `requireMapEditing`; das Durchschreiben auf die Quellen einer Belegstelle ist EINE
 *   Operation (WI-0254 §5, Vali: „überall“).
 * - `GET /api/editor/inhalte/literatur` und `…/:id`: `use_editor_menu`; `POST …/literatur` (`work.create`) und `POST …/literatur/:id/update`
 *   (`work.update`): `manage_sources`, Klasse `map`, `requireMapEditing`, dieselbe Naht wie die Quellen.
 *
 * - Die Rücknahme (WI-0265 B6g1; Fachvertrag `project-control/planning/aenderungen-arbeitsserien-fachvertrag.md` C.2): `POST …/quellen/:id/restore-series`, `…/literatur/:id/restore-series` und
 *   `…/korpora/:id/restore-series` (je mit `/preview`) nehmen die Felder einer Quelle, die Felder und die Ortsliste eines Werks und die Angaben eines Korpus samt der Wirkung auf seine Quellen
 *   zurück, auch als Serie (`editor/ruecknahme-quelle.ts`, `-werk.ts`, `-korpus.ts`). Die Vorprüfung liest nur (`use_editor_menu`, Klasse `map` wie jede Vorschau); die Rücknahme schreibt EINE
 *   Operation (`manage_sources`, Klasse `map`, `requireMapEditing`) über dieselbe Naht wie das Original, ohne Ableitung und ohne Ereignis. Die Verwendungen einer Quelle an Trägern
 *   und die Quellen am Träger folgen mit B6g3.
 * - Dasselbe am Vorkommen (WI-0265 B6g2): `POST …/vorkommen/:id/restore-series` (mit `/preview`) nimmt die Felder, Ortszeilen, Quellenverknüpfungen und Regeln eines Eintrags (`lore.update`) und die
 *   Regeln und Quellen aus „Regeln als Text“ (`lore.rules_text`, EINE Operation über mehrere Einträge: `:id` ist einer davon) zurück, auch als Serie (`editor/ruecknahme-vorkommen.ts`); seit WI-0265 B8d
 *   auch `lore.create` und ein Eintrag, den „Regeln als Text“ anlegte (zurück heißt stillgelegt). Dasselbe gilt für `source.create`, `work.create` und `corpus.create`. Recht, Klasse und Naht wie bei der Quelle.
 *
 * 🔴 Wie bei jedem Schreibweg der Karte: Klasse `map` (423 `map_locked`, SYS-4) und der Schalter `MAP_EDITING` (423 `map_editing_off`),
 * beide vor dem Handler; die Sperre gegen den laufenden Zug sitzt in der Schreibnaht (503 `map_import_running`). Eine Quelle wirkt auf
 * Infopanel und Kanon-Etikett aller ihrer Träger; das ist Inhalt der Karte, nicht der Verwaltung.
 */

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

/** Wie viele Links eine Person je Minute prüfen lassen kann: Ein Mensch fügt keine dreißig ein. */
const ADRESSEN_JE_MINUTE = 30;

async function actorOf(request: FastifyRequest): Promise<MapActor> {
    const session = await adminSession(request);
    return { kind: "person", personId: session.personId, environment: session.environment };
}

/** Wer fragt, für die Vorprüfung einer Rücknahme: die Person der Sitzung und ihre Rechte hier (wie `demand`). */
const leserVon = (session: Awaited<ReturnType<typeof adminSession>>, kanal: AuthConfig["kanal"]): RuecknahmeLeser => ({
    personId: session.personId,
    rechte: rechteHier(rechteVon(session), kanal),
});

export const editorInhalteRoutes: FastifyPluginAsyncTypebox = async (app) => {
    const adressDrossel = createRateLimiter(ADRESSEN_JE_MINUTE, 60_000);

    app.get(
        INHALTE_QUELLEN_ADRESSE_URL,
        {
            ...protect("manage_sources"),
            schema: {
                querystring: InhalteAdressAnfrage,
                response: { 200: InhalteAdressAuskunft, 429: ApiErrorBody, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const { personId } = await adminSession(request);
            if (!adressDrossel.allows(personId)) {
                throw new ApiError(429, "rate_limited", "Zu viele Adressen auf einmal. Gleich noch einmal versuchen.");
            }
            adressDrossel.record(personId);
            void reply.header("cache-control", "private, no-store");
            return adressAuskunft(app.database!, request.query.url);
        },
    );

    app.get(
        INHALTE_QUELLEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: InhalteQuellenAnfrage, response: { 200: InhalteQuellenListe, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return listeQuellen(app.database!, request.query);
        },
    );

    app.get(
        INHALTE_ZIELE_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: InhalteZieleAnfrage, response: { 200: InhalteZiele, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return sucheZiele(app.database!, request.query.q, request.query.limit ?? 8, request.query.wege === true);
        },
    );

    app.get(
        inhalteQuelleUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: InhalteQuelle, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const quelle = await leseQuelle(app.database!, request.params.id);
            if (quelle === undefined) throw new ApiError(404, "not_found", "Diese Quelle gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return quelle;
        },
    );

    app.post(
        INHALTE_QUELLEN_URL,
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: InhalteQuelleAnlegenBody, response: { 200: InhalteQuelleAngelegt, ...ADMIN_ERRORS } },
        },
        async (request) => legeQuelleAn(app.database!, await actorOf(request), request.body),
    );

    app.post(
        inhalteQuelleAendernUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: InhalteQuelleAendernBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => aendereQuelle(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Quellen zurücknehmen (WI-0265 B6g1, Fachvertrag C.2): die Vorprüfung liest nur (wie jede Vorschau unter der Kartensperre), die Rücknahme schreibt EINE Operation mit der Quelle restore. Das Recht der Vorwärtsoperation (manage_sources) prüft der gemeinsame Ablauf; bei einer fremden Person Pflichtgrund.
    app.post(
        editorQuelleRestoreSeriesPreviewUrl(":id"),
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
            return vorschauQuelle(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorQuelleRestoreSeriesUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenQuelle(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    // Vorkommen zurücknehmen (WI-0265 B6g2, Fachvertrag C.2): Felder, Ortszeilen, Quellenverknüpfungen und Regeln eines Eintrags, auch als Serie, und die Regeln aus „Regeln als Text“; dieselben Regeln wie bei den Quellen.
    app.post(
        editorVorkommenRestoreSeriesPreviewUrl(":id"),
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
            return vorschauVorkommen(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorVorkommenRestoreSeriesUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenVorkommen(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    app.get(
        inhalteTraegerQuellenUrl(":kind", ":id"),
        {
            ...protect("use_editor_menu"),
            schema: {
                params: InhalteTraegerQuellenParams,
                response: { 200: InhalteTraegerQuellen, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            const quellen = await leseTraegerQuellen(app.database!, request.params.kind, request.params.id);
            if (quellen === undefined) throw new ApiError(404, "not_found", "Dieses Objekt gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return quellen;
        },
    );

    app.post(
        inhalteTraegerQuellenUrl(":kind", ":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: InhalteTraegerQuellenParams,
                body: InhalteTraegerQuellenBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) =>
            aendereTraegerQuellen(
                app.database!,
                await actorOf(request),
                request.params.kind,
                request.params.id,
                request.body,
            ),
    );

    app.get(
        INHALTE_LITERATUR_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: InhalteWerkeAnfrage, response: { 200: InhalteWerkListe, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return listeWerke(app.database!, request.query);
        },
    );

    app.get(
        inhalteWerkUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: InhalteWerk, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const werk = await leseWerk(app.database!, request.params.id);
            if (werk === undefined) throw new ApiError(404, "not_found", "Dieses Werk gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return werk;
        },
    );

    app.post(
        INHALTE_LITERATUR_URL,
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: InhalteWerkAnlegenBody, response: { 200: InhalteWerkAngelegt, ...ADMIN_ERRORS } },
        },
        async (request) => legeWerkAn(app.database!, await actorOf(request), request.body),
    );

    app.post(
        inhalteWerkAendernUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: InhalteWerkAendernBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => aendereWerk(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Werke zurücknehmen (WI-0265 B6g1): Felder und Ortsliste, auch als Serie; dieselben Regeln wie bei den Quellen.
    app.post(
        editorWerkRestoreSeriesPreviewUrl(":id"),
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
            return vorschauWerk(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorWerkRestoreSeriesUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenWerk(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );

    app.get(
        INHALTE_VORKOMMEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: InhalteVorkommenAnfrage, response: { 200: InhalteVorkommenListe, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return listeVorkommen(app.database!, request.query);
        },
    );

    app.get(
        INHALTE_VORKOMMEN_ZIELE_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: InhalteVorkommenZieleAnfrage,
                response: { 200: InhalteVorkommenZiele, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return sucheVorkommenZiele(app.database!, request.query.q, request.query.limit ?? 8);
        },
    );

    app.get(
        INHALTE_VORKOMMEN_FLAECHEN_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: InhalteVorkommenFlaechenAnfrage,
                response: { 200: InhalteVorkommenFlaechen, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return sucheVorkommenFlaechen(app.database!, request.query.q, request.query.limit ?? 8);
        },
    );

    app.get(
        INHALTE_VORKOMMEN_ORTE_URL,
        {
            ...protect("use_editor_menu"),
            schema: {
                querystring: InhalteVorkommenLageOrteAnfrage,
                response: { 200: InhalteVorkommenLageOrte, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return sucheVorkommenOrte(app.database!, request.query.q, request.query.limit ?? 8);
        },
    );

    // Der Umriss Aventuriens ändert sich nur mit der Karte: eine Stunde im Browser, danach bedingt (ETag aus dem Stand der Region und ihrer Flächen, im Prozess zwischengespeichert).
    app.get(
        INHALTE_VORKOMMEN_UMRISS_URL,
        {
            ...protect("use_editor_menu"),
            schema: { response: { 200: InhalteVorkommenUmriss, 304: Type.Null(), ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const stand = await leseUmriss(app.database!);
            if (stand === undefined) throw new ApiError(404, "not_found", "Die Karte hat keinen Umriss Aventuriens.");
            void reply.header("cache-control", "private, max-age=3600");
            void reply.header("etag", stand.etag);
            if (etagMatches(request.headers["if-none-match"], stand.etag)) return reply.code(304).send(null);
            return stand.umriss;
        },
    );

    app.get(
        inhalteVorkommenUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: InhalteVorkommen, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const eintrag = await leseVorkommen(app.database!, request.params.id);
            if (eintrag === undefined) throw new ApiError(404, "not_found", "Diesen Eintrag gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return eintrag;
        },
    );

    // Der Rückweg „Als Text“ (WI-0254 §14): die aktiven Regeln eines Eintrags in der Wiki-Kurzschrift. Liest nur.
    app.get(
        inhalteVorkommenAlsTextUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: InhalteRegelTextAlsText, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const antwort = await leseRegelTextAlsText(app.database!, request.params.id);
            if (antwort === undefined) throw new ApiError(404, "not_found", "Diesen Eintrag gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return antwort;
        },
    );

    // „Regeln als Text“ prüfen (WI-0254 §13): liest den Text und löst ihn gegen den Katalog auf, schreibt nichts. POST wegen der Länge des Texts; Klasse `map` wie jede Vorschau der Editoren (die Kartensperre hält sie an,
    // `requireMapEditing` nicht: Prüfen schreibt nicht).
    app.post(
        INHALTE_REGELTEXT_PRUEFEN_URL,
        {
            ...protect("use_editor_menu", { writeClass: "map" }),
            schema: {
                body: InhalteRegelTextPruefenBody,
                response: { 200: InhalteRegelTextErgebnis, ...ADMIN_ERRORS },
            },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-store");
            return pruefeRegelText(app.database!, request.body);
        },
    );

    // „Regeln als Text“ übernehmen (`lore.rules_text`, WI-0254 §13): EINE Operation über alle Einträge des Texts; der Server liest ihn noch einmal und legt an, was dann „neu“ ist.
    app.post(
        INHALTE_REGELTEXT_UEBERNEHMEN_URL,
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                body: InhalteRegelTextUebernehmenBody,
                response: { 200: InhalteRegelTextUebernommen, ...ADMIN_ERRORS },
            },
        },
        async (request) => uebernehmeRegelText(app.database!, await actorOf(request), request.body),
    );

    app.post(
        INHALTE_VORKOMMEN_URL,
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: InhalteVorkommenAnlegenBody, response: { 200: InhalteVorkommenAngelegt, ...ADMIN_ERRORS } },
        },
        async (request) => legeVorkommenAn(app.database!, await actorOf(request), request.body),
    );

    app.post(
        inhalteVorkommenAendernUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: InhalteVorkommenAendernBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => aendereVorkommen(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.get(
        INHALTE_KORPORA_URL,
        {
            ...protect("use_editor_menu"),
            schema: { querystring: InhalteKorporaAnfrage, response: { 200: InhalteKorporaListe, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            void reply.header("cache-control", "private, no-cache");
            return listeKorpora(app.database!, request.query);
        },
    );

    app.get(
        inhalteKorpusUrl(":id"),
        {
            ...protect("use_editor_menu"),
            schema: { params: ById, response: { 200: InhalteKorpusEintrag, ...ADMIN_ERRORS } },
        },
        async (request, reply) => {
            const korpus = await leseKorpus(app.database!, request.params.id);
            if (korpus === undefined) throw new ApiError(404, "not_found", "Diesen Korpus gibt es nicht.");
            void reply.header("cache-control", "private, no-cache");
            return korpus;
        },
    );

    app.post(
        INHALTE_KORPORA_URL,
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { body: InhalteKorpusAnlegenBody, response: { 200: InhalteKorpusAngelegt, ...ADMIN_ERRORS } },
        },
        async (request) => legeKorpusAn(app.database!, await actorOf(request), request.body),
    );

    app.post(
        inhalteKorpusWirkungUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            schema: {
                params: ById,
                body: InhalteKorpusWirkungBody,
                response: { 200: InhalteKorpusWirkung, ...ADMIN_ERRORS },
            },
        },
        async (request) => pruefeWirkung(app.database!, request.params.id, request.body),
    );

    app.post(
        inhalteKorpusAendernUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: {
                params: ById,
                body: InhalteKorpusAendernBody,
                response: { 200: OperationReceipt, ...ADMIN_ERRORS },
            },
        },
        async (request) => aendereKorpus(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Korpora zurücknehmen (WI-0265 B6g1): Angaben und die Wirkung auf die Quellen, auch als Serie; dieselben Regeln wie bei den Quellen.
    app.post(
        editorKorpusRestoreSeriesPreviewUrl(":id"),
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
            return vorschauKorpus(
                app.database!,
                request.params.id,
                request.body,
                leserVon(await adminSession(request), app.authConfig.kanal),
            );
        },
    );
    app.post(
        editorKorpusRestoreSeriesUrl(":id"),
        {
            ...protect("manage_sources", { writeClass: "map" }),
            preHandler: requireMapEditing,
            schema: { params: ById, body: RuecknahmeBody, response: { 200: RuecknahmeReceipt, ...ADMIN_ERRORS } },
        },
        async (request) =>
            ruecknehmenKorpus(
                app.database!,
                await actorOf(request),
                leserVon(await adminSession(request), app.authConfig.kanal),
                request.params.id,
                request.body,
            ),
    );
};
