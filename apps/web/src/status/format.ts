import { formatNumber, isMessageKey, t, type MessageKey } from "../i18n/i18n";

/**
 * Formatierung der Statusseite: Dauer, Speicher, Zeitpunkt. Alles über die Sprachtafeln (`t`, `formatNumber`), nichts als Literal.
 */

/** Sekunden als „45 s“, „5 min 12 s“, „2 h 03 min“. Auf volle Sekunden gerundet, nie negativ. */
export function formatDuration(totalSeconds: number): string {
    const seconds = Math.max(0, Math.round(totalSeconds));
    if (seconds < 60) return `${String(seconds)} ${t("status.unit.s")}`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
        const rest = seconds % 60;
        return rest === 0
            ? `${String(minutes)} ${t("status.unit.min")}`
            : `${String(minutes)} ${t("status.unit.min")} ${String(rest)} ${t("status.unit.s")}`;
    }
    const hours = Math.floor(minutes / 60);
    return `${String(hours)} ${t("status.unit.h")} ${String(minutes % 60).padStart(2, "0")} ${t("status.unit.min")}`;
}

/** Megabyte mit Tausenderpunkt („1.250 MB“); `null` heißt unbekannt. */
export function formatMb(megabytes: number | null | undefined): string {
    if (megabytes === null || megabytes === undefined) return t("status.unknown");
    return `${formatNumber(megabytes, 0)} ${t("status.unit.mb")}`;
}

/** Wie lange ein Zeitpunkt zurückliegt, in Sekunden (Serverzeit); `null`, wo es keinen Zeitpunkt gibt. */
export function secondsSince(iso: string | null, nowMs: number): number | null {
    if (iso === null) return null;
    const at = Date.parse(iso);
    return Number.isNaN(at) ? null : Math.max(0, (nowMs - at) / 1000);
}

/** Wie lange bis ein Zeitpunkt, in Sekunden; `null`, wo es keinen gibt; nie negativ. */
export function secondsUntil(iso: string | null, nowMs: number): number | null {
    if (iso === null) return null;
    const at = Date.parse(iso);
    return Number.isNaN(at) ? null : Math.max(0, (at - nowMs) / 1000);
}

/** Der Text eines Schlüssels, der aus Daten kommt (Jobart, Grund, Befund); ohne Eintrag der Rohwert. */
export function dataLabel(prefix: string, value: string): string {
    const key = `${prefix}.${value}`;
    return isMessageKey(key) ? t(key as MessageKey) : value;
}

/** Datum und Uhrzeit in der Sprache der Seite, ohne Sekunden. */
export function formatMoment(iso: string | null): string {
    if (iso === null) return t("status.unknown");
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return t("status.unknown");
    return at.toLocaleString(t("status.locale"), { dateStyle: "short", timeStyle: "short" });
}
