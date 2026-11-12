<script setup lang="ts">
import { computed, useAttrs, useId, type StyleValue } from "vue";
import AvmSperrgrund from "./avm-sperrgrund.vue";
import { beschriebenVon, sperre, teileAttrs } from "./bedienelement";

/**
 * Das mehrzeilige Textfeld der Fenster (Guide §8 „Eingabefelder“, §30.5; WI-0068 P4b): Prompt, Beleg als Text. Dieselbe Kante,
 * dieselben Zustände und dieselbe Schrift wie `AvmEingabe`, nur mehrzeilig; die Höhe wächst mit `zeilen`, der Mensch kann sie
 * senkrecht ziehen. Mit `waechst` wächst die Höhe zusätzlich mit dem Inhalt (`field-sizing: content`; `zeilen` bleibt das Mindestmaß, wo der
 * Browser es nicht kennt, gilt allein `zeilen` und der Zug).
 *
 * - `id`, `name`, `placeholder`, `aria-*` und Ereignisse gehen an das `<textarea>`, `class` und `style` an die Hülle.
 * - Zustände nach §30.5: Kante `border-strong` beim Überfahren, im Fokus goldbraune Kante samt Fokusring, `ungueltig` mit
 *   `aria-invalid` und der Kante des Gefahrtripels, gesperrt eine eigene Farbfassung samt sichtbarem Satz; 120 ms.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
    zeilen?: number | undefined;
    /** Die Höhe wächst mit dem Inhalt (mindestens `zeilen`). */
    waechst?: boolean | undefined;
    ungueltig?: boolean | undefined;
    gesperrt?: string | undefined;
    /** Die Kennung eines Satzes, der den Grund schon sichtbar nennt (wie bei `AvmKnopf` und `AvmEingabe`): keine eigene Zeile, der Grund als `title`. */
    grundBei?: string | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<string>({ default: "" });

const attrs = useAttrs();
const geteilt = computed(() => teileAttrs(attrs));
const grundId = useId();
const zustand = computed(() => sperre(props.gesperrt));
const beschreibung = computed(() =>
    beschriebenVon(
        attrs["aria-describedby"],
        zustand.value.grund === undefined ? undefined : (props.grundBei ?? grundId),
    ),
);
</script>

<template>
    <span class="textbereich-huelle" :class="[geteilt.huelle.class]" :style="geteilt.huelle.style as StyleValue">
        <textarea
            v-model="wert"
            v-bind="geteilt.element"
            class="textbereich"
            :class="{ 'is-ungueltig': props.ungueltig, 'is-waechst': props.waechst }"
            :style="props.waechst ? { '--textbereich-zeilen': String(props.zeilen ?? 3) } : undefined"
            :rows="props.zeilen ?? 3"
            :disabled="zustand.gesperrt"
            :title="props.grundBei === undefined ? (attrs['title'] as string | undefined) : zustand.grund"
            :aria-invalid="props.ungueltig ? 'true' : undefined"
            :aria-describedby="beschreibung"
            :data-testid="props.testid"
        ></textarea>
        <AvmSperrgrund
            v-if="zustand.grund !== undefined && props.grundBei === undefined"
            :id="grundId"
            :text="zustand.grund"
        />
    </span>
</template>

<style scoped>
.textbereich-huelle {
    display: inline-flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.textbereich {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    min-height: var(--avm-control-h);
    margin: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    outline: none;
    background: var(--color-panel);
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    resize: vertical;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

/* Wächst mit dem Inhalt; `zeilen` bleibt das Mindestmaß (Zeilenhöhe der Schrift, Polster und Kante), denn mit `field-sizing: content` gilt `rows` nicht als Mindestmaß. */
.textbereich.is-waechst {
    min-height: calc(var(--textbereich-zeilen) * 1lh + 2 * var(--space-6) + 2 * 1px);
    field-sizing: content;
}

.textbereich::placeholder {
    color: var(--color-placeholder);
}

.textbereich:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

.textbereich:focus {
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.textbereich.is-ungueltig {
    border-color: var(--color-danger-soft-border);
}

.textbereich.is-ungueltig:focus {
    border-color: var(--color-danger-soft-text);
}

.textbereich:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
    resize: none;
}

@media (pointer: coarse) {
    .textbereich {
        font-size: var(--font-size-touch);
    }
}

@media (prefers-reduced-motion: reduce) {
    .textbereich {
        transition: none;
    }
}
</style>
