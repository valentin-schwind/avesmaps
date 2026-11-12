import type { EditorPlaceDetail, OperationReceipt, PlaceUpdateBody } from "@avesmaps3d/shared";
import type { ApiFehler } from "./ort-bearbeitung";

/**
 * Der Schreibweg von „Verbergen“ und „Zurückholen“ am Ort (WI-0128 E15, D20). Die Handgriffe selbst stehen seit Schritt O1 im Register
 * (`editor-menu/handgriffe-ort.ts`, EDIT-0002 §6); hier bleibt, was den Ort liest und schreibt.
 */

/** Was „◌ Verbergen“ zum Schreiben braucht (\`ortseditor-daten.ts\`). */
export interface VerbergenApi {
    ort(publicId: string, signal: AbortSignal): Promise<EditorPlaceDetail | null>;
    speichereOrt(
        publicId: string,
        body: PlaceUpdateBody,
    ): Promise<{ ok: true; quittung: OperationReceipt } | { ok: false; status: number; fehler: ApiFehler }>;
}

export type VerbergenErgebnis =
    { ok: true; name: string; revision: number; mapRevision: number | undefined } | { ok: false; satz: string };

/**
 * „◌ Verbergen“ bzw. „● Zurückholen“ sofort (D20): den Ort mit Revision lesen und \`hidden\` als \`place.update\` schreiben, eine Operation.
 * Ein Konflikt kann nur entstehen, wenn jemand zwischen Lesen und Schreiben speichert; dann sagt es der Satz des Servers.
 */
export async function verbergen(
    api: VerbergenApi,
    publicId: string,
    verborgen: boolean,
    neueKennung: () => string = () => crypto.randomUUID(),
    ladefehler = "Der Ort ließ sich nicht laden.",
): Promise<VerbergenErgebnis> {
    const ort = await api.ort(publicId, new AbortController().signal).catch(() => null);
    if (ort === null) return { ok: false, satz: ladefehler };
    const antwort = await api.speichereOrt(publicId, {
        operationId: neueKennung(),
        baseRevision: ort.revision,
        changes: { hidden: verborgen },
    });
    if (!antwort.ok) return { ok: false, satz: antwort.fehler.message };
    const neu = antwort.quittung.affected.find((x) => x.kind === "place");
    return {
        ok: true,
        name: ort.name,
        revision: neu?.revision ?? ort.revision + 1,
        mapRevision: antwort.quittung.mapRevision,
    };
}
