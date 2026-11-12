import type { ExpressionSpecification, Map as MapLibreMap } from "maplibre-gl";
import { computed, watch, type ComputedRef } from "vue";
import { politicalMinZoom } from "@avesmaps3d/shared";
import type { GebietLage } from "../editor-menu/handgriffe-gebiet";
import { modusGrund } from "../editor-menu/handgriffe-ort";
import type { EditorSperre } from "../editor-sperre/sperre";
import { locale, t } from "../i18n/i18n";
import { formHinweis } from "../map/geometrie/formentwurf-texte";
import { territoryBandLead } from "../map/territory-band";
import { TERRITORY_FILL_LAYER_ID } from "../map/territory-layers";
import {
    createZoombaender,
    createZoombandDaten,
    type DarstellungStand,
    type Zoombaender,
    type ZoombandMeldung,
} from "./zoombaender";

/**
 * „Farben und Zoombänder“ für die Seite (WI-0209 D2, D4): der Modus mit Server und Sperre verbunden, dazu warum der Reiter gerade nicht
 * ändern lässt, damit `app.vue` nur einhängt. Wie `gebietsform-anbindung.ts`.
 *
 * Die Farben im Entwurf zeigt die Karte gleich (D4; Probierblatt: „Baum und Karte zeigen es gleich“): Solange der Entwurf Farben ändert,
 * füllt die Gebietsebene diese Gebiete mit ihrer neuen Farbe (`farbAusdruck`), sonst wieder mit der aus der Kachel. Die Schraffur
 * umstrittener Gebiete folgt erst nach „Fertig“ (ihre Muster stehen in der Kachel).
 */
export interface ZoombaenderSeite {
    /** Die EINE Sperre der Seite (EDIT-0003 §4), geteilt von allen Editoren. */
    sperre: EditorSperre;
    /** Rechte, Stand des Bearbeitens und ob ein anderer Modus läuft, wie bei den Handgriffen am Gebiet. */
    lage(): GebietLage;
    /** Geschrieben: die Kachelrevision an die Karte (`editRevision` in `app.vue`). */
    geaendert(revision: number | undefined): void;
    /** Geschrieben: Liste, Detail und Reiter neu lesen. */
    gespeichert(): void;
    /** Die Karte, sobald sie bereit ist: Sie zeigt die Farben im Entwurf. */
    karte?(): MapLibreMap | undefined;
}

export interface ZoombaenderFuerSeite extends Zoombaender {
    /** Warum der Reiter die Spannen gerade nicht ändern lässt, als Satz; leer ohne Recht (still lesend); fehlend: es geht. */
    readonly grund: ComputedRef<string | undefined>;
}

export function createZoombaenderFuerSeite(seite: ZoombaenderSeite): ZoombaenderFuerSeite {
    const baender = createZoombaender({
        daten: createZoombandDaten(),
        sperre: seite.sperre,
        geaendert: seite.geaendert,
        gespeichert: seite.gespeichert,
        anderswo: (name) => t("gebietseditor.farben.anderswo", { name }),
    });
    const grund = computed(() => {
        const lage = seite.lage();
        // Ohne Recht bleibt der Reiter still lesend, ohne Satz (wie „Ansehen“ ohne Schreibrecht).
        if (!lage.rechte.includes("edit_territories")) return "";
        const modus = modusGrund(lage.bearbeiten);
        const warum =
            modus !== undefined
                ? t(modus)
                : lage.laeuft && baender.laufend.value === undefined
                  ? t("ortseditor.handgriff.grund.laeuft")
                  : undefined;
        return warum === undefined ? undefined : t("gebietseditor.baender.aus", { grund: warum });
    });
    if (seite.karte !== undefined) {
        const karte = seite.karte;
        watch(baender.stand, (stand) => {
            const map = karte();
            if (map?.getLayer(TERRITORY_FILL_LAYER_ID) !== undefined)
                map.setPaintProperty(TERRITORY_FILL_LAYER_ID, "fill-color", farbAusdruck(stand));
        });
    }
    return { ...baender, grund };
}

/** Die Füllfarbe der Gebietsebene mit den Farben im Entwurf: je geändertem Gebiet seine neue, sonst die aus der Kachel. */
export function farbAusdruck(stand: DarstellungStand): ExpressionSpecification {
    const paare = [...stand].flatMap(([id, d]) => (d.farbe === undefined ? [] : [id, d.farbe]));
    if (paare.length === 0) return ["get", "color"];
    return ["match", ["get", "territory_public_id"], ...paare, ["get", "color"]] as unknown as ExpressionSpecification;
}

/** Der Satz zu einer Meldung des Modus als Hinweis am Rand; was der Formentwurf schon sagt, sagt er. */
export function zoombandHinweis(meldung: ZoombandMeldung): { text: string; ton: "warning" | "success" | undefined } {
    if (meldung.art === "gespeichert") {
        const namen = new Intl.ListFormat(locale.value, { type: "conjunction" }).format(meldung.namen);
        // Mit einer Spanne folgt die Karte nach der Ableitung; Farben zeigt sie gleich.
        const satz = meldung.spannen ? "gebietseditor.baender.gespeichert" : "gebietseditor.farben.gespeichert";
        return { text: t(satz, { namen }), ton: "success" };
    }
    return formHinweis(meldung, { ladefehler: "gebietseditor.form.ladefehler" });
}

/** Der Kamerazoom, bei dem die Karte dieses Band zeigt: die Mitte seiner Spanne (Klick auf eine Bandspalte). */
export function zoomFuerBand(band: number, lead: number = territoryBandLead()): number {
    return band <= 0 ? politicalMinZoom(1, lead) - 0.5 : politicalMinZoom(band, lead) + 0.5;
}
