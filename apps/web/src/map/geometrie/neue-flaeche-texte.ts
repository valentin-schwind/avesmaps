import { t } from "../../i18n/i18n";
import { ANLEGEN_ANFANG, type AnlegenZeiger } from "./anlegen";
import type { NeueFlaecheMeldung } from "./neue-flaeche";

/** Die Sätze von „Neue Fläche“ (C3, `neue-flaeche.ts`) für Leiste, Schild und Meldungen; alle Texte aus `neueFlaeche.*`. */

/** Das Schild am Ziel: woran der Klick einrastet und was er dort tut (R9, R12). */
export function neueFlaecheSchild(zeiger: AnlegenZeiger): { name: string; tut: string } {
    const { ziel } = zeiger.treffer;
    if (ziel.objekt === ANLEGEN_ANFANG)
        return { name: t("neueFlaeche.schild.ersteEcke"), tut: t("neueFlaeche.schild.schliessen") };
    const kante = ziel.art === "kante";
    const name =
        ziel.name.trim() === ""
            ? t(kante ? "neueFlaeche.schild.kanteOhneName" : "neueFlaeche.schild.eckeOhneName")
            : t(kante ? "neueFlaeche.schild.kante" : "neueFlaeche.schild.ecke", { name: ziel.name });
    return {
        name,
        tut: t(zeiger.lage === "anfang" ? "neueFlaeche.schild.anfang" : "neueFlaeche.schild.einrasten"),
    };
}

/** Warum „Fertig“ bei der neuen Fläche nicht geht (Ringe kennen nur „zu wenig“). */
export const neueFlaecheGrund = (): string => t("neueFlaeche.grund.zuWenig");

/** Die Meldung nach dem Anlegen, als Hinweis unten. */
export function neueFlaecheMeldungText(meldung: NeueFlaecheMeldung): string {
    switch (meldung.art) {
        case "gespeichert": {
            const satz = t("neueFlaeche.gespeichert", { name: meldung.name });
            return meldung.hinweis === undefined ? satz : `${satz} ${meldung.hinweis}`;
        }
        case "abgelehnt":
            return meldung.satz;
        case "serverfehler":
            return meldung.status === 0
                ? t("neueFlaeche.keineAntwort")
                : t("neueFlaeche.serverfehler", { status: String(meldung.status) });
        case "abgewiesen":
            return neueFlaecheGrund();
        case "verworfen":
            return t("neueFlaeche.verworfen");
    }
}
