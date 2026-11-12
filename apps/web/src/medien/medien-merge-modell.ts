import type { MediaAssetDetail, MediaUsageResult } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { zahl } from "./medien-text";

/**
 * Was das Fenster „Zusammenführen“ rechnet (WI-0068 D1). Reine Funktionen, damit Vitest sie ohne Browser prüft.
 *
 * 🔴 **Die Vorgabe für das bleibende Werk ist die größte Auflösung** (Betreiber 2026-10-11, Frage 2 Antwort A), bei gleicher
 * Fläche das zuerst genannte. Der Mensch kann ein anderes wählen — die Vorgabe ist ein Vorschlag, keine Entscheidung.
 *
 * 🪤 **Die Rechte sind der Punkt, an dem ein Mensch hinsehen muss.** Weichen Grundlage, Prüfstand oder Urheber zwischen den
 * Werken ab, verliert das aufgehende Werk seine — das bleibende trägt danach die Verwendungen aller. Deshalb warnt das Fenster,
 * statt die Wahl stillschweigend zu treffen.
 */

export interface MergeKandidat {
    assetId: string;
    revision: number;
    name: string;
    /** Die Fläche des Originals in Pixeln; `undefined`, wenn die Maße fehlen. */
    flaeche: number | undefined;
    masse: string;
    rechte: string;
    verwendungen: number;
}

/**
 * Das ORIGINAL unter den Darstellungen eines Werks.
 *
 * 🪤 Verglichen wird die Auflösung des Originals (`private_source`), nicht die einer gerechneten Fassung: Die ist aus dem Rezept
 * entstanden und sagt nichts darüber, welches Werk mehr Bild trägt.
 */
function original(detail: Pick<MediaAssetDetail, "representations"> | undefined) {
    return detail?.representations.find((eintrag) => eintrag.storageClass === "private_source");
}

/** Die Fläche eines Werks aus den Maßen seines Originals; `undefined`, wenn eines fehlt. */
function flaecheVon(detail: Pick<MediaAssetDetail, "representations"> | undefined): number | undefined {
    const quelle = original(detail);
    return quelle?.width == null || quelle.height == null ? undefined : quelle.width * quelle.height;
}

/** Die Maße als Satz („2000 × 1200“); ohne Maße ein Strich, nie eine erfundene Zahl. */
export function masseSatz(detail: Pick<MediaAssetDetail, "representations"> | undefined): string {
    const quelle = original(detail);
    if (quelle?.width == null || quelle.height == null) return t("medien.merge.ohneMasse");
    return `${zahl(quelle.width)} × ${zahl(quelle.height)}`;
}

/**
 * Die Vorgabe für das bleibende Werk: die größte Auflösung, bei Gleichstand das erste. `undefined` bei leerer Liste.
 *
 * 🪤 Ein Werk ohne bekannte Maße gewinnt nie gegen eines mit Maßen — sonst entschiede ein fehlender Wert die Frage.
 */
export function vorgabeBleibt(kandidaten: readonly MergeKandidat[]): string | undefined {
    let beste: MergeKandidat | undefined;
    for (const kandidat of kandidaten) {
        if (beste === undefined) {
            beste = kandidat;
            continue;
        }
        if ((kandidat.flaeche ?? -1) > (beste.flaeche ?? -1)) beste = kandidat;
    }
    return beste?.assetId;
}

/** Weichen die Rechte zwischen den Kandidaten ab? Dann gehört die Gruppe angesehen, nicht geklickt. */
export function rechteWeichenAb(kandidaten: readonly MergeKandidat[]): boolean {
    return new Set(kandidaten.map((kandidat) => kandidat.rechte)).size > 1;
}

/**
 * Der Satz unter der Liste: was der Klick bewegt.
 *
 * 🔴 Er nennt die Zahl der Verwendungen, die umziehen — das ist die Veränderung, die ein Mensch vorher sehen muss. „Zwei Bilder
 * werden eines“ sagt für sich noch nichts darüber, was danach an welchem Ort hängt.
 */
export function mergeSatz(kandidaten: readonly MergeKandidat[], bleibt: string | undefined): string {
    if (bleibt === undefined) return t("medien.merge.waehlen");
    const gehen = kandidaten.filter((kandidat) => kandidat.assetId !== bleibt);
    if (gehen.length === 0) return t("medien.merge.waehlen");
    const verwendungen = gehen.reduce((summe, kandidat) => summe + kandidat.verwendungen, 0);
    return t(gehen.length === 1 ? "medien.merge.satzEins" : "medien.merge.satz", {
        n: zahl(gehen.length),
        verwendungen: zahl(verwendungen),
    });
}

/**
 * Die Kandidaten einer Gruppe aus der Reverse Usage: das Werk selbst und jedes mit derselben Datei.
 *
 * 🪤 Die Maße stehen NICHT in `sameFile` (der Vertrag nennt dort nur Kennung, Revision, Titel und Art). Wer sie braucht, lädt
 * das Werk; bis dahin steht ein Strich, und die Vorgabe fällt auf das erste. Genau deshalb nimmt diese Funktion die Maße als
 * eigenen Parameter: Das Fenster entscheidet, wie viel es lädt.
 */
export function mergeKandidaten(
    verwendung: MediaUsageResult,
    eigenerName: string,
    details: ReadonlyMap<string, MediaAssetDetail>,
): MergeKandidat[] {
    const zeile = (assetId: string, revision: number, name: string, verwendungen: number): MergeKandidat => {
        const detail = details.get(assetId);
        return {
            assetId,
            revision: detail?.asset.revision ?? revision,
            name,
            flaeche: flaecheVon(detail),
            masse: masseSatz(detail),
            rechte: detail?.rights?.basis ?? t("medien.merge.ohneRechte"),
            verwendungen,
        };
    };
    return [
        zeile(verwendung.asset.id, verwendung.asset.revision, eigenerName, verwendung.usages.length),
        ...verwendung.sameFile.map((eintrag) =>
            zeile(
                eintrag.asset.id,
                eintrag.asset.revision,
                eintrag.asset.title ?? t("medien.merge.ohneTitel"),
                eintrag.usages.length,
            ),
        ),
    ];
}
