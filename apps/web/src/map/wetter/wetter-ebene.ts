import type { Map as MapLibreMap } from "maplibre-gl";
import { wetterFehlerArt, type WetterDaten } from "@avesmaps3d/shared";
import type { MapInteractionCoordinator } from "../interaction/types";
import { ladeWetterDaten, modellFuerEngine } from "./wetter-daten";
import { erzeugeWetter } from "./engine/wetter-engine";
import { installWetterGriffe } from "./wetter-griffe";
import { installWetterInfo, type WetterInfoAnschluss } from "./wetter-info";
import { erzeugeJahreslauf } from "./wetter-jahr";
import { erzeugeWetterKamera } from "./wetter-kamera";
import { erzeugeSymbolebene, symboleFuerEngine } from "./wetter-symbole";
import { phoneViewport } from "../../controls/phone-viewport";
import {
    engineFortschritt,
    meldeWetterFehler,
    meldeWetterFortschritt,
    meldeWetterMessung,
    meldeWetterMetrik,
    wetterMesszeile,
    wetterStartZeit,
} from "./wetter-schalter";
import { erzeugeWetterMessung } from "./wetter-messung";
import { t } from "../../i18n/i18n";
import type { WetterEditorAnschluss, WetterStand } from "./wetter-schalter";

/**
 * Das Wetter auf der Karte (WI-0288): Engine, Jahreslauf und Symbolebene zusammen. Dieses Modul ist der eine Eingang des nachgeladenen
 * Chunks; `wetter-schalter.ts` holt es erst beim ersten Einschalten oder mit dem Wetter-Editor.
 *
 * - Die Schalter des Auges setzen die Einblendungen der Engine.
 * - Seit Stufe 2 kommen Presets, Icons und Wettermodell aus dem Leseweg (`wetter-daten.ts`), gelesen beim ersten Einschalten und bei jedem
 *   weiteren (`neuLesen`). Ohne Antwort gelten die Vorgaben im Code. Ausdehnung und Raster der Stufen, Takt und gröbste Auflösung des
 *   Wettermodells nimmt die Engine nur beim Entstehen (Folge `neustart`, also nach dem Neuladen der Seite).
 * - **Der Wetter-Editor** (Stufe 3, `editor`): Solange sein Fenster offen ist, gelten seine Presets und Icons, jede Änderung sofort, auch
 *   vor dem Speichern; die Icons stehen als Griffe da, auch ohne Schalter. Die Engine läuft dafür NICHT an: Die Rechnung kostet die Karte
 *   auch, wenn nichts von ihr zu sehen ist, und sie bleibt dem Auge vorbehalten.
 * - **Infopanel** (Betreiber 2026-11-08: „ja infopanel bauen“, `info`): Ohne Editor öffnet ein Klick auf ein Icon mit Wiki-Verweis sein Infopanel (`wetter-info.ts`); das
 *   offene Icon trägt den Ton der Auswahl (`offen`).
 */
export interface WetterEbene {
    setze(stand: WetterStand): void;
    /** Hängt die Rechnung in die Karte; mehrfach ohne Wirkung. */
    ein(): void;
    /** Nimmt die Rechnung von der Karte; sie steht, bis sie wieder eingeschaltet wird. */
    aus(): void;
    /** Liest Presets, Icons und Wettermodell neu und wendet sie an; ein unveränderter Stand kostet ein 304. */
    neuLesen(): Promise<void>;
    /** Der Wetter-Editor an der Karte, oder `undefined`, wenn sein Fenster zu ist. */
    editor(anschluss: WetterEditorAnschluss | undefined): void;
    /** Das Icon, dessen Infopanel offen ist (`undefined`: keines). */
    offen(id: string | undefined): void;
    /**
     * Der Messlauf auf dem Gerät (rund 15 s): Bildrate mit und ohne Wetter, Stand der Automatik, Bildgröße und GPU-Zeit je Durchgang, als
     * Textzeilen für das Auge. Das Wetter ist danach wieder so wie vorher.
     */
    messlauf(): Promise<string[]>;
}

export { ladeWetterDaten };

/**
 * Das Telefon-Profil (Betreiber 2026-11-08: „wobei wir mit der qualität hier runter können - im gegensatz zum desktop“). Im ersten Test (20
 * bis 60 FPS) galten 20 % gröbste Auflösung, 28 Schritte, 0,4 der Partikel und Takt 15. Jetzt gröber: Wolken automatisch ab 15 %, Start bei
 * 25 % statt 50 % (die Automatik geht nur hoch, wenn es reicht), 20 Schritte im Strahl, keine Feinstufe (`feinVoll`/`feinAb` unter null),
 * 0,3 der Partikel, Takt 12, keine Lichtstrahlen, gröber schon unter 40 FPS. Gilt, wenn die Engine auf einem Telefon entsteht; die Werte des
 * Wettermodells überdeckt es dort. Was davon wirklich zählt, zeigt der Messlauf auf dem Gerät (`messlauf`).
 */
export const TELEFON_PROFIL: Readonly<Record<string, number | "auto">> = {
    res: "auto",
    resMin: 0.15,
    resStart: 0.25,
    steps: 20,
    pmenge: 0.3,
    mmenge: 0.3,
    nmenge: 0.3,
    takt: 12,
    shafts: 0,
    // Ohne Schatten und Lichtstrahlen entfällt der Schattendurchgang (512², jedes zweite Bild); am Telefon ungemessen (WI-0290).
    schatten: 0,
    feinVoll: -2,
    feinAb: -1,
    fpsGrob: 40,
};

/** Die Einblendungen der Engine, wie der Messlauf sie nennt (Kennungen aus `cfg`). */
const EINBLENDUNGEN = ["wolken", "partikel", "niederschlag", "schnee", "meer", "regenkarte", "linie"] as const;
/** Was `gpuZeiten` neben den Durchgängen meldet. */
const NEBENWERTE = new Set(["summe", "gestoert", "zeitabfrage"]);

const warte = (ms: number): Promise<void> => new Promise((fertig) => globalThis.setTimeout(fertig, ms));
const zahl = (wert: number, stellen = 1): string => wert.toLocaleString(undefined, { maximumFractionDigits: stellen });

/**
 * Bilder der Karte je Sekunde über `ms`. Die Karte zeichnet sonst nur, wenn sich etwas ändert; hier zeichnet sie in jedem Bild neu, mit
 * oder ohne Wetter, damit beide Zahlen dasselbe messen.
 */
function zaehleBilder(map: MapLibreMap, ms: number): Promise<number> {
    return new Promise((fertig) => {
        let n = 0;
        let start = 0;
        const jeBild = (): void => {
            if (start === 0) start = performance.now();
            else n++;
            map.triggerRepaint();
        };
        map.on("render", jeBild);
        map.triggerRepaint();
        globalThis.setTimeout(() => {
            map.off("render", jeBild);
            const dauer = performance.now() - start;
            fertig(start === 0 || dauer <= 0 ? 0 : Math.round((n * 1000) / dauer));
        }, ms);
    });
}

const fuerEngine = (modell: WetterDaten["modell"]): Record<string, number | "auto"> => ({
    ...modellFuerEngine(modell),
    ...(phoneViewport.value ? TELEFON_PROFIL : {}),
});

export function erzeugeWetterEbene(
    map: MapLibreMap,
    datum: () => number | null,
    anfang: WetterDaten,
    interaction?: MapInteractionCoordinator,
    info?: WetterInfoAnschluss,
): WetterEbene {
    // Der Fortschritt des ersten Starts steht als Balken unter den Wetter-Icons im Auge (`wetterLaden`); ein Fehler nimmt ihn weg und steht
    // dort als Grund (etwa ein Telefon ohne Gleitkomma-Puffer).
    const w = erzeugeWetter(
        map,
        (text, anteil) => {
            if (text.startsWith("Fehler")) {
                meldeWetterFortschritt(undefined);
                const grund = text.replace(/^Fehler:\s*/u, "");
                meldeWetterFehler(grund);
                // Einmal je Seite und Art, als Klasse (`wetterFehlerArt`), nie der Text (WI-0288).
                const art = wetterFehlerArt(grund);
                meldeWetterMetrik("wetter_fehler", art, `wetter_fehler:${art}`);
                return;
            }
            meldeWetterFortschritt(engineFortschritt(anteil));
        },
        fuerEngine(anfang.modell),
    );
    // Die Messzeile: einmal je Sekunde, solange sie an ist (`?wetterTelefon=1`).
    globalThis.setInterval(() => {
        if (!wetterMesszeile.value) return;
        const s = w.stand();
        meldeWetterMessung(
            s.bereit ? { fps: Math.round(s.fps), anteil: s.anteil, takt: s.takt, gpu: String(s.gpu ?? "") } : null,
        );
    }, 1000);
    // Die Windpartikel zeigen die Hebung immer farbig: orange steigt die Luft, blau fällt sie (Betreiber 2026-11-07).
    w.cfg.pfarbe = true;
    let daten = anfang;
    const kamera = erzeugeWetterKamera(map);
    const symbole = erzeugeSymbolebene(
        map,
        kamera,
        { setzeQuellen: (liste) => w.setzeQuellen(liste), sturm: () => w.cfg.stuerme },
        symboleFuerEngine(daten.symbole),
    );
    const jahr = erzeugeJahreslauf(
        w,
        datum,
        () => symbole.uebertrage(),
        () => daten.presets,
    );
    symbole.uebertrage();
    let laeuft = false;
    let anschluss: WetterEditorAnschluss | undefined;
    // Die Messung für die anonyme Besucherstatistik (WI-0288): Nutzung, Start und Leistung, je Seitenaufruf einmal. Sie hört auf die Bilder
    // der Karte, die das Wetter ohnehin in jedem Bild neu zeichnet, und zwingt nichts zum Zeichnen. `laeuft` ist die Rechnung, nicht der Editor.
    const messung = erzeugeWetterMessung({
        jetzt: () => performance.now(),
        sichtbar: () => globalThis.document?.visibilityState === "visible",
        laeuft: () => laeuft,
        stand: () => w.stand(),
        startBeginn: wetterStartZeit,
        melde: (metrik, klasse) => meldeWetterMetrik(metrik, klasse),
    });
    map.on("render", messung.bild);
    globalThis.setInterval(messung.tick, 500);
    const jeBild = (): void => {
        if (laeuft) jahr.jeBild();
        symbole.zeichne();
    };
    // Die Symbolebene und ihr Bildtakt: mit der Rechnung oder mit dem Editor.
    let zeichnet = false;
    const stelle = (): void => {
        const soll = laeuft || anschluss !== undefined;
        if (soll === zeichnet) return;
        zeichnet = soll;
        if (soll) {
            symbole.ein();
            map.on("render", jeBild);
        } else {
            symbole.aus();
            map.off("render", jeBild);
        }
        map.triggerRepaint();
    };
    // Die Griffe hören nur, solange der Editor verbunden ist (`enabled`); die Ebene lebt so lange wie die Karte.
    if (interaction !== undefined) installWetterGriffe(map, interaction, symbole, kamera, () => anschluss);
    // Der Klick eines Besuchers auf ein Icon mit Wiki-Verweis, nur ohne Editor.
    if (interaction !== undefined && info !== undefined)
        installWetterInfo(interaction, symbole, () => anschluss !== undefined, info);
    symbole.offen(info?.offen());

    /** Presets und Icons eines neuen Stands (gelesen oder vom Editor) anwenden; was gleich ist, bleibt. */
    const uebernimm = (neu: Pick<WetterDaten, "presets" | "symbole">): void => {
        const vorher = daten;
        daten = { ...daten, presets: neu.presets, symbole: neu.symbole };
        if (JSON.stringify(neu.symbole) !== JSON.stringify(vorher.symbole))
            symbole.setze(symboleFuerEngine(neu.symbole));
        else symbole.uebertrage();
        if (JSON.stringify(neu.presets) !== JSON.stringify(vorher.presets)) jahr.neuePresets();
        map.triggerRepaint();
    };

    const ein = (): void => {
        if (laeuft) return;
        laeuft = true;
        w.ein();
        stelle();
        // Das Messhandle der Werkzeuge unter `project-control/discovery/wi-0288-wetter-messung/`, nur im Entwicklungsbuild.
        if (import.meta.env.DEV) (globalThis as { avesmapsWetter?: unknown }).avesmapsWetter = w;
    };
    const aus = (): void => {
        if (!laeuft) return;
        laeuft = false;
        w.aus();
        stelle();
    };

    return {
        setze(stand): void {
            w.cfg.schnee = stand.schneedecke;
            w.cfg.wolken = stand.wolken;
            w.cfg.niederschlag = stand.regenUndSchnee;
            w.cfg.partikel = stand.wind;
            w.cfg.meer = stand.stroemungen;
            w.cfg.regenkarte = stand.niederschlag;
            w.cfg.linie = stand.schneefallgrenze;
            symbole.zeige({ wind: stand.wind, stroemung: stand.stroemungen });
            map.triggerRepaint();
        },
        ein,
        aus,
        async messlauf(): Promise<string[]> {
            // Erst bereit (nach dem Einschwingen), dann wie es die Person sieht, mit der Automatik; zuletzt ohne Wetter, danach wieder an.
            for (let i = 0; i < 120 && !w.stand().bereit; i++) await warte(500);
            await warte(1500);
            const mit = await zaehleBilder(map, 4000);
            const s = w.stand();
            const halte = (): void => map.triggerRepaint();
            map.on("render", halte);
            const zeiten = await w.gpuZeiten(30).finally(() => map.off("render", halte));
            const lief = laeuft;
            aus();
            await warte(500);
            const ohne = await zaehleBilder(map, 4000);
            if (lief) ein();
            const an = EINBLENDUNGEN.filter((id) => w.cfg[id]);
            const liste = Object.entries(zeiten)
                .filter(([name, ms]) => !NEBENWERTE.has(name) && ms >= 0.05)
                .sort((a, b) => b[1] - a[1])
                .map(([name, ms]) => `${name} ${zahl(ms)}`)
                .join(" · ");
            return [
                t("display.weather.messlauf.bildrate", { ohne: String(ohne), mit: String(mit) }),
                t("display.weather.test", {
                    fps: String(mit),
                    anteil: String(Math.round(s.anteil * 100)),
                    takt: String(s.takt),
                    gpu: s.gpu || "?",
                }),
                `${String(s.W)}×${String(s.H)} · DPR ${zahl(globalThis.devicePixelRatio ?? 1, 2)} · Zoom ${zahl(map.getZoom())} · ${zahl(map.getPitch(), 0)}° · ${an.join(", ")}`,
                t("display.weather.messlauf.gpu", {
                    art: zeiten["zeitabfrage"] === 1 ? "Zeitabfrage" : "finish",
                    summe: zahl(zeiten["summe"] ?? 0),
                    liste: liste || "-",
                }),
            ];
        },
        async neuLesen(): Promise<void> {
            const neu = await ladeWetterDaten();
            // Ohne Antwort bleibt, was schon gilt: Ein kurzer Ausfall soll gespeicherte Werte nicht durch die Vorgaben ersetzen.
            if (neu.nurVorgaben && !daten.nurVorgaben) return;
            // Werte mit Folge `neustart` setzt die Engine nicht nachträglich um; sie stehen in `cfg`, wirken aber erst beim Neuladen.
            Object.assign(w.cfg, fuerEngine(neu.modell));
            w.sonneGeaendert();
            daten = { ...daten, modell: neu.modell, nurVorgaben: neu.nurVorgaben };
            // Ist der Editor offen, gilt sein Stand: Er ist neuer als der gelesene, solange er noch speichert.
            if (anschluss === undefined) uebernimm(neu);
        },
        editor(neu): void {
            anschluss = neu;
            if (neu !== undefined) {
                uebernimm(neu);
                symbole.editor({ gewaehlt: neu.gewaehlt, griffe: neu.darf });
            } else symbole.editor(undefined);
            stelle();
        },
        offen(id): void {
            symbole.offen(id);
        },
    };
}
