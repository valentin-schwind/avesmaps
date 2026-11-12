import { RELEASE_TEST_JOB_KIND } from "@avesmaps3d/shared";
import { isMessageKey, t, type MessageKey } from "../i18n/i18n";

/**
 * Der Name einer Phase aus den Sprachtafeln (`status.phase.<Jobart>.<Phase>`); `null`, wenn sie keinen hat. Eine eigene kleine Datei, weil die
 * Kopfleiste ihn braucht (`kopf-warteschlange.vue`) und die Zeilen der Statusseite (`job-view.ts`) dort nicht mitgeladen werden sollen.
 *
 * Die Phasen des Release-Tests sind die Schritte seines Runners (WI-0248); ihre Namen stehen schon bei der Karte im Reiter „Umgebungen“
 * (`admin.umgebungen.releaseTest.schritt.*`, die Browserteile mit ihrer Nummer).
 */
export function phaseName(kind: string, phase: string): string | null {
    const key = `status.phase.${kind}.${phase}`;
    if (isMessageKey(key)) return t(key as MessageKey);
    if (kind === RELEASE_TEST_JOB_KIND) {
        const browser = /^browser-(\d)$/u.exec(phase);
        if (browser?.[1] !== undefined) return t("admin.umgebungen.releaseTest.schritt.browser", { n: browser[1] });
        const schritt = `admin.umgebungen.releaseTest.schritt.${phase}`;
        if (isMessageKey(schritt)) return t(schritt as MessageKey);
    }
    return null;
}
