import {
    EDITOR_NODICES_URL,
    EDITOR_POWERLINE_TARGETS_URL,
    EDITOR_POWERLINES_URL,
    editorNodixMoveUrl,
    editorNodixRetireUrl,
    editorPowerlineTargetsUrl,
    type EditorPowerlineTargets,
    type NodixCreateBody,
    type NodixCreateReceipt,
    type NodixMoveBody,
    type NodixRetireBody,
    type OperationReceipt,
    type PowerlineCreateBody,
    type PowerlineCreateReceipt,
} from "@avesmaps3d/shared";
import { sende, type SchreibAntwort } from "../fenster/entwurf-senden";

/**
 * Was „Kurve bearbeiten“, „Neue Kraftlinie“, „Neuer Kraftlinienpunkt“ und „Kraftlinienpunkt entfernen“ vom Server lesen und schreiben
 * (WI-0205 K8, K9, K10; `powerline-editor-ops.ts`): die Nodices zum Einrasten, `powerline.create`, `nodix.create` und `nodix.retire`. Jede Frage trägt ein `AbortSignal`; der
 * Schreibweg ist der gemeinsame (`fenster/entwurf-senden.ts`). Die Linie selbst und `powerline.update_line` liest und schreibt die Art
 * der Bearbeitung (`kraftlinie-art.ts`).
 */

export type Antwort<T> = SchreibAntwort<T>;

export interface KraftlinienDaten {
    ziele(anker: string, signal: AbortSignal): Promise<EditorPowerlineTargets | null>;
    /** Alle Nodices der Karte, für eine neue Kraftlinie (K9). */
    nodices(signal: AbortSignal): Promise<EditorPowerlineTargets | null>;
    /** `powerline.create` (K9): ein Abschnitt von Nodix zu Nodix. */
    legeAn(body: PowerlineCreateBody): Promise<Antwort<PowerlineCreateReceipt>>;
    /** `nodix.create` (K9): ein Kraftlinienpunkt an einer Stelle. */
    setzePunkt(body: NodixCreateBody): Promise<Antwort<NodixCreateReceipt>>;
    /** `nodix.retire` (K10): ein Kraftlinienpunkt ohne Linie, weich. */
    entfernePunkt(id: string, body: NodixRetireBody): Promise<Antwort<OperationReceipt>>;
    /** `nodix.move` (K5): ein Kraftlinienpunkt an eine neue Stelle; die Bahnen an ihm folgen. */
    verschiebePunkt(id: string, body: NodixMoveBody): Promise<Antwort<OperationReceipt>>;
}

async function lies<T>(url: string, signal: AbortSignal): Promise<T | null> {
    // Der Editor liest immer den Stand von jetzt, nicht den Zwischenspeicher des Browsers (wie der Ortseditor, E19).
    const antwort = await fetch(url, { signal, cache: "no-store", headers: { accept: "application/json" } });
    if (antwort.status === 404) return null;
    if (!antwort.ok) throw new Error(`${url} antwortete ${String(antwort.status)}`);
    return (await antwort.json()) as T;
}

export function createKraftlinienDaten(): KraftlinienDaten {
    return {
        ziele: (anker, signal) => lies(editorPowerlineTargetsUrl(anker), signal),
        nodices: (signal) => lies(EDITOR_POWERLINE_TARGETS_URL, signal),
        legeAn: (body) => sende<PowerlineCreateReceipt>(EDITOR_POWERLINES_URL, body),
        setzePunkt: (body) => sende<NodixCreateReceipt>(EDITOR_NODICES_URL, body),
        entfernePunkt: (id, body) => sende(editorNodixRetireUrl(id), body),
        verschiebePunkt: (id, body) => sende(editorNodixMoveUrl(id), body),
    };
}
