import { MediaStore, instagramKey, publishedWebpHash } from "../../media/storage.ts";
import { INSTAGRAM_BILD, InstagramBildFehler, macheInstagramBild } from "./instagram-bild.ts";

/**
 * Sorgt dafür, dass zur veröffentlichten WebP eines Bilds die JPEG-Fassung für Instagram daneben liegt (WI-0268 C12b). Gemeinsamer Code des Versandjobs (`jobs/social-senden-job.ts`) und des Prüflaufs
 * (`pruefen-meta.ts`): Beide nennen Meta danach die Adresse der Fassung (`instagram.bildAdresse`, `mediaInstagramUrl`), nie die der WebP.
 *
 * - **Wo:** `published/sha256/<2>/<2>/<hash>.ig.jpg`, im Ordner der WebP und mit deren Hash (`instagramKey`); sie hat keine Zeile in `media_file`.
 * - **Idempotent:** Liegt sie schon da, wird sie genommen; es wird nichts neu gerechnet. Geschrieben wird atomar (Temporärdatei, `fsync`, `rename`, `MediaStore.storeInstagram`).
 * - 🔴 **Nie länger öffentlich als ihre WebP:** Die WebP muss VOR dem Ablegen UND NACH dem Schreiben noch unter `published/` liegen. Fehlt sie, entsteht keine Fassung (eine vorhandene wird entfernt): Eine Quarantäne oder ein
 *   Löschen der WebP, die zwischen Lesen und Schreiben dazwischen kam, lässt keine öffentliche Waise zurück. Dasselbe Netz von der anderen Seite spannt `MediaStore` (Quarantäne und Löschen nehmen die Fassung mit).
 * - Alle Fehler sind `InstagramBildFehler` mit einem kurzen Satz ohne Pfad und ohne Text der Bibliothek.
 */

/** Was die Ableitung vom Medienspeicher braucht; `MediaStore` erfüllt es, Tests geben einen eigenen. */
export interface InstagramAblage {
    exists(schluessel: string): Promise<boolean>;
    read(schluessel: string, maxBytes: number): Promise<Uint8Array>;
    storeInstagram(webpSha256: string, bytes: Uint8Array): Promise<unknown>;
    removeInstagram(webpSha256: string): Promise<boolean>;
}

export interface InstagramFassung {
    /** Der Speicherschlüssel der Fassung (`published/sha256/…/<hash>.ig.jpg`). */
    readonly schluessel: string;
    /** Der Hash der WebP (auch der der Fassung im Namen). */
    readonly sha256: string;
    /** `false`: Sie lag schon da und wurde genommen. */
    readonly erzeugt: boolean;
}

/** Die Medienablage aus `MEDIA_ROOT`; `undefined`, wenn die Variable fehlt oder kein absoluter Pfad ist. */
export function medienAblage(umgebung: NodeJS.ProcessEnv): MediaStore | undefined {
    const wurzel = umgebung["MEDIA_ROOT"]?.trim();
    if (wurzel === undefined || wurzel === "") return undefined;
    try {
        return new MediaStore(wurzel);
    } catch {
        return undefined;
    }
}

const NICHT_OEFFENTLICH = "Die veröffentlichte Fassung des Bildes liegt nicht (mehr) öffentlich vor";

/**
 * Stellt die Instagram-Fassung zur veröffentlichten WebP `webpSchluessel` sicher. `maxQuellBytes` ist die Grenze, bis zu der die WebP gelesen wird (die Datei wird vor dem Lesen gemessen). Wirft `InstagramBildFehler`.
 */
export async function sichereInstagramBild(
    ablage: InstagramAblage,
    webpSchluessel: string,
    maxQuellBytes: number = INSTAGRAM_BILD.maxBytes,
): Promise<InstagramFassung> {
    const sha256 = publishedWebpHash(webpSchluessel);
    if (sha256 === undefined) throw new InstagramBildFehler("Das Bild ist keine veröffentlichte Datei");
    const schluessel = instagramKey(sha256);

    // Zuerst die WebP: Ohne sie gibt es die Fassung nicht, auch wenn eine alte noch daliegt.
    if (!(await istDa(ablage, webpSchluessel))) {
        await entferne(ablage, sha256);
        throw new InstagramBildFehler(NICHT_OEFFENTLICH);
    }
    if (await istDa(ablage, schluessel)) return { schluessel, sha256, erzeugt: false };

    let quelle: Uint8Array;
    try {
        quelle = await ablage.read(webpSchluessel, maxQuellBytes);
    } catch (fehler) {
        throw new InstagramBildFehler("Die Bilddatei ist nicht lesbar", { cause: fehler });
    }
    const bild = await macheInstagramBild(quelle);
    try {
        await ablage.storeInstagram(sha256, bild.bytes);
    } catch (fehler) {
        throw new InstagramBildFehler("Die Instagram-Fassung des Bildes konnte nicht abgelegt werden", {
            cause: fehler,
        });
    }
    // Das Netz gegen das Dazwischenkommen: Ging die WebP inzwischen aus der Auslieferung, darf die eben geschriebene Fassung nicht öffentlich bleiben.
    if (!(await istDa(ablage, webpSchluessel))) {
        await entferne(ablage, sha256);
        throw new InstagramBildFehler(NICHT_OEFFENTLICH);
    }
    return { schluessel, sha256, erzeugt: true };
}

async function istDa(ablage: InstagramAblage, schluessel: string): Promise<boolean> {
    try {
        return await ablage.exists(schluessel);
    } catch (fehler) {
        throw new InstagramBildFehler("Die Medienablage ist nicht lesbar", { cause: fehler });
    }
}

/** Entfernt eine übrig gebliebene Fassung; scheitert das, steht es im Fehler (sie darf nicht öffentlich bleiben, also wird der Versand nicht fortgesetzt). */
async function entferne(ablage: InstagramAblage, sha256: string): Promise<void> {
    try {
        await ablage.removeInstagram(sha256);
    } catch (fehler) {
        throw new InstagramBildFehler("Die Instagram-Fassung des Bildes konnte nicht entfernt werden", {
            cause: fehler,
        });
    }
}
