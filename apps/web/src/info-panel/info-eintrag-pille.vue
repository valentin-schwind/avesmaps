<script setup lang="ts">
import type { EditorZeichenName } from "../controls/editor-zeichen.vue";
import VorkommenPlakette from "../controls/vorkommen-plakette.vue";

/**
 * Die Pille „Eintrag öffnen“ am Telefon (WI-0257 S3b, Entwurf „Suchen und Leuchten“, Telefonbild): Wählt jemand ein Vorkommen, geht sein Panel am Telefon nicht über die ganze Karte auf, sondern die Karte
 * zeigt zuerst, was leuchtet; diese Pille oben links trägt das Zeichen der Kategorie und den Namen und holt das Panel auf Wunsch nach vorn. Am Rechner gibt es sie nicht (dort steht das Panel neben der Karte). Das Zeichen steht in der Plakette der Vorkommen wie im Kopf des Panels (`vorkommen-plakette.vue`).
 *
 * 🔴 Sie liegt nur da, wo das Panel eines Eintrags eingeklappt hinter der Karte steht (`app.vue` entscheidet); ein ✕ im Panel klappt es ein, ein Klick in die freie Karte beendet Eintrag und Leuchten.
 * Steht im Panel der Sammelscreen (WI-0257 S5), trägt sie dessen Zeichen `vorkommen`, „Ausgewählte Vorkommen“ und die Zahl der gewählten (`app.vue` setzt Zeichen und Texte).
 */
defineProps<{ name: string; zeichen: EditorZeichenName; hinweis: string }>();
const emit = defineEmits<{ oeffne: [] }>();
</script>

<template>
    <button type="button" class="eintrag-pille" data-testid="eintrag-pille" @click="emit('oeffne')">
        <VorkommenPlakette groesse="p" :zeichen="zeichen" />
        <span class="eintrag-pille__text">
            <span class="eintrag-pille__name einzeilig">{{ name }}</span>
            <span class="eintrag-pille__hinweis einzeilig">{{ hinweis }}</span>
        </span>
    </button>
</template>

<style scoped>
.eintrag-pille {
    position: absolute;
    top: var(--space-10);
    left: var(--space-10);
    z-index: var(--z-map-panel);
    display: flex;
    align-items: center;
    gap: var(--space-8);
    /* Der rechte Rand bleibt frei für die Knöpfe der Karte. */
    max-width: calc(100vw - 2 * var(--space-10) - var(--icon-xxl) - var(--space-16));
    padding: var(--space-4) var(--space-12) var(--space-4) var(--space-4);
    border: 1px solid var(--color-border-strong);
    /* Ein Radius über der halben Höhe: die Pille ist ganz rund (der Kanon führt keinen eigenen Wert dafür). */
    border-radius: var(--icon-xxl);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

/* 🪤 Die Hoverwäsche ist durchscheinend: sie liegt ÜBER der Fläche (wie die Suchkachel). */
.eintrag-pille:hover {
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.eintrag-pille:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

.eintrag-pille__text {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.eintrag-pille__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.eintrag-pille__hinweis {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .eintrag-pille {
        transition: none;
    }
}
</style>
