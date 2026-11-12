<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { MAM_PAGE_LIMIT, type MamAssetSummary, type MediaGalleryDetail } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import MedienAuswahl from "./medien-auswahl.vue";
import { auswahlEintrag } from "./medien-auswahl-modell";
import { createMedienClient, istAbbruch, type MedienClient } from "./medien-client";
import { galerieEintraege } from "./medien-galerien-modell";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import { datum, zahl } from "./medien-text";

/**
 * „Bilder zu dieser Galerie hinzufügen“ (WI-0068 P6): dieselbe Auswahl wie bei Wappen und Titelbildern
 * (`medien-auswahl.vue`), aber gegen `gallery.add` statt gegen eine Ortsbindung.
 *
 * 🔴 **Die Liste fasst bytegleiche Werke zusammen** (`groupFiles`): Legacy legte je Verwendung ein eigenes Werk an, 1.025 Assets
 * teilen ihre Quelldatei (WI-0068 §21). Ohne die Zusammenfassung stünde dasselbe Bild hier mehrfach, und wer wählt, nähme
 * zufällig eines — die Dublette wanderte weiter in die Galerie. Gezeigt wird das älteste Werk der Gruppe; die Zeile sagt, wie
 * viele weitere dieselbe Datei tragen. Der Filter sitzt im Server, nicht hier: über Seitengrenzen hinweg greift nur er.
 *
 * 🔴 **Der Server weist eine Dublette ab** (`media_duplicate_file`), auch wenn jemand sie auf einem anderen Weg wählt: Zwei
 * Werke mit denselben Bytes in EINER Galerie sind zweimal dasselbe Bild. Die Eindeutigkeit der Tafel fängt das nicht, sie
 * prüft die Asset-Kennung.
 *
 * 🪤 **Hochladen führt hier nicht hinein.** Das Formular lädt hoch und bindet an einen ORT; eine Galerie ist kein Ort. Wer ein
 * neues Bild braucht, lädt es in der Medienverwaltung hoch und legt es dann hier hinein.
 */
const props = defineProps<{
    galerie: MediaGalleryDetail;
    operationen?: MedienOperationen | undefined;
    client?: MedienClient | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{ fertig: [] }>();

const ops = props.operationen ?? createMedienOperationen();
const client = props.client ?? createMedienClient();

const treffer = shallowRef<MamAssetSummary[]>([]);
const gesamt = ref(0);
const laedt = ref(false);
const suche = ref("");
const gewaehlt = ref<string | undefined>();
const sendet = ref(false);
const fehler = ref<OperationsFehler | undefined>();
const ladeFehler = ref<string | undefined>();
const handlung = new Handlung();

let lauf: AbortController | undefined;
let tippen: ReturnType<typeof setTimeout> | undefined;

async function ladeTreffer(anhaengen: boolean): Promise<void> {
    lauf?.abort();
    lauf = new AbortController();
    const signal = lauf.signal;
    laedt.value = true;
    ladeFehler.value = undefined;
    const q = suche.value.trim();
    try {
        const antwort = await client.suche(
            {
                type: "picture",
                groupFiles: true,
                // Ein Reisebild bleibt in seiner Rolle und lässt sich in keine Galerie legen (WI-0272 S5): Die Auswahl bietet es gar nicht erst an.
                ohneReisebilder: true,
                ...(q === "" ? {} : { q }),
                sort: "name",
                limit: MAM_PAGE_LIMIT.default,
                offset: anhaengen ? treffer.value.length : 0,
            },
            signal,
        );
        if (signal.aborted) return;
        treffer.value = anhaengen ? [...treffer.value, ...antwort.items] : antwort.items;
        gesamt.value = antwort.total;
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
        void ladeTreffer(false);
    },
    { immediate: true },
);

watch(suche, () => {
    if (tippen !== undefined) clearTimeout(tippen);
    tippen = setTimeout(() => void ladeTreffer(false), 250);
});

onBeforeUnmount(() => {
    lauf?.abort();
    if (tippen !== undefined) clearTimeout(tippen);
});

/** Was schon in der Galerie steht: die Zeile sagt „gebunden“ und der Knopf sperrt. */
const drin = computed(() => new Set(galerieEintraege(props.galerie).aktiv.map((eintrag) => eintrag.asset.id)));
const eintraege = computed(() => treffer.value.map((eintrag) => auswahlEintrag(eintrag, drin.value, datum)));

const gewaehltesWerk = computed(() => treffer.value.find((eintrag) => eintrag.id === gewaehlt.value));

/** Der Satz unter der Liste: was ein Klick tut, und was an dem gewählten Werk zu wissen ist. */
const satz = computed(() => {
    const werk = gewaehltesWerk.value;
    if (werk === undefined) return t("medien.galerien.bilderSatzLeer");
    if (drin.value.has(werk.id)) return t("medien.galerien.bilderSatzDrin");
    if (werk.sharedFileCount > 0) {
        return t("medien.galerien.bilderSatzGeteilt", { n: zahl(werk.sharedFileCount) });
    }
    return t("medien.galerien.bilderSatz");
});

const gesperrt = computed(() => {
    if (sendet.value) return t("medien.bearbeiten.sendet");
    if (gewaehlt.value === undefined) return t("medien.galerien.bilderWaehlen");
    if (drin.value.has(gewaehlt.value)) return t("medien.galerien.bilderSatzDrin");
    return undefined;
});

async function hinzufuegen(): Promise<void> {
    const assetId = gewaehlt.value;
    if (assetId === undefined || gesperrt.value !== undefined) return;
    sendet.value = true;
    fehler.value = undefined;
    try {
        await handlung.fuehreAus((operationId) =>
            ops.galerieBildHinzu({
                operationId,
                galleryId: props.galerie.id,
                baseRevision: props.galerie.revision,
                assetId,
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
        :titel="t('medien.galerien.bilderTitel')"
        :zusatz="t('medien.galerien.bilderZusatz')"
        testid="medien-galerie-bilder-fenster"
    >
        <div class="galerie-bilder">
            <AvmHinweis v-if="ladeFehler" ton="gefahr" rolle="alert" testid="medien-galerie-bilder-ladefehler">{{
                ladeFehler
            }}</AvmHinweis>
            <MedienAuswahl
                v-model:gewaehlt="gewaehlt"
                v-model:suche="suche"
                rolle="header"
                :eintraege="eintraege"
                :darf-hochladen="false"
                :laedt="laedt"
                :mehr="treffer.length < gesamt"
                :gesamt="gesamt"
                @mehr-laden="ladeTreffer(true)"
            />
            <p class="galerie-bilder__satz" data-testid="medien-galerie-bilder-satz">{{ satz }}</p>
            <AvmHinweis v-if="fehler" :ton="fehler.ton" rolle="alert" testid="medien-galerie-bilder-fehler">{{
                fehler.text
            }}</AvmHinweis>
        </div>
        <template #fuss-haupt>
            <AvmKnopf testid="medien-galerie-bilder-abbrechen" @click="offen = false">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
            <AvmKnopf art="gefuellt" :gesperrt="gesperrt" testid="medien-galerie-bilder-hinzu" @click="hinzufuegen">{{
                t("medien.galerien.bilderHinzu")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.galerie-bilder {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

.galerie-bilder__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
