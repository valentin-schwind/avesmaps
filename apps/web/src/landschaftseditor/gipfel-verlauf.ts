import { editorPeakHistoryUrl, type EditorPeakDetail, type MapHistoryObject } from "@avesmaps3d/shared";
import { istDerographie } from "../aenderungen/aenderung-ruecknahme";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import type { Ruecknahme, VerlaufsArt } from "../fenster/entwurf-verlauf";

/**
 * Der Verlauf eines Gipfels oder Vulkans im Derographie-Fenster („Gipfel entfernen …“, Editor-Orchestrierung 2026-10-19; gemeinsamer
 * Verlauf `fenster/entwurf-verlauf.ts`): jede Operation, die ihn nennt (`GET /api/editor/peaks/:id/history`).
 *
 * **Zurücknehmen über den Server** (WI-0265 B6c): Alles, was am Gipfel zurückgeht, nimmt `POST /api/editor/peaks/:id/restore-series` zurück: Vorprüfung, Rückfrage mit den Folgen, EINE
 * Rücknahme (`aenderungen/aenderung-ruecknahme.vue`, dieselbe wie im Reiter „Änderungen“), einzeln oder als ganze Arbeitsserie. Das sind Name, Höhe (folgte sie dem Wiki, kommt sie so
 * zurück), „Auf der Karte anzeigen“ und Lage, Stilllegen und Zurückholen („Gipfel entfernen …“, auch das „Entfernen …“ der Mehrfachauswahl, das ihn mitnahm; dann kommen ihre
 * Landschaften mit zurück). Dieser Anschluss spielt nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`); `ruecknahmeZiel` nennt dem Verlauf die Adresse.
 *
 * **Nicht zurücknehmbar:** Import und Zurücksetzen der Testwelt und das Anlegen („Gipfel setzen“).
 */

const NICHT = { art: "nicht" } as const;

/** Es gibt keine Rücknahme, die dieser Anschluss selbst schriebe: Der Server nimmt alles zurück. */
type KeineRuecknahme = never;

export function gehoertZumGipfel(gegenstand: MapHistoryObject, d: EditorPeakDetail): boolean {
    return gegenstand.kind === "peak" && gegenstand.id === d.id;
}

export function createGipfelVerlaufsArt(): VerlaufsArt<EditorPeakDetail, KeineRuecknahme> {
    return {
        url: editorPeakHistoryUrl,
        gehoert: gehoertZumGipfel,
        ruecknahme: (): Ruecknahme<KeineRuecknahme> => NICHT,
        // Jeder Eintrag, den der Server zurücknimmt und der diesen Gipfel nennt, hängt hier an ihm (auch das „Entfernen …“ einer Mehrfachauswahl, die ihn mitnahm).
        ruecknahmeZiel: (eintrag, id) =>
            istDerographie(
                eintrag.operation,
                eintrag.objects.map((gegenstand) => gegenstand.action),
            ) && eintrag.objects.some((gegenstand) => gegenstand.kind === "peak" && gegenstand.id === id)
                ? { familie: "peak", id }
                : undefined,
        // Unerreichbar: `ruecknahme` bietet nie etwas an, das hier geschrieben würde.
        schreibe: (): Promise<SchreibAntwort> =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "not_revertable", message: "Der Server nimmt Gipfel zurück." },
            }),
        feldFolge: ["active", "name", "height", "showName", "position"],
    };
}
