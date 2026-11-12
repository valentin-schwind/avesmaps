<script setup lang="ts">
import { computed } from "vue";
import type { OperationsStatus } from "@avesmaps3d/shared";
import JobRow from "./job-row.vue";
import { formatMoment } from "./format";
import { t } from "../i18n/i18n";

/**
 * Der Reiter „Betrieb“ (JOBS-0001 5.1): der Zustand der EIGENEN Umgebung, live gelesen. Health, Release, höchste Migration, die
 * Zeiger von Gelände und Anzeigehöhen, der Legacy-Satz und die letzten Imports (Zug und Rollouts erscheinen hier als Jobs).
 *
 * Die Seite besitzt keine Daten: Was hier steht, liest der Server aus der Datenbank. Wo ein Wert fehlt, steht „unbekannt“.
 */

const props = defineProps<{ operations: OperationsStatus; nowMs: number }>();

const database = computed(() => {
    const check = props.operations.health.database;
    return check.status === "ok"
        ? t("status.ops.databaseOk", { detail: check.detail })
        : t("status.ops.databaseFailed");
});

const dem = computed(() => {
    const pointer = props.operations.pointers.dem;
    return pointer ? t("status.ops.dem", { revision: pointer.revision, format: pointer.format }) : t("status.ops.none");
});

const heights = computed(() => {
    const pointer = props.operations.pointers.displayHeights;
    if (pointer.state === "none") return t("status.ops.none");
    return t(pointer.state === "current" ? "status.ops.heights.current" : "status.ops.heights.stale", {
        revision: pointer.revision ?? t("status.unknown"),
    });
});

const legacy = computed(() => {
    const { mapRevision, ecosystemRevision, territoriesRevision } = props.operations.legacy;
    if (mapRevision === null && ecosystemRevision === null && territoriesRevision === null) return t("status.ops.none");
    return t("status.ops.legacy", {
        map: mapRevision ?? t("status.unknown"),
        eco: ecosystemRevision ?? t("status.unknown"),
        territories: territoriesRevision ?? t("status.unknown"),
    });
});
</script>

<template>
    <div class="ops-tab" data-testid="operations-tab">
        <section class="ops-tab__block">
            <h2 class="ops-tab__heading">{{ t("status.ops.title") }}</h2>
            <dl class="ops-tab__facts">
                <dt>{{ t("status.ops.health") }}</dt>
                <dd data-testid="ops-health" :data-status="operations.health.database.status">{{ database }}</dd>
                <dt>{{ t("status.ops.release") }}</dt>
                <dd data-testid="ops-release">{{ operations.releaseId }}</dd>
                <dt>{{ t("status.ops.profile") }}</dt>
                <dd data-testid="ops-profile">{{ operations.profile }}</dd>
                <dt>{{ t("status.ops.migration") }}</dt>
                <dd data-testid="ops-migration">{{ operations.migration ?? t("status.unknown") }}</dd>
                <dt>{{ t("status.ops.dem.label") }}</dt>
                <dd data-testid="ops-dem">{{ dem }}</dd>
                <dt>{{ t("status.ops.heights.label") }}</dt>
                <dd data-testid="ops-heights" :data-state="operations.pointers.displayHeights.state">{{ heights }}</dd>
                <dt>{{ t("status.ops.legacy.label") }}</dt>
                <dd data-testid="ops-legacy">
                    {{ legacy }}
                    <template v-if="operations.legacy.importedAt">
                        ·
                        {{ t("status.ops.importedAt", { time: formatMoment(operations.legacy.importedAt) }) }}</template
                    >
                </dd>
            </dl>
        </section>

        <section class="ops-tab__block" aria-labelledby="ops-imports">
            <h2 id="ops-imports" class="ops-tab__heading">
                {{ t("status.ops.imports", { n: operations.imports.length }) }}
            </h2>
            <ul v-if="operations.imports.length > 0" class="ops-tab__list" data-testid="ops-imports">
                <JobRow v-for="job in operations.imports" :key="job.id" :job="job" :now-ms="nowMs" />
            </ul>
            <p v-else class="ops-tab__empty" data-testid="ops-imports-empty">{{ t("status.ops.imports.empty") }}</p>
        </section>
    </div>
</template>

<style scoped>
.ops-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
}

.ops-tab__heading {
    margin: 0 0 var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Kennzahlenliste: Beschriftung links, Wert rechts (Guide §13.16); auf schmalem Schirm untereinander. */
.ops-tab__facts {
    display: grid;
    grid-template-columns: minmax(7.5rem, auto) minmax(0, 1fr);
    gap: var(--space-4) var(--space-10);
    margin: 0;
    font-size: var(--font-size-body);
}

.ops-tab__facts dt {
    color: var(--color-text-muted);
}

.ops-tab__facts dd {
    margin: 0;
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.ops-tab__facts dd[data-status="failed"],
.ops-tab__facts dd[data-state="stale"] {
    color: var(--color-danger);
}

.ops-tab__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
}

.ops-tab__empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}
</style>
