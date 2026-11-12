import {
    isCalendarMonth,
    isDepartureMonth,
    isLodgingLevel,
    NAMELESS_MONTH,
    type Karteneinstellung,
    type KartenWert,
    type KurvenPunkt,
} from "@avesmaps3d/shared";
import { formatDecimal, t } from "../i18n/i18n";
import { kartenserienKatalog } from "../map/kartenserien-stand";
import { label } from "./verwaltung-text";
import { airProfileLabel, type AirChoiceId } from "../route-planner/air-profiles";
import { formatDate, lodgingLabel, monthName, monthOption, transportLabel } from "../route-planner/planner-model";

/**
 * Wie die Karteneinstellungen ihre Werte nennen (WI-0166). 🔴 **Dieselben Wörter wie dort, wo der Wert wirkt:** Ein
 * Transportmittel heißt im Reiter so wie im Routenplaner, ein Monat so wie im Feld „Reisebeginn“. Hier liegt keine zweite
 * Wortliste, nur die Zuordnung Einstellung → Beschriftung des Planers.
 */

/** Eine Zahl, wie sie im Feld und in den Sätzen steht: in der Sprache der Seite, ohne Nullen am Ende. */
export const zahl = (wert: number, stellen: number): string => formatDecimal(wert, stellen);

/** Der Name einer Wahl, wie der Planer sie zeigt; eine unbekannte Wahl bleibt, wie sie ist (erfunden wird nichts). */
export function optionText(einstellung: Karteneinstellung, wert: string): string {
    switch (einstellung.id) {
        case "planerReiseart":
            return wert === "air" ? t("planner.mode.air") : t("planner.mode.surface");
        case "planerFlugmittel":
            return airProfileLabel(wert as Exclude<AirChoiceId, "custom">);
        case "planerLandTransport":
        case "planerFlussTransport":
        case "planerMeerTransport":
            return transportLabel(wert);
        case "planerRoutenwahl":
            return wert === "shortest" ? t("planner.route.shortest") : t("planner.route.fastest");
        case "planerUnterbringung":
            return isLodgingLevel(wert) ? lodgingLabel(wert) : wert;
        // Der PDF Exporter (WI-0306): dieselben Wörter wie im Dialog „Reise als PDF“.
        case "pdfKartenbild":
            return label("reisePdf.karte.modus", wert);
        case "pdfKarte":
            return pdfKarteText(wert);
        case "pdfEtappenArt":
            return label("reisePdf.etappen", wert);
        case "pdfFormat":
            return label("reisePdf.format", wert);
        case "pdfLage":
            return label("reisePdf.lage", wert);
        case "pdfPapier":
            return label("reisePdf.papier", wert);
        case "pdfSprache":
            return wert === "seite" ? t("admin.karteneinstellungen.pdf.sprache.seite") : label("lang.name", wert);
        default:
            return wert;
    }
}

/** Die Karte des PDFs: „Was die Karte gerade zeigt“, eine Serie mit ihrem Namen im Fächer, „Politisch“, „Derographie, Vegetation“. */
function pdfKarteText(wert: string): string {
    if (wert === "aktuell") return t("admin.karteneinstellungen.pdf.karte.aktuell");
    if (wert === "politisch") return t("view.political");
    if (wert.startsWith("serie:")) {
        const id = wert.slice("serie:".length);
        return kartenserienKatalog().series.find((serie) => serie.id === id)?.label ?? id;
    }
    const ebene = wert.slice("dero:".length);
    return `${t("view.landscapes")}, ${ebene === "hoehenstufen" ? t("topography.hoehenstufen") : label("layer", ebene)}`;
}

/**
 * Die Wahl eines Monats im Feld „Reisebeginn“: „Unbestimmt“ oder „Firun (Winter)“. Die Kurzform des Planers, weil das Feld
 * neben dem Tag nur halb so breit ist; im Satz „statt …“ steht die lange Form (`wertText`).
 */
export function monatText(monat: string): string {
    if (monat === "unbestimmt") return t("planner.travelStart.noneShort");
    return isDepartureMonth(monat) ? monthOption(monat) : monat;
}

/** Ein Wert als Text, für „statt …“, das Rücksetzzeichen und die Leiste. */
export function wertText(einstellung: Karteneinstellung, wert: KartenWert): string {
    switch (einstellung.art) {
        case "zahl":
            return typeof wert === "number" ? zahl(wert, einstellung.stellen) : String(wert);
        case "punkt": {
            if (typeof wert !== "object" || !("x" in wert)) return String(wert);
            return t("admin.karteneinstellungen.point", {
                x: zahl(wert.x, einstellung.stellen),
                y: zahl(wert.y, einstellung.stellen),
            });
        }
        case "auswahl":
            return optionText(einstellung, String(wert));
        case "schalter":
            return wert === true ? t("admin.karteneinstellungen.on") : t("admin.karteneinstellungen.off");
        case "farbe":
            return String(wert);
        case "text":
            return wert === "" ? t("admin.karteneinstellungen.leer") : String(wert);
        case "reisebeginn": {
            if (typeof wert !== "object" || !("monat" in wert)) return t("planner.travelStart.none");
            if (wert.monat === NAMELESS_MONTH) return formatDate({ month: "", day: wert.tag, nameless: true });
            return isCalendarMonth(wert.monat) ? `${String(wert.tag)}. ${monthName(wert.monat)}` : wert.monat;
        }
        case "kurve":
            // Die Punkte der Kurve, mit dem Zoom, wie die Karte ihn anzeigt (eine Stufe unter MapLibre).
            return Array.isArray(wert)
                ? (wert as readonly KurvenPunkt[])
                      .map((p) =>
                          t("admin.karteneinstellungen.curve.point", {
                              zoom: zahl(p.zoom - 1, 1),
                              neigung: zahl(p.neigung, 0),
                          }),
                      )
                      .join(" · ")
                : String(wert);
    }
}
