<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";
import InfoSpoiler from "../info-panel/info-spoiler.vue";

/**
 * EINE Zeile des Verzeichnisses (WI-0118): zugeklappt einzeilig - Bild, Name, Zusatz, rechts die Links -, aufgeklappt der VERGRÖSSERTE
 * Eintrag. Beide Fenster (Kartensammlung, Literatur) setzen ihre Zeilen aus diesem Bauteil; was sie unterscheidet, steht in den Slots.
 *
 * 🔴 **Eine Zeile ist offen, die übrigen zu** (Legacy: Akkordeon, „bei 20 Karten wäre die Liste sonst nicht mehr zu überblicken, und
 * der Zweck ist Durchklicken, nicht Stapeln“) - das entscheidet das Fenster, diese Zeile meldet nur `toggle`. Der Kopf ist ein KNOPF
 * (`aria-expanded`), die Links daneben bleiben Links: Sie liegen NICHT im Knopf, ein Anker in einem Knopf wäre ungültig und ein Klick
 * darauf klappte die Zeile mit auf.
 *
 * 🔴 **Aufgeklappt stehen die Links im Eintrag** (`catalog-entry.vue`, bei den Angaben, mit der Aufschrift „Fundstellen“): Neben einem Bild von
 * 400 px und einer Angabenspalte ist für eine dritte Spalte kein Platz. Zugeklappt stehen sie rechts neben dem Namen; die Zeile zeichnet sie nur
 * dann selbst, aufgeklappt gehören sie dem Eintrag.
 *
 * 🔴 **Ein verdeckter Eintrag bleibt zu** (Spoiler-Deckel `info-spoiler.vue`, EIN Mechanismus mit dem Streifen): Der Deckel liegt über der
 * ganzen Zeile, Name und Links sind unsichtbar, aber nicht entfernt - die Zeile behält ihre Höhe.
 *
 * Aufklappen läuft über `grid-template-rows` in 150 ms (Guide §30.4), bei reduzierter Bewegung gar nicht; zugeklappt ist der Eintrag `inert`.
 * Sein Inhalt (das große Bild!) entsteht erst beim ersten Aufklappen: 543 Karten sollen nicht 543 große Bilder laden.
 */
const props = defineProps<{
    open: boolean;
    veiled: boolean;
    veilLabel: string;
    /** Die Kennung des Eintrags, für Tests und das Fenster, das ihn sucht. */
    rowId: string;
}>();
const emit = defineEmits<{ toggle: []; reveal: [] }>();
defineSlots<{
    /** Das kleine Bild der zugeklappten Zeile. Fehlt der Slot, trägt die Zeile kein Bild. */
    bild?(): unknown;
    /** Der Name; `open` sagt, ob die Zeile aufgeklappt ist (dann steht hier der volle Titel). */
    kopf(props: { open: boolean }): unknown;
    /** Der vergrößerte Eintrag, samt seinen Links. */
    detail(): unknown;
    /** Die Links der zugeklappten Zeile, rechts neben dem Namen. */
    links(): unknown;
}>();

const detailId = useId();
const element = useTemplateRef<HTMLElement>("element");
/** Hat die Zeile je offen gestanden? Erst dann entsteht der Inhalt des Eintrags (das große Bild lädt erst jetzt). */
const everOpen = ref(props.open);
let timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Der geöffnete Eintrag rückt ins Bild, sobald er seine Höhe hat (die Bewegung dauert 150 ms). Ein Eintrag, der schon beim Erscheinen
 * der Zeile offen steht - das Fenster ging mit einem Klick auf seine Kachel auf -, ist der Grund des Öffnens und rückt an den Anfang;
 * wer eine Zeile selbst aufklappt, will nur, dass sie ganz zu sehen ist.
 */
function bringIntoView(block: ScrollLogicalPosition): void {
    clearTimeout(timer);
    timer = setTimeout(() => element.value?.scrollIntoView({ block }), 200);
}

watch(
    () => props.open,
    (now) => {
        if (!now) return;
        everOpen.value = true;
        bringIntoView("nearest");
    },
);
onMounted(() => {
    if (props.open) bringIntoView("start");
});
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
    <li
        ref="element"
        class="zeile"
        :class="{ 'is-open': open, 'is-veiled': veiled }"
        :data-id="rowId"
        :data-open="open ? '' : undefined"
        data-testid="catalog-row"
    >
        <button
            type="button"
            class="zeile__kopf"
            :aria-expanded="open"
            :aria-controls="detailId"
            :title="open ? t('catalog.row.close') : t('catalog.row.open')"
            data-testid="catalog-row-toggle"
            @click="emit('toggle')"
        >
            <span v-if="$slots.bild && !open" class="zeile__bild" data-testid="catalog-row-thumb"
                ><slot name="bild"
            /></span>
            <span class="zeile__text"><slot name="kopf" :open="open" /></span>
            <span class="zeile__pfeil avm-versalmitte" aria-hidden="true">{{ open ? "▴" : "▾" }}</span>
        </button>
        <div v-if="!open" class="zeile__links"><slot name="links" /></div>
        <div :id="detailId" class="zeile__detail" :inert="!open" data-testid="catalog-row-detail">
            <div class="zeile__innen">
                <slot v-if="everOpen" name="detail" />
            </div>
        </div>
        <InfoSpoiler v-if="veiled" :label="veilLabel" @reveal="emit('reveal')" />
    </li>
</template>

<style scoped>
.zeile {
    /* Der Deckel reicht über die ganze Zeile (nicht nur über ein Bild). */
    --spoiler-veil-height: 100%;
    /* Beim Heranrollen bleibt ein Streifen Luft über der Zeile, nicht die nackte Kante des Rumpfes. */
    scroll-margin-top: var(--space-6);
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-2) var(--space-10);
    padding: var(--space-4) var(--space-6);
    transition: background-color 120ms ease;
}

.zeile + .zeile {
    border-top: 1px solid var(--color-divider);
}

/* Die Hover-Lasur wird GESCHICHTET, nicht gesetzt (Guide §30.1): Sie ist durchscheinend. */
.zeile:hover:not(.is-open) {
    background: linear-gradient(var(--color-hover-wash), var(--color-hover-wash)), var(--color-panel);
}

/*
 * Der offene Eintrag hebt sich als KARTE aus der Reihe (Guide §13.13: „die Karte hebt den einzelnen Eintrag heraus, die Zeile ordnet die
 * Reihe“): Fläche `panel-soft`, weicher Umriss, mehr Polster. Die Trennlinie über ihm fällt weg - die Karte hat ihren Umriss.
 */
.zeile.is-open {
    margin-block: var(--space-4);
    padding: var(--space-8) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

/* Der Kopf: ein Knopf über die ganze Breite des Namens. */
.zeile__kopf {
    display: flex;
    flex: 1 1 var(--avm-fenster-spalte);
    align-items: center;
    gap: var(--space-8);
    box-sizing: border-box;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.zeile__kopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.zeile__bild {
    display: flex;
    flex: none;
    align-items: center;
    justify-content: center;
}

.zeile__text {
    display: block;
    flex: 1 1 auto;
    min-width: 0;
}

.zeile__pfeil {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    transition: color 120ms ease;
}

.zeile__kopf:hover .zeile__pfeil {
    color: var(--color-link-hover);
}

/* Die Links: zugeklappt rechts neben dem Namen (der Name sagt, wovon sie sind); aufgeklappt zeichnet sie der Eintrag. */
.zeile__links {
    flex: 0 1 var(--avm-fenster-spalte);
    min-width: 0;
}

.zeile__detail {
    display: grid;
    flex: 1 1 100%;
    grid-template-rows: 0fr;
    min-width: 0;
    transition: grid-template-rows 150ms ease;
}

.zeile__innen {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
}

.zeile.is-open > .zeile__detail {
    grid-template-rows: 1fr;
}

/* Verdeckt: der Name und die Links unsichtbar, aber nicht entfernt, das Bild unkenntlich - die Zeile behält ihre Höhe. */
.zeile.is-veiled .zeile__text,
.zeile.is-veiled .zeile__pfeil,
.zeile.is-veiled .zeile__links {
    visibility: hidden;
}

.zeile.is-veiled .zeile__bild {
    filter: blur(var(--avesmaps-infopanel-veil-blur));
    user-select: none;
}

@media (prefers-reduced-motion: reduce) {
    .zeile,
    .zeile__pfeil,
    .zeile__detail {
        transition: none;
    }
}
</style>
