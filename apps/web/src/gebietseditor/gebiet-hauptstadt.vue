<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import type { EditorPlaceRow } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import { ladeOrte } from "../editor-liste/orte-liste";
import { ortsAuswahl } from "../editor-liste/orts-auswahl";
import { formatNumber, t } from "../i18n/i18n";

/**
 * Die Hauptstadt eines Gebiets als Ortssuche (WI-0209 B2; EDIT-0005 §9 B2, E1; Muster „Verlagern …“ im Ortseditor,
 * `ortseditor/staette-verlagern-fenster.vue`): die Ortsliste des Editors (`ladeOrte`, einmal geladen) gefiltert über `ortsAuswahl`, nur
 * Orte auf der Karte. Gewählt wird mit einem Klick; „Keine“ nimmt die Hauptstadt weg. Der Herrschaftssitz bleibt nur lesend (E1).
 */
const props = defineProps<{
    /** Die Hauptstadt im Entwurf. */
    wert: { id: string; name: string } | undefined;
    kennung: string;
}>();
const emit = defineEmits<{ wahl: [ort: { id: string; name: string } | undefined] }>();

const offen = ref(false);
const suche = ref("");
const rows = ref<readonly EditorPlaceRow[]>([]);
const laedt = ref(false);
const ladeFehler = ref(false);
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
function oeffne(): void {
    offen.value = true;
    suche.value = "";
    if (rows.value.length === 0) void lade();
}
function waehle(ort: { id: string; name: string } | undefined): void {
    offen.value = false;
    emit("wahl", ort);
}
onBeforeUnmount(() => lauf?.abort());

const auswahl = computed(() =>
    ortsAuswahl(rows.value, suche.value, new Set(props.wert === undefined ? [] : [props.wert.id])),
);
const weitere = computed(() => auswahl.value.treffer - auswahl.value.zeilen.length);
</script>

<template>
    <div class="hauptstadt" :data-testid="`${kennung}-hauptstadt`">
        <div class="hauptstadt__zeile">
            <span>{{ wert?.name ?? "–" }}</span>
            <button
                v-if="!offen"
                type="button"
                class="hauptstadt__verweis"
                :data-testid="`${kennung}-hauptstadt-aendern`"
                @click="oeffne"
            >
                {{ t("gebietseditor.hauptstadt.aendern") }}
            </button>
            <button
                v-if="!offen && wert"
                type="button"
                class="hauptstadt__verweis"
                :data-testid="`${kennung}-hauptstadt-keine`"
                @click="waehle(undefined)"
            >
                {{ t("gebietseditor.hauptstadt.keine") }}
            </button>
            <button v-if="offen" type="button" class="hauptstadt__verweis" @click="offen = false">
                {{ t("gebietseditor.hauptstadt.abbrechen") }}
            </button>
        </div>
        <template v-if="offen">
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('gebietseditor.hauptstadt.suche')"
                :placeholder="t('gebietseditor.hauptstadt.suche')"
                :testid="`${kennung}-hauptstadt-suche`"
            />
            <p v-if="ladeFehler" class="hauptstadt__satz">{{ t("editorListe.fehler") }}</p>
            <p v-else-if="laedt" class="hauptstadt__satz">{{ t("editorListe.laedt") }}</p>
            <ul v-else class="hauptstadt__liste" :data-testid="`${kennung}-hauptstadt-liste`">
                <li v-for="zeile in auswahl.zeilen" :key="zeile.id">
                    <button
                        type="button"
                        class="hauptstadt__wahl"
                        :data-ort="zeile.id"
                        @click="waehle({ id: zeile.id, name: zeile.name })"
                    >
                        <span class="einzeilig">{{ zeile.name }}</span>
                        <small v-if="zeile.unterzeile" class="einzeilig">{{ zeile.unterzeile }}</small>
                    </button>
                </li>
            </ul>
            <p v-if="!laedt && weitere > 0" class="hauptstadt__satz">
                {{ t("gebietseditor.hauptstadt.weitere", { n: formatNumber(weitere, 0) }) }}
            </p>
        </template>
    </div>
</template>

<style scoped>
.hauptstadt {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.hauptstadt__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-8);
}

.hauptstadt__liste {
    display: grid;
    max-height: 220px;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.hauptstadt__wahl {
    display: grid;
    width: 100%;
    padding: var(--space-2) var(--space-6);
    border: 0;
    border-bottom: 1px solid var(--color-border);
    background: none;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.hauptstadt__wahl small {
    color: var(--color-text-muted);
}

.hauptstadt__wahl:hover {
    background: var(--color-active-wash);
}

.hauptstadt__wahl:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.hauptstadt__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.hauptstadt__verweis {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.hauptstadt__verweis:hover {
    color: var(--color-link-hover);
}

.hauptstadt__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
