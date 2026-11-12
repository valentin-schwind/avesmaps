import {
    COMMUNITY_URL,
    STATUS_SCHLUESSEL_MUSTER,
    type CommunityStand,
    type KontaktBody,
    type MeldungAntwort,
    type MeldungBody,
    type StatusAntwortBody,
    type StatusDiscordLoesenAntwort,
    type StatusSicht,
    type StatusZurueckziehenBody,
    type VorgangQuittung,
} from "@avesmaps3d/shared";
import { ApiFailure, getJson, newOperationId, postJson, type Fetcher } from "../auth/api";
import type { MessageKey } from "../i18n/de";

/**
 * Die Besucherseite der Meldungen an der Leitung (WI-0268 C2; Server: `apps/server/src/routes/community.ts`, Vertrag `packages/shared/src/community.ts`).
 * Sieben Aufrufe (seit WI-0268 C4 mit dem Kontaktformular, seit C8 mit „Verbindung lösen“), alle an dieselbe Herkunft und im Umschlag der Fehler (ADR-0018): Die Oberfläche wählt ihren eigenen Satz nach dem Code und zeigt nie den Text des Servers.
 *
 * - 🔴 **Der Schlüssel der Statusseite entsteht HIER, im Browser** (32 Zufallsbytes, base64url, 43 Zeichen), und geht nur im Rumpf: Der Server sieht ihn, speichert aber
 *   nur seinen Hash, und in keiner Adresse und keinem Log steht er. Wer das Formular erneut sendet (Netz weg), schickt denselben Schlüssel und dieselbe `operationId`
 *   (`neuesFormular`), damit daraus nie zwei Vorgänge werden.
 * - 🔴 **Eine Kennung je Formular**, nicht je Versuch (ADR-0019): `operationId` wird beim Öffnen gezogen und bleibt, bis das Formular zugeht oder verworfen wird.
 */

/** Die Kennungen, die EIN Formular trägt: Sie überleben ein erneutes Senden, nicht das nächste Formular. */
export interface FormularKennung {
    readonly operationId: string;
    readonly schluessel: string;
}

/** 32 Zufallsbytes als base64url ohne Auffüllung: 43 Zeichen (`STATUS_SCHLUESSEL_MUSTER`). */
export function neuerSchluessel(
    zufall: (bytes: Uint8Array) => Uint8Array = (bytes) => globalThis.crypto.getRandomValues(bytes),
): string {
    const bytes = zufall(new Uint8Array(32));
    let text = "";
    for (const byte of bytes) text += String.fromCharCode(byte);
    return btoa(text).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
}

/** Passt dieser Text zum Schlüssel der Statusseite? Vor jeder Frage an den Server geprüft: Ein verstümmelter Link fragt gar nicht erst. */
export const istSchluessel = (text: string): boolean => new RegExp(STATUS_SCHLUESSEL_MUSTER, "u").test(text);

export function neuesFormular(): FormularKennung {
    return { operationId: newOperationId(), schluessel: neuerSchluessel() };
}

/** Die Adresse der Statusseite: der Schlüssel im Fragment, nie in der Suche (`STATUS_PFAD`, Bedienkonzept §1.2). */
export const statusAdresse = (origin: string, schluessel: string): string => `${origin}/meldung#${schluessel}`;

/**
 * Der Stand des Moduls: geht es gerade, ist der Mailweg eingerichtet (WI-0268 C6a), und geht „Mit Discord verbinden“ (C8)? Eine Antwort, die fehlt, ist ein Nein: Ein toter Knopf wäre schlimmer als ein Satz.
 */
export async function ladeModulStand(
    fetcher: Fetcher = fetch,
): Promise<{ meldungen: boolean; mailweg: boolean; discord: boolean }> {
    try {
        const stand = await getJson<CommunityStand>(`${COMMUNITY_URL}/stand`, fetcher);
        return {
            meldungen: stand.meldungen === true,
            mailweg: stand.mailweg === true,
            discord: stand.discord === true,
        };
    } catch {
        return { meldungen: false, mailweg: false, discord: false };
    }
}

/** Geht „Mit Discord verbinden“ gerade (die Anmeldung mit Discord ist hier eingerichtet und das Modul geht)? */
export async function ladeDiscord(fetcher: Fetcher = fetch): Promise<boolean> {
    return (await ladeModulStand(fetcher)).discord;
}

/** Geht das Meldeformular gerade? */
export async function ladeStand(fetcher: Fetcher = fetch): Promise<boolean> {
    return (await ladeModulStand(fetcher)).meldungen;
}

/** Ist der Mailweg eingerichtet? Antworten gehen dann als Mail, sonst auf die Statusseite. */
export async function ladeMailweg(fetcher: Fetcher = fetch): Promise<boolean> {
    return (await ladeModulStand(fetcher)).mailweg;
}

export const sendeMeldung = (body: MeldungBody, fetcher?: Fetcher): Promise<MeldungAntwort> =>
    postJson<MeldungAntwort>(`${COMMUNITY_URL}/meldungen`, body, fetcher);

/** Das Kontaktformular der Hinweise (WI-0268 C4): eine Anfrage; die Antwort ist die COM-Nummer wie bei der Meldung. */
export const sendeKontakt = (body: KontaktBody, fetcher?: Fetcher): Promise<MeldungAntwort> =>
    postJson<MeldungAntwort>(`${COMMUNITY_URL}/anfragen`, body, fetcher);

export const leseStatus = (schluessel: string, fetcher?: Fetcher): Promise<StatusSicht> =>
    postJson<StatusSicht>(`${COMMUNITY_URL}/status`, { schluessel }, fetcher);

export const sendeAntwort = (body: StatusAntwortBody, fetcher?: Fetcher): Promise<VorgangQuittung> =>
    postJson<VorgangQuittung>(`${COMMUNITY_URL}/status/antwort`, body, fetcher);

export const ziehZurueck = (body: StatusZurueckziehenBody, fetcher?: Fetcher): Promise<VorgangQuittung> =>
    postJson<VorgangQuittung>(`${COMMUNITY_URL}/status/zurueckziehen`, body, fetcher);

/** Die Verbindung mit Discord lösen (WI-0268 C8): aus allen Meldungen derselben Verbindung. Verbunden wird über den Sprung zu Discord (`discord-verbinden.ts`). */
export const loeseDiscord = (schluessel: string, fetcher?: Fetcher): Promise<StatusDiscordLoesenAntwort> =>
    postJson<StatusDiscordLoesenAntwort>(`${COMMUNITY_URL}/status/discord-loesen`, { schluessel }, fetcher);

/**
 * Was schiefging, in der Sprache der Oberfläche (ADR-0018: der Fachcode, nie der Text des Servers).
 * - `netz`: nichts ist angekommen; der Text bleibt, erneutes Senden ist gefahrlos (dieselbe Kennung).
 * - `zu_viele`: die Drossel (429); `sperreBis` nennt die Uhrzeit.
 * - `nicht_moeglich`: das Modul ist auf dieser Instanz nicht eingerichtet (503).
 * - `ungueltig`: die Angaben wurden nicht angenommen (422, 400).
 * - `nicht_gefunden`: kein Vorgang zu diesem Schlüssel (404), derselbe Satz für „nie gewesen“ und „abgelaufen“.
 * - `sonst`: alles Übrige (fremde Herkunft, Serverfehler).
 */
export type FehlerArt = "netz" | "zu_viele" | "nicht_moeglich" | "ungueltig" | "nicht_gefunden" | "sonst";

export function fehlerArt(fehler: unknown): FehlerArt {
    if (!(fehler instanceof ApiFailure)) return "sonst";
    if (fehler.status === 0 || fehler.code === "network") return "netz";
    switch (fehler.code) {
        case "community_rate":
            return "zu_viele";
        case "community_unavailable":
            return "nicht_moeglich";
        case "community_invalid":
        case "validation_failed":
            return "ungueltig";
        case "community_not_found":
            return "nicht_gefunden";
        default:
            return fehler.status === 429 ? "zu_viele" : fehler.status === 503 ? "nicht_moeglich" : "sonst";
    }
}

export const FEHLER_SATZ: Readonly<Record<FehlerArt, MessageKey>> = {
    netz: "community.fehler.netz",
    zu_viele: "community.fehler.zuViele",
    nicht_moeglich: "community.nichtMoeglich",
    ungueltig: "community.fehler.ungueltig",
    nicht_gefunden: "community.status.fehlt",
    sonst: "community.fehler.sonst",
};

/** Frühestens wann es nach einer Drossel (429) wieder geht; der Server nennt die Sekunden, die Uhrzeit rechnet die Oberfläche. */
export function sperreBis(fehler: unknown, jetzt: Date): Date | undefined {
    if (!(fehler instanceof ApiFailure) || fehlerArt(fehler) !== "zu_viele") return undefined;
    const sekunden = fehler.details?.["retryAfterSeconds"];
    return new Date(jetzt.getTime() + (typeof sekunden === "number" && sekunden > 0 ? sekunden : 3600) * 1000);
}

/**
 * Wie der Server Längen zählt: in Codepunkten (ajv `maxLength`, `char_length` der Datenbank), nicht in UTF-16-Einheiten. Ein Emoji ist EIN Zeichen; mit `.length` (zwei) bot das Fenster den Knopf
 * zu früh nicht mehr an und sagte „zu lang“, wo der Server angenommen hätte (WI-0291).
 */
export const zeichenZahl = (text: string): number => [...text].length;

/** Auf höchstens `max` Codepunkte kürzen, ohne ein Zeichen in der Mitte durchzuschneiden. */
export const kuerzeZeichen = (text: string, max: number): string =>
    zeichenZahl(text) > max ? [...text].slice(0, max).join("") : text;
