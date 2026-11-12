<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, useId, watch } from "vue";
import { subjectKey, type SourceEntry } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import InfoSourceLine from "./info-source-line.vue";
import InfoSourceList from "./info-source-list.vue";
import type { SourceListModel, WikiModel } from "./panel-types";
import {
    cachedSources,
    emptySources,
    hasBox,
    loadSources,
    sourceBoxOf,
    sourcesModelOf,
    type SourcesModel,
} from "./source-model";

/**
 * Der Quellenkasten (Design Guide §16.4, Legacy `.fs-src--box`, `buildSourceListMarkup`): EIN Kasten für alles, was sagt, WOHER das Panel
 * seine Angaben hat. Zone 1 „Quelle:“ / „Quellen:“ trägt die Wikizeile und jede von Hand zugeordnete Quelle (`info-source-line.vue`), ein
 * Trenner scheidet sie von Zone 2 „Publikationen:“, deren Reiter „Beschrieben (n)“ und „Erwähnt (n)“ je eine Liste aufklappen
 * (`info-source-list.vue`: Titel mit Typ darunter, Seiten rechts; unter „Beschrieben“ in den Gruppen Ausführlich und Ergänzend). Was das
 * Modell trägt (`source-model.ts`), steht da; ohne Wikizeile, Quelle und Beleg entsteht kein Kasten.
 *
 * 🔴 Die Liste kommt sofort, nicht erst auf Klick (Legacy zeigt Zone 1 und die Reiterzahlen ohne): Meldet die Detailantwort Quellen
 * (`counts.sources`), holt der Kasten sie in EINER abbrechbaren Frage. Bis sie da ist, steht die Wikizeile schon (sie kommt aus der Detailantwort),
 * und unter ihr hält eine ruhige Zeile den Platz der Publikationen, damit nichts springt. Ein Fehler zeigt dort eine kleine Zeile samt
 * „Noch einmal versuchen“ und zerstört den Rest des Panels nicht (WI-0063 5.3). Der Kasten gehört zu seinem Subject: Wechselt es, bricht
 * er die Frage ab, und eine verspätete Antwort eines anderen gilt nie.
 *
 * Gruppiert wird durch einen Trenner, nicht durch einen Rahmen (AGENTS.md §12): der Trenner läuft über die volle Kastenbreite, nur
 * wo oben wirklich etwas steht.
 */
const props = defineProps<{
    wiki?: WikiModel | undefined;
    sources?: SourceListModel | undefined;
    /**
     * Die Publikationen und Quellen, die die Antwort des Gegenstands schon mitbringt (der Eintrag eines Vorkommens, WI-0260): Dann gibt es keine Quellenroute und keine Wartezeile, der Kasten
     * steht sofort da. Hat der Gegenstand eine Liste unter einem Ref (`sources`), gilt diese.
     */
    entries?: readonly SourceEntry[] | undefined;
}>();

type Status = "loading" | "ready" | "error";
const status = ref<Status>("ready");
const loaded = shallowRef<SourcesModel>(emptySources());
/** Der Reiter, dessen Liste offen ist; ein zweiter Klick auf ihn klappt sie zu, der andere wechselt (Legacy `avesmapsToggleSourceTab`). */
const tab = ref<"described" | "mentioned" | null>(null);
const listPanel = useId();

let controller: AbortController | undefined;

async function load(): Promise<void> {
    controller?.abort();
    const list = props.sources;
    if (list === undefined) {
        loaded.value = props.entries === undefined ? emptySources() : sourcesModelOf({ sources: [...props.entries] });
        status.value = "ready";
        return;
    }
    // Eine frische Liste aus dem Cache zeichnet ohne Wartezeile.
    const hit = cachedSources(list.ref);
    if (hit !== undefined) {
        loaded.value = sourcesModelOf(hit);
        status.value = "ready";
        return;
    }
    const own = new AbortController();
    controller = own;
    status.value = "loading";
    try {
        const section = await loadSources(list.ref, own.signal);
        if (own.signal.aborted) return;
        loaded.value = section === null ? emptySources() : sourcesModelOf(section);
        status.value = "ready";
    } catch (error) {
        if (own.signal.aborted) return;
        console.error("Infopanel: Quellen nicht geladen", error);
        status.value = "error";
    }
}

// Die Liste gehört zum Ref, den die Detailantwort nennt: Er kommt erst mit der Antwort und ändert sich mit dem Subject. Eine mitgebrachte Liste (`entries`) ersetzt der Kasten, sobald sie wechselt.
watch(
    [() => (props.sources === undefined ? "" : subjectKey(props.sources.ref)), () => props.entries],
    () => {
        tab.value = null;
        void load();
    },
    { immediate: true },
);
onBeforeUnmount(() => controller?.abort());

/** Unter der ersten Zone steht eine Zeile statt der Reiter: Die Liste lädt oder ist gescheitert. */
const noteBelow = computed(() => status.value !== "ready");
const box = computed(() => sourceBoxOf(props.wiki, loaded.value, noteBelow.value));
const visible = computed(() => hasBox(box.value, noteBelow.value));
const openTab = computed(() => box.value.tabs.find((entry) => entry.key === tab.value));

const toggleTab = (name: "described" | "mentioned"): void => {
    tab.value = tab.value === name ? null : name;
};
</script>

<template>
    <section v-if="visible" class="info-source" data-testid="info-source" :aria-busy="status === 'loading'">
        <template v-if="box.lines.length > 0">
            <p class="info-source__label" data-testid="info-source-label">{{ box.label }}</p>
            <ul class="info-source__list" data-testid="info-source-list">
                <InfoSourceLine v-for="line in box.lines" :key="line.key" :line="line" />
            </ul>
        </template>
        <div
            v-if="box.divider"
            class="info-source__divider"
            role="presentation"
            data-testid="info-source-divider"
        ></div>
        <div v-if="noteBelow || box.tabs.length > 0" class="info-source__pub-zone">
            <p v-if="status === 'loading'" class="info-source__note" data-testid="info-sources-loading">
                <!-- Derselbe Schnitt wie die Aufschrift eines Reiters (`.avm-versalmitte`): nur so ist die wartende
                     Zeile so hoch wie die Reiterzeile, die sie vertritt. Siehe den Satz am Stilblatt unten. -->
                <span class="avm-versalmitte">{{ t("infoPanel.sources.loading") }}</span>
            </p>
            <template v-else-if="status === 'error'">
                <p class="info-source__note" data-testid="info-sources-error">{{ t("infoPanel.sources.error") }}</p>
                <button type="button" class="info-source__retry" data-testid="info-sources-retry" @click="load">
                    {{ t("infoPanel.retry") }}
                </button>
            </template>
            <template v-else>
                <div class="info-source__pub" data-testid="info-sources-pub">
                    <span class="info-source__publabel einzeilig" :title="t('infoPanel.sources.publications')">{{
                        t("infoPanel.sources.publications")
                    }}</span>
                    <button
                        v-for="entry in box.tabs"
                        :key="entry.key"
                        type="button"
                        class="info-source__tab"
                        :class="{ 'is-active': tab === entry.key }"
                        :aria-expanded="tab === entry.key"
                        :aria-controls="listPanel"
                        :title="entry.hint"
                        :data-testid="`info-sources-tab-${entry.key}`"
                        @click="toggleTab(entry.key)"
                    >
                        <span class="avm-versalmitte">{{ entry.label }}</span>
                        <span class="info-source__n avm-versalmitte">({{ entry.count }})</span>
                    </button>
                </div>
                <InfoSourceList v-if="openTab !== undefined" :id="listPanel" :groups="openTab.groups" />
            </template>
        </div>
    </section>
</template>

<style scoped>
/* Legacys Kasten: Fläche `panel-soft`, 1 px Rand, Polster 6 × 8. Den Radius 7 führt der Guide als LEGACY DEBT (§16.5): hier der nächste des Kanons. */
.info-source {
    margin: var(--space-8) var(--info-pad-x) 0;
    padding: var(--space-4) var(--space-6);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: var(--leading-normal);
}

.info-source__label {
    margin: 0 0 var(--space-2);
    color: var(--color-text);
}

.info-source__list {
    display: grid;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Der Trenner läuft über die volle Kastenbreite: Die negativen Ränder sind das Seitenpolster des Kastens (Legacy `.fs-src-trenner`, −8 px). */
.info-source__divider {
    margin: var(--space-6) calc(-1 * var(--space-6)) 0;
    border-top: 1px solid var(--color-divider);
}

.info-source__divider + .info-source__pub-zone {
    margin-top: var(--space-6);
}

.info-source__note {
    margin: 0;
    color: var(--color-text-muted);
}

/*
 * Die wartende Zeile hat die Höhe eines Reiters: gleiche Schrift, gleiches Polster, Rand durchsichtig - und seit WI-0102
 * auch derselbe SCHNITT. Trifft die Liste ein, springt nichts.
 *
 * 💣 Genau daran hing der dauerhaft rote Fall „der Kasten springt nicht" (`info-panel-grammar.spec.ts`), Fehlbetrag
 * 7,40625 px, gemessen am 2026-10-07: Die drei gleichen Werte (11 px Schrift, 2 × 4 px Polster, 2 × 1 px Rand) stimmten,
 * aber die Aufschrift des Reiters trägt `.avm-versalmitte` und ist damit auf die Versalhöhe geschnitten - 8,53125 px statt
 * des ganzen Zeilenkastens von 15,9375 px (11 × 1,45 = 15,95, in Chromiums 1/64-Raster 15,9375). Die Differenz ist
 * 15,9375 − 8,53125 = 7,40625 px, und um genau die SCHRUMPFTE der Kasten, sobald die Publikationen eintrafen. Die
 * wartende Zeile trägt deshalb denselben Schnitt; beide Zeilen messen jetzt 18,53125 px.
 *
 * 🪤 Die Zahl ist kein Grenzwert, der hier stehen müsste - sie steht nur zur Erklärung da. Gemessen wird am gezeichneten
 * Bild, und die Zeilen sollen GLEICH hoch sein, nicht „um 7,4 px verschieden".
 */
.info-source__pub-zone > .info-source__note:only-child {
    padding: var(--space-2) 0;
    border: 1px solid transparent;
    font-size: var(--font-size-caption);
}

.info-source__retry {
    margin-top: var(--space-4);
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

.info-source__retry:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-source__retry:active {
    background: var(--color-button-soft-active);
}

.info-source__retry:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Zone 2: „Publikationen:“ und die Reiter stehen in EINER Zeile, auf jeder Breite.
 *
 * 🔴 Betreiber 2026-10-11 zum Befund WI-0102 F1: **„Telefon: mit ... abschneiden“**. Vorher brach die Zeile um, sobald
 * sie nicht passte: Sie braucht 292,68 px (78,38 Aufschrift + 109,16 und 93,14 die Reiter + 2 × 6 Abstand), bei 390 px
 * Fenster bleiben 291, bei 360 px 261. Bei 360 px stand sie damit in zwei Reihen (43,06 statt 18,53 px), und weil die
 * wartende Zeile nicht wissen kann, ob ein oder zwei Reiter kommen, wuchs der Kasten beim Eintreffen um 24,53 px.
 *
 * Gekürzt wird nach der Rezeptur der Planerleiste und der Klappbox (WI-0089, WI-0098): Die Reihe bricht nicht um, das
 * Textfeld gibt nach und kürzt am Ende über die Hausklasse `.einzeilig` (app.vue), der volle Text steht im `title`.
 * Nachgeben darf nur die Aufschrift: Die Reiter sind Knöpfe mit einer Zahl, und eine Zahl kürzt nie (WI-0098 §5).
 * `flex: 0 1 auto` und nicht `1 1 auto`: Die Aufschrift wächst nicht, am Rechner bleibt alles, wo es war.
 */
.info-source__pub {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-4);
    color: var(--color-text-muted);
}

.info-source__pub > * {
    flex: 0 0 auto;
}

.info-source__pub > .info-source__publabel {
    flex: 0 1 auto;
    min-width: 0;
}

/* Der Reiter (Guide §30.5): Ruhe, Hover (Fläche und Rand), gedrückt, Fokus, Übergang 120 ms. Gesperrt gibt es nicht: Ein Reiter ohne Inhalt entsteht gar nicht.
   Seine Schrift sitzt mittig nach der Hausregel `.avm-versalmitte` (`styles/canon.css`): Beschriftung und Zahl stehen je in einem eigenen Feld, auf die Versalhöhe geschnitten. */
.info-source__tab {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-2) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.info-source__tab:hover {
    border-color: var(--color-border-strong);
    background: var(--color-panel-muted);
}

.info-source__tab:active {
    background: var(--color-panel-active);
}

.info-source__tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Der offene Reiter: Goldwäsche und Akzentfarbe (Legacy `.fs-src-tab.is-active`). */
.info-source__tab.is-active {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
    color: var(--color-accent-strong);
}

.info-source__n {
    color: inherit;
}

@media (prefers-reduced-motion: reduce) {
    .info-source__retry,
    .info-source__tab {
        transition: none;
    }
}
</style>
