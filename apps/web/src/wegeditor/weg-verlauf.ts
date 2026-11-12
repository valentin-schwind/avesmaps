import { editorPathHistoryUrl, type EditorPathStreet } from "@avesmaps3d/shared";
import { ruecknahmeFamilie, ruecknahmeZiel } from "../aenderungen/aenderung-ruecknahme";
import { type Ruecknahme, type VerlaufsArt } from "../fenster/entwurf-verlauf";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { istQuellenEintrag } from "../fenster/quellen-verlauf-modell";

/**
 * Der Verlauf der Straße als Anschluss an den gemeinsamen Verlauf (WI-0177, EDIT-0003 T54; `fenster/entwurf-verlauf.ts`, Muster
 * `kraftlinieneditor/kraftlinie-verlauf.ts`): jede Operation an einem ihrer Abschnitte (`GET /api/editor/paths/:id/history`).
 *
 * **Zurücknehmen über den Server** (WI-0265 B6a und B6a2): Alles, was am Weg zurückgeht, nimmt `POST /api/editor/paths/:id/restore-series` zurück: Vorprüfung, Rückfrage mit den
 * Folgen, EINE Rücknahme (`aenderungen/aenderung-ruecknahme.vue`, dieselbe wie im Reiter „Änderungen“). Das sind die Felder der Straße (Name, Wegart, „Name auf der Karte“,
 * Kennzeichen, Tunnel, Bach, Fließrichtung, Reisemittel; auch als Serie), die Kurve samt mitgezogenen Punkten, die Wechsel des Stands (Ganz löschen, Zurückholen, Von der Karte
 * nehmen, Zurück auf die Karte; einzeln, die ganze Straße oder die Mehrfachauswahl), „Auswahl zu neuem Weg“ und „Wege verbinden“, seit B8a das Anlegen und das Teilen und seit B8a2 die
 * Rücknahme von „Auswahl zu neuem Weg“, „Wege verbinden“ und Teilen (in beide Richtungen). Dieser Anschluss spielt nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`);
 * `ruecknahmeZiel` nennt dem Verlauf die Adresse.
 *
 * **Nicht zurücknehmbar:** Import und Zurücksetzen der Testwelt, die Quellen der Straße (ihr ↺ ist das der Quellen) und eine Umgruppierung oder Verbindung, die selbst ein Client-↺ war
 * (Altbestand mit Quelle `restore`, vor dem Server-↺).
 */

const NICHT = { art: "nicht" } as const;

/** Es gibt keine Rücknahme, die dieser Anschluss selbst schriebe: Der Server nimmt alles zurück. */
type KeineRuecknahme = never;

export function createWegVerlaufsArt(): VerlaufsArt<EditorPathStreet, KeineRuecknahme> {
    return {
        url: editorPathHistoryUrl,
        gehoert: (g, d) => g.kind === "path" && d.segments.some((a) => a.id === g.id),
        ruecknahme: (): Ruecknahme<KeineRuecknahme> => NICHT,
        // Die Adresse hängt an einem Abschnitt, den die Operation berührte, nicht am Anker der Straße.
        // Die Quellen eines Objekts (`<art>.sources_changed`) nimmt der Server in „Änderungen“ zurück (WI-0265 B6g3); in diesem Verlauf haben sie ihr eigenes ↺ je Quelle (`quellen-verlauf-eintrag.vue`), hier keine Adresse.
        ruecknahmeZiel: (eintrag) =>
            !istQuellenEintrag(eintrag) && ruecknahmeFamilie(eintrag) === "path" ? ruecknahmeZiel(eintrag) : undefined,
        // Unerreichbar: `ruecknahme` bietet nie etwas an, das hier geschrieben würde.
        schreibe: (): Promise<SchreibAntwort> =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "not_revertable", message: "Der Server nimmt Wege zurück." },
            }),
        feldFolge: [
            "name",
            "subtype",
            "isBach",
            "flowDirection",
            "mark",
            "labelVisible",
            "tunnel",
            "weitere",
            "reisen",
            "active",
            "offMap",
            "geometry",
            "wiki",
        ],
        // Die Herkunft der Wiki-Felder (`nameOrigin` …) steht nicht als eigene Zeile da; ↺ nimmt sie mit (WI-0225 §7).
        herkunft: "path",
    };
}
