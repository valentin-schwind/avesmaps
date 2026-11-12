<script setup lang="ts">
import { t } from "../i18n/i18n";

/**
 * Die Lücke zwischen zwei Neuigkeiten in der Pflege (WI-0217; Betreiber 2026-10-17: „praktisch wär wie die blaue linie, wenn ich oben
 * oder zwischendrin manuell neuigkeiten einfügen könnte“). Beim Überfahren und im Tastaturfokus erscheint eine Linie mit „✚ Neu“; ein
 * Klick öffnet den Editor an dieser Stelle.
 *
 * - Am Finger gibt es kein Überfahren: Dort steht die Linie immer da, leise in der Farbe der Trennlinie, die Marke gedämpft.
 * - 🔴 Keine Deckkraft: Sie heißt im Haus „gesperrt“ (Guide §30.2). Verborgen ist die Marke über `visibility`, die Linie über ihre Farbe.
 */
defineProps<{
    /** Für Vorleser: wo eingefügt wird („ganz oben“ oder unter welchem Eintrag). */
    label: string;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ einfuegen: [] }>();
</script>

<template>
    <li class="luecke">
        <button
            type="button"
            class="luecke__knopf"
            :aria-label="label"
            :data-testid="testid"
            @click="emit('einfuegen')"
        >
            <span class="luecke__marke" aria-hidden="true">{{ t("admin.news.insert") }}</span>
        </button>
    </li>
</template>

<style scoped>
.luecke {
    position: relative;
    height: var(--space-16);
    list-style: none;
}

.luecke__knopf {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    width: 100%;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-accent-strong);
    font: inherit;
    cursor: pointer;
}

.luecke__knopf::before,
.luecke__knopf::after {
    content: "";
    flex: 1 1 auto;
    height: 2px;
    background: transparent;
    transition: background-color 120ms ease;
}

.luecke__marke {
    flex: none;
    margin-inline: var(--space-6);
    padding: 0 var(--space-6);
    border: 1px solid var(--color-accent);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    visibility: hidden;
}

.luecke__knopf:hover::before,
.luecke__knopf:hover::after,
.luecke__knopf:focus-visible::before,
.luecke__knopf:focus-visible::after {
    background: var(--color-accent);
}

.luecke__knopf:hover .luecke__marke,
.luecke__knopf:focus-visible .luecke__marke {
    visibility: visible;
}

.luecke__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (hover: none) {
    .luecke__knopf::before,
    .luecke__knopf::after {
        background: var(--color-divider);
    }

    .luecke__marke {
        border-color: var(--color-divider);
        color: var(--color-text-muted);
        visibility: visible;
    }
}

@media (prefers-reduced-motion: reduce) {
    .luecke__knopf::before,
    .luecke__knopf::after {
        transition: none;
    }
}
</style>
