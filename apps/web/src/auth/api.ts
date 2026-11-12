/**
 * Anfragen an Anmeldung, Konto und Verwaltung (WI-0120 A9; Umschlag ADR-0018, Quittung ADR-0019). Diese Routen antworten im
 * Fehlerfall immer `{ error: { code, message, details? } }`; hier wird daraus ein `ApiFailure` mit stabilem Code, nach dem die
 * Oberfläche ihren eigenen Text wählt.
 *
 * Schreibende Anfragen gehen als JSON an dieselbe Herkunft: Der Browser setzt `Origin` und `Sec-Fetch-Site` selbst, und genau
 * das prüft der Server (AUTH-0001 §6.2). Kein Token in der Adresse, keine Zugangsdaten im Speicher der Seite.
 */

export class ApiFailure extends Error {
    readonly status: number;
    readonly code: string;
    readonly details: Record<string, unknown> | undefined;

    constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
        super(message);
        this.name = "ApiFailure";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export type Fetcher = typeof fetch;

/** Eine neue Kennung je Benutzerhandlung; eine Wiederholung schickt dieselbe (ADR-0019). */
export function newOperationId(): string {
    return globalThis.crypto.randomUUID();
}

async function read<T>(response: Response): Promise<T> {
    let text: string;
    try {
        text = await response.text();
    } catch {
        // Bricht die Verbindung beim Lesen des Rumpfs ab, ist das ein Netzfehler wie ein gescheitertes fetch (WI-0202, W5-05):
        // Sonst käme er als TypeError beim Aufrufer an und hieße dort „Fehler in der Seite“.
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    let body: unknown = undefined;
    if (text !== "") {
        try {
            body = JSON.parse(text);
        } catch {
            body = undefined;
        }
    }
    if (response.ok) return body as T;
    const error = (body as { error?: { code?: unknown; message?: unknown; details?: unknown } } | undefined)?.error;
    const code = typeof error?.code === "string" ? error.code : response.status >= 500 ? "unavailable" : "failed";
    const message = typeof error?.message === "string" ? error.message : response.statusText;
    const details =
        error?.details !== null && typeof error?.details === "object"
            ? (error.details as Record<string, unknown>)
            : undefined;
    throw new ApiFailure(response.status, code, message, details);
}

async function send<T>(fetcher: Fetcher, url: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
        response = await fetcher(url, { ...init, credentials: "same-origin", cache: "no-store" });
    } catch {
        throw new ApiFailure(0, "network", "Keine Verbindung zum Server.");
    }
    return read<T>(response);
}

export function getJson<T>(url: string, fetcher: Fetcher = fetch): Promise<T> {
    return send<T>(fetcher, url, { method: "GET", headers: { accept: "application/json" } });
}

export function postJson<T>(url: string, body: unknown, fetcher: Fetcher = fetch): Promise<T> {
    return send<T>(fetcher, url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body ?? {}),
    });
}

/**
 * Eine ganze Datei per `PUT` als Strom (der Abzug für lokal, WI-0251: Hunderte Megabyte, nie ganz in den Speicher der Seite). Der Browser liest
 * sie beim Senden selbst; Antwort und Fehler wie bei JSON.
 */
export function putDatei<T>(url: string, datei: Blob, contentType: string, fetcher: Fetcher = fetch): Promise<T> {
    return send<T>(fetcher, url, {
        method: "PUT",
        headers: { "content-type": contentType, accept: "application/json" },
        body: datei,
    });
}

/** Rohe Bytes per `PUT` (Stücke eines Uploads, WI-0220 Schnitt 3), mit eigenen Köpfen; Antwort und Fehler wie bei JSON. */
export function putBytes<T>(
    url: string,
    bytes: ArrayBuffer,
    headers: Record<string, string>,
    fetcher: Fetcher = fetch,
): Promise<T> {
    return send<T>(fetcher, url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream", accept: "application/json", ...headers },
        body: bytes,
    });
}
