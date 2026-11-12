<script setup lang="ts">
/**
 * Ein Name in der Etappenliste (WI-0087 P1, P2): ein **Objektlink**, wo es einen Gegenstand gibt, sonst **Text**.
 *
 * 🔴 „Was auf der Karte ist, ist anklickbar" (`AGENTS.md`, Betreiber 2026-10-04): Ort, Weg und Gebiet, die die Liste
 * nennt, öffnen ihr Infopanel über dieselbe Öffnungsnaht wie ein Klick auf der Karte.
 *
 * 🪤 **Ohne Gegenstand kein Knopf** (A6): Ein Etappenende ohne Ort (`marker`, `exit`, `join`, `landing`) und ein Weg,
 * dessen Kennung der Abschnitt nicht trägt, bleiben Text - ein Knopf, der nichts tut, ist schlimmer als kein Knopf.
 *
 * EINE Rezeptur für alle drei Stellen (Etappenzeile, Wegpunktname, Gebiet im Untertitel): Zustände und Übergang
 * stehen hier und nicht dreimal (Guide §30.5: Ruhe · Hover · Fokus · Gesperrt · Übergang). Schrift und Größe erbt der
 * Name von seiner Zeile, damit derselbe Link im Titel und im gedämpften Untertitel sitzen kann.
 */
defineProps<{ text: string; linked: boolean; stale: boolean; testid?: string }>();
const emit = defineEmits<{ open: [] }>();
</script>

<template>
    <button
        v-if="linked"
        type="button"
        class="stage-link"
        :disabled="stale"
        :data-testid="testid"
        @click.stop="emit('open')"
    >
        {{ text }}
    </button>
    <span v-else class="stage-link stage-link--plain" :data-testid="testid">{{ text }}</span>
</template>

<style scoped>
.stage-link {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: inherit;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.stage-link:hover:not(:disabled) {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.stage-link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.stage-link:disabled {
    cursor: default;
}

/* Kein Gegenstand, kein Knopf: Der Name erbt den Ton seiner Zeile und sieht nicht aus, als könnte man ihn drücken. */
.stage-link--plain {
    color: inherit;
    cursor: inherit;
}

@media (prefers-reduced-motion: reduce) {
    .stage-link {
        transition: none;
    }
}
</style>
