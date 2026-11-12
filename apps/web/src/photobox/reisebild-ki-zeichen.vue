<script setup lang="ts">
import { t } from "../i18n/i18n";
import ReisebildZeichen from "./reisebild-zeichen.vue";

/**
 * Die Kennzeichnung eines KI-Bildes, wo ein Reisebild gezeigt wird (Vali 2026-11-03: „kannst du das label "KI-Bild" in der photobox ersetzen durch ein kleines roboter-icon“): ein Zeichen statt der Schrift, in der
 * Größe der Umgebung. „KI-Bild“ bleibt der Name für Vorleser und der Hinweis beim Zeigen. Wo die Entstehung als Angabe neben anderen steht (Formular, Statusseite, Medienverwaltung), bleibt der Text.
 *
 * Im Vollbild ist Platz (`mit-text`, Vali 2026-11-03: „da kann dahinter noch "KI-generiert" stehen“): Dort steht der Text hinter dem Zeichen, und das Zeichen ist wieder reiner Schmuck.
 */
defineProps<{ mitText?: boolean }>();
</script>

<template>
    <span v-if="mitText" class="reisebild-ki reisebild-ki--text" data-testid="reisebild-ki">
        <ReisebildZeichen name="roboter" />
        {{ t("photobox.karte.kiGeneriert") }}
    </span>
    <span
        v-else
        class="reisebild-ki"
        role="img"
        :aria-label="t('photobox.karte.kiBild')"
        :title="t('photobox.karte.kiBild')"
        data-testid="reisebild-ki"
    >
        <ReisebildZeichen name="roboter" />
    </span>
</template>

<style scoped>
.reisebild-ki {
    display: inline-flex;
    vertical-align: -0.2em;
}

.reisebild-ki--text {
    align-items: center;
    gap: var(--space-2);
}

.reisebild-ki svg {
    flex: none;
    width: 1.2em;
    height: 1.2em;
}
</style>
