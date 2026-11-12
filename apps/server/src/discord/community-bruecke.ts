import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
    COMMUNITY_DISCORD_OFFEN_PFAD,
    COMMUNITY_DISCORD_SIGNATUR_KOPF,
    COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
    COMMUNITY_DISCORD_ZEIT_KOPF,
    COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
    CommunityDiscordOffenAnfrage,
    CommunityDiscordOffenAntwort,
    CommunityDiscordUebernehmenAnfrage,
    CommunityDiscordUebernehmenAntwort,
    CommunityDiscordZurueckziehenAnfrage,
    CommunityDiscordZurueckziehenAntwort,
    brueckeSchluesselTaugt,
    signiere,
    type CommunityDiscordErgebnis,
    type CommunityDiscordZeile,
} from "@avesmaps3d/shared";

/**
 * Der Client der Brücke von der Stage nach Production (WI-0268 C8, Discord-Seite; Fachkonzept §8.3a, Vertrag `packages/shared/src/community-discord.ts`,
 * Betriebsvertrag `project-control/handovers/2026-10-31-wi0268-c8-discord-bruecke-an-claudio.md`). Der Bot lebt auf der Stage, Website-Meldungen liegen
 * in Production; hier fragt er dort nach den offenen Meldungen einer Discord-Kennung und zieht eine eigene zurück.
 *
 * | Variable                              | Bedeutung                                                                                      |
 * |---------------------------------------|------------------------------------------------------------------------------------------------|
 * | `COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL`| 🔴 Geheimnis: der gemeinsame Dienstschlüssel (mindestens 32 Zeichen); fehlt er, ist die Brücke aus |
 * | `COMMUNITY_DISCORD_BRUECKE_URL`       | wahlfrei: die Adresse von Production (Vorgabe `https://avesmaps.de`); `https`, nur lokal auch `http` |
 *
 * - **Nie eine Ausnahme:** Jeder Fehler (Brücke aus, Zeit, Netz, 4xx/5xx, Antwort gegen das Schema ungültig) ist ein Wert (`art: "aus"` oder
 *   `art: "ausfall"`), und der Aufrufer sagt dazu einen Satz. Nichts an `/offen` und `/erledigt` hängt an der Brücke.
 * - **Zeitgrenze 1,5 s** für Verbindung und Antwort zusammen; Discord wartet nur drei Sekunden auf die erste Antwort, und die Datenbank braucht auch Zeit.
 * - **Streng gelesen:** Die Antwort muss genau dem Schema entsprechen (keine zusätzlichen Felder). Liefert Production mehr als Nummer, Stand und Kurztitel,
 *   ist das ein Ausfall und nichts davon erreicht Discord.
 * - 🔴 **Nichts davon ins Protokoll:** weder der Schlüssel noch die Discord-Kennung noch die Antwort. `grund` ist eine der fünf Klassen, sonst nichts.
 * - Keine Weiterleitung (`redirect: "error"`): Eine signierte Anfrage geht nur an die eingestellte Adresse.
 */

export const BRUECKE_URL_VORGABE = "https://avesmaps.de";
/** Die Zeitgrenze einer Anfrage an Production. */
export const BRUECKE_ZEIT_MS = 1500;
/** Eine Antwort ist klein (höchstens 20 Zeilen); mehr lesen wir nicht. */
const ANTWORT_MAX_ZEICHEN = 64 * 1024;

type Abruf = (url: string, init: RequestInit) => Promise<Response>;

export interface BrueckeKonfig {
    /** Die Adresse von Production ohne Pfad der Brücke und ohne Schrägstrich am Ende. */
    url: string;
    /** 🔴 Geheim. Verlässt diesen Prozess nie; in die Anfrage geht nur die Signatur. */
    schluessel: string;
    /** Nur Tests: ein gestelltes `fetch` statt Production. Aus der Umgebung nie gesetzt. */
    abruf?: Abruf | undefined;
    /** Nur Tests: eine andere Zeitgrenze (Vorgabe 1500 ms). */
    zeitMs?: number | undefined;
    /** Nur Tests: die Uhr (Unix-Millisekunden). */
    jetzt?: (() => number) | undefined;
}

const leer = (wert: string | undefined): string | undefined =>
    wert === undefined || wert.trim() === "" ? undefined : wert.trim();
const LOKAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Die Konfiguration der Brücke aus der Umgebung, oder `undefined` (= aus): ohne Schlüssel, mit einem Schlüssel unter 32 Zeichen, oder mit einer Adresse, die
 * nicht `https` ist (lokal auch `http`), Zugangsdaten, Abfrage oder Anker trägt.
 */
export function brueckenKonfiguration(env: NodeJS.ProcessEnv): BrueckeKonfig | undefined {
    const schluessel = leer(env["COMMUNITY_DISCORD_BRUECKE_SCHLUESSEL"]);
    if (!brueckeSchluesselTaugt(schluessel)) return undefined;
    let ziel: URL;
    try {
        ziel = new URL(leer(env["COMMUNITY_DISCORD_BRUECKE_URL"]) ?? BRUECKE_URL_VORGABE);
    } catch {
        return undefined;
    }
    const sicher = ziel.protocol === "https:" || (ziel.protocol === "http:" && LOKAL.has(ziel.hostname));
    if (!sicher || ziel.username !== "" || ziel.password !== "" || ziel.search !== "" || ziel.hash !== "")
        return undefined;
    return { url: `${ziel.origin}${ziel.pathname.replace(/\/+$/u, "")}`, schluessel };
}

/** Warum die Brücke nichts lieferte: Zeit überschritten, Netz, Status außer 200, Antwort nicht nach Vertrag, Anfrage selbst unzulässig. */
export type BrueckeGrund = "zeit" | "netz" | "status" | "antwort" | "anfrage";

export type BrueckeAusfall = { art: "aus" } | { art: "ausfall"; grund: BrueckeGrund };
export type OffenErgebnis = { art: "ok"; zeilen: readonly CommunityDiscordZeile[] } | BrueckeAusfall;
export type ZurueckziehenErgebnis = { art: "ok"; ergebnis: CommunityDiscordErgebnis } | BrueckeAusfall;
export type UebernehmenErgebnis = { art: "ok"; nummer: string } | BrueckeAusfall;

/**
 * Die Zeitgrenze des Weiterleitens (WI-0297): Ein Betreiber hat geklickt und wartet; Discord wartet hier nicht. Bilder gehen mit, darum länger als `/offen`.
 */
export const UEBERNEHMEN_ZEIT_MS = 15_000;

export interface CommunityBruecke {
    /** Ist die Brücke eingeschaltet (Schlüssel und Adresse stimmen)? Nur dann sagt `/offen` etwas über einen Ausfall. */
    readonly eingeschaltet: boolean;
    /** Die offenen Website-Meldungen dieser Discord-Kennung. Wirft nie. */
    offeneWebsiteMeldungen(discordId: string): Promise<OffenErgebnis>;
    /** Zieht die eigene Website-Meldung `COM-…` zurück. Wirft nie. */
    websiteMeldungZurueckziehen(discordId: string, nummer: string): Promise<ZurueckziehenErgebnis>;
    /** Leitet eine Meldung aus dem Kanal an die Redaktion in Production weiter (WI-0297) und gibt die COM-Nummer zurück. Wirft nie. */
    anCommunityWeiterleiten(anfrage: CommunityDiscordUebernehmenAnfrage): Promise<UebernehmenErgebnis>;
}

const AUS: CommunityBruecke = {
    eingeschaltet: false,
    offeneWebsiteMeldungen: async () => ({ art: "aus" }),
    websiteMeldungZurueckziehen: async () => ({ art: "aus" }),
    anCommunityWeiterleiten: async () => ({ art: "aus" }),
};

/** Die Brücke zu Production; ohne Konfiguration (oder mit zu kurzem Schlüssel) ist sie aus. */
export function communityBruecke(konfig: BrueckeKonfig | undefined): CommunityBruecke {
    if (konfig === undefined || !brueckeSchluesselTaugt(konfig.schluessel)) return AUS;
    const { url, schluessel } = konfig;
    const abruf: Abruf = konfig.abruf ?? fetch;
    const zeitMs = konfig.zeitMs ?? BRUECKE_ZEIT_MS;
    const jetzt = konfig.jetzt ?? Date.now;

    /** Eine signierte Anfrage; der Rumpf wird vorher und die Antwort nachher gegen den Vertrag geprüft. */
    async function sende<A extends TSchema, R extends TSchema>(
        pfad: string,
        anfrageSchema: A,
        anfrage: Static<A>,
        antwortSchema: R,
        grenzeMs = zeitMs,
    ): Promise<{ art: "ok"; antwort: Static<R> } | { art: "ausfall"; grund: BrueckeGrund }> {
        if (!Value.Check(anfrageSchema, anfrage)) return { art: "ausfall", grund: "anfrage" };
        try {
            const rumpf = JSON.stringify(anfrage);
            const zeit = String(jetzt());
            const antwort = await abruf(`${url}${pfad}`, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    accept: "application/json",
                    "user-agent": "Avesmaps-Stage-Bruecke/1",
                    [COMMUNITY_DISCORD_ZEIT_KOPF]: zeit,
                    [COMMUNITY_DISCORD_SIGNATUR_KOPF]: await signiere(schluessel, zeit, rumpf),
                },
                body: rumpf,
                redirect: "error",
                signal: AbortSignal.timeout(grenzeMs),
            });
            if (antwort.status !== 200) return { art: "ausfall", grund: "status" };
            const text = await antwort.text();
            if (text.length > ANTWORT_MAX_ZEICHEN) return { art: "ausfall", grund: "antwort" };
            let roh: unknown;
            try {
                roh = JSON.parse(text);
            } catch {
                return { art: "ausfall", grund: "antwort" };
            }
            return Value.Check(antwortSchema, roh)
                ? { art: "ok", antwort: roh as Static<R> }
                : { art: "ausfall", grund: "antwort" };
        } catch (fehler) {
            // Nur die Klasse des Fehlers; sein Text kann die Adresse oder, bei einem Fehler im Netz, mehr verraten, als ins Protokoll gehört.
            const name = fehler instanceof Error ? fehler.name : "";
            return { art: "ausfall", grund: name === "TimeoutError" || name === "AbortError" ? "zeit" : "netz" };
        }
    }

    return {
        eingeschaltet: true,
        async offeneWebsiteMeldungen(discordId) {
            const ergebnis = await sende(
                COMMUNITY_DISCORD_OFFEN_PFAD,
                CommunityDiscordOffenAnfrage,
                { discordId },
                CommunityDiscordOffenAntwort,
            );
            return ergebnis.art === "ok" ? { art: "ok", zeilen: ergebnis.antwort.zeilen } : ergebnis;
        },
        async websiteMeldungZurueckziehen(discordId, nummer) {
            const ergebnis = await sende(
                COMMUNITY_DISCORD_ZURUECKZIEHEN_PFAD,
                CommunityDiscordZurueckziehenAnfrage,
                { discordId, nummer },
                CommunityDiscordZurueckziehenAntwort,
            );
            return ergebnis.art === "ok" ? { art: "ok", ergebnis: ergebnis.antwort.ergebnis } : ergebnis;
        },
        async anCommunityWeiterleiten(anfrage) {
            const ergebnis = await sende(
                COMMUNITY_DISCORD_UEBERNEHMEN_PFAD,
                CommunityDiscordUebernehmenAnfrage,
                anfrage,
                CommunityDiscordUebernehmenAntwort,
                // Nur Tests geben eine eigene Zeit vor; sonst gilt die längere Grenze dieses Wegs.
                konfig.zeitMs ?? UEBERNEHMEN_ZEIT_MS,
            );
            return ergebnis.art === "ok" ? { art: "ok", nummer: ergebnis.antwort.nummer } : ergebnis;
        },
    };
}
