<script setup lang="ts">
/**
 * Die Vorschau unter einer Zeile der Werte von „19 (Test)“ (WI-0249, Entwurf zum Ausprobieren; Betreiber 2026-10-24: „ich glaub die editoren
 * wollen doch nur ‚Schema‘. direkt den slider im schema wirken zu sehen ist außerordentlich hilfreich“):
 *
 * - **Schema:** feste Formen im Querschnitt, in der Seitenansicht oder von oben, die sich mit dem Wert verformen (`hoehenmodell-vorschau-schema.ts`
 *   und `…-form.ts`). Wo die Rechnung eine Formel kennt, ist es dieselbe im Eindimensionalen; sonst ehrlich vereinfacht, und die Unterschrift sagt es.
 *   Gestrichelt steht dasselbe ohne den Wert, was der Wert verändert, ist dazwischen gefüllt.
 * - **Ziehen:** Der Regler stellt denselben Wert wie das Feld darüber (ungespeichert, ↺ und Verwerfen gelten wie beim Tippen). Die Zeichnung
 *   folgt dem Regler sofort; ins Feld geht der Wert gedrosselt, damit die Seite beim Ziehen nicht jedes Mal alle Zeilen neu rechnet. Eine
 *   Wahl ohne Schieber (das Grundmuster) zeigt dieselbe Zeichnung, ohne Regler.
 *
 * Rechts neben dem Schema, am Telefon darunter, steht ein Satz in Alltagssprache, der den Wert beim Namen nennt.
 */
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { formatDecimal, t, type MessageKey } from "../i18n/i18n";
import type { VorschauModell } from "./hoehenmodell-vorschau";
import HoehenmodellVorschauZeichnung from "./hoehenmodell-vorschau-zeichnung.vue";

const props = defineProps<{
    modell: VorschauModell;
    /** Gesperrt ohne eigenen Satz (er steht einmal oben): der Regler steht, die Zeichnung zeigt den Wert. */
    gesperrt: string | undefined;
    telefon: boolean;
    /** Kleiner gezeichnet, für die lange Liste der einzelnen Werte. */
    kompakt?: boolean | undefined;
}>();
const emit = defineEmits<{ tippe: [text: string] }>();

/** Der Wert während des Ziehens; sonst der der Zeile. */
const lokal = ref<number | null>(null);
const wert = computed(() => lokal.value ?? props.modell.wert);

const figur = computed(() => props.modell.schema(wert.value));
const satz = computed(() => props.modell.satz?.(wert.value) ?? "");

/** Drosselung des Eintrags ins Feld: alle Zeilen der Seite rechnen sich mit jedem neuen Wert neu. */
const EINTRAG_NACH_MS = 120;
let eintrag: ReturnType<typeof setTimeout> | undefined;

const text = (v: number): string => formatDecimal(v, 6);

function trage(v: number): void {
    clearTimeout(eintrag);
    eintrag = undefined;
    emit("tippe", text(v));
}

function ziehen(ereignis: Event): void {
    const v = Number((ereignis.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    lokal.value = v;
    eintrag ??= setTimeout(() => trage(lokal.value ?? v), EINTRAG_NACH_MS);
}

function loslassen(ereignis: Event): void {
    const v = Number((ereignis.target as HTMLInputElement).value);
    if (Number.isFinite(v)) trage(v);
    // Erst nach dem nächsten Zeichnen zurück: Bis dahin trägt die Zeile den Wert noch nicht.
    void nextTick(() => {
        lokal.value = null;
    });
}

/** Die Standardmarke (Guide §13.25): ein Dreieck unter der Bahn am Wert der Datei. */
const markeAnteil = computed(() => {
    const d = props.modell.datei;
    if (props.modell.zug === null) return null;
    const { min, max } = props.modell.zug;
    if (d === null || max <= min || d < min || d > max) return null;
    return (d - min) / (max - min);
});

onBeforeUnmount(() => {
    clearTimeout(eintrag);
});

const unterschriftSchema = computed(() =>
    t(`admin.terrain.test.vorschau.schema.${props.modell.unterschrift.schema}` as MessageKey),
);
const unterschriftVorher = computed(() =>
    props.modell.unterschrift.vorher === null
        ? null
        : t(`admin.terrain.test.vorschau.vorher.${props.modell.unterschrift.vorher}` as MessageKey),
);
const reglerName = computed(() => t("admin.terrain.test.vorschau.regler", { name: props.modell.name }));
const dateiHinweis = computed(() =>
    props.modell.datei === null
        ? undefined
        : t("admin.terrain.test.vorschau.reglerDatei", { wert: formatDecimal(props.modell.datei, 6) }),
);
</script>

<template>
    <div
        class="vorschau"
        :class="{ 'vorschau--telefon': props.telefon, 'vorschau--kompakt': props.kompakt === true }"
        role="group"
        :aria-label="t('admin.terrain.test.vorschau.region', { name: props.modell.name })"
        :data-testid="`hoehenmodell-vorschau-${props.modell.key}`"
    >
        <figure class="vorschau__bild" :data-testid="`hoehenmodell-vorschau-schema-${props.modell.key}`">
            <HoehenmodellVorschauZeichnung
                :figur="figur"
                :beschriftung="`${t('admin.terrain.test.vorschau.art.schema')}: ${unterschriftSchema}`"
                :testid="`hoehenmodell-vorschau-schema-bild-${props.modell.key}`"
            />
            <figcaption
                class="vorschau__unterschrift"
                :data-testid="`hoehenmodell-vorschau-unterschrift-${props.modell.key}`"
            >
                <span class="vorschau__titel">{{ t("admin.terrain.test.vorschau.art.schema") }}</span>
                {{ unterschriftSchema }}
                <span v-if="unterschriftVorher !== null">{{ unterschriftVorher }}</span>
            </figcaption>
        </figure>

        <div class="vorschau__rechts">
            <div v-if="props.modell.zug !== null" class="vorschau__bahn">
                <input
                    type="range"
                    class="vorschau__regler"
                    :min="props.modell.zug.min"
                    :max="props.modell.zug.max"
                    :step="props.modell.zug.schritt"
                    :value="wert"
                    :disabled="props.gesperrt !== undefined"
                    :aria-label="reglerName"
                    :title="dateiHinweis === undefined ? reglerName : `${reglerName} · ${dateiHinweis}`"
                    :data-testid="`hoehenmodell-vorschau-regler-${props.modell.key}`"
                    @input="ziehen"
                    @change="loslassen"
                />
                <span
                    v-if="markeAnteil !== null"
                    class="vorschau__marke"
                    :style="{ '--marke': String(markeAnteil) }"
                    aria-hidden="true"
                    :data-testid="`hoehenmodell-vorschau-datei-${props.modell.key}`"
                ></span>
            </div>
            <p
                v-if="satz !== ''"
                class="vorschau__satz"
                :data-testid="`hoehenmodell-vorschau-satz-${props.modell.key}`"
            >
                {{ satz }}
            </p>
        </div>
    </div>
</template>

<style scoped>
.vorschau {
    grid-column: 1 / -1;
    display: grid;
    /* Schema und Schieber nebeneinander, solange jedes mindestens 17rem bekommt; sonst (schmales Fenster, Telefon) untereinander. */
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
    gap: var(--space-6) var(--space-12);
    align-items: start;
    min-width: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

.vorschau--telefon {
    grid-template-columns: minmax(0, 1fr);
}

.vorschau--kompakt {
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 13rem), 1fr));
}

.vorschau__rechts {
    display: grid;
    gap: var(--space-6);
    align-content: start;
    min-width: 0;
}

.vorschau__bahn {
    position: relative;
    min-width: 0;
    padding-bottom: var(--space-4);
}

/* Der Regler ist ein natives Bedienelement im Akzent des Editors (Guide §13.25). */
.vorschau__regler {
    display: block;
    width: 100%;
    margin: 0;
    accent-color: var(--color-accent-brown);
    cursor: pointer;
}

.vorschau__regler:disabled {
    cursor: not-allowed;
}

/* Die Standardmarke: ein Dreieck unter der Bahn am Wert der Datei; der Daumen ist rund 16 px breit, seine Mitte läuft nur über die Bahn minus diese Breite. */
.vorschau__marke {
    position: absolute;
    bottom: 0;
    left: calc(var(--space-6) + var(--marke) * (100% - 2 * var(--space-6)));
    width: 0;
    height: 0;
    border-right: var(--space-4) solid transparent;
    border-bottom: var(--space-4) solid var(--color-text-muted);
    border-left: var(--space-4) solid transparent;
    transform: translateX(-50%);
    pointer-events: none;
}

.vorschau__bild {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    min-width: 0;
    max-width: 26rem;
}

.vorschau--kompakt .vorschau__bild {
    max-width: 17rem;
}

.vorschau__unterschrift {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.vorschau__titel {
    color: var(--color-text);
    font-weight: var(--font-weight-regular);
    margin-right: var(--space-4);
}

.vorschau__satz {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
}
</style>
