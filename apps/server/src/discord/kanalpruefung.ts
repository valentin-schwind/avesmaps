import { DISCORD_API } from "./rest.ts";

/**
 * Die Prüfung eines Kanals beim Speichern der Einstellungen (WI-0255; Vali 2026-10-25: „auch den kanal festlegen können“; Claudios Vorschlag:
 * „eine Prüfung ‚der Bot darf in diesem Kanal schreiben‘ beim Speichern“). Der Bot-Schlüssel kommt aus der geschützten Konfiguration; hier wird
 * gelesen, nie gesendet, und es wird nichts aufbewahrt.
 *
 * 1. `GET /channels/{id}`: Gibt es den Kanal, sieht der Bot ihn, ist es ein Textkanal einer Gilde (Text oder Ankündigung)? 404: **unbekannt**; 403:
 *    **verboten** (`sehen`); anderer Kanaltyp: **verboten** (`kein_textkanal`).
 * 2. Darf der Bot dort **schreiben**? Discord liefert die Rechte des Bots im Kanal nicht fertig; sie werden aus dem gerechnet, was jeder Bot lesen darf
 *    (`GET /users/@me`, `GET /guilds/{g}/roles`, `GET /guilds/{g}/members/{bot}`): die Rechte der Rollen, dann die Überschreibungen des Kanals in der
 *    Reihenfolge, die Discord dokumentiert (alle, Rollen, Bot). Fehlt „Kanal ansehen“ oder „Nachrichten senden“: **verboten**.
 * 3. Erreicht die App Discord nicht, lehnt es den Schlüssel ab oder antwortet unlesbar: **nicht_pruefbar**. Das ist kein Urteil über den Kanal, und
 *    der Aufrufer speichert dann nichts.
 *
 * 🔴 Der Schlüssel steht nur im Kopf `Authorization`. Kein Urteil, keine Meldung und kein Grund trägt ihn oder Discords Fehlertext; `grund` nennt nur
 * den Schritt und den HTTP-Status.
 */

export type KanalGrund = "sehen" | "schreiben" | "kein_textkanal";

export type KanalUrteil =
    | { art: "erlaubt" }
    | { art: "verboten"; grund: KanalGrund }
    | { art: "unbekannt" }
    | { art: "nicht_pruefbar"; grund: string };

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

/** Discords Rechte als Bits (`permissions` kommt als Zahl in einem Text, bis 2^48). */
const ADMINISTRATOR = 1n << 3n;
const KANAL_ANSEHEN = 1n << 10n;
const NACHRICHTEN_SENDEN = 1n << 11n;
/** `GUILD_TEXT` und `GUILD_ANNOUNCEMENT`: die Kanäle, in die ein Bot einen Tagesbericht schreibt. */
const TEXTKANAELE: readonly number[] = [0, 5];
const ZEIT_MS = 8_000;

/** Eine Anfrage, die nicht antworten konnte oder deren Antwort nicht taugt. */
class NichtPruefbar extends Error {}

export interface Ueberschreibung {
    id: string;
    /** 0: Rolle, 1: Mitglied. */
    type: number;
    allow: bigint;
    deny: bigint;
}

const wieZahl = (wert: unknown): bigint => {
    if (typeof wert !== "string" || !/^[0-9]{1,20}$/u.test(wert)) throw new NichtPruefbar("Rechte unlesbar");
    return BigInt(wert);
};

/** Die Rechte des Bots im Kanal nach der Reihenfolge der Discord-Dokumentation (`Permission Overwrites`). */
export function rechteImKanal(
    gilde: string,
    bot: string,
    rollenDerGilde: ReadonlyMap<string, bigint>,
    rollenDesBots: readonly string[],
    ueberschreibungen: readonly Ueberschreibung[],
): bigint {
    // Die Rolle „alle“ trägt die Kennung der Gilde.
    let rechte = rollenDerGilde.get(gilde) ?? 0n;
    for (const rolle of rollenDesBots) rechte |= rollenDerGilde.get(rolle) ?? 0n;
    if ((rechte & ADMINISTRATOR) !== 0n) return ~0n;
    const alle = ueberschreibungen.find((eintrag) => eintrag.id === gilde && eintrag.type === 0);
    if (alle !== undefined) rechte = (rechte & ~alle.deny) | alle.allow;
    let erlaubt = 0n;
    let verboten = 0n;
    for (const rolle of rollenDesBots) {
        const eintrag = ueberschreibungen.find((o) => o.id === rolle && o.type === 0);
        if (eintrag === undefined) continue;
        erlaubt |= eintrag.allow;
        verboten |= eintrag.deny;
    }
    rechte = (rechte & ~verboten) | erlaubt;
    const selbst = ueberschreibungen.find((o) => o.id === bot && o.type === 1);
    if (selbst !== undefined) rechte = (rechte & ~selbst.deny) | selbst.allow;
    return rechte;
}

export async function pruefeKanal(schluessel: string, kanal: string, abruf: Abruf = fetch): Promise<KanalUrteil> {
    const kopf = {
        authorization: `Bot ${schluessel}`,
        "user-agent": "DiscordBot (https://avesmaps.de, 1.0)",
    };
    const frage = async (schritt: string, pfad: string): Promise<Response> => {
        try {
            return await abruf(`${DISCORD_API}${pfad}`, {
                method: "GET",
                headers: kopf,
                signal: AbortSignal.timeout(ZEIT_MS),
            });
        } catch (fehler) {
            const name = fehler instanceof Error ? fehler.name : "Fehler";
            throw new NichtPruefbar(`${schritt}: ${name === "TimeoutError" ? "Zeitüberschreitung" : "Netzfehler"}`);
        }
    };
    const lies = async (schritt: string, antwort: Response): Promise<unknown> => {
        if (!antwort.ok) throw new NichtPruefbar(`${schritt}: HTTP ${String(antwort.status)}`);
        try {
            return (await antwort.json()) as unknown;
        } catch {
            throw new NichtPruefbar(`${schritt}: Antwort unlesbar`);
        }
    };

    try {
        const kanalAntwort = await frage("Kanal", `/channels/${encodeURIComponent(kanal)}`);
        if (kanalAntwort.status === 404) return { art: "unbekannt" };
        if (kanalAntwort.status === 403) return { art: "verboten", grund: "sehen" };
        const roh = (await lies("Kanal", kanalAntwort)) as {
            id?: unknown;
            type?: unknown;
            guild_id?: unknown;
            permission_overwrites?: unknown;
        };
        if (roh.id !== kanal) throw new NichtPruefbar("Kanal: unerwartete Antwort");
        if (typeof roh.type !== "number" || !TEXTKANAELE.includes(roh.type) || typeof roh.guild_id !== "string") {
            return { art: "verboten", grund: "kein_textkanal" };
        }
        const gilde = roh.guild_id;

        const [ich, rollen] = await Promise.all([
            frage("Bot", "/users/@me").then((antwort) => lies("Bot", antwort)),
            frage("Rollen", `/guilds/${encodeURIComponent(gilde)}/roles`).then((antwort) => lies("Rollen", antwort)),
        ]);
        const botId = (ich as { id?: unknown }).id;
        if (typeof botId !== "string" || !/^[0-9]{17,20}$/u.test(botId)) throw new NichtPruefbar("Bot: ohne Kennung");
        const mitglied = (await lies(
            "Mitglied",
            await frage("Mitglied", `/guilds/${encodeURIComponent(gilde)}/members/${encodeURIComponent(botId)}`),
        )) as { roles?: unknown };

        if (!Array.isArray(rollen) || !Array.isArray(mitglied.roles)) {
            throw new NichtPruefbar("Rollen: unerwartete Antwort");
        }
        const rollenDerGilde = new Map<string, bigint>();
        for (const rolle of rollen as { id?: unknown; permissions?: unknown }[]) {
            if (typeof rolle.id === "string") rollenDerGilde.set(rolle.id, wieZahl(rolle.permissions));
        }
        const rollenDesBots = (mitglied.roles as unknown[]).filter(
            (rolle): rolle is string => typeof rolle === "string",
        );
        const roheUeberschreibungen = (Array.isArray(roh.permission_overwrites) ? roh.permission_overwrites : []) as {
            id?: unknown;
            type?: unknown;
            allow?: unknown;
            deny?: unknown;
        }[];
        const ueberschreibungen = roheUeberschreibungen.flatMap((eintrag): Ueberschreibung[] =>
            typeof eintrag.id === "string" && typeof eintrag.type === "number"
                ? [{ id: eintrag.id, type: eintrag.type, allow: wieZahl(eintrag.allow), deny: wieZahl(eintrag.deny) }]
                : [],
        );

        const rechte = rechteImKanal(gilde, botId, rollenDerGilde, rollenDesBots, ueberschreibungen);
        if ((rechte & KANAL_ANSEHEN) === 0n) return { art: "verboten", grund: "sehen" };
        if ((rechte & NACHRICHTEN_SENDEN) === 0n) return { art: "verboten", grund: "schreiben" };
        return { art: "erlaubt" };
    } catch (fehler) {
        if (fehler instanceof NichtPruefbar) return { art: "nicht_pruefbar", grund: fehler.message };
        return { art: "nicht_pruefbar", grund: "unerwarteter Fehler" };
    }
}
