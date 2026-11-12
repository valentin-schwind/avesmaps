<script setup lang="ts">
import { computed, watch } from "vue";
import type { KanalBericht } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { t } from "../i18n/i18n";
import CommitVerweis from "./commit-verweis.vue";
import KanalWer from "./kanal-wer.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import { zeit, type Kanal } from "./kanal";

/**
 * Die Gruppe „Fix-Berichte“ im Protokoll der Systemsteuerung (KANAL-0001 §3.1, Blatt WI-0124 Nachtrag E1): jede Änderung von Claudia und
 * Claudio, neueste oben, dauerhaft und nur lesend, auch wenn die Meldung längst gelöscht ist. Die OPS-ID öffnet den Vorgang im Kanal.
 * Sichtbar nur mit `use_operator_channel`; der Server prüft es trotzdem.
 */
/** `suche`: die Suche der Protokoll-Leiste, schon entprellt; sie geht an den Server (die Berichte blättern). */
const props = defineProps<{ kanal: Kanal; telefon: boolean; suche?: string }>();
const emit = defineEmits<{ oeffne: [ops: string] }>();

watch(
    () => props.suche ?? "",
    (q) => void props.kanal.ladeBerichte(false, q),
    { immediate: true },
);

const now = computed(() => new Date());
const kopfzeile = (b: KanalBericht): string =>
    [b.was, b.klasse, t(`kanal.change.art.${b.art}`)].join(" · ") +
    (b.grund === null ? "" : ` (${t("kanal.reports.reason", { reason: b.grund })})`);
const letzte = (b: KanalBericht) => b.beobachtungen.at(-1) ?? null;
</script>

<template>
    <p v-if="props.kanal.loading.value && props.kanal.berichte.value.length === 0" class="berichte__leise">
        {{ t("admin.loading") }}
    </p>
    <VerwaltungLadeproblem
        v-else-if="props.kanal.loadProblems.value.length > 0"
        :problems="props.kanal.loadProblems.value"
        :fehlt="props.kanal.unconfirmed.value"
        testid="berichte-ladeproblem"
        @bestaetigen="props.kanal.confirmAgain()"
    />
    <p v-else-if="props.kanal.berichte.value.length === 0" class="berichte__leise" data-testid="berichte-leer">
        {{ t("kanal.reports.none") }}
    </p>
    <FensterTafel v-else :beschriftung="t('admin.group.aenderungen')" art="text" grund="fenster">
        <table data-testid="berichte-tafel">
            <thead>
                <tr>
                    <th scope="col">{{ t("kanal.reports.col.time") }}</th>
                    <th scope="col">{{ t("kanal.reports.col.who") }}</th>
                    <th scope="col">{{ t("kanal.reports.col.case") }}</th>
                    <th scope="col">{{ t("kanal.reports.col.change") }}</th>
                    <th v-if="!props.telefon" scope="col">{{ t("kanal.reports.col.observation") }}</th>
                    <th v-if="!props.telefon" scope="col">{{ t("kanal.reports.col.checked") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="b in props.kanal.berichte.value" :key="b.id" :data-testid="`bericht-${b.id}`">
                    <th scope="row" class="berichte__zeit">{{ zeit(b.at, now) }}</th>
                    <td><KanalWer :wer="{ art: b.agent }" /></td>
                    <td>
                        <button
                            v-if="b.ops !== null"
                            type="button"
                            class="berichte__ops"
                            :aria-label="t('kanal.reports.openCase', { ops: b.ops })"
                            :data-testid="`bericht-ops-${b.ops}`"
                            @click="emit('oeffne', b.ops)"
                        >
                            {{ b.ops }}
                        </button>
                        <span v-else class="berichte__leise">—</span>
                    </td>
                    <td>
                        <span class="berichte__erste">{{ kopfzeile(b) }}</span>
                        <span class="berichte__zweite"
                            ><template v-if="b.commit !== null"
                                >{{ t("kanal.reports.commit") }}
                                <CommitVerweis :sha="b.commit" :stellen="7" /></template
                            ><template v-else>{{ t("kanal.reports.noCommit") }}</template
                            ><template v-if="b.release !== null">
                                · {{ t("kanal.reports.release", { release: b.release }) }}</template
                            ></span
                        >
                        <template v-if="props.telefon">
                            <span class="berichte__zweite">{{
                                letzte(b) === null
                                    ? t("kanal.reports.noObservation")
                                    : t(`kanal.observation.${letzte(b)!.ergebnis}`)
                            }}</span>
                            <span class="berichte__zweite">{{
                                b.nachpruefung === null ? t("kanal.review.open") : t(`kanal.review.${b.nachpruefung}`)
                            }}</span>
                        </template>
                    </td>
                    <td v-if="!props.telefon">
                        <span v-if="letzte(b) === null" class="berichte__leise">{{
                            t("kanal.reports.noObservation")
                        }}</span>
                        <span
                            v-else
                            :class="`berichte__beob berichte__beob--${letzte(b)!.ergebnis}`"
                            :title="letzte(b)!.text ?? undefined"
                            >{{ t(`kanal.observation.${letzte(b)!.ergebnis}`) }}</span
                        >
                    </td>
                    <td v-if="!props.telefon">
                        <span v-if="b.nachpruefung === null" class="berichte__leise">{{
                            t("kanal.reports.checkOpen")
                        }}</span>
                        <span v-else class="berichte__pruef"
                            ><KanalWer :wer="{ art: 'claudia' }" />
                            {{ t(`kanal.reports.check.${b.nachpruefung}`) }}</span
                        >
                    </td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>
    <p v-if="props.kanal.berichte.value.length > 0" class="berichte__summe" data-testid="berichte-summe">
        {{ t("admin.audit.shown", { n: props.kanal.berichte.value.length }) }}
        <AvmKnopf
            v-if="props.kanal.berichteWeiter.value !== null"
            groesse="zeile"
            :gesperrt="props.kanal.loading.value ? '' : undefined"
            testid="berichte-aelter"
            @click="props.kanal.ladeBerichte(true)"
            >{{ t("admin.audit.more") }}</AvmKnopf
        >
    </p>
    <p class="berichte__hinweis">{{ t("kanal.reports.note") }}</p>
</template>

<style scoped>
.berichte__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.berichte__zeit {
    white-space: nowrap;
}

.berichte__ops {
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-link);
    font: inherit;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    cursor: pointer;
}

.berichte__ops:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.berichte__ops:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.berichte__erste,
.berichte__zweite {
    display: block;
}

.berichte__erste {
    color: var(--color-text-strong);
}

.berichte__zweite {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.berichte__beob {
    white-space: nowrap;
}

.berichte__beob--unauffaellig {
    color: var(--color-success-soft-text);
}

.berichte__beob--fallback,
.berichte__beob--offen {
    color: var(--color-warning-soft-text);
}

.berichte__beob--fehler,
.berichte__beob--rollback {
    color: var(--color-danger-soft-text);
}

.berichte__pruef {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
}

.berichte__summe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.berichte__hinweis {
    margin: 0;
    padding: var(--space-4) var(--space-8);
    border-left: 3px solid var(--color-accent);
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
    color: var(--color-text);
    font-size: var(--font-size-small);
}
</style>
