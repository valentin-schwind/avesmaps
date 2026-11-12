<script setup lang="ts">
/**
 * Die Urheberzeile unter den Bildern der Kataloge (Legacy `avesmapsGameLiteratureCreditMarkup` und `avesmapsCitymapCreditMarkup`, Pflichtangabe
 * aus den Ulisses-Fanrichtlinien, `NOTICE.md`): „Bilder © Ulisses Spiele bzw. der jeweiligen Rechteinhaber“. EIN Bauteil für den Streifen im
 * Panel und die Fenster; ob sie überhaupt steht, entscheidet `catalogCredit` (keine Bilder, keine Zeile).
 *
 * 🔴 Nur der Satz, kein Link (Betreiber 2026-10-09). Wo die Zeile steht, bestimmt der Aufrufer.
 */
withDefaults(defineProps<{ text: string; tag?: "p" | "span" }>(), { tag: "p" });
</script>

<template>
    <component :is="tag" class="urheber" data-testid="info-catalog-credit">{{ text }}</component>
</template>

<style scoped>
/*
 * Die Urheberzeile ist eine FUSSNOTE, nicht eine Überschrift: dieselbe Farbe und dieselbe Sprosse wie die übrigen Hinweiszeilen
 * (`--color-text-muted`, `--font-size-caption` - die unterste Sprosse des Kanons, 11 px). Keine neue Farbe, keine neue Sprosse.
 */
.urheber {
    display: block;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}
</style>
