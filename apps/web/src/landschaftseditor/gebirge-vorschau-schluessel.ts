import type { EditorGebirge } from "@avesmaps3d/shared";
import type { GebirgsEntwurf } from "./gebirge-stand";

/**
 * Woran die Vorschau des Gebirges erkennt, dass sich NUR die Höhe eines Punkts geändert hat (WI-0249 P9; Betreiber 2026-10-25, Stage:
 * „kammhöhen, lassen sich nicht in der höhe verschieben. das gebirge drumrum senkt sich ab“).
 *
 * Gemessen am Gebirge Blutzinnen (Fassung 19, Kette, ein Kammpunkt um 600 Schritt gehoben): Die Punkthöhen stehen im Netz, und mit dem Netz
 * im Schlüssel des Talboden-Speichers fand die grobe Vorschau nach jedem Ziehen keinen gemerkten Talboden mehr und rechnete mit dem des Typs
 * (0,2 statt 0,85): Das Gelände fern vom Punkt lag im Mittel 527 Schritt tiefer (bis 1.561), bis die feine Rechnung nach Sekunden den
 * abgeleiteten Talboden wiederfand. Und das Ende der Höhenskala wanderte mit dem höchsten Punkt (2.317 → 3.400): Eine Zelle fern vom Punkt
 * mit unveränderter Höhe wurde dunkler (Blauanteil 142 → 102), die Schummerung flacher (Überhöhung 1,73 → 1,18).
 *
 * Eine Punkthöhe ist absolut: Sie ändert die Ableitung des Talbodens nicht (`rechneRueckennetz`, `punktHoehenAbsolut`), also auch keinen der
 * beiden Schlüssel. Verschiebt, ergänzt oder löscht man einen Punkt, ändern sich beide wie zuvor.
 */

type Netz = EditorGebirge["stand"]["netz"];

/** Das Netz ohne die Höhen seiner Punkte: Lage, Rang und Folge bleiben, jede Höhe ist die Vorgabe (`null`, bei Linien kein Feld). */
export function netzOhnePunktHoehen(netz: Netz): Netz {
    return {
        kaemme: netz.kaemme.map((kamm) => {
            const kopie = { ...kamm };
            delete kopie.hoehen;
            return kopie;
        }),
        nebengipfel: netz.nebengipfel.map((n) => ({ ...n, h: null })),
        ...(netz.mulden === undefined ? {} : { mulden: netz.mulden.map((m) => ({ ...m, h: null })) }),
    };
}

/** Der Entwurf mit dem Netz ohne Punkthöhen; ohne Netz bleibt es ohne. */
const ohnePunktHoehen = (s: GebirgsEntwurf): GebirgsEntwurf =>
    s.netz === undefined ? s : { ...s, netz: netzOhnePunktHoehen(s.netz) };

/**
 * Der Schlüssel des Talboden-Speichers (Typ, Gratwerte, Netz): Der abgeleitete Talboden der letzten feinen Rechnung gilt für die grobe
 * Rechnung desselben Gebirges, bis sich etwas ändert, das ihn ändert. Punkthöhen gehören nicht dazu.
 */
export const talbodenSchluessel = (s: GebirgsEntwurf): string =>
    JSON.stringify([s.typ, s.modell?.grat ?? null, s.modell?.gratBreite ?? null, ohnePunktHoehen(s).netz ?? null]);

/**
 * Der Schlüssel der Höhenskala: alles, was das Bild bestimmt (Entwurf des Gebirges, Gipfel der Eingabe mit ihren Höhen, Saat, Grundhöhe),
 * außer den Punkthöhen. Gleicher Schlüssel = das Ende der Skala der letzten feinen Rechnung bleibt stehen, auch wenn ein Punkt höher
 * wird als alles bisher: Die Tönung der übrigen Zellen und die Überhöhung der Schummerung ändern sich dann nicht mit.
 */
export const skalaSchluessel = (
    s: GebirgsEntwurf,
    eingabe: Pick<EditorGebirge["eingabe"], "peaks" | "saat">,
    grundhoehe: number | null,
): string => JSON.stringify([ohnePunktHoehen(s), eingabe.peaks, eingabe.saat, grundhoehe]);

/**
 * Die letzte feine Rechnung samt dem Schlüssel, unter dem sie gilt: Ende der Höhenskala, abgeleiteter Talboden (Rückennetz) und Dauer.
 * Ändert sich unter demselben Schlüssel nur eine Punkthöhe, ist der Talboden derselbe (die Ableitung sieht Punkthöhen nicht,
 * `rechneRueckennetz`, `punktHoehenAbsolut`) und die Rechnung ohne Ableitung billig.
 */
export interface GemerkteSkala {
    readonly schluessel: string;
    readonly hoechste: number;
    readonly talboden?: number | undefined;
    /** Dauer der Rechnung in ms (mit Ableitung des Talbodens, also eher zu hoch). */
    readonly ms?: number | undefined;
}

/** Das gemerkte Ende der Skala, wenn es zu diesem Schlüssel gehört; sonst `undefined` (dann zählt die höchste Stelle der Rechnung). */
export const festeSkala = (gemerkt: GemerkteSkala | undefined, schluessel: string): number | undefined =>
    gemerkt?.schluessel === schluessel ? gemerkt.hoechste : undefined;

/** Der abgeleitete Talboden der letzten feinen Rechnung, wenn sich seither nur Punkthöhen geändert haben; sonst `undefined`. */
export const festerTalboden = (gemerkt: GemerkteSkala | undefined, schluessel: string): number | undefined =>
    gemerkt?.schluessel === schluessel ? gemerkt.talboden : undefined;

/** Bis zu dieser Dauer der letzten feinen Rechnung (ms) rechnet die Vorschau nach einer Änderung nur der Punkthöhen gleich fein, ohne grobes Zwischenbild. */
export const FEIN_OHNE_GROB_MS = 4000;

/**
 * Hat sich seit der letzten feinen Rechnung NUR die Höhe von Punkten geändert (gleicher Schlüssel, Talboden bekannt), und war sie rasch? Dann
 * zeigt die Vorschau gleich das feine Bild und kein grobes davor: Gemessen an Blutzinnen (Fassung 19) lag das grobe Bild im selben Zustand im
 * Mittel 84 Schritt über dem feinen, und der gezogene Punkt sprang auf 2.229, um mit der feinen Rechnung auf 1.683 zu fallen.
 */
export const nurPunkthoeheGeaendert = (gemerkt: GemerkteSkala | undefined, schluessel: string): boolean =>
    gemerkt?.schluessel === schluessel &&
    gemerkt.talboden !== undefined &&
    (gemerkt.ms ?? Infinity) <= FEIN_OHNE_GROB_MS;

/**
 * Der Schlüssel des letzten Talbodens dieses Gebirges (Teilfläche, Typ, Gratwerte), ohne das Netz: Ändert sich das Netz, rechnet die grobe
 * Vorschau mit dem Talboden der letzten feinen Rechnung derselben Art, bis die feine fertig ist, nicht mit dem des Typs (Blutzinnen: 0,2 statt
 * 0,85, das Gelände im Mittel 510 Schritt tiefer).
 */
export const talbodenArtSchluessel = (flaeche: string, s: GebirgsEntwurf): string =>
    JSON.stringify([flaeche, s.typ, s.modell?.grat ?? null, s.modell?.gratBreite ?? null]);
