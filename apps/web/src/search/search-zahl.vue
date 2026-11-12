<script setup lang="ts">
/**
 * Eine Zahl in der Trefferliste („leuchtet in 194 Gegenden“, „39 Gegenden“): der Satz mit der Zahl als eigenem Stück, damit sie in der Farbe der Auswahl steht (WI-0257 S3b, Entwurf „Suchen und
 * Leuchten“). Der Satz kommt fertig aus der Sprachtafel (`tPlural`), die Zählform wählt die Sprache; hier steht nur, wo die Zahl sitzt.
 *
 * Ohne Wert (die Zahl wird noch nachgeladen) steht nichts da: kein Platzhalter, der später springt.
 */
defineProps<{
    wert: { zahl?: number; vor?: string; nach?: string; text?: string } | undefined;
    testid?: string;
}>();
</script>

<template>
    <span v-if="wert !== undefined" class="search-zahl" :data-testid="testid">
        <template v-if="wert.zahl !== undefined"
            >{{ wert.vor }}<em>{{ wert.zahl }}</em
            >{{ wert.nach }}</template
        >
        <template v-else>{{ wert.text }}</template>
    </span>
</template>

<style scoped>
.search-zahl {
    color: var(--color-spotlight-text-soft);
    font-size: var(--font-size-caption);
    letter-spacing: 0;
    text-transform: none;
    white-space: nowrap;
}

/* Die Zahl in der Farbe, in der es auf der Karte leuchtet. */
.search-zahl em {
    color: var(--color-map-selection);
    font-style: normal;
}
</style>
