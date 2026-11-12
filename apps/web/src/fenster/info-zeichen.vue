<script setup lang="ts">
/**
 * Das ⓘ als Strichzeichen (Legacy `index.html`, `.tsi-info-btn`): Kreis, Strich, Punkt, in der Farbe
 * seiner Umgebung. EINE Zeichnung für den Auslöser (`info-knopf.vue`) und das Zeichen vor dem Titel
 * eines Erklärfensters (`avm-fenster.vue`) - ein Bild mit zwei Lesern steht an einer Stelle (Guide §13.44).
 */
</script>

<template>
    <svg class="info-zeichen" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="11" x2="12" y2="16" />
        <circle class="info-zeichen__punkt" cx="12" cy="7.5" r="1" />
    </svg>
</template>

<style scoped>
.info-zeichen {
    display: block;
    width: 100%;
    height: 100%;
    fill: none;
    stroke: currentcolor;
    stroke-width: 2;
}

.info-zeichen__punkt {
    fill: currentcolor;
    stroke: none;
}
</style>
