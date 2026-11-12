import {
    EDITOR_TERRITORY_DETAIL_FIELDS,
    editorTerritoryHistoryUrl,
    type EditorTerritoryDetail,
} from "@avesmaps3d/shared";
import { ruecknahmeFamilie } from "../aenderungen/aenderung-ruecknahme";
import type { VerlaufsArt } from "../fenster/entwurf-verlauf";
import { istQuellenEintrag } from "../fenster/quellen-verlauf-modell";

/**
 * Der Verlauf eines Herrschaftsgebiets als Anschluss an den gemeinsamen Verlauf (WI-0209 D5; `fenster/entwurf-verlauf.ts`, Vorlage
 * `kraftlinieneditor/kraftlinie-verlauf.ts`): jede Operation am Gebiet oder an einer seiner Flächen (`GET …/territories/:id/history`).
 *
 * 🔴 **Zurückgenommen wird auf dem Server** (WI-0265 B6b): Der Anschluss spielt nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`).
 * `ruecknahmeZiel` nennt dem Verlauf die Adresse (`POST /api/editor/territories/:id/restore-series`), und das gemeinsame Bauteil
 * `aenderungen/aenderung-ruecknahme.vue` fragt: Vorprüfung des Servers, Rückfrage mit den Folgen, EINE Rücknahme, einzeln oder als ganze Serie. Der Server nimmt
 * (`apps/server/src/editor/ruecknahme-gebiet.ts`):
 *
 * - **Felder und Darstellung** (`territory.update`, `.display`, `.sammel`): Name, Kurzname, Art, Status, Hauptstadt, Obergebiet („Umhängen“), die 17 Detailfelder
 *   (ein Wert, der vorher dem Wiki folgte, kommt als Wiki-Wert zurück), Farbe und Zoomspanne. Eine Operation über mehrere Gebiete (Mehrfachauswahl) kommt für
 *   ALLE zurück oder für keines; das ↺ „nur dieses Gebiet“ der früheren Fassung fällt weg.
 * - **Entfernen** (D3, `territory.retire`), **„Unter neues Obergebiet …“** (`territory.create_parent`) und **„Flächen vereinigen ›“** (`territory.merge`): ↺ holt
 *   alles zurück, solange es noch so steht, wie die Operation es hinterließ. Vor ↺ an „Entfernen“ nennt die Rückfrage die Folgen (EDIT-0003 T54, R13: welche Gebiete
 *   zurückkommen, wie viele Untergebiete wieder wie vorher hängen, welche Flächen auf die Karte gehen; `folgenZeilen` in `aenderung-ruecknahme.ts`).
 * - **Nicht zurücknehmbar:** Import und Zurücksetzen der Testwelt, das Anlegen, die Form (Grenzen, Flächen der Nachbarn; dafür „Grenzen bearbeiten“), ein
 *   Zurückholen und ein Name, der vorher leer war.
 */

/** Die Felder des Protokolls, in der Folge, in der der Verlauf sie zeigt. */
const FELDER = ["name", "shortName", "type", "status", "capital", "parent"] as const;
const DARSTELLUNG = ["color", "minZoom", "maxZoom"] as const;

export function createGebietVerlaufsArt(): VerlaufsArt<EditorTerritoryDetail, never> {
    return {
        url: editorTerritoryHistoryUrl,
        gehoert: (g, d) =>
            (g.kind === "territory" && g.id === d.id) ||
            (g.kind === "territory_area" && d.areas.some((a) => a.id === g.id)),
        // Der Server nimmt zurück; der Anschluss spielt nichts mehr selbst.
        ruecknahme: () => ({ art: "nicht" }),
        schreibe: () =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "unknown_error", message: "Das Gebiet wird auf dem Server zurückgenommen." },
            }),
        // Die Quellen eines Objekts (`<art>.sources_changed`) nimmt der Server in „Änderungen“ zurück (WI-0265 B6g3); in diesem Verlauf haben sie ihr eigenes ↺ je Quelle (`quellen-verlauf-eintrag.vue`), hier keine Adresse.
        ruecknahmeZiel: (eintrag, id) =>
            !istQuellenEintrag(eintrag) && ruecknahmeFamilie(eintrag) === "territory"
                ? { familie: "territory", id }
                : undefined,
        feldFolge: [...FELDER, ...EDITOR_TERRITORY_DETAIL_FIELDS, ...DARSTELLUNG, "active", "parentOrigin", "geometry"],
        // Die Herkunft der Detailfelder steht in `territory_detail_field_origin`, nicht im Katalog: keine eigene Zeile im Verlauf.
        herkunftsfelder: EDITOR_TERRITORY_DETAIL_FIELDS,
    };
}
