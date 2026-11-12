/**
 * Die zwei Stufen ohne Datenbank und ohne Schnappschuss (WI-0250 Phase B):
 *
 * - **vorschau**: `rechneVorschau`, die Rechnung der Gebirge-Vorschau im Editor (Auflösung 1×/2×/4× = 750/375/187,5 m Zellweite), mit den
 *   Reglern und dem Rückennetz des Auftrags.
 * - **saat**: `buildMountainRaster`, die Saat, die das Gelände übernimmt (0,25 E = 750 m, mit Pässen, Talboden aus dem Band abgeleitet).
 *
 * Beide rufen nur öffentliche Funktionen auf. Die Phasenproben bilden die Optionen nach, mit denen diese Funktionen `rechneRueckennetz`
 * aufrufen (`rechnen.ts` der Vorschau, `rueckennetz/raster.ts` der Saat); stimmt eine Probe nicht mit dem Hauptlauf überein, sagt das der
 * Bericht (`ergebnis_gleich`).
 */
import { ausGebirge, METER_JE_E, schritteZuSamples } from "./austausch.ts";
import type { Auftrag } from "./auftrag.ts";
import { baueGebirgsEingabe, type Gebirgsfall } from "./eingabe.ts";
import {
    mitRueckennetz,
    rueckennetzGitter,
    type Eingabe,
    type Generator,
    type GebirgsRaster,
    type Rezept,
} from "./generator.ts";
import { runde } from "./messung.ts";
import { messePhasen } from "./phasen.ts";
import type { Ausfuehrung, Vorbereitet } from "./typen.ts";

type Punkt = { x: number; y: number; h: number | null };

const listeAus = (eingabe: Eingabe, schluessel: string): unknown[] =>
    Array.isArray(eingabe[schluessel]) ? (eingabe[schluessel] as unknown[]) : [];

/** Wie `rechnen.ts` der Vorschau: Punkte ohne Höhe tragen das Feld `h` nicht. */
const punkte = (liste: unknown[]): { x: number; y: number; h?: number }[] =>
    (liste as Punkt[]).map((n) => ({ x: n.x, y: n.y, ...(n.h === null || n.h === undefined ? {} : { h: n.h }) }));

/** Der Typwert `form.kopf` (WI-0249 P2) aus den Formreglern; fehlt er (Stand davor), gilt 0. */
function kopfVon(form: unknown): number | undefined {
    const k = (form as { kopf?: unknown } | null)?.kopf;
    return typeof k === "number" ? k : undefined;
}

function zaehle(eigen: Uint8Array): number {
    let n = 0;
    for (let k = 0; k < eigen.length; k++) if (eigen[k]) n++;
    return n;
}

function ausfuehrung(
    r: GebirgsRaster,
    haupt: string,
    herkunft: Record<string, unknown>,
    zusatz: Record<string, unknown>,
): Ausfuehrung {
    return {
        samples: schritteZuSamples(r.h, r.eigen),
        zellen: r.w * r.hh,
        eigene_zellen: zaehle(r.eigen),
        form: { breite: r.w, hoehe: r.hh, zellgroesse_m: r.cell * METER_JE_E },
        rasters: () => [
            {
                name: haupt,
                raster: ausGebirge(r.h, r.eigen, r.w, r.hh, r.cell, {
                    ...herkunft,
                    grenzen_e: r.bounds,
                    zellweite_e: r.cell,
                }),
            },
        ],
        zusatz: { zelle_e: r.cell, ...zusatz },
        haupt,
    };
}

export function bereiteVorschau(gen: Generator, auftrag: Auftrag, fall: Gebirgsfall, rezept: Rezept): Vorbereitet {
    const v = auftrag.vorschau;
    if (!v) throw new Error("Auftrag ohne vorschau");
    const g = baueGebirgsEingabe(gen, auftrag, fall, rezept);
    const werte: Record<string, unknown> = { ...g.regler };
    delete werte["maximalhoehe"];
    delete werte["muster"];
    const stand = {
        werte,
        muster: g.regler["muster"] ?? null,
        kammhoehe: (g.regler["maximalhoehe"] as number | undefined) ?? null,
    };
    const kaemme = listeAus(g.eingabe, "kaemme");
    const nebengipfel = listeAus(g.eingabe, "nebengipfel");
    const mulden = listeAus(g.eingabe, "mulden");
    // Dieselbe Weiche wie `rechneVorschau` (WI-0249 P2: mit Köpfen auch ein Gebirge nur mit Nebengipfeln).
    const mitNetz = mitRueckennetz(gen, { kaemme, mulden, nebengipfel }, kopfVon(g.rueckennetz.form));
    const ableiten = v.talboden === "ableiten";
    const gruppe = rezept.gebirgsPresets ?? null;
    const aufruf = {
        eingabe: g.eingabe,
        preset: null,
        stand,
        grundhoehe: null,
        kante: v.kante,
        aufloesung: v.aufloesung,
        rueckennetz: {
            kaemme,
            nebengipfel,
            mulden,
            typ: auftrag.typ,
            gruppe,
            modell: auftrag.modell,
            ableiten,
            ...(typeof v.talboden === "number" ? { talbodenFest: v.talboden } : {}),
        },
    };
    const haupt = `vorschau-${String(v.aufloesung)}x`;
    return {
        parameter: {
            stufe: "vorschau",
            regler: g.regler,
            saat: g.saat,
            typ: auftrag.typ,
            modell: auftrag.modell,
            ...v,
            rueckennetz_aktiv: mitNetz,
        },
        async fuehreAus() {
            const e = gen.rechneVorschau(aufruf);
            return ausfuehrung(
                e,
                haupt,
                {
                    generator: "rechneVorschau",
                    stufe: "vorschau",
                    aufloesung: v.aufloesung,
                    gebirge: fall.name,
                    saat: g.saat,
                },
                {
                    intern_ms: runde(e.ms, 1),
                    ...(e.talboden === undefined ? {} : { talboden: e.talboden }),
                    rueckennetz_aktiv: mitNetz,
                },
            );
        },
        async phasen(lauf, hauptFingerprint, wiederholungen) {
            const talboden = lauf.zusatz["talboden"];
            if (!mitNetz || typeof talboden !== "number") return null;
            const r = g.rueckennetz;
            const talbodenFest = typeof v.talboden === "number" ? v.talboden : (r.talbodenFest ?? undefined);
            const sucht = talbodenFest === undefined && ableiten;
            return messePhasen({
                gen,
                eingabe: {
                    ...g.eingabe,
                    regler: gen.gebirge.gebirgsRegler(null, stand, null),
                    zelle: lauf.zusatz["zelle_e"],
                    vorschauZelleMin: Math.max(0.25, 0.1) / v.aufloesung,
                },
                typ: { struktur: r.struktur, form: r.form },
                optionen: {
                    kaemme,
                    nebengipfel: punkte(nebengipfel),
                    mulden: punkte(mulden),
                    hypsometrie: sucht,
                    talbodenFest,
                    band: r.band,
                    gratMin: r.gratMin,
                },
                sucht,
                talboden,
                hauptFingerprint,
                wiederholungen,
                alsFloat32: true,
            });
        },
    };
}

export async function bereiteSaat(
    gen: Generator,
    auftrag: Auftrag,
    fall: Gebirgsfall,
    rezept: Rezept,
): Promise<Vorbereitet> {
    const g = baueGebirgsEingabe(gen, auftrag, fall, rezept);
    // Wie der Server (`loadMountainJobs`, WI-0249 P2): mit dem Formerhalt der Fassung rechnet die Saat auf dem Gitter des Geländes.
    const gitter = await rueckennetzGitter(gen, rezept);
    const regler = gitter ? { ...g.rueckennetz, gitter } : g.rueckennetz;
    const eingabe: Eingabe = { ...g.eingabe, paesse: fall.paesse, rueckennetz: regler };
    const r = g.rueckennetz;
    const mitNetz = mitRueckennetz(
        gen,
        {
            kaemme: listeAus(g.eingabe, "kaemme"),
            mulden: listeAus(g.eingabe, "mulden"),
            nebengipfel: listeAus(g.eingabe, "nebengipfel"),
        },
        kopfVon(r.form),
    );
    return {
        parameter: {
            stufe: "saat",
            regler: g.regler,
            saat: g.saat,
            typ: auftrag.typ,
            modell: auftrag.modell,
            rueckennetz_aktiv: mitNetz,
            rueckennetz_gitter: gitter,
        },
        async fuehreAus() {
            const e = gen.gebirge.buildMountainRaster(eingabe);
            return ausfuehrung(
                e,
                "saat",
                { generator: "buildMountainRaster", stufe: "saat", gebirge: fall.name, saat: g.saat },
                { ...(e.talboden === undefined ? {} : { talboden: e.talboden }), rueckennetz_aktiv: mitNetz },
            );
        },
        async phasen(lauf, hauptFingerprint, wiederholungen) {
            const talboden = lauf.zusatz["talboden"];
            if (!mitNetz || typeof talboden !== "number") return null;
            return messePhasen({
                gen,
                eingabe,
                typ: { struktur: r.struktur, form: r.form },
                optionen: {
                    band: r.band,
                    gratMin: r.gratMin,
                    ...(r.talbodenFest !== null ? { talbodenFest: r.talbodenFest } : {}),
                    ...(r.mittelZiel !== null ? { mittelZiel: r.mittelZiel } : {}),
                    ...(gitter ? { gitter } : {}),
                },
                sucht: r.talbodenFest === null,
                talboden,
                hauptFingerprint,
                wiederholungen,
            });
        },
    };
}
