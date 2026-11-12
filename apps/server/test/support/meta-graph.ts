/**
 * Eine gestellte Graph-Schnittstelle von Meta für die Tests von Facebook und Instagram (WI-0268 C12b): ein Ersatz für `fetch`, der die Aufrufe mitschreibt und sich wie die Schnittstelle verhält (Seite: Eintrag,
 * Foto, Löschen; Instagram: Container, Status, Veröffentlichen, Permalink). 🔴 Es geht NIE ein echter Aufruf hinaus: Wer diesen Ersatz nicht übergibt, ruft in den Tests nichts auf.
 *
 * Wie Meta hat sie KEINEN Idempotenz-Kopf: Wer zweimal sendet, legt zwei Beiträge an. Die Zählung der Dienste ist ein Parameter, damit die Tests die Abweichung zeigen können, die `social:pruefen` finden muss.
 */

export interface MetaAufruf {
    readonly methode: string;
    readonly host: string;
    readonly pfad: string;
    readonly version: string;
    readonly abfrage: Record<string, string>;
    readonly kopf: Headers;
    /** Felder eines Formulars (`application/x-www-form-urlencoded`) oder einer Datei-Übertragung (Datei als `{ typ, groesse }`). */
    readonly felder: Record<string, string | { typ: string; groesse: number }> | null;
    readonly redirect: "follow" | "error" | "manual" | undefined;
}

export interface MetaStellOptionen {
    readonly seite?: string;
    readonly konto?: string;
    /** Die Grenze der Seite in Zeichen (Codepoints); Meta kennt sie nicht offiziell, die Tests setzen eine. */
    readonly facebookMax?: number;
    /** Die Grenze der Unterschrift in UTF-16-Einheiten. */
    readonly instagramMax?: number;
    /** Wie oft der Container `IN_PROGRESS` meldet, bevor er `FINISHED` meldet; `"nie"`: bleibt in Arbeit; `"fehler"` / `"abgelaufen"`: meldet ERROR / EXPIRED. */
    readonly containerSchritte?: number | "nie" | "fehler" | "abgelaufen";
    /** Lässt einen Aufruf scheitern: eine Antwort, `"netz"` (keine Antwort) oder nichts. `nr` zählt alle Aufrufe ab 1. */
    readonly fehler?: ((aufruf: MetaAufruf, nr: number) => Response | "netz" | undefined) | undefined;
    /** Der Permalink der Instagram-Beiträge (Vorgabe: ein Link); `null`: Meta nennt keinen. */
    readonly permalink?: ((id: string) => string) | null;
}

export interface FacebookBeitragDort {
    readonly id: string;
    readonly text: string;
    readonly veroeffentlicht: boolean;
    readonly foto: { typ: string; groesse: number; beschreibung: string } | null;
}

export interface InstagramBeitragDort {
    readonly id: string;
    readonly container: string;
    readonly text: string;
    readonly bildUrl: string;
    readonly beschreibung: string;
}

export interface GestellteGraph {
    readonly fetch: typeof globalThis.fetch;
    readonly aufrufe: MetaAufruf[];
    /** Die Beiträge der Seite, die gerade existieren (gelöschte sind weg). */
    readonly facebook: Map<string, FacebookBeitragDort>;
    /** Wie viele Beiträge die Seite je angelegt hat (auch gelöschte). */
    readonly facebookAngelegt: () => number;
    /** Die veröffentlichten Instagram-Beiträge (nie zu löschen). */
    readonly instagram: Map<string, InstagramBeitragDort>;
    /** Die angelegten Container: Kennung → Zustand. */
    readonly container: Map<string, { text: string; bildUrl: string; beschreibung: string; veroeffentlicht: boolean }>;
}

const json = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const fehlerAntwort = (status: number, code: number, message: string, sub?: number): Response =>
    json(status, {
        error: { message, type: "OAuthException", code, ...(sub === undefined ? {} : { error_subcode: sub }) },
    });

export function stelleGraph(optionen: MetaStellOptionen = {}): GestellteGraph {
    const seite = optionen.seite ?? "100000000000001";
    const konto = optionen.konto ?? "170000000000002";
    const facebookMax = optionen.facebookMax ?? 63_206;
    const instagramMax = optionen.instagramMax ?? 2200;
    const aufrufe: MetaAufruf[] = [];
    const facebook = new Map<string, FacebookBeitragDort>();
    const instagram = new Map<string, InstagramBeitragDort>();
    const container = new Map<
        string,
        { text: string; bildUrl: string; beschreibung: string; veroeffentlicht: boolean }
    >();
    const abfragen = new Map<string, number>();
    let nr = 0;
    let fbNr = 0;
    let igNr = 0;
    let containerNr = 0;

    const antwort = async (eingabe: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = new URL(
            typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url,
        );
        const [, version = "", ...teile] = url.pathname.split("/");
        const pfad = `/${teile.join("/")}`;
        let felder: MetaAufruf["felder"] = null;
        if (init?.body instanceof URLSearchParams) felder = Object.fromEntries(init.body.entries());
        else if (init?.body instanceof FormData) {
            felder = {};
            for (const [name, wert] of init.body.entries()) {
                felder[name] = typeof wert === "string" ? wert : { typ: wert.type, groesse: wert.size };
            }
        }
        const aufruf: MetaAufruf = {
            methode: init?.method ?? "GET",
            host: url.host,
            pfad,
            version,
            abfrage: Object.fromEntries(url.searchParams.entries()),
            kopf: new Headers(init?.headers),
            felder,
            redirect: init?.redirect,
        };
        aufrufe.push(aufruf);
        nr += 1;
        const fehler = optionen.fehler?.(aufruf, nr);
        if (fehler === "netz") throw new TypeError(`fetch failed: ${url.href}`);
        if (fehler !== undefined) return fehler;
        if (!(aufruf.kopf.get("Authorization") ?? "").startsWith("Bearer ")) {
            return fehlerAntwort(400, 190, "Invalid OAuth access token.");
        }
        const text = (name: string): string => {
            const wert = aufruf.felder?.[name];
            return typeof wert === "string" ? wert : "";
        };

        // --- Lesen: das Konto, ein Beitrag, ein Container, ein Permalink --------------------------------------------------
        if (aufruf.methode === "GET") {
            const id = /^\/([0-9_]+)$/u.exec(pfad)?.[1];
            if (id === undefined) return fehlerAntwort(400, 100, "Unsupported get request.");
            if (id === seite || id === konto) return json(200, { id });
            if (facebook.has(id)) return json(200, { id });
            if (container.has(id)) {
                const c = container.get(id)!;
                if (c.veroeffentlicht) return json(200, { status_code: "PUBLISHED", id });
                const schritte = optionen.containerSchritte ?? 0;
                if (schritte === "fehler") return json(200, { status_code: "ERROR", id });
                if (schritte === "abgelaufen") return json(200, { status_code: "EXPIRED", id });
                const gefragt = (abfragen.get(id) ?? 0) + 1;
                abfragen.set(id, gefragt);
                return json(200, {
                    status_code: schritte === "nie" || gefragt <= schritte ? "IN_PROGRESS" : "FINISHED",
                    id,
                });
            }
            if (instagram.has(id)) {
                if (aufruf.abfrage["fields"] === "permalink") {
                    if (optionen.permalink === null) return json(200, { id });
                    return json(200, {
                        id,
                        permalink: (optionen.permalink ?? ((i) => `https://www.instagram.com/p/${i}/`))(id),
                    });
                }
                return json(200, { id });
            }
            return fehlerAntwort(400, 100, "Object does not exist", 33);
        }

        // --- Facebook ---------------------------------------------------------------------------------------------------
        if (aufruf.methode === "POST" && pfad === `/${seite}/feed`) {
            const message = text("message");
            if (Array.from(message).length > facebookMax) {
                return fehlerAntwort(400, 100, "The message is too long.");
            }
            fbNr += 1;
            const id = `${seite}_${String(500000000 + fbNr)}`;
            facebook.set(id, { id, text: message, veroeffentlicht: text("published") !== "false", foto: null });
            return json(200, { id });
        }
        if (aufruf.methode === "POST" && pfad === `/${seite}/photos`) {
            const quelle = aufruf.felder?.["source"];
            if (quelle === undefined || typeof quelle === "string") return fehlerAntwort(400, 100, "No photo.");
            const caption = text("caption");
            if (Array.from(caption).length > facebookMax) return fehlerAntwort(400, 100, "The caption is too long.");
            fbNr += 1;
            const id = `${seite}_${String(500000000 + fbNr)}`;
            const foto = String(900000000 + fbNr);
            facebook.set(foto, {
                id: foto,
                text: caption,
                veroeffentlicht: text("published") !== "false",
                foto: { typ: quelle.typ, groesse: quelle.groesse, beschreibung: text("alt_text_custom") },
            });
            return json(200, { id: foto, post_id: id });
        }
        if (aufruf.methode === "DELETE") {
            const id = /^\/([0-9_]+)$/u.exec(pfad)?.[1];
            if (id !== undefined && facebook.delete(id)) return json(200, { success: true });
            return fehlerAntwort(400, 100, "Object does not exist", 33);
        }

        // --- Instagram ----------------------------------------------------------------------------------------------------
        if (aufruf.methode === "POST" && pfad === `/${konto}/media`) {
            const caption = text("caption");
            const bildUrl = text("image_url");
            if (!bildUrl.startsWith("https://"))
                return fehlerAntwort(400, 9004, "Only photo or video can be accepted as media type.", 2207052);
            if (caption.length > instagramMax) {
                return fehlerAntwort(
                    400,
                    100,
                    "Invalid parameter: caption exceeded the maximum allowed length",
                    2207010,
                );
            }
            containerNr += 1;
            const id = String(700000000 + containerNr);
            container.set(id, { text: caption, bildUrl, beschreibung: text("alt_text"), veroeffentlicht: false });
            return json(200, { id });
        }
        if (aufruf.methode === "POST" && pfad === `/${konto}/media_publish`) {
            const id = text("creation_id");
            const c = container.get(id);
            if (c === undefined) return fehlerAntwort(400, 100, "Invalid creation_id", 2207006);
            if (c.veroeffentlicht) return fehlerAntwort(400, 100, "The media has already been published", 2207020);
            c.veroeffentlicht = true;
            igNr += 1;
            const media = String(800000000 + igNr);
            instagram.set(media, {
                id: media,
                container: id,
                text: c.text,
                bildUrl: c.bildUrl,
                beschreibung: c.beschreibung,
            });
            return json(200, { id: media });
        }
        return fehlerAntwort(400, 100, "Unsupported request.");
    };
    return {
        fetch: antwort as typeof globalThis.fetch,
        aufrufe,
        facebook,
        facebookAngelegt: () => fbNr,
        instagram,
        container,
    };
}
