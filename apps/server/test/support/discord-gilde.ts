/**
 * Ein gestelltes Discord für die Prüfung eines Kanals (WI-0255, `discord/kanalpruefung.ts`): eine Gilde mit einer Rolle für alle (`GILDE`) und einer Rolle des
 * Bots, Kanäle mit eigenem Verhalten, und jede Anfrage wird gemerkt. Kein Test spricht mit Discord; die Kennungen sind erfunden, im Format von Discord.
 */

export const GILDE = "2000000000000000001";
export const BOT = "3000000000000000001";
export const ROLLE = "4000000000000000001";

export const ANSEHEN = 1n << 10n;
export const SENDEN = 1n << 11n;
export const ADMIN = 1n << 3n;

const json = (status: number, rumpf: unknown): Response =>
    new Response(JSON.stringify(rumpf), { status, headers: { "content-type": "application/json" } });

export interface Gilde {
    /** Felder des Kanalobjekts, die überschrieben werden (etwa `type: 2` oder eine fremde `id`). */
    kanal?: Record<string, unknown>;
    /** Rechte der Rolle „alle“ (Vorgabe: ansehen und senden) und der Rolle des Bots (Vorgabe: keine). */
    alle?: bigint;
    botRolle?: bigint;
    ueberschreibungen?: { id: string; type: number; allow: bigint; deny: bigint }[];
    rollenDesBots?: string[];
    /** Ein HTTP-Status statt der Antwort, je Schritt. */
    status?: Partial<Record<"kanal" | "bot" | "rollen" | "mitglied", number>>;
    wirft?: "netz" | "zeit";
}

/**
 * `gilde` gilt für alles; `kanaele` überschreibt es je Kanalkennung (Verhalten des Kanals: `kanal`, `ueberschreibungen`, `status.kanal`, `wirft`).
 * `fehlertext` steht im Rumpf jeder Fehlerantwort: Er darf in keinem Urteil und keiner Antwort der App wieder auftauchen.
 */
export interface GestellteGilde {
    abruf: (url: string, init: RequestInit) => Promise<Response>;
    anfragen: { url: string; method: string; authorization: string | null }[];
}

export function gestellteGilde(
    gilde: Gilde = {},
    kanaele: Record<string, Gilde> = {},
    fehlertext = "kaputt",
): GestellteGilde {
    const anfragen: { url: string; method: string; authorization: string | null }[] = [];
    const abruf = async (url: string, init: RequestInit): Promise<Response> => {
        const pfad = url.replace("https://discord.com/api/v10", "");
        anfragen.push({
            url: pfad,
            method: init.method ?? "GET",
            authorization: new Headers(init.headers).get("authorization"),
        });
        const kanalId = /^\/channels\/(\d+)$/u.exec(pfad)?.[1];
        const fuerKanal = kanalId === undefined ? gilde : (kanaele[kanalId] ?? gilde);
        const wirft = fuerKanal.wirft ?? gilde.wirft;
        if (wirft === "netz") throw new TypeError("fetch failed");
        if (wirft === "zeit") throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        const fehler = (status: number): Response => json(status, { message: fehlertext, code: 1 });
        if (kanalId !== undefined) {
            if (fuerKanal.status?.kanal !== undefined) return fehler(fuerKanal.status.kanal);
            return json(200, {
                id: kanalId,
                type: 0,
                guild_id: GILDE,
                permission_overwrites: (fuerKanal.ueberschreibungen ?? []).map((o) => ({
                    id: o.id,
                    type: o.type,
                    allow: String(o.allow),
                    deny: String(o.deny),
                })),
                ...fuerKanal.kanal,
            });
        }
        if (pfad === "/users/@me") return gilde.status?.bot ? fehler(gilde.status.bot) : json(200, { id: BOT });
        if (pfad === `/guilds/${GILDE}/roles`) {
            if (gilde.status?.rollen !== undefined) return fehler(gilde.status.rollen);
            return json(200, [
                { id: GILDE, permissions: String(gilde.alle ?? ANSEHEN | SENDEN) },
                { id: ROLLE, permissions: String(gilde.botRolle ?? 0n) },
            ]);
        }
        if (pfad === `/guilds/${GILDE}/members/${BOT}`) {
            if (gilde.status?.mitglied !== undefined) return fehler(gilde.status.mitglied);
            return json(200, { roles: gilde.rollenDesBots ?? [ROLLE] });
        }
        return fehler(404);
    };
    return { abruf, anfragen };
}
