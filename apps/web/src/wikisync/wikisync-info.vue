<script setup lang="ts">
/**
 * Das kleine ⓘ des Reiters „WikiSync“ (Mockup, Vali 2026-10-25: „bisschen viel text … für dummies zusammenfassen“): Was nur Entwicklung und Betrieb
 * braucht, steht dahinter; der Haupttext bleibt ein kurzer Satz. Ein Klick klappt die Erklärung unter der Zeile auf, kein eigenes Fenster.
 * Das Zeichen ist dasselbe wie am Auslöser der Erklärfenster (`fenster/info-zeichen.vue`).
 */
import { ref, useId } from "vue";
import InfoZeichen from "../fenster/info-zeichen.vue";
import { t } from "../i18n/i18n";

defineProps<{
    text: string;
    /** Der Name des Knopfs für Vorleser; ohne Angabe „Mehr dazu“. */
    beschriftung?: string | undefined;
}>();

const offen = ref(false);
const id = useId();
</script>

<template>
    <span class="wsync-info">
        <button
            type="button"
            class="wsync-info__knopf"
            :aria-expanded="offen"
            :aria-controls="id"
            :aria-label="beschriftung ?? t('admin.wikisync.info')"
            :title="beschriftung ?? t('admin.wikisync.info')"
            @click.stop="offen = !offen"
        >
            <InfoZeichen />
        </button>
        <span v-show="offen" :id="id" class="wsync-info__text" role="note">{{ text }}</span>
    </span>
</template>

<style scoped>
.wsync-info {
    display: inline;
}

.wsync-info__knopf {
    display: inline-grid;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin-left: var(--space-2);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    line-height: 0;
    vertical-align: text-bottom;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.wsync-info__knopf:hover,
.wsync-info__knopf[aria-expanded="true"] {
    color: var(--color-text-strong);
}

.wsync-info__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.wsync-info__text {
    display: block;
    margin-top: var(--space-2);
    padding: var(--space-4) var(--space-6);
    border-left: 2px solid var(--color-border);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
    letter-spacing: normal;
    text-transform: none;
}

@media (pointer: coarse) {
    .wsync-info__knopf {
        width: var(--space-24);
        height: var(--space-24);
    }
}

@media (prefers-reduced-motion: reduce) {
    .wsync-info__knopf {
        transition: none;
    }
}
</style>
