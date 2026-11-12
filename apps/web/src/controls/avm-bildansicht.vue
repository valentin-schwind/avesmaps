<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { t } from "../i18n/i18n";
import {
    blaettern,
    einpassen,
    stelleNachTaste,
    wischRichtung,
    type AnsichtBild,
    type Masse,
} from "./avm-bildansicht-modell";

/**
 * Die Bildansicht (Betreiber 2026-10-11, wörtlich: „kannst du bei einem klick auf ein bild einer lightbox vollansicht machen (mit < und >
 * wenns mehrere (1,2,3) oder in eine galerie gibt, ESC lässt es wieder verschwinden“; Guide §13.46): ein Bild so groß, wie der Schirm es
 * zulässt, auf fast deckendem Grund. Ein Baustein für jede Stelle, an der man ein Bild anklickt (Kopfbild des Infopanels, Vorschau im
 * Inspector der Medienverwaltung).
 *
 * - Das Modell ist die Stelle in `bilder`: `null` heißt zu. Ein modales `<dialog>` in der obersten Ebene, also auch über einem modalen
 *   Fenster (der Medienverwaltung); der Rest der Seite ist solange träge.
 * - **‹ ›** nur bei mehr als einem Bild, im Kreis; darunter „2 von 7“. ← → blättern, Pos1 und Ende springen, am Finger wischen.
 * - **Esc**, das ✕ und ein Klick auf den Grund (Druck UND Loslassen dort, wie die Hülle) schließen. Esc verbraucht die Taste: Weder das
 *   Fenster darunter noch das Infopanel noch die Auswahl der Karte erfahren davon.
 * - Das Bild wird eingepasst und höchstens verdoppelt (`einpassen`); Titel und, wo verlangt, die Nennung stehen darunter.
 * - Was auf dem Grund liegt, trägt die Farben für Bilder (`media*`, Guide §16.1): runde dunkle Scheiben, weiße Schrift. Zustände nach
 *   §30.5, 120 ms.
 */
const props = defineProps<{
    bilder: readonly AnsichtBild[];
    testid?: string | undefined;
    /**
     * Bild und Zeile als EIN Block (die Reisebilder, WI-0272 S4): Die Zeile ist so breit wie das Bild, linksbündig, ohne eigene Lücke zum Bild. Der benannte Slot `zeile` ersetzt die Standardzeile und
     * bekommt das gezeigte Bild, seine Stelle und die Zahl. Ohne `block` und ohne Slot bleibt alles, wie es war.
     */
    block?: boolean | undefined;
}>();
defineSlots<{
    zeile?: (props: { bild: AnsichtBild; stelle: number; anzahl: number }) => unknown;
    /** Hinter der Nennung, in ihrer Zeile. */
    "nennung-zusatz"?: (props: { bild: AnsichtBild }) => unknown;
}>();
const stelle = defineModel<number | null>({ required: true });

const dialog = useTemplateRef<HTMLDialogElement>("dialog");
const flaeche = useTemplateRef<HTMLDivElement>("flaeche");

const anzahl = computed(() => props.bilder.length);
const hier = computed(() =>
    stelle.value === null || anzahl.value === 0 ? null : Math.min(Math.max(stelle.value, 0), anzahl.value - 1),
);
const aktuell = computed(() => (hier.value === null ? undefined : props.bilder[hier.value]));
const mehrere = computed(() => anzahl.value > 1);

/** Die Maße, die der Browser beim Laden gemessen hat, falls die Folge keine kannte. */
const gemessen = ref<Masse | undefined>();
const platz = ref<Masse>({ breite: 0, hoehe: 0 });
const groesse = computed(() => {
    const bild = aktuell.value;
    const masse =
        bild?.breite !== null && bild?.breite !== undefined && bild.hoehe !== null && bild.hoehe !== undefined
            ? { breite: bild.breite, hoehe: bild.hoehe }
            : gemessen.value;
    return masse === undefined ? undefined : einpassen(masse, platz.value);
});

function schliessen(): void {
    stelle.value = null;
}

function gehe(schritt: 1 | -1): void {
    if (hier.value === null) return;
    const neu = blaettern(hier.value, schritt, anzahl.value);
    if (neu !== null) stelle.value = neu;
}

function taste(event: KeyboardEvent): void {
    if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        schliessen();
        return;
    }
    if (hier.value === null) return;
    const neu = stelleNachTaste(event.key, hier.value, anzahl.value);
    if (neu === null) return;
    event.preventDefault();
    event.stopPropagation();
    stelle.value = neu;
}

/** Druck und Loslassen: auf dem Grund schließt es, eine Wischgeste blättert. */
let druck: { x: number; y: number; aufGrund: boolean } | undefined;
const aufGrund = (ziel: EventTarget | null): boolean =>
    ziel === dialog.value ||
    ziel === flaeche.value ||
    (ziel instanceof Element && ziel.matches(".avm-bildansicht__buehne"));

function gedrueckt(event: PointerEvent): void {
    druck = { x: event.clientX, y: event.clientY, aufGrund: aufGrund(event.target) };
}

function losgelassen(event: PointerEvent): void {
    const start = druck;
    druck = undefined;
    if (start === undefined) return;
    const richtung = wischRichtung(event.clientX - start.x, event.clientY - start.y);
    if (richtung !== 0 && mehrere.value) {
        gehe(richtung);
        return;
    }
    if (start.aufGrund && aufGrund(event.target)) schliessen();
}

function geladen(event: Event): void {
    const bild = event.target as HTMLImageElement;
    if (bild.naturalWidth > 0) gemessen.value = { breite: bild.naturalWidth, hoehe: bild.naturalHeight };
}

/** Die Nachbarn schon laden, damit das Blättern nicht wartet. */
function vorladen(): void {
    if (hier.value === null || !mehrere.value) return;
    for (const schritt of [1, -1]) {
        const nachbar = props.bilder[blaettern(hier.value, schritt, anzahl.value) ?? hier.value];
        if (nachbar !== undefined) new Image().src = nachbar.url;
    }
}

let beobachter: ResizeObserver | undefined;
onMounted(() => {
    beobachter = new ResizeObserver(([eintrag]) => {
        if (eintrag !== undefined) {
            platz.value = { breite: eintrag.contentRect.width, hoehe: eintrag.contentRect.height };
        }
    });
});
onBeforeUnmount(() => {
    beobachter?.disconnect();
    if (dialog.value?.open === true) dialog.value.close();
});

watch(
    aktuell,
    async (bild, vorher) => {
        if (bild?.url !== vorher?.url) gemessen.value = undefined;
        await nextTick();
        const element = dialog.value;
        if (element === null) return;
        if (bild !== undefined && !element.open) {
            element.showModal();
            // Den Fokus hat die Ansicht selbst, nicht der erste Pfeil (die Plattform nähme den ersten Knopf).
            element.focus({ preventScroll: true });
            beobachter?.disconnect();
            if (flaeche.value !== null) beobachter?.observe(flaeche.value);
        } else if (bild === undefined && element.open) {
            element.close();
        }
        vorladen();
    },
    { immediate: true, flush: "post" },
);
</script>

<template>
    <dialog
        ref="dialog"
        class="avm-bildansicht"
        tabindex="-1"
        :aria-label="t('bildansicht.name')"
        :data-testid="testid ?? 'bildansicht'"
        @keydown="taste"
        @cancel.prevent="schliessen"
        @close="schliessen"
        @pointerdown="gedrueckt"
        @pointerup="losgelassen"
    >
        <figure v-if="aktuell !== undefined" class="avm-bildansicht__buehne" :class="{ 'is-block': props.block }">
            <div ref="flaeche" class="avm-bildansicht__flaeche">
                <img
                    :key="aktuell.url"
                    class="avm-bildansicht__bild"
                    :src="aktuell.url"
                    :alt="aktuell.titel ?? ''"
                    :style="
                        groesse === undefined
                            ? undefined
                            : { width: `${String(groesse.breite)}px`, height: `${String(groesse.hoehe)}px` }
                    "
                    draggable="false"
                    data-testid="bildansicht-bild"
                    @load="geladen"
                />
            </div>
            <figcaption
                v-if="$slots.zeile && hier !== null"
                class="avm-bildansicht__zeile avm-bildansicht__zeile--eigen"
                :style="props.block && groesse !== undefined ? { width: `${String(groesse.breite)}px` } : undefined"
                data-testid="bildansicht-zeile"
            >
                <slot name="zeile" :bild="aktuell" :stelle="hier" :anzahl="anzahl" />
            </figcaption>
            <figcaption
                v-else-if="aktuell.titel || aktuell.nennung || mehrere"
                class="avm-bildansicht__zeile"
                data-testid="bildansicht-zeile"
            >
                <span v-if="aktuell.titel" class="avm-bildansicht__titel">{{ aktuell.titel }}</span>
                <span v-if="mehrere && hier !== null" class="avm-bildansicht__stand" data-testid="bildansicht-stand">{{
                    t("bildansicht.stand", { n: hier + 1, von: anzahl })
                }}</span>
                <span v-if="aktuell.nennung" class="avm-bildansicht__nennung"
                    >{{ aktuell.nennung }}<slot name="nennung-zusatz" :bild="aktuell"
                /></span>
            </figcaption>
        </figure>
        <template v-if="aktuell !== undefined">
            <button
                v-if="mehrere"
                type="button"
                class="avm-bildansicht__knopf avm-bildansicht__knopf--vor"
                :aria-label="t('bildansicht.vorher')"
                data-testid="bildansicht-vorher"
                @click="gehe(-1)"
            >
                <svg class="avm-bildansicht__zeichen" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M10.5 3 5.5 8l5 5" />
                </svg>
            </button>
            <button
                v-if="mehrere"
                type="button"
                class="avm-bildansicht__knopf avm-bildansicht__knopf--nach"
                :aria-label="t('bildansicht.weiter')"
                data-testid="bildansicht-weiter"
                @click="gehe(1)"
            >
                <svg class="avm-bildansicht__zeichen" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="M5.5 3l5 5-5 5" />
                </svg>
            </button>
            <button
                type="button"
                class="avm-bildansicht__knopf avm-bildansicht__knopf--zu"
                :aria-label="t('bildansicht.schliessen')"
                :title="t('bildansicht.schliessen')"
                data-testid="bildansicht-schliessen"
                @click="schliessen"
            >
                ✕
            </button>
        </template>
    </dialog>
</template>

<style scoped>
/* Der Grund ist das Fenster selbst: über den ganzen Schirm, fast deckend (`scrimViewer`); ::backdrop bleibt leer. */
.avm-bildansicht {
    position: fixed;
    inset: 0;
    box-sizing: border-box;
    width: 100vw;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: var(--space-16) calc(var(--avm-fenster-bildansicht-pfeil) + var(--space-16));
    border: 0;
    background: var(--color-scrim-viewer);
    color: var(--color-media-text);
    overflow: hidden;
    overscroll-behavior: contain;
    touch-action: pan-y;
}

.avm-bildansicht[open] {
    display: grid;
    animation: avm-bildansicht-auf 120ms ease;
}

/* Den Fokus hat beim Öffnen die Ansicht selbst, nicht der erste Pfeil: kein Ring, bevor jemand Tab drückt. */
.avm-bildansicht:focus {
    outline: none;
}

.avm-bildansicht::backdrop {
    background: transparent;
}

@keyframes avm-bildansicht-auf {
    from {
        opacity: 0;
    }
}

.avm-bildansicht__buehne {
    display: grid;
    grid-template-rows: minmax(0, 1fr) auto;
    gap: var(--space-8);
    min-width: 0;
    min-height: 0;
    margin: 0;
}

.avm-bildansicht__flaeche {
    display: grid;
    place-items: center;
    min-width: 0;
    min-height: 0;
}

/* Bild und Zeile als ein Block (`block`): ohne Lücke, das Bild liegt unten an der Zeile, der Block steht in der Mitte der Bühne. */
.avm-bildansicht__buehne.is-block {
    gap: 0;
}

.avm-bildansicht__buehne.is-block .avm-bildansicht__flaeche {
    align-items: end;
}

.avm-bildansicht__zeile--eigen {
    display: block;
    box-sizing: border-box;
    justify-self: center;
    text-align: left;
}

/* Ohne bekannte Maße die natürliche Größe, begrenzt auf den Platz; sonst setzt `einpassen` Breite und Höhe. */
.avm-bildansicht__bild {
    display: block;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
    user-select: none;
}

.avm-bildansicht__zeile {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-2) var(--space-12);
    font-size: var(--font-size-small);
    text-align: center;
}

.avm-bildansicht__stand {
    font-variant-numeric: tabular-nums;
    opacity: 0.8;
}

.avm-bildansicht__nennung {
    flex-basis: 100%;
    font-size: var(--font-size-caption);
    opacity: 0.8;
}

/* Runde Scheiben auf dem Grund (Guide §16.1: was auf einem Bild liegt, bekommt einen eigenen Grund). */
/* Gezeichnet, damit es in der Mitte des Knopfes sitzt (Zeichen der Schrift tun das nicht). */
.avm-bildansicht__zeichen {
    display: block;
    width: 1em;
    height: 1em;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 2;
}

.avm-bildansicht__knopf {
    position: absolute;
    display: grid;
    place-items: center;
    width: var(--avm-fenster-bildansicht-pfeil);
    height: var(--avm-fenster-bildansicht-pfeil);
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--color-media-nav);
    color: var(--color-media-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-title);
    line-height: 1;
    transition:
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.avm-bildansicht__knopf--vor,
.avm-bildansicht__knopf--nach {
    top: 50%;
    transform: translateY(-50%);
}

.avm-bildansicht__knopf--vor {
    left: var(--space-8);
}

.avm-bildansicht__knopf--nach {
    right: var(--space-8);
}

.avm-bildansicht__knopf--zu {
    top: var(--space-8);
    right: var(--space-8);
    font-size: var(--font-size-body);
}

.avm-bildansicht__knopf:hover,
.avm-bildansicht__knopf:active {
    background: var(--color-media-nav-hover);
}

.avm-bildansicht__knopf:focus-visible {
    outline: none;
    background: var(--color-media-nav-hover);
    box-shadow: var(--focus-ring);
}

/* Am Telefon liegen die Pfeile auf dem Bild statt daneben: Der Platz gehört dem Bild. */
@media (max-width: 767px) {
    .avm-bildansicht {
        padding: calc(var(--avm-fenster-bildansicht-pfeil) + var(--space-8)) var(--space-4) var(--space-16);
    }
}

@media (prefers-reduced-motion: reduce) {
    .avm-bildansicht[open] {
        animation: none;
    }

    .avm-bildansicht__knopf {
        transition: none;
    }
}
</style>
