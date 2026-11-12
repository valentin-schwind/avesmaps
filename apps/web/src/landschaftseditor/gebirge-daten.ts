import {
    EDITOR_GEBIRGE_URL,
    editorGebirgeProfilUrl,
    type EditorGebirge,
    type EditorGebirgeProfile,
} from "@avesmaps3d/shared";

/**
 * Was der Reiter „Gebirge“ über eine Teilfläche liest (WI-0178 P4; Vertrag WI-0226 `GET /api/editor/gebirge/:area`): Presets samt
 * Quelle („fassung“ oder „vorgabe“), Grundhöhe und die Eingabe der Vorschau (P6). `undefined`, wenn die Teilfläche (noch) kein aktives
 * Gebirge ist (404), etwa solange der Wechsel zum Gebirge erst im Entwurf steht.
 */
export async function ladeGebirge(
    flaeche: string,
    signal?: AbortSignal,
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): Promise<EditorGebirge | undefined> {
    const antwort = await fetcher(`${EDITOR_GEBIRGE_URL}/${flaeche}`, {
        signal: signal ?? null,
        cache: "no-store",
        headers: { accept: "application/json" },
    });
    if (antwort.status === 404) return undefined;
    if (!antwort.ok) throw new Error(`Gebirge ${flaeche}: ${String(antwort.status)}`);
    return (await antwort.json()) as EditorGebirge;
}

/**
 * Die Höhenprofile der Flüsse und Pässe einer Teilfläche (WI-0245, `GET …/:area/profile`): abgetastet im Höhenmodell der Wegfindung wie
 * das Flussprofil im Routenplaner. `undefined`, wenn es sie nicht gibt; die Abschnitte stehen dann ohne Kurve.
 */
export async function ladeGebirgsProfile(
    flaeche: string,
    signal?: AbortSignal,
    fetcher: typeof fetch = (eingabe, init) => fetch(eingabe, init),
): Promise<EditorGebirgeProfile | undefined> {
    const antwort = await fetcher(editorGebirgeProfilUrl(flaeche), {
        signal: signal ?? null,
        cache: "no-store",
        headers: { accept: "application/json" },
    });
    if (!antwort.ok) return undefined;
    return (await antwort.json()) as EditorGebirgeProfile;
}
