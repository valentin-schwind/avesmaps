<script setup lang="ts">
import { computed, useAttrs, useId, useTemplateRef, type StyleValue } from "vue";
import AvmSperrgrund from "./avm-sperrgrund.vue";
import { beschriebenVon, sperre, teileAttrs } from "./bedienelement";

/**
 * Der Knopf (Guide §7, §12.3, §13.11, §13.22, §30.5; WI-0120 A8). Bis hierhin war jeder Knopf in seinem Bauteil gestylt;
 * wer jetzt einen braucht, nimmt diesen.
 *
 * - **Drei Arten:** `weich` (Vorgabe, die gefasste Fläche für alles Gewöhnliche), `gefuellt` (🔴 die EINE Hauptaktion je
 *   Fläche) und `gefahr` (Sperren, Zurückziehen, Löschen: die weiche Fläche bleibt, Rand und Schrift färben sich im
 *   `danger-soft`-Tripel - er warnt, er schreit nicht, §13.11; gefüllt rot ist allein Legacys Kontolöschung, §13.21).
 * - **Zwei Größen:** `normal` in Bedienhöhe (32 px, `--avm-control-h`), `zeile` für Knöpfe in einer Tafelzeile
 *   (26 px, Guide §5.1 „Sekundärknopf“; die Abstandsleiter trägt dieselbe Zahl als `--space-24`).
 * - **Zweite Zeile** (`zweite`): der Zustand, auf den der Knopf wirkt („läuft gerade · Hesindiane, 14:03“, §13.12) - auf
 *   dem gefüllten Knopf in `--color-on-button-muted`.
 * - **Gesperrt mit Grund** (`gesperrt`): `disabled`, der Satz steht SICHTBAR daneben (`AvmSperrgrund`), dazu als `title`
 *   und über `aria-describedby`. Ohne Satz gibt es keine Sperre (§7: „Ein ausgegrauter Knopf ohne Grund ist eine
 *   Sackgasse“). Nennt ein Satz darüber den Grund für eine ganze Gruppe (`grundBei`), entfällt die eigene Zeile.
 * - **Zustände nach §30.5:** Ruhe aus den Tokens; Hover färbt die Fläche, die Kante wird `border-strong`, und der Knopf
 *   hebt sich um einen Pixel mit `--shadow-button-hover` (gefüllt: `-strong`, §13.22); gedrückt dunkler und ohne Hub;
 *   Fokus nur über die Tastatur (`:focus-visible`), der Ring KOMPONIERT mit dem eigenen Schatten; gesperrt eine eigene
 *   Farbfassung ohne Schatten (nie Deckkraft, §30.2); alles in 120 ms `ease`, bei reduzierter Bewegung ohne Übergang und
 *   ohne Hub.
 * - Die Aufschrift sitzt mit ihrer Versalhöhe mittig (`.avm-versalmitte`, Guide §3.2).
 * - **Ein Zeichen davor** (Slot `zeichen`, etwa das Discord-Symbol): Zeichen und Aufschrift stehen in einer Reihe, die Aufschrift
 *   behält ihre Versalmitte, das Zeichen sitzt auf derselben Mitte. Es ist Schmuck (`aria-hidden`), der Name bleibt die Aufschrift.
 * - **Ein Umschalter** (`gedrueckt`, etwa „Auswahl isolieren“ in der Leiste „Ecken bearbeiten“, WI-0178): gesetzt trägt der Knopf
 *   `aria-pressed`; an bleibt er unten (§30.5 „Aktiv/gedrückt“: die Fläche des Drückens, Innenschatten, kein Hub), auch beim
 *   Überfahren. Er bleibt weich: Gefüllt ist die EINE Hauptaktion daneben.
 *
 * 🪤 Die Hülle hält Knopf und Satz zusammen. `class` und `style` des Aufrufers gehen an sie (Breite, Lage), alles andere an
 * den Knopf (`teileAttrs`); sein `aria-describedby` wird mit dem eigenen verbunden, nicht überschrieben. Weil die Wurzel
 * kein `<button>` ist, färbt die Fußleiste der Fensterhülle (`:slotted(button)`) diesen Knopf nicht um.
 */
defineOptions({ inheritAttrs: false });

const props = defineProps<{
    art?: "weich" | "gefuellt" | "gefahr" | undefined;
    groesse?: "normal" | "zeile" | undefined;
    /** Der Satz, warum der Knopf gerade nicht geht; gesetzt heißt gesperrt. */
    gesperrt?: string | undefined;
    /**
     * Die Kennung eines Satzes, der den Grund schon sichtbar nennt, etwa EIN `AvmSperrgrund` über einer Gruppe aus demselben Grund
     * gesperrter Knöpfe (WI-0232: fünf gleiche Zeilen untereinander). Der Knopf steht dann ohne eigene Zeile, mit dem Grund als
     * `title` und `aria-describedby` auf jenen Satz.
     */
    grundBei?: string | undefined;
    /** Die zweite Zeile: der Zustand, auf den der Knopf wirkt. */
    zweite?: string | undefined;
    /** `submit` nur im Formular; sonst ein gewöhnlicher Knopf. */
    typ?: "button" | "submit" | undefined;
    /** Über die ganze Breite des Elternteils, etwa der Hauptknopf eines schmalen Fensters; der Satz steht dann darunter. */
    breit?: boolean | undefined;
    /** Ein Umschalter: gesetzt heißt `aria-pressed`, `true` heißt an. */
    gedrueckt?: boolean | undefined;
    testid?: string | undefined;
}>();

const attrs = useAttrs();
const geteilt = computed(() => teileAttrs(attrs));
const knopf = useTemplateRef<HTMLButtonElement>("knopf");
const grundId = useId();
const zustand = computed(() => sperre(props.gesperrt));
/**
 * Ein `disabled` des Aufrufers (etwa „beschäftigt“) sperrt auch. 🪤 Bis 2026-10-19 überschrieb die eigene Bindung es still: Die Freigabe nach
 * Production und die Knöpfe der Neuigkeiten sahen bedienbar aus, obwohl sie es nicht waren (Fund des Betreibers). Einen Grund trägt nur `gesperrt`; deshalb hält `test/knopf-sperre.test.ts`
 * `disabled` an den Knöpfen des Hauses fern, und dies bleibt das Netz für alles, was es doch durchreicht.
 */
const aussenGesperrt = computed(() => attrs["disabled"] === true || attrs["disabled"] === "");
const beschreibung = computed(() =>
    beschriebenVon(
        attrs["aria-describedby"],
        zustand.value.grund === undefined ? undefined : (props.grundBei ?? grundId),
    ),
);

defineExpose({
    /** Den Fokus auf den Knopf, etwa wenn eine Bestätigung erscheint. */
    focus: (): void => knopf.value?.focus(),
});
</script>

<template>
    <span
        class="knopf-huelle"
        :class="[geteilt.huelle.class, { 'knopf-huelle--breit': props.breit }]"
        :style="geteilt.huelle.style as StyleValue"
    >
        <button
            ref="knopf"
            v-bind="geteilt.element"
            :type="props.typ ?? 'button'"
            class="knopf"
            :class="[
                `knopf--${props.art ?? 'weich'}`,
                `knopf--${props.groesse ?? 'normal'}`,
                { 'knopf--zweizeilig': props.zweite, 'knopf--gedrueckt': props.gedrueckt === true },
            ]"
            :aria-pressed="props.gedrueckt"
            :disabled="zustand.gesperrt || aussenGesperrt"
            :title="zustand.grund ?? (attrs['title'] as string | undefined)"
            :aria-describedby="beschreibung"
            :data-testid="props.testid"
        >
            <span v-if="$slots.zeichen" class="knopf__reihe">
                <span class="knopf__zeichen" aria-hidden="true"><slot name="zeichen" /></span>
                <span class="knopf__text avm-versalmitte"><slot /></span>
            </span>
            <span v-else class="knopf__text avm-versalmitte"><slot /></span>
            <span v-if="props.zweite" class="knopf__zweite avm-versalmitte">{{ props.zweite }}</span>
        </button>
        <AvmSperrgrund
            v-if="zustand.grund !== undefined && props.grundBei === undefined"
            :id="grundId"
            :text="zustand.grund"
        />
    </span>
</template>

<style scoped>
.knopf-huelle {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-4);
    max-width: 100%;
    vertical-align: middle;
}

.knopf-huelle--breit {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    width: 100%;
}

.knopf {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: var(--avm-control-h);
    padding: 0 var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: var(--leading-tight);
    white-space: nowrap;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease,
        transform 120ms ease;
}

/* Die zweite Zeile braucht Luft über und unter sich; eine Zeile allein sitzt über die Mindesthöhe mittig. */
.knopf--zweizeilig {
    padding-block: var(--space-4);
}

.knopf--zeile {
    min-height: var(--space-24);
    padding-inline: var(--space-6);
    font-size: var(--font-size-small);
}

/* Ein Zeichen vor der Aufschrift: in einer Reihe, auf der Mitte der Versalhöhe. */
.knopf__reihe {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
}

.knopf__zeichen {
    display: inline-flex;
    flex: none;
}

.knopf__zweite {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* §13.22: Ein Knopf mit Fläche vertieft sie beim Überfahren und hebt sich um einen Pixel. */
.knopf:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
    box-shadow: var(--shadow-button-hover);
    transform: translateY(-1px);
}

/* Gedrückt heißt dunkler, nicht bewegt (§13.22 „Aktiv“). */
.knopf:active:not(:disabled) {
    background: var(--color-button-soft-active);
    box-shadow: none;
    transform: none;
}

/* §30.3: Der Ring kommt zum eigenen Schatten hinzu, er ersetzt ihn nicht. */
.knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.knopf:hover:focus-visible:not(:disabled) {
    box-shadow: var(--focus-ring), var(--shadow-button-hover);
}

/* Ein Umschalter, der an ist (§30.5 „Aktiv/gedrückt“): unten, mit Innenschatten; das Überfahren hebt ihn nicht. */
.knopf--gedrueckt,
.knopf--gedrueckt:hover:not(:disabled),
.knopf--gedrueckt:active:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-active);
    box-shadow: inset var(--shadow-field-rest);
    color: var(--color-text-strong);
    transform: none;
}

.knopf--gedrueckt:focus-visible,
.knopf--gedrueckt:hover:focus-visible:not(:disabled) {
    box-shadow:
        var(--focus-ring),
        inset var(--shadow-field-rest);
}

/* Gefüllt: die eine Hauptaktion. */
.knopf--gefuellt {
    border-color: var(--color-button-border);
    background: var(--color-button);
    color: var(--color-button-text);
}

.knopf--gefuellt .knopf__zweite {
    color: var(--color-on-button-muted);
}

.knopf--gefuellt:hover:not(:disabled) {
    border-color: var(--color-button-border);
    background: var(--color-button-hover);
    box-shadow: var(--shadow-button-hover-strong);
}

.knopf--gefuellt:active:not(:disabled) {
    background: var(--color-button-active);
}

.knopf--gefuellt:hover:focus-visible:not(:disabled) {
    box-shadow: var(--focus-ring), var(--shadow-button-hover-strong);
}

/* Gefahr: Fläche bleibt, Rand und Schrift wandern als Satz (§13.11); beim Überfahren die weiche Gefahrfläche (Legacy lore.css). */
.knopf--gefahr {
    border-color: var(--color-danger-soft-border);
    color: var(--color-danger-soft-text);
}

.knopf--gefahr .knopf__zweite {
    color: inherit;
}

.knopf--gefahr:hover:not(:disabled),
.knopf--gefahr:active:not(:disabled) {
    border-color: var(--color-danger-soft-border);
    background: var(--color-danger-soft);
}

/* Gesperrt: eine eigene Farbfassung, kein Schatten, kein Hub, nie Deckkraft (§30.2). */
.knopf:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    box-shadow: none;
    color: var(--color-disabled-text);
    cursor: not-allowed;
    transform: none;
}

.knopf:disabled .knopf__zweite {
    color: inherit;
}

@media (prefers-reduced-motion: reduce) {
    .knopf {
        transition: none;
    }

    .knopf:hover:not(:disabled) {
        transform: none;
    }
}
</style>
