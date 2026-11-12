import { shallowRef, type ShallowRef } from "vue";
import { CONTENT_STATE_URL, type ContentState } from "@avesmaps3d/shared";

/**
 * Was die Inhaltsschalter der Systemsteuerung gerade ausblenden (WI-0127 SYS-10, SYS-0001 §3.4): der öffentliche Stand
 * `GET /api/content-state`, damit das Panel, die Katalogfenster, der Kartenumschalter und die Hinweise an der Stelle des Inhalts
 * ihren Satz zeigen, statt einen leeren Abschnitt oder einen Fehler.
 *
 * - **Wahrheit beim Server:** Er liefert ausgeblendete Bilder und Abschnitte gar nicht erst aus (Grund `switched_off`, `paused`). Was hier
 *   steht, steuert nur die Sätze; ohne Antwort gilt nichts als ausgeblendet.
 * - **Gelesen beim ersten Blick** (`ausgeblendet`), dann im Takt mit ETag (304 kostet nichts) und sobald die Seite wieder sichtbar wird.
 *   Kein Eingriff in den Start der Anwendung.
 * - **Der Stand der Reisebilder fährt mit** (`reisebilder`, WI-0272): Ändert er sich, holt die Seite leise Karte, Leiste und Ortskopf neu (`photobox/reisebilder-frisch.ts`). Kein eigener Takt.
 */

export const CONTENT_STATE_POLL_MS = 60_000;

export interface Inhaltsstand {
    readonly revision: number | null;
    readonly off: ReadonlySet<string>;
    /** Anders als vorher heißt: Die freigegebenen Reisebilder haben sich geändert. Bis zur ersten Antwort und auf einem älteren Server fehlt er. */
    readonly reisebilder?: string | undefined;
}

export interface InhaltsstandQuelle {
    readonly stand: Readonly<ShallowRef<Inhaltsstand>>;
    /** Ist dieser Schalter gerade aus? Startet das Lesen beim ersten Aufruf. */
    ausgeblendet(key: string): boolean;
    /** Alle Schalter, die gerade aus sind; startet das Lesen wie `ausgeblendet`. */
    aus(): ReadonlySet<string>;
    /** Einmal lesen (für Tests und nach einer eigenen Umschaltung). */
    lies(): Promise<void>;
}

const LEER: Inhaltsstand = { revision: null, off: new Set() };

export function createInhaltsstand(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    takt: (lies: () => void) => void = starteTakt,
): InhaltsstandQuelle {
    const stand = shallowRef<Inhaltsstand>(LEER);
    let etag: string | undefined;
    let gestartet = false;

    async function lies(): Promise<void> {
        try {
            const response = await fetcher(CONTENT_STATE_URL, {
                headers: etag === undefined ? {} : { "if-none-match": etag },
                cache: "no-cache",
            });
            if (response.status === 304 || !response.ok) return;
            const body = (await response.json()) as ContentState;
            etag = response.headers.get("etag") ?? undefined;
            stand.value = { revision: body.revision, off: new Set(body.off), reisebilder: body.reisebilder };
        } catch {
            // Ohne Antwort bleibt der letzte Stand; der Server blendet trotzdem aus.
        }
    }

    function starte(): void {
        if (gestartet) return;
        gestartet = true;
        void lies();
        takt(() => void lies());
    }

    return {
        stand,
        ausgeblendet(key) {
            starte();
            return stand.value.off.has(key);
        },
        aus() {
            starte();
            return stand.value.off;
        },
        lies,
    };
}

function starteTakt(lies: () => void): void {
    if (typeof window === "undefined") return;
    window.setInterval(lies, CONTENT_STATE_POLL_MS);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") lies();
    });
}

/** Der eine Stand der Seite. */
export const inhaltsstand = createInhaltsstand();

/** Kurzform für Vorlagen: `ausgeblendet("panel.literature")`. */
export const ausgeblendet = (key: string): boolean => inhaltsstand.ausgeblendet(key);
