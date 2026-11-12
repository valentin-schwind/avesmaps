<script setup lang="ts">
import type { SubjectRef } from "@avesmaps3d/shared";
import InfoLid from "./info-lid.vue";
import InfoStairs from "./info-stairs.vue";
import type { LiesInModel } from "./panel-types";

/**
 * „Liegt in“ (WI-0063 5.4, Design Guide §16; Legacy `.location-popup__breadcrumb`): die Herrschaftskette als Treppe von der Wurzel zum
 * Blatt. Die Überschrift trägt die Beziehung (WI-0063 5.4): „Liegt in“, „An dieser Stelle“, „Erstreckt sich über“, „Verläuft durch“.
 *
 * Eine lange Treppe (mehr als vier Gebiete) steht in einem Deckel; dessen Kopf nennt die Beziehung samt Zahl („Erstreckt sich über 19
 * politische Gebiete“), eine eigene Überschrift steht dann nicht darüber (Betreiber 2026-10-04, WI-0063 27.12).
 */
defineProps<{ model: LiesInModel }>();
const emit = defineEmits<{ open: [ref: SubjectRef] }>();
</script>

<template>
    <section class="info-lies-in" data-testid="info-lies-in">
        <InfoLid v-if="model.lid !== undefined" :summary="model.lid.summary">
            <InfoStairs :rows="model.rows" @open="emit('open', $event)" />
        </InfoLid>
        <template v-else>
            <h3 class="info-lies-in__heading">{{ model.heading }}</h3>
            <InfoStairs :rows="model.rows" @open="emit('open', $event)" />
        </template>
    </section>
</template>

<style scoped>
/* Zwischen den zwei Linien über und unter: oben die des Bands, unten die eigene, die sie von der Datentabelle trennt (Legacy). */
.info-lies-in {
    padding: var(--space-10) var(--info-pad-x);
    border-bottom: 1px solid var(--color-divider);
}

.info-lies-in__heading {
    margin: 0 0 var(--space-2);
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-snug);
}
</style>
