import { MEDIA_COAT_QUALITY, type MediaCoatRejection } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";

/**
 * Die Vorprüfung eines neuen Wappens im Browser (WI-0068 P4b, Betreiber 2026-10-10: „wappen … müssen bestimmte qualitätsmerkmale
 * erfüllen wie z.B: transparenter hintergrund und quadratisches format“, „nur mit durchsichtigem rand auffüllen“, Mindestgröße 128 an
 * der langen Seite). Sie sagt es vor dem Hochladen; der Server prüft selbst (Dateikopf), der Worker die Ecken (`coat_not_transparent`).
 *
 * `wappenUrteil` ist rein (Vitest ohne Browser); `bildMasse` dekodiert im Browser.
 */

/** Was die Vorprüfung über eine Datei weiß. `ecken`: Alphawerte der vier Ecken (0 bis 255), `null` bei SVG. */
export interface BildMasse {
    breite: number;
    hoehe: number;
    svg: boolean;
    ecken: readonly number[] | null;
}

/** Dieselbe Schwelle wie der Worker (`CORNER_ALPHA_MAX`) und die Messung am Bestand. */
export const ECKE_DURCHSICHTIG_BIS = 15;

export interface WappenUrteil {
    /** Abgewiesen, mit dem Grund des Servers. */
    ablehnung?: MediaCoatRejection;
    /** Nicht quadratisch: die Seitenlänge nach dem Auffüllen (vor der Ableitung auf höchstens 512). */
    auffuellenAuf?: number;
}

export function wappenUrteil(masse: BildMasse): WappenUrteil {
    if (!masse.svg && Math.max(masse.breite, masse.hoehe) < MEDIA_COAT_QUALITY.minLongEdge) {
        return { ablehnung: "coat_too_small" };
    }
    if (masse.ecken !== null && masse.ecken.some((alpha) => alpha > ECKE_DURCHSICHTIG_BIS)) {
        return { ablehnung: "coat_not_transparent" };
    }
    if (!masse.svg && masse.breite !== masse.hoehe) return { auffuellenAuf: Math.max(masse.breite, masse.hoehe) };
    return {};
}

/** Der Satz zum Urteil, oder `undefined`, wenn nichts zu sagen ist. */
export function wappenSatz(urteil: WappenUrteil, masse: BildMasse): string | undefined {
    if (urteil.ablehnung === "coat_too_small") {
        return t("medien.formular.wappenKlein", {
            n: MEDIA_COAT_QUALITY.minLongEdge,
            lang: Math.max(masse.breite, masse.hoehe),
        });
    }
    if (urteil.ablehnung === "coat_not_transparent") return t("medien.formular.wappenDeckend");
    if (urteil.auffuellenAuf !== undefined) return t("medien.formular.wappenAuffuellen", { n: urteil.auffuellenAuf });
    return undefined;
}

/**
 * Maße und Ecken einer Datei im Browser: dekodiert über `createImageBitmap`, die Ecken an einer kleinen Fassung (32 × 32, gestreckt),
 * wie der Worker. Ein SVG wird nicht gerastert (es ist von der Größe ausgenommen, seine Ecken prüft der Worker). `undefined`, wenn der
 * Browser die Datei nicht lesen kann; dann entscheidet der Server.
 */
export async function bildMasse(datei: Blob): Promise<BildMasse | undefined> {
    if (datei.type === "image/svg+xml") return { breite: 0, hoehe: 0, svg: true, ecken: null };
    let bild: ImageBitmap;
    try {
        bild = await createImageBitmap(datei);
    } catch {
        return undefined;
    }
    try {
        const seite = 32;
        const leinwand =
            typeof OffscreenCanvas === "undefined"
                ? Object.assign(document.createElement("canvas"), { width: seite, height: seite })
                : new OffscreenCanvas(seite, seite);
        const kontext = leinwand.getContext("2d") as
            CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
        if (kontext === null) return { breite: bild.width, hoehe: bild.height, svg: false, ecken: null };
        kontext.clearRect(0, 0, seite, seite);
        kontext.drawImage(bild, 0, 0, seite, seite);
        const daten = kontext.getImageData(0, 0, seite, seite).data;
        const alpha = (x: number, y: number): number => daten[(y * seite + x) * 4 + 3] ?? 255;
        return {
            breite: bild.width,
            hoehe: bild.height,
            svg: false,
            ecken: [alpha(0, 0), alpha(seite - 1, 0), alpha(0, seite - 1), alpha(seite - 1, seite - 1)],
        };
    } finally {
        bild.close();
    }
}
