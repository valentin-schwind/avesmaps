<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import { linienPfad, LINIE_MINDEST, SYMBOL_RADIUS, type FensterLinie } from "./fenster-linie";
import { reisebilder } from "./reisebilder-zustand";

/**
 * Die Linie von der Kachel zur Stelle auf der Karte (WI-0272 S4, Aufgabe 29): Fährt der Zeiger über eine Kachel der Leiste, führt eine Linie von der Oberkante der Kachelmitte zum Symbol des Bildes. Sie
 * steht nur, solange die Hervorhebung aus einer Kachel kommt (nicht vom Symbol), die Bildansicht zu ist und es kein Telefon ist (dort gibt es keinen Zeiger).
 *
 * - **Eine feste Fläche über der Karte** (`position: fixed`, ohne Klick), über der Leiste und unter den Panels. Saum und Strich wie die Linie des Formulars (`reisebild-besucher.vue`): hell mit dunklem Saum.
 * - **Das Symbol** liefert die Karte (`schirmVon`); ist das Bild unter der Fahne verborgen (der Marker steht nicht), endet die Linie am Punkt des Bildes.
 * - **Folgen:** Solange die Linie steht, wird in jedem Bild nachgemessen (Karte bewegt sich, Leiste scrollt, Fenster ändert sich); steht sie nicht, rechnet nichts.
 */
const { hervor, hervorQuelle, ansicht, leisteOffen } = reisebilder;

const an = computed(
    () =>
        leisteOffen.value &&
        hervor.value !== undefined &&
        hervorQuelle.value === "kachel" &&
        ansicht.value === undefined &&
        !phoneViewport.value,
);

const linie = shallowRef<FensterLinie | undefined>(undefined);
let bild: number | undefined;

function messe(): void {
    const id = hervor.value;
    const kachel = id === undefined ? null : document.querySelector<HTMLElement>(`[data-bild-id="${CSS.escape(id)}"]`);
    const ziel = id === undefined ? undefined : reisebilder.schirmVon(id);
    if (kachel === null || ziel === undefined) {
        setze(undefined);
        return;
    }
    const kasten = kachel.getBoundingClientRect();
    const von = { x: kasten.left + kasten.width / 2, y: kasten.top };
    const laenge = Math.hypot(ziel.x - von.x, ziel.y - von.y);
    if (laenge < LINIE_MINDEST) {
        setze(undefined);
        return;
    }
    // Sie endet am Rand des Symbols, nicht in seiner Mitte.
    const anteil = (laenge - SYMBOL_RADIUS) / laenge;
    setze({ von, bis: { x: von.x + (ziel.x - von.x) * anteil, y: von.y + (ziel.y - von.y) * anteil } });
}

/** Nur setzen, was sich um mehr als einen halben Bildpunkt geändert hat: kein Neuzeichnen im Stillstand. */
function setze(neu: FensterLinie | undefined): void {
    const alt = linie.value;
    if (neu === undefined || alt === undefined) {
        if (neu !== alt) linie.value = neu;
        return;
    }
    const nah = (a: number, b: number): boolean => Math.abs(a - b) < 0.5;
    if (
        nah(alt.von.x, neu.von.x) &&
        nah(alt.von.y, neu.von.y) &&
        nah(alt.bis.x, neu.bis.x) &&
        nah(alt.bis.y, neu.bis.y)
    )
        return;
    linie.value = neu;
}

function takt(): void {
    messe();
    bild = requestAnimationFrame(takt);
}

watch(
    an,
    (jetzt) => {
        if (jetzt && bild === undefined) takt();
        else if (!jetzt) {
            if (bild !== undefined) cancelAnimationFrame(bild);
            bild = undefined;
            linie.value = undefined;
        }
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (bild !== undefined) cancelAnimationFrame(bild);
});

const pfad = computed(() => (linie.value === undefined ? "" : linienPfad(linie.value)));
</script>

<template>
    <svg v-if="linie !== undefined" class="reisebilder-linie" aria-hidden="true" data-testid="reisebilder-linie">
        <g class="reisebilder-linie__saum"><path :d="pfad" /></g>
        <g class="reisebilder-linie__strich"><path :d="pfad" /></g>
        <circle class="reisebilder-linie__anfang" :cx="linie.von.x" :cy="linie.von.y" r="3.5" />
    </svg>
</template>

<style scoped>
/* Wie die Linie des Formulars (`reisebild-besucher.vue`): hell mit dunklem Saum, damit sie auf jedem Gelände steht; über der Leiste, unter den Panels. */
.reisebilder-linie {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-map-panel) - 1);
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
}

.reisebilder-linie__saum path,
.reisebilder-linie__strich path {
    fill: none;
}

.reisebilder-linie__saum path {
    stroke: rgb(0 0 0 / 55%);
    stroke-width: 3.5;
}

.reisebilder-linie__strich path {
    stroke: var(--color-map-paper);
    stroke-width: 1.5;
}

.reisebilder-linie__anfang {
    fill: var(--color-map-paper);
    stroke: rgb(0 0 0 / 60%);
    stroke-width: 1;
}
</style>
