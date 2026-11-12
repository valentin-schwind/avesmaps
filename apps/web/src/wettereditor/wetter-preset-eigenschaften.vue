<script setup lang="ts">
import { computed, onMounted, shallowRef } from "vue";
import { NAMELESS_MONTH, type DepartureMonth, type WetterJahrSpalte, type WetterPreset } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmFeld from "../controls/avm-feld.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import { klimaraster, klimazoneBei } from "../map/wetter/klimazonen";
import { formatNumber, t } from "../i18n/i18n";
import {
    einheitText,
    geltungText,
    istAngelegt,
    mitteSatz,
    monatUndTag,
    presetName,
    referenzWert,
    tagAus,
    tauschFrage,
    wertGruppen,
    zeitName,
    zeitVon,
    zeitpunktOptionen,
} from "./wetter-editor-modell";
import WetterWertzeile from "./wetter-wertzeile.vue";
import type { WetterTausch, WetterTauschHinweis } from "./wettereditor-steuerung";

/**
 * Die Eigenschaften eines Presets (WI-0288 Stufe 3; Probierseite `presetEigenschaften`): der Zeitpunkt mit Monat und Tag, darunter die
 * 15 jahreszeitlichen Werte in vier Abschnitten (Temperatur, Licht, Feuchte und Wolken, Wind und Wetterlagen), je mit Regler, Feld und ↺.
 *
 * - ↺ setzt an einem datierten Preset auf den Kartenstandard zurück, am unbestimmten auf die Vorgabe im Code (Probierseite); leise links
 *   steht, worauf.
 * - **Angelegte Presets** (Betreiber 2026-11-08) tragen unten „Preset entfernen …“ (rot, mit Rückfrage wie bei Icons); die 14 festen nicht,
 *   und ein angelegtes, das gerade der Kartenstandard ist, mit dem Grund im Titel gesperrt.
 * - Ein Tausch fragt erst (Idee B, `AvmBestaetigung` an der Stelle, an der gefragt wurde); danach steht der Satz mit „↺ Zurücknehmen“.
 */
const props = defineProps<{
    preset: WetterPreset;
    presets: readonly WetterPreset[];
    /** Wie viel dieses Preset gerade auf der Karte gilt (`undefined`: gar nicht). */
    anteil: number | undefined;
    tausch: WetterTausch | undefined;
    hinweis: WetterTauschHinweis | undefined;
    problem: string | undefined;
    /** Die Mitte der Karte in Karteneinheiten, für den Satz zur Schneefallgrenze (Klimazone dort, WI-0288 Stufe 5). */
    mitte: { x: number; z: number } | undefined;
    gesperrt: string | undefined;
    kennung: string;
    /** Die Frage „Preset entfernen?“ steht gerade. */
    entfernenFrage: boolean;
    /** Eine Handlung läuft (Anlegen, Entfernen); das Entfernen wartet dann. */
    laeuft: boolean;
}>();
const emit = defineEmits<{
    wert: [k: WetterJahrSpalte, wert: number];
    zeitpunkt: [ziel: number | null];
    tauschJa: [];
    tauschNein: [];
    zuruecknehmen: [];
    entfernenFragen: [];
    entfernenNein: [];
    entfernenJa: [];
}>();

const datum = computed(() => monatUndTag(props.preset.tag));
const monat = computed({
    get: (): string => datum.value?.monat ?? "",
    set(neu: string) {
        if (neu === "") {
            emit("zeitpunkt", null);
            return;
        }
        const ziel = neu as DepartureMonth;
        const alt = datum.value;
        // Wie in der Probierseite: zu den Namenlosen Tagen der 3., aus ihnen oder aus „unbestimmt“ der 15., sonst bleibt der Tag.
        const tag = ziel === NAMELESS_MONTH ? 3 : alt === null || alt.monat === NAMELESS_MONTH ? 15 : alt.tag;
        emit("zeitpunkt", tagAus(ziel, tag));
    },
});
function tagGeaendert(ereignis: Event): void {
    const eingabe = ereignis.target as HTMLInputElement;
    const alt = datum.value;
    const neu = Number(eingabe.value);
    if (alt === null || !Number.isFinite(neu) || eingabe.value.trim() === "") {
        if (alt !== null) eingabe.value = String(alt.tag);
        return;
    }
    emit("zeitpunkt", tagAus(alt.monat, neu));
}
const tageBis = computed(() => (datum.value?.monat === NAMELESS_MONTH ? 5 : 30));
/**
 * Wahl und Tag zeigen, was gilt: Fragt ein Tausch, steht dort die Wahl; wird er abgebrochen oder abgewiesen (unbestimmt bleibt), zeichnen
 * beide neu und stehen wieder auf dem Zeitpunkt des Presets. Ohne das bliebe die abgebrochene Wahl im Feld stehen.
 */
const auswahlStand = computed(
    () => `${String(props.preset.tag)}-${props.tausch === undefined ? "ruhe" : "frage"}-${props.problem ?? ""}`,
);
const unterzeile = computed(() =>
    props.preset.tag === null
        ? t("wettereditor.preset.kartenstandard")
        : `${t("wettereditor.zeile.preset")} · ${zeitName(zeitVon(props.preset.tag))}`,
);
const gilt = computed(() => geltungText(props.anteil));
/** Nur ein angelegtes Preset lässt sich entfernen, und nicht, solange es der Kartenstandard ist (der Server sagt sonst 409). */
const angelegt = computed(() => istAngelegt(props.preset));
const entfernenGrund = computed(
    () => props.gesperrt ?? (props.preset.tag === null ? t("wettereditor.preset.entfernen.bleibt") : undefined),
);
const frage = computed(() =>
    props.tausch === undefined
        ? undefined
        : tauschFrage(props.presets, props.tausch.id, props.tausch.mit, props.tausch.ziel),
);
const gruppen = wertGruppen();
const zurueckText = (k: WetterJahrSpalte, stellen: number, faktor: number, einheit: string): string => {
    const zahl = formatNumber(
        Math.round(referenzWert(props.presets, props.preset, k) * faktor * 10 ** stellen) / 10 ** stellen,
        stellen,
    );
    return props.preset.tag === null
        ? t("wettereditor.zurueck.vorgabe", { wert: `${zahl} ${einheit}` })
        : t("wettereditor.zurueck.standard", { wert: `${zahl} ${einheit}` });
};
// Die Klimazonen für die Schneefallgrenze der Wegfindung; bis sie da sind (oder ohne sie), rechnet der Satz aus der Temperatur.
const klima = shallowRef<Uint8Array | undefined>(undefined);
onMounted(() => {
    klimaraster()
        .then((raster) => {
            klima.value = raster;
        })
        .catch(() => undefined);
});
const mitte = computed(() =>
    props.mitte === undefined
        ? undefined
        : mitteSatz(
              props.preset.werte as Record<WetterJahrSpalte, number>,
              props.mitte,
              props.preset.tag,
              klimazoneBei(klima.value, props.mitte.x, props.mitte.z),
          ),
);
</script>

<template>
    <div class="wetter-eigenschaften" :data-testid="`${kennung}-preset`">
        <div class="wetter-eigenschaften__name">
            <strong
                >{{ presetName(preset) }}
                <AvmPille v-if="gilt" ton="erfolg" :testid="`${kennung}-gilt`">{{ gilt }}</AvmPille></strong
            >
            <small>{{ unterzeile }}</small>
        </div>
        <section class="wetter-eigenschaften__abschnitt">
            <h4 class="wetter-eigenschaften__titel">{{ t("wettereditor.zeitpunkt") }}</h4>
            <FensterFeldzeile :name="t('wettereditor.zeitpunkt')" :fuer="`${kennung}-monat`">
                <span
                    :key="auswahlStand"
                    class="wetter-eigenschaften__zeitpunkt"
                    :class="{ 'is-ohne-tag': datum === null }"
                >
                    <AvmAuswahl
                        :id="`${kennung}-monat`"
                        v-model="monat"
                        :optionen="zeitpunktOptionen()"
                        :gesperrt="gesperrt"
                        :testid="`${kennung}-monat`"
                    />
                    <AvmFeld
                        v-if="datum !== null"
                        type="number"
                        min="1"
                        :max="tageBis"
                        step="1"
                        :value="datum.tag"
                        :aria-label="t('wettereditor.zeitpunkt.tag')"
                        :title="t('wettereditor.zeitpunkt.tagTitel', { n: tageBis })"
                        :disabled="gesperrt !== undefined"
                        :data-testid="`${kennung}-tag`"
                        @change="tagGeaendert"
                    />
                </span>
            </FensterFeldzeile>
            <p class="wetter-eigenschaften__leise">
                {{
                    preset.tag === null ? t("wettereditor.zeitpunkt.satzUnbestimmt") : t("wettereditor.zeitpunkt.satz")
                }}
            </p>
            <AvmHinweis v-if="problem" ton="warnung" rolle="alert" :testid="`${kennung}-problem`">{{
                problem
            }}</AvmHinweis>
            <AvmBestaetigung
                v-if="frage"
                :frage="frage.frage"
                :folge="frage.folge"
                :bestaetigen="t('wettereditor.tausch.ja')"
                :testid="`${kennung}-tausch-frage`"
                @bestaetigen="emit('tauschJa')"
                @abbrechen="emit('tauschNein')"
            />
            <AvmHinweis v-else-if="hinweis" rolle="status" :testid="`${kennung}-tausch-hinweis`">
                {{ hinweis.satz }}
                <button
                    type="button"
                    class="wetter-eigenschaften__verweis"
                    :disabled="gesperrt !== undefined"
                    :data-testid="`${kennung}-tausch-zurueck`"
                    @click="emit('zuruecknehmen')"
                >
                    {{ t("wettereditor.tausch.zuruecknehmen") }}
                </button>
            </AvmHinweis>
        </section>
        <section
            v-for="gruppe in gruppen"
            :key="gruppe.id"
            class="wetter-eigenschaften__abschnitt"
            :data-testid="`${kennung}-abschnitt-${gruppe.id}`"
        >
            <h4 class="wetter-eigenschaften__titel">{{ t(`wettereditor.gruppe.${gruppe.id}`) }}</h4>
            <WetterWertzeile
                v-for="def in gruppe.werte"
                :key="def.id"
                :schluessel="def.id"
                :kennung="kennung"
                :name="t(`wettereditor.wert.${def.id}`)"
                :satz="t(`wettereditor.wert.${def.id}.satz`)"
                :min="def.min"
                :max="def.max"
                :schritt="def.schritt"
                :wert="preset.werte[def.id] ?? 0"
                :referenz="referenzWert(presets, preset, def.id)"
                :referenz-text="zurueckText(def.id, def.stellen, def.faktor ?? 1, einheitText(def.einheit))"
                :stellen="def.stellen"
                :faktor="def.faktor"
                :einheit="einheitText(def.einheit)"
                :gesperrt="gesperrt"
                @setze="(wert: number) => emit('wert', def.id, wert)"
                @zurueck="emit('wert', def.id, referenzWert(presets, preset, def.id))"
            />
            <p
                v-if="gruppe.id === 'temperatur' && mitte"
                class="wetter-eigenschaften__leise"
                :data-testid="`${kennung}-mitte`"
            >
                {{ mitte }}
            </p>
        </section>
        <section v-if="angelegt" class="wetter-eigenschaften__abschnitt">
            <AvmBestaetigung
                v-if="entfernenFrage"
                :frage="t('wettereditor.preset.entfernen.frage', { name: presetName(preset) })"
                :folge="t('wettereditor.preset.entfernen.folge')"
                :bestaetigen="t('wettereditor.entfernen.ja')"
                :gesperrt="laeuft ? t('wettereditor.laeuft') : undefined"
                :testid="`${kennung}-preset-entfernen-frage`"
                @bestaetigen="emit('entfernenJa')"
                @abbrechen="emit('entfernenNein')"
            />
            <span v-else class="wetter-eigenschaften__entfernen">
                <AvmKnopf
                    art="gefahr"
                    groesse="zeile"
                    :gesperrt="entfernenGrund"
                    :testid="`${kennung}-preset-entfernen`"
                    @click="emit('entfernenFragen')"
                >
                    {{ t("wettereditor.preset.entfernen") }}
                </AvmKnopf>
            </span>
        </section>
    </div>
</template>

<style scoped>
.wetter-eigenschaften {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.wetter-eigenschaften__name {
    display: grid;
    gap: var(--space-2);
}

.wetter-eigenschaften__name strong {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-strong);
    font-weight: normal;
    font-size: var(--font-size-subhead);
}

.wetter-eigenschaften__name small {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Wie die Abschnitte der Landschaft (`landschaftseditor-fenster.vue`), bis O3 sie in einen Baustein zieht. */
.wetter-eigenschaften__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.wetter-eigenschaften__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.wetter-eigenschaften__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wetter-eigenschaften__zeitpunkt {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7ch;
    gap: var(--space-4);
    align-items: center;
}

.wetter-eigenschaften__zeitpunkt.is-ohne-tag {
    grid-template-columns: minmax(0, 1fr);
}

.wetter-eigenschaften__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    transition: color 120ms ease;
}

.wetter-eigenschaften__verweis:hover {
    color: var(--color-link-hover);
}

.wetter-eigenschaften__verweis:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}

.wetter-eigenschaften__verweis:disabled {
    color: var(--color-disabled-text);
    cursor: default;
}

@media (prefers-reduced-motion: reduce) {
    .wetter-eigenschaften__verweis {
        transition: none;
    }
}
</style>
