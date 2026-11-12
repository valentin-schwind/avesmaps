import { postJson, type Fetcher } from "../auth/api";
import type { MessageKey } from "../i18n/de";
import { istSchluessel } from "./api";

/**
 * „Mit Discord verbinden“ für Melder (WI-0268 C8; Fachkonzept §8.3 und §8.4, Bedienkonzept §2.1 und §5). Der Weg ist der der Anmeldung mit Discord (`POST /api/auth/discord/start`, Zweck `melder`), aber ohne Konto
 * und ohne Sitzung: Discord bestätigt nur die Kennung, die der Server an die Meldung hängt.
 *
 * - 🔴 **Der Statusschlüssel steht in keiner Adresse.** Er geht im Rumpf an den Server, und weil die Seite für den Sprung zu Discord verlassen wird und beim Zurückkommen kein Fragment mehr hat, legt sie ihn vor dem
 *   Sprung in `sessionStorage` (nur dieser Tab, höchstens 15 Minuten, beim Lesen gelöscht). Die Rückkehr (`/meldung?discord=<Ergebnis>`) trägt nur das Ergebnis; `main.ts` stellt den Schlüssel von dort wieder her.
 * - Ohne Speicher (privates Fenster, gesperrte Websitedaten) kommt die Seite ohne Schlüssel zurück und sagt es (`nicht_gefunden`); die Verbindung selbst ist dann trotzdem gesetzt.
 */

/** Die Ergebnisse der Rückkehr (`MelderOutcome` in `apps/server/src/routes/auth-discord.ts`). */
export const MELDER_ERGEBNISSE = ["verbunden", "abgebrochen", "discord_fehler", "nicht_gefunden"] as const;
export type MelderErgebnis = (typeof MELDER_ERGEBNISSE)[number];

/** Der Parameter der Rückkehr: `/meldung?discord=verbunden`. */
export const DISCORD_PARAMETER = "discord";

export const istMelderErgebnis = (text: string | null | undefined): text is MelderErgebnis =>
    (MELDER_ERGEBNISSE as readonly (string | null | undefined)[]).includes(text);

/** Der Satz zur Rückkehr und wie laut er ist (Toast): Gutes als `success`, was nicht ging als `warning`. */
export function ergebnisSatz(ergebnis: MelderErgebnis): {
    readonly key: MessageKey;
    readonly ton: "success" | "warning";
} {
    switch (ergebnis) {
        case "verbunden":
            return { key: "community.discord.ergebnis.verbunden", ton: "success" };
        case "abgebrochen":
            return { key: "community.discord.ergebnis.abgebrochen", ton: "warning" };
        case "nicht_gefunden":
            return { key: "community.discord.ergebnis.nichtGefunden", ton: "warning" };
        case "discord_fehler":
            return { key: "community.discord.ergebnis.discordFehler", ton: "warning" };
    }
}

const SCHLUESSEL_KEY = "avesmaps3d.community-schluessel";
/** Länger als ein Umweg über Discord (zehn Minuten) braucht der Schlüssel nicht zu überleben. */
const BEHALTEN_MS = 15 * 60_000;

interface Gemerkt {
    readonly schluessel: string;
    readonly at: number;
}

/** Vor dem Sprung zu Discord: den Statusschlüssel für die Rückkehr merken (nur dieser Tab). */
export function merkeSchluessel(schluessel: string, jetzt: number = Date.now(), speicher?: Storage): void {
    try {
        (speicher ?? globalThis.sessionStorage)?.setItem(
            SCHLUESSEL_KEY,
            JSON.stringify({ schluessel, at: jetzt } satisfies Gemerkt),
        );
    } catch {
        // Ohne Speicher kommt die Seite ohne Schlüssel zurück und sagt es.
    }
}

/** Nach der Rückkehr: den gemerkten Schlüssel einmal holen und löschen; `null`, wenn keiner da, zu alt oder verstümmelt ist. */
export function nimmSchluessel(jetzt: number = Date.now(), speicher?: Storage): string | null {
    try {
        const ort = speicher ?? globalThis.sessionStorage;
        const roh = ort?.getItem(SCHLUESSEL_KEY);
        ort?.removeItem(SCHLUESSEL_KEY);
        if (roh === null || roh === undefined) return null;
        const gemerkt = JSON.parse(roh) as Partial<Gemerkt>;
        if (typeof gemerkt.at !== "number" || typeof gemerkt.schluessel !== "string") return null;
        if (jetzt - gemerkt.at > BEHALTEN_MS || jetzt < gemerkt.at) return null;
        return istSchluessel(gemerkt.schluessel) ? gemerkt.schluessel : null;
    } catch {
        return null;
    }
}

export interface VerbindenUmfeld {
    readonly fetcher?: Fetcher | undefined;
    /** Nur Tests: statt `location.assign`. */
    readonly gehe?: ((adresse: string) => void) | undefined;
    readonly speicher?: Storage | undefined;
    readonly jetzt?: (() => number) | undefined;
}

/**
 * Der Sprung zu Discord: Der Server legt den Umweg an (der Schlüssel im Rumpf, nie in der Adresse), erst dann wird der Schlüssel für die Rückkehr gemerkt und die Seite verlassen. Scheitert der Start (Netz, 404,
 * 503), bleibt die Seite stehen und der Aufrufer sagt es; nichts ist gemerkt.
 */
export async function verbindeMitDiscord(schluessel: string, umfeld: VerbindenUmfeld = {}): Promise<void> {
    const { authorizeUrl } = await postJson<{ authorizeUrl: string }>(
        "/api/auth/discord/start",
        { purpose: "melder", schluessel },
        umfeld.fetcher,
    );
    merkeSchluessel(schluessel, (umfeld.jetzt ?? Date.now)(), umfeld.speicher);
    (umfeld.gehe ?? ((adresse: string) => globalThis.location.assign(adresse)))(authorizeUrl);
}
