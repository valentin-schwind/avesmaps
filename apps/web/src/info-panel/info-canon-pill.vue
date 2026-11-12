<script setup lang="ts">
import { computed } from "vue";
import { t } from "../i18n/i18n";
import type { CanonPill } from "./panel-types";

/**
 * Das Kanon-Etikett (Design Guide §16, Legacy `featureKanonBadgeMarkup`, css/features/feature-sources.css `.fs-kanon`): Ohne Bezeichner
 * ist die Pille rund, mit Bezeichner geteilt - links der Kanon, rechts, wer es geschrieben hat (seit WI-0253 B-2 auch bei „offiziell“,
 * Regel in `sources.yaml`). Gold heißt im Kanon, Blaugrün nicht; KEIN Rot für „inoffiziell“ (Legacy: die Briefspiele sind der Grund, warum es die Inhalte gibt).
 *
 * Farbe allein ist keine Auszeichnung: Der Wortlaut steht IM Element, die zwei Felder trennt ein „·“ im `aria-label`.
 *
 * 🔴 Betreiber 2026-10-04: „die pillen offiziell und inoffiziell sind extrem wichtig. mach den text darin fett und zentrier ihn
 * vertikal exakt mittig“; dazu: „nein nur die linke hälfte von INOFFIZIELL | Briefspiel wird fett“.
 * - FETT ist nur das Kanonwort (die farbige Hälfte). Faculty Glyphic bringt nur den Regular-Schnitt mit, und `canon.css` schaltet die
 *   Kunstfettung appweit ab; hier wird sie ausdrücklich wieder erlaubt (wie Legacy `.fs-kanon`), sonst steht 700 im Stil und gezeichnet
 *   wird dasselbe Regular. Wer die Fettung prüft, prüft `font-synthesis-weight`, nicht nur `font-weight`.
 * - MITTIG heißt: die Mitte der Versalhöhe auf der Mitte der Pille. Das ist die Hausregel `.avm-versalmitte` (`styles/canon.css`, seit
 *   2026-10-05 an EINER Stelle): Sie schneidet den Textkasten auf Versalhöhe oben und Grundlinie unten, das Feld setzt ihn per Flex in die
 *   Mitte. Damit hängt die Lage an der Schrift selbst, nicht an einem von Hand austarierten Polster (Legacy 4,25/2,75 px traf einen
 *   Mittelweg, nicht die Mitte). Wächter: `e2e/info-panel-canon-pill.spec.ts` und `e2e/leisten-mitte.spec.ts`, höchstens 0,5 px.
 * - Beide Formen sind gleich hoch (Legacy: 18 px): Die Höhe steht am Etikett, die Felder füllen sie.
 */
const props = defineProps<{ pill: CanonPill }>();

const state = computed(() =>
    t(props.pill.state === "official" ? "infoPanel.canon.official" : "infoPanel.canon.unofficial"),
);
const label = computed(() => (props.pill.by === undefined ? state.value : `${state.value} · ${props.pill.by}`));
</script>

<template>
    <span
        class="info-canon"
        :class="[`is-${pill.state}`, { 'is-split': pill.by !== undefined }]"
        :aria-label="label"
        data-testid="info-canon"
        :data-state="pill.state"
    >
        <span class="info-canon__state"
            ><span class="info-canon__glyphs avm-versalmitte">{{ state }}</span></span
        >
        <span v-if="pill.by !== undefined" class="info-canon__by"
            ><span class="info-canon__glyphs avm-versalmitte">{{ pill.by }}</span></span
        >
    </span>
</template>

<style scoped>
.info-canon {
    display: inline-flex;
    align-items: stretch;
    flex-shrink: 0;
    box-sizing: border-box;
    height: var(--space-16);
    max-width: 100%;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--radius-lg);
    font-size: var(--font-size-kanon);
    letter-spacing: var(--letter-spacing-caps);
    line-height: 1;
    text-transform: uppercase;
    white-space: nowrap;
}

/* Jedes Feld füllt die Höhe und setzt seine Schrift in die Mitte. */
.info-canon__state,
.info-canon__by {
    display: flex;
    align-items: center;
    padding: 0 var(--space-6);
}

/* Das farbige Feld: die ganze Pille oder die linke Hälfte, fett. */
.info-canon__state {
    flex-shrink: 0;
    font-weight: var(--font-weight-bold);
    font-synthesis-weight: auto;
}

.info-canon__state .info-canon__glyphs {
    font-synthesis-weight: auto;
}

.info-canon.is-official .info-canon__state {
    background: var(--color-kanon-official);
    color: var(--color-kanon-official-text);
}

.info-canon.is-unofficial .info-canon__state {
    background: var(--color-kanon-unofficial);
    color: var(--color-kanon-unofficial-text);
}

/* 🔴 Das rechte Feld ist NEUTRAL, nie blaugrün: Es trägt gar keine Fläche, nur die Kontur und die gedämpfte Schrift, im Gewicht
   der übrigen Oberfläche. */
.info-canon.is-split {
    border-color: var(--color-border);
}

.info-canon__by {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: 0;
    text-transform: none;
}

/* 🪤 Der Kasten ist auf Versalhöhe beschnitten: Ein `overflow: hidden` HIER schnitte die Oberlängen von f und l und die Unterlänge von p
   ab. Ein zu langer Name endet deshalb an der Kontur des Etiketts, wie vorher. */
.info-canon__by .info-canon__glyphs {
    min-width: 0;
}
</style>
