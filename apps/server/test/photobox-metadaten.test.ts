import { crc32 } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { MetadatenFehler, entferneMetadaten, exifAusrichtung } from "../src/photobox/metadaten.ts";

/**
 * Metadaten beim Eingang auf Containerebene entfernen (WI-0272 S3, Fixrunde Block A, `photobox/metadaten.ts`), ohne Datenbank und ohne zu dekodieren:
 * eine Freigabeliste je Format. Was nicht auf ihr steht, fällt weg (EXIF, XMP, IPTC, Kommentare, Textblöcke, Daten hinter dem Bildende); die Bildpunkte
 * bleiben gleich, weil kein Byte der Bilddaten angefasst wird. `sharp` kommt nur in den Tests vor: als Erzeuger der Beispiele und als Gegenprobe, dass das
 * Ergebnis dieselben Bildpunkte und Maße dekodiert.
 */

const GPS = {
    IFD0: { Copyright: "Alrik Testmann", Make: "TestCam" },
    IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 28/1 38/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "7/1 0/1 12/1",
    },
};

/** Ein Bild mit Verlauf (damit Kodierer und Dekoder etwas zu tun haben), 64 × 48. */
const grund = (kanaele: 3 | 4 = 3) => {
    const breite = 64;
    const hoehe = 48;
    const roh = Buffer.alloc(breite * hoehe * kanaele);
    for (let y = 0; y < hoehe; y += 1) {
        for (let x = 0; x < breite; x += 1) {
            const stelle = (y * breite + x) * kanaele;
            roh[stelle] = (x * 4) % 256;
            roh[stelle + 1] = (y * 5) % 256;
            roh[stelle + 2] = ((x + y) * 3) % 256;
            if (kanaele === 4) roh[stelle + 3] = 255 - ((x * 2) % 128);
        }
    }
    return sharp(roh, { raw: { width: breite, height: hoehe, channels: kanaele } });
};

const roh = async (bytes: Uint8Array): Promise<{ data: Buffer; width: number; height: number; channels: number }> => {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
};

/** Dieselben Bildpunkte und Maße vorher und nachher. */
async function gleicheBildpunkte(vorher: Uint8Array, nachher: Uint8Array): Promise<void> {
    const a = await roh(vorher);
    const b = await roh(nachher);
    expect([b.width, b.height, b.channels]).toEqual([a.width, a.height, a.channels]);
    expect(b.data.equals(a.data)).toBe(true);
}

const enthaelt = (bytes: Uint8Array, text: string): boolean => Buffer.from(bytes).includes(Buffer.from(text, "latin1"));

/** Die Geheimnisse, die nach dem Entfernen nirgends mehr in den Bytes stehen dürfen. */
const GEHEIM = ["TestCam", "Alrik Testmann", "XMP-GEHEIM", "IPTC-GEHEIM", "COM-GEHEIM", "TEXT-GEHEIM", "HINTEN-GEHEIM"];
const nichtsGeheimes = (bytes: Uint8Array): void => {
    for (const text of GEHEIM) expect(enthaelt(bytes, text), text).toBe(false);
};

// --- Hilfen zum Bauen von Beispielen ---------------------------------------------------------------------------------------------

/** Ein TIFF-Block mit einer Ausrichtung (`Orientation`, 0x0112), in der gewünschten Byte-Ordnung. */
function tiff(ausrichtung: number, ordnung: "II" | "MM" = "II"): Buffer {
    const klein = ordnung === "II";
    const b = Buffer.alloc(8 + 2 + 12 + 4);
    b.write(ordnung, 0, "latin1");
    const u16 = (wert: number, stelle: number) =>
        klein ? b.writeUInt16LE(wert, stelle) : b.writeUInt16BE(wert, stelle);
    const u32 = (wert: number, stelle: number) =>
        klein ? b.writeUInt32LE(wert, stelle) : b.writeUInt32BE(wert, stelle);
    u16(42, 2);
    u32(8, 4);
    u16(1, 8); // ein Eintrag
    u16(0x0112, 10);
    u16(3, 12); // SHORT
    u32(1, 14);
    u16(ausrichtung, 18);
    return b;
}

const jpegSegment = (marker: number, nutzlast: Uint8Array): Buffer =>
    Buffer.concat([
        Buffer.from([0xff, marker, ((nutzlast.length + 2) >> 8) & 0xff, (nutzlast.length + 2) & 0xff]),
        nutzlast,
    ]);

/** Fügt Segmente direkt hinter SOI ein. */
const nachSoi = (jpeg: Uint8Array, ...segmente: Buffer[]): Buffer =>
    Buffer.concat([jpeg.subarray(0, 2), ...segmente, jpeg.subarray(2)]);

const XMP_KOPF = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "latin1");
const IPTC_BLOCK = Buffer.concat([
    Buffer.from("Photoshop 3.0\0", "latin1"),
    Buffer.from("8BIM", "latin1"),
    Buffer.from([0x04, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10]),
    Buffer.from("IPTC-GEHEIM-1234", "latin1"),
]);

function pngBlock(typ: string, daten: Uint8Array = new Uint8Array()): Buffer {
    const kopf = Buffer.alloc(4);
    kopf.writeUInt32BE(daten.length);
    const typUndDaten = Buffer.concat([Buffer.from(typ, "latin1"), daten]);
    const pruefsumme = Buffer.alloc(4);
    pruefsumme.writeUInt32BE(crc32(typUndDaten));
    return Buffer.concat([kopf, typUndDaten, pruefsumme]);
}

/** Die Blöcke eines PNG (Typ, Gesamtlänge ab Anfang des Blocks, Lage). */
function pngBloecke(png: Uint8Array): { typ: string; stelle: number; laenge: number }[] {
    const b = Buffer.from(png);
    const liste: { typ: string; stelle: number; laenge: number }[] = [];
    for (let o = 8; o + 12 <= b.length;) {
        const laenge = 12 + b.readUInt32BE(o);
        liste.push({ typ: b.toString("latin1", o + 4, o + 8), stelle: o, laenge });
        o += laenge;
    }
    return liste;
}

/** Fügt Blöcke vor IEND ein (hinter dem Kopf käme für gAMA/cHRM; die Reihenfolge ist für diese Tests gleich). */
function pngMit(png: Uint8Array, vorIdat: Buffer[], vorIend: Buffer[]): Buffer {
    const b = Buffer.from(png);
    const bloecke = pngBloecke(b);
    const idat = bloecke.find((block) => block.typ === "IDAT")!;
    const iend = bloecke.find((block) => block.typ === "IEND")!;
    return Buffer.concat([
        b.subarray(0, idat.stelle),
        ...vorIdat,
        b.subarray(idat.stelle, iend.stelle),
        ...vorIend,
        b.subarray(iend.stelle),
    ]);
}

/** Die Blöcke einer RIFF-Datei (WebP): Typ, Länge der Daten, Lage des Kopfes. */
function riffBloecke(webp: Uint8Array): { typ: string; laenge: number; stelle: number }[] {
    const b = Buffer.from(webp);
    const liste: { typ: string; laenge: number; stelle: number }[] = [];
    const ende = 8 + b.readUInt32LE(4);
    for (let o = 12; o + 8 <= ende;) {
        const laenge = b.readUInt32LE(o + 4);
        liste.push({ typ: b.toString("latin1", o, o + 4), laenge, stelle: o });
        o += 8 + laenge + (laenge & 1);
    }
    return liste;
}

/** Hängt einen RIFF-Block an (mit Polsterbyte) und setzt die Größe im Kopf neu. */
function riffAnhaengen(webp: Uint8Array, typ: string, daten: Buffer): Buffer {
    const kopf = Buffer.alloc(8);
    kopf.write(typ, 0, "latin1");
    kopf.writeUInt32LE(daten.length, 4);
    const block = Buffer.concat([kopf, daten, daten.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
    const neu = Buffer.concat([Buffer.from(webp), block]);
    neu.writeUInt32LE(neu.length - 8, 4);
    return neu;
}

const gifTabelle = (gif: Uint8Array): number => {
    const gepackt = gif[10] ?? 0;
    return (gepackt & 0x80) !== 0 ? 3 * (1 << ((gepackt & 7) + 1)) : 0;
};

/** Ein GIF-Block mit Unterblöcken: Einleitung (21 Label), dann Daten in Unterblöcken, dann der Abschluss. */
const gifErweiterung = (label: number, ...unterbloecke: Buffer[]): Buffer =>
    Buffer.concat([
        Buffer.from([0x21, label]),
        ...unterbloecke.flatMap((daten) => [Buffer.from([daten.length]), daten]),
        Buffer.from([0x00]),
    ]);

// --- JPEG -----------------------------------------------------------------------------------------------------------------------

describe("JPEG: Metadaten auf Containerebene entfernen (WI-0272 S3, Fixrunde A)", () => {
    it("🔴 GPS-EXIF, XMP, IPTC, Kommentar und angehängte Daten fallen weg; dieselben Bildpunkte und Maße", async () => {
        const basis = await grund().jpeg({ quality: 90 }).withExif(GPS).toBuffer();
        const mit = Buffer.concat([
            nachSoi(
                basis,
                jpegSegment(0xe1, Buffer.concat([XMP_KOPF, Buffer.from("<x:xmpmeta>XMP-GEHEIM</x:xmpmeta>")])),
                jpegSegment(0xed, IPTC_BLOCK),
                jpegSegment(0xfe, Buffer.from("COM-GEHEIM")),
            ),
            Buffer.from("HINTEN-GEHEIM"),
        ]);
        const vorher = await sharp(mit).metadata();
        expect(vorher.exif).toBeDefined();
        expect(vorher.xmp).toBeDefined();
        for (const text of GEHEIM.filter((eintrag) => eintrag !== "TEXT-GEHEIM"))
            expect(enthaelt(mit, text)).toBe(true);

        const ergebnis = entferneMetadaten(mit, "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        nichtsGeheimes(ergebnis.bytes);
        const nachher = await sharp(ergebnis.bytes).metadata();
        expect([nachher.format, nachher.width, nachher.height]).toEqual(["jpeg", 64, 48]);
        expect(nachher.exif).toBeUndefined();
        expect(nachher.xmp).toBeUndefined();
        expect(nachher.iptc).toBeUndefined();
        await gleicheBildpunkte(mit, ergebnis.bytes);
        // Das Ende ist EOI, davor ein ganzes Bild.
        expect([...ergebnis.bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
        expect(ergebnis.bytes.length).toBeLessThan(mit.length);
    });

    it("ein Bild ohne Metadaten bleibt, wie es ist: dieselben Bytes, nichts entfernt", async () => {
        const sauber = await grund().jpeg().toBuffer();
        const ergebnis = entferneMetadaten(sauber, "jpeg");
        expect(ergebnis.entfernt).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(sauber)).toBe(true);
    });

    it("🔴 das ICC-Profil bleibt (APP2 mit Kennung), jedes andere APP2 (MPF) fällt weg; Adobe (APP14) bleibt", async () => {
        const mitProfil = await grund().jpeg().withIccProfile("srgb").withExif(GPS).toBuffer();
        const vorher = await sharp(mitProfil).metadata();
        expect(vorher.icc).toBeDefined();
        const mpf = jpegSegment(0xe2, Buffer.from("MPF\0GEHEIMES-ZWEITBILD", "latin1"));
        const adobe = jpegSegment(0xee, Buffer.from([...Buffer.from("Adobe"), 0, 100, 0, 0, 0, 0, 1]));
        const ergebnis = entferneMetadaten(nachSoi(mitProfil, mpf, adobe), "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        const nachher = await sharp(ergebnis.bytes).metadata();
        expect(nachher.exif).toBeUndefined();
        expect(nachher.icc?.length).toBe(vorher.icc?.length);
        expect(enthaelt(ergebnis.bytes, "ICC_PROFILE")).toBe(true);
        expect(enthaelt(ergebnis.bytes, "GEHEIMES-ZWEITBILD")).toBe(false);
        expect(enthaelt(ergebnis.bytes, "Adobe")).toBe(true);
        await gleicheBildpunkte(mitProfil, ergebnis.bytes);
    });

    it("das Vorschaubild im JFIF-Kopf fällt weg, der Kopf selbst bleibt; ein JFIF ohne Vorschaubild bleibt, wie es ist", async () => {
        const basis = await grund().jpeg().toBuffer();
        const kopf = Buffer.concat([Buffer.from("JFIF\0", "latin1"), Buffer.from([1, 1, 1, 0, 72, 0, 72])]);
        const ohneVorschau = nachSoi(basis, jpegSegment(0xe0, Buffer.concat([kopf, Buffer.from([0, 0])])));
        const unveraendert = entferneMetadaten(ohneVorschau, "jpeg");
        expect(unveraendert.entfernt).toBe(false);
        expect(Buffer.from(unveraendert.bytes).equals(ohneVorschau)).toBe(true);

        // Ein JFIF mit 2 × 1 Vorschaupunkten (RGB, 6 Bytes) statt keinem.
        const mit = nachSoi(
            basis,
            jpegSegment(0xe0, Buffer.concat([kopf, Buffer.from([2, 1, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])])),
        );
        expect(await roh(mit)).toBeDefined();
        const ergebnis = entferneMetadaten(mit, "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        expect(enthaelt(ergebnis.bytes, "JFIF")).toBe(true);
        expect(Buffer.from(ergebnis.bytes).includes(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]))).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(ohneVorschau)).toBe(true);
        await gleicheBildpunkte(mit, ergebnis.bytes);
    });

    it("ein JFXX (Erweiterung mit Vorschaubild) fällt weg", async () => {
        const basis = await grund().jpeg().toBuffer();
        const jfxx = jpegSegment(0xe0, Buffer.from("JFXX\0\x10GEHEIMES-VORSCHAUBILD", "latin1"));
        const ergebnis = entferneMetadaten(nachSoi(basis, jfxx), "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        expect(enthaelt(ergebnis.bytes, "GEHEIMES-VORSCHAUBILD")).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(basis)).toBe(true);
    });

    it("ein progressives JPEG (mehrere Bildläufe, Marken dazwischen) bleibt dekodierbar und gleich", async () => {
        const progressiv = await grund().jpeg({ progressive: true }).withExif(GPS).toBuffer();
        const ergebnis = entferneMetadaten(progressiv, "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        nichtsGeheimes(ergebnis.bytes);
        await gleicheBildpunkte(progressiv, ergebnis.bytes);
    });
});

// --- PNG ------------------------------------------------------------------------------------------------------------------------

describe("PNG: Metadaten auf Containerebene entfernen (WI-0272 S3, Fixrunde A)", () => {
    it("🔴 eXIf, tEXt, tIME und Daten hinter IEND fallen weg; die Bildpunkte bleiben gleich, erhaltene Blöcke unverändert", async () => {
        const basis = await grund(4).png().withExif(GPS).withIccProfile("srgb").toBuffer();
        const ausBasis = pngBloecke(basis).map((block) => block.typ);
        expect(ausBasis).toContain("eXIf");
        expect(ausBasis).toContain("iCCP");
        const mit = Buffer.concat([
            pngMit(
                basis,
                [
                    pngBlock("gAMA", Buffer.from([0, 1, 0xb1, 0x8f])),
                    pngBlock("pHYs", Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1])),
                ],
                [
                    pngBlock("tEXt", Buffer.from("Prompt\0TEXT-GEHEIM", "latin1")),
                    pngBlock("iTXt", Buffer.from("XML:com.adobe.xmp\0\0\0\0\0XMP-GEHEIM", "latin1")),
                    pngBlock("tIME", Buffer.from([7, 234, 11, 1, 12, 0, 0])),
                    pngBlock("caBX", Buffer.from("C2PA-GEHEIM")),
                ],
            ),
            Buffer.from("HINTEN-GEHEIM"),
        ]);
        const ergebnis = entferneMetadaten(mit, "png");
        expect(ergebnis.entfernt).toBe(true);
        nichtsGeheimes(ergebnis.bytes);
        expect(enthaelt(ergebnis.bytes, "C2PA-GEHEIM")).toBe(false);
        const typen = pngBloecke(ergebnis.bytes).map((block) => block.typ);
        expect(typen[0]).toBe("IHDR");
        expect(typen.at(-1)).toBe("IEND");
        for (const typ of ["eXIf", "tEXt", "iTXt", "tIME", "caBX"]) expect(typen).not.toContain(typ);
        for (const typ of ["iCCP", "gAMA", "pHYs", "IDAT"]) expect(typen).toContain(typ);
        // Die Blöcke, die bleiben, sind Byte für Byte die ursprünglichen (CRCs unverändert).
        const alt = Buffer.from(mit);
        const neu = Buffer.from(ergebnis.bytes);
        const erhalten = pngBloecke(mit).filter((block) => typen.includes(block.typ));
        const jetzt = pngBloecke(neu);
        expect(jetzt.map((block) => block.typ)).toEqual(erhalten.map((block) => block.typ));
        jetzt.forEach((block, index) => {
            const original = erhalten[index]!;
            expect(
                neu
                    .subarray(block.stelle, block.stelle + block.laenge)
                    .equals(alt.subarray(original.stelle, original.stelle + original.laenge)),
                block.typ,
            ).toBe(true);
        });
        // Nichts hinter IEND.
        const letzter = pngBloecke(ergebnis.bytes).at(-1)!;
        expect(letzter.stelle + letzter.laenge).toBe(ergebnis.bytes.length);
        const meta = await sharp(ergebnis.bytes).metadata();
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeDefined();
        await gleicheBildpunkte(mit, ergebnis.bytes);
    });

    it("ein Bild ohne Metadaten bleibt, wie es ist", async () => {
        const sauber = await grund(4).png().toBuffer();
        const ergebnis = entferneMetadaten(sauber, "png");
        expect(ergebnis.entfernt).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(sauber)).toBe(true);
    });
});

// --- WebP -----------------------------------------------------------------------------------------------------------------------

describe("WebP: Metadaten auf Containerebene entfernen (WI-0272 S3, Fixrunde A)", () => {
    it("🔴 EXIF und XMP fallen weg, die Flags in VP8X werden gelöscht, die RIFF-Größe stimmt, dieselben Bildpunkte", async () => {
        const basis = await grund()
            .webp({ lossless: true })
            .withExif(GPS)
            .withXmp("<x:xmpmeta>XMP-GEHEIM</x:xmpmeta>")
            .withIccProfile("srgb")
            .toBuffer();
        const vorher = riffBloecke(basis);
        const typenVorher = vorher.map((block) => block.typ);
        expect(typenVorher).toContain("EXIF");
        expect(typenVorher).toContain("XMP ");
        const vp8x = vorher.find((block) => block.typ === "VP8X")!;
        expect(basis[vp8x.stelle + 8]! & 0x0c).toBe(0x0c);
        // Ein Block mit ungerader Länge (Polsterbyte) und Daten hinter dem Ende der Datei kommen dazu.
        const mit = Buffer.concat([
            riffAnhaengen(basis, "JUNK", Buffer.from("TEXT-GEHEIM")),
            Buffer.from("HINTEN-GEHEIM"),
        ]);

        const ergebnis = entferneMetadaten(mit, "webp");
        expect(ergebnis.entfernt).toBe(true);
        nichtsGeheimes(ergebnis.bytes);
        const out = Buffer.from(ergebnis.bytes);
        // RIFF-Größe: die Datei ohne die ersten acht Bytes, und es steht nichts dahinter.
        expect(out.readUInt32LE(4)).toBe(out.length - 8);
        expect(out.toString("latin1", 0, 4)).toBe("RIFF");
        expect(out.toString("latin1", 8, 12)).toBe("WEBP");
        const nachher = riffBloecke(out);
        const typen = nachher.map((block) => block.typ);
        for (const typ of ["EXIF", "XMP ", "JUNK"]) expect(typen).not.toContain(typ);
        expect(typen).toContain("VP8X");
        expect(typen).toContain("ICCP");
        const neuesVp8x = nachher.find((block) => block.typ === "VP8X")!;
        expect(out[neuesVp8x.stelle + 8]! & 0x0c).toBe(0);
        // Die übrigen Flags bleiben (ICC).
        expect(out[neuesVp8x.stelle + 8]! & 0x20).toBe(basis[vp8x.stelle + 8]! & 0x20);
        const meta = await sharp(out).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["webp", 64, 48]);
        expect(meta.exif).toBeUndefined();
        expect(meta.xmp).toBeUndefined();
        expect(meta.icc).toBeDefined();
        await gleicheBildpunkte(basis, out);
    });

    it("ein verlustbehaftetes WebP ohne VP8X und ohne Metadaten bleibt, wie es ist", async () => {
        const sauber = await grund().webp().toBuffer();
        const ergebnis = entferneMetadaten(sauber, "webp");
        expect(ergebnis.entfernt).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(sauber)).toBe(true);
    });
});

// --- GIF ------------------------------------------------------------------------------------------------------------------------

describe("GIF: Metadaten auf Containerebene entfernen (WI-0272 S3, Fixrunde A)", () => {
    it("🔴 Kommentar, Text- und fremde Application-Erweiterungen und Daten hinter dem Trailer fallen weg; die Schleife bleibt", async () => {
        const basis = await grund().gif().toBuffer();
        const nachTabelle = 13 + gifTabelle(basis);
        const schleife = gifErweiterung(0xff, Buffer.from("NETSCAPE2.0"), Buffer.from([1, 0, 0]));
        const einfuegen = Buffer.concat([
            gifErweiterung(0xfe, Buffer.from("COM-GEHEIM")),
            gifErweiterung(0xff, Buffer.from("XMP DataXMP"), Buffer.from("XMP-GEHEIM")),
            gifErweiterung(
                0x01,
                Buffer.from([12, 0, 0, 0, 0, 0, 0, 0, 0, 8, 8, 0, 0, 0, 1]),
                Buffer.from("TEXT-GEHEIM"),
            ),
            schleife,
        ]);
        const mit = Buffer.concat([
            basis.subarray(0, nachTabelle),
            einfuegen,
            basis.subarray(nachTabelle),
            Buffer.from("HINTEN-GEHEIM"),
        ]);
        expect((await sharp(mit).metadata()).format).toBe("gif");
        const ergebnis = entferneMetadaten(mit, "gif");
        expect(ergebnis.entfernt).toBe(true);
        nichtsGeheimes(ergebnis.bytes);
        expect(enthaelt(ergebnis.bytes, "NETSCAPE2.0")).toBe(true);
        expect(enthaelt(ergebnis.bytes, "XMP DataXMP")).toBe(false);
        expect(ergebnis.bytes.at(-1)).toBe(0x3b);
        const meta = await sharp(ergebnis.bytes).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(["gif", 64, 48]);
        await gleicheBildpunkte(mit, ergebnis.bytes);
    });

    it("ein Bild ohne Metadaten bleibt, wie es ist", async () => {
        const sauber = await grund().gif().toBuffer();
        const ergebnis = entferneMetadaten(sauber, "gif");
        expect(ergebnis.entfernt).toBe(false);
        expect(Buffer.from(ergebnis.bytes).equals(sauber)).toBe(true);
    });
});

// --- kaputte Eingaben -----------------------------------------------------------------------------------------------------------

/** Wirft die Funktion, dann ausschließlich `MetadatenFehler` mit dem Code `unsupported` (nie ein RangeError, nie eine Endlosschleife). */
function nurSauberesScheitern(bytes: Uint8Array, format: "jpeg" | "png" | "webp" | "gif"): "ok" | "fehler" {
    try {
        entferneMetadaten(bytes, format);
        return "ok";
    } catch (fehler) {
        expect(fehler).toBeInstanceOf(MetadatenFehler);
        expect((fehler as MetadatenFehler).code).toBe("unsupported");
        return "fehler";
    }
}

describe("kaputte Eingaben: unsupported statt Absturz (WI-0272 S3, Fixrunde A)", () => {
    const beispiele = async () => ({
        jpeg: await grund().jpeg().withExif(GPS).toBuffer(),
        png: await grund(4).png().withExif(GPS).toBuffer(),
        webp: await grund().webp({ lossless: true }).withExif(GPS).toBuffer(),
        gif: await grund().gif().toBuffer(),
    });

    it("🔴 jede Abschneidung jeder Form wirft MetadatenFehler (unsupported) oder geht durch, nie etwas anderes", async () => {
        const alle = await beispiele();
        for (const [format, bytes] of Object.entries(alle) as ["jpeg" | "png" | "webp" | "gif", Buffer][]) {
            let fehlgeschlagen = 0;
            for (let laenge = 0; laenge < bytes.length; laenge += 1) {
                if (nurSauberesScheitern(bytes.subarray(0, laenge), format) === "fehler") fehlgeschlagen += 1;
            }
            // Fast jede Abschneidung ist ein Fehler (das Ende fehlt: EOI, IEND, Größe, Trailer).
            expect(fehlgeschlagen, format).toBeGreaterThan(bytes.length - 8);
            expect(nurSauberesScheitern(bytes, format)).toBe("ok");
        }
    });

    it("verfälschte Bytes (Längen, Marken) werfen nur MetadatenFehler und hängen nie", async () => {
        const alle = await beispiele();
        let zustand = 0x2545f491;
        const zufall = (bis: number): number => {
            zustand ^= zustand << 13;
            zustand ^= zustand >>> 17;
            zustand ^= zustand << 5;
            return (zustand >>> 0) % bis;
        };
        for (const [format, bytes] of Object.entries(alle) as ["jpeg" | "png" | "webp" | "gif", Buffer][]) {
            for (let lauf = 0; lauf < 600; lauf += 1) {
                const kopie = Buffer.from(bytes);
                for (let n = 1 + zufall(4); n > 0; n -= 1) kopie[zufall(Math.min(kopie.length, 400))] = zufall(256);
                nurSauberesScheitern(kopie, format);
            }
        }
    });

    it("ein Segment mit Länge über das Ende, eine fehlende Marke und ein Text als Bild sind unsupported", async () => {
        const jpeg = await grund().jpeg().withExif(GPS).toBuffer();
        const zuLang = Buffer.from(jpeg);
        zuLang.writeUInt16BE(0xffff, 4);
        expect(() => entferneMetadaten(zuLang, "jpeg")).toThrow(MetadatenFehler);
        const keineMarke = Buffer.from(jpeg);
        keineMarke[2] = 0x00;
        expect(() => entferneMetadaten(keineMarke, "jpeg")).toThrow(MetadatenFehler);
        const text = Buffer.from("das ist kein Bild, nur ein Text");
        for (const format of ["jpeg", "png", "webp", "gif"] as const) {
            expect(() => entferneMetadaten(text, format)).toThrow(MetadatenFehler);
            expect(() => entferneMetadaten(new Uint8Array(0), format)).toThrow(MetadatenFehler);
        }
        expect(() => entferneMetadaten(jpeg.subarray(0, 40), "jpeg")).toThrowError(
            expect.objectContaining({ code: "unsupported" }) as Error,
        );
    });

    it("ein WebP, dessen Größe über das Ende reicht, und ein PNG ohne IEND sind unsupported", async () => {
        const webp = await grund().webp({ lossless: true }).withExif(GPS).toBuffer();
        const zuGross = Buffer.from(webp);
        zuGross.writeUInt32LE(webp.length + 100, 4);
        expect(() => entferneMetadaten(zuGross, "webp")).toThrow(MetadatenFehler);
        const png = await grund(4).png().toBuffer();
        expect(() => entferneMetadaten(png.subarray(0, png.length - 12), "png")).toThrow(MetadatenFehler);
    });
});

// --- Ausrichtung ----------------------------------------------------------------------------------------------------------------

describe("Ausrichtung im EXIF: ungleich 1 wird abgewiesen (WI-0272 S3, Fixrunde A)", () => {
    it("🔴 Orientierung 6 wird abgewiesen, Orientierung 1 nicht (JPEG)", async () => {
        const gedreht = await grund().jpeg().withMetadata({ orientation: 6 }).toBuffer();
        expect((await sharp(gedreht).metadata()).orientation).toBe(6);
        expect(() => entferneMetadaten(gedreht, "jpeg")).toThrow(MetadatenFehler);
        expect(() => entferneMetadaten(gedreht, "jpeg")).toThrowError(
            expect.objectContaining({ code: "unsupported" }) as Error,
        );

        const gerade = await grund().jpeg().withMetadata({ orientation: 1 }).toBuffer();
        const ergebnis = entferneMetadaten(gerade, "jpeg");
        expect(ergebnis.entfernt).toBe(true);
        expect((await sharp(ergebnis.bytes).metadata()).exif).toBeUndefined();
    });

    it("dasselbe in PNG (eXIf) und WebP (EXIF)", async () => {
        const png = await grund(4).png().withMetadata({ orientation: 6 }).toBuffer();
        expect(pngBloecke(png).map((block) => block.typ)).toContain("eXIf");
        expect(() => entferneMetadaten(png, "png")).toThrow(MetadatenFehler);
        const webp = await grund().webp({ lossless: true }).withMetadata({ orientation: 8 }).toBuffer();
        expect(riffBloecke(webp).map((block) => block.typ)).toContain("EXIF");
        expect(() => entferneMetadaten(webp, "webp")).toThrow(MetadatenFehler);
        const pngEins = await grund(4).png().withMetadata({ orientation: 1 }).toBuffer();
        expect(entferneMetadaten(pngEins, "png").entfernt).toBe(true);
    });

    it("der TIFF-Leser versteht beide Byte-Ordnungen und wirft nie: unlesbar zählt als 1", () => {
        for (const ordnung of ["II", "MM"] as const) {
            for (const wert of [1, 2, 3, 4, 5, 6, 7, 8])
                expect(exifAusrichtung(tiff(wert, ordnung)), `${ordnung} ${String(wert)}`).toBe(wert);
            // Werte außerhalb von 1 bis 8 sind keine Ausrichtung.
            expect(exifAusrichtung(tiff(0, ordnung))).toBe(1);
            expect(exifAusrichtung(tiff(9, ordnung))).toBe(1);
        }
        const ganz = tiff(6);
        // Der Eintrag endet bei Byte 22; was davor abgeschnitten ist, ist unlesbar.
        for (let laenge = 0; laenge < 22; laenge += 1) expect(exifAusrichtung(ganz.subarray(0, laenge))).toBe(1);
        expect(exifAusrichtung(ganz.subarray(0, 22))).toBe(6);
        expect(exifAusrichtung(Buffer.from("kein TIFF, nur Text"))).toBe(1);
        const falscheZahl = tiff(6);
        falscheZahl.writeUInt16LE(41, 2);
        expect(exifAusrichtung(falscheZahl)).toBe(1);
        const weitDraussen = tiff(6);
        weitDraussen.writeUInt32LE(0xfffffff0, 4);
        expect(exifAusrichtung(weitDraussen)).toBe(1);
        // Sehr viele angegebene Einträge, aber keiner mit dieser Marke, und das Verzeichnis endet früh: 1.
        const vieleEintraege = tiff(6);
        vieleEintraege.writeUInt16LE(0xffff, 8);
        vieleEintraege.writeUInt16LE(0x0100, 10);
        expect(exifAusrichtung(vieleEintraege)).toBe(1);
        let zustand = 12345;
        for (let lauf = 0; lauf < 2000; lauf += 1) {
            const zufall = Buffer.alloc(40);
            for (let stelle = 0; stelle < zufall.length; stelle += 1) {
                zustand = (zustand * 1103515245 + 12345) & 0x7fffffff;
                zufall[stelle] = zustand >>> 16;
            }
            zufall.write("II", 0, "latin1");
            zufall.writeUInt16LE(42, 2);
            expect(exifAusrichtung(zufall)).toBeGreaterThanOrEqual(1);
        }
    });

    it("eine Ausrichtung in einem handgebauten EXIF-Segment (Big Endian) wird erkannt", async () => {
        const basis = await grund().jpeg().toBuffer();
        const exif = jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff(6, "MM")]));
        expect(() => entferneMetadaten(nachSoi(basis, exif), "jpeg")).toThrow(MetadatenFehler);
        const eins = jpegSegment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff(1, "MM")]));
        expect(entferneMetadaten(nachSoi(basis, eins), "jpeg").entfernt).toBe(true);
    });
});
