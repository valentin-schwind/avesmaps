<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from "vue";
import { ESCAPE_CASCADE_KEY } from "../keyboard/escape-cascade";
import type { ChoiceList } from "./choice-list";

/**
 * Die Auswahlliste (`choice-list.ts`): am Klick die Flächen, wo mehrere übereinanderliegen (WI-0043 Stufe 2, „C“: alle Flächen
 * an der Stelle, kleinste zuerst, die gewählte markiert), und die Kandidaten eines mehrdeutigen Objektlinks (WI-0063 4.6). Zeigen
 * oder Fokus auf einem Eintrag umreißt ihn auf der Karte (`preview`), ein Klick oder Enter wählt ihn.
 *
 * Aussehen und Regeln wie das Kartenmenü (`map-context-menu.vue`, Guide §18): Esc schließt, ein Klick daneben
 * schließt, jede Kartenbewegung schließt (bei den Flächen), die Pfeiltasten wandern. Ein Klick daneben auf dieselbe Stelle
 * schließt sie und wählt die nächste Fläche (Durchklicken, „B“), die Liste geht dann neu auf.
 *
 * 🔴 Esc gehört der Kaskade (`keyboard/escape-cascade.ts`, Stufe „menus“): Eine offene Liste schließt, ohne die Auswahl
 * aufzuheben. Sie hört nicht selbst auf die Taste.
 *
 * Auch für Editoren wählt ein Eintrag nur, ohne Untermenü (WI-0178, Betreiber 2026-10-21, wörtlich: „Das Hier liegen 3 Flächen soll aber
 * bleiben und bei der auswahl die fläche halt auswählen“, „aber keine untermenüs mehr haben“); das Editor-Menü gibt es beim Rechtsklick.
 */

const props = defineProps<{ choices: ChoiceList | undefined }>();
const emit = defineEmits<{
    choose: [id: string];
    /** Welcher Eintrag gerade gezeigt wird; `undefined`, wenn keiner. */
    preview: [id: string | undefined];
    close: [];
}>();

const menu = useTemplateRef<HTMLDivElement>("menu");

/** Vom Klickpunkt abgesetzt, damit die gewählte Fläche sichtbar bleibt; am Rand klappt die Liste um. */
const OFFSET = 12;
const EDGE = 8;
/**
 * Die Lage der Liste: zuerst neben dem Klick, dann ganz im Bild (`placeInside`). 🪤 Als EIN Zustand: Eine Bindung an den Klickpunkt
 * setzte bei jeder Neuzeichnung (etwa der gelben Zeile) die Lage zurück, die Liste sprang am Telefon unter dem Finger weg.
 */
const lage = shallowRef<{ left: string; top: string } | undefined>();
const position = computed(() => {
    if (lage.value) return lage.value;
    const at = props.choices?.screen;
    return at ? { left: `${String(at.x + OFFSET)}px`, top: `${String(at.y + OFFSET)}px` } : {};
});

async function placeInside(): Promise<void> {
    await nextTick();
    const element = menu.value;
    const at = props.choices?.screen;
    if (!element || !at) return;
    const box = element.getBoundingClientRect();
    const left = at.x + OFFSET + box.width > globalThis.innerWidth - EDGE ? at.x - OFFSET - box.width : at.x + OFFSET;
    const top = at.y + OFFSET + box.height > globalThis.innerHeight - EDGE ? at.y - OFFSET - box.height : at.y + OFFSET;
    lage.value = { left: `${String(Math.max(EDGE, left))}px`, top: `${String(Math.max(EDGE, top))}px` };
}

function onOutside(event: PointerEvent): void {
    if (!menu.value?.contains(event.target as Node)) emit("close");
}

function onKey(event: KeyboardEvent): void {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    // Die Pfeile gehören der Liste, nicht der Karte.
    event.stopPropagation();
    const items = [...(menu.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
    items[next]?.focus();
}

function listen(on: boolean): void {
    if (on) {
        document.addEventListener("pointerdown", onOutside, true);
    } else {
        document.removeEventListener("pointerdown", onOutside, true);
    }
}

watch(
    () => props.choices,
    (choices, vorher) => {
        listen(choices !== undefined);
        // Eine Liste an einer neuen Stelle beginnt wieder neben dem Klick.
        if (choices?.screen.x !== vorher?.screen.x || choices?.screen.y !== vorher?.screen.y) lage.value = undefined;
        if (choices) void placeInside();
    },
);

const cascade = inject(ESCAPE_CASCADE_KEY, undefined);
let unregister: (() => void) | undefined;
onMounted(() => {
    unregister = cascade?.register("menus", () => {
        if (props.choices === undefined) return false;
        emit("close");
        return true;
    });
});

onBeforeUnmount(() => {
    listen(false);
    unregister?.();
});

/**
 * Welche Flächen die Karte gerade gelb zeigt: die gewählte und die gezeigte (Zeiger, Fokus). Jede ihrer Zeilen steht samt Name in der
 * Farbe der Kartenauswahl (Betreiber 2026-10-20: „mit gelber schrift highlighten was auf der karte aktuell auch gelb markiert ist“;
 * Editor-Orchestrierung 2026-10-20: beide, verlässt der Zeiger die Zeile, bleibt die gewählte).
 */
const gezeigt = shallowRef<string | undefined>();
function zeigeVorschau(id: string | undefined): void {
    gezeigt.value = id;
    emit("preview", id);
}

function choose(id: string): void {
    emit("choose", id);
    emit("close");
}
</script>

<template>
    <div
        v-if="choices"
        ref="menu"
        class="area-choices"
        role="menu"
        :aria-label="choices.label"
        :style="position"
        :data-testid="choices.testid"
        @keydown="onKey"
        @mouseleave="zeigeVorschau(undefined)"
    >
        <div class="area-choices__title">{{ choices.title }}</div>
        <button
            v-for="entry in choices.entries"
            :key="entry.id"
            type="button"
            class="area-choices__item"
            :class="{ 'is-markiert': entry.id === choices.selected || entry.id === gezeigt }"
            role="menuitemradio"
            :aria-checked="entry.id === choices.selected"
            :data-testid="choices.itemTestid"
            @click="choose(entry.id)"
            @mouseenter="zeigeVorschau(entry.id)"
            @mouseleave="zeigeVorschau(undefined)"
            @focus="zeigeVorschau(entry.id)"
        >
            <span
                class="area-choices__mark"
                :style="entry.swatch === undefined ? undefined : { color: entry.swatch }"
                aria-hidden="true"
                >{{ entry.swatch !== undefined || entry.id === choices.selected ? "●" : "" }}</span
            >
            <span class="area-choices__name einzeilig">{{ entry.name }}</span>
            <span class="area-choices__type">{{ entry.type }}</span>
        </button>
    </div>
</template>

<style scoped>
/* Wie das Kartenmenü (§18): ein kleines Blatt über der Karte, Radius 10, Einträge 36 hoch. */
.area-choices {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    min-width: 204px;
    max-width: min(420px, calc(100vw - 16px));
    padding: var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
}

/* Der Gruppentitel des Kartenmenüs: 11 px, Versalien, gesperrt, in der Akzentfarbe. */
.area-choices__title {
    padding: var(--space-4) var(--space-10) var(--space-2);
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
}

.area-choices__item {
    display: grid;
    grid-template-columns: 1em minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-8);
    width: 100%;
    min-height: 36px;
    padding: var(--space-6) var(--space-10);
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    text-align: left;
    transition: background-color 120ms ease;
}

.area-choices__mark {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

/* Zu lange Namen kürzt die Hausklasse `.einzeilig` (app.vue): Sie lässt den Unterlängen Platz. */
.area-choices__item.is-markiert,
.area-choices__item.is-markiert .area-choices__name,
.area-choices__item.is-markiert .area-choices__type {
    color: var(--color-list-selection-text);
}

.area-choices__name {
    color: var(--color-text-strong);
}

.area-choices__type {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.area-choices__item:hover,
.area-choices__item:focus-visible {
    outline: none;
    background: var(--color-hover-wash);
}

.area-choices__item:active {
    background: var(--color-active-wash);
}

@media (prefers-reduced-motion: reduce) {
    .area-choices__item {
        transition: none;
    }
}
</style>
