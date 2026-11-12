import {
    EDITOR_CHANGES_URL,
    EDITOR_PLACES_SAMMEL_DELETE_URL,
    EDITOR_PLACES_SAMMEL_URL,
    EDITOR_PLACES_URL,
    editorPlaceDeleteUrl,
    editorPlaceMoveTargetsUrl,
    editorPlaceMoveUrl,
    editorPlaceRemovalUrl,
    editorPlaceRestoreUrl,
    editorPlaceSiteCandidatesUrl,
    editorPlaceSiteRelationUrl,
    editorPlaceSitesAddUrl,
    editorPlaceSitesUrl,
    editorPlaceTakeOffMapUrl,
    editorPlaceUrl,
    subjectSectionUrl,
    type ApiErrorBody,
    type EditorMoveTargets,
    type EditorPlaceDetail,
    type EditorPlaceSites,
    type EditorSiteCandidates,
    type MapHistoryPage,
    type OperationReceipt,
    type PlaceRemoval,
    type SiteAddBody,
    type SiteRelationBody,
    type SubjectDetail,
    type SubjectRef,
    type SubjectStaettenSection,
} from "@avesmaps3d/shared";
import { createSubjectClient, type SubjectClient } from "../info-panel/subject-client";
import type { ApiFehler, OrtApi } from "./ort-bearbeitung";
import type { EntfernenApi } from "./ort-entfernen";
import type { SammelApi } from "./ort-sammel";
import type { SetzenApi } from "./ort-setzen";
import type { VerschiebeApi } from "./ort-verschieben";

/**
 * Was der Ortseditor zu einem Ort liest (WI-0128 E6: „zeigt alle Abschnitte lesend“). Bis der Schreibweg kommt (Stufe B, E10) liest er
 * dieselben Lesewege wie das Infopanel: das Detail (`/api/subjects/place/:id`) und, erst wenn man den Reiter öffnet, Innerorts. Die Quellen eines Orts liest und schreibt
 * `fenster/traeger-quellen.vue` selbst (WI-0254 §12). Jede Frage trägt ein `AbortSignal`: Ein jüngerer Ort bricht die ältere ab (AGENTS „Abbrechen ist Pflicht“).
 *
 * Zum Bearbeiten (E11) liest er den Ort mit Revision und Herkunft (`GET /api/editor/places/:id`) und speichert über `place.update`
 * (`PATCH`); die Antwort ist die Quittung oder der Fehler im Umschlag (ADR-0018). Zum Verschieben (E12) holt er einmal die freien
 * Wegenden im Umkreis und sendet `place.move` (`POST …/move`). Zum Setzen (E16) legt er einen Wiki-Eintrag als Ort an (`place.create`).
 */
export interface OrtseditorDaten extends OrtApi, VerschiebeApi, SetzenApi, EntfernenApi, SammelApi {
    /** „Änderungen“: alle Operationen oder nur die eigenen (E17). */
    /** „Änderungen“; mit `suche` nur die Operationen, die der Freitext trifft (`felder`: die Felder, deren Name ihn enthält). */
    aenderungen(
        mine: boolean,
        before: number | undefined,
        signal: AbortSignal,
        suche?: { q: string; felder: readonly string[] },
    ): Promise<MapHistoryPage>;
    detail(publicId: string, signal: AbortSignal): Promise<SubjectDetail | null>;
    staetten(publicId: string, signal: AbortSignal): Promise<SubjectStaettenSection | null>;
    /** Die Stätten am Ort über Kennungen (E18): belegt, offen genannt, dazu Legacys Vergleichszahl. */
    sites(publicId: string, signal: AbortSignal): Promise<EditorPlaceSites | null>;
    /** `site.relate` (E10b): eine Stätte diesem Ort zuordnen, von einem anderen her verlagern oder die Beziehung lösen. */
    bindeStaette(
        publicId: string,
        body: SiteRelationBody,
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }>;
    /** „Innerorts hinzufügen“ (WI-0196): was noch nirgends innerorts ist, mit Abstand in Meilen. */
    innerortsKandidaten(publicId: string, signal: AbortSignal): Promise<EditorSiteCandidates | null>;
    /** `site.add` (WI-0196): die gewählten Einträge in EINER Operation an diesen Ort binden. */
    innerortsHinzufuegen(
        publicId: string,
        body: SiteAddBody,
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }>;
}

const ortRef = (id: string): SubjectRef => ({ kind: "place", id });

async function seite(url: string, signal: AbortSignal): Promise<MapHistoryPage> {
    const antwort = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
    return (await antwort.json()) as MapHistoryPage;
}

async function sektion<T>(url: string | null, signal: AbortSignal): Promise<T | null> {
    if (url === null) return null;
    const antwort = await fetch(url, { signal, headers: { accept: "application/json" } });
    if (antwort.status === 404) return null;
    if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
    return (await antwort.json()) as T;
}

/** Ein Schreibweg: die Quittung oder der Fehler im Umschlag; ohne Verbindung ein eigener Fehler. */
async function schreibe(
    url: string,
    method: "PATCH" | "POST",
    body: unknown,
): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }> {
    let antwort: Response;
    try {
        antwort = await fetch(url, {
            method,
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        return { ok: false, status: 0, fehler: { code: "network_error", message: "Keine Verbindung zum Server." } };
    }
    if (antwort.ok) return { ok: true, quittung: (await antwort.json()) as OperationReceipt };
    const umschlag = (await antwort.json().catch(() => undefined)) as ApiErrorBody | undefined;
    return {
        ok: false,
        status: antwort.status,
        fehler: umschlag?.error ?? {
            code: "unknown_error",
            message: `Der Server antwortete ${String(antwort.status)}.`,
        },
    };
}

export function createOrtseditorDaten(client: SubjectClient = createSubjectClient()): OrtseditorDaten {
    return {
        async detail(publicId, signal) {
            // Der Ortseditor liest immer den Stand von jetzt, nicht den Zwischenspeicher des Browsers (`max-age`), E19.
            const antwort = await client.detail(ortRef(publicId), signal, true);
            return antwort !== null && antwort.subject.kind === "place" ? (antwort as SubjectDetail) : null;
        },
        staetten: (publicId, signal) => sektion(subjectSectionUrl(ortRef(publicId), "staetten"), signal),
        sites: (publicId, signal) => sektion(editorPlaceSitesUrl(publicId), signal),
        bindeStaette: (publicId, body) => schreibe(editorPlaceSiteRelationUrl(publicId), "POST", body),
        innerortsKandidaten: (publicId, signal) => sektion(editorPlaceSiteCandidatesUrl(publicId), signal),
        innerortsHinzufuegen: (publicId, body) => schreibe(editorPlaceSitesAddUrl(publicId), "POST", body),
        async ort(publicId, signal) {
            const antwort = await fetch(editorPlaceUrl(publicId), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${editorPlaceUrl(publicId)} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as EditorPlaceDetail;
        },
        speichereOrt: (publicId, body) => schreibe(editorPlaceUrl(publicId), "PATCH", body),
        async ziele(publicId, signal) {
            const antwort = await fetch(editorPlaceMoveTargetsUrl(publicId), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok)
                throw new Error(`${editorPlaceMoveTargetsUrl(publicId)} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as EditorMoveTargets;
        },
        verschiebe: (publicId, body) => schreibe(editorPlaceMoveUrl(publicId), "POST", body),
        nimmAb: (publicId, body) => schreibe(editorPlaceTakeOffMapUrl(publicId), "POST", body),
        loesche: (publicId, body) => schreibe(editorPlaceDeleteUrl(publicId), "POST", body),
        stelleWiederHer: (publicId, body) => schreibe(editorPlaceRestoreUrl(publicId), "POST", body),
        // Die Mehrfachauswahl der Ortsliste (WI-0237): ↺ auf Wiki-Werte und „Ganz löschen“ für mehrere, je EINE Operation.
        sammle: (body) => schreibe(EDITOR_PLACES_SAMMEL_URL, "POST", body),
        loescheAlle: (body) => schreibe(EDITOR_PLACES_SAMMEL_DELETE_URL, "POST", body),
        async entfernenVorschau(publicId, signal) {
            const antwort = await fetch(editorPlaceRemovalUrl(publicId), {
                signal,
                cache: "no-store",
                headers: { accept: "application/json" },
            });
            if (antwort.status === 404) return null;
            if (!antwort.ok) throw new Error(`${editorPlaceRemovalUrl(publicId)} antwortete ${String(antwort.status)}`);
            return (await antwort.json()) as PlaceRemoval;
        },
        lege: (body) => schreibe(EDITOR_PLACES_URL, "POST", body),
        aenderungen: (mine, before, signal, suche) => {
            const frage = new URLSearchParams();
            if (mine) frage.set("mine", "true");
            if (suche !== undefined && suche.q !== "") {
                frage.set("q", suche.q);
                if (suche.felder.length > 0) frage.set("qFelder", suche.felder.join(","));
            }
            if (before !== undefined) frage.set("before", String(before));
            const text = frage.toString();
            return seite(text === "" ? EDITOR_CHANGES_URL : `${EDITOR_CHANGES_URL}?${text}`, signal);
        },
    };
}
