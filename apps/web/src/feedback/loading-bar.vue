<script setup lang="ts">
import { loadingBar } from "./loading-bar";

/**
 * Der Ladebalken oben am Fenster (Legacy, MCS-020 D2). Rein zur Anzeige: er nimmt keinen Klick an
 * und liest sich nicht vor - was lädt, sagt der Satz im Planer.
 */
</script>

<template>
    <div
        class="loading-bar"
        :class="{ 'is-active': loadingBar.visible, 'is-resetting': loadingBar.resetting }"
        aria-hidden="true"
        data-testid="loading-bar"
    >
        <div class="loading-bar__fill" :style="{ width: `${(loadingBar.progress * 100).toFixed(2)}%` }"></div>
    </div>
</template>

<style scoped>
.loading-bar {
    position: fixed;
    top: 0;
    left: 0;
    z-index: var(--z-loading-bar);
    width: 100%;
    /* Bauteilmaß: Legacys Balkenhöhe. */
    height: 4px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 250ms ease;
}

.loading-bar.is-active {
    opacity: 1;
}

/* Gedecktes Bronze bis Antikgold, wie Legacy - dunkel genug für den Kontrast auf hellem Grund. */
.loading-bar__fill {
    height: 100%;
    background: linear-gradient(
        90deg,
        var(--color-loading-bar-deep) 0%,
        var(--color-loading-bar-mid) 50%,
        var(--color-loading-bar-light) 100%
    );
    box-shadow: var(--shadow-loading-bar);
    transition: width 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
}

.loading-bar.is-resetting .loading-bar__fill {
    transition: none;
}

@media (prefers-reduced-motion: reduce) {
    .loading-bar,
    .loading-bar__fill {
        transition-duration: 0ms;
    }
}
</style>
