import { ref, type Ref } from "vue";

/**
 * „Neue Version“ (WI-0136 N1, NACHRICHT-0001 §2; Betreiber 2026-10-11 „2A“): Die Seite merkt, wenn auf dem Server eine neue Oberfläche
 * läuft, und bietet „Neu laden“ an. **Nie automatisch neu laden.**
 *
 * - **Signal ist das Programmpaket der Seite.** Jeder Build schreibt seinen Einstieg mit Hash in den Namen (`/assets/index-AbCd1234.js`),
 *   die Seite nennt ihn als Modul-Skript. Die Prüfung holt die eigene Seite ohne Zwischenspeicher und vergleicht den Einstieg. Ein Release
 *   nur am Server ändert ihn nicht und zeigt nichts; jeder Fix an der Oberfläche ändert ihn. Ohne Server-Änderung, ohne Claudio.
 * - **Wann:** beim Start den eigenen Einstieg merken, dann alle 5 min, solange der Tab sichtbar ist, und beim Zurückkehren in den Tab und
 *   bei `online`.
 * - **Kein Fehlalarm:** Eine Antwort nach einer Umleitung (etwa die Anmeldeseite), ohne Einstieg oder mit einem anderen Stamm (nicht
 *   `index`, im Entwicklungsbuild nicht `main`) zählt nicht. Scheitert der Abruf, bleibt alles, wie es ist, bis zum nächsten Takt.
 */

export const NEUE_VERSION_TAKT_MS = 5 * 60_000;
/** Erkennungszeichen des Abrufs (Tests leiten ihn daran um). */
export const VERSIONSPROBE_KOPF = "x-avm-versionsprobe";

const SKRIPT = /<script\b[^>]*>/giu;
const MODUL = /\btype\s*=\s*["']module["']/iu;
const QUELLE = /\bsrc\s*=\s*["']([^"']+)["']/iu;

/** Die `src` der Modul-Skripte einer Seite, in ihrer Reihenfolge. */
export function moduleAusHtml(html: string): string[] {
    const srcs: string[] = [];
    for (const tag of html.match(SKRIPT) ?? []) {
        if (!MODUL.test(tag)) continue;
        const src = QUELLE.exec(tag)?.[1];
        if (src !== undefined) srcs.push(src);
    }
    return srcs;
}

/** Der Einstieg: das erste Modul-Skript, das nicht zum Entwicklungsserver gehört (`/@vite/client`). */
export function einstieg(srcs: readonly string[]): string | undefined {
    return srcs.find((src) => !src.includes("/@vite/"));
}

/** Der Stamm eines Einstiegs ohne Hash und Endung: `/assets/index-AbCd1234.js` → `index`, `/src/main.ts?v=2` → `main`. */
export function stamm(src: string): string {
    const name = src.split("?")[0]!.split("/").pop() ?? "";
    return name.replace(/-[A-Za-z0-9_-]{6,}\.js$/u, "").replace(/\.[a-z]+$/u, "");
}

/** Ist `fremd` eine andere Version als `eigen`? Nur bei gleichem Stamm und anderem Pfad. */
export function istNeu(eigen: string | undefined, fremd: string | undefined): boolean {
    return eigen !== undefined && fremd !== undefined && fremd !== eigen && stamm(fremd) === stamm(eigen);
}

export interface NeueVersionOptionen {
    fetch?: typeof fetch;
    /** Der eigene Einstieg; ohne Angabe aus den Modul-Skripten der laufenden Seite. */
    eigen?: () => string | undefined;
    pfad?: () => string;
    sichtbar?: () => boolean;
    neuLaden?: () => void;
    taktMs?: number;
}

export interface NeueVersion {
    /** Eine neue Version liegt bereit (bleibt stehen, bis neu geladen ist). */
    neu: Ref<boolean>;
    pruefe(): Promise<void>;
    start(): void;
    stop(): void;
    /** Lädt neu, wie Strg+Umschalt+R: Die Startseite ist nicht zwischengespeichert, die Pakete tragen ihren Hash. */
    neuLaden(): void;
}

export function createNeueVersion(optionen: NeueVersionOptionen = {}): NeueVersion {
    const neu = ref(false);
    const holen = optionen.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
    const eigenVon =
        optionen.eigen ??
        (() =>
            einstieg(
                [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.getAttribute("src") ?? ""),
            ));
    const pfad = optionen.pfad ?? (() => location.pathname);
    const sichtbar = optionen.sichtbar ?? (() => document.visibilityState === "visible");
    let eigen: string | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    let laeuft = false;

    async function pruefe(): Promise<void> {
        if (neu.value || laeuft) return;
        eigen ??= eigenVon();
        if (eigen === undefined) return;
        laeuft = true;
        try {
            const antwort = await holen(pfad(), {
                cache: "no-store",
                credentials: "same-origin",
                headers: { accept: "text/html", [VERSIONSPROBE_KOPF]: "1" },
            });
            if (!antwort.ok || antwort.redirected) return;
            if (istNeu(eigen, einstieg(moduleAusHtml(await antwort.text())))) neu.value = true;
        } catch {
            // Später erneut: ein gescheiterter Abruf heißt nicht „neue Version“.
        } finally {
            laeuft = false;
        }
    }

    const imTakt = (): void => {
        if (sichtbar()) void pruefe();
    };
    const beiSicht = (): void => {
        if (sichtbar()) void pruefe();
    };

    return {
        neu,
        pruefe,
        start() {
            if (timer !== undefined) return;
            eigen ??= eigenVon();
            timer = setInterval(imTakt, optionen.taktMs ?? NEUE_VERSION_TAKT_MS);
            globalThis.document?.addEventListener("visibilitychange", beiSicht);
            globalThis.addEventListener?.("online", imTakt);
        },
        stop() {
            if (timer !== undefined) clearInterval(timer);
            timer = undefined;
            globalThis.document?.removeEventListener("visibilitychange", beiSicht);
            globalThis.removeEventListener?.("online", imTakt);
        },
        neuLaden: optionen.neuLaden ?? (() => location.reload()),
    };
}

let geteilt: NeueVersion | undefined;

/** Eine je Seite; die Glocke in der Kopfleiste startet sie (seit WI-0146, vorher der Kasten daneben). Im Entwicklungsbuild für Browsertests unter `__avesmapsNeueVersion`. */
export function useNeueVersion(): NeueVersion {
    geteilt ??= createNeueVersion();
    if (import.meta.env.DEV) (globalThis as { __avesmapsNeueVersion?: NeueVersion }).__avesmapsNeueVersion = geteilt;
    return geteilt;
}
