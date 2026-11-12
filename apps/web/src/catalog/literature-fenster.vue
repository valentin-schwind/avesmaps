<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubjectLiteratureSection } from "@avesmaps3d/shared";
import AvmFenster from "../fenster/avm-fenster.vue";
import { formatNumber, t } from "../i18n/i18n";
import { catalogCredit, catalogHeading } from "../info-panel/catalog-model";
import type { CatalogTarget } from "../info-panel/panel-types";
import CatalogCredit from "./catalog-credit.vue";
import CatalogEntry from "./catalog-entry.vue";
import CatalogFilterBar from "./catalog-filter-bar.vue";
import CatalogLinks from "./catalog-links.vue";
import CatalogNotice from "./catalog-notice.vue";
import CatalogRow from "./catalog-row.vue";
import { suchtreffer, type FilterChange } from "./catalog-filter-model";
import {
    emptyLiteratureFilter,
    literatureFacets,
    literatureFilterGroups,
    literatureFilterReduce,
    literatureMatches,
    openWorks,
    sortWorks,
    workRowsOf,
    type WorkRow,
} from "./literature-window-model";
import { useCatalogList } from "./use-catalog-list";
import { useCatalogSection } from "./use-catalog-section";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { editorSektionen } from "../info-panel/panel-section-load";

/**
 * Das Fenster „Literatur zu …“ (WI-0118, Design Guide §12.6; Legacy `openFlatDialogForSection` in `map-features-place-extras.js`, Mirror
 * `cbe278210`): alle Werke der Spielliteratur, die diesen Gegenstand nennen, mit Filtern, Sortierung und - der Zweck des Fensters - dem
 * VERGRÖSSERTEN Eintrag. Einen vergrößerten Literatureintrag gibt es auch in Legacy nicht; die Zeilen dort waren nie aufklappbar.
 *
 * 🔴 Aufgebaut ist es wie in Legacy: Kopf (Titel und Zahl der OFFEN stehenden Werke - ein Spoiler zählt nicht mit, sonst verriete die Zahl,
 * wie viel hier gespielt wird), Leiste (Filter und Sortierung), Liste, Fuß (die Urheberzeile, wo Umschläge stehen). Die Leiste zeigt nur
 * Filter, die die Liste teilen. Die Rolle `play` IST der Spoiler: Der Deckel liegt über der ganzen Zeile; „Spoiler“ in der Leiste nimmt alle
 * weg. Die Rolle geht nie in die Sortierung ein - ein Spoiler steht an seinem Platz.
 */
const props = defineProps<{ ziel?: CatalogTarget | undefined }>();
const offen = defineModel<boolean>("offen", { required: true });

const { status, answer, retry } = useCatalogSection<SubjectLiteratureSection>(
    "literature",
    () => props.ziel,
    () => offen.value,
);
/** Ein Inhaltsschalter blendet das Fenster aus (WI-0127 SYS-10): sein Satz statt der Liste, aus dem Stand der Seite oder der Antwort. */
const pausiert = computed(
    () => (!editorSektionen() && ausgeblendet("panel.literature")) || answer.value?.paused === true,
);
const rows = computed<WorkRow[]>(() => (answer.value === undefined ? [] : workRowsOf(answer.value)));

const filter = ref(emptyLiteratureFilter());
/** Die Freitextsuche (Titel und Reihe, `suchtext`); sie gilt wie ein Filter und wird mit ihm zurückgesetzt. */
const suche = ref("");
const list = useCatalogList({
    section: "literature",
    open: () => offen.value,
    target: () => props.ziel,
    rows: () => rows.value,
    reset: () => {
        filter.value = emptyLiteratureFilter();
        suche.value = "";
    },
});

const facets = computed(() => literatureFacets(rows.value));
const groups = computed(() => literatureFilterGroups(facets.value, filter.value, rows.value.length));
const visible = computed(() =>
    sortWorks(
        rows.value.filter((row) => literatureMatches(row, filter.value) && gesucht(row)),
        filter.value.sort,
    ),
);
const change = (next: FilterChange): void => {
    filter.value = literatureFilterReduce(filter.value, next);
};

const isVeiled = (row: WorkRow): boolean => row.spoiler && !filter.value.spoilers && !list.revealed.value.has(row.id);
/** 🔴 Eine Suche trifft nie eine verdeckte Zeile: Sonst verriete der Treffer den Titel, den der Deckel verbirgt. */
function gesucht(row: WorkRow): boolean {
    return suche.value.trim() === "" || (!isVeiled(row) && suchtreffer(row.suchtext, suche.value));
}

const coverOf = (row: WorkRow): WorkRow["cover"] =>
    row.cover !== undefined && !list.broken.value.includes(row.cover.url) ? row.cover : undefined;
const withImages = computed(() => rows.value.some((row) => coverOf(row) !== undefined));

const title = computed(() => catalogHeading("literature", props.ziel?.name));
const count = computed(() => {
    if (status.value !== "ready" || rows.value.length === 0) return undefined;
    const shown = openWorks(visible.value);
    const total = openWorks(rows.value);
    return shown === total
        ? `(${formatNumber(shown, 0)})`
        : `(${t("catalog.count.of", { shown: formatNumber(shown, 0), total: formatNumber(total, 0) })})`;
});
/**
 * 🪤 Gefragt wird, was die Liste TRÄGT, nicht was der Browser geladen hat (wie im Streifen, `catalogCredit`): Ein Bild, dessen Adresse nicht
 * lädt, ist ein Unfall und keine Aussage über die Rechte.
 */
const credit = computed(() => catalogCredit(rows.value.map((row) => row.cover)));
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="title"
        :zusatz="count"
        testid="literature-window"
    >
        <template v-if="rows.length >= 2" #leiste>
            <CatalogFilterBar
                v-model:suche="suche"
                :groups="groups"
                :platzhalter="t('catalog.literature.search')"
                :beschriftung="t('catalog.literature.searchLabel')"
                @change="change"
            />
        </template>

        <CatalogNotice v-if="pausiert" kind="text" :text="pausiertSatz('panel.literature') ?? ''" />
        <CatalogNotice v-else-if="status === 'loading'" kind="loading" :text="t('catalog.loading')" />
        <CatalogNotice v-else-if="status === 'error'" kind="error" :text="t('catalog.error')" @retry="retry" />
        <CatalogNotice
            v-else-if="status === 'ready' && rows.length === 0"
            kind="text"
            :text="t('catalog.literature.empty')"
        />
        <CatalogNotice
            v-else-if="status === 'ready' && visible.length === 0"
            kind="text"
            :text="t('catalog.literature.noneMatch')"
        />
        <ul v-else-if="status === 'ready'" class="liste" data-testid="catalog-list">
            <CatalogRow
                v-for="row in visible"
                :key="row.id"
                :row-id="row.id"
                :open="list.opened.value === row.id"
                :veiled="isVeiled(row)"
                :veil-label="t('infoPanel.literature.spoiler')"
                :data-role="row.spoiler ? 'play' : 'open'"
                @toggle="list.toggle(row.id)"
                @reveal="list.reveal(row.id)"
            >
                <template v-if="withImages" #bild>
                    <img
                        v-if="coverOf(row) !== undefined"
                        class="umschlag"
                        :src="row.cover?.url"
                        :width="row.cover?.width"
                        :height="row.cover?.height"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        @error="list.broke(row.cover?.url ?? '')"
                    />
                    <span v-else class="umschlag is-leer"></span>
                </template>
                <template #kopf="{ open }">
                    <span class="name" :class="{ 'is-offen': open }" data-testid="catalog-row-title">{{
                        row.title
                    }}</span>
                    <template v-if="!open">
                        <span v-if="row.meta !== ''" class="zeile-text">{{ row.meta }}</span>
                        <span v-if="row.facts !== ''" class="zeile-text">{{ row.facts }}</span>
                        <span v-if="row.containedIn !== ''" class="zeile-text is-kursiv">{{ row.containedIn }}</span>
                    </template>
                </template>
                <template #detail>
                    <CatalogEntry
                        :image="coverOf(row)"
                        :full="undefined"
                        :fallback-href="row.links[0]?.url"
                        :facts="row.detail"
                        :links="row.links"
                        :broken="list.broken.value"
                        @broke="list.broke"
                    />
                </template>
                <template #links>
                    <CatalogLinks :links="row.links" />
                </template>
            </CatalogRow>
        </ul>

        <template v-if="credit !== undefined" #fuss-hinweis>
            <CatalogCredit :text="credit" tag="span" />
        </template>
    </AvmFenster>
</template>

<style scoped>
.liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Der Umschlag der zugeklappten Zeile im Hochformat eines gedruckten Bandes (210 : 297), wie im Streifen. */
.umschlag {
    display: block;
    box-sizing: border-box;
    width: var(--icon-xl);
    /* 🪤 `height: auto`: Das Element trägt die Höhe der Datei als Attribut, und das gewänne sonst gegen das Seitenverhältnis. */
    height: auto;
    aspect-ratio: 210 / 297;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    object-fit: cover;
}

/* 🔴 Ohne Umschlag bleibt nur die Fläche stehen - ohne Rahmen, ohne Grund, ohne Zeichen (MEDIA-M12). */
.umschlag.is-leer {
    border-color: transparent;
    background: none;
}

/* Der Titel: im Fenster ein Name, kein Link (die Zeile ist der Knopf); der offene Eintrag setzt ihn größer und kräftiger. */
.name {
    display: block;
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.name.is-offen {
    font-size: var(--font-size-reading);
}

/* Die Zeilen unter dem Titel stehen in einer Größe; unterschieden werden sie über Farbe und Schnitt, nicht über Gewicht. */
.zeile-text {
    display: block;
    margin-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.zeile-text.is-kursiv {
    font-style: italic;
}
</style>
