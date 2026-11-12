<script setup lang="ts">
/**
 * Was eine Handlung der Verwaltung zurückgibt, an der Stelle, an der gehandelt wurde (WI-0120 A10): eine Ablehnung als Satz, ein
 * Konflikt mit Wer und Wann (ADR-0020), ein frisch ausgestellter Link im Kopierfeld. 🔴 Ein Link steht nur in der ersten
 * Antwort und danach nirgends mehr (Kap. 10.70); eine Wiederholung derselben Handlung bekommt keinen zweiten.
 */
import { computed } from "vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKopierfeld from "../controls/avm-kopierfeld.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import { untilText } from "./formular";
import type { ActionResult } from "./verwaltung";

const props = defineProps<{
    ergebnis: ActionResult | undefined;
    /** Für wen ein Link gilt, für die Beschriftung des Kopierfelds. */
    fuer?: string | undefined;
    testid?: string | undefined;
}>();

const konflikt = computed(() => {
    const conflict = props.ergebnis?.conflict;
    if (conflict === undefined) return null;
    if (conflict.by === null) return t("admin.conflict.anonymous");
    const time = conflict.at === null ? "" : relativeTime(new Date(conflict.at), new Date(), locale.value);
    return time === ""
        ? t("admin.conflict.byNoTime", { name: conflict.by })
        : t("admin.conflict.by", { name: conflict.by, time });
});
const bis = computed(() => {
    const expiresAt = props.ergebnis?.expiresAt;
    return expiresAt === undefined || expiresAt === null ? "" : untilText(expiresAt, locale.value);
});
</script>

<template>
    <template v-if="ergebnis !== undefined">
        <AvmHinweis v-if="!ergebnis.ok && ergebnis.problems.length > 0" ton="gefahr" rolle="alert" :testid="testid">
            <span v-if="konflikt !== null" class="meldung__zeile">{{ konflikt }}</span>
            <template v-else>
                <span v-for="problem in ergebnis.problems" :key="problem.key" class="meldung__zeile">{{
                    t(problem.key, problem.params)
                }}</span>
            </template>
        </AvmHinweis>
        <div v-else-if="ergebnis.ok && typeof ergebnis.link === 'string'" class="meldung__link" :data-testid="testid">
            <AvmKopierfeld
                :wert="ergebnis.link"
                :beschriftung="t('admin.link.label', { name: fuer ?? '' })"
                :testid="testid === undefined ? undefined : `${testid}-link`"
            />
            <p class="meldung__leise">{{ t("admin.link.once", { time: bis }) }}</p>
        </div>
        <AvmHinweis v-else-if="ergebnis.ok && ergebnis.link === null" ton="warnung" rolle="status" :testid="testid">{{
            t("admin.link.shownOnce")
        }}</AvmHinweis>
    </template>
</template>

<style scoped>
.meldung__zeile {
    display: block;
}

.meldung__link {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
}

.meldung__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: normal;
}
</style>
