<script setup lang="ts">
/**
 * „Karten herunterladen“ (WI-0280, Bauvorlage Mockup Fassung 1, Vali 2026-11-05 „ja bauen“): Karten anhaken, als ZIP laden, per Token-Link oder API-Schlüssel weitergeben.
 * Aus dem Hauptmenü, also modal wie die Medien; ein Blatt mit stehenden Reitern, damit die Mitte des Bildschirms beim Wechsel stehen bleibt.
 */
import { computed, onMounted, ref } from "vue";
import { useKartenExport } from "./karten-export";
import KartenApi from "./karten-api.vue";
import KartenAuswahl from "./karten-auswahl.vue";
import KartenZugaenge from "./karten-zugaenge.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import VerwaltungLadeproblem from "../auth/verwaltung-ladeproblem.vue";
import { t } from "../i18n/i18n";

const offen = defineModel<boolean>("offen", { required: true });

type Reiter = "karten" | "links" | "api";
const reiter = ref<Reiter>("karten");
const sicht = useKartenExport();
const auswahl = ref<InstanceType<typeof KartenAuswahl> | null>(null);

onMounted(() => void sicht.lade());

const gueltig = (art: "links" | "schluessel"): number =>
    sicht.stand.value?.[art].filter((zugang) => zugang.zustand === "aktiv").length ?? 0;

const reiterListe = computed(() => [
    { id: "karten" as const, name: t("kartenExport.reiter.karten") },
    { id: "links" as const, name: t("kartenExport.reiter.links", { n: gueltig("links") }) },
    { id: "api" as const, name: t("kartenExport.reiter.api", { n: gueltig("schluessel") }) },
]);

function neuAnlegen(art: "link" | "schluessel"): void {
    reiter.value = "karten";
    // Erst im nächsten Bild steht die Auswahl wieder da.
    requestAnimationFrame(() => auswahl.value?.weitergeben(art));
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="verwaltung"
        :titel="t('kartenExport.titel')"
        testid="karten-export-fenster"
    >
        <template #reiter>
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('kartenExport.reiter.label')"
                kennung="karten-export"
            />
        </template>

        <VerwaltungLadeproblem
            :problems="sicht.probleme.value"
            :fehlt="sicht.unbestaetigt.value"
            testid="karten-export-fehler"
            @bestaetigen="sicht.bestaetige()"
            ><span>{{ t("kartenExport.ladeFehler") }}</span></VerwaltungLadeproblem
        >
        <template v-if="sicht.stand.value">
            <KartenAuswahl v-if="reiter === 'karten'" ref="auswahl" :sicht="sicht" :stand="sicht.stand.value" />
            <KartenZugaenge
                v-else-if="reiter === 'links'"
                art="link"
                :sicht="sicht"
                :stand="sicht.stand.value"
                @neu="neuAnlegen('link')"
            />
            <KartenApi v-else :sicht="sicht" :stand="sicht.stand.value" @neu="neuAnlegen('schluessel')" />
        </template>

        <template #fuss-hinweis>{{ t("kartenExport.fuss") }}</template>
    </AvmFenster>
</template>
