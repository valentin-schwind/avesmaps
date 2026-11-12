<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die Pille „Gefahrengebiet“ (WI-0308; Vali 2026-11-12, Antwort 12: „oh ja gut idee, hab ich ganz vergessen. du kannst die pille
 * "Gefahrengebiet" verwenden“). Sie steht im Kopf des Panels neben dem Kanon-Etikett, an einer Fläche mit wirksamer Gefahrenlage; die Arten
 * stehen darunter in einer eigenen Zeile (`info-header.vue`).
 *
 * 🔴 Gestalt und Maße der Pille „Verborgen“ (`info-hidden-pill.vue`): dieselbe Höhe, dasselbe fette, mittig gesetzte Wort, damit die Pillen
 * eine Zeile ergeben. Die Farbe ist das weiche Gefahrentripel des Kanons (`danger-soft*`), hell und dunkel; das Wort steht IM Element.
 */
</script>

<template>
    <span class="info-gefahr" data-testid="info-gefahr">
        <span class="info-gefahr__word"
            ><span class="info-gefahr__glyphs avm-versalmitte">{{ t("gefahr.pille") }}</span></span
        >
    </span>
</template>

<style scoped>
.info-gefahr {
    display: inline-flex;
    align-items: stretch;
    flex-shrink: 0;
    box-sizing: border-box;
    height: var(--space-16);
    max-width: 100%;
    overflow: hidden;
    border: 1px solid var(--color-danger-soft-border);
    border-radius: var(--radius-lg);
    font-size: var(--font-size-kanon);
    letter-spacing: var(--letter-spacing-caps);
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
}

/* Das Feld füllt die Höhe und setzt seine Schrift in die Mitte. */
.info-gefahr__word {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 var(--space-6);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
    font-weight: var(--font-weight-bold);
    font-synthesis-weight: auto;
}

/* 🪤 Die Kunstfettung steht auch am Textkasten selbst: Ohne sie zeichnete der Browser dasselbe Regular (wie bei der Kanon-Pille). */
.info-gefahr__glyphs {
    font-synthesis-weight: auto;
}
</style>
