<script setup lang="ts">
/**
 * Der Hinweisblock mit linkem Balken (Guide §13.25 „Der Hinweiskasten“; WI-0120 A8).
 *
 * 🔴 „Ein Hinweis trägt einen linken Balken, keinen Rahmen und kein Symbol“ (§13.25, CANON). Avesmaps warnt in Sätzen,
 * nicht in Schildern.
 *
 * - **`neutral`:** Balken in Gold (`--color-accent`), Fläche `panel-soft`, Schrift gedämpft - Legacys Hinweiskasten.
 * - **`warnung`:** nur der Balken wechselt (`--color-warning`). Legacy, wörtlich: „Nur die Kante ist die warnende statt
 *   der ruhigen“ (css/components/landschaft-dialog.css `__warnung`). Eine Folge, die man kennen muss, oder eine Wartezeit.
 * - **`gefahr`:** etwas ist abgewiesen worden, und der Mensch kann es ändern (Guide §17.11: Rot ist für das reserviert,
 *   was jemand abstellen kann). Dann wandert das ganze weiche Tripel: Fläche `danger-soft`, Schrift `danger-soft-text`,
 *   der Balken in `--color-danger` - wie Legacys abgewiesene Anmeldung (`.edit-login__error`, css/pages/edit.css:100-106).
 * - Maße wie Legacy: Balken 3 px, Radius `sm`. Polster 6 / 10 und 12 px wie im Mockup der Verwaltung; Legacy setzt
 *   7 / 10 und 11 px, hier trägt der Block auch Fehlermeldungen eines Fensters.
 * - Er ist zugleich die **Rückmeldung im Fenster**: Im modalen Fenster liegt der Toast unter dem Schleier (Risiko R5).
 *   Mit `rolle="alert"` (abgewiesene Anmeldung) oder `rolle="status"` (gespeichert) liest ein Vorleser ihn vor.
 * - Der Inhalt ist der Slot: ein Satz, oder `FensterText` mit Absätzen und Aufzählung.
 */
defineProps<{
    ton?: "neutral" | "warnung" | "gefahr" | undefined;
    rolle?: "status" | "alert" | undefined;
    testid?: string | undefined;
}>();
</script>

<template>
    <div class="hinweis" :class="`hinweis--${ton ?? 'neutral'}`" :role="rolle" :data-testid="testid">
        <slot />
    </div>
</template>

<style scoped>
.hinweis {
    padding: var(--space-4) var(--space-8);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.hinweis--warnung {
    border-left-color: var(--color-warning);
}

.hinweis--gefahr {
    border-left-color: var(--color-danger);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.hinweis > :deep(p) {
    margin: 0;
}
</style>
