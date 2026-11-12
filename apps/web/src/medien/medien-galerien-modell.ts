import type { MamGallerySummary, MediaGalleryDetail, MediaGalleryDeleteHindernis } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { galerieHerkunft, zahl } from "./medien-text";

/**
 * Was die Galerieliste und der Galerie-Inspector rechnen (WI-0068 P6). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Eine Galerie hat fast nie einen Titel.** Im Bestand trägt keine der 82 einen (`title IS NULL`); sie heißen nach ihrem Ort,
 * und Legacy hat sie so angelegt. Der Name der Oberfläche kommt deshalb aus den gebundenen Orten, und erst wenn es auch die nicht
 * gibt, steht da „Galerie ohne Titel“ — nie eine nackte Kennung.
 */

/** Der Name, unter dem eine Galerie in der Liste steht: ihr Titel, sonst ihre Orte, sonst der Platzhalter. */
export function galerieName(galerie: Pick<MamGallerySummary, "title" | "places">): string {
    const titel = galerie.title?.trim();
    if (titel !== undefined && titel !== "") return titel;
    if (galerie.places.length > 0) return galerie.places.map((ort) => ort.name).join(" · ");
    return t("medien.galerie.ohneTitel");
}

/**
 * Die zweite Zeile: wie viele Bilder, wo sie hängt, und woher sie kommt. Ein Entwurf sagt zuerst, dass ihn niemand sieht — das ist
 * die Aussage, die zählt, nicht die Zahl der Orte.
 */
export function galerieUnterzeile(galerie: MamGallerySummary): string {
    const bilder = t(galerie.items === 1 ? "medien.galerien.einBild" : "medien.galerien.bilder", {
        n: zahl(galerie.items),
    });
    const herkunft = galerieHerkunft(galerie.origin);
    if (galerie.draft) return t("medien.galerien.unterEntwurf", { bilder, herkunft });
    const orte =
        galerie.places.length === 1
            ? t("medien.galerien.einOrt")
            : t("medien.galerien.orte", { n: zahl(galerie.places.length) });
    return t("medien.galerien.unter", { bilder, orte, herkunft });
}

/**
 * Die Einträge einer Galerie in der Reihenfolge, in der die Oberfläche sie zeigt: aktive in ihrer Folge, zurückgezogene am Ende.
 *
 * 🪤 Der Server liefert zurückgezogene Einträge AN IHRER STELLE (so steht es im Vertrag), weil die Folge sonst Lücken hätte. Für
 * die Anzeige gehören sie trotzdem nach hinten: Sie sind Verlauf, kein Teil der Galerie.
 */
export function galerieEintraege(galerie: MediaGalleryDetail | undefined): {
    aktiv: MediaGalleryDetail["items"];
    zurueckgezogen: MediaGalleryDetail["items"];
} {
    const items = galerie?.items ?? [];
    return {
        aktiv: items.filter((eintrag) => !eintrag.retired),
        zurueckgezogen: items.filter((eintrag) => eintrag.retired),
    };
}

/**
 * Welches Bild das Titelbild der Galerie ist: das gesetzte Cover, sonst der erste aktive Eintrag (Vorgabe der Oberfläche, so
 * steht es im Vertrag). `undefined`, wenn die Galerie leer ist.
 */
export function galerieCover(galerie: MediaGalleryDetail | undefined): string | undefined {
    if (galerie === undefined) return undefined;
    const { aktiv } = galerieEintraege(galerie);
    if (galerie.coverAssetId !== null && aktiv.some((eintrag) => eintrag.asset.id === galerie.coverAssetId)) {
        return galerie.coverAssetId;
    }
    return aktiv[0]?.asset.id;
}

/** Die aktiven Ortsbindungen einer Galerie; die zurückgezogenen sind Verlauf und stehen nicht in der Liste der Orte. */
export function galerieOrte(galerie: MediaGalleryDetail | undefined): MediaGalleryDetail["bindings"] {
    return (galerie?.bindings ?? []).filter((bindung) => !bindung.retired);
}

/** Ist die Galerie ein Entwurf? Ohne aktive Ortsbindung ja — und dann sieht ein Besucher ihre Bilder nicht. */
export function istEntwurf(galerie: MediaGalleryDetail | undefined): boolean {
    return galerie !== undefined && galerieOrte(galerie).length === 0;
}

/**
 * Warum „Galerie entfernen“ nicht geht (WI-0068 R3; dieselbe Regel prüft der Server, `gallery.delete`): aus Legacy, noch an einem Ort,
 * oder von jemand anderem angelegt. `undefined`: Es geht. Kennt eine ältere Antwort Herkunft oder Person nicht, entscheidet der Server.
 */
export function entfernenHindernis(
    galerie: MediaGalleryDetail,
    personId: string | undefined,
): MediaGalleryDeleteHindernis | undefined {
    if (galerie.fromLegacy === true) return "legacy";
    if (galerieOrte(galerie).length > 0) return "bound";
    if (galerie.createdBy !== undefined && galerie.createdBy?.id !== personId) return "foreign";
    return undefined;
}

/**
 * Die Folge nach einem Schritt nach links oder rechts: GENAU die aktiven Einträge als Asset-Kennungen, wie `gallery.order` sie
 * verlangt. `undefined`, wenn der Schritt nicht geht — das Bild steht schon am Rand oder gehört nicht zur Galerie.
 *
 * 🪤 Zurückgezogene Einträge zählen NICHT mit: Sie stehen in der Anzeige hinten und dürfen in der Folge nicht auftauchen, sonst
 * weist der Server die Anfrage ab („genau die Bilder dieser Galerie, jedes einmal“).
 */
export function verschobeneFolge(
    galerie: MediaGalleryDetail | undefined,
    assetId: string,
    richtung: -1 | 1,
): string[] | undefined {
    const folge = galerieEintraege(galerie).aktiv.map((eintrag) => eintrag.asset.id);
    const von = folge.indexOf(assetId);
    const nach = von + richtung;
    if (von === -1 || nach < 0 || nach >= folge.length) return undefined;
    const neu = [...folge];
    neu[von] = folge[nach]!;
    neu[nach] = assetId;
    return neu;
}
