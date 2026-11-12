import { MEDIA_SUSPEND_REASON_MAX, type MediaAssetDetail, type MediaUsageResult } from "@avesmaps3d/shared";

/**
 * Was der Einzelbild-Notaus trifft und was er verlangt (WI-0068; Betreiber 2026-10-10: „im mam kann man dann immernoch bilder etc
 * gezielt offline nehmen“). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Der Notaus gilt dem BILD, nicht der Stelle**, und das ist genau das, was die Bestätigung sagen muss: Alle Verwendungen
 * verschwinden, und zwar auch die anderer Werke mit denselben Bytes. Wer nur „dieses Asset“ liest, unterschätzt die Wirkung.
 */

export const NOTAUS_GRUND_MAX = MEDIA_SUSPEND_REASON_MAX;

export interface NotausUmfang {
    /** Aktive Verwendungen dieses Assets. */
    verwendungen: number;
    /** Davon die, die ein Besucher heute sieht. */
    oeffentlich: number;
    /** Weitere Werke mit denselben Bytes (sie verschwinden mit). */
    weitereWerke: number;
    /** Deren Verwendungen. */
    weitereVerwendungen: number;
}

/** Was der Notaus trifft, aus dem, was der Inspector ohnehin geladen hat. */
export function notausUmfang(verwendung: MediaUsageResult | undefined): NotausUmfang {
    const usages = verwendung?.usages ?? [];
    const sameFile = verwendung?.sameFile ?? [];
    return {
        verwendungen: usages.length,
        oeffentlich: usages.filter((usage) => usage.publication?.public === true).length,
        weitereWerke: sameFile.length,
        weitereVerwendungen: sameFile.reduce((summe, eintrag) => summe + eintrag.usages.length, 0),
    };
}

/** Gilt für dieses Asset gerade ein Notaus? Dann steht „wieder freigeben“ statt „offline nehmen“. */
export function aktiverNotausStand(
    detail: MediaAssetDetail | undefined,
): { revision: number; sha256: string } | undefined {
    const aktiv = detail?.suspensions.find((eintrag) => eintrag.liftedAt === null);
    return aktiv === undefined ? undefined : { revision: aktiv.revision, sha256: aktiv.sha256 };
}

/**
 * Darf gesendet werden? Der Grund ist Pflicht (die Datenbank verlangt ihn, und ohne ihn wäre im Protokoll nicht nachvollziehbar,
 * warum ein Bild verschwand). Leerzeichen allein zählen nicht.
 */
export function notausGrundFehler(grund: string): "leer" | "zuLang" | undefined {
    const getrimmt = grund.trim();
    if (getrimmt === "") return "leer";
    if (getrimmt.length > NOTAUS_GRUND_MAX) return "zuLang";
    return undefined;
}
