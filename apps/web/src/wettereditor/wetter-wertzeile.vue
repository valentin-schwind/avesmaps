<script setup lang="ts">
import { computed } from "vue";
import AvmFeld from "../controls/avm-feld.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { formatNumber } from "../i18n/i18n";

/**
 * Eine Zeile „Wert“ im Wetter-Editor (WI-0288 Stufe 3; Probierseite nach `landschaftseditor/gebirge-wertzeile.vue`) auf der EINEN Feldkante
 * (`FensterFeldzeile`): Name, leise der Kartenstandard, Regler, Zahl im Feld, Einheit, ↺ am Zeilenende bei Abweichung. Ohne `referenz`
 * (die Werte eines Icons) fallen Kartenstandard und ↺ weg.
 *
 * - Gespeichert wird in den Einheiten der Tafel; das Feld zeigt `wert × faktor` (Anteil 0,7 → 70 %, Reichweite 150 → 450 km).
 * - Der Regler meldet jede Bewegung (`input`), das Feld beim Verlassen oder mit Enter (`change`): Gespeichert wird ohnehin entprellt.
 */
const props = defineProps<{
    /** Der Schlüssel im Namen der Prüfkennung (`<kennung>-wert-<schluessel>`). */
    schluessel: string;
    kennung: string;
    name: string;
    satz: string;
    min: number;
    max: number;
    schritt: number;
    wert: number;
    /** Worauf ↺ zurücksetzt, leise links neben dem Regler; ohne Angabe weder das eine noch das andere. */
    referenz?: number | undefined;
    /** Der Zettel an der leisen Zahl und am ↺. */
    referenzText?: string | undefined;
    stellen: number;
    faktor?: number | undefined;
    einheit: string;
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{ setze: [wert: number]; zurueck: [] }>();

const faktor = computed(() => props.faktor ?? 1);
const id = computed(() => `${props.kennung}-wert-${props.schluessel}`);
const anzeige = (wert: number): number => Math.round(wert * faktor.value * 10 ** props.stellen) / 10 ** props.stellen;
const weicht = computed(() => props.referenz !== undefined && Math.abs(props.wert - props.referenz) > 1e-6);
const referenzZahl = computed(() =>
    props.referenz === undefined ? "" : formatNumber(anzeige(props.referenz), props.stellen),
);

function regler(ereignis: Event): void {
    const neu = Number((ereignis.target as HTMLInputElement).value);
    if (Number.isFinite(neu) && neu !== props.wert) emit("setze", neu);
}
function feld(ereignis: Event): void {
    const eingabe = ereignis.target as HTMLInputElement;
    const neu = Number(eingabe.value) / faktor.value;
    if (eingabe.value.trim() === "" || !Number.isFinite(neu)) {
        eingabe.value = String(anzeige(props.wert));
        return;
    }
    if (Math.abs(neu - props.wert) > 1e-9) emit("setze", neu);
}
</script>

<template>
    <FensterFeldzeile class="wetter-wert" :class="{ 'is-abw': weicht }" :fuer="id" :titel="satz" :testid="id">
        <template #beschriftung>
            <span class="wetter-wert__name">{{ name }}</span>
        </template>
        <span class="wetter-wert__eingabe" :class="{ 'wetter-wert__eingabe--ohne': referenz === undefined }">
            <span
                v-if="referenz !== undefined"
                class="wetter-wert__referenz"
                :title="referenzText"
                :data-testid="`${id}-referenz`"
                >{{ referenzZahl }}</span
            >
            <input
                type="range"
                :min="min"
                :max="max"
                :step="schritt"
                :value="wert"
                :disabled="gesperrt !== undefined"
                :aria-label="name"
                :data-testid="`${id}-regler`"
                @input="regler"
            />
            <AvmFeld
                :id="id"
                type="number"
                :min="anzeige(min)"
                :max="anzeige(max)"
                :step="schritt * faktor"
                :value="anzeige(wert)"
                :disabled="gesperrt !== undefined"
                :data-testid="`${id}-feld`"
                @change="feld"
            />
            <span class="wetter-wert__einheit">{{ einheit }}</span>
        </span>
        <template #zurueck>
            <button
                v-if="weicht"
                type="button"
                class="wetter-wert__zurueck"
                :title="referenzText"
                :aria-label="referenzText"
                :disabled="gesperrt !== undefined"
                :data-testid="`${id}-zurueck`"
                @click="emit('zurueck')"
            >
                ↺
            </button>
        </template>
    </FensterFeldzeile>
</template>

<style scoped>
/* Das Raster steht in `fenster-feldzeile-raster.css` (EINE Feldkante); hier nur Name, Eingabe und ↺, wie die Werte des Gebirges. */
.wetter-wert__name {
    color: var(--color-text-muted);
}

.wetter-wert.is-abw .wetter-wert__name {
    color: var(--color-text);
}

.wetter-wert__eingabe {
    display: grid;
    grid-template-columns: 5ch minmax(0, 1fr) 7ch 3ch;
    gap: var(--space-4);
    align-items: center;
}

.wetter-wert__eingabe--ohne {
    grid-template-columns: minmax(0, 1fr) 7ch minmax(3ch, auto);
}

.wetter-wert__referenz {
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

.wetter-wert__einheit {
    color: var(--color-text-muted);
    white-space: nowrap;
}

.wetter-wert__eingabe input[type="range"] {
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-brown);
    cursor: pointer;
}

.wetter-wert__eingabe input[type="range"]:disabled {
    cursor: default;
}

.wetter-wert__zurueck {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.wetter-wert__zurueck:hover {
    color: var(--color-link-hover);
}

.wetter-wert__zurueck:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .wetter-wert__zurueck {
        transition: none;
    }
}
</style>
