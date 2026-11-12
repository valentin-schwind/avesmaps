<script setup lang="ts">
import FensterVerweis from "../fenster/fenster-verweis.vue";
import { t } from "../i18n/i18n";
import type { FeldZeile } from "./medien-inspektor-modell";

/**
 * Feldzeilen im Inspector (Guide §16 und §11 „Tabellenzeile“: Beschriftung 96 px gedämpft, Wert füllt in `--color-text-strong`,
 * eine Abstandszahl für alle). Ein privates Feld trägt hinter der Beschriftung die Marke „intern“ (Positivliste
 * `MEDIA_PRIVATE_FIELDS`, WI-0068 P3); was die Route nicht liefert, steht gar nicht da (`medien-inspektor-modell.ts`).
 */
defineProps<{ zeilen: readonly FeldZeile[]; testid?: string | undefined }>();
</script>

<template>
    <dl class="medien-felder" :data-testid="testid">
        <div v-for="zeile in zeilen" :key="zeile.id" class="medien-felder__zeile" :data-feld="zeile.id">
            <dt class="medien-felder__label">
                {{ zeile.label }}
                <span v-if="zeile.intern" class="medien-felder__intern" data-testid="medien-intern">{{
                    t("medien.intern")
                }}</span>
            </dt>
            <dd class="medien-felder__wert" :class="zeile.ton === undefined ? undefined : `is-${zeile.ton}`">
                <FensterVerweis v-if="zeile.verweis !== undefined" :ziel="zeile.verweis">{{
                    zeile.wert
                }}</FensterVerweis>
                <template v-else>{{ zeile.wert }}</template>
            </dd>
        </div>
    </dl>
</template>

<style scoped>
.medien-felder {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
}

.medien-felder__zeile {
    display: grid;
    grid-template-columns: var(--avesmaps-infopanel-label-w) minmax(0, 1fr);
    gap: var(--space-6);
    align-items: baseline;
}

.medien-felder__label {
    display: flex;
    flex-direction: column;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

.medien-felder__intern {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.medien-felder__wert {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    white-space: pre-line;
}

.medien-felder__wert.is-warnung {
    color: var(--color-warning-soft-text);
}

.medien-felder__wert.is-erfolg {
    color: var(--color-success-soft-text);
}
</style>
