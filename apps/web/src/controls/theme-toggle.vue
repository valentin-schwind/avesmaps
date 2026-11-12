<script setup lang="ts">
import { computed } from "vue";
import { melde } from "../besuch/besuch-melden";
import { theme, toggleTheme } from "../theme/theme";
import { t } from "../i18n/i18n";

/**
 * Der Themenknopf (WI-0032; Legacy `index.html:2738`, `css/features/route-planner.css:1302-1413`):
 * Sonne und Mond in der oberen rechten Ecke des Planers. Beim Wechsel geht das eine unter und das
 * andere auf, mit einem kleinen Überschwinger; die Sonne dreht sich langsam. Bei „Bewegung
 * reduzieren“ steht beides still.
 */
const dark = computed(() => theme.value === "dark");
const label = computed(() => (dark.value ? t("theme.toggle.toLight") : t("theme.toggle.toDark")));

/** Die Wahl eines Menschen zählt hier, an der Hand (WI-0286); was dem Betriebssystem folgt, zählt nur beim Start der Seite. */
function wechsle(): void {
    toggleTheme();
    melde("theme", theme.value);
}
</script>

<template>
    <button
        type="button"
        class="theme-toggle"
        :aria-label="label"
        :aria-pressed="dark"
        :title="t('theme.toggle.title')"
        data-testid="theme-toggle"
        @click="wechsle()"
    >
        <svg class="theme-toggle__icon theme-toggle__icon--sun" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="4.2" />
            <g stroke-width="1.9" stroke-linecap="round">
                <line x1="12" y1="2" x2="12" y2="4.4" />
                <line x1="12" y1="19.6" x2="12" y2="22" />
                <line x1="2" y1="12" x2="4.4" y2="12" />
                <line x1="19.6" y1="12" x2="22" y2="12" />
                <line x1="4.9" y1="4.9" x2="6.6" y2="6.6" />
                <line x1="17.4" y1="17.4" x2="19.1" y2="19.1" />
                <line x1="4.9" y1="19.1" x2="6.6" y2="17.4" />
                <line x1="17.4" y1="6.6" x2="19.1" y2="4.9" />
            </g>
        </svg>
        <svg class="theme-toggle__icon theme-toggle__icon--moon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
    </button>
</template>

<style scoped>
.theme-toggle {
    position: relative;
    width: 24px;
    height: 24px;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    cursor: pointer;
    transition: transform 120ms ease;
}

.theme-toggle:hover {
    transform: scale(1.12);
}

.theme-toggle:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.theme-toggle__icon {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 21px;
    height: 21px;
    transition: transform 550ms cubic-bezier(0.34, 1.32, 0.5, 1);
}

/* Hell: die Sonne steht, der Mond ist unter dem Horizont. */
.theme-toggle__icon--sun {
    fill: var(--color-theme-sun);
    stroke: var(--color-theme-sun);
    transform: translate(-50%, -50%);
}

.theme-toggle__icon--moon {
    fill: var(--color-theme-moon);
    transform: translate(-50%, 135%);
}

/* Dunkel: die Sonne ist untergegangen, der Mond steht. */
:root[data-theme="dark"] .theme-toggle__icon--sun {
    transform: translate(-50%, 135%);
}

:root[data-theme="dark"] .theme-toggle__icon--moon {
    transform: translate(-50%, -50%);
}

.theme-toggle__icon--sun g {
    transform-box: fill-box;
    transform-origin: center;
    animation: theme-sun-spin 22s linear infinite;
}

@keyframes theme-sun-spin {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .theme-toggle,
    .theme-toggle__icon,
    .theme-toggle__icon--sun g {
        transition: none;
        animation: none;
    }
}
</style>
