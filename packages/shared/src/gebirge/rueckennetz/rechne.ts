/**
 * Ein Gebirge aus dem Rückennetz (WI-0246; Entwurf Meilensteine 1 bis 4, abgenommen als Bauvorlage V16/V17): V12-Eingabe rein, Raster
 * der V12 heraus (Schritt, Zeile 0 = Süden, `eigen`), dazu das Netz zum Einblenden. Netz aus gezeichneten Kämmen (`kaemme.ts`), sonst
 * selbst erzeugt (`netz.ts`, Rückfall); Hebung in `hebung.ts`; Täler, Erosion, Pässe und Senkenfüllung in `landschaft.ts`.
 *
 * Massigkeit, Grat zuerst (Hauptorchestrierung 2026-10-20, Entscheidung A): Ohne eigenen Talboden wird der höchste gesucht, bei dem die
 * Landschaft das Ziel (HI-Band des Typs oder die Durchschnittshöhe des Gebirges) noch nicht überschreitet und der Grat der gezeichneten
 * Kanten über der Schwelle des Typs bleibt.
 */
import { pointInGeometry } from "../geometry.ts";
import { andockRahmen, baueRaster, mitAndockStreifen, type Raster } from "../raster.ts";
import { spannbaum } from "../ridge.ts";
import type { V12Bounds, V12Input } from "../types.ts";
import { schneideAus, type RueckenRaster } from "./ausschnitt.ts";
import { GRAT_MIN_VORSCHLAG, GRAT_PROBEN_JE_KANTE, messeGrat, quantil } from "./grat.ts";
import { hebe, type FormRegler } from "./hebung.ts";
import { formeKoepfe, type KopfForm, type KopfPunkt } from "./koepfe.ts";
import { HI_BAND_VORSCHLAG, hypsometrischesIntegral, type HiBand } from "./hypsometrie.ts";
import { baueAusKaemmen, durchhangAus, type GezeichneterKamm, type HoehenPunkt } from "./kaemme.ts";
import { formeLandschaft } from "./landschaft.ts";
import type { Pass } from "./paesse.ts";
import { baueRueckennetz, type Rueckennetz } from "./netz.ts";
import { hatPunktHoehen } from "./netz-vertrag.ts";
import { drueckeSenken, type MuldeEingabe } from "./senken.ts";
import { eigeneZiele, triffPunkte } from "./treffen.ts";
import { TYPEN_VORSCHLAG, type TypRegler } from "./typen.ts";

/** Ein Nebengipfel als Eingabe der Rechnung: wie im Netz-Vertrag, die Höhe darf fehlen, im Editor mit freier Kennung. */
export interface NebengipfelEingabe {
    id?: string;
    x: number;
    y: number;
    /** Höhe in Schritt; fehlt sie, gilt die Vorgabe (`nebengipfelVorgabe`). */
    h?: number | null;
}

/** Die Linie ohne ihre Punkthöhen (Vorgaben an allen Stützpunkten): was die Ableitung des Talbodens sieht. */
const ohnePunktHoehen = (linie: GezeichneterKamm): GezeichneterKamm => {
    const kopie = { ...linie };
    delete kopie.hoehen;
    return kopie;
};

/** VORSCHLAG: höchster Talboden, den die Ableitung setzt (Anteil der Kammhöhe). */
export const TALBODEN_GRENZE = 0.85;
/** Gemessen: Grat der Landschaft auf 0,25 E gegen 0,5 E (vorsichtiger Wert aus 1,03–1,31). */
export const GRAT_AUFLOESUNG = 1.1;

/** VORSCHLAG: ein Nebengipfel ohne eigene Höhe steht auf 80 % der Kammhöhe. */
export const NEBENGIPFEL_ANTEIL = 0.8;

/** Mittelhöhe über die Fläche (Schritt), wie die Durchschnittshöhe des Geländelaufs. */
function mittelhoehe(h: ArrayLike<number>, eigen: ArrayLike<number>): number {
    let summe = 0;
    let n = 0;
    for (let k = 0; k < h.length; k++) {
        if (!eigen[k]) continue;
        summe += h[k] as number;
        n++;
    }
    return n > 0 ? summe / n : 0;
}

/**
 * Höhe eines Nebengipfels ohne eigene Höhe, aus Kammhöhe und Typ (VORSCHLAG): 80 % der Kammhöhe, aber mindestens 10 % über dem Talboden
 * des Typs, sonst läge er beim Plateau (Talboden 85 %) unter der Hochfläche und würde eine Mulde.
 */
export function nebengipfelVorgabe(kamm: number, talboden: number): number {
    return Math.round(Math.max(NEBENGIPFEL_ANTEIL, Math.min(1, talboden + 0.1)) * kamm);
}

export interface RueckenErgebnis {
    w: number;
    hh: number;
    cell: number;
    bounds: V12Input["bounds"];
    eigen: Uint8Array;
    h: Float64Array;
    netz: Rueckennetz;
    /** 1, wo eine Senke gewollt ist (See, Talachse, gezeichnetes Tal, Mulde); in der Grundform nur Tal und Mulde. */
    senke: Uint8Array;
    /** Die Nebengipfel, wie gerechnet (mit Höhe). */
    nebengipfel: { x: number; y: number; h: number }[];
    /** Wirksamer Talboden (abgeleitet, eigener oder der des Typs) und das Band des Typs. */
    talboden: number;
    hiBand: HiBand | null;
    ms: number;
}

export interface RueckenOptionen {
    /** Gezeichnete Kämme mit Vorrang; sonst `input.kaemme`, ohne Kamm erzeugt das Modell das Netz selbst (Rückfall). */
    kaemme?: readonly GezeichneterKamm[];
    /** „landschaft“ (Vorgabe): mit Tälern, Erosion und Senkenfüllung; „grundform“: nur die Hebung (schnell, zum Ziehen). */
    stufe?: "grundform" | "landschaft";
    /** Passrouten (Linienzüge in E); sonst `input.paesse`. */
    paesse?: readonly Pass[];
    /** Nebengipfel (nicht kanonisch), Höhe optional; sonst `input.nebengipfel`. */
    nebengipfel?: readonly NebengipfelEingabe[];
    /** Mulden (Gegengipfel, `senken.ts`), Boden optional; sonst `input.mulden`. Täler kommen mit den Kämmen (Rang `tal`). */
    mulden?: readonly MuldeEingabe[];
    /** Talboden ableiten (Vorgabe ja). Nein = Talboden des Typs. */
    hypsometrie?: boolean;
    /** Fester Talboden statt der Ableitung (eigener Wert des Gebirges, oder `e.talboden` einer früheren Rechnung beim Ziehen). */
    talbodenFest?: number | undefined;
    /** Typname für HI-Band und Gratschwelle aus dem Vorschlag, wenn `typ` eigene Regler sind. */
    bandVon?: string;
    /** HI-Band und Gratschwelle direkt (aus der Fassung); gehen `bandVon` vor. */
    band?: HiBand | null;
    gratMin?: number;
    /** Durchschnittshöhe des Gebirges (Schritt, Betreiber C3 2026-09-27): Ziel der Ableitung statt des HI-Bands. */
    mittelZiel?: number;
    /**
     * Fassung 19 (WI-0249 P9, Betreiber 2026-10-25: „nebengipfel- und muldenhöhen sollen den talboden auch nicht mehr verschieben, aber nur in
     * fassung 19“): Die Ableitung des Talbodens rechnet auch ohne die Höhen der Nebengipfel und Mulden (wie ohne die Punkthöhen der Linien).
     * Fehlt der Schalter (Fassung 17 und 18), zählen sie in der Ableitung wie zuvor.
     */
    punktHoehenAbsolut?: boolean;
    /**
     * Nur intern (die Proben der Talboden-Ableitung): `false` heftet die Punkte mit eigener Höhe nicht an (`treffen.ts`). Sonst heftet die Rechnung
     * mit `punktHoehenAbsolut` (Fassung 19) nach der Landschaft jeden Punkt mit eigener Höhe auf diese Höhe (Vali wählte: Punkt trifft seine Höhe).
     */
    treffen?: false;
    /**
     * Nur dieser Rahmen (E), mit überlappendem Rand (`ausschnitt.ts`); nur für die Vorschau großer Gebirge. Netz und Randabstand kommen
     * aus der ganzen Fläche; den Talboden leitet der Ausschnitt nicht ab (`talbodenFest` aus der groben Rechnung, sonst der des Typs).
     */
    ausschnitt?: V12Bounds;
    /**
     * Phasen der Rechnung (WI-0249 P6, fürs Terrain-Lab): Name und Dauer in ms je Abschnitt, in ihrer Folge: `raster`, `talboden` (nur mit
     * Ableitung; ihre Proben melden nichts), `netz`, `hebung`, `koepfe` (mit Köpfen), `senken`, `naehe`, `landschaft/taeler`,
     * `landschaft/erosion`, `landschaft/erhalt`, `landschaft/paesse`, `landschaft/koepfe`, `landschaft/senken`, `treffen` (Fassung 19 mit eigenen
     * Höhen). Nur melden: Ohne ihn und mit ihm rechnet alles Zeichen für Zeichen gleich.
     */
    phase?: (name: string, ms: number) => void;
    /** Zellmitten auf dem Gitter des Geländes (`RueckennetzRegler.gitter`, WI-0249 P2); nur wenn die Zellweite der Rechnung passt. */
    gitter?: { zelle: number; mitte: number };
}

/** Der Rahmen der Fläche nach außen auf das Gitter gelegt: Seine Ecken sind Zellmitten `mitte + k · zelle`. */
export function rahmenAufGitter(b: V12Bounds, gitter: { zelle: number; mitte: number }): V12Bounds {
    const unter = (v: number) => gitter.mitte + Math.floor((v - gitter.mitte) / gitter.zelle) * gitter.zelle;
    const ueber = (v: number) => gitter.mitte + Math.ceil((v - gitter.mitte) / gitter.zelle) * gitter.zelle;
    return { min_x: unter(b.min_x), min_y: unter(b.min_y), max_x: ueber(b.max_x), max_y: ueber(b.max_y) };
}

/** `typ` ist ein Schlüssel aus `TYPEN_VORSCHLAG` oder eigene Regler. Wirft, wenn der Ausschnitt die Fläche nicht trifft. */
export function rechneRueckennetz(
    input: V12Input,
    typ: string | TypRegler,
    optionen: RueckenOptionen = {},
): RueckenErgebnis {
    const start = performance.now();
    let marke = start;
    const melde = optionen.phase
        ? (name: string): void => {
              const jetzt = performance.now();
              optionen.phase!(name, jetzt - marke);
              marke = jetzt;
          }
        : undefined;
    const basis = typeof typ === "string" ? (TYPEN_VORSCHLAG[typ] ?? TYPEN_VORSCHLAG["kettengebirge"]!) : typ;
    const werte = input.regler;
    const regler = {
        ...basis,
        form: {
            ...basis.form,
            ...(werte.plateau !== undefined ? { schaerfe: werte.plateau } : {}),
            ...(werte.rauschen !== undefined ? { rauschen: werte.rauschen } : {}),
            ...(werte.erosion !== undefined ? { erosion: werte.erosion } : {}),
            ...(werte.koernung !== undefined
                ? {
                      koernung:
                          Math.max(input.bounds.max_x - input.bounds.min_x, input.bounds.max_y - input.bounds.min_y) /
                          Math.max(1, werte.koernung),
                  }
                : {}),
        },
    };
    const zelleRoh = input.zelle ?? 0.25;
    // Auf dem Gitter des Geländes (WI-0249 P2): nur der Rahmen des Rasters, alles andere (Körnung, Netz) bleibt am Rahmen der Fläche.
    const rahmenRoh = andockRahmen(input.bounds, input.andock);
    const rahmen =
        optionen.gitter && Math.abs(optionen.gitter.zelle - zelleRoh) < 1e-12
            ? rahmenAufGitter(rahmenRoh, optionen.gitter)
            : rahmenRoh;
    const ganz = mitAndockStreifen(
        baueRaster(rahmen, zelleRoh, (x, y) => pointInGeometry([x, y], input.geometry), input.vorschauZelleMin),
        input.andock,
    );
    const ausschnitt = optionen.ausschnitt ? schneideAus(ganz, optionen.ausschnitt) : null;
    if (optionen.ausschnitt && !ausschnitt) throw new RangeError("Der Ausschnitt trifft das Gebirge nicht.");
    // Gerechnet wird im Ausschnitt; das Netz kommt immer aus der ganzen Fläche (Äste laufen bis zum echten Umriss).
    const r: RueckenRaster = ausschnitt ?? ganz;
    melde?.("raster");
    const saat = Number.isFinite(Number(input.saat)) ? Number(input.saat) : 12345;
    const kamm = Number(input.regler?.maximalhoehe) > 0 ? Number(input.regler.maximalhoehe) : 1500;
    const peaks = Array.isArray(input.peaks) ? input.peaks : [];
    const nebenRoh: readonly NebengipfelEingabe[] = optionen.nebengipfel ?? input.nebengipfel ?? [];
    // Jeder gesetzte Nebengipfel zählt (Betreiber 2026-10-23, WI-0249): Kein Filter nach Nähe zu einem Gipfel, einem anderen Nebengipfel oder
    // einem Fluss. Eng benachbarte Punkte bilden gemeinsame Flanken, schmale Sättel oder ein Massiv; gesetzte Positionen und kanonische
    // Gipfelhöhen bleiben. Ein Fluss fließt weiter talwärts: `formeLandschaft` schneidet die Läufe zuletzt ein, auch durch eine Erhebung.
    // Köpfe (WI-0249 P2, `koepfe.ts`): Mindestprominenz der gesetzten Punkte; ohne den Typwert rechnet alles wie zuvor. Mit Köpfen
    // rechnet ein Nebengipfel knapp am Umriss, dessen Zelle schon außerhalb liegt, an der nächsten Zelle der Fläche (höchstens zwei
    // Zellen weit); sonst fiele er aus der Rechnung. Gemeldet wird er an seiner gesetzten Lage.
    const kopf = Math.max(0, Number(regler.form.kopf) || 0);
    // Kegel der Köpfe (Typwert `form.kopfNeigung`) mit Sockel, in der Grundform und nach der Erosion der Landschaft wieder: Sonst trägt die
    // Erosion den Körper ab, und `sichereGipfel` setzt danach nur die Zelle des Punkts zurück (eine Spitze von einer Zelle).
    const kopfNeigung = Math.max(0, Number(regler.form.kopfNeigung) || 0);
    const kopfForm: KopfForm | undefined = kopfNeigung > 0 ? { neigung: kopfNeigung } : undefined;
    const nebenBehalten = kopf > 0 ? nebenRoh.map((n) => inDieFlaeche(ganz, n)) : nebenRoh;
    const sattel = Number.isFinite(Number(input.regler?.sattel)) ? Number(input.regler.sattel) : 0.85;
    const linien = optionen.kaemme ?? input.kaemme ?? [];
    // Kämme tragen das Netz, Täler drücken danach nach unten (`senken.ts`). Trägt das Gebirge nur Punkte (Nebengipfel, keine Kämme), spannen
    // mit Köpfen die Punkte selbst das Netz auf: Kämme als Spannbaum von Gipfeln und Nebengipfeln, je Kante von Punkt zu Punkt.
    const gezeichneteKaemme = linien.filter((k) => k.rang !== "tal");
    const kaemme =
        kopf > 0 && gezeichneteKaemme.length === 0 && nebenBehalten.length > 0
            ? kaemmeAusPunkten([...peaks, ...nebenBehalten])
            : gezeichneteKaemme;
    const taeler = linien.filter((k) => k.rang === "tal");
    const mulden: readonly MuldeEingabe[] = optionen.mulden ?? input.mulden ?? [];
    const gezeichnet = kaemme.length > 0;
    // Normierung der Formpunkte an der Kammhöhe, eigene Höhen haben Vorrang.
    const mitTalboden = (rNetz: Raster, rHebung: RueckenRaster, talboden: number) => {
        const vorgabe = nebengipfelVorgabe(kamm, talboden);
        const nebengipfel = nebenBehalten.map((n) => ({ x: n.x, y: n.y, h: Number(n.h) > 0 ? Number(n.h) : vorgabe }));
        const hoehenPunkte: HoehenPunkt[] = [
            ...peaks.map((p) => ({ x: p.x, y: p.y, h: Number(p.h) > 0 ? Number(p.h) : kamm })),
            ...nebengipfel,
        ];
        const netz = gezeichnet
            ? baueAusKaemmen(
                  rNetz,
                  kaemme,
                  regler.struktur,
                  saat,
                  hoehenPunkte,
                  kamm,
                  sattel,
                  taeler,
                  durchhangAus(regler.form),
              )
            : baueRueckennetz(input, rNetz, regler.struktur, saat);
        melde?.("netz");
        const grund = hebe(rHebung, netz, { ...regler.form, talboden }, kamm, saat, peaks, nebengipfel, input.regler);
        melde?.("hebung");
        // Jeder gesetzte Punkt ein Kopf; ein Nebengipfel über einer Mulde steigt dabei (seine wirksame Höhe gilt ab hier).
        const wirksam = formeKoepfe(rHebung, grund, kopfPunkte(nebengipfel), kopf * kamm, kopfForm);
        if (kopf > 0) melde?.("koepfe");
        const gesetzt = nebengipfel.map((n, i) => ({ ...n, h: wirksam[i] as number }));
        const gewollt = drueckeSenken(rHebung, grund, taeler, mulden, regler.form, kamm, talboden, saat);
        melde?.("senken");
        return { nebengipfel: kopf > 0 ? gesetzt : nebengipfel, netz, grund, gewollt };
    };
    const kopfPunkte = (nebengipfel: readonly { x: number; y: number; h: number }[]): KopfPunkt[] => [
        ...nebengipfel.map((n) => ({ ...n, fest: false })),
        ...peaks.map((p) => ({ x: p.x, y: p.y, h: Number(p.h) > 0 ? Number(p.h) : kamm, fest: true })),
    ];
    const typName = optionen.bandVon ?? (typeof typ === "string" ? typ : undefined);
    const typBand =
        optionen.band !== undefined
            ? optionen.band
            : typName !== undefined
              ? (HI_BAND_VORSCHLAG[typName] ?? null)
              : null;
    const hiBand =
        werte.hypsometrie !== undefined && werte.hypsometrie > 0
            ? { ziel: werte.hypsometrie, min: werte.hypsometrie, max: werte.hypsometrie }
            : typBand;
    const gratMin = optionen.gratMin ?? (typName !== undefined ? GRAT_MIN_VORSCHLAG[typName] : undefined) ?? 0.1;
    const mittelZiel = Number(optionen.mittelZiel) > 0 ? Number(optionen.mittelZiel) : null;
    // Der Talboden ist ein Anteil der Kammhöhe, kein Anteil eines fremden Gipfels.
    const sockelDach = 1;
    let talboden = Math.min(regler.form.talboden, sockelDach);
    const gesucht =
        !Number.isFinite(optionen.talbodenFest) &&
        (hiBand !== null || mittelZiel !== null) &&
        optionen.hypsometrie !== false &&
        !ausschnitt;
    if (Number.isFinite(optionen.talbodenFest)) talboden = Number(optionen.talbodenFest);
    else if (gesucht) {
        // Geprüft wird an der Landschaft auf 0,5 E (auf 0,75 E ist die Gratlinie nicht aufgelöst): Die Grundform sagt den Grat nicht
        // voraus (Trollzacken, Kette: Landschaft/Grundform 0,97 bis 1,63 je nach Talboden, weil Täler und Erosion den Grat nachschärfen).
        // Eine Massenhülle (Täler zur Kantenhöhe auffüllen) nahm den Grat mit (Trollzacken, Kette: 11 % statt 20 %), sie ist verworfen.
        const zelle = Math.max(0.5, r.cell);
        const obergrenze = Math.min(TALBODEN_GRENZE, sockelDach);
        // Auf 0,25 E liegt der Grat der Landschaft 1,03- bis 1,31-mal über dem auf 0,5 E (Trollzacken, Blutzinnen); vorsichtig 1,1.
        const gratZiel = gratMin / (r.cell < 0.5 ? GRAT_AUFLOESUNG : 1);
        // Die Ableitung sieht die Form ohne die Werte des Formerhalts (WI-0249 P2): Köpfe und Muster am Kamm sollen die Massigkeit nicht
        // umsteuern (Trollzacken, Rauschen 0,95: ohne Musterbuckel auf dem Kamm hielt der Grat einen Talboden von 0,63 statt 0,33 aus, die
        // Vorschau wurde fast doppelt so hoch). Trägt das Gebirge nur Punkte, rechnet die Probe mit denselben Kämmen aus dem Spannbaum.
        // Ebenso ohne Durchhang: Er senkt die Sättel, der Talboden soll deshalb nicht steigen.
        const formAbleitung: FormRegler = { ...regler.form };
        delete formAbleitung.kopf;
        delete formAbleitung.kammMuster;
        delete formAbleitung.kopfNeigung;
        delete formAbleitung.durchhang;
        delete formAbleitung.durchhangNeben;
        // Eigene Punkthöhen der Linien (WI-0249 P9) sind absolut und steuern die Ableitung nicht: Sonst höbe ein höherer Punkt die Massigkeit (HI) oder
        // die Durchschnittshöhe an, und die Suche senkte den Talboden, bis der Rest des Gebirges unter seiner Höhe läge (Betreiber 2026-10-25: „wenn ich
        // einen gipfel erhöhe, dann senkt sich das restliche gebirge ab“). Die Probe rechnet die Linien ohne ihre Punkthöhen; ohne eigene Punkthöhen
        // bleibt alles wie zuvor.
        const ableitungsLinien = kaemme === gezeichneteKaemme ? linien : [...kaemme, ...taeler];
        const kaemmeAbleitung = ableitungsLinien.some(hatPunktHoehen)
            ? { kaemme: ableitungsLinien.map(ohnePunktHoehen) }
            : kaemme === gezeichneteKaemme
              ? {}
              : { kaemme: ableitungsLinien };
        const probeOptionen: RueckenOptionen = {
            ...optionen,
            ...kaemmeAbleitung,
            stufe: "landschaft",
            hypsometrie: false,
            talbodenFest: undefined,
            // Die Probe heftet nichts an: Eigene Höhen steuern die Ableitung nicht (WI-0249, Punkt trifft seine Höhe).
            treffen: false,
            // Fassung 19: Nebengipfel und Mulden ohne eigene Höhe (die Vorgabe der Probe), ihre Höhen verschieben den Talboden nicht.
            ...(optionen.punktHoehenAbsolut === true
                ? {
                      nebengipfel: nebenRoh.map((n) => ({ ...n, h: null })),
                      mulden: mulden.map((m) => ({ ...m, h: null })),
                  }
                : {}),
        };
        delete probeOptionen.phase;
        const passt = (tb: number, nurGrat = false): boolean => {
            const probe = rechneRueckennetz(
                { ...input, zelle },
                { struktur: regler.struktur, form: { ...formAbleitung, talboden: tb } },
                probeOptionen,
            );
            if (!nurGrat) {
                const zuMassig =
                    mittelZiel !== null
                        ? mittelhoehe(probe.h, probe.eigen) >= mittelZiel
                        : hypsometrischesIntegral(probe.h, probe.eigen) >= hiBand!.ziel;
                if (zuMassig) return false;
            }
            if (!gezeichnet) return true;
            // Zweite Bedingung: Der Grat der gezeichneten Kanten bleibt über der Schwelle des Typs, keine Kante mit Messlänge konkav.
            // So wird das HI so hoch, wie es ohne Gratverlust geht (Ehernes Schwert, Kette, ohne Bedingung: HI 0,42, Grat 11,6 %).
            const gm = messeGrat(probe, kaemme, kamm, 1.5, regler.form.randBreite);
            if (!gm.alle.length) return true;
            return (
                quantil(gm.alle, 0.5) >= gratZiel &&
                gm.jeKante.every((k) => k.proben < GRAT_PROBEN_JE_KANTE || k.median >= 0)
            );
        };
        // Höchster Talboden, bei dem beides noch passt; beides ist (näherungsweise) monoton im Talboden.
        if (obergrenze > talboden && passt(talboden)) {
            let unten = talboden;
            let oben = obergrenze;
            if (passt(oben)) talboden = oben;
            else {
                for (let schritt = 0; schritt < 6; schritt++) {
                    const mitte = (unten + oben) / 2;
                    if (passt(mitte)) unten = mitte;
                    else oben = mitte;
                }
                talboden = unten;
            }
        } else if (!passt(talboden)) {
            // Grat zuerst: Ist schon der Talboden des Typs zu hoch für einen sichtbaren Grat (Trollzacken als Plateau: 4 % bei 0,85),
            // senken bis zum höchsten Wert, bei dem der Grat steht.
            let unten = 0;
            let oben = talboden;
            for (let schritt = 0; schritt < 6; schritt++) {
                const mitte = (unten + oben) / 2;
                if (passt(mitte)) unten = mitte;
                else oben = mitte;
            }
            talboden = unten;
        }
    }
    if (gesucht) melde?.("talboden");
    const { nebengipfel, netz, grund, gewollt } = mitTalboden(ganz, r, talboden);
    // Nähe zu den Strängen (gezeichnet oder erzeugt), 1 bis 0,25 E, weich auf 0 bei 1 E: dort gilt ein höherer Erhalt (`GRAT_ERHALT`).
    const gratNaehe = new Float32Array(r.w * r.hh);
    for (const kante of netz.kanten) {
        if (kante.art !== "strang") continue;
        for (let s = 1; s < kante.punkte.length; s++) {
            const [ax, ay] = kante.punkte[s - 1]!;
            const [bx, by] = kante.punkte[s]!;
            const l = Math.hypot(bx - ax, by - ay);
            for (let u = 0; u <= l; u += r.cell / 2) {
                const x = ax + ((bx - ax) * u) / (l || 1);
                const y = ay + ((by - ay) * u) / (l || 1);
                for (let j = Math.max(0, r.j(y - 1)); j <= Math.min(r.hh - 1, r.j(y + 1)); j++)
                    for (let i = Math.max(0, r.i(x - 1)); i <= Math.min(r.w - 1, r.i(x + 1)); i++) {
                        const k = j * r.w + i;
                        if (!r.drin[k]) continue;
                        const f = Math.max(0, Math.min(1, (Math.hypot(r.x(i) - x, r.y(j) - y) - 0.25) / 0.75));
                        const g = 1 - f * f * (3 - 2 * f);
                        if (g > (gratNaehe[k] as number)) gratNaehe[k] = g;
                    }
            }
        }
    }
    melde?.("naehe");
    const landschaft =
        optionen.stufe === "grundform"
            ? null
            : formeLandschaft(
                  r,
                  grund,
                  input,
                  regler.form.erosion,
                  kamm,
                  regler.form.erhalt,
                  optionen.paesse ?? input.paesse ?? [],
                  nebengipfel,
                  regler.form.randBreite,
                  gratNaehe,
                  gewollt,
                  kopf > 0
                      ? {
                            punkte: kopfPunkte(nebengipfel),
                            prominenz: kopf * kamm,
                            ...(kopfForm ? { form: kopfForm } : {}),
                        }
                      : undefined,
                  melde,
              );
    const h = landschaft?.h ?? grund;
    const senke = landschaft?.senke ?? gewollt;
    // Fassung 19 (WI-0249; Vali wählte: Punkt trifft seine Höhe, 2026-10-26): Jeder Punkt mit eigener Höhe trifft sie nach der Landschaft;
    // Auslaufen und Rinnen wirken nur dazwischen (`treffen.ts`). Ein Fluss oder See mit eigenen Höhen wirkt wie ein gezeichnetes Tal (WI-0259):
    // Das Umland folgt seinen Höhen, Bett und See bleiben. Ohne eigene Höhen und in Fassung 17 und 18 Zeichen für Zeichen wie zuvor.
    if (landschaft && optionen.punktHoehenAbsolut === true && optionen.treffen !== false) {
        const ziele = eigeneZiele({
            kaemme: linien,
            nebengipfel: nebenRoh.map((n) => ({ x: n.x, y: n.y, h: Number(n.h) > 0 ? Number(n.h) : null })),
            mulden: mulden.map((m) => ({ x: m.x, y: m.y, h: m.h ?? null })),
            seen: input.seen,
            fluesse: input.fluesse,
            flussHoehen: input.flussHoehen,
            seeHoehen: input.seeHoehen,
            geometry: input.geometry,
        });
        if (ziele.punkte.length > 0) {
            // Im Kern eines Punkts jede Zelle der Fläche; im Kern einer Strecke und eines Flusspunkts kein Wasser (Fluss, See: Senke, aber nicht
            // gewollt); im Abfall keine Senke, damit Flüsse fallen und Seen eben bleiben und gezeichnete Täler und Mulden ihre Form behalten.
            triffPunkte(
                {
                    w: r.w,
                    hh: r.hh,
                    cell: r.cell,
                    x0: r.bounds.min_x,
                    y0: r.bounds.min_y,
                    h,
                    darf: (k, art) =>
                        r.drin[k] === 1 &&
                        (art === "punkt" || (art === "strecke" ? !(senke[k] && !gewollt[k]) : !senke[k])),
                },
                ziele,
            );
            melde?.("treffen");
        }
    }
    // Der Streifen hinter einer gemeinsamen Grenze ist nur Rechengebiet (`mitAndockStreifen`): Dort steht nichts.
    if (r.eigen !== r.drin) for (let k = 0; k < h.length; k++) if (!r.eigen[k]) h[k] = 0;
    return {
        w: r.w,
        hh: r.hh,
        cell: r.cell,
        bounds: r.bounds,
        eigen: r.eigen,
        h,
        netz,
        senke,
        nebengipfel:
            kopf > 0
                ? (landschaft?.nebengipfel ?? nebengipfel).map((n, i) => ({
                      ...n,
                      x: nebenRoh[i]!.x,
                      y: nebenRoh[i]!.y,
                  }))
                : nebengipfel,
        talboden,
        hiBand,
        ms: performance.now() - start,
    };
}

/**
 * Kämme aus gesetzten Punkten (WI-0249 P2): der Spannbaum von Gipfeln und Nebengipfeln, je Kante ein Nebenkamm von Punkt zu Punkt. Beide
 * Enden liegen auf ihren Punkten und tragen deren Höhe (`baueAusKaemmen`), dazwischen hängt der Kamm durch wie zwischen gezeichneten Gipfeln.
 */
export function kaemmeAusPunkten(punkte: readonly { x: number; y: number }[]): GezeichneterKamm[] {
    return spannbaum(punkte).map(([a, b]) => ({
        punkte: [
            [punkte[a]!.x, punkte[a]!.y],
            [punkte[b]!.x, punkte[b]!.y],
        ],
        rang: "neben",
    }));
}

/** Ein Punkt, dessen Zelle außerhalb der Fläche liegt, an die Mitte der nächsten Zelle der Fläche (bis zwei Zellen); sonst unverändert. */
function inDieFlaeche<T extends { x: number; y: number }>(r: Raster, p: T): T {
    const pi = r.i(p.x);
    const pj = r.j(p.y);
    if (pi >= 0 && pj >= 0 && pi < r.w && pj < r.hh && r.drin[pj * r.w + pi]) return p;
    let beste: { x: number; y: number; d: number } | null = null;
    for (let j = Math.max(0, pj - 2); j <= Math.min(r.hh - 1, pj + 2); j++)
        for (let i = Math.max(0, pi - 2); i <= Math.min(r.w - 1, pi + 2); i++) {
            if (!r.drin[j * r.w + i]) continue;
            const d = Math.hypot(r.x(i) - p.x, r.y(j) - p.y);
            if (beste === null || d < beste.d) beste = { x: r.x(i), y: r.y(j), d };
        }
    return beste === null ? p : { ...p, x: beste.x, y: beste.y };
}
