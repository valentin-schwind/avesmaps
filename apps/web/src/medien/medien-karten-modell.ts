import type { CitymapEntry, MamKarteBild, MamKarteDetail, MamKarteZeile } from "@avesmaps3d/shared";
import { artLabel, factsOf, typeLabel, validityLabel } from "../catalog/citymap-window-model";
import { t } from "../i18n/i18n";
import type { FeldZeile } from "./medien-inspektor-modell";
import type { Fuellung } from "./medien-kreis";

/**
 * Was die Kartensammlung der Medienverwaltung rechnet (WI-0068 R5, nur lesend). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Die Angaben einer Karte rechnet der Katalog** (`catalog/citymap-window-model.ts`, `factsOf`): dieselben Zeilen und Wörter wie im
 * Fenster „Kartensammlung von …“, das Besucher sehen. Was niemand erfasst hat (dreiwertig unbekannt), hat keine Zeile; ein ausdrückliches
 * Nein steht da. Hier kommen nur die Angaben dazu, die Besucher nie sehen (Herkunft, Zustand, Wiki-Schlüssel), mit der Marke „intern“.
 */

const ohneNull = <T>(wert: T | null): T | undefined => (wert === null ? undefined : wert);
const text = (wert: string | null): string | undefined => (wert === null || wert.trim() === "" ? undefined : wert);

/** Die Karte in der Form des Katalogs, damit dessen Faktenzeilen sie lesen. */
export function alsKatalogEintrag(karte: MamKarteDetail): CitymapEntry {
    return {
        id: karte.id,
        title: karte.title,
        ...(karte.types.length > 0 ? { types: [...karte.types] } : {}),
        ...(karte.art === null ? {} : { art: karte.art }),
        ...(karte.colorMode === null ? {} : { colorMode: karte.colorMode }),
        ...(karte.isOfficial === null ? {} : { official: karte.isOfficial }),
        ...(karte.isLabeled === null ? {} : { labeled: karte.isLabeled }),
        ...(karte.isMultilevel === null ? {} : { multilevel: karte.isMultilevel }),
        ...(karte.hasScale === null ? {} : { hasScale: karte.hasScale }),
        ...(karte.validFromBf === null ? {} : { validFrom: karte.validFromBf }),
        ...(karte.validToBf === null ? {} : { validTo: karte.validToBf }),
        ...(text(karte.format) === undefined ? {} : { format: karte.format! }),
        ...(text(karte.author) === undefined ? {} : { author: karte.author! }),
        ...(text(karte.publisher) === undefined ? {} : { publisher: karte.publisher! }),
        ...(karte.widthPx === null || karte.widthPx < 1 ? {} : { widthPx: karte.widthPx }),
        ...(karte.heightPx === null || karte.heightPx < 1 ? {} : { heightPx: karte.heightPx }),
        ...(text(karte.note) === undefined ? {} : { note: karte.note! }),
    };
}

/** Die Angaben der Karte als Feldzeilen des Inspectors: erst die des Katalogs, dann die internen. */
export function kartenZeilen(karte: MamKarteDetail): FeldZeile[] {
    const katalog = factsOf(alsKatalogEintrag(karte)).flatMap((zeile) =>
        zeile.value.kind === "text"
            ? [{ id: zeile.key, label: zeile.label, wert: zeile.value.text, intern: false }]
            : [],
    );
    const intern: FeldZeile[] = [
        {
            id: "zustand",
            label: t("medien.karten.feld.zustand"),
            wert: t(`medien.karten.zustand.${karte.state}`),
            intern: true,
        },
        {
            id: "herkunft",
            label: t("medien.karten.feld.herkunft"),
            wert: t(`medien.karten.herkunft.${karte.legacyOrigin}`),
            intern: true,
        },
    ];
    const schluessel = ohneNull(karte.legacyWikiKey);
    if (schluessel !== undefined) {
        intern.push({
            id: "wikischluessel",
            label: t("medien.karten.feld.wikiSchluessel"),
            wert: schluessel,
            intern: true,
        });
    }
    return [...katalog, ...intern];
}

/** Die zweite Zeile einer Karte in der Liste: Art, Typen, Zeitraum, soweit erfasst, und ab zwei Versionen ihre Zahl (WI-0287 Stufe 2, Entwurf `unterzeile`). */
export function kartenUnterzeile(
    zeile: Pick<MamKarteZeile, "art" | "types" | "validFromBf" | "validToBf"> & { versions?: number | undefined },
): string {
    return [
        zeile.art === null ? undefined : artLabel(zeile.art),
        zeile.types.length === 0 ? undefined : zeile.types.map(typeLabel).join(" & "),
        validityLabel({
            ...(zeile.validFromBf === null ? {} : { validFrom: zeile.validFromBf }),
            ...(zeile.validToBf === null ? {} : { validTo: zeile.validToBf }),
        }) || undefined,
        zeile.versions !== undefined && zeile.versions > 1
            ? t("medien.karten.versionen", { n: zeile.versions })
            : undefined,
    ]
        .filter((teil): teil is string => teil !== undefined && teil !== "")
        .join(" · ");
}

/**
 * Der Kreis einer Karte (Hausregel: der Kreis in jeder Liste): ○ ohne Bild, ◐ mit Bild, aber keines öffentlich, ● ein Bild öffentlich.
 * Die Bedeutung steht in der Legende unter der Liste.
 */
export function kreisDerKarte(zeile: Pick<MamKarteZeile, "images" | "publicImages">): Fuellung {
    if (zeile.images === 0) return "leer";
    return zeile.publicImages > 0 ? "voll" : "halb";
}

export function kartenKreisName(fuellung: Fuellung): string {
    return t(`medien.karten.kreis.${fuellung}`);
}

/** Die Rolle eines Bildes der Karte („Vorschau“, „Vollbild“). */
export function bildRolle(bild: Pick<MamKarteBild, "role">): string {
    return t(bild.role === "map_preview" ? "medien.karten.bild.vorschau" : "medien.karten.bild.vollbild");
}

/** Das Bild, das man sieht: die öffentliche Datei, sonst die private Vorschau; ohne beides keines. */
export function sichtbaresBild(
    bild: Pick<MamKarteBild, "preview" | "privatePreview">,
): { url: string; width: number; height: number } | undefined {
    return bild.preview ?? bild.privatePreview ?? undefined;
}

/**
 * Welche Karte nach dem Entfernen gewählt wird (WI-0287): die nächste aktive nach der entfernten, sonst die erste aktive der Liste, sonst keine.
 * Eine stillgelegte Zeile (das Kästchen „Stillgelegte anzeigen“ ist an) wird übersprungen.
 */
export function naechsteKarte(
    zeilen: readonly Pick<MamKarteZeile, "id" | "active">[],
    entfernt: string,
): string | undefined {
    const stelle = zeilen.findIndex((zeile) => zeile.id === entfernt);
    const aktiv = (zeile: Pick<MamKarteZeile, "id" | "active">): boolean => zeile.active && zeile.id !== entfernt;
    return (zeilen.slice(stelle + 1).find(aktiv) ?? zeilen.find(aktiv))?.id;
}
