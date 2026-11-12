import type { CommunityLage } from "@avesmaps3d/shared";
import type { BezugOrt } from "../community/meldung-modell";
import type { MessageKey } from "../i18n/de";
import { t } from "../i18n/i18n";

/**
 * Die Stelle in Worten (WI-0272 S2b, Aufgabe 13; WI §5.1: „in Gareth“, „nordöstlich von Gareth“): ein Satz für die Zeile „Stelle“ des Formulars und der Statusseite.
 *
 * - **„in {Ort}“**, wenn die Stelle höchstens `ORT_NAH` vom nächsten Ort liegt; sonst **„{Richtung} von {Ort}“** in acht Himmelsrichtungen. Der Ort kommt aus
 *   `fetchNearestPlace` (`photobox/reisebild-besucher.ts`); solange er fehlt (die Antwort ist unterwegs, oder es gibt keinen), steht „Stelle auf der Karte“.
 * - **Die Karte rechnet mit y nach Norden** (`aventuria-v1`, Achse y = Norden): Der Winkel zählt von Osten gegen den Uhrzeigersinn, Norden ist also +90°. Die Probierseite rechnet in
 *   Bildpunkten (y nach unten) und kehrt das Vorzeichen um; hier gilt der Kartenraum selbst.
 * - 🪤 **`ORT_NAH` ist ein Regler** (WI §9, Meldeliste): „Nähe, ab der ein Bild an einem Ort hängt“. Die Zahl der Probierseite (24 Bildpunkte eines Zoom-4-Ausschnitts) ist Kulisse;
 *   6 Karteneinheiten (rund 18 Meilen) tragen den Satz „in Gareth“ für die Stadt samt Umland, ohne dass ein Dorf in der Nachbarschaft ihr den Namen nimmt.
 */

/** Näher als so viele Karteneinheiten am nächsten Ort heißt „in {Ort}“. */
export const ORT_NAH = 6;

/** Die acht Himmelsrichtungen vom Ort aus gesehen, von Osten gegen den Uhrzeigersinn (Winkel / 45°). */
export const RICHTUNGEN = ["o", "no", "n", "nw", "w", "sw", "s", "so"] as const;
export type Himmelsrichtung = (typeof RICHTUNGEN)[number];

/** In welcher Himmelsrichtung vom Ort aus liegt die Stelle? (Kartenraum: x nach Osten, y nach Norden.) */
export function richtungVonOrt(stelle: CommunityLage, ort: CommunityLage): Himmelsrichtung {
    const winkel = Math.atan2(stelle.y - ort.y, stelle.x - ort.x);
    const index = ((Math.round(winkel / (Math.PI / 4)) % 8) + 8) % 8;
    return RICHTUNGEN[index]!;
}

/** Wie weit liegt die Stelle vom Ort, in Karteneinheiten? */
export const abstandZumOrt = (stelle: CommunityLage, ort: CommunityLage): number =>
    Math.hypot(stelle.x - ort.x, stelle.y - ort.y);

/** Liegt die Stelle „im“ Ort (höchstens `ORT_NAH` vom Ortspunkt)? */
export const imOrt = (stelle: CommunityLage, ort: BezugOrt | undefined): boolean =>
    ort !== undefined && abstandZumOrt(stelle, ort.lage) <= ORT_NAH;

export type Uebersetzer = (key: MessageKey, params?: Record<string, string | number>) => string;

/** Die Stelle in Worten: „in Gareth“, „nordöstlich von Gareth“ oder, ohne Ort, „Stelle auf der Karte“. */
export function stelleText(
    stelle: CommunityLage,
    naechsterOrt: BezugOrt | undefined,
    uebersetze: Uebersetzer = t,
): string {
    if (naechsterOrt === undefined) return uebersetze("photobox.stelle.frei");
    if (imOrt(stelle, naechsterOrt)) return uebersetze("photobox.stelle.in", { ort: naechsterOrt.name });
    const richtung = richtungVonOrt(stelle, naechsterOrt.lage);
    return uebersetze("photobox.stelle.von", {
        richtung: uebersetze(`photobox.richtungVon.${richtung}` as MessageKey),
        ort: naechsterOrt.name,
    });
}

/** Die Himmelsrichtungen der Blickrichtung, Norden zuerst, im Uhrzeigersinn (`blickrichtung` 0 bis 7, Migration 0274: 0 = Norden, je 45°). */
export const BLICK_RICHTUNGEN = ["n", "no", "o", "so", "s", "sw", "w", "nw"] as const;
