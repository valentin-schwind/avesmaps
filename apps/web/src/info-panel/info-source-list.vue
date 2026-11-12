<script setup lang="ts">
import { t } from "../i18n/i18n";
import type { SourceGroup } from "./source-model";

/**
 * Die Liste eines Publikationsreiters (WI-0254 §12; Design Guide §16.4; Betreiber 2026-10-28 zur Quellen-Klappbox der Editoren: „im
 * prinzip brauchen wir hier keine klappbox, sondern nur die liste in dem schönen stil“). Sie löst die Tafel Titel/Typ/Seiten ab und
 * zeigt dieselbe Zeile wie die Klappbox, nur ohne Klappen: der Titel (ein Link, wo es einen sicheren Shop-Link gibt) mit dem Typ
 * darunter, rechts die Seiten. Unter „Beschrieben“ stehen die Gruppen Ausführlich und Ergänzend je mit Kopf und Zahl, unter „Erwähnt“
 * eine Liste ohne Kopf; die Folge (nach Titel, in der Sprache der Seite) ist die des Modells (`source-model.ts`).
 *
 * Eine Spalte, wie das Panel schmal ist; ab etwa 560 px Breite (das Panel als Fenster) steht der Typ in einer eigenen Spalte neben dem
 * Titel. Die Breite misst eine Container-Abfrage an der Liste selbst, nicht am Fenster der Seite. Nur http(s) wird ein Link (`safeHref`,
 * schon im Modell). Lange Seitenangaben stehen gekürzt, die volle im Titel des Elements, gepunktet unterstrichen wie in Legacy.
 * Eine Herkunft der Zeile (Wiki oder von Hand) gehört nicht zum Leser und steht hier nicht.
 */
defineProps<{ id: string; groups: SourceGroup[] }>();
</script>

<template>
    <div :id="id" class="info-source-list" data-testid="info-sources-list">
        <template v-for="group in groups" :key="group.key">
            <h4 v-if="group.label !== undefined" class="info-source-list__head" data-testid="info-source-group">
                <span class="avm-versalmitte">{{ group.label }}</span>
                <span class="info-source-list__n avm-versalmitte">{{ group.rows.length }}</span>
            </h4>
            <ul class="info-source-list__rows" :data-kind="group.key">
                <li
                    v-for="row in group.rows"
                    :key="row.key"
                    class="info-source-list__row"
                    data-testid="info-source-pub-row"
                >
                    <span class="info-source-list__name">
                        <a
                            v-if="row.href !== undefined"
                            class="info-source-list__title einzeilig"
                            :href="row.href"
                            :title="row.title"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ row.title }}</a
                        >
                        <span v-else class="info-source-list__title einzeilig" :title="row.title">{{ row.title }}</span>
                        <span class="info-source-list__type einzeilig">{{ row.type }}</span>
                    </span>
                    <span
                        v-if="row.pages !== undefined"
                        class="info-source-list__pages"
                        :class="{ 'is-shortened': row.pages.shortened }"
                        :title="
                            row.pages.shortened ? t('infoPanel.sources.pages', { pages: row.pages.full }) : undefined
                        "
                        data-testid="info-source-pub-pages"
                        >{{ t("infoPanel.sources.pages", { pages: row.pages.short }) }}</span
                    >
                </li>
            </ul>
        </template>
    </div>
</template>

<style scoped>
/* Die Breite, nach der sich die Spalten richten, ist die der Liste selbst (Container-Abfrage unten). */
.info-source-list {
    container: info-source-list / inline-size;
    display: flex;
    flex-direction: column;
    margin-top: var(--space-6);
}

/* Der Kopf einer Gruppe: Versalien, leise, mit der Zahl dahinter; der erste steht bündig unter den Reitern. */
.info-source-list__head {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    margin: var(--space-8) 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.info-source-list__head:first-child {
    margin-top: 0;
}

.info-source-list__n {
    letter-spacing: 0;
}

/* Die Zeilen stehen auf der Fläche des Panels im weichen Kasten: ein Rand rundum, zwischen den Zeilen ein Trenner (kein Rahmen je Zeile, AGENTS.md §12). */
.info-source-list__rows {
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.info-source-list__row {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    min-height: var(--avm-control-h);
    padding: var(--space-2) var(--space-8);
}

.info-source-list__row + .info-source-list__row {
    border-top: 1px solid var(--color-divider);
}

/* Titel und Typ untereinander; der Name gibt nach und kürzt am Ende (`.einzeilig`, voller Text im `title`), die Seiten kürzen nie. */
.info-source-list__name {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
}

.info-source-list__title {
    color: var(--color-text);
    text-decoration: none;
}

a.info-source-list__title {
    color: var(--color-link);
}

a.info-source-list__title:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
    text-underline-offset: 2px;
}

a.info-source-list__title:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-source-list__type {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.info-source-list__pages {
    flex: none;
    max-width: 8.5em;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
    text-align: right;
}

/* Eine gekürzte Angabe zeigt, dass mehr dahintersteckt (Legacy `.fs-src-c-pages[title]`): Ohne das liest sich „9 ff.“ wie die ganze. */
.info-source-list__pages.is-shortened {
    cursor: help;
    text-decoration: underline dotted;
    text-underline-offset: 3px;
}

/* Breit (das Panel als Fenster, ab 560 px): der Typ steht in einer eigenen Spalte neben dem Titel. `rem` und nicht `px`: Das Panel führt kein Pixelmaß
   im Stil (`info-panel-huelle.test.ts`), und 35 rem sind bei der Wurzelschrift des Hauses (16 px) genau 560 px - unabhängig von der Schrift des Kastens. */
@container info-source-list (min-width: 35rem) {
    .info-source-list__name {
        flex-direction: row;
        align-items: baseline;
        gap: var(--space-8);
    }

    .info-source-list__type {
        flex: none;
        width: 9.5em;
        order: 2;
        margin-left: auto;
        font-size: var(--font-size-small);
    }
}
</style>
