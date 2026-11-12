<script setup lang="ts">
import AvmText from "../controls/avm-text.vue";
import AvmWert from "../controls/avm-wert.vue";
import { t } from "../i18n/i18n";
import StageLink from "./stage-link.vue";
import type { StageRowModel } from "./stage-list-model";

/**
 * Eine Etappenzeile des Reiseplans (WI-0079 §2, M0-Blatt vom 2026-10-05): zwei lesbare Zeilen.
 *
 *     ③ 🜚  Grenzfelden → Hartsteen  [Eiltempo teils]
 *           Straße · 11,82 Meilen · 2,3 Std.
 *
 * - 🔴 **Kein „›“ am rechten Rand** (Betreiber 2026-10-05: „der pfeil kann weg, wenn kein untermenü kommt“). Ein
 *   Pfeil nach rechts verspricht, dass an Ort und Stelle etwas aufgeht; hier geht nichts auf, ein Klick WÄHLT die
 *   Etappe und füllt das Infopanel. Dass die Zeile anklickbar ist, trägt sie in Hover- und Auswahlfläche und im
 *   Zeigerwechsel. Den Pfeil behält, was wirklich klappt: der Kopf einer Mediengruppe (▾/▴).
 *
 * - **Spalte 1** trägt die Perle mit der durchgehenden Nummer (§1.2); nur die gewählte Etappe ist gefüllt, und
 *   zwar in `--color-marker-active` - die Farbe, die im Planer, auf der Karte und im Panel „ausgewählt“ heißt
 *   (Guide §17.4). Weicht die Route hier einer Sperre aus, steht ihr Ring im Warnton.
 * - **Zeile 1** nennt die beiden Orte; sie sind Objektlinks („Was auf der Karte ist, ist anklickbar“). 🪤 Ein Ende
 *   OHNE Ort (Abgangs-, Anschlusspunkt, Anlegestelle) ist kein Knopf, sondern Text (WI-0087 A6). Dahinter
 *   das Etikett des Eiltempos (Betreiber 2026-10-05, F4 = B) - ohne Trenner davor: Es gehört nicht in die Reihe
 *   der Angaben, es ist eine Marke.
 * - **Zeile 2** nennt den WEGNAMEN, sonst die Wegart, dazu Distanz und Reisezeit als Werte (Klappbox-Regel, Guide
 *   §16.3). 🔴 Der Name steht nur, wenn der Weg wirklich einen hat (WI-0087 P1, Betreiber 2026-10-05: „sofern der
 *   weg einen namen hat"); er ist ein Objektlink auf den Weg, wo der Abschnitt dessen Kennung trägt, sonst Text.
 * - 🔴 **Keine eigene Kante** (Befund des Betreibers am M0-Blatt: „beim Mouse Hover sieht man, dass zwei rahmen
 *   gezeichnet werden“). Die Zeile liegt in einem Kasten, der schon eine Kante hat; Hover und Auswahl färben nur
 *   die Fläche (Guide §30.1). Steht der Zeiger auf einem Ortsnamen, träfe ein Klick den ORT - dann leuchtet nur
 *   der Name, und die Zeile tritt zurück.
 */
defineProps<{ row: StageRowModel; active: boolean; stale: boolean; treffer?: boolean }>();
const emit = defineEmits<{ select: []; openFrom: []; openTo: []; openPath: [] }>();

function onKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    emit("select");
}
</script>

<template>
    <li
        class="stage"
        :class="{ 'is-active': active, 'stage--closure': row.closure, 'stage--treffer': treffer }"
        :data-stage="row.index"
        role="button"
        :tabindex="stale ? -1 : 0"
        :aria-current="active ? 'step' : undefined"
        data-testid="route-stage"
        @click="emit('select')"
        @keydown="onKey"
    >
        <span class="stage__bead stages__mark" aria-hidden="true"
            ><span class="stage__number avm-versalmitte">{{ row.number }}</span></span
        >
        <img v-if="row.icon" class="stage__icon" :src="row.icon" alt="" />
        <span v-else class="stage__icon" aria-hidden="true"></span>
        <span class="stage__text">
            <!-- 🪤 Die Leerzeichen stehen ausdrücklich da: Vue verwirft den Umbruch zwischen zwei Elementen. -->
            <span class="stage__line1"
                ><StageLink
                    :text="row.fromName"
                    :linked="row.fromRef !== undefined"
                    :stale="stale"
                    testid="stage-from"
                    @open="emit('openFrom')"
                /><span class="stage__arrow">&nbsp;→ </span
                ><StageLink
                    :text="row.toName"
                    :linked="row.toRef !== undefined"
                    :stale="stale"
                    testid="stage-to"
                    @open="emit('openTo')"
                /><template v-if="row.hurry"
                    >{{ " "
                    }}<span class="pille" data-testid="stage-hurry">{{
                        t(row.hurry === "full" ? "planner.hurry" : "planner.hurry.partial")
                    }}</span></template
                ><template v-if="row.rest"
                    >{{ " " }}<span class="pille" data-testid="stage-rest">{{ t("planner.rest") }}</span></template
                ></span
            >
            <span class="stage__line2"
                ><span v-if="row.pathName" class="stage__way"
                    ><StageLink
                        :text="row.pathName"
                        :linked="row.pathRef !== undefined"
                        :stale="stale"
                        testid="stage-path"
                        @open="emit('openPath')"
                    /><template v-if="row.pathType"
                        >{{ " " }}<span data-testid="stage-path-type">({{ row.pathType }})</span></template
                    ></span
                ><AvmText v-else :text="row.typeLabel" rolle="sekundaer" /><span class="stage__sep">·</span
                ><AvmWert :werte="[row.distance]" /><span class="stage__sep">·</span><AvmWert :werte="[row.duration]"
            /></span>
        </span>
    </li>
</template>

<style scoped>
.stage {
    position: relative;
    display: grid;
    grid-template-columns: var(--mark-size) var(--icon-md) minmax(0, 1fr);
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    /* Links eine Sprosse weniger: Die Kante des Gruppenkastens trägt das Pixel, die Kette bleibt in der Spur. */
    padding: var(--space-4) var(--space-4) var(--space-4) calc(var(--space-4) - 1px);
    background: var(--color-panel);
    cursor: pointer;
    line-height: var(--leading-snug);
    transition:
        color 120ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.stage.is-active {
    background: var(--color-active-wash);
}

/*
 * Ein Hervorheben zeigt, was ein Klick träfe. Die gewählte Etappe behält ihre Fläche: Auswahl ist ein Zustand,
 * kein Zeigen. Am Finger gibt es kein Zeigen, und die Zeile kennt keinen gehaltenen Zustand - dort bleibt nach
 * einem Tipp nichts stehen.
 * 💣 Deshalb nur am echten Zeiger (wie `fan-ohr.vue`): Nach einem Tipp hält Chrome `:hover` dort, wo der Finger war,
 * und ohne die Klammer stand der Ton auf der Zeile, die nach dem Aufklappen unter dieser Stelle lag (Volllauf 2026-10-08).
 * `:not(.is-active)` hält die gewählte Zeile bei ihrer Fläche, wie vorher die Reihenfolge der beiden Regeln.
 */
@media (hover: hover) {
    .stage:not(.is-active):hover {
        background: var(--color-hover-wash);
    }

    .stage:not(.is-active):hover:has(.stage-link:hover) {
        background: var(--color-panel);
    }
}

.stage:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Ein Treffer von „Unterwegs“ (WI-0257 S4): Der gewählte Eintrag kommt in dieser Etappe vor. Das Gold der Karte (`--color-map-selection`, dieselbe Farbe, in der der Eintrag dort leuchtet) als sanfte
 * Fläche, nur als Fläche: Hausregel, keine farbigen Randbalken an gewählten Zeilen. Die gewählte Etappe behält ihre eigene Fläche (Auswahl ist ein Zustand).
 */
.stage.stage--treffer:not(.is-active) {
    background: color-mix(in srgb, var(--color-map-selection) 22%, var(--color-panel));
}

/*
 * 🔴 **Die Etappennummer ist NUR eine Ziffer** (WI-0087 P7, Betreiber 2026-10-06: „ich wolle KEINE KREISE bei
 * etappen" · „kreise suggerieren einen punkt d.h. einen stopp. eine etappe ist aber ein längeres stück"). Kein Ring,
 * kein Grund, kein Schein - nichts Rundes. Platz in der Kette macht die Kette selbst: Sie setzt an der Ziffer aus
 * (`route-stage-list.vue`, `measureChain`), statt übermalt zu werden.
 *
 * 🪤 **Die 10 px waren eine benannte Ausnahme, und ihr Grund ist weg.** Sie entstanden aus dem engen Innenraum des
 * Rings (Betreiber 2026-10-05: „die zahlen müssen glaub kleiner und zentrierter sein, sonst stoßen sie an den
 * rand“) - ohne Ring stößt nichts mehr an, und die Ziffer geht auf die Hausgröße zurück. Auf der ersten Vorlage
 * waren die gedämpften Nummern bei 10 px fast unlesbar; deshalb trägt eine gewöhnliche Nummer jetzt den normalen
 * Textton, nicht den gedämpften.
 *
 * Die Breite der Spalte (`--mark-size`) bleibt: Sie hält die Ziffern und die Wegpunktmarken in EINER Spur.
 */
.stage__bead {
    position: relative;
    z-index: 3;
    display: grid;
    place-items: center;
    box-sizing: border-box;
    width: var(--mark-size);
    height: var(--mark-size);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
    line-height: 1;
    transition: color 120ms ease;
}

/*
 * 🔴 „Zentrierter“ ist die Hausregel vom 2026-10-05: In einer Leiste sitzt die VERSALHÖHE in der Mitte, nicht die
 * Zeile (Guide §3.2, `avm-versalmitte`). Die waagerechte Mitte besorgen `place-items: center` und die
 * Tabellenziffern, die der „1“ dieselbe Breite geben wie der „8“.
 */
.stage__number {
    display: block;
}

/*
 * Die gewählte Etappe: die Ziffer hell und fett.
 *
 * 🔴 **`pillText`, nicht `markerActive`** (Betreiber 2026-10-06: „im lightheme passt bei der selektierten
 * etappenzahl kein gelb"). Gemessen auf dem Grund der gewählten Zeile (`activeWash` über `panel`) kommt
 * `markerActive` auf **1,50** - und er hat KEINEN Dunkelwert, derselbe helle Bernstein gilt in beiden Themen.
 * `pillText` ist im Haus schon der Goldton für Schrift auf hellem Goldgrund, dieselbe Lage, mit beiden Themen
 * hinterlegt, und liegt in BEIDEN besser: **6,16** hell und **5,01** dunkel. Keine neue Farbe, kein neues Feld.
 */
.stage.is-active .stage__bead {
    color: var(--color-pill-text);
}

.stage.is-active .stage__number {
    font-weight: 700;
}

/*
 * Die Etappe, an der die Route einer Sperre ausweicht: ihre Ziffer im Warnton.
 *
 * 🪤 Vorher trug das der RING (`border-color`). Mit dem Ring ist der Träger weggefallen, die Aussage nicht - sie
 * sitzt jetzt in der Ziffer selbst. Ist die Etappe zugleich gewählt, gewinnt die Auswahl, wie vorher auch.
 */
.stage--closure .stage__bead {
    color: var(--color-warning);
}

.stage__icon {
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}

.stage__text {
    min-width: 0;
}

.stage__line1 {
    display: block;
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.stage__arrow {
    color: var(--color-text-muted);
}

.stage__line2 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-4);
    margin-top: 1px;
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.stage__sep {
    color: var(--color-text-muted);
}

/*
 * Der Wegname steht, wo die Gattung stand, und erbt deren gedämpften Ton - ein Name OHNE Kennung sieht deshalb genau
 * wie die Gattung aus (`stage-link--plain` erbt die Farbe), einer MIT Kennung ist ein Link.
 */
.stage__way {
    color: var(--color-text-muted);
}

/*
 * Die Etiketten der Zeile: „Eiltempo“ (WI-0078) und „Rast“ (WI-0087 P8). EINE Rezeptur aus der vorhandenen
 * Etiketten-Palette des Hauses (Guide §2), kein neues Token.
 *
 * 🔴 **Beide tragen dieselbe Farbe, unterschieden wird über das WORT.** Sie können wirklich an derselben Zeile
 * stehen (gemessen an einer Fußreise Ferdok → Perricum mit Eiltempo: 12 von 36 Etappen tragen beides). Eine zweite
 * Farbe gäbe es im Haus nur als `pillHidden` - und die heißt „verborgen“, also etwas anderes. Eine neue Farbe für
 * „Rast“ behauptete eine Bedeutung, die es nicht gibt.
 */
.pille {
    display: inline-flex;
    align-items: center;
    box-sizing: border-box;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: calc(var(--space-16) / 2);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    line-height: var(--space-16);
    white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
    .stage,
    .stage__bead {
        transition: none;
    }
}
</style>
