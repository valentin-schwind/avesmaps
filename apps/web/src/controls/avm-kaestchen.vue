<script setup lang="ts">
/**
 * Das goldene Kästchen und der Auswahlknopf (Guide §8, §17.7, §17.11) - EIN Bauteil in zwei Radien,
 * gezeichnet statt nativ. Aus dem Routenplaner gezogen, als „Hinweise“ es als zweiter Leser brauchte
 * (WI-0045 Stufe B, Guide §12.6 „zum Baustein ziehen, nicht abschreiben“).
 *
 * - Die Beschriftung ist der Slot; ein Bild davor gehört mit hinein.
 * - Aus trägt die kräftigere Kante `border-strong` (§17.11): ein Schalter, der aus ist, kein leeres Feld.
 * - Zustände nach §30.5: Hover-Lasur, An in Gold, Fokusring, 120 ms, ohne Bewegung keiner.
 * - **Gesperrt** (`gesperrt`, WI-0127 SYS-10): `disabled`, gedämpft, ohne Hover; der Grund steht als `title` (der Aufrufer nennt ihn
 *   zusätzlich sichtbar, etwa einmal über einer Tafel). Ein leerer Grund sperrt ohne Satz (es läuft gerade).
 * - **Unbestimmt** (`unbestimmt`, WI-0253 §20): das Kästchen „Alle“ über einer Liste von Kästchen, von denen einige gewählt sind: ein Strich statt des Hakens. Es
 *   sagt nur, wie es aussieht; was ein Klick darauf tut, entscheidet der Aufrufer (`checked` bleibt die Wahl).
 */
import { computed } from "vue";
import { sperre } from "./bedienelement";

const props = defineProps<{
    art: "checkbox" | "radio";
    checked: boolean;
    /** Die Gruppe eines Auswahlknopfs. */
    name?: string | undefined;
    /** Was die Wahl bewirkt, beim Überfahren. */
    hinweis?: string | undefined;
    testid?: string | undefined;
    /** Eine Beschriftung über mehrere Zeilen: das Kästchen steht an der ersten, nicht in der Mitte. */
    mehrzeilig?: boolean | undefined;
    /** Der Satz, warum das Kästchen gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    /** Ein Strich statt des Hakens: einige, aber nicht alle der Kästchen, für die dieses steht. */
    unbestimmt?: boolean | undefined;
}>();
const zustand = computed(() => sperre(props.gesperrt));
const emit = defineEmits<{ change: [checked: boolean] }>();

function wechsel(event: Event): void {
    emit("change", (event.target as HTMLInputElement).checked);
}
</script>

<template>
    <label
        class="kaestchen"
        :class="{ 'kaestchen--mehrzeilig': props.mehrzeilig, 'kaestchen--gesperrt': zustand.gesperrt }"
        :title="zustand.grund ?? props.hinweis"
    >
        <input
            class="kaestchen__feld"
            :type="props.art"
            :name="props.name"
            :checked="props.checked"
            :indeterminate="props.unbestimmt === true"
            :disabled="zustand.gesperrt"
            :data-testid="props.testid"
            @change="wechsel"
        />
        <slot />
    </label>
</template>

<style scoped>
.kaestchen {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    cursor: pointer;
}

/* 14 × 14, Legacys Maß (§17.7); der Kanon hat dafür keine Sprosse, und `--space-12` ist ein Abstand. */
.kaestchen__feld {
    position: relative;
    flex: 0 0 auto;
    width: 14px;
    height: 14px;
    margin: 0;
    border: 1px solid var(--color-border-strong);
    background: var(--color-panel);
    cursor: pointer;
    appearance: none;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

/* Mehrzeilig: oben ausgerichtet und um die halbe Differenz zur Zeilenhöhe eingerückt - auf der ersten Zeile mittig. */
.kaestchen--mehrzeilig {
    align-items: flex-start;
}

.kaestchen--mehrzeilig .kaestchen__feld {
    margin-top: calc((1lh - 14px) / 2);
    font: inherit;
}

.kaestchen__feld[type="checkbox"] {
    border-radius: var(--radius-sm);
}

.kaestchen__feld[type="radio"] {
    border-radius: 50%;
}

.kaestchen__feld:hover {
    background: var(--color-hover-wash);
}

.kaestchen__feld:checked {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
}

.kaestchen__feld[type="checkbox"]:checked::after {
    position: absolute;
    top: 45%;
    left: 50%;
    width: 3px;
    height: 6.5px;
    border: solid var(--color-accent-strong);
    border-width: 0 2px 2px 0;
    content: "";
    transform: translate(-50%, -50%) rotate(45deg);
}

.kaestchen__feld[type="checkbox"]:indeterminate {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
}

.kaestchen__feld[type="checkbox"]:indeterminate::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 7px;
    height: 0;
    border-top: 2px solid var(--color-accent-strong);
    content: "";
    transform: translate(-50%, -50%);
}

.kaestchen__feld[type="radio"]:checked::after {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-accent-strong);
    content: "";
    transform: translate(-50%, -50%);
}

.kaestchen--gesperrt {
    color: var(--color-text-muted);
    cursor: default;
}

.kaestchen--gesperrt .kaestchen__feld {
    opacity: 0.5;
    cursor: default;
}

.kaestchen--gesperrt .kaestchen__feld:hover {
    background: var(--color-panel);
}

.kaestchen--gesperrt .kaestchen__feld:checked:hover {
    background: var(--color-active-wash);
}

.kaestchen__feld:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .kaestchen__feld {
        transition: none;
    }
}
</style>
