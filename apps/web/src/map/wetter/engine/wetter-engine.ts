import type { CustomLayerInterface, CustomRenderMethodInput, Map as MapLibreMap } from "maplibre-gl";
import { WETTER_UNBESTIMMT, wettermodellVorgaben } from "@avesmaps3d/shared";
import { klimawertBei } from "../klimazonen";
import { modellFuerEngine } from "../wetter-daten";
import { bildGezaehlt, neueAutomatik, taktSchritt } from "./automatik";
import {
    hoeheAt,
    ladeHoehen,
    ladeKlima,
    ladeVegetation,
    uploadHoehen,
    uploadKlima,
    uploadVegetation,
    vegAt,
} from "./daten";
import { progFertig } from "./gl";
import { berechneHimmel, LH, LW } from "./himmel";
import { aktualisiereKamera, aufEbene, projekt } from "./kamera";
import { erzeugeKern, initGL, MAXG, WARM_STEPS, type FensterWunsch, type Gpu } from "./kern";
import { clamp, M_U } from "./mathe";
import { leseDeckung, leseFenster, messeWind } from "./messung";
import { stepNoise } from "./rauschen";
import { bewegePartikel, initSim, stepSim, updateWorld } from "./simulation";
import type { WetterCfg, WetterEngine, WetterModellCfg, WindMessung } from "./typen";
import { neuerMesslauf, zLies, type ZeitAbfrage } from "./zeitmessung";
import { currentScale, grundzustand, partikelZahl, resize, uniforms, zeichneAusgabe, zeichneWolken } from "./zeichnen";

export type { WetterCfg, WetterEngine, WetterEngineStand, WetterQuelle } from "./typen";

/**
 * Wetter als eigene MapLibre-Ebene: Strömung, Feuchte, Wolken und Schnee auf der GPU, ohne Eingriff in Karte oder Daten.
 * Weltkoordinaten: x,z in Karteneinheiten (0 bis 1024), y nach oben, 1 Einheit = 3.000 Schritt.
 * Das Grundfeld ist periodisch und größer als die Karte; zwei feinere Fenster folgen der Kamera.
 * Gerechnet wird in `prerender`, gezeichnet in `render`; MapLibre stellt seinen GL-Zustand danach selbst wieder her.
 *
 * Die Teile (WI-0288 Stufe 7): `kern.ts` (Zustand, Aufbau im GL-Kontext), `shader/` (GLSL), `gl.ts`, `daten.ts` (Höhen, Vegetation,
 * Klima), `himmel.ts`, `rauschen.ts`, `simulation.ts`, `automatik.ts` (Takt und Wolkenauflösung), `zeichnen.ts`, `kamera.ts`,
 * `messung.ts` und `zeitmessung.ts` (Werkzeuge). Diese Datei ist die Fabrik: Start in Schritten, die Ebene und die Schnittstelle.
 */
// Die Vorgaben (WI-0288 Stufe 2): das Wettermodell und der Kartenstandard („unbestimmt“) aus `packages/shared/src/wetter/`, dazu die Einblendungen,
// die die Schalter im Auge setzen. Jede Zahl steht dort genau einmal; `wetter.test.ts` (shared) hält sie gegen den Prototyp.
export const WETTER_VORGABEN: WetterCfg = {
    // Das Wettermodell kennt seine Kennungen nur als Text (`WETTERMODELL_PANELE`); `WetterModellCfg` nennt die, die die Engine liest.
    ...(modellFuerEngine(wettermodellVorgaben()) as unknown as WetterModellCfg),
    ...WETTER_UNBESTIMMT,
    regenkarte: false,
    schnee: false,
    linie: false,
    partikel: false,
    wolken: true,
    pfarbe: false,
    meer: false,
    niederschlag: false,
};

const grund = (e: unknown): string =>
    String(
        (typeof e === "object" && e !== null && "message" in e ? (e as { message: unknown }).message : undefined) || e,
    );

// `start`: die Werte des Wettermodells aus dem Leseweg. Ausdehnung und Raster der Stufen, Takt und gröbste Auflösung gelten nur beim Entstehen (Folge `neustart`).
export function erzeugeWetter(
    map: MapLibreMap,
    meldung: (text: string, anteil?: number) => void,
    start: Readonly<Record<string, unknown>> = {},
): WetterEngine {
    const cfg: WetterCfg = { ...WETTER_VORGABEN, ...start };
    const k = erzeugeKern(map, cfg);
    const { sun } = k;
    /** Die Programme, Texturen und Bildpuffer, ab dem ersten Bild (`initGL`). */
    let gpu: Gpu | null = null;
    /** Der GL-Kontext der Karte, ab dem ersten Bild (für `gpuZeiten`). */
    let glKarte: WebGL2RenderingContext | null = null;
    const automatik = neueAutomatik();

    // ---------- Atmosphäre: Streuung einmal je Sonnenstand in eine kleine Tabelle
    function updateSun(): void {
        berechneHimmel(sun, k.skyData, cfg.sunEl, cfg.sunAz, cfg.sunPower);
        if (gpu) {
            const gl = gpu.gl;
            gl.bindTexture(gl.TEXTURE_2D, gpu.T.sky);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LW, LH, gl.RGBA, gl.FLOAT, k.skyData);
        }
        sun.dirty = false;
    }

    // Übersetzen in zwei Hälften (Betreiber 2026-11-08: „das erstmalige anzeigen des wetters dauert recht lang“): `progStart` stößt nur an, mit
    // KHR_parallel_shader_compile übersetzt der Treiber im Hintergrund (beim ersten Besuch gemessen 6,4 s am Stück, die Karte stand so lange);
    // `progFertig` fragt erst, wenn `programmeFertig` es meldet, und liest dann die Uniforms. Ohne die Erweiterung wartet `progFertig` wie bisher.
    const programmeFertig = (g: Gpu): boolean => {
        const parallel = g.parallel;
        return (
            !parallel ||
            Object.values(g.P).every((q) => q.u || g.gl.getProgramParameter(q.p, parallel.COMPLETION_STATUS_KHR))
        );
    };

    // ---------- Start in Schritten, damit die Karte nicht einfriert
    let datenDa = false;
    let stage = 0,
        warm = 0,
        bereit = false,
        fehler: unknown = null,
        letzte = performance.now();
    // Zeitraffer nach einem Sprung im Kalender: Schritte wie beim Einschwingen, aber sichtbar und über einige Sekunden verteilt.
    let raffer: { rest: number; bis: number } | null = null;
    // Messwünsche der Werkzeuge, eingelöst im nächsten Bild.
    let messung: ((aus: WindMessung) => void) | null = null,
        deckung: ((anteil: number) => void) | null = null,
        fenster: FensterWunsch | null = null;
    // Die Vegetation an oder aus (`vegetationAn`), eingelöst im nächsten Bild.
    let vegWechsel: boolean | null = null;

    function boot(gl: WebGL2RenderingContext): void {
        // Erst die Kacheln anfordern, dann die Shader übersetzen: Beim ersten Besuch dauert das Übersetzen Sekunden (gemessen 6,4 s), das Netz läuft derweil.
        if (stage === 0) {
            const daten = Promise.all([
                ladeHoehen().then((h) => {
                    k.hoehen = h;
                    k.peak = h.peak;
                }),
                ladeVegetation()
                    .then((v) => {
                        k.veg = v;
                    })
                    .catch((e: unknown) => {
                        console.warn("Wetter: Vegetation nicht geladen, jedes Land verdunstet gleich", e);
                        k.veg = null;
                    }),
                ladeKlima()
                    .then((r) => {
                        k.klima = r;
                    })
                    .catch((e: unknown) => {
                        console.warn(
                            "Wetter: Klimazonen nicht geladen, die Schneefallgrenze kommt aus der Temperatur",
                            e,
                        );
                        k.klima = null;
                    }),
            ]);
            gpu = initGL(k, gl);
            stage = 1;
            meldung("Höhen werden gelesen …", 0.05);
            daten.then(
                () => {
                    datenDa = true;
                },
                (e: unknown) => {
                    fehler = e;
                },
            );
            return;
        }
        const g = gpu!;
        // Weiter erst, wenn die Kacheln da sind und der Treiber alle Programme übersetzt hat; bis dahin zeichnet die Karte ungestört weiter.
        if (stage === 1) {
            if (!datenDa || !programmeFertig(g)) return;
            for (const q of Object.values(g.P)) if (!q.u) progFertig(g.gl, q);
            stage = 2;
        }
        if (stage === 2) {
            const hm = uploadHoehen(g.gl, k.hoehen!, k.hangMax);
            g.T.hm = hm.tex;
            k.hangMax = hm.hangMax;
            g.T.veg = uploadVegetation(g.gl, k.veg);
            [g.T.kw0, g.T.kw1, g.T.kw2] = uploadKlima(g.gl, k.klima, cfg.klimaWeich);
            stage = 3;
            meldung("Wolkenrauschen wird erzeugt …", 0.2);
            return;
        }
        if (stage === 3) {
            const f = stepNoise(g.gl, g.P.noise, g.vao, k.rauschen, g.T);
            meldung("Wolkenrauschen wird erzeugt …", 0.2 + f * 0.4);
            if (k.rauschen.done) stage = 4;
            return;
        }
        if (stage === 4) {
            updateSun();
            initSim(k, g);
            stage = 5;
            return;
        }
        if (stage === 5) {
            for (let i = 0; i < 10 && warm < WARM_STEPS; i++, warm++) stepSim(k, g, 0.22);
            meldung("Das Wetter stellt sich ein …", 0.6 + (0.4 * warm) / WARM_STEPS);
            if (warm >= WARM_STEPS) {
                bereit = true;
                letzte = performance.now();
                automatik.settle = 90;
                k.historyValid = false;
                meldung("", 1);
            }
        }
    }

    /** Ein Bild rechnen: Takt, Partikel, Zeitraffer, Wolken mit Verlauf; dazu die Messwünsche und die Automatik. */
    function rechne(g: Gpu, args: CustomRenderMethodInput): void {
        const gl = g.gl;
        const jetzt = performance.now(),
            raw = (jetzt - letzte) / 1000,
            dt = Math.min(0.05, Math.max(0.001, raw));
        letzte = jetzt;
        k.uhr += Math.min(raw, 0.1);
        k.schneeAn =
            k.schneeAn < 0
                ? cfg.schnee
                    ? 1
                    : 0
                : clamp(k.schneeAn + ((cfg.schnee ? 1 : -1) * Math.min(raw, 0.1)) / 2.5);
        aktualisiereKamera(k, args);
        if (sun.dirty) updateSun();
        if (vegWechsel !== null) {
            gl.deleteTexture(g.T.veg ?? null);
            g.T.veg = uploadVegetation(gl, vegWechsel ? k.veg : null);
            vegWechsel = null;
            grundzustand(gl);
        }
        grundzustand(gl);
        updateWorld(k, g);
        const simDt = !k.paused && cfg.tempo > 0 ? dt * cfg.tempo * 1.4 : 0;
        taktSchritt(k, g, simDt, raw);
        bewegePartikel(k, g, simDt);
        if (raffer) {
            const bilder = Math.max(1, (raffer.bis - jetzt) / 16.7),
                n = Math.min(4, Math.ceil(raffer.rest / bilder));
            for (let i = 0; i < n; i++) stepSim(k, g, 0.22);
            raffer.rest -= n;
            if (raffer.rest <= 0) raffer = null;
        }
        if (messung) {
            const aus = messeWind(k, g),
                fertig = messung;
            messung = null;
            fertig(aus);
        }
        resize(k, g);
        k.frameNo++;
        grundzustand(gl);
        const U = uniforms(k, g);
        k.U = U;
        zLies(gl, k.uhrGpu);
        const F = g.F,
            cloud = F.cloud!,
            hA = F.hA!,
            hB = F.hB!;
        zeichneWolken(k, g, U, cloud, hA, hB);
        F.hA = hB;
        F.hB = hA;
        k.historyValid = true;
        if (deckung) {
            const anteil = leseDeckung(k, g, hB),
                fertig = deckung;
            deckung = null;
            fertig(anteil);
        }
        if (fenster) {
            const { r, n, y, fertig } = fenster;
            fenster = null;
            fertig(leseFenster(k, g, hB, k.vp!, r, n, y));
        }
        gl.bindVertexArray(null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        bildGezaehlt(k, automatik, raw, jetzt);
    }

    const layer: CustomLayerInterface = {
        id: "wetter-probe",
        type: "custom",
        renderingMode: "3d",
        prerender(gl, args): void {
            map.triggerRepaint();
            if (fehler) return;
            glKarte = gl;
            try {
                grundzustand(gl);
                if (!bereit) {
                    boot(gl);
                    if (!bereit) return;
                }
                rechne(gpu!, args);
            } catch (e) {
                fehler = e;
                console.error(e);
                meldung("Fehler: " + grund(e));
            }
        },
        render(): void {
            const g = gpu,
                U = k.U,
                hA = g?.F.hA,
                vp = k.vp;
            if (!bereit || fehler || !U || !g || !hA || !vp) return;
            zeichneAusgabe(k, g, U, hA, vp);
        },
    };
    function ersteSymbolEbene(): string | undefined {
        for (const id of map.getLayersOrder()) {
            const l = map.getLayer(id);
            if (l && l.type === "symbol") return id;
        }
        return undefined;
    }
    let ab: (() => void) | null = null;
    return {
        cfg,
        sg: k.sg,
        ein(): void {
            ab = (): void => {
                if (map.style?._loaded && !map.getLayer(layer.id)) {
                    map.addLayer(layer, ersteSymbolEbene());
                }
            };
            map.on("styledata", ab);
            if (map.style?._loaded) ab();
            map.triggerRepaint();
        },
        aus(): void {
            if (ab) map.off("styledata", ab);
            ab = null;
            if (map.getLayer(layer.id)) map.removeLayer(layer.id);
            map.triggerRepaint();
        },
        sonneGeaendert(): void {
            sun.dirty = true;
        },
        neuStart(): void {
            if (!bereit || !gpu) return;
            initSim(k, gpu);
            warm = 0;
            bereit = false;
            stage = 5;
            k.historyValid = false;
            raffer = null;
        },
        // So viele Einschwing-Schritte zusätzlich, verteilt auf `ms`; mehrere Aufrufe hintereinander summieren sich bis zu einem vollen Einschwingen.
        zeitraffer(n, ms): void {
            if (!bereit || n <= 0) return;
            raffer = { rest: Math.min(WARM_STEPS, (raffer ? raffer.rest : 0) + n), bis: performance.now() + ms };
        },
        setPause(p): void {
            k.paused = p;
        },
        messeWind: () =>
            new Promise((fertig) => {
                messung = fertig;
            }),
        gpuZeiten: (bilder = 60, mitFinish = false) =>
            new Promise((fertig) => {
                const ext = mitFinish
                    ? null
                    : glKarte && (glKarte.getExtension("EXT_disjoint_timer_query_webgl2") as ZeitAbfrage | null);
                k.uhrGpu.zm = neuerMesslauf(ext, bilder, fertig);
            }),
        messeDeckung: () =>
            new Promise((fertig) => {
                deckung = fertig;
            }),
        // Wolkenbild in einem festen Weltausschnitt um die Bildmitte: gleiches Raster bei jedem Zoom, deshalb direkt vergleichbar.
        messeFenster: (r, n = 48, y = 1.5) =>
            new Promise((fertig) => {
                fenster = { r, n, y, fertig };
            }),
        hoehe: (x, z) => hoeheAt(k.hoehen, x, z),
        vegetation: (x, z) => vegAt(k.veg, x, z),
        klimazone: (x, z) => klimawertBei(k.klima ?? undefined, x, z),
        vegetationAn(an): void {
            vegWechsel = !!an;
        },
        istPause: () => k.paused,
        setzeQuellen(alle): void {
            const { gP, gV, mP, mV } = k;
            const liste = alle.filter((g) => g.kind !== "stroemung" && g.kind !== "mahlstrom").slice(0, MAXG),
                meer = alle.filter((g) => g.kind === "stroemung" || g.kind === "mahlstrom").slice(0, MAXG);
            k.mN = meer.length;
            meer.forEach((g, i) => {
                const o = i * 4;
                mP[o] = g.x;
                mP[o + 1] = g.z;
                mP[o + 2] = g.r;
                mP[o + 3] = 0;
                // Ein Mahlstrom trägt Drehsinn mal Stärke in z und die Stärke in w (Strudel, `FS_MEER`); eine Strömung behält z = 0.
                const strudel = g.kind === "mahlstrom";
                mV[o] = strudel ? 0 : Math.cos(g.dir) * g.s;
                mV[o + 1] = strudel ? 0 : Math.sin(g.dir) * g.s;
                mV[o + 2] = strudel ? g.spin * g.s : 0;
                mV[o + 3] = strudel ? g.s : 0;
            });
            k.gN = liste.length;
            liste.forEach((g, i) => {
                const o = i * 4;
                gP[o] = g.x;
                gP[o + 1] = g.z;
                gP[o + 2] = g.r;
                gP[o + 3] = 0;
                if (g.kind === "wind") {
                    gV[o] = Math.cos(g.dir) * g.s;
                    gV[o + 1] = Math.sin(g.dir) * g.s;
                    gV[o + 2] = 0;
                    gV[o + 3] = 0;
                } else {
                    gV[o] = 0;
                    gV[o + 1] = 0;
                    gV[o + 2] = ((g.spin * g.s) / (0.43 * g.r)) * 0.9;
                    gV[o + 3] = g.s;
                }
            });
        },
        projekt: (x, y, z) => projekt(k, x, y, z),
        aufEbene: (px, py, y) => aufEbene(k, px, py, y),
        stand: () => ({
            bereit,
            gpu: gpu?.gpuName ?? "",
            fps: automatik.fps,
            W: k.W,
            H: k.H,
            CW: k.CW,
            CH: k.CH,
            anteil: currentScale(k),
            takt: Math.round(1 / k.TAKTE[k.taktStufe]!),
            stufen: k.WL.filter((l) => l.on).map((l) => (l.e / l.res) * M_U),
            dist: k.cam.dist,
            hs: k.hs,
            tx: k.cam.tx,
            tz: k.cam.tz,
            eye: k.eye,
            peak: k.peak,
            sn: cfg.tn + (cfg.ts - cfg.tn) * clamp(k.cam.tz / 1024),
            boden: hoeheAt(k.hoehen, k.cam.tx, k.cam.tz),
            partikelZahl: partikelZahl(k),
            fehler: fehler ? grund(fehler) : null,
        }),
    };
}
