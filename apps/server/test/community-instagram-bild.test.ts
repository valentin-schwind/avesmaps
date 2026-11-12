import { describe, expect, it } from "vitest";
import sharp, { type OverlayOptions, type Sharp } from "sharp";
import {
    INSTAGRAM_BILD,
    InstagramBildFehler,
    macheInstagramBild,
    rechneZuschnitt,
} from "../src/community/social/instagram-bild.ts";

/**
 * Die JPEG-Fassung für Instagram (WI-0268 C12b), rein: Bytes hinein, Bytes heraus. Instagram nimmt nur JPEG im Fenster 4:5 bis 1,91:1, höchstens 8 MiB; die Regeln sind die von Legacy
 * (`api/_internal/social/media.php`): mittig zuschneiden, nie stauchen, nur verkleinern (1440 Pixel), Transparenz auf Weiß, keine Metadaten.
 */

type Farbe = { r: number; g: number; b: number };
const ROT: Farbe = { r: 255, g: 0, b: 0 };
const GRUEN: Farbe = { r: 0, g: 255, b: 0 };
const BLAU: Farbe = { r: 0, g: 0, b: 255 };

/** Ein WebP aus drei Streifen: `a`, die Mitte `b` und `c` (waagerecht nebeneinander oder senkrecht untereinander). So sieht der Test, WAS der Zuschnitt behält. */
async function streifen(
    breite: number,
    hoehe: number,
    richtung: "senkrecht" | "waagerecht",
    farben: readonly [Farbe, Farbe, Farbe],
): Promise<Buffer> {
    const drittel = richtung === "senkrecht" ? Math.floor(hoehe / 4) : Math.floor(breite / 4);
    const teile = [drittel, (richtung === "senkrecht" ? hoehe : breite) - 2 * drittel, drittel];
    let versatz = 0;
    const lagen: OverlayOptions[] = [];
    for (const [i, laenge] of teile.entries()) {
        const farbe = farben[i] as Farbe;
        lagen.push({
            input: await sharp({
                create: {
                    width: richtung === "senkrecht" ? breite : laenge,
                    height: richtung === "senkrecht" ? laenge : hoehe,
                    channels: 3,
                    background: farbe,
                },
            })
                .png()
                .toBuffer(),
            left: richtung === "senkrecht" ? 0 : versatz,
            top: richtung === "senkrecht" ? versatz : 0,
        });
        versatz += laenge;
    }
    return sharp({ create: { width: breite, height: hoehe, channels: 3, background: ROT } })
        .composite(lagen)
        .webp({ lossless: true })
        .toBuffer();
}

const glatt = (breite: number, hoehe: number): Promise<Buffer> =>
    sharp({ create: { width: breite, height: hoehe, channels: 3, background: { r: 90, g: 120, b: 150 } } })
        .webp()
        .toBuffer();

/** Das Pixel (x, y) des Ergebnisses als RGB. */
async function pixel(bytes: Buffer, x: number, y: number): Promise<[number, number, number]> {
    const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i] ?? -1, data[i + 1] ?? -1, data[i + 2] ?? -1];
}

const nah = (ist: readonly number[], soll: Farbe, toleranz = 12): void => {
    expect(Math.abs((ist[0] ?? -999) - soll.r)).toBeLessThanOrEqual(toleranz);
    expect(Math.abs((ist[1] ?? -999) - soll.g)).toBeLessThanOrEqual(toleranz);
    expect(Math.abs((ist[2] ?? -999) - soll.b)).toBeLessThanOrEqual(toleranz);
};

describe("Instagram-Fassung: Zuschnitt auf 4:5 bis 1,91:1", () => {
    it("🔴 ein Hochformat, das zu schmal ist, verliert oben und unten und endet bei 0,8", async () => {
        // 400 × 1000 (0,4): oben und unten je ein Viertel Rot/Blau, die Mitte Grün. Behalten wird die Mitte, 400 × 500.
        const erg = await macheInstagramBild(await streifen(400, 1000, "senkrecht", [ROT, GRUEN, BLAU]));
        expect([erg.breite, erg.hoehe]).toEqual([400, 500]);
        expect(erg.beschnitten).toBe(true);
        const meta = await sharp(erg.bytes).metadata();
        expect([meta.width, meta.height]).toEqual([400, 500]);
        // Nie gestaucht: die ganze Fläche ist die Mitte, weder Rot noch Blau aus den abgeschnittenen Rändern.
        for (const [x, y] of [
            [5, 5],
            [394, 5],
            [200, 250],
            [5, 494],
            [394, 494],
        ] as const)
            nah(await pixel(erg.bytes, x, y), GRUEN);
    });

    it("🔴 ein Panorama, das zu breit ist, verliert links und rechts und endet bei 1,91", async () => {
        // 2000 × 400 (5:1): links und rechts je ein Viertel Rot/Blau. 400 × 1,91 = 764 breit bleiben von der Mitte.
        const erg = await macheInstagramBild(await streifen(2000, 400, "waagerecht", [ROT, GRUEN, BLAU]));
        expect([erg.breite, erg.hoehe]).toEqual([764, 400]);
        expect(erg.beschnitten).toBe(true);
        expect(erg.breite / erg.hoehe).toBeLessThanOrEqual(1.91);
        for (const [x, y] of [
            [5, 5],
            [758, 5],
            [382, 200],
            [5, 394],
            [758, 394],
        ] as const)
            nah(await pixel(erg.bytes, x, y), GRUEN);
    });

    it("🔴 beide Grenzen des Fensters gehören dazu: 4:5 und 1,91:1 bleiben unberührt", async () => {
        const hoch = await macheInstagramBild(await glatt(800, 1000));
        expect([hoch.breite, hoch.hoehe, hoch.beschnitten]).toEqual([800, 1000, false]);
        const quer = await macheInstagramBild(await glatt(1910, 1000));
        // 1910 > 1440: verkleinert, aber nicht zugeschnitten.
        expect(quer.beschnitten).toBe(false);
        expect(quer.breite).toBe(1440);
        expect(quer.hoehe).toBe(754);
        const quadrat = await macheInstagramBild(await glatt(500, 500));
        expect([quadrat.breite, quadrat.hoehe, quadrat.beschnitten]).toEqual([500, 500, false]);
    });

    it("ein Bild von 1 × 1 Pixel kommt an (kein Teilen durch null)", async () => {
        const erg = await macheInstagramBild(await glatt(1, 1));
        expect([erg.breite, erg.hoehe]).toEqual([1, 1]);
    });

    it("🔴 die EXIF-Ausrichtung wird zuerst angewendet: der Zuschnitt rechnet auf dem, was man sieht", async () => {
        // Rohmaß 600 × 300, EXIF 6 (90° drehen): sichtbar 300 × 600 (0,5) → zu schmal → 300 × 375.
        const gedreht = await sharp({ create: { width: 600, height: 300, channels: 3, background: GRUEN } })
            .jpeg()
            .withMetadata({ orientation: 6 })
            .toBuffer();
        const erg = await macheInstagramBild(gedreht);
        expect([erg.breite, erg.hoehe, erg.beschnitten]).toEqual([300, 375, true]);
    });

    it("🔴 nach dem Zuschnitt liegt das Verhältnis für jedes Maß im Fenster (rechnerisch, ganzzahlig)", () => {
        const maße = [
            ...Array.from({ length: 70 }, (_, i) => i + 1),
            99,
            100,
            799,
            800,
            801,
            1000,
            1439,
            1440,
            1441,
            1910,
            1911,
            2000,
            4096,
            5000,
            8192,
        ];
        for (const breite of maße) {
            for (const hoehe of maße) {
                const z = rechneZuschnitt(breite, hoehe);
                const beschr = `${String(breite)}×${String(hoehe)} → ${String(z.zielBreite)}×${String(z.zielHoehe)}`;
                // 0,8 ≤ b/h ≤ 1,91, ohne Gleitkomma.
                expect(z.zielBreite * 5 >= z.zielHoehe * 4, beschr).toBe(true);
                expect(z.zielBreite * 100 <= z.zielHoehe * 191, beschr).toBe(true);
                expect(z.zielBreite, beschr).toBeLessThanOrEqual(INSTAGRAM_BILD.maxBreite);
                expect(z.zielBreite, beschr).toBeGreaterThanOrEqual(1);
                expect(z.zielHoehe, beschr).toBeGreaterThanOrEqual(1);
                // Nur zuschneiden, nie größer als die Quelle.
                expect(z.width + z.left, beschr).toBeLessThanOrEqual(breite);
                expect(z.height + z.top, beschr).toBeLessThanOrEqual(hoehe);
            }
        }
    });
});

describe("Instagram-Fassung: Größe, Transparenz, Metadaten", () => {
    it("🔴 nur verkleinern: höchstens 1440 Pixel breit, im selben Verhältnis; ein kleines Bild bleibt, wie es ist", async () => {
        const gross = await macheInstagramBild(await glatt(3000, 2000));
        expect([gross.breite, gross.hoehe, gross.beschnitten]).toEqual([1440, 960, false]);
        const klein = await macheInstagramBild(await glatt(600, 400));
        expect([klein.breite, klein.hoehe]).toEqual([600, 400]);
        // Zu breit UND zu groß: erst zuschneiden (1910 × 1000), dann auf 1440 verkleinern.
        const beides = await macheInstagramBild(await glatt(4000, 1000));
        expect([beides.breite, beides.hoehe, beides.beschnitten]).toEqual([1440, 754, true]);
        const meta = await sharp(beides.bytes).metadata();
        expect([meta.width, meta.height]).toEqual([1440, 754]);
    });

    it("🔴 das Ergebnis ist ein JPEG laut Magic Bytes (nie die Bytes der Quelle)", async () => {
        const quelle = await glatt(300, 300);
        const erg = await macheInstagramBild(quelle);
        expect([...erg.bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);
        expect([...erg.bytes.subarray(-2)]).toEqual([0xff, 0xd9]);
        expect(Buffer.compare(erg.bytes, quelle)).not.toBe(0);
        expect((await sharp(erg.bytes).metadata()).format).toBe("jpeg");
        // Auch ein JPEG als Quelle wird neu geschrieben (Metadaten!), nicht durchgereicht.
        const jpeg = await sharp({ create: { width: 300, height: 300, channels: 3, background: ROT } })
            .jpeg()
            .toBuffer();
        expect((await macheInstagramBild(jpeg)).bytes.byteLength).toBeGreaterThan(0);
    });

    it.each([
        ["WebP", (s: Sharp) => s.webp({ lossless: true })],
        ["PNG", (s: Sharp) => s.png()],
    ])("🔴 ein durchsichtiges %s liegt auf Weiß, ohne Alphakanal", async (_name, format) => {
        const leer = await format(
            sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }),
        ).toBuffer();
        const erg = await macheInstagramBild(leer);
        const meta = await sharp(erg.bytes).metadata();
        expect(meta.hasAlpha).toBe(false);
        expect(meta.format).toBe("jpeg");
        nah(await pixel(erg.bytes, 10, 10), { r: 255, g: 255, b: 255 }, 3);
        nah(await pixel(erg.bytes, 200, 200), { r: 255, g: 255, b: 255 }, 3);
    });

    it("Halbdurchsichtiges mischt sich MIT dem Weiß (schwarz bei halber Deckung wird mittelgrau, nicht schwarz)", async () => {
        const halb = await sharp({
            create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.5 } },
        })
            .png()
            .toBuffer();
        const erg = await macheInstagramBild(halb);
        const [r, g, b] = await pixel(erg.bytes, 200, 200);
        for (const kanal of [r, g, b]) {
            expect(kanal).toBeGreaterThan(110);
            expect(kanal).toBeLessThan(145);
        }
    });

    it("🔴 keine Metadaten: weder EXIF noch Farbprofil im Ergebnis", async () => {
        const mit = await sharp({ create: { width: 500, height: 400, channels: 3, background: GRUEN } })
            .withExif({ IFD0: { Copyright: "Geheim-Nutzername", Artist: "Gerät-12345" } })
            .withIccProfile("srgb")
            .webp()
            .toBuffer();
        // Die Quelle trägt es wirklich (sonst bewiese der Test nichts).
        expect((await sharp(mit).metadata()).exif).toBeDefined();
        const erg = await macheInstagramBild(mit);
        const meta = await sharp(erg.bytes).metadata();
        expect(meta.exif).toBeUndefined();
        expect(meta.icc).toBeUndefined();
        expect(erg.bytes.includes(Buffer.from("Geheim-Nutzername"))).toBe(false);
        expect(erg.bytes.includes(Buffer.from("Gerät-12345"))).toBe(false);
    });

    it("🔴 höchstens 8 MiB: ist das Ergebnis zu groß, sinkt die Qualität schrittweise", async () => {
        // Ein Bild mit Rauschen (schlecht zu komprimieren), damit die Qualität einen Unterschied macht.
        const roh = Buffer.alloc(900 * 900 * 3);
        for (let i = 0; i < roh.length; i += 1) roh[i] = (i * 2654435761) % 251;
        const rauschen = await sharp(roh, { raw: { width: 900, height: 900, channels: 3 } })
            .webp({ lossless: true })
            .toBuffer();
        const vollQualitaet = await macheInstagramBild(rauschen);
        const grenze = INSTAGRAM_BILD as { maxBytes: number };
        const alt = grenze.maxBytes;
        try {
            grenze.maxBytes = vollQualitaet.bytes.byteLength - 1;
            const kleiner = await macheInstagramBild(rauschen);
            expect(kleiner.bytes.byteLength).toBeLessThanOrEqual(grenze.maxBytes);
            expect(kleiner.bytes.byteLength).toBeLessThan(vollQualitaet.bytes.byteLength);
            // Dieselben Maße: Nur die Qualität sinkt.
            expect([kleiner.breite, kleiner.hoehe]).toEqual([vollQualitaet.breite, vollQualitaet.hoehe]);
            // Und was auch bei der niedrigsten Qualität zu groß bleibt, ist ein Fehler (nie ein zu großes Bild).
            grenze.maxBytes = 100;
            await expect(macheInstagramBild(rauschen)).rejects.toThrow(InstagramBildFehler);
        } finally {
            grenze.maxBytes = alt;
        }
        expect(INSTAGRAM_BILD.maxBytes).toBe(8 * 1024 * 1024);
    }, 60_000);

    it("🔴 etwas, das kein Bild ist, ist ein Fehler mit kurzem Satz (kein Pfad, kein Text der Bibliothek)", async () => {
        const kaputt = await macheInstagramBild(new TextEncoder().encode("das ist kein Bild")).catch((e: unknown) => e);
        expect(kaputt).toBeInstanceOf(InstagramBildFehler);
        expect((kaputt as Error).message).toBe("Das Bild lässt sich nicht für Instagram aufbereiten");
        const leer = await macheInstagramBild(new Uint8Array()).catch((e: unknown) => e);
        expect(leer).toBeInstanceOf(InstagramBildFehler);
        const abgeschnitten = (await glatt(400, 400)).subarray(0, 60);
        await expect(macheInstagramBild(abgeschnitten)).rejects.toThrow(InstagramBildFehler);
    });
});
