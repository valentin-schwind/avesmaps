/**
 * Die Typwerte des Rückennetzes als einzelne, stellbare Werte (WI-0246; Hauptorchestrierung 2026-10-20: „die Typwerte jetzt stellbar
 * bauen“). Je Gebirgstyp führt die Fassung sie unter `gebirgsPresets.typen.<typ>.rueckennetz`; über „19 (Test)“ verstellt man sie auf der
 * Stage. Eine Kennung ist der Pfad im `RueckennetzTyp` („struktur.welle“, „form.grat“, „band.ziel“, „gratMin“). Die Grenzen sind
 * Spielraum zum Ausprobieren, keine Aussage über sinnvolle Werte; sinnvoll sind die Vorschläge in `typen.ts`.
 *
 * Von der Struktur stehen nur Welle, Astabstand und Astlänge hier: Die übrigen (Abstand, Füllung, Stränge, Wandern) nimmt nur der Rückfall
 * ohne gezeichneten Kamm (`netz.ts`), und den rechnet das Gelände nie (Weiche in `buildMountainRaster`). Die Fassung führt sie trotzdem.
 *
 * Sie wirken nur auf Gebirge mit gezeichneten Kämmen: Eine Änderung rechnet kein Gebirge ohne Kamm neu (`wirksamesRezept`, Server).
 */
import type { RueckennetzTyp } from "./typen.ts";

export interface RueckennetzTypwert {
    id: string;
    gruppe: "struktur" | "form" | "ziel";
    min: number;
    max: number;
    schritt: number;
}

const w = (id: string, gruppe: RueckennetzTypwert["gruppe"], min: number, max: number, schritt: number) =>
    ({ id, gruppe, min, max, schritt }) as const;

export const RUECKENNETZ_TYPWERTE = [
    w("struktur.welle", "struktur", 2, 40, 1),
    w("struktur.astAbstand", "struktur", 0, 10, 0.1),
    w("struktur.astLaenge", "struktur", 0, 1, 0.05),
    w("form.breite", "form", 0.3, 4, 0.05),
    w("form.schaerfe", "form", 0, 1, 0.05),
    w("form.talboden", "form", 0, 0.95, 0.01),
    w("form.rauschen", "form", 0, 0.5, 0.01),
    w("form.koernung", "form", 0.5, 12, 0.5),
    w("form.randBreite", "form", 0.5, 8, 0.5),
    w("form.erosion", "form", 0, 5, 1),
    w("form.erhalt", "form", 0, 1, 0.05),
    w("form.grat", "form", 0, 0.3, 0.01),
    w("form.gratBreite", "form", 0.15, 1.5, 0.05),
    // Köpfe (WI-0249 P2): Mindestprominenz je gesetztem Punkt, Anteil der Kammhöhe; 0 = wie vor P2.
    w("form.kopf", "form", 0, 0.3, 0.01),
    // Muster am Kamm (WI-0249 P2): Anteil des Grundmusters an gezeichneten Kämmen und Gipfeln; 1 = wie vor P2.
    w("form.kammMuster", "form", 0, 1, 0.05),
    // Kopfneigung (WI-0249 P2): Kegel der Nebengipfel nach dem Formmodell der kanonischen Gipfel; 0 = Kopf wie zuvor.
    w("form.kopfNeigung", "form", 0, 1, 0.01),
    // Durchhang (WI-0249 P2): Anteil der Höhe, um den Haupt- und Nebenkämme zwischen ihren Punkten durchhängen; 0 = gerade wie vor P2.
    w("form.durchhang", "form", 0, 0.5, 0.01),
    w("form.durchhangNeben", "form", 0, 0.5, 0.01),
    // Erosion im Gelände (WI-0249 P2): Anteil der hydraulischen Erosion im Endgelände; 1 = voll wie vor P2, 0 = die Vorschau bleibt.
    w("form.gelaendeErosion", "form", 0, 1, 0.05),
    w("band.ziel", "ziel", 0, 1, 0.01),
    w("gratMin", "ziel", 0, 0.4, 0.01),
] as const satisfies readonly RueckennetzTypwert[];
export type RueckennetzTypwertId = (typeof RUECKENNETZ_TYPWERTE)[number]["id"];

const pfad = (id: string): [string, string] | [string] => {
    const [a, b] = id.split(".") as [string, string | undefined];
    return b === undefined ? [a] : [a, b];
};

/** Werte, die vor WI-0249 P2 fehlen, gelten wie zuvor: keine Köpfe, volles Muster am Kamm, kein Durchhang, volle Erosion im Gelände. */
const OHNE_WERT: Readonly<Record<string, number>> = {
    "form.gratBreite": 0.45,
    "form.kopf": 0,
    "form.kammMuster": 1,
    "form.kopfNeigung": 0,
    "form.durchhang": 0,
    "form.durchhangNeben": 0,
    "form.gelaendeErosion": 1,
};

/** Ein Typwert; die Gratbreite fehlt im Vorschlag mancher Typen und gilt dann mit 0,45 E, die Werte von WI-0249 P2 wie zuvor (`OHNE_WERT`). */
export function typwert(typ: RueckennetzTyp, id: string): number {
    const [a, b] = pfad(id);
    const knoten = (typ as unknown as Record<string, unknown>)[a];
    const wert = b === undefined ? knoten : (knoten as Record<string, unknown> | undefined)?.[b];
    if (typeof wert === "number") return wert;
    return OHNE_WERT[id] ?? Number.NaN;
}

/** Derselbe Typ mit einem anderen Wert (unverändertes Original). */
export function mitTypwert(typ: RueckennetzTyp, id: string, wert: number): RueckennetzTyp {
    const [a, b] = pfad(id);
    if (b === undefined) return { ...typ, [a]: wert };
    const knoten = (typ as unknown as Record<string, Record<string, number>>)[a]!;
    return { ...typ, [a]: { ...knoten, [b]: wert } };
}

/** Die Grenzen eines Typwerts; `undefined` für eine unbekannte Kennung. */
export const typwertGrenze = (id: string): RueckennetzTypwert | undefined =>
    RUECKENNETZ_TYPWERTE.find((eintrag) => eintrag.id === id);
