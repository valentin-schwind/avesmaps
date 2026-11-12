<script setup lang="ts">
/**
 * Der Reiter „Protokoll“ (WI-0120 A10; Mockup `06-protokoll`, AUTH-0001 §5 und ADR-0019): was in der Verwaltung und bei der
 * Anmeldung geschah, neueste oben, zum Lesen - eine Tafel, kein Raster. Gefiltert wird in der Leiste des Fensters (Art, Wer,
 * Zeitraum); „ältere zeigen“ blättert weiter. Einträge lassen sich weder ändern noch löschen.
 */
import { computed, watch } from "vue";
import AvmAvatar from "../controls/avm-avatar.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterTafel from "../fenster/fenster-tafel.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { AuditFilter, Administration } from "./verwaltung";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import {
    actorText,
    aktionenMitTitel,
    describeEvent,
    groupFilter,
    rangeStart,
    type AuditRange,
    type EventGroup,
} from "./verwaltung-text";

const props = defineProps<{
    verwaltung: Administration;
    /** Das Fenster: die Kontenverwaltung zeigt die Konten-Ereignisse, die Systemsteuerung die System-Ereignisse (SYS-15). */
    tafel: "konten" | "system";
    gruppe: EventGroup;
    wer: string;
    zeitraum: AuditRange;
    /** Die Suche der Leiste (schon entprellt); sie geht an den Server, mit den Handlungen, deren Titel passt. */
    suche?: string;
}>();

const filter = computed<AuditFilter>(() => ({
    ...groupFilter(props.tafel, props.gruppe),
    personId: props.wer === "" ? undefined : props.wer,
    from: rangeStart(props.zeitraum, new Date()),
    ...(props.suche ? { q: props.suche, qAktionen: aktionenMitTitel(props.suche) } : {}),
}));
watch(filter, (jetzt) => void props.verwaltung.loadAudit(jetzt), { immediate: true });

const zeilen = computed(() => {
    const jetzt = new Date();
    return props.verwaltung.audit.value.map((entry) => ({
        entry,
        zeit: relativeTime(new Date(entry.at), jetzt, locale.value, "zeitpunkt"),
        wer: actorText(entry),
        was: describeEvent(entry),
    }));
});
</script>

<template>
    <p v-if="verwaltung.loading.has('audit') && zeilen.length === 0" class="protokoll__leise">
        {{ t("admin.loading") }}
    </p>
    <VerwaltungLadeproblem
        v-else-if="verwaltung.loadProblems.has('audit')"
        :problems="verwaltung.loadProblems.get('audit')"
        :fehlt="verwaltung.unconfirmed.get('audit')"
        testid="protokoll-ladeproblem"
        @bestaetigen="verwaltung.confirmAgain()"
    />
    <p v-else-if="zeilen.length === 0" class="protokoll__leise" data-testid="protokoll-leer">
        {{ t("admin.audit.none") }}
    </p>
    <FensterTafel v-else :beschriftung="t('admin.audit.table')" art="text" grund="fenster">
        <table data-testid="protokoll-tafel">
            <thead>
                <tr>
                    <th scope="col">{{ t("admin.audit.col.time") }}</th>
                    <th scope="col">{{ t("admin.audit.col.who") }}</th>
                    <th scope="col">{{ t("admin.audit.col.what") }}</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="zeile in zeilen" :key="zeile.entry.id" data-testid="protokoll-eintrag">
                    <th scope="row" class="protokoll__zeit">{{ zeile.zeit }}</th>
                    <td>
                        <span class="protokoll__wer">
                            <AvmAvatar
                                v-if="zeile.entry.actor !== null"
                                :kennung="zeile.entry.actor.id"
                                :name="zeile.entry.actor.displayName"
                            />
                            <span :class="zeile.wer.person ? 'protokoll__name' : 'protokoll__maschine'">{{
                                zeile.wer.name
                            }}</span>
                        </span>
                    </td>
                    <td>
                        <span :class="zeile.was.danger ? 'protokoll__gefahr' : 'protokoll__was'">{{
                            zeile.was.title
                        }}</span>
                        <span v-if="zeile.was.details.length > 0" class="protokoll__leise">
                            · {{ zeile.was.details.join(" · ") }}</span
                        >
                        <AvmPille v-if="zeile.entry.recovery" ton="gefahr" class="protokoll__pille">{{
                            t("admin.audit.recovery")
                        }}</AvmPille>
                    </td>
                </tr>
            </tbody>
        </table>
    </FensterTafel>
    <p v-if="zeilen.length > 0" class="protokoll__summe" data-testid="protokoll-summe">
        {{ t("admin.audit.shown", { n: zeilen.length }) }}
        <AvmKnopf
            v-if="verwaltung.auditNext.value !== null"
            groesse="zeile"
            :gesperrt="verwaltung.loading.has('audit') ? '' : undefined"
            testid="protokoll-aelter"
            @click="verwaltung.loadAudit(filter, true)"
            >{{ t("admin.audit.more") }}</AvmKnopf
        >
    </p>
</template>

<style scoped>
.protokoll__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.protokoll__zeit {
    white-space: nowrap;
}

.protokoll__wer {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    white-space: nowrap;
}

.protokoll__name,
.protokoll__was {
    color: var(--color-text-strong);
}

.protokoll__maschine {
    color: var(--color-text-muted);
    font-style: italic;
}

.protokoll__gefahr {
    color: var(--color-danger);
}

.protokoll__pille {
    margin-left: var(--space-4);
}

.protokoll__summe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-6);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}
</style>
