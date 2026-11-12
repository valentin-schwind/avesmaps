<script setup lang="ts">
import { computed, useAttrs, useId, type StyleValue } from "vue";
import AvmSperrgrund from "./avm-sperrgrund.vue";
import { beschriebenVon, sperre, teileAttrs } from "./bedienelement";

/**
 * Das Auswahlfeld (Guide §8 „Auswahlfeld“, §30.5; WI-0120 A8), als NATIVES `<select>`.
 *
 * 🔴 Nativ, weil es im modalen Fenster aufgehen muss: `AvmFenster` legt sein `<dialog>` mit `showModal()` in die oberste
 * Ebene und macht den Rest der Seite träge. Eine selbstgebaute Liste, die sich nach `body` verlegt (wie die der
 * Transportmittel im Planer), läge darunter und wäre nicht zu bedienen (Discovery Frontend, Risiko R5). Die Liste eines
 * `<select>` öffnet der Browser über allem, mit Tastatur, Vorleser und Telefonrad.
 *
 * - Weißes Feld, Kante, Radius `md`, der Pfeil rechts gezeichnet in der gedämpften Schriftfarbe (8 × 6, Legacys Maß).
 * - Zwei Größen wie der Knopf: `normal` in Bedienhöhe, `zeile` (26 px) für die Rolle in einer Tafelzeile.
 * - Gesperrt mit Grund (`gesperrt`), sichtbar daneben wie beim Knopf (Mockup: „eigenes Konto: hier nicht änderbar“).
 * - Schrift 13 px; am Finger 16 px (`--font-size-touch`). 🪤 Legacy lässt seine Dropdowns am Finger bei 13 px, aber das
 *   sind selbstgebaute Listen; in ein natives `<select>` unter 16 px zoomt Safari beim Antippen hinein wie in ein Feld.
 * - `id`, `name`, `aria-label` und Ereignisse gehen an das `<select>`, `class` und `style` an die Hülle.
 * - **Gruppen** (`gruppe` an der Option, WI-0271 L4: die Landmarkenarten nach Erhebung, Hohlform, Wasser …): aufeinanderfolgende Optionen derselben
 *   Gruppe stehen in einem `<optgroup>`; ohne `gruppe` wie bisher.
 */
defineOptions({ inheritAttrs: false });

interface AuswahlOption {
    wert: string;
    text: string;
    /** Eine einzelne Wahl, die hier nicht geht (etwa eine Rolle über der eigenen Stufe). */
    gesperrt?: boolean | undefined;
    /** Der Name der Gruppe, in der die Option steht (`<optgroup>`). */
    gruppe?: string | undefined;
}

const props = defineProps<{
    optionen: readonly AuswahlOption[];
    groesse?: "normal" | "zeile" | undefined;
    /** Der Satz, warum die Auswahl gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<string>({ required: true });

const attrs = useAttrs();
const geteilt = computed(() => teileAttrs(attrs));
/** Die Optionen in Gruppen: je Lauf derselben `gruppe` eine; ohne Gruppen ein Lauf ohne Namen. */
const gruppen = computed(() => {
    const laeufe: { name: string | undefined; optionen: AuswahlOption[] }[] = [];
    for (const option of props.optionen) {
        const letzter = laeufe.at(-1);
        if (letzter !== undefined && letzter.name === option.gruppe) letzter.optionen.push(option);
        else laeufe.push({ name: option.gruppe, optionen: [option] });
    }
    return laeufe;
});
const grundId = useId();
const zustand = computed(() => sperre(props.gesperrt));
const beschreibung = computed(() =>
    beschriebenVon(attrs["aria-describedby"], zustand.value.grund === undefined ? undefined : grundId),
);
</script>

<template>
    <span class="auswahl-huelle" :class="[geteilt.huelle.class]" :style="geteilt.huelle.style as StyleValue">
        <span
            class="auswahl"
            :class="[`auswahl--${props.groesse ?? 'normal'}`, { 'is-gesperrt': zustand.gesperrt }]"
            :data-testid="props.testid"
        >
            <select
                v-model="wert"
                v-bind="geteilt.element"
                class="auswahl__feld"
                :disabled="zustand.gesperrt"
                :title="zustand.grund ?? (attrs['title'] as string | undefined)"
                :aria-describedby="beschreibung"
            >
                <template v-for="(lauf, i) in gruppen" :key="lauf.name ?? `ohne-${i}`">
                    <optgroup v-if="lauf.name !== undefined" :label="lauf.name">
                        <option
                            v-for="option in lauf.optionen"
                            :key="option.wert"
                            :value="option.wert"
                            :disabled="option.gesperrt"
                        >
                            {{ option.text }}
                        </option>
                    </optgroup>
                    <template v-else>
                        <option
                            v-for="option in lauf.optionen"
                            :key="option.wert"
                            :value="option.wert"
                            :disabled="option.gesperrt"
                        >
                            {{ option.text }}
                        </option>
                    </template>
                </template>
            </select>
            <svg class="auswahl__pfeil" viewBox="0 0 8 6" aria-hidden="true">
                <path
                    d="M1 1.25 4 4.5 7 1.25"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </span>
        <AvmSperrgrund v-if="zustand.grund !== undefined" :id="grundId" :text="zustand.grund" />
    </span>
</template>

<style scoped>
.auswahl-huelle {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    min-width: 0;
    max-width: 100%;
    vertical-align: middle;
}

.auswahl {
    position: relative;
    display: inline-flex;
    flex: 1 1 auto;
    min-width: 0;
    color: var(--color-text-muted);
}

.auswahl__feld {
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: var(--avm-control-h);
    margin: 0;
    padding: 0 calc(var(--space-8) * 2 + var(--space-6)) 0 var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    appearance: none;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.auswahl--zeile .auswahl__feld {
    height: var(--space-24);
    padding-left: var(--space-6);
    font-size: var(--font-size-small);
}

.auswahl__feld:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

.auswahl__feld:active:not(:disabled) {
    background: var(--color-panel-soft);
}

.auswahl__feld:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.auswahl__feld:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

/* Der Pfeil gehört zum Feld, nicht zur Liste: Er fängt keinen Klick, das Feld darunter nimmt ihn. */
.auswahl__pfeil {
    position: absolute;
    top: 50%;
    right: var(--space-8);
    width: var(--space-6);
    height: var(--space-4);
    pointer-events: none;
    transform: translateY(-50%);
}

.auswahl.is-gesperrt {
    color: var(--color-disabled-text);
}

@media (pointer: coarse) {
    .auswahl__feld {
        font-size: var(--font-size-touch);
    }
}

@media (prefers-reduced-motion: reduce) {
    .auswahl__feld {
        transition: none;
    }
}
</style>
