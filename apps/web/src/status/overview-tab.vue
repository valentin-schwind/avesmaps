<script setup lang="ts">
import type { RepoBeleg, RepoOverview } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";

/**
 * Der Reiter „Überblick“ (JOBS-0001 5.1, D2 A, D3 A/A): Was auf den Betreiber wartet, was heute entschieden wurde, was die
 * Entwicklung selbst entschieden hat, welche Work Items in Arbeit sind und wie der Datenstand laut Dokumentation aussieht.
 *
 * 🔴 DIE SEITE PFLEGT NICHTS. Alles ist aus dem Repository GELESEN, und zu jeder Zeile steht die Fundstelle (Datei und Zeile, als Link
 * auf GitHub): Eine Zeile, die der Leser anzweifelt, ist mit einem Klick belegt oder widerlegt. Nur lokal; auf der Stage gibt es
 * dieses Repository nicht, und der Reiter erscheint dort gar nicht.
 */

defineProps<{ repo: RepoOverview }>();

const GITHUB_BLOB = "https://github.com/valentin-schwind/avesmaps3D/blob/master/";

function belegUrl(beleg: RepoBeleg): string {
    return `${GITHUB_BLOB}${beleg.file}#L${String(beleg.line)}`;
}

function belegText(beleg: RepoBeleg): string {
    return t("status.overview.beleg", { file: beleg.file.replace(/^project-control\//, ""), line: beleg.line });
}
</script>

<template>
    <div class="overview-tab" data-testid="overview-tab">
        <p class="overview-tab__hint">{{ t("status.overview.hint", { date: repo.today }) }}</p>

        <section class="overview-tab__block" aria-labelledby="ov-waiting">
            <h2 id="ov-waiting" class="overview-tab__heading">
                {{ t("status.overview.waiting", { n: repo.waiting.length }) }}
            </h2>
            <ul v-if="repo.waiting.length > 0" class="overview-tab__list" data-testid="ov-waiting">
                <li
                    v-for="entry in repo.waiting"
                    :key="`${entry.beleg.file}:${String(entry.beleg.line)}`"
                    class="overview-tab__entry"
                >
                    <p class="overview-tab__text">{{ entry.text }}</p>
                    <p v-if="entry.detail" class="overview-tab__detail">{{ entry.detail }}</p>
                    <a
                        class="overview-tab__beleg"
                        :href="belegUrl(entry.beleg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ belegText(entry.beleg) }}</a
                    >
                </li>
            </ul>
            <p v-else class="overview-tab__empty">{{ t("status.overview.empty.waiting") }}</p>
        </section>

        <section class="overview-tab__block" aria-labelledby="ov-decided">
            <h2 id="ov-decided" class="overview-tab__heading">
                {{ t("status.overview.decided", { n: repo.decidedToday.length }) }}
            </h2>
            <ul v-if="repo.decidedToday.length > 0" class="overview-tab__list" data-testid="ov-decided">
                <li
                    v-for="entry in repo.decidedToday"
                    :key="`${entry.beleg.file}:${String(entry.beleg.line)}`"
                    class="overview-tab__entry"
                >
                    <p class="overview-tab__text">{{ t("status.overview.quote", { text: entry.text }) }}</p>
                    <p v-if="entry.detail" class="overview-tab__detail">{{ entry.detail }}</p>
                    <a
                        class="overview-tab__beleg"
                        :href="belegUrl(entry.beleg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ belegText(entry.beleg) }}</a
                    >
                </li>
            </ul>
            <p v-else class="overview-tab__empty">{{ t("status.overview.empty.decided") }}</p>
        </section>

        <section class="overview-tab__block" aria-labelledby="ov-self">
            <h2 id="ov-self" class="overview-tab__heading">
                {{ t("status.overview.self", { n: repo.selfDecided.length }) }}
            </h2>
            <ul v-if="repo.selfDecided.length > 0" class="overview-tab__list" data-testid="ov-self">
                <li
                    v-for="entry in repo.selfDecided"
                    :key="`${entry.beleg.file}:${String(entry.beleg.line)}`"
                    class="overview-tab__entry"
                >
                    <p class="overview-tab__text">{{ entry.text }}</p>
                    <a
                        class="overview-tab__beleg"
                        :href="belegUrl(entry.beleg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ belegText(entry.beleg) }}</a
                    >
                </li>
            </ul>
            <p v-else class="overview-tab__empty">{{ t("status.overview.empty.self") }}</p>
        </section>

        <section class="overview-tab__block" aria-labelledby="ov-sessions">
            <h2 id="ov-sessions" class="overview-tab__heading">
                {{ t("status.overview.sessions", { n: repo.sessions.length }) }}
            </h2>
            <ul v-if="repo.sessions.length > 0" class="overview-tab__list" data-testid="ov-sessions">
                <li
                    v-for="entry in repo.sessions"
                    :key="`${entry.beleg.file}:${String(entry.beleg.line)}`"
                    class="overview-tab__entry"
                >
                    <p class="overview-tab__text">{{ entry.text }}</p>
                    <p v-if="entry.detail" class="overview-tab__detail">{{ entry.detail }}</p>
                    <a
                        class="overview-tab__beleg"
                        :href="belegUrl(entry.beleg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ belegText(entry.beleg) }}</a
                    >
                </li>
            </ul>
            <p v-else class="overview-tab__empty">{{ t("status.overview.empty.sessions") }}</p>
        </section>

        <section class="overview-tab__block" aria-labelledby="ov-data">
            <h2 id="ov-data" class="overview-tab__heading">{{ t("status.overview.data") }}</h2>
            <ul v-if="repo.dataStand.length > 0" class="overview-tab__list" data-testid="ov-data">
                <li
                    v-for="row in repo.dataStand"
                    :key="`${row.beleg.file}:${String(row.beleg.line)}`"
                    class="overview-tab__entry"
                >
                    <p class="overview-tab__text">{{ row.label }}</p>
                    <dl class="overview-tab__pair">
                        <dt>{{ t("status.overview.stage") }}</dt>
                        <dd>{{ row.stage }}</dd>
                        <dt>{{ t("status.overview.local") }}</dt>
                        <dd>{{ row.local }}</dd>
                    </dl>
                    <a
                        class="overview-tab__beleg"
                        :href="belegUrl(row.beleg)"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ belegText(row.beleg) }}</a
                    >
                </li>
            </ul>
            <p v-else class="overview-tab__empty">{{ t("status.overview.empty.data") }}</p>
        </section>
    </div>
</template>

<style scoped>
.overview-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-16);
}

.overview-tab__hint {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.overview-tab__heading {
    margin: 0 0 var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.overview-tab__list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    margin: 0;
    padding: 0;
    list-style: none;
}

.overview-tab__entry {
    padding: var(--space-6) var(--space-10);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.overview-tab__text {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.overview-tab__detail {
    margin: var(--space-2) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.overview-tab__pair {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: var(--space-2) 0 0;
    font-size: var(--font-size-small);
}

.overview-tab__pair dt {
    color: var(--color-text-muted);
}

.overview-tab__pair dd {
    margin: 0;
    color: var(--color-text);
    overflow-wrap: anywhere;
}

/* Die Fundstelle: ein Link, goldbraun, nie blau (Guide §2). */
.overview-tab__beleg {
    display: inline-block;
    margin-top: var(--space-4);
    color: var(--color-link);
    font-size: var(--font-size-caption);
    text-decoration: none;
    transition: color 120ms ease;
}

.overview-tab__beleg:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.overview-tab__beleg:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.overview-tab__empty {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

@media (prefers-reduced-motion: reduce) {
    .overview-tab__beleg {
        transition: none;
    }
}
</style>
