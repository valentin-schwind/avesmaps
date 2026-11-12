<script setup lang="ts">
/**
 * Eine Liste von Feldzeilen aus `<dt>`/`<dd>` auf DEM Raster der Feldzeile (`fenster-feldzeile-raster.css`; Betreiber 2026-10-19:
 * „glaubst man kann das so angleichen?“): `<dt>` in der Spalte der Beschriftung, `<dd>` in der des Felds, die ↺-Spalte bleibt leer.
 * So fluchtet ein Kasten aus solchen Zeilen mit den Wiki-Feldern darunter (`wiki-feld.vue`) und mit jeder `FensterFeldzeile`.
 *
 * Ein Editor tauscht sein eigenes `<dl class="…__werte">` gegen dieses Bauteil; die Zeilen darin bleiben, wie sie sind. Eingabe,
 * Auswahl und Textbereich füllen ihr `<dd>`; Text, Verweise und Knöpfe bleiben so breit wie ihr Inhalt.
 */
defineOptions({ name: "FensterFeldzeilen" });

defineProps<{ testid?: string | undefined }>();
</script>

<template>
    <dl class="fenster-feldzeilen fenster-feldzeile-raster" :data-testid="testid"><slot /></dl>
</template>

<style src="./fenster-feldzeile-raster.css"></style>

<style scoped>
.fenster-feldzeilen {
    align-items: center;
    row-gap: var(--space-4);
    margin: 0;
}

.fenster-feldzeilen :slotted(dt) {
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

.fenster-feldzeilen :slotted(dd) {
    grid-column: 2;
    min-width: 0;
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.fenster-feldzeilen
    :deep(dd > :is(.eingabe-huelle, .auswahl-huelle, .mehrfach-huelle, .textbereich-huelle, input.feld)) {
    width: 100%;
}
</style>
