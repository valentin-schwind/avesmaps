import {
    EDITOR_PEAKS_URL,
    editorPeakUrl,
    type EditorPeakDetail,
    type PeakCreateBody,
    type PeakCreateReceipt,
    type PeakRetireBody,
    type PeakUpdateBody,
    editorPeakRetireUrl,
} from "@avesmaps3d/shared";
import { getJson, ApiFailure, type Fetcher } from "../auth/api";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Lesen und Schreiben eines Gipfels oder Vulkans (WI-0178 P1/P2; Vertrag `packages/shared/src/editor-peaks.ts`): das Detail und
 * `peak.update` als EINE Operation über den Fensterrumpf (`fenster/entwurf-senden.ts`); `peak.create` für „▲ Gipfel setzen …“ (P7).
 */
export interface GipfelDaten {
    /** Das Detail; `null`, wenn es den Gipfel nicht (mehr) gibt. */
    lies(id: string, signal: AbortSignal): Promise<EditorPeakDetail | null>;
    schreibe(id: string, body: PeakUpdateBody): Promise<SchreibAntwort>;
    lege(body: PeakCreateBody): Promise<SchreibAntwort<PeakCreateReceipt>>;
    /** „Gipfel entfernen …“: `peak.retire`, weich; ↺ im Verlauf (`gipfel-verlauf.ts`). */
    entferne(id: string, body: PeakRetireBody): Promise<SchreibAntwort>;
}

export function createGipfelDaten(fetcher: Fetcher = (url, init) => fetch(url, init)): GipfelDaten {
    return {
        async lies(id, signal) {
            try {
                return await getJson<EditorPeakDetail>(editorPeakUrl(id), (ziel, init) =>
                    fetcher(ziel, { ...init, signal, cache: "no-store" }),
                );
            } catch (error) {
                if (error instanceof ApiFailure && error.status === 404) return null;
                throw error;
            }
        },
        schreibe: (id, body) => sende(editorPeakUrl(id), body, "PATCH", fetcher as typeof fetch),
        lege: (body) => sende<PeakCreateReceipt>(EDITOR_PEAKS_URL, body, "POST", fetcher as typeof fetch),
        entferne: (id, body) => sende(editorPeakRetireUrl(id), body, "POST", fetcher as typeof fetch),
    };
}
