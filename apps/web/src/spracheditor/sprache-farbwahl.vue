<script setup lang="ts">
import { computed } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { FARB_VORSCHLAEGE, farbeGueltig, farbeNormal } from "./sprache-felder";

/**
 * Die Farbe einer Sprache (WI-0261 S5d2; Betreiber 2026-10-30: „sprachen dürfen also farben haben (eigenschaft im spracheditor)“; Bauvorlage
 * `fenster-sprachen.js` `farbeDekorieren`): links der Farbwähler des Browsers, daneben `#rrggbb` zum Tippen, darunter „Farben der Legende“
 * als Vorschläge und „↺ Startwert“ (die Legendenfarbe des eigenen Schlüssels). Jede Wahl ist ein Schritt im Entwurf; die Karte folgt sofort
 * (`map/sprachen-vorschau.ts`), „Fertig“ schreibt.
 *
 * - Tippen und Ziehen am Farbwähler sind EIN Schritt bis zum Verlassen des Felds (`tippen`), ein Vorschlag oder ↺ ist ein eigener.
 * - Eine Eingabe, die keine Farbe ist, steht rot da und sperrt „Fertig“ mit Grund (`sprache-art.ts`, `pruefe`); die Karte behält dann die
 *   gespeicherte Farbe.
 */
const props = defineProps<{
    /** Die Farbe im Entwurf, wie getippt (auch ungültig). */
    farbe: string;
    /** Die gespeicherte Farbe: für den Farbwähler, solange die Eingabe keine Farbe ist. */
    gespeichert: string;
    /** Die Legendenfarbe des Schlüssels („↺ Startwert“); ohne keine. */
    start: string | undefined;
    lesend: boolean;
    kennung: string;
}>();
const emit = defineEmits<{ setze: [farbe: string, wie: "tippen" | "einzeln"] }>();

const gueltig = computed(() => farbeGueltig(props.farbe));
const waehler = computed(() => (gueltig.value ? farbeNormal(props.farbe) : props.gespeichert));
const istStart = computed(() => props.start !== undefined && farbeNormal(props.farbe) === props.start);
</script>

<template>
    <div class="farbwahl" :data-testid="`${kennung}-farbe`">
        <div class="farbwahl__zeile">
            <span class="farbwahl__feld" :style="{ '--farbe': waehler }">
                <input
                    v-if="!lesend"
                    type="color"
                    class="farbwahl__waehler"
                    :value="waehler"
                    :aria-label="t('spracheditor.farbe.waehlen')"
                    :data-testid="`${kennung}-farbe-waehler`"
                    @input="emit('setze', ($event.target as HTMLInputElement).value, 'tippen')"
                />
            </span>
            <AvmEingabe
                class="farbwahl__text"
                :model-value="farbe"
                :ungueltig="!gueltig"
                :gesperrt="lesend ? '' : undefined"
                :placeholder="t('spracheditor.farbe.platzhalter')"
                :aria-label="t('spracheditor.feld.farbe')"
                spellcheck="false"
                :testid="`${kennung}-farbe-text`"
                @update:model-value="(wert: string) => emit('setze', wert, 'tippen')"
            />
        </div>
        <p v-if="!gueltig" class="farbwahl__fehler" :data-testid="`${kennung}-farbe-fehler`">
            {{ t("spracheditor.grund.farbe") }}
        </p>
        <div v-if="!lesend" class="farbwahl__auswahl">
            <div class="farbwahl__reihe" role="group" :aria-label="t('spracheditor.farbe.legende')">
                <button
                    v-for="vorschlag in FARB_VORSCHLAEGE"
                    :key="vorschlag"
                    type="button"
                    class="farbwahl__chip"
                    :class="{ 'is-gewaehlt': farbeNormal(farbe) === vorschlag }"
                    :style="{ '--farbe': vorschlag }"
                    :title="vorschlag === start ? t('spracheditor.farbe.startTitel', { farbe: vorschlag }) : vorschlag"
                    :aria-label="t('spracheditor.farbe.vorschlag', { farbe: vorschlag })"
                    :aria-pressed="farbeNormal(farbe) === vorschlag"
                    :data-testid="`${kennung}-farbe-chip`"
                    @click="emit('setze', vorschlag, 'einzeln')"
                ></button>
            </div>
            <AvmKnopf
                v-if="start !== undefined && !istStart"
                groesse="zeile"
                :title="t('spracheditor.farbe.startTitel', { farbe: start })"
                :testid="`${kennung}-farbe-start`"
                @click="emit('setze', start, 'einzeln')"
            >
                {{ t("spracheditor.farbe.start") }}
            </AvmKnopf>
        </div>
        <p v-if="!lesend" class="farbwahl__hinweis">{{ t("spracheditor.farbe.hinweis") }}</p>
    </div>
</template>

<style scoped>
.farbwahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
}

.farbwahl__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

/* Das Feld zeigt die Farbe; darüber liegt unsichtbar der Farbwähler des Browsers (wie `gebiet-farbfeld.vue`). */
.farbwahl__feld {
    position: relative;
    flex: none;
    width: var(--avm-control-h);
    height: var(--avm-control-h);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--farbe);
}

.farbwahl__feld:has(:focus-visible) {
    box-shadow: var(--focus-ring);
}

.farbwahl__waehler {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: 0;
    opacity: 0;
    cursor: pointer;
}

.farbwahl__text {
    flex: 1 1 auto;
    min-width: 0;
    font-variant-numeric: tabular-nums;
}

.farbwahl__auswahl {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.farbwahl__reihe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.farbwahl__chip {
    width: var(--space-16);
    height: var(--space-16);
    padding: 0;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    background: var(--farbe);
    cursor: pointer;
    transition: box-shadow 120ms ease;
}

.farbwahl__chip:hover {
    box-shadow: 0 0 0 2px var(--color-active-wash);
}

.farbwahl__chip.is-gewaehlt {
    box-shadow: 0 0 0 2px var(--color-text-strong);
}

.farbwahl__chip:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.farbwahl__fehler {
    margin: 0;
    color: var(--color-danger);
    font-size: var(--font-size-small);
}

.farbwahl__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

@media (prefers-reduced-motion: reduce) {
    .farbwahl__chip {
        transition: none;
    }
}
</style>
