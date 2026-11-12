import type { Map as MapLibreMap } from "maplibre-gl";
import { watch } from "vue";
import {
    AVENTURIA,
    SEARCH_FIT_MAX_ZOOM,
    fromRenderLngLat,
    toRenderLngLat,
    type EditorLandscapeLayer,
} from "@avesmaps3d/shared";
import { showToast } from "../feedback/toast";
import { t } from "../i18n/i18n";
import type { Camera } from "../map/camera/camera";
import { belegeGeometrie } from "../map/geometrie/besitzer";
import { zeigeFrei } from "../map/geometrie/kamera";
import { installGeometrieSchicht } from "../map/geometrie/schicht";
import { createEckenDaten } from "./ecken-daten";
import { createFlaecheVereinfachen, type FlaecheVereinfachen, type VereinfachenMeldung } from "./flaeche-vereinfachen";
import type { LandschaftBearbeitung } from "./landschaftseditor-steuerung";

/**
 * „Fläche vereinfachen“ für die Seite (WI-0233): der Modus mit Server, Karte und Kamera verbunden, damit `app.vue` nur die Griffe reicht
 * (`app.vue` schmal einhängen). Wie `wegeditor/wegkurve-anbindung.ts` beim Vereinfachen:
 *
 * - **Vorschau** mit der gemeinsamen Schicht des Geometrie-Moduls, ohne Besitzer im Koordinator: Es gibt nichts zu ziehen. Läuft schon ein
 *   Modus des Moduls, beginnt sie nicht (Hinweis aus `besitzer.ts`).
 * - **Maßstab** (Karteneinheiten je Bildpunkt) in der Mitte der Fläche, waagrecht und senkrecht gemittelt.
 * - **Kamera** nur, wenn die Fläche nicht frei zu sehen ist (`zeigeFrei`, Stufe der Suche für Landschaften).
 * - **Tasten:** Enter ist „Fertig“ der Bearbeitung; mit dem Regler in der Hand gehen auch Strg+Z und Strg+Y (sonst nimmt sie die Seite,
 *   `entwurfTasten` in `app.vue`). Esc hängt die Seite in ihre Kaskade.
 * - **Hinweise** unten: gespeichert (mit „vorher → nachher Stützpunkte“), der Umriss kreuzte sich, keine Fläche, Ladefehler.
 * - **Das Fenster trägt die Form** (wie die Wegkurve): Wird das Fenster der Landschaft abgelegt oder geschlossen, endet der Modus und die
 *   Form hängt ab; der Entwurf bleibt (D19, G5). Auf der Stage gefunden (2026-10-19): Esc mit dem Fokus im Fenster legte es ab, der Regler
 *   blieb oben stehen.
 * - **An einer Sprache** (WI-0261 Stufe 2) dieselbe Anbindung: Was den Entwurf trägt, sagt die Quelle des Laufs (`lauf.quelle`,
 *   `map/geometrie/flaechen-quelle.ts`).
 */
export interface VereinfachenSeite {
    /** Karte und Kamera, sobald die Karte bereit ist; vorher startet kein Modus. */
    karte(): { map: MapLibreMap; camera: Pick<Camera, "showBounds"> } | undefined;
    /** Die sichtbaren Ebenen der Karte (in „Landschaften“ die gewählte, sonst alle drei). */
    ebenen(): readonly EditorLandscapeLayer[];
    /** Die Bearbeitung dieser Landschaft; öffnet ihr Fenster (D19). Ohne Schreibrecht keine: Dann beginnt nichts. */
    bearbeitung(regionId: string): LandschaftBearbeitung | undefined;
    /** Steht das Fenster dieser Landschaft sichtbar (angedockt oder gelöst)? Sonst endet der Modus. */
    getragen(regionId: string): boolean;
}

/** Die Kennung des Reglers: Mit ihm in der Hand gelten Enter, Strg+Z und Strg+Y dem Modus. */
export const VEREINFACHEN_REGLER_ID = "flaeche-vereinfachen-staerke";

const space = AVENTURIA.coordinateSpace;

export function vereinfachenHinweis(meldung: VereinfachenMeldung): { text: string; ton?: "success" | "warning" } {
    switch (meldung.art) {
        case "gespeichert":
            return {
                text: t("landschaftseditor.vereinfachen.gespeichert", {
                    name: meldung.name,
                    vorher: String(meldung.vorher),
                    nachher: String(meldung.nachher),
                }),
                ton: "success",
            };
        case "kreuzt":
            return {
                text: t("landschaftseditor.vereinfachen.kreuzt", {
                    staerke: String(meldung.staerke),
                    gilt: String(meldung.gilt),
                }),
                ton: "warning",
            };
        case "ohneFlaeche":
            return { text: t("landschaftseditor.vereinfachen.ohneFlaeche", { name: meldung.name }), ton: "warning" };
        case "ladefehler":
            return { text: t("landschaftseditor.vereinfachen.ladefehler"), ton: "warning" };
    }
}

export function createFlaecheVereinfachenFuerSeite(seite: VereinfachenSeite): FlaecheVereinfachen {
    const vereinfachen = createFlaecheVereinfachen({
        daten: createEckenDaten(),
        ebenen: seite.ebenen,
        bearbeitung: seite.bearbeitung,
        getragen: seite.getragen,
        karte: {
            vorschau(bild) {
                const da = seite.karte();
                if (da === undefined) return undefined;
                const belegung = belegeGeometrie();
                if (belegung === undefined) return undefined;
                const schicht = installGeometrieSchicht(da.map);
                schicht.zeige(bild());
                // Ohne Anfasser gibt es nichts zu sperren und keinen Zug abzubrechen.
                return {
                    aktualisiere: () => schicht.zeige(bild()),
                    markiere: () => undefined,
                    sperre: () => undefined,
                    abbrechen: () => false,
                    aus: () => {
                        schicht.entferne();
                        belegung.frei();
                    },
                };
            },
            massstab(punkte) {
                const map = seite.karte()?.map;
                if (map === undefined || punkte.length === 0) return 1;
                const mitte = {
                    x: punkte.reduce((summe, p) => summe + p.x, 0) / punkte.length,
                    y: punkte.reduce((summe, p) => summe + p.y, 0) / punkte.length,
                };
                const render = toRenderLngLat(space, mitte);
                const at = map.project([render.lng, render.lat]);
                const weite = (dx: number, dy: number): number => {
                    const p = fromRenderLngLat(space, map.unproject([at.x + dx, at.y + dy]));
                    return Math.hypot(p.x - mitte.x, p.y - mitte.y);
                };
                return (weite(1, 0) + weite(0, 1)) / 2;
            },
            zeige(teile) {
                const da = seite.karte();
                if (da !== undefined) zeigeFrei(da.map, da.camera, teile, SEARCH_FIT_MAX_ZOOM.landschaft);
            },
        },
    });
    const stopMeldung = watch(vereinfachen.meldung, (meldung) => {
        if (meldung === undefined) return;
        const { text, ton } = vereinfachenHinweis(meldung);
        showToast(text, ton);
    });
    const stopTraeger = watch(
        () => {
            const lauf = vereinfachen.laufend.value;
            return lauf?.phase !== "bereit" || lauf.quelle.getragen(lauf.id);
        },
        (getragen) => {
            if (!getragen) vereinfachen.beende();
        },
    );
    function taste(event: KeyboardEvent): void {
        const lauf = vereinfachen.laufend.value;
        if (lauf?.phase !== "bereit" || lauf.bearbeitung === undefined) return;
        const ziel = event.target as HTMLElement | null;
        const regler = ziel?.id === VEREINFACHEN_REGLER_ID;
        if (!regler && ziel?.closest?.("input, textarea, select, [contenteditable='true']")) return;
        if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            void lauf.bearbeitung.fertig();
            return;
        }
        // Ohne den Regler in der Hand nimmt die Seite Strg+Z und Strg+Y (`entwurfTasten`).
        if (!regler || !(event.ctrlKey || event.metaKey)) return;
        const k = event.key.toLowerCase();
        if (k !== "z" && k !== "y") return;
        event.preventDefault();
        if (k === "y" || event.shiftKey) vereinfachen.wieder();
        else vereinfachen.zurueck();
    }
    document.addEventListener("keydown", taste);
    return {
        ...vereinfachen,
        destroy() {
            vereinfachen.destroy();
            stopMeldung();
            stopTraeger();
            document.removeEventListener("keydown", taste);
        },
    };
}
