import sharp from "sharp";
import { RASTER_ENGINE } from "../../media/raster/limits.ts";

/**
 * Die JPEG-Fassung für Instagram (WI-0268 C12b; Legacy `api/_internal/social/media.php` → `avesmapsSocialEncodeImageBytes`, dieselben Regeln). Instagram nimmt über die Graph-Schnittstelle (`image_url`) NUR
 * JPEG, höchstens 8 MiB, im Seitenverhältnis 4:5 bis 1,91:1; der Hub hat nur veröffentlichte WebP. Diese Datei ist die reine Umwandlung (Bytes hinein, Bytes heraus, kein Dateizugriff); wo die Fassung liegt und
 * wann sie entsteht, regelt `instagram-ableitung.ts`.
 *
 * - 💣 **Zuschneiden, nie stauchen:** Nur EINE Kante schrumpft. Zu hoch verliert oben und unten, zu breit links und rechts, mittig. Beide Grenzen des Fensters sind eingeschlossen: Ein Bild genau auf 4:5 oder
 *   1,91:1 bleibt unberührt. Eine Karte, die verzerrt auf Instagram steht, ist genau der Fehler, den dieses Projekt vermeiden will.
 * - **Nur verkleinern:** höchstens 1440 Pixel breit, NACH dem Zuschnitt und im selben Verhältnis. Was schon darunter liegt, wird nicht neu gerechnet. Das Runden schiebt das Verhältnis nie aus dem Fenster: Der Zuschnitt rundet ab (ganzzahlig), und beim Verkleinern auf 1440 ergeben sich
 *   Höhen in [754; 1800], deren Verhältnis 1440 durch Höhe wieder im Fenster liegt (die Probe in `instagram-bild.test.ts` rechnet es für viele Maße nach).
 * - 💣 **Transparenz auf Weiß:** JPEG kennt keine. Ein durchsichtiges Bild käme sonst schwarz heraus, erst nach dem Veröffentlichen sichtbar. `flatten` legt Halbdurchsichtiges MIT dem Weiß, nicht darüber.
 * - **Keine Metadaten:** weder EXIF (Ort, Gerät) noch Farbprofil; die Ausrichtung des Quellbilds wird vorher angewendet. Das Ergebnis ist sRGB.
 * - **Höchstens 8 MiB:** Qualität 88 (mozjpeg); ist das Ergebnis größer, sinkt sie schrittweise, und was dann noch zu groß ist, ist ein Fehler. Nie wird ein Bild stillschweigend schlechter, als nötig.
 */

/** Das Fenster, das Instagram nimmt (Seitenverhältnis Breite durch Höhe), die Breite, die Qualität und die Größe der Datei. */
export const INSTAGRAM_BILD = {
    /** 4:5 (Hochformat, Verhältnis 0,8), als Bruch Breite : Höhe: An der Grenze entscheidet so kein Gleitkommafehler. */
    minVerhaeltnis: { breite: 4, hoehe: 5 },
    /** 1,91:1 (Querformat). */
    maxVerhaeltnis: { breite: 191, hoehe: 100 },
    /** Längste Breite in Pixeln; sie ist eine Obergrenze, kein Ziel. */
    maxBreite: 1440,
    /** Die JPEG-Qualitäten der Reihe nach (88 wie Legacy); die erste, deren Ergebnis in die Grenze passt, gewinnt. */
    qualitaetStufen: [88, 80, 72, 64, 56] as readonly number[],
    /** Höchste Größe der Datei: die Grenze von Instagram (8 MiB). */
    maxBytes: 8 * 1024 * 1024,
} as const;

export interface InstagramBild {
    /** Die JPEG-Datei. */
    readonly bytes: Buffer;
    /** Die ENDGÜLTIGEN Maße (nach Zuschnitt und Verkleinern). */
    readonly breite: number;
    readonly hoehe: number;
    /** War ein Zuschnitt nötig? Verkleinern allein macht ein Bild nicht „beschnitten“ (es geht kein Inhalt verloren). */
    readonly beschnitten: boolean;
}

/** Das Bild ist nicht (mehr) lesbar oder nicht in eine Fassung für Instagram zu bringen. Der Text nennt weder Pfad noch Ursache der Bibliothek. */
export class InstagramBildFehler extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = "InstagramBildFehler";
    }
}

let engineEingestellt = false;

/** Einmal je Prozess: ein libvips-Arbeitsthread, kein Operationscache (Claudios Bedingung, `media/raster/limits.ts`; derselbe Wert wie bei der Rasterpipeline). */
function stelleEngineEin(): void {
    if (engineEingestellt) return;
    sharp.cache(false);
    sharp.concurrency(RASTER_ENGINE.concurrency);
    engineEingestellt = true;
}

/** Der Zuschnitt, das Ziel und ob zugeschnitten wird: reine Rechnung auf den Maßen NACH der Ausrichtung. */
export function rechneZuschnitt(
    breite: number,
    hoehe: number,
): {
    left: number;
    top: number;
    width: number;
    height: number;
    zielBreite: number;
    zielHoehe: number;
    beschnitten: boolean;
} {
    const { minVerhaeltnis: min, maxVerhaeltnis: max } = INSTAGRAM_BILD;
    let width = breite;
    let height = hoehe;
    let beschnitten = false;
    // Ganzzahlig gerechnet und beim Zuschnitt ABGERUNDET: Das Ergebnis liegt immer IM Fenster (gerundet könnte ein sehr schmales Bild knapp daneben landen), die Grenzen selbst gehören dazu.
    if (breite * min.hoehe < hoehe * min.breite) {
        height = Math.floor((breite * min.hoehe) / min.breite);
        beschnitten = true;
    } else if (breite * max.hoehe > hoehe * max.breite) {
        width = Math.floor((hoehe * max.breite) / max.hoehe);
        beschnitten = true;
    }
    // Nie größer als die Quelle und nie null: ein Bild von 1 × 1 Pixel muss ankommen, nicht durch Null teilen.
    width = Math.max(1, Math.min(width, breite));
    height = Math.max(1, Math.min(height, hoehe));
    const left = Math.floor((breite - width) / 2);
    const top = Math.floor((hoehe - height) / 2);
    // Die Obergrenze gilt NACH dem Zuschnitt und im selben Verhältnis: Verkleinern ist kein Stauchen.
    let zielBreite = width;
    let zielHoehe = height;
    if (width > INSTAGRAM_BILD.maxBreite) {
        zielBreite = INSTAGRAM_BILD.maxBreite;
        zielHoehe = Math.max(1, Math.round((height * zielBreite) / width));
    }
    return { left, top, width, height, zielBreite, zielHoehe, beschnitten };
}

/**
 * Wandelt ein Bild (WebP, PNG, JPEG ...) in die Fassung für Instagram. Wirft `InstagramBildFehler`, wenn es sich nicht dekodieren lässt, mehrbildig ist oder auch bei der niedrigsten Qualität über der Grenze bleibt.
 * Gibt NIE die Bytes der Quelle zurück: Ein PNG unter dem Namen `.jpg` wäre genau die Falle, die diese Datei beseitigt.
 */
export async function macheInstagramBild(quelle: Uint8Array): Promise<InstagramBild> {
    if (quelle.byteLength === 0) throw new InstagramBildFehler("Das Bild ist leer");
    stelleEngineEin();
    const eingabe = Buffer.from(quelle.buffer, quelle.byteOffset, quelle.byteLength);
    try {
        const meta = await sharp(eingabe, { failOn: "warning" }).metadata();
        if ((meta.pages ?? 1) > 1) throw new InstagramBildFehler("Das Bild hat mehrere Bilder (animiert)");
        // Die Maße NACH der Ausrichtung (EXIF 5 bis 8 vertauscht Breite und Höhe): Der Zuschnitt rechnet auf dem, was man sieht.
        const breite = meta.autoOrient.width;
        const hoehe = meta.autoOrient.height;
        if (!(breite >= 1) || !(hoehe >= 1)) throw new InstagramBildFehler("Das Bild hat keine lesbaren Maße");
        const z = rechneZuschnitt(breite, hoehe);

        for (const qualitaet of INSTAGRAM_BILD.qualitaetStufen) {
            let pipeline = sharp(eingabe, { failOn: "warning" }).autoOrient();
            if (z.width !== breite || z.height !== hoehe) {
                pipeline = pipeline.extract({ left: z.left, top: z.top, width: z.width, height: z.height });
            }
            // `fill` mit den im selben Verhältnis gerechneten Maßen: reine Verkleinerung, kein zweiter Zuschnitt (die Rundung kostet höchstens ein halbes Pixel).
            if (z.zielBreite !== z.width || z.zielHoehe !== z.height) {
                pipeline = pipeline.resize({ width: z.zielBreite, height: z.zielHoehe, fit: "fill" });
            }
            const { data, info } = await pipeline
                .flatten({ background: "#ffffff" })
                .toColourspace("srgb")
                .timeout({ seconds: RASTER_ENGINE.timeoutSeconds })
                .jpeg({ quality: qualitaet, mozjpeg: true })
                .toBuffer({ resolveWithObject: true });
            if (info.format !== "jpeg") throw new InstagramBildFehler("Die Ausgabe ist kein JPEG");
            if (data.byteLength <= INSTAGRAM_BILD.maxBytes) {
                return { bytes: data, breite: info.width, hoehe: info.height, beschnitten: z.beschnitten };
            }
        }
        throw new InstagramBildFehler("Das Bild bleibt auch bei niedriger Qualität größer als Instagram erlaubt");
    } catch (fehler) {
        if (fehler instanceof InstagramBildFehler) throw fehler;
        throw new InstagramBildFehler("Das Bild lässt sich nicht für Instagram aufbereiten", { cause: fehler });
    }
}
