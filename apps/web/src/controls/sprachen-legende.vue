<script setup lang="ts">
import { computed, ref } from "vue";
import AvmDisclosure from "./avm-disclosure.vue";
import { formatNumber, t } from "../i18n/i18n";
import type { SprachLegendenZeile } from "../map/sprachen-stand";

/**
 * Die Legende der Ebene „Sprachen“ (WI-0261 S5a; Bauvorlage: der Kasten „Sprachen“ der Probierseite 2026-10-30, `app.js`
 * `renderLegende`): je Sprache ein Farbpunkt und der Name der Legende, in der Reihenfolge der Legende (`GET /api/sprachen`), am
 * Ende das Schraffurmuster mit dem Satz zu den Mischgebieten.
 *
 * Gebaut wie die Legende der Höhenstufen (`height-legend.vue`): derselbe Rahmen, dieselbe Schrift, derselbe Platz im Eckbund über
 * dem Fächer. Einklappbar wie in der Vorlage, mit der Klappbox des Hauses (`AvmDisclosure`, Guide §16.3: Ruhe, Hover, gedrückt,
 * Fokus und Übergang bringt sie mit, §30.5); zugeklappt nennt sie die Zahl der Sprachen. Am Telefon beginnt sie zugeklappt.
 *
 * Seit S5b (WI-0261) ist jede Zeile ein Knopf (Vorlage `legende-sprache`): Ein Klick öffnet die Infobox der Sprache (die Kamera fliegt auf ihre Hauptteile),
 * Zeigen hebt sie auf der Karte hervor wie der Zeiger über der Fläche (`zeige`, nur mit der Maus wie in der Vorlage; am Finger gäbe es kein Ende des Zeigens).
 * Die Zustände nach Guide §30.5: Ruhe ohne Fläche, Hover mit der goldenen Lasur, gedrückt mit der stärkeren, Fokus mit dem Ring, die gewählte Sprache
 * markiert (`aria-pressed`) in der Schrift der Auswahl; 120 ms. Gesperrt ist eine Zeile nie.
 *
 * Die Farben sind die der Karte und haben deshalb keinen Dunkelwert (Guide §23.1, wie die Höhenstufen); das Muster zeigt die
 * Streifen wie die Karte (45°, `/`), an den ersten beiden Sprachen.
 */
const props = defineProps<{
    sprachen: readonly SprachLegendenZeile[];
    /** Am Telefon beginnt die Legende zugeklappt. */
    zugeklappt?: boolean;
    /** Der Schlüssel der gewählten Sprache (ihre Infobox ist offen). */
    gewaehlt?: string | undefined;
}>();
const emit = defineEmits<{
    /** Eine Zeile wurde gewählt: ihre Infobox öffnen. */
    waehle: [sprache: SprachLegendenZeile];
    /** Die Maus zeigt auf eine Zeile (`undefined`: auf keine mehr). */
    zeige: [schluessel: string | undefined];
}>();

const offen = ref(props.zugeklappt !== true);
const anzahl = computed(() => formatNumber(props.sprachen.length, 0));
/** Das Muster der Mischgebiete braucht zwei Sprachen; mit einer gibt es keine. */
const muster = computed(() => {
    const [a, b] = props.sprachen;
    return a && b ? { "--sprache-a": a.farbe, "--sprache-b": b.farbe } : undefined;
});

/** Nur die Maus zeigt (Vorlage: `pointerType === "mouse"`); ein Finger hinterließe eine Hervorhebung ohne Ende. */
function zeige(event: PointerEvent, schluessel: string | undefined): void {
    if (event.pointerType === "mouse") emit("zeige", schluessel);
}
</script>

<template>
    <section class="sprachen-legende" :aria-label="t('legend.sprachen')" data-testid="sprachen-legende">
        <AvmDisclosure
            v-model:open="offen"
            :label="t('legend.sprachen')"
            :secondary="anzahl"
            summary-one-line
            toggle-testid="sprachen-legende-kopf"
        >
            <ul class="sprachen-legende__liste">
                <li v-for="sprache in sprachen" :key="sprache.schluessel">
                    <button
                        type="button"
                        class="sprachen-legende__zeile sprachen-legende__knopf"
                        :aria-pressed="sprache.schluessel === gewaehlt"
                        :title="t('legend.sprachen.oeffnen', { name: sprache.name })"
                        data-testid="sprachen-legende-zeile"
                        :data-sprache="sprache.schluessel"
                        @click="emit('waehle', sprache)"
                        @pointerenter="zeige($event, sprache.schluessel)"
                        @pointerleave="zeige($event, undefined)"
                    >
                        <span class="sprachen-legende__feld" aria-hidden="true"
                            ><span class="sprachen-legende__punkt" :style="{ background: sprache.farbe }"
                        /></span>
                        <span class="sprachen-legende__name">{{ sprache.name }}</span>
                    </button>
                </li>
            </ul>
            <p v-if="muster" class="sprachen-legende__zeile sprachen-legende__misch">
                <span class="sprachen-legende__feld sprachen-legende__schraffur" :style="muster" aria-hidden="true" />
                <span>{{ t("legend.sprachen.misch") }}</span>
            </p>
        </AvmDisclosure>
    </section>
</template>

<style scoped>
/*
 * Bauteilmaße dieser Legende, benannt, im Rahmen der Höhenlegende (`height-legend.vue`, Guide §28.1: Legende 11 px, gedämpft).
 * Die Breite trägt „Thorwalsch / Gjalskisch / Fjarningsch“ in einer Zeile (Vorlage: höchstens 292 px); längere Namen brechen um.
 * Der Punkt 11 px wie in der Vorlage, mittig im Feld von 22 px, in dem auch das Muster steht: Namen und Satz fluchten.
 * Die Knöpfe der Zeilen tragen 2 px Polster (oben, unten) und 4 px seitlich, damit Lasur und Fokusring nicht am Text kleben; die Liste rückt um dieselben
 * 4 px nach links, sodass Punkte und Namen weiter mit dem Satz der Mischgebiete fluchten.
 */
.sprachen-legende {
    --legende-breite: 260px;
    --legende-feld-b: 22px;
    --legende-feld-h: 11px;
    --legende-punkt: 11px;
    --legende-feld-radius: 2px;
    --legende-zeilenluft: 1px;
    --legende-streifen: 3px;
    --legende-knopf-y: 2px;

    box-sizing: border-box;
    width: var(--legende-breite);
    max-width: 100%;
    margin: 0 0 var(--space-4) auto;
    padding: var(--space-2);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-tight);
}

.sprachen-legende__liste {
    margin: 0;
    padding: var(--space-2) var(--space-2) 0;
    list-style: none;
}

.sprachen-legende__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    margin: var(--legende-zeilenluft) 0;
}

/* Die Zeile als Knopf (§30.5): Ruhe ohne Fläche, Hover und gedrückt mit der Lasur der Zeilen, Fokus mit dem Ring, die gewählte in der Schrift der Auswahl. */
.sprachen-legende__knopf {
    box-sizing: border-box;
    width: 100%;
    padding: var(--legende-knopf-y) var(--space-4);
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.sprachen-legende__knopf:hover {
    background: var(--color-hover-wash);
}

.sprachen-legende__knopf:active {
    background: var(--color-active-wash);
}

.sprachen-legende__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.sprachen-legende__knopf[aria-pressed="true"] {
    background: var(--color-active-wash);
    color: var(--color-list-selection-text);
}

.sprachen-legende__feld {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: var(--legende-feld-b);
    height: var(--legende-feld-h);
}

.sprachen-legende__punkt {
    width: var(--legende-punkt);
    height: var(--legende-punkt);
    border: 1px solid var(--color-border);
    border-radius: 50%;
}

.sprachen-legende__misch {
    margin: var(--space-4) 0 var(--space-2);
    padding: var(--space-4) var(--space-6) 0;
    border-top: 1px solid var(--color-divider);
    color: var(--color-text-muted);
}

/* Die Streifen wie auf der Karte: 45°, von rechts oben nach links unten, beide Farben gleich breit. */
.sprachen-legende__schraffur {
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--legende-feld-radius);
    background: repeating-linear-gradient(
        135deg,
        var(--sprache-a) 0 var(--legende-streifen),
        var(--sprache-b) var(--legende-streifen) calc(2 * var(--legende-streifen))
    );
}

@media (prefers-reduced-motion: reduce) {
    .sprachen-legende__knopf {
        transition: none;
    }
}
</style>
