import {
    EDITOR_PATHS_SAMMEL_DELETE_URL,
    EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL,
    EDITOR_PATHS_URL,
    editorPathDeleteUrl,
    editorPathPutOnMapUrl,
    editorPathSplitUrl,
    editorPathStreetDeleteUrl,
    editorPathStreetTakeOffMapUrl,
    editorPathStreetUrl,
    editorPathTakeOffMapUrl,
    editorPathTargetsAreaUrl,
    editorPathTargetsUrl,
    editorPathUrl,
    editorPlaceUrl,
    pathTargetLayersParam,
    type ApiErrorBody,
    type EditorLandscapeLayer,
    type EditorPathDetail,
    type EditorPathStreet,
    type EditorPathTargets,
    type EditorPlaceDetail,
    type OperationReceipt,
    type PathRemovalBody,
    type PathSammelRemovalBody,
    type PathStreetRemovalBody,
    type PathCreateBody,
    type PathCreateReceipt,
    type PathSplitBody,
    type PathSplitReceipt,
} from "@avesmaps3d/shared";
import type { ApiFehler } from "../ortseditor/ort-bearbeitung";

/**
 * Was der Wegeditor vom Server liest und schreibt (WI-0177 Stufe 1, `editor-path-ops.ts`): den Weg mit Revision und Anschlüssen, die
 * Andockziele um ihn und „Hier teilen“ (die Kurve schreibt die Bearbeitung der Straße, `weg-art.ts`); für „Neuer Weg“ den Ort am
 * Anfang, die Andockziele in einem Kasten und `path.create`. Jede Frage trägt ein `AbortSignal` (AGENTS „Abbrechen ist Pflicht“); ein
 * Schreibweg antwortet mit der Quittung oder dem Fehler im Umschlag (ADR-0018), ohne Verbindung mit einem eigenen Fehler.
 */

export type Anlegeantwort =
    { ok: true; quittung: PathCreateReceipt } | { ok: false; status: number; fehler: ApiFehler };
export type Teilantwort = { ok: true; quittung: PathSplitReceipt } | { ok: false; status: number; fehler: ApiFehler };

/** Ein Kasten in Karteneinheiten. */
export interface Kasten {
    readonly x0: number;
    readonly y0: number;
    readonly x1: number;
    readonly y1: number;
}

/** Die Antwort auf einen Wechsel des Stands (löschen, abnehmen, zurück auf die Karte). */
export type Standantwort = { ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler };

export interface WegeditorDaten {
    weg(publicId: string, signal: AbortSignal): Promise<EditorPathDetail | null>;
    /** Die Straße eines Abschnitts mit allen Abschnitten in ihrer Folge (EDIT-0003 T49). */
    strasse(publicId: string, signal: AbortSignal): Promise<EditorPathStreet | null>;
    /** Die Andockziele um den Weg; an einem Fluss dazu die Flächenkanten der Ebenen `ebenen` (ohne Angabe alle drei) und die Abschnitte anderer Flüsse. */
    ziele(
        publicId: string,
        signal: AbortSignal,
        ebenen?: readonly EditorLandscapeLayer[],
    ): Promise<EditorPathTargets | null>;
    /** Die Andockziele im Kasten; für einen neuen Fluss oder Bach (`fluss`) wie um einen Fluss. */
    zieleImKasten(
        kasten: Kasten,
        signal: AbortSignal,
        fluss?: { readonly art: "fluss" | "bach"; readonly ebenen: readonly EditorLandscapeLayer[] },
    ): Promise<EditorPathTargets | null>;
    legeAn(body: PathCreateBody): Promise<Anlegeantwort>;
    /** „Weg hier teilen“ (`path.split`). */
    teile(publicId: string, body: PathSplitBody): Promise<Teilantwort>;
    /** „Ganz löschen“ (`path.delete`, weich). */
    loesche(publicId: string, body: PathRemovalBody): Promise<Standantwort>;
    /** „Von der Karte nehmen“ (`path.take_off_map`, Stufe 3b). */
    nimmAb(publicId: string, body: PathRemovalBody): Promise<Standantwort>;
    /** „Zurück auf die Karte“ (`path.put_on_map`). */
    legeZurueck(publicId: string, body: PathRemovalBody): Promise<Standantwort>;
    /** „Ganze Straße“ ganz löschen bzw. von der Karte nehmen: alle Abschnitte in EINER Operation (EDIT-0003 T49). */
    loescheStrasse(publicId: string, body: PathStreetRemovalBody): Promise<Standantwort>;
    nimmStrasseAb(publicId: string, body: PathStreetRemovalBody): Promise<Standantwort>;
    /** Mehrere Wege (die Mehrfachauswahl) ganz löschen bzw. von der Karte nehmen: alle Abschnitte in EINER Operation (WI-0252). */
    loescheAuswahl(body: PathSammelRemovalBody): Promise<Standantwort>;
    nimmAuswahlAb(body: PathSammelRemovalBody): Promise<Standantwort>;
    /** Ein Ort mit Lage und Namen, für „Neuer Weg ab hier“. */
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
}

async function lies<T>(url: string, signal: AbortSignal): Promise<T | null> {
    // Der Editor liest immer den Stand von jetzt, nicht den Zwischenspeicher des Browsers (wie der Ortseditor, E19).
    const antwort = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (antwort.status === 404) return null;
    if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
    return (await antwort.json()) as T;
}

/** Schreibt eine Operation und liest die Quittung oder den Fehler im Umschlag; ohne Verbindung ein eigener Fehler. */
async function schreibe<Q>(
    url: string,
    body: unknown,
): Promise<{ ok: true; quittung: Q } | { ok: false; status: number; fehler: ApiFehler }> {
    let antwort: Response;
    try {
        antwort = await fetch(url, {
            method: "POST",
            headers: { accept: "application/json", "content-type": "application/json" },
            body: JSON.stringify(body),
        });
    } catch {
        return { ok: false, status: 0, fehler: { code: "network_error", message: "Keine Verbindung zum Server." } };
    }
    if (antwort.ok) return { ok: true, quittung: (await antwort.json()) as Q };
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

export function createWegeditorDaten(): WegeditorDaten {
    return {
        weg: (publicId, signal) => lies(editorPathUrl(publicId), signal),
        strasse: (publicId, signal) => lies(editorPathStreetUrl(publicId), signal),
        ziele: (publicId, signal, ebenen) =>
            lies(
                ebenen === undefined
                    ? editorPathTargetsUrl(publicId)
                    : `${editorPathTargetsUrl(publicId)}?${pathTargetLayersParam(ebenen)}`,
                signal,
            ),
        zieleImKasten: (kasten, signal, fluss) => lies(editorPathTargetsAreaUrl(kasten, fluss), signal),
        legeAn: (body) => schreibe<PathCreateReceipt>(EDITOR_PATHS_URL, body),
        teile: (publicId, body) => schreibe<PathSplitReceipt>(editorPathSplitUrl(publicId), body),
        loesche: (publicId, body) => schreibe<OperationReceipt>(editorPathDeleteUrl(publicId), body),
        nimmAb: (publicId, body) => schreibe<OperationReceipt>(editorPathTakeOffMapUrl(publicId), body),
        legeZurueck: (publicId, body) => schreibe<OperationReceipt>(editorPathPutOnMapUrl(publicId), body),
        loescheStrasse: (publicId, body) => schreibe<OperationReceipt>(editorPathStreetDeleteUrl(publicId), body),
        nimmStrasseAb: (publicId, body) => schreibe<OperationReceipt>(editorPathStreetTakeOffMapUrl(publicId), body),
        loescheAuswahl: (body) => schreibe<OperationReceipt>(EDITOR_PATHS_SAMMEL_DELETE_URL, body),
        nimmAuswahlAb: (body) => schreibe<OperationReceipt>(EDITOR_PATHS_SAMMEL_TAKE_OFF_MAP_URL, body),
        ort: (publicId, signal) => lies(editorPlaceUrl(publicId), signal),
    };
}
