<script setup lang="ts">
import { useId } from "vue";
import EditorZeichen from "../controls/editor-zeichen.vue";

/**
 * Eine Spalte im Rumpf aus Spalten (WI-0068 P3; Hülle `rumpf="spalten"`, Guide §12.6 „Ein Rumpf aus Spalten“, §13.14 „Die
 * Facettenspalte“, §13.15 „Statusleiste und Spalten“). Kopf mit dem Spaltentitel, eine Unterzeile, eine stehende Leiste und der
 * Inhalt, der allein rollt.
 *
 * - 🔴 **Ein Fenster heißt dunkel, eine Spalte heißt goldbraun** (§13.15): Titel 16 px `--color-accent-strong`, die Unterzeile
 *   11 px gedämpft („84 Treffer · verwendet von Gareth“). Polster 8 / 12 (`--avm-col-pad`).
 * - **Breiten aus dem Kanon:** `facetten` (`fenster.spalten.facetten`, 208, §13.14), `schiene` (`fenster.schiene`, 228, §13.12: eine
 *   Spalte, die eine `FensterSchiene` trägt; der Inhalt ohne eigenen Rand, die Schiene bringt ihn mit, ihr Balken steht an der
 *   Haarlinie) und `inspektor` (`fenster.spalten.inspektor`, 400, so breit wie das Infopanel) stehen fest, `fuellen` nimmt den
 *   Rest. Am Telefon (`telefon`) füllt die Spalte das Fenster; welche dasteht, entscheidet das Fenster (Drill-down, WI-0068 §3.4).
 * - Eine Haarlinie trennt eine Spalte von der nächsten; die letzte hat keine.
 * - Die Leiste (Slot `leiste`) steht wie der Kopf: Filter und Sortierung rollen nicht mit der Liste weg (§12.2, WI-0118).
 * - Slot `zurueck` vor dem Titel (am Telefon „‹ Arten“), Slot `kopf` rechts daneben.
 * - Slot `unter` ersetzt den Text der Unterzeile, wenn sie ein Bedienteil trägt (etwa „· verwendet von Gareth ✕“, Guide §13.45: lösbare
 *   Angaben stehen in der Trefferzeile, nicht in der Leiste).
 * - **✕ rechts im Kopf** (`schliessen`, WI-0241; Betreiber 2026-10-20: „kannst du hier ein X hinmachen, dass das ding zumacht“): Mit
 *   dem Text gesetzt steht ganz rechts ein ✕, das `schliesse` meldet. Die Editoren hängen ihre Liste daran: über der Karte derselbe Weg
 *   wie „«“ an den Eigenschaften (Listen-Schalter, zurück mit „»“), am Telefon auf die Seite „Eigenschaften“ (zurück mit „‹ Liste“).
 */
const props = defineProps<{
    titel: string;
    unterzeile?: string | undefined;
    breite: "facetten" | "schiene" | "fuellen" | "inspektor";
    telefon?: boolean | undefined;
    testid?: string | undefined;
    /**
     * Diese Spalte lässt sich von ihrer linken Kante her einziehen (WI-0128 P1): Ihre Breite ist die Kanonbreite abzüglich
     * `--avm-fenster-einzug`, den die Fensterhülle überblendet. Nur für die erste Spalte eines Rumpfs aus Spalten gedacht.
     */
    einziehbar?: boolean | undefined;
    /** Der Text des ✕ rechts im Kopf (`title`, `aria-label`); ohne ihn kein ✕. */
    schliessen?: string | undefined;
}>();
const emit = defineEmits<{ schliesse: [] }>();
const slots = defineSlots<{
    default(): unknown;
    leiste?(): unknown;
    zurueck?(): unknown;
    kopf?(): unknown;
    unter?(): unknown;
}>();

const titelId = useId();
</script>

<template>
    <section
        class="fenster-spalte"
        :class="[
            `fenster-spalte--${props.telefon ? 'telefon' : props.breite}`,
            { 'fenster-spalte--einziehbar': props.einziehbar === true && props.telefon !== true },
        ]"
        :aria-labelledby="titelId"
        :data-testid="props.testid"
    >
        <header class="fenster-spalte__kopf">
            <slot name="zurueck" />
            <h3 :id="titelId" class="fenster-spalte__titel einzeilig avm-versalmitte">{{ props.titel }}</h3>
            <slot name="kopf" />
            <button
                v-if="props.schliessen"
                type="button"
                class="fenster-spalte__schliessen"
                :aria-label="props.schliessen"
                :title="props.schliessen"
                :data-testid="props.testid && `${props.testid}-schliessen`"
                @click="emit('schliesse')"
            >
                <EditorZeichen name="entfernen" />
            </button>
        </header>
        <p v-if="props.unterzeile || slots.unter" class="fenster-spalte__unter" data-testid="fenster-spalte-unter">
            <slot name="unter">{{ props.unterzeile }}</slot>
        </p>
        <div v-if="slots.leiste" class="fenster-spalte__leiste"><slot name="leiste" /></div>
        <div class="fenster-spalte__inhalt"><slot /></div>
    </section>
</template>

<style scoped>
/* `border-box`: Die Haarlinie gehört zur Spalte, die Kanonbreite ist die ganze Spalte (208, 400). */
.fenster-spalte {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    border-right: 1px solid var(--color-divider);
}

.fenster-spalte:last-child {
    border-right: 0;
}

.fenster-spalte--facetten {
    flex: 0 0 var(--avm-fenster-facetten);
}

.fenster-spalte--schiene {
    flex: 0 0 var(--avm-fenster-schiene);
}

.fenster-spalte--inspektor {
    flex: 0 0 var(--avm-fenster-inspektor);
}

.fenster-spalte--fuellen {
    flex: 1 1 auto;
}

.fenster-spalte--telefon {
    flex: 1 1 auto;
    border-right: 0;
}

/*
 * Eine Spalte, die sich einziehen lässt (WI-0128 P1, Betreiber 2026-10-13): Sie wird von ihrer LINKEN Kante her schmaler, ihr
 * Inhalt behält die Kanonbreite und wird abgeschnitten - gestaucht wanderte die Schrift mit und läse sich verzerrt.
 * 🔴 Die Haarlinie trägt der NACHBAR: Eine eigene Kante klemmte bei Breite 0 auf ein Pixel, und die rechte Spalte rückte genau
 * darum um ein Pixel zur Seite. So misst die eingezogene Spalte wirklich 0, und die Linie steht an derselben Stelle wie vorher.
 */
.fenster-spalte--einziehbar {
    flex: 0 0 max(0px, calc(var(--avm-fenster-inspektor) - var(--avm-fenster-einzug, 0px)));
    overflow: hidden;
    border-right: 0;
}

.fenster-spalte--einziehbar + .fenster-spalte {
    border-left: 1px solid var(--color-divider);
}

.fenster-spalte--einziehbar > * {
    box-sizing: border-box;
    width: var(--avm-fenster-inspektor);
}

.fenster-spalte__kopf {
    display: flex;
    flex: none;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-6) var(--space-10) var(--space-2);
}

/* Das ✕ wie die Pfeilknöpfe « » an den Eigenschaften: ohne Rahmen, gedämpft, beim Überfahren hinterlegt. */
.fenster-spalte__schliessen {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    padding: 0;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.fenster-spalte__schliessen:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.fenster-spalte__schliessen:active {
    background: var(--color-active-wash);
    color: var(--color-text-strong);
}

.fenster-spalte__schliessen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.fenster-spalte__titel {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-subhead);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-tight);
}

/*
 * Der Titel sitzt mit seiner Versalhöhe mittig im Kopf (Guide §3.2; er trägt das Hausrezept `.avm-versalmitte`, WI-0183). Vorher hob ihn der Raum für die
 * Unterlängen (`.einzeilig`, unten 0,3 em Polster ohne den Ausgleich, weil `margin: 0` ihn abräumt) um gut 2 px über die Mitte, und ein
 * Zeichen daneben (« im Ortseditor) stand sichtbar tiefer. Jetzt ist der Kasten auf die Versalhöhe geschnitten, und das Polster gibt ihm
 * GENAU die bisherige Höhe zurück (Zeile plus Unterlängenraum): Kein Kopf wird höher oder niedriger, nur der Text rückt auf die Mitte.
 * Unten bleibt der Unterlängenraum im Polster, damit `overflow: hidden` keine Unterlänge abschneidet. 🪤 Ein Browser ohne
 * Schnitt der Versalhöhe (Firefox) zeigt den Titel mittig in seiner Zeile, und der Kopf wird dort um die Zeile minus Versalhöhe höher.
 */
.fenster-spalte__titel {
    --titel-luft: calc((var(--leading-tight) * 1em + var(--descender-room) - 1cap) / 2);
    padding-top: var(--titel-luft);
    padding-bottom: calc(var(--titel-luft) + var(--descender-room));
    margin-bottom: calc(-1 * var(--descender-room));
}

.fenster-spalte__unter {
    flex: none;
    margin: 0;
    padding: 0 var(--space-10) var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.fenster-spalte__leiste {
    display: flex;
    flex: none;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) var(--space-10) var(--space-6);
    border-bottom: 1px solid var(--color-divider);
}

.fenster-spalte__inhalt {
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    padding: var(--space-6) var(--space-10) var(--space-10);
    scrollbar-width: thin;
}

.fenster-spalte--schiene .fenster-spalte__inhalt {
    padding: 0;
}
</style>
