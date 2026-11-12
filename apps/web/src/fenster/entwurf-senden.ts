import type { ApiErrorBody, OperationReceipt } from "@avesmaps3d/shared";

/**
 * Der Schreibweg eines Entwurfs (O3): EINE Operation an den Server, die Quittung oder der Fehler im Umschlag (ADR-0018). Ohne
 * Verbindung kommt ein eigener Fehler `network_error`, damit der Entwurf stehen bleibt und der Satz sagt, warum. Bisher stand derselbe
 * `fetch` in `landschaftseditor/ecken-daten.ts`, `wegeditor/wegeditor-daten.ts` und `kraftlinieneditor/kraftlinien-daten.ts`; sie
 * stellen mit O3 hierher um.
 */

export type ApiFehler = ApiErrorBody["error"];

export type SchreibAntwort<Q = OperationReceipt> =
    | { readonly ok: true; readonly quittung: Q }
    | { readonly ok: false; readonly status: number; readonly fehler: ApiFehler };

export async function sende<Q = OperationReceipt>(
    url: string,
    body: unknown,
    methode: "POST" | "PATCH" = "POST",
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
    /** Bricht die Anfrage ab (eine Vorschau, die ein neues Ziel überholt); abgebrochen kommt sie wie ohne Verbindung zurück. */
    signal?: AbortSignal,
): Promise<SchreibAntwort<Q>> {
    let antwort: Response;
    try {
        antwort = await fetcher(url, {
            method: methode,
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
            ...(signal === undefined ? {} : { signal }),
        });
    } catch {
        return { ok: false, status: 0, fehler: { code: "network_error", message: "Keine Verbindung zum Server." } };
    }
    if (antwort.ok) return { ok: true, quittung: (await antwort.json()) as Q };
    const umschlag = (await antwort.json().catch(() => undefined)) as ApiErrorBody | undefined;
    return {
        ok: false,
        status: antwort.status,
        fehler: umschlag?.error ?? {
            code: "unknown_error",
            message: `Der Server antwortete ${String(antwort.status)}.`,
        },
    };
}
