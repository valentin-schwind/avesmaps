<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watchEffect } from "vue";
import ThemeToggle from "../controls/theme-toggle.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import OperationsTab from "./operations-tab.vue";
import OverviewTab from "./overview-tab.vue";
import QueueTab from "./queue-tab.vue";
import { createStatusStore, type StatusStore, type TabKey } from "./status-store";
import { t } from "../i18n/i18n";

/**
 * Die Statusseite (JOBS-0001 Teil B, Etappe 1, Betreiber 2026-10-04: D5 C „Etappe 1 baut die Seite für den Betreiber, nur Ansicht“):
 * eine eigene Seite ohne Karte, am Handy lesbar. Drei Reiter: Warteschlange (live über `/ws`), Betrieb, Überblick (nur lokal).
 *
 * 🔴 NUR ANSICHT. Es gibt keinen Knopf, der die Queue verändert: kein Abbrechen, kein Wiederholen (kommt mit Etappe 3 und den Rechten
 * aus D1). Die Seite besitzt keine Daten und pflegt nichts selbst; HTTP ist die Wahrheit, `/ws` weckt nur.
 *
 * Gestaltung nach dem Design Guide: Reiter mit Unterkante (§9), Kennzahlenliste (§13.16), Listenzeile als Karte (§10), Zählung in
 * Klammern in der Beschriftung, die sie zählt (§13.12). Jeder Text steht in den Sprachtafeln.
 */

/**
 * `eingebettet` (Betreiber 2026-10-11): dieselbe Seite als Ansicht der Systemsteuerung, ohne Seitenkopf und Thema-Knopf (die hat das
 * Fenster) und ohne die Adresse anzufassen: Dort steht der Ausschnitt der Karte, der Reiter bleibt im Zustand.
 */
const props = defineProps<{ store?: StatusStore; eingebettet?: boolean }>();
const store = props.store ?? createStatusStore();

const TAB_HASH: Record<TabKey, string> = { queue: "#queue", operations: "#operations", overview: "#overview" };

function tabFromHash(hash: string): TabKey {
    const found = (Object.keys(TAB_HASH) as TabKey[]).find((key) => TAB_HASH[key] === hash);
    return found ?? "queue";
}

const overview = computed(() => store.overview.value);

const tabs = computed<{ id: TabKey; name: string }[]>(() => {
    const running = overview.value ? overview.value.running.length + overview.value.queued.length : null;
    const list: { id: TabKey; name: string }[] = [
        {
            id: "queue",
            name: running === null ? t("status.tab.queue") : t("status.tab.queueCount", { n: running }),
        },
    ];
    // Betrieb und Überblick nur in der vollen Sicht (WI-0120 A11, JOBS-0001 D1 A); ein Editor sieht nur seine Jobs.
    if (overview.value?.view === "own") return list;
    list.push({ id: "operations", name: t("status.tab.operations") });
    // D2 A: Auf der Stage gibt es keinen Überblick, der Reiter erscheint dort gar nicht.
    if (store.overviewAvailable.value) list.push({ id: "overview", name: t("status.tab.overview") });
    return list;
});

function select(next: TabKey): void {
    store.setTab(next);
    // Der Reiter steht in der Adresse (#queue, #operations, #overview), ohne einen Eintrag im Verlauf anzulegen; eingebettet nicht.
    if (!props.eingebettet) history.replaceState(null, "", TAB_HASH[next]);
}

/** Die Reiterleiste ist die des Hauses (`FensterReiter`, Guide §9); gewählt wird über `select`, damit die Adresse folgt. */
const gewaehlt = computed<TabKey>({ get: () => store.tab.value, set: select });

const connectionLabel = computed(() => t(`status.live.${store.connection.value}`));

const FAILURE_TEXT = {
    disabled: "status.disabled",
    unavailable: "status.unavailable",
    error: "status.error.load",
    signin: "status.signin",
    forbidden: "status.forbidden",
    confirm: "status.confirm",
} as const;

const failureText = computed(() => {
    const failure = store.queueFailure.value;
    return failure === null ? null : t(FAILURE_TEXT[failure]);
});
/** Ohne Anmeldung führt ein Verweis zur Anmeldung der Karte (`/anmelden` öffnet dort das Fenster). */
const needsSignin = computed(() => store.queueFailure.value === "signin");

/** Den Titel des Tabs setzt nur die eigene Seite; eingebettet führt ihn die Karte nach der Sitzung (`auth/seitentitel.ts`). */
watchEffect(() => {
    if (props.eingebettet) return;
    document.title = `${t("status.page.title")} – ${t("page.title")}`;
});

/** Auf dem Tab, den die Adresse nennt, aber nur wenn er existiert (der Überblick fehlt auf der Stage). */
watchEffect(() => {
    if (store.tab.value === "overview" && store.repo.value !== null && !store.overviewAvailable.value)
        store.setTab("queue");
});

/** Wer die Adresse ändert (ein Lesezeichen, ein Link mit #operations), landet auf dem Reiter, den sie nennt. */
function followHash(): void {
    const wanted = tabFromHash(globalThis.location.hash);
    if (wanted !== store.tab.value) store.setTab(wanted);
}

onMounted(() => {
    store.start();
    if (props.eingebettet) return;
    followHash();
    globalThis.addEventListener("hashchange", followHash);
});
onBeforeUnmount(() => {
    globalThis.removeEventListener("hashchange", followHash);
    store.stop();
});
</script>

<template>
    <div class="status-page" :class="{ 'status-page--eingebettet': props.eingebettet }" data-testid="status-page">
        <header class="status-page__head">
            <template v-if="!props.eingebettet">
                <h1 class="status-page__title">{{ t("status.page.title") }}</h1>
                <ThemeToggle class="status-page__theme" />
            </template>
            <a
                v-else
                class="status-page__eigene"
                href="/status.html"
                target="_blank"
                rel="noopener"
                data-testid="status-eigene-seite"
                >{{ t("status.page.ownPage") }}</a
            >
            <p class="status-page__meta" data-testid="status-env">
                <template v-if="overview">{{
                    t("status.page.env", { release: overview.releaseId, profile: overview.profile })
                }}</template>
            </p>
            <p
                class="status-page__live"
                :data-connection="store.connection.value"
                data-testid="status-live"
                :title="t('status.live.title')"
            >
                <span class="status-page__live-dot" aria-hidden="true"></span>{{ connectionLabel }}
            </p>
        </header>

        <FensterReiter
            v-model="gewaehlt"
            :reiter="tabs"
            :beschriftung="t('status.tabs.label')"
            kennung="status"
            data-testid="status-tabs"
        />

        <main
            :id="`status-inhalt-${store.tab.value}`"
            class="status-page__body"
            role="tabpanel"
            :aria-labelledby="`status-reiter-${store.tab.value}`"
        >
            <template v-if="store.tab.value === 'queue'">
                <p v-if="failureText && !overview" class="status-page__note" data-testid="status-failure">
                    {{ failureText }}
                    <a v-if="needsSignin" class="status-page__link" href="/anmelden" data-testid="status-signin">{{
                        t("status.signinLink")
                    }}</a>
                </p>
                <p v-else-if="!overview" class="status-page__note" data-testid="status-loading">
                    {{ t("status.loading") }}
                </p>
                <template v-else>
                    <p v-if="failureText" class="status-page__note" data-testid="status-stale">
                        {{ t("status.stale") }}
                    </p>
                    <QueueTab :overview="overview" :now-ms="store.nowMs.value" />
                </template>
            </template>
            <template v-else-if="store.tab.value === 'operations'">
                <p
                    v-if="store.operationsFailure.value && !store.operations.value"
                    class="status-page__note"
                    data-testid="status-failure"
                >
                    {{ t(FAILURE_TEXT[store.operationsFailure.value]) }}
                </p>
                <p v-else-if="!store.operations.value" class="status-page__note">{{ t("status.loading") }}</p>
                <OperationsTab v-else :operations="store.operations.value" :now-ms="store.nowMs.value" />
            </template>
            <template v-else>
                <OverviewTab v-if="store.repo.value && store.repo.value.available" :repo="store.repo.value" />
                <p v-else class="status-page__note" data-testid="status-overview-missing">
                    {{ t("status.overview.unavailable") }}
                </p>
            </template>
        </main>
    </div>
</template>

<style scoped>
.status-page {
    box-sizing: border-box;
    max-width: 52rem;
    min-height: 100vh;
    margin: 0 auto;
    padding: 0 var(--space-12) var(--space-24);
    color: var(--color-text);
    font-family: var(--font-ui);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.status-page__head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-10);
    align-items: center;
    padding: var(--space-12) 0 var(--space-8);
}

.status-page__title {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-title);
    font-weight: var(--font-weight-regular);
    line-height: var(--leading-tight);
}

.status-page__theme,
.status-page__eigene {
    justify-self: end;
}

/* Im Fenster: ohne eigene Breite, Höhe und Ränder; die Hülle gibt den Rahmen. */
.status-page--eingebettet {
    max-width: none;
    min-height: 0;
    margin: 0;
    padding: 0;
}

.status-page--eingebettet .status-page__head {
    padding-top: 0;
}

.status-page__eigene {
    grid-column: 2;
    color: var(--color-link);
    font-size: var(--font-size-small);
    text-decoration: none;
}

.status-page__eigene:hover {
    text-decoration: underline;
}

.status-page__meta,
.status-page__live {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.status-page__live {
    justify-self: end;
    white-space: nowrap;
}

.status-page__live-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: var(--space-4);
    border-radius: 50%;
    background: var(--color-text-muted);
}

.status-page__live[data-connection="live"] .status-page__live-dot {
    background: var(--color-success);
}

.status-page__live[data-connection="offline"] .status-page__live-dot {
    background: var(--color-danger);
}

.status-page__body {
    padding-top: var(--space-12);
}

.status-page__note {
    margin: 0;
    color: var(--color-text-muted);
}

/* Der Weg zur Anmeldung: ein gewöhnlicher Verweis in der Farbe der Links (Guide: Gold heißt Link). */
.status-page__link {
    color: var(--color-link);
}
</style>
