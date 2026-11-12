import { watch, type Ref } from "vue";
import { locale, t } from "../i18n/i18n";
import { authState, type AuthSnapshot } from "./session-state";

/**
 * Der Browsertitel folgt der Sitzung und der Umgebung (Betreiber 2026-10-12, Wortlaut in `page.title*`):
 *
 *     avesmaps.de            Avesmaps                 angemeldet: Avesmaps · Editor
 *     stage.avesmaps.de      Avesmaps · Stage         angemeldet: Avesmaps · Stage · Editor
 *
 * 🔴 Das ersetzt die Entscheidung vom 2026-10-11 („Stage ist ja klar wegen der URL nö das passt“): Seit dem Cutover vom
 * 2026-10-12 steht Production öffentlich, und wer beide Tabs offen hat, unterscheidet sie am Titel, nicht an der Adresse.
 *
 * Der Titel entsteht aus Teilen, nicht aus vier festen Sätzen: Marke, Umgebung, Rolle der Seite. Eine weitere Umgebung oder ein
 * weiterer Zusatz hängt sich an, ohne dass vier Tafeleinträge gepflegt werden müssen. Nur `staging` trägt einen Umgebungsteil —
 * Production ist der Normalfall und braucht keinen, lokal reicht die Adresse.
 *
 * Die Statusseite setzt ihren eigenen Titel (`status/status-app.vue`).
 */
export function seitentitel(sitzung: AuthSnapshot): string {
    const teile = [t("page.title")];
    if (sitzung.environment === "staging") teile.push(t("page.title.stage"));
    if (sitzung.person !== null) teile.push(t("page.title.editor"));
    return teile.join(" · ");
}

/** Führt `document.title` mit der Sitzung (und der Sprache) nach, nicht nur beim Laden; gibt das Ende des Beobachtens zurück. */
export function folgeSeitentitel(
    sitzung: Readonly<Ref<AuthSnapshot>> = authState,
    seite: { title: string } = document,
): () => void {
    return watch(
        () => [sitzung.value.person !== null, sitzung.value.environment, locale.value] as const,
        () => {
            seite.title = seitentitel(sitzung.value);
        },
        { immediate: true },
    );
}
