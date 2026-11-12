import { PHOTOBOX_GALERIE_OHNE_ORT, type PhotoboxGalerien } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { zahl } from "./medien-text";

/**
 * Was die Liste der PhotoBox-Galerien rechnet (WI-0272). Reine Funktionen, wie bei den Galerien.
 *
 * Eine PhotoBox-Galerie heißt wie ihr Ort; die Bilder an freien Stellen stehen zusammen unter „Freie Stellen“ (OPS-000095).
 */
type PhotoboxGalerie = PhotoboxGalerien["items"][number];

export function photoboxKennung(galerie: Pick<PhotoboxGalerie, "ort">): string {
    return galerie.ort?.id ?? PHOTOBOX_GALERIE_OHNE_ORT;
}

export function photoboxName(galerie: Pick<PhotoboxGalerie, "ort">): string {
    return galerie.ort?.name ?? t("medien.photobox.ohneOrt");
}

export function photoboxUnterzeile(galerie: Pick<PhotoboxGalerie, "ort" | "bilder">): string {
    const bilder = t(galerie.bilder === 1 ? "medien.galerien.einBild" : "medien.galerien.bilder", {
        n: zahl(galerie.bilder),
    });
    return galerie.ort === null ? t("medien.photobox.unterOhneOrt", { bilder }) : bilder;
}

/** Der Titel von Spalte 3: nach dem Ort, wenn die Liste ihn kennt; eine Suche kann ihn gerade ausblenden. */
export function photoboxTitel(kennung: string | undefined, galerie: PhotoboxGalerie | undefined): string {
    if (kennung === PHOTOBOX_GALERIE_OHNE_ORT) return t("medien.photobox.titelOhneOrt");
    return galerie?.ort == null ? t("medien.objekt.photobox") : t("medien.photobox.titel", { ort: galerie.ort.name });
}
