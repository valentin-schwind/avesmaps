<script setup lang="ts">
import { computed } from "vue";
import type { PhotoboxGalerien } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { Geladen } from "./medien-daten";
import { photoboxKennung, photoboxName, photoboxUnterzeile } from "./medien-photobox-modell";
import MedienStapelZeile from "./medien-stapel-zeile.vue";
import { zahl } from "./medien-text";

/**
 * Spalte 2 für das Medienobjekt „PhotoBox-Galerien“ (WI-0272): die freigegebenen Reisebilder je Ort, in den Zeilen der Galerien. Nur lesend: Eine solche Galerie entsteht mit der Freigabe, also gibt es hier
 * weder „Neue Galerie“ noch eine Marke „Entwurf“. Die Suche geht über den Ortsnamen an den Server, wie bei den Galerien.
 */
const props = defineProps<{
    liste: Geladen<PhotoboxGalerien>;
    suche: string;
    gewaehlt: string | undefined;
    telefon: boolean;
}>();
const emit = defineEmits<{
    waehle: [kennung: string];
    suche: [wert: string];
    erneut: [];
    zurueck: [];
}>();

const zeilen = computed(() => props.liste.wert?.items ?? []);
const unterzeile = computed(() =>
    props.liste.laedt && props.liste.wert === undefined
        ? t("medien.treffer.laedt")
        : t("medien.galerien.unterzeile", { n: zahl(zeilen.value.length) }),
);
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('medien.objekt.photobox')"
        :unterzeile="unterzeile"
        testid="medien-spalte-photobox"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-arten" @click="emit('zurueck')">{{
                t("medien.zurueck.arten")
            }}</AvmKnopf>
        </template>
        <template #leiste>
            <AvmListenleiste
                :model-value="suche"
                :platzhalter="t('medien.galerien.ortSuche')"
                :beschriftung="t('medien.photobox.suche.label')"
                class="photobox__leiste"
                testid="medien-photobox"
                @update:model-value="(wert: string) => emit('suche', wert)"
            />
        </template>

        <AvmHinweis v-if="liste.fehler" :ton="liste.fehler.ton" rolle="alert" testid="medien-photobox-fehler">{{
            liste.fehler.text
        }}</AvmHinweis>
        <AvmKnopf v-if="liste.fehler?.erneut" groesse="zeile" testid="medien-photobox-erneut" @click="emit('erneut')">{{
            t("medien.erneut")
        }}</AvmKnopf>

        <p
            v-if="!liste.fehler && !liste.laedt && zeilen.length === 0"
            class="photobox__satz"
            data-testid="medien-photobox-leer"
        >
            {{ suche.trim() === "" ? t("medien.photobox.leer") : t("medien.galerien.ortLeer") }}
        </p>

        <ul
            v-if="zeilen.length > 0"
            class="photobox__liste"
            :aria-label="t('medien.objekt.photobox')"
            data-testid="medien-photobox-liste"
        >
            <li v-for="zeile in zeilen" :key="photoboxKennung(zeile)">
                <MedienStapelZeile
                    :name="photoboxName(zeile)"
                    :unterzeile="photoboxUnterzeile(zeile)"
                    :previews="zeile.previews"
                    :anzahl="zeile.bilder"
                    :gewaehlt="photoboxKennung(zeile) === gewaehlt"
                    :data-galerie="photoboxKennung(zeile)"
                    data-testid="medien-photobox-zeile"
                    @click="emit('waehle', photoboxKennung(zeile))"
                />
            </li>
        </ul>
        <p v-if="liste.laedt" class="photobox__satz" data-testid="medien-photobox-laedt">
            {{ t("medien.treffer.laedt") }}
        </p>
    </FensterSpalte>
</template>

<style scoped>
.photobox__leiste {
    flex: 1 1 auto;
    min-width: 0;
}

.photobox__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

.photobox__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
