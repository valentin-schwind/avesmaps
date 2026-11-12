import { h, nextTick, render, watch } from "vue";
import type { GeoJSONSource, GeoJSONSourceSpecification, Map as MapLibreMap } from "maplibre-gl";
import {
    kartenAnzeige,
    kartenWunsch,
    schliesseKarte,
    setzeKartenAnzeige,
    type KartenWunsch,
} from "../aenderungen/karte-ablage";
import { flugOptionen } from "../aenderungen/aenderung-lage-modell";
import { HINWEIS_RAND } from "../controls/kamera-hinweis-platz";
import { t } from "../i18n/i18n";
import type { EscapeCascade } from "../keyboard/escape-cascade";
import type { Camera, CameraPadding } from "./camera/camera";
import { fillZoom, leavesGap, mergeInsets, visibleRect, type VisibleArea } from "./camera/visible-area";
import AenderungenOverlayLeiste from "./aenderungen-overlay-leiste.vue";
import {
    OVERLAY_EBENEN_LISTE,
    OVERLAY_QUELLE,
    ebenenSichtbar,
    overlayDaten,
    overlayEbenen,
    overlayGrenzen,
    type OverlayDaten,
} from "./aenderungen-overlay-formen";
import { nachStilwechsel, styleTakesChanges, whenStyleTakesChanges } from "./style-ready";

/**
 * Vorher und Nachher einer Änderung auf der Karte (WI-0265 B5b; Probierseite `review/wi-0265/aenderungen.html`, Szenen 2 und 4): eine
 * **nicht-interaktive Überlagerung** in einer eigenen GeoJSON-Quelle mit eigenen Ebenen (`aenderungen-overlay-formen.ts`), dazu die Leiste mit dem Schalter
 * Beide | Vorher | Nachher und der Legende (`aenderungen-overlay-leiste.vue`).
 *
 * - **Was gezeigt wird, kommt aus der Ablage** (`aenderungen/karte-ablage.ts`): das Detail einer Änderung oder einer Serie legt sein Bild dort ab, und
 *   diese Stelle zeichnet es. Sie rechnet nichts am Protokoll; die Lage kommt als Kartenkoordinaten (`aventuria-v1`) und wird mit der einen Projektion
 *   des Hauses umgerechnet (`toRenderLngLat`, ADR-0003).
 * - 🔴 **Die Kamera fliegt über `camera.ts`** (`showBounds`: in die freie Fläche neben Panel und Fenster, nie ein Sprung) und höchstens so nah wie auf einen Weg; auf einen Punkt (ein Ort) so nah wie auf einen Ort (`flugOptionen`).
 *   **Nie so weit hinaus, dass ein Kartenrand ins Bild kommt** (WI-0265 B9b/B9c): Der untere Deckel ist die Stufe, bei der das Kartenbild die freie Fläche gerade noch ganz füllt (`fuellstufe`, `fillZoom`). Jeder Kasten, der bei ihr ins Bild passt,
 *   wird ganz gezeigt, auch am Telefon; erst ein Kasten, der größer ist als das füllende Kartenbild, wird angeschnitten und liegt mit seiner Mitte im Bild (der Kartenzaun hält die Mitte).
 *   Das Fenster, in dem das Detail steht,
 *   nennt die Seite über `frei` (das vorderste sichtbare Editorfenster, wie jeder Hinflug aus einem Editor): Ohne das landete die Mitte der Änderung in der Mitte der ganzen Karte, halb unter dem angedockten Fenster
 *   (WI-0265 B6d, am Ort gemessen: 1920 px, Fenster ab 960 px, das Nachher bei 1152 px).
 * - **Klicks gehen durch.** Kein Handler im Interaktions-Koordinator, keine Treffer: Die Quelle trägt keine Kacheln, und die Leiste fängt nur auf ihrer eigenen Fläche.
 * - **Esc und das Schließen des Details entfernen sie** (Esc über die Kaskade, Stufe `action`; das Detail räumt seinen Wunsch beim Schließen selbst ab).
 * - **Am Telefon** blendet das Panel sich weg, damit die Karte frei ist (der Wunsch kommt vom Aufrufer, `panel.zu`), und die Leiste trägt den Rückweg.
 * - **Der heutige Ort (B9):** Hat das Bild `heute` (eine Änderung ohne Lage im Protokoll), zeichnet dieselbe Quelle ihn mit den untersten Ebenen, dezent; die Leiste zeigt statt des Schalters Beide | Vorher | Nachher
 *   nur, dass dies der heutige Ort ist, und wenn ein Gegenstand nicht mehr auf der Karte liegt, den Satz dazu. Dieselbe Anbindung, dieselbe Kamera, dasselbe Entfernen: kein zweiter Mechanismus.
 * - Ein Stilwechsel nimmt Quelle und Ebenen mit; sie kommen im nächsten Bild wieder (`nachStilwechsel`), wie bei den anderen eigenen Ebenen.
 */

export interface AenderungenKarteUmfeld {
    /** Die Kamera der Seite (sie entsteht nach der Karte); ohne sie bleibt der Flug aus. */
    readonly camera: () => Pick<Camera, "showBounds"> | undefined;
    /** Die freie Fläche: Die Leiste steht oben links darin und folgt ihr. */
    readonly area: Pick<VisibleArea, "keepFree" | "onChange" | "onCovered"> | undefined;
    readonly escape: Pick<EscapeCascade, "register">;
    readonly phone: () => boolean;
    /** Das Editorpanel weg- und wieder einblenden (nur am Telefon gerufen). */
    readonly panel: { readonly zu: () => void; readonly auf: () => void };
    /**
     * Was ein Editorfenster nach der Landung zusätzlich deckt (`free` der Kamera, wie jeder Hinflug aus einem Editor, `editor-panel/hinflug.ts`): Das Detail steht meist in einem angedockten
     * Fenster, und was unter ihm läge, sähe man nicht. Ohne Angabe deckt nur, was die Panels der Karte melden.
     */
    readonly frei?: (() => Partial<CameraPadding>) | undefined;
}

export interface AenderungenKarte {
    destroy(): void;
}

export function installAenderungenKarte(map: MapLibreMap, umfeld: AenderungenKarteUmfeld): AenderungenKarte {
    const element = document.createElement("div");
    element.className = "aenderungen-karte-leiste";
    element.style.position = "absolute";
    element.style.zIndex = "var(--z-map-ui)";
    // Die Lasche des Routenplaners (`--avesmaps-tab-w`) steht links neben der freien Fläche und ragt in sie hinein: Die Leiste rückt daran vorbei.
    element.style.maxWidth = `calc(100% - var(--avesmaps-tab-w) - ${String(2 * HINWEIS_RAND)}px)`;
    // Die Hülle ist so groß wie die Leiste und fängt selbst nichts; die Leiste fängt auf ihrer Fläche (`pointer-events: auto`).
    element.style.pointerEvents = "none";

    let daten: OverlayDaten | undefined;
    let wunsch: KartenWunsch | undefined;
    const ebenen = overlayEbenen();

    const setzeSichtbarkeit = (): void => {
        for (const [id, sichtbar] of ebenenSichtbar(kartenAnzeige.value))
            if (map.getLayer(id) !== undefined) map.setLayoutProperty(id, "visibility", sichtbar ? "visible" : "none");
    };

    /** Quelle und Ebenen anlegen, wo sie fehlen (ein Stilwechsel nimmt sie mit), und die Daten setzen. */
    const lege = (): void => {
        if (daten === undefined || !styleTakesChanges(map)) return;
        const quelle = map.getSource(OVERLAY_QUELLE) as GeoJSONSource | undefined;
        // Das GeoJSON-Format ist dasselbe; `OverlayDaten` führt nur die Merkmale, die diese Überlagerung baut (und `readonly`).
        const inhalt = daten as unknown as GeoJSONSourceSpecification["data"];
        if (quelle === undefined) map.addSource(OVERLAY_QUELLE, { type: "geojson", data: inhalt });
        else quelle.setData(inhalt as Parameters<GeoJSONSource["setData"]>[0]);
        for (const ebene of ebenen) if (map.getLayer(ebene.id) === undefined) map.addLayer(ebene);
        setzeSichtbarkeit();
    };

    const nimmWeg = (): void => {
        if (!styleTakesChanges(map)) return;
        for (const id of OVERLAY_EBENEN_LISTE) if (map.getLayer(id) !== undefined) map.removeLayer(id);
        if (map.getSource(OVERLAY_QUELLE) !== undefined) map.removeSource(OVERLAY_QUELLE);
    };

    // --- Die Leiste ---------------------------------------------------------------------------------------------------

    const setzeLage = (): void => {
        const frei = umfeld.area?.keepFree();
        element.style.left = `calc(${String(frei?.left ?? 0)}px + var(--avesmaps-tab-w) + ${String(HINWEIS_RAND)}px)`;
        element.style.top = `${String((frei?.top ?? 0) + HINWEIS_RAND)}px`;
    };

    const zeichneLeiste = (): void => {
        if (wunsch === undefined) return;
        if (element.parentElement === null) map.getContainer().appendChild(element);
        setzeLage();
        render(
            h(AenderungenOverlayLeiste, {
                anzeige: kartenAnzeige.value,
                hinweise: wunsch.bild.hinweise,
                heute: wunsch.bild.heute,
                rueckweg: wunsch.rueckweg,
                telefon: umfeld.phone(),
                onAnzeige: setzeKartenAnzeige,
                onSchliessen: schliesseKarte,
                onZumDetail: () => {
                    schliesseKarte();
                    umfeld.panel.auf();
                },
            }),
            element,
        );
    };

    const raeumeLeiste = (): void => {
        render(null, element);
        element.remove();
    };

    // --- Zeigen und Entfernen -------------------------------------------------------------------------------------------

    /**
     * Die Stufe, bei der das Kartenbild (der Zaun der Karte, `maxBounds`) die freie Fläche gerade noch ganz füllt (`fillZoom`): darunter erschiene der Kartenrand im Bild. Die freie Fläche ist die, in die die
     * Kamera einpasst (`showBounds`: `keepFree()`, mit dem Fenster `frei` dazu, wo dann noch eine Lücke bleibt). `undefined`, wo es sie nicht gibt (keine Karte mit Zaun, keine Fläche).
     */
    const fuellstufe = (frei: Partial<CameraPadding> | undefined): number | undefined => {
        const zaun = map.getMaxBounds();
        if (zaun === null) return undefined;
        const leinwand = map.getCanvas();
        const groesse = { width: leinwand.clientWidth, height: leinwand.clientHeight };
        const gedeckt = umfeld.area?.keepFree() ?? {};
        const danach = frei === undefined ? undefined : mergeInsets(gedeckt, frei);
        const flaeche = visibleRect(groesse, danach !== undefined && leavesGap(groesse, danach) ? danach : gedeckt);
        const stufe = fillZoom(
            { west: zaun.getWest(), south: zaun.getSouth(), east: zaun.getEast(), north: zaun.getNorth() },
            flaeche,
        );
        return Number.isFinite(stufe) ? stufe : undefined;
    };

    const fliege = async (neu: KartenWunsch): Promise<void> => {
        const grenzen = overlayGrenzen(neu.bild);
        if (grenzen === undefined) return;
        // Am Telefon liegt das Panel bis hierher noch davor: Die Fläche der Kamera wird erst frei, wenn Vue es weggeblendet hat.
        if (umfeld.phone()) {
            umfeld.panel.zu();
            await nextTick();
        }
        if (wunsch !== neu) return;
        const frei = umfeld.frei?.();
        void umfeld.camera()?.showBounds(grenzen, {
            ...flugOptionen(neu.bild.grenzen, fuellstufe(frei)),
            ...(frei === undefined ? {} : { free: frei }),
        });
    };

    const zeige = (neu: KartenWunsch): void => {
        wunsch = neu;
        daten = overlayDaten(neu.bild, {
            vorher: t("aenderungen.karte.zeichen.vorher"),
            nachher: t("aenderungen.karte.zeichen.nachher"),
        });
        whenStyleTakesChanges(map, lege);
        zeichneLeiste();
        void fliege(neu);
    };

    const entferne = (): void => {
        if (wunsch === undefined) return;
        wunsch = undefined;
        daten = undefined;
        nimmWeg();
        raeumeLeiste();
    };

    const stopWunsch = watch(
        kartenWunsch,
        (neu) => {
            if (neu === undefined) entferne();
            else zeige(neu);
        },
        { flush: "sync" },
    );
    const stopAnzeige = watch(
        kartenAnzeige,
        () => {
            setzeSichtbarkeit();
            zeichneLeiste();
        },
        { flush: "sync" },
    );

    const stopStil = nachStilwechsel(map, lege);
    const stopLage = [umfeld.area?.onChange(setzeLage), umfeld.area?.onCovered(setzeLage)];
    map.on("resize", setzeLage);
    // Esc nimmt die Überlagerung weg, bevor es die Auswahl der Karte aufhebt (Stufe `action`, nach den Modi der Editoren).
    const stopEscape = umfeld.escape.register("action", () => {
        if (wunsch === undefined) return false;
        schliesseKarte();
        return true;
    });

    const destroy = (): void => {
        stopWunsch();
        stopAnzeige();
        stopStil();
        for (const stop of stopLage) stop?.();
        map.off("resize", setzeLage);
        stopEscape();
        entferne();
        raeumeLeiste();
    };
    map.once("remove", destroy);
    return { destroy };
}
