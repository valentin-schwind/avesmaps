import type { MediaRole } from "@avesmaps3d/shared";
import type { ClearanceState, RightsBasis } from "../media/policy.ts";

/**
 * Was Legacys Medien-Manifest (Export E5, `api/_internal/app/medien-export.php`, Legacy-Commit `024e3af3d`) in Avesmaps3D bedeutet
 * (WI-0063 Abschnitt 26.20 MEDIA-4, Vertrag `project-control/migration/contracts/media.yaml`, `umsetzung_m8_m10`).
 *
 * 🔴 Rein: keine Datenbank, kein Dateisystem. Diese Datei ist die EINE Stelle, an der ein Legacy-Rechtecode zu einer Rechtsbasis
 * wird. Sie rät nichts: `cc_by` bekommt keine Version, `permission_granted` keine Lizenz, `ai_generated` keine Lizenz, ein
 * Legacy-Tor (`legacy_public`) keine Freigabe. Die Veröffentlichung entscheidet allein `media/policy.ts`.
 *
 * Eine Klasse ist keine Rolle: Legacy nennt die Rolle der Ortsbilder `gallery`, der Karten `full` und `preview`, der Cover `cover`.
 * Die Rolle im Ziel folgt der KLASSE (`CLASS_ROLE`), nie dem Rollenwert des Manifests.
 */

export const MEDIA_SOURCE_SYSTEM = "avesmaps-legacy";
export const MEDIA_CONTRACT_VERSION = "1";

export const MEDIA_CLASSES = [
    "settlement_image",
    "settlement_coat",
    "territory_coat",
    "citymap_full",
    "citymap_preview",
    "literature_cover",
] as const;
export type MediaClass = (typeof MEDIA_CLASSES)[number];

export const isMediaClass = (value: unknown): value is MediaClass =>
    typeof value === "string" && (MEDIA_CLASSES as readonly string[]).includes(value);

/** Die Rolle eines Bildes im Ziel, aus seiner Klasse. */
export const CLASS_ROLE: Readonly<Record<MediaClass, MediaRole>> = {
    settlement_image: "header",
    settlement_coat: "coat",
    territory_coat: "coat",
    citymap_full: "map_full",
    citymap_preview: "map_preview",
    literature_cover: "literature_cover",
};

export type SubjectKind = "place" | "territory" | "adventure" | "citymap";

/** Das Fachobjekt der Klasse im Ziel. Legacy nennt das Werk `literature`, wir `adventure`. */
export const CLASS_SUBJECT: Readonly<Record<MediaClass, SubjectKind>> = {
    settlement_image: "place",
    settlement_coat: "place",
    territory_coat: "territory",
    citymap_full: "citymap",
    citymap_preview: "citymap",
    literature_cover: "adventure",
};

/** Was Legacy in `subject_kind` und `role` schreibt, je Klasse: ein Manifest, das etwas anderes sagt, ist ein Befund. */
export const LEGACY_SHAPE: Readonly<Record<MediaClass, { subjectKind: string; role: string }>> = {
    settlement_image: { subjectKind: "place", role: "gallery" },
    settlement_coat: { subjectKind: "place", role: "coat" },
    territory_coat: { subjectKind: "territory", role: "coat" },
    citymap_full: { subjectKind: "citymap", role: "full" },
    citymap_preview: { subjectKind: "citymap", role: "preview" },
    literature_cover: { subjectKind: "literature", role: "cover" },
};

/** Die Herkunftswerte, die Legacy je Klasse nennt (Spalte `origin`). */
export const LEGACY_ORIGINS = [
    "upload",
    "external",
    "custom",
    "wiki_localized",
    "wiki_staging",
    "autoget",
    "wiki_sync",
    "unknown",
] as const;
export type LegacyOrigin = (typeof LEGACY_ORIGINS)[number];

export const isLegacyOrigin = (value: unknown): value is LegacyOrigin =>
    typeof value === "string" && (LEGACY_ORIGINS as readonly string[]).includes(value);

/** Die sieben Rechtecodes von Legacys EINEM Katalog (`api/_internal/media-license.php`). */
export const LEGACY_RIGHTS_CODES = [
    "unknown_other",
    "public_domain",
    "cc0",
    "cc_by",
    "permission_granted",
    "ai_generated",
    "own_work",
] as const;
export type LegacyRightsCode = (typeof LEGACY_RIGHTS_CODES)[number];

const isRightsCode = (value: string): value is LegacyRightsCode =>
    (LEGACY_RIGHTS_CODES as readonly string[]).includes(value);

export type CreationMethod = "unknown" | "photo" | "drawing" | "ai_generated" | "scan" | "derived";
export type AssetOrigin =
    | "legacy_import"
    | "editor_upload"
    | "community_upload"
    | "wiki_import"
    | "wiki_localized"
    | "project_generated"
    | "external_import";

/** Die Eingabe der Rechtezuordnung: nur, was Legacys Manifest dazu sagt. */
export interface RightsInput {
    mediaClass: MediaClass;
    /** Der rohe Rechtecode (`legacy_rights_code`), `null` bei leerem oder fehlendem Wert. */
    code: string | null;
    origin: LegacyOrigin | null;
    /** Hat Legacy das Bild gestempelt (`uploaded_at`)? Ohne Export B weiß man es nicht: dann `false`. */
    hasStamp: boolean;
}

export interface RightsMapping {
    basis: RightsBasis;
    licenseKey: string | null;
    /** Nur bei `license` ohne Schlüssel (Legacys unversioniertes `cc_by`), sonst `null`. */
    licenseFamily: string | null;
    clearance: ClearanceState;
    creationMethod: CreationMethod;
    /** Legacy-Vorgabe ohne Einstufung: Befund `assumed_default_license`. */
    assumedDefault: boolean;
    /** Rechtslage nicht geklärt (`unknown`, `needs_review`): Befund `rights_unresolved`, nie öffentlich ohne Regel. */
    unresolved: boolean;
    /** `cc_by` ohne Version: Befund `cc_by_without_version`, keine Version geraten. */
    ccByWithoutVersion: boolean;
    /** Ein Code, den Legacys Katalog nicht kennt. */
    unknownCode: boolean;
}

const UNKNOWN_RIGHTS: RightsMapping = {
    basis: "unknown",
    licenseKey: null,
    licenseFamily: null,
    clearance: "unreviewed",
    creationMethod: "unknown",
    assumedDefault: false,
    unresolved: true,
    ccByWithoutVersion: false,
    unknownCode: false,
};

/**
 * Legacy-Code -> Rechtsbasis (media.yaml `rechte.zuordnung_legacy_code`, Media-Core-Plan Abschnitt 6, STOP-Regeln 1 bis 5).
 *
 * | Legacy                | Ziel                                                                                         |
 * | public_domain         | `public_domain`, `legacy_asserted`                                                           |
 * | cc0                   | `license` cc0-1.0, `legacy_asserted`                                                         |
 * | cc_by                 | `license`, Familie cc-by (bei Gebieten unbekannt), KEIN Schlüssel, `needs_review`            |
 * | permission_granted    | `fan_policy` bei Literaturcover und Autoget-Vorschau, sonst `permission`, `legacy_asserted`  |
 * | ai_generated          | `own_work`, Entstehung ai_generated, `legacy_asserted` (bei Vorgabe `legacy_assumed`)        |
 * | own_work              | `own_work`, `legacy_asserted`                                                                |
 * | unknown_other, fremd  | `unknown`, `unreviewed`, nie öffentlich                                                      |
 * | leer: Ortsbild        | `own_work`, Entstehung ai_generated, `legacy_assumed` (Klassenannahme des Betreibers)        |
 * | leer: alles andere    | `unknown`, `unreviewed` (Legacys Tor sperrt ebenfalls)                                       |
 */
export function mapRights(input: RightsInput): RightsMapping {
    const code = input.code;
    if (code === null) {
        if (input.mediaClass === "settlement_image") {
            return {
                basis: "own_work",
                licenseKey: null,
                licenseFamily: null,
                clearance: "legacy_assumed",
                creationMethod: "ai_generated",
                assumedDefault: true,
                unresolved: false,
                ccByWithoutVersion: false,
                unknownCode: false,
            };
        }
        return { ...UNKNOWN_RIGHTS };
    }
    if (!isRightsCode(code)) return { ...UNKNOWN_RIGHTS, unknownCode: true };

    const asserted = {
        licenseKey: null,
        licenseFamily: null,
        clearance: "legacy_asserted",
        creationMethod: "unknown",
        assumedDefault: false,
        unresolved: false,
        ccByWithoutVersion: false,
        unknownCode: false,
    } as const;
    switch (code) {
        case "unknown_other":
            return { ...UNKNOWN_RIGHTS };
        case "public_domain":
            return { ...asserted, basis: "public_domain" };
        case "cc0":
            return { ...asserted, basis: "license", licenseKey: "cc0-1.0" };
        case "cc_by":
            return {
                ...asserted,
                basis: "license",
                // Legacys Wiki-Parser wirft für Gebiete CC-BY-SA, NC, GFDL und allgemeines Creative Commons in `cc_by`: die Familie ist
                // dort unbekannt. Bei den Medien, die Editoren hochladen, ist `cc_by` die Wahl „CC-BY“ ohne Versionsangabe.
                licenseFamily: input.mediaClass === "territory_coat" ? null : "cc-by",
                clearance: "needs_review",
                unresolved: true,
                ccByWithoutVersion: true,
            };
        case "permission_granted": {
            // Das Cover und die automatisch geholte Kartenvorschau tragen die Fan-Regeln von Ulisses (Legacy-Code, G1 = A);
            // jede andere Genehmigung ist eine Einzelgenehmigung.
            const fan =
                input.mediaClass === "literature_cover" ||
                (input.mediaClass === "citymap_preview" && input.origin === "autoget");
            return { ...asserted, basis: fan ? "fan_policy" : "permission" };
        }
        case "ai_generated": {
            // Ortswappen mit Quelle `own`: in Legacy ein Alias (Owner-Entscheid 2026-08-16, die ganze Klasse ist ai_generated).
            // Ausdrücklich eingestuft ist nur, was einen Hochladestempel trägt.
            const assumed = input.mediaClass === "settlement_coat" && !input.hasStamp;
            return {
                ...asserted,
                basis: "own_work",
                clearance: assumed ? "legacy_assumed" : "legacy_asserted",
                creationMethod: "ai_generated",
                assumedDefault: assumed,
            };
        }
        case "own_work":
            return { ...asserted, basis: "own_work" };
    }
}

/**
 * Die Herkunft des Assets (`media_asset.origin`) aus Legacys Herkunftswert. Der Vertrag kennt kein `autoget`: ein automatisch geholtes
 * Fremdbild ist ein externer Import; vom Wiki-Abgleich lokal abgelegte Dateien sind lokalisierte Wiki-Dateien.
 */
export function assetOrigin(origin: LegacyOrigin | null): AssetOrigin {
    switch (origin) {
        case "wiki_localized":
        case "wiki_sync":
            return "wiki_localized";
        case "wiki_staging":
            return "wiki_import";
        case "autoget":
        case "external":
            return "external_import";
        default:
            return "legacy_import";
    }
}

/** Herkunft der direkten Bindung (`*_media.origin`): `wiki_localized` nur bei einer lokalisierten Wiki-Datei. */
export const bindingOrigin = (origin: LegacyOrigin | null): "legacy" | "wiki_localized" =>
    assetOrigin(origin) === "wiki_localized" ? "wiki_localized" : "legacy";

/**
 * Hat Legacy das Original NICHT aufbewahrt? Dann „Kein Original vorhanden“ (`degraded_original`, Betreiber 2026-10-04): Ortsbilder
 * sind der 800 x 450-Zuschnitt, Cover höchstens 600 px, Kartenvorschauen 400 px, eigene Wappen-Uploads höchstens 512 px. Eine
 * lokalisierte Wiki-Datei und ein hochgeladenes Kartenbild hat Legacy unverkleinert abgelegt.
 */
export function isDegradedOriginal(mediaClass: MediaClass, origin: LegacyOrigin | null): boolean {
    switch (mediaClass) {
        case "settlement_image":
        case "literature_cover":
        case "citymap_preview":
            return true;
        case "settlement_coat":
        case "territory_coat":
            return origin === "custom";
        case "citymap_full":
            return false;
    }
}

/** Was Legacys Stempel bedeutet: bei Ortsbildern die LETZTE Einstufung (`set_meta` stempelt bei jeder neu), sonst der Upload. */
export const stampSemantics = (mediaClass: MediaClass): "upload" | "last_classification" =>
    mediaClass === "settlement_image" ? "last_classification" : "upload";

/**
 * Wo eine Notiz hingehört. Bei Bildern und Wappen mischt Legacys `note` Kommentar und Prompt (nie geraten aufgeteilt): sie bleibt
 * unverändert in `media_creation.legacy_note_raw`. Bei Karten und Covern heißt das Feld `*_license_note` und ist eine Rechtenotiz.
 */
export const noteIsRightsNote = (mediaClass: MediaClass): boolean =>
    mediaClass === "citymap_full" || mediaClass === "citymap_preview" || mediaClass === "literature_cover";

/** Ein Wappen aus dem Zwischenspeicher: nur ein Proxy-Cache, nicht Legacys eigene Ablage (Befund `cache_path_source`). */
export const isCachePath = (localUrl: string): boolean => localUrl.startsWith("/uploads/wappen/cache/");

/** Eine Adresse ohne angehängten Cache-Stempel `?v=<zahl>`. */
export function withoutStamp(url: string): string {
    return url.trim().replace(/\?v=\d+$/, "");
}

/**
 * Ein Zeitstempel aus Legacy als `timestamptz`-Text, oder `null`. Legacy liefert ISO (`…Z`) bei Ortsbildern und Wappen und
 * `YYYY-MM-DD HH:MM:SS` ohne Zone bei Karten und Covern. Ein Wert ohne Zone gilt als UTC: der Stempel wird einmal übernommen und
 * nie neu geschrieben, also muss die Übernahme unabhängig von der Zeitzone der Sitzung dieselbe sein.
 */
export function legacyTimestamp(value: string | null): string | null {
    if (value === null) return null;
    const text = value.trim();
    if (text === "") return null;
    const iso = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(text);
    if (iso === null) return null;
    const [, date, time, fraction, zone] = iso;
    const normalizedZone =
        zone === undefined
            ? "Z"
            : zone === "Z"
              ? "Z"
              : zone.includes(":")
                ? zone
                : `${zone.slice(0, 3)}:${zone.slice(3)}`;
    const parsed = new Date(`${String(date)}T${String(time)}${fraction ?? ""}${normalizedZone}`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
