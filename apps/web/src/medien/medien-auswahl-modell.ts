import {
    typeImageVariantAccepts,
    type MamAssetSummary,
    type MediaCreationMethod,
    type MediaSubjectSlots,
    type MediaTypeImageVariant,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { BindbareRolle } from "./medien-formular-modell";
import { trefferBild, type TrefferBild } from "./medien-inspektor-modell";
import { anzeigeName, herkunftName, rechtsgrundName, zahl } from "./medien-text";

/**
 * Was die Auswahl eines Wappens oder Titelbilds rechnet (WI-0068 P4b, WI-0126 §11j, Gesamtmockup Version 7): je Eintrag die Zeile
 * (Name, „gebunden“, „hochgeladen von … · Datum“, Rechte, Verwendungen, „wartet auf Rechteprüfung“) und was der Hauptknopf tut. Reine
 * Funktionen, damit Vitest sie ohne Browser prüft.
 */

export interface AuswahlEintrag {
    id: string;
    name: string;
    vorschau: TrefferBild | null;
    gebunden: boolean;
    hochgeladen: string;
    rechte: string;
    verwendungen: string;
    wartet: boolean;
    /**
     * Wie viele WEITERE Werke dieselbe Datei tragen; 0 heisst: dieses Werk hat sie allein.
     *
     * 🔴 Legacy legte je Verwendung ein eigenes Werk an (1.025 Assets teilen ihre Quelldatei, WI-0068 §21). Wo eine Auswahl
     * gruppiert (`groupFiles`), steht hier EIN Werk für die ganze Gruppe — und die Zahl sagt, dass es mehr sind. Ohne sie
     * sähe ein Mensch nicht, dass seine Wahl stellvertretend ist.
     */
    geteilt: number;
}

/** Was am Platz schon hängt: das Wappen bzw. das Titelbild als Einzelbild (WI-0219; die Bilder einer Galerie sind kein Titelbild). */
export function gebundeneAssets(plaetze: MediaSubjectSlots | undefined, rolle: BindbareRolle): ReadonlySet<string> {
    if (plaetze === undefined) return new Set();
    if (rolle === "coat") return new Set(plaetze.coat.asset === null ? [] : [plaetze.coat.asset.id]);
    const bild = plaetze.header?.image?.asset.id;
    return new Set(bild === undefined ? [] : [bild]);
}

/**
 * „hochgeladen von … · Datum“: die Person beim Hochladen im Editor; aus Legacy „Legacy-Import“, mit Legacys Namen, wo er bekannt ist
 * (17 von 2.513); kam es anders herein (etwa aus dem Wiki übernommen), steht die Herkunft. Nie leer (WI-0128 E19): ohne Person bei einem
 * Upload „unbekannt“, ohne Datum „Datum unbekannt“.
 */
export function hochgeladenSatz(eintrag: MamAssetSummary, datum: (iso: string) => string): string {
    const am =
        eintrag.uploadedAt === null || eintrag.uploadedAt === undefined
            ? t("medien.auswahl.datumUnbekannt")
            : datum(eintrag.uploadedAt);
    const person = eintrag.uploadedBy?.displayName;
    if (person !== undefined) return t("medien.auswahl.hochgeladen", { von: person, am });
    if (eintrag.origin === "legacy_import") {
        const von = eintrag.uploadedByLabel
            ? t("medien.auswahl.legacyVon", { name: eintrag.uploadedByLabel })
            : t("medien.auswahl.legacy");
        return t("medien.auswahl.hochgeladen", { von, am });
    }
    if (eintrag.origin === "editor_upload")
        return t("medien.auswahl.hochgeladen", { von: t("medien.auswahl.unbekannt"), am });
    return t("medien.auswahl.herkunft", { herkunft: herkunftName(eintrag.origin), am });
}

/** Wartet es auf die Rechteprüfung? Ohne öffentliche Datei und mit ungeprüften Rechten. */
export function wartetAufPruefung(eintrag: MamAssetSummary): boolean {
    if (eintrag.published) return false;
    return eintrag.clearance === null || ["unreviewed", "needs_review", "legacy_assumed"].includes(eintrag.clearance);
}

export function auswahlEintrag(
    eintrag: MamAssetSummary,
    gebunden: ReadonlySet<string>,
    datum: (iso: string) => string,
): AuswahlEintrag {
    return {
        id: eintrag.id,
        name: anzeigeName(eintrag, eintrag.primaryUsage),
        vorschau: trefferBild(eintrag),
        gebunden: gebunden.has(eintrag.id),
        hochgeladen: hochgeladenSatz(eintrag, datum),
        rechte: eintrag.rightsBasis === null ? t("medien.auswahl.ohneRechte") : rechtsgrundName(eintrag.rightsBasis),
        verwendungen: t(eintrag.usageCount === 1 ? "medien.auswahl.verwendung" : "medien.auswahl.verwendungen", {
            n: zahl(eintrag.usageCount),
        }),
        wartet: wartetAufPruefung(eintrag),
        geteilt: eintrag.sharedFileCount,
    };
}

export interface AuswahlHandlung {
    /** „Ersetzen“ oder „Hinzufügen“. */
    text: string;
    /** Warum es gerade nicht geht; `undefined`: Es geht. */
    gesperrt: string | undefined;
    /** Der Satz unter der Auswahl: was der Knopf tut. */
    satz: string;
}

/**
 * Was der Hauptknopf tut und ob er geht: ein Wappen setzen oder ersetzen, das Titelbild setzen oder ersetzen (WI-0219: EIN Bild ODER
 * EINE Galerie; was bisher hängt, wird gelöst und bleibt in der Medienverwaltung).
 */
export function auswahlHandlung(
    plaetze: MediaSubjectSlots | undefined,
    rolle: BindbareRolle,
    gewaehlt: string | undefined,
    ortName: string,
): AuswahlHandlung {
    const wirkung = t("medien.auswahl.wirkung");
    if (rolle === "coat") {
        const gebunden = plaetze?.coat.asset?.id;
        const text = t(gebunden === undefined ? "medien.auswahl.hinzufuegen" : "medien.auswahl.ersetzen");
        const satz = `${t(gebunden === undefined ? "medien.auswahl.satzWappenNeu" : "medien.auswahl.satzWappenErsetzen", { ort: ortName })} ${wirkung}`;
        const gesperrt =
            plaetze === undefined
                ? t("medien.auswahl.laedt")
                : gewaehlt === undefined
                  ? t("medien.auswahl.nichtsGewaehlt")
                  : gewaehlt === gebunden
                    ? t("medien.auswahl.schonGebundenWappen")
                    : undefined;
        return { text, gesperrt, satz };
    }
    const platz = plaetze?.header;
    const bild = platz?.image?.asset.id;
    const besetzt = bild !== undefined || (platz?.gallery ?? null) !== null;
    const text = t(besetzt ? "medien.auswahl.titelbildErsetzen" : "medien.auswahl.alsTitelbild");
    const satz = `${t("medien.auswahl.satzTitelbild", { ort: ortName })} ${wirkung}`;
    const gesperrt =
        plaetze === undefined
            ? t("medien.auswahl.laedt")
            : platz === null || platz === undefined
              ? t("medien.auswahl.keineGalerie")
              : gewaehlt === undefined
                ? t("medien.auswahl.nichtsGewaehlt")
                : gewaehlt === bild
                  ? t("medien.auswahl.schonGebundenBild")
                  : undefined;
    return { text, gesperrt, satz };
}

/**
 * Dasselbe für ein Typbild (WI-0068, Betreiber 2026-10-11): Das Ziel ist die KATEGORIE, nicht ein Fachobjekt — es gibt deshalb keine
 * Plätze und keine Galerie, sondern genau ein geltendes Asset (den ★) oder keines. Der ★ wandert, das alte Asset bleibt im Verlauf.
 *
 * Seit WI-0281 je Variante: `variante` ist die Variante, die gesetzt wird, `entstehung` die des gewählten Bildes. Passt sie nicht (ein KI-Bild als Typbild ohne
 * KI, ein Foto als KI-Typbild, Unbekanntes als ohne KI), ist der Knopf gesperrt und sagt warum, wie der Server (`type_image_variant_mismatch`).
 */
export function typbildHandlung(
    aktuell: { assetId: string } | null,
    gewaehlt: string | undefined,
    kategorieName: string,
    variante: MediaTypeImageVariant = "ki",
    entstehung?: MediaCreationMethod,
): AuswahlHandlung {
    const satz = `${t(aktuell === null ? "medien.typbild.satzNeu" : "medien.typbild.satzErsetzen", { art: kategorieName })} ${t("medien.typbild.wirkung")}`;
    const gesperrt =
        gewaehlt === undefined
            ? t("medien.auswahl.nichtsGewaehlt")
            : gewaehlt === aktuell?.assetId
              ? t("medien.typbild.schonGesetzt")
              : entstehung !== undefined && !typeImageVariantAccepts(variante, entstehung)
                ? t(
                      variante === "ohne_ki"
                          ? "medien.typbild.variante.passtNichtOhneKi"
                          : "medien.typbild.variante.passtNichtKi",
                  )
                : undefined;
    return { text: t(aktuell === null ? "medien.auswahl.hinzufuegen" : "medien.auswahl.ersetzen"), gesperrt, satz };
}
