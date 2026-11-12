<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die Marke „rot schraffiert“ (WI-0308, Entwurf: an der Zeile der Liste und vor dem Hinweis unter der Gefahrenlage): ein kleines Kästchen
 * mit Rand, Tönung und Strichen unter 45° in der Kartenfarbe `colour.mapGefahr`, wie die Fläche auf der Karte. Die Karte ist hell, die Marke
 * zeigt dieselbe Farbe in beiden Themen. Der Name steht als `title` und für Vorleser.
 */
</script>

<template>
    <span class="gefahr-marke" role="img" :aria-label="t('gefahr.schraffur')" :title="t('gefahr.schraffur')"></span>
</template>

<style scoped>
.gefahr-marke {
    display: inline-block;
    flex: none;
    box-sizing: border-box;
    width: var(--space-16);
    height: var(--space-10);
    border: 1.5px solid var(--color-map-gefahr);
    border-radius: var(--radius-sm);
    background:
        repeating-linear-gradient(
            135deg,
            color-mix(in srgb, var(--color-map-gefahr) 75%, transparent) 0 1.6px,
            transparent 1.6px 5px
        ),
        color-mix(in srgb, var(--color-map-gefahr) 10%, transparent);
    vertical-align: -1px;
}
</style>
