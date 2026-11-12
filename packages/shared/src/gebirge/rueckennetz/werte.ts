/**
 * Die Werte des Rückennetzes am Gebirge (WI-0246): die Typwerte aus der Fassung (sonst der Vorschlag im Code) und die drei Werte, die
 * der Reiter „Gebirge“ je Gebirge abweichend setzen kann (Gratlinie, Gratbreite, Talboden).
 * Ohne TypeBox, damit es im Worker der Vorschau läuft. EINE Auflösung für Gelände und Vorschau: `rueckennetzRegler`.
 */
import type { Gebirgstyp, GebirgsPresetGruppe } from "../regler.ts";
import type { FormRegler } from "./hebung.ts";
import type { StrukturRegler } from "./netz.ts";
import { typVorschlag, type RueckennetzTyp } from "./typen.ts";

/**
 * Die drei Werte, die ein Gebirge abweichend setzen kann; Liste und Grenzen führt der Vertrag des Reiters (`GEBIRGS_MODELL_WERTE`,
 * `modell-werte.ts`, Derographie WI-0245). Der Talboden ist ein Anteil der Kammhöhe; ohne eigenen Wert wird er abgeleitet.
 */
export type ModellAbweichung = Partial<Record<"grat" | "gratBreite" | "talboden" | "erosionsfestigkeit", number>>;

/** Gratbreite, wenn ein Typ keine führt (E). */
export const GRAT_BREITE_VORGABE = 0.45;

/** Die Typwerte eines Gebirgstyps: aus der Fassung, sonst der Vorschlag (`TYPEN_VORSCHLAG`). Ohne Typ gilt das Kettengebirge. */
export function rueckennetzTyp(gruppe: GebirgsPresetGruppe | null, typ: Gebirgstyp | null): RueckennetzTyp {
    const name = typ ?? "kettengebirge";
    return gruppe?.typen[name].rueckennetz ?? typVorschlag(name);
}

/**
 * Die Preset-Spalte des Reiters: Gratlinie, Gratbreite und Talboden des Typs; die Erosionsfestigkeit (WI-0249, Fassung 19) hat kein Preset
 * je Typ und steht auf 0 (das Gebirge erodiert wie seine Landschaftsart).
 */
export function rueckennetzVorgabe(
    gruppe: GebirgsPresetGruppe | null,
    typ: Gebirgstyp | null,
): Required<ModellAbweichung> {
    const { form } = rueckennetzTyp(gruppe, typ);
    return {
        grat: form.grat,
        gratBreite: form.gratBreite ?? GRAT_BREITE_VORGABE,
        talboden: form.talboden,
        erosionsfestigkeit: 0,
    };
}

/** Die Regler einer Rechnung: Typwerte mit den Abweichungen des Gebirges. */
export interface RueckennetzRegler {
    struktur: StrukturRegler;
    form: FormRegler;
    band: RueckennetzTyp["band"];
    gratMin: number;
    /** Ein eigener Talboden; null = abgeleitet (aus der Durchschnittshöhe, sonst aus dem HI-Band). */
    talbodenFest: number | null;
    /** Durchschnittshöhe des Gebirges (Schritt, Betreiber C3 2026-09-27); null = nicht gesetzt. */
    mittelZiel: number | null;
    /**
     * Das Gitter des Geländes (WI-0249 P2 Schritt 2): Rechnet die Saat in dieser Zellweite, liegen ihre Zellmitten auf
     * `mitte + k · zelle` wie die des Domänengitters (`terrain/hydrology/grid.ts`). Die Einbettung liest sie dann Zelle für Zelle statt
     * bilinear über zwei Zeilen (an den Blutzinnen 0,48 Zellen versetzt: −89 Schritt Grat). Nur das Gelände setzt es, und nur mit dem
     * Formerhalt der Fassung (`mountainMorphology.rueckennetz`); fehlt es, rechnet die Saat ab dem Rahmen der Fläche wie zuvor.
     */
    gitter?: { zelle: number; mitte: number };
    /**
     * Fassung 19 (WI-0249 P9, Betreiber 2026-10-25): Die Höhen der Nebengipfel und Mulden verschieben den abgeleiteten Talboden nicht
     * (`RueckenOptionen.punktHoehenAbsolut`). Gesetzt, wo die Fassung Presets führt (`gruppe` von `rueckennetzRegler`); in Fassung 17 und 18
     * fehlt das Feld, und alles rechnet Zeichen für Zeichen wie zuvor (auch der Fingerabdruck).
     */
    punktHoehenAbsolut?: true;
}

/** Typwerte und Abweichungen des Gebirges zu den Reglern einer Rechnung (Gelände und Vorschau). */
export function rueckennetzRegler(
    gruppe: GebirgsPresetGruppe | null,
    typ: Gebirgstyp | null,
    abweichung: ModellAbweichung,
    durchschnittshoehe: number | null = null,
): RueckennetzRegler {
    const t = rueckennetzTyp(gruppe, typ);
    return {
        struktur: t.struktur,
        form: {
            ...t.form,
            ...(abweichung.grat !== undefined ? { grat: abweichung.grat } : {}),
            ...(abweichung.gratBreite !== undefined ? { gratBreite: abweichung.gratBreite } : {}),
        },
        band: t.band,
        gratMin: t.gratMin,
        talbodenFest: abweichung.talboden ?? null,
        mittelZiel: durchschnittshoehe !== null && durchschnittshoehe > 0 ? durchschnittshoehe : null,
        ...(gruppe !== null ? { punktHoehenAbsolut: true as const } : {}),
    };
}

/**
 * Rechnet ein Gebirge mit diesem Netz das Rückennetz statt der V12? Mit gezeichneter Linie (Kamm oder Tal) oder Mulde immer (WI-0247); mit
 * Köpfen (Typwert `form.kopf`, WI-0249 P2) auch, wenn es nur Nebengipfel trägt. EINE Regel für Gelände, Vorschau und Weiche.
 */
export function rechnetRueckennetz(
    netz: {
        kaemme?: readonly unknown[] | undefined;
        mulden?: readonly unknown[] | undefined;
        nebengipfel?: readonly unknown[] | undefined;
    },
    kopf: number | undefined,
): boolean {
    if ((netz.kaemme?.length ?? 0) > 0 || (netz.mulden?.length ?? 0) > 0) return true;
    return (Number(kopf) || 0) > 0 && (netz.nebengipfel?.length ?? 0) > 0;
}
