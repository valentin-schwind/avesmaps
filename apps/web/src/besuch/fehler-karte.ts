import { erfasseFehler } from "./fehler-faenger";

/**
 * Die Fänger an der Karte (WI-0202): `karte`, `worker`, `kontext_verloren`. Die Karte kommt von dem, der sie besitzt
 * (`app.vue`), nie aus `globalThis` (Falle der Besuchsmeldung, `besuch-melden.ts`, `beobachteKarte`).
 *
 * - **`karte`:** das MapLibre-Ereignis `error`, aber **ohne Ladefehler** von Kacheln und Quellen. Die tragen eine Kachel oder
 *   einen HTTP-Status; sie sieht der Server selbst, und die Störungswache (`map/karte-gestoert.ts`) zeigt sie schon. Sonst wäre
 *   jeder Neustart der Stage eine Flut von Kartenfehlern.
 * - **`worker`:** Die Karte hat nach `WORKER_FRIST_MS` sichtbarer Zeit weder eine Vektorkachel noch einen Fehler dazu gesehen.
 *   Das ist das Zeichen der Worker-Falle (`app.vue`, Kopf): Der Arbeiter scheitert ohne Ausnahme und ohne Meldung, und es geht
 *   nie eine Vektorkachel hinaus. Ein Ausfall des Servers sieht anders aus: Dort scheitern die Kacheln sichtbar.
 * - **`kontext_verloren`:** `webglcontextlost` an der Leinwand. Bis dahin hörte darauf nur der Flug-Melder im
 *   Entwicklungsbuild (`map/flug-melder.ts`).
 */

export const WORKER_FRIST_MS = 45_000;
const TAKT_MS = 5_000;

type KartenEreignis = {
    error?: unknown;
    tile?: unknown;
    source?: { type?: string };
    sourceId?: string;
};

/** Was der Fänger von der Karte braucht; eine Probe in Tests reicht. */
export interface KarteFuerFehler {
    on(art: "error" | "sourcedata", haken: (ereignis: KartenEreignis) => void): unknown;
    off(art: "error" | "sourcedata", haken: (ereignis: KartenEreignis) => void): unknown;
    getCanvas(): HTMLCanvasElement;
    getStyle(): { sources?: Record<string, { type?: string }> } | undefined;
}

export interface KartenfehlerUhr {
    alle(ms: number, tun: () => void): () => void;
    sichtbar(): boolean;
}

const ECHTE_UHR: KartenfehlerUhr = {
    alle: (ms, tun) => {
        const id = setInterval(tun, ms);
        return () => clearInterval(id);
    },
    sichtbar: () => document.visibilityState === "visible",
};

/** Ein Ladefehler einer Kachel oder Quelle, kein Fehler im Code? */
export function istLadefehler(ereignis: KartenEreignis): boolean {
    if (ereignis.tile !== undefined && ereignis.tile !== null) return true;
    const status = (ereignis.error as { status?: unknown } | undefined)?.status;
    return typeof status === "number";
}

const istVektor = (ereignis: KartenEreignis): boolean => ereignis.source?.type === "vector";

/** Hängt die Fänger an die Karte. Gibt die Funktion zurück, die sie wieder abnimmt. */
export function beobachteKartenfehler(karte: KarteFuerFehler, uhr: KartenfehlerUhr = ECHTE_UHR): () => void {
    const leinwand = karte.getCanvas();
    const verloren = (): void => erfasseFehler("kontext_verloren", { name: "WebGLContextLost", message: "" });
    leinwand.addEventListener("webglcontextlost", verloren);

    let vektorGesehen = false;
    let sichtbareZeit = 0;
    let stopTakt: (() => void) | undefined;
    const fertig = (): void => {
        stopTakt?.();
        stopTakt = undefined;
    };

    const beiFehler = (ereignis: KartenEreignis): void => {
        if (istVektor(ereignis)) vektorGesehen = true;
        if (istLadefehler(ereignis)) return;
        erfasseFehler("karte", ereignis.error ?? { name: "MapError", message: "" });
    };
    const beiDaten = (ereignis: KartenEreignis): void => {
        if (istVektor(ereignis) && ereignis.tile !== undefined && ereignis.tile !== null) vektorGesehen = true;
    };
    karte.on("error", beiFehler);
    karte.on("sourcedata", beiDaten);

    // Nur sichtbare Zeit zählt: Ein Tab im Hintergrund lädt nicht, und das wäre keine Worker-Falle.
    stopTakt = uhr.alle(TAKT_MS, () => {
        if (vektorGesehen) return fertig();
        if (!uhr.sichtbar()) return;
        sichtbareZeit += TAKT_MS;
        if (sichtbareZeit < WORKER_FRIST_MS) return;
        const quellen = Object.values(karte.getStyle()?.sources ?? {});
        if (quellen.some((quelle) => quelle.type === "vector")) {
            erfasseFehler("worker", {
                name: "KeineVektorkachel",
                message: `Nach ${String(WORKER_FRIST_MS / 1000)} s keine Vektorkachel und kein Fehler dazu`,
            });
        }
        fertig();
    });

    return () => {
        fertig();
        leinwand.removeEventListener("webglcontextlost", verloren);
        karte.off("error", beiFehler);
        karte.off("sourcedata", beiDaten);
    };
}
