/**
 * Die elf Gebirgstypen auf dem Rückennetz-Modell (VORSCHLAG, Startwerte zum Einstellen im Entwurf; Hauptorchestrierung 2026-10-20:
 * „Preset-Werte für die Typ-Achsen setzt du zunächst als begründete Startwerte, ausdrücklich als Vorschlag gekennzeichnet“).
 * Struktur (Netz) und Form (Hebung) getrennt, wie der Vorschlag es empfiehlt; Höhe kommt aus der Kammhöhe des Gebirges.
 * Begründung je Typ aus den Definitionen in `topographie-19-test/gebirgs-presets-quellen.md` §2 (Abstände der Reihen §3).
 */
import { GRAT_MIN_VORSCHLAG } from "./grat.ts";
import type { FormRegler } from "./hebung.ts";
import { HI_BAND_VORSCHLAG, type HiBand } from "./hypsometrie.ts";
import type { StrukturRegler } from "./netz.ts";

export interface TypRegler {
    struktur: StrukturRegler;
    form: FormRegler;
}

const s = (
    abstand: number,
    fuellung: number,
    straengeMax: number,
    wandern: number,
    welle: number,
    astAbstand: number,
    astLaenge: number,
): StrukturRegler => ({ abstand, fuellung, straengeMax, wandern, welle, astAbstand, astLaenge });
const f = (
    breite: number,
    schaerfe: number,
    talboden: number,
    rauschen: number,
    koernung: number,
    randBreite: number,
    erosion: number,
    erhalt: number,
    grat: number,
    gratBreite = 0.45,
): FormRegler => ({ breite, schaerfe, talboden, rauschen, koernung, randBreite, erosion, erhalt, grat, gratBreite });

/** VORSCHLAG. Folge: Struktur (Abstand, Füllung, Stränge, Wandern, Welle, Astabstand, Astlänge) · Form (Breite, Schärfe, Talboden, Rauschen, Körnung, Rand, Rinnennetz 0–5, Erhalt der Grundform, Gratlinie, Gratbreite in E). */
export const TYPEN_VORSCHLAG: Readonly<Record<string, TypRegler>> = {
    // Eine durchgehende Hauptkammlinie, Seitenkämme untergeordnet: ein Strang, viele kurze Äste.
    kammgebirge: { struktur: s(6, 0.3, 1, 0.3, 14, 2.5, 0.6), form: f(1.1, 0.55, 0.3, 0.12, 4, 3, 3, 0.5, 0.15, 0.45) },
    // Verästelte Kammlinien mit vielen Seitengraten: wenige Stränge, dichte, lange Äste, scharf.
    gratgebirge: {
        struktur: s(5, 0.5, 2, 0.6, 9, 1.8, 0.85),
        form: f(0.8, 0.8, 0.25, 0.14, 3, 2.5, 4, 0.5, 0.2, 0.45),
    },
    // Mehrere parallel gestaffelte Kämme mit Längstälern: 3–5 Stränge, lang, gabeln und vereinigen sich.
    kettengebirge: {
        struktur: s(4, 0.5, 5, 0.5, 12, 2.5, 0.8),
        form: f(1.2, 0.5, 0.2, 0.15, 4, 1.5, 4, 0.5, 0.18, 0.45),
    },
    // Kuppen auf gemeinsamem Fuß ohne durchgehenden Kamm: kurze Stücke, rund, keine Äste.
    kuppengebirge: { struktur: s(3.5, 0.7, 6, 1, 5, 0, 0), form: f(1.6, 0.05, 0.4, 0.2, 3, 3, 3, 0.35, 0.12, 0.45) },
    // Geschlossene Erhebung ohne Hauptrichtung: dichter, kurzer Verbund, hoher Sockel.
    massengebirge: {
        struktur: s(3, 0.85, 8, 0.9, 6, 2.5, 0.5),
        form: f(1.3, 0.25, 0.6, 0.15, 3, 4, 3, 0.4, 0.12, 0.45),
    },
    // Tafel mit Abbruchkante: kaum Stränge, sehr hoher Sockel, steiler Rand.
    plateaugebirge: {
        struktur: s(8, 0.3, 1, 0.2, 20, 0, 0),
        form: f(2.5, 0.1, 0.85, 0.06, 6, 1.5, 1, 0.7, 0.15, 0.45),
    },
    // Eingeebneter Rumpf eines alten Faltengebirges: Ketten wie die Kette, aber breit, rund und niedrig.
    rumpfgebirge: { struktur: s(4.5, 0.7, 4, 0.5, 12, 4, 0.5), form: f(1.8, 0.1, 0.45, 0.1, 5, 4, 5, 0.3, 0.12, 0.45) },
    // Altes, flaches Tafelland: kein Netz, nur der Sockel.
    schild: { struktur: s(10, 0, 1, 0, 20, 0, 0), form: f(3, 0, 0.7, 0.08, 8, 5, 2, 0.3, 0.14, 0.45) },
    // Einzelne Berge aus der Ebene: nur der Gipfel (Netz ohne Stränge), niedriger Sockel.
    inselberg: { struktur: s(10, 0, 1, 0, 20, 0, 0), form: f(1, 0.3, 0.05, 0.05, 3, 1.5, 3, 0.4, 0.1, 0.45) },
    // Zerklüftet, tief eingeschnitten: Struktur aus der Form der Fläche, Hochfläche, scharfe Kanten (Material Karst).
    karst: { struktur: s(5, 0.6, 3, 0.7, 7, 2, 0.5), form: f(1.4, 0.7, 0.65, 0.18, 2.5, 2, 1, 0.7, 0.12, 0.45) },
    // Viele Berge ohne beherrschenden Kamm: weiches, verzweigtes Netz.
    bergland: { struktur: s(3.5, 0.8, 7, 0.9, 6, 2, 0.6), form: f(1.2, 0.2, 0.35, 0.18, 3, 3, 4, 0.35, 0.1, 0.45) },
};

/** Die Typwerte, wie die Fassung sie je Gebirgstyp führt (`gebirgsPresets.typen.<typ>.rueckennetz`): Struktur, Form, HI-Band, Gratschwelle. */
export interface RueckennetzTyp extends TypRegler {
    band: HiBand;
    /** Mindestgrat (Median, Anteil der Höchsthöhe), den die Ableitung des Talbodens hält. */
    gratMin: number;
}

/** Der Vorschlag im Code für einen Typ (unbekannt: Kettengebirge). */
export function typVorschlag(typ: string): RueckennetzTyp {
    const name = typ in TYPEN_VORSCHLAG ? typ : "kettengebirge";
    return { ...TYPEN_VORSCHLAG[name]!, band: HI_BAND_VORSCHLAG[name]!, gratMin: GRAT_MIN_VORSCHLAG[name]! };
}
