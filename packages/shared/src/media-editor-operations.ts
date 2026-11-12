import { Type, type Static, type TLiteral, type TNull, type TSchema, type TUnion } from "@sinclair/typebox";
import { MEDIA_IMAGE_RELATIONS, MEDIA_ROLES, MEDIA_UPLOAD_ROLES, type MediaRole } from "./media.ts";
import {
    MEDIA_BINDING_ORIGINS,
    MEDIA_CLEARANCE_STATES,
    MEDIA_CREATION_METHODS,
    MEDIA_EDITOR_URL,
    MEDIA_EVIDENCE_KINDS,
    MEDIA_GALLERY_ORIGINS,
    MEDIA_RIGHTS_BASES,
    MEDIA_TECHNICAL_STATES,
    MediaImageRelationState,
    MediaPersonRef,
    MediaPreview,
    MediaUsagePublication,
    type MediaCreationMethod,
} from "./media-editor.ts";
import { MutationEnvelope, UUID_PATTERN } from "./operation.ts";

/**
 * Der Schreibpfad der Medienverwaltung (WI-0068 P4a, §14): benannte Operationen statt PATCH-Suppe, und der Vertrag des EINEN
 * Upload-Formulars, das das MAM-Fenster und der Ortseditor (EDIT-0001 E19, WI-0126 §11j) einbetten.
 *
 * - Jede Operation trägt den `MutationEnvelope` (`operationId`, wo ein Datensatz geändert wird `baseRevision`) und antwortet mit der
 *   `OperationReceipt` (ADR-0019). Höchstens einmal je Kennung; dieselbe Kennung mit anderem Inhalt ist 409 `idempotency_key_reused`.
 * - Veraltete Revision: 409 `edit_conflict` mit `EditConflictDetails` (ADR-0020); „wer“ nur aus dem Fachprotokoll.
 * - Rechte prüft der Server (`protect`), nie die Oberfläche: Hochladen, Metadaten, Rechte und Bindungen `upload_media`, „Rechte
 *   geprüft“ `review_media_rights` (auch am eigenen Hochgeladenen, WI-0282). Schreibklasse `map`: die Kartensperre hält alles an (423).
 * - 🔴 Öffentlich wird ein Bild allein über die Entscheidung der Policy (`decidePublication`); bis dahin „wartet auf Rechteprüfung“.
 *   Kein Feld hier schaltet etwas frei.
 */

function oneOf<T extends string>(values: readonly T[]): TUnion<TLiteral<T>[]> {
    return Type.Union(values.map((value) => Type.Literal(value)));
}
const nullable = <T extends TSchema>(schema: T): TUnion<[T, TNull]> => Type.Union([schema, Type.Null()]);
const strict = { additionalProperties: false } as const;
const Uuid = () => Type.String({ pattern: UUID_PATTERN });
const Revision = () => Type.Integer({ minimum: 1 });
const Moment = () => Type.String({ minLength: 20 });

// --- Adressen ---

/** `POST` legt ein Asset aus einer hochgeladenen Datei an (dieselbe Adresse liest mit `GET` die Liste). */
export const MEDIA_UPLOAD_URL = MEDIA_EDITOR_URL;
export const MEDIA_LICENSES_URL = `${MEDIA_EDITOR_URL}/licenses`;
export const MEDIA_PUBLICATION_PREVIEW_URL = `${MEDIA_EDITOR_URL}/publication-preview`;
export const MEDIA_COAT_BIND_URL = `${MEDIA_EDITOR_URL}/bindings/coat`;
export const MEDIA_COAT_NONE_URL = `${MEDIA_EDITOR_URL}/bindings/coat/none`;
export const MEDIA_HEADER_SET_URL = `${MEDIA_EDITOR_URL}/bindings/header/set`;
export const MEDIA_HEADER_NONE_URL = `${MEDIA_EDITOR_URL}/bindings/header/none`;
export const MEDIA_HEADER_RELATION_URL = `${MEDIA_EDITOR_URL}/bindings/header/relation`;

const assetPath = (id: string, tail: string): string => `${MEDIA_EDITOR_URL}/${encodeURIComponent(id)}/${tail}`;
export const mediaMetadataUrl = (id: string): string => assetPath(id, "metadata");
export const mediaCreationUrl = (id: string): string => assetPath(id, "creation");
export const mediaRightsUrl = (id: string): string => assetPath(id, "rights");
export const mediaRightsReviewUrl = (id: string): string => assetPath(id, "rights/review");
export const mediaEvidenceUrl = (id: string): string => assetPath(id, "evidence");
/** Einzelbild-Notaus: die Bytes dieses Assets offline nehmen beziehungsweise wieder freigeben (Betreiber 2026-10-10). */
export const mediaSuspendUrl = (id: string): string => assetPath(id, "suspend");
export const mediaSuspendLiftUrl = (id: string): string => assetPath(id, "suspend/lift");
export const mediaDeleteUrl = (id: string): string => assetPath(id, "delete");
export const mediaSubjectSlotsUrl = (kind: MediaSlotSubjectKind, id: string): string =>
    `${MEDIA_EDITOR_URL}/subjects/${kind}/${encodeURIComponent(id)}`;

// --- Grenzen und Formate der Datei ---

/**
 * Die Grenzen des Betreibers für ein Bild (D2, Betreiber 2026-10-04): 6 MiB Raster, 512 KiB SVG, 16 MP, 8192 px Kante. Die Quelle
 * ist `apps/server/src/media/raster/limits.ts` (`RASTER_LIMITS`); hier stehen sie für die Vorprüfung im Formular, ein Servertest hält
 * beide gleich. Der Server prüft immer selbst, aus den Bytes.
 */
export const MEDIA_UPLOAD_LIMITS = {
    maxRasterBytes: 6 * 1024 * 1024,
    maxSvgBytes: 512 * 1024,
    maxPixels: 16_000_000,
    maxEdge: 8192,
} as const;

/**
 * Die angenommenen Bildtypen (`inspect.ts`, `FORMAT_MIME`). Das Format kommt auf dem Server aus den Bytes, nie aus Name oder
 * angegebenem Typ; ein SVG nur ohne Text, Skript und Fremdverweis (D4), öffentlich nie als SVG.
 */
export const MEDIA_UPLOAD_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;
export type MediaUploadType = (typeof MEDIA_UPLOAD_TYPES)[number];

/**
 * Eine Karte oder Kartenvorschau der Kartensammlung (WI-0287): JPEG, PNG, WebP oder PDF. Die Karte bis 50 MB (wie „Karte vorschlagen“), die Vorschau bis 6 MiB; die
 * Grenzen der Bildpunkte (16 MP, 8192 px) gelten auch hier. Die Datei kommt als Rohkörper (`MEDIA_KARTE_DATEI_URL`), nicht als Base64 im JSON.
 */
export const MEDIA_KARTE_DATEI = {
    maxBytes: 50 * 1024 * 1024,
    maxBytesVorschau: MEDIA_UPLOAD_LIMITS.maxRasterBytes,
    types: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
} as const;

/**
 * Belegdateien (privat, nie mit Adresse): PDF, Rasterbild oder reiner UTF-8-Text (eine Mail als Text), höchstens so groß wie ein
 * Rasterbild. Ausführbares, HTML und SVG werden abgewiesen.
 */
export const MEDIA_EVIDENCE_TYPES = [
    "application/pdf",
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "text/plain",
] as const;
export type MediaEvidenceType = (typeof MEDIA_EVIDENCE_TYPES)[number];

/**
 * Base64-Länge, die eine Datei in der Anfrage höchstens haben darf: die Bytegrenze plus 2 MiB Luft. So erreicht eine Datei knapp über
 * der Grenze die genaue Prüfung (413 `payload_too_large` mit `reason`), statt am Schema als bloß „falsch geformt“ zu scheitern; was
 * weit darüber liegt, weist schon die Grenze der Anfrage ab (ebenfalls 413).
 */
const BASE64_MAX = Math.ceil((MEDIA_UPLOAD_LIMITS.maxRasterBytes + 2 * 1024 * 1024) / 3) * 4;

/** So groß darf die Anfrage des Hochladens höchstens sein: Bild und Beleg als Base64 plus die Felder. */
export const MEDIA_UPLOAD_BODY_LIMIT = 2 * BASE64_MAX + 256 * 1024;

/**
 * Die Qualitätsmerkmale eines Wappens (WI-0068 P4b, Betreiber 2026-10-10: „wappen … müssen bestimmte qualitätsmerkmale erfüllen wie
 * z.B: transparenter hintergrund und quadratisches format“; zur Größe „ja“ nach der Messung am Bestand):
 * - mindestens `minLongEdge` Pixel an der LANGEN Seite, gemessen vor dem Auffüllen (das kleinste Wappen des Bestands ist 90 × 128;
 *   „128 × 128 vor dem Auffüllen“ hätte 16 davon abgewiesen); ein SVG ist ausgenommen;
 * - ein durchsichtiger Hintergrund: ein Format ohne Durchsichtigkeit (JPEG, PNG ohne Alpha) weist der Server ab, undurchsichtige Ecken
 *   sieht erst der Worker (die Datei bleibt dann privat, Befund `coat_not_transparent`);
 * - nicht quadratisch ist kein Fehler: der Worker füllt mit durchsichtigem Rand zum Quadrat auf, nie zugeschnitten oder gestreckt.
 * Gilt für NEUE Wappen; der Bestand bleibt, wie er ist.
 */
export const MEDIA_COAT_QUALITY = { minLongEdge: 128 } as const;

/** Die Gründe (`details.reason` bei 422 `media_file_rejected`), mit denen der Server ein neues Wappen abweist. */
export const MEDIA_COAT_REJECTIONS = ["coat_too_small", "coat_not_transparent"] as const;
export type MediaCoatRejection = (typeof MEDIA_COAT_REJECTIONS)[number];

/** Eine Datei in der Anfrage: der Name nur zur Anzeige (nie ein Pfad, nie Identität), die Bytes als Base64. */
export const MediaFileUpload = Type.Object(
    {
        name: Type.String({ minLength: 1, maxLength: 255, pattern: "^[^/\\\\]+$" }),
        dataBase64: Type.String({ minLength: 4, maxLength: BASE64_MAX, pattern: "^[A-Za-z0-9+/]+={0,2}$" }),
    },
    strict,
);
export type MediaFileUpload = Static<typeof MediaFileUpload>;

// --- Das gemeinsame Formular (WI-0126 §11j) ---

/** Ein Beleg: Art, dazu je nach Art eine Datei, eine Adresse oder Text (`validateMediaEvidence`). Immer privat. */
export const MediaEvidenceInput = Type.Object(
    {
        kind: oneOf(MEDIA_EVIDENCE_KINDS),
        text: Type.Optional(Type.String({ maxLength: 8000 })),
        url: Type.Optional(Type.String({ maxLength: 2000 })),
        file: Type.Optional(MediaFileUpload),
    },
    strict,
);
export type MediaEvidenceInput = Static<typeof MediaEvidenceInput>;

/** Rechte (WI-0068 §7): Grundlage Pflicht, Lizenz und Namensnennung je nach Grundlage. Der Urheber steht bei den Rechten. */
export const MediaRightsFields = Type.Object(
    {
        basis: oneOf(MEDIA_RIGHTS_BASES),
        licenseKey: Type.Optional(nullable(Type.String({ maxLength: 64 }))),
        creator: Type.Optional(nullable(Type.String({ maxLength: 300 }))),
        rightsHolder: Type.Optional(nullable(Type.String({ maxLength: 300 }))),
        attribution: Type.Optional(nullable(Type.String({ maxLength: 1000 }))),
        /** PRIVAT: die interne Rechtenotiz. */
        rightsNote: Type.Optional(nullable(Type.String({ maxLength: 4000 }))),
    },
    strict,
);
export type MediaRightsFields = Static<typeof MediaRightsFields>;

/** Entstehung (WI-0068 §6): Werkzeug und Modell bei jeder Art, Prompt nur bei `ai_generated`. Alles privat. */
export const MediaCreationFields = Type.Object(
    {
        tool: Type.Optional(nullable(Type.String({ maxLength: 200 }))),
        model: Type.Optional(nullable(Type.String({ maxLength: 200 }))),
        prompt: Type.Optional(nullable(Type.String({ maxLength: 8000 }))),
        negativePrompt: Type.Optional(nullable(Type.String({ maxLength: 8000 }))),
    },
    strict,
);
export type MediaCreationFields = Static<typeof MediaCreationFields>;

/**
 * Die Felder des Formulars „Neues … hochladen“ (Bauteil P4b; MAM-Fenster und Ortseditor betten es ein). `role` ist der Asset-Typ,
 * für den hochgeladen wird (Wappen, Titelbild …): Er wählt das Profil der Ableitung, gebunden wird mit einer eigenen Operation.
 * Der Hochlader steht nie im Formular: ihn setzt der Server aus der Sitzung (Provenienz `media_ingest`, getrennt vom Urheber).
 */
export const MediaUploadForm = Type.Object(
    {
        /** „Name in der Liste“. Leer nur mit `titleFromBinding`. */
        title: Type.String({ maxLength: 200 }),
        /**
         * Der Name kommt aus der Bindung, die dem Hochladen folgt (WI-0068 P4b 7b, Koordination 2026-10-11): Das Formular war mit dem Namen
         * nach der Namensregel vorbelegt (`MediaSubjectSlots.suggestedTitles`) und blieb unverändert. Dann ist `title` leer, das Asset
         * hat nach dem Hochladen keinen Titel, und die Bindung vergibt ihn als abgeleiteten (`asset.title_derived`), nicht als Titel eines
         * Menschen. Optional: ein Formular der Vorversion schickt es nicht.
         */
        titleFromBinding: Type.Optional(Type.Boolean()),
        /** 🔴 Nur Rollen mit Asset-Typ (`MEDIA_UPLOAD_ROLES`): `photobox` legt keine Redaktion hoch, die Rolle entsteht aus der Freigabe. */
        role: oneOf(MEDIA_UPLOAD_ROLES),
        creationMethod: oneOf(MEDIA_CREATION_METHODS),
        creation: Type.Optional(MediaCreationFields),
        rights: MediaRightsFields,
        /** „Herkunft“: woher das Bild kommt (Adresse oder Beschreibung); Provenienz, keine Lizenz. */
        provenance: Type.Optional(nullable(Type.String({ maxLength: 1000 }))),
        evidence: Type.Optional(MediaEvidenceInput),
        /** „Rechte geprüft“ gleich beim Hochladen: nur mit `review_media_rights` und nur mit bekannter Rechtsgrundlage (WI-0282). */
        rightsReviewed: Type.Optional(Type.Boolean()),
    },
    strict,
);
export type MediaUploadForm = Static<typeof MediaUploadForm>;

/** Ein Eintrag des Lizenzkatalogs, wie das Formular ihn braucht (`GET …/licenses`). */
export const MediaLicenseInfo = Type.Object(
    {
        key: Type.String(),
        displayName: Type.String(),
        uri: Type.String(),
        family: Type.String(),
        requiresAttribution: Type.Boolean(),
    },
    strict,
);
export type MediaLicenseInfo = Static<typeof MediaLicenseInfo>;

export const MediaLicenseCatalog = Type.Object({ licenses: Type.Array(MediaLicenseInfo) }, strict);
export type MediaLicenseCatalog = Static<typeof MediaLicenseCatalog>;

// --- Prüfung als reine Funktion: dieselbe im Formular und auf dem Server ---

export const MEDIA_FORM_RULES = [
    "required",
    "unknown_license",
    "only_with_license",
    "required_by_license",
    "needs_ai_generated",
    "not_allowed",
    "not_http",
    "unsupported_type",
    "too_large",
] as const;
export type MediaFormRule = (typeof MEDIA_FORM_RULES)[number];

/** Ein Befund am Formular: Pfad und Regel, nie der eingegebene Wert (wie `validation_failed` im Umschlag, ADR-0018). */
export interface MediaFormIssue {
    path: string;
    rule: MediaFormRule;
}

const blank = (value: string | null | undefined): boolean =>
    value === undefined || value === null || value.trim() === "";
const HTTP_URL = /^https?:\/\/\S+$/u;

/**
 * Rechte je Grundlage (WI-0068 §7, Auftrag P4a): `license` verlangt einen Schlüssel aus dem Katalog, eine Lizenz mit
 * Namensnennungspflicht (CC BY) die Namensnennung; einen Lizenzschlüssel gibt es nur bei `license`. Sonst ist nichts Pflicht:
 * `unknown` ist erlaubt und wird nie öffentlich.
 */
export function validateMediaRights(
    rights: MediaRightsFields,
    licenses: readonly MediaLicenseInfo[],
    prefix = "rights",
): MediaFormIssue[] {
    const issues: MediaFormIssue[] = [];
    const key = blank(rights.licenseKey) ? null : (rights.licenseKey as string).trim();
    if (rights.basis === "license") {
        if (key === null) issues.push({ path: `${prefix}.licenseKey`, rule: "required" });
        const license = key === null ? undefined : licenses.find((entry) => entry.key === key);
        if (key !== null && license === undefined)
            issues.push({ path: `${prefix}.licenseKey`, rule: "unknown_license" });
        if (license?.requiresAttribution === true && blank(rights.attribution)) {
            issues.push({ path: `${prefix}.attribution`, rule: "required_by_license" });
        }
    } else if (key !== null) {
        issues.push({ path: `${prefix}.licenseKey`, rule: "only_with_license" });
    }
    return issues;
}

/** Prompt und Negativ-Prompt gibt es nur bei einem KI-erzeugten Bild. */
export function validateMediaCreation(
    method: MediaCreationMethod,
    creation: MediaCreationFields | undefined,
    prefix = "creation",
): MediaFormIssue[] {
    if (method === "ai_generated" || creation === undefined) return [];
    return (["prompt", "negativePrompt"] as const)
        .filter((field) => !blank(creation[field]))
        .map((field) => ({ path: `${prefix}.${field}`, rule: "needs_ai_generated" as const }));
}

/**
 * Ein Beleg je Art (Migration 0064, `media_rights_evidence_one_source`): Lizenz- und Quellseite mit Adresse (http oder https), ohne
 * Datei; Mail, PDF und Dokument mit Datei, ohne Adresse; die Notiz des Betreibers mit Text, ohne Adresse. Text ist sonst eine
 * freiwillige Beschreibung.
 */
export function validateMediaEvidence(evidence: MediaEvidenceInput, prefix = "evidence"): MediaFormIssue[] {
    const issues: MediaFormIssue[] = [];
    const hasUrl = !blank(evidence.url);
    const hasFile = evidence.file !== undefined;
    switch (evidence.kind) {
        case "license_page":
        case "source_page":
            if (!hasUrl) issues.push({ path: `${prefix}.url`, rule: "required" });
            if (hasFile) issues.push({ path: `${prefix}.file`, rule: "not_allowed" });
            break;
        case "email":
        case "pdf":
        case "document":
            if (!hasFile) issues.push({ path: `${prefix}.file`, rule: "required" });
            if (hasUrl) issues.push({ path: `${prefix}.url`, rule: "not_allowed" });
            break;
        case "operator_note":
            if (blank(evidence.text)) issues.push({ path: `${prefix}.text`, rule: "required" });
            if (hasUrl) issues.push({ path: `${prefix}.url`, rule: "not_allowed" });
            break;
    }
    if (hasUrl && !HTTP_URL.test((evidence.url as string).trim()))
        issues.push({ path: `${prefix}.url`, rule: "not_http" });
    return issues;
}

export interface MediaFormContext {
    /** `upload`: ein neues Asset (Datei und Name Pflicht); `edit`: ein vorhandenes. */
    mode: "upload" | "edit";
    licenses: readonly MediaLicenseInfo[];
    /** Hat die Sitzung `review_media_rights`? */
    mayReview: boolean;
    /** Was das Formular vor dem Senden über die Datei weiß (Vorprüfung; der Server prüft die Bytes selbst). */
    file?: { sizeBytes: number; type: string } | undefined;
}

/**
 * Die ganze Prüfung des Formulars, ohne Datenbank und ohne Uhr. Leer heißt: absendbar. Der Server ruft dieselbe Funktion und
 * antwortet bei Befunden 400 `validation_failed` mit `details.issues`.
 */
export function validateMediaForm(form: MediaUploadForm, context: MediaFormContext): MediaFormIssue[] {
    const issues: MediaFormIssue[] = [];
    if (form.titleFromBinding === true) {
        if (form.title.trim() !== "") issues.push({ path: "title", rule: "not_allowed" });
    } else if (context.mode === "upload" && form.title.trim() === "") issues.push({ path: "title", rule: "required" });
    issues.push(...validateMediaCreation(form.creationMethod, form.creation));
    issues.push(...validateMediaRights(form.rights, context.licenses));
    if (form.evidence !== undefined) issues.push(...validateMediaEvidence(form.evidence));
    if (form.rightsReviewed === true) {
        if (!context.mayReview || form.rights.basis === "unknown") {
            issues.push({ path: "rightsReviewed", rule: "not_allowed" });
        }
    }
    if (context.file !== undefined) {
        const type = context.file.type;
        const karte = form.role === "map_full" || form.role === "map_preview";
        const typen: readonly string[] = karte ? MEDIA_KARTE_DATEI.types : MEDIA_UPLOAD_TYPES;
        if (!typen.includes(type)) issues.push({ path: "file", rule: "unsupported_type" });
        const limit = karte
            ? form.role === "map_full"
                ? MEDIA_KARTE_DATEI.maxBytes
                : MEDIA_KARTE_DATEI.maxBytesVorschau
            : type === "image/svg+xml"
              ? MEDIA_UPLOAD_LIMITS.maxSvgBytes
              : MEDIA_UPLOAD_LIMITS.maxRasterBytes;
        if (context.file.sizeBytes > limit) issues.push({ path: "file", rule: "too_large" });
    }
    return issues;
}

// --- Die Operationen ---

/** Hochladen: das Asset entsteht privat (`pending`), die Ableitungen rechnet ein Job (`media_settle`, `derivedWork`). */
export const MediaUploadBody = Type.Object(
    { operationId: MutationEnvelope.properties.operationId, file: MediaFileUpload, form: MediaUploadForm },
    strict,
);
export type MediaUploadBody = Static<typeof MediaUploadBody>;

/**
 * Der Kopf einer Kartendatei (`MEDIA_KARTE_DATEI_URL`): Der Rumpf ist `[Länge des Kopfes, 4 Byte Big Endian][Kopf als UTF-8-JSON][Bytes der Datei]`. So geht eine Datei bis
 * 50 MB ohne Base64 und ohne eine Bibliothek für mehrteilige Rümpfe zusammen mit ihrem Formular in EINER Anfrage (`medien-operationen.ts`, `karteDatei`).
 */
export const MediaKarteDateiKopf = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        name: Type.String({ minLength: 1, maxLength: 255 }),
        form: MediaUploadForm,
    },
    strict,
);
export type MediaKarteDateiKopf = Static<typeof MediaKarteDateiKopf>;

/** Titel und Art der Entstehung am Asset (`baseRevision` des Assets). `null` beim Titel: kein eigener Name. */
export const MediaMetadataBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Revision(),
        title: Type.Optional(nullable(Type.String({ maxLength: 200 }))),
        creationMethod: Type.Optional(oneOf(MEDIA_CREATION_METHODS)),
    },
    strict,
);
export type MediaMetadataBody = Static<typeof MediaMetadataBody>;

/** Werkzeug, Modell und Prompt (`baseRevision` der Entstehung; ohne, wenn es noch keine gibt). */
export const MediaCreationBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Optional(Revision()),
        creation: MediaCreationFields,
    },
    strict,
);
export type MediaCreationBody = Static<typeof MediaCreationBody>;

/**
 * Rechte setzen (`baseRevision` der Rechte; ohne, wenn das Asset noch keine hat). 🔴 Ändern sich Grundlage oder Lizenz, gilt eine
 * frühere Prüfung nicht mehr: der Prüfstand fällt auf `unreviewed` (Warnung `clearance_reset` in der Quittung).
 */
export const MediaRightsBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Type.Optional(Revision()),
        rights: MediaRightsFields,
    },
    strict,
);
export type MediaRightsBody = Static<typeof MediaRightsBody>;

/** Die Entscheidungen der Rechteprüfung („Rechte geprüft“ ist `cleared`). */
export const MEDIA_REVIEW_DECISIONS = ["cleared", "rejected", "needs_review"] as const;
export type MediaReviewDecision = (typeof MEDIA_REVIEW_DECISIONS)[number];

/** Rechte prüfen (`review_media_rights`, auch am eigenen Hochgeladenen, WI-0282). */
export const MediaRightsReviewBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Revision(),
        decision: oneOf(MEDIA_REVIEW_DECISIONS),
    },
    strict,
);
export type MediaRightsReviewBody = Static<typeof MediaRightsReviewBody>;

/** Einen Beleg anhängen (nur anhängen, keine Revision). */
export const MediaEvidenceBody = Type.Object(
    { operationId: MutationEnvelope.properties.operationId, evidence: MediaEvidenceInput },
    strict,
);
export type MediaEvidenceBody = Static<typeof MediaEvidenceBody>;

/** Die Fachobjekte mit Bindungsplätzen für Wappen und Titelbilder. */
export const MEDIA_SLOT_SUBJECT_KINDS = ["place", "territory"] as const;
export type MediaSlotSubjectKind = (typeof MEDIA_SLOT_SUBJECT_KINDS)[number];

export const MediaSlotSubjectRef = Type.Object({ kind: oneOf(MEDIA_SLOT_SUBJECT_KINDS), id: Uuid() }, strict);
export type MediaSlotSubjectRef = Static<typeof MediaSlotSubjectRef>;

/**
 * Der Zustand eines Wappenplatzes: `undecided` (kein Entscheid, Legacy darf ihn füllen), `none` („bewusst ohne“: eine
 * Unterdrückung, eigener Zustand, nicht bloß leer), `set` (eine aktive Bindung).
 */
export const MEDIA_COAT_STATES = ["undecided", "none", "set"] as const;
export type MediaCoatState = (typeof MEDIA_COAT_STATES)[number];

/**
 * Wappen setzen oder ersetzen. Der gesehene Stand geht mit: bei `set` die Revision der Bindung (`baseRevision`), sonst
 * `baseState`. Weicht der Platz davon ab, 409 `edit_conflict` (eine Unterdrückung hat keine Revision; `currentRevision` ist dann 0).
 */
export const MediaCoatBindBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        subject: MediaSlotSubjectRef,
        assetId: Uuid(),
        baseRevision: Type.Optional(Revision()),
        baseState: Type.Optional(oneOf(["undecided", "none"] as const)),
    },
    strict,
);
export type MediaCoatBindBody = Static<typeof MediaCoatBindBody>;

/** Wappen entfernen: Der Platz wird „bewusst ohne“, das Asset bleibt (`baseRevision` der Bindung). */
export const MediaCoatNoneBody = Type.Object(
    { operationId: MutationEnvelope.properties.operationId, subject: MediaSlotSubjectRef, baseRevision: Revision() },
    strict,
);
export type MediaCoatNoneBody = Static<typeof MediaCoatNoneBody>;

/**
 * Das Titelbild eines Orts setzen (WI-0219; Betreiber 2026-10-17: „er kann nicht mehr wie ein bild haben, EIN titelbild oder EINE
 * Galerie“): EIN Bild als Einzelbindung (`place_media`, Rolle `header`). Es ersetzt, was bisher am Ort hängt, ein Einzelbild oder eine
 * Galerie; das Alte wird nur gelöst und bleibt in der Medienverwaltung unter „Bilder“ bzw. „Galerien“. Der gesehene Stand, genau
 * einer: die Revision der Einzelbindung (`baseRevision`), die der gebundenen Galerie (`galleryRevision`) oder, wenn nichts hängt, der
 * Zustand des Platzes (`baseState`). Weicht er ab, 409 `edit_conflict`. Hebt ein „bewusst ohne“ auf.
 */
export const MediaHeaderSetBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        placeId: Uuid(),
        assetId: Uuid(),
        baseRevision: Type.Optional(Revision()),
        galleryRevision: Type.Optional(Revision()),
        baseState: Type.Optional(oneOf(["undecided", "none"] as const)),
    },
    strict,
);
export type MediaHeaderSetBody = Static<typeof MediaHeaderSetBody>;

/**
 * Kein Titelbild (WI-0219): löst, was am Ort hängt (Einzelbild oder Galerie, je mit dem gesehenen Stand), und macht den Platz „bewusst
 * ohne“ wie beim Wappen; das Alte bleibt in der Medienverwaltung.
 */
export const MediaHeaderNoneBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        placeId: Uuid(),
        baseRevision: Type.Optional(Revision()),
        galleryRevision: Type.Optional(Revision()),
    },
    strict,
);
export type MediaHeaderNoneBody = Static<typeof MediaHeaderNoneBody>;

/**
 * Der Bildbezug EINER Verwendung eines Titelbildes (Betreiber 2026-10-11, „1A … 2 B … 3 A ja das gilt für alle“; Operation
 * `header.relation`): `value` `place_view` (Ortsansicht) oder `type_image` (Typbild) übersteuert die Regel, `null` gibt sie zurück.
 * Die Verwendung ist das Bild `assetId` an `placeId`: ein Eintrag der Kopf-Galerie (`via: "gallery"`) oder eine direkte Bindung
 * (`via: "binding"`); ohne `via` die eine, die es gibt. `baseRevision` ist bei der Galerie die Revision der GALERIE (wie bei den übrigen
 * Titelbild-Operationen), bei der Bindung die der Bindung. Ändert weder Provenienz noch Rechte noch Freigabe des Assets.
 */
export const MEDIA_HEADER_RELATION_VIAS = ["gallery", "binding"] as const;
export const MediaHeaderRelationBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        placeId: Uuid(),
        assetId: Uuid(),
        via: Type.Optional(oneOf(MEDIA_HEADER_RELATION_VIAS)),
        value: nullable(oneOf(MEDIA_IMAGE_RELATIONS)),
        baseRevision: Revision(),
    },
    strict,
);
export type MediaHeaderRelationBody = Static<typeof MediaHeaderRelationBody>;

/**
 * Der Einzelbild-Notaus (Betreiber 2026-10-10 zu SYS-0001 Frage 2, wörtlich: „im mam kann man dann immernoch bilder etc gezielt
 * offline nehmen"; Operation `suspension.set`).
 *
 * 🔴 **Er gilt dem BILD, nicht der Stelle.** Gegenstand sind die Bytes des Originals: Jede Verwendung jedes Assets mit denselben
 * Bytes verschwindet, und die veröffentlichte Datei wandert in derselben Handlung in die Quarantäne unter `private/`. Deshalb nennt
 * die Bestätigung vorher alle betroffenen Stellen — die Oberfläche hat sie bereits (`MediaUsageResult.usages` und `sameFile`).
 *
 * 🔴 **Grund ist Pflicht** (Datenbank: `reason` nicht leer), und die Route verlangt einen frischen Passkey. Ein Notaus ist kein
 * Löschen: Asset, Bindungen und Rechte bleiben unberührt, und kein Import und kein Medienlauf hebt ihn auf.
 */
export const MEDIA_SUSPEND_REASON_MAX = 500;
export const MediaSuspendBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        reason: Type.String({ minLength: 1, maxLength: MEDIA_SUSPEND_REASON_MAX }),
    },
    strict,
);
export type MediaSuspendBody = Static<typeof MediaSuspendBody>;

/**
 * Endgültig löschen (Operation `asset.delete`, Recht `delete_media`, frischer Passkey): `baseRevision` ist die Revision des Assets.
 * Nur ein eigener Upload ohne jede Verwendung (Betreiber 2026-10-17, „A, nur eigene Uploads“); sonst 409 `media_not_deletable`.
 */
export const MediaDeleteBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Revision(),
    },
    strict,
);
export type MediaDeleteBody = Static<typeof MediaDeleteBody>;

/**
 * Den Notaus wieder aufheben (Operation `suspension.lift`): `baseRevision` ist die Revision der aktiven Notaus-Zeile. Eine
 * aufgehobene Zeile ist endgültig (Migration 0088 hält sie fest) — ein erneutes Ausblenden legt eine neue an.
 */
export const MediaSuspendLiftBody = Type.Object(
    {
        operationId: MutationEnvelope.properties.operationId,
        baseRevision: Revision(),
        reason: Type.String({ minLength: 1, maxLength: MEDIA_SUSPEND_REASON_MAX }),
    },
    strict,
);
export type MediaSuspendLiftBody = Static<typeof MediaSuspendLiftBody>;

// --- Lesemodelle für den Ortseditor und das Formular ---

/** Ein Bild an einem Platz, wie der Ortseditor es zeigt (WI-0126 §11j: „hochgeladen von …“, „wartet auf Rechteprüfung“). */
export const MediaSlotAsset = Type.Object(
    {
        id: Uuid(),
        revision: Revision(),
        title: nullable(Type.String()),
        technicalState: oneOf(MEDIA_TECHNICAL_STATES),
        clearance: nullable(oneOf(MEDIA_CLEARANCE_STATES)),
        preview: nullable(MediaPreview),
        /** PRIVAT: wer es hochlud (Editor-Upload); bei Legacy-Medien `null`. */
        uploadedBy: nullable(MediaPersonRef),
        uploadedAt: nullable(Moment()),
        /** Die Entscheidung der Policy für genau diese Verwendung, wie der Resolver sie heute trifft. */
        publication: MediaUsagePublication,
    },
    strict,
);
export type MediaSlotAsset = Static<typeof MediaSlotAsset>;

export const MediaSubjectSlots = Type.Object(
    {
        subject: Type.Object(
            { kind: oneOf(MEDIA_SLOT_SUBJECT_KINDS), id: Uuid(), name: Type.String(), active: Type.Boolean() },
            strict,
        ),
        coat: Type.Object(
            {
                state: oneOf(MEDIA_COAT_STATES),
                /** Herkunft der Bindung oder der Unterdrückung; `null` ohne Entscheid. */
                origin: nullable(oneOf(MEDIA_BINDING_ORIGINS)),
                /** Revision der aktiven Bindung (`baseRevision` für Ersetzen und Entfernen). */
                revision: nullable(Revision()),
                asset: nullable(MediaSlotAsset),
            },
            strict,
        ),
        /**
         * Nur bei Orten: das Titelbild, EIN Einzelbild (`image`) ODER EINE Galerie (`gallery` mit ihren Bildern in `items`), WI-0219.
         * Die 78 Titelbilder aus Legacy sind Galerien mit einem Bild und bleiben es, bis jemand neu wählt.
         */
        header: nullable(
            Type.Object(
                {
                    gallery: nullable(
                        Type.Object(
                            {
                                id: Uuid(),
                                revision: Revision(),
                                origin: oneOf(MEDIA_GALLERY_ORIGINS),
                                /** Ihr Titel in der Medienverwaltung; `null` ohne. */
                                title: Type.Optional(nullable(Type.String())),
                            },
                            strict,
                        ),
                    ),
                    /** Das Einzelbild (WI-0219); `null`, wenn eine Galerie hängt oder nichts. */
                    image: Type.Optional(
                        nullable(
                            Type.Object(
                                {
                                    asset: MediaSlotAsset,
                                    /** Revision der Einzelbindung (`baseRevision` für Ersetzen und „bewusst ohne“). */
                                    revision: Revision(),
                                    origin: oneOf(MEDIA_BINDING_ORIGINS),
                                    relation: Type.Optional(MediaImageRelationState),
                                },
                                strict,
                            ),
                        ),
                    ),
                    items: Type.Array(
                        Type.Object(
                            {
                                asset: MediaSlotAsset,
                                position: Type.Integer({ minimum: 0 }),
                                revision: Revision(),
                                /** Der Bildbezug dieses Eintrags (Betreiber 2026-10-11); geschrieben über `header.relation`. */
                                relation: Type.Optional(MediaImageRelationState),
                            },
                            strict,
                        ),
                    ),
                    max: Type.Integer({ minimum: 1 }),
                    /** Eine Unterdrückung der Rolle `header` (aus Legacy oder „Kein Titelbild“, `header.none`); Setzen hebt sie auf. */
                    suppressed: Type.Boolean(),
                },
                strict,
            ),
        ),
        /**
         * Der Name, den ein NEUES Asset nach der Namensregel bekäme (WI-0068 P4b 7b): ein neues Wappen ersetzt das bisherige, ein neues
         * Titelbild kommt hinten an die Galerie. Das Formular „Neues … hochladen“ ist damit vorbelegt. `null`: kein Name (Objekt ohne
         * Namen) bzw. die Rolle gibt es hier nicht. Optional: ein Server der Vorversion schickt es nicht.
         */
        suggestedTitles: Type.Optional(
            Type.Object({ coat: nullable(Type.String()), header: nullable(Type.String()) }, strict),
        ),
    },
    strict,
);
export type MediaSubjectSlots = Static<typeof MediaSubjectSlots>;

/**
 * „Der Satz unter dem Formular sagt vorher, ob das Bild danach öffentlich ist“ (WI-0126 §11j): die Entscheidung der Policy für ein
 * technisch fertiges Bild mit diesen Rechten in dieser Rolle, mit den Freigaberegeln von heute. Ohne Prüfstand gilt `unreviewed`.
 */
export const MediaPublicationPreviewQuery = Type.Object(
    {
        role: oneOf(MEDIA_ROLES),
        basis: oneOf(MEDIA_RIGHTS_BASES),
        licenseKey: Type.Optional(Type.String({ maxLength: 64 })),
        clearance: Type.Optional(oneOf(MEDIA_CLEARANCE_STATES)),
        /**
         * Die Art der Entstehung aus dem Formular; ohne sie `unknown`. Eine Freigaberegel kann an ihr hängen (Betreiber 2026-10-10: die
         * Klassenregeln für Wappen und Ortsbilder gelten KI-generierten eigenen Werken).
         */
        creation: Type.Optional(oneOf(MEDIA_CREATION_METHODS)),
    },
    strict,
);
export type MediaPublicationPreviewQuery = Static<typeof MediaPublicationPreviewQuery>;

export const MediaPublicationPreview = MediaUsagePublication;
export type MediaPublicationPreview = Static<typeof MediaPublicationPreview>;

// --- Fachcodes der Operationen (ADR-0018) ---

/**
 * - `media_file_rejected` 422: die Datei verletzt eine Grenze des Betreibers oder ist kein Bild (`details.reason` ist der Code der
 *   Rasterpipeline, etwa `too_many_pixels`, `svg_has_text`). Typ und Größe antworten mit den gemeinsamen Codes
 *   `unsupported_media_type` (415) und `payload_too_large` (413), ebenfalls mit `details.reason`.
 * - `gallery_full` 409: die Galerie trägt schon so viele Bilder, wie ein Auftrag fassen kann (`MEDIA_GALLERY_ITEMS_MAX`).
 * - `media_already_bound` 409: das Bild hängt schon an diesem Platz.
 * - `media_not_deletable` 409 (`asset.delete`): `details.reason` sagt warum: `legacy` (Bild aus Legacy, bis zum Cutoff
 *   unlöschbar), `in_use` (eine Verwendung, auch zurückgezogen; `details.usages`), `merged` (Teil einer Zusammenführung),
 *   `suspension` (an ihm wurde ein Notaus ausgelöst).
 * - `media_duplicate_file` 409 (WI-0068 P6): ein anderes Werk mit DENSELBEN BYTES steht schon in dieser Galerie; `details.assetId`
 *   nennt es. Legacy legte je Verwendung ein eigenes Werk an (1.025 Assets teilen ihre Quelldatei, §21) — zwei davon in einer
 *   Galerie wären zweimal dasselbe Bild. Sie gehören zusammengeführt (D1), nicht nebeneinander.
 * - `media_already_exists` 409 (`asset.upload`, Betreiber 2026-10-17): ein Werk mit DENSELBEN BYTES gibt es schon; `details.assetId`
 *   nennt das kanonische (`MediaSameBytes.suggested`). Ein zweites Werk entsteht nicht — „Vorhandenes Bild verwenden“.
 * - `merge_preview_stale` 409 (`media.merge_all`): Die Vorschau des Menschen ist nicht mehr die heutige; `details.expected` nennt die
 *   heutigen Zahlen. Neu laden, dann noch einmal.
 * - `place_has_gallery` 409 (WI-0068 P6): der Ort hat schon eine Galerie; je Ort und Rolle ist höchstens eine aktiv.
 * - `media_not_bound` 409: das Bild hängt nicht (mehr) an diesem Platz.
 * - `media_kind_not_bindable` 409: ein 3D-Modell ist kein Wappen und kein Titelbild.
 * - `media_type_mismatch` 409: der Asset-Typ passt nicht zur Rolle (ein Bild ist kein Wappen, Betreiber 2026-10-10); `details.assetType`.
 * - `media_storage_unavailable` 503: ohne `MEDIA_ROOT` nimmt die Instanz keine Datei an.
 */
export const MEDIA_OPERATION_ERROR_STATUS = {
    media_file_rejected: 422,
    gallery_full: 409,
    media_already_bound: 409,
    media_duplicate_file: 409,
    media_already_exists: 409,
    merge_preview_stale: 409,
    place_has_gallery: 409,
    media_not_bound: 409,
    media_kind_not_bindable: 409,
    media_type_mismatch: 409,
    media_storage_unavailable: 503,
    media_not_deletable: 409,
} as const;
export type MediaOperationErrorCode = keyof typeof MEDIA_OPERATION_ERROR_STATUS;

/** Die Rollen, die P4a binden kann. */
export const MEDIA_BINDABLE_ROLES = ["coat", "header"] as const satisfies readonly MediaRole[];
