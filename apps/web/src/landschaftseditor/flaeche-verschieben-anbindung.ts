import type { Map as MapLibreMap } from "maplibre-gl";
import { watch } from "vue";
import { AVENTURIA, SEARCH_FIT_MAX_ZOOM, fromRenderLngLat, type EditorLandscapeLayer } from "@avesmaps3d/shared";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import { belegeGeometrie, meldeGeometrieAn } from "../map/geometrie/besitzer";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieSchicht } from "../map/geometrie/schicht";
import { INTERACTION_PRIORITY } from "../map/interaction/priorities";
import type { Claim, InteractionOwner, MapInteractionCoordinator } from "../map/interaction/types";
import { createEckenDaten } from "./ecken-daten";
import {
    createFlaecheVerschieben,
    inTeilflaeche,
    type FlaecheVerschieben,
    type VerschiebenMeldung,
} from "./flaeche-verschieben";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Verschieben“ für die Seite (Werkzeug 7 der Derographie): der Modus mit Server, Karte und Kamera verbunden, damit `app.vue` nur die
 * Griffe reicht (`app.vue` schmal einhängen).
 *
 * - **Vorschau** in der gemeinsamen Schicht des Geometrie-Moduls; der Modus belegt das Modul (ein Modus zur Zeit) und meldet sich als
 *   `geometry-edit` an: Zeigen bewegt die hängende Teilfläche, ein Klick setzt sie ab oder hebt sie wieder auf. Die Karte lässt sich
 *   dabei weiter ziehen (ein Ziehen ist kein Klick).
 * - **Zeiger:** „grabbing“, solange die Teilfläche hängt; „grab“ über der abgesetzten Teilfläche.
 * - **Kamera** nur, wenn die Teilfläche nicht frei zu sehen ist (`zeigeFrei`, Stufe der Suche für Landschaften).
 * - **Enter** ist „Fertig“ der Bearbeitung; Strg+Z und Strg+Y nimmt die Seite (`entwurfTasten`), Esc hängt sie in ihre Kaskade.
 * - **Das Fenster trägt die Form** (wie „Ecken bearbeiten“): Wird das Fenster der Landschaft abgelegt oder geschlossen, endet der Modus;
 *   der Entwurf bleibt (D19, G5).
 * - **An einer Sprache** (WI-0261 Stufe 2) dieselbe Anbindung: Was den Entwurf trägt und welches Fenster seine Liste einzieht, sagt die Quelle des
 *   Laufs (`lauf.quelle`, `map/geometrie/flaechen-quelle.ts`).
 */
export interface VerschiebenSeite {
    /** Karte, Kamera und Koordinator, sobald die Karte bereit ist; vorher startet kein Modus. */
    karte():
        { map: MapLibreMap; camera: Pick<Camera, "showBounds">; interaction: MapInteractionCoordinator } | undefined;
    ebenen(): readonly EditorLandscapeLayer[];
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    getragen(regionId: string): boolean;
}

const space = AVENTURIA.coordinateSpace;

export function verschiebenHinweis(meldung: VerschiebenMeldung): { text: string; ton?: "success" | "warning" } {
    switch (meldung.art) {
        case "gespeichert":
            return { text: t("landschaftseditor.verschieben.gespeichert", { name: meldung.name }), ton: "success" };
        case "ohneFlaeche":
            return { text: t("landschaftseditor.verschieben.ohneFlaeche", { name: meldung.name }), ton: "warning" };
        case "ladefehler":
            return { text: t("landschaftseditor.verschieben.ladefehler"), ton: "warning" };
    }
}

export function createFlaecheVerschiebenFuerSeite(seite: VerschiebenSeite): FlaecheVerschieben {
    const verschieben = createFlaecheVerschieben({
        daten: createEckenDaten(),
        ebenen: seite.ebenen,
        bearbeitung: seite.bearbeitung,
        getragen: seite.getragen,
        karte: {
            an(bild, zeiger) {
                const da = seite.karte();
                if (da === undefined) return undefined;
                const belegung = belegeGeometrie(verschieben.laufend.value?.quelle.werkzeug);
                if (belegung === undefined) return undefined;
                const schicht = installGeometrieSchicht(da.map);
                schicht.zeige(bild());
                const owner: InteractionOwner<Claim> = {
                    id: "geometry-edit",
                    priority: INTERACTION_PRIORITY["geometry-edit"],
                    kinds: ["hover", "click"],
                    layers: () => [],
                    hit(context) {
                        const lauf = verschieben.laufend.value;
                        if (lauf === undefined) return {};
                        if (lauf.haengt) return { cursor: "grabbing" };
                        const jetzt = verschieben.stand();
                        const punkt = fromRenderLngLat(space, context.lngLat);
                        return jetzt !== undefined && inTeilflaeche(jetzt.teile, lauf.areaId, punkt)
                            ? { cursor: "grab" }
                            : {};
                    },
                    apply(kind, _claim, context) {
                        const punkt = fromRenderLngLat(space, context.lngLat);
                        if (kind === "click") zeiger.klick(punkt);
                        else zeiger.bewege(punkt);
                    },
                };
                const anmeldung = meldeGeometrieAn(da.interaction, owner);
                return {
                    aktualisiere: () => schicht.zeige(bild()),
                    aus: () => {
                        anmeldung.ab();
                        schicht.entferne();
                        belegung.frei();
                    },
                };
            },
            zeige(teile) {
                const da = seite.karte();
                if (da !== undefined) zeigeFrei(da.map, da.camera, teile, SEARCH_FIT_MAX_ZOOM.landschaft);
            },
        },
    });
    const stopMeldung = watch(verschieben.meldung, (meldung) => {
        if (meldung === undefined) return;
        const { text, ton } = verschiebenHinweis(meldung);
        showToast(text, ton);
    });
    const stopTraeger = watch(
        () => {
            const lauf = verschieben.laufend.value;
            return lauf?.phase !== "bereit" || lauf.quelle.getragen(lauf.id);
        },
        (getragen) => {
            if (!getragen) verschieben.beende();
        },
    );
    function taste(event: KeyboardEvent): void {
        const lauf = verschieben.laufend.value;
        if (lauf?.phase !== "bereit" || lauf.bearbeitung === undefined) return;
        const ziel = event.target as HTMLElement | null;
        if (ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        void lauf.bearbeitung.fertig();
    }
    document.addEventListener("keydown", taste);
    return {
        ...verschieben,
        destroy() {
            verschieben.destroy();
            stopMeldung();
            stopTraeger();
            document.removeEventListener("keydown", taste);
        },
    };
}
