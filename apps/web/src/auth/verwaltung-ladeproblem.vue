<script setup lang="ts">
/**
 * Warum ein Bereich der Verwaltung leer bleibt (Hotfix 2026-10-10, Betreiber: „sollte mir das gesagt werden“). Fehlte nur die
 * Bestätigung (die Person hat „Kurz bestätigen“ abgebrochen), ist das keine Störung: Die Zeile sagt ruhig, WAS fehlt (zweiter
 * Faktor, Passkey, Bestätigung), und der Knopf „Bestätigen“ bietet das gemeinsame Fenster erneut an (`bestaetigen.ts`). Jede andere
 * Ablehnung bleibt eine rote Meldung mit ihrem Satz; der Slot steht davor (etwa „Der Betriebszustand ließ sich nicht laden.“).
 */
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import type { Need } from "./bestaetigen";
import type { Phrase } from "./formular";

defineProps<{
    problems: readonly Phrase[] | undefined;
    /** Was fehlt, wenn der Bereich nur ohne Bestätigung leer blieb. */
    fehlt: Need | null | undefined;
    testid?: string | undefined;
}>();
const emit = defineEmits<{ bestaetigen: [] }>();
</script>

<template>
    <AvmHinweis v-if="fehlt" ton="warnung" rolle="status" :testid="testid">
        <span class="ladeproblem">
            <span class="ladeproblem__satz">{{ t(`admin.unconfirmed.${fehlt}`) }}</span>
            <AvmKnopf
                groesse="zeile"
                :testid="testid === undefined ? undefined : `${testid}-bestaetigen`"
                @click="emit('bestaetigen')"
                >{{ t("admin.unconfirmed.confirm") }}</AvmKnopf
            >
        </span>
    </AvmHinweis>
    <AvmHinweis v-else-if="problems !== undefined && problems.length > 0" ton="gefahr" rolle="alert" :testid="testid">
        <slot />
        <span v-for="problem in problems" :key="problem.key" class="ladeproblem__zeile">{{
            t(problem.key, problem.params)
        }}</span>
    </AvmHinweis>
</template>

<style scoped>
.ladeproblem {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.ladeproblem__satz {
    flex: 1 1 auto;
    min-width: 0;
}

.ladeproblem__zeile {
    display: block;
}
</style>
