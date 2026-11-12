<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die Pille „Verborgen“ (WI-0080 Nachtrag, Betreiber 2026-10-05: „kannst du eine weitere pille in lila neben ‚offiziell/inoffiziell‘ mit
 * den titel ‚Verborgen‘“). Sie steht im Kopf des Panels NEBEN dem Kanon-Etikett und nur an einem verborgenen Ort - einem, den man auf der
 * Karte findet und nicht über die Suche (die Regel steht in WI-0080).
 *
 * 🔴 Gestalt und Maße sind die der Kanon-Pille (`info-canon-pill.vue`), damit die beiden eine Zeile ergeben; damit gelten auch deren
 * Betreiberentscheide vom 2026-10-04 weiter: FETT ist das Wort, und zwar mit ausdrücklich erlaubter Kunstfettung (Faculty Glyphic bringt
 * nur Regular mit, `canon.css` schaltet die Synthese appweit ab); MITTIG ist die Hausregel `.avm-versalmitte` (`styles/canon.css`), die
 * den Textkasten auf die Versalhöhe schneidet, statt eines von Hand austarierten Polsters. Dass keine der beiden Rezepturen wegläuft,
 * hält `apps/web/test/info-pillen-masse.test.ts` fest, und `e2e/leisten-mitte.spec.ts` misst es am Bild.
 *
 * 🪤 Die Farbe sagt etwas ANDERES als Kanon, deshalb ein eigener Ton und keine der beiden Kanonfarben: `colour.pillHidden` im Designkanon,
 * hell und dunkel, als Geschwister der beiden vorhandenen Pillen gewählt (Begründung und Messwerte stehen dort). Farbe allein ist keine
 * Auszeichnung - der Wortlaut steht IM Element.
 *
 * 🔴 Das kennt Legacy nicht: Dort ist ein verborgener Ort unsichtbar und es gibt kein Etikett dafür. Bewusste Abweichung (WI-0080 §7).
 */
</script>

<template>
    <span class="info-hidden" data-testid="info-hidden">
        <span class="info-hidden__word"
            ><span class="info-hidden__glyphs avm-versalmitte">{{ t("infoPanel.hidden") }}</span></span
        >
    </span>
</template>

<style scoped>
.info-hidden {
    display: inline-flex;
    align-items: stretch;
    flex-shrink: 0;
    box-sizing: border-box;
    height: var(--space-16);
    max-width: 100%;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-kanon);
    letter-spacing: var(--letter-spacing-caps);
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
}

/* Das Feld füllt die Höhe und setzt seine Schrift in die Mitte. */
.info-hidden__word {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    padding: 0 var(--space-6);
    background: var(--color-pill-hidden);
    color: var(--color-pill-hidden-text);
    font-weight: var(--font-weight-bold);
    font-synthesis-weight: auto;
}

/* 🪤 Die Kunstfettung steht auch am Textkasten selbst: Ohne sie zeichnete der Browser dasselbe Regular (wie bei der Kanon-Pille). */
.info-hidden__glyphs {
    font-synthesis-weight: auto;
}
</style>
