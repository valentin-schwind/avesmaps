import type { RasterFormat } from "../media/raster/inspect.ts";

/**
 * Metadaten eines Reisebildes schon beim Eingang entfernen (WI-0272 S3, Fixrunde Block A): Der Datenschutztext verspricht, dass die Originaldatei mit
 * ihren Metadaten (Gerät, Zeit, GPS, Name) nicht bleibt. Der Browser kodiert ein Foto vor dem Absenden neu; der Server verlässt sich nicht darauf, sondern
 * legt die private Quelle von vornherein ohne sie ab. Die Bereinigung beim Einreichen und beim Bild-Ersetzen (`photobox/db.ts`, `pruefeBild`) ersetzt die
 * frühere im Worker: Die Quelle trägt nie Metadaten, der Worker schreibt nichts mehr unter `private/source/`.
 *
 * - 🔴 **Nur Byte-Arbeit auf Containerebene, ohne zu dekodieren** (MEDIA-M7: keine Bildbibliothek im Anfrageprozess). Die Bilddaten werden nie angefasst,
 *   also bleiben die Bildpunkte gleich, und die Datei kann nie wachsen.
 * - 🔴 **Freigabeliste statt Sperrliste:** Was nicht ausdrücklich bleibt, fällt weg, auch Blöcke, die es heute noch nicht gibt, und alles hinter dem Bildende.
 *   - JPEG: von SOI bis EOI. Es bleiben APP0 (nur JFIF, ohne das eingebettete Vorschaubild), APP2 nur mit Kennung `ICC_PROFILE`, APP14 (Adobe) und die
 *     Segmente des Bildes (SOF, DHT, DAC, DQT, DNL, DRI, EXP, SOS samt Bilddaten, RSTn). Alles andere (APP1 mit EXIF und XMP, APP13 mit IPTC, jedes weitere
 *     APPn, COM, die reservierten Segmente) und alles hinter EOI fällt weg.
 *   - PNG: IHDR, PLTE, IDAT, IEND, tRNS, gAMA, cHRM, sRGB, iCCP, sBIT, bKGD, pHYs, acTL, fcTL, fdAT, unverändert samt CRC; nichts hinter IEND.
 *   - WebP: VP8X (mit gelöschten Flags für EXIF und XMP), ICCP, ANIM, ANMF, ALPH, `VP8 `, VP8L; die RIFF-Größe wird neu gesetzt, Polsterbytes stimmen.
 *   - GIF: Kopf, Bildschirmbeschreibung, globale Farbtafel, Graphic Control Extension, Bilder samt Daten, die Schleife `NETSCAPE2.0` und der Trailer.
 *     Kommentar, Text und jede andere Application-Extension (zum Beispiel XMP) fallen weg.
 * - **Kaputter Aufbau** (Länge über das Ende hinaus, fehlende Marke, fehlendes Ende) ist ein `MetadatenFehler` mit dem Code `unsupported`; `pruefeBild`
 *   macht daraus die 422 des Eingangs. Eine Datei, die sich hier nicht lesen lässt, würde auch der Worker nicht dekodieren.
 * - **Ausrichtung:** Das Formular normalisiert über die Leinwand, ein gedrehtes Bild kommt nur von fremden Clients. Trägt ein EXIF-Block eine Ausrichtung
 *   ungleich 1, wird abgewiesen (`MetadatenFehler`), denn mit dem EXIF fiele die Drehung weg, und das Bild stünde auf der Seite. Der kleine TIFF-Leser
 *   (`exifAusrichtung`) versteht beide Byte-Ordnungen und wirft nie; unlesbar zählt als 1.
 * - **Deterministisch:** dieselben Bytes ergeben immer dieselbe Ausgabe (Prüfsumme und Ablage des Eingangs, Wiederholungserkennung).
 */

/** Der Aufbau der Datei ist nicht in Ordnung, oder die Datei lässt sich so nicht annehmen (gedrehtes Bild): sie wird nicht angenommen. */
export class MetadatenFehler extends Error {
    readonly code = "unsupported" as const;

    constructor(message: string) {
        super(message);
        this.name = "MetadatenFehler";
    }
}

const kaputt = (was: string): MetadatenFehler => new MetadatenFehler(`Dateiaufbau beschädigt: ${was}`);
const gedreht = (): MetadatenFehler =>
    new MetadatenFehler(
        "Das Bild ist gedreht gespeichert (die Ausrichtung steht nur in den Metadaten); bitte aufrecht speichern.",
    );

export interface OhneMetadaten {
    /** Bei `entfernt: false` genau die Eingabe. */
    bytes: Uint8Array;
    /** Hat sich etwas geändert (Block, Anhang, Flag)? */
    entfernt: boolean;
}

// --- Bytes lesen ------------------------------------------------------------------------------------------------------------------

const u16be = (b: Uint8Array, o: number): number => ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
const u32be = (b: Uint8Array, o: number): number =>
    (((b[o] ?? 0) << 24) | ((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0)) >>> 0;
const u32le = (b: Uint8Array, o: number): number =>
    ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;

function ascii(b: Uint8Array, o: number, n: number): string {
    let text = "";
    for (let i = o; i < Math.min(o + n, b.length); i += 1) text += String.fromCharCode(b[i] ?? 0);
    return text;
}

/** Beginnt `b` ab `o` mit dieser Zeichenfolge (Latin-1, Nullbytes als `\0`)? */
const beginntMit = (b: Uint8Array, o: number, text: string): boolean =>
    o + text.length <= b.length && ascii(b, o, text.length) === text;

/** Setzt die Stücke zu einer Datei zusammen; unverändert, wenn das Ergebnis die Eingabe ist. */
function zusammen(eingabe: Uint8Array, teile: readonly Uint8Array[]): OhneMetadaten {
    let laenge = 0;
    for (const teil of teile) laenge += teil.length;
    const aus = new Uint8Array(laenge);
    let stelle = 0;
    for (const teil of teile) {
        aus.set(teil, stelle);
        stelle += teil.length;
    }
    if (laenge === eingabe.length && aus.every((wert, index) => wert === eingabe[index])) {
        return { bytes: eingabe, entfernt: false };
    }
    return { bytes: aus, entfernt: true };
}

// --- Ausrichtung (TIFF-Leser) -----------------------------------------------------------------------------------------------------

/** So viele Einträge der ersten Verzeichnisebene werden höchstens angesehen (die Ausrichtung steht in den ersten, mehr gibt eine Kamera nie). */
const MAX_EINTRAEGE = 1024;

/**
 * Die Ausrichtung (`Orientation`, Tag 0x0112) aus einem TIFF-Block, wie ihn EXIF trägt; beide Byte-Ordnungen (II und MM). Gibt 2 bis 8 zurück, wenn das Bild
 * gedreht oder gespiegelt gespeichert ist, sonst 1. **Wirft nie:** unlesbar (zu kurz, falsche Marke, Verzeichnis außerhalb, anderer Typ) und ein Wert
 * außerhalb von 1 bis 8 zählen als 1.
 */
export function exifAusrichtung(tiff: Uint8Array): number {
    try {
        const klein = tiff[0] === 0x49 && tiff[1] === 0x49;
        if (!klein && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return 1;
        const lies16 = (o: number): number =>
            o < 0 || o + 2 > tiff.length
                ? -1
                : klein
                  ? (tiff[o] ?? 0) | ((tiff[o + 1] ?? 0) << 8)
                  : ((tiff[o] ?? 0) << 8) | (tiff[o + 1] ?? 0);
        const lies32 = (o: number): number => {
            if (o < 0 || o + 4 > tiff.length) return -1;
            const a = lies16(o);
            const b = lies16(o + 2);
            return klein ? b * 0x10000 + a : a * 0x10000 + b;
        };
        if (lies16(2) !== 42) return 1;
        const verzeichnis = lies32(4);
        const anzahl = lies16(verzeichnis);
        if (verzeichnis < 0 || anzahl < 0) return 1;
        for (let i = 0; i < Math.min(anzahl, MAX_EINTRAEGE); i += 1) {
            const eintrag = verzeichnis + 2 + i * 12;
            if (eintrag + 12 > tiff.length) return 1;
            if (lies16(eintrag) !== 0x0112) continue;
            // SHORT (3), genau ein Wert, im Wertfeld selbst.
            if (lies16(eintrag + 2) !== 3 || lies32(eintrag + 4) < 1) return 1;
            const wert = lies16(eintrag + 8);
            return wert >= 2 && wert <= 8 ? wert : 1;
        }
        return 1;
    } catch {
        return 1;
    }
}

/** Ein EXIF-Block trägt eine Ausrichtung ungleich 1: die Datei wird nicht angenommen. `tiff` beginnt bei der Byte-Ordnung (II oder MM). */
function pruefeAusrichtung(tiff: Uint8Array): void {
    if (exifAusrichtung(tiff) !== 1) throw gedreht();
}

// --- JPEG -------------------------------------------------------------------------------------------------------------------------

const JPEG_EOI = Uint8Array.of(0xff, 0xd9);

/** Die Segmente des Bildes selbst (ohne Länge in der Liste: SOS ist besonders): SOF0–15 ohne JPG (C8), DHT (C4) und DAC (CC) sind darin, dazu DQT, DNL, DRI, EXP. */
function jpegBildsegment(marker: number): boolean {
    if (marker >= 0xc0 && marker <= 0xcf) return marker !== 0xc8;
    return marker === 0xdb || marker === 0xdc || marker === 0xdd || marker === 0xdf;
}

function jpeg(b: Uint8Array): OhneMetadaten {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) throw kaputt("JPEG ohne SOI");
    const teile: Uint8Array[] = [b.subarray(0, 2)];
    let o = 2;
    for (;;) {
        if (o >= b.length) throw kaputt("JPEG ohne Ende (EOI)");
        if (b[o] !== 0xff) throw kaputt("JPEG-Markerfolge");
        // Füllbytes (0xFF) vor dem Marker sind erlaubt; sie fallen weg.
        let m = o + 1;
        while (m < b.length && b[m] === 0xff) m += 1;
        if (m >= b.length) throw kaputt("JPEG endet im Marker");
        const marker = b[m] ?? 0;
        if (marker === 0x00) throw kaputt("JPEG-Marker 0");
        if (marker === 0xd9) {
            teile.push(JPEG_EOI);
            return zusammen(b, teile);
        }
        if (marker === 0xd8) throw kaputt("JPEG mit zweitem SOI");
        // Marker ohne Länge: TEM und RSTn.
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            teile.push(Uint8Array.of(0xff, marker));
            o = m + 1;
            continue;
        }
        if (m + 3 > b.length) throw kaputt("JPEG-Segment abgeschnitten");
        const laenge = u16be(b, m + 1);
        const ende = m + 1 + laenge;
        if (laenge < 2 || ende > b.length) throw kaputt("JPEG-Segmentlänge");
        const nutzlast = m + 3;
        const marke = Uint8Array.of(0xff, marker);

        if (marker === 0xda) {
            // SOS: Kopf und die Bilddaten dahinter bis zum nächsten Marker (0xFF 0x00 ist ein Füllbyte der Daten, 0xFF 0xD0–D7 ein Neustart, 0xFF 0xFF Füllung).
            let p = ende;
            for (;;) {
                const f = b.indexOf(0xff, p);
                if (f === -1 || f + 1 >= b.length) throw kaputt("JPEG ohne Ende (EOI)");
                const folge = b[f + 1] ?? 0;
                if (folge === 0x00 || (folge >= 0xd0 && folge <= 0xd7)) p = f + 2;
                else if (folge === 0xff) p = f + 1;
                else {
                    p = f;
                    break;
                }
            }
            teile.push(marke, b.subarray(m + 1, p));
            o = p;
            continue;
        }
        if (jpegBildsegment(marker)) {
            teile.push(marke, b.subarray(m + 1, ende));
        } else if (marker === 0xe0 && beginntMit(b, nutzlast, "JFIF\0") && laenge >= 16) {
            // JFIF: Version, Einheit und Dichte bleiben, das eingebettete Vorschaubild (es könnte ein früherer Bildausschnitt sein) fällt weg.
            const kopf = Uint8Array.of(0xff, 0xe0, 0x00, 0x10);
            const jfif = new Uint8Array(12 + 2);
            jfif.set(b.subarray(nutzlast, nutzlast + 12));
            teile.push(kopf, jfif);
        } else if (marker === 0xe2 && beginntMit(b, nutzlast, "ICC_PROFILE\0")) {
            teile.push(marke, b.subarray(m + 1, ende));
        } else if (marker === 0xee && beginntMit(b, nutzlast, "Adobe") && laenge >= 14) {
            teile.push(marke, b.subarray(m + 1, ende));
        } else if (marker === 0xe1 && beginntMit(b, nutzlast, "Exif\0\0")) {
            pruefeAusrichtung(b.subarray(nutzlast + 6, ende));
        }
        o = ende;
    }
}

// --- PNG --------------------------------------------------------------------------------------------------------------------------

const PNG_BLEIBT = new Set([
    "IHDR",
    "PLTE",
    "IDAT",
    "IEND",
    "tRNS",
    "gAMA",
    "cHRM",
    "sRGB",
    "iCCP",
    "sBIT",
    "bKGD",
    "pHYs",
    "acTL",
    "fcTL",
    "fdAT",
]);

const PNG_KOPF = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function png(b: Uint8Array): OhneMetadaten {
    if (b.length < 8 + 12 || !PNG_KOPF.every((wert, index) => b[index] === wert)) throw kaputt("PNG ohne Kennung");
    const teile: Uint8Array[] = [b.subarray(0, 8)];
    let o = 8;
    let erster = true;
    for (;;) {
        if (o + 12 > b.length) throw kaputt("PNG ohne Ende (IEND)");
        const laenge = u32be(b, o);
        const gesamt = 12 + laenge;
        if (gesamt > b.length - o) throw kaputt("PNG-Blocklänge");
        const typ = ascii(b, o + 4, 4);
        if (erster && typ !== "IHDR") throw kaputt("PNG ohne IHDR");
        erster = false;
        if (typ === "eXIf") pruefeAusrichtung(b.subarray(o + 8, o + 8 + laenge));
        if (PNG_BLEIBT.has(typ)) teile.push(b.subarray(o, o + gesamt));
        o += gesamt;
        if (typ === "IEND") return zusammen(b, teile);
    }
}

// --- WebP -------------------------------------------------------------------------------------------------------------------------

const WEBP_BLEIBT = new Set(["VP8X", "ICCP", "ANIM", "ANMF", "ALPH", "VP8 ", "VP8L"]);
/** In VP8X: EXIF (0x08) und XMP (0x04). */
const WEBP_FLAGS_METADATEN = 0x0c;

function webp(b: Uint8Array): OhneMetadaten {
    if (b.length < 20 || ascii(b, 0, 4) !== "RIFF" || ascii(b, 8, 4) !== "WEBP") throw kaputt("WebP ohne RIFF-Kopf");
    const ende = u32le(b, 4) + 8;
    if (ende < 20 || ende > b.length) throw kaputt("WebP-Größe");
    const bloecke: Uint8Array[] = [];
    let o = 12;
    while (o < ende) {
        if (o + 8 > ende) throw kaputt("WebP-Block abgeschnitten");
        const typ = ascii(b, o, 4);
        const laenge = u32le(b, o + 4);
        const datenEnde = o + 8 + laenge;
        if (datenEnde > ende) throw kaputt("WebP-Blocklänge");
        if (typ === "EXIF") {
            // Manche Kodierer stellen „Exif\0\0“ davor, andere nicht.
            const anfang = beginntMit(b, o + 8, "Exif\0\0") ? o + 14 : o + 8;
            pruefeAusrichtung(b.subarray(Math.min(anfang, datenEnde), datenEnde));
        }
        if (WEBP_BLEIBT.has(typ)) {
            const block = new Uint8Array(8 + laenge + (laenge & 1));
            block.set(b.subarray(o, datenEnde));
            if (typ === "VP8X") {
                if (laenge < 10) throw kaputt("WebP-VP8X zu kurz");
                block[8] = (block[8] ?? 0) & ~WEBP_FLAGS_METADATEN;
            }
            bloecke.push(block);
        }
        o = datenEnde + (laenge & 1);
    }
    let summe = 4;
    for (const block of bloecke) summe += block.length;
    const kopf = new Uint8Array(12);
    kopf.set(b.subarray(0, 4));
    new DataView(kopf.buffer).setUint32(4, summe, true);
    kopf.set(b.subarray(8, 12), 8);
    return zusammen(b, [kopf, ...bloecke]);
}

// --- GIF --------------------------------------------------------------------------------------------------------------------------

/** Hinter den Unterblöcken ab `o` (je Länge und Daten, die Länge 0 beendet): die Stelle danach. */
function gifNachUnterbloecken(b: Uint8Array, o: number): number {
    let p = o;
    for (;;) {
        if (p >= b.length) throw kaputt("GIF-Unterblock abgeschnitten");
        const laenge = b[p] ?? 0;
        p += 1 + laenge;
        if (laenge === 0) {
            if (p > b.length) throw kaputt("GIF-Unterblock abgeschnitten");
            return p;
        }
        if (p > b.length) throw kaputt("GIF-Unterblock abgeschnitten");
    }
}

function gif(b: Uint8Array): OhneMetadaten {
    const kopf = ascii(b, 0, 6);
    if (b.length < 14 || (kopf !== "GIF87a" && kopf !== "GIF89a")) throw kaputt("GIF ohne Kennung");
    let o = 13;
    if (((b[10] ?? 0) & 0x80) !== 0) o += 3 * (1 << (((b[10] ?? 0) & 7) + 1));
    if (o > b.length) throw kaputt("GIF-Farbtafel abgeschnitten");
    const teile: Uint8Array[] = [b.subarray(0, o)];
    for (;;) {
        if (o >= b.length) throw kaputt("GIF ohne Ende (Trailer)");
        const block = b[o] ?? 0;
        if (block === 0x3b) {
            teile.push(b.subarray(o, o + 1));
            return zusammen(b, teile);
        }
        if (block === 0x21) {
            if (o + 2 > b.length) throw kaputt("GIF-Erweiterung abgeschnitten");
            const label = b[o + 1] ?? 0;
            const ende = gifNachUnterbloecken(b, o + 2);
            // Bleibt: Graphic Control Extension und die Schleife. Der erste Unterblock der Application-Extension nennt Kennung und Prüfcode (11 Bytes).
            const schleife = label === 0xff && b[o + 2] === 11 && ascii(b, o + 3, 11) === "NETSCAPE2.0";
            if (label === 0xf9 || schleife) teile.push(b.subarray(o, ende));
            o = ende;
            continue;
        }
        if (block === 0x2c) {
            if (o + 11 > b.length) throw kaputt("GIF-Bild abgeschnitten");
            const gepackt = b[o + 9] ?? 0;
            let p = o + 10;
            if ((gepackt & 0x80) !== 0) p += 3 * (1 << ((gepackt & 7) + 1));
            p += 1; // kleinste LZW-Codegröße
            if (p > b.length) throw kaputt("GIF-Bild abgeschnitten");
            const ende = gifNachUnterbloecken(b, p);
            teile.push(b.subarray(o, ende));
            o = ende;
            continue;
        }
        throw kaputt("GIF-Block unbekannt");
    }
}

// --- Einstieg ---------------------------------------------------------------------------------------------------------------------

/**
 * Das Bild ohne Metadaten und ohne Anhang (siehe Kopf). `format` kommt aus den Bytes (`sniffFormat`), nie aus dem Dateinamen. `entfernt: false` und die
 * Eingabe selbst, wenn schon nichts darin stand. Wirft `MetadatenFehler` (Code `unsupported`) bei kaputtem Aufbau, einer Ausrichtung ungleich 1 und bei jedem
 * Format außer JPEG, PNG, WebP und GIF (ein Reisebild ist nie ein SVG).
 */
export function entferneMetadaten(bytes: Uint8Array, format: RasterFormat): OhneMetadaten {
    switch (format) {
        case "jpeg":
            return jpeg(bytes);
        case "png":
            return png(bytes);
        case "webp":
            return webp(bytes);
        case "gif":
            return gif(bytes);
        default:
            throw new MetadatenFehler("Das ist kein Rasterbild, dessen Metadaten sich entfernen lassen.");
    }
}
