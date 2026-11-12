<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import type { MamGallerySummary } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { createMedienClient, istAbbruch, type MedienClient } from "../medien/medien-client";
import { galerieName, galerieUnterzeile } from "../medien/medien-galerien-modell";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "../medien/medien-operationen";

/**
 * „Galerie hinzufügen …“ im Ortseditor (WI-0219): EINE Galerie der Medienverwaltung als Titelbild des Orts. Betreiber 2026-10-17: „er kann
 * nicht mehr wie ein bild haben, EIN titelbild oder EINE Galerie“.
 *
 * - Die Liste ist die der Medienverwaltung (`MamGalleryList`), gesucht über Titel UND Ortsnamen; die Galerie, die hier schon hängt,
 *   steht gesperrt da, mit Grund.
 * - Die Wahl ersetzt, was bisher am Ort hängt (`gallery.bind`): ein Einzelbild wird gelöst, eine bisherige Galerie mit ihrer gesehenen
 *   Revision (`replaceRevision`). Das Alte bleibt in der Medienverwaltung unter „Bilder“ bzw. „Galerien“; die Bilder der Galerie
 *   bearbeitet man dort.
 * - Das Gegenstück in der Medienverwaltung ist `medien/medien-galerie-ort-fenster.vue` (ein Ort für eine Galerie).
 */
const props = defineProps<{
    ort: { id: string; name: string };
    /** Die Galerie, die schon am Ort hängt, und ihre gesehene Revision: Sie wird ersetzt. */
    bisher?: { id: string; revision: number } | undefined;
    operationen?: MedienOperationen | undefined;
    client?: MedienClient | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [] }>();

const ops = props.operationen ?? createMedienOperationen();
const client = props.client ?? createMedienClient();

const galerien = shallowRef<MamGallerySummary[]>([]);
const laedt = ref(false);
const suche = ref("");
const gewaehlt = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const ladeFehler = ref<string | undefined>();
const gruppe = useId();
let handlung = new Handlung();

let lauf: AbortController | undefined;
let uhr: ReturnType<typeof setTimeout> | undefined;

async function lade(): Promise<void> {
    lauf?.abort();
    const eigener = new AbortController();
    lauf = eigener;
    laedt.value = true;
    ladeFehler.value = undefined;
    try {
        const liste = await client.galerien(suche.value, eigener.signal);
        if (!eigener.signal.aborted) galerien.value = liste.items;
    } catch (error) {
        if (!istAbbruch(error)) ladeFehler.value = operationsFehler(error).text;
    } finally {
        if (!eigener.signal.aborted) laedt.value = false;
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
        handlung = new Handlung();
        void lade();
    },
    { immediate: true },
);
// Die Suche fragt den Server erst, wenn das Tippen ruht.
watch(suche, () => {
    if (uhr !== undefined) clearTimeout(uhr);
    uhr = setTimeout(() => void lade(), 250);
});
onBeforeUnmount(() => {
    lauf?.abort();
    if (uhr !== undefined) clearTimeout(uhr);
});

const schonDa = computed(() => new Set(props.bisher === undefined ? [] : [props.bisher.id]));
const gesperrt = computed(() => {
    if (sendet.value) return t("medien.bearbeiten.sendet");
    if (gewaehlt.value === undefined) return t("ortseditor.galerieWahl.waehlen");
    if (schonDa.value.has(gewaehlt.value)) return t("ortseditor.galerieWahl.schonDa");
    return undefined;
});

async function binden(): Promise<void> {
    const galerie = galerien.value.find((eintrag) => eintrag.id === gewaehlt.value);
    if (galerie === undefined || gesperrt.value !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            ops.galerieBinden({
                operationId,
                galleryId: galerie.id,
                baseRevision: galerie.revision,
                placeId: props.ort.id,
                ...(props.bisher === undefined ? {} : { replaceRevision: props.bisher.revision }),
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
        :titel="t('ortseditor.galerieWahl.titel', { ort: ort.name })"
        :zusatz="t('ortseditor.galerieWahl.zusatz')"
        testid="ortseditor-galerie-wahl"
    >
        <div class="galerie-wahl">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" testid="ortseditor-galerie-wahl-ladefehler">{{
                ladeFehler
            }}</AvmHinweis>
            <AvmEingabe
                v-model="suche"
                art="suche"
                :aria-label="t('ortseditor.galerieWahl.suche')"
                :placeholder="t('ortseditor.galerieWahl.suche')"
                testid="ortseditor-galerie-wahl-suche"
            />
            <p v-if="laedt && galerien.length === 0" class="galerie-wahl__satz">{{ t("medien.treffer.laedt") }}</p>
            <p v-else-if="galerien.length === 0" class="galerie-wahl__satz" data-testid="ortseditor-galerie-wahl-leer">
                {{ t("ortseditor.galerieWahl.leer") }}
            </p>
            <div
                v-else
                class="galerie-wahl__liste"
                role="radiogroup"
                :aria-label="t('ortseditor.galerieWahl.titel', { ort: ort.name })"
                data-testid="ortseditor-galerie-wahl-liste"
            >
                <label
                    v-for="galerie in galerien"
                    :key="galerie.id"
                    class="galerie-wahl__zeile"
                    :class="{ 'is-gewaehlt': gewaehlt === galerie.id, 'is-gesperrt': schonDa.has(galerie.id) }"
                    :data-galerie="galerie.id"
                    data-testid="ortseditor-galerie-wahl-zeile"
                >
                    <input
                        v-model="gewaehlt"
                        class="galerie-wahl__radio"
                        type="radio"
                        :name="gruppe"
                        :value="galerie.id"
                        :disabled="schonDa.has(galerie.id)"
                    />
                    <img
                        v-if="galerie.previews[0]"
                        class="galerie-wahl__daumen"
                        :src="galerie.previews[0].url"
                        alt=""
                        loading="lazy"
                    />
                    <span v-else class="galerie-wahl__daumen galerie-wahl__daumen--leer" aria-hidden="true"></span>
                    <span class="galerie-wahl__text">
                        <span class="galerie-wahl__name einzeilig">{{ galerieName(galerie) }}</span>
                        <span class="galerie-wahl__unter einzeilig">{{ galerieUnterzeile(galerie) }}</span>
                    </span>
                    <span v-if="schonDa.has(galerie.id)" class="galerie-wahl__grund">{{
                        t("ortseditor.galerieWahl.schonDa")
                    }}</span>
                </label>
            </div>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="ortseditor-galerie-wahl-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="ortseditor-galerie-wahl-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" testid="ortseditor-galerie-wahl-binden" @click="binden">{{
                t("ortseditor.galerieWahl.binden")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.galerie-wahl {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.galerie-wahl__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.galerie-wahl__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    max-height: 46vh;
    overflow-y: auto;
}

/* Eine Zeile wie jede Zeile des Hauses: durchsichtige Kante immer da, Zustände nach Guide §30.5. */
.galerie-wahl__zeile {
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

.galerie-wahl__zeile:hover:not(.is-gesperrt) {
    background: var(--color-hover-wash);
}

.galerie-wahl__zeile.is-gewaehlt {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

.galerie-wahl__zeile:focus-within {
    border-color: var(--color-accent);
    box-shadow: var(--focus-ring);
}

.galerie-wahl__zeile.is-gesperrt {
    cursor: default;
}

.galerie-wahl__radio {
    flex: none;
    margin: 0;
}

.galerie-wahl__daumen {
    flex: none;
    width: var(--avm-fenster-daumen);
    height: var(--avm-fenster-daumen);
    border-radius: var(--radius-sm);
    object-fit: cover;
}

.galerie-wahl__daumen--leer {
    border: 1px dashed var(--color-border);
}

.galerie-wahl__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.galerie-wahl__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
}

.galerie-wahl__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.galerie-wahl__grund {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    text-align: right;
}

@media (prefers-reduced-motion: reduce) {
    .galerie-wahl__zeile {
        transition: none;
    }
}
</style>
