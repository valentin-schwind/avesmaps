import {
    DISPLAY_HEIGHT_POINTER_URL,
    readTerrainPointer,
    TERRAIN_POINTER_URL,
    type DisplayHeightPointer,
    type JobEventRecord,
    type TerrainDemPointer,
} from "@avesmaps3d/shared";
import { authState } from "../../auth/session-state";
import { JobsSocket, type Timers, type WebSocketLike } from "../../status/jobs-socket";
import { loadDisplayHeightPointer } from "./display-height-pointer";

/**
 * Die Karte hört auf neue Geländekacheln (JOBS-0001 V5, 4.9, WI-0125): `/ws`, Kanal `area`.
 *
 * - `area.changed` (eine lokale Veröffentlichung oder ein voller Lauf): Zeiger neu holen, dann lädt die Karte nur die Kacheln mit neuer
 *   Revision nach (`applyTerrainPointer`).
 * - `display_heights.changed`: den Zeiger der Anzeigehöhen neu holen; bis er zum Gelände passt, zeigt die Karte keine Höhenlinien
 *   (ADR-0012 Punkt 5: keine alten, sondern keine).
 * - `map.changed` (WI-0128 E13): Ein Editor hat Orte oder Wege geändert; die Karte lädt deren Kacheln mit der Nummer des Ereignisses als
 *   Revision neu (`map/edit-revision.ts`).
 * - Nach jedem (Wieder-)Verbinden und bei `gap` beide Zeiger neu: Ein verpasstes Ereignis kostet nur Aktualität, nie Richtigkeit. Bei
 *   `gap` laden auch Orte und Wege neu, mit der Nummer, die der Server nennt.
 *
 * Nur wo der Server es anbietet: Der Zeiger trägt dann `x-avesmaps-live: area` (überall, wo die Statusseite an ist). Ohne den
 * Hinweis, oder wenn die erste Verbindung abgewiesen wird (Anmeldung verlangt), versucht die Karte es nicht weiter. Ein Seitenreload
 * ist nie der Weg der Synchronisation (7.29).
 *
 * 🔴 **Und nur, wer hinein darf** (WI-0197): Der Hinweis gilt der Instanz, nicht dem Besucher. Sagt die Sitzung `liveChannel: false`,
 * versucht die Karte `/ws` gar nicht erst und liest auch keinen Zeiger dafür: Den abgewiesenen Handschlag schrieb der Browser sonst
 * als Fehler in die Konsole, und das abfangen kann keine Seite (gemessen 2026-10-16: Production weist jeden Besucher ab).
 *
 * 🪤 **Ohne Grafikkarte wird der Geländezeiger gar nicht erst gelesen** (WI-0049, Betreiber 2026-09-27 „3: A“;
 * ADR-0011 Punkt 4) - auch nicht, um den Kanal zu entdecken. Dort entscheidet der Zeiger der Anzeigehöhen, denn
 * Höhenlinien, Höhenstufen und die Kacheln der Editoren gibt es auch ohne Grafikkarte; nur Berge gibt es nicht.
 * Der Hinweis steht deshalb an beiden Zeigern (`routes/live-hint.ts`).
 */

export interface TerrainLiveOptions {
    /**
     * Liest diese Karte überhaupt Gelände? Ohne Grafikkarte nicht (`software-rendering.ts`): dann bleibt
     * `onTerrain` ungerufen und der Geländezeiger ungelesen.
     */
    mitGelaende: boolean;
    onTerrain(pointer: TerrainDemPointer): void;
    onDisplayHeights(pointer: DisplayHeightPointer | undefined): void;
    /**
     * Orte oder Wege geändert (`map.changed`, E13): die Nummer des Ereignisses ist die neue Kachelrevision. Dazu das Ereignis selbst
     * (fehlt nach einer Lücke): `payload.jobKind` und `payload.jobId` nennen den Auftrag, der abgeleitet hat (etwa `territory_derive`).
     */
    onMapChanged?(revision: number, ereignis?: JobEventRecord): void;
    fetcher?: typeof fetch;
    socketUrl?: string;
    createSocket?: (url: string) => WebSocketLike;
    timers?: Timers;
    /** Darf diese Sitzung den Kanal betreten? Ohne Angabe die Sitzung (`liveChannel`); fehlt sie, zählt allein der Hinweis. */
    channelAllowed?: () => boolean;
}

const LIVE_HEADER = "x-avesmaps-live";

const defaultSocketUrl = (): string => {
    const { protocol, host } = globalThis.location;
    return `${protocol === "https:" ? "wss:" : "ws:"}//${host}/ws`;
};

/** Startet das Mithören; gibt die Funktion zum Beenden zurück (oder eine leere, wenn die Instanz nichts anbietet). */
export async function startTerrainLive(options: TerrainLiveOptions): Promise<() => void> {
    const allowed = options.channelAllowed ?? (() => authState.value.liveChannel !== false);
    if (!allowed()) return () => undefined;
    const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
    const readTerrain = async (): Promise<{ pointer: TerrainDemPointer | undefined; live: boolean }> => {
        const response = await fetcher(TERRAIN_POINTER_URL, { headers: { accept: "application/json" } });
        if (response.status !== 200 || /^text\/html\b/i.test(response.headers.get("content-type") ?? ""))
            return { pointer: undefined, live: false };
        return {
            pointer: readTerrainPointer(await response.json()),
            live: response.headers.get(LIVE_HEADER) === "area",
        };
    };
    /**
     * Bietet diese Instanz den Kanal an, wenn das Gelände ungelesen bleibt? Dann fragt der Zeiger der Anzeigehöhen.
     * Sein Status zählt dabei nicht: Ob Höhen abgeleitet sind (200) oder nicht (404), sagt nichts darüber, ob die
     * Instanz Ereignisse sendet - den Hinweis trägt jede Antwort.
     */
    const offersChannel = async (): Promise<boolean> => {
        const response = await fetcher(DISPLAY_HEIGHT_POINTER_URL, { headers: { accept: "application/json" } });
        return response.headers.get(LIVE_HEADER) === "area";
    };
    let live: boolean;
    try {
        live = options.mitGelaende ? (await readTerrain()).live : await offersChannel();
    } catch {
        return () => undefined;
    }
    if (!live) return () => undefined;

    let latestSeq: number | null = null;
    let connections = 0;
    const refreshTerrain = async (): Promise<void> => {
        // Ohne Grafikkarte gibt es kein Gelände zu erneuern - und der Zeiger bleibt ungelesen.
        if (!options.mitGelaende) return;
        try {
            const { pointer } = await readTerrain();
            if (pointer) options.onTerrain(pointer);
        } catch (error) {
            console.warn("Gelände: neuer Zeiger nicht lesbar", error instanceof Error ? error.message : error);
        }
    };
    const refreshDisplayHeights = async (): Promise<void> => {
        try {
            options.onDisplayHeights(await loadDisplayHeightPointer(fetcher));
        } catch (error) {
            console.warn("Höhenstufen: neuer Zeiger nicht lesbar", error instanceof Error ? error.message : error);
        }
    };
    const onEvent = (event: JobEventRecord): void => {
        latestSeq = Math.max(latestSeq ?? 0, event.seq);
        if (event.kind === "area.changed") {
            // Neues Gelände: die alten Höhenlinien passen nicht mehr, also auch ihren Zeiger neu lesen.
            void refreshTerrain().then(refreshDisplayHeights);
        } else if (event.kind === "display_heights.changed") void refreshDisplayHeights();
        else if (event.kind === "map.changed") options.onMapChanged?.(event.seq, event);
    };
    const socket = new JobsSocket({
        url: options.socketUrl ?? defaultSocketUrl(),
        channel: "area",
        stopIfNeverOpened: true,
        getSince: () => latestSeq,
        onEvent,
        onGap: (seq) => {
            latestSeq = seq;
            options.onMapChanged?.(seq);
            void refreshTerrain().then(refreshDisplayHeights);
        },
        onConnected: () => {
            // Beim ersten Verbinden ist der Stand frisch; nach einem Abbruch könnte zwischendurch etwas veröffentlicht worden sein.
            connections += 1;
            if (connections > 1) void refreshTerrain().then(refreshDisplayHeights);
        },
        ...(options.createSocket ? { createSocket: options.createSocket } : {}),
        ...(options.timers ? { timers: options.timers } : {}),
    });
    socket.start();
    return () => socket.stop();
}
