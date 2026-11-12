import type { MamKarteAnlegenBody, MamKarteBild, MamKarteDetail, OperationReceipt } from "@avesmaps3d/shared";
import type { OrtWahl } from "../community/kartenvorschlaege-modell";
import { t } from "../i18n/i18n";
import { kartenAnfrage, type KartenBasis, type KartenStand } from "./medien-karte-bearbeiten-modell";
import { assetDerQuittung, type HochladeAblauf } from "./medien-operationen";

/**
 * Was „Neuer Eintrag“ und die Plätze „Die Karte“ und „Die Vorschau“ der Kartensammlung rechnen (WI-0287 Stufe 1, Punkt 2, Entwurf Fassung 5). Reine Funktionen, damit Vitest sie
 * ohne Browser prüft. Die Prüfung der Angaben ist dieselbe wie beim Ändern einer Karte (`kartenAnfrage`, gegen eine leere Karte): Was niemand erfasst hat, geht nicht mit.
 */

/** Die Rolle eines Bildes am Eintrag: Karte (`map_full`) oder Vorschau (`map_preview`). */
export type KartenRolle = "map_full" | "map_preview";

export function leererKartenStand(): KartenStand {
    return {
        titel: "",
        art: "",
        farbe: "",
        mehrstoeckig: "",
        beschriftet: "",
        offiziell: "",
        spoiler: "",
        massstab: "",
        breite: "",
        hoehe: "",
        format: "",
        ab: "",
        bis: "",
        zeichner: "",
        verlag: "",
        notiz: "",
        typen: [],
    };
}

const LEERE_KARTE: KartenBasis = {
    revision: 1,
    title: "",
    art: null,
    colorMode: null,
    isMultilevel: null,
    isLabeled: null,
    isOfficial: null,
    isSpoiler: null,
    hasScale: null,
    widthPx: null,
    heightPx: null,
    format: null,
    validFromBf: null,
    validToBf: null,
    author: null,
    publisher: null,
    note: null,
    types: [],
};

export interface NeuerEintragPruefung {
    /** Die Anfrage ohne Kennung; `undefined`, solange etwas fehlt. */
    anfrage: Omit<MamKarteAnlegenBody, "operationId"> | undefined;
    /** Befunde je Feld des Stands (`titel`, `ab` …). */
    befunde: ReadonlyMap<string, string>;
}

/**
 * Orte und Regionen als Teil der Anfrage (WI-0287 Stufe 3): Nur Orte gehen als `places` wie bisher; ist eine Region dabei, gehen alle in der gewählten Folge als `targets` (und `places` bleibt leer),
 * damit die Folge stimmt.
 */
export function ortZiele(orte: readonly OrtWahl[]): Pick<MamKarteAnlegenBody, "places" | "targets"> {
    if (orte.every((ort) => (ort.kind ?? "place") === "place")) return { places: orte.map((ort) => ort.id) };
    return { places: [], targets: orte.map((ort) => ({ kind: ort.kind ?? "place", id: ort.id })) };
}

export function neuerEintragAnfrage(titel: string, stand: KartenStand, orte: readonly OrtWahl[]): NeuerEintragPruefung {
    const geprueft = kartenAnfrage(LEERE_KARTE, { ...stand, titel });
    if (geprueft.anfrage === undefined) return { anfrage: undefined, befunde: geprueft.befunde };
    return {
        anfrage: {
            fields: geprueft.anfrage.fields ?? {},
            types: geprueft.anfrage.types ?? [],
            ...ortZiele(orte),
        },
        befunde: geprueft.befunde,
    };
}

/** Der Name, mit dem das Hochladefenster den Titel vorbelegt: `Karte von „Titel“` bzw. `Vorschau von „Titel“`. */
export const vorbelegterTitel = (rolle: KartenRolle, eintragTitel: string): string =>
    t(rolle === "map_full" ? "medien.karten.platz.nameKarte" : "medien.karten.platz.nameVorschau", {
        titel: eintragTitel,
    });

/** Gleicher Name ohne Groß- und Kleinschreibung und ohne Ränder (wie der Entwurf: `toLocaleLowerCase("de")`). */
export const gleicherName = (a: string, b: string): boolean =>
    a.trim().toLocaleLowerCase("de") === b.trim().toLocaleLowerCase("de");

/** Das Werk in der Liste, das schon so heißt (das erste), oder `undefined`. Ein leerer Name hat keinen Konflikt. */
export function namensKonflikt<T extends { title: string | null }>(titel: string, werke: readonly T[]): T | undefined {
    if (titel.trim() === "") return undefined;
    return werke.find((werk) => werk.title !== null && gleicherName(werk.title, titel));
}

/** Die Rolle, die ein Eintrag schon belegt hat: das aktive Bild, falls es eines gibt; bei der Karte die erste Version. */
export const bildDerRolle = (karte: Pick<MamKarteDetail, "images">, rolle: KartenRolle): MamKarteBild | undefined =>
    karte.images.find((bild) => bild.role === rolle);

/** Die Versionen der Karte eines Eintrags (WI-0287 Stufe 2): alle aktiven `map_full`, in der Folge, in der der Server sie liefert (ihre Reihenfolge). */
export const versionenDerKarte = (karte: Pick<MamKarteDetail, "images">): MamKarteBild[] =>
    karte.images.filter((bild) => bild.role === "map_full");

/** Die Bezeichnung einer Version, wie sie gespeichert wird: getrimmt, leer heißt ohne (`null`), wie am Server. */
export const versionsBezeichnung = (wert: string | null | undefined): string | null => {
    const text = (wert ?? "").trim();
    return text === "" ? null : text;
};

/** Der Asset-Typ der Liste, in der ein Werk der Rolle liegt (Suche und Sprung in die Liste). */
export const typDerRolle = (rolle: KartenRolle): "map" | "map_preview" =>
    rolle === "map_full" ? "map" : "map_preview";

/**
 * Der Satz im leeren Platz „Die Karte“ (Entwurf): ob ein Link oder eine Vorschau da ist, ändert, was fehlt.
 * Links stehen darunter, lesend.
 */
export function leereKarteSatz(
    hatLink: boolean,
    hatVorschau: boolean,
): "keine" | "nurLink" | "vorschauLink" | "vorschauOhneLink" {
    if (hatLink) return hatVorschau ? "vorschauLink" : "nurLink";
    return hatVorschau ? "vorschauOhneLink" : "keine";
}

/**
 * Hochladen, dann das neue Werk an den Eintrag binden: zwei Operationen auf einen Klick, wie überall (`hochladenUndBinden`). Scheitert der zweite Schritt, bleibt das Werk liegen und
 * der Aufrufer sagt es (Hinweis „hochgeladen, aber nicht angehängt“); ein neuer Aufruf mit demselben Ablauf lädt nicht noch einmal hoch, sondern bindet nur.
 */
export async function karteHochladenUndBinden(
    ablauf: HochladeAblauf,
    hochladen: (operationId: string) => Promise<OperationReceipt>,
    binden: (assetId: string, operationId: string) => Promise<OperationReceipt>,
): Promise<{ assetId: string; quittung: OperationReceipt }> {
    if (ablauf.assetId === undefined || ablauf.hochgeladen === undefined) {
        const quittung = await ablauf.hochladen.fuehreAus(hochladen);
        const werk = assetDerQuittung(quittung);
        if (werk === undefined) throw new Error(t("medien.karten.platz.ohneWerk"));
        ablauf.assetId = werk;
        ablauf.hochgeladen = quittung;
    }
    const assetId = ablauf.assetId;
    return { assetId, quittung: await ablauf.binden.fuehreAus((operationId) => binden(assetId, operationId)) };
}
