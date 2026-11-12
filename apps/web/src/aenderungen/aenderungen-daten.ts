import {
    EDITOR_CHANGES_URL,
    editorChangeLageUrl,
    editorChangeUrl,
    type MapChangeLage,
    type MapHistoryEntry,
    type MapHistoryPage,
} from "@avesmaps3d/shared";
import { aenderungenFrage, type AenderungenFilter } from "./aenderung-modell";

/**
 * Was der Reiter „Änderungen“ vom Server liest (WI-0265 B5a): die Liste mit allen Filtern (sie wirken auf dem Server, die Einträge kommen
 * seitenweise über `before`) und die volle Nutzlast EINER Operation (`GET /api/editor/changes/:operationId`), die die Liste weglässt.
 * Jede Frage trägt ein `AbortSignal`: Eine jüngere bricht die ältere ab (AGENTS „Abbrechen ist Pflicht“).
 */
export interface AenderungenDaten {
    seite(filter: AenderungenFilter, before: number | undefined, signal: AbortSignal): Promise<MapHistoryPage>;
    /** Die Operation mit voller Nutzlast; `null`, wenn es sie nicht gibt. */
    detail(operationId: string, signal: AbortSignal): Promise<MapHistoryEntry | null>;
    /**
     * Wo die Gegenstände der Operation (und der weiteren, einer Arbeitsserie) HEUTE liegen: ein Kasten (`GET /api/editor/changes/:operationId/lage`, WI-0265 B9); `null`, wenn es die Operation nicht gibt.
     */
    lage(operationId: string, mit: readonly string[], signal: AbortSignal): Promise<MapChangeLage | null>;
}

export interface DatenOptionen {
    readonly fetcher?: typeof fetch;
    /** Die Jetzt-Zeit für Zeiträume wie „heute“; ein Test setzt sie fest. */
    readonly jetzt?: () => Date;
    readonly limit?: number;
}

export function createAenderungenDaten(optionen: DatenOptionen = {}): AenderungenDaten {
    const hole = optionen.fetcher ?? ((eingabe, init) => fetch(eingabe, init));
    const jetzt = optionen.jetzt ?? (() => new Date());
    const limit = optionen.limit;
    return {
        async seite(filter, before, signal) {
            const frage = aenderungenFrage(filter, { before, limit, jetzt: jetzt() });
            const url = frage === "" ? EDITOR_CHANGES_URL : `${EDITOR_CHANGES_URL}?${frage}`;
            const antwort = await hole(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
            if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as MapHistoryPage;
        },
        async detail(operationId, signal) {
            const url = editorChangeUrl(operationId);
            const antwort = await hole(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as MapHistoryEntry;
        },
        async lage(operationId, mit, signal) {
            const url = editorChangeLageUrl(operationId, mit);
            const antwort = await hole(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as MapChangeLage;
        },
    };
}
