<script setup lang="ts">
import { computed } from "vue";
import AvmFeld from "../controls/avm-feld.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Eine Zeile „Wert“ im Reiter „Gebirge“ (WI-0178 P4, Fassung 16) auf der EINEN Feldkante (`FensterFeldzeile`): Name, dann eine eigene
 * schmale Spalte mit dem Preset (Bauvorlage Gebirge-Entwurf V16, Betreiber 2026-10-20: Preset-Anzeige „eigene Spalte“; ohne Preset „–“),
 * Regler und Zahl im Feld, ↺ in der Spalte am Zeilenende zurück auf das Preset. Regler und Zahl schreiben beim Loslassen; ein Zug in Folge verschmilzt im
 * Entwurf zu EINEM Schritt (der Reiter nennt den Schlüssel). Dieselbe Zeile trägt die Werte der V12 und die des Rückennetzes (WI-0245):
 * Was gilt, was das Preset ist und was beim Setzen geschieht, sagt der Reiter.
 */
const props = defineProps<{
    /** Der Schlüssel im Namen der Prüfkennung (`…-gebirge-wert-<schluessel>`). */
    schluessel: string;
    name: string;
    satz: string;
    grenze: { readonly min: number; readonly max: number; readonly schritt: number };
    gilt: number;
    /** Das Preset; ohne Typ gibt es bei den Werten der V12 keins. */
    preset: number | undefined;
    weicht: boolean;
    typName: string;
    gesperrt?: string | undefined;
    kennung: string;
    /** Eine Einheit hinter dem Feld (etwa „%“), dann ohne Preset-Spalte; ohne sie bleibt die Zeile wie bei den übrigen Werten. */
    einheit?: string | undefined;
    /** Der Zettel am ↺, wo „Zurück auf {Typ}“ nicht passt (ein Wert ohne Preset je Typ). */
    zurueckText?: string | undefined;
}>();
const emit = defineEmits<{ setze: [wert: number]; zurueck: [] }>();

const zahl = (wert: number): string =>
    formatNumber(wert, props.grenze.schritt >= 1 ? 0 : String(props.grenze.schritt).split(".")[1]!.length);
const zurueck = computed(
    () =>
        props.zurueckText ??
        t("landschaftseditor.gebirge.wert.zurueck", { typ: props.typName, n: zahl(props.preset ?? props.gilt) }),
);
const id = computed(() => `${props.kennung}-gebirge-wert-${props.schluessel}`);

function setze(ereignis: Event): void {
    const neu = Number((ereignis.target as HTMLInputElement).value);
    if (!Number.isFinite(neu) || neu === props.gilt) return;
    emit("setze", neu);
}
</script>

<template>
    <FensterFeldzeile class="gebirge-wert" :class="{ 'is-abw': weicht }" :fuer="id" :titel="satz">
        <template #beschriftung>
            <span class="gebirge-wert__name">{{ name }}</span>
        </template>
        <span class="gebirge-wert__eingabe" :class="{ 'gebirge-wert__eingabe--einheit': einheit !== undefined }">
            <span
                v-if="einheit === undefined"
                class="gebirge-wert__preset"
                :title="
                    preset === undefined ? undefined : t('landschaftseditor.gebirge.wert.preset', { n: zahl(preset) })
                "
                :data-testid="`${id}-preset`"
                >{{ preset === undefined ? "–" : zahl(preset) }}</span
            >
            <input
                type="range"
                :min="grenze.min"
                :max="grenze.max"
                :step="grenze.schritt"
                :value="gilt"
                :disabled="gesperrt !== undefined"
                :aria-label="name"
                :data-testid="`${id}-regler`"
                @change="setze"
            />
            <AvmFeld
                :id="id"
                type="number"
                :min="grenze.min"
                :max="grenze.max"
                :step="grenze.schritt"
                :value="gilt"
                :disabled="gesperrt !== undefined"
                :data-testid="id"
                @change="setze"
            />
            <span v-if="einheit !== undefined" class="gebirge-wert__einheit">{{ einheit }}</span>
        </span>
        <template #zurueck>
            <button
                v-if="weicht"
                type="button"
                class="gebirge-wert__zurueck"
                :title="zurueck"
                :aria-label="zurueck"
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
/* Das Raster steht in `fenster-feldzeile-raster.css` (EINE Feldkante); hier nur Name, Eingabe und ↺. */
.gebirge-wert__preset {
    overflow: hidden;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    text-align: right;
    white-space: nowrap;
}

.gebirge-wert.is-abw .gebirge-wert__name {
    color: var(--color-text);
}

.gebirge-wert__eingabe {
    display: grid;
    grid-template-columns: 5ch minmax(0, 1fr) 7ch;
    gap: var(--space-4);
    align-items: center;
}

/* Mit Einheit (Prozent) ohne Preset-Spalte: Regler, Feld und Einheit (Entwurf „Höhe und Erosion“, Vali 2026-10-25). */
.gebirge-wert__eingabe--einheit {
    grid-template-columns: minmax(0, 1fr) 7ch auto;
}

.gebirge-wert__einheit {
    color: var(--color-text-muted);
}

.gebirge-wert__eingabe input[type="range"] {
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-brown);
    cursor: pointer;
}

.gebirge-wert__zurueck {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.gebirge-wert__zurueck:hover {
    color: var(--color-link-hover);
}
</style>
