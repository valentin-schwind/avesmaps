/**
 * Ein gestellter Webhook von Discord für die Tests des Kanals (WI-0268): ein Ersatz für `fetch`, der die Aufrufe mitschreibt und sich wie die Schnittstelle verhält (Webhook lesen, senden mit `wait=true`, Nachricht lesen, löschen).
 * 🔴 Es geht NIE ein echter Aufruf hinaus: Wer diesen Ersatz nicht übergibt, ruft in den Tests nichts auf. Wie Discord kennt er keinen Idempotenz-Kopf: Wer zweimal sendet, legt zwei Nachrichten an.
 */

export interface WebhookAufruf {
    readonly methode: string;
    readonly host: string;
    /** Der Pfad hinter `/api/v10/webhooks/<Kennung>/<Schlüssel>`. */
    readonly pfad: string;
    readonly abfrage: Record<string, string>;
    /** Die JSON-Nutzlast, auch aus `payload_json` einer Datei-Übertragung. */
    readonly nutzlast: Record<string, unknown> | null;
    readonly datei: { readonly name: string; readonly typ: string; readonly groesse: number } | null;
    readonly redirect: "follow" | "error" | "manual" | undefined;
}

export interface WebhookStellOptionen {
    /** Der Kanal, zu dem der Webhook gehört. */
    readonly kanal: string;
    readonly server?: string;
    /** Lässt einen Aufruf scheitern: eine Antwort, `"netz"` (keine Antwort) oder nichts. */
    readonly fehler?: ((aufruf: WebhookAufruf) => Response | "netz" | undefined) | undefined;
}

export interface GestellterWebhook {
    readonly fetch: typeof globalThis.fetch;
    readonly aufrufe: WebhookAufruf[];
    /** Die Nachrichten im Kanal, nach Kennung. */
    readonly nachrichten: Map<string, Record<string, unknown>>;
}

const json = (status: number, rumpf: unknown): Response =>
    new Response(JSON.stringify(rumpf), { status, headers: { "Content-Type": "application/json" } });

export const WEBHOOK_SERVER = "152366557740138501";

export function stelleWebhook(optionen: WebhookStellOptionen): GestellterWebhook {
    const aufrufe: WebhookAufruf[] = [];
    const nachrichten = new Map<string, Record<string, unknown>>();
    let naechste = 1_600_000_000_000_000_000n;
    const stell = async (eingabe: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
        const adresse = new URL(String(eingabe));
        const treffer = /^\/api\/v10\/webhooks\/\d+\/[^/]+(\/.*)?$/u.exec(adresse.pathname);
        if (treffer === null) throw new Error(`Der gestellte Webhook kennt diesen Aufruf nicht: ${adresse.pathname}`);
        let nutzlast: Record<string, unknown> | null = null;
        let datei: WebhookAufruf["datei"] = null;
        if (typeof init.body === "string") nutzlast = JSON.parse(init.body) as Record<string, unknown>;
        if (init.body instanceof FormData) {
            nutzlast = JSON.parse(String(init.body.get("payload_json"))) as Record<string, unknown>;
            const blob = init.body.get("files[0]");
            if (blob instanceof File) datei = { name: blob.name, typ: blob.type, groesse: blob.size };
        }
        const aufruf: WebhookAufruf = {
            methode: init.method ?? "GET",
            host: adresse.host,
            pfad: treffer[1] ?? "",
            abfrage: Object.fromEntries(adresse.searchParams),
            nutzlast,
            datei,
            redirect: init.redirect,
        };
        aufrufe.push(aufruf);
        const fehler = optionen.fehler?.(aufruf);
        if (fehler === "netz") throw new TypeError(`fetch failed: ${adresse.toString()}`);
        if (fehler !== undefined) return fehler;
        if (aufruf.pfad === "" && aufruf.methode === "GET") {
            return json(200, {
                id: "1600000000000000099",
                channel_id: optionen.kanal,
                guild_id: optionen.server ?? WEBHOOK_SERVER,
            });
        }
        if (aufruf.pfad === "" && aufruf.methode === "POST") {
            naechste += 1n;
            const id = String(naechste);
            nachrichten.set(id, { ...nutzlast, datei });
            return json(200, { id, channel_id: optionen.kanal });
        }
        const nachricht = /^\/messages\/(\d+)$/u.exec(aufruf.pfad)?.[1];
        if (nachricht !== undefined) {
            if (!nachrichten.has(nachricht)) return json(404, { message: "Unknown Message", code: 10008 });
            if (aufruf.methode === "GET") return json(200, { id: nachricht });
            if (aufruf.methode === "DELETE") {
                nachrichten.delete(nachricht);
                return new Response(null, { status: 204 });
            }
        }
        return json(405, { message: "405: Method Not Allowed", code: 0 });
    };
    return { fetch: stell as typeof globalThis.fetch, aufrufe, nachrichten };
}
