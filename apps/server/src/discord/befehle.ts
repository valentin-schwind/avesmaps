import { randomBytes } from "node:crypto";
import { pruefeKanal, type KanalUrteil } from "./kanalpruefung.ts";
import { discordKonfiguration } from "./konfig.ts";
import { ANFRAGE_ZEIT_MS, DISCORD_API, bereinigt, discordRest, nachrichtAus, type SendeErgebnis } from "./rest.ts";

/**
 * Was Claudio auf der Kommandozeile mit dem Bot-Schlüssel tut (WI-0255 Paket 2; `cli.ts befehle-registrieren`, `cli.ts discord-nachricht`):
 * die Befehle bei Discord anmelden und einen Text in den Berichtskanal stellen. Leicht und ohne Datenbank, damit Tests es mit gestelltem `fetch` prüfen.
 *
 * - 🔴 `discord-nachricht` sendet nur in den Berichtskanal (Vali 2026-10-26: „du sollst den testkanal nicht mehr benutzen. der einzige kanal, den du
 *   benutzen darfst ist: 1523690349816447157“). Welcher das ist, sagt `CliDeps.berichtsKanal` (die Kommandozeile: der Reiter vor der Umgebung);
 *   ohne das gilt `DISCORD_BERICHT_KANAL`. Ein `--kanal`, der davon abweicht, wird abgelehnt, nichts geht hinaus.
 * - 🔴 Der Bot-Schlüssel steht nur im Kopf `Authorization`. Keine Rückgabe, keine Meldung und kein Fehlertext trägt ihn (`bereinigt`).
 * - `PUT /applications/{id}/commands` ERSETZT die Liste: Was nicht darin steht, verschwindet (so gingen 2026-10-26 Legacys `/offen` und
 *   `/erledigt` verloren; seit 2026-10-31 stehen alle sechs darin). Mit
 *   `server` gilt die Liste nur in diesem Server und sofort (eine globale Anmeldung kann bei Discord bis zu einer Stunde brauchen).
 * - 🔴 Discord zeigt eine Liste auf Server-Ebene NEBEN der globalen, jeder Befehl steht dann doppelt (OPS-000076). `befehle-lesen` zeigt beide Ebenen, nur lesend;
 *   `befehle-server-leeren` leert genau die eines Servers und nie die globale.
 */

/**
 * Die Befehle, wie Discord sie angemeldet bekommt (Typ 1: Slash-Befehl), in Legacys Reihenfolge (`api/_internal/discord/__tests__/commands-test.php`):
 * `hilfe, bug, idee, frage, offen, erledigt`. Beschreibungen höchstens 100 Zeichen. `/erledigt` trägt die Nummer einer Meldung aus Discord als ganze Zahl (Option
 * Typ 4) oder die Nummer einer Website-Meldung als Text (Option Typ 3, `meldung:COM-000123`, WI-0268 C8); beide wahlfrei, genau eine ist nötig (der Empfänger sagt es).
 * Nach dem Rollout dieser Liste: `discord-einrichten.sh --befehle-registrieren`, sonst kennt Discord die neue Option nicht.
 */
export const DISCORD_BEFEHLE = [
    { name: "hilfe", description: "Die Befehle von Avesmaps im Überblick", type: 1 },
    { name: "bug", description: "Einen Fehler auf avesmaps.de melden", type: 1 },
    { name: "idee", description: "Eine Idee oder einen Wunsch für Avesmaps einreichen", type: 1 },
    { name: "frage", description: "Eine Frage an die Betreiber von Avesmaps", type: 1 },
    { name: "offen", description: "Die offenen Meldungen aus Discord", type: 1 },
    {
        name: "erledigt",
        description: "Eine eigene Meldung als erledigt schließen oder zurückziehen",
        type: 1,
        // Genau eine der beiden Optionen ist Pflicht; Discord kann das nicht ausdrücken, darum beide wahlfrei und die Prüfung im Empfänger.
        options: [
            {
                type: 4,
                name: "nummer",
                description: "Die Nummer einer Meldung aus Discord, wie /offen sie zeigt, etwa 123",
                required: false,
                min_value: 1,
            },
            {
                type: 3,
                name: "meldung",
                description: "Eine eigene Website-Meldung, etwa COM-000123",
                required: false,
                min_length: 1,
                max_length: 20,
            },
        ],
    },
] as const;

type Abruf = (url: string, init: RequestInit) => Promise<Response>;
const SNOWFLAKE = /^\d{17,20}$/u;

export type RegistrierErgebnis =
    | { art: "ok"; status: number; namen: string[]; beschreibungen: string[] }
    | { art: "abgelehnt"; status: number; meldung: string }
    | { art: "unklar"; grund: string };

/** Die Liste einer Ebene lesen oder ersetzen; die Antwort von Discord ist in beiden Fällen die Liste danach. */
async function befehlsListe(
    schluessel: string,
    anwendung: string,
    optionen: { server?: string | undefined; abruf?: Abruf; schreibe?: readonly unknown[] },
): Promise<RegistrierErgebnis> {
    if (!SNOWFLAKE.test(anwendung)) return { art: "abgelehnt", status: 0, meldung: "Application ID ungültig" };
    if (optionen.server !== undefined && !SNOWFLAKE.test(optionen.server))
        return { art: "abgelehnt", status: 0, meldung: "Server-Kennung ungültig" };
    const ziel =
        optionen.server === undefined
            ? `/applications/${anwendung}/commands`
            : `/applications/${anwendung}/guilds/${optionen.server}/commands`;
    let antwort: Response;
    try {
        antwort = await (optionen.abruf ?? fetch)(`${DISCORD_API}${ziel}`, {
            method: optionen.schreibe === undefined ? "GET" : "PUT",
            headers: {
                authorization: `Bot ${schluessel}`,
                "content-type": "application/json",
                "user-agent": "DiscordBot (https://avesmaps.de, 1.0)",
            },
            ...(optionen.schreibe === undefined ? {} : { body: JSON.stringify(optionen.schreibe) }),
            signal: AbortSignal.timeout(ANFRAGE_ZEIT_MS),
        });
    } catch (fehler) {
        const name = fehler instanceof Error ? fehler.name : "Fehler";
        return { art: "unklar", grund: name === "TimeoutError" ? "Zeitüberschreitung" : `Netzfehler (${name})` };
    }
    if (antwort.ok) {
        const namen: string[] = [];
        const beschreibungen: string[] = [];
        try {
            const liste = (await antwort.json()) as { name?: unknown; description?: unknown }[];
            if (Array.isArray(liste))
                for (const befehl of liste) {
                    if (typeof befehl.name !== "string") continue;
                    namen.push(befehl.name);
                    beschreibungen.push(typeof befehl.description === "string" ? befehl.description : "");
                }
        } catch {
            // Angekommen, aber die Liste ist unlesbar: dann bleiben die Namen leer.
        }
        return { art: "ok", status: antwort.status, namen, beschreibungen };
    }
    let meldung = "";
    try {
        const roh = (await antwort.json()) as { message?: unknown; code?: unknown };
        meldung = `${typeof roh.message === "string" ? roh.message : ""}${typeof roh.code === "number" ? ` (${String(roh.code)})` : ""}`;
    } catch {
        // ohne Rumpf
    }
    return { art: "abgelehnt", status: antwort.status, meldung: bereinigt(meldung, schluessel) };
}

export const registriereBefehle = (
    schluessel: string,
    anwendung: string,
    optionen: { server?: string | undefined; abruf?: Abruf } = {},
): Promise<RegistrierErgebnis> => befehlsListe(schluessel, anwendung, { ...optionen, schreibe: DISCORD_BEFEHLE });

/** Was bei Discord angemeldet ist, global oder in einem Server. Liest nur. */
export const leseBefehle = (
    schluessel: string,
    anwendung: string,
    optionen: { server?: string | undefined; abruf?: Abruf } = {},
): Promise<RegistrierErgebnis> => befehlsListe(schluessel, anwendung, optionen);

/** Leert die Liste EINES Servers. Die globale Liste bleibt; ohne Server gibt es diesen Aufruf nicht. */
export const leereServerBefehle = (
    schluessel: string,
    anwendung: string,
    server: string,
    optionen: { abruf?: Abruf } = {},
): Promise<RegistrierErgebnis> => befehlsListe(schluessel, anwendung, { ...optionen, server, schreibe: [] });

/** Die Grenze einer Discord-Nachricht. */
export const NACHRICHT_MAX = 2000;

export type TextErgebnis =
    | { art: "gesendet"; messageId: string }
    | { art: "kanal"; urteil: Exclude<KanalUrteil, { art: "erlaubt" }> }
    | { art: "senden"; ergebnis: Exclude<SendeErgebnis, { art: "ok" }> };

/**
 * Ein Text in einen Kanal (die Begrüßung im Berichtskanal, WI-0255 Abnahme; den Kanal wählt der Aufrufer, `befehlOhneDatenbank` nur den Berichtskanal): zuerst prüfen, ob der Bot dort sehen und schreiben darf
 * (`kanalpruefung.ts`), dann senden, ohne Pings und ohne Vorschaukarten. Länge und Kanal prüft der Aufrufer (`textFuerDiscord`).
 */
export async function sendeText(
    schluessel: string,
    kanal: string,
    inhalt: string,
    abruf: Abruf = fetch,
): Promise<TextErgebnis> {
    const urteil = await pruefeKanal(schluessel, kanal, abruf);
    if (urteil.art !== "erlaubt") return { art: "kanal", urteil };
    const ergebnis = await discordRest(schluessel, abruf).sende(
        kanal,
        nachrichtAus(inhalt, `text${randomBytes(8).toString("hex")}`),
    );
    return ergebnis.art === "ok" ? { art: "gesendet", messageId: ergebnis.messageId } : { art: "senden", ergebnis };
}

/** Ein Text aus einer Datei, bereit für Discord: ohne Rand, nicht leer, höchstens 2000 Zeichen; sonst der Grund. */
export function textFuerDiscord(roh: string): { ok: true; text: string } | { ok: false; grund: string } {
    const text = roh
        .replace(/^\uFEFF/u, "")
        .replace(/\r\n?/gu, "\n")
        .trim();
    if (text === "") return { ok: false, grund: "der Text ist leer" };
    const laenge = [...text].length;
    if (laenge > NACHRICHT_MAX)
        return {
            ok: false,
            grund: `der Text hat ${String(laenge)} Zeichen, Discord nimmt höchstens ${String(NACHRICHT_MAX)}`,
        };
    return { ok: true, text };
}

export const istKennung = (wert: string | undefined): wert is string => wert !== undefined && SNOWFLAKE.test(wert);

/** Die Befehle der Kommandozeile, die keine Datenbank brauchen (`cli.ts`). */
export const OHNE_DATENBANK = [
    "befehle-registrieren",
    "befehle-lesen",
    "befehle-server-leeren",
    "discord-nachricht",
    "kanal-pruefen",
] as const;
export type BefehlOhneDatenbank = (typeof OHNE_DATENBANK)[number];

export interface CliDeps {
    out(zeile: string): void;
    err(zeile: string): void;
    lies(pfad: string): string;
    abruf?: Abruf;
    /** Der Berichtskanal, der gilt (der Reiter vor der Umgebung). Fehlt es, gilt `DISCORD_BERICHT_KANAL` der Umgebung. Wirft es, wird nichts gesendet. */
    berichtsKanal?: () => Promise<string | undefined>;
}

const wert = (argumente: readonly string[], name: string): string | undefined => {
    const i = argumente.indexOf(name);
    return i < 0 ? undefined : argumente[i + 1];
};

/**
 * Das Urteil von `pruefeKanal` als eine Zeile für die Kommandozeile und der Exitcode dazu: 0 nur bei „erlaubt“, sonst 1. Keine Zeile trägt den Schlüssel
 * (`pruefeKanal` nennt nur Schritt und HTTP-Status).
 */
function kanalZeile(kanal: string, urteil: KanalUrteil): { zeile: string; code: number } {
    const kopf = `discord kanal-pruefen: Kanal ${kanal}:`;
    switch (urteil.art) {
        case "erlaubt":
            return { zeile: `${kopf} erlaubt, der Bot darf dort sehen und schreiben`, code: 0 };
        case "verboten":
            return {
                zeile: `${kopf} verboten, der Bot darf dort nicht ${
                    urteil.grund === "sehen"
                        ? "sehen"
                        : urteil.grund === "schreiben"
                          ? "schreiben"
                          : "schreiben (kein Textkanal)"
                }`,
                code: 1,
            };
        case "unbekannt":
            return { zeile: `${kopf} unbekannt, den Kanal gibt es nicht oder der Bot sieht ihn nicht`, code: 1 };
        case "nicht_pruefbar":
            return { zeile: `${kopf} nicht prüfbar (${urteil.grund})`, code: 1 };
    }
}

/**
 * `befehle-registrieren [--server <id>]`, `befehle-lesen [--server <id>]`, `befehle-server-leeren --server <id>`, `discord-nachricht --datei <pfad> [--kanal <berichtskanal>]` und
 * `kanal-pruefen --kanal <id>`. Exitcode 0 bei Erfolg, 1 wenn Discord ablehnt oder nicht erreichbar ist, 2 bei falschem Aufruf oder fehlendem Schlüssel. 🔴 Keine Zeile trägt den Bot-Schlüssel.
 *
 * `kanal-pruefen` ist nur lesend (WI-0255; Claudios Bitte 2026-11-03 für `--meldungs-kanaele`): Es ruft allein `pruefeKanal` auf, vier `GET`, und sendet nichts. Anders als
 * `discord-nachricht` gilt es für jeden Kanal, den der Aufrufer nennt (die Kanäle von `/bug` und `/idee` sind nicht der Berichtskanal); Exitcode 0 nur bei „erlaubt“.
 */
export async function befehlOhneDatenbank(
    befehl: BefehlOhneDatenbank,
    argumente: readonly string[],
    env: NodeJS.ProcessEnv,
    anwendung: string,
    deps: CliDeps,
): Promise<number> {
    const schluessel = env["DISCORD_BOT_TOKEN"]?.trim();
    if (schluessel === undefined || schluessel === "") {
        deps.err(`discord ${befehl}: DISCORD_BOT_TOKEN fehlt`);
        return 2;
    }
    const abruf = deps.abruf ?? fetch;
    if (befehl === "kanal-pruefen") {
        const kanal = wert(argumente, "--kanal");
        if (!istKennung(kanal)) {
            deps.err("Aufruf: cli.ts kanal-pruefen --kanal <kanal-id> (17 bis 20 Ziffern)");
            return 2;
        }
        const { zeile, code } = kanalZeile(kanal, await pruefeKanal(schluessel, kanal, abruf));
        (code === 0 ? deps.out : deps.err)(zeile);
        return code;
    }
    if (befehl === "befehle-lesen" || befehl === "befehle-server-leeren") {
        const server = wert(argumente, "--server");
        if ((argumente.includes("--server") || befehl === "befehle-server-leeren") && !istKennung(server)) {
            deps.err(`discord ${befehl}: --server braucht die Kennung eines Servers (17 bis 20 Ziffern)`);
            return 2;
        }
        const ergebnis =
            befehl === "befehle-lesen"
                ? await leseBefehle(schluessel, anwendung, { server, abruf })
                : await leereServerBefehle(schluessel, anwendung, server!, { abruf });
        if (ergebnis.art !== "ok") {
            deps.err(
                ergebnis.art === "abgelehnt"
                    ? `discord ${befehl}: abgelehnt (HTTP ${String(ergebnis.status)}${ergebnis.meldung === "" ? "" : `: ${ergebnis.meldung}`})`
                    : `discord ${befehl}: unklar (${ergebnis.grund})`,
            );
            return 1;
        }
        const wo = server === undefined ? "global" : `im Server ${server}`;
        deps.out(
            `discord ${befehl}: ${wo}: ${String(ergebnis.namen.length)} Befehle (HTTP ${String(ergebnis.status)})`,
        );
        ergebnis.namen.forEach((name, i) => deps.out(`  /${name}: ${ergebnis.beschreibungen[i] ?? ""}`));
        return 0;
    }
    if (befehl === "befehle-registrieren") {
        const server = wert(argumente, "--server");
        if (argumente.includes("--server") && !istKennung(server)) {
            deps.err("discord befehle-registrieren: --server braucht die Kennung eines Servers (17 bis 20 Ziffern)");
            return 2;
        }
        const wo =
            server === undefined
                ? "global, bei Discord bis zu einer Stunde bis sichtbar"
                : `im Server ${server}, sofort`;
        const ergebnis = await registriereBefehle(schluessel, anwendung, { server, abruf });
        if (ergebnis.art === "ok") {
            deps.out(
                `discord befehle-registrieren: angemeldet für ${anwendung} (${wo}): ${ergebnis.namen.join(", ") || "-"} (HTTP ${String(ergebnis.status)})`,
            );
            return 0;
        }
        deps.err(
            ergebnis.art === "abgelehnt"
                ? `discord befehle-registrieren: abgelehnt (HTTP ${String(ergebnis.status)}${ergebnis.meldung === "" ? "" : `: ${ergebnis.meldung}`})`
                : `discord befehle-registrieren: unklar (${ergebnis.grund})`,
        );
        return 1;
    }
    const angegeben = wert(argumente, "--kanal");
    const datei = wert(argumente, "--datei");
    if ((argumente.includes("--kanal") && !istKennung(angegeben)) || datei === undefined || datei.startsWith("--")) {
        deps.err("Aufruf: cli.ts discord-nachricht --datei <pfad> [--kanal <berichtskanal-id>]");
        return 2;
    }
    // 🔴 Der einzige Kanal ist der Berichtskanal. Lässt er sich nicht ermitteln, geht nichts hinaus.
    let kanal: string | undefined;
    try {
        kanal = await (deps.berichtsKanal ?? (async () => discordKonfiguration(env).berichtKanal))();
    } catch {
        deps.err("discord discord-nachricht: nicht gesendet, der Berichtskanal ließ sich nicht ermitteln");
        return 1;
    }
    if (kanal === undefined) {
        deps.err(
            "discord discord-nachricht: nicht gesendet, kein Berichtskanal eingestellt (Reiter „Discord“ oder DISCORD_BERICHT_KANAL)",
        );
        return 2;
    }
    if (angegeben !== undefined && angegeben !== kanal) {
        deps.err(
            `discord discord-nachricht: nicht gesendet, ${angegeben} ist nicht der Berichtskanal; gesendet wird nur dorthin`,
        );
        return 2;
    }
    let roh: string;
    try {
        roh = deps.lies(datei);
    } catch {
        deps.err(`discord discord-nachricht: ${datei} ist nicht lesbar`);
        return 2;
    }
    const text = textFuerDiscord(roh);
    if (!text.ok) {
        deps.err(`discord discord-nachricht: nicht gesendet, ${text.grund}`);
        return 2;
    }
    const ergebnis = await sendeText(schluessel, kanal, text.text, abruf);
    if (ergebnis.art === "gesendet") {
        deps.out(`discord discord-nachricht: gesendet in ${kanal} (Nachricht ${ergebnis.messageId})`);
        return 0;
    }
    if (ergebnis.art === "kanal") {
        const u = ergebnis.urteil;
        deps.err(
            u.art === "verboten"
                ? `discord discord-nachricht: nicht gesendet, der Bot darf in ${kanal} nicht ${u.grund === "sehen" ? "sehen" : u.grund === "schreiben" ? "schreiben" : "schreiben (kein Textkanal)"}`
                : u.art === "unbekannt"
                  ? `discord discord-nachricht: nicht gesendet, den Kanal ${kanal} gibt es nicht oder der Bot sieht ihn nicht`
                  : `discord discord-nachricht: nicht gesendet, Kanal nicht prüfbar (${u.grund})`,
        );
        return 1;
    }
    const e = ergebnis.ergebnis;
    deps.err(
        `discord discord-nachricht: nicht gesendet (${
            e.art === "abgelehnt"
                ? `HTTP ${String(e.status)}${e.meldung === "" ? "" : `: ${e.meldung}`}`
                : e.art === "ratelimit"
                  ? `Rate-Limit, ${String(e.nachSekunden)} s`
                  : e.art === "stoerung"
                    ? `Störung bei Discord, HTTP ${String(e.status)}`
                    : e.grund
        })`,
    );
    return 1;
}
