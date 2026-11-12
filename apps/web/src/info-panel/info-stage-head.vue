<script setup lang="ts">
import type { SubjectRef } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import AvmWert from "../controls/avm-wert.vue";
import ClosureNote from "../route-planner/closure-note.vue";
import InfoLink from "./info-link.vue";
import { withTrailingPunctuation } from "./panel-text";
import type { ActionRun, HeaderModel, StageNav } from "./panel-types";

/**
 * Der Titel einer Etappe (WI-0063 4.7, E13, 27.13; Betreiber 2026-10-04: „kann man die buttons < > rechts fixieren, dass sie nicht immer
 * hin und herspringen. schön wär eigentlich bei etappen, wenn Titel und Subtitle der Etappe zentriert, links < und recht > wäre“):
 *
 *     Etappe 4 von 8
 *   ‹  Burg Willenbach → Mardramund  ›
 *
 * Der Titel steht mittig, darunter EINE dreispaltige Zeile: Pfeil, Untertitel, Pfeil. 🔴 Die Pfeilspalten haben die feste Breite einer
 * Bedienhöhe (`--avm-control-h`), der Untertitel füllt den Rest und bricht in sich um: Wie lang die Namen sind, ändert nie die Stelle der
 * Pfeile. Beim Blättern bleibt der Daumen auf derselben Stelle.
 *
 * Bricht der Untertitel um, bleiben die Pfeile an der ERSTEN Zeile stehen (nicht in der Mitte der Zeile): Eine Mitte wanderte mit der
 * Zahl der Zeilen auf und ab, und gerade das soll nicht geschehen. Die erste Zeile sitzt mittig zu den Pfeilen (`padding-block`).
 *
 * Von und Bis sind Objektlinks, wo das Ende ein Ort der Karte ist (Regel „Was auf der Karte ist, ist anklickbar“); sie öffnen über die
 * Naht des Panels, die Pfeile wählen die vorige und nächste Etappe. Die Zustände der Pfeile folgen Guide §30.5: Ruhe, Hover, Aktiv, Fokus,
 * Gesperrt (gedämpfte Fläche, `not-allowed`, nie `opacity`), Übergang 120 ms.
 */
defineProps<{ model: HeaderModel; nav: StageNav }>();
const emit = defineEmits<{ open: [ref: SubjectRef]; run: [run: ActionRun] }>();
</script>

<template>
    <div class="info-stage-head" data-testid="info-stage-head">
        <h2 class="info-stage-head__title" data-testid="info-title">{{ model.title }}</h2>
        <div
            class="info-stage-head__row"
            role="group"
            :aria-label="t('infoPanel.stage.group')"
            data-testid="info-stage-nav"
        >
            <button
                type="button"
                class="info-stage-head__step"
                :disabled="!nav.hasPrev"
                :aria-label="nav.prev"
                data-testid="info-stage-prev"
                @click="emit('run', { type: 'stageStep', step: -1 })"
            >
                ‹
            </button>
            <div>
                <p class="info-stage-head__subtitle" data-testid="info-subtitle">
                    <template v-for="(item, position) in model.subtitle" :key="position">
                        <template v-if="position > 0"> · </template>
                        <template v-for="(part, at) in withTrailingPunctuation(item.parts)" :key="at">
                            <InfoLink v-if="part.ref !== undefined" :tail="part.tail" @open="emit('open', part.ref)">{{
                                part.text
                            }}</InfoLink>
                            <template v-else>{{ part.text }}</template>
                        </template>
                    </template>
                </p>
                <p v-if="model.stageHead?.leg" class="info-stage-head__leg" data-testid="info-stage-leg">
                    {{ model.stageHead.leg }}
                </p>
            </div>
            <button
                type="button"
                class="info-stage-head__step"
                :disabled="!nav.hasNext"
                :aria-label="nav.next"
                data-testid="info-stage-next"
                @click="emit('run', { type: 'stageStep', step: 1 })"
            >
                ›
            </button>
        </div>
    </div>
    <!--
        Die drei Kennzahlen (WI-0079 §7a, Bildvorgabe des Betreibers vom 2026-10-05): EIN Kasten, darin gleich
        breite Spalten mit feinen senkrechten Strichen. Eine Größe, die es nicht gibt, hat keine Spalte.
    -->
    <div v-if="model.stageHead && model.stageHead.figures.length > 0" class="kennzahlen" data-testid="stage-figures">
        <div class="kennzahlen__reihe">
            <div
                v-for="figure in model.stageHead.figures"
                :key="figure.key"
                class="kennzahl"
                :data-testid="`stage-figure-${figure.key}`"
            >
                <img class="kennzahl__bild" :src="figure.icon" alt="" />
                <span class="kennzahl__wert"><AvmWert :werte="[figure.value]" /></span>
                <span class="kennzahl__name">{{ figure.label }}</span>
            </div>
        </div>
    </div>
    <!-- Die Hinweise, die früher in der Etappenzeile des Planers standen (WI-0079 §4): Sperre und Querfeldein. -->
    <div v-if="model.stageHead && model.stageHead.notes.length > 0" class="info-stage-head__notes">
        <ClosureNote v-for="(note, at) in model.stageHead.notes" :key="at" testid="stage-note">{{ note }}</ClosureNote>
    </div>
</template>

<style scoped>
/* Wie die Titelzeile der anderen Köpfe (Polster 10 / 18 / 12), nur mittig gesetzt. */
.info-stage-head {
    padding: var(--space-8) var(--info-pad-x) var(--space-10);
    text-align: center;
}

/* Name 20 px (Guide §16.1); Betonung über die Farbe, nicht das Gewicht. */
.info-stage-head__title {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-tight);
}

/* Pfeil | Untertitel | Pfeil: die Pfeilspalten fest, der Untertitel füllt den Rest. Oben bündig, damit die Pfeile nie mit der Zeilenzahl wandern. */
.info-stage-head__row {
    display: grid;
    grid-template-columns: var(--avm-control-h) minmax(0, 1fr) var(--avm-control-h);
    align-items: start;
    column-gap: var(--space-6);
    margin-top: var(--space-2);
}

/* Die erste Zeile sitzt mittig zum Pfeil: halbe Bedienhöhe minus halbe Zeilenhöhe oben und unten (ohne `lh` bleibt ein fester Wert). */
.info-stage-head__subtitle {
    margin: 0;
    padding-block: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
    line-height: var(--leading-normal);
}

/*
 * Ein Link ist ein Knopf und damit ein Kasten (`inline-block`, auch mit `display: inline`): Ein Name, der umbricht, füllt die Breite, und der
 * Text darin stünde links (`.info-link` setzt `text-align: left`). In dieser Zeile steht er mittig wie der Rest.
 */
.info-stage-head__subtitle :deep(.info-link) {
    text-align: center;
}

@supports (padding-block: calc(1lh)) {
    .info-stage-head__subtitle {
        padding-block: calc((var(--avm-control-h) - 1lh) / 2);
    }
}

/* Die Pfeile der Etappe: eine Bedienhöhe (32 px) im weichen Knopf (Guide §30.5). */
.info-stage-head__step {
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-title);
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.info-stage-head__step:hover:not(:disabled) {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-stage-head__step:active:not(:disabled) {
    background: var(--color-button-soft-active);
}

.info-stage-head__step:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Gesperrt: an der ersten und der letzten Etappe gibt es kein Vorher und Nachher - gedämpfte Fläche, kein Schatten, nicht greifbar. */
.info-stage-head__step:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
    .info-stage-head__step {
        transition: none;
    }
}

/* Die Teilstrecke (§3): leise unter dem Untertitel, nur bei mehr als zwei Wegpunkten. */
.info-stage-head__leg {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

/*
 * Die drei Kennzahlen nach der Bildvorgabe des Betreibers vom 2026-10-05 (WI-0079 §7a): EIN abgerundeter Kasten
 * mit dünner Kontur, darin gleich breite Spalten mit feinen senkrechten Strichen - nur dazwischen, nie außen.
 * Die Werte setzt `AvmWert` (Klappbox-Regel, Guide §16.3): Zahl hell mit Ziffern gleicher Breite, Einheit
 * gedämpft; die Beschriftung darunter gedämpft und klein.
 */
.kennzahlen {
    margin: 0 var(--info-pad-x) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.kennzahlen__reihe {
    display: grid;
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
}

.kennzahl {
    display: grid;
    justify-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-8) var(--space-4);
}

.kennzahl + .kennzahl {
    border-inline-start: 1px solid var(--color-divider);
}

/*
 * Ein Inhaltsbild: volle Farbe, nie umgefärbt (Guide §30.2).
 *
 * 🔴 **Die Kantenlänge steht im Kanon** (`infoPanel.figureIcon`, 36 px), nicht hier: Betreiber 2026-10-06 „die 3 etappen
 * icons könnten 150% größer sein. die sind hübsch!“ - 150 % von `icon.lg` (24 px). Ein eigener Kanonname, obwohl der Wert
 * dem der Aktionskachel gleicht: Die Aktionskachel ist eine offene Gestaltungsfrage (WI-0089 P4) und darf die Kennzahlen
 * nicht mitziehen. Gemessen am 2026-10-06: Die Kachel wächst damit von 90 auf 102 px, der Kasten von 92 auf 104 px; die
 * Breite bleibt (115,7 px am Rechner, 92,3 px bei 360 px), und keine Beschriftung bricht um.
 */
.kennzahl__bild {
    display: block;
    width: var(--avesmaps-infopanel-figure-icon);
    height: var(--avesmaps-infopanel-figure-icon);
    object-fit: contain;
}

.kennzahl__wert {
    font-size: var(--font-size-title);
    line-height: var(--leading-tight);
    white-space: nowrap;
}

/*
 * 🔴 **Am schmalen Gerät fällt die ZAHL eine Sprosse tiefer** (Betreiber 2026-10-06: „bei 360px kannst du die schrift
 * der zahlen kleiner machen, damit die zahlen in die spalten passen“). Ein Wert bricht in diesem Haus nie um; er lief
 * deshalb aus seiner Spalte ins Polster.
 *
 * Gemessen am 2026-10-06 über 190 echte Werte aus vier Reisen (Thorwal→Al'Anfa, Gareth→Fasar, Riva→Al'Anfa,
 * Gareth→Kuslik), Spaltenplatz bei 360 px **80,33 px**: Bei `title` (20 px) ist die breiteste Zahl „202,50 h“
 * **87,33 px** breit und passt nicht; bei `subhead` (16 px) sind es **69,86 px**, und damit passen ALLE. `subhead` ist
 * die nächste Sprosse der Hauptleiter des Kanons und die erste, die reicht - keine neue Stufe, keine erfundene Zahl.
 *
 * 🪤 Die Beschriftung bleibt, wie sie war (`small`, 12 px, einzeilig); nur die Zahl gibt nach.
 *
 * 🪤 Die Schwelle ist die vorhandene des Hauses (419 px, `controls/map-fan.vue`), nicht eine neue. Gerechnet läuft die
 * breiteste Zahl erst unter rund 379 px Fensterbreite über - zwischen 379 und 419 px steht sie also eine Spur kleiner,
 * als sie müsste. Das ist der Preis dafür, EINE Zahl im Haus zu führen statt zwei.
 */
@media (max-width: 419px) {
    .kennzahl__wert {
        font-size: var(--font-size-subhead);
    }
}

.kennzahl__name {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    text-align: center;
}

/* Die geretteten Hinweise der Etappenzeile (§4): dieselben Kästen wie im Planer, mit dem Polster des Panels. */
.info-stage-head__notes {
    display: grid;
    gap: var(--space-4);
    margin: 0 var(--info-pad-x) var(--space-6);
}
</style>
