<script setup lang="ts">
import { shallowRef, watch } from "vue";
import type { RouteResponse, SubjectRef } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import type { LandscapeLines } from "../route-planner/route-landscapes";
import { useStageLore } from "../route-planner/stage-lore";
import InfoContent from "./info-content.vue";
import { publicMapUrl } from "../auth/entry";
import { currentPanelMode, panelRules } from "./panel-extras";
import type { PanelActions } from "./panel-actions";
import type { PanelEnv } from "./panel-types";
import type { ShownSubject, SubjectSelection } from "./subject-selection";

/**
 * Das Infopanel am rechten Rand (WI-0063 P5, Design Guide §16, §17.2; Legacy `css/features/infopanel.css`): die Hülle des rechten
 * Slots. Sie zeigt, was die Auswahl hält, und kennt keine Art des Subjects; den Inhalt zeichnet `info-content.vue` nach der Grammatik des
 * Guides (P6). Ein Link im Inhalt öffnet über die EINE Öffnungsnaht (`openSubject`), eine Aktionskachel läuft über `actions`.
 * Der Inhalt läuft von Kante zu Kante: Jeder Baustein bringt sein seitliches Polster selbst mit (`--info-pad-x`, Legacy
 * `--infopanel-pad-x` 18 px), damit Trenner und das Bild randlos bleiben.
 *
 * - **Am Rechner** 400 px (`--avesmaps-infopanel-width`), bündig von oben bis unten ohne Spalt und ohne Rundung (Betreiber
 *   2026-10-31: „dass wir das panel zumindest rechts vollständig von oben nach unten durchgehen lassen“; der Rahmen des Gradnetzes
 *   schließt dann mit ihm ab);
 *   `translateX` in 0,22 s `ease`, Panel und Randlasche im selben Bild (Guide §16: Literal, kein Token). Kein ✕.
 * - **Die Randlasche „Info“** ist die des Planers, an den rechten Rand gespiegelt (Guide §17.2): Sie klappt nur die
 *   Darstellung ein oder aus, die Auswahl bleibt. Ohne Inhalt ist sie verborgen.
 * - **Den Slot teilt es mit dem Editorpanel** (WI-0128 E3, `editor-panel/`): Der Behälter steht offen, solange der SLOT offen ist,
 *   damit die Lasche an seiner Kante sitzt; steht der Editor vorn, ist der Stapel verborgen und `inert`, und die Lasche holt das
 *   Infopanel nach vorn.
 * - **Am Telefon** volle Höhe, `min(400 px, 100vw − 24 px)`, ✕ oben rechts, die Lasche verborgen, kein Bottom Sheet, keine
 *   Wischgesten. Planer und Panel schließen einander aus (`phone-exclusion.ts`).
 * - 🔴 **Es meldet sich als Rand** (`data-map-overlay="right"`), geschlossen unter `inert`: Sonst zielt die Kamera unter das
 *   Panel (AGENTS.md „Die Kamera“, `docs/design/3d-navigation.md` § 1a). Der Kamera-Ring und die Eckknöpfe fahren mit dem
 *   offenen Panel nach links (`app.vue`, gleiche Zeit).
 *
 * Es zeigt auch während des Ausfahrens noch den letzten Inhalt: Mit dem Subject verschwände sonst der Text, bevor das Panel weg ist.
 */
const props = defineProps<{
    selection: SubjectSelection;
    phone: boolean;
    /** Die Reise des Planers, aus der eine Etappe ihre Zeilen liest. */
    route: RouteResponse | null;
    /** Die Landschaften und Gebiete der Reise, die der Planer schon abgefragt hat (WI-0063 27.13); `null`, bis die Antwort da ist. */
    landscapes: LandscapeLines | null;
    /** Wie das eigene Flugmittel heißt (Planer); leer heißt „Eigenes Flugmittel“. */
    customAirName: string;
    /** Wie die Kartenpunkte der Reise im Planer heißen, nach Kennung (WI-0087 P9); dieselbe Quelle wie die Eingabe. */
    pointNames: ReadonlyMap<string, string>;
    /** Was die Aktionskacheln tun (Planer, Zwischenablage, Kamera); `app.vue` verdrahtet es über die vorhandenen Nähte. */
    actions: PanelActions;
    /** Die Karte steht in der Standardansicht (WI-0272 S5): nur dann trägt der Kopf eines Ortes „+ Eigenes Bild hinzufügen“. */
    standard?: boolean;
}>();

/**
 * Die Gruppe „Bearbeiten · nur Editoren“ unter dem Aktionsband (WI-0128 E15); `app.vue` hängt sie ein. `ersatz` steht, wo `app.vue` ihn füllt, an Stelle des Inhalts:
 * der Sammelscreen „Ausgewählte Vorkommen“ (WI-0257 S5), der kein Subject ist und über dem Panel des Eintrags liegt, das die Auswahl zuletzt geöffnet hat.
 */
defineSlots<{ bearbeiten?(props: { shown: ShownSubject }): unknown; ersatz?(): unknown }>();

const visible = props.selection.panelVisible;
const slotOpen = props.selection.slotOpen;

const displayed = shallowRef<ShownSubject | undefined>(props.selection.shown.value);
watch(
    () => props.selection.shown.value,
    (shown) => {
        if (shown !== undefined) displayed.value = shown;
    },
);

/**
 * Die Vorkommen der Etappe, die GEZEIGT wird (WI-0106): Eine Etappe hat keinen Detail-Endpunkt, sie lebt im Planer - ihre vier
 * Zeilen kommen in EINEM Lauf, sobald sie im Panel steht.
 *
 * 🪤 Gefragt wird an `displayed`, nicht an `selection.shown`: Das ist, was gezeichnet WIRD. So entsteht keine Frage für ein
 * Panel, das gerade zugeht, und die Zeilen bleiben stehen, während es ausfährt.
 */
const stageLore = useStageLore(
    () => props.route,
    () => (displayed.value?.ref.kind === "routeStage" ? displayed.value.ref.index : null),
);

/** Was das Modell von außen braucht: die Regel dieser Seite (Besucher: wie Legacy), die Adresse zum Teilen und der Stand der Reise. */
const env: PanelEnv = {
    rules: panelRules(currentPanelMode()),
    // 🔴 Nie der Editor-Modus (`publicMapUrl`): „Ort teilen“ gehört auf die Karte, nicht nach `/edit`.
    pageUrl: publicMapUrl({
        origin: globalThis.location?.origin ?? "",
        pathname: globalThis.location?.pathname ?? "/",
    }),
    isDestination: (id) => props.actions.isDestination(id),
    landscapes: () => props.landscapes,
    stageLore: (index) => stageLore.stageLore(index),
    customAirName: () => props.customAirName,
    pointNames: () => props.pointNames,
    standardAnsicht: () => props.standard === true,
};

/** Ein Link im Inhalt öffnet sein Subject und fliegt hin, wie jeder Objektlink. */
function open(ref: SubjectRef): void {
    props.selection.openSubject(ref, { source: "link", camera: "target" });
}
</script>

<template>
    <div
        class="info-panel"
        :class="{
            'is-open': slotOpen,
            'is-vorn': visible,
            'is-phone': phone,
            'has-content': selection.hasContent.value,
        }"
        :data-open="visible ? '' : undefined"
    >
        <aside
            class="info-panel__stack"
            :inert="!visible"
            data-map-overlay="right"
            data-testid="info-panel"
            :aria-label="t('infoPanel.label')"
        >
            <button
                v-if="phone"
                type="button"
                class="info-panel__close"
                :aria-label="t('infoPanel.close')"
                :title="t('infoPanel.close')"
                data-testid="info-panel-close"
                @click="selection.collapsePanel()"
            >
                <span aria-hidden="true">✕</span>
            </button>
            <div class="info-panel__body">
                <p v-if="selection.pinned.value" class="info-panel__pinned" data-testid="info-pinned">
                    {{ t("infoPanel.pinned") }}
                </p>
                <slot v-if="$slots.ersatz" name="ersatz" />
                <InfoContent
                    v-else-if="displayed"
                    :shown="displayed"
                    :route="route"
                    :env="env"
                    @retry="selection.retry()"
                    @open="open"
                    @run="actions.run($event, displayed)"
                >
                    <template #bearbeiten="{ shown }"><slot name="bearbeiten" :shown="shown" /></template>
                </InfoContent>
            </div>
        </aside>

        <button
            v-if="!phone"
            type="button"
            class="info-panel__tab"
            :aria-expanded="visible"
            :title="visible ? t('infoPanel.tab.close') : t('infoPanel.tab.open')"
            data-testid="info-panel-tab"
            @click="selection.togglePanel()"
        >
            {{ t("infoPanel.tab") }}
        </button>
    </div>
</template>

<style scoped>
/*
 * Das Panel und seine Lasche wandern GEMEINSAM: zugeklappt um genau die Panelbreite nach rechts. `transform`, nicht `right`
 * (Guide §16), damit das Einfahren dieselbe Bewegung ist wie das Auf- und Zuklappen. Wie beim Planer (`route-planner.vue`),
 * nur gespiegelt.
 */
.info-panel {
    --info-w: min(var(--avesmaps-infopanel-width), 100vw - var(--avesmaps-tab-w));
    position: absolute;
    top: 0;
    right: 0;
    z-index: var(--z-map-panel);
    width: 0;
    height: 100%;
    transform: translateX(var(--info-w));
    transition: transform 220ms ease;
}

.info-panel.is-phone {
    --info-w: min(var(--avesmaps-infopanel-width), 100vw - 2 * var(--space-10));
}

.info-panel.is-open {
    transform: none;
}

/* Zugeklappt verschwindet das Panel nach der Fahrt ganz - sonst ragte sein Schatten an den Rand. */
.info-panel:not(.is-open) .info-panel__stack {
    visibility: hidden;
    transition: visibility 0s linear 220ms;
}

/* Der Slot ist offen, aber der Editor steht vorn (WI-0128 E3): sofort verborgen, es fährt nichts. */
.info-panel.is-open:not(.is-vorn) .info-panel__stack {
    visibility: hidden;
}

/* Bündig von oben bis unten, ohne Rundung (Betreiber 2026-10-31); bis dahin §16 oben 10 px, unten der Kartenrand. */
.info-panel__stack {
    position: absolute;
    top: 0;
    right: 0;
    /* Endet über der Leiste der Reisebilder, wenn sie offen ist (WI-0272 S4); am Telefon ist die Zahl dann 0. */
    bottom: var(--avm-reisebilder-leiste, 0);
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    width: var(--info-w);
    border-radius: 0;
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    color: var(--color-text);
    font-size: var(--font-size-body);
    line-height: var(--leading-snug);
}

.is-phone .info-panel__stack {
    top: 0;
    bottom: 0;
    border-radius: 0;
}

/*
 * Ein Scrollbereich für die ganze Spalte (Legacy). 🔴 Das Polster steht NICHT am Körper, sondern an den Bausteinen: Bild und Trenner laufen
 * von Kante zu Kante, ohne negative Ränder, die das Polster eines Vorfahren zurücknehmen. `--info-pad-x` ist Legacys 18 px (`--space-16`).
 * 💣 Der Platz für den Rollbalken steht IMMER bereit (`scrollbar-gutter: stable`): Ohne ihn erschiene er beim Aufklappen eines Deckels,
 * nähme sich seine Breite, und jede Zeile bräche neu um - der Inhalt spränge unter dem Finger weg (Legacy, Betreiber 2026-08-12). Die
 * Bildfläche misst damit 385 px, wie der Guide sie vermessen hat (§16.1).
 */
.info-panel__body {
    --info-pad-x: var(--space-16);
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
    scrollbar-gutter: stable;
    border-radius: inherit;
}

.info-panel__pinned {
    margin: var(--space-10) var(--info-pad-x) 0;
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

/*
 * §17.2: Die Lasche - der einzige dauerhaft dunkle Fleck, damit man sie auf heller Karte findet. Um 180° gedreht wie die Lasche
 * „Editor“ darunter (Betreiber 2026-11-04); die Rundung steht darum vor der Drehung rechts und landet links.
 */
.info-panel__tab {
    position: absolute;
    top: var(--avesmaps-tab-top);
    /*
     * An der Kante eines angedockten Werkzeugfensters, wenn eins da ist (WI-0128 E6, `--avm-slot-breite` aus `app.vue`).
     * 🔴 Die Stelle steht fest, die Abweichung ist eine VERSCHIEBUNG: `right` zu bewegen hieße, in jedem Bild neu zu
     * rechnen, wo die Lasche liegt - und die Hausregel „die Bewegung ist `transform`, nicht `right`" (Guide §16) gilt für
     * die Lasche wie für das Panel, an dem sie hängt. Ist der Slot breiter als das Panel, wird die Differenz negativ und
     * die Lasche wandert nach links.
     */
    right: var(--info-w);
    transform: translateX(calc(var(--info-w) - var(--avm-slot-breite, var(--info-w)))) rotate(180deg);
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
    /* Sie wandert mit, wenn ein Werkzeugfenster seine Liste einzieht (WI-0128 P1), in der Zeit des Panels (Guide §16). */
    transition:
        transform 220ms ease,
        background-color 120ms ease,
        box-shadow 120ms ease;
}

/* Ohne Inhalt ist die Lasche verborgen - sie fährt mit dem Panel hinaus und verschwindet dann ganz. */
.info-panel:not(.has-content) .info-panel__tab {
    visibility: hidden;
    transition: visibility 0s linear 220ms;
}

.info-panel__tab:hover {
    background: var(--color-button-hover);
}

.info-panel__tab:active {
    background: var(--color-button-active);
}

.info-panel__tab:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus)), var(--shadow-panel);
}

/* Das ✕ gibt es nur am Telefon (Legacy: 26 × 26 px oben rechts). */
.info-panel__close {
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

.info-panel__close:hover {
    background: var(--color-button-soft-hover);
}

.info-panel__close:active {
    background: var(--color-button-soft-active);
}

.info-panel__close:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-panel,
    .info-panel__tab,
    .info-panel__close {
        transition: none;
    }
}
</style>
