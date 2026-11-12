import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    ApiErrorBody,
    MEDIA_COAT_BIND_URL,
    MEDIA_COAT_NONE_URL,
    MEDIA_EDITOR_URL,
    MEDIA_GALLERY_ADD_URL,
    MEDIA_GALLERY_BIND_URL,
    MEDIA_GALLERY_CAPTION_URL,
    MEDIA_GALLERY_COVER_URL,
    MEDIA_GALLERY_CREATE_URL,
    MEDIA_GALLERY_ORDER_URL,
    MEDIA_GALLERY_REMOVE_URL,
    MEDIA_GALLERY_TITLE_URL,
    MEDIA_GALLERY_UNBIND_URL,
    MEDIA_GALLERY_DELETE_URL,
    MediaGalleryDeleteBody,
    MEDIA_HEADER_NONE_URL,
    MEDIA_HEADER_RELATION_URL,
    MEDIA_HEADER_SET_URL,
    MEDIA_LICENSES_URL,
    MEDIA_MERGE_ALL_URL,
    MEDIA_MERGE_PREVIEW_URL,
    MEDIA_MERGE_URL,
    MediaMergeAllBody,
    MEDIA_PHOTOBOX_URL,
    MEDIA_PUBLICATION_PREVIEW_URL,
    MEDIA_SHA256_PATTERN,
    MediaSameBytes,
    MEDIA_SLOT_SUBJECT_KINDS,
    MEDIA_TYPE_IMAGE_RELEASE_URL,
    MEDIA_TYPE_IMAGE_SET_URL,
    MEDIA_TYPE_IMAGES_ADOPT_URL,
    MEDIA_UPLOAD_BODY_LIMIT,
    MEDIA_UPLOAD_URL,
    MediaCoatBindBody,
    MediaCoatNoneBody,
    MediaCreationBody,
    MediaEvidenceBody,
    MediaGalleryAddBody,
    MediaGalleryBindBody,
    MediaGalleryCaptionBody,
    MediaGalleryCoverBody,
    MediaGalleryCreateBody,
    MediaGalleryOrderBody,
    MediaGalleryRemoveBody,
    MediaGalleryTitleBody,
    MediaHeaderNoneBody,
    MediaHeaderSetBody,
    MediaHeaderRelationBody,
    MediaLicenseCatalog,
    MediaMergeBody,
    MediaMergeLiftBody,
    MediaMergePreview,
    MediaMetadataBody,
    MediaPublicationPreview,
    MediaPublicationPreviewQuery,
    MediaRightsBody,
    MediaRightsReviewBody,
    MediaSuspendBody,
    MediaSuspendLiftBody,
    MediaDeleteBody,
    MediaSubjectSlots,
    MediaTypeImageReleaseBody,
    MediaTypeImageSetBody,
    MediaTypeImagesAdoptBody,
    MediaKarteDateiKopf,
    MediaUploadBody,
    MamKarteAendernBody,
    MamKarteAnlegenBody,
    MamKarteBildBody,
    MamKarteBildLoesenBody,
    MamKarteLinksBody,
    MamKarteOrteBody,
    MamKarteQuellenBody,
    MamKarteStilllegenBody,
    MamKarteVersionBody,
    MamKarteVorschauBody,
    MamKarteZusammenlegenBody,
    OperationReceipt,
    PhotoboxRedaktionAblehnen,
    PhotoboxRedaktionErneutPruefen,
    PhotoboxRedaktionFreigeben,
    PhotoboxRedaktionKorrigieren,
    PhotoboxRedaktionOffline,
    PhotoboxRedaktionRueckfrage,
    MEDIA_KARTE_DATEI_URL,
    MEDIA_KARTEN_URL,
    UUID_PATTERN,
    rechteVon,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, adminSession } from "../auth/admin-guard.ts";
import { demand, hatRecht, protect, protectEines } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { MediaStore } from "../media/storage.ts";
import {
    adoptBuiltinTypeImages,
    builtinTypeImageDir,
    releaseTypeImage,
    setTypeImage,
} from "../media-editor/type-images.ts";
import { aendereKarte } from "../media-editor/kartensammlung-schreiben.ts";
import { legeKarteAn } from "../media-editor/kartensammlung-anlegen.ts";
import { loeseKartenbild, weiseKartenbildZu } from "../media-editor/kartensammlung-bilder.ts";
import { ersetzeKartenlinks } from "../media-editor/kartensammlung-links.ts";
import { aendereKartenorte } from "../media-editor/kartensammlung-orte.ts";
import { aendereKartenquellen } from "../media-editor/kartensammlung-quellen.ts";
import { entferneKarte, holeKarteZurueck } from "../media-editor/kartensammlung-stilllegen.ts";
import { aendereKartenversion } from "../media-editor/kartensammlung-versionen.ts";
import { legeKartenZusammen } from "../media-editor/kartensammlung-zusammenlegen.ts";
import { erzeugeKartenvorschau } from "../media-editor/kartensammlung-vorschau.ts";
import { liftMerge, mergeAssets } from "../media-editor/merge.ts";
import { mergePreview } from "../media-editor/merge-preview.ts";
import { requestMergeAll } from "../media-editor/merge-all.ts";
import { sameBytesAssets } from "../media-editor/search.ts";
import { deleteAsset } from "../media-editor/asset-delete.ts";
import { liftSuspension, suspendAsset } from "../media-editor/suspension.ts";
import {
    addEvidence,
    notFound,
    readLicenses,
    reviewRights,
    setCreation,
    setMetadata,
    setRights,
} from "../media-editor/asset-operations.ts";
import { bindCoat, removeCoat, setHeader, setHeaderNone } from "../media-editor/binding-operations.ts";
import {
    addToGallery,
    bindGallery,
    createGallery,
    orderGallery,
    removeFromGallery,
    setGalleryCaption,
    setGalleryCover,
    setGalleryTitle,
    unbindGallery,
    deleteGallery,
} from "../media-editor/gallery-operations.ts";
import { setHeaderRelation } from "../media-editor/header-relation.ts";
import type { MediaActor } from "../media-editor/operation-store.ts";
import { ablehnen, erneutPruefen, freigeben, korrigieren, nehmeOffline, rueckfragen } from "../photobox/redaktion.ts";
import { publicationPreview } from "../media-editor/preview.ts";
import { subjectSlots } from "../media-editor/slots.ts";
import { uploadMedia, uploadMediaBytes } from "../media-editor/upload.ts";
import { PDF_LIMITS } from "../media/raster/limits.ts";

/**
 * Der Schreibpfad der Medienverwaltung (WI-0068 P4a, §14). Jede Route ist eine benannte Operation mit `MutationEnvelope` und
 * `OperationReceipt` (ADR-0019), Rechteprüfung serverseitig über `protect`, Schreibklasse `map` (die Kartensperre antwortet 423
 * `map_locked`, SYS-4), Fehler im Umschlag (ADR-0018), kein Cache.
 *
 *     POST /api/editor/media                          Hochladen über die Ingestion          upload_media (R)
 *     POST /api/editor/media/:id/metadata             Titel, Art der Entstehung            upload_media (R)
 *     POST /api/editor/media/:id/creation             Werkzeug, Modell, Prompt             upload_media (R)
 *     POST /api/editor/media/:id/rights               Rechte setzen                        upload_media (R)
 *     POST /api/editor/media/:id/rights/review        „Rechte geprüft“ (auch eigenes)      review_media_rights (R)
 *     POST /api/editor/media/:id/evidence             Beleg anhängen                       upload_media (R)
 *     POST /api/editor/media/:id/suspend              Notaus: das Bild offline nehmen      suspend_media_publication (S, Passkey)
 *     POST /api/editor/media/:id/suspend/lift         Notaus aufheben                      suspend_media_publication (S, Passkey)
 *     POST /api/editor/media/:id/delete               endgültig löschen (eigener Upload)   delete_media (S, Passkey)
 *     POST /api/editor/media/bindings/coat            Wappen setzen oder ersetzen          upload_media (R)
 *     POST /api/editor/media/bindings/coat/none       Wappen entfernen: „bewusst ohne“     upload_media (R)
 *     POST /api/editor/media/bindings/header/set      Titelbild: EIN Bild setzen/ersetzen  upload_media (R)
 *     POST /api/editor/media/bindings/header/none     Kein Titelbild: „bewusst ohne“       upload_media (R)
 *     POST /api/editor/media/bindings/header/relation Bildbezug einer Verwendung           upload_media (R)
 *     POST /api/editor/media/citymaps/:id/update      Karte der Kartensammlung ändern      upload_media (R)
 *     POST /api/editor/media/citymaps                 Neuen Eintrag anlegen                upload_media (R)
 *     POST /api/editor/media/citymaps/:id/image       Version der Karte anhängen, Vorschau zuweisen/ändern  upload_media (R)
 *     POST /api/editor/media/citymaps/:id/image/remove Version der Karte oder Vorschau lösen  upload_media (R)
 *     POST /api/editor/media/citymaps/:id/version     Bezeichnung, Reihenfolge einer Version  upload_media (R)
 *     POST /api/editor/media/citymaps/:id/links        Fundstellen ersetzen               upload_media (R)
 *     POST /api/editor/media/citymaps/:id/places       Orte und Regionen anhängen/lösen   upload_media (R)
 *     POST /api/editor/media/citymaps/:id/sources      Publikation anhängen, Fundstelle, lösen, holen, zuerst  upload_media (R)
 *     POST /api/editor/media/citymaps/:id/preview      Vorschau aus der Karte erzeugen      upload_media (R)
 *     PUT  /api/editor/media/citymaps/datei           Kartendatei als Rohkörper, bis 50 MB upload_media (R)
 *     POST /api/editor/media/citymaps/:id/retire      Eintrag entfernen (stilllegen)       upload_media (R)
 *     POST /api/editor/media/citymaps/:id/restore     Eintrag zurückholen                  upload_media (R)
 *     POST /api/editor/media/citymaps/:id/merge       Bilder an anderen Eintrag geben und entfernen  upload_media (R)
 *     POST /api/editor/media/photobox/:id/approve     Reisebild freigeben                  moderate_submissions (R)
 *     POST /api/editor/media/photobox/:id/ask         Reisebild: Rückfrage an den Einreicher moderate_submissions (R)
 *     POST /api/editor/media/photobox/:id/reject      Reisebild ablehnen                   moderate_submissions (R)
 *     POST /api/editor/media/photobox/:id/correct     Reisebild: Angaben berichtigen       moderate_submissions (R)
 *     POST /api/editor/media/photobox/:id/offline     Reisebild offline nehmen             publish_media (R)
 *
 *     GET  /api/editor/media/subjects/:kind/:id       Plätze eines Orts oder Gebiets       view_media_private (R)
 *     GET  /api/editor/media/licenses                 Lizenzkatalog für das Formular       view_media_private (R)
 *     GET  /api/editor/media/publication-preview      „öffentlich danach?“ fürs Formular   view_media_private (R)
 *
 * Kein Notaus und kein Löschen in diesem Paket (eigene spätere Pakete). „Verwendung freigeben“ (`publish_media`) ebenfalls nicht:
 * öffentlich wird ein Bild allein über die Entscheidung der Policy.
 */

/** Zusätzlich zu den Codes der Verwaltung: 422 `media_file_rejected`. */
const MEDIA_ERRORS = { ...ADMIN_ERRORS, 422: ApiErrorBody };

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });
const BySubject = Type.Object(
    {
        kind: Type.Union(MEDIA_SLOT_SUBJECT_KINDS.map((kind) => Type.Literal(kind))),
        id: Type.String({ pattern: UUID_PATTERN }),
    },
    { additionalProperties: false },
);

const write = protect("upload_media", { writeClass: "map" });
const receipt = { 200: OperationReceipt, ...MEDIA_ERRORS };

async function actorOf(request: FastifyRequest): Promise<MediaActor> {
    const session = await adminSession(request);
    return { personId: session.personId, environment: session.environment };
}

/** Der Medienspeicher der Instanz; ohne `MEDIA_ROOT` nimmt sie keine Datei an (503). */
export function storeOf(app: FastifyInstance): MediaStore {
    const root = app.config.mediaRoot;
    if (root !== undefined && root !== "") {
        try {
            return new MediaStore(root);
        } catch {
            // ein relativer Pfad: wie ohne Speicher
        }
    }
    throw new ApiError(503, "media_storage_unavailable", "Auf dieser Instanz ist kein Medienspeicher eingerichtet.");
}

/** Der ganze Rumpf einer Kartendatei: die Datei und ihr Formular (samt Beleg als Base64). */
const KARTE_DATEI_BODY_LIMIT = PDF_LIMITS.maxBytes + MEDIA_UPLOAD_BODY_LIMIT;

/**
 * Zerlegt den Rumpf einer Kartendatei (`MediaKarteDateiKopf`). Der Kopf durchläuft keine Schemaprüfung der Route, deshalb hier; 400 wie jede falsch geformte Anfrage.
 * Nur die Rollen der Kartensammlung (`map_full`, `map_preview`) gehen diesen Weg.
 */
export function liesKartenDatei(rumpf: unknown): { kopf: MediaKarteDateiKopf; bytes: Uint8Array } {
    const falsch = (): ApiError =>
        new ApiError(400, "validation_failed", "Die Kartendatei kommt in einem falschen Rumpf.", {
            issues: [{ path: "body", rule: "required" }],
        });
    if (!Buffer.isBuffer(rumpf) || rumpf.byteLength < 4) throw falsch();
    const laenge = rumpf.readUInt32BE(0);
    if (laenge < 2 || laenge > MEDIA_UPLOAD_BODY_LIMIT || 4 + laenge >= rumpf.byteLength) throw falsch();
    let kopf: unknown;
    try {
        kopf = JSON.parse(rumpf.subarray(4, 4 + laenge).toString("utf8"));
    } catch {
        throw falsch();
    }
    if (
        !Value.Check(MediaKarteDateiKopf, kopf) ||
        (kopf.form.role !== "map_full" && kopf.form.role !== "map_preview")
    ) {
        throw falsch();
    }
    return { kopf, bytes: rumpf.subarray(4 + laenge) };
}

export const mediaEditorOperationRoutes: FastifyPluginAsyncTypebox = async (app) => {
    // Reisebilder prüfen und freigeben (WI-0272 S3, `photobox/redaktion.ts`): `:id` ist die öffentliche Kennung der Einreichung, `baseRevision` ihre
    // Revision. Prüfen und Freigeben darf ab Reviewer (`moderate_submissions`), eine freigegebene Einreichung zurücknehmen ab Editor (`publish_media`,
    // ohne Passkey). Schreibklasse `map` wie jede Operation der Medienverwaltung; Kartendaten schreibt keine dieser Routen.
    const pruefen = protectEines(["moderate_submissions", "moderate_photobox"], { writeClass: "map" });
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/approve`,
        { ...pruefen, schema: { params: ById, body: PhotoboxRedaktionFreigeben, response: receipt } },
        async (request) => freigeben(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/ask`,
        { ...pruefen, schema: { params: ById, body: PhotoboxRedaktionRueckfrage, response: receipt } },
        async (request) => rueckfragen(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/reject`,
        { ...pruefen, schema: { params: ById, body: PhotoboxRedaktionAblehnen, response: receipt } },
        async (request) => ablehnen(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/correct`,
        { ...pruefen, schema: { params: ById, body: PhotoboxRedaktionKorrigieren, response: receipt } },
        async (request) => korrigieren(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/reopen`,
        { ...pruefen, schema: { params: ById, body: PhotoboxRedaktionErneutPruefen, response: receipt } },
        async (request) => erneutPruefen(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_PHOTOBOX_URL}/:id/offline`,
        {
            ...protect("publish_media", { writeClass: "map" }),
            schema: { params: ById, body: PhotoboxRedaktionOffline, response: receipt },
        },
        async (request) =>
            nehmeOffline(app.database!, storeOf(app), await actorOf(request), request.params.id, request.body),
    );

    // Die Kartensammlung (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“): Eigenschaften und Typen einer Karte, wie ein Werk (`upload_media`).
    // 503 `map_import_running`, solange der Legacy-Zug die Karten schreibt.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/update`,
        {
            ...protectEines(["upload_media", "edit_map_collection"], { writeClass: "map" }),
            schema: { params: ById, body: MamKarteAendernBody, response: receipt },
        },
        async (request) => aendereKarte(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // Einen Eintrag der Kartensammlung anlegen, Karte und Vorschau zuweisen, ändern, lösen und eine Kartendatei hochladen (WI-0287 Stufe 1, Punkt 2). Dieselben Rechte wie das Ändern.
    const kartenRecht = protectEines(["upload_media", "edit_map_collection"], { writeClass: "map" });
    app.post(
        MEDIA_KARTEN_URL,
        { ...kartenRecht, schema: { body: MamKarteAnlegenBody, response: receipt } },
        async (request) => legeKarteAn(app.database!, await actorOf(request), request.body),
    );
    app.post(
        `${MEDIA_KARTEN_URL}/:id/image`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteBildBody, response: receipt } },
        async (request) => weiseKartenbildZu(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_KARTEN_URL}/:id/image/remove`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteBildLoesenBody, response: receipt } },
        async (request) => loeseKartenbild(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // Die Versionen der Karte (WI-0287 Stufe 2): Bezeichnung und Reihenfolge, je Handlung eine Operation, mit dem Recht der Sammlung.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/version`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteVersionBody, response: receipt } },
        async (request) => aendereKartenversion(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_KARTEN_URL}/:id/links`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteLinksBody, response: receipt } },
        async (request) => ersetzeKartenlinks(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // Die Publikationen eines Eintrags (WI-0287 Punkt 4): je Handlung eine Operation, mit dem Recht der Sammlung. Eine neue Quelle im Verzeichnis anlegen bleibt bei `manage_sources` (Inhalte).
    // Die Orte und Regionen eines Eintrags (WI-0287 Stufe 3): je Handlung eine Operation (anhängen, lösen, zuordnen), mit dem Recht der Sammlung.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/places`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteOrteBody, response: receipt } },
        async (request) => aendereKartenorte(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_KARTEN_URL}/:id/sources`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteQuellenBody, response: receipt } },
        async (request) => aendereKartenquellen(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // „Vorschau erzeugen“ (WI-0287 Punkt 5): ein neues Werk aus der Karte des Eintrags, sofort als Vorschau gebunden; die Datei rechnet der Worker
    // (`citymap_preview_generate`). Dieselben Rechte und dieselbe Sperre wie das Zuweisen.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/preview`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteVorschauBody, response: receipt } },
        async (request) =>
            erzeugeKartenvorschau(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.addContentTypeParser(
        "application/octet-stream",
        { parseAs: "buffer", bodyLimit: KARTE_DATEI_BODY_LIMIT },
        (_request, body, done) => done(null, body),
    );
    app.put(
        MEDIA_KARTE_DATEI_URL,
        { ...kartenRecht, bodyLimit: KARTE_DATEI_BODY_LIMIT, schema: { response: receipt } },
        async (request) => {
            const session = await adminSession(request);
            const { kopf, bytes } = liesKartenDatei(request.body);
            return uploadMediaBytes(
                app.database!,
                storeOf(app),
                { personId: session.personId, environment: session.environment },
                { mayReview: rechteVon(session).has("review_media_rights") },
                { operationId: kopf.operationId, name: kopf.name, form: kopf.form, bytes },
            );
        },
    );
    // Einen Eintrag der Kartensammlung entfernen und zurückholen (WI-0287): stilllegen, nie löschen; derselbe Weg und dieselbe Sperre wie das Ändern.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/retire`,
        {
            ...protectEines(["upload_media", "edit_map_collection"], { writeClass: "map" }),
            schema: { params: ById, body: MamKarteStilllegenBody, response: receipt },
        },
        async (request) => entferneKarte(app.database!, await actorOf(request), request.params.id, request.body),
    );
    app.post(
        `${MEDIA_KARTEN_URL}/:id/restore`,
        {
            ...protectEines(["upload_media", "edit_map_collection"], { writeClass: "map" }),
            schema: { params: ById, body: MamKarteStilllegenBody, response: receipt },
        },
        async (request) => holeKarteZurueck(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // „Bilder an anderen Eintrag geben“ (WI-0287 Stufe 2): übergeben und stilllegen in EINER Operation, gegen die Revisionen beider Einträge; Rechte und Sperre wie das Entfernen.
    app.post(
        `${MEDIA_KARTEN_URL}/:id/merge`,
        { ...kartenRecht, schema: { params: ById, body: MamKarteZusammenlegenBody, response: receipt } },
        async (request) => legeKartenZusammen(app.database!, await actorOf(request), request.params.id, request.body),
    );
    // Typbilder (WI-0068, Migration 0113): den ★ einer Kategorie setzen (wie eine Bindung, `upload_media`); die eingebauten Grafiken
    // übernehmen (ein Klick, `publish_media`: er macht nach der Policy bis zu 37 Bilder öffentlich).
    app.post(
        MEDIA_TYPE_IMAGE_SET_URL,
        { ...write, schema: { body: MediaTypeImageSetBody, response: receipt } },
        async (request) => setTypeImage(app.database!, await actorOf(request), request.body),
    );
    // Eine Variante lösen (WI-0281): dasselbe Recht und dieselbe Klasse wie das Setzen; das Asset bleibt.
    app.post(
        MEDIA_TYPE_IMAGE_RELEASE_URL,
        { ...write, schema: { body: MediaTypeImageReleaseBody, response: receipt } },
        async (request) => releaseTypeImage(app.database!, await actorOf(request), request.body),
    );
    app.post(
        MEDIA_TYPE_IMAGES_ADOPT_URL,
        {
            ...protect("publish_media", { writeClass: "map" }),
            schema: { body: MediaTypeImagesAdoptBody, response: receipt },
        },
        async (request) =>
            adoptBuiltinTypeImages(
                app.database!,
                storeOf(app),
                await actorOf(request),
                request.body,
                builtinTypeImageDir(),
            ),
    );

    // --- Einzelbild-Notaus (WI-0068, Betreiber 2026-10-10: „im mam kann man dann immernoch bilder etc gezielt offline nehmen“) ---
    //
    // 🔴 Beide verlangen einen FRISCHEN PASSKEY (Betreiber zu WI-0119 F2) und einen Pflichtgrund.
    // 🔴 Ausblenden ist ein Sicherheitshandgriff und läuft auch unter Kartensperre (`security`, SYS-4). Das Aufheben macht
    //    Inhalt wieder öffentlich und wartet darum wie jede Inhaltsänderung auf sie (`map`).
    app.post(
        `${MEDIA_EDITOR_URL}/:id/suspend`,
        {
            ...protect("suspend_media_publication", { confirm: "passkey", writeClass: "security" }),
            schema: { params: ById, body: MediaSuspendBody, response: receipt },
        },
        async (request) => suspendAsset(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/suspend/lift`,
        {
            ...protect("suspend_media_publication", { confirm: "passkey", writeClass: "map" }),
            schema: { params: ById, body: MediaSuspendLiftBody, response: receipt },
        },
        async (request) => liftSuspension(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Endgültig löschen (WI-0068 R4, `asset-delete.ts`): nur Betreiber (`delete_media`, Stufe S) mit frischem Passkey, nur ein eigener
    // Upload ohne jede Verwendung (Betreiber 2026-10-17). Schreibklasse `map`: Es ändert, was die Medienverwaltung führt.
    app.post(
        `${MEDIA_EDITOR_URL}/:id/delete`,
        {
            ...protect("delete_media", { confirm: "passkey", writeClass: "map" }),
            schema: { params: ById, body: MediaDeleteBody, response: receipt },
        },
        async (request) =>
            deleteAsset(app.database!, storeOf(app), await actorOf(request), request.params.id, request.body),
    );

    // --- Zusammenfuehren bytegleicher Werke (WI-0068 D1, Migration 0121) ---
    //
    // 🔴 Dieselbe Schreibklasse `map` wie jede Bindung: Die Operation haengt Verwendungen an Fachobjekten um. Sie verlangt
    // KEINEN frischen Passkey - anders als der Notaus nimmt sie nichts offline, und sie ist umkehrbar. 🪤 Nie automatisch
    // (WI-0068 §21): Es gibt keine Route, die ueber den Bestand laeuft; ein Klick fuehrt EINE Gruppe zusammen.
    app.post(MEDIA_MERGE_URL, { ...write, schema: { body: MediaMergeBody, response: receipt } }, async (request) =>
        mergeAssets(app.database!, await actorOf(request), request.body),
    );

    // „Alle bytegleichen Duplikate zusammenführen“: nur Betreiber, frischer Passkey (§21, Betreiber 2026-10-17). Die Operation reiht
    // EINEN Auftrag `media_merge_all` ein; die Arbeit tut die Jobs-Rolle (`media-editor/merge-all.ts`).
    app.post(
        MEDIA_MERGE_ALL_URL,
        {
            ...protect("merge_media_all", { confirm: "passkey", writeClass: "map" }),
            schema: { body: MediaMergeAllBody, response: receipt },
        },
        async (request) => requestMergeAll(app.database!, await actorOf(request), request.body),
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/merge/lift`,
        { ...write, schema: { params: ById, body: MediaMergeLiftBody, response: receipt } },
        async (request) => liftMerge(app.database!, await actorOf(request), request.params.id, request.body),
    );

    // Die Vorschau ist reines Lesen und traegt deshalb das Leserecht, nicht `upload_media`.
    app.get(
        MEDIA_MERGE_PREVIEW_URL,
        { ...protect("view_media_private"), schema: { response: { 200: MediaMergePreview, ...ADMIN_ERRORS } } },
        async () => mergePreview(app.database!),
    );
    // Gibt es diese Datei schon? Der Browser fragt nach der Dateiwahl (Betreiber 2026-10-17); der Upload prüft selbst noch einmal.
    app.get(
        `${MEDIA_EDITOR_URL}/same-bytes/:sha256`,
        {
            ...protect("view_media_private"),
            schema: {
                params: Type.Object({ sha256: Type.String({ pattern: MEDIA_SHA256_PATTERN }) }),
                response: { 200: MediaSameBytes, ...ADMIN_ERRORS },
            },
        },
        async (request) => {
            const hits = await sameBytesAssets(app.database!, request.params.sha256);
            return { hits, suggested: hits[0]?.id ?? null };
        },
    );

    app.post(
        MEDIA_UPLOAD_URL,
        {
            ...protectEines(["upload_media", "upload_social_image", "edit_map_collection"], { writeClass: "map" }),
            bodyLimit: MEDIA_UPLOAD_BODY_LIMIT,
            schema: { body: MediaUploadBody, response: receipt },
        },
        async (request) => {
            const session = await adminSession(request);
            // Die Fachrechte (WI-0279) gelten nur für ihre Rolle: Bilder des Social Hubs, Karten der Sammlung; alles andere bleibt bei `upload_media`.
            const role = request.body.form.role;
            const config = app.authConfig;
            const erlaubt =
                hatRecht(session, "upload_media", config) ||
                (role === "social_post" && hatRecht(session, "upload_social_image", config)) ||
                ((role === "map_full" || role === "map_preview") && hatRecht(session, "edit_map_collection", config));
            if (!erlaubt) throw new ApiError(403, "forbidden", "Dafür fehlt das Recht.");
            const store = storeOf(app);
            const mayReview = rechteVon(session).has("review_media_rights");
            return uploadMedia(
                app.database!,
                store,
                { personId: session.personId, environment: session.environment },
                { mayReview },
                request.body,
            );
        },
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/metadata`,
        { ...write, schema: { params: ById, body: MediaMetadataBody, response: receipt } },
        async (request) => setMetadata(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/creation`,
        { ...write, schema: { params: ById, body: MediaCreationBody, response: receipt } },
        async (request) => setCreation(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/rights`,
        { ...write, schema: { params: ById, body: MediaRightsBody, response: receipt } },
        async (request) => {
            const session = await adminSession(request);
            return setRights(
                app.database!,
                { personId: session.personId, environment: session.environment },
                request.params.id,
                request.body,
                {
                    pruefeCommunityLizenz: () => {
                        if (!hatRecht(session, "edit_community_license", app.authConfig)) {
                            throw new ApiError(
                                403,
                                "community_license_locked",
                                "Die Lizenz eines Community-Uploads ändert nur der Betreiber.",
                            );
                        }
                        demand(session, "edit_community_license", app.authConfig);
                    },
                },
            );
        },
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/rights/review`,
        {
            ...protect("review_media_rights", { writeClass: "map" }),
            schema: { params: ById, body: MediaRightsReviewBody, response: receipt },
        },
        async (request) => reviewRights(app.database!, await actorOf(request), request.params.id, request.body),
    );

    app.post(
        `${MEDIA_EDITOR_URL}/:id/evidence`,
        {
            ...write,
            bodyLimit: MEDIA_UPLOAD_BODY_LIMIT,
            schema: { params: ById, body: MediaEvidenceBody, response: receipt },
        },
        async (request) =>
            addEvidence(app.database!, storeOf(app), await actorOf(request), request.params.id, request.body),
    );

    app.post(
        MEDIA_COAT_BIND_URL,
        { ...write, schema: { body: MediaCoatBindBody, response: receipt } },
        async (request) => bindCoat(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_COAT_NONE_URL,
        { ...write, schema: { body: MediaCoatNoneBody, response: receipt } },
        async (request) => removeCoat(app.database!, await actorOf(request), request.body),
    );

    // Das Titelbild eines Orts: EIN Bild ODER EINE Galerie (WI-0219, `binding-operations.ts`); jede Wahl ersetzt das Bisherige.
    app.post(
        MEDIA_HEADER_SET_URL,
        { ...write, schema: { body: MediaHeaderSetBody, response: receipt } },
        async (request) => setHeader(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_HEADER_NONE_URL,
        { ...write, schema: { body: MediaHeaderNoneBody, response: receipt } },
        async (request) => setHeaderNone(app.database!, await actorOf(request), request.body),
    );

    // Der Bildbezug einer Verwendung: Ortsansicht, Typbild oder zurück auf die Regel (Betreiber 2026-10-11, `header-relation.ts`).
    app.post(
        MEDIA_HEADER_RELATION_URL,
        { ...write, schema: { body: MediaHeaderRelationBody, response: receipt } },
        async (request) => setHeaderRelation(app.database!, await actorOf(request), request.body),
    );

    // --- Die Galerie als eigenes Medienobjekt (WI-0068 P6, `gallery-operations.ts`) ---
    //
    // 🔴 Dieselbe Schreibklasse `map` wie die ortsbezogenen Operationen: Eine Galerie entscheidet, welche Bilder an einem Ort
    // öffentlich sind. Am ORT setzt `header.set` ein Einzelbild; `gallery.bind` löst es (WI-0219: EIN Titelbild ODER EINE Galerie).
    app.post(
        MEDIA_GALLERY_CREATE_URL,
        { ...write, schema: { body: MediaGalleryCreateBody, response: receipt } },
        async (request) => createGallery(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_TITLE_URL,
        { ...write, schema: { body: MediaGalleryTitleBody, response: receipt } },
        async (request) => setGalleryTitle(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_ADD_URL,
        { ...write, schema: { body: MediaGalleryAddBody, response: receipt } },
        async (request) => addToGallery(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_ORDER_URL,
        { ...write, schema: { body: MediaGalleryOrderBody, response: receipt } },
        async (request) => orderGallery(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_COVER_URL,
        { ...write, schema: { body: MediaGalleryCoverBody, response: receipt } },
        async (request) => setGalleryCover(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_CAPTION_URL,
        { ...write, schema: { body: MediaGalleryCaptionBody, response: receipt } },
        async (request) => setGalleryCaption(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_REMOVE_URL,
        { ...write, schema: { body: MediaGalleryRemoveBody, response: receipt } },
        async (request) => removeFromGallery(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_BIND_URL,
        { ...write, schema: { body: MediaGalleryBindBody, response: receipt } },
        async (request) => bindGallery(app.database!, await actorOf(request), request.body),
    );

    app.post(
        MEDIA_GALLERY_UNBIND_URL,
        { ...write, schema: { body: MediaGalleryBindBody, response: receipt } },
        async (request) => unbindGallery(app.database!, await actorOf(request), request.body),
    );

    // Eine eigene, ortlose Galerie entfernen (WI-0068 R3; nach dem Muster von „Endgültig löschen“). Die Bilder bleiben, deshalb wie jede
    // Galerie-Operation `upload_media`.
    app.post(
        MEDIA_GALLERY_DELETE_URL,
        { ...write, schema: { body: MediaGalleryDeleteBody, response: receipt } },
        async (request) => deleteGallery(app.database!, await actorOf(request), request.body),
    );

    // --- Lesen für den Ortseditor und das Formular ---

    app.get(
        `${MEDIA_EDITOR_URL}/subjects/:kind/:id`,
        {
            ...protect("view_media_private"),
            schema: { params: BySubject, response: { 200: MediaSubjectSlots, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const slots = await subjectSlots(app.database!, request.params.kind, request.params.id);
            if (slots === undefined) throw notFound(request.params.kind === "place" ? "Diesen Ort" : "Dieses Gebiet");
            return slots;
        },
    );

    app.get(
        MEDIA_LICENSES_URL,
        { ...protect("view_media_private"), schema: { response: { 200: MediaLicenseCatalog, ...ADMIN_ERRORS } } },
        async () => ({ licenses: await readLicenses(app.database!) }),
    );

    app.get(
        MEDIA_PUBLICATION_PREVIEW_URL,
        {
            ...protect("view_media_private"),
            schema: {
                querystring: MediaPublicationPreviewQuery,
                response: { 200: MediaPublicationPreview, ...ADMIN_ERRORS },
            },
        },
        async (request) => publicationPreview(app.database!, request.query),
    );
};
