<script setup lang="ts">
/**
 * Eine Karte im Rumpf (Legacy `.tsi-wcard`/`.tsi-wtitle`, Guide §17.9 und §13.43): ein in sich
 * geschlossener Block mit eigener Aufschrift - Landreise, Flussreise, Meerreise.
 *
 * - Fläche `--color-panel-soft`, Kante `--color-border`, Radius `md`, Polster 12 / 14.
 * - Die Aufschrift steht INNEN oben, mit Bild davor: 12 px, Goldbraun, gemischt geschrieben, leicht
 *   gesperrt - die „feste Gruppe“ aus §8. Sie ist Text, kein Knopf; Versalien hießen „hier kann man
 *   drücken“.
 * - 🔴 Geschwister teilen eine Form (§13.43): stehen Karten nebeneinander, sind es alle Karten.
 * - Rechts neben der Aufschrift darf ein Etikett stehen (Slot `etikett`), etwa eine Wirkungsklasse.
 */
defineProps<{
    titel: string;
    /** Ein Inhaltsbild vor der Aufschrift, in voller Farbe (§13.42). */
    bild?: string | undefined;
}>();
</script>

<template>
    <section class="fenster-karte">
        <h3 class="fenster-karte__titel">
            <img v-if="bild" class="fenster-karte__bild" :src="bild" alt="" />
            <span>{{ titel }}</span>
            <slot name="etikett" />
        </h3>
        <slot />
    </section>
</template>

<style scoped>
.fenster-karte {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-10) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

/* Die Sperrung 0.02em ist Legacys Wert am Bauteil, nicht `--letter-spacing-caps` (Guide §8, §28.4). */
.fenster-karte__titel {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-bold);
    letter-spacing: 0.02em;
    line-height: var(--leading-snug);
}

.fenster-karte__bild {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    object-fit: contain;
    pointer-events: none;
}
</style>
