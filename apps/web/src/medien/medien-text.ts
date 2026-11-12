import type {
    HeaderGraphicObjects,
    MediaGalleryOrigin,
    MediaGalleryPublicationState,
    MamBasket,
    MamSort,
    MamUsageLabel,
    MediaAllowReason,
    MediaClearanceState,
    MediaCreationMethod,
    MediaDenyReason,
    MediaAssetType,
    MediaKind,
    MediaOrigin,
    MediaRightsBasis,
    MediaRole,
    MediaTechnicalState,
    MediaUsageSubjectKind,
} from "@avesmaps3d/shared";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import { formatNumber, locale, t } from "../i18n/i18n";
import type { TypbildSort } from "./medien-typbilder-modell";
import {
    MEDIEN_FILTER_NAMEN,
    MEDIEN_FILTER_WERTE,
    type MedienFilter,
    type MedienFilterName,
    type MedienObjekt,
} from "./medien-zustand";

/**
 * Die Wörter der Medienverwaltung (WI-0068 P3): je Wert des Vertrags ein Schlüssel der Sprachtafeln, nie ein Literal im Bauteil. Die
 * Schlüssel stehen als Schablone (`medien.rolle.${rolle}`); der Typ prüft, dass es jeden gibt - ein neuer Wert im Vertrag ohne Text ist
 * ein Typfehler, kein englisches Wort mitten im Deutschen.
 */

export const rolleName = (role: MediaRole): string => t(`medien.rolle.${role}`);
export const rechtsgrundName = (basis: MediaRightsBasis): string => t(`medien.rechtsgrund.${basis}`);
export const pruefstandName = (state: MediaClearanceState): string => t(`medien.pruefstand.${state}`);
export const herkunftName = (origin: MediaOrigin): string => t(`medien.herkunft.${origin}`);
export const entstehungName = (method: MediaCreationMethod): string => t(`medien.entstehung.${method}`);
export const technikName = (state: MediaTechnicalState): string => t(`medien.technik.${state}`);
export const artName = (kind: MediaKind): string => t(`medien.art.${kind}`);
export const artMehrzahl = (kind: MediaKind): string => t(`medien.artMehrzahl.${kind}`);
export const typName = (type: MediaAssetType): string => t(`medien.typ.${type}`);
export const typMehrzahl = (type: MediaAssetType): string => t(`medien.typMehrzahl.${type}`);
export const korbName = (basket: MamBasket): string => t(`medien.korb.${basket}`);
export const korbErklaerung = (basket: MamBasket): string => t(`medien.korbErklaerung.${basket}`);
export const sortName = (sort: MamSort): string => t(`medien.sort.${sort}`);
/**
 * Herkunft und Stand einer GALERIE. 🪤 Sie haben eigene, kuerzere Wertelisten als ein Asset (`legacy | editor` statt der sieben
 * Herkuenfte, `draft | published | suppressed` statt der Pruefstaende) - wer hier `herkunftName` nimmt, trifft die falsche Tafel.
 */
export const galerieHerkunft = (origin: MediaGalleryOrigin): string => t(`medien.galerie.herkunft.${origin}`);
export const galerieStand = (state: MediaGalleryPublicationState): string => t(`medien.galerie.stand.${state}`);

/** Ein Medienobjekt in der Schiene („Typbilder“). */
export const objektName = (objekt: MedienObjekt): string => t(`medien.objekt.${objekt}`);
/** Welche Fachobjekte eine Typbildkategorie zeigt („Orte“, „Landschaften“, „Wege“, „Übrige“). */
export const typbildObjekteName = (objects: HeaderGraphicObjects): string => t(`medien.typbild.objekte.${objects}`);
/** Die Sortierung der Typbildliste: Name der Kategorie oder Zahl der Objekte (WI-0068 Typbilder, Oberfläche). */
export const typbildSortName = (sort: TypbildSort): string => t(`medien.typbild.sort.${sort}`);

/** Das Zeichen je Sortierung aus der Familie des Hauses (`controls/avm-sortierzeichen.vue`, Guide §13.45). */
export const SORT_ZEICHEN: Readonly<Record<MamSort, "name" | "zeit" | "menge" | "haken">> = {
    name: "name",
    changed: "zeit",
    usage: "menge",
    rights: "haken",
};

const FILTER_WERTNAME: Readonly<Record<MedienFilterName, (wert: string) => string>> = {
    role: (wert) => rolleName(wert as MediaRole),
    rightsBasis: (wert) => rechtsgrundName(wert as MediaRightsBasis),
    clearance: (wert) => pruefstandName(wert as MediaClearanceState),
    origin: (wert) => herkunftName(wert as MediaOrigin),
    creation: (wert) => entstehungName(wert as MediaCreationMethod),
    technical: (wert) => technikName(wert as MediaTechnicalState),
};

/**
 * Die Abschnitte des Filterknopfs (`controls/avm-filterknopf.vue`): je Filter der Medienverwaltung einer mit genau einer Wahl, denn
 * der Vertrag kennt je Filter einen Wert (`MamSearchQuery`).
 */
export function medienFilterAbschnitte(): FilterAbschnitt[] {
    return MEDIEN_FILTER_NAMEN.map((name) => ({
        id: name,
        titel: t(`medien.filter.name.${name}`),
        art: "eins",
        werte: MEDIEN_FILTER_WERTE[name].map((wert) => ({ wert, text: FILTER_WERTNAME[name](wert) })),
    }));
}

/** Die gesetzten Filter als Wahl des Filterknopfs. */
export function medienFilterWahl(filter: MedienFilter): FilterWahl {
    return Object.fromEntries(
        MEDIEN_FILTER_NAMEN.map((name) => [name, filter[name] === undefined ? [] : [filter[name]]]),
    );
}
export const subjektArtName = (kind: MediaUsageSubjectKind): string => t(`medien.subjekt.${kind}`);
export const grundName = (reason: MediaAllowReason | MediaDenyReason): string => t(`medien.grund.${reason}`);
/** Der Grund an einer Verwendung. Ein Bild der Kategorie „Social Media Posts“ ist öffentlich, weil seine Rechte bestätigt sind, nie „ohne Prüfung“ (WI-0278). */
export const verwendungGrund = (
    role: MediaRole | null | undefined,
    publication: { public: boolean; reason: MediaAllowReason | MediaDenyReason },
): string =>
    role === "social_post" && publication.public ? t("medien.freigabe.grundSocial") : grundName(publication.reason);

/** Die Kurzform einer Kennung, wie sie im Inspector neben dem Titel steht („Asset 6dcf1e76“). */
export function kurzKennung(id: string): string {
    return id.slice(0, 8);
}

/**
 * Der Name eines Assets in Liste und Inspector (P0 „Titel am Asset“): der eigene Titel, sonst die Beschreibung der Einreichung eines Besuchers
 * (WI-0272 S3), sonst der Name der ersten Verwendung samt Rolle
 * („Gareth · Wappen“), sonst die Galerie, sonst das Typbild seiner Kategorie, sonst die Kurzkennung. Er ist Anzeige, nie Schlüssel.
 */
export function anzeigeName(
    asset: {
        id: string;
        title: string | null;
        /** Die Einreichung eines Besuchers hinter dem Asset (WI-0272 S3): Ihre Beschreibung benennt es, solange es keinen Titel trägt. */
        submission?: { beschreibung: string | null } | null | undefined;
    },
    erste: MamUsageLabel | null | undefined,
): string {
    if (asset.title !== null && asset.title.trim() !== "") return asset.title;
    const beschreibung = asset.submission?.beschreibung;
    if (beschreibung !== null && beschreibung !== undefined && beschreibung.trim() !== "") return beschreibung;
    const subjekt = erste?.subject?.name;
    const rolle = erste?.role === null || erste?.role === undefined ? undefined : rolleName(erste.role);
    if (subjekt !== undefined && subjekt !== "") return rolle === undefined ? subjekt : `${subjekt} · ${rolle}`;
    const galerie = erste?.gallery;
    if (galerie !== null && galerie !== undefined) return galerie.title ?? t("medien.galerie.ohneTitel");
    if (erste?.typeImage !== undefined) return t("medien.verwendung.typbildName", { art: erste.typeImage.label });
    return t("medien.asset.kurz", { id: kurzKennung(asset.id) });
}

/** Zahlen in der Sprache der Seite, ganz („2.484“). */
export const zahl = (wert: number): string => formatNumber(wert, 0);

/** 🪤 Je Sprache ein Eintrag, sonst bricht der Typecheck - eine neue Tafel kommt hier nie von selbst mit (WI-0158). */
const ZEIT_LOCALE = {
    de: "de-DE",
    en: "en-GB",
    fr: "fr-FR",
    nl: "nl-NL",
    it: "it-IT",
    es: "es-ES",
    pl: "pl-PL",
    da: "da-DK",
    sv: "sv-SE",
} as const;

/** Ein Zeitpunkt als Datum und Uhrzeit („05.10.2026, 10:00“). */
export function datumZeit(iso: string): string {
    return new Date(iso).toLocaleString(ZEIT_LOCALE[locale.value], {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Ein Tag („05.10.2026“). */
export function datum(iso: string): string {
    return new Date(iso).toLocaleDateString(ZEIT_LOCALE[locale.value], {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
    });
}

/** Bytes lesbar: „412 KB“, „1,4 MB“ (Basis 1024, eine Nachkommastelle ab MB). */
export function groesse(bytes: number): string {
    if (bytes < 1024) return t("medien.datei.bytes", { n: zahl(bytes) });
    if (bytes < 1024 * 1024) return t("medien.datei.kb", { n: zahl(Math.round(bytes / 1024)) });
    return t("medien.datei.mb", { n: formatNumber(bytes / (1024 * 1024), 1) });
}

/** Das Format aus dem MIME-Typ („image/png“ → „PNG“). */
export function format(mimeType: string): string {
    const teil = mimeType.split("/")[1] ?? mimeType;
    return teil.replace(/^svg\+xml$/, "svg").toUpperCase();
}
