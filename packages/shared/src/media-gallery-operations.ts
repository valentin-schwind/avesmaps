import { Type, type Static } from "@sinclair/typebox";
import { MEDIA_EDITOR_URL } from "./media-editor.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";

/**
 * Die Galerie als eigenes Medienobjekt im Schreibpfad (WI-0068 P6; Betreiber 2026-10-12: „eine galerie ist ein medientyp, der
 * bilder sammelt - ich erstelle eine galerie und kann dort bilder hinzufügen“; Betreiber 2026-10-12 zu mehreren Orten: „eine
 * galerie [darf] gern an mehreren orten hängen“; Betreiber 2026-10-13 zur Entwurfsgalerie).
 *
 * 🔴 **Jede dieser Operationen geht gegen die Revision der GALERIE**, nicht gegen die eines Eintrags. Die Revision der Galerie
 * steigt auch, wenn sich ein Eintrag ändert (Migration 0086) — EINE `baseRevision` schützt damit die ganze Folge, und zwei
 * Leute, die gleichzeitig ordnen, bekommen „Jemand war schneller“ statt eines stillen Überschreibens.
 *
 * 🔴 **Ein Ort hat EIN Titelbild ODER EINE Galerie** (Betreiber 2026-10-17, WI-0219): Das Einzelbild setzt `header.set`
 * (`media-editor-operations.ts`), die Galerie `gallery.bind`; jede Wahl löst, was bisher hängt. Diese Operationen arbeiten an der
 * GALERIE: eine Galerie ohne Ort anlegen, sie an einen zweiten Ort binden, eine Bindung lösen, ohne die Bilder anzufassen.
 */

const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const Revision = () => Type.Integer({ minimum: 1 });

export const MEDIA_GALLERY_OPS_URL = `${MEDIA_EDITOR_URL}/galleries`;
export const MEDIA_GALLERY_CREATE_URL = `${MEDIA_GALLERY_OPS_URL}/create`;
export const MEDIA_GALLERY_TITLE_URL = `${MEDIA_GALLERY_OPS_URL}/title`;
export const MEDIA_GALLERY_ORDER_URL = `${MEDIA_GALLERY_OPS_URL}/order`;
export const MEDIA_GALLERY_COVER_URL = `${MEDIA_GALLERY_OPS_URL}/cover`;
export const MEDIA_GALLERY_CAPTION_URL = `${MEDIA_GALLERY_OPS_URL}/caption`;
export const MEDIA_GALLERY_ADD_URL = `${MEDIA_GALLERY_OPS_URL}/add`;
export const MEDIA_GALLERY_REMOVE_URL = `${MEDIA_GALLERY_OPS_URL}/remove`;
export const MEDIA_GALLERY_BIND_URL = `${MEDIA_GALLERY_OPS_URL}/bind`;
export const MEDIA_GALLERY_UNBIND_URL = `${MEDIA_GALLERY_OPS_URL}/unbind`;
export const MEDIA_GALLERY_DELETE_URL = `${MEDIA_GALLERY_OPS_URL}/delete`;

/** Wie lang ein Titel und eine Bildunterschrift höchstens sind. */
export const MEDIA_GALLERY_TITLE_MAX = 200;
export const MEDIA_GALLERY_CAPTION_MAX = 500;
/**
 * Wie viele Bilder eine Galerie höchstens trägt. 🔴 Die frühere Grenze von 10 ist ENTFALLEN (Betreiber 2026-10-12: „keine
 * Zehnergrenze“); was hier steht, ist kein Produktmaß, sondern eine Schranke gegen eine Anfrage, die alles umsortieren will.
 */
export const MEDIA_GALLERY_ITEMS_MAX = 500;

/**
 * Eine Galerie anlegen — ohne Ort. Sie ist damit ein **Entwurf**: Ihre Bilder sind für Besucher unsichtbar, bis sie an einen Ort
 * gebunden wird (Betreiber 2026-10-13, Variante A des Blatts).
 */
export const MediaGalleryCreateBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        title: Type.Optional(Type.String({ maxLength: MEDIA_GALLERY_TITLE_MAX })),
    },
    strict,
);
export type MediaGalleryCreateBody = Static<typeof MediaGalleryCreateBody>;

/** Der Titel der Galerie; leer heißt „kein eigener Titel“, dann heißt sie in der Oberfläche nach ihren Orten. */
export const MediaGalleryTitleBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        title: Type.Union([Type.String({ maxLength: MEDIA_GALLERY_TITLE_MAX }), Type.Null()]),
    },
    strict,
);
export type MediaGalleryTitleBody = Static<typeof MediaGalleryTitleBody>;

/** Die Folge: GENAU die aktiven Einträge in neuer Reihenfolge (Asset-Kennungen). Fehlt einer oder ist einer zu viel: 400. */
export const MediaGalleryOrderBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        order: Type.Array(Uuid(), { minItems: 1, maxItems: MEDIA_GALLERY_ITEMS_MAX, uniqueItems: true }),
    },
    strict,
);
export type MediaGalleryOrderBody = Static<typeof MediaGalleryOrderBody>;

/**
 * Das Titelbild der Galerie. `null` nimmt die Setzung zurück; dann gilt wieder der erste Eintrag als Vorgabe der Oberfläche.
 * 🪤 Ein zurückgezogener Eintrag kann nie Titelbild sein — sonst zeigte die Galerie ein Bild, das sie nicht mehr führt.
 */
export const MediaGalleryCoverBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        assetId: Type.Union([Uuid(), Type.Null()]),
    },
    strict,
);
export type MediaGalleryCoverBody = Static<typeof MediaGalleryCoverBody>;

/** Die Bildunterschrift eines Eintrags; `null` oder leer entfernt sie. */
export const MediaGalleryCaptionBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        assetId: Uuid(),
        caption: Type.Union([Type.String({ maxLength: MEDIA_GALLERY_CAPTION_MAX }), Type.Null()]),
    },
    strict,
);
export type MediaGalleryCaptionBody = Static<typeof MediaGalleryCaptionBody>;

/** Ein Bild aus der Galerie nehmen: der Eintrag wird zurückgezogen, das Asset bleibt (ein Notaus oder Löschen ist etwas anderes). */
export const MediaGalleryRemoveBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        assetId: Uuid(),
    },
    strict,
);
export type MediaGalleryRemoveBody = Static<typeof MediaGalleryRemoveBody>;

/**
 * Die Galerie an einen Ort binden beziehungsweise die Bindung lösen.
 *
 * 🔴 **Binden und Lösen rühren die Bilder nicht an.** Lösen nimmt NUR diesem Ort die Galerie; die Bilder, die Folge und die
 * anderen Orte bleiben (Betreiber 2026-10-12). Und ein Ort hat entweder ein Titelbild ODER eine Galerie, nie beides (Betreiber
 * 2026-10-17: „EIN titelbild oder EINE Galerie“, WI-0219):
 * - Binden löst ein Einzelbild des Orts; es bleibt in der Medienverwaltung unter „Bilder“.
 * - Eine zweite Galerie am selben Ort weist der Server ab (409 `place_has_gallery`), außer der Ortseditor ersetzt sie ausdrücklich:
 *   `replaceRevision` ist die gesehene Revision der bisherigen Galerie, die dann gelöst wird und unter „Galerien“ bleibt.
 * - `replaceRevision` gilt nur fürs Binden, beim Lösen wird es abgewiesen.
 */
export const MediaGalleryBindBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        placeId: Uuid(),
        replaceRevision: Type.Optional(Revision()),
    },
    strict,
);
export type MediaGalleryBindBody = Static<typeof MediaGalleryBindBody>;

/** Warum eine Galerie nicht entfernt werden darf (`details.reason` bei 409 `media_not_deletable`). */
export const MEDIA_GALLERY_DELETE_HINDERNISSE = ["legacy", "bound", "foreign"] as const;
export type MediaGalleryDeleteHindernis = (typeof MEDIA_GALLERY_DELETE_HINDERNISSE)[number];

/**
 * Eine Galerie entfernen (Operation `gallery.delete`, WI-0068 R3 „Entfernen/Retire“; Paket „was beim Bedienen nicht geht“). Nach dem
 * Muster von „Endgültig löschen“ (Betreiber 2026-10-17, „A, nur eigene Uploads“) und R3 („kein verstecktes Entfernen gemeinsamer
 * Bindungen“): nur eine selbst in der Medienverwaltung angelegte Galerie, die an keinem Ort hängt. Die Bilder bleiben; es fallen die
 * Folge, Unterschriften, Cover und der Verlauf ihrer Ortsbindungen. Eine Legacy-Galerie bleibt (der nächste Import legte sie wieder an).
 */
export const MediaGalleryDeleteBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
    },
    strict,
);
export type MediaGalleryDeleteBody = Static<typeof MediaGalleryDeleteBody>;

/**
 * Ein Bild in die Galerie legen; `position` sagt wohin, ohne sie die letzte Stelle.
 *
 * Eine Zehnergrenze gibt es nicht mehr (Betreiber 2026-10-12, entscheidungen.md: „Grenze 10 entfällt“; ihr Grund, die Bildliste am Ort,
 * fiel mit WI-0219). Es bleibt nur der technische Deckel eines Auftrags (`MEDIA_GALLERY_ITEMS_MAX`), derselbe wie in `gallery.order`.
 */
export const MediaGalleryAddBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        galleryId: Uuid(),
        baseRevision: Revision(),
        assetId: Uuid(),
        position: Type.Optional(Type.Integer({ minimum: 0, maximum: MEDIA_GALLERY_ITEMS_MAX - 1 })),
    },
    strict,
);
export type MediaGalleryAddBody = Static<typeof MediaGalleryAddBody>;
