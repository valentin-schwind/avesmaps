import { MAM_BASKETS, MEDIA_ASSET_TYPES, type MamBasket, type MamNavigation } from "@avesmaps3d/shared";
import type { SchienenBereich, SchienenEintrag } from "../fenster/fenster-schiene";
import { t } from "../i18n/i18n";
import { korbName, objektName, typMehrzahl, zahl } from "./medien-text";
import { auswahlKennung, type MedienAuswahl } from "./medien-zustand";

/** Die Kartenvorschläge der Redaktion (OPS-000093): nur mit einem der beiden Rechte gesetzt; `zahl` sind die offenen, `undefined` solange sie unbekannt sind. */
export interface SchieneVorschlaege {
    readonly zahl: number | undefined;
}

/**
 * Die Bereiche der Schiene „Medienarten“ (`medien-arten.vue`, dort steht, was jeder Eintrag bedeutet), als reine Abbildung der Navigation des Servers, damit sie
 * ohne Vue-Werkzeug prüfbar ist (`test/medien-vorschlaege.test.ts`).
 */
export function medienArtenBereiche(
    nav: MamNavigation | undefined,
    vorschlaege: SchieneVorschlaege | undefined,
): SchienenBereich[] {
    const ansicht = (auswahl: MedienAuswahl, name: string, anzahl: number | undefined): SchienenEintrag => ({
        id: auswahlKennung(auswahl),
        name,
        art: "ansicht",
        wert: anzahl === undefined ? undefined : zahl(anzahl),
    });
    const korb = (basket: MamBasket): SchienenEintrag =>
        ansicht({ korb: basket }, korbName(basket), nav?.baskets[basket]);
    return [
        {
            id: "assets",
            name: t("medien.arten.assets"),
            eintraege: [
                ansicht({ typ: null }, t("medien.arten.alle"), nav?.total),
                // Die Asset-Typen (Betreiber 2026-10-10: Wappen sind ein eigener Typ).
                ...MEDIA_ASSET_TYPES.map((type) => ansicht({ typ: type }, typMehrzahl(type), nav?.types[type])),
            ],
        },
        {
            id: "objekte",
            name: t("medien.arten.objekte"),
            eintraege: [
                // Typbilder sind gebaut (Betreiber 2026-10-11, Migration 0113): ein echter Eintrag, kein gestrichelter.
                ansicht({ objekt: "typbilder" }, objektName("typbilder"), nav?.typeImages),
                ansicht({ objekt: "galerien" }, objektName("galerien"), nav?.galleries),
                // Die Kartensammlung ist lesbar (WI-0068 R5): ein echter Eintrag; Bearbeiten erst nach der Entscheidung des Betreibers.
                ansicht({ objekt: "kartensammlung" }, objektName("kartensammlung"), nav?.citymaps),
                // Die Reisebilder je Ort (WI-0272): nur lesend, sie entstehen mit der Freigabe.
                ansicht({ objekt: "photobox" }, objektName("photobox"), nav?.photoboxGalerien),
            ],
        },
        {
            id: "eingaenge",
            name: t("medien.arten.eingaenge"),
            eintraege: [
                ansicht({ korb: "photobox_uploads" }, korbName("photobox_uploads"), nav?.einreichungen?.offen),
                ...(vorschlaege === undefined
                    ? []
                    : [ansicht({ objekt: "kartenvorschlaege" }, objektName("kartenvorschlaege"), vorschlaege.zahl)]),
            ],
        },
        {
            id: "pruefen",
            name: t("medien.arten.pruefen"),
            // Der Korb der Einreichungen gehört zu den Eingängen, nicht zu den Prüfkörben der Rechte und Dateien.
            eintraege: MAM_BASKETS.filter((basket) => basket !== "photobox_uploads").map(korb),
        },
    ];
}
