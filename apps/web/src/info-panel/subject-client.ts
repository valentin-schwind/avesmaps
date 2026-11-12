import {
    SUBJECT_RESOLVE_LINK_URL,
    subjectDetailUrl,
    type MapPointDetail,
    type ObjectLinkRequest,
    type ResolveLinkResponse,
    type SubjectDetail,
    type SubjectRef,
} from "@avesmaps3d/shared";
import { LOAD_ATTEMPTS, pause, retryAfterMs } from "../route-planner/load-retry";
import { inhaltsstand } from "../system/inhaltsstand";
import { bootstrapViewer } from "../viewer/bootstrap-viewer";

/**
 * Die Lese-Endpunkte der Subjects, wie das Infopanel sie fragt (WI-0063 P4, `GET /api/subjects/...`). Nur Lesen, kein
 * Schreibpfad, kein HTML: strukturierte Daten.
 *
 * 🔴 Jede Frage ist abbrechbar (`signal`): Ein jüngerer Subject bricht die Frage nach dem älteren ab, auch in der Pause vor
 * einer Wiederholung. Dass die Antwort eines älteren trotzdem eintrifft (ein Stack, der das Abbrechen nicht beachtet), fängt
 * `subject-selection.ts` über `subjectKey` ab, nicht dieses Modul.
 *
 * Eine Absage wegen Last (503: die Drossel `busy` oder die Zeitgrenze der Datenbank, `database_unavailable`) fragt der Dienst
 * selbst noch einmal, still, nach der Regel des Planers (`load-retry.ts`, Betreiber 2026-09-27); erst danach zeigt das Panel
 * seine Meldung. Befund 2026-10-04: Unter Last bekam Gareth 503, das Panel meldete sofort einen Fehler.
 */

/** Dieselbe Frage, bis sie keine Absage wegen Last mehr ist oder die Versuche aufgebraucht sind (auch die Quellen des Kastens fragen so). */
export async function fetchUnderLoad(
    fetcher: typeof fetch,
    url: string,
    signal: AbortSignal | undefined,
    cache?: RequestCache,
): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
        const response = await fetcher(url, { ...(signal ? { signal } : {}), ...(cache ? { cache } : {}) });
        if (response.status !== 503 || attempt >= LOAD_ATTEMPTS) return response;
        await pause(retryAfterMs(response), signal);
    }
}

/**
 * Fragt dieser Betrachter als Editor (`use_editor_menu` im Editor-Modus)? Dann mit `?editor=true`: Der Server prüft das Recht selbst,
 * zeigt ausgeblendete Abschnitte echt (WI-0127 SYS-11) und antwortet `private, no-store`, nie aus dem öffentlichen Zwischenspeicher
 * (WI-0193: Nginx hält Details 60 s für alle; nach „Verbergen“ bot das Menü am Ort sonst wieder „Verbergen“ an, EDIT-0003 T35 (1)).
 */
export const editorSicht = (): boolean => bootstrapViewer().can("use_editor_menu");

/** Die Adresse für einen Editor mit `editor=true`, für Detail und Sektion dieselbe Regel. */
export function editorFetchUrl(url: string, editor: boolean = editorSicht()): string {
    return editor ? `${url}${url.includes("?") ? "&" : "?"}editor=true` : url;
}

/** Die Antwort des Servers für einen Subject; `null`, wo es ihn nicht (mehr) gibt (404). */
export type SubjectAnswer = SubjectDetail | MapPointDetail;

export interface SubjectClient {
    /**
     * Detail eines Subjects; `null` bei 404; wirft bei jedem anderen Fehler. Für Arten ohne Endpunkt nicht aufrufen. `frisch`: am
     * Zwischenspeicher des Browsers vorbei (`max-age`), nach einer eigenen Änderung (WI-0128 E19).
     */
    detail(ref: SubjectRef, signal?: AbortSignal, frisch?: boolean): Promise<SubjectAnswer | null>;
    /** Löst einen Objektlink der Wiki Aventurica auf (WI-0063 4.6). */
    resolveLink(request: ObjectLinkRequest, signal?: AbortSignal): Promise<ResolveLinkResponse>;
}

/** Eine Antwort, die nicht 200 ist: mit dem Status, damit die Oberfläche „nicht erreichbar“ von „gibt es nicht“ trennt. */
export class SubjectRequestError extends Error {
    readonly status: number;
    constructor(status: number, what: string) {
        super(`${what} antwortete ${String(status)}`);
        this.name = "SubjectRequestError";
        this.status = status;
    }
}

/**
 * Die Adresse eines Ortes mit dem Stand der Reisebilder: Nginx hält die Antwort 60 s und schlüsselt nach der ganzen Adresse (`ops/deploy/staging-deploy.sh`). So trifft ein neu freigegebenes Bild nie die alte
 * Antwort, und der Zwischenspeicher wirkt für alle anderen Orte und Besucher weiter (WI-0272). Andere Arten tragen keine Reisebilder.
 */
export function mitReisebildStand(url: string, ref: SubjectRef, stand: string | undefined): string {
    if (ref.kind !== "place" || stand === undefined) return url;
    return `${url}${url.includes("?") ? "&" : "?"}stand=${encodeURIComponent(stand)}`;
}

export function createSubjectClient(
    fetcher: typeof fetch = (...args) => globalThis.fetch(...args),
    editor: () => boolean = editorSicht,
    reisebildStand: () => string | undefined = () => inhaltsstand.stand.value.reisebilder,
): SubjectClient {
    return {
        async detail(ref, signal, frisch) {
            const url = subjectDetailUrl(ref);
            if (url === null) throw new Error(`Subject ${ref.kind} hat keinen Endpunkt`);
            const response = await fetchUnderLoad(
                fetcher,
                editorFetchUrl(mitReisebildStand(url, ref, reisebildStand()), editor()),
                signal,
                frisch === true ? "no-cache" : undefined,
            );
            if (response.status === 404) return null;
            if (!response.ok) throw new SubjectRequestError(response.status, url);
            return (await response.json()) as SubjectAnswer;
        },
        async resolveLink(request, signal) {
            // Unter dem Namen, unter dem der Link ankam (`settlement` bleibt `settlement`): Die Auflösung ist dieselbe.
            const url = `${SUBJECT_RESOLVE_LINK_URL}?${new URLSearchParams({ [request.name]: request.value }).toString()}`;
            const response = await fetchUnderLoad(fetcher, url, signal);
            if (!response.ok) throw new SubjectRequestError(response.status, SUBJECT_RESOLVE_LINK_URL);
            return (await response.json()) as ResolveLinkResponse;
        },
    };
}
