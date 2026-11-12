import type { Map as MapLibreMap } from "maplibre-gl";
import type { MessageKey } from "../i18n/i18n";

/**
 * Der Screenshot der Karte (WI-0274; Entwurf Fassung 5, Vali 2026-11-01 „perfekt“): Formate, die Größe des Felds und das Bild selbst.
 *
 * - **Das Bild kommt aus der Leinwand von MapLibre**, im selben Bild, in dem sie gezeichnet wird (`render`): Ohne
 *   `preserveDrawingBuffer` ist der Puffer danach leer, und die Option kostet in jedem Bild. Auf der Stage gemessen (2026-11-01):
 *   3840 × 1906 Bildpunkte bei 2560 × 1271 CSS-Pixeln, die Leinwand ist nicht gesperrt (Kacheln vom eigenen Server), alle Ebenen samt
 *   eigener (Routenpillen, Kraftlinien) sind drin, die Bedienfelder als HTML von selbst nicht.
 * - **Das Format gilt für das fertige Bild.** Der Rahmen liegt im Feld wie auf der Karte in der freien Fläche, er ändert es nicht.
 * - **Das Feld ist immer so groß, wie es passt** (Vali 2026-11-01: „versuch immer fast die ganze karte rauszuholen“): Jeder Wechsel des
 *   Seitenverhältnisses rechnet es neu aus den Grenzen, nie aus der vorigen Größe; sonst schrumpfte es bei jedem Wechsel am Rand.
 */

export interface Seitenverhaeltnis {
    /** Breite durch Höhe. */
    r: number;
    /** Der Name als Zahl („16:9“) oder als Wort der Sprachtafel („DIN A4 quer“). */
    zahl?: string;
    text?: MessageKey;
}

export const QUADRAT: Seitenverhaeltnis = { r: 1, text: "screenshot.quadrat" };

/** Was das Mausrad beim Rechteck durchläuft, von breit nach hoch; 1:1 hat seine eigene Kachel. */
export const RECHTECKE: readonly Seitenverhaeltnis[] = [
    { r: 2, zahl: "2:1" },
    { r: 16 / 9, zahl: "16:9" },
    { r: 297 / 210, text: "screenshot.format.a4Quer" },
    { r: 4 / 3, zahl: "4:3" },
    { r: 3 / 4, zahl: "3:4" },
    { r: 210 / 297, text: "screenshot.format.a4Hoch" },
    { r: 9 / 16, zahl: "9:16" },
    { r: 1 / 2, zahl: "1:2" },
];
/** Das Rechteck beginnt bei 16:9. */
export const RECHTECK_VORGABE = 1;

export function formatName(format: Seitenverhaeltnis, t: (key: MessageKey) => string): string {
    return format.text === undefined ? (format.zahl ?? "") : t(format.text);
}

/** Der nächste Platz in `RECHTECKE`: an den Enden bleibt er stehen, `rundum` (Knopf am Finger) beginnt wieder vorn. */
export function naechstesRechteck(stelle: number, schritt: 1 | -1, rundum = false): number {
    const n = RECHTECKE.length;
    const neu = stelle + schritt;
    return rundum ? (neu + n) % n : Math.min(n - 1, Math.max(0, neu));
}

export interface Kasten {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Platz für die Leiste oben und die Maßangabe unten, Rand an den Seiten (CSS-Pixel). */
export const FELD_RAND = { oben: 64, unten: 40, seite: 24 } as const;
/** Die kurze Seite des Felds wird nicht kleiner, sonst deckt die Nennung (`nennung.ts`) einen großen Teil des Bilds; bei 240 px war es gut die Hälfte (Vali 2026-11-01: „Ja, 400 px“). */
export const FELD_MIN = 400;

/** Wo das Feld liegen darf, in einer Fläche der Größe `breite` × `hoehe`. */
export function feldGrenzen(breite: number, hoehe: number): Kasten {
    return {
        x: FELD_RAND.seite,
        y: FELD_RAND.oben,
        w: Math.max(0, breite - 2 * FELD_RAND.seite),
        h: Math.max(0, hoehe - FELD_RAND.oben - FELD_RAND.unten),
    };
}

/** Das größte Feld im Verhältnis `r`, das in die Grenzen passt, höchstens `bisBreite` breit; die kurze Seite nicht unter `FELD_MIN`. */
export function feldMasse(r: number, grenzen: Kasten, bisBreite = Infinity): { w: number; h: number } {
    const passt = Math.min(grenzen.w, grenzen.h * r);
    const w = Math.min(passt, Math.max(Math.min(bisBreite, passt), FELD_MIN * Math.max(1, r)));
    return { w: Math.floor(w), h: Math.floor(w / r) };
}

/** Das Feld mit der Mitte möglichst bei `mitte`, ganz in den Grenzen. */
export function legeFeld(mitte: { x: number; y: number }, masse: { w: number; h: number }, grenzen: Kasten): Kasten {
    const x = Math.min(Math.max(grenzen.x, mitte.x - masse.w / 2), grenzen.x + grenzen.w - masse.w);
    const y = Math.min(Math.max(grenzen.y, mitte.y - masse.h / 2), grenzen.y + grenzen.h - masse.h);
    return { x: Math.round(x), y: Math.round(y), w: masse.w, h: masse.h };
}

/** Wie viele Bildpunkte der Leinwand auf ein CSS-Pixel kommen. */
export function dichte(map: MapLibreMap): number {
    const behaelter = map.getContainer();
    return behaelter.clientWidth > 0 ? map.getCanvas().width / behaelter.clientWidth : 1;
}

/** Wie lange höchstens auf nachgeladene Ebenen gewartet wird, bevor abgegriffen wird. */
const WARTEN_MS = 2000;

/**
 * Die Karte, wie sie gerade gezeichnet ist: eine Kopie der Leinwand aus dem `render` eines eigens angestoßenen Bilds. Lädt sie noch
 * (das gerade eingeschaltete Raster), wird bis `idle` gewartet, höchstens `WARTEN_MS`.
 */
export async function kartenbild(map: MapLibreMap): Promise<HTMLCanvasElement> {
    if (!map.loaded() || !map.areTilesLoaded()) {
        await new Promise<void>((fertig) => {
            const uhr = setTimeout(fertig, WARTEN_MS);
            map.once("idle", () => {
                clearTimeout(uhr);
                fertig();
            });
        });
    }
    return new Promise((fertig) => {
        map.once("render", () => {
            const quelle = map.getCanvas();
            const kopie = document.createElement("canvas");
            kopie.width = quelle.width;
            kopie.height = quelle.height;
            kopie.getContext("2d")?.drawImage(quelle, 0, 0);
            fertig(kopie);
        });
        map.triggerRepaint();
    });
}

/**
 * Das Feld aus dem Standbild, in dessen Bildpunkten. `darueber` zeichnet danach in CSS-Pixeln des Kartenbehälters (Gradnetz-Rahmen und
 * Nennung kennen nur diese).
 */
export function schneide(
    bild: HTMLCanvasElement,
    feld: Kasten,
    faktor: number,
    darueber?: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
    const leinwand = document.createElement("canvas");
    leinwand.width = Math.max(1, Math.round(feld.w * faktor));
    leinwand.height = Math.max(1, Math.round(feld.h * faktor));
    const ctx = leinwand.getContext("2d");
    if (!ctx) return leinwand;
    ctx.drawImage(
        bild,
        feld.x * faktor,
        feld.y * faktor,
        feld.w * faktor,
        feld.h * faktor,
        0,
        0,
        leinwand.width,
        leinwand.height,
    );
    if (darueber) {
        ctx.setTransform(faktor, 0, 0, faktor, -feld.x * faktor, -feld.y * faktor);
        darueber(ctx);
    }
    return leinwand;
}

export function alsPng(leinwand: HTMLCanvasElement): Promise<Blob> {
    return new Promise((fertig, fehler) => {
        leinwand.toBlob((blob) => (blob ? fertig(blob) : fehler(new Error("leeres Bild"))), "image/png");
    });
}

/**
 * Das Bild in die Zwischenablage. 🔴 Im Klick selbst aufrufen und den Inhalt als Promise übergeben: Dann gilt die Nutzergeste noch,
 * wenn das PNG fertig ist (dasselbe Muster wie der Kurzlink, `route-planner/use-share-link.ts`).
 */
export function inZwischenablage(png: Promise<Blob>): Promise<void> {
    const ablage = globalThis.navigator?.clipboard;
    if (typeof ablage?.write !== "function" || typeof ClipboardItem !== "function") {
        return Promise.reject(new Error("keine Zwischenablage für Bilder"));
    }
    try {
        return ablage.write([new ClipboardItem({ "image/png": png })]);
    } catch (fehler) {
        return Promise.reject(fehler instanceof Error ? fehler : new Error(String(fehler)));
    }
}

/** `avesmaps-2026-11-01-1430.png` */
export function dateiname(jetzt = new Date()): string {
    const zwei = (n: number): string => String(n).padStart(2, "0");
    return `avesmaps-${String(jetzt.getFullYear())}-${zwei(jetzt.getMonth() + 1)}-${zwei(jetzt.getDate())}-${zwei(jetzt.getHours())}${zwei(jetzt.getMinutes())}.png`;
}

interface Dateigriff {
    name: string;
    createWritable(): Promise<{ write(daten: Blob): Promise<void>; close(): Promise<void> }>;
}
type Dateiwaehler = (optionen: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<Dateigriff>;

/**
 * „Speichern unter …“: der Dateidialog des Browsers, wo es ihn gibt (Chrome, Edge); sonst ein Download in den üblichen Ordner.
 * Im Klick aufrufen, der Dialog braucht die Nutzergeste.
 */
export async function speichern(
    png: Blob,
    name: string,
    beschreibung: string,
): Promise<{ wie: "dialog"; name: string } | { wie: "download" } | { wie: "abgebrochen" }> {
    const waehler = (globalThis as unknown as { showSaveFilePicker?: Dateiwaehler }).showSaveFilePicker;
    if (typeof waehler === "function") {
        try {
            const griff = await waehler({
                suggestedName: name,
                types: [{ description: beschreibung, accept: { "image/png": [".png"] } }],
            });
            const schreiber = await griff.createWritable();
            await schreiber.write(png);
            await schreiber.close();
            return { wie: "dialog", name: griff.name };
        } catch (fehler) {
            if (fehler instanceof DOMException && fehler.name === "AbortError") return { wie: "abgebrochen" };
            // Verweigert (etwa in einem Rahmen): weiter mit dem Download.
        }
    }
    const url = URL.createObjectURL(png);
    const verweis = document.createElement("a");
    verweis.href = url;
    verweis.download = name;
    verweis.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { wie: "download" };
}
