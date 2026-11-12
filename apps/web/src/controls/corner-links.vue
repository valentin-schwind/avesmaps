<script setup lang="ts">
/**
 * Die beiden Verweise unten im Eckbund (WI-0028), wie Legacys `.map-corner-actions__row`:
 * „Neuigkeiten“ links, „Hinweise“ rechts am Rand, nebeneinander als letzte Reihe der Spalte.
 *
 * „Neuigkeiten“ war gesperrt, solange es das Fenster nicht gab (Betreiber 2026-09-23: „neuigkeiten (noch
 * deaktiviert)“). Seit WI-0139 gibt es es: der Knopf öffnet, was auf avesmaps.de neu ist (Betreiber
 * 2026-10-13, „es wird auch zeit … den "Neuigkeiten-Kanal" fürs frontend freizuschalten“).
 */
import { t } from "../i18n/i18n";

const emit = defineEmits<{ news: []; notes: [] }>();
</script>

<template>
    <div class="corner-links">
        <!-- Der Knopf „Reisebilder“ (WI-0272 S4) steht vor „Neuigkeiten“; er kommt aus dem nachgeladenen Teil und trägt die Klasse `corner-link` selbst. -->
        <slot />
        <button type="button" class="corner-link" data-testid="news-open" @click="emit('news')">
            {{ t("corner.news") }}
        </button>
        <button
            type="button"
            class="corner-link"
            data-testid="notes-open"
            aria-haspopup="dialog"
            @click="emit('notes')"
        >
            {{ t("corner.notes") }}
        </button>
    </div>
</template>

<style scoped>
/*
 * Legacys Eckknöpfe (`css/components/legal-dialog.css`, `#legal-button, #news-button`): Fläche,
 * Kontur, Radius und Schatten wie Suchlupe und Fächerkachel, dazu die Schrift der Textknöpfe.
 * Die Polsterung ist Legacys 7 × 10 px - kein Abstand des Kanons trifft sie, deshalb benannt.
 */
.corner-links {
    display: flex;
    align-items: flex-end;
    gap: var(--space-4);
}

.corner-link,
:slotted(.corner-link) {
    --corner-link-pad-y: 7px;
    --corner-link-pad-x: 10px;

    padding: var(--corner-link-pad-y) var(--corner-link-pad-x);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    cursor: pointer;
    font-family: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-tight);
    text-align: center;
    white-space: nowrap;
}

/* 🪤 Die Hoverwäsche ist durchscheinend: sie liegt ÜBER der Fläche, sonst sähe man die Karte durch. */
.corner-link:hover:not(:disabled),
.corner-link:focus-visible,
:slotted(.corner-link:hover:not(:disabled)),
:slotted(.corner-link:focus-visible) {
    outline: none;
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.corner-link:focus-visible,
:slotted(.corner-link:focus-visible) {
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/*
 * Gesperrt: die Schrift ausgegraut, kein Hover. 🪤 Nicht über die Deckkraft des ganzen Knopfes -
 * dann schiene die Karte durch seine Fläche (so am ersten Bild gesehen). Legacy graut gesperrte
 * Zeilen genauso über die Schriftfarbe aus.
 */
.corner-link:disabled,
:slotted(.corner-link:disabled) {
    color: var(--color-disabled-text);
    cursor: default;
}
</style>
