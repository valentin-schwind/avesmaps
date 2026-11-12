<script setup lang="ts">
import EditorZeichen from "../controls/editor-zeichen.vue";
import { t } from "../i18n/i18n";
import type { HandgriffZeile } from "./action";

/**
 * Die Gruppe „Bearbeiten · nur Editoren“ im Infopanel (WI-0128 E15; EDIT-0001 D7, D16, D20; EDIT-0002 §4.2; Gesamtmockup Version 7):
 * Kacheln in vier Spalten (Betreiber 2026-10-11: „den item-kacheln für editoren im infopanel kannst du gern auch ein 4-spalten grid
 * geben“) mit den gezeichneten Zeichen der Editoren (`controls/editor-zeichen.vue`, in der Schriftfarbe), darunter, wenn es fehlt,
 * warum nur gelesen wird. Was noch nicht geht, steht mit seinem kurzen Grund in der zweiten Zeile der Kachel da, nie als toter Knopf
 * ohne Wort. Die Zeilen kommen aus dem Register (`handgriffZeilen`); die Gruppe kennt keine Objektart.
 */
defineProps<{ zeilen: readonly HandgriffZeile[]; nurLesen: boolean }>();
const emit = defineEmits<{ griff: [id: string] }>();
</script>

<template>
    <section class="handgriff-gruppe" :aria-label="t('ortseditor.gruppe')" data-testid="handgriff-gruppe">
        <div class="handgriff-gruppe__kopf">
            <span class="handgriff-gruppe__titel">{{ t("ortseditor.gruppe") }}</span>
            <span class="handgriff-gruppe__pille">{{ t("ortseditor.gruppe.nurEditoren") }}</span>
        </div>
        <div class="handgriff-gruppe__kacheln">
            <button
                v-for="zeile in zeilen"
                :key="zeile.id"
                type="button"
                class="handgriff-gruppe__kachel"
                :class="{ 'is-gefahr': zeile.gefahr }"
                :disabled="zeile.grund !== undefined"
                :title="zeile.grund !== undefined ? t(zeile.grund) : undefined"
                :data-testid="`griff-${zeile.id}`"
                @click="emit('griff', zeile.id)"
            >
                <span v-if="zeile.zeichen" class="handgriff-gruppe__zeichen" aria-hidden="true"
                    ><EditorZeichen :name="zeile.zeichen"
                /></span>
                <span class="handgriff-gruppe__text">{{ t(zeile.text) }}</span>
                <small v-if="zeile.grund !== undefined" class="handgriff-gruppe__grund">{{ t(zeile.grund) }}</small>
            </button>
        </div>
        <p v-if="nurLesen" class="handgriff-gruppe__hinweis" data-testid="handgriff-gruppe-nur-lesen">
            {{ t("ortseditor.gruppe.nurLesen") }}
        </p>
    </section>
</template>

<style scoped>
/* Wie das Aktionsband (Guide §13.6): eine Linie darunter, dasselbe Polster; die Kacheln tragen dieselbe Fassung. */
.handgriff-gruppe {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-10) var(--info-pad-x);
    border-bottom: 1px solid var(--color-divider);
}

.handgriff-gruppe__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.handgriff-gruppe__titel {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.handgriff-gruppe__pille {
    padding: 0 var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.handgriff-gruppe__kacheln {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    /* Vier Spalten in der Breite des Panels: knapper Abstand und Rand, damit „verschieben“ ungetrennt in eine Kachel passt. */
    gap: var(--space-4);
}

.handgriff-gruppe__kachel {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: var(--avesmaps-infopanel-tile-min-h);
    margin: 0;
    padding: var(--space-6) var(--space-2);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    line-height: var(--leading-tight);
    text-align: center;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.handgriff-gruppe__kachel:not(:disabled):hover {
    border-color: var(--color-border-strong);
}

.handgriff-gruppe__kachel:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

/* Gesperrt in der Sperrfassung, nie mit Deckkraft (Guide §30.2); der Grund steht als zweite Zeile da. */
.handgriff-gruppe__kachel:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: default;
}

.handgriff-gruppe__kachel.is-gefahr:not(:disabled) {
    color: var(--color-danger);
}

.handgriff-gruppe__zeichen {
    display: grid;
    place-items: center;
    width: var(--icon-md);
    height: var(--icon-md);
}

.handgriff-gruppe__zeichen :deep(.editor-zeichen) {
    width: 100%;
    height: 100%;
}

.handgriff-gruppe__kachel.is-gefahr:not(:disabled) .handgriff-gruppe__zeichen {
    color: var(--color-danger);
}

.handgriff-gruppe__grund {
    font-size: var(--font-size-caption);
}

.handgriff-gruppe__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .handgriff-gruppe__kachel {
        transition: none;
    }
}
</style>
