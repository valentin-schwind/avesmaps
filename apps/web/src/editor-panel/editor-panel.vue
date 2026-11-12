<script setup lang="ts">
import { computed, nextTick, watch } from "vue";
import { EDITORPANEL, kinder } from "@avesmaps3d/shared";
import { oeffnenPlan, subjektRefVon, type ObjektZiel } from "../aenderungen/aenderung-modell";
import { gilt, sprungZuAenderungen } from "../aenderungen/sprung";
import FensterReiter from "../fenster/fenster-reiter.vue";
import OrtEntfernenFenster from "../ortseditor/ort-entfernen-fenster.vue";
import OrtUmwandelnFenster from "../ortseditor/ort-umwandeln-fenster.vue";
import { createOrtseditorDaten } from "../ortseditor/ortseditor-daten";
import { t } from "../i18n/i18n";
import type { SubjectSelection } from "../info-panel/subject-selection";
import type { HinflugAnsicht } from "../map/hinflug-ansicht";
import type { NavStand } from "./editor-panel-nav";
import EditorBearbeitungen from "./editor-bearbeitungen.vue";
import { navName, type EditorpanelId } from "./editor-panel-texte";
import type { KarteninhaltZahlen } from "./karteninhalte-zahlen";
import { rumpfVon } from "./komponenten";
import type { Werkzeugfenster } from "./werkzeugfenster";

/**
 * Das Editorpanel am rechten Rand (WI-0128 E3; EDIT-0001 §3.2, §4.1; Legacy `#review-panel`, Mirror `cfbbe69c8`
 * `index.html:460-856`). Es teilt den rechten Slot mit dem Infopanel: zwei Laschen, ein Slot, eins offen
 * (`subject-selection.ts`, Legacy `window.avesmapsEdgePanels`).
 *
 * - **Die Lasche „Editor“** steht unter „Info“ (Legacy `infopanel.css:831`: `top` = Lasche + Höhe + 10 px), dunkel, senkrecht,
 *   um 180° gedreht wie in Legacy. Beide Laschen sitzen an der Kante des offenen Slots, sonst an der Bildschirmkante.
 * - **Kopf, Hauptreiter, Rumpf** (Guide §10: Kopf steht, nur der Rumpf läuft). Die Reiter kommen aus dem Navigationsregister
 *   (`EDITORPANEL`); spätere stehen gedämpft da (D16). Der Rumpf je Reiter steht in `komponenten.ts`.
 * - 🔴 **Es meldet sich als Rand** (`data-map-overlay="right"`), wenn es vorn steht; sonst `inert`, dann zählt es für die Kamera
 *   nicht (AGENTS.md „Die Kamera“).
 * - **Am Telefon** volle Höhe mit ✕, ohne Lasche, solange es offen ist; Planer und Slot schließen einander aus (`phone-exclusion.ts`).
 */
const props = defineProps<{
    selection: SubjectSelection;
    phone: boolean;
    nav: NavStand;
    rechte: readonly string[];
    werkzeuge: ReadonlySet<string>;
    /** Die offenen Werkzeugfenster (E6); ihre Ablage steht unter „Offene Bearbeitungen“. */
    fenster: Werkzeugfenster;
    /** Die Zahlen der Kacheln „Karteninhalte“ (WI-0212); geholt erst, wenn der Reiter zu sehen ist. */
    zahlen?: KarteninhaltZahlen | undefined;
}>();
const emit = defineEmits<{
    oeffne: [werkzeug: string, modus: "bearbeiten" | "lesen"];
    messwerte: [];
    /** Eine Kachel der Karteninhalte wurde gewählt: die Karte auf die Ansicht ihres Inhalts (EDIT-0003 T37). */
    ansicht: [ziel: HinflugAnsicht];
}>();

/**
 * Steht das Messfenster gelöst oder angedockt da, zeigt der Reiter „Status“ seinen Block nicht noch einmal (WI-0138 V15).
 * Gefragt wird die Fensterverwaltung selbst - sie ist die eine Quelle, hier wie unter „Offene Bearbeitungen“.
 */
const messwerteOffen = computed(() =>
    props.fenster.stand.value.fenster.some(
        (fenster) => fenster.werkzeug === "messwerte" && fenster.lage !== "versenkt",
    ),
);

/**
 * ⊕ und ⚙ aus „Änderungen“ (E17): Der Ort wird gewählt und angeflogen; ⚙ öffnet ihn danach im Ortseditor über dasselbe Verb wie
 * „⚙ Orte bearbeiten“ (es öffnet den gewählten Ort).
 */
function ortZeigen(publicId: string, oeffnen: boolean): void {
    props.selection.openSubject({ kind: "place", id: publicId }, { source: "link", camera: "target", still: oeffnen });
    if (oeffnen) emit("oeffne", "ortseditor", "bearbeiten");
}

/**
 * "⚙ Im Objektverlauf zeigen" aus "Änderungen" (WI-0265 B5a): das Objekt wählen und sein Werkzeug öffnen. Wie (Subjekt, Öffnung, Reihenfolge)
 * steht in `oeffnenPlan`: Die Fenster der Editoren öffnen sich nur für eine Öffnung `map`, und ein Weg und eine Kraftlinie heißen `anchor`
 * statt `id`. Den Verlauf des Fensters wählt der Sprung selbst (`aenderungen/sprung.ts`).
 */
function objektOeffnen(ziel: ObjektZiel, id: string): void {
    const plan = oeffnenPlan(ziel, id);
    if (plan.werkzeugZuerst) emit("oeffne", plan.werkzeug, "bearbeiten");
    props.selection.openSubject(plan.ref, plan.optionen);
    if (!plan.werkzeugZuerst) emit("oeffne", plan.werkzeug, "bearbeiten");
}

/** Ein Objektname in der Editorenliste (WI-0276): das Objekt wählen und anfliegen. Sein Werkzeug bleibt zu, die Liste bleibt stehen. */
function objektZeigen(ziel: ObjektZiel, id: string): void {
    props.selection.openSubject(subjektRefVon(ziel, id), { source: "link", camera: "target", still: true });
}

/**
 * "⇄ In Änderungen zeigen" aus einem Objektverlauf: der Reiter "Änderungen" kommt nach vorn und wählt die Operation selbst. Ein angedocktes
 * Werkzeugfenster deckt das Panel zu (beide teilen den rechten Rand); es wird abgelegt wie bei der Lasche "Info" (der Entwurf bleibt, die Ablage
 * unter "Offene Bearbeitungen" und die Lasche "Editor" holen es zurück). Das Ablegen folgt erst, wenn die Seite auf das Zeigen des Panels
 * reagiert hat: Die Lasche "Editor" holte sonst ein früher abgelegtes Fenster gleich wieder her.
 */
watch(
    sprungZuAenderungen,
    (sprung) => {
        if (sprung === undefined || !gilt(sprung.seit)) return;
        props.selection.showEditor();
        props.nav.waehle("aenderungen");
        void nextTick(() => props.fenster.infoLasche());
    },
    { flush: "sync" },
);

const vorn = props.selection.editorVisible;
const slotOffen = props.selection.slotOpen;

const reiter = computed(() =>
    kinder(EDITORPANEL, null, props.rechte).map((eintrag) => ({
        id: eintrag.id,
        name: t(navName(eintrag.id as EditorpanelId)),
        spaeter: eintrag.art === "spaeter" ? t("editorPanel.spaeter.satz") : undefined,
    })),
);
const aktiv = computed({
    get: () => props.nav.gewaehlt(null) ?? "",
    set: (id: string) => props.nav.waehle(id),
});
const rumpf = computed(() => rumpfVon(aktiv.value));
/** Das Blatt „Ort entfernen“ (E22) braucht nur die Lese- und Schreibwege des Orts. */
const entfernenApi = createOrtseditorDaten();
</script>

<template>
    <div class="editor-panel" :class="{ 'is-open': slotOffen, 'is-vorn': vorn, 'is-phone': phone }">
        <aside
            class="editor-panel__stack"
            :inert="!vorn"
            data-map-overlay="right"
            data-testid="editor-panel"
            :aria-label="t('editorPanel.label')"
        >
            <button
                v-if="phone"
                type="button"
                class="editor-panel__close"
                :aria-label="t('editorPanel.close')"
                :title="t('editorPanel.close')"
                data-testid="editor-panel-close"
                @click="selection.closeEditor()"
            >
                <span aria-hidden="true">✕</span>
            </button>
            <header class="editor-panel__kopf">
                <h2 class="editor-panel__titel avm-versalmitte">{{ t("editorPanel.title") }}</h2>
            </header>
            <FensterReiter
                v-model="aktiv"
                class="editor-panel__reiter"
                :reiter="reiter"
                :beschriftung="t('editorPanel.reiter')"
                kennung="editorpanel"
                verteilt
            />
            <div
                :id="`editorpanel-inhalt-${aktiv}`"
                class="editor-panel__rumpf"
                role="tabpanel"
                :aria-labelledby="`editorpanel-reiter-${aktiv}`"
            >
                <component
                    :is="rumpf"
                    v-if="rumpf"
                    :nav="nav"
                    :rechte="rechte"
                    :werkzeuge="werkzeuge"
                    :phone="phone"
                    :messwerte-offen="messwerteOffen"
                    :zahlen="zahlen"
                    :sichtbar="vorn && slotOffen"
                    @oeffne="(werkzeug: string, modus: 'bearbeiten' | 'lesen') => emit('oeffne', werkzeug, modus)"
                    @messwerte="emit('messwerte')"
                    @ansicht="(ziel: HinflugAnsicht) => emit('ansicht', ziel)"
                    @ort="ortZeigen"
                    @objekt="objektOeffnen"
                    @zeigen="objektZeigen"
                >
                    <template #bearbeitungen>
                        <EditorBearbeitungen :fenster="fenster" />
                    </template>
                </component>
            </div>
        </aside>

        <button
            v-if="!phone || !vorn"
            type="button"
            class="editor-panel__tab"
            :class="{ 'is-vorn': vorn }"
            :aria-expanded="vorn"
            :title="vorn ? t('editorPanel.tab.close') : t('editorPanel.tab.open')"
            data-testid="editor-panel-tab"
            @click="selection.toggleEditor()"
        >
            {{ t("editorPanel.tab") }}
        </button>
        <!-- „Ort entfernen“ (WI-0128 E22): EIN Blatt für Infopanel, Kontextmenü, Menü am Objekt und Ortseditor. -->
        <OrtEntfernenFenster :api="entfernenApi" :rechte="rechte" />
        <OrtUmwandelnFenster :api="entfernenApi" />
    </div>
</template>

<style scoped>
/*
 * Wie das Infopanel (`info-panel.vue`): ein Behälter ohne Breite am rechten Rand, zu um die Panelbreite nach rechts geschoben.
 * 🔴 Offen heißt hier „der Slot ist offen“, nicht „der Editor ist vorn“: Die Lasche sitzt an der Kante des Slots, auch wenn das
 * Infopanel vorn steht. Wechseln Info und Editor, fährt nichts; nur der Inhalt tauscht.
 */
.editor-panel {
    --editor-w: min(var(--avesmaps-infopanel-width), 100vw - var(--avesmaps-tab-w));
    position: absolute;
    top: 0;
    right: 0;
    z-index: var(--z-map-panel);
    width: 0;
    height: 100%;
    transform: translateX(var(--editor-w));
    transition: transform 220ms ease;
}

.editor-panel.is-phone {
    --editor-w: min(var(--avesmaps-infopanel-width), 100vw - 2 * var(--space-10));
}

.editor-panel.is-open {
    transform: none;
}

/* Zugeklappt verschwindet es nach der Fahrt ganz (sonst ragte der Schatten an den Rand); steht Info vorn, sofort. */
.editor-panel:not(.is-open) .editor-panel__stack {
    visibility: hidden;
    transition: visibility 0s linear 220ms;
}

.editor-panel.is-open:not(.is-vorn) .editor-panel__stack {
    visibility: hidden;
}

/* Bündig von oben bis unten, ohne Rundung - dieselbe Fläche wie das Infopanel (Betreiber 2026-10-31). */
.editor-panel__stack {
    position: absolute;
    top: 0;
    right: 0;
    /* Endet über der Leiste der Reisebilder, wenn sie offen ist (WI-0272 S4). */
    bottom: var(--avm-reisebilder-leiste, 0px);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: var(--editor-w);
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.is-phone .editor-panel__stack {
    top: 0;
    bottom: 0;
    border-radius: 0;
}

/* Guide §10: Kopfleiste 6 / 14, Titel `subhead`; darunter die Hauptreiter mit durchgehender Haarlinie. */
/*
 * Der Kopf trägt den Namen des Panels und braucht Luft: 6 px über dem Titel klebten ihn an die Reiterzeile (Betreiber
 * 2026-10-13: „kannst du dem header etwas mehr platz geben"). Jetzt 12 über und 10 unter dem Titel - dieselben Sprossen
 * wie der Fensterkopf (`avm-fenster.vue`), damit beide Köpfe im Haus gleich atmen.
 */
.editor-panel__kopf {
    flex: none;
    padding: var(--space-12) var(--space-12) var(--space-10);
}

.editor-panel__titel {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: normal;
    line-height: var(--leading-tight);
}

/* Die Reiterzeile steht als eigene Zeile unter dem Titel, nicht an ihm; die Linie der Leiste läuft bis an die Ränder. */
.editor-panel__reiter {
    flex: none;
    padding-inline: var(--space-12);
}

.editor-panel__rumpf {
    flex: 1 1 auto;
    min-height: 0;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
}

/*
 * Die Lasche „Editor“ (Guide §9 „Panel-Laschen“, §17.2): dasselbe dunkle Brett wie „Info“, darunter. Legacy dreht sie um 180°
 * (`review-panel.css`); die Rundung steht darum vor der Drehung rechts und landet links.
 */
.editor-panel__tab {
    position: absolute;
    top: calc(var(--avesmaps-tab-top) + var(--avesmaps-tab-h) + var(--space-8));
    /* An der Kante eines angedockten Werkzeugfensters, wenn eins da ist (`--avm-slot-breite` aus `app.vue`). */
    right: var(--avm-slot-breite, var(--editor-w));
    width: var(--avesmaps-tab-w);
    height: var(--avesmaps-tab-h);
    padding: 0;
    border: 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    background: var(--color-button);
    box-shadow: var(--shadow-panel);
    color: var(--color-button-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    text-align: center;
    text-orientation: mixed;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    /* `right` wandert mit, wenn ein Werkzeugfenster seine Liste einzieht (WI-0128 P1), in der Zeit des Panels (Guide §16). */
    transition:
        right 220ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

.editor-panel__tab:hover {
    background: var(--color-button-hover);
}

.editor-panel__tab:active {
    background: var(--color-button-active);
}

.editor-panel__tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/* Das ✕ gibt es nur am Telefon, wie beim Infopanel. */
.editor-panel__close {
    position: absolute;
    top: var(--space-6);
    right: var(--space-6);
    z-index: 1;
    display: grid;
    place-items: center;
    width: var(--avesmaps-infopanel-close);
    height: var(--avesmaps-infopanel-close);
    padding: 0;
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-body);
    line-height: 1;
    transition: background-color 120ms ease;
}

.editor-panel__close:hover {
    background: var(--color-button-soft-hover);
}

.editor-panel__close:active {
    background: var(--color-button-soft-active);
}

.editor-panel__close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .editor-panel,
    .editor-panel__tab,
    .editor-panel__close {
        transition: none;
    }
}
</style>
