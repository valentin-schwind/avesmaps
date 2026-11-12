import { anlegenPunkte, type AnlegenArt, type AnlegenEntwurf } from "./anlegen";
import { KRINGEL_ECKE_PX, KRINGEL_KANTE_PX, type Bild } from "./bild";
import type { Punkt, Treffer, Ziel } from "./geometrie";

/**
 * Was der Modus „Anlegen“ zeichnet (`anlegen.ts`), als reine Rechnung; die Schicht (`schicht.ts`) malt es mit denselben Ebenen wie
 * „Geometrie bearbeiten“, also im selben Aussehen (G11):
 *
 * - **Kante** (Knallrot): die gesetzten Punkte, gerundet wie die Karte (beim Ring geschlossen, sobald drei stehen).
 * - **Gummiband** (gestrichelt, Rolle `folge`): vom letzten Punkt zum Zeiger, eingerastet wie der nächste Klick; beim Ring dazu vom
 *   Zeiger zurück zum ersten Punkt.
 * - **Anfasser:** jeder gesetzte Punkt, Anfang und letzter größer. Gezogen wird beim Anlegen nichts; sie zeigen nur, was steht.
 * - **Hülle** um den Zeiger in der Größe des Fangradius, solange der nächste Klick einrasten kann; **Kringel** ums Ziel;
 *   **Andockmarken** an den Zielen um den Zeiger.
 */

/** Das Objekt, unter dem der Entwurf in der Schicht steht. */
export const ANLEGEN_OBJEKT = "anlegen";

export interface AnlegenZeichnung {
    readonly entwurf: AnlegenEntwurf;
    /** Wo der nächste Punkt läge (eingerastet oder frei), solange der Zeiger auf der Karte ist. */
    readonly zeiger?: Punkt | undefined;
    readonly treffer?: Treffer | undefined;
    /** Ob der nächste Klick überhaupt einrasten kann (Hülle um den Zeiger). */
    readonly rastet?: boolean;
    readonly andock: readonly Ziel[];
}

export function anlegenBild(art: AnlegenArt, z: AnlegenZeichnung, fangradius: number): Bild {
    const punkte = anlegenPunkte(z.entwurf);
    const ring = art.teilart === "ring";
    const linien: Bild["linien"][number][] = [];
    const linie = (coords: readonly Punkt[], rolle: "kante" | "folge"): void => {
        if (coords.length >= 2) linien.push({ coords, rolle, objekt: ANLEGEN_OBJEKT, nr: 0 });
    };
    const geschlossen = ring && punkte.length >= 3 ? [...punkte, punkte[0]!] : punkte;
    linie(punkte.length >= 2 ? art.rundung(geschlossen) : [], "kante");
    const letzter = punkte.at(-1);
    if (z.zeiger !== undefined && letzter !== undefined) {
        linie([letzter, z.zeiger], "folge");
        if (ring && punkte.length >= 2) linie([z.zeiger, punkte[0]!], "folge");
    }

    const anfasser = punkte.map((at, index) => ({
        at,
        ende: !ring && (index === 0 || index === punkte.length - 1),
        stelle: { objekt: ANLEGEN_OBJEKT, nr: 0, index },
    }));

    const ringe: Bild["ringe"][number][] = [];
    if (z.zeiger !== undefined && z.rastet === true) ringe.push({ at: z.zeiger, art: "huelle", radius: fangradius });
    if (z.treffer !== undefined) {
        const kante = z.treffer.ziel.art === "kante";
        ringe.push({
            at: z.treffer.at,
            art: kante ? "kringelKante" : "kringel",
            radius: kante ? KRINGEL_KANTE_PX : KRINGEL_ECKE_PX,
        });
    }

    return { linien, anfasser, andock: z.andock.map((ziel) => ziel.at), ringe };
}
