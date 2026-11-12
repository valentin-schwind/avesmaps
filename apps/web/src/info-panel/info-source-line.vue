<script setup lang="ts">
import { ref, useId } from "vue";
import { t } from "../i18n/i18n";
import InfoCanonPill from "./info-canon-pill.vue";
import { safeHref, type SourceLine } from "./source-model";

/**
 * Eine Zeile der ersten Zone des Quellenkastens (Design Guide §16.4, Legacy `.fs-src-row`, `buildSourceListMarkup`): die Wikizeile oder
 * eine von Hand zugeordnete Quelle. Links der Name (kürzt) und die Seiten (kürzen nie), rechts die feste Gruppe aus ⓘ und Kanon-Etikett.
 * Hinter dem ⓘ steht die Rechtetafel - als Geschwister UNTER der Zeile, aber in IHREM Eintrag: Bei zwei Quellen wäre sonst nicht zu
 * sehen, wessen Rechte dort stehen, und das sind zuordnungspflichtige Angaben.
 *
 * 🔴 Das ⓘ ist IMMER da, und das ist tragend: Es hält den Lizenzhinweis der Wiki-Texte, den die Lizenz an jeder Kopie verlangt (Legacy
 * `popups.js`), und bei jeder Katalogquelle Kanon, Lizenz und Nennung. Wer es je an eine Bedingung hängt, nimmt die Lizenzangabe mit.
 * Nur http(s) wird ein Link (`safeHref`): `javascript:` überlebt jedes Maskieren.
 *
 * Schmal gebrochen, wie Legacy im 400-px-Panel (Betreiber Legacy 2026-09-01, Variante B): Der Name bekommt die ganze Zeile, die Seiten
 * stehen darunter, die Marken bleiben rechts - ein Name, der ganz verschwindet, wäre schlimmer als eine zweite Zeile.
 */
const props = defineProps<{ line: SourceLine }>();

const open = ref(false);
const panel = useId();
</script>

<template>
    <li class="info-source-line" :data-kind="props.line.kind" data-testid="info-source-row">
        <div class="info-source-line__row">
            <span class="info-source-line__main">
                <span class="info-source-line__title einzeilig" data-testid="info-source-title">
                    <a
                        v-if="props.line.href !== undefined"
                        class="info-source-line__link"
                        :href="props.line.href"
                        target="_blank"
                        rel="noopener noreferrer"
                        >{{ props.line.title }}</a
                    >
                    <template v-else>{{ props.line.title }}</template>
                </span>
                <span
                    v-if="props.line.pages !== undefined"
                    class="info-source-line__pages"
                    :title="
                        props.line.pages.shortened
                            ? t('infoPanel.sources.pages', { pages: props.line.pages.full })
                            : undefined
                    "
                    data-testid="info-source-pages"
                    >{{ t("infoPanel.sources.pages", { pages: props.line.pages.short }) }}</span
                >
            </span>
            <span class="info-source-line__marks">
                <button
                    type="button"
                    class="info-source-line__info"
                    :aria-expanded="open"
                    :aria-controls="panel"
                    :aria-label="t('infoPanel.source.rights')"
                    :title="t('infoPanel.source.rights')"
                    data-testid="info-source-info"
                    @click="open = !open"
                >
                    i
                </button>
                <InfoCanonPill v-if="props.line.pill !== undefined" :pill="props.line.pill" />
            </span>
        </div>
        <div v-if="open" :id="panel" class="info-source-line__rights" data-testid="info-source-rights">
            <dl>
                <template v-for="row in props.line.rights" :key="row.key">
                    <dt>{{ row.label }}</dt>
                    <dd :data-rights="row.key">
                        <a
                            v-if="row.href !== undefined && safeHref(row.href) !== undefined"
                            class="info-source-line__link"
                            :href="safeHref(row.href)"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ row.text }}</a
                        >
                        <template v-else>{{ row.text }}</template>
                    </dd>
                </template>
            </dl>
        </div>
    </li>
</template>

<style scoped>
.info-source-line {
    min-width: 0;
}

.info-source-line__row {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    flex-wrap: nowrap;
}

/* Der Name und die Seiten: schmal gebrochen, der Name nimmt die ganze Zeile und kürzt, die Seiten stehen darunter. */
.info-source-line__main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
}

.info-source-line__title {
    flex: 1 1 100%;
    min-width: 0;
}

.info-source-line__link {
    color: var(--color-link);
    text-decoration: none;
}

.info-source-line__link:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-source-line__link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-source-line__pages {
    flex: 0 0 auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    white-space: nowrap;
}

/* Eine gekürzte Angabe zeigt, dass mehr dahintersteckt (Legacy `.fs-src-pages[title]`): Ohne das liest sich „9 ff.“ wie die ganze. */
.info-source-line__pages[title] {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    cursor: help;
}

/* Die Marken schrumpfen nie: Sie sind die Aussage, gekürzt wird links. */
.info-source-line__marks {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}

/* Das ⓘ: ein runder Knopf, weich; geöffnet gefüllt in der zweiten Akzentfarbe (Legacy `.fs-src-info`). */
.info-source-line__info {
    display: grid;
    place-items: center;
    width: var(--icon-sm);
    height: var(--icon-sm);
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: 50%;
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    line-height: 1;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.info-source-line__info:hover {
    border-color: var(--color-accent-brown);
    background: var(--color-button-soft-hover);
}

.info-source-line__info:active {
    background: var(--color-button-soft-active);
}

.info-source-line__info[aria-expanded="true"] {
    border-color: var(--color-accent-brown);
    background: var(--color-accent-brown);
    color: var(--color-panel);
}

.info-source-line__info:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Die Rechtetafel: Kante links in der zweiten Akzentfarbe, Fläche weich; sie steht UNTER der Zeile, in ihrem Eintrag. */
.info-source-line__rights {
    margin: var(--space-4) 0 var(--space-4);
    padding: var(--space-6) var(--space-8);
    border-left: 2px solid var(--color-accent-brown);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--color-panel-muted);
    font-size: var(--font-size-caption);
}

.info-source-line__rights dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: var(--space-2) var(--space-8);
    margin: 0;
}

.info-source-line__rights dt {
    color: var(--color-text-muted);
}

.info-source-line__rights dd {
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text);
}

@media (prefers-reduced-motion: reduce) {
    .info-source-line__info {
        transition: none;
    }
}
</style>
