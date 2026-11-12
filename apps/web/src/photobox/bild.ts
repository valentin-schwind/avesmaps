import type { MediaFileUpload } from "@avesmaps3d/shared";
import { bildVorbereiten, type Vorbereitet, type VorbereitungsOptionen } from "../auth/kanal-bild";

/**
 * Das Bild eines Reisebilds im Browser vorbereiten (WI-0272 S2b, Aufgabe 13; Grenzen WI §5.1: JPEG, PNG, WebP, GIF bis 6 MB).
 *
 * - **Dieselbe Vorbereitung wie beim Betreiber-Kanal** (`auth/kanal-bild.ts`): Das Bild wird gelesen, aufrecht gestellt, auf die lange Kante 2560 px verkleinert und als WebP neu
 *   kodiert. Das hat drei Folgen, die hier gewollt sind: Ein Telefonfoto über 6 MB passt (es wird auf 1920 px verkleinert, wenn es sonst zu groß bliebe), **die Ortsdaten
 *   (EXIF, GPS) verlassen das Gerät nie** (WI §10: „Ortsdaten aus jeder öffentlichen Fassung“; hier geht schon die Einreichung ohne sie), und bei einem GIF zählt nur das erste Bild
 *   (WI §13). Der Server verlässt sich nicht darauf: Er prüft die Bytes selbst (`inspectImage`).
 * - **Nur diese vier Formate** nach der Angabe des Browsers (`image/jpeg`, `image/png`, `image/webp`, `image/gif`): Ein SVG ist ein Dokument, kein Foto (der Server lehnt es mit 415 ab);
 *   gar nicht erst zu lesen spart die Runde.
 * - 🔴 **Der Dateiname des Besuchers geht nicht an den Server.** Er bleibt auf dem Gerät und steht höchstens im Formular; hier trägt die Datei einen eigenen Namen (`reisebild.webp`),
 *   denn die Einreichung speichert den Namen nicht (`original_filename` bleibt leer, WI §13).
 * - **Rückfälle für Safari/iOS** (Review S2b I3): Kann der Browser kein WebP kodieren, geht ein JPEG (0,9) hinaus statt eines PNG, das als Telefonfoto oft über 6 MB läge; und kennt er `imageOrientation: "from-image"`
 *   nicht, wird das Bild noch einmal ohne diese Option gelesen. Der Betreiber-Kanal ruft dieselbe Vorbereitung ohne diese Optionen auf und bleibt bei seinem Verhalten.
 */

/** Die Formate, die das Formular annimmt (nach der Angabe des Browsers). */
export const BILD_TYPEN = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Die beiden Rückfälle der Vorbereitung (`auth/kanal-bild.ts`), für das Reisebild eingeschaltet. */
export const REISEBILD_VORBEREITUNG: VorbereitungsOptionen = {
    jpegRueckfall: true,
    ausrichtungOhneOptionWiederholen: true,
};

/** Das gewählte, vorbereitete Bild: die Datei für den Server, die Maße und eine Adresse für die Vorschau im Formular. */
export interface GewaehltesBild {
    readonly datei: MediaFileUpload;
    readonly breite: number;
    readonly hoehe: number;
    /** Der Name, den die Datei auf dem Gerät hatte: nur zur Anzeige im Formular, nie gesendet. */
    readonly anzeigeName: string;
}

export type BildErgebnis =
    | { readonly ok: true; readonly bild: GewaehltesBild }
    | { readonly ok: false; readonly grund: "kein_bild" | "zu_gross" };

/** Sagt die Angabe des Browsers, dass das ein JPEG, PNG, WebP oder GIF ist? */
export const istErlaubterTyp = (typ: string): boolean => (BILD_TYPEN as readonly string[]).includes(typ.toLowerCase());

export async function bereiteBildVor(
    datei: File,
    vorbereiten: (datei: File) => Promise<Vorbereitet> = (gewaehlt) =>
        bildVorbereiten(gewaehlt, REISEBILD_VORBEREITUNG),
): Promise<BildErgebnis> {
    if (!istErlaubterTyp(datei.type)) return { ok: false, grund: "kein_bild" };
    const ergebnis = await vorbereiten(datei);
    if (!ergebnis.ok) return ergebnis;
    const name = ergebnis.datei.name.toLowerCase();
    const endung = name.endsWith(".png") ? "png" : name.endsWith(".jpg") ? "jpg" : "webp";
    return {
        ok: true,
        bild: {
            datei: { name: `reisebild.${endung}`, dataBase64: ergebnis.datei.dataBase64 },
            breite: ergebnis.breite,
            hoehe: ergebnis.hoehe,
            anzeigeName: datei.name,
        },
    };
}
