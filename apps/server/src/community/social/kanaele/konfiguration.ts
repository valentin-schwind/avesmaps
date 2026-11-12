import { inspect } from "node:util";
import { DISCORD_KANAL_MUSTER } from "@avesmaps3d/shared";

/**
 * Die Konfiguration der fremden Kanäle des Social Hubs (WI-0268 C12a und C12b; Fachkonzept §15.7: „Zugangsschlüssel als Secret auf dem Server, nie im Klartext in der Datenbank“). Sie kommt aus der Umgebung des
 * Prozesses (Umgebungsdatei der Unit), nie aus einer Tafel:
 *
 *     COMMUNITY_SOCIAL_MASTODON_URL       die Instanz, nur `https`, etwa `https://rollenspiel.social` (ohne Pfad, Anmeldung, Anfrage)
 *     COMMUNITY_SOCIAL_MASTODON_TOKEN     der Zugangsschlüssel der Anwendung des Kontos (Rechte `write:statuses` und `write:media`)
 *
 *     COMMUNITY_SOCIAL_META_GRAPH_VERSION die Version der Graph-Schnittstelle von Meta, etwa `v21.0` (Vorgabe: `META_GRAPH_VERSION_VORGABE`); als Einstellung, weil Meta Versionen abkündigt
 *     COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID   die Kennung der Facebook-Seite (nur Ziffern)
 *     COMMUNITY_SOCIAL_FACEBOOK_TOKEN     der Zugangsschlüssel der Seite (`pages_manage_posts`, `pages_read_engagement`)
 *     COMMUNITY_SOCIAL_INSTAGRAM_USER_ID  die Kennung des Instagram-Geschäftskontos, verbunden mit der Seite (nur Ziffern)
 *     COMMUNITY_SOCIAL_INSTAGRAM_TOKEN    der Zugangsschlüssel dafür (`instagram_basic`, `instagram_content_publish`); darf derselbe Seitenschlüssel sein, steht aber in einer eigenen Angabe
 *
 *     COMMUNITY_SOCIAL_DISCORD_WEBHOOK    die Adresse des Webhooks im Kanal (`https://discord.com/api/webhooks/<Kennung>/<Schlüssel>`): Sie IST der Zugangsschlüssel und kann nur in diesen einen Kanal schreiben
 *     COMMUNITY_SOCIAL_DISCORD_KANAL      die Kennung des Kanals, zu dem der Webhook gehören muss (Form: `DISCORD_KANAL_MUSTER`); ein eigener Wert, nie der Kanal des Berichts, der Bugs oder der Ideen
 *
 * 🔴 **Fehlt eine der Angaben eines Kanals (oder ist eine unbrauchbar), gibt es den Kanal nicht** (`leseMastodonZugang`, `leseMetaZugang`, `leseDiscordZugang` geben `undefined`): Im Hub ist er nicht wählbar, der Grund steht im Tooltip,
 * es entsteht kein Auftrag. So bleibt jede Umgebung ohne Konfiguration unverändert (lokal und Stage senden nie ohne ausdrücklich eingerichtetes Testkonto). Facebook und Instagram sind zwei Kanäle: Der eine kann
 * eingerichtet sein, der andere nicht.
 *
 * 🔴 **Der Zugangsschlüssel steht nie in Logs, Fehlertexten oder Antworten.** Er lebt in einer Schließung, nicht im Objekt: Weder Spread noch `JSON.stringify` noch `console.log` noch eine Fehlerausgabe
 * finden ihn. Auch die Adresse der Instanz als Angabe der Konfiguration geht nie in eine Antwort der Schnittstelle (die öffentliche Adresse eines gesendeten Beitrags steht im Ziel); das Protokoll nennt allein, ob der Kanal eingerichtet ist.
 */

/** Die Jobart des Sendens (WI-0268 C12a, `jobs/social-senden-job.ts`). Hier, damit die Routen sie kennen, ohne den Auftrag zu laden. */
export const SOCIAL_SENDEN_KIND = "social_senden";

export const MASTODON_VARIABLEN = ["COMMUNITY_SOCIAL_MASTODON_URL", "COMMUNITY_SOCIAL_MASTODON_TOKEN"] as const;

/** Ein Zugang zu einer Mastodon-Instanz: Adressen der Schnittstelle und die Kopfzeile mit dem Schlüssel, nichts davon aufzählbar. */
export interface MastodonZugang {
    /**
     * Die Adresse eines Pfads der Schnittstelle (`/api/v2/instance`). Der Pfad ist fest im Code und beginnt mit `/api/`; ein Pfad, der die Instanz verließe (Doppelpunkt, `//`, `..`, Steuerzeichen), wirft.
     * 🔴 Nie die Adresse in einen Text setzen: Sie gehört zur Konfiguration.
     */
    adresse(pfad: string): string;
    /** Die Kopfzeilen für einen Aufruf mit Anmeldung. 🔴 Enthalten den Schlüssel: nie loggen. */
    anmeldeKopf(): Record<string, string>;
    /** Ersetzt jede Stelle des Schlüssels und der Adresse der Instanz in einem Text durch `…`. */
    entschaerfe(text: string): string;
}

// eslint-disable-next-line no-control-regex
const STEUERZEICHEN = /[\u0000-\u001f\u007f]/u;

/** Prüft die Adresse der Instanz: `https`, ein Host, ohne Anmeldung, Anfrage, Fragment und Pfad. `undefined`, wenn sie nicht taugt. */
export function leseInstanz(roh: string | undefined): URL | undefined {
    const text = roh?.trim();
    if (text === undefined || text === "" || text.length > 300 || STEUERZEICHEN.test(text)) return undefined;
    let url: URL;
    try {
        url = new URL(text);
    } catch {
        return undefined;
    }
    if (url.protocol !== "https:" || url.hostname === "") return undefined;
    if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return undefined;
    if (url.pathname !== "/") return undefined;
    return url;
}

/** Ein Zugangsschlüssel: eine Zeile ohne Leerraum und Steuerzeichen, damit aus ihm nie eine zweite Kopfzeile wird. Die Schlüssel von Meta sind länger als die von Mastodon (`hoechstens`). */
function leseSchluessel(roh: string | undefined, hoechstens = 500): string | undefined {
    const text = roh?.trim();
    if (text === undefined || text.length < 10 || text.length > hoechstens) return undefined;
    if (/\s/u.test(text) || STEUERZEICHEN.test(text)) return undefined;
    return text;
}

/**
 * Liest den Zugang. `undefined`, wenn eine Angabe fehlt, leer oder unbrauchbar ist: Der Kanal ist dann aus. Der Aufrufer erfährt nicht, WELCHE fehlt.
 */
export function leseMastodonZugang(umgebung: NodeJS.ProcessEnv = process.env): MastodonZugang | undefined {
    const instanz = leseInstanz(umgebung["COMMUNITY_SOCIAL_MASTODON_URL"]);
    const schluessel = leseSchluessel(umgebung["COMMUNITY_SOCIAL_MASTODON_TOKEN"]);
    if (instanz === undefined || schluessel === undefined) return undefined;
    const zugang = {} as MastodonZugang;
    const sichtbar = { kanal: "mastodon", eingerichtet: true };
    Object.defineProperty(zugang, "adresse", {
        enumerable: false,
        value: (pfad: string): string => {
            if (
                !pfad.startsWith("/api/") ||
                pfad.includes("//") ||
                pfad.includes("..") ||
                pfad.includes(":") ||
                STEUERZEICHEN.test(pfad)
            ) {
                throw new Error("ungültiger Pfad der Schnittstelle");
            }
            return new URL(pfad, instanz).toString();
        },
    });
    Object.defineProperty(zugang, "anmeldeKopf", {
        enumerable: false,
        value: (): Record<string, string> => ({ Authorization: `Bearer ${schluessel}` }),
    });
    Object.defineProperty(zugang, "entschaerfe", {
        enumerable: false,
        value: (text: string): string => text.split(schluessel).join("…").split(instanz.host).join("…"),
    });
    Object.defineProperty(zugang, "toJSON", { enumerable: false, value: () => sichtbar });
    Object.defineProperty(zugang, inspect.custom, { enumerable: false, value: () => sichtbar });
    return Object.freeze(zugang);
}

/** Kennt die Umgebung den Kanal Mastodon (beide Angaben da und brauchbar)? */
export const mastodonEingerichtet = (umgebung: NodeJS.ProcessEnv = process.env): boolean =>
    leseMastodonZugang(umgebung) !== undefined;

// --- Meta: Facebook-Seite und Instagram-Geschäftskonto (WI-0268 C12b) --------------------------------------------------------------------

/** Die Kanäle, die über die Graph-Schnittstelle von Meta gehen. */
export const META_KANAELE = ["facebook", "instagram"] as const;
export type MetaKanal = (typeof META_KANAELE)[number];
export const istMetaKanal = (kanal: string): kanal is MetaKanal => (META_KANAELE as readonly string[]).includes(kanal);

/** Die Version der Graph-Schnittstelle, wenn die Umgebung keine nennt. Meta kündigt Versionen ab (etwa zwei Jahre Laufzeit): Wer sie ändert, ändert die Einstellung, nicht den Code. */
export const META_GRAPH_VERSION_VORGABE = "v21.0";

export const META_VARIABLEN = {
    facebook: ["COMMUNITY_SOCIAL_FACEBOOK_PAGE_ID", "COMMUNITY_SOCIAL_FACEBOOK_TOKEN"],
    instagram: ["COMMUNITY_SOCIAL_INSTAGRAM_USER_ID", "COMMUNITY_SOCIAL_INSTAGRAM_TOKEN"],
} as const satisfies Record<MetaKanal, readonly [string, string]>;

const META_HOST = "https://graph.facebook.com";

/**
 * Ein Zugang zur Graph-Schnittstelle von Meta für EIN Konto: Adressen der Schnittstelle und die Kopfzeile mit dem Schlüssel, nichts davon aufzählbar (wie `MastodonZugang`). Die Kennung des Kontos (Seite oder
 * Instagram-Geschäftskonto) ist ein Teil der Pfade und kein Geheimnis, steht aber nie in einer Antwort der Schnittstelle des Hubs.
 */
export interface MetaZugang {
    readonly kanal: MetaKanal;
    /** Die Kennung der Seite beziehungsweise des Instagram-Geschäftskontos. */
    readonly konto: string;
    /**
     * Die Adresse eines Pfads der Schnittstelle mit Version (`/<Kennung>/feed`, `/<Kennung>`). Der Pfad besteht aus ein oder zwei Teilen (Kennung aus Ziffern und Unterstrich, dann ein Wort); ein Pfad, der den Host
     * verließe (Doppelpunkt, `//`, `..`, Steuerzeichen, Anfrage), wirft. `abfrage` sind feste Felder des Codes (`fields=status_code`), nie Eingaben.
     * 🔴 Nie die Adresse in einen Text setzen: Sie gehört zur Konfiguration.
     */
    adresse(pfad: string, abfrage?: Readonly<Record<string, string>>): string;
    /** Die Kopfzeilen für einen Aufruf mit Anmeldung. 🔴 Enthalten den Schlüssel: nie loggen. */
    anmeldeKopf(): Record<string, string>;
    /** Ersetzt jede Stelle des Schlüssels in einem Text durch `…`. */
    entschaerfe(text: string): string;
}

/** Die Version der Graph-Schnittstelle: leer heißt Vorgabe; `v21.0` ist die Form; alles andere macht die Einstellung unbrauchbar (und damit beide Kanäle aus). */
export function leseGraphVersion(umgebung: NodeJS.ProcessEnv = process.env): string | undefined {
    const roh = umgebung["COMMUNITY_SOCIAL_META_GRAPH_VERSION"]?.trim();
    if (roh === undefined || roh === "") return META_GRAPH_VERSION_VORGABE;
    return /^v[1-9][0-9]\.[0-9]$/u.test(roh) ? roh : undefined;
}

/** Die Kennung eines Kontos bei Meta: nur Ziffern. */
const leseKontoKennung = (roh: string | undefined): string | undefined => {
    const text = roh?.trim();
    return text !== undefined && /^[0-9]{5,25}$/u.test(text) ? text : undefined;
};

/** Die Form eines Pfads: ein Teil oder zwei, der erste eine Kennung (Ziffern, bei Beiträgen von Facebook mit Unterstrich), der zweite ein kleines Wort. */
const META_PFAD = /^\/[0-9][0-9_]{4,60}(?:\/[a-z_]{1,30})?$/u;

/**
 * Liest den Zugang eines Meta-Kanals. `undefined`, wenn eine Angabe fehlt, leer oder unbrauchbar ist (auch die Version): Der Kanal ist dann aus. Der Aufrufer erfährt nicht, WELCHE fehlt.
 */
export function leseMetaZugang(kanal: MetaKanal, umgebung: NodeJS.ProcessEnv = process.env): MetaZugang | undefined {
    const [kontoName, schluesselName] = META_VARIABLEN[kanal];
    const konto = leseKontoKennung(umgebung[kontoName]);
    const schluessel = leseSchluessel(umgebung[schluesselName], 1000);
    const version = leseGraphVersion(umgebung);
    if (konto === undefined || schluessel === undefined || version === undefined) return undefined;
    const zugang = {} as MetaZugang;
    const sichtbar = { kanal, eingerichtet: true };
    Object.defineProperty(zugang, "kanal", { enumerable: false, value: kanal });
    Object.defineProperty(zugang, "konto", { enumerable: false, value: konto });
    Object.defineProperty(zugang, "adresse", {
        enumerable: false,
        value: (pfad: string, abfrage?: Readonly<Record<string, string>>): string => {
            if (!META_PFAD.test(pfad)) throw new Error("ungültiger Pfad der Schnittstelle");
            const url = new URL(`${META_HOST}/${version}${pfad}`);
            for (const [name, wert] of Object.entries(abfrage ?? {})) {
                if (!/^[a-z_,]{1,40}$/u.test(name) || !/^[a-z_,]{1,60}$/u.test(wert)) {
                    throw new Error("ungültige Abfrage der Schnittstelle");
                }
                url.searchParams.set(name, wert);
            }
            return url.toString();
        },
    });
    Object.defineProperty(zugang, "anmeldeKopf", {
        enumerable: false,
        value: (): Record<string, string> => ({ Authorization: `Bearer ${schluessel}` }),
    });
    Object.defineProperty(zugang, "entschaerfe", {
        enumerable: false,
        value: (text: string): string => text.split(schluessel).join("…"),
    });
    Object.defineProperty(zugang, "toJSON", { enumerable: false, value: () => sichtbar });
    Object.defineProperty(zugang, inspect.custom, { enumerable: false, value: () => sichtbar });
    return Object.freeze(zugang);
}

/** Kennt die Umgebung diesen Meta-Kanal (Konto, Schlüssel und Version da und brauchbar)? */
export const metaEingerichtet = (kanal: MetaKanal, umgebung: NodeJS.ProcessEnv = process.env): boolean =>
    leseMetaZugang(kanal, umgebung) !== undefined;

// --- Discord: ein Webhook im Kanal (Vali 2026-11-03; warum kein Bot-Schlüssel: `discord.ts`) -----------------------------------------------

export const DISCORD_VARIABLEN = ["COMMUNITY_SOCIAL_DISCORD_WEBHOOK", "COMMUNITY_SOCIAL_DISCORD_KANAL"] as const;

/** Die Adresse, die Discord für einen Webhook nennt: fest der Host von Discord, eine Kennung und der Schlüssel; nichts sonst. */
const DISCORD_WEBHOOK =
    /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api(?:\/v[0-9]{1,2})?\/webhooks\/([0-9]{17,20})\/([A-Za-z0-9._-]{30,200})$/u;
const DISCORD_KANAL = new RegExp(DISCORD_KANAL_MUSTER, "u");
/** Der Pfad einer Nachricht hinter dem Webhook. */
const DISCORD_PFAD = /^(?:\/messages\/[0-9]{17,20})?$/u;

/** Ein Zugang zu einem Webhook bei Discord: die Adressen, nichts davon aufzählbar. Die Kennung des Kanals ist kein Geheimnis, steht aber in keiner Antwort der Schnittstelle des Hubs. */
export interface DiscordZugang {
    readonly kanal: string;
    /**
     * Die Adresse des Webhooks (`""`) oder einer seiner Nachrichten (`/messages/<Kennung>`); `abfrage` sind feste Felder des Codes (`wait=true`). Ein anderer Pfad wirft.
     * 🔴 Enthält den Schlüssel: nie in einen Text setzen.
     */
    adresse(pfad: string, abfrage?: Readonly<Record<string, string>>): string;
    /** Ersetzt jede Stelle des Schlüssels und der Kennung des Webhooks in einem Text durch `…`. */
    entschaerfe(text: string): string;
}

/**
 * Liest den Zugang zu Discord. `undefined`, wenn eine Angabe fehlt, leer oder unbrauchbar ist: Der Kanal ist dann aus. Der Aufrufer erfährt nicht, WELCHE fehlt. Die Adresse wird nie wörtlich benutzt, sondern aus ihren
 * geprüften Teilen neu gebaut: So kann aus der Einstellung kein anderer Host werden.
 */
export function leseDiscordZugang(umgebung: NodeJS.ProcessEnv = process.env): DiscordZugang | undefined {
    const treffer = DISCORD_WEBHOOK.exec(umgebung["COMMUNITY_SOCIAL_DISCORD_WEBHOOK"]?.trim() ?? "");
    const kanal = umgebung["COMMUNITY_SOCIAL_DISCORD_KANAL"]?.trim() ?? "";
    const [, kennung, schluessel] = treffer ?? [];
    if (kennung === undefined || schluessel === undefined || !DISCORD_KANAL.test(kanal)) return undefined;
    const basis = `https://discord.com/api/v10/webhooks/${kennung}/${schluessel}`;
    const zugang = {} as DiscordZugang;
    const sichtbar = { kanal: "discord", eingerichtet: true };
    Object.defineProperty(zugang, "kanal", { enumerable: false, value: kanal });
    Object.defineProperty(zugang, "adresse", {
        enumerable: false,
        value: (pfad: string, abfrage?: Readonly<Record<string, string>>): string => {
            if (!DISCORD_PFAD.test(pfad)) throw new Error("ungültiger Pfad der Schnittstelle");
            const url = new URL(`${basis}${pfad}`);
            for (const [name, wert] of Object.entries(abfrage ?? {})) {
                if (!/^[a-z_]{1,20}$/u.test(name) || !/^[a-z_]{1,20}$/u.test(wert)) {
                    throw new Error("ungültige Abfrage der Schnittstelle");
                }
                url.searchParams.set(name, wert);
            }
            return url.toString();
        },
    });
    Object.defineProperty(zugang, "entschaerfe", {
        enumerable: false,
        value: (text: string): string => text.split(schluessel).join("…").split(kennung).join("…"),
    });
    Object.defineProperty(zugang, "toJSON", { enumerable: false, value: () => sichtbar });
    Object.defineProperty(zugang, inspect.custom, { enumerable: false, value: () => sichtbar });
    return Object.freeze(zugang);
}

/** Kennt die Umgebung den Kanal Discord (Webhook und Kanal da und brauchbar)? */
export const discordEingerichtet = (umgebung: NodeJS.ProcessEnv = process.env): boolean =>
    leseDiscordZugang(umgebung) !== undefined;

/** Kennt die Umgebung diesen Kanal mit Zugang? */
export const kanalEingerichtet = (kanal: string, umgebung: NodeJS.ProcessEnv = process.env): boolean => {
    if (kanal === "mastodon") return mastodonEingerichtet(umgebung);
    if (kanal === "discord") return discordEingerichtet(umgebung);
    return istMetaKanal(kanal) && metaEingerichtet(kanal, umgebung);
};

/**
 * Die öffentliche Herkunft dieser Umgebung (`PUBLIC_ORIGIN`), wenn Meta von dort ein Bild abholen KANN: `https`, ein Host mit Punkt, kein Loopback, keine Adresse, keine Endung eines privaten Netzes (`.local`, `.test`,
 * `.localhost`, `.internal`, `.invalid`, `.lan`, `.ts.net`). Sonst `undefined`: Instagram holt sein Bild selbst ab und kann einen privaten Host nie erreichen.
 */
export function leseOeffentlicheHerkunft(umgebung: NodeJS.ProcessEnv = process.env): URL | undefined {
    const url = leseInstanz(umgebung["PUBLIC_ORIGIN"]);
    if (url === undefined) return undefined;
    const host = url.hostname.toLowerCase();
    if (!host.includes(".") || /^[0-9.]+$/u.test(host) || host.startsWith("[")) return undefined;
    if (/\.(local|test|localhost|internal|invalid|lan|example|ts\.net)$/u.test(host)) return undefined;
    return url;
}
