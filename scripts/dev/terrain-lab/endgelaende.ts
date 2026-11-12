/**
 * Die Stufe „endgelaende-lokal“ (WI-0250 Phase B): das Gelände um ein Gebirge mit der ganzen Kette des Generators, so wie der lokale Job
 * (`computeLocalTerrain`, WI-0125/0223) es rechnet. Eingaben aus einem Schnappschuss (nur lesend gezogen, `schnappschuss.ts`); die Saat des
 * Gebirges rechnet der Lauf neu mit den Reglern des Auftrags, setzt sie in den Schnappschuss ein und lässt die grobe Stufe (4096², die GANZE
 * Karte, sie ist domainweit gekoppelt) und die feine Stufe (8192², nur die Rechenkacheln des Gebirges) laufen.
 *
 * Zwei Wege, dasselbe Ergebnis:
 * - Standard: `computeLocalTerrain` selbst. Phasenzeiten aus seinen Rückrufen (`phase`, `coarsePhase`).
 * - Mit `zwischenstaende`: ein Nachbau der drei Schritte von `computeLocalTerrain` (grobe Stufe, `composeFineLocal`, Schlussschritte), weil
 *   die Funktion den Beobachter (`beobachter.ts`) nicht durchreicht. 🪤 Fehlende Schnittstelle: Ein Feld `beobachter` in
 *   `LocalComputeOptions` machte den Nachbau überflüssig; er gehört WI-0249. Der Beobachter ändert das Gelände nicht (Test
 *   `domain-terrain-beobachter.test.ts`), der Fingerabdruck beider Wege ist derselbe.
 *
 * Gemessen wird kein Lauf der ganzen Karte nebenbei: Die grobe Stufe IST ein Lauf der ganzen Karte (rund 3 bis 6 Minuten, mehrere GB).
 */
import { createHash } from "node:crypto";
import type { Auftrag } from "./auftrag.ts";
import { METER_JE_E, samplesFingerprint, schritteZuSamples, type Raster } from "./austausch.ts";
import { baueGebirgsEingabe, type Gebirgsfall } from "./eingabe.ts";
import {
    fordere,
    ladeModul,
    mitRueckennetz,
    rueckennetzGitter,
    rueckennetzNetz,
    type Generator,
    type Rezept,
} from "./generator.ts";
import { aufraeumen, runde, Stoppuhr } from "./messung.ts";
import { ladeSchnappschuss, standardSchnappschuss, type Schnappschuss } from "./schnappschuss.ts";
import type { Ausfuehrung, Vorbereitet, Zwischenstand } from "./typen.ts";

interface Sicht {
    n: number;
    cell: number;
    zeile0: "nord" | "sued";
    hoehe: Float32Array | Uint16Array;
}
type Beobachter = (phase: string, sicht: Sicht) => void;
type Fn = (...args: unknown[]) => unknown;
interface Fenster {
    n: number;
    gx0: number;
    gy0: number;
    w: number;
    h: number;
    cell_e: number;
}

/** Das Fenster um den Rahmen des Gebirges auf einem Gitter der Seite `n` (Zeilen vom Norden gezählt), mit Rand in E. */
export function fensterUm(
    b: { min_x: number; min_y: number; max_x: number; max_y: number },
    rand: number,
    n: number,
): Fenster {
    const cell = 1024 / n;
    const gx0 = Math.max(0, Math.floor((b.min_x - rand) / cell));
    const gx1 = Math.min(n, Math.ceil((b.max_x + rand) / cell));
    const gy0 = Math.max(0, Math.floor((1024 - (b.max_y + rand)) / cell));
    const gy1 = Math.min(n, Math.ceil((1024 - (b.min_y - rand)) / cell));
    return { n, gx0, gy0, w: gx1 - gx0, h: gy1 - gy0, cell_e: cell };
}

/** Schneidet das Fenster aus einer Sicht (Meter, Zeile 0 Nord). */
export function schneideAus(sicht: Sicht, f: Fenster): Float32Array {
    const aus = new Float32Array(f.w * f.h);
    for (let j = 0; j < f.h; j++) {
        const gy = f.gy0 + j;
        const zeile = sicht.zeile0 === "nord" ? gy : f.n - 1 - gy;
        const von = zeile * f.n + f.gx0;
        for (let i = 0; i < f.w; i++) aus[j * f.w + i] = sicht.hoehe[von + i] as number;
    }
    return aus;
}

function rasterVon(f: Fenster, hoehen: Float32Array, herkunft: Record<string, unknown>): Raster {
    return { breite: f.w, hoehe: f.h, zellgroesse_m: f.cell_e * METER_JE_E, hoehen, herkunft };
}

export interface EndgelaendeKontext {
    laborDir: string;
}

export async function bereiteEndgelaende(
    gen: Generator,
    auftrag: Auftrag,
    fall: Gebirgsfall,
    rezept: Rezept,
    kontext: EndgelaendeKontext,
): Promise<Vorbereitet> {
    const opt = auftrag.endgelaende;
    if (!opt) throw new Error("Auftrag ohne endgelaende");
    const wurzel = gen.wurzel;
    const snap: Schnappschuss = ladeSchnappschuss(opt.schnappschuss ?? standardSchnappschuss(kontext.laborDir));
    const gebirgeId = opt.gebirgeId ?? fall.area;
    if (!gebirgeId) throw new Error("Kennung des Gebirges fehlt (endgelaende.gebirgeId oder area der Fixture)");
    const index = snap.eingaben.seedsMeta.findIndex((m) => m.id === gebirgeId);
    if (index < 0) throw new Error(`Gebirge ${gebirgeId} hat im Schnappschuss keine Saat`);
    const sb = snap.gebirge.input.bounds;
    const fb = fall.input.bounds;
    const abweichung = Math.max(...(["min_x", "min_y", "max_x", "max_y"] as const).map((k) => Math.abs(sb[k] - fb[k])));
    if (snap.gebirge.id === gebirgeId && abweichung > 1e-3)
        throw new Error(`Rahmen der Fixture und des Gebirges im Schnappschuss weichen um ${String(abweichung)} E ab`);

    const generate = await ladeModul(wurzel, "apps/server/src/terrain/domain/generate.ts");
    const lokal = await ladeModul(wurzel, "apps/server/src/terrain/domain/local.ts");
    const footprint = await ladeModul(wurzel, "apps/server/src/terrain/domain/footprint.ts");
    const computeLocalTerrain = fordere(lokal["computeLocalTerrain"], "computeLocalTerrain", wurzel) as Fn;
    const computeTilesOf = fordere(footprint["computeTilesOf"], "computeTilesOf", wurzel) as Fn;
    const erosionWorkersFor = generate["erosionWorkersFor"] as ((size: number) => number) | undefined;
    const fine = rezept.generator.fine;
    if (!fine) throw new Error("Das Rezept hat keine feine Stufe; das lokale Endgelände braucht sie");
    const n = rezept.generator.size;

    const g = baueGebirgsEingabe(gen, auftrag, fall, rezept);
    // Wie der Server (WI-0249 P2): Die Saat rechnet mit dem Formerhalt der Fassung auf dem Gitter des Geländes (`rueckennetzGitter`), und die Domäne bekommt
    // das gezeichnete Netz jedes Rückennetz-Gebirges (`rueckennetzNetz`) für den Formerhalt in der Erosion mit.
    const gitter = await rueckennetzGitter(gen, rezept);
    const saatEingabe = {
        ...g.eingabe,
        paesse: fall.paesse,
        rueckennetz: gitter ? { ...g.rueckennetz, gitter } : g.rueckennetz,
    };
    const netz = await rueckennetzNetz(gen, saatEingabe);
    const rechnetNetz = mitRueckennetz(
        gen,
        {
            kaemme: (g.eingabe["kaemme"] as unknown[] | undefined) ?? [],
            mulden: (g.eingabe["mulden"] as unknown[] | undefined) ?? [],
            nebengipfel: (g.eingabe["nebengipfel"] as unknown[] | undefined) ?? [],
        },
        (g.rueckennetz.form as { kopf?: number }).kopf,
    );
    const tiles = computeTilesOf(
        [{ minX: fb.min_x, minY: fb.min_y, maxX: fb.max_x, maxY: fb.max_y }],
        fine.tiles,
    ) as number[];
    const fensterGrob = fensterUm(fb, opt.rand, n);
    const fensterFein = fensterUm(fb, opt.rand, fine.size);
    const arbeiter = erosionWorkersFor ? erosionWorkersFor(n) : null;

    /** Die Saat des Gebirges mit den Reglern des Auftrags, eingesetzt in die Eingaben des Schnappschusses. */
    function eingaben() {
        const v12 = gen.gebirge.buildMountainRaster(saatEingabe);
        const samples = schritteZuSamples(v12.h, v12.eigen);
        let hoechste = 0;
        for (let k = 0; k < samples.length; k++)
            if (v12.eigen[k] && (samples[k] as number) > hoechste) hoechste = samples[k] as number;
        const seeds = snap.eingaben.seeds.slice();
        seeds[index] = {
            cell: v12.cell,
            originX: v12.bounds.min_x,
            originY: v12.bounds.min_y,
            width: v12.w,
            height: v12.hh,
            samples,
        };
        const deckel = Math.max(Number(g.regler["maximalhoehe"] ?? 0), hoechste);
        const andere = ((snap.eingaben["rueckennetz"] as { id: string }[] | undefined) ?? []).filter(
            (r) => r.id !== gebirgeId,
        );
        return {
            v12,
            saatFingerprint: samplesFingerprint(samples),
            deckel,
            eingaben: {
                ...snap.eingaben,
                seeds,
                // Nur ein Gebirge, das das Rückennetz rechnet, steht in der Liste (wie `loadDomainInputs`).
                rueckennetz: rechnetNetz
                    ? [
                          ...andere,
                          { id: gebirgeId, geometry: fall.input.geometry, deckel, ...(netz === null ? {} : { netz }) },
                      ]
                    : andere,
            },
        };
    }

    return {
        parameter: {
            stufe: "endgelaende-lokal",
            regler: g.regler,
            saat: g.saat,
            typ: auftrag.typ,
            modell: auftrag.modell,
            gebirge_id: gebirgeId,
            rueckennetz_gitter: gitter,
            rueckennetz_netz: rechnetNetz,
            rand_e: opt.rand,
            zwischenstaende: opt.zwischenstaende,
            kacheln: tiles,
            groben_gitter: n,
            feines_gitter: fine.size,
            schnappschuss: {
                ordner: snap.ordner,
                inhalt_sha256: snap.inhalt_sha256,
                master: snap.master_kopf,
                eingaben: snap.eingaben.fingerprint,
            },
        },
        async fuehreAus(): Promise<Ausfuehrung> {
            const uhr = new Stoppuhr();
            const zwischen: {
                phase: string;
                ab_beginn_ms: number;
                name: string;
                hoehen: Float32Array;
                fenster: Fenster;
                fingerprint: string;
            }[] = [];
            const beginn = performance.now();
            const saat = eingaben();
            uhr.markiere("saat");
            let endgueltig: Uint16Array;
            let befunde: number;
            let feinBerechnet: number;
            if (!opt!.zwischenstaende) {
                const ergebnis = (await computeLocalTerrain(saat.eingaben, rezept, {
                    tiles,
                    base: snap.master,
                    phase: (name: string) => {
                        // Der Job meldet den BEGINN von „coarse“, „fine“ und „finish“. Davor: Eingaben (Saat) und Rüstzeit.
                        if (name === "coarse") uhr.neustart();
                        else if (name === "fine") uhr.markiere("grob:abschluss");
                        else if (name === "finish") uhr.markiere("fein");
                        return Promise.resolve();
                    },
                    coarsePhase: (name: string) => uhr.markiere(`grob:${name}`),
                })) as { raster: { samples: Uint16Array }; findings: unknown[]; fineComputed: number };
                uhr.markiere("schluss");
                endgueltig = ergebnis.raster.samples;
                befunde = ergebnis.findings.length;
                feinBerechnet = ergebnis.fineComputed;
            } else {
                const nachbau = await laufMitBeobachter(
                    wurzel,
                    rezept,
                    saat.eingaben,
                    snap,
                    tiles,
                    uhr,
                    (phase, sicht) => {
                        const f = sicht.n === n ? fensterGrob : fensterFein;
                        const hoehen = schneideAus(sicht, f);
                        zwischen.push({
                            phase,
                            ab_beginn_ms: runde(performance.now() - beginn, 1),
                            name: phase,
                            hoehen,
                            fenster: f,
                            fingerprint: samplesFingerprint(schritteZuSamples(hoehen, null)),
                        });
                    },
                );
                endgueltig = nachbau.samples;
                befunde = nachbau.befunde;
                feinBerechnet = nachbau.feinBerechnet;
                if (zwischen.length === 0)
                    throw new Error(
                        "Der Beobachter wurde nie gerufen: Dieser Stand kennt ihn nicht (Commit vor f28a9bbee?)",
                    );
            }
            const gruppen_ms = gruppiere(uhr.ms, opt!.zwischenstaende);
            const fein = schneideAus(
                { n: fine.size, cell: 1024 / fine.size, zeile0: "sued", hoehe: endgueltig },
                fensterFein,
            );
            const samples = schritteZuSamples(fein, null);
            const herkunft = {
                generator: "computeLocalTerrain",
                stufe: "endgelaende-lokal",
                gebirge: fall.name,
                saat: g.saat,
                fenster_e: {
                    gitter: fine.size,
                    gx0: fensterFein.gx0,
                    gy0_nord: fensterFein.gy0,
                    breite: fensterFein.w,
                    hoehe: fensterFein.h,
                },
            };
            const vollFingerprint = createHash("sha256")
                .update(new Uint8Array(endgueltig.buffer, endgueltig.byteOffset, endgueltig.byteLength))
                .digest("hex");
            return {
                samples,
                zellen: fein.length,
                eigene_zellen: fein.length,
                form: { breite: fensterFein.w, hoehe: fensterFein.h, zellgroesse_m: fensterFein.cell_e * METER_JE_E },
                rasters: () => [
                    { name: "endgelaende", raster: rasterVon(fensterFein, fein, herkunft) },
                    ...zwischen.map((z) => ({
                        name: `stufen/${z.name.replace(/[^A-Za-z0-9_-]/g, "-")}`,
                        raster: rasterVon(z.fenster, z.hoehen, { ...herkunft, phase: z.phase }),
                    })),
                ],
                phasen_ms: uhr.ms,
                gruppen_ms,
                // Nur der Nachbau mit Beobachter kennt Zwischenstände; sonst fehlt das Feld (in `meta.json`: null).
                ...(opt!.zwischenstaende
                    ? {
                          zwischenstaende: zwischen.map((z): Zwischenstand => ({
                              phase: z.phase,
                              ab_beginn_ms: z.ab_beginn_ms,
                              name: `stufen/${z.name.replace(/[^A-Za-z0-9_-]/g, "-")}`,
                              fingerprint: z.fingerprint,
                          })),
                      }
                    : {}),
                zusatz: {
                    zelle_e: fensterFein.cell_e,
                    talboden: saat.v12.talboden ?? null,
                    saat_fingerprint: saat.saatFingerprint,
                    deckel: saat.deckel,
                    voll_fingerprint: vollFingerprint,
                    fein_kacheln_gerechnet: feinBerechnet,
                    befunde,
                    erosion: { iterationen: rezept.generator.iterations, arbeiter },
                    nachbau_mit_beobachter: opt!.zwischenstaende,
                },
                haupt: "endgelaende",
            };
        },
        async phasen() {
            return null;
        },
    };
}

/**
 * Die Phasen in vier Gruppen, die für beide Wege gleich heißen: `saat` (Gebirge neu gerechnet), `grob` (grobe Stufe bis zu den Schlussschritten
 * einschließlich), `fein` (Kacheln der feinen Stufe), `schluss` (Schlussschritte über die feine Stufe). Der Nachbau mit Beobachter nennt die Phasen
 * einzeln in zeitlicher Folge (die Schlüssel stehen in der Reihenfolge ihres Auftretens), der Weg über `computeLocalTerrain` mit Vorsilbe.
 */
export function gruppiere(ms: Record<string, number>, nachbau: boolean): Record<string, number> {
    const g: Record<string, number> = { saat: ms["saat"] ?? 0, grob: 0, fein: 0, schluss: 0 };
    if (!nachbau) {
        for (const [k, v] of Object.entries(ms)) if (k.startsWith("grob:")) g["grob"] = (g["grob"] as number) + v;
        g["fein"] = ms["fein"] ?? 0;
        g["schluss"] = ms["schluss"] ?? 0;
    } else {
        let stufe: "grob" | "fein" | "schluss" = "grob";
        for (const [k, v] of Object.entries(ms)) {
            if (k === "saat") continue;
            if (k === "fine-tiles") {
                g["fein"] = (g["fein"] as number) + v;
                stufe = "schluss";
            } else g[stufe] = (g[stufe] as number) + v;
        }
    }
    for (const k of Object.keys(g)) g[k] = runde(g[k] as number, 1);
    return g;
}

/** Der Ablauf von `computeLocalTerrain` ohne Zwischenstand der groben Stufe, mit Beobachter (siehe Kopf). */
async function laufMitBeobachter(
    wurzel: string,
    rezept: Rezept,
    eingaben: Record<string, unknown>,
    snap: Schnappschuss,
    tiles: number[],
    uhr: Stoppuhr,
    sieht: (phase: string, sicht: Sicht) => void,
): Promise<{ samples: Uint16Array; befunde: number; feinBerechnet: number }> {
    const generate = await ladeModul(wurzel, "apps/server/src/terrain/domain/generate.ts");
    const localFine = await ladeModul(wurzel, "apps/server/src/terrain/domain/local-fine.ts");
    const interior = await ladeModul(wurzel, "apps/server/src/terrain/domain/mountain-interior.ts");
    const gridModul = await ladeModul(wurzel, "apps/server/src/terrain/hydrology/grid.ts");
    const generateDomainTerrain = fordere(generate["generateDomainTerrain"], "generateDomainTerrain", wurzel) as Fn;
    const finishDomainTerrain = fordere(generate["finishDomainTerrain"], "finishDomainTerrain", wurzel) as Fn;
    const composeFineLocal = fordere(localFine["composeFineLocal"], "composeFineLocal", wurzel) as Fn;
    const domainClasses = fordere(interior["domainClasses"], "domainClasses", wurzel) as Fn;
    const grid = fordere(gridModul["grid"], "grid", wurzel) as Fn;
    const feinRezept = rezept.generator.fine!;
    const n = rezept.generator.size;
    let stufe = "grob";
    uhr.neustart();
    const beobachter: Beobachter = (phase, sicht) => {
        uhr.markiere(
            phase.startsWith("constraints/") ? `${stufe}-${phase.replace("/", "-")}` : phase.replace("/", "-"),
        );
        sieht(
            phase.startsWith("constraints/") ? `${stufe}-${phase.replace("/", "-")}` : phase.replace("/", "-"),
            sicht,
        );
        uhr.neustart();
    };
    const grobRezept = structuredClone(rezept);
    delete grobRezept.generator.fine;
    const grob = generateDomainTerrain(
        eingaben,
        grobRezept,
        n,
        undefined,
        undefined,
        undefined,
        undefined,
        beobachter,
    ) as {
        raster: { samples: Uint16Array };
        report: { ignoredPeaks: { id: string }[] };
    };
    aufraeumen();
    stufe = "fein";
    const gitter = grid(feinRezept.size) as { n: number; cell: number };
    uhr.neustart();
    const lokal = composeFineLocal(
        grob.raster,
        gitter,
        domainClasses(gitter, eingaben),
        feinRezept,
        rezept.generator.seed,
        new Set(tiles),
        snap.master,
    ) as { samples: Uint16Array; computed: number };
    const raster = {
        width: feinRezept.size,
        height: feinRezept.size,
        cell: gitter.cell,
        originX: gitter.cell / 2,
        originY: gitter.cell / 2,
        samples: lokal.samples,
    };
    beobachter("fine-tiles", { n: gitter.n, cell: gitter.cell, zeile0: "sued", hoehe: raster.samples });
    aufraeumen();
    const ignoriert = new Set(grob.report.ignoredPeaks.map((p) => p.id));
    const gipfel = (eingaben["peaks"] as { id: string }[]).filter((p) => !ignoriert.has(p.id));
    const fertig = finishDomainTerrain(
        raster,
        eingaben,
        rezept,
        gipfel,
        grob.report.ignoredPeaks,
        undefined,
        false,
        beobachter,
    ) as {
        findings: unknown[];
    };
    uhr.markiere("fein-verify");
    return { samples: raster.samples, befunde: fertig.findings.length, feinBerechnet: lokal.computed };
}
