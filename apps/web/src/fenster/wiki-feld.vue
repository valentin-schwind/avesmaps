<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import FensterFeldzeile from "./fenster-feldzeile.vue";
import type { WikiFeldLage } from "./wiki-feld";

/**
 * EINE Feldzeile mit Wiki-Wert (WI-0225; Design Guide §13.8 „Ein Wiki-Feld bauen“, verbindlich; Betreiber 2026-10-18: „ja, A aber der
 * durchgestrichene wert kommt nicht vor das feld sondern hinter das label“). Jedes Feld mit Wiki-Wert ist in jedem Editor dieses
 * Bauteil; kein Editor baut seine eigene Wiki-Zeile (Prüftest `wiki-feld-einzig.test.ts`).
 *
 * - **Drei Spalten:** Beschriftung (130 px, dahinter der Wiki-Wert) · das Feld (Slot) · ↺ (24 px, in jeder Zeile, auch leer) - das
 *   Raster ist `FensterFeldzeile` (`fenster-feldzeile.vue`, seit 2026-10-19 EINES für jede Feldzeile im Editor). So fluchten alle
 *   Felder eines Kastens mit den Zeilen ohne Wiki.
 * - **Den Zustand rechnet `wikiLage`** (`wiki-feld.ts`), nicht der Aufrufer und nicht dieses Bauteil.
 * - **Wird es eng, kürzt der Wiki-Wert** (`.einzeilig`, der Zettel trägt den ganzen Wert), nie die Beschriftung, nie das Feld, nie ↺.
 * - **↺** meldet nur (`zurueck`); was es im Entwurf tut, entscheidet die Art (EIN Schritt, geschrieben mit „Fertig“). Still ist es ein
 *   gesperrter Knopf ohne Rand und Fläche, wie der Rücksetzknopf der Wegfindung, fokussierbar über seinen Zettel.
 */
defineOptions({ name: "WikiFeld" });

const props = defineProps<{
    /** Die Beschriftung, übersetzt, ohne Doppelpunkt. */
    name: string;
    /** Die Kennung des Felds im Slot, für `<label for>`. */
    fuer?: string | undefined;
    lage: WikiFeldLage;
    /** An wie vielen Abschnitten der Artikel hängt („5/7“, Straße oder Kraftlinie). */
    anteil?: { mit: number; von: number } | undefined;
    /** Im Entwurf geändert, noch nicht geschrieben: ein Punkt hinter der Beschriftung (wie bisher am Ort). */
    geaendert?: boolean | undefined;
    /** Ein mehrzeiliges Feld (Textbereich): Beschriftung und ↺ stehen oben, nicht mittig. */
    oben?: boolean | undefined;
    /** Die Zettel eines abgebildeten Felds ohne Zuordnung (Wegtyp): am stillen ↺ und am Wiki-Text. */
    ohneZuordnung?: { still: string; wiki: string } | undefined;
    testid?: string | undefined;
}>();

const emit = defineEmits<{ zurueck: [] }>();

/** Der Wiki-Wert steht hinter der Beschriftung, wenn er abweicht oder keine Zuordnung hat. */
const wikiSichtbar = computed(() => props.lage.abweichend || props.lage.zustand === "unzugeordnet");
const wikiAnzeige = computed(() => props.lage.wikiText ?? t("wikiFeld.leer"));
const wikiZettel = computed(() =>
    props.lage.zustand === "unzugeordnet"
        ? (props.ohneZuordnung?.wiki ?? t("wikiFeld.stand", { wert: wikiAnzeige.value }))
        : t("wikiFeld.stand", { wert: wikiAnzeige.value }),
);
const zurueckZettel = computed(() => {
    if (props.lage.zurueck) return t("wikiFeld.zurueck");
    if (props.lage.zustand === "unzugeordnet") return props.ohneZuordnung?.still ?? t("wikiFeld.still");
    return t("wikiFeld.still");
});
</script>

<template>
    <FensterFeldzeile
        class="wiki-feld"
        :class="{ 'wiki-feld--weicht': lage.abweichend }"
        :data-zustand="lage.zustand"
        :fuer="fuer"
        :oben="oben"
        :titel="lage.zustand === 'unbekannt' ? t('wikiFeld.unbekannt') : undefined"
        :testid="testid"
    >
        <template #beschriftung>
            <span class="wiki-feld__name" :class="{ 'is-geaendert': geaendert }">{{ name }}</span>
            <span
                v-if="wikiSichtbar"
                class="wiki-feld__wiki"
                :class="{ 'wiki-feld__wiki--frage': lage.zustand === 'unzugeordnet' }"
                :title="wikiZettel"
                :data-testid="testid && `${testid}-wiki`"
            >
                <span v-if="lage.zustand === 'unzugeordnet'" class="wiki-feld__text einzeilig"
                    >„{{ lage.wikiText }}</span
                ><span v-if="lage.zustand === 'unzugeordnet'" class="wiki-feld__frage">“?</span>
                <s v-else class="wiki-feld__text einzeilig">{{ wikiAnzeige }}</s>
            </span>
            <span v-if="anteil" class="wiki-feld__anteil" :data-testid="testid && `${testid}-anteil`"
                >{{ anteil.mit }}/{{ anteil.von }}</span
            >
        </template>
        <slot />
        <template #zurueck>
            <AvmKnopf
                v-if="lage.mitZurueck"
                art="weich"
                groesse="zeile"
                class="wiki-feld__zurueck"
                :gesperrt="lage.zurueck ? undefined : ''"
                :title="zurueckZettel"
                :aria-label="t('wikiFeld.zurueckName', { name })"
                :testid="testid && `${testid}-zurueck`"
                @click="emit('zurueck')"
            >
                <span aria-hidden="true">↺</span>
            </AvmKnopf>
        </template>
    </FensterFeldzeile>
</template>

<style scoped>
/* Raster, Beschriftung, Feldbreite und `oben`: `fenster-feldzeile.vue`. Die Beschriftung selbst kürzt nie; Platz gibt zuerst der Wiki-Wert her. */
.wiki-feld__name {
    flex: none;
    white-space: nowrap;
}

/* Im Entwurf geändert, noch nicht geschrieben. */
.wiki-feld__name.is-geaendert::after {
    content: " •" / "";
    color: var(--color-warning-soft-text);
}

/* Weicht der Wert ab: braun, der zweite Akzent der Editoren (§13.7, §13.8). */
.wiki-feld--weicht .wiki-feld__name {
    color: var(--color-accent-brown);
}

.wiki-feld__wiki {
    display: flex;
    min-width: 0;
    flex: 0 1 auto;
    color: var(--color-danger);
    font-size: var(--font-size-caption);
}

.wiki-feld__text {
    display: block;
    min-width: 0;
}

.wiki-feld__wiki--frage {
    color: var(--color-text-muted);
    font-style: italic;
}

/* Das „?“ hinter einem Wiki-Text ohne Zuordnung kürzt nie mit. */
.wiki-feld__frage {
    flex: none;
}

.wiki-feld__anteil {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.wiki-feld__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

/* Still: ohne Rand und Fläche, gedämpft, ohne Wirkung (wie die Wegfindung, §13.8). */
.wiki-feld__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}
</style>
