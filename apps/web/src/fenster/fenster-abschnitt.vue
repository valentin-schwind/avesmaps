<script setup lang="ts">
/**
 * Ein Abschnitt im Rumpf, abgesetzt durch eine Trennlinie (Legacy `.tsi-rules`, `.tsi-sources`).
 *
 * 🔴 Der Abstand über und unter der Linie ist derselbe (Guide §4, CANON): oben kommt er aus dem Takt
 * des Rumpfes (`--divider-gap`), unten aus diesem Polster - beide lesen dieselbe Zahl. Legacy hatte
 * hier 18 / 14 und 14 / 10 stehen, zwei Rezepturen für eine Linie.
 *
 * ⚠️ Entweder Karte oder Trennlinie, nie beides (Guide P5): ein Abschnitt hat keine Fläche und keinen Rahmen.
 */
</script>

<template>
    <section class="fenster-abschnitt">
        <slot />
    </section>
</template>

<style scoped>
.fenster-abschnitt {
    min-width: 0;
    padding-top: var(--divider-gap);
    border-top: 1px solid var(--color-divider);
}
</style>
