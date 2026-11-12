<script setup lang="ts">
import type { Absatz } from "./social-vorschau-modell";

/**
 * Der Text einer Vorschau, wie der Dienst ihn setzt (WI-0270, Probierseite V15): Absätze, Zeilenumbrüche, Hashtags und Adressen als farbige Spannen. 🔴 Gerendert wird aus den Stücken des Modells
 * (`social-vorschau-modell.ts`, `zerlege`), nie aus einem HTML-Text: Der Beitragstext kommt von Menschen, und `v-html` dafür gibt es nicht. Die Farben und Schriften erbt die Vorschau (`--vs-*` am Wurzelelement
 * von `social-vorschau.vue`).
 *
 * `knopf` ist die Aufschrift des Kürzungsknopfs („mehr“, „Mehr anzeigen“); ist er gesetzt, wurde gekürzt, und hinter dem Text steht „… “ und der Knopf. `inline`: der erste Absatz läuft in der Zeile weiter
 * (Instagram: der Kontoname steht davor).
 */
defineProps<{
    absaetze: readonly Absatz[];
    knopf?: string | undefined;
    inline?: boolean | undefined;
}>();
defineEmits<{ mehr: [] }>();
</script>

<template>
    <p v-for="(absatz, i) in absaetze" :key="i" class="vs-absatz" :class="{ 'vs-absatz--inline': inline && i === 0 }">
        <template v-for="(stueck, j) in absatz" :key="j">
            <br v-if="stueck.art === 'umbruch'" />
            <span v-else-if="stueck.art === 'text'">{{ stueck.text }}</span>
            <span v-else class="vs-link" :class="`vs-link--${stueck.art}`">{{ stueck.text }}</span>
        </template>
        <template v-if="knopf !== undefined && i === absaetze.length - 1"
            >…
            <button type="button" class="vs-weiter" data-testid="social-vorschau-mehr" @click="$emit('mehr')">
                {{ knopf }}
            </button></template
        >
    </p>
</template>

<style scoped>
.vs-absatz {
    margin: 0;
}

.vs-absatz--inline {
    display: inline;
}

.vs-link {
    color: var(--vs-link);
}

.vs-weiter {
    padding: 0;
    border: 0;
    background: none;
    color: var(--vs-leise);
    font: inherit;
    cursor: pointer;
}

.vs-weiter:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
