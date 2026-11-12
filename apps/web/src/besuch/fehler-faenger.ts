import type { App } from "vue";
import { CLIENT_FEHLER_GRENZEN, diagnoseAus, seitenSignatur, type ClientFehlerArt } from "@avesmaps3d/shared";
import { grafikKlasse, sendeFehler } from "./besuch-melden";

/**
 * Die Fänger für Fehler im Browser (WI-0202; Betreiber 2026-10-16: „fehler protokollieren ist hilfreich, es muss
 * datenschutzrechtlich gesichert sein, dass wir bei abstürzen diagnosen erheben“). Was erfasst wird und was nie, steht in
 * `packages/shared/src/client-fehler.ts`; verschickt wird über die Besuchsmeldung (`besuch-melden.ts`).
 *
 * - **Grenze je Seite:** Jede Art zählt einmal, jede Diagnose geht einmal hinaus, höchstens `jeSeite`. Eine Fehlerschleife
 *   flutet damit weder die Statistik noch die Drossel des Servers.
 * - **Nichts wird gespeichert:** Die Grenzen leben im Speicher dieses Tabs und verfallen mit ihm.
 * - 🔴 **Der Fänger wirft nie.** Ein Fehler beim Erfassen eines Fehlers bleibt hier.
 *
 * Die Karte (`karte`, `worker`, `kontext_verloren`) hängt `fehler-karte.ts` an; hier stehen Fenster, Vue und Start.
 */

const gezaehlt = new Set<ClientFehlerArt>();
const signaturen = new Set<string>();
let diagnosen = 0;

/** Einen Fehler erfassen: die Art einmal zählen, die Diagnose einmal schicken, solange die Grenze der Seite reicht. */
export function erfasseFehler(art: ClientFehlerArt, wert: unknown): void {
    try {
        const zaehlen = !gezaehlt.has(art);
        gezaehlt.add(art);
        let neu: ReturnType<typeof diagnoseAus> | undefined;
        if (diagnosen < CLIENT_FEHLER_GRENZEN.jeSeite) {
            const diagnose = diagnoseAus(art, wert, { ursprung: location.origin, grafik: grafikKlasse() });
            const signatur = seitenSignatur(diagnose);
            if (!signaturen.has(signatur)) {
                signaturen.add(signatur);
                diagnosen += 1;
                neu = diagnose;
            }
        }
        sendeFehler(zaehlen ? art : undefined, neu);
    } catch {
        /* Der Fänger darf die Seite nie stören. */
    }
}

/** Ab hier steht die Oberfläche: Fehler am Fenster heißen `unbehandelt`, vorher `start`. */
let oberflaeche = false;
export function oberflaecheSteht(): void {
    oberflaeche = true;
}

const fensterArt = (): ClientFehlerArt => (oberflaeche ? "unbehandelt" : "start");

/** Ein Fehlerobjekt? `ResizeObserver` und „Script error.“ fremder Skripte kommen ohne. */
function fehlerartig(wert: unknown): boolean {
    return typeof wert === "object" && wert !== null && ("message" in wert || "stack" in wert);
}

/** Abbrüche sind gewollt (eine überholte Anfrage), kein Fehler. */
function istAbbruch(wert: unknown): boolean {
    return typeof wert === "object" && wert !== null && (wert as { name?: unknown }).name === "AbortError";
}

/** Aus einer fremden Datei, etwa einer Browsererweiterung? Dann ist es nicht unser Fehler. */
function fremdeDatei(datei: string | undefined): boolean {
    if (datei === undefined || datei === "") return false;
    try {
        return new URL(datei, location.href).origin !== location.origin;
    } catch {
        return true;
    }
}

let eingehaengt = false;

/**
 * Hängt die Fänger am Fenster ein. 🔴 Läuft als ERSTER Import von `main.ts` (`fehler-start.ts`): Module werden in der
 * Reihenfolge ihrer Importe ausgewertet, und ein Fehler beim Auswerten von `app.vue` soll schon gefangen werden.
 */
export function installiereFehlerfaenger(): void {
    if (eingehaengt || typeof window === "undefined") return;
    eingehaengt = true;
    window.addEventListener("error", (event: ErrorEvent) => {
        if (!fehlerartig(event.error) || fremdeDatei(event.filename)) return;
        erfasseFehler(fensterArt(), event.error);
    });
    window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
        if (istAbbruch(event.reason)) return;
        erfasseFehler(fensterArt(), event.reason);
    });
}

/**
 * Der Fänger für Vue. 🪤 Ein eigener `errorHandler` ersetzt Vues Ausgabe in die Konsole; deshalb schreibt er selbst hinein,
 * sonst verschwände jeder Fehler eines Bauteils aus der Konsole, die er sichtbarer machen soll.
 */
export function faengeVueFehler(app: App): void {
    app.config.errorHandler = (fehler, _instanz, info) => {
        console.error(`Vue (${info}):`, fehler);
        erfasseFehler("vue", fehler);
    };
}

/** Der Start selbst scheitert (`main.ts`): in die Konsole und als `start` erfassen. */
export function startGescheitert(fehler: unknown): void {
    console.error("Start gescheitert", fehler);
    erfasseFehler("start", fehler);
}

/** Für Tests: alle Grenzen zurück. */
export function setzeFehlerfaengerZurueck(): void {
    gezaehlt.clear();
    signaturen.clear();
    diagnosen = 0;
    oberflaeche = false;
    eingehaengt = false;
}
