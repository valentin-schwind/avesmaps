import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import {
    MEDIA_ASSET_TYPES,
    MEDIA_IMAGE_RELATIONS,
    MEDIA_KINDS,
    MEDIA_PUBLIC_URL_PATTERN,
    MEDIA_ROLES,
} from "./media.ts";
import { UUID_PATTERN } from "./operation.ts";
import {
    MAM_EINREICHUNGEN,
    PHOTOBOX_CREATION_KINDS,
    PHOTOBOX_SUBMISSION_STATES,
    PhotoboxSubmissionView,
} from "./photobox-sicht.ts";

/**
 * Die Lesemodelle der Medienverwaltung, des MAM (WI-0068 P2, §17; Betreiber 2026-10-09 zum Mockup-Blatt, Frage 1).
 *
 * 🔴 Jeder Pfad hier verlangt `view_media_private` (ab Reviewer, Stufe R): „MAM öffnen und private Angaben lesen“ ist EIN Recht.
 * Die Antworten liefern deshalb die privaten Felder mit; welche das sind, steht in der Positivliste `MEDIA_PRIVATE_FIELDS`
 * unten. Öffentliche Sichten (`MediaPublicView`, WI-0063) bleiben, wie sie sind, und tragen keins davon.
 *
 * - Keine Datenbankzeile roh: Kennungen sind die öffentlichen (`public_id`), nie die internen Schlüssel; Personen sind
 *   `{ id, displayName }` aus der pseudonymen `person.id`.
 * - Jede Antwort trägt die Revisionen ihrer Datensätze (ADR-0020); ein Schreibpfad schickt sie als `baseRevision` zurück.
 *   Antworten landen in keinem Cache (`no-store`).
 * - Die Operationen des Schreibpfads und das gemeinsame Upload-Formular stehen in `media-editor-operations.ts` (WI-0068 P4a).
 */

export const MEDIA_EDITOR_URL = "/api/editor/media";
export const MEDIA_EDITOR_NAVIGATION_URL = `${MEDIA_EDITOR_URL}/navigation`;
export const MEDIA_EDITOR_GALLERY_URL = "/api/editor/galleries";

export const mediaEditorAssetUrl = (id: string): string => `${MEDIA_EDITOR_URL}/${encodeURIComponent(id)}`;
export const mediaEditorUsageUrl = (id: string): string => `${mediaEditorAssetUrl(id)}/usage`;
export const mediaEditorGalleryUrl = (id: string): string => `${MEDIA_EDITOR_GALLERY_URL}/${encodeURIComponent(id)}`;

/**
 * Die private Vorschau (WI-0068 P4b, geschützter Bildweg): Bleibt ein Bild privat, rechnet der Hintergrunddienst dieselbe Fassung wie
 * für die Öffentlichkeit und legt sie unter `derivatives/` ab (Variante `intern_<variante>`). Nur `view_media_private` ruft sie ab,
 * nie aus einem Cache, nie das Original (EXIF, Aufnahmeort).
 */
export const MEDIA_INTERN_VARIANT_PATTERN = "^intern_[a-z0-9_]{1,57}$";
export const MEDIA_EDITOR_PREVIEW_URL_PATTERN = `^/api/editor/media/${UUID_PATTERN.slice(1, -1)}/preview/intern_[a-z0-9_]{1,57}$`;
export const mediaEditorPreviewUrl = (id: string, variant: string): string =>
    `${mediaEditorAssetUrl(id)}/preview/${encodeURIComponent(variant)}`;

/** Eine Aufzählung als Schema, ohne `$id` (dieselben Listen stehen in mehreren Routenschemata). */
function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}

const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const Revision = () => Type.Integer({ minimum: 1 });
const Count = () => Type.Integer({ minimum: 0 });
/** Ein Zeitpunkt als ISO-8601-Text (`toISOString()`). */
const Moment = () => Type.String({ minLength: 20 });
const Day = () => Type.String({ pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" });

// --- Die Wertelisten, wie die Datenbank sie mit CHECK hält (Migrationen 0064, 0068, 0069, 0086) ---

export const MEDIA_ORIGINS = [
    "legacy_import",
    "editor_upload",
    "community_upload",
    "wiki_import",
    "wiki_localized",
    "project_generated",
    "external_import",
] as const;
export const MEDIA_CREATION_METHODS = ["unknown", "photo", "drawing", "ai_generated", "scan", "derived"] as const;
export const MEDIA_TECHNICAL_STATES = ["pending", "ok", "missing_file", "decode_failed", "unsupported_format"] as const;
export const MEDIA_MODERATION_STATES = ["not_applicable", "pending", "approved", "rejected"] as const;
export const MEDIA_RIGHTS_BASES = [
    "public_domain",
    "license",
    "permission",
    "fan_policy",
    "own_work",
    "unknown",
] as const;
export const MEDIA_CLEARANCE_STATES = [
    "unreviewed",
    "legacy_assumed",
    "legacy_asserted",
    "needs_review",
    "cleared",
    "rejected",
] as const;
export const MEDIA_STORAGE_CLASSES = ["private_source", "master", "derivative", "published"] as const;
export const MEDIA_INGEST_KINDS = [
    "editor_upload",
    "community_upload",
    "legacy_import",
    "wiki_import",
    "system_import",
    "generated",
] as const;
export const MEDIA_PUBLICATION_OVERRIDES = ["none", "approved", "blocked"] as const;
export const MEDIA_BINDING_ORIGINS = ["legacy", "wiki_localized", "editor"] as const;
export const MEDIA_GALLERY_KINDS = ["object_gallery", "editorial", "photobox"] as const;
export const MEDIA_GALLERY_PUBLICATION_STATES = ["draft", "published", "suppressed"] as const;
/**
 * `photobox`: die Ortsbindung stammt aus Reisebildern (WI-0272); `place_media_gallery.origin` kennt den Wert seit Migration 0274.
 * 🪤 `media_gallery.origin` (eigener CHECK `media_gallery_origin_known`) bleibt bei `legacy` und `editor`; die Liste gilt für beide Tafeln.
 */
export const MEDIA_GALLERY_ORIGINS = ["legacy", "editor", "photobox"] as const;
/** 🪤 Die Galerie hat EIGENE, kürzere Wertelisten als ein Asset; wer die des Assets nimmt, trifft die falsche Tafel. */
export type MediaGalleryKind = (typeof MEDIA_GALLERY_KINDS)[number];
export type MediaGalleryPublicationState = (typeof MEDIA_GALLERY_PUBLICATION_STATES)[number];
export type MediaGalleryOrigin = (typeof MEDIA_GALLERY_ORIGINS)[number];
export const MEDIA_SUSPENSION_FILE_STATES = ["pending", "quarantined", "restored"] as const;
export const MEDIA_EVIDENCE_KINDS = [
    "email",
    "pdf",
    "document",
    "license_page",
    "source_page",
    "operator_note",
] as const;

export type MediaOrigin = (typeof MEDIA_ORIGINS)[number];
export type MediaCreationMethod = (typeof MEDIA_CREATION_METHODS)[number];
export type MediaTechnicalState = (typeof MEDIA_TECHNICAL_STATES)[number];
export type MediaModerationState = (typeof MEDIA_MODERATION_STATES)[number];
export type MediaRightsBasis = (typeof MEDIA_RIGHTS_BASES)[number];
export type MediaClearanceState = (typeof MEDIA_CLEARANCE_STATES)[number];
export type MediaPublicationOverride = (typeof MEDIA_PUBLICATION_OVERRIDES)[number];

/**
 * Warum ein Medium in einer Rolle öffentlich ist oder nicht: die Grundcodes der EINEN Entscheidung
 * (`apps/server/src/media/policy.ts`, `decidePublication`). Sie stehen hier, damit das MAM sie zeigen und übersetzen kann.
 */
export const MEDIA_ALLOW_REASONS = ["automatic", "rule", "override_approved"] as const;
export const MEDIA_DENY_REASONS = [
    "role_mismatch",
    "kind_not_public",
    "suppressed",
    "retired",
    "blocked",
    "technical_state_not_ok",
    "moderation_pending",
    "moderation_rejected",
    "rights_missing",
    "rights_unknown",
    "clearance_rejected",
    "no_published_representation",
    "svg_not_public",
    "not_webp",
    "attribution_required",
    "permission_needs_approval",
    "fan_policy_needs_approval",
    "legacy_assumed",
    "clearance_pending",
    // Ein Einzelbild-Notaus hält die Bytes des Originals (Code-Review 2026-10-16 S8-04), gleich wo die Datei gerade liegt.
    "publication_suspended",
    // Ein Inhaltsschalter der Systemsteuerung (WI-0127 SYS-10) hält ein Bild zurück, das sonst öffentlich wäre.
    "switched_off",
] as const;
export type MediaAllowReason = (typeof MEDIA_ALLOW_REASONS)[number];
export type MediaDenyReason = (typeof MEDIA_DENY_REASONS)[number];

/**
 * Die Fachobjekte, die ein Medium verwenden (typisierte Bindungen, keine `entity_type`-Relation). Ort und Gebiet haben eine
 * Kartenlage („Auf Karte zeigen“, WI-0068 §8); Werk und Karte der Kartensammlung sind Katalogobjekte.
 */
export const MEDIA_USAGE_SUBJECT_KINDS = ["place", "territory", "adventure", "citymap"] as const;
export type MediaUsageSubjectKind = (typeof MEDIA_USAGE_SUBJECT_KINDS)[number];
export const MEDIA_USAGE_ON_MAP: Readonly<Record<MediaUsageSubjectKind, boolean>> = {
    place: true,
    territory: true,
    adventure: false,
    citymap: false,
};

// --- Bausteine ---

/** Eine Person über ihre pseudonyme Kennung; aufgelöste Konten heißen „Ehemalige Person …“ (AUTH-0001 §5). */
export const MediaPersonRef = Type.Object({ id: Uuid(), displayName: Type.String() }, strict);
export type MediaPersonRef = Static<typeof MediaPersonRef>;

/** Ein in diesem Werk aufgegangenes Werk (WI-0068 D1): wer es wann zusammengeführt hat. */
export const MediaMergedHere = Type.Object(
    { assetId: Uuid(), title: nullable(Type.String()), mergedAt: Moment(), mergedBy: nullable(MediaPersonRef) },
    strict,
);
export type MediaMergedHere = Static<typeof MediaMergedHere>;

export const MediaUsageSubject = Type.Object(
    {
        kind: oneOf(MEDIA_USAGE_SUBJECT_KINDS),
        id: Uuid(),
        name: Type.String(),
        /** `false`: das Fachobjekt ist stillgelegt (`is_active`), die Bindung steht aber noch. */
        active: Type.Boolean(),
    },
    strict,
);
export type MediaUsageSubject = Static<typeof MediaUsageSubject>;

/** Eine veröffentlichte Datei als Vorschau im MAM: dieselbe Adresse, die auch Besucher abrufen können. */
export const MediaPreview = Type.Object(
    {
        url: Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN }),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type MediaPreview = Static<typeof MediaPreview>;

/** Die private Vorschau eines Bildes ohne öffentliche Datei (WI-0068 P4b): nur mit `view_media_private`, `no-store`. */
export const MediaPrivatePreview = Type.Object(
    {
        url: Type.String({ pattern: MEDIA_EDITOR_PREVIEW_URL_PATTERN }),
        width: Type.Integer({ minimum: 1 }),
        height: Type.Integer({ minimum: 1 }),
    },
    strict,
);
export type MediaPrivatePreview = Static<typeof MediaPrivatePreview>;

/** Die Entscheidung der Policy für eine Verwendung, wie der Resolver sie heute trifft. */
export const MediaUsagePublication = Type.Object(
    {
        public: Type.Boolean(),
        reason: oneOf([...MEDIA_ALLOW_REASONS, ...MEDIA_DENY_REASONS] as const),
    },
    strict,
);
export type MediaUsagePublication = Static<typeof MediaUsagePublication>;

/** Die bewusste Einzelfreigabe oder -sperre an einer Verwendung (Bindung oder Galerieeintrag). */
export const MediaUsageOverride = Type.Object(
    {
        state: oneOf(MEDIA_PUBLICATION_OVERRIDES),
        decidedOn: nullable(Day()),
        /** PRIVAT: wer entschied (Person). */
        decidedBy: nullable(MediaPersonRef),
        /** PRIVAT: die Begründung der Person. */
        reason: nullable(Type.String()),
        /** PRIVAT: das wörtliche Betreiberzitat. */
        operatorQuote: nullable(Type.String()),
    },
    strict,
);
export type MediaUsageOverride = Static<typeof MediaUsageOverride>;

/**
 * Der Bildbezug einer Verwendung eines Titelbildes an einem Ort (Betreiber 2026-10-11, „1A … 2 B … 3 A ja das gilt für alle“), wie der
 * Ortseditor und die Verwendungen der Medienverwaltung ihn zeigen: was gilt (`value`), was die Regel allein sagt (`rule`: dieselbe
 * Quelldatei an genau einem aktiven Ort ist Ortsansicht), die Übersteuerung eines Menschen (`override`, `null`: die Regel gilt) und an
 * wie vielen aktiven Orten die Datei als Titelbild hängt (`places`). Geschrieben über die Operation `header.relation`.
 */
export const MediaImageRelationState = Type.Object(
    {
        value: oneOf(MEDIA_IMAGE_RELATIONS),
        rule: oneOf(MEDIA_IMAGE_RELATIONS),
        override: nullable(oneOf(MEDIA_IMAGE_RELATIONS)),
        places: Type.Integer({ minimum: 0 }),
    },
    strict,
);
export type MediaImageRelationState = Static<typeof MediaImageRelationState>;

/**
 * Eine Verwendung (Reverse Usage, WI-0068 §8): direkt über eine Bindung oder über einen Galerieeintrag. Ein Eintrag einer
 * Galerie ohne Bindung steht mit `subject` und `role` `null` da (die Galerie verwendet das Bild, aber kein Fachobjekt die
 * Galerie). Nur aktive Verwendungen; zurückgezogene zählt `MediaUsageResult.retired`.
 */
/**
 * Wie ein Medium verwendet wird: direkt an einem Fachobjekt, als Eintrag einer Galerie oder als Typbild (★) einer Kategorie
 * (Migration 0113, Code-Review 2026-10-16 S8-03). Ein Typbild hat kein Fachobjekt, sondern die Kategorie (`typeImage`).
 */
export const MEDIA_USAGE_VIAS = ["binding", "gallery", "type_image"] as const;
export type MediaUsageVia = (typeof MEDIA_USAGE_VIAS)[number];

/**
 * Die zwei Varianten einer Typbildkategorie (WI-0281, Betreiber 2026-11-05: „jede Typbildkategorie zwei Typbilder“): `ki`, die KI-generierte Illustration,
 * die der Normalmodus bevorzugt, und `ohne_ki`, eine Illustration, deren Entstehung ohne KI eingetragen ist; nur sie zeigt der Modus „Ohne KI“. Zwei
 * Zuordnungen DERSELBEN Kategorie (Spalte `media_type_image.variant`, Migration 0314), keine zweite Kategorie und kein zweites Asset.
 */
export const MEDIA_TYPE_IMAGE_VARIANTS = ["ki", "ohne_ki"] as const;
export type MediaTypeImageVariant = (typeof MEDIA_TYPE_IMAGE_VARIANTS)[number];

/**
 * Die Entstehungen, die als „ohne KI“ gelten: eingetragen als Foto, Zeichnung oder Scan (`media_asset.creation_method`).
 * 🔴 `unknown` und `derived` gelten NIE als ohne KI (Betreiber 2026-11-05: „Unbekannte Herkunft bleibt unbekannt und darf nicht automatisch als
 * ‚Ohne KI‘ gelten“): Eine Nicht-KI-Herkunft wird nie aus dem Aussehen oder aus fehlenden KI-Angaben geschlossen, sie steht in der Entstehung.
 */
export const OHNE_KI_CREATION_METHODS = ["photo", "drawing", "scan"] as const satisfies readonly MediaCreationMethod[];

/** Ist die Entstehung als ohne KI eingetragen? */
export const istOhneKiEntstehung = (method: string | null | undefined): boolean =>
    method !== null && method !== undefined && (OHNE_KI_CREATION_METHODS as readonly string[]).includes(method);

/**
 * Passt ein Asset dieser Entstehung in die Variante? `ohne_ki` nimmt nur Foto, Zeichnung und Scan. `ki` nimmt alles andere: KI-generiert, aber
 * auch unbekannt und abgeleitet, denn Unbekanntes gilt nie als ohne KI. So kann dasselbe Asset nie in beiden Varianten einer Kategorie stehen.
 */
export const typeImageVariantAccepts = (variant: MediaTypeImageVariant, method: string | null | undefined): boolean =>
    variant === "ohne_ki" ? istOhneKiEntstehung(method) : !istOhneKiEntstehung(method);

/** Die Kategorie eines Typbilds (`HEADER_GRAPHICS`) samt ihrem Namen, wie die Liste der Typbilder ihn zeigt. */
export const MediaUsageTypeImage = Type.Object(
    {
        category: Type.String(),
        label: Type.String(),
        /** Welche der zwei Varianten (WI-0281); fehlt es (Vorversion), ist es die KI-Variante. */
        variant: Type.Optional(oneOf(MEDIA_TYPE_IMAGE_VARIANTS)),
    },
    strict,
);
export type MediaUsageTypeImage = Static<typeof MediaUsageTypeImage>;

/**
 * Warum „Vorschau erzeugen“ an einer Karte gesperrt ist (WI-0287 Stufe 1, Punkt 5; Entwurf Fassung 5 `sperrgrund`, in dieser Reihenfolge): ihr Notaus gilt
 * (`suspended`), ihre Rechtsgrundlage ist unbekannt (`rights_unknown`, `decidePublication` könnte nie freigeben), oder ihre Datei fehlt (`file_missing`). Eine offene
 * Rechteprüfung sperrt nicht: Die Vorschau entsteht und bleibt privat, bis die Karte geklärt ist.
 */
export const KARTE_VORSCHAU_SPERREN = ["suspended", "rights_unknown", "file_missing"] as const;
export type KarteVorschauSperre = (typeof KARTE_VORSCHAU_SPERREN)[number];

/** Ein Werk mit Titel, als Ziel eines Sprungs (erzeugte Vorschau, Karte, aus der sie entstand). */
const WerkBezug = Type.Object({ assetId: Uuid(), title: nullable(Type.String()) }, strict);

export const MediaUsage = Type.Object(
    {
        via: oneOf(MEDIA_USAGE_VIAS),
        subject: nullable(MediaUsageSubject),
        role: nullable(oneOf(MEDIA_ROLES)),
        gallery: nullable(
            Type.Object(
                {
                    id: Uuid(),
                    title: nullable(Type.String()),
                    kind: oneOf(MEDIA_GALLERY_KINDS),
                    position: Type.Integer(),
                },
                strict,
            ),
        ),
        /** Herkunft der Bindung; bei einem Galerieeintrag die der Galeriebindung (`null` ohne Bindung). */
        origin: nullable(oneOf(MEDIA_BINDING_ORIGINS)),
        /** Revision der Bindung oder des Galerieeintrags (ADR-0020). */
        revision: Revision(),
        /** Seit wann es die Verwendung gibt: Anlage der Bindung, des Galerieeintrags oder des ★ (WI-0068 R4). */
        since: Type.Optional(Day()),
        override: MediaUsageOverride,
        /** `null` ohne Rolle (Galerie ohne Bindung): dann gibt es nichts zu entscheiden. */
        publication: nullable(MediaUsagePublication),
        /** Nur bei einem Titelbild an einem Ort: sein Bildbezug (Ortsansicht oder Typbild, Betreiber 2026-10-11). */
        relation: Type.Optional(MediaImageRelationState),
        /** Nur bei `via: "type_image"`: die Kategorie, deren ★ das Medium ist. */
        typeImage: Type.Optional(MediaUsageTypeImage),
        /**
         * Nur bei einer Karte der Kartensammlung in der Rolle `map_full`, und nur in Reverse Usage des Werks selbst (WI-0287 Punkt 5, „Vorschau erzeugen“ im Inspector): die
         * Revision des Eintrags, auf die die Operation baut, und seine aktive Vorschau (`null`: keine).
         */
        citymap: Type.Optional(Type.Object({ revision: Revision(), preview: nullable(WerkBezug) }, strict)),
    },
    strict,
);
export type MediaUsage = Static<typeof MediaUsage>;

// --- Liste, Suche, Navigation (Spalten 1 und 2) ---

/**
 * Die Prüfkörbe der Spalte 1 (WI-0068 §3.1), als EINE Liste; die Bedingungen stehen an einer Stelle im Server
 * (`apps/server/src/media-editor/search.ts`), die Navigation zählt mit denselben.
 *
 * - `rights_open`: keine Rechtezeile, Rechtsgrund `unknown` oder Prüfstand `unreviewed`, `needs_review`, `legacy_assumed`.
 * - `legacy_assumed`: die Importannahme (§6), schnell einzeln zu prüfen.
 * - `unused`, `multiple`: keine oder mehr als eine aktive Verwendung.
 * - `shared_file`: dasselbe Original (SHA-256) trägt noch ein anderes Asset (Hinweis, nie Zusammenführung).
 * - `missing_file`: noch keine Bytes (`pending`) oder Datei fehlt; `technical`: Format abgewiesen oder unlesbar.
 * - `missing_derivative` (WI-0068 P4b, 6c): die Entscheidung erlaubt das Bild öffentlich (so wie der Dateilauf sie fragt), aber unter
 *   `published/` fehlt die Variante der Rolle; ohne Notaus und technisch gut. Der Server rechnet es mit der Policy, keine SQL-Bedingung.
 *   Ein Wappen aus dem Editor mit undurchsichtigen Ecken fehlt nicht: Es bleibt absichtlich privat und steht in `coat_defects`.
 * - `coat_defects` (WI-0068 P4b T2b, „Wappen mit Mängeln“): ein Wappen, dessen Ecken nicht durchsichtig sind (Messung der Pipeline,
 *   `media_file.corners_transparent`), oder ein Wappen aus Legacy, das nicht quadratisch ist (aus den Maßen des Originals; ein Wappen
 *   aus dem Editor wird zum Quadrat aufgefüllt). Befund, nichts blockiert.
 * - `unpublished`: keine Datei unter `published/` (die Policy hat sie beim Medienlauf nicht freigegeben).
 * - `suspended`: ein Einzelbild-Notaus gilt für das Original.
 * - `former_ai_assumption` („Rechte prüfen: früher als KI angenommen“, Betreiber 2026-10-10): aus Legacy übernommen, eigenes Werk, aber
 *   nicht (mehr) KI-generiert, und die Rechte sind nicht geprüft. Die alten Klassenregeln für Wappen und Ortsbilder nahmen jedes eigene
 *   Werk als KI an; die neuen tragen nur KI-generierte (`own_work` UND `ai_generated`).
 * - `photobox_uploads` (WI-0272 S3, „PhotoBox-Uploads“): jedes Asset, das eine Einreichung eines Besuchers ist (`media_ingest.submission_id`, das
 *   aktuelle Bild der Einreichung). Die Schiene zeigt ihn unter „Eingänge“, nicht unter „Prüfen“; die Unterteilung `einreichung` trennt
 *   `offen`, `rueckfrage` und `erledigt` (`photoboxUnterteilung`).
 */
export const MAM_BASKETS = [
    "rights_open",
    "former_ai_assumption",
    "legacy_assumed",
    "unused",
    "multiple",
    "shared_file",
    "missing_file",
    "missing_derivative",
    "coat_defects",
    "technical",
    "unpublished",
    "suspended",
    "photobox_uploads",
] as const;
export type MamBasket = (typeof MAM_BASKETS)[number];

export const MAM_SORTS = ["name", "changed", "usage", "rights"] as const;
export type MamSort = (typeof MAM_SORTS)[number];

export const MAM_PAGE_LIMIT = { default: 50, max: 200 } as const;

/**
 * Die Suche (Spalte 2). `q` sucht ohne Groß- und Kleinschreibung in Titel, Urheber, Rechteinhaber, Quellschlüssel und im Namen
 * eines verwendenden Fachobjekts; `subject` nimmt genau ein Fachobjekt über seine Kennung (`place:<uuid>`).
 */
export const MamSearchQuery = Type.Object(
    {
        q: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
        kind: Type.Optional(oneOf(MEDIA_KINDS)),
        /** Der Asset-Typ (Wappen, Bild …, Betreiber 2026-10-10); Spalte 1 wählt ihn. */
        type: Type.Optional(oneOf(MEDIA_ASSET_TYPES)),
        role: Type.Optional(oneOf(MEDIA_ROLES)),
        creation: Type.Optional(oneOf(MEDIA_CREATION_METHODS)),
        origin: Type.Optional(oneOf(MEDIA_ORIGINS)),
        rightsBasis: Type.Optional(oneOf(MEDIA_RIGHTS_BASES)),
        clearance: Type.Optional(oneOf(MEDIA_CLEARANCE_STATES)),
        technical: Type.Optional(oneOf(MEDIA_TECHNICAL_STATES)),
        basket: Type.Optional(oneOf(MAM_BASKETS)),
        /** Nur Einreichungen eines Teils des Korbs „PhotoBox-Uploads“ (WI-0272 S3); gilt auch ohne den Korb und lässt dann nur Einreichungen übrig. */
        einreichung: Type.Optional(oneOf(MAM_EINREICHUNGEN)),
        subject: Type.Optional(
            Type.String({ pattern: `^(${MEDIA_USAGE_SUBJECT_KINDS.join("|")}):${UUID_PATTERN.slice(1, -1)}$` }),
        ),
        /**
         * Je Gruppe bytegleicher Werke nur EINES zeigen, das älteste (WI-0068 P6).
         *
         * 🔴 Für eine AUSWAHL gedacht: Wer ein Bild in eine Galerie legen will, soll es einmal sehen und nicht
         * fünfmal, weil Legacy je Verwendung ein eigenes Werk anlegte (§21). Der Filter wirkt über Seitengrenzen, eine
         * Zusammenfassung in der Oberfläche täte das nicht. `sharedFileCount` sagt an der Zeile, wie viele weitere es gibt,
         * und `total` zählt dann Gruppen statt Werke.
         *
         * 🪤 Die VERWALTUNG zeigt weiter alle Werke: Dort geht es gerade darum, Dubletten zu finden (Korb `shared_file`).
         */
        groupFiles: Type.Optional(Type.Boolean()),
        /**
         * Reisebilder (Einreichungen von Besuchern, WI-0272) weglassen. 🔴 Für jede AUSWAHL gedacht (Wappen, Titelbild, Galerie, Typbild): Ein Reisebild bleibt in seiner Rolle `photobox` und lässt sich
         * nirgends einbinden (Server: 409 `media_photobox_not_bindable`); die Auswahl soll es gar nicht erst anbieten. Die VERWALTUNG zeigt sie weiter (Korb „PhotoBox-Uploads“).
         */
        ohneReisebilder: Type.Optional(Type.Boolean()),
        sort: Type.Optional(oneOf(MAM_SORTS)),
        order: Type.Optional(oneOf(["asc", "desc"] as const)),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAM_PAGE_LIMIT.max })),
        offset: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
    },
    strict,
);
export type MamSearchQuery = Static<typeof MamSearchQuery>;

/** Wie das MAM ein Asset ohne Titel nennt („Gareth · Wappen“): die erste Verwendung. */
export const MamUsageLabel = Type.Object(
    {
        subject: nullable(MediaUsageSubject),
        role: nullable(oneOf(MEDIA_ROLES)),
        gallery: nullable(Type.Object({ id: Uuid(), title: nullable(Type.String()) }, strict)),
        /** Ist die erste Verwendung ein Typbild (★), seine Kategorie. */
        typeImage: Type.Optional(MediaUsageTypeImage),
    },
    strict,
);
export type MamUsageLabel = Static<typeof MamUsageLabel>;

/**
 * Die Einreichung hinter einer Zeile der Liste (WI-0272 S3): was die Zeile braucht, um sie ohne Öffnen zu lesen. PRIVAT wie die ganze Zeile der
 * Medienverwaltung; `unterteilung` ist der Teil des Korbs „PhotoBox-Uploads“, in dem sie steht.
 */
export const MamSubmissionLabel = Type.Object(
    {
        zustand: oneOf(PHOTOBOX_SUBMISSION_STATES),
        unterteilung: oneOf(MAM_EINREICHUNGEN),
        /** Die geltende Beschreibung des Einreichers; die Liste nennt das Werk danach, solange es keinen Titel trägt. `null` bei einer geleerten Einreichung. */
        beschreibung: nullable(Type.String()),
        eingereichtAm: Moment(),
        entstehung: oneOf(PHOTOBOX_CREATION_KINDS),
        /** Der Ort, auf den sich das Bild bezieht; `null` ohne. */
        ortName: nullable(Type.String()),
    },
    strict,
);
export type MamSubmissionLabel = Static<typeof MamSubmissionLabel>;

export const MamAssetSummary = Type.Object(
    {
        id: Uuid(),
        revision: Revision(),
        title: nullable(Type.String()),
        kind: oneOf(MEDIA_KINDS),
        /** Der Asset-Typ; `null` nur für ein Asset vor Migration 0095 ohne Klasse und Verwendung. */
        assetType: nullable(oneOf(MEDIA_ASSET_TYPES)),
        origin: oneOf(MEDIA_ORIGINS),
        creationMethod: oneOf(MEDIA_CREATION_METHODS),
        technicalState: oneOf(MEDIA_TECHNICAL_STATES),
        rightsBasis: nullable(oneOf(MEDIA_RIGHTS_BASES)),
        clearance: nullable(oneOf(MEDIA_CLEARANCE_STATES)),
        usageCount: Count(),
        /** Andere Assets mit demselben Original (SHA-256). */
        sharedFileCount: Count(),
        /**
         * Die Gruppe bytegleicher Werke, als Kennung ihres ältesten Mitglieds; `null`, wenn das Werk seine Datei allein trägt.
         *
         * 🔴 Legacy legte je Verwendung ein eigenes Werk an: 1.025 Assets teilen ihre Quelldatei mit einem anderen (§21,
         * Korb `shared_file`). Eine Auswahl, die danach nicht gruppiert, zeigt dasselbe Bild mehrfach — wer es sucht, wählt
         * zufällig eines der Werke, und die Dublette wandert weiter. Die Kennung ist stabil, solange die Gruppe besteht, und
         * überlebt das spätere Zusammenführen (D1): Danach ist nur noch ein Werk übrig und `fileGroup` wieder `null`.
         *
         * 🪤 Sie ist eine Asset-Kennung, kein Hash: Die SHA-256 ist ein privates Feld und gehört nicht in eine Liste.
         */
        fileGroup: nullable(Uuid()),
        primaryUsage: nullable(MamUsageLabel),
        preview: nullable(MediaPreview),
        /** PRIVAT: die private Vorschau, wenn keine öffentliche Datei da ist. Optional: ein Server der Vorversion schickt sie nicht. */
        privatePreview: Type.Optional(nullable(MediaPrivatePreview)),
        /** Eine Datei liegt unter `published/`. */
        published: Type.Boolean(),
        /** Ein Einzelbild-Notaus gilt für das Original. */
        suspended: Type.Boolean(),
        updatedAt: Moment(),
        /**
         * PRIVAT: wer es hochlud (Editor-Upload) für „hochgeladen von …“ in der Auswahl (WI-0068 P4b, WI-0126 §11j); bei Legacy-Medien
         * `null`, dann nennt `uploadedByLabel` Legacys `uploaded_by`, wo es ihn gibt (17 von 2.513). Optional: ein Server der Vorversion
         * schickt beides nicht.
         */
        uploadedBy: Type.Optional(nullable(MediaPersonRef)),
        /** PRIVAT: Legacys `uploaded_by` als Text. */
        uploadedByLabel: Type.Optional(nullable(Type.String())),
        /** Wann es hereinkam: Legacys Hochladedatum, sonst der Eingang. */
        uploadedAt: Type.Optional(nullable(Moment())),
        /** PRIVAT: Die Einreichung eines Besuchers hinter diesem Asset (WI-0272 S3); `null` bei jedem anderen Asset. Optional: ein Server der Vorversion schickt es nicht. */
        submission: Type.Optional(nullable(MamSubmissionLabel)),
    },
    strict,
);
export type MamAssetSummary = Static<typeof MamAssetSummary>;

export const MamSearchResult = Type.Object(
    {
        items: Type.Array(MamAssetSummary),
        total: Count(),
        limit: Type.Integer({ minimum: 1 }),
        offset: Count(),
    },
    strict,
);
export type MamSearchResult = Static<typeof MamSearchResult>;

export const MamNavigation = Type.Object(
    {
        total: Count(),
        kinds: Type.Object({ image: Count(), model_3d: Count() }, strict),
        /** Assets je Asset-Typ (Spalte 1); was keinen Typ hat, zählt nur in `total`. */
        types: Type.Object(
            Object.fromEntries(MEDIA_ASSET_TYPES.map((type) => [type, Count()])) as Record<
                (typeof MEDIA_ASSET_TYPES)[number],
                ReturnType<typeof Count>
            >,
            strict,
        ),
        galleries: Count(),
        citymaps: Count(),
        /** Die PhotoBox-Galerien: Orte mit freigegebenen Reisebildern, dazu die Sammlung ohne Ort, wenn es Bilder an freien Stellen gibt. */
        photoboxGalerien: Count(),
        /**
         * Typbilder: wie viele der 37 Kategorien heute einen ★ tragen (`media_type_image`, Migration 0113). Die Liste zeigt immer
         * alle 37 und sagt bei jeder ohne ★, dass dort die eingebaute Grafik gilt — die Zahl in der Schiene ist der Stand, nicht
         * die Größe der Liste.
         */
        typeImages: Count(),
        baskets: Type.Object(
            Object.fromEntries(MAM_BASKETS.map((basket) => [basket, Count()])) as Record<
                MamBasket,
                ReturnType<typeof Count>
            >,
            strict,
        ),
        /** Die Teile des Korbs „PhotoBox-Uploads“ mit ihrer Zahl (WI-0272 S3). Optional: ein Server der Vorversion schickt sie nicht. */
        einreichungen: Type.Optional(Type.Object({ offen: Count(), rueckfrage: Count(), erledigt: Count() }, strict)),
    },
    strict,
);
export type MamNavigation = Static<typeof MamNavigation>;

// --- Das Asset (Spalte 3, Inspector in der Reihenfolge von WI-0068 §3.3) ---

export const MediaAssetCore = Type.Object(
    {
        id: Uuid(),
        revision: Revision(),
        title: nullable(Type.String()),
        kind: oneOf(MEDIA_KINDS),
        assetType: nullable(oneOf(MEDIA_ASSET_TYPES)),
        origin: oneOf(MEDIA_ORIGINS),
        creationMethod: oneOf(MEDIA_CREATION_METHODS),
        technicalState: oneOf(MEDIA_TECHNICAL_STATES),
        moderationState: oneOf(MEDIA_MODERATION_STATES),
        degradedOriginal: Type.Boolean(),
        sourceSystem: Type.String(),
        sourceRef: nullable(Type.String()),
        createdAt: Moment(),
        updatedAt: Moment(),
        importedAt: nullable(Moment()),
    },
    strict,
);
export type MediaAssetCore = Static<typeof MediaAssetCore>;

/** Rechte (WI-0068 §7): gespeichert ist nicht geprüft, geprüft ist nicht in jeder Rolle öffentlich. */
export const MediaRightsEditorView = Type.Object(
    {
        revision: Revision(),
        basis: oneOf(MEDIA_RIGHTS_BASES),
        licenseKey: nullable(Type.String()),
        licenseFamily: nullable(Type.String()),
        licenseName: nullable(Type.String()),
        licenseUri: nullable(Type.String()),
        requiresAttribution: nullable(Type.Boolean()),
        creator: nullable(Type.String()),
        rightsHolder: nullable(Type.String()),
        attribution: nullable(Type.String()),
        clearance: oneOf(MEDIA_CLEARANCE_STATES),
        reviewedAt: nullable(Moment()),
        updatedAt: Moment(),
        /** PRIVAT: interne Rechtenotiz. */
        rightsNote: nullable(Type.String()),
        /** PRIVAT: Legacys Rechtecode als Evidenz der Migration. */
        legacyRightsCode: nullable(Type.String()),
        /** PRIVAT: Rechteprüfer als Text (Legacy). */
        reviewedBy: nullable(Type.String()),
        /** PRIVAT: Rechteprüfer als Person. */
        reviewer: nullable(MediaPersonRef),
    },
    strict,
);
export type MediaRightsEditorView = Static<typeof MediaRightsEditorView>;

/** Entstehung (WI-0068 §6): ganz privat, nur die Revision nicht. KI-Erzeugung ist keine Lizenz. */
export const MediaCreationEditorView = Type.Object(
    {
        revision: Revision(),
        updatedAt: Moment(),
        tool: nullable(Type.String()),
        model: nullable(Type.String()),
        prompt: nullable(Type.String()),
        negativePrompt: nullable(Type.String()),
        parameters: nullable(Type.Record(Type.String(), Type.Unknown())),
        /** Legacys Notiz, Kommentar und Prompt gemischt, nicht geraten aufgeteilt. */
        legacyNoteRaw: nullable(Type.String()),
    },
    strict,
);
export type MediaCreationEditorView = Static<typeof MediaCreationEditorView>;

/** Provenienz (WI-0068 §5): wer oder was das Asset hereinbrachte. Der Hochlader ist nie der Urheber. */
export const MediaIngestView = Type.Object(
    {
        kind: oneOf(MEDIA_INGEST_KINDS),
        /** Der Medienzug als Akteur (`legacy_import`). */
        migrationRunId: nullable(Uuid()),
        sourceSystem: nullable(Type.String()),
        sourceRef: nullable(Type.String()),
        ingestedAt: Moment(),
        /** PRIVAT: der Hochlader als Person (nie bei `legacy_import`). */
        actor: nullable(MediaPersonRef),
        /** PRIVAT: Legacys `uploaded_by` als Text. */
        legacyActorLabel: nullable(Type.String()),
        legacyUploadedAt: nullable(Moment()),
        legacyStampSemantics: nullable(oneOf(["upload", "last_classification"] as const)),
        submissionId: nullable(Type.String()),
        /** PRIVAT: Dateiname des Hochladers, nur Anzeige. */
        originalFilename: nullable(Type.String()),
    },
    strict,
);
export type MediaIngestView = Static<typeof MediaIngestView>;

/** Was Legacy über das Bild sagte (`media_legacy_source`): Evidenz, nie eine Freigabe. */
export const MediaLegacySourceView = Type.Object(
    {
        mediaClass: Type.String(),
        legacyOrigin: nullable(Type.String()),
        legacySource: nullable(Type.String()),
        legacyForm: nullable(Type.String()),
        legacyPublic: Type.Boolean(),
        legacyShown: nullable(Type.Boolean()),
        mediaRevision: nullable(Type.String()),
        fileFetchedAt: nullable(Moment()),
        /** PRIVAT: Adressen in Legacys Speicher und im Wiki. */
        localUrl: Type.String(),
        storedUrl: nullable(Type.String()),
        sourceUrl: nullable(Type.String()),
    },
    strict,
);
export type MediaLegacySourceView = Static<typeof MediaLegacySourceView>;

/** Eine Datei des Assets (Representation, WI-0068 §2 Nr. 3). Eine Adresse hat nur die Klasse `published`. */
export const MediaRepresentation = Type.Object(
    {
        variant: Type.String(),
        storageClass: oneOf(MEDIA_STORAGE_CLASSES),
        mimeType: Type.String(),
        width: nullable(Type.Integer({ minimum: 1 })),
        height: nullable(Type.Integer({ minimum: 1 })),
        byteSize: Type.Integer({ minimum: 1 }),
        sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        recipe: nullable(Type.String()),
        recipeVersion: nullable(Type.String()),
        createdAt: Moment(),
        url: nullable(Type.String({ pattern: MEDIA_PUBLIC_URL_PATTERN })),
        /**
         * Nur am Original eines Wappens (WI-0068 P4b T2b): Sind die Ecken durchsichtig? `null`: noch nicht gemessen oder kein Wappen.
         * Optional: ein Server der Vorversion schickt es nicht.
         */
        cornersTransparent: Type.Optional(nullable(Type.Boolean())),
        /**
         * Nur am Original eines angenommenen Kartenvorschlags (WI-0275): Seit wann gilt die Datei als gelöscht? Die Zeile bleibt, gerechnet wird aus dem Master. `null`: Die Datei gibt es.
         * Optional: ein Server der Vorversion schickt es nicht.
         */
        bytesDeletedAt: Type.Optional(nullable(Moment())),
        /** PRIVAT: die geschützte Adresse einer privaten Vorschau (`intern_<variante>`); sonst `null`. Optional wie oben. */
        privateUrl: Type.Optional(nullable(Type.String({ pattern: MEDIA_EDITOR_PREVIEW_URL_PATTERN }))),
        /** PRIVAT: der Schlüssel unter `MEDIA_ROOT`. */
        storageKey: Type.String(),
    },
    strict,
);
export type MediaRepresentation = Static<typeof MediaRepresentation>;

/** Ein Rechtebeleg (PRIVAT als Ganzes, `MediaAssetDetail.evidence`). Die Datei selbst hat keine Adresse. */
export const MediaEvidenceView = Type.Object(
    {
        kind: oneOf(MEDIA_EVIDENCE_KINDS),
        /** Der Beleg hängt an einer Freigaberegel, die dieses Asset trägt, nicht am Asset selbst. */
        viaRule: Type.Boolean(),
        hasFile: Type.Boolean(),
        externalUrl: nullable(Type.String()),
        issuer: nullable(Type.String()),
        recipient: nullable(Type.String()),
        datedOn: nullable(Day()),
        description: nullable(Type.String()),
        recordedBy: nullable(Type.String()),
        recordedAt: Moment(),
    },
    strict,
);
export type MediaEvidenceView = Static<typeof MediaEvidenceView>;

/** Der Einzelbild-Notaus der Bytes dieses Assets (`suspend_media_publication`), samt Wiederfreigabe. */
export const MediaSuspensionView = Type.Object(
    {
        revision: Revision(),
        sha256: Type.String({ pattern: "^[0-9a-f]{64}$" }),
        /**
         * Das Asset, an dem der Notaus ausgelöst wurde; er gilt allen Assets mit denselben Bytes. `null`, wenn es endgültig gelöscht ist (WI-0272, Migration 0328): Der
         * Notaus bleibt mit Grund, Person, Zeit und Prüfsumme stehen und sperrt die Bytes weiter.
         */
        triggeredOn: nullable(Uuid()),
        suspendedAt: Moment(),
        liftedAt: nullable(Moment()),
        fileState: oneOf(MEDIA_SUSPENSION_FILE_STATES),
        /** PRIVAT: Grund, Person, Wiederfreigabe. */
        reason: Type.String(),
        suspendedBy: nullable(MediaPersonRef),
        liftedBy: nullable(MediaPersonRef),
        liftReason: nullable(Type.String()),
    },
    strict,
);
export type MediaSuspensionView = Static<typeof MediaSuspensionView>;

/** Ein Eintrag des Fachprotokolls zum Asset (Historie, WI-0068 §3.3), neueste zuerst. */
export const MediaHistoryEntry = Type.Object(
    {
        operationId: Uuid(),
        at: Moment(),
        action: Type.String(),
        actorKind: oneOf(["person", "cli", "system", "anonymous"] as const),
        targetRevision: nullable(Revision()),
        /** PRIVAT: wer handelte. */
        actor: nullable(MediaPersonRef),
        actorLabel: nullable(Type.String()),
        /**
         * Nur bei `rights.reviewed`: der Entscheid (`cleared`, `rejected`, `needs_review`), damit der Verlauf „Rechte erneut zur Prüfung gestellt“ sagt statt
         * eines bloßen „geprüft“ (OPS-000101). Ein Code aus dem Fachprotokoll, nie Freitext.
         */
        decision: Type.Optional(Type.String({ maxLength: 40 })),
    },
    strict,
);
export type MediaHistoryEntry = Static<typeof MediaHistoryEntry>;

export const MEDIA_HISTORY_LIMIT = 20;

export const MediaAssetDetail = Type.Object(
    {
        asset: MediaAssetCore,
        rights: nullable(MediaRightsEditorView),
        creation: nullable(MediaCreationEditorView),
        ingest: Type.Array(MediaIngestView),
        legacySource: nullable(MediaLegacySourceView),
        representations: Type.Array(MediaRepresentation),
        /** Alle Notaus-Einträge der Bytes, neueste zuerst; höchstens der erste ist aktiv. */
        suspensions: Type.Array(MediaSuspensionView),
        usageCount: Count(),
        retiredUsageCount: Count(),
        sharedFileCount: Count(),
        history: Type.Array(MediaHistoryEntry),
        /** PRIVAT: die Belege am Asset und an den Freigaberegeln seiner Rechtsbasis. */
        evidence: Type.Array(MediaEvidenceView),
        /**
         * Die Werke, die in diesem aufgegangen sind und es noch sind (D1), neueste zuerst. Sie fallen aus jeder Liste; nur hier lässt
         * sich ihre Zusammenführung aufheben (`mediaMergeLiftUrl` mit IHRER Kennung).
         */
        mergedHere: Type.Array(MediaMergedHere),
        /**
         * PRIVAT: die Einreichung eines Besuchers hinter diesem Asset (WI-0272 S3), samt der Revision, auf die die Operationen der Redaktion bauen.
         * Nur beim aktuellen Bild der Einreichung (ein ersetztes trägt sie nicht) und nur mit `view_media_private`; fehlt bei jedem anderen Asset.
         */
        submission: Type.Optional(PhotoboxSubmissionView),
        /**
         * Nur an einer erzeugten Vorschau (WI-0287 Punkt 5, `media_asset.generated_from_asset_id`): die Karte, aus der sie entstand. Grundlage, Lizenz, Nennung, Prüfstand und Entstehung
         * kommen von dort und ändern sich nur dort; `offline`: Der Notaus der Karte gilt gerade auch hier.
         */
        erzeugtAus: Type.Optional(
            Type.Object({ assetId: Uuid(), title: nullable(Type.String()), offline: Type.Boolean() }, strict),
        ),
        /** Nur an einer Karte: die aus ihr erzeugten Vorschauen („Gilt auch für …“). */
        erzeugte: Type.Optional(Type.Array(WerkBezug)),
        /** Nur an einer Karte (Asset-Typ `map`): warum „Vorschau erzeugen“ gesperrt ist; `null`: es geht. */
        vorschauSperre: Type.Optional(nullable(oneOf(KARTE_VORSCHAU_SPERREN))),
        /**
         * Nur an einem Bild aus einem Kartenvorschlag (WI-0287; Vali 2026-11-07 „Ja, erlauben“, `media-editor/vorschlag-loeschen.ts`): `nurStillgelegt`, wenn es und die
         * aus ihm erzeugten Vorschauen nur noch an stillgelegten Einträgen der Kartensammlung hängen. Dann darf der Betreiber es endgültig löschen; die Einträge
         * (`eintraege`, Titel) verlieren das Bild, die `vorschauen` fallen mit, der Vorschlag bleibt ohne Datei im Verlauf.
         */
        ausVorschlag: Type.Optional(
            Type.Object(
                { nurStillgelegt: Type.Boolean(), eintraege: Type.Array(Type.String()), vorschauen: Count() },
                strict,
            ),
        ),
        /**
         * Nur an einem Bild aus einem Kartenvorschlag (WI-0068, OPS-000093): der Vorschlag, zu dem das Bild gehört (hängen mehrere am Bild, der offene vor den entschiedenen, dann der neueste).
         * `id` ist die öffentliche Kennung der Redaktion (`kartenvorschlagRedaktionUrl`), `zustand` einer aus `KARTENVORSCHLAG_ZUSTAENDE`. Als Text, nicht als Aufzählung: `kartenvorschlag.ts` hängt über
         * die Kartensammlung an diesem Vertrag, ein Import zurück wäre ein Kreis. Die Oberfläche zeigt „Vorschlag prüfen …“ nur bei einem offenen Vorschlag und nur mit einem der beiden Redaktionsrechte.
         */
        kartenvorschlag: Type.Optional(
            Type.Object({ id: Type.String(), nummer: Type.String(), zustand: Type.String() }, strict),
        ),
        /**
         * Nur an einem PhotoBox-Bild (WI-0272; Vali 2026-11-08, Entwurf „Eingänge“ Fassung 2, `media-editor/photobox-loeschen.ts`): dieselben Fakten, mit denen das
         * endgültige Löschen entscheidet, auch an einer ersetzten Fassung (die `submission` nicht trägt). `zustand` der Einreichung (offen heißt: nicht löschbar),
         * `aktiv`: das Bild gilt noch als Reisebild (sonst ist es zurückgezogen oder war nie öffentlich), `anderswo`: Verwendungen außer seinen Reisebild-Zeilen,
         * aktiv oder zurückgezogen (jede hält es fest), `ort`: der Name des Orts der Einreichung, `null` an freier Stelle.
         */
        ausPhotobox: Type.Optional(
            Type.Object(
                {
                    zustand: oneOf(PHOTOBOX_SUBMISSION_STATES),
                    aktiv: Type.Boolean(),
                    anderswo: Count(),
                    ort: nullable(Type.String()),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type MediaAssetDetail = Static<typeof MediaAssetDetail>;

/** Reverse Usage (WI-0068 §8) samt „gleiche Datei“ als Hinweis: andere Assets mit demselben Original und ihre Stellen. */
export const MediaUsageResult = Type.Object(
    {
        asset: Type.Object({ id: Uuid(), revision: Revision() }, strict),
        usages: Type.Array(MediaUsage),
        /** Zurückgezogene Bindungen und Galerieeinträge, die noch auf das Asset zeigen (ein endgültiges Löschen sähe sie). */
        retired: Count(),
        /**
         * Ist dieses Werk selbst in einem anderen aufgegangen (OPS-000096)? Dann bleibt „gleiche Datei“ als Hinweis stehen, aber zusammenführen
         * lässt es sich von hier nicht mehr (409 `media_already_merged`). Fehlt das Feld (älterer Server), gilt `false`.
         */
        aufgegangen: Type.Optional(Type.Boolean()),
        sameFile: Type.Array(
            Type.Object(
                {
                    asset: Type.Object(
                        { id: Uuid(), revision: Revision(), title: nullable(Type.String()), kind: oneOf(MEDIA_KINDS) },
                        strict,
                    ),
                    usages: Type.Array(MediaUsage),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type MediaUsageResult = Static<typeof MediaUsageResult>;

// --- Die Galerie als Objekt (WI-0068 §9) ---

/** Ein Eintrag; innerhalb der Galerie heißt er nach seinem Asset (je Galerie höchstens einmal, Migration 0064). */
export const MediaGalleryItemView = Type.Object(
    {
        asset: Type.Object(
            {
                id: Uuid(),
                revision: Revision(),
                title: nullable(Type.String()),
                kind: oneOf(MEDIA_KINDS),
                technicalState: oneOf(MEDIA_TECHNICAL_STATES),
                clearance: nullable(oneOf(MEDIA_CLEARANCE_STATES)),
                preview: nullable(MediaPreview),
            },
            strict,
        ),
        position: Type.Integer(),
        caption: nullable(Type.String()),
        retired: Type.Boolean(),
        revision: Revision(),
        override: MediaUsageOverride,
    },
    strict,
);
export type MediaGalleryItemView = Static<typeof MediaGalleryItemView>;

export const MediaGalleryDetail = Type.Object(
    {
        id: Uuid(),
        revision: Revision(),
        kind: oneOf(MEDIA_GALLERY_KINDS),
        title: nullable(Type.String()),
        origin: oneOf(MEDIA_GALLERY_ORIGINS),
        publicationState: oneOf(MEDIA_GALLERY_PUBLICATION_STATES),
        /** Das Cover als Asset-Kennung seines Eintrags; `null`: der erste Eintrag ist Vorgabe der Oberfläche. */
        coverAssetId: nullable(Uuid()),
        createdAt: Moment(),
        updatedAt: Moment(),
        /**
         * Aus Legacy (der Medienimport legte sie an) statt in der Medienverwaltung angelegt. Eine Legacy-Galerie lässt sich lösen, aber
         * nicht entfernen: Der nächste Import legte sie wieder an. Optional nur für Antworten älterer Stände.
         */
        fromLegacy: Type.Optional(Type.Boolean()),
        /** Wer sie in der Medienverwaltung angelegt hat (`gallery.created` im Fachprotokoll); `null` bei Legacy oder unbekannt. */
        createdBy: Type.Optional(nullable(MediaPersonRef)),
        /** In `position`, zurückgezogene Einträge an ihrer Stelle. */
        items: Type.Array(MediaGalleryItemView),
        /** Wer die Galerie verwendet (typisierte Bindung, heute nur Orte in der Rolle `header`). */
        bindings: Type.Array(
            Type.Object(
                {
                    subject: MediaUsageSubject,
                    role: oneOf(MEDIA_ROLES),
                    origin: oneOf(MEDIA_GALLERY_ORIGINS),
                    retired: Type.Boolean(),
                    revision: Revision(),
                },
                strict,
            ),
        ),
    },
    strict,
);
export type MediaGalleryDetail = Static<typeof MediaGalleryDetail>;

/**
 * Eine Galerie in der Liste der Medienverwaltung (WI-0068 P6; Betreiber 2026-10-12: „eine galerie ist ein medientyp, der bilder
 * sammelt“, und 2026-10-13 zur Entwurfsgalerie).
 *
 * 🔴 `draft` ist die Kernaussage der Zeile: Eine Galerie OHNE aktive Ortsbindung ist ein Entwurf, und ihre Bilder sind für
 * Besucher unsichtbar (Betreiber 2026-10-13, Variante A des Blatts). Deshalb steht sie in der Liste als Entwurf da und nicht
 * bloß als „an 0 Orten“ — eine Zahl erklärt nichts, die Marke schon.
 */
export const MamGallerySummary = Type.Object(
    {
        id: Uuid(),
        revision: Revision(),
        title: nullable(Type.String()),
        kind: oneOf(MEDIA_GALLERY_KINDS),
        origin: oneOf(MEDIA_GALLERY_ORIGINS),
        publicationState: oneOf(MEDIA_GALLERY_PUBLICATION_STATES),
        /** Aktive Einträge (zurückgezogene zählen nicht mit). */
        items: Count(),
        /** Die Orte, an denen sie aktiv hängt; leer heißt Entwurf. */
        places: Type.Array(Type.Object({ id: Uuid(), name: Type.String() }, strict)),
        /** Ohne aktive Ortsbindung: ein redaktioneller Entwurf, für Besucher unsichtbar. */
        draft: Type.Boolean(),
        /** Die ersten Bilder für den Stapel in der Zeile, in der Folge der Galerie; das Cover zuerst. */
        previews: Type.Array(MediaPreview),
    },
    strict,
);
export type MamGallerySummary = Static<typeof MamGallerySummary>;

export const MamGalleryList = Type.Object({ items: Type.Array(MamGallerySummary), total: Count() }, strict);
export type MamGalleryList = Static<typeof MamGalleryList>;

/** Wie viele Bilder der Stapel einer Zeile zeigt (der Rest steht als „+n“). */
export const MAM_GALLERY_PREVIEWS = 3;
/** Wie viele Galerien eine Seite der Liste trägt. */
export const MAM_GALLERY_PAGE = 100;

// --- Positivliste der privaten Felder ---

/**
 * 🔴 Die privaten Felder je Lesemodell: nur mit `view_media_private` sichtbar (WI-0068 §2 Nr. 15, AC16; Betreiber 2026-10-09).
 * Prompt, Rechtenotiz, Belege, Ingest- und Legacy-Akteur, Personen hinter Entscheidungen, Begründungen und private
 * Speicherangaben. Keine öffentliche Sicht (`MediaPublicView`, Infopanel, Wappenliste) trägt eines davon; die Tests
 * `packages/shared/test/media-editor.test.ts` (jedes Feld steht im Lesemodell, keines in der öffentlichen Sicht) und
 * `apps/server/test/media-editor-routes.test.ts` (kein Wert in einer öffentlichen Antwort, 401/403 ohne das Recht) halten das.
 * Wer ein Lesemodell um ein privates Feld erweitert, trägt es hier ein; die Oberfläche kann es daran als intern zeigen.
 */
export const MEDIA_PRIVATE_FIELDS = {
    MediaUsageOverride: ["decidedBy", "reason", "operatorQuote"],
    MediaRightsEditorView: ["rightsNote", "legacyRightsCode", "reviewedBy", "reviewer"],
    MediaCreationEditorView: ["tool", "model", "prompt", "negativePrompt", "parameters", "legacyNoteRaw"],
    MediaIngestView: [
        "actor",
        "legacyActorLabel",
        "legacyUploadedAt",
        "legacyStampSemantics",
        "submissionId",
        "originalFilename",
    ],
    MediaLegacySourceView: ["localUrl", "storedUrl", "sourceUrl"],
    MediaRepresentation: ["storageKey", "privateUrl"],
    MediaSuspensionView: ["reason", "suspendedBy", "liftedBy", "liftReason"],
    MediaHistoryEntry: ["actor", "actorLabel"],
    MediaAssetDetail: ["evidence", "submission"],
    // Der Platz am Ort (WI-0068 P4a, `media-editor-operations.ts`): wer das Bild hochlud.
    MediaSlotAsset: ["uploadedBy"],
    // Ein Treffer der Liste (WI-0068 P4b, Auswahl): wer es hochlud.
    MamAssetSummary: ["uploadedBy", "uploadedByLabel", "privatePreview", "submission"],
} as const satisfies Record<string, readonly string[]>;

export type MediaPrivateModel = keyof typeof MEDIA_PRIVATE_FIELDS;

// --- Fachcodes nach ADR-0018 ---

/**
 * Die Fachcodes des MAM im Umschlag `{ error: { code, message, details? } }` (ADR-0018 Nr. 2). Ein Bearbeitungskonflikt ist der
 * gemeinsame Code `edit_conflict` mit `EditConflictDetails` (ADR-0020); wer zuletzt änderte, steht im Fachprotokoll.
 *
 * - `media_in_use`: ein verwendetes Asset lässt sich nicht endgültig löschen (§16); `details` `MediaInUseDetails`.
 * - `community_license_locked`: Grundlage oder Lizenz eines Community-Uploads ändert nur der Betreiber (`edit_community_license`, WI-0282).
 * - `publication_suspended`: Freigeben, solange ein Notaus für die Bytes gilt; erst aufheben.
 * - `suspension_active`: für diese Bytes gilt schon ein Notaus (höchstens einer, Migration 0086).
 * - `media_original_missing`: ein Asset ohne Original (`pending`) lässt sich nicht aussetzen; bis zu seinen Bytes sperrt
 *   `publication_override = 'blocked'`.
 */
export const MEDIA_ERROR_STATUS = {
    media_in_use: 409,
    community_license_locked: 403,
    publication_suspended: 409,
    suspension_active: 409,
    media_original_missing: 409,
} as const;
export type MediaErrorCode = keyof typeof MEDIA_ERROR_STATUS;

export const MediaInUseDetails = Type.Object(
    {
        /** Aktive Verwendungen dieses Assets. */
        usageCount: Count(),
        /** Zurückgezogene Bindungen und Einträge, die noch auf das Asset zeigen. */
        retiredCount: Count(),
    },
    strict,
);
export type MediaInUseDetails = Static<typeof MediaInUseDetails>;
