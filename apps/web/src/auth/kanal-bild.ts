import {
    KANAL_BILD_KANTE,
    KANAL_BILD_KANTE_KLEIN,
    KANAL_BILD_MAX_BYTES,
    type MediaFileUpload,
} from "@avesmaps3d/shared";

/**
 * Bilder für den Betreiber-Kanal im Browser vorbereiten (KANAL-0001 §6.1 Schritt 0, Koordination 2026-10-11): Die Medienverwaltung nimmt
 * höchstens 6 MiB je Rasterdatei, ein Telefonfoto liegt oft darüber, und die Grenze wird nicht angehoben. Darum:
 *
 * - lesen mit `createImageBitmap(datei, { imageOrientation: "from-image" })`, damit ein hochkant gehaltenes Telefonfoto aufrecht steht;
 * - auf einer Leinwand auf die lange Kante 2560 px verkleinern (nie vergrößern) und als WebP (Qualität 0,9) kodieren, sonst PNG;
 * - was eine Leinwand kodiert, trägt keine Metadaten: kein EXIF, keine GPS-Angabe, das Bild verlässt das Gerät ohne Ort;
 * - ist die Datei dann noch über 6 MiB, einmal mit 1920 px; sonst „zu groß“, ohne hochzuladen.
 *
 * Auch ein kleines Bild wird neu kodiert, damit keine Metadaten mitgehen. Der Server verlässt sich nicht darauf (`inspectImage`, Worker).
 *
 * 🪤 **Rückfälle für Safari/iOS und ältere Browser sind Optionen, ohne die alles bleibt, wie es für den Kanal war** (`VorbereitungsOptionen`; das Reisebild-Formular schaltet beide ein, Review S2b I3):
 * Die Leinwand kodiert in Safari kein WebP (`toBlob("image/webp")` liefert PNG), ein Telefonfoto als PNG liegt oft über 6 MiB; und `imageOrientation: "from-image"` kennen ältere Browser nicht
 * (`createImageBitmap` wirft dann einen `TypeError`, den die Vorbereitung als „kein Bild“ meldet).
 */

/** Was die Vorbereitung bei einem Browser tut, dem etwas fehlt. Ohne Angabe gilt jeweils das Verhalten des Betreiber-Kanals (`false`). */
export interface VorbereitungsOptionen {
    /**
     * Kann die Leinwand kein WebP kodieren: JPEG (Qualität 0,9) statt PNG. Durchsichtiges wird vorher weiß unterlegt (JPEG kennt keine Durchsicht, die Leinwand legte sie sonst auf Schwarz);
     * liefert auch die JPEG-Kodierung nichts, bleibt PNG der letzte Weg.
     */
    readonly jpegRueckfall?: boolean;
    /** Wirft `createImageBitmap` mit `{ imageOrientation: "from-image" }`, einmal ohne diese Option lesen (der Browser liest dann mit seiner Vorgabe). */
    readonly ausrichtungOhneOptionWiederholen?: boolean;
}

export type Vorbereitet =
    | { ok: true; datei: MediaFileUpload; breite: number; hoehe: number }
    | { ok: false; grund: "zu_gross" | "kein_bild" };

/** Die Maße nach dem Verkleinern auf `kante` an der langen Seite; ein kleineres Bild bleibt, wie es ist. */
export function zielMasse(breite: number, hoehe: number, kante: number): { breite: number; hoehe: number } {
    const lang = Math.max(breite, hoehe);
    if (lang <= kante) return { breite, hoehe };
    const faktor = kante / lang;
    return { breite: Math.max(1, Math.round(breite * faktor)), hoehe: Math.max(1, Math.round(hoehe * faktor)) };
}

const ENDUNG: Readonly<Record<string, string>> = { "image/webp": "webp", "image/jpeg": "jpg" };

/** Der Dateiname zur Anzeige: der alte Name ohne Endung, die neue Endung dazu (`webp`, `jpg`, sonst `png`). */
export function neuerName(name: string, typ: string): string {
    const stamm =
        name
            .replace(/\.[^.]*$/u, "")
            .replace(/[/\\]/gu, "")
            .trim() || "bild";
    return `${stamm.slice(0, 200)}.${ENDUNG[typ] ?? "png"}`;
}

function kodiere(leinwand: HTMLCanvasElement, typ: string, qualitaet?: number): Promise<Blob | null> {
    return new Promise((resolve) => leinwand.toBlob(resolve, typ, qualitaet));
}

/** JPEG (0,9); `null`, wenn die Leinwand es nicht kodiert. Weiß wird HINTER das Gezeichnete gelegt: Durchsichtiges würde sonst schwarz. */
async function kodiereJpeg(
    leinwand: HTMLCanvasElement,
    masse: { breite: number; hoehe: number },
): Promise<Blob | null> {
    const kontext = leinwand.getContext("2d");
    if (kontext !== null) {
        kontext.globalCompositeOperation = "destination-over";
        kontext.fillStyle = "#ffffff";
        kontext.fillRect(0, 0, masse.breite, masse.hoehe);
    }
    const blob = await kodiere(leinwand, "image/jpeg", 0.9);
    return blob !== null && blob.type === "image/jpeg" ? blob : null;
}

async function base64(blob: Blob): Promise<string> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binaer = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binaer += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binaer);
}

/** Das Bild lesen, aufrecht gestellt; `undefined`, wenn der Browser es nicht lesen kann. */
async function liesBild(datei: File, wiederholenOhneAusrichtung: boolean): Promise<ImageBitmap | undefined> {
    try {
        return await createImageBitmap(datei, { imageOrientation: "from-image" });
    } catch {
        if (!wiederholenOhneAusrichtung) return undefined;
    }
    try {
        return await createImageBitmap(datei);
    } catch {
        return undefined;
    }
}

export async function bildVorbereiten(datei: File, optionen: VorbereitungsOptionen = {}): Promise<Vorbereitet> {
    const bitmap = await liesBild(datei, optionen.ausrichtungOhneOptionWiederholen === true);
    if (bitmap === undefined) return { ok: false, grund: "kein_bild" };
    try {
        for (const kante of [KANAL_BILD_KANTE, KANAL_BILD_KANTE_KLEIN]) {
            const masse = zielMasse(bitmap.width, bitmap.height, kante);
            const leinwand = document.createElement("canvas");
            leinwand.width = masse.breite;
            leinwand.height = masse.hoehe;
            const kontext = leinwand.getContext("2d");
            if (kontext === null) return { ok: false, grund: "kein_bild" };
            kontext.drawImage(bitmap, 0, 0, masse.breite, masse.hoehe);
            let blob = await kodiere(leinwand, "image/webp", 0.9);
            // Ein Browser ohne WebP-Kodierer liefert PNG zurück (oder nichts): dann JPEG, wo das gewünscht ist (Safari), sonst ausdrücklich PNG.
            if (blob === null || blob.type !== "image/webp") {
                blob = optionen.jpegRueckfall === true ? await kodiereJpeg(leinwand, masse) : null;
                if (blob === null) blob = await kodiere(leinwand, "image/png");
            }
            if (blob === null) return { ok: false, grund: "kein_bild" };
            if (blob.size <= KANAL_BILD_MAX_BYTES) {
                return {
                    ok: true,
                    datei: { name: neuerName(datei.name, blob.type), dataBase64: await base64(blob) },
                    ...masse,
                };
            }
        }
        return { ok: false, grund: "zu_gross" };
    } finally {
        bitmap.close();
    }
}
