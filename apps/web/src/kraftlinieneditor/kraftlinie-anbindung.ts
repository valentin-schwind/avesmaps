import type { Map as MapLibreMap } from "maplibre-gl";
import { watch } from "vue";
import { SEARCH_FIT_MAX_ZOOM } from "@avesmaps3d/shared";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieModus } from "../map/geometrie/modus";
import type { MapInteractionCoordinator } from "../map/interaction/types";
import { startansicht } from "../map/start-view";
import { createKraftlinieKurve, type KraftlinieKurve } from "./kraftlinie-kurve";
import { createKraftlinienDaten } from "./kraftlinien-daten";
import type { KraftlinieneditorSteuerung } from "./kraftlinieneditor-steuerung";

/**
 * „Kurve bearbeiten“ für die Seite (WI-0205 K8 auf O3; Muster `wegeditor/wegkurve-anbindung.ts`): die Kurve mit Server, Karte, Kamera
 * und Fangradius verbunden, damit `app.vue` nur die Griffe reicht.
 *
 * - **Hinflug** wie bei Fläche und Weg (`map/geometrie/kamera.ts`, `zeigeFrei`): nur, wenn nichts von der Linie frei zu sehen ist.
 * - **Enter** ist „Fertig“, solange die Kurve läuft (wie die Wegkurve); nie in einem Textfeld. Strg+Z und Strg+Y gehen über die
 *   Steuerung (`taste`), Esc über die Kaskade (`app.vue`).
 * - **Das Fenster trägt die Kurve:** Wird es abgelegt oder geschlossen, hängt die Form ab; der Entwurf bleibt (D19, G5).
 * - Ein Ende ins Leere und ein Ladefehler sagen es als Hinweis unten.
 */

export interface KraftlinieSeite {
    karte(): MapLibreMap | undefined;
    interaction(): MapInteractionCoordinator | undefined;
    camera(): Pick<Camera, "showBounds"> | undefined;
}

export function createKraftlinieKurveFuerSeite(
    seite: KraftlinieSeite,
    steuerung: Pick<KraftlinieneditorSteuerung, "fensterVon" | "bearbeitungVon">,
): KraftlinieKurve {
    const daten = createKraftlinienDaten();
    const kurve = createKraftlinieKurve({
        ziele: daten.ziele,
        fangradius: () => startansicht().fangradius,
        melde: (art) =>
            showToast(
                t(
                    art === "kein-ziel"
                        ? "kraftlinieneditor.meldung.keinZiel"
                        : "kraftlinieneditor.bearbeiten.ladefehler",
                ),
                "warning",
            ),
        karte: {
            ein(eingabe) {
                const map = seite.karte();
                const interaction = seite.interaction();
                return map && interaction
                    ? installGeometrieModus(map, interaction, { ...eingabe, werkzeug: "kraftlinieneditor" })
                    : undefined;
            },
            zeige(teile) {
                const map = seite.karte();
                const camera = seite.camera();
                if (map && camera) zeigeFrei(map, camera, teile, SEARCH_FIT_MAX_ZOOM.weg);
            },
        },
    });
    const stopTraeger = watch(
        () => {
            const bearbeitung = kurve.laufend.value;
            if (bearbeitung === undefined) return true;
            const traeger = steuerung.fensterVon(bearbeitung.id);
            return (
                traeger !== undefined &&
                traeger.lage !== "versenkt" &&
                steuerung.bearbeitungVon(bearbeitung.id) === bearbeitung
            );
        },
        (getragen) => {
            if (!getragen) kurve.haengeAb();
        },
    );
    const tasten = (event: KeyboardEvent): void => {
        const bearbeitung = kurve.laufend.value;
        if (bearbeitung === undefined || event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey)
            return;
        const ziel = event.target as HTMLElement | null;
        if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        event.preventDefault();
        void bearbeitung.fertig();
    };
    document.addEventListener("keydown", tasten);
    return {
        ...kurve,
        destroy() {
            document.removeEventListener("keydown", tasten);
            stopTraeger();
            kurve.destroy();
        },
    };
}
