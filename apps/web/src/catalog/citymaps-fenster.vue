<script setup lang="ts">
import { computed, ref } from "vue";
import type { SubjectCitymapsSection } from "@avesmaps3d/shared";
import AvmFenster from "../fenster/avm-fenster.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { formatNumber, t } from "../i18n/i18n";
import { catalogCredit, catalogHeading } from "../info-panel/catalog-model";
import type { CatalogTarget } from "../info-panel/panel-types";
import CatalogCredit from "./catalog-credit.vue";
import CatalogEntry from "./catalog-entry.vue";
import CatalogFilterBar from "./catalog-filter-bar.vue";
import CatalogLinks from "./catalog-links.vue";
import CatalogNotice from "./catalog-notice.vue";
import CatalogRow from "./catalog-row.vue";
import {
    citymapFacets,
    citymapFilterGroups,
    citymapFilterReduce,
    citymapMatches,
    citymapRowsOf,
    emptyCitymapFilter,
    type CitymapRow,
} from "./citymap-window-model";
import { suchtreffer, type FilterChange } from "./catalog-filter-model";
import { useCatalogList } from "./use-catalog-list";
import { useCatalogSection } from "./use-catalog-section";
import { ausgeblendet } from "../system/inhaltsstand";
import { pausiertSatz } from "../system/inhaltsstand-text";
import { editorSektionen } from "../info-panel/panel-section-load";
import { kartenvorschlagBesucher } from "../kartenvorschlag/kartenvorschlag-besucher";

/**
 * Das Fenster „Kartensammlung von …“ (WI-0118, Design Guide §12.6; Legacy `map-features-citymaps-dialog.js`, Mirror `cbe278210`): die ganze
 * Liste der Karten, die diesen Gegenstand abbilden, mit Filtern, und - der Zweck des Fensters - dem VERGRÖSSERTEN Eintrag. Ein Blatt in
 * der Breite `lesen`; diese Datei liefert nur den Inhalt, die Hülle ist `AvmFenster`.
 *
 * 🔴 Aufgebaut ist es wie in Legacy: Kopf (Titel und Zahl), Filterleiste, Liste, Fuß (der Hinweis, dass Karten externe Inhalte sind, die
 * Urheberzeile, wo Bilder stehen, und „Karte vorschlagen“). Die Leiste steht fest, nur die Liste rollt; sie zeigt nur Filter, die die Liste
 * teilen. „Spoiler“ ist kein Filter, sondern nimmt die Deckel weg.
 *
 * 🔴 „Karte vorschlagen“ öffnet seit WI-0275 Stufe C das Fenster der Besucher (`kartenvorschlag/`), das ÜBER der Sammlung aufgeht; es ist der Ersatz für Legacys anonyme Einreichung. „+ Neuer
 * Fundort“ bleibt GESPERRT, bis es Anmeldung und den ersten Schreibweg des Editors gibt (ADR-0013, WI-0068): Es steht da, hat aber keine Handlung; seine Erklärung steht als Zeile daneben.
 */
const props = defineProps<{ ziel?: CatalogTarget | undefined }>();
const offen = defineModel<boolean>("offen", { required: true });

const { status, answer, retry } = useCatalogSection<SubjectCitymapsSection>(
    "citymaps",
    () => props.ziel,
    () => offen.value,
);
/** Ein Inhaltsschalter blendet das Fenster aus (WI-0127 SYS-10): sein Satz statt der Liste, aus dem Stand der Seite oder der Antwort. */
const pausiert = computed(
    () => (!editorSektionen() && ausgeblendet("panel.citymaps")) || answer.value?.paused === true,
);
const rows = computed<CitymapRow[]>(() => (answer.value === undefined ? [] : citymapRowsOf(answer.value)));

const filter = ref(emptyCitymapFilter());
/** Die Freitextsuche (Titel, Zeichner, Verlag, `suchtext`); sie gilt wie ein Filter und wird mit ihm zurückgesetzt. */
const suche = ref("");
const list = useCatalogList({
    section: "citymaps",
    open: () => offen.value,
    target: () => props.ziel,
    rows: () => rows.value,
    reset: () => {
        filter.value = emptyCitymapFilter();
        suche.value = "";
    },
});

const facets = computed(() => citymapFacets(rows.value));
const groups = computed(() => citymapFilterGroups(facets.value, filter.value));
const visible = computed(() => rows.value.filter((row) => citymapMatches(row, filter.value) && gesucht(row)));
const change = (next: FilterChange): void => {
    filter.value = citymapFilterReduce(filter.value, next);
};

const isVeiled = (row: CitymapRow): boolean =>
    row.spoiler && !filter.value.spoilers && !list.revealed.value.has(row.id);
/** 🔴 Eine Suche trifft nie eine verdeckte Zeile: Sonst verriete der Treffer den Titel, den der Deckel verbirgt. */
function gesucht(row: CitymapRow): boolean {
    return suche.value.trim() === "" || (!isVeiled(row) && suchtreffer(row.suchtext, suche.value));
}

/** Die Bilder, die der Browser nicht laden konnte, fallen aus der Zeile (`@error`); niemand erfährt, dass es eines gäbe. */
const imageOf = (row: CitymapRow): CitymapRow["preview"] =>
    row.preview !== undefined && !list.broken.value.includes(row.preview.url) ? row.preview : undefined;
/**
 * Die gewählte Version je Zeile (WI-0287 Stufe 2, Entwurf `frontendInhalt`): ab zwei Versionen zeigt der vergrößerte Eintrag Reiter mit ihren Bezeichnungen, die gewählte mit
 * ihrem Vollbild, sonst mit der Vorschau. Ohne Wahl die erste.
 */
const versionen = ref<ReadonlyMap<string, string>>(new Map());
const versionVon = (row: CitymapRow): string => versionen.value.get(row.id) ?? "0";
function waehleVersion(row: CitymapRow, id: string): void {
    versionen.value = new Map(versionen.value).set(row.id, id);
}
const versionsReiter = (row: CitymapRow): { id: string; name: string }[] =>
    row.versions.map((version, index) => ({ id: String(index), name: version.name }));
const fullOf = (row: CitymapRow): CitymapRow["full"] => {
    const full = row.versions.length > 1 ? row.versions[Number(versionVon(row))]?.full : row.full;
    return full !== undefined && !list.broken.value.includes(full.url) ? full : undefined;
};
/** Trägt die Liste überhaupt ein Bild? Nur dann hat die zugeklappte Zeile eine Bildfläche, die die Namen auf einer Kante hält. */
const withImages = computed(() => rows.value.some((row) => imageOf(row) !== undefined));

const title = computed(() => catalogHeading("citymaps", props.ziel?.name));
const count = computed(() => {
    if (status.value !== "ready" || rows.value.length === 0) return undefined;
    return visible.value.length === rows.value.length
        ? `(${formatNumber(visible.value.length, 0)})`
        : `(${t("catalog.count.of", { shown: formatNumber(visible.value.length, 0), total: formatNumber(rows.value.length, 0) })})`;
});
/**
 * 🪤 Gefragt wird, was die Liste TRÄGT, nicht was der Browser geladen hat (wie im Streifen, `catalogCredit`): Ein Bild, dessen Adresse nicht
 * lädt, ist ein Unfall und keine Aussage über die Rechte.
 */
const credit = computed(() => catalogCredit(rows.value.map((row) => row.preview)));

/**
 * „Karte vorschlagen“ (WI-0275 Stufe C): das Fenster der Besucher geht ÜBER der Sammlung auf (beide sind modal; das jüngere liegt oben) und lässt sie darunter stehen. `hatKarten` sagt, ob die
 * Sammlung schon etwas trägt: „Für die erste Karte von …“ statt „Für die Kartensammlung von …“.
 */
function vorschlagen(): void {
    const ziel = props.ziel;
    kartenvorschlagBesucher.oeffne({
        ...(ziel?.ref.kind === "place" ? { id: ziel.ref.id } : {}),
        name: ziel?.name ?? "",
        hatKarten: rows.value.length > 0,
    });
}
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="blatt"
        breite="lesen"
        :titel="title"
        :zusatz="count"
        testid="citymaps-window"
    >
        <template v-if="rows.length >= 2" #leiste>
            <CatalogFilterBar
                v-model:suche="suche"
                :groups="groups"
                :platzhalter="t('catalog.citymaps.search')"
                :beschriftung="t('catalog.citymaps.searchLabel')"
                @change="change"
            />
        </template>

        <CatalogNotice v-if="pausiert" kind="text" :text="pausiertSatz('panel.citymaps') ?? ''" />
        <CatalogNotice v-else-if="status === 'loading'" kind="loading" :text="t('catalog.loading')" />
        <CatalogNotice v-else-if="status === 'error'" kind="error" :text="t('catalog.error')" @retry="retry" />
        <CatalogNotice
            v-else-if="status === 'ready' && rows.length === 0"
            kind="text"
            :text="t('catalog.citymaps.empty')"
        />
        <template v-else-if="status === 'ready' && visible.length === 0">
            <CatalogNotice kind="text" :text="t('catalog.citymaps.noneMatch')" />
            <button type="button" class="fehlt-eine" data-testid="catalog-suggest-none" @click="vorschlagen">
                {{ t("kartenvorschlag.fehltEine") }}
            </button>
        </template>
        <ul v-else-if="status === 'ready'" class="liste" data-testid="catalog-list">
            <CatalogRow
                v-for="row in visible"
                :key="row.id"
                :row-id="row.id"
                :open="list.opened.value === row.id"
                :veiled="isVeiled(row)"
                :veil-label="t('infoPanel.citymaps.spoiler')"
                @toggle="list.toggle(row.id)"
                @reveal="list.reveal(row.id)"
            >
                <template v-if="withImages" #bild>
                    <img
                        v-if="imageOf(row) !== undefined"
                        class="klein"
                        :src="row.preview?.url"
                        :width="row.preview?.width"
                        :height="row.preview?.height"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        @error="list.broke(row.preview?.url ?? '')"
                    />
                    <span v-else class="klein is-leer"></span>
                </template>
                <template #kopf="{ open }">
                    <template v-if="open">
                        <span class="titel" data-testid="catalog-row-title">{{ row.title }}</span
                        ><span
                            v-if="row.versions.length > 1"
                            class="zusatz versionen"
                            data-testid="catalog-row-versions"
                            >{{ t("catalog.citymaps.versions", { n: formatNumber(row.versions.length, 0) }) }}</span
                        >
                    </template>
                    <template v-else>
                        <span class="name" data-testid="catalog-row-name">{{ row.band }}</span
                        ><span v-if="row.suffix !== ''" class="zusatz"> · {{ row.suffix }}</span>
                    </template>
                </template>
                <template #detail>
                    <FensterReiter
                        v-if="row.versions.length > 1"
                        class="versionen-reiter"
                        :model-value="versionVon(row)"
                        :reiter="versionsReiter(row)"
                        :beschriftung="t('catalog.citymaps.versionsLabel')"
                        :kennung="`citymap-${row.id}-versionen`"
                        @update:model-value="(id: string) => waehleVersion(row, id)"
                    />
                    <div
                        :id="
                            row.versions.length > 1
                                ? `citymap-${row.id}-versionen-inhalt-${versionVon(row)}`
                                : undefined
                        "
                        :role="row.versions.length > 1 ? 'tabpanel' : undefined"
                        :aria-labelledby="
                            row.versions.length > 1
                                ? `citymap-${row.id}-versionen-reiter-${versionVon(row)}`
                                : undefined
                        "
                    >
                        <CatalogEntry
                            :image="imageOf(row)"
                            :full="fullOf(row)"
                            :fallback-href="row.bestLink"
                            :facts="row.facts"
                            :links="row.links"
                            :links-empty="t('catalog.link.none')"
                            :broken="list.broken.value"
                            @broke="list.broke"
                        >
                            <button type="button" class="gesperrt" disabled data-testid="catalog-add-source">
                                {{ t("catalog.citymaps.addSource") }}
                            </button>
                            <span class="gesperrt-hinweis">{{ t("catalog.citymaps.addSourceLocked") }}</span>
                        </CatalogEntry>
                    </div>
                </template>
                <template #links>
                    <CatalogLinks :links="row.links" :empty="t('catalog.link.none')" />
                </template>
            </CatalogRow>
        </ul>

        <template #fuss-hinweis>
            <span class="fuss">
                <span data-testid="catalog-foot-hint">{{ t("catalog.citymaps.footHint") }}</span>
                <CatalogCredit v-if="credit !== undefined" :text="credit" tag="span" />
            </span>
        </template>
        <template #fuss-haupt>
            <button type="button" data-testid="catalog-suggest" @click="vorschlagen">
                <img class="feder" src="/icons/menu/feder.webp" alt="" width="80" height="80" decoding="async" />
                {{ t("infoPanel.citymaps.suggest") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.liste {
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Das kleine Bild der zugeklappten Zeile: Legacys 48 × 34 (Verhältnis 7 : 5), das Bild füllt die Fläche formatunabhängig. */
.klein {
    display: block;
    box-sizing: border-box;
    width: var(--icon-xxl);
    /* 🪤 `height: auto`: Das Element trägt die Höhe der Datei als Attribut, und das gewänne sonst gegen das Seitenverhältnis. */
    height: auto;
    aspect-ratio: 7 / 5;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    object-fit: cover;
}

/* 🔴 Ohne Bild bleibt nur die Fläche stehen - ohne Rahmen, ohne Grund, ohne Zeichen (MEDIA-M12): Sie hält die Namen auf einer Kante. */
.klein.is-leer {
    border-color: transparent;
    background: none;
}

.name {
    color: var(--color-link);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.zusatz {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der volle Titel des offenen Eintrags: die Überschrift der Karte. */
.titel {
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

/* „2 Versionen“ hinter dem Titel (WI-0287 Stufe 2, Entwurf `fe-zeile`): leise, mit Abstand. */
.versionen {
    margin-left: var(--space-6);
    white-space: nowrap;
}

/* Die Reiter der Versionen stehen über dem Bild, mit Luft darunter. */
.versionen-reiter {
    margin-bottom: var(--space-8);
}

.gesperrt {
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-disabled-border);
    border-radius: var(--radius-md);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
    font: inherit;
    font-size: var(--font-size-caption);
}

/* „Fehlt eine? Karte vorschlagen“ unter einer Suche ohne Treffer: leise, mittig, ein echter Knopf. */
.fehlt-eine {
    display: block;
    margin: 0 auto var(--space-16);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.fehlt-eine:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.fehlt-eine:active {
    background: var(--color-button-soft-active);
}

.fehlt-eine:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .fehlt-eine {
        transition: none;
    }
}

.gesperrt-hinweis {
    margin-left: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der Fuß: der Hinweis, die Urheberzeile und die Erklärung der gesperrten Kachel, je in einer Zeile. */
.fuss {
    display: grid;
    gap: var(--space-2);
}

/* Das Zeichen vor „Karte vorschlagen“: die Sprosse `icon.md`, wie die Kachel im Panel. */
.feder {
    display: block;
    width: var(--icon-md);
    height: var(--icon-md);
    object-fit: contain;
}
</style>
