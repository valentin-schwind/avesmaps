<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import KanalListe from "./kanal-liste.vue";
import KanalMelden from "./kanal-melden.vue";
import KanalVorgang from "./kanal-vorgang.vue";
import type { Kanal } from "./kanal";

/**
 * Der Eintrag „Claudia & Claudio“ der Systemsteuerung: der Betreiber-Kanal (WI-0124, KANAL-0001 §8, Blatt `review/wi-0124-mockup/`).
 * Drei Lagen im selben Eintrag: die Liste, „Vorgang melden“ und ein Vorgang. Sichtbar nur mit `use_operator_channel`; jede Anfrage prüft der
 * Server trotzdem.
 */
const props = defineProps<{ kanal: Kanal; telefon: boolean }>();
const lage = ref<"liste" | "melden" | "vorgang">("liste");

/** Neu rechnen im Takt der Glocke (60 s): ob Claudio abholt, und wie lange es her ist (Koordination 2026-10-11). */
const TAKT_MS = 60_000;
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => void props.kanal.takt(), TAKT_MS);
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
});

onMounted(() => {
    // Aus den Fix-Berichten kommt die OPS-ID mit: dann gleich den Vorgang, die Liste lädt beim Zurück.
    const ziel = props.kanal.nimmZiel();
    if (ziel === null) void props.kanal.ladeListe();
    else void oeffne(ziel);
});

// Ein Vorgang von außen (Glocke, Fix-Berichte, Backups), während der Kanal schon offen ist.
watch(
    () => props.kanal.ziel.value,
    (ziel) => {
        if (ziel === null) return;
        props.kanal.nimmZiel();
        void oeffne(ziel);
    },
);

async function oeffne(ops: string): Promise<void> {
    props.kanal.schliesse();
    // Beim Öffnen neu rechnen: Ein direkt geöffneter Vorgang (Glocke, Fix-Berichte) kennt die Liste nicht.
    void props.kanal.takt();
    await props.kanal.oeffne(ops);
    lage.value = "vorgang";
}

function zurListe(): void {
    lage.value = "liste";
    props.kanal.schliesse();
    void props.kanal.ladeListe();
}
</script>

<template>
    <KanalMelden
        v-if="lage === 'melden'"
        :kanal="props.kanal"
        :telefon="props.telefon"
        @abbrechen="zurListe()"
        @gemeldet="lage = 'vorgang'"
    />
    <KanalVorgang
        v-else-if="lage === 'vorgang' && props.kanal.vorgang.value !== null"
        :kanal="props.kanal"
        :telefon="props.telefon"
        @zurueck="zurListe()"
    />
    <KanalListe v-else :kanal="props.kanal" :telefon="props.telefon" @oeffne="oeffne" @melden="lage = 'melden'" />
</template>
