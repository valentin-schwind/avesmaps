<script setup lang="ts">
import { ref, useId } from "vue";
import AvmText from "../controls/avm-text.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Der Deckel (Design Guide §16.3, Legacy `.infobox-lid`, `js/ui/infobox-lid.js`): ein zusammengeklappter Abschnitt als schmale Leiste.
 *
 * 🔴 Was zugeklappt ist, zeigt seine ZUSAMMENFASSUNG - nie nur seinen Namen: „33 Orte auf dem Weg“, dazu, wo es sie gibt, die Vorschau
 * („erste → … → letzte“). Man muss nichts aufklappen, um zu wissen, ob es sich lohnt. Die Zahl wird hervorgehoben, das Wort nicht
 * (die Hausschrift hat nur Regular, die Betonung trägt die Farbe).
 *
 * 🔴 Die Leiste trägt ihre Schrift mittig (Hausregel `.avm-versalmitte`, `styles/canon.css`): Das Polster ist oben wie unten 3 px, und
 * jedes Feld der Zusammenfassung ist auf seine Versalhöhe geschnitten. Vorher saß die Zeile 0,9 px zu tief, weil der Zeilenkasten die
 * Unterlängen mittrug. Die Felder bleiben auf EINER Grundlinie (`baseline`): Zahl und Wort gehören zusammen.
 *
 * 🔴 **Und seine Höhe ist die des Hauses** (Hausregel `.avm-klappbox-kopf`, `styles/canon.css`, Betreiber 2026-10-07): Ein zugeklappter
 * einzeiliger Deckel ist genauso hoch wie eine zugeklappte Klappbox im Routenplaner - eine Symbolzeile in gleichem Polster. Die Zahl
 * steht dort und nicht hier; dieses Bauteil zentriert seine Reihe darin.
 *
 * Aufklappen läuft über `grid-template-rows` in 150 ms (Guide §30.4), bei reduzierter Bewegung gar nicht; zugeklappt ist der Inhalt `inert`
 * und für Tastatur und Vorleser nicht da. 💣 Der Deckel hat eine Untergrenze: Bleiben zwischen zwei Deckeln weniger als ~5 px, kleben
 * sie aneinander - der Zeilenabstand der Feldliste ist größer.
 */
defineProps<{
    count?: number;
    /** Das Wort hinter der Zahl, fertig in der passenden Zählform (WI-0173). */
    unit?: string;
    /**
     * Die Zusammenfassung als Satz („Erstreckt sich über 19 politische Gebiete“) statt Zahl und Wort. Sie läuft über `AvmText`: Die Zahl
     * steht hell, der Rest gedämpft, wie in jeder Klappbox (`controls/wert.ts`).
     */
    summary?: string;
    /** Die Vorschau im zugeklappten Zustand; ohne sie steht nur die Zusammenfassung. */
    preview?: string | undefined;
}>();
const emit = defineEmits<{ toggle: [open: boolean] }>();

const open = ref(false);
const body = useId();

function toggle(): void {
    open.value = !open.value;
    emit("toggle", open.value);
}
</script>

<template>
    <div class="info-lid" :class="{ 'is-open': open }" data-testid="info-lid" :data-open="open ? '' : undefined">
        <button
            type="button"
            class="info-lid__summary avm-klappbox-kopf"
            :aria-expanded="open"
            :aria-controls="body"
            :title="open ? t('infoPanel.lid.close') : t('infoPanel.lid.open')"
            @click="toggle"
        >
            <span class="info-lid__foot">
                <AvmText
                    v-if="summary !== undefined"
                    class="info-lid__summary-text avm-versalmitte einzeilig"
                    :text="summary"
                    :title="summary"
                    rolle="sekundaer"
                    data-testid="info-lid-summary"
                />
                <template v-else-if="count !== undefined">
                    <span class="info-lid__count avm-versalmitte" data-testid="info-lid-count">{{
                        formatNumber(count, 0)
                    }}</span>
                    <span class="info-lid__unit avm-versalmitte einzeilig" :title="unit">{{ unit }}</span>
                </template>
                <span class="info-lid__more avm-versalmitte" aria-hidden="true">{{ open ? "▴" : "▾" }}</span>
            </span>
            <span v-if="preview !== undefined && !open" class="info-lid__preview" data-testid="info-lid-preview">{{
                preview
            }}</span>
        </button>
        <div :id="body" class="info-lid__full" :inert="!open">
            <div class="info-lid__inner"><slot /></div>
        </div>
    </div>
</template>

<style scoped>
.info-lid {
    min-width: 0;
    border: 1px solid var(--color-divider);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.info-lid:hover,
.info-lid:focus-within {
    border-color: var(--color-button-soft-border);
    background: var(--color-panel-active);
}

/*
 * 🔴 **Die Höhe kommt aus der Hausregel `.avm-klappbox-kopf`** (`styles/canon.css`, Betreiber 2026-10-07: „klappboxen …
 * sollen eine einheitliche höhe haben (beispiele oneliner), im routenplaner wie im infopanel etc."). Gemessen war der
 * Deckel 16,08 px hoch und die Klappbox des Planers 22,00 - beides ungesetzt, der Deckel so hoch wie der auf die
 * Versalhöhe geschnittene Kasten seines Winkels. Jetzt sagt EINE Klasse die Höhe, und sie steht nicht hier.
 *
 * 🔴 **Senkrecht zentriert statt oben angeschlagen** (Spalte, `justify-content: center`): Die Klasse gibt dem Kopf
 * mehr Höhe, als die auf die Versalhöhe geschnittene Reihe braucht; ohne diese Zeile hinge die Aufschrift oben in
 * ihrem Kopf, und §3.2 wäre genau da gebrochen, wo der Deckel sie bisher am saubersten erfüllt hat. Mit ihr sitzt der
 * Versalkasten mittig im Polster und mittig in der Höhe - gemessen 0,00 px vor und nach der Änderung.
 *
 * 🪤 Die Spalte ist auch der Weg für den zweizeiligen Fall: Trägt der Deckel eine Vorschau („33 Orte auf dem Weg“ /
 * „Trallop → … → Punin“), ist er höher als die Untergrenze, und `center` tut nichts. Beide Zeilen behalten dann
 * Reihenfolge und Abstand wie im Block zuvor (gemessen: 33,47 px vor wie nach der Änderung).
 */
.info-lid__summary {
    display: flex;
    flex-direction: column;
    justify-content: center;
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    padding: var(--avesmaps-infopanel-lid-pad);
    border: 0;
    border-radius: var(--radius-md);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.info-lid__summary:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * 🔴 **DIE AUFSCHRIFT BLEIBT EINZEILIG, AUCH WENN SIE NICHT HINEINPASST** (Betreiber 2026-10-07 am Bildschirmfoto der
 * Zeile „88 Handelswaren gelistet“: „das darf nicht passieren“).
 *
 * 💣 Vorher stand hier `flex-wrap: wrap`, und die Aufschrift konnte nicht nachgeben (kein `min-width: 0`). Wurde es
 * eng, rutschte darum der PFEIL in eine zweite Zeile - rechtsbündig unter dem Text -, und der Kopf war doppelt so
 * hoch wie seine Nachbarn. Gemessen am 2026-10-07: Bei 360 px Fenster ist das Panel 330 px breit, die Wertespalte
 * 175 px, der Platz in der Reihe 155 px; „445 Pflanzenarten gesehen“ braucht 154,06 px Text plus 6 px Abstand plus
 * 11 px Pfeil, also 171 px - drei der vier Vorkommenszeilen brachen um (Kopf 29,38 statt 22,00 px).
 *
 * 🪤 **Die Feldzeile ist NICHT die Ursache**, obwohl sie wie eine aussieht: `info-fields.vue` gibt der Wertespalte
 * `minmax(0, 1fr)` und dem `dd` ein `min-width: 0`, reicht also eine harte Grenze herein. Die Klappbox selbst hat
 * sich entschieden, in die Höhe zu gehen statt den Text zu kürzen.
 *
 * 🔴 **Die Rezeptur ist die abgenommene der Planerleiste** (Betreiber 2026-10-06: „Gemeinschaftszimmer kann auch
 * dranstehen … halt mit ‚…‘“), keine zweite daneben: Die Reihe bricht nicht um, das letzte Textfeld gibt nach und
 * kürzt am Ende über die Hausklasse `.einzeilig` (app.vue - die einzige Stelle, an der der Auslassungspunkt
 * erklärt ist, `design-canon.test.ts`), Zahl und Pfeil behalten ihren Platz. Der volle Text bleibt im DOM und im
 * `title`.
 */
.info-lid__foot {
    display: flex;
    flex-wrap: nowrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-4);
    font-size: var(--font-size-caption);
}

/* Die Zahl kürzt nie: sie ist die Aussage, und „8…“ statt „88“ wäre falsch. */
.info-lid__count {
    flex: none;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
}

.info-lid__unit,
.info-lid__summary-text {
    flex: 1 1 auto;
    min-width: 0;
}

.info-lid__unit {
    color: var(--color-text-muted);
}

.info-lid__summary-text {
    font-size: var(--font-size-small);
}

/* Der Pfeil steht rechts; Legacy: die Linkfarbe, „aufklappen“ ist eine Handlung. */
.info-lid__more {
    flex: none;
    margin-left: auto;
    color: var(--color-link);
    font-size: var(--font-size-body);
    line-height: 1;
}

.info-lid__summary:hover .info-lid__more {
    color: var(--color-link-hover);
}

.info-lid__preview {
    display: block;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.info-lid__full {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 150ms ease;
}

/*
 * 💣 **Das Kind-Zeichen ist hier tragend, nicht Geschmack.** Vues Scoped CSS hängt die Kennung nur an den LETZTEN Teil des
 * Selektors: `.info-lid.is-open .info-lid__full[data-v-…]` trifft mit einem Nachfahrenselektor auch den Deckel IM Deckel - ein
 * offener äußerer riss den inneren mit auf. Aufgefallen am Blatt vom 2026-10-06 (WI-0091): „Aus der Region“ stand offen da,
 * obwohl ihr Knopf `aria-expanded="false"` meldete. Beide Deckel sind dieselbe Komponente und teilen sich darum die Kennung.
 */
.info-lid.is-open > .info-lid__full {
    grid-template-rows: 1fr;
}

.info-lid__inner {
    min-height: 0;
    min-width: 0;
    overflow: hidden;
    padding: 0 var(--space-6);
}

.info-lid.is-open > .info-lid__full > .info-lid__inner {
    padding-bottom: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .info-lid,
    .info-lid__full {
        transition: none;
    }
}
</style>
