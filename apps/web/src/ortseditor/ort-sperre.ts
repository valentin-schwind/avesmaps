import type { EditorLock, EditorLockPart } from "@avesmaps3d/shared";
import type { EditorSperre, FreigabeAngebot, NimmErgebnis } from "../editor-sperre/sperre";

/**
 * Die Sperre eines Orts während der Bearbeitung (EDIT-0003 §4, WI-0208) über den gemeinsamen Baustein `editor-sperre/sperre.ts`.
 *
 * Am Ort halten mehrere Stellen dieselbe Sperre zugleich: „Ort verschieben“ (die Form) und der Entwurf jedes Ortseditor-Fensters, das
 * den Ort zeigt (die Eigenschaften). Der Baustein kennt je Objekt EINE Sperre und gäbe sie beim ersten `gib` frei, auch wenn das Fenster
 * noch einen Entwurf hat. Hier zählt jeder Halter; frei wird der Ort erst, wenn keiner mehr hält. Der Server behält für denselben Lauf
 * seine Zeile und sein „seit“, ein zweites Nehmen fragt ihn deshalb nicht noch einmal.
 *
 * **Freigabe auf Bitte** (WI-0262): Jeder Halter meldet mit `biete` an, wie er sich beenden lässt (Entwurf speichern, Modus enden). Der
 * Baustein darunter ruft alle Angebote eines Orts auf, bevor er die Sperre abgibt; hier ist es nur der Durchgriff.
 */
export interface OrtSperre {
    /** Nimmt die Sperre für diesen Halter; hält ein anderer den Ort, kommt seine Sperre zurück. */
    nimm(id: string, teil: EditorLockPart, halter: object): Promise<NimmErgebnis>;
    /** Dieser Halter ist fertig; der Ort wird frei, wenn sonst keiner hält. */
    gib(id: string, halter: object): void;
    /** Ein Zuhörer für eine verlorene Sperre (abgelaufen oder von einem Admin aufgehoben); zurück kommt das Abmelden. */
    beiVerlust(hoerer: (id: string) => void): () => void;
    /**
     * Meldet an, wie dieser Halter auf eine Bitte um Freigabe endet; zurück kommt das Abmelden. Ohne die Schnittstelle der Seite tut es
     * nichts. Optional, damit eine Attrappe ohne Seite genügt.
     */
    biete?(id: string, angebot: FreigabeAngebot): () => void;
}

export function createOrtSperre(
    sperre: Pick<EditorSperre, "nimm" | "gib" | "beiVerlust"> & Partial<Pick<EditorSperre, "bieteFreigabe">>,
): OrtSperre {
    const halter = new Map<string, Set<object>>();
    const gehalten = new Map<string, EditorLock>();
    const fragt = new Map<string, Promise<NimmErgebnis>>();
    const zuhoerer = new Set<(id: string) => void>();

    sperre.beiVerlust((ziel) => {
        if (ziel.kind !== "place" || !gehalten.has(ziel.id)) return;
        gehalten.delete(ziel.id);
        halter.delete(ziel.id);
        for (const hoerer of zuhoerer) hoerer(ziel.id);
    });

    function halte(id: string, wer: object): void {
        const menge = halter.get(id) ?? new Set<object>();
        menge.add(wer);
        halter.set(id, menge);
    }

    return {
        async nimm(id, teil, wer) {
            const schon = gehalten.get(id);
            if (schon !== undefined) {
                halte(id, wer);
                return { art: "genommen", sperre: schon };
            }
            // Fragen zwei zugleich (Verschieben und ein Fenster), geht EINE Frage an den Server.
            let frage = fragt.get(id);
            if (frage === undefined) {
                frage = sperre.nimm({ kind: "place", id }, teil);
                fragt.set(id, frage);
            }
            const ergebnis = await frage;
            if (fragt.get(id) === frage) fragt.delete(id);
            if (ergebnis.art === "genommen") {
                gehalten.set(id, ergebnis.sperre);
                halte(id, wer);
            }
            return ergebnis;
        },
        gib(id, wer) {
            const menge = halter.get(id);
            if (menge === undefined || !menge.delete(wer) || menge.size > 0) return;
            halter.delete(id);
            gehalten.delete(id);
            sperre.gib({ kind: "place", id });
        },
        beiVerlust(hoerer) {
            zuhoerer.add(hoerer);
            return () => zuhoerer.delete(hoerer);
        },
        biete: (id, angebot) => sperre.bieteFreigabe?.({ kind: "place", id }, angebot) ?? (() => undefined),
    };
}
