import { ZAEHLREGELN, type MastodonGrenzen } from "@avesmaps3d/shared";
import type { DiscordZugang } from "./konfiguration.ts";

/**
 * Die Anbindung an Discord (WI-0268; Vali 2026-11-03: „schön wärs, wenn posts die da mit angehäkelt werden in unserem discord channel 1523841043890704534 (Neue Features) landen“). Nur diese Datei redet mit Discord für den
 * Hub; sie kennt keine Datenbank.
 *
 * 🔴 **Ein Webhook, nicht der Bot:** Beiträge entstehen in Production, und Production kennt keinen Bot-Schlüssel (`discord/konfig.ts`; Vali 2026-10-26: Der Bot kennt nur Stage und Discord). Ein Webhook kann nur in seinen einen
 * Kanal schreiben. Der Tagesbericht und die Befehle gehen weiter nur über den Bot auf der Stage (`discord/rest.ts`).
 *
 * - **Zugang prüfen** (`leseWebhook`): `GET` auf den Webhook; er muss zum eingestellten Kanal gehören (Bericht, Bugs, Ideen und Neue Features sind vier Kanäle, ein falsch eingesetzter Webhook schriebe sonst öffentlich in den falschen). Discord
 *   nennt dabei auch den Server, den die Adresse der Nachricht braucht. Der tägliche Lauf und der Prüflauf nutzen denselben Aufruf; er sendet nichts.
 * - **Senden** (`sende`): Der Beitrag geht als Einbettung mit Titelzeile hinaus, wie die Vorschau des Hubs ihn zeigt; ein Bild als Anhang in der Einbettung, mit Bildbeschreibung.
 * - **Zurücknehmen** (`nimmZurueck`): `DELETE` auf die Nachricht; „nicht (mehr) da“ zählt als zurückgenommen.
 * - 🔴 **Nie eine Erwähnung:** `allowed_mentions` ist leer, kein `@everyone`, kein `@here`, keine Rolle, was auch im Text steht.
 * - 🔴 **Kein Idempotenz-Kopf:** Ein Webhook kennt keine `nonce`. Gegen Doppeltes schützen der Auftrag (`gibtEs` vor einem neuen Versuch, Reservierung der Sendung) und dieser Satz: Bleibt beim Senden die Antwort aus, kann die Nachricht
 *   angekommen sein. Das ist ein dauerhafter Fehler mit dem Satz, im Kanal nachzusehen; „Erneut senden“ entscheidet eine Person.
 * - 🔴 **Nie ein echter Aufruf im Test:** Alles geht durch `deps.fetch`; Tests stellen Discord (`test/support/discord-webhook.ts`).
 * - 🔴 **Die Adresse des Webhooks IST der Schlüssel:** Sie steht nie in einem Text. Jeder Fehlertext ist ein fester Satz mit dem Code der Antwort; nur bei 400 kommt ein gekürzter, bereinigter Auszug dazu (`entschaerfe`).
 *   Zeitgrenze je Aufruf (15 s), kein Folgen von Weiterleitungen, Antwort höchstens 1 MB.
 */

export interface DiscordDeps {
    /** Der Aufruf; Tests stellen Discord, damit nie ein echter Aufruf hinausgeht. */
    fetch?: typeof globalThis.fetch;
    /** Zeitgrenze je Aufruf in Millisekunden. */
    timeoutMs?: number;
}

export const ZEITGRENZE_MS = 15_000;
const ANTWORT_MAX = 1_000_000;
const MIB = 1024 * 1024;
/** Der Name über der Nachricht, wie in der Vorschau des Hubs. */
const ANZEIGENAME = "Avesmaps";
/** Die Kante der Einbettung, wie in der Vorschau des Hubs (`--vs-discord-kante`). */
const KANTE = 0x5865f2;
/** Eine Kennung bei Discord. */
const KENNUNG = /^\d{17,20}$/u;
/** Discord nimmt für die Beschreibung eines Anhangs höchstens so viele Zeichen; der Hub (1000) bleibt darunter. */
const ANHANG_BESCHREIBUNG_MAX = 1024;

/** Ein Fehler des Kanals mit kurzem Satz. `dauerhaft` heißt: ein neuer Versuch ändert nichts oder könnte doppelt senden; sonst lohnt es sich später noch einmal. */
export class DiscordFehler extends Error {
    readonly dauerhaft: boolean;
    readonly status: number | undefined;

    constructor(satz: string, dauerhaft: boolean, status?: number) {
        super(satz);
        this.name = "DiscordFehler";
        this.dauerhaft = dauerhaft;
        this.status = status;
    }
}

/**
 * Die Grenzen, die der Hub für Discord führt (Discord nennt sie nicht): Die Zeichengrenze kommt aus `ZAEHLREGELN` (eine Quelle), Links zählen als Text, die Bildbeschreibung ist so lang wie die des Hubs, die Größe vorsichtig unter
 * der Grenze eines Servers ohne Boost. Der Hub hat nur veröffentlichte WebP-Bilder, Discord zeigt sie als Anhang an.
 */
export function discordGrenzen(): MastodonGrenzen {
    return {
        zeichen: ZAEHLREGELN.discord.grenze,
        adresse: 0,
        bilder: 1,
        beschreibung: 1000,
        bildBytes: 8 * MIB,
        bildTypen: ["image/webp", "image/jpeg"],
    };
}

interface Antwort {
    readonly status: number;
    readonly json: unknown;
}

const istObjekt = (wert: unknown): wert is Record<string, unknown> =>
    typeof wert === "object" && wert !== null && !Array.isArray(wert);

// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/gu;

/** Ein Auszug der Fehlermeldung von Discord: eine Zeile, ohne Steuerzeichen und ohne Schlüssel, höchstens 140 Zeichen. */
function auszug(json: unknown, zugang: DiscordZugang): string {
    const roh = istObjekt(json) ? json["message"] : undefined;
    if (typeof roh !== "string") return "";
    const rein = zugang.entschaerfe(roh).replace(STEUERZEICHEN, " ").replace(/\s+/gu, " ").trim();
    return rein.length > 140 ? `${rein.slice(0, 139)}…` : rein;
}

/** Der Satz zu einer Antwort, die nicht in Ordnung war. */
function fehlerZu(status: number, json: unknown, zugang: DiscordZugang): DiscordFehler {
    const code = String(status);
    if (status === 401 || status === 403 || status === 404) {
        return new DiscordFehler(`Discord kennt den Webhook nicht (mehr) oder lehnt ihn ab (${code})`, true, status);
    }
    if (status === 400) {
        const text = auszug(json, zugang);
        return new DiscordFehler(
            `Discord lehnt den Beitrag ab (${code})${text === "" ? "" : `: ${text}`}`,
            true,
            status,
        );
    }
    if (status === 413) return new DiscordFehler(`Die Datei ist Discord zu groß (${code})`, true, status);
    if (status === 429) return new DiscordFehler(`Discord bremst gerade (${code})`, false, status);
    if (status >= 500) return new DiscordFehler(`Discord meldet einen Fehler (${code})`, false, status);
    if (status >= 300 && status < 400) {
        return new DiscordFehler(`Discord leitet weiter, der Hub folgt nicht (${code})`, true, status);
    }
    return new DiscordFehler(`Discord lehnt die Anfrage ab (${code})`, true, status);
}

/** Der JSON-Rumpf einer Antwort; eine Antwort, die keiner ist (auch 204), zählt als leer: Dann entscheidet der Status. */
async function leseJson(antwort: Response): Promise<unknown> {
    try {
        const text = (await antwort.text()).slice(0, ANTWORT_MAX);
        return text === "" ? null : (JSON.parse(text) as unknown);
    } catch {
        return null;
    }
}

interface Aufruf {
    readonly methode: "GET" | "POST" | "DELETE";
    readonly pfad?: `/messages/${string}`;
    readonly abfrage?: Readonly<Record<string, string>>;
    readonly kopf?: Record<string, string>;
    readonly body?: string | FormData;
}

/** Ein Aufruf mit Zeitgrenze, ohne Weiterleitung. Wirft nur, wenn keine Antwort kam, und dann nie mit dem Text des Fehlers: Er enthielte die Adresse und damit den Schlüssel. */
async function aufruf(zugang: DiscordZugang, deps: DiscordDeps, a: Aufruf): Promise<Antwort> {
    const hole = deps.fetch ?? globalThis.fetch;
    let antwort: Response;
    try {
        antwort = await hole(zugang.adresse(a.pfad ?? "", a.abfrage), {
            method: a.methode,
            redirect: "manual",
            headers: { Accept: "application/json", ...(a.kopf ?? {}) },
            ...(a.body === undefined ? {} : { body: a.body }),
            signal: AbortSignal.timeout(deps.timeoutMs ?? ZEITGRENZE_MS),
        });
    } catch (fehler) {
        const zeit =
            (fehler as { name?: unknown }).name === "TimeoutError" ||
            (fehler as { name?: unknown }).name === "AbortError";
        throw new DiscordFehler(
            zeit ? "Discord hat nicht rechtzeitig geantwortet" : "Discord war nicht erreichbar",
            false,
        );
    }
    return { status: antwort.status, json: await leseJson(antwort) };
}

/**
 * Liest den Webhook: Er gilt noch und gehört zum eingestellten Kanal. Gibt den Server zurück, den die Adresse einer Nachricht braucht. Wirft `DiscordFehler`; schreibt nichts.
 */
export async function leseWebhook(zugang: DiscordZugang, deps: DiscordDeps = {}): Promise<{ server: string }> {
    const antwort = await aufruf(zugang, deps, { methode: "GET" });
    if (antwort.status !== 200) throw fehlerZu(antwort.status, antwort.json, zugang);
    const json = istObjekt(antwort.json) ? antwort.json : {};
    if (json["channel_id"] !== zugang.kanal) {
        throw new DiscordFehler("Der Webhook gehört zu einem anderen Kanal als dem eingestellten", true);
    }
    const server = json["guild_id"];
    if (typeof server !== "string" || !KENNUNG.test(server)) {
        throw new DiscordFehler("Discord nannte den Server des Webhooks nicht", true);
    }
    return { server };
}

export interface DiscordBeitrag {
    /** Die Titelzeile der Einbettung; ein Beitrag ohne Titel hat keine. */
    readonly titel?: string | undefined;
    readonly text: string;
    /** Ein Bild: die Datei, ihr Medientyp und die Bildbeschreibung (Pflicht im Hub). */
    readonly bild?: { readonly bytes: Uint8Array; readonly mime: string; readonly beschreibung: string } | undefined;
}

export interface Gesendet {
    /** Die Kennung der Nachricht bei Discord (für das Zurücknehmen). */
    readonly id: string;
    /** Die Adresse der Nachricht (`https`). */
    readonly url: string;
}

/** Die Adresse einer Nachricht bei Discord. */
export const discordAdresse = (server: string, kanal: string, nachricht: string): string =>
    `https://discord.com/channels/${server}/${kanal}/${nachricht}`;

/** Die Dateiendung zum Typ; sie muss zur Einbettung passen (`attachment://`). */
const endungZu = (mime: string): string =>
    (mime.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gu, "").slice(0, 8) || "bin";

/** Sendet einen Beitrag als Einbettung in den Kanal des Webhooks (`?wait=true`: Discord antwortet mit der Nachricht und ihrer Kennung). */
export async function sende(zugang: DiscordZugang, beitrag: DiscordBeitrag, deps: DiscordDeps = {}): Promise<Gesendet> {
    const { server } = await leseWebhook(zugang, deps);
    const titel = beitrag.titel?.trim() ?? "";
    const datei = beitrag.bild === undefined ? undefined : `bild.${endungZu(beitrag.bild.mime)}`;
    const nutzlast = {
        username: ANZEIGENAME,
        allowed_mentions: { parse: [] },
        embeds: [
            {
                ...(titel === "" ? {} : { title: titel }),
                description: beitrag.text,
                color: KANTE,
                ...(datei === undefined ? {} : { image: { url: `attachment://${datei}` } }),
            },
        ],
        ...(datei === undefined || beitrag.bild === undefined
            ? {}
            : {
                  attachments: [
                      {
                          id: 0,
                          filename: datei,
                          description: beitrag.bild.beschreibung.slice(0, ANHANG_BESCHREIBUNG_MAX),
                      },
                  ],
              }),
    };
    let body: string | FormData;
    let kopf: Record<string, string> = {};
    if (datei === undefined || beitrag.bild === undefined) {
        body = JSON.stringify(nutzlast);
        kopf = { "Content-Type": "application/json" };
    } else {
        const form = new FormData();
        form.append("payload_json", JSON.stringify(nutzlast));
        form.append("files[0]", new Blob([Buffer.from(beitrag.bild.bytes)], { type: beitrag.bild.mime }), datei);
        body = form;
    }
    let antwort: Antwort;
    try {
        antwort = await aufruf(zugang, deps, { methode: "POST", abfrage: { wait: "true" }, kopf, body });
    } catch (fehler) {
        // Ohne Antwort kann die Nachricht angekommen sein; ein neuer Versuch könnte sie öffentlich verdoppeln. Das entscheidet eine Person.
        if (fehler instanceof DiscordFehler) {
            throw new DiscordFehler(
                `${fehler.message}; der Beitrag kann angekommen sein, bitte im Kanal nachsehen`,
                true,
            );
        }
        throw fehler;
    }
    if (antwort.status !== 200) throw fehlerZu(antwort.status, antwort.json, zugang);
    const id = istObjekt(antwort.json) ? antwort.json["id"] : undefined;
    if (typeof id !== "string" || !KENNUNG.test(id)) {
        throw new DiscordFehler("Discord nannte keine Kennung der Nachricht; bitte im Kanal nachsehen", true);
    }
    return { id, url: discordAdresse(server, zugang.kanal, id) };
}

/** Gibt es diese Nachricht noch? (Vor einem Wiederholungsversuch: Wer schon eine Kennung hat, sendet nicht noch einmal.) */
export async function gibtEs(zugang: DiscordZugang, externId: string, deps: DiscordDeps = {}): Promise<boolean> {
    if (!KENNUNG.test(externId)) throw new DiscordFehler("Die Kennung der Nachricht bei Discord ist unbrauchbar", true);
    const antwort = await aufruf(zugang, deps, { methode: "GET", pfad: `/messages/${externId}` });
    if (antwort.status === 200) return true;
    if (antwort.status === 404) return false;
    throw fehlerZu(antwort.status, antwort.json, zugang);
}

/** Löscht eine Nachricht des Webhooks. Ist sie dort nicht (mehr) da, ist das Ziel erreicht. */
export async function nimmZurueck(zugang: DiscordZugang, externId: string, deps: DiscordDeps = {}): Promise<void> {
    if (!KENNUNG.test(externId)) throw new DiscordFehler("Die Kennung der Nachricht bei Discord ist unbrauchbar", true);
    const antwort = await aufruf(zugang, deps, { methode: "DELETE", pfad: `/messages/${externId}` });
    if (antwort.status === 204 || antwort.status === 200 || antwort.status === 404) return;
    throw fehlerZu(antwort.status, antwort.json, zugang);
}
