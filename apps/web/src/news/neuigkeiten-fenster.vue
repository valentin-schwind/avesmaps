<script setup lang="ts">
import { computed, watch } from "vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t } from "../i18n/i18n";
import NeuigkeitenListe from "./neuigkeiten-liste.vue";
import { useNeuigkeiten } from "./news";

/**
 * Das Fenster „Neuigkeiten“ (WI-0139 N5; Betreiber 2026-10-13: „es wird auch zeit bei "Production" den "Neuigkeiten-Kanal" fürs frontend
 * freizuschalten … das war für "normale" nutzer erklärt, was gerade auf avesmaps.de passiert“). Ein Blatt in der Breite `lesen`, wie
 * „Hinweise“ — diese Datei liefert nur den Inhalt, die Hülle ist `AvmFenster`.
 *
 * 🔴 **Aufbau wie Legacys Changelog-Dialog** (Betreiber 2026-10-14: „so anpassen, dass es zu dem design von legacy passt“): eine
 * **Einleitung** oben und eine **Fußzeile** unten — zwei Sätze, die sagen, was das hier ist und dass es weitergeht —, dazwischen die
 * Reihe mit Monatsband und Perlenkette (`neuigkeiten-liste.vue`, dort auch die Evidenz aus dem Discovery-Mirror).
 *
 * 🔴 **Gelesenes verschwindet nicht** (Betreiber 2026-10-13). Was seit dem letzten Öffnen dazukam, trägt die Marke „neu“; alles Frühere
 * steht leiser da, aber es steht da. Der Lesestand liegt allein im Browser (`news.ts`).
 */
const offen = defineModel<boolean>("offen", { required: true });
const neuigkeiten = useNeuigkeiten();

watch(offen, (jetzt) => void (jetzt && neuigkeiten.oeffnen()), { immediate: true });

const eintraege = computed(() => neuigkeiten.liste.value?.eintraege ?? []);
const leer = computed(() => !neuigkeiten.laedt.value && !neuigkeiten.fehler.value && eintraege.value.length === 0);
</script>

<template>
    <AvmFenster v-model:offen="offen" bauart="blatt" breite="lesen" :titel="t('news.title')" testid="news">
        <div class="neuigkeiten">
            <p class="einleitung">{{ t("news.intro") }}</p>

            <p v-if="neuigkeiten.laedt.value" class="zustand" data-testid="news-laedt">{{ t("news.loading") }}</p>
            <p v-else-if="neuigkeiten.fehler.value" class="zustand" role="alert" data-testid="news-fehler">
                {{ t("news.failed") }}
            </p>
            <p v-else-if="leer" class="zustand" data-testid="news-leer">{{ t("news.empty") }}</p>

            <NeuigkeitenListe v-else :eintraege="eintraege" :stand="neuigkeiten.stand.value" />
        </div>

        <template #fuss-hinweis>{{ t("news.foot") }}</template>
    </AvmFenster>
</template>

<style scoped>
/*
 * 🔴 Alles steht in EINEM Kind des Rumpfes, nicht als Geschwister darin: Der Rumpf ist eine Spalte mit `--divider-gap` zwischen seinen
 * Kindern, und dieser Abstand zwischen Einleitung und Reihe wäre ein anderer als der, den Legacys Blatt zeigt.
 */
.neuigkeiten {
    display: flow-root;
}

/* Die Einleitung sagt, was das hier ist; darunter die Trennlinie, dieselbe wie zwischen den Zonen des Fensters. */
.einleitung {
    margin: 0 0 var(--space-6);
    padding-bottom: var(--space-6);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.zustand {
    margin: 0;
    padding: var(--space-16) 0;
    color: var(--color-text-muted);
    text-align: center;
}
</style>
