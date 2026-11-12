import { PHOTOBOX_LIMITS, type PhotoboxSubmissionState } from "@avesmaps3d/shared";
import { ApiFailure } from "../auth/api";
import { formatNumber, t } from "../i18n/i18n";
import { ablehnungsCode, genauerGrund, textAus, zahlAus, type Abbildung, type GrundSatz } from "../system/ablehnung";
import { DATEI_GRUENDE } from "../system/datei-ablehnung";
import { ZUSTAND_TEXT } from "./status-modell";

/**
 * Die Sätze zu den Ablehnungen der Reisebilder (WI-0291, Inventar Nr. 9, 10 und 16): Vali 2026-11-08: „ich will genau fehlermeldungen und wissen, was ich zu tun habe“.
 * Der Server schickt in `details.reason` einen Fachcode (`photobox/db.ts`, `ungueltig`, `uebergangFehlt`); das Fenster bildet ihn auf einen Satz ab, der den Grund nennt und
 * sagt, was zu tun ist. Zwei Abbildungen, weil die Person eine andere ist: der Besucher am Formular und an der Statusseite, die Redaktion in der Medienverwaltung.
 * Die Dateigründe (`media_file_rejected`) kommen aus `DATEI_GRUENDE`.
 */

/** Der Zustand des Reisebilds in den Worten der Statusseite („Zurückgezogen“), oder `undefined`, wenn der Server keinen oder einen unbekannten nennt. */
function zustandWort(details: Readonly<Record<string, unknown>>): string | undefined {
    const zustand = textAus(details, "zustand");
    if (zustand === undefined || !(zustand in ZUSTAND_TEXT)) return undefined;
    return t(ZUSTAND_TEXT[zustand as PhotoboxSubmissionState]);
}

/** Die Datei ist zu groß (413 `payload_too_large`, `details.limitBytes`): die Grenze in MB, wie der Server sie nennt (Rückfall: 6 MB der Reisebilder). */
const zuGross: GrundSatz = (details) =>
    t("photobox.ablehnung.zuGross", {
        mb: formatNumber((zahlAus(details, "limitBytes") ?? 6 * 1024 * 1024) / 1024 / 1024, 0),
    });

/** Der Schlüssel `reason` der Datei: Die Sätze der Dateigründe gelten für Reisebilder wie für jedes Formular mit Bild. */
const DATEI: Readonly<Record<string, GrundSatz>> = DATEI_GRUENDE;

/** Die Sätze für den Besucher: das Formular „Eigenes Bild hinzufügen“ und die Statusseite. */
export const BESUCHER_ABBILDUNG: Abbildung = {
    gruende: {
        ...DATEI,
        too_large_bytes: zuGross,
        unsupported_format: () => t("photobox.ablehnung.format"),
        cc_by_avesmaps: () => t("photobox.ablehnung.ccByAvesmaps"),
        stelle_ausserhalb: () => t("photobox.ablehnung.stelleAusserhalb"),
        ort_unbekannt: () => t("photobox.ablehnung.ortUnbekannt"),
        feld_leer: (details) => {
            switch (textAus(details, "feld")) {
                case "beschreibung":
                    return t("photobox.ablehnung.beschreibungLeer");
                case "name":
                    return t("photobox.ablehnung.nameLeer");
                default:
                    return undefined;
            }
        },
        angaben_passen_nicht: () => t("photobox.ablehnung.angabenPassenNicht"),
        ersetzungen_erschoepft: (details) =>
            t("photobox.ablehnung.ersetzungenErschoepft", {
                n: formatNumber(zahlAus(details, "hoechstens") ?? 5, 0),
            }),
        schluessel_belegt: () => t("photobox.ablehnung.schluesselBelegt"),
        // Der Betreiber hat das Bild endgültig gelöscht (WI-0272): Eine Seite von vorher bietet noch Knöpfe an, der Server nimmt nichts mehr an.
        bild_entfernt: () => t("photobox.status.text.entfernt"),
        uebergang: (details) => {
            const zustand = zustandWort(details);
            return zustand === undefined
                ? t("photobox.ablehnung.uebergangOhne")
                : t("photobox.ablehnung.uebergang", { zustand });
        },
    },
    felder: {
        beschreibung: (regel) =>
            regel === "maxLength"
                ? t("photobox.ablehnung.beschreibungLang", { max: PHOTOBOX_LIMITS.descriptionMax })
                : t("photobox.ablehnung.beschreibungLeer"),
        name: (regel) =>
            regel === "maxLength"
                ? t("photobox.ablehnung.nameLang", { max: PHOTOBOX_LIMITS.attributionMax })
                : t("photobox.ablehnung.nameLeer"),
        x: () => t("photobox.ablehnung.stelleFalsch"),
        y: () => t("photobox.ablehnung.stelleFalsch"),
        entstehung: () => t("photobox.ablehnung.entstehungFehlt"),
        nutzung: () => t("photobox.ablehnung.nutzungFehlt"),
        // Eine leere Datei meldet der Server als fehlendes Feld `bild` (`decodeBase64`, 400).
        bild: (regel) => (regel === "required" ? DATEI_GRUENDE["empty_file"]?.({}) : undefined),
    },
};

/** Die Sätze für die Redaktion in der Medienverwaltung (Bearbeiten, Rückfrage, Ablehnen einer Einreichung). */
export const REDAKTION_ABBILDUNG: Abbildung = {
    gruende: {
        stelle_ausserhalb: () => t("medien.ablehnung.stelleAusserhalb"),
        ort_unbekannt: () => t("medien.ablehnung.ortUnbekannt"),
        feld_leer: (details) => {
            switch (textAus(details, "feld")) {
                case "beschreibung":
                    return t("medien.ablehnung.leerBeschreibung");
                case "nachricht":
                    return t("medien.ablehnung.leerNachricht");
                case "grund":
                    return t("medien.ablehnung.leerGrund");
                default:
                    return undefined;
            }
        },
        nichts_zu_korrigieren: () => t("medien.ablehnung.nichtsZuKorrigieren"),
        nichts_wartet: () => t("medien.ablehnung.nichtsWartet"),
        technik_nicht_fertig: () => t("medien.ablehnung.technikNichtFertig"),
        uebergang: (details) => {
            const zustand = zustandWort(details);
            return zustand === undefined
                ? t("medien.op.photoboxUebergang")
                : t("medien.ablehnung.uebergang", { zustand });
        },
    },
    felder: {
        beschreibung: (regel) =>
            regel === "maxLength"
                ? t("medien.ablehnung.beschreibungLang", { max: PHOTOBOX_LIMITS.descriptionMax })
                : t("medien.ablehnung.leerBeschreibung"),
    },
};

/**
 * Der genaue Satz der Redaktion zu einem Fehler, aber NUR wenn die Abbildung den Fachcode kennt: Sonst bliebe vom Satz des Servers nur das Deutsche übrig, und die
 * Medienverwaltung hat für Reisebilder ihre eigenen Rückfälle (`FACHCODE`).
 */
export function redaktionGrund(fehler: ApiFailure): string | undefined {
    const code = ablehnungsCode(fehler);
    if (code === undefined || REDAKTION_ABBILDUNG.gruende?.[code] === undefined) return undefined;
    return genauerGrund(fehler, REDAKTION_ABBILDUNG);
}
