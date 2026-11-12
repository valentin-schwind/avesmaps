import type { ApiErrorBody } from "@avesmaps3d/shared";

declare module "fastify" {
    interface FastifyContextConfig {
        /**
         * Die Route antwortet nur im Fehlerumschlag `{ error: { code, message, details? } }` (ADR-0018). Der Fehlerhandler
         * übersetzt dann auch Fastifys eigene Antworten (400, 413, 415) und `database_unavailable` in diese Form.
         */
        errorEnvelope?: boolean;
    }
}

/**
 * Ein erwarteter Fehler mit stabilem Code (ADR-0018). Wer ihn wirft, bestimmt Status, Code und Satz; der Fehlerhandler sendet
 * ihn im Umschlag und loggt ihn auf `info`, nicht als Störung.
 *
 * 🪤 Keine Parameter-Properties im Konstruktor: Node führt den Server per Type-Stripping aus und kennt sie nicht.
 */
export class ApiError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly details: Record<string, unknown> | undefined;

    constructor(statusCode: number, code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "ApiError";
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
    }
}

export function apiErrorBody(code: string, message: string, details?: Record<string, unknown>): ApiErrorBody {
    return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

/** Fastifys eigene Codes für eine unlesbare Anfrage, übersetzt in stabile Codes des Umschlags. */
const FASTIFY_CODES: Record<string, { code: string; message: string }> = {
    FST_ERR_VALIDATION: { code: "validation_failed", message: "Die Anfrage ist unvollständig oder falsch geformt." },
    FST_ERR_CTP_BODY_TOO_LARGE: { code: "payload_too_large", message: "Die Anfrage ist zu groß." },
    FST_ERR_CTP_INVALID_MEDIA_TYPE: { code: "unsupported_media_type", message: "Dieses Format wird nicht angenommen." },
    FST_ERR_CTP_EMPTY_JSON_BODY: { code: "validation_failed", message: "Die Anfrage hat keinen Inhalt." },
    FST_ERR_CTP_INVALID_JSON_BODY: { code: "validation_failed", message: "Der Inhalt ist kein gültiges JSON." },
};

/**
 * Fastifys Antwort auf eine unlesbare Anfrage im Umschlag. Bei Validierungsfehlern steht in `details.issues`, welches Feld
 * welche Regel verletzt (Pfad und Regel aus dem Schema, nie der eingegebene Wert).
 */
export function envelopeForFrameworkError(error: {
    code?: string;
    statusCode?: number;
    validation?: readonly { instancePath?: string; keyword?: string }[];
    validationContext?: string;
}): { status: number; body: ApiErrorBody } {
    const status = error.statusCode ?? 400;
    const known = error.code === undefined ? undefined : FASTIFY_CODES[error.code];
    if (known === undefined) {
        return { status, body: apiErrorBody("bad_request", "Die Anfrage kann so nicht bearbeitet werden.") };
    }
    if (error.validation === undefined) return { status, body: apiErrorBody(known.code, known.message) };
    const issues = error.validation.slice(0, 20).map((issue) => ({
        path: `${error.validationContext ?? ""}${issue.instancePath ?? ""}`,
        rule: issue.keyword ?? "unknown",
    }));
    return { status, body: apiErrorBody(known.code, known.message, { issues }) };
}
