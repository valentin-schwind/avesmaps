<script setup lang="ts">
import { computed } from "vue";
import type { PhotoboxGalerien, PhotoboxOrtReisebilder } from "@avesmaps3d/shared";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import ReisebildZeilen from "../photobox/reisebild-zeilen.vue";
import { reisebilder as karte } from "../photobox/reisebilder-zustand";
import type { Geladen } from "./medien-daten";
import { photoboxKennung, photoboxTitel, photoboxUnterzeile } from "./medien-photobox-modell";

type Reisebild = PhotoboxOrtReisebilder["reisebilder"][number];

/**
 * Spalte 3 für das Medienobjekt „PhotoBox-Galerien“ (WI-0272): die Reisebilder der gewählten Galerie in der Reihenfolge der Freigabe. Prüfen, korrigieren und offline nehmen bleiben, wo sie sind: „Bild bearbeiten“
 * führt in den Korb „PhotoBox-Uploads › Erledigt“ an dieses Bild, wie das Panel des Ortseditors. „Zur Stelle“ schließt das Fenster, denn es liegt über der Karte.
 */
const props = defineProps<{
    galerie: Geladen<PhotoboxOrtReisebilder>;
    liste: PhotoboxGalerien | undefined;
    kennung: string | undefined;
    telefon: boolean;
}>();
const emit = defineEmits<{ bild: [id: string]; schliessen: []; erneut: []; zurueck: [] }>();

const zeile = computed(() => props.liste?.items.find((eintrag) => photoboxKennung(eintrag) === props.kennung));
const bilder = computed(() => props.galerie.wert?.reisebilder ?? []);

function zurStelle(bild: Reisebild): void {
    karte.markiere([bild.publicId]);
    karte.zeige(bild.publicId, bild.lage);
    emit("schliessen");
}
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="photoboxTitel(kennung, zeile)"
        :unterzeile="zeile ? photoboxUnterzeile(zeile) : undefined"
        testid="medien-spalte-photobox-galerie"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-photobox" @click="emit('zurueck')">{{
                t("medien.zurueck.photobox")
            }}</AvmKnopf>
        </template>

        <AvmHinweis
            v-if="galerie.fehler"
            :ton="galerie.fehler.ton"
            rolle="alert"
            testid="medien-photobox-galerie-fehler"
            >{{ galerie.fehler.text }}</AvmHinweis
        >
        <AvmKnopf
            v-if="galerie.fehler?.erneut"
            groesse="zeile"
            testid="medien-photobox-galerie-erneut"
            @click="emit('erneut')"
            >{{ t("medien.erneut") }}</AvmKnopf
        >
        <p v-if="kennung === undefined" class="photobox-galerie__satz" data-testid="medien-photobox-keine-gewaehlt">
            {{ t("medien.photobox.keineGewaehlt") }}
        </p>
        <p
            v-else-if="galerie.wert && bilder.length === 0"
            class="photobox-galerie__satz"
            data-testid="medien-photobox-galerie-leer"
        >
            {{ t("medien.photobox.leerFolge") }}
        </p>
        <ReisebildZeilen
            v-if="kennung !== undefined && bilder.length > 0"
            :bilder="bilder"
            kennung="medien-photobox"
            :medien-text="t('medien.photobox.bildBearbeiten')"
            @stelle="zurStelle"
            @medien="(bild: Reisebild) => emit('bild', bild.publicId)"
        />
    </FensterSpalte>
</template>

<style scoped>
.photobox-galerie__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
