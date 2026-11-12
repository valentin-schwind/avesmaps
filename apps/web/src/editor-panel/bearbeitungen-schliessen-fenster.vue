<script setup lang="ts">
import { computed, shallowRef, watch } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmFenster from "../fenster/avm-fenster.vue";
import { t, tPlural } from "../i18n/i18n";
import type { SchliessFrage } from "./fenster-verwaltung";

/**
 * „Trotzdem schließen?“ unter „Offene Bearbeitungen“ (WI-0231; Betreiber 2026-10-19 über die Editor-Orchestrierung, wörtlich: „pop up mit
 * ".... trotzdem schließen? ok, abbrechen"“): modal mittig über der Karte, auf der gemeinsamen Hülle (Hausregel „Fenster als Hülle“).
 *
 * - Das ✕ einer Zeile nennt ihren Titel, „Alle schließen“ die Zahl der Entwürfe.
 * - „OK“ verwirft: Die Fenster gehen zu, und ihre Entwürfe sind weg (`werkzeugfenster.verwirf`). „Abbrechen“, Escape und ✕ lassen alles,
 *   wie es ist.
 */
const frage = defineModel<SchliessFrage | undefined>("frage", { required: true });
const emit = defineEmits<{ verwirf: [ids: readonly string[]] }>();

// Der Satz bleibt stehen, solange das Fenster zugeht: Ohne ihn spränge der Text beim Schließen auf leer.
const gezeigt = shallowRef<SchliessFrage | undefined>(frage.value);
watch(frage, (jetzt) => {
    if (jetzt !== undefined) gezeigt.value = jetzt;
});

const offen = computed({
    get: () => frage.value !== undefined,
    set: (auf: boolean) => {
        if (!auf) frage.value = undefined;
    },
});
const titel = computed(() =>
    gezeigt.value?.titel === undefined
        ? t("editorPanel.bearbeitungen.alleSchliessen")
        : t("editorPanel.bearbeitungen.schliessen"),
);
const satz = computed(() => {
    const jetzt = gezeigt.value;
    if (jetzt === undefined) return "";
    return jetzt.titel === undefined
        ? tPlural("editorPanel.bearbeitungen.trotzdemAlle", jetzt.ids.length, { n: jetzt.ids.length })
        : t("editorPanel.bearbeitungen.trotzdem", { titel: jetzt.titel });
});

function ok(): void {
    const ids = frage.value?.ids ?? [];
    frage.value = undefined;
    emit("verwirf", ids);
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="entscheiden"
        :titel="titel"
        testid="bearbeitungen-schliessen"
    >
        <p class="schliessen__satz" data-testid="bearbeitungen-schliessen-satz">{{ satz }}</p>
        <template #fuss-haupt>
            <AvmKnopf testid="bearbeitungen-schliessen-abbrechen" @click="offen = false">{{
                t("ui.confirm.cancel")
            }}</AvmKnopf>
            <AvmKnopf art="gefahr" testid="bearbeitungen-schliessen-ok" @click="ok">{{
                t("editorPanel.bearbeitungen.trotzdem.ok")
            }}</AvmKnopf>
        </template>
    </AvmFenster>
</template>

<style scoped>
.schliessen__satz {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}
</style>
