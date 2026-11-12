import { snowflakeAb } from "./zeit.ts";

/**
 * Der schmale REST-Weg zum vorhandenen Bot (WI-0255): eine Nachricht in einen Kanal senden und nachsehen, ob sie schon dort steht. Kein Gateway,
 * kein Dauerdienst (Betreiberauftrag: „kein Gateway-Dauerdienst, sofern Discord HTTP-Interactions + REST genügen“).
 *
 * - 🔴 Der Bot-Schlüssel steht nur im Kopf `Authorization`; keine Fehlermeldung, kein Protokoll und keine Antwort an die Oberfläche trägt ihn.
 *   Discords Fehlertext wird gekürzt und von Steuerzeichen befreit, bevor er in `fehler` landet.
 * - **Jede Antwort hat eine Art**, damit die Zustellung entscheiden kann: `ok` (mit Message-ID), `ratelimit` (429 mit `retry_after`),
 *   `abgelehnt` (4xx: Rechte, Kanal, Schlüssel; Wiederholen hilft nicht), `stoerung` (5xx) und `unklar` (Zeitüberschreitung oder Netzfehler:
 *   Die Anfrage kann angekommen sein).
 * - Gesendet wird mit `allowed_mentions: { parse: [] }` (nie ein Ping), `flags: 4` (keine Vorschaukarten für Verweise, der Bericht bleibt
 *   kompakt) und `nonce` mit `enforce_nonce`: Wiederholt ein Lauf binnen Minuten, gibt Discord die vorhandene Nachricht zurück statt einer
 *   zweiten.
 *
 * Tests reichen `fetch` herein; kein Test spricht mit Discord.
 */

export const DISCORD_API = "https://discord.com/api/v10";
export const ANFRAGE_ZEIT_MS = 10_000;
const UNTERDRUECKE_VORSCHAU = 1 << 2;

export interface DiscordNachricht {
    content: string;
    /** `parse: []` verbietet jede Erwähnung; `users` erlaubt genau die genannten Personen (nur die Posts zu `/bug` und `/idee`, nie der Bericht). */
    allowed_mentions: { parse: []; users?: string[] };
    flags: number;
    nonce: string;
    enforce_nonce: true;
}

export function nachrichtAus(text: string, nonce: string): DiscordNachricht {
    return { content: text, allowed_mentions: { parse: [] }, flags: UNTERDRUECKE_VORSCHAU, nonce, enforce_nonce: true };
}

/** Eine Nachricht, die genau die Personen `personen` anpingen darf (ihre Kennungen), sonst niemanden: keine Rolle, kein `@everyone`, kein `@here`. */
export function nachrichtAnPersonen(text: string, nonce: string, personen: readonly string[]): DiscordNachricht {
    return { ...nachrichtAus(text, nonce), allowed_mentions: { parse: [], users: [...personen] } };
}

export type SendeErgebnis =
    | { art: "ok"; messageId: string }
    | { art: "ratelimit"; nachSekunden: number; global: boolean }
    | { art: "abgelehnt"; status: number; meldung: string }
    | { art: "stoerung"; status: number }
    | { art: "unklar"; grund: string };

export type SucheErgebnis =
    { art: "gefunden"; messageId: string } | { art: "nicht_gefunden" } | { art: "fehler"; grund: string };

export interface DiscordRest {
    sende(kanal: string, nachricht: DiscordNachricht): Promise<SendeErgebnis>;
    /** Steht schon eine Nachricht des Bots seit `ab` im Kanal, deren Inhalt mit `anfang` beginnt? */
    suche(kanal: string, ab: Date, anfang: string): Promise<SucheErgebnis>;
}

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

/** Discords Fehlertext ohne Steuerzeichen, gekürzt; nie der Schlüssel (der steht ohnehin nie in einer Antwort von Discord). */
export function bereinigt(text: string, schluessel: string): string {
    const ohne = text.split(schluessel).join("[…]");
    // Steuerzeichen (unter 32 und 127) werden Leerzeichen; ein Zeichenvergleich statt eines Musters mit Steuerzeichen.
    const sauber = [...ohne].map((zeichen) =>
        zeichen.charCodeAt(0) < 32 || zeichen.charCodeAt(0) === 127 ? " " : zeichen,
    );
    return sauber.join("").replace(/\s+/gu, " ").trim().slice(0, 200);
}

async function meldungAus(antwort: Response, schluessel: string): Promise<string> {
    try {
        const roh = (await antwort.json()) as { code?: unknown; message?: unknown };
        const code = typeof roh.code === "number" ? ` (${String(roh.code)})` : "";
        const satz = typeof roh.message === "string" ? roh.message : "";
        return bereinigt(`${satz}${code}`, schluessel);
    } catch {
        return "";
    }
}

export function discordRest(schluessel: string, abruf: Abruf = fetch): DiscordRest {
    const kopf = {
        authorization: `Bot ${schluessel}`,
        "content-type": "application/json",
        "user-agent": "DiscordBot (https://avesmaps.de, 1.0)",
    };
    let botId: string | undefined;

    async function frage(pfad: string, init: RequestInit = {}): Promise<Response> {
        return await abruf(`${DISCORD_API}${pfad}`, {
            ...init,
            headers: kopf,
            signal: AbortSignal.timeout(ANFRAGE_ZEIT_MS),
        });
    }

    return {
        async sende(kanal, nachricht) {
            let antwort: Response;
            try {
                antwort = await frage(`/channels/${encodeURIComponent(kanal)}/messages`, {
                    method: "POST",
                    body: JSON.stringify(nachricht),
                });
            } catch (fehler) {
                const name = fehler instanceof Error ? fehler.name : "Fehler";
                return {
                    art: "unklar",
                    grund: name === "TimeoutError" ? "Zeitüberschreitung" : `Netzfehler (${name})`,
                };
            }
            if (antwort.ok) {
                try {
                    const rumpf = (await antwort.json()) as { id?: unknown };
                    if (typeof rumpf.id === "string" && /^\d{17,20}$/u.test(rumpf.id))
                        return { art: "ok", messageId: rumpf.id };
                } catch {
                    // Angekommen, aber die Antwort ist unlesbar: Dann wissen wir die Kennung nicht, also nachsehen.
                }
                return { art: "unklar", grund: "Antwort ohne Kennung" };
            }
            if (antwort.status === 429) {
                let nachSekunden = Number.parseFloat(antwort.headers.get("retry-after") ?? "");
                let global = antwort.headers.get("x-ratelimit-global") === "true";
                try {
                    const rumpf = (await antwort.json()) as { retry_after?: unknown; global?: unknown };
                    if (typeof rumpf.retry_after === "number") nachSekunden = rumpf.retry_after;
                    if (rumpf.global === true) global = true;
                } catch {
                    // Ohne Rumpf gilt der Kopf.
                }
                return { art: "ratelimit", nachSekunden: Number.isFinite(nachSekunden) ? nachSekunden : 60, global };
            }
            if (antwort.status >= 500) return { art: "stoerung", status: antwort.status };
            return { art: "abgelehnt", status: antwort.status, meldung: await meldungAus(antwort, schluessel) };
        },

        async suche(kanal, ab, anfang) {
            try {
                if (botId === undefined) {
                    const ich = await frage("/users/@me");
                    if (!ich.ok) return { art: "fehler", grund: `Bot nicht lesbar (${String(ich.status)})` };
                    const rumpf = (await ich.json()) as { id?: unknown };
                    if (typeof rumpf.id !== "string") return { art: "fehler", grund: "Bot ohne Kennung" };
                    botId = rumpf.id;
                }
                const liste = await frage(
                    `/channels/${encodeURIComponent(kanal)}/messages?limit=100&after=${snowflakeAb(ab)}`,
                );
                if (!liste.ok) return { art: "fehler", grund: `Kanal nicht lesbar (${String(liste.status)})` };
                const nachrichten = (await liste.json()) as {
                    id?: unknown;
                    content?: unknown;
                    author?: { id?: unknown };
                }[];
                const treffer = Array.isArray(nachrichten)
                    ? nachrichten.find(
                          (nachricht) =>
                              nachricht.author?.id === botId &&
                              typeof nachricht.content === "string" &&
                              nachricht.content.startsWith(anfang) &&
                              typeof nachricht.id === "string",
                      )
                    : undefined;
                return treffer === undefined
                    ? { art: "nicht_gefunden" }
                    : { art: "gefunden", messageId: String(treffer.id) };
            } catch (fehler) {
                const name = fehler instanceof Error ? fehler.name : "Fehler";
                return {
                    art: "fehler",
                    grund: name === "TimeoutError" ? "Zeitüberschreitung" : `Netzfehler (${name})`,
                };
            }
        },
    };
}
