<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import type { EditorPlaceRow, EditorSite } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { ladeOrte } from "../editor-liste/orte-liste";
import { ortsAuswahl } from "../editor-liste/orts-auswahl";
import AvmFenster from "../fenster/avm-fenster.vue";
import { formatNumber, t } from "../i18n/i18n";

/**
 * „Verlagern …“ einer belegten Stätte (WI-0128 E10b, EDIT-0001 G3): einen anderen Ort wählen, dann EINE Operation `site.relate`
 * mit dem Weg `hierher` am Zielort. Der Server schreibt die eine Zeile der Stätte um und trägt das Verlagern in den Verlauf
 * BEIDER Orte ein (`site-edit.ts`); hier wird nur gewählt.
 *
 * 🪤 Die Ortsliste kommt als Ganzes (`ladeOrte`) und wird hier gefiltert, wie in der Ortsauswahl der Medienverwaltung. Angeboten
 * werden nur Orte mit Kartenzeile (`orts-auswahl.ts`), und nie der Ort, an dem die Stätte schon liegt.
 */
const props = defineProps<{
    staette: EditorSite | undefined;
    /** Die `public_id` des Orts, an dem die Stätte heute liegt: Er steht nicht zur Wahl. */
    vonOrt: string;
    kennung: string;
    /** Die Operation am Zielort; bei Erfolg schließt das Fenster, sonst steht der Satz des Servers darin. */
    verlagere: (zielOrt: string) => Promise<string | undefined>;
}>();
const offen = defineModel<boolean>("offen", { required: true });

const rows = shallowRef<EditorPlaceRow[]>([]);
const laedt = ref(false);
const ladeFehler = ref(false);
const suche = ref("");
const gewaehlt = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<string | undefined>();
const gruppe = useId();

let lauf: AbortController | undefined;
async function lade(): Promise<void> {
    lauf?.abort();
    lauf = new AbortController();
    const signal = lauf.signal;
    laedt.value = true;
    ladeFehler.value = false;
    try {
        const liste = await ladeOrte(signal);
        if (!signal.aborted) rows.value = liste.rows;
    } catch {
        if (!signal.aborted) ladeFehler.value = true;
    } finally {
        if (!signal.aborted) laedt.value = false;
    }
}

watch(
    offen,
    (jetzt) => {
        if (!jetzt) {
            lauf?.abort();
            return;
        }
        gewaehlt.value = undefined;
        fehler.value = undefined;
        suche.value = "";
        if (rows.value.length === 0) void lade();
    },
    { immediate: true },
);
onBeforeUnmount(() => lauf?.abort());

const auswahl = computed(() => ortsAuswahl(rows.value, suche.value, new Set([props.vonOrt])));
const weitere = computed(() => auswahl.value.treffer - auswahl.value.zeilen.length);

const gesperrt = computed(() => {
    if (sendet.value) return t("ortseditor.verlagern.sendet");
    if (gewaehlt.value === undefined) return t("ortseditor.verlagern.waehlen");
    return undefined;
});

async function verlagern(): Promise<void> {
    const ziel = gewaehlt.value;
    if (ziel === undefined || gesperrt.value !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    const satz = await props.verlagere(ziel);
    sendet.value = false;
    if (satz === undefined) offen.value = false;
    else fehler.value = satz;
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('ortseditor.verlagern.titel')"
        :zusatz="staette ? t('ortseditor.verlagern.zusatz', { name: staette.name }) : undefined"
        :testid="`${kennung}-verlagern`"
    >
        <div class="verlagern">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert">{{ t("ortseditor.fehler") }}</AvmHinweis>
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('ortseditor.verlagern.suche')"
                :placeholder="t('ortseditor.verlagern.suche')"
                :testid="`${kennung}-verlagern-suche`"
            />
            <p v-if="laedt" class="verlagern__satz">{{ t("editorListe.laedt") }}</p>
            <p v-else-if="auswahl.zeilen.length === 0" class="verlagern__satz">
                {{ t("ortseditor.verlagern.leer") }}
            </p>
            <div
                v-else
                class="verlagern__liste"
                role="radiogroup"
                :aria-label="t('ortseditor.verlagern.titel')"
                :data-testid="`${kennung}-verlagern-liste`"
            >
                <label
                    v-for="zeile in auswahl.zeilen"
                    :key="zeile.id"
                    class="verlagern__zeile"
                    :class="{ 'is-gewaehlt': gewaehlt === zeile.id }"
                    :data-ort="zeile.id"
                    :data-testid="`${kennung}-verlagern-zeile`"
                >
                    <input v-model="gewaehlt" class="verlagern__radio" type="radio" :name="gruppe" :value="zeile.id" />
                    <span class="verlagern__text">
                        <span class="verlagern__name einzeilig">{{ zeile.name }}</span>
                        <span v-if="zeile.unterzeile" class="verlagern__unter einzeilig">{{ zeile.unterzeile }}</span>
                    </span>
                </label>
            </div>
            <p v-if="weitere > 0" class="verlagern__satz">
                {{ t("ortseditor.verlagern.weitere", { n: formatNumber(auswahl.treffer, 0) }) }}
            </p>
            <AvmHinweis v-if="fehler" ton="gefahr" rolle="alert" :testid="`${kennung}-verlagern-fehler`">{{
                fehler
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf :testid="`${kennung}-verlagern-abbrechen`" @click="offen = false">{{
                t("ortseditor.verlagern.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" :testid="`${kennung}-verlagern-los`" @click="verlagern">{{
                t("ortseditor.verlagern.los")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.verlagern {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.verlagern__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.verlagern__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 46vh;
    overflow-y: auto;
}

/* Eine Zeile wie jede Zeile des Hauses: durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.verlagern__zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition:
        background-color 120ms ease,
        border-color 120ms ease;
}

.verlagern__zeile:hover {
    background: var(--color-hover-wash);
}

.verlagern__zeile.is-gewaehlt {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.verlagern__zeile:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.verlagern__radio {
    flex: none;
    margin: 0;
}

.verlagern__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.verlagern__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.verlagern__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

@media (prefers-reduced-motion: reduce) {
    .verlagern__zeile {
        transition: none;
    }
}
</style>
