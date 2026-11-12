import { createReadStream } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
    MAM_GALLERY_PAGE,
    MEDIA_EDITOR_GALLERY_URL,
    MamGalleryList,
    MEDIA_EDITOR_NAVIGATION_URL,
    MEDIA_EDITOR_URL,
    MEDIA_INTERN_VARIANT_PATTERN,
    MEDIA_KARTEN_URL,
    MEDIA_PHOTOBOX_ORT_EINGAENGE_ROUTE,
    MEDIA_PHOTOBOX_ORT_REISEBILDER_ROUTE,
    MEDIA_PHOTOBOX_STAPEL_URL,
    MEDIA_TYPE_IMAGES_URL,
    MEDIA_PHOTOBOX_GALERIEN_URL,
    MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL,
    MamKarteDetail,
    MamKartenAnfrage,
    MamKartenListe,
    MamTypeImageList,
    MamNavigation,
    MamSearchQuery,
    MamSearchResult,
    MediaAssetDetail,
    MediaGalleryDetail,
    MediaUsageResult,
    PhotoboxGalerien,
    PhotoboxOrtEingaenge,
    PhotoboxOrtReisebilder,
    PhotoboxStapel,
    UUID_PATTERN,
} from "@avesmaps3d/shared";
import { ADMIN_ERRORS, noStore } from "../auth/admin-guard.ts";
import { protect } from "../auth/plugin.ts";
import { ApiError } from "../http/api-error.ts";
import { assetDetail } from "../media-editor/detail.ts";
import { galleryDetail, galleryList } from "../media-editor/gallery.ts";
import { karteDetail, kartenListe } from "../media-editor/kartensammlung.ts";
import {
    mediaNavigation,
    photoboxGalerien,
    photoboxOrtEingaenge,
    photoboxOrtReisebilder,
    photoboxStapel,
    searchMedia,
} from "../media-editor/search.ts";
import { typeImageList } from "../media-editor/type-images.ts";
import { usageOf } from "../media-editor/usage.ts";
import { MediaStorageError } from "../media/storage.ts";
import { technikNachziehen } from "../photobox/db.ts";
import { mediaEditorOperationRoutes, storeOf } from "./media-editor-operations.ts";

/**
 * Der Lesepfad der Medienverwaltung (WI-0068 P2, §17). Die Operationen des Schreibpfads (P4a) hängen als eigenes Plugin darunter
 * (`media-editor-operations.ts`), damit sie dieselbe Hülle haben (kein Cache).
 *
 *     GET /api/editor/media                 Liste und Suche (MamSearchQuery)            view_media_private (R)
 *     GET /api/editor/media/navigation      Arten, Medienobjekte, Prüfkörbe mit Zahl     view_media_private (R)
 *     GET /api/editor/media/:id             Asset im Inspector                           view_media_private (R)
 *     GET /api/editor/media/:id/usage       Reverse Usage samt „gleiche Datei“           view_media_private (R)
 *     GET /api/editor/galleries/:id         Galerie als Objekt                           view_media_private (R)
 *     GET /api/editor/media/:id/preview/:variant   private Vorschau (Bild, `intern_…`)   view_media_private (R)
 *     GET /api/editor/media/type-images     Typbilder: 37 Kategorien mit ★ und Zahl       view_media_private (R)
 *     GET /api/editor/media/photobox/stapel Stapel neuer Reisebilder: Zahl und Vorschauen view_media_private (R)
 *     GET /api/editor/media/photobox/ort/:id/reisebilder  freigegebene Reisebilder eines Ortes (Panel im Ortseditor, WI-0272)
 *     GET /api/editor/media/photobox/galerien  die Reisebilder je Ort (Medienobjekt „PhotoBox-Galerien“)  view_media_private (R)
 *     GET /api/editor/media/photobox/ohne-ort/reisebilder  die Reisebilder an freien Stellen  view_media_private (R)
 *     GET /api/editor/media/photobox/ort/:id/eingaenge  offene Eingänge eines Ortes (Kopf der Infobox)  view_media_private (R)
 *
 * 🔴 „MAM öffnen und private Angaben lesen“ ist EIN Recht (Betreiber 2026-10-09): jede Route hier verlangt `view_media_private`,
 * serverseitig über `protect` (401 ohne Anmeldung, 403 ohne Recht, beides vor der Prüfung der Anfrage). Die Antworten tragen
 * private Felder (`MEDIA_PRIVATE_FIELDS`); öffentliche Lesepfade bleiben unverändert und lesen nichts davon. Antworten landen
 * in keinem Cache (`no-store`), Fehler stehen im Umschlag (ADR-0018).
 *
 * 🔴 **Das Nachziehen steht hier, nicht in den Lesefunktionen** (WI-0272 S3, Fixrunde E): Eine Einreichung, deren Bild technisch geprüft ist, wechselt von `incoming` auf `pending`
 * oder `technical_failed` (`technikNachziehen`: der Abgleich der Aufträge schreibt `media_submission` nicht, wer liest, zieht nach). Die Routen tun es EINMAL vor dem Lesen: Liste nur beim
 * Korb „PhotoBox-Uploads“ (oder einem Teil davon), Navigation, Detail und Stapel jedes Mal. Die Funktionen bleiben rein lesend und laufen auch in `READ ONLY` (`media:messung`).
 *
 * 🔴 Die private Vorschau (WI-0068 P4b) ist der einzige Bildweg zu nicht veröffentlichten Bytes: nur eine gerechnete Fassung
 * (`derivatives/`, Variante `intern_…`), nie das Original; `no-store`, `nosniff`, `default-src 'none'`. Der Schlüssel kommt aus der
 * Datenbank, nie aus der Anfrage, und `MediaStore.locate` hält ihn unter der Wurzel.
 */

const ById = Type.Object({ id: Type.String({ pattern: UUID_PATTERN }) }, { additionalProperties: false });

const GalleryQuery = Type.Object(
    {
        q: Type.Optional(Type.String({ maxLength: 200 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAM_GALLERY_PAGE })),
        offset: Type.Optional(Type.Integer({ minimum: 0 })),
    },
    { additionalProperties: false },
);
const PhotoboxGalerienQuery = Type.Object(
    { q: Type.Optional(Type.String({ maxLength: 200 })) },
    { additionalProperties: false },
);
const ByVariant = Type.Object(
    { id: Type.String({ pattern: UUID_PATTERN }), variant: Type.String({ pattern: MEDIA_INTERN_VARIANT_PATTERN }) },
    { additionalProperties: false },
);

const notFound = (what: string): ApiError => new ApiError(404, "not_found", `${what} gibt es nicht.`);

export const mediaEditorRoutes: FastifyPluginAsyncTypebox = async (app) => {
    noStore(app);
    await app.register(mediaEditorOperationRoutes);

    app.get(
        MEDIA_EDITOR_URL,
        {
            ...protect("view_media_private"),
            schema: { querystring: MamSearchQuery, response: { 200: MamSearchResult, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Der Übergang gehört zur Zeile der Einreichung im Korb; eine andere Liste zeigt ihn nicht und lässt die Tafel in Ruhe.
            if (request.query.basket === "photobox_uploads" || request.query.einreichung !== undefined) {
                await technikNachziehen(app.database!);
            }
            return searchMedia(app.database!, request.query);
        },
    );

    app.get(
        MEDIA_TYPE_IMAGES_URL,
        { ...protect("view_media_private"), schema: { response: { 200: MamTypeImageList, ...ADMIN_ERRORS } } },
        async () => typeImageList(app.database!),
    );

    // Der Stapel in Community › Meldungen (WI-0272 S3, Aufgabe 19): offene Reisebilder und die Vorschauen der neuesten; `offen` zählt wie der Korb „PhotoBox-Uploads › offen“.
    app.get(
        MEDIA_PHOTOBOX_STAPEL_URL,
        { ...protect("view_media_private"), schema: { response: { 200: PhotoboxStapel, ...ADMIN_ERRORS } } },
        async () => {
            await technikNachziehen(app.database!);
            return photoboxStapel(app.database!);
        },
    );

    // Die offenen Eingänge eines Ortes für den Kopf seiner Infobox (WI-0272 S5): nur hier, nie in der öffentlichen Antwort des Ortes (`routes/subjects.ts`, öffentlich zwischengespeichert). Die Hülle dieses
    // Plugins macht sie `no-store`; ohne `view_media_private` gibt es 401 oder 403, bevor etwas gelesen wird.
    app.get(
        MEDIA_PHOTOBOX_ORT_EINGAENGE_ROUTE,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: PhotoboxOrtEingaenge, ...ADMIN_ERRORS } },
        },
        async (request) => {
            await technikNachziehen(app.database!);
            return photoboxOrtEingaenge(app.database!, request.params.id);
        },
    );

    // Die freigegebenen Reisebilder eines Ortes für den Reiter „Bilder“ des Ortseditors (WI-0272); wie die Eingänge nur hier.
    app.get(
        MEDIA_PHOTOBOX_ORT_REISEBILDER_ROUTE,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: PhotoboxOrtReisebilder, ...ADMIN_ERRORS } },
        },
        (request) => photoboxOrtReisebilder(app.database!, request.params.id),
    );

    // Das Medienobjekt „PhotoBox-Galerien“ (WI-0272): die Reisebilder je Ort, und die Bilder der Sammlung ohne Ort; ein Ort liest seine über die Route darüber.
    app.get(
        MEDIA_PHOTOBOX_GALERIEN_URL,
        {
            ...protect("view_media_private"),
            schema: { querystring: PhotoboxGalerienQuery, response: { 200: PhotoboxGalerien, ...ADMIN_ERRORS } },
        },
        (request) => photoboxGalerien(app.database!, request.query.q),
    );
    app.get(
        MEDIA_PHOTOBOX_OHNE_ORT_REISEBILDER_URL,
        { ...protect("view_media_private"), schema: { response: { 200: PhotoboxOrtReisebilder, ...ADMIN_ERRORS } } },
        () => photoboxOrtReisebilder(app.database!, null),
    );

    app.get(
        MEDIA_EDITOR_NAVIGATION_URL,
        { ...protect("view_media_private"), schema: { response: { 200: MamNavigation, ...ADMIN_ERRORS } } },
        async () => {
            await technikNachziehen(app.database!);
            return mediaNavigation(app.database!);
        },
    );

    app.get(
        `${MEDIA_EDITOR_URL}/:id`,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: MediaAssetDetail, ...ADMIN_ERRORS } },
        },
        async (request) => {
            // Die Revision, die dieses Asset nennt, ist die, auf die die Operationen der Redaktion bauen, und die zählt der Übergang hoch.
            await technikNachziehen(app.database!);
            const detail = await assetDetail(app.database!, request.params.id);
            if (detail === undefined) throw notFound("Dieses Medium");
            return detail;
        },
    );

    app.get(
        `${MEDIA_EDITOR_URL}/:id/usage`,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: MediaUsageResult, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const usage = await usageOf(app.database!, request.params.id);
            if (usage === undefined) throw notFound("Dieses Medium");
            return usage;
        },
    );

    // Ohne Antwortschema: Der Körper ist die Datei (wie /media/ und der Kanal); Fehler haben die übliche Form.
    app.get(
        `${MEDIA_EDITOR_URL}/:id/preview/:variant`,
        { ...protect("view_media_private"), schema: { params: ByVariant } },
        async (request, reply) => {
            const [file] = await app.database!<{ storage_key: string }[]>`
                SELECT f.storage_key FROM media_file f JOIN media_asset a ON a.id = f.media_asset_id
                 WHERE a.public_id = ${request.params.id}::uuid AND f.storage_class = 'derivative'
                   AND f.variant = ${request.params.variant} AND f.mime_type = 'image/webp'
                 ORDER BY f.created_at DESC, f.id DESC
                 LIMIT 1
            `;
            if (file === undefined) throw notFound("Diese Vorschau");
            let located: { path: string; byteSize: number };
            try {
                located = await storeOf(app).locate(file.storage_key);
            } catch (error) {
                if (!(error instanceof MediaStorageError)) throw error;
                if (error.code !== "missing") request.log.warn({ err: error }, "private Vorschau abgewiesen");
                throw notFound("Diese Vorschau");
            }
            return reply
                .header("content-type", "image/webp")
                .header("content-length", located.byteSize)
                .header("x-content-type-options", "nosniff")
                .header("content-security-policy", "default-src 'none'")
                .header("content-disposition", "inline")
                .send(createReadStream(located.path));
        },
    );

    /**
     * Die Galerien als Liste (WI-0068 P6). Gesucht wird über Titel UND Ortsnamen: Im Bestand trägt keine Galerie einen Titel, sie
     * heißen in der Oberfläche nach ihrem Ort.
     */
    app.get(
        MEDIA_EDITOR_GALLERY_URL,
        {
            ...protect("view_media_private"),
            schema: { querystring: GalleryQuery, response: { 200: MamGalleryList, ...ADMIN_ERRORS } },
        },
        async (request) =>
            galleryList(app.database!, {
                q: request.query.q,
                limit: request.query.limit ?? MAM_GALLERY_PAGE,
                offset: request.query.offset ?? 0,
            }),
    );

    app.get(
        `${MEDIA_EDITOR_GALLERY_URL}/:id`,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: MediaGalleryDetail, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const gallery = await galleryDetail(app.database!, request.params.id);
            if (gallery === undefined) throw notFound("Diese Galerie");
            return gallery;
        },
    );

    /**
     * Die Kartensammlung (WI-0068 R5), nur lesend: die Karten aus Legacy (Migration 0069) als eigenes Objekt der Medienverwaltung, mit
     * ihren Bildern und der Entscheidung der Policy je Bild. Kein Schreibweg: Bearbeiten erst nach der Entscheidung des Betreibers.
     */
    app.get(
        MEDIA_KARTEN_URL,
        {
            ...protect("view_media_private"),
            schema: { querystring: MamKartenAnfrage, response: { 200: MamKartenListe, ...ADMIN_ERRORS } },
        },
        async (request) => kartenListe(app.database!, request.query),
    );

    app.get(
        `${MEDIA_KARTEN_URL}/:id`,
        {
            ...protect("view_media_private"),
            schema: { params: ById, response: { 200: MamKarteDetail, ...ADMIN_ERRORS } },
        },
        async (request) => {
            const karte = await karteDetail(app.database!, request.params.id);
            if (karte === undefined) throw notFound("Diese Karte");
            return karte;
        },
    );
};
