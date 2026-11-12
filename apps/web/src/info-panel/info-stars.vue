<script setup lang="ts">
import type { StarFill } from "./catalog-model";

/**
 * Die Bewertungssterne (Design Guide §16.6, Legacy `reviewStarsMarkup`, `css/features/location-reviews.css`): fünf Zeichen ★ in drei
 * Zuständen.
 *
 * 🔴 **Eine Teilfüllung wird AM SELBEN Zeichen gemacht, nicht mit einem zweiten Symbol** (Guide §16.6): Der halbe Stern ist ein ★,
 * dessen linke Hälfte gold und dessen rechte stumpf ist - ein HARTER Farbwechsel bei 50 %, auf die Schrift geclippt. Keine
 * Halbstern-Glyphe, keine Überlagerung zweier Sterne, kein Beschnitt. Avesmaps kodiert Anteile durch Füllung, nie durch getrennte
 * Zeichen.
 *
 * Die Sterne sind ein BILD: Sie tragen `aria-hidden`, und daneben steht der Wert als Text für Bildschirmleser (`label`).
 */
defineProps<{ stars: readonly StarFill[]; label: string }>();
</script>

<template>
    <span class="info-stars" data-testid="info-stars">
        <span class="info-stars__glyphs" aria-hidden="true"
            ><span v-for="(fill, at) in stars" :key="at" class="info-stars__star" :class="`is-${fill}`">★</span></span
        >
        <span class="info-stars__label">{{ label }}</span>
    </span>
</template>

<style scoped>
/*
 * 💣 `position: relative` ist Pflicht, nicht Geschmack: Der Text für Bildschirmleser unten steht `absolute`, und ohne eigenen
 * Bezugsrahmen würde das PANEL sein Bezugsrahmen - genau so entstand am 2026-10-04 der zweite Scrollbalken im Planer.
 */
.info-stars {
    position: relative;
    display: inline-flex;
    align-items: baseline;
}

/* Die Sperrung trennt fünf ★ voneinander (Legacy 1 px bei 12 bis 14 px Schrift); der Kanonwert liegt genau dort. */
.info-stars__glyphs {
    display: inline-flex;
    letter-spacing: var(--letter-spacing-caps);
    white-space: nowrap;
}

/* Leer ist der Grundzustand: derselbe Stern, nur stumpf. */
.info-stars__star {
    color: var(--color-star-muted);
}

.info-stars__star.is-full {
    color: var(--color-star);
}

/* Der halbe Stern: ein Verlauf mit harter Kante bei 50 %, auf die Schrift geclippt (Guide §16.6, §13.23). */
.info-stars__star.is-half {
    background-image: linear-gradient(90deg, var(--color-star) 50%, var(--color-star-muted) 50%);
    background-clip: text;
    color: transparent;
}

/* Der Wert steht nur für Bildschirmleser da; im Bild sagen ihn die Sterne. */
.info-stars__label {
    position: absolute;
    overflow: hidden;
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    white-space: nowrap;
}
</style>
