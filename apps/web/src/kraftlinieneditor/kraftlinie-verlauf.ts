import { editorPowerlineHistoryUrl, type EditorPowerlineDetail } from "@avesmaps3d/shared";
import { ruecknahmeFamilie } from "../aenderungen/aenderung-ruecknahme";
import type { VerlaufsArt } from "../fenster/entwurf-verlauf";
import type { Ankerfolge } from "./kraftlinie-art";

/**
 * Der Verlauf der Kraftlinie als Anschluss an den gemeinsamen Verlauf (WI-0205; `fenster/entwurf-verlauf.ts`, erster Nutzer): jede
 * Operation an einem der heutigen Abschnitte der Linie (`GET /api/editor/powerlines/:anker/history`).
 *
 * 🔴 **Zurückgenommen wird auf dem Server** (WI-0265 B6b): Der Anschluss spielt nichts mehr selbst zurück (`ruecknahme` sagt immer `nicht`).
 * `ruecknahmeZiel` nennt dem Verlauf die Adresse (`POST /api/editor/powerlines/:anker/restore-series`), und das gemeinsame Bauteil
 * `aenderungen/aenderung-ruecknahme.vue` fragt: Vorprüfung des Servers, Rückfrage mit den Folgen, EINE Rücknahme, einzeln oder als ganze Serie. Der Server nimmt
 * (`apps/server/src/editor/ruecknahme-kraftlinie.ts`):
 *
 * - **Felder der Linie** (Name, Beschriftung, Beschreibung) stehen im Protokoll je Abschnitt; ↺ setzt sie wie „Fertig“ für alle Abschnitte auf den Wert davor
 *   (`powerline.update_line`). Eine Beschriftung, die vorher nur an einigen Abschnitten stand, kommt so an allen zurück (der Schreibweg kennt sie nur für die ganze
 *   Linie). Folgte ein Wert vorher dem Wiki, kommt er als Wiki-Wert zurück.
 * - **Der Wiki-Artikel** der Linie: ↺ ordnet den Artikel von vorher wieder zu (oder löst ihn), über seinen Schlüssel.
 * - **Form je Abschnitt** (Bogen, Enden): der Wert davor an genau diesem Abschnitt.
 * - **Angefügt und herausgenommen** (Nodix anfügen, R5): Ein angefügter Abschnitt entfällt wieder, ein herausgenommener kommt zurück (der Server prüft, dass er
 *   seither unberührt ist). Ein zurückgekommener Abschnitt nimmt Name, Beschriftung und Beschreibung der Linie von heute an. Nimmt das ↺ den Anker heraus, lesen
 *   Bearbeitung und Verlauf unter dem neuen weiter (`Ankerfolge`, `nachRuecknahme`).
 * - **Stand** (K10): ↺ an „Von der Karte nehmen“, „Zurück auf die Karte“, „Ganz löschen“ und „Zurückholen“ ist der Gegenwechsel. Trifft ein Wechsel auch Abschnitte
 *   anderer Linien (Mehrfachauswahl, WI-0238), kommen ALLE zurück oder keine; das ↺ der früheren Fassung, das nur die Linien zurücknahm, die noch so standen, fällt weg.
 * - **Nicht zurücknehmbar:** Import und Zurücksetzen der Testwelt, das Anlegen einer Linie (`powerline.create`), alles am Kraftlinienpunkt (`nodix.*`), Änderungen
 *   an einer Linie, die gerade nicht auf der Karte ist, und ein Name, der vorher leer war.
 */

const LINIE = ["name", "labelVisible", "description", "wiki"] as const;
const FORM = ["curve", "from", "to"] as const;

export function createKraftlinieVerlaufsArt(
    _fetcher?: typeof fetch,
    folge: Ankerfolge = { anker: undefined },
): VerlaufsArt<EditorPowerlineDetail, never> {
    return {
        url: editorPowerlineHistoryUrl,
        gehoert: (g, linie) => g.kind === "powerline" && linie.segments.some((a) => a.id === g.id),
        // Der Server nimmt zurück; der Anschluss spielt nichts mehr selbst.
        ruecknahme: () => ({ art: "nicht" }),
        schreibe: () =>
            Promise.resolve({
                ok: false,
                status: 0,
                fehler: { code: "unknown_error", message: "Die Kraftlinie wird auf dem Server zurückgenommen." },
            }),
        ruecknahmeZiel: (eintrag, id) =>
            ruecknahmeFamilie(eintrag) === "powerline" ? { familie: "powerline", id: folge.anker ?? id } : undefined,
        // Die Linie heißt nach ihrem kleinsten Abschnitt; war das der herausgenommene, liest die Art unter dem neuen weiter.
        nachRuecknahme(quittung) {
            const [neu] = (quittung.affected ?? [])
                .filter((a) => a.kind === "powerline")
                .map((a) => a.id)
                .sort();
            if (neu !== undefined) folge.anker = neu;
        },
        feldFolge: [...LINIE, ...FORM, "wiki", "active", "offMap"],
        // Die Herkunft der Wiki-Felder (`nameOrigin`, `descriptionOrigin`) steht nicht als eigene Zeile da (WI-0225 Nachtrag 2).
        herkunft: "powerline",
    };
}
