<script setup lang="ts">
import InfoZeichen from "./info-zeichen.vue";

/**
 * Der ⓘ-Auslöser eines Erklärfensters (Legacy `#transport-info-btn`, `.tsi-info-btn`; Guide §17.6,
 * §17.7): 16 × 16, ohne Fläche und Rahmen, gedämpft; beim Überfahren tritt er in die Textfarbe.
 *
 * - Er steht HINTER der Kopfzeile, die er erklärt - in der Klappbox im Slot `info` (`controls/avm-disclosure.vue`,
 *   seit WI-0089 P3; vorher im Rahmenkasten `frame-box.vue`).
 * - 🔴 Sein Klick klappt die Klappbox nicht mit (`.stop`, Legacy `map-features-planner-groups.js`).
 * - Er fokussiert sich beim Klick selbst: Safari tut das bei Knöpfen nicht, und die Hülle gibt den
 *   Fokus beim Schließen an das zurück, was ihn beim Öffnen hatte.
 */
defineProps<{
    /** Der Name für Vorleser („Transportmittel erklären“). */
    beschriftung: string;
    /** Was die Erklärung beantwortet, beim Überfahren (Legacy `title`). */
    hinweis: string;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ oeffnen: [] }>();

function klick(event: MouseEvent): void {
    (event.currentTarget as HTMLElement | null)?.focus();
    emit("oeffnen");
}
</script>

<template>
    <button
        type="button"
        class="info-knopf"
        :aria-label="beschriftung"
        :title="hinweis"
        aria-haspopup="dialog"
        :data-testid="testid"
        @click.stop="klick"
    >
        <InfoZeichen />
    </button>
</template>

<style scoped>
.info-knopf {
    display: inline-grid;
    flex: none;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 0;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.info-knopf:hover {
    color: var(--color-text);
}

.info-knopf:active {
    color: var(--color-text-strong);
}

.info-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-knopf {
        transition: none;
    }
}
</style>
