<script setup lang="ts">
/**
 * Der Satz, warum ein Bedienelement gesperrt ist (Guide §7 „Gesperrt heißt: ein Satz, nicht bloß ein toter Knopf“, §24;
 * WI-0120 A8). Er steht SICHTBAR neben dem Element, nicht nur im `title`: „Die Bedienung wird dort erklärt, wo sie
 * stattfindet“ (§13.11), und ein Hinweis beim Überfahren erreicht weder den Finger noch die Tastatur. Das Element zeigt
 * mit `aria-describedby` auf ihn.
 *
 * EIN Baustein für Knopf, Feld und Auswahl, damit der Satz überall gleich aussieht (Guide P6); dieselbe leise Zeile wie
 * „Karte vorschlagen“ in den Katalogfenstern (WI-0118).
 */
defineProps<{
    /** Die Kennung, auf die `aria-describedby` des gesperrten Elements zeigt. */
    id: string;
    text: string;
}>();
</script>

<template>
    <span :id="id" class="sperrgrund" data-testid="sperrgrund">{{ text }}</span>
</template>

<style scoped>
.sperrgrund {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}
</style>
