<script setup lang="ts">
import { computed, useAttrs, useId, useTemplateRef, type StyleValue } from "vue";
import AvmKaestchen from "./avm-kaestchen.vue";
import AvmSperrgrund from "./avm-sperrgrund.vue";
import { mehrfachWahl } from "./avm-mehrfachauswahl";
import { beschriebenVon, sperre, teileAttrs } from "./bedienelement";
import { useMenueBlatt } from "./menue-blatt";

/**
 * Die Mehrfachauswahl (WI-0308, erster Leser die Gefahrenlage im Landschaftseditor; Entwurf
 * https://claude.ai/artifact/3gVFeJnDStVxioYK2KK6Wt, Ansicht „Editor“): ein Feld wie das Auswahlfeld (`avm-auswahl.vue`), das ein Blatt
 * mit Kästchen öffnet. Für jeden Editor gleich, keine Sonderauswahl eines Editors (Abschnitt „Editoren: eine Orchestrierung“).
 *
 * - **Das Feld** in der Fassung des Auswahlfelds: weiße Fläche, Kante, Radius `md`, der Pfeil rechts. Es nennt die gewählten Werte mit
 *   Komma (eine Zeile, `.einzeilig`), ohne Wahl den Text der leeren Wahl; ab zwei Werten steht ihre Zahl rechts. Mit `ton="gefahr"`
 *   stehen die gewählten Werte in der Gefahrfarbe, die Zahl im weichen Gefahrentripel.
 * - **Das Blatt** (`menue-blatt.ts`, wie der Filterknopf): oben die leere Wahl als runder Knopf mit `leerZusatz` rechts („Vorgabe“), sie
 *   leert die Auswahl; nach einem Strich die Werte als Kästchen in der Folge der Optionen. Es bleibt offen, solange man wählt; Esc, ein
 *   Klick daneben und ein Bildlauf schließen es.
 * - **Gesperrt mit Grund** (`gesperrt`): das Feld gedämpft, der Grund daneben wie beim Auswahlfeld.
 * - **Zustände nach Guide §30.5:** Ruhe; Hover kräftigt die Kante; offen und gedrückt die Lasur `active-wash`; Fokus über die Tastatur
 *   goldene Kante und Ring; 120 ms `ease`, bei reduzierter Bewegung ohne. Am Finger 16 px Schrift.
 * - `aria-label` und `id` gehen an das Feld, `class` und `style` an die Hülle. Das Modell ist die Liste der gewählten Werte in der
 *   Folge der Optionen.
 */
defineOptions({ inheritAttrs: false });

interface Option {
    wert: string;
    text: string;
}

const props = defineProps<{
    optionen: readonly Option[];
    /** Der Text der leeren Wahl (oben im Blatt, im Feld ohne Wahl). */
    leer: string;
    /** Der Zusatz rechts an der leeren Wahl, etwa „Vorgabe“. */
    leerZusatz?: string | undefined;
    ton?: "gefahr" | undefined;
    /** Der Satz, warum die Auswahl gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    testid?: string | undefined;
}>();
const wert = defineModel<readonly string[]>({ required: true });

const attrs = useAttrs();
const geteilt = computed(() => teileAttrs(attrs));
const zustand = computed(() => sperre(props.gesperrt));
const grundId = useId();
const blattId = useId();
const gruppe = useId();
const beschreibung = computed(() =>
    beschriebenVon(attrs["aria-describedby"], zustand.value.grund === undefined ? undefined : grundId),
);

/** Der Name der Auswahl, auch für das Blatt. */
const bezeichnung = computed(() => {
    const name = attrs["aria-label"];
    return typeof name === "string" ? name : undefined;
});
const gewaehlt = computed(() => props.optionen.filter((option) => wert.value.includes(option.wert)));
const anzeige = computed(() =>
    gewaehlt.value.length === 0 ? props.leer : gewaehlt.value.map((option) => option.text).join(", "),
);

const feld = useTemplateRef<HTMLButtonElement>("feld");
const blatt = useTemplateRef<HTMLDivElement>("blatt");
function fokus(): void {
    (
        blatt.value?.querySelector<HTMLElement>("input:checked") ?? blatt.value?.querySelector<HTMLElement>("input")
    )?.focus({ preventScroll: true });
}
const { offen, lage, ziel, umschalten, schliessen } = useMenueBlatt(feld, blatt, fokus);

function oeffne(): void {
    if (!zustand.value.gesperrt) umschalten();
}

function onBlattTaste(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    // Esc gehört hier dem Blatt: verbraucht, damit die Tastatur der Seite nicht noch das Fenster schließt.
    event.preventDefault();
    event.stopPropagation();
    schliessen(true);
}

/** Eine Wahl an oder aus; die leere Wahl leert alles (`mehrfachWahl`). */
function setze(option: string | undefined, an: boolean): void {
    if (option === undefined && !an) return;
    wert.value = mehrfachWahl(props.optionen, wert.value, option, an);
}

const kennung = (rest: string): string | undefined =>
    props.testid === undefined ? undefined : `${props.testid}${rest}`;
</script>

<template>
    <span class="mehrfach-huelle" :class="[geteilt.huelle.class]" :style="geteilt.huelle.style as StyleValue">
        <button
            ref="feld"
            v-bind="geteilt.element"
            type="button"
            class="mehrfach"
            :class="{ 'is-offen': offen, 'is-gesperrt': zustand.gesperrt }"
            :disabled="zustand.gesperrt"
            :title="zustand.grund ?? (attrs['title'] as string | undefined)"
            aria-haspopup="true"
            :aria-expanded="offen"
            :aria-controls="offen ? blattId : undefined"
            :aria-describedby="beschreibung"
            :data-testid="props.testid"
            @click="oeffne"
        >
            <span
                class="mehrfach__wert einzeilig"
                :class="{ 'mehrfach__wert--gefahr': props.ton === 'gefahr' && gewaehlt.length > 0 }"
                :data-testid="kennung('-wert')"
                >{{ anzeige }}</span
            >
            <span
                v-if="gewaehlt.length > 1"
                class="mehrfach__zahl avm-versalmitte"
                :class="{ 'mehrfach__zahl--gefahr': props.ton === 'gefahr' }"
                aria-hidden="true"
                >{{ gewaehlt.length }}</span
            >
            <svg class="mehrfach__pfeil" viewBox="0 0 8 6" aria-hidden="true">
                <path
                    d="M1 1.25 4 4.5 7 1.25"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </button>
        <AvmSperrgrund v-if="zustand.grund !== undefined" :id="grundId" :text="zustand.grund" />
        <Teleport :to="ziel">
            <div
                v-if="offen"
                :id="blattId"
                ref="blatt"
                class="mehrfach__blatt"
                role="group"
                :aria-label="bezeichnung"
                :style="{
                    top: `${String(lage.top)}px`,
                    left: `${String(lage.left)}px`,
                    ...(lage.hoehe === undefined ? {} : { maxHeight: `${String(lage.hoehe)}px` }),
                }"
                :data-testid="kennung('-blatt')"
                @keydown="onBlattTaste"
            >
                <AvmKaestchen
                    art="radio"
                    :name="gruppe"
                    :checked="gewaehlt.length === 0"
                    :testid="kennung('-leer')"
                    @change="(an: boolean) => setze(undefined, an)"
                >
                    <span class="mehrfach__option">{{ props.leer }}</span>
                    <span v-if="props.leerZusatz" class="mehrfach__zusatz">{{ props.leerZusatz }}</span>
                </AvmKaestchen>
                <hr class="mehrfach__strich" />
                <AvmKaestchen
                    v-for="option in props.optionen"
                    :key="option.wert"
                    art="checkbox"
                    :checked="wert.includes(option.wert)"
                    :testid="kennung(`-${option.wert}`)"
                    @change="(an: boolean) => setze(option.wert, an)"
                >
                    <span class="mehrfach__option">{{ option.text }}</span>
                </AvmKaestchen>
            </div>
        </Teleport>
    </span>
</template>

<style scoped>
.mehrfach-huelle {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    min-width: 0;
    max-width: 100%;
    vertical-align: middle;
}

.mehrfach {
    display: inline-flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    min-width: 0;
    height: var(--avm-control-h);
    margin: 0;
    padding: 0 var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background-color: var(--color-panel);
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.mehrfach:hover:not(:disabled) {
    border-color: var(--color-border-strong);
}

/* §30.1: Die Lasur liegt ÜBER der Fassung (geschichtet), sie ersetzt sie nicht. */
.mehrfach:active:not(:disabled),
.mehrfach.is-offen {
    border-color: var(--color-border-strong);
    background-image: linear-gradient(var(--color-active-wash), var(--color-active-wash));
}

.mehrfach:focus-visible {
    outline: none;
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.mehrfach:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.mehrfach__wert {
    flex: 1 1 auto;
    min-width: 0;
}

.mehrfach__wert--gefahr {
    color: var(--color-danger);
}

.mehrfach:disabled .mehrfach__wert--gefahr {
    color: inherit;
}

.mehrfach__zahl {
    flex: none;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    line-height: var(--space-16);
}

.mehrfach__zahl--gefahr {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
    color: var(--color-danger-soft-text);
}

.mehrfach__pfeil {
    flex: none;
    width: var(--space-6);
    height: var(--space-4);
    color: var(--color-text-muted);
}

/* Das Blatt wie das des Filterknopfs (Guide §18): eine Spalte, es rollt in sich. */
.mehrfach__blatt {
    position: fixed;
    z-index: var(--z-dialog-high);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    box-sizing: border-box;
    width: min(320px, 100vw - 2 * var(--space-6));
    max-height: min(70vh, 480px);
    padding: var(--space-6) var(--space-10);
    overflow-y: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
}

.mehrfach__option {
    flex: 1 1 auto;
    min-width: 0;
}

.mehrfach__zusatz {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.mehrfach__strich {
    width: 100%;
    margin: var(--space-2) 0;
    border: 0;
    border-top: 1px solid var(--color-divider);
}

@media (pointer: coarse) {
    .mehrfach {
        font-size: var(--font-size-touch);
    }
}

@media (prefers-reduced-motion: reduce) {
    .mehrfach {
        transition: none;
    }
}
</style>
