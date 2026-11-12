import { editorLandscapeHistoryUrl, type EditorLandscapeDetail, type MapHistoryObject } from "@avesmaps3d/shared";
import { ruecknahmeFamilie } from "../aenderungen/aenderung-ruecknahme";
import type { Ruecknahme, VerlaufsArt } from "../fenster/entwurf-verlauf";
import type { SchreibAntwort } from "../fenster/entwurf-senden";
import { istQuellenEintrag } from "../fenster/quellen-verlauf-modell";

/**
 * Der Verlauf einer Fläche der Derographie als Anschluss an den gemeinsamen Verlauf (WI-0178 D3; `fenster/entwurf-verlauf.ts`, erster
 * Nutzer die Kraftlinie): jede Operation an der Fläche, ihren Teilflächen und Beschriftungen (`GET /api/editor/landscapes/:id/history`).
 *
 * **Zurücknehmen über den Server** (WI-0265 B3 und B6c): Alles, was an der Fläche zurückgeht, nimmt `POST /api/editor/landscapes/:id/restore-series` zurück: Vorprüfung, Rückfrage mit den
 * Folgen, EINE Rücknahme (`aenderungen/aenderung-ruecknahme.vue`, dieselbe wie im Reiter „Änderungen“), einzeln oder als ganze Arbeitsserie. Das sind die Felder der Fläche (Name, Ebene,
 * Art, Platz in der Ebene, Klicksperre, „für Besucher verborgen“, Kurve), die Felder ihrer Beschriftungen (Größe, Priorität, Zoomspanne, „Auf der Karte anzeigen“, Lage, Text), ihre Form
 * samt den mitgezogenen Ecken der Nachbarflächen, das Gebirge (Typ, Muster, Kammhöhe, Werte, gezeichnetes Netz), Stilllegen und Zurückholen („Fläche entfernen …“) und die Werkzeuge
 * an Flächen, die in EINER Operation schreiben („Mit anderer Fläche“, „Unterflächen“, „Zerschneiden“, „Kopieren“, „Flächen vereinigen“, die Mehrfachauswahl). Dieser Anschluss spielt
 * nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`); `ruecknahmeZiel` nennt dem Verlauf die Adresse.
 *
 * **Nicht zurücknehmbar:** Import und Zurücksetzen der Testwelt, das Anlegen (Fläche, Beschriftung) und das Löschen einer Beschriftung. Die Gipfel, die in der Fläche liegen, haben
 * ihren eigenen Verlauf (`gipfel-verlauf.ts`).
 */

const NICHT = { art: "nicht" } as const;

/** Es gibt keine Rücknahme, die dieser Anschluss selbst schriebe: Der Server nimmt alles zurück. */
type KeineRuecknahme = never;

/** Gehört dieser Gegenstand zur Fläche: sie selbst, eine ihrer Teilflächen oder Beschriftungen. */
export function gehoertZurFlaeche(gegenstand: MapHistoryObject, d: EditorLandscapeDetail): boolean {
    if (gegenstand.kind === "landscape") return gegenstand.id === d.id;
    if (gegenstand.kind === "label") return d.labels.some((label) => label.id === gegenstand.id);
    if (gegenstand.kind === "area") return d.areas.some((area) => area.id === gegenstand.id);
    return false;
}

export function createLandschaftVerlaufsArt(): VerlaufsArt<EditorLandscapeDetail, KeineRuecknahme> {
    return {
        url: editorLandscapeHistoryUrl,
        gehoert: gehoertZurFlaeche,
        ruecknahme: (): Ruecknahme<KeineRuecknahme> => NICHT,
        // Die Fläche, an der der Verlauf hängt, ist die Adresse; sie steht in jedem Eintrag, der in diesem Verlauf erscheint.
        // Die Quellen eines Objekts (`<art>.sources_changed`) nimmt der Server in „Änderungen“ zurück (WI-0265 B6g3); in diesem Verlauf haben sie ihr eigenes ↺ je Quelle (`quellen-verlauf-eintrag.vue`), hier keine Adresse.
        ruecknahmeZiel: (eintrag, id) =>
            !istQuellenEintrag(eintrag) && ruecknahmeFamilie(eintrag) === "landscape"
                ? { familie: "landscape", id }
                : undefined,
        // Unerreichbar: `ruecknahme` bietet nie etwas an, das hier geschrieben würde.
        schreibe: (): Promise<SchreibAntwort> =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "not_revertable", message: "Der Server nimmt Flächen zurück." },
            }),
        feldFolge: [
            "name",
            "layer",
            "type",
            "locked",
            "hidden",
            "curve",
            "size",
            "priority",
            "zoom",
            "showName",
            "position",
            "geometry",
        ],
    };
}
