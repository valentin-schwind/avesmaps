import {
    KARTE_TEXT_MAX,
    KARTEN_TYPEN,
    type KarteTyp,
    type MamKarteAendernBody,
    type MamKarteDetail,
    type MamKarteFelder,
} from "@avesmaps3d/shared";
import { artLabel, colourLabel, typeLabel } from "../catalog/citymap-window-model";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Was der Kasten „Angaben“ einer Karte beim Bearbeiten rechnet (WI-0068 R5, Betreiber 2026-10-18 „B jetzt“). Wie die Kästen eines Werks
 * (`medien-bearbeiten-modell.ts`): ein Stand aus dem Detail, eine Anfrage an `citymap.update` nur mit dem, was sich geändert hat. Reine
 * Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * - 🔴 **Dreiwertig:** Art, Farbe und die fünf Merkmale kennen „unbekannt“ (leer), nie als „nein“ (0069, Legacy-Kernregel).
 * - Ein leeres Textfeld heißt „nicht erfasst“; der Titel ist Pflicht. Zahlen sind ganze Zahlen; 9999 als „bis“ ist das offene Ende.
 * - Die Grenzen sind Legacys (`KARTE_TEXT_MAX`); der Server prüft dasselbe noch einmal.
 */

export type Dreiwert = "" | "ja" | "nein";

export interface KartenStand {
    titel: string;
    /** `""` heißt unbekannt. */
    art: string;
    farbe: string;
    /** `Dreiwert`; als Text, weil das Auswahlfeld Text liefert. */
    mehrstoeckig: string;
    beschriftet: string;
    offiziell: string;
    spoiler: string;
    massstab: string;
    breite: string;
    hoehe: string;
    format: string;
    ab: string;
    bis: string;
    zeichner: string;
    verlag: string;
    notiz: string;
    typen: KarteTyp[];
}

const dreiwert = (wert: boolean | null): Dreiwert => (wert === null ? "" : wert ? "ja" : "nein");
const ausDreiwert = (wert: string): boolean | null => (wert === "ja" ? true : wert === "nein" ? false : null);
const zahlText = (wert: number | null): string => (wert === null ? "" : String(wert));

export function kartenStandAus(karte: MamKarteDetail): KartenStand {
    return {
        titel: karte.title,
        art: karte.art ?? "",
        farbe: karte.colorMode ?? "",
        mehrstoeckig: dreiwert(karte.isMultilevel),
        beschriftet: dreiwert(karte.isLabeled),
        offiziell: dreiwert(karte.isOfficial),
        spoiler: dreiwert(karte.isSpoiler),
        massstab: dreiwert(karte.hasScale),
        breite: zahlText(karte.widthPx),
        hoehe: zahlText(karte.heightPx),
        format: karte.format ?? "",
        ab: zahlText(karte.validFromBf),
        bis: zahlText(karte.validToBf),
        zeichner: karte.author ?? "",
        verlag: karte.publisher ?? "",
        notiz: karte.note ?? "",
        typen: [...karte.types],
    };
}

/** Das Ergebnis der Prüfung: die Anfrage (ohne Kennung) oder `undefined`, wenn sich nichts änderte; Befunde je Feld des Stands. */
export interface KartenAnfrage {
    anfrage: Omit<MamKarteAendernBody, "operationId"> | undefined;
    befunde: ReadonlyMap<keyof KartenStand, string>;
}

const ohneLeer = (wert: string | null): string | null => (wert === null || wert.trim() === "" ? null : wert.trim());

/** Was die Prüfung von einer Karte wissen muss; `medien-karte-neu-modell.ts` prüft dieselben Felder gegen eine leere Karte (neuer Eintrag, WI-0287). */
export type KartenBasis = Pick<
    MamKarteDetail,
    | "revision"
    | "title"
    | "art"
    | "colorMode"
    | "isMultilevel"
    | "isLabeled"
    | "isOfficial"
    | "isSpoiler"
    | "hasScale"
    | "widthPx"
    | "heightPx"
    | "format"
    | "validFromBf"
    | "validToBf"
    | "author"
    | "publisher"
    | "note"
    | "types"
>;

export function kartenAnfrage(karte: KartenBasis, stand: KartenStand): KartenAnfrage {
    const befunde = new Map<keyof KartenStand, string>();
    const felder: MamKarteFelder = {};

    const titel = stand.titel.trim();
    if (titel === "") befunde.set("titel", t("medien.karten.bearbeiten.titelPflicht"));
    else if (titel !== karte.title) felder.title = titel;

    const text = (feld: keyof KartenStand, wert: string, max: number): string | null => {
        const neu = ohneLeer(wert);
        if (neu !== null && neu.length > max) befunde.set(feld, t("medien.karten.bearbeiten.zuLang", { max }));
        return neu;
    };
    const zahl = (feld: keyof KartenStand, wert: string, min: number, max: number): number | null => {
        const roh = wert.trim();
        if (roh === "") return null;
        const n = /^-?\d+$/u.test(roh) ? Number(roh) : Number.NaN;
        if (!Number.isInteger(n) || n < min || n > max) {
            // Jahre ohne Tausenderpunkt (wie im Katalog), Bildpunkte mit.
            const zeige = (n: number): string => (max > 9999 ? formatNumber(n, 0) : String(n));
            befunde.set(feld, t("medien.karten.bearbeiten.zahl", { min: zeige(min), max: zeige(max) }));
            return null;
        }
        return n;
    };

    const art = stand.art === "" ? null : (stand.art as NonNullable<MamKarteFelder["art"]>);
    if (art !== karte.art) felder.art = art;
    const farbe = stand.farbe === "" ? null : (stand.farbe as NonNullable<MamKarteFelder["colorMode"]>);
    if (farbe !== karte.colorMode) felder.colorMode = farbe;

    const merkmale = [
        ["isMultilevel", stand.mehrstoeckig, karte.isMultilevel],
        ["isLabeled", stand.beschriftet, karte.isLabeled],
        ["isOfficial", stand.offiziell, karte.isOfficial],
        ["isSpoiler", stand.spoiler, karte.isSpoiler],
        ["hasScale", stand.massstab, karte.hasScale],
    ] as const;
    for (const [feld, wert, vorher] of merkmale) {
        const neu = ausDreiwert(wert);
        if (neu !== vorher) felder[feld] = neu;
    }

    const breite = zahl("breite", stand.breite, 1, 1_000_000);
    if (!befunde.has("breite") && breite !== karte.widthPx) felder.widthPx = breite;
    const hoehe = zahl("hoehe", stand.hoehe, 1, 1_000_000);
    if (!befunde.has("hoehe") && hoehe !== karte.heightPx) felder.heightPx = hoehe;
    const ab = zahl("ab", stand.ab, -9999, 9999);
    if (!befunde.has("ab") && ab !== karte.validFromBf) felder.validFromBf = ab;
    const bis = zahl("bis", stand.bis, -9999, 9999);
    if (!befunde.has("bis") && bis !== karte.validToBf) felder.validToBf = bis;
    if (ab !== null && bis !== null && ab > bis) befunde.set("bis", t("medien.karten.bearbeiten.bisVorAb"));

    const texte = [
        ["format", "format", stand.format, karte.format, KARTE_TEXT_MAX.format],
        ["zeichner", "author", stand.zeichner, karte.author, KARTE_TEXT_MAX.author],
        ["verlag", "publisher", stand.verlag, karte.publisher, KARTE_TEXT_MAX.publisher],
        ["notiz", "note", stand.notiz, karte.note, KARTE_TEXT_MAX.note],
    ] as const;
    for (const [feldDesStands, feld, wert, vorher, max] of texte) {
        const neu = text(feldDesStands, wert, max);
        if (neu !== ohneLeer(vorher)) felder[feld] = neu;
    }
    if (titel.length > KARTE_TEXT_MAX.title)
        befunde.set("titel", t("medien.karten.bearbeiten.zuLang", { max: KARTE_TEXT_MAX.title }));

    const typen = [...new Set(stand.typen)].sort();
    const typenGeaendert = typen.join(",") !== [...karte.types].sort().join(",");

    if (befunde.size > 0) return { anfrage: undefined, befunde };
    if (Object.keys(felder).length === 0 && !typenGeaendert) return { anfrage: undefined, befunde };
    return {
        anfrage: {
            baseRevision: karte.revision,
            ...(Object.keys(felder).length > 0 ? { fields: felder } : {}),
            ...(typenGeaendert ? { types: typen } : {}),
        },
        befunde,
    };
}

/** Die Optionen der Auswahlfelder: „unbekannt“ zuerst, dann die Wörter des Katalogs. */
export const artOptionen = (): { wert: string; text: string }[] => [
    { wert: "", text: t("medien.karten.bearbeiten.unbekannt") },
    ...["politisch", "derographisch", "topologisch", "skizze"].map((wert) => ({ wert, text: artLabel(wert) })),
];
export const farbOptionen = (): { wert: string; text: string }[] => [
    { wert: "", text: t("medien.karten.bearbeiten.unbekannt") },
    ...["graustufen", "braun", "farbig"].map((wert) => ({ wert, text: colourLabel(wert) })),
];
export const dreiwertOptionen = (): { wert: Dreiwert; text: string }[] => [
    { wert: "", text: t("medien.karten.bearbeiten.unbekannt") },
    { wert: "ja", text: t("catalog.yes") },
    { wert: "nein", text: t("catalog.no") },
];
/** Die 16 Typen in der Folge des Vertrags, mit dem Wort des Katalogs. */
export const typOptionen = (): { wert: KarteTyp; text: string }[] =>
    KARTEN_TYPEN.map((wert) => ({ wert, text: typeLabel(wert) }));

/**
 * Nach „↺ Neu laden“ bei offenem Kasten: Was die Redakteurin seit dem Öffnen nicht angefasst hat (gleich dem Stand von damals), folgt dem
 * neuen Stand; ihre eigenen Eingaben bleiben. Sonst schickte das nächste Speichern die alten Werte der unberührten Felder mit und
 * überschriebe still, was die andere Person gerade geändert hat (Fund der R5-Bedienprobe 2026-10-19).
 */
export function kartenStandNachladen(alt: KartenStand, eigen: KartenStand, neu: KartenStand): KartenStand {
    const ergebnis = { ...eigen };
    for (const feld of Object.keys(eigen) as (keyof KartenStand)[]) {
        if (feld === "typen") continue;
        if (eigen[feld] === alt[feld]) (ergebnis as Record<string, unknown>)[feld] = neu[feld];
    }
    const gleich = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");
    ergebnis.typen = gleich(eigen.typen, alt.typen) ? [...neu.typen] : [...eigen.typen];
    return ergebnis;
}
