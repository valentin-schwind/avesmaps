<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die Zeile, die statt der Liste steht (WI-0118): „Wird geladen …“, der Fehler samt „Noch einmal versuchen“, „Keine Karten hinterlegt.“ und
 * „Keine Karte passt zu diesen Filtern.“. Leise und mittig, nie ein Platzhalterkasten - dieselben Wörter wie der Streifen im Panel, wo es
 * sie schon gibt (`infoPanel.retry`).
 */
defineProps<{ kind: "loading" | "error" | "text"; text: string }>();
const emit = defineEmits<{ retry: [] }>();
</script>

<template>
    <div class="hinweis" :data-kind="kind" :aria-busy="kind === 'loading'" data-testid="catalog-notice">
        <p class="hinweis__text">{{ text }}</p>
        <button
            v-if="kind === 'error'"
            type="button"
            class="hinweis__neu"
            data-testid="catalog-retry"
            @click="emit('retry')"
        >
            {{ t("infoPanel.retry") }}
        </button>
    </div>
</template>

<style scoped>
.hinweis {
    padding: var(--space-16) 0;
    text-align: center;
}

.hinweis__text {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.hinweis__neu {
    margin-top: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.hinweis__neu:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.hinweis__neu:active {
    background: var(--color-button-soft-active);
}

.hinweis__neu:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .hinweis__neu {
        transition: none;
    }
}
</style>
