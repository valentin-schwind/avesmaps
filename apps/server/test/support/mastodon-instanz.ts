import { mastodonRegel, zaehleKanal } from "@avesmaps3d/shared";

/**
 * Eine gestellte Mastodon-Instanz für die Tests des Kanals (WI-0268 C12a): ein Ersatz für `fetch`, der die Aufrufe mitschreibt und sich wie die Schnittstelle verhält (Grenzen, Beiträge mit
 * `Idempotency-Key`, Bilder, Löschen). 🔴 Es geht NIE ein echter Aufruf hinaus: Wer diesen Ersatz nicht übergibt, ruft in den Tests nichts auf.
 *
 * Die Zählung der Instanz ist ein Parameter (`zaehle`): Vorgabe ist die Regel des Hubs; ein Test gibt eine andere, um die Abweichung zu zeigen, die `social:pruefen` finden muss.
 */

export interface Aufruf {
    readonly methode: string;
    readonly host: string;
    readonly pfad: string;
    readonly kopf: Headers;
    readonly body: string | FormData | null;
    readonly redirect: "follow" | "error" | "manual" | undefined;
}

export interface StellOptionen {
    /** `max_characters` der Instanz. */
    readonly max?: number;
    /** `characters_reserved_per_url`. */
    readonly adresse?: number;
    /** Wie die Instanz zählt; Vorgabe: die Regel des Hubs mit diesen Grenzen. */
    readonly zaehle?: (text: string) => number;
    /** Die Bildformate, die sie nimmt. */
    readonly typen?: readonly string[];
    /** Lässt einen Aufruf scheitern: eine Antwort, `"netz"` (kein Antwort) oder nichts. `nr` zählt alle Aufrufe ab 1. */
    readonly fehler?: ((aufruf: Aufruf, nr: number) => Response | "netz" | undefined) | undefined;
    /** Die Grenzen als Antwort von `/api/v2/instance` ganz ersetzen (etwa ohne `max_characters`). */
    readonly instanz?: unknown;
}

export interface Beitrag {
    readonly id: string;
    readonly text: string;
    readonly sichtbarkeit: string;
    readonly medien: readonly string[];
    readonly schluessel: string | null;
}

export interface GestellteInstanz {
    readonly fetch: typeof globalThis.fetch;
    readonly aufrufe: Aufruf[];
    /** Die Beiträge, die gerade existieren (gelöschte sind weg). */
    readonly beitraege: Map<string, Beitrag>;
    /** Wie viele Beiträge je angelegt wurden (auch gelöschte). */
    readonly angelegt: () => number;
    /** Die hochgeladenen Bilder: Kennung → Beschreibung. */
    readonly medien: Map<string, { beschreibung: string; typ: string; groesse: number }>;
}

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export function stelleInstanz(optionen: StellOptionen = {}): GestellteInstanz {
    const max = optionen.max ?? 500;
    const adresse = optionen.adresse ?? 23;
    const regel = mastodonRegel({ zeichen: max, adresse }, "test");
    const zaehle =
        optionen.zaehle ?? ((text: string) => zaehleKanal("mastodon", { text, hashtags: [] }, { mastodon: regel }).n);
    const aufrufe: Aufruf[] = [];
    const beitraege = new Map<string, Beitrag>();
    const medien = new Map<string, { beschreibung: string; typ: string; groesse: number }>();
    const schluessel = new Map<string, string>();
    let nr = 0;
    let beitragNr = 0;
    let medienNr = 0;

    const antwort = async (eingabe: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(
            typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url,
        );
        const aufruf: Aufruf = {
            methode: init?.method ?? "GET",
            host: url.host,
            pfad: url.pathname,
            kopf: new Headers(init?.headers),
            body: (init?.body ?? null) as string | FormData | null,
            redirect: init?.redirect,
        };
        aufrufe.push(aufruf);
        nr += 1;
        const fehler = optionen.fehler?.(aufruf, nr);
        if (fehler === "netz") throw new TypeError(`fetch failed: ${url.href}`);
        if (fehler !== undefined) return fehler;

        if (aufruf.methode === "GET" && aufruf.pfad === "/api/v2/instance") {
            return json(
                200,
                optionen.instanz ?? {
                    configuration: {
                        statuses: {
                            max_characters: max,
                            max_media_attachments: 4,
                            characters_reserved_per_url: adresse,
                        },
                        media_attachments: {
                            supported_mime_types: optionen.typen ?? [
                                "image/jpeg",
                                "image/png",
                                "image/webp",
                                "video/mp4",
                            ],
                            description_limit: 1500,
                            image_size_limit: 16_777_216,
                        },
                    },
                },
            );
        }
        // Alles Weitere verlangt die Anmeldung.
        if (!(aufruf.kopf.get("Authorization") ?? "").startsWith("Bearer "))
            return json(401, { error: "The access token is invalid" });
        if (aufruf.methode === "POST" && aufruf.pfad === "/api/v2/media") {
            const form = aufruf.body as FormData;
            const datei = form.get("file") as File;
            medienNr += 1;
            const id = `m${String(medienNr)}`;
            medien.set(id, {
                beschreibung: String(form.get("description") ?? ""),
                typ: datei.type,
                groesse: datei.size,
            });
            return json(200, { id });
        }
        if (aufruf.methode === "POST" && aufruf.pfad === "/api/v1/statuses") {
            const body = JSON.parse(String(aufruf.body)) as {
                status: string;
                visibility: string;
                media_ids?: string[];
            };
            const key = aufruf.kopf.get("Idempotency-Key");
            const bekannt = key === null ? undefined : schluessel.get(key);
            if (bekannt !== undefined) {
                const b = beitraege.get(bekannt);
                if (b !== undefined)
                    return json(200, {
                        id: b.id,
                        url: `https://${url.host}/@konto/${b.id}`,
                        uri: `https://${url.host}/users/konto/statuses/${b.id}`,
                    });
            }
            if (zaehle(body.status) > max) {
                return json(422, { error: `Validation failed: Text character limit of ${String(max)} exceeded` });
            }
            beitragNr += 1;
            const id = String(1000 + beitragNr);
            beitraege.set(id, {
                id,
                text: body.status,
                sichtbarkeit: body.visibility,
                medien: body.media_ids ?? [],
                schluessel: key,
            });
            if (key !== null) schluessel.set(key, id);
            return json(200, {
                id,
                url: `https://${url.host}/@konto/${id}`,
                uri: `https://${url.host}/users/konto/statuses/${id}`,
            });
        }
        const loeschen = /^\/api\/v1\/statuses\/([0-9A-Za-z_-]+)$/u.exec(aufruf.pfad);
        if (aufruf.methode === "DELETE" && loeschen !== null) {
            const id = loeschen[1]!;
            if (!beitraege.has(id)) return json(404, { error: "Record not found" });
            beitraege.delete(id);
            return json(200, {});
        }
        return json(404, { error: "Not found" });
    };
    return { fetch: antwort as typeof globalThis.fetch, aufrufe, beitraege, angelegt: () => beitragNr, medien };
}
