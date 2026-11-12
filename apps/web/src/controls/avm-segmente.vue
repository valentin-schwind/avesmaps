<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useSlots, useTemplateRef, watch } from "vue";
/**
 * Der Segmentschalter im Panel (Guide §13.25, §9): Er wählt, *was gilt* - deshalb ist das aktive
 * Segment gefüllt, nicht unterstrichen. Die Segmente liegen in einer **Mulde** (Fläche `panel-soft`,
 * 1 px Kante, Polster und Abstand 4), gleich breit über die ganze Zeile. Erster Leser: „Land & Wasser |
 * Flug“ im Rahmenkasten Transportmittel (WI-0050).
 *
 * - Knöpfe mit `aria-pressed` in einer Gruppe, wie DE | EN und die Kamera-Pille: Tab erreicht jedes
 *   Segment, Enter und Leertaste wählen.
 * - Zustände nach §30.5: ruhend nur Schrift, Hover-Lasur, gedrückt die Aktiv-Lasur, Fokusring, 120 ms.
 *   Das gewählte Segment antwortet nicht mehr auf Hover - es gibt nichts zu wählen.
 * - Keine Fettung (§3): Die Wahl sagt die Füllung.
 * - **Gesperrt** (WI-0127 SYS-5, Blatt WI-0119 A1 „Wartung“): ein Segment, das man nicht wählen kann, steht in der eigenen
 *   Farbfassung der Sperre, nie mit Deckkraft (§30.2), und antwortet auf nichts. Der Satz, warum, steht SICHTBAR daneben
 *   (`AvmSperrgrund`, Guide §7); `beschrieben` verweist mit `aria-describedby` auf ihn. Ein gewähltes Segment bleibt gefüllt,
 *   auch wenn es gesperrt ist: Was gilt, verschwindet nicht, nur weil man es gerade nicht ändern kann.
 * - **Gestapelt** (Blatt A4, Telefon): passt das längste Wort nicht in seinen Teil der Zeile, stehen die Segmente
 *   untereinander; die Mulde bleibt. `gestapelt="auto"` misst das selbst, für Wörter, die erst die Daten bringen (die Wortform einer Rolle in neun
 *   Sprachen, WI-0279): gestapelt, sobald das längste Wort nicht in seinen Teil der Zeile passt, sonst nebeneinander.
 * - **Zeichen statt Wort** (WI-0068 P4b, Betreiber 2026-10-10: „versuch so viel in icons zu packen wie möglich“): Der Slot `zeichen`
 *   zeichnet das Segment; das Wort (`label`) wird dann sein Name für Vorleser und der Hinweis beim Überfahren. Die Segmente sind dann
 *   so breit wie ihr Zeichen, nicht über die ganze Zeile.
 * - **Eng** (WI-0275, Unterreiter der Community): weniger Polster; reicht die Zeile trotzdem nicht, bricht die Mulde um, und jede Zeile füllt die Breite.
 */
const props = defineProps<{
    options: readonly {
        value: string;
        label: string;
        hinweis?: string;
        /** Nicht wählbar; der Satz dazu steht neben dem Schalter. */
        gesperrt?: boolean | undefined;
        /** Die Kennung des Satzes, der das Segment erklärt (`aria-describedby`). */
        beschrieben?: string | undefined;
    }[];
    /** Name der Gruppe für Vorleser. */
    label: string;
    testid: string;
    /** Untereinander statt nebeneinander (Telefon, wenn das längste Wort nicht passt); `auto` misst das. */
    gestapelt?: boolean | "auto" | undefined;
    /** Weniger Polster, und zu viele brechen um, statt die Mulde zu sprengen. */
    eng?: boolean | undefined;
}>();
const model = defineModel<string>({ required: true });
const slots = useSlots();

function choose(value: string): void {
    if (model.value !== value) model.value = value;
}

const wurzel = useTemplateRef<HTMLDivElement>("wurzel");
const zuEng = ref(false);
const gestapelt = computed(() => (props.gestapelt === "auto" ? zuEng.value : props.gestapelt === true));

/** Passt das längste Wort in seinen Teil der Zeile? Die Breite des Worts misst ein Range, denn sie hängt nicht davon ab, wie die Segmente gerade stehen. */
function miss(): void {
    const huelle = wurzel.value;
    if (huelle === null || props.gestapelt !== "auto") return;
    const woerter = [...huelle.querySelectorAll<HTMLElement>(".segmente__segment > .einzeilig")];
    const erstes = woerter[0]?.parentElement;
    if (erstes === null || erstes === undefined) return;
    const stil = getComputedStyle(huelle);
    const innen = huelle.clientWidth - parseFloat(stil.paddingLeft) - parseFloat(stil.paddingRight);
    const teil = (innen - parseFloat(stil.columnGap) * (woerter.length - 1)) / woerter.length;
    const segment = getComputedStyle(erstes);
    const rand = parseFloat(segment.paddingLeft) + parseFloat(segment.paddingRight);
    const bereich = document.createRange();
    const laengstes = Math.max(
        ...woerter.map((wort) => {
            bereich.selectNodeContents(wort);
            return bereich.getBoundingClientRect().width;
        }),
    );
    zuEng.value = laengstes + rand > teil;
}

let beobachter: ResizeObserver | undefined;
onMounted(() => {
    if (props.gestapelt !== "auto" || wurzel.value === null) return;
    beobachter = new ResizeObserver(miss);
    beobachter.observe(wurzel.value);
    miss();
    // Die Hausschrift kommt nach: Erst mit ihr stimmt die Breite der Wörter.
    void document.fonts.ready.then(miss);
});
watch(
    () => props.options.map((option) => option.label).join("\n"),
    () => void nextTick(miss),
);
onBeforeUnmount(() => beobachter?.disconnect());
</script>

<template>
    <div
        ref="wurzel"
        class="segmente"
        :class="{
            'segmente--gestapelt': gestapelt,
            'segmente--zeichen': slots['zeichen'] !== undefined,
            'segmente--eng': props.eng === true,
        }"
        role="group"
        :aria-label="props.label"
        :data-testid="props.testid"
    >
        <button
            v-for="option in props.options"
            :key="option.value"
            type="button"
            class="segmente__segment"
            :class="{ 'is-active': model === option.value }"
            :aria-pressed="model === option.value"
            :disabled="option.gesperrt === true"
            :aria-describedby="option.beschrieben"
            :aria-label="slots['zeichen'] !== undefined ? option.label : undefined"
            :title="option.hinweis ?? (slots['zeichen'] !== undefined ? option.label : undefined)"
            :data-testid="`${props.testid}-${option.value}`"
            @click="choose(option.value)"
        >
            <slot name="zeichen" :option="option"
                ><span class="einzeilig">{{ option.label }}</span></slot
            >
        </button>
    </div>
</template>

<style scoped>
.segmente {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
    gap: var(--space-2);
    padding: var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

/* Zeichen statt Wort: so breit wie das Zeichen, das Zeichen mittig. */
.segmente--zeichen {
    grid-auto-columns: auto;
}

.segmente--zeichen .segmente__segment {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-4);
}

.segmente--eng {
    display: flex;
    flex-wrap: wrap;
}

.segmente--eng .segmente__segment {
    flex: 1 1 auto;
    padding: 0 var(--space-2);
}

/* Am Telefon passt „Eingeschränkt“ nicht in ein Drittel: die Segmente stehen untereinander, die Mulde bleibt (Blatt A4). */
.segmente--gestapelt {
    grid-auto-flow: row;
}

/* Zusammen mit Mulde und Kante so hoch wie ein Bedienelement des Planers (32 px, §17.7). */
.segmente__segment {
    min-width: 0;
    height: calc(var(--avm-control-h) - 2 * var(--space-2) - 2px);
    padding: 0 var(--space-6);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

/* Wird es eng, kürzt das Wort mit „…“ statt die Mulde zu sprengen (`.einzeilig` braucht einen Block). */
.segmente__segment > .einzeilig {
    display: block;
}

.segmente__segment:not(.is-active):not(:disabled):hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.segmente__segment:not(.is-active):not(:disabled):active {
    background: var(--color-active-wash);
}

/* Gesperrt: die eigene Farbfassung (§30.2), kein Zeiger, keine Lasur. Steht VOR `.is-active`, damit Gewähltes gefüllt bleibt. */
.segmente__segment:disabled {
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: default;
}

.segmente__segment.is-active {
    background: var(--color-button);
    color: var(--color-button-text);
    cursor: default;
}

.segmente__segment:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .segmente__segment {
        transition: none;
    }
}
</style>
