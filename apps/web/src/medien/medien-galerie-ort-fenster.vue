<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import type { EditorPlaceRow, MediaGalleryDetail } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { ladeOrte } from "../editor-liste/orte-liste";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { istAbbruch } from "./medien-client";
import { galerieOrte } from "./medien-galerien-modell";
import { kopfFolge, ortsTreffer, ortsZeilen } from "./medien-galerie-orte-modell";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import { zahl } from "./medien-text";

/**
 * „Diese Galerie an einen Ort binden“ (WI-0068 P6): eine Suche über die Ortsliste des Editors, dann `gallery.bind`.
 *
 * 🔴 **Erst mit einem Ort sieht ein Besucher die Bilder** (Betreiber 2026-10-13, Variante A). Das steht im Zusatz des Fensters,
 * weil es der Grund ist, aus dem jemand hier steht.
 *
 * 🪤 **Die Liste kommt als Ganzes** (`ladeOrte`, rund 5.000 Zeilen gepackt, mit ETag) und wird hier gefiltert. Eine eigene
 * Suchroute wäre eine zweite Wahrheit darüber, was ein Ort ist — und die Ortsliste ist ohnehin das, was der Editor zeigt.
 *
 * 🔴 **EIN Titelbild ODER EINE Galerie** (WI-0219): Wer einen Ort mit Titelbild wählt, bekommt dessen Plätze nachgeladen. Hängt
 * dort eine Galerie, steht „Binden“ gesperrt mit Grund (ersetzen geht im Ortseditor); hängt ein Einzelbild, sagt ein Hinweis, dass
 * es gelöst wird. Ohne das liefe der Klick in einen 409, den niemand vorhersehen konnte.
 */
const props = defineProps<{
    galerie: MediaGalleryDetail;
    operationen?: MedienOperationen | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [] }>();

const ops = props.operationen ?? createMedienOperationen();

const rows = shallowRef<EditorPlaceRow[]>([]);
const laedt = ref(false);
const suche = ref("");
const gewaehlt = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const ladeFehler = ref<string | undefined>();
const handlung = new Handlung();
const gruppe = useId();

let lauf: AbortController | undefined;
let kopfLauf: AbortController | undefined;
/** Was Binden am gewählten Ort tut, sobald seine Plätze da sind; `"laedt"` bis dahin. */
const kopf = shallowRef<ReturnType<typeof kopfFolge> | "laedt">({});

async function lade(): Promise<void> {
    lauf?.abort();
    lauf = new AbortController();
    const signal = lauf.signal;
    laedt.value = true;
    ladeFehler.value = undefined;
    try {
        const liste = await ladeOrte(signal);
        if (!signal.aborted) rows.value = liste.rows;
    } catch (error) {
        if (!istAbbruch(error)) ladeFehler.value = operationsFehler(error).text;
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

onBeforeUnmount(() => {
    lauf?.abort();
    kopfLauf?.abort();
});

/** An welchen Orten diese Galerie schon hängt: dort ist die Bindung keine Handlung mehr. */
const gebunden = computed(() => new Set(galerieOrte(props.galerie).map((bindung) => bindung.subject.id)));
const zeilen = computed(() => ortsZeilen(rows.value, suche.value, { gebunden: gebunden.value }));
const treffer = computed(() => ortsTreffer(rows.value, suche.value));
const weitere = computed(() => treffer.value - zeilen.value.length);

watch(gewaehlt, async (placeId) => {
    kopfLauf?.abort();
    kopf.value = {};
    const zeile = zeilen.value.find((eintrag) => eintrag.id === placeId);
    if (placeId === undefined || zeile?.titelbild === undefined) return;
    kopfLauf = new AbortController();
    const signal = kopfLauf.signal;
    kopf.value = "laedt";
    try {
        const plaetze = await ops.plaetze("place", placeId, signal);
        if (!signal.aborted) kopf.value = kopfFolge(plaetze.header);
    } catch (error) {
        // Ohne Plätze entscheidet der Server; der Fehler steht da, Binden bleibt möglich.
        if (!signal.aborted && !istAbbruch(error)) {
            kopf.value = {};
            fehler.value = operationsFehler(error);
        }
    }
});

const gesperrt = computed(() => {
    if (sendet.value) return t("medien.bearbeiten.sendet");
    if (gewaehlt.value === undefined) return t("medien.galerien.ortWaehlen");
    if (kopf.value === "laedt") return t("medien.treffer.laedt");
    return zeilen.value.find((zeile) => zeile.id === gewaehlt.value)?.gesperrt ?? kopf.value.gesperrt;
});
const hinweis = computed(() => (kopf.value === "laedt" ? undefined : (kopf.value.gesperrt ?? kopf.value.hinweis)));

async function binden(): Promise<void> {
    const placeId = gewaehlt.value;
    if (placeId === undefined || gesperrt.value !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            ops.galerieBinden({
                operationId,
                galleryId: props.galerie.id,
                baseRevision: props.galerie.revision,
                placeId,
            }),
        );
        offen.value = false;
        emit("fertig");
    } catch (error) {
        fehler.value = operationsFehler(error);
    } finally {
        sendet.value = false;
    }
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="t('medien.galerien.ortTitel')"
        :zusatz="t('medien.galerien.ortZusatz')"
        testid="medien-galerie-ort-fenster"
    >
        <div class="galerie-ort">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" testid="medien-galerie-ort-ladefehler">{{
                ladeFehler
            }}</AvmHinweis>
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('medien.galerien.ortSuche')"
                :placeholder="t('medien.galerien.ortSuche')"
                testid="medien-galerie-ort-suche"
            />
            <p v-if="laedt" class="galerie-ort__satz">{{ t("medien.treffer.laedt") }}</p>
            <p v-else-if="zeilen.length === 0" class="galerie-ort__satz" data-testid="medien-galerie-ort-leer">
                {{ t("medien.galerien.ortLeer") }}
            </p>
            <div
                v-else
                class="galerie-ort__liste"
                role="radiogroup"
                :aria-label="t('medien.galerien.ortTitel')"
                data-testid="medien-galerie-ort-liste"
            >
                <label
                    v-for="zeile in zeilen"
                    :key="zeile.id"
                    class="galerie-ort__zeile"
                    :class="{ 'is-gewaehlt': gewaehlt === zeile.id, 'is-gesperrt': zeile.gesperrt !== undefined }"
                    :data-ort="zeile.id"
                    data-testid="medien-galerie-ort-zeile"
                >
                    <input
                        v-model="gewaehlt"
                        class="galerie-ort__radio"
                        type="radio"
                        :name="gruppe"
                        :value="zeile.id"
                        :disabled="zeile.gesperrt !== undefined"
                    />
                    <span class="galerie-ort__text">
                        <span class="galerie-ort__name einzeilig">{{ zeile.name }}</span>
                        <span v-if="zeile.unterzeile" class="galerie-ort__unter einzeilig">{{ zeile.unterzeile }}</span>
                    </span>
                    <span v-if="zeile.gesperrt ?? zeile.titelbild" class="galerie-ort__grund">{{
                        zeile.gesperrt ?? zeile.titelbild
                    }}</span>
                </label>
            </div>
            <p v-if="weitere > 0" class="galerie-ort__satz" data-testid="medien-galerie-ort-weitere">
                {{ t("medien.galerien.ortWeitere", { n: zahl(treffer) }) }}
            </p>
            <AvmHinweis v-if="hinweis" testid="medien-galerie-ort-hinweis">{{ hinweis }}</AvmHinweis>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-galerie-ort-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-galerie-ort-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" testid="medien-galerie-ort-binden" @click="binden">{{
                t("medien.galerien.ortBinden")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.galerie-ort {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.galerie-ort__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.galerie-ort__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 46vh;
    overflow-y: auto;
}

/* Eine Zeile wie jede Zeile des Hauses: durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.galerie-ort__zeile {
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

.galerie-ort__zeile:hover:not(.is-gesperrt) {
    background: var(--color-hover-wash);
}

.galerie-ort__zeile.is-gewaehlt {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.galerie-ort__zeile:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.galerie-ort__zeile.is-gesperrt {
    cursor: default;
}

.galerie-ort__radio {
    flex: none;
    margin: 0;
}

.galerie-ort__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.galerie-ort__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.galerie-ort__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der Grund steht an der Zeile, nicht erst nach dem Klick: Auskunft, nie Schutz (das entscheidet der Server). */
.galerie-ort__grund {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    text-align: right;
}

@media (prefers-reduced-motion: reduce) {
    .galerie-ort__zeile {
        transition: none;
    }
}
</style>
