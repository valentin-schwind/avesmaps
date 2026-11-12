import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

/**
 * Eine fremde, öffentliche Webseite vom Server aus lesen (WI-0277): der EINE ausgehende Abruf an einer Adresse, die ein Mensch eingetippt hat. Vorbild ist Legacys Linkprüfung
 * (`api/_internal/linkcheck/probe.php`); wer so etwas noch einmal braucht, dockt hier an (`AGENTS.md`, „Andocken“).
 *
 * - 🔴 **Kein Weg nach innen (SSRF):** nur http und https, nur die Ports 80 und 443, keine Zugangsdaten in der Adresse, kein Name ohne Punkt und keine internen Endungen. **Alle** Adressen eines
 *   Namens müssen öffentlich sein, nicht nur eine (ein Name mit einer öffentlichen und einer privaten Adresse kommt nicht durch).
 * - 🔴 **Geprüft wird beim Verbinden, nicht davor:** Die Prüfung sitzt im `lookup` der Verbindung; sie verbindet genau mit den Adressen, die sie gerade geprüft hat. Eine Prüfung davor ließe einem Namen die Zeit, danach
 *   auf etwas Internes zu zeigen (DNS-Rebinding). 🪤 Eine Adresse aus Ziffern fragt nie nach einem `lookup`: Sie wird vorab geprüft; `new URL` hat `2130706433` und `0x7f.1` dann schon zu `127.0.0.1` gemacht.
 * - 🔴 **Jede Weiterleitung ist eine neue Adresse:** Sie durchläuft dieselbe Prüfung. Höchstens drei.
 * - **Kurz und klein:** sechs Sekunden über alles, Weiterleitungen eingeschlossen; gelesen werden höchstens 128 KiB und nur HTML (Legacy, gemessen: `<title>` bis Byte 459, `<h1>` bis 9.287). Danach bricht der Abruf ab und
 *   liefert, was da ist.
 * - **Ohne alles:** kein Cookie, keine Anmeldung; der Abruf nennt sich `AvesmapsLinkBot`, wie in Legacy.
 * - Was zurückkommt, ist **fremder Text**: Er wird hier nur geliefert, nie ausgeführt und nie geloggt.
 */

const ABRUF_MS = 6000;
const ABRUF_BYTES = 128 * 1024;
const WEITERLEITUNGEN = 3;
const KENNUNG = "AvesmapsLinkBot/1.0 (+https://avesmaps.de)";

const INTERNE_ENDUNGEN = /\.(?:local|localhost|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/u;

const GESPERRT = new BlockList();
for (const [netz, laenge] of [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
] as const) {
    GESPERRT.addSubnet(netz, laenge, "ipv4");
}
for (const [netz, laenge] of [
    ["::", 96],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
] as const) {
    GESPERRT.addSubnet(netz, laenge, "ipv6");
}

/** Eine Adresse, die der Abruf nie erreichen darf; im Zweifel gesperrt. `::ffff:127.0.0.1` zählt als die IPv4-Adresse, die es ist (`BlockList`). */
export function istGesperrteIp(ip: string): boolean {
    const familie = isIP(ip);
    if (familie === 0) return true;
    return GESPERRT.check(ip, familie === 4 ? "ipv4" : "ipv6");
}

/** Darf diese Adresse überhaupt gefragt werden (ohne DNS)? Prüft Schema, Port, Zugangsdaten und den Namen. */
export function istAbrufbar(url: URL): boolean {
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.port !== "" && url.port !== "80" && url.port !== "443") return false;
    if (url.username !== "" || url.password !== "") return false;
    const host = url.hostname
        .toLowerCase()
        .replace(/^\[|\]$/gu, "")
        .replace(/\.+$/u, "");
    if (isIP(host) !== 0) return !istGesperrteIp(host);
    return host.includes(".") && !INTERNE_ENDUNGEN.test(host);
}

/** Das `lookup` der Verbindung: Nur wenn ALLE Adressen des Namens öffentlich sind, verbindet sie, und zwar mit genau diesen. */
export const pruefendesLookup: LookupFunction = (host, optionen, fertig) => {
    dnsLookup(host, { all: true, verbatim: true }, (fehler, adressen: LookupAddress[]) => {
        if (fehler !== null) {
            fertig(fehler, "", 0);
            return;
        }
        if (adressen.length === 0 || adressen.some((eine) => istGesperrteIp(eine.address))) {
            const gesperrt: NodeJS.ErrnoException = new Error("Kein öffentlicher Name.");
            gesperrt.code = "ENOTPUBLIC";
            fertig(gesperrt, "", 0);
            return;
        }
        if (optionen.all === true) fertig(null, adressen);
        else fertig(null, adressen[0]!.address, adressen[0]!.family);
    });
};

export type Abruf =
    /** Die Adresse (oder ein Ziel ihrer Weiterleitung) ist keine öffentliche Seite; gefragt wurde sie nicht. */
    | { readonly art: "gesperrt" }
    /** Keine Antwort: Name unbekannt, keine Verbindung, Zeit um, zu viele Weiterleitungen. */
    | { readonly art: "keine_antwort" }
    /** Eine Antwort; `html` nur bei 2xx und HTML, höchstens die ersten 128 KiB. */
    | { readonly art: "antwort"; readonly status: number; readonly html?: string };

export interface AbrufOptionen {
    zeitMs?: number;
    maxBytes?: number;
    /** Nur für Tests: Prüfung und Namensauflösung ersetzen, damit ein Server auf dem eigenen Rechner antworten darf. */
    istErlaubt?: (url: URL) => boolean;
    lookup?: LookupFunction;
}

/** Der Text der Bytes: der Zeichensatz aus dem Kopf, sonst aus `<meta>`, sonst UTF-8; was als UTF-8 nicht aufgeht, ist fast immer Windows-1252 (alte Briefspielseiten). */
export function alsText(bytes: Buffer, inhaltsart: string | undefined): string {
    const ausKopf = /charset=["']?([\w-]+)/iu.exec(inhaltsart ?? "")?.[1];
    const ausMeta = /<meta[^>]{0,500}charset=["']?([\w-]+)/iu.exec(bytes.subarray(0, 4096).toString("latin1"))?.[1];
    const lies = (name: string): string | undefined => {
        try {
            return new TextDecoder(name).decode(bytes);
        } catch {
            return undefined;
        }
    };
    const genannt = lies(ausKopf ?? ausMeta ?? "utf-8");
    if (genannt !== undefined && !genannt.includes("�")) return genannt;
    return lies("windows-1252") ?? bytes.toString("utf8");
}

interface EinSchritt {
    status: number;
    location?: string | undefined;
    html?: string | undefined;
}

function einSchritt(url: URL, signal: AbortSignal, maxBytes: number, lookup: LookupFunction): Promise<EinSchritt> {
    const anfrage = url.protocol === "https:" ? httpsRequest : httpRequest;
    return new Promise((fertig, scheitert) => {
        const auftrag = anfrage(
            url,
            {
                method: "GET",
                signal,
                lookup,
                agent: false,
                headers: { "user-agent": KENNUNG, accept: "text/html,*/*;q=0.5", "accept-encoding": "identity" },
            },
            (antwort: IncomingMessage) => {
                const status = antwort.statusCode ?? 0;
                const location = antwort.headers.location;
                const inhaltsart = antwort.headers["content-type"];
                const kodierung = antwort.headers["content-encoding"];
                const liesRumpf =
                    status >= 200 &&
                    status < 300 &&
                    (inhaltsart === undefined || inhaltsart.toLowerCase().includes("html")) &&
                    (kodierung === undefined || kodierung === "identity");
                if (!liesRumpf) {
                    auftrag.destroy();
                    fertig({ status, location });
                    return;
                }
                const stuecke: Buffer[] = [];
                let laenge = 0;
                const schluss = (): void => {
                    fertig({ status, html: alsText(Buffer.concat(stuecke), inhaltsart) });
                };
                antwort.on("data", (stueck: Buffer) => {
                    stuecke.push(stueck);
                    laenge += stueck.length;
                    if (laenge >= maxBytes) {
                        schluss();
                        auftrag.destroy();
                    }
                });
                antwort.on("end", schluss);
                antwort.on("error", () => {
                    if (laenge > 0) schluss();
                    else scheitert(new Error("Die Antwort brach ab."));
                });
            },
        );
        auftrag.on("error", scheitert);
        auftrag.end();
    });
}

/** Die Seite unter dieser Adresse holen, mit allen Grenzen oben. Wirft nie: Jeder Ausgang ist ein Ergebnis. */
export async function holeOeffentlicheSeite(adresse: string, optionen: AbrufOptionen = {}): Promise<Abruf> {
    const istErlaubt = optionen.istErlaubt ?? istAbrufbar;
    const signal = AbortSignal.timeout(optionen.zeitMs ?? ABRUF_MS);
    let url: URL;
    try {
        url = new URL(adresse);
    } catch {
        return { art: "gesperrt" };
    }
    for (let schritt = 0; schritt <= WEITERLEITUNGEN; schritt += 1) {
        if (!istErlaubt(url)) return { art: "gesperrt" };
        let antwort: EinSchritt;
        try {
            antwort = await einSchritt(
                url,
                signal,
                optionen.maxBytes ?? ABRUF_BYTES,
                optionen.lookup ?? pruefendesLookup,
            );
        } catch (fehler) {
            return (fehler as NodeJS.ErrnoException).code === "ENOTPUBLIC"
                ? { art: "gesperrt" }
                : { art: "keine_antwort" };
        }
        if (antwort.status >= 300 && antwort.status < 400 && antwort.location !== undefined) {
            try {
                url = new URL(antwort.location, url);
            } catch {
                return { art: "keine_antwort" };
            }
            continue;
        }
        return antwort.html === undefined
            ? { art: "antwort", status: antwort.status }
            : { art: "antwort", status: antwort.status, html: antwort.html };
    }
    return { art: "keine_antwort" };
}
