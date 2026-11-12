import {
    EDITOR_LANDSCAPES_URL,
    editorLandscapeTargetsUrl,
    type EditorLandscapeDetail,
    type EditorLandscapeTargets,
} from "@avesmaps3d/shared";
import type { EckenDaten } from "./ecken";

/**
 * Was „Ecken bearbeiten“ vom Server liest (WI-0178 C1): die Landschaft mit Teilflächen und Revisionen und die Andockziele um sie, beide
 * mit `AbortSignal` (AGENTS „Abbrechen ist Pflicht“) und immer frisch (nicht aus dem Zwischenspeicher des Browsers, wie Ortseditor und
 * Wegeditor). Geschrieben wird über die Bearbeitung der Landschaft (`landscape.update`, `landschaft-art.ts`).
 */
async function lies<T>(url: string, signal: AbortSignal): Promise<T | null> {
    const antwort = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (antwort.status === 404) return null;
    if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
    return (await antwort.json()) as T;
}

export function createEckenDaten(): EckenDaten {
    return {
        landschaft: (regionId, signal) => lies<EditorLandscapeDetail>(`${EDITOR_LANDSCAPES_URL}/${regionId}`, signal),
        ziele: (regionId, ebenen, signal) =>
            lies<EditorLandscapeTargets>(`${editorLandscapeTargetsUrl(regionId)}?layers=${ebenen.join(",")}`, signal),
    };
}
