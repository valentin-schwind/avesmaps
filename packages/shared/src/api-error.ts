import { Type, type Static } from "@sinclair/typebox";

/**
 * Der Fehlerumschlag der API (M10 a, ADR-0018).
 *
 *     { "error": { "code": "edit_conflict", "message": "…", "details": { … } } }
 *
 * - `code` ist stabil und maschinenlesbar (Kleinbuchstaben, Ziffern, Unterstrich). Die Oberfläche entscheidet daran, nie am Text.
 * - `message` ist ein kurzer, menschenlesbarer Satz ohne Stack, Pfad, SQL oder Geheimnis (Kap. 11.15–11.17).
 * - `details` trägt nur, was der Code dokumentiert (Positivliste je Code), etwa die Revision bei `edit_conflict`.
 *
 * Neue Routen und jede Route, die eine Schreibaktion trägt, antworten nur in dieser Form. Ältere Lesepfade behalten ihre Form,
 * bis sie ohnehin angefasst werden (ADR-0018, „erst erweitern, dann umstellen, dann entfernen“).
 */
export const API_ERROR_CODE_PATTERN = "^[a-z][a-z0-9_]{1,63}$";

export const ApiErrorBody = Type.Object(
    {
        error: Type.Object(
            {
                code: Type.String({ pattern: API_ERROR_CODE_PATTERN }),
                message: Type.String({ maxLength: 500 }),
                details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
            },
            { additionalProperties: false },
        ),
    },
    { additionalProperties: false },
);
export type ApiErrorBody = Static<typeof ApiErrorBody>;

/**
 * Die Codes, die jede Route kennen kann, mit ihrem HTTP-Status. Fachliche Codes (etwa `invitation_expired`) definiert ihr
 * Fachbereich selbst, im selben Muster.
 */
export const API_ERROR_STATUS = {
    validation_failed: 400,
    bad_request: 400,
    unauthenticated: 401,
    forbidden: 403,
    forbidden_origin: 403,
    assurance_required: 403,
    reauth_required: 403,
    not_found: 404,
    edit_conflict: 409,
    idempotency_key_reused: 409,
    payload_too_large: 413,
    unsupported_media_type: 415,
    rate_limited: 429,
    internal_error: 500,
    database_unavailable: 503,
    /** Eine Sperre hielt die Anfrage länger als `lock_timeout` auf (55P03): gleich noch einmal, die Datenbank ist erreichbar. */
    database_busy: 503,
} as const;
export type CommonApiErrorCode = keyof typeof API_ERROR_STATUS;

/** `details` von `edit_conflict` (M10 c, ADR-0020): was jetzt gilt und wer es zuletzt geändert hat. */
export const EditConflictDetails = Type.Object(
    {
        currentRevision: Type.Integer({ minimum: 0 }),
        changedAt: Type.Optional(Type.String()),
        changedBy: Type.Optional(Type.Object({ id: Type.String(), displayName: Type.String() })),
    },
    { additionalProperties: false },
);
export type EditConflictDetails = Static<typeof EditConflictDetails>;

/**
 * Fastifys eigene Antwort auf eine unlesbare Anfrage (400, 413, 415) für Routen, die noch nicht den Umschlag führen. Früher
 * stand sie in sechs Routen je einmal als `ValidationError`; hier steht sie einmal. Eine Route mit Umschlag sieht sie nie,
 * der Fehlerhandler übersetzt sie (`validation_failed`, `payload_too_large`, `unsupported_media_type`).
 */
export const FastifyErrorBody = Type.Object({
    statusCode: Type.Integer(),
    code: Type.String(),
    error: Type.String(),
    message: Type.String(),
});
export type FastifyErrorBody = Static<typeof FastifyErrorBody>;
