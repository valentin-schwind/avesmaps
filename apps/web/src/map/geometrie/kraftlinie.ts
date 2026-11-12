import {
    clampPowerlineCurve,
    powerlineCurveNormalOffset,
    powerlineCurveSign,
    powerlineDrawnPath,
} from "@avesmaps3d/shared";
import type { GeometrieArt, Punkt, Steuergriff, Teil } from "./geometrie";
import { deckungsgleich } from "./rechnung";

/**
 * Die Kraftlinie im Geometrie-Modul (WI-0205 Paket K7; Blatt Kraftlinien; EDIT-0003 T28; Tafel im Kopf von `geometrie.ts`).
 *
 * - **Ein Teil je Abschnitt**: zwei Punkte, die Lagen seiner Knoten (Ort, Beschriftung oder Kraftlinienpunkt). `Teil.objekt` ist der
 *   Abschnitt (`powerline.public_id`), `Teil.revision` seine Revision, `Teil.wert` sein Bogen (`curve`, Prozent der Sehne).
 * - **Rundung** ist Legacys Parabel aus `@avesmaps3d/shared` (`powerlineDrawnPath`), dieselbe Rechnung wie die Karte und die abgeleitete
 *   Bahn (`drawn_geom`): keine zweite Formel.
 * - **Enden** rasten an Orten mit Nodix (`ort`), Beschriftungen mit Nodix (`label`) und Kraftlinienpunkten (`ecke`) ein; welche das sind,
 *   liefert der Aufrufer (`GeometrieEingabe.ziele`). Nie am anderen Ende desselben Abschnitts. Ein Ende ohne Ziel setzt nichts (R4);
 *   das entscheidet der Aufrufer an der Handbewegung (`treffer` fehlt).
 * - **Strg löst nicht** (`loesen: false`): Eine Kraftlinie hängt immer an Nodices, ein gelöstes Ende gibt es nicht (T28 (4), (6)).
 * - **Kein Punkt dazwischen**, keiner wird gelöscht: Nodices kommen über „Nodix anfügen“ und „Nodix herausnehmen“ (R4, R5), nicht
 *   über Doppelklicks auf die Linie.
 * - **Nichts zieht mit**: Die Knoten sind eigene Objekte; ein Ende umzuhängen bewegt keinen Ort und keinen anderen Abschnitt (R6).
 * - **Der Steuergriff** ist der Scheitel des Bogens (Mitte der Sehne, um `h = curve % der Sehne` entlang der Normalen); sein Zug setzt
 *   den Bogen, begrenzt auf ±45 % und auf ganze Prozent gerundet, wie der Regler im Fenster.
 */

/** Die Mitte der Sehne und die Einheitsnormale `(−ty, tx)`, wie `powerlineCurvedPoints` sie rechnet; ohne Länge keine Normale. */
function sehneVon(a: Punkt, b: Punkt): { mitte: Punkt; nx: number; ny: number; laenge: number } {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const laenge = Math.hypot(dx, dy);
    const mitte = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return laenge > 0 ? { mitte, nx: -dy / laenge, ny: dx / laenge, laenge } : { mitte, nx: 0, ny: 0, laenge: 0 };
}

/** Der Scheitel eines Bogens zwischen `a` und `b`: der Punkt der gezeichneten Bahn bei `t = 0,5`. */
export function kraftlinienScheitel(a: Punkt, b: Punkt, curve: number | undefined): Punkt {
    const { mitte, nx, ny } = sehneVon(a, b);
    const versatz = powerlineCurveNormalOffset(curve ?? 0, 0.5, a.x, a.y, b.x, b.y);
    return { x: mitte.x + nx * versatz, y: mitte.y + ny * versatz };
}

/**
 * Der Bogen, dessen Scheitel dem Zeiger am nächsten liegt: der Abstand des Zeigers von der Sehne entlang der Normalen, in Prozent der
 * Sehne, mit dem Vorzeichen der Richtung West → Ost (`powerlineCurveSign`, unabhängig von `from → to`). Begrenzt auf ±45, ganze Prozent.
 */
export function kraftlinienKurve(a: Punkt, b: Punkt, zeiger: Punkt): number {
    const { mitte, nx, ny, laenge } = sehneVon(a, b);
    if (!(laenge > 0)) return 0;
    const abstand = (zeiger.x - mitte.x) * nx + (zeiger.y - mitte.y) * ny;
    const prozent = (100 * abstand) / (laenge * powerlineCurveSign(a.x, a.y, b.x, b.y));
    return Math.round(clampPowerlineCurve(prozent)) || 0;
}

const enden = (teil: Teil): [Punkt, Punkt] | undefined => {
    const a = teil.punkte[0];
    const b = teil.punkte.at(-1);
    return a !== undefined && b !== undefined && teil.punkte.length >= 2 ? [a, b] : undefined;
};

/** Der Scheitel als Steuergriff: Lage aus Enden und Bogen, Wert aus der Lage des Zeigers. */
export const KRAFTLINIEN_SCHEITEL: Steuergriff = {
    lage(teil) {
        const ab = enden(teil);
        return ab ? kraftlinienScheitel(ab[0], ab[1], teil.wert) : undefined;
    },
    wert(teil, zeiger) {
        const ab = enden(teil);
        return ab ? kraftlinienKurve(ab[0], ab[1], zeiger) : (teil.wert ?? 0);
    },
};

export const KRAFTLINIE: GeometrieArt = {
    id: "kraftlinie",
    teilart: "linie",
    rundung: (punkte, teil) => powerlineDrawnPath(punkte, teil?.wert ?? 0),
    ziele: () => ["ort", "label", "ecke"],
    zielErlaubt: (ziel, stelle, teil) => {
        const anderes = stelle.index === 0 ? teil.punkte.at(-1) : teil.punkte[0];
        return anderes === undefined || !deckungsgleich(ziel.at, anderes);
    },
    mindestens: 2,
    loeschbar: () => false,
    einfuegen: false,
    // Jede Handbewegung kommt sofort beim Aufrufer an; er hält den Entwurf, „Fertig“ schreibt (T27 (4)).
    speichern: { art: "sofort" },
    mitziehen: false,
    huelleInRuhe: () => false,
    loesen: false,
    steuergriff: KRAFTLINIEN_SCHEITEL,
};
