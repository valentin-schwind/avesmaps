import { Type, type Static } from "@sinclair/typebox";
import { HEADER_GRAPHICS, type HeaderGraphic } from "./header-graphics.ts";
import { MEDIA_PUBLIC_URL_PATTERN, MediaCredit } from "./media.ts";
import {
    MEDIA_CREATION_METHODS,
    MEDIA_EDITOR_URL,
    MEDIA_TYPE_IMAGE_VARIANTS,
    MediaPreview,
    MediaPrivatePreview,
} from "./media-editor.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";

/**
 * Typbilder (WI-0068, Betreiber 2026-10-11, wörtlich: „kannst du im MAM die neue kategorie „Typbilder“ machen, wo man sich typbilde
 * anlegen und für jede kategorie eins auswählen kann, markiere diese immer dann mit einem stern und erlaube, dass andere bilder aus
 * assets ausgewählt werden können, wobei das alte typbild seinen stern/status verliert.“).
 *
 * - Die Kategorien sind die Kopfgrafiken der Arten (`HEADER_GRAPHICS`, 43); die Zuordnung Art → Kategorie steht in `header-graphics.ts`.
 * - Je Kategorie trägt genau ein Asset den ★ (Tafel `media_type_image`, Migration 0113): das gültige Typbild. Ein anderes wählen heißt,
 *   der ★ wandert; das alte Asset bleibt und steht im Verlauf. Eine Operation mit Revision und Fachprotokoll.
 * - Öffentlich ist ein Typbild nur, wenn die EINE Entscheidung es erlaubt (Rolle `header`); sonst zeigt das Infopanel die eingebaute
 *   Grafik (bis zum Cutoff).
 * - „Eingebaute Typbilder übernehmen“: ein Klick legt die eingebauten Dateien als Assets mit ★ an, wo eine Kategorie noch keines hat.
 *   Die Rechte nach dem Betreiber (2026-10-12): „sie sind alle KI-erzeugt von mir“ (eigenes Werk, KI-erzeugt, Beleg mit Zitat).
 * - **Zwei Varianten je Kategorie** (WI-0281, Betreiber 2026-11-05): `ki` und `ohne_ki` (`MEDIA_TYPE_IMAGE_VARIANTS`), je mit eigenem ★, eigenem Verlauf
 *   und eigener Revision; ein Asset bleibt ein Asset mit eigener Herkunft und eigenen Rechten. Welches Asset in welche Variante darf, sagt die Entstehung
 *   (`typeImageVariantAccepts`). Die Felder der Vorversion (`current`, `former`, `formerItems`) tragen die KI-Variante, `ohneKi` die zweite.
 * - **Öffentlich** zeigt der Normalmodus die KI-Variante, sonst die Ohne-KI-Variante (`images`); der Modus „Ohne KI“ nur die Ohne-KI-Variante (`ohneKi`),
 *   und fehlt sie, einen neutralen Platzhalter, nie die KI-Variante und nie die eingebaute Grafik (die ist KI-erzeugt).
 */

export const MEDIA_TYPE_IMAGES_URL = `${MEDIA_EDITOR_URL}/type-images`;
export const MEDIA_TYPE_IMAGE_SET_URL = `${MEDIA_TYPE_IMAGES_URL}/set`;
export const MEDIA_TYPE_IMAGES_ADOPT_URL = `${MEDIA_TYPE_IMAGES_URL}/adopt`;
/** Eine Variante lösen, ohne ein anderes Bild zu setzen (WI-0281, Vali 2026-11-05: „im zweifel darf auch nix sein“). */
export const MEDIA_TYPE_IMAGE_RELEASE_URL = `${MEDIA_TYPE_IMAGES_URL}/release`;
/** Öffentlich: Kategorie → Adresse des veröffentlichten Typbilds. */
export const MEDIA_TYPE_IMAGES_PUBLIC_URL = "/api/media/type-images";

/** Das Zitat des Betreibers zu den Rechten der eingebauten Grafiken, wörtlich, mit Datum (Beleg an jedem übernommenen Asset). */
export const BUILTIN_TYPE_IMAGE_RIGHTS_QUOTE = "sie sind alle KI-erzeugt von mir";
export const BUILTIN_TYPE_IMAGE_RIGHTS_DATE = "2026-10-12";

const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const Revision = () => Type.Integer({ minimum: 1 });
const Category = () => Type.Union(HEADER_GRAPHICS.map((graphic) => Type.Literal(graphic)));

/** Wie viele frühere Typbilder je Kategorie mitkommen; der Verlauf wächst, der Inspector zeigt die jüngsten. */
export const MAM_TYPE_IMAGE_FORMER_LIMIT = 5;

/** Dieselben Werte wie `HeaderGraphicObjects` (`header-graphics.ts`), hier als Liste für das Schema. */
export const MEDIA_TYPE_IMAGE_OBJECTS = ["place", "landscape", "path", "other"] as const;

const Variant = () => Type.Union(MEDIA_TYPE_IMAGE_VARIANTS.map((variant) => Type.Literal(variant)));

/** Das gültige Typbild (★) einer Variante. */
const MamTypeImageCurrent = () =>
    Type.Object(
        {
            assetId: Uuid(),
            title: Type.Union([Type.String(), Type.Null()]),
            preview: Type.Union([MediaPreview, Type.Null()]),
            privatePreview: Type.Optional(Type.Union([MediaPrivatePreview, Type.Null()])),
            /** Revision der Zeile des ★ (`baseRevision` für den Wechsel). */
            revision: Revision(),
            since: Type.String(),
            /**
             * Ob Besucher es sehen: die Policy erlaubt es, und bei der Ohne-KI-Variante ist die Entstehung (noch) als ohne KI eingetragen. Sonst zeigt
             * das Infopanel die andere Variante, die eingebaute Grafik oder im Modus „Ohne KI“ den Platzhalter.
             */
            public: Type.Boolean(),
            /** Die Entstehung des Assets (WI-0281): Passt sie nicht zur Variante, sagt es der Inspector. Fehlt sie (Vorversion), ist sie unbekannt. */
            creationMethod: Type.Optional(Type.Union(MEDIA_CREATION_METHODS.map((method) => Type.Literal(method)))),
        },
        strict,
    );

/** Die früheren Typbilder einer Variante (neueste zuerst, höchstens `MAM_TYPE_IMAGE_FORMER_LIMIT`). */
const MamTypeImageFormerItems = () =>
    Type.Array(
        Type.Object(
            {
                assetId: Uuid(),
                title: Type.Union([Type.String(), Type.Null()]),
                preview: Type.Union([MediaPreview, Type.Null()]),
                /** Wann dieses Asset den ★ verlor. */
                retiredAt: Type.String(),
            },
            strict,
        ),
    );

/** Eine Variante einer Kategorie: ihr ★ (falls einer), wie viele Assets ihn früher trugen, die jüngsten davon. */
export const MamTypeImageSlot = Type.Object(
    {
        current: Type.Union([MamTypeImageCurrent(), Type.Null()]),
        former: Type.Integer({ minimum: 0 }),
        formerItems: MamTypeImageFormerItems(),
    },
    strict,
);
export type MamTypeImageSlot = Static<typeof MamTypeImageSlot>;

/**
 * Eine Kategorie in der Medienverwaltung: ihre zwei Varianten, wie viele Objekte sie zeigen. 🪤 `current`, `former` und `formerItems` sind die
 * KI-Variante (so liest sie die Vorversion als „den ★“), `ohneKi` ist die zweite Variante.
 */
export const MamTypeImage = Type.Object(
    {
        category: Category(),
        label: Type.String(),
        objects: Type.Union(MEDIA_TYPE_IMAGE_OBJECTS.map((value) => Type.Literal(value))),
        /** Wie viele aktive Objekte diese Grafik heute zeigen; `null`, wo es keine Zählung gibt (übrige). */
        count: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
        /** Das gültige KI-Typbild (★); `null`: noch keines, das Infopanel zeigt die Ohne-KI-Variante oder die eingebaute Grafik. */
        current: Type.Union([MamTypeImageCurrent(), Type.Null()]),
        /** Wie viele Assets früher den ★ der KI-Variante trugen. */
        former: Type.Integer({ minimum: 0 }),
        /**
         * Die jüngsten früheren KI-Typbilder (neueste zuerst, höchstens `MAM_TYPE_IMAGE_FORMER_LIMIT`): „das alte Typbild verliert
         * seinen Stern“ bleibt damit nachvollziehbar (Betreiber 2026-10-11). `former` zählt ALLE, auch die hier nicht gezeigten.
         */
        formerItems: MamTypeImageFormerItems(),
        /** Die Ohne-KI-Variante (WI-0281). Fehlt sie (Antwort der Vorversion), ist sie leer. */
        ohneKi: Type.Optional(MamTypeImageSlot),
    },
    strict,
);
export type MamTypeImage = Static<typeof MamTypeImage>;

export const MamTypeImageList = Type.Object(
    {
        items: Type.Array(MamTypeImage),
        /**
         * Wie viele eingebaute Grafiken der Klick „Eingebaute Typbilder übernehmen“ anlegen würde: Kategorien ohne KI-Variante (die eingebauten Grafiken sind
         * KI-erzeugt, sie gehören nur in die KI-Variante).
         */
        adoptable: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type MamTypeImageList = Static<typeof MamTypeImageList>;

/**
 * Den ★ einer Variante setzen (`baseRevision` der bisherigen ★-Zeile DIESER Variante, ohne bisherige weglassen). Ohne `variant` (Vorversion) die
 * KI-Variante. 🔴 Der Server prüft die Entstehung gegen die Variante (`typeImageVariantAccepts`): 409 `type_image_variant_mismatch`.
 */
export const MediaTypeImageSetBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        category: Category(),
        assetId: Uuid(),
        baseRevision: Type.Optional(Revision()),
        variant: Type.Optional(Variant()),
    },
    strict,
);
export type MediaTypeImageSetBody = Static<typeof MediaTypeImageSetBody>;

/**
 * Den ★ einer Variante lösen (WI-0281, Vali 2026-11-05: „ja im zweifel darf auch nix sein - und dann ist halt grau“): Die Zeile wird Verlauf, das Asset bleibt.
 * Danach gilt für die Variante, was ohne ★ gilt: im Normalmodus die andere Variante oder die eingebaute Grafik, im Modus „Ohne KI“ die graue Fläche. Die Variante
 * ist Pflicht (eine lösende Handlung rät nicht), `baseRevision` ist die der ★-Zeile dieser Variante.
 */
export const MediaTypeImageReleaseBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        category: Category(),
        variant: Variant(),
        baseRevision: Revision(),
    },
    strict,
);
export type MediaTypeImageReleaseBody = Static<typeof MediaTypeImageReleaseBody>;

/** „Eingebaute Typbilder übernehmen“: ein Klick; legt nur an, wo eine Kategorie noch keinen ★ hat. */
export const MediaTypeImagesAdoptBody = Type.Object({ operationId: MutationEnvelope.properties.operationId }, strict);
export type MediaTypeImagesAdoptBody = Static<typeof MediaTypeImagesAdoptBody>;

/** Ein öffentliches Typbild: Adresse, Maße und, wo die Rechte sie verlangen, die Nennung (ein Foto unter CC BY, WI-0281). */
const PublicTypeImage = () =>
    Type.Object(
        {
            url: Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN }),
            width: Type.Integer({ minimum: 1 }),
            height: Type.Integer({ minimum: 1 }),
            credit: Type.Optional(MediaCredit),
        },
        strict,
    );
const PublicTypeImages = () =>
    Type.Record(Type.String({ pattern: `^(${HEADER_GRAPHICS.join("|")})$` }), PublicTypeImage(), {
        additionalProperties: false,
    });

/**
 * Öffentlich: die Typbilder, die die Policy erlaubt.
 * - `images`: was der Normalmodus zeigt, die KI-Variante, sonst die Ohne-KI-Variante. Fehlt eine Kategorie, zeigt das Infopanel die eingebaute Grafik.
 * - `ohneKi` (WI-0281): was der Modus „Ohne KI“ zeigt, nur die Ohne-KI-Variante mit einer als ohne KI eingetragenen Entstehung. Fehlt eine Kategorie
 *   (oder das Feld, Antwort der Vorversion), zeigt das Infopanel im Modus „Ohne KI“ den neutralen Platzhalter.
 */
export const MediaTypeImagesPublic = Type.Object(
    {
        schemaVersion: Type.Literal(1),
        images: PublicTypeImages(),
        ohneKi: Type.Optional(PublicTypeImages()),
    },
    { $id: "MediaTypeImagesPublic", additionalProperties: false },
);
export type MediaTypeImagesPublic = Static<typeof MediaTypeImagesPublic>;

export const isHeaderGraphic = (value: string): value is HeaderGraphic =>
    (HEADER_GRAPHICS as readonly string[]).includes(value);
