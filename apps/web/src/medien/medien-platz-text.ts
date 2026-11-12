import type { MediaDenyReason, MediaSlotAsset, MediaSubjectSlots } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { datum, grundName } from "./medien-text";

/**
 * Wie ein gebundenes Bild an seinem Platz heißt (Wappen `coat`, Titelbild `header`): Name, Herkunft, Freigabe und der Satz zum leeren
 * Wappenplatz. Gemeinsam für den Reiter „Bilder“ des Ortseditors (WI-0128 E19; EDIT-0001 §8.1 E19; WI-0126 §11j) und den Wappen-Kasten
 * (`medien-wappen-kasten.vue`) an Orten und Gebieten. Reine Rechnung ohne Vue, damit Vitest sie prüft.
 */

/** Die Gründe der Policy, die heißen: Die Rechte sind noch nicht geprüft (Mockup: „wartet auf Rechteprüfung“). */
const WARTET_AUF_RECHTE: ReadonlySet<MediaDenyReason> = new Set<MediaDenyReason>([
    "rights_missing",
    "rights_unknown",
    "legacy_assumed",
    "clearance_pending",
    "permission_needs_approval",
    "fan_policy_needs_approval",
    "attribution_required",
]);

export interface Freigabe {
    readonly ton: "neutral" | "warnung";
    readonly text: string;
    /** Der Grund der Policy, als Hinweis beim Zeigen. */
    readonly grund: string | undefined;
}

/** Öffentlich entscheidet allein die Medienverwaltung (`decidePublication`); bis dahin sehen nur Editoren das Bild. */
export function freigabe(asset: MediaSlotAsset): Freigabe {
    const { public: oeffentlich, reason } = asset.publication;
    if (oeffentlich) return { ton: "neutral", text: t("ortseditor.bilder.oeffentlich"), grund: undefined };
    const grund = t("ortseditor.bilder.nurEditoren", { grund: grundName(reason) });
    return WARTET_AUF_RECHTE.has(reason as MediaDenyReason)
        ? { ton: "warnung", text: t("medien.auswahl.wartet"), grund }
        : { ton: "warnung", text: t("ortseditor.bilder.nichtOeffentlich"), grund };
}

/**
 * „hochgeladen von … · Datum“; was Legacy nicht kennt, heißt „unbekannt“, nie leer (Koordination 2026-10-10: den Hochlader kennt Legacy
 * nur bei 17 von 2.513 Medien).
 */
export function herkunft(asset: MediaSlotAsset): string {
    return t("medien.auswahl.hochgeladen", {
        von: asset.uploadedBy?.displayName ?? t("medien.auswahl.unbekannt"),
        am: asset.uploadedAt === null ? t("medien.auswahl.datumUnbekannt") : datum(asset.uploadedAt),
    });
}

export const bildName = (asset: MediaSlotAsset): string => asset.title?.trim() || t("ortseditor.bilder.ohneName");

/** Der Satz zum Platz „Wappen“ ohne Bild: bewusst ohne (ein Entscheid) oder noch keins gebunden. */
export function ohneWappen(plaetze: MediaSubjectSlots): string {
    return t(plaetze.coat.state === "none" ? "ortseditor.bilder.bewusstOhne" : "ortseditor.bilder.keinWappen");
}
