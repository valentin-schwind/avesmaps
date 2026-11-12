<script setup lang="ts">
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { medienStelle } from "./medien-stelle";

/**
 * Der Hinweis oben auf der Karte, solange die Redaktion die Stelle einer Reisebild-Einreichung wählt (WI-0272 S3, `medien-stelle.ts`): Die Medienverwaltung ist dafür zu, die Karte
 * nimmt den nächsten Klick (`medien-stelle-layer.ts`), und ohne diese Zeile wüsste niemand, was gerade gilt. „Abbrechen“ und Esc bringen die Medienverwaltung zurück.
 */
</script>

<template>
    <div
        v-if="medienStelle.waehlen.value"
        class="medien-stelle-hinweis"
        role="status"
        data-testid="medien-stelle-hinweis"
    >
        <span class="medien-stelle-hinweis__titel">{{ t("medien.einreichung.stelle.titel") }}</span>
        <span class="medien-stelle-hinweis__satz">{{ t("medien.einreichung.stelle.satz") }}</span>
        <AvmKnopf groesse="zeile" testid="medien-stelle-abbrechen" @click="medienStelle.beende()">{{
            t("medien.bearbeiten.abbrechen")
        }}</AvmKnopf>
    </div>
</template>

<style scoped>
/* Oben in der Mitte, im Abstand der Kartenränder: der Platz, den ein Modus auf der Karte schon bei den Reisebildern hat (`fenster-lage.ts`, `oben-mitte`). */
.medien-stelle-hinweis {
    position: fixed;
    top: var(--space-12);
    left: 50%;
    z-index: var(--z-map-hint);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    max-width: calc(100vw - 2 * var(--space-12));
    padding: var(--space-6) var(--space-10);
    transform: translateX(-50%);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.medien-stelle-hinweis__titel {
    color: var(--color-accent-strong);
}

.medien-stelle-hinweis__satz {
    color: var(--color-text-muted);
}
</style>
