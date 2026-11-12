<script setup lang="ts">
import AvmWert from "../controls/avm-wert.vue";
import type { Wert } from "../controls/wert";

/**
 * Der Kopf einer Mediengruppe (WI-0079 §1.1) und der Kasten um ihre Etappen.
 *
 * 🪤 Ein eigener kleiner Baustein statt `AvmDisclosure` - genau der Fall, den §5 nennt: Der zweizeilige Kopf mit
 * Bild in eigener Spalte passt nicht in dessen einzeilige Kopfzeile. **Tokens, Zustände, Pfeil (▾/▴) und Dauern
 * sind unverändert die seinen** (Guide §30.5: Ruhe · Hover · Aktiv · Fokus · Übergang).
 *
 * Der Titel trägt KEINE Zahl: Nach der Klappbox-Regel (Guide §16.3) ist ein Titel mit Zahl Sekundärtext und damit
 * gedämpft - der Gruppenname wäre dann leiser als die Zahlen darunter. Die Zahl der Etappen steht in der Metazeile.
 */
defineProps<{
    title: string;
    icon: string;
    meta: readonly Wert[];
    open: boolean;
    bodyId: string;
    testid?: string;
    /** Eine Etappe dieser Gruppe ist ein Treffer von „Unterwegs“ (WI-0257 S4): Der Kopf zeigt es auch bei zugeklappter Gruppe. */
    treffer?: boolean;
}>();
const emit = defineEmits<{ toggle: [] }>();

function onKey(event: KeyboardEvent): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    emit("toggle");
}
</script>

<template>
    <li class="group" :class="{ 'group--closed': !open, 'group--treffer': treffer }" data-testid="route-stage-group">
        <div
            class="group__head"
            :class="{ 'avm-kopf-offen': open }"
            role="button"
            tabindex="0"
            :aria-expanded="open"
            :aria-controls="bodyId"
            :data-testid="testid"
            @click="emit('toggle')"
            @keydown="onKey"
        >
            <span aria-hidden="true"></span>
            <img class="group__icon" :src="icon" alt="" />
            <span class="group__titles">
                <span class="group__title">{{ title }}</span>
                <span class="group__meta">
                    <template v-for="(value, index) in meta" :key="index"
                        ><span v-if="index > 0" class="group__sep"> · </span><AvmWert :werte="[value]"
                    /></template>
                </span>
            </span>
            <span class="group__arrow" aria-hidden="true"></span>
        </div>
        <ul :id="bodyId" class="group__body">
            <slot />
        </ul>
    </li>
</template>

<style scoped>
.group {
    --mark-bg: var(--color-panel);
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    background: var(--color-disclosure-bg);
    box-shadow: var(--shadow-disclosure);
}

.group__head {
    display: grid;
    grid-template-columns: var(--mark-size) var(--icon-md) minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-4);
    /* Links eine Sprosse weniger: Die Kante des Kastens trägt das fehlende Pixel, die Kette bleibt in der Spur. */
    padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) - 1px);
    border-radius: calc(var(--radius-md) - 1px);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.group__head:hover {
    background: var(--color-panel-active);
}

.group__head:active {
    background: var(--color-active-wash);
}

.group__head:focus-visible {
    outline: none;
    box-shadow: inset 0 0 0 calc(var(--space-2) / 2) var(--color-focus);
}

/* Wie die Etappenzeile (`route-stage-row.vue`): das Gold des Leuchtens als sanfte Fläche, ohne Kante. */
.group--treffer > .group__head {
    background: color-mix(in srgb, var(--color-map-selection) 22%, transparent);
}

.group__icon {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.group__titles {
    min-width: 0;
}

.group__title {
    display: block;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.group__meta {
    display: block;
    margin-top: 1px;
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.group__sep {
    color: var(--color-text-muted);
}

.group__arrow {
    color: var(--color-link);
    font-size: var(--font-size-body);
    line-height: 1;
    transition: color 120ms ease;
}

.group__arrow::after {
    content: "▴";
}

.group--closed .group__arrow::after {
    content: "▾";
}

.group__head:hover .group__arrow {
    color: var(--color-link-hover);
}

/*
 * 🔴 Die Etappen einer Gruppe lesen als EINE zusammenhängende Liste (Betreiber 2026-10-05: „kannst du die
 * abstände zwischen den etappen entfernen?“) - kein Zwischenraum, also auch keine Kärtchen.
 *
 * Getrennt werden sie von einer Haarlinie ZWISCHEN zwei Zeilen, nie um eine Zeile herum: dieselbe Grammatik, die
 * `info-source-list` im Infopanel führt (`li + li`). Ein Rahmen zeigt im Haus, was ein Klick trifft - das darf eine
 * Trennlinie nicht behaupten. Der Abstand ZWISCHEN den Gruppen bleibt (`--leg-gap` an der Liste): Dass ein neues
 * Medium beginnt, ist eine andere Aussage als dass eine neue Etappe beginnt.
 */
.group__body {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.group__body > * + * {
    border-top: 1px solid var(--color-divider);
}

/* Die letzte Zeile rundet den Kasten mit; ihre Fläche stünde sonst in der Ecke über dessen Kante. */
.group__body > :last-child {
    border-bottom-left-radius: calc(var(--radius-md) - 1px);
    border-bottom-right-radius: calc(var(--radius-md) - 1px);
}

.group--closed .group__body {
    display: none;
}

@media (prefers-reduced-motion: reduce) {
    .group__head,
    .group__arrow {
        transition: none;
    }
}
</style>
