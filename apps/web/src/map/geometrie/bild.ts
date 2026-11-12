import type { GeometrieArt, Marke, Mitgezogen, Punkt, Stelle, Teil, Treffer, Ziel } from "./geometrie";
import { verschoben, type Teilung } from "./rechnung";

/**
 * Was das Geometrie-Modul zeichnet, als reine Rechnung aus dem Zustand des Modus (WI-0177). Die Schicht (`schicht.ts`) malt es nur.
 *
 * - **Kante** (Knallrot): die gerundete Vorschau jedes bearbeiteten Teils.
 * - **Alt** (blass gestrichelt): während eines Zugs die Lage vorher, auch die der mitgezogenen Nachbarn.
 * - **Folge** (gestrichelt): die Nachbarn mit ihren mitgezogenen Punkten.
 * - **Anfasser:** jeder Kontrollpunkt; die Enden einer Linie etwas größer.
 * - **Steuergriffe:** je Teil einer Art mit Steuergriff (Kraftlinie: der Scheitel des Bogens), nach `art.steuergriff.lage`.
 * - **Andockmarken:** die Ziele um den Zeiger, an denen der gezogene Punkt einrasten könnte.
 * - **Ringe:** die Hülle in der Größe des Fangradius (an den Punkten, die einrasten können: in Ruhe nach `huelleInRuhe`, beim Ziehen
 *   um den gezogenen Punkt), der Kringel ums Einrastziel (um eine Ecke oder einen Ort durchgezogen, um einen Kantenpunkt
 *   gestrichelt), die Marken des Aufrufers (bestätigt, frei, Fehler) und, beim Lösen mit Strg, der Bernstein-Ring an der Stelle, an der Punkte
 *   von Nachbarn liegen bleiben (`liegen`).
 * - **Markiert** (Umschalt + Klick, `GeometrieArt.markieren`): der gelbe Ring um jede markierte Ecke, auch während sie gezogen wird.
 * - **Teilung** (Strg über einer Kante, `teilungUnter`): die gerade Strecke hervorgehoben und die vier Punkte, die ein Klick setzt.
 */

/** Der Kringel um eine Ecke oder einen Ort, in Bildpunkten (Legacys Gebietseditor `region-edit-snap-preview.js`: 11, durchgezogen). */
export const KRINGEL_ECKE_PX = 11;
/** Der Kringel um einen Punkt auf einer Kante (Legacy: 8, gestrichelt). */
export const KRINGEL_KANTE_PX = 8;
/** Der Ring eines bestätigten Anschlusses. */
export const MARKE_BESTAETIGT_PX = 11;
/** Der Ring eines offenen Endes (etwas größer, damit er den Anfasser nicht verdeckt). */
export const MARKE_FREI_PX = 13;
/** Der Ring an liegen gebliebenen Punkten (Strg): um den Anfasser und eine Ortsmarke darunter herum. */
export const LIEGEN_PX = 17;
/** Der Ring um die Stelle einer abgelehnten Form: weit genug, dass er die Anfasser und Kanten dort nicht deckt. */
export const MARKE_FEHLER_PX = 20;
/** Der Ring um eine markierte Ecke: außen um den Anfasser. */
export const MARKIERT_PX = 10;
/** So weit um den Zeiger leuchten die Andockpunkte, als Vielfaches des Fangradius. */
export const ANDOCK_UMKREIS = 6;

export interface Zustand {
    readonly teile: readonly Teil[];
    /** Die Teile vor dem laufenden Zug (nur während eines Zugs). */
    readonly vorher?: readonly Teil[] | undefined;
    readonly nachbarn: readonly Teil[];
    readonly mitgezogen: readonly Mitgezogen[];
    readonly gezogen?: { readonly stelle: Stelle; readonly at: Punkt } | undefined;
    /** Der Teil, dessen Steuergriff gerade gezogen wird. */
    readonly gesteuert?: { readonly objekt: string; readonly nr: number } | undefined;
    readonly treffer?: Treffer | undefined;
    readonly andock: readonly Ziel[];
    readonly marken: readonly Marke[];
    /** Wo beim Lösen Punkte von Nachbarn liegen bleiben (`liegenBleibende`). */
    readonly liegen?: readonly Punkt[] | undefined;
    /** Strg über einer Kante: die Strecke und die Punkte, die ein Klick setzt. */
    readonly teilung?: Teilung | undefined;
    /** Die markierten Ecken (Umschalt + Klick); gezeichnet an ihrer Lage in `teile`. */
    readonly markiert?: readonly Stelle[] | undefined;
    /** Die Rundung ist ausgeschaltet (Taste R): Die Kante läuft gerade durch die Punkte, der dünne Umriss entfällt. */
    readonly eckig?: boolean | undefined;
}

export type LinienRolle = "kante" | "alt" | "folge" | "ecken" | "teilung";
export type RingArt = "huelle" | "kringel" | "kringelKante" | "bestaetigt" | "frei" | "fehler" | "liegen" | "markiert";

export interface Bild {
    readonly linien: readonly {
        readonly coords: readonly Punkt[];
        readonly rolle: LinienRolle;
        readonly objekt: string;
        readonly nr: number;
        /** Ein Teil nur zum Wählen (`Teil.fest`). */
        readonly fest?: boolean;
    }[];
    readonly anfasser: readonly {
        readonly at: Punkt;
        readonly ende: boolean;
        readonly stelle: Stelle;
        readonly fest?: boolean;
    }[];
    readonly steuergriffe?: readonly {
        readonly at: Punkt;
        readonly objekt: string;
        readonly nr: number;
        readonly aktiv: boolean;
    }[];
    readonly andock: readonly Punkt[];
    readonly ringe: readonly { readonly at: Punkt; readonly art: RingArt; readonly radius: number }[];
    /** Die Punkte, die Strg + Klick setzen würde (Vorschau, fangen keinen Zeiger). */
    readonly teilung?: readonly Punkt[];
}

const geschlossen = (teil: Teil, punkte: readonly Punkt[]): readonly Punkt[] =>
    teil.art === "ring" && punkte.length > 0 ? [...punkte, punkte[0]!] : punkte;

export function bildVon(art: GeometrieArt, zustand: Zustand, fangradius: number): Bild {
    const linien: Bild["linien"][number][] = [];
    const rund = (teil: Teil, punkte: readonly Punkt[]): readonly Punkt[] =>
        teil.art === "punkt"
            ? []
            : zustand.eckig === true
              ? geschlossen(teil, punkte)
              : art.rundung(geschlossen(teil, punkte), teil);
    for (const teil of zustand.vorher ?? [])
        linien.push({ coords: rund(teil, teil.punkte), rolle: "alt", objekt: teil.objekt, nr: teil.nr });
    for (const nachbar of zustand.nachbarn) {
        const seine = zustand.mitgezogen.filter(
            (m) => m.stelle.objekt === nachbar.objekt && m.stelle.nr === nachbar.nr,
        );
        if (seine.length === 0) continue;
        let punkte: readonly Punkt[] = nachbar.punkte;
        for (const m of seine) punkte = verschoben(punkte, m.stelle.index, m.nach);
        linien.push({ coords: rund(nachbar, nachbar.punkte), rolle: "alt", objekt: nachbar.objekt, nr: nachbar.nr });
        linien.push({ coords: rund(nachbar, punkte), rolle: "folge", objekt: nachbar.objekt, nr: nachbar.nr });
    }
    for (const teil of zustand.teile) {
        if (teil.art !== "punkt")
            linien.push({
                coords: rund(teil, teil.punkte),
                rolle: "kante",
                objekt: teil.objekt,
                nr: teil.nr,
                ...(teil.fest === true ? { fest: true } : {}),
            });
        // Der eckige Umriss dünn über der Rundung (T27 (6)): Er ist, was gespeichert wird.
        if (art.eckenZeigen === true && zustand.eckig !== true && teil.art !== "punkt")
            linien.push({ coords: geschlossen(teil, teil.punkte), rolle: "ecken", objekt: teil.objekt, nr: teil.nr });
    }
    const teilung = zustand.teilung;
    if (teilung !== undefined)
        linien.push({ coords: [teilung.von, teilung.bis], rolle: "teilung", objekt: teilung.objekt, nr: teilung.nr });

    const anfasser: Bild["anfasser"][number][] = [];
    const ringe: Bild["ringe"][number][] = [];
    for (const teil of zustand.teile) {
        teil.punkte.forEach((at, index) => {
            const stelle = { objekt: teil.objekt, nr: teil.nr, index };
            const ende = teil.art !== "ring" && (index === 0 || index === teil.punkte.length - 1);
            anfasser.push({
                at,
                ende: ende && teil.fest !== true,
                stelle,
                ...(teil.fest === true ? { fest: true } : {}),
            });
            const wirdGezogen =
                zustand.gezogen !== undefined &&
                zustand.gezogen.stelle.objekt === teil.objekt &&
                zustand.gezogen.stelle.nr === teil.nr &&
                zustand.gezogen.stelle.index === index;
            if (!wirdGezogen && art.huelleInRuhe(stelle, teil)) ringe.push({ at, art: "huelle", radius: fangradius });
        });
    }
    if (zustand.gezogen !== undefined) {
        const teil = zustand.teile.find(
            (t) => t.objekt === zustand.gezogen!.stelle.objekt && t.nr === zustand.gezogen!.stelle.nr,
        );
        if (teil !== undefined && art.ziele(zustand.gezogen.stelle, teil).length > 0)
            ringe.push({ at: zustand.gezogen.at, art: "huelle", radius: fangradius });
    }
    if (zustand.treffer !== undefined) {
        const kante = zustand.treffer.ziel.art === "kante";
        ringe.push({
            at: zustand.treffer.at,
            art: kante ? "kringelKante" : "kringel",
            radius: kante ? KRINGEL_KANTE_PX : KRINGEL_ECKE_PX,
        });
    }
    for (const at of zustand.liegen ?? []) ringe.push({ at, art: "liegen", radius: LIEGEN_PX });
    for (const stelle of zustand.markiert ?? []) {
        const at = zustand.teile.find((t) => t.objekt === stelle.objekt && t.nr === stelle.nr)?.punkte[stelle.index];
        if (at !== undefined) ringe.push({ at, art: "markiert", radius: MARKIERT_PX });
    }
    for (const marke of zustand.marken) {
        ringe.push({
            at: marke.at,
            art: marke.art,
            radius:
                marke.art === "bestaetigt"
                    ? MARKE_BESTAETIGT_PX
                    : marke.art === "fehler"
                      ? MARKE_FEHLER_PX
                      : MARKE_FREI_PX,
        });
    }
    const steuergriffe: NonNullable<Bild["steuergriffe"]>[number][] = [];
    const griff = art.steuergriff;
    if (griff !== undefined)
        for (const teil of zustand.teile) {
            const at = teil.art === "punkt" ? undefined : griff.lage(teil);
            if (at === undefined) continue;
            const aktiv = zustand.gesteuert?.objekt === teil.objekt && zustand.gesteuert.nr === teil.nr;
            steuergriffe.push({ at, objekt: teil.objekt, nr: teil.nr, aktiv });
        }
    return {
        linien,
        anfasser,
        steuergriffe,
        andock: zustand.andock.map((ziel) => ziel.at),
        ringe,
        ...(teilung === undefined ? {} : { teilung: teilung.punkte }),
    };
}
