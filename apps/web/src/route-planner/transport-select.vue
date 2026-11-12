<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from "vue";
import { useAnchoredPopup } from "./anchored-popup";

/**
 * Das Auswahlfeld mit Bild (Design Guide §17.7, Legacy `.transport-combobox`).
 *
 * 🔴 Kein `<select>`: Ein natives Auswahlfeld kann kein Bild neben dem Text tragen, und die
 * Transportart ist ohne ihr Bild nur halb so schnell zu lesen. Die Tastatur ist Legacys: am Knopf
 * ↓/↑/Enter/Leertaste öffnen, in der Liste ↑/↓ zyklisch, Pos1/Ende, Enter/Leertaste wählen, Esc
 * schließt. Ein Klick daneben schließt; offen ist immer nur eine Liste.
 */
const props = defineProps<{
    /** `short`: was das geschlossene Feld zeigt, wenn der volle Text nicht hineinpasst; die Liste nennt ihn ganz. */
    options: readonly { value: string; label: string; short?: string; icon?: string }[];
    label: string;
    testid: string;
}>();
const model = defineModel<string>({ required: true });

const open = ref(false);
const active = ref(0);
const root = useTemplateRef<HTMLDivElement>("root");
const button = useTemplateRef<HTMLButtonElement>("button");
const list = useTemplateRef<HTMLUListElement>("list");
const listPosition = useAnchoredPopup(button, open);
const listId = `transport-select-${Math.random().toString(36).slice(2, 8)}`;
const selected = computed(() => props.options.find((option) => option.value === model.value) ?? props.options[0]);

/** Offen ist immer nur eine Liste im Haus: Wer öffnet, schließt die andere. */
const CLOSE_OTHERS = "avesmaps:transport-select-open";

function onOtherOpened(event: Event): void {
    if ((event as CustomEvent<string>).detail !== listId) close(false);
}

function onPointerOutside(event: PointerEvent): void {
    // Die Liste hängt am body, nicht in der Hülle - ein Tipp in sie ist kein Tipp daneben.
    const target = event.target as Node;
    if (!root.value?.contains(target) && !list.value?.contains(target)) close(false);
}

async function show(): Promise<void> {
    if (open.value) return;
    active.value = Math.max(
        0,
        props.options.findIndex((option) => option.value === model.value),
    );
    open.value = true;
    document.dispatchEvent(new CustomEvent(CLOSE_OTHERS, { detail: listId }));
    document.addEventListener(CLOSE_OTHERS, onOtherOpened);
    document.addEventListener("pointerdown", onPointerOutside, true);
    await nextTick();
    list.value?.focus();
}

function close(refocus: boolean): void {
    if (!open.value) return;
    open.value = false;
    document.removeEventListener(CLOSE_OTHERS, onOtherOpened);
    document.removeEventListener("pointerdown", onPointerOutside, true);
    if (refocus) button.value?.focus();
}

function choose(index: number): void {
    const option = props.options[index];
    if (option) model.value = option.value;
    close(true);
}

function onButtonKey(event: KeyboardEvent): void {
    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        void show();
    }
}

function onListKey(event: KeyboardEvent): void {
    const count = props.options.length;
    const keys: Record<string, () => void> = {
        ArrowDown: () => (active.value = (active.value + 1) % count),
        ArrowUp: () => (active.value = (active.value - 1 + count) % count),
        Home: () => (active.value = 0),
        End: () => (active.value = count - 1),
        Enter: () => choose(active.value),
        " ": () => choose(active.value),
        Escape: () => close(true),
        Tab: () => close(false),
    };
    const action = keys[event.key];
    if (!action) return;
    if (event.key !== "Tab") event.preventDefault();
    // Die Taste gehört dieser Liste, nicht der Karte (Pfeile verschieben sonst die Karte).
    event.stopPropagation();
    action();
}

onBeforeUnmount(() => close(false));
</script>

<template>
    <div ref="root" class="select" :data-testid="testid">
        <button
            ref="button"
            type="button"
            class="select__button"
            aria-haspopup="listbox"
            :aria-expanded="open"
            :aria-controls="listId"
            :aria-label="`${label}: ${selected?.label ?? ''}`"
            @click="open ? close(true) : show()"
            @keydown="onButtonKey"
        >
            <img v-if="selected?.icon" class="select__icon" :src="selected.icon" alt="" />
            <span class="select__label einzeilig">{{ selected?.short ?? selected?.label }}</span>
        </button>
        <!-- Am body, nicht im rollenden Panel: Die Liste ragt über den Planer hinaus (Betreiber 2026-09-24). -->
        <Teleport to="body">
            <ul
                v-if="open"
                :id="listId"
                ref="list"
                class="select__list"
                :style="listPosition"
                role="listbox"
                tabindex="-1"
                :aria-label="label"
                :aria-activedescendant="`${listId}-${String(active)}`"
                @keydown="onListKey"
            >
                <li
                    v-for="(option, index) in options"
                    :id="`${listId}-${String(index)}`"
                    :key="option.value"
                    class="select__option"
                    :class="{ 'is-active': index === active, 'is-selected': option.value === model }"
                    role="option"
                    :aria-selected="option.value === model"
                    @pointerenter="active = index"
                    @click="choose(index)"
                >
                    <img v-if="option.icon" class="select__icon" :src="option.icon" alt="" />
                    <span>{{ option.label }}</span>
                </li>
            </ul>
        </Teleport>
    </div>
</template>

<style scoped>
.select {
    position: relative;
    min-width: 0;
}

.select__button {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    width: 100%;
    height: var(--avm-control-h);
    box-sizing: border-box;
    /* Die 22 rechts machen dem Pfeil Platz (§17.7). */
    padding: 2px 22px 2px 6px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-field-rest);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    transition:
        border-color 120ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

/* Der Pfeil: ein Winkel aus zwei Kanten in Textfarbe, kein zweites Bild. */
.select__button::after {
    position: absolute;
    top: 50%;
    right: 9px;
    width: 6px;
    height: 6px;
    border-right: 1.5px solid var(--color-text-muted);
    border-bottom: 1.5px solid var(--color-text-muted);
    content: "";
    transform: translateY(-70%) rotate(45deg);
}

.select__button:hover {
    border-color: var(--color-border-strong);
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

.select__button:active {
    background: linear-gradient(var(--color-active-wash), var(--color-active-wash)), var(--color-panel);
}

.select__button:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-field-rest);
}

/* Gekürzt wird über `.einzeilig` (app.vue). */
.select__label {
    min-width: 0;
}

/* Inhaltsbilder werden nie umgefärbt und nie gedimmt (§30.2). */
.select__icon {
    flex: 0 0 auto;
    width: var(--icon-lg);
    height: var(--icon-lg);
    object-fit: contain;
}

/* Lage und Grenzen setzt `useAnchoredPopup`; die Liste rollt selbst, wenn sie länger ist. */
.select__list {
    position: fixed;
    z-index: var(--z-autocomplete);
    box-sizing: border-box;
    overflow-y: auto;
    margin: 0;
    padding: var(--space-2) 0;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    outline: none;
}

.select__option {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-2) var(--space-6);
    cursor: pointer;
    font-size: var(--font-size-body);
    transition: background-color 120ms ease;
}

.select__option.is-active {
    background: var(--color-hover-wash);
}

.select__option.is-selected {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

@media (prefers-reduced-motion: reduce) {
    .select__button,
    .select__option {
        transition: none;
    }
}
</style>
