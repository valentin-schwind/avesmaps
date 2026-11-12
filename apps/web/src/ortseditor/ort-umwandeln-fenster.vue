<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { editorPlaceInLandmarkeUrl, type PlaceInLandmarkeReceipt, type PlaceRemoval } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import { sende } from "../fenster/entwurf-senden";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import { melde, type EntfernenApi } from "./ort-entfernen";
import { meldeUmgewandelt, umwandelnBitte } from "./ort-umwandeln";

/**
 * Die Rückfrage zu „In Landmarke umwandeln …“ (WI-0271 L8): ein Blatt mit dem Muster der Bestätigung, wie die Rückfragen der anderen Handgriffe. Was den Ort sperrt (innerorts, Hauptstadt), liest es vorab aus
 * derselben Vorschau wie „Ort entfernen“ und sagt es, statt erst den Server scheitern zu lassen. Die Art schlägt der Server vor; danach öffnet sich die Landmarke, dort steht die Wahl.
 */
const props = defineProps<{ api: Pick<EntfernenApi, "entfernenVorschau"> }>();

const offen = ref(false);
const vorschau = shallowRef<PlaceRemoval | undefined>(undefined);
const satz = ref<string | undefined>(undefined);
const laeuft = ref(false);
let abbruch: AbortController | undefined;

watch(umwandelnBitte, (bitte) => {
    if (bitte === undefined) return;
    offen.value = true;
    vorschau.value = undefined;
    satz.value = undefined;
    abbruch?.abort();
    abbruch = new AbortController();
    void props.api
        .entfernenVorschau(bitte.publicId, abbruch.signal)
        .then((ort) => {
            vorschau.value = ort ?? undefined;
            if (ort === null) satz.value = t("ortseditor.entfernen.ladefehler");
        })
        .catch(() => {
            satz.value = t("ortseditor.entfernen.ladefehler");
        });
});
watch(offen, (jetzt) => {
    if (!jetzt) abbruch?.abort();
});

/** Warum es nicht geht; dieselben Fälle lehnt der Server ab. */
const sperre = computed((): string | undefined => {
    const ort = vorschau.value;
    if (ort === undefined) return undefined;
    if (ort.innerortsVon !== undefined) return t("ortseditor.umwandeln.sperre.innerorts", { ort: ort.innerortsVon });
    if (ort.gebiete.length > 0) return t("ortseditor.umwandeln.sperre.gebiet", { gebiet: ort.gebiete[0]!.name });
    return undefined;
});

async function umwandeln(): Promise<void> {
    const ort = vorschau.value;
    if (ort === undefined) return;
    laeuft.value = true;
    satz.value = undefined;
    const antwort = await sende<PlaceInLandmarkeReceipt>(editorPlaceInLandmarkeUrl(ort.publicId), {
        operationId: globalThis.crypto.randomUUID(),
        baseRevision: ort.revision,
    });
    laeuft.value = false;
    if (!antwort.ok) {
        satz.value = antwort.fehler.message;
        return;
    }
    offen.value = false;
    melde(ort.publicId, "geloescht", antwort.quittung.mapRevision);
    meldeUmgewandelt(antwort.quittung.peakId, antwort.quittung.name);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="entscheiden"
        :titel="t('ortseditor.umwandeln.titel')"
        :zusatz="vorschau?.name"
        testid="ort-umwandeln"
    >
        <p v-if="vorschau === undefined && satz === undefined" class="umwandeln__leise" role="status">
            {{ t("ortseditor.entfernen.laedt") }}
        </p>
        <AvmHinweis v-if="sperre" ton="gefahr" rolle="alert" testid="ort-umwandeln-sperre">{{ sperre }}</AvmHinweis>
        <AvmHinweis v-if="satz" ton="gefahr" rolle="alert" testid="ort-umwandeln-fehler">{{ satz }}</AvmHinweis>
        <AvmBestaetigung
            v-if="vorschau && !sperre"
            :frage="t('ortseditor.umwandeln.frage', { name: vorschau.name })"
            :folge="
                t('ortseditor.umwandeln.folge', {
                    wegenden: String(vorschau.wegenden.length),
                })
            "
            :bestaetigen="t('ortseditor.umwandeln.bestaetigen')"
            :gesperrt="laeuft ? t('ortseditor.umwandeln.laeuft') : undefined"
            testid="ort-umwandeln-frage"
            @bestaetigen="void umwandeln()"
            @abbrechen="offen = false"
        />
    </AvmFenster>
</template>

<style scoped>
.umwandeln__leise {
    margin: 0;
    color: var(--color-text-muted);
}
</style>
