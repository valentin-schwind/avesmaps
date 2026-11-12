import { locale, t, type MessageKey } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { LeseGrund, ZeilenFehler } from "./traeger-quellen-modell";

const GRUND_SAETZE: Readonly<Record<NonNullable<LeseGrund>, MessageKey>> = {
    recht: "fenster.traegerQuellen.sperre.recht",
    bearbeiten: "fenster.traegerQuellen.sperre.bearbeiten",
    still: "fenster.traegerQuellen.sperre.still",
};

/** Der Satz, warum sich die Quellen nicht ändern lassen (`leseGrund`); `undefined`, wo es geht. */
export const leseGrundSatz = (grund: LeseGrund): string | undefined =>
    grund === undefined ? undefined : t(GRUND_SAETZE[grund]);

/**
 * Der Satz zu einem Fehler beim Schreiben der Quellen eines Objekts (WI-0254 §12): der des Servers; bei 409 „Jemand war schneller“ mit wer und wann (`relativeTime`). Gemeinsam für die Zeilen der Klappbox
 * (`traeger-quellen.vue`) und das ↺ im Verlauf (`quellen-verlauf-steuerung.ts`).
 */
export function fehlerSatz(fehler: ZeilenFehler): string {
    if (fehler.art === "satz") return fehler.satz;
    const jetzt = new Date();
    const wann = relativeTime(fehler.wann === undefined ? jetzt : new Date(fehler.wann), jetzt, locale.value);
    return fehler.wer === undefined
        ? t("fenster.traegerQuellen.konflikt.jemand", { wann })
        : t("fenster.traegerQuellen.konflikt.wer", { wer: fehler.wer, wann });
}
