import { MEDIA_UPLOAD_LIMITS } from "@avesmaps3d/shared";
import { formatNumber, t } from "../i18n/i18n";
import type { GrundSatz } from "./ablehnung";

/**
 * Die Sätze zu einer abgelehnten Datei (422 `media_file_rejected`, `details.reason` aus der Prüfung der Bilder, `apps/server/src/media/raster/inspect.ts`), für die Formulare der
 * Besucher (Reisebild, Karte vorschlagen). Jeder Satz nennt den Grund und was zu tun ist (Vali 2026-11-08). Die Medienverwaltung hat ihre eigenen (`medien.op.datei.*`).
 */
export const DATEI_GRUENDE: Readonly<Record<string, GrundSatz>> = {
    too_many_pixels: () =>
        t("datei.ablehnung.pixel", { mp: formatNumber(MEDIA_UPLOAD_LIMITS.maxPixels / 1_000_000, 0) }),
    too_large_dimensions: () => t("datei.ablehnung.kante", { kante: formatNumber(MEDIA_UPLOAD_LIMITS.maxEdge, 0) }),
    animated_or_multiframe: () => t("datei.ablehnung.mehrbild"),
    bad_header: () => t("datei.ablehnung.unlesbar"),
    decode_failed: () => t("datei.ablehnung.unlesbar"),
    empty_file: () => t("datei.ablehnung.leer"),
};
