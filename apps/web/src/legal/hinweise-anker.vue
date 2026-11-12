<script setup lang="ts">
import { t } from "../i18n/i18n";
import { hinweisAdresse } from "./hinweis-adresse";

/**
 * Das Linkzeichen 🔗 an einer Stelle der Hinweise (dasselbe Zeichen wie im Routenplaner, `route-overview.vue`). Ein Klick kopiert die Adresse der Stelle; das Fenster fängt ihn ab (`data-hinweis-anker`,
 * `hinweise-fenster.vue`), damit nicht jede der gut zweihundert Stellen einen eigenen Handler trägt. Ein echter Link: „Link kopieren“ im Kontextmenü tut dasselbe.
 *
 * Es zeigt sich erst, wenn man auf seine Zeile zeigt oder es den Fokus hat; das Elternteil trägt dafür die Klasse `hinweis-traeger`. 🪤 `opacity` statt `visibility`, weil es sonst nie den Fokus bekäme, und nur für
 * dieses Zeigen, nicht als Hover (Guide §30.2): Hover und Druck legen die Lasur des Hauses (§30.5). Gesperrt gibt es hier nicht. Am Telefon steht es leise da: Das Emoji nimmt keine Schriftfarbe an, also bleibt nur die Deckkraft.
 */
const props = defineProps<{
    kennung: string;
    /** Wie die Stelle heißt, für Vorleser. */
    punkt: string;
}>();

const adresse = hinweisAdresse(globalThis.location?.origin ?? "", props.kennung);
</script>

<template>
    <a
        class="hinweis-anker"
        :href="adresse"
        :data-hinweis-anker="props.kennung"
        :aria-label="t('notes.anker.label', { punkt: props.punkt })"
        :title="t('notes.anker.title')"
        ><span aria-hidden="true">🔗</span></a
    >
</template>

<style scoped>
.hinweis-anker {
    position: relative;
    flex: 0 0 auto;
    padding-inline: var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-size-caption);
    line-height: 1;
    opacity: 0;
    text-decoration: none;
    transition:
        opacity 120ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.hinweis-traeger:hover > .hinweis-anker,
.hinweis-anker:focus-visible {
    opacity: 1;
}

.hinweis-anker:hover {
    background: var(--color-hover-wash);
}

.hinweis-anker:active {
    background: var(--color-active-wash);
}

.hinweis-anker:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (hover: none) {
    .hinweis-anker {
        opacity: 0.55;
    }
}

/* Am Finger reicht das Ziel über das Zeichen hinaus, ohne die Zeile höher zu machen. */
@media (pointer: coarse) {
    .hinweis-anker::before {
        position: absolute;
        inset: calc(var(--space-6) * -1);
        content: "";
    }
}

@media (prefers-reduced-motion: reduce) {
    .hinweis-anker {
        transition: none;
    }
}
</style>
