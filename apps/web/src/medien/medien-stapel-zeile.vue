<script setup lang="ts">
import { computed } from "vue";
import { zahl } from "./medien-text";

/**
 * Eine Zeile mit Bildstapel in Spalte 2 der Medienobjekte (Galerien, PhotoBox-Galerien): die ersten Bilder versetzt übereinander, darüber hinaus „+n“; eine Sammlung erkennt man am Bild, nicht am Titel. Eine Marke
 * neben dem Namen kommt über den Slot `marke`.
 */
const props = defineProps<{
    name: string;
    unterzeile: string;
    previews: readonly { url: string }[];
    anzahl: number;
    gewaehlt: boolean;
    /** Die Unterzeile in der Warnfarbe (ein Entwurf, den Besucher nicht sehen). */
    warnung?: boolean;
}>();

const mehr = computed(() => Math.max(0, props.anzahl - props.previews.length));
</script>

<template>
    <button
        type="button"
        class="galerie-zeile"
        :class="{ 'is-gewaehlt': gewaehlt }"
        :aria-current="gewaehlt ? 'true' : undefined"
    >
        <span class="galerie-zeile__stapel">
            <img
                v-for="(bild, i) in previews"
                :key="bild.url"
                :src="bild.url"
                :style="{ '--i': i }"
                alt=""
                loading="lazy"
                decoding="async"
            />
            <span v-if="mehr > 0" class="galerie-zeile__mehr">+{{ zahl(mehr) }}</span>
        </span>
        <span class="galerie-zeile__text">
            <span class="galerie-zeile__l1">
                <span class="galerie-zeile__name einzeilig">{{ name }}</span>
                <slot name="marke" />
            </span>
            <span class="galerie-zeile__l2 einzeilig" :class="{ 'is-entwurf': warnung }">{{ unterzeile }}</span>
        </span>
        <span class="galerie-zeile__n">{{ zahl(anzahl) }}</span>
    </button>
</template>

<style scoped>
/* Eine Zeile wie jede Zeile des Hauses (Legacys `.avm-row`): durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.galerie-zeile {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.galerie-zeile:hover {
    background: var(--color-hover-wash);
}

.galerie-zeile:active {
    background: var(--color-active-wash);
}

.galerie-zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.galerie-zeile.is-gewaehlt,
.galerie-zeile.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

/* Der Stapel: die ersten Bilder versetzt übereinander, das Cover vorn. */
.galerie-zeile__stapel {
    position: relative;
    flex: none;
    width: 92px;
    height: 46px;
}

.galerie-zeile__stapel img {
    position: absolute;
    top: calc(var(--i) * 3px);
    left: calc(var(--i) * 14px);
    width: 62px;
    height: 35px;
    border: 2px solid var(--color-panel);
    border-radius: var(--radius-sm);
    object-fit: cover;
    box-shadow: 0 1px 3px rgb(46 39 30 / 30%);
}

.galerie-zeile__mehr {
    position: absolute;
    right: -4px;
    bottom: 0;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--color-text-strong);
    color: var(--color-panel);
    font-size: var(--font-size-caption);
}

.galerie-zeile__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.galerie-zeile__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.galerie-zeile__name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.galerie-zeile__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.galerie-zeile__l2.is-entwurf {
    color: var(--color-warning-soft-text);
}

.galerie-zeile__n {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .galerie-zeile {
        transition: none;
    }
}
</style>
