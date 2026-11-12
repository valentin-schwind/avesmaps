<script setup lang="ts">
import { ref } from "vue";
import type { ReadConfirmation } from "../auth/bestaetigen";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { t } from "../i18n/i18n";
import DiscordVerwaltung from "./discord-verwaltung.vue";
import { createDiscordVerwaltung } from "./discord";
import type { NeuigkeitenPflege } from "./pflege";
import VerwaltungNeuigkeiten from "./verwaltung-neuigkeiten.vue";

/**
 * Systemsteuerung › Neuigkeiten mit zwei Reitern (WI-0255; Betreiberauftrag 2026-10-25: „ein zusätzliches Navtab „Discord“, ohne die
 * vorhandene Neuigkeiten-Verwaltung zu verändern“): „Website“ ist die bisherige Pflege, unverändert (`verwaltung-neuigkeiten.vue`),
 * „Discord“ der Tagesbericht (`discord-verwaltung.vue`). Die Reiter wechseln, was man sieht; der Discord-Reiter lädt erst, wenn man ihn wählt.
 */
const props = defineProps<{ pflege: NeuigkeitenPflege; lesen?: ReadConfirmation | undefined }>();

type Reiter = "website" | "discord";
const aktiv = ref<Reiter>("website");
const reiter = [
    { id: "website" as const, name: t("admin.news.tab.website") },
    { id: "discord" as const, name: t("admin.news.tab.discord") },
];
const discord = createDiscordVerwaltung(props.lesen === undefined ? {} : { reads: props.lesen });
</script>

<template>
    <div class="neuigkeiten-reiter">
        <FensterReiter v-model="aktiv" :reiter="reiter" :beschriftung="t('admin.news.tabs')" kennung="neuigkeiten" />
        <div
            v-if="aktiv === 'website'"
            id="neuigkeiten-inhalt-website"
            role="tabpanel"
            aria-labelledby="neuigkeiten-reiter-website"
        >
            <VerwaltungNeuigkeiten :pflege="props.pflege" />
        </div>
        <div v-else id="neuigkeiten-inhalt-discord" role="tabpanel" aria-labelledby="neuigkeiten-reiter-discord">
            <DiscordVerwaltung :discord="discord" />
        </div>
    </div>
</template>

<style scoped>
.neuigkeiten-reiter {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}
</style>
