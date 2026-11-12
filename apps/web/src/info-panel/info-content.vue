<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { subjectKey, type RouteResponse, type SubjectRef } from "@avesmaps3d/shared";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { formatNumber, t } from "../i18n/i18n";
import { bewertungsZiel } from "./bewertung-ziel";
import { useOrtBewertungen } from "./bewertungen-quelle";
import InfoActions from "./info-actions.vue";
import InfoBewertungen from "./info-bewertungen.vue";
import InfoBewertungszeile from "./info-bewertungszeile.vue";
import InfoCatalog from "./info-catalog.vue";
import InfoEintrag from "./info-eintrag.vue";
import InfoFields from "./info-fields.vue";
import InfoHeader from "./info-header.vue";
import InfoLiesIn from "./info-lies-in.vue";
import InfoSection from "./info-section.vue";
import InfoSourceBox from "./info-source-box.vue";
import SpracheAlleZeigen from "./sprache-alle-zeigen.vue";
import { useArrival } from "./panel-arrival";
import { panelModelOf } from "./panel-model";
import type { ActionRun, PanelEnv } from "./panel-types";
import type { ShownSubject } from "./subject-selection";

/**
 * Der Inhalt des Infopanels nach der Grammatik des Design Guides §16 und Legacys Gareth-Aufbau (WI-0063 P6, Betreiber: „aussehn wie
 * legacy“): Kopf mit Bild, Wappen, Name, Untertitel und Kanon - Aktionsband - „Liegt in“ - Feldliste - EIN Quellenkasten (Wikizeile,
 * Quellen, Publikationen) - die Katalogabschnitte Kartensammlung und Literatur (P8). Die Hülle (`info-panel.vue`) und
 * das Modell (`panel-model.ts`) bleiben; diese Komponente setzt nur zusammen und entscheidet nichts.
 *
 * 🔴 **Ein Ort hat Reiter „Überblick · Bewertungen (N)“** (WI-0269 C10, Vali 2026-10-31: „wie bei google maps“; Bedienkonzept §6.3): Der Kopf trägt unter OFFIZIELL die Zeile „3,8 ★★★★½ (10 Bewertungen)“,
 * die Kacheln stehen ÜBER den Reitern (sie gelten für den Ort, nicht für einen Reiter; dort steht auch „Bewertung schreiben“), darunter die Reiterleiste des Hauses (`FensterReiter`). „Überblick“ trägt alles,
 * was bisher im Panel stand, „Bewertungen“ Wert, Verteilung und Liste. Den Reiter haben alle Orte, auch ohne Bewertung („Noch keine Bewertung“), damit der Aufbau stabil bleibt; Wege, Gebiete und
 * alle anderen Gegenstände bleiben ohne. Sind die Bewertungen für Besucher ausgeblendet (Inhaltsschalter), entfallen Zeile, Reiter und Kachel.
 * Ein geteilter Link (`?place=…&bewertung=…`) öffnet das Panel gleich auf dem Reiter, die Bewertung hervorgehoben (`bewertung-ziel.ts`).
 *
 * 🔴 Keine leeren Bauteile (WI-0063 5.3): Was das Modell nicht nennt, wird nicht gezeichnet - keine Zeile ohne Wert, kein Kasten ohne
 * Wikizeile, Quelle und Beleg. Ein Fehler der optionalen Quellenliste zerstört den Rest nicht (`info-source-box.vue`).
 * Kein `v-html`, kein Markup vom Server (WI-0063 11.4): Alles sind Textknoten, Wiki-Text kommt als Rohtext.
 *
 * 🔴 **Das Panel geht sofort auf und zeigt sofort, was die Karte weiß; der eintreffende Inhalt wird eingeblendet, nicht gesetzt**
 * (WI-0088 P1). Eingeblendet wird genau, was mit der Antwort NEU dazukommt - jeder dieser Bausteine entsteht erst mit ihr
 * (`panel-model.ts` `pending()` nennt weder Zeilen noch Kataloge). Der Name steht schon da und bleibt stehen. Wann überhaupt
 * eingeblendet wird, entscheidet `panel-arrival.ts`; der Übergang verzögert nichts, ein Klick während der Einblendung wirkt sofort.
 */

const props = defineProps<{
    shown: ShownSubject;
    /** Die Reise des Planers: Eine Etappe liest ihre Zeilen daraus. */
    route: RouteResponse | null;
    env: PanelEnv;
}>();
const emit = defineEmits<{ retry: []; open: [ref: SubjectRef]; run: [run: ActionRun] }>();
/**
 * Unter dem Aktionsband: die Gruppe „Bearbeiten · nur Editoren“ (WI-0128 E15, EDIT-0001 D7). Das Infopanel entscheidet nicht, ob sie
 * steht; wer sie einhängt, prüft Modus, Recht und Art (`app.vue`).
 */
defineSlots<{ bearbeiten?(props: { shown: ShownSubject }): unknown }>();

const model = computed(() => panelModelOf(props.shown, props.route, props.env));

// --- Reiter „Überblick · Bewertungen“ (nur Orte) -------------------------------------------------------------------------------------

type OrtReiter = "ueberblick" | "bewertungen";
const bewertungen = useOrtBewertungen(() => props.shown.ref);
const istOrt = computed(() => props.shown.ref.kind === "place");
/** Reiter und Zeile stehen, sobald die Antwort da ist und die Bewertungen für Besucher nicht ausgeblendet sind. */
const mitReitern = computed(
    () => istOrt.value && props.shown.status === "ready" && model.value !== undefined && !bewertungen.pausiert.value,
);
const reiter = ref<OrtReiter>("ueberblick");
/** Die Bewertung eines geteilten Links: sie wird im Reiter hervorgehoben. */
const hervorheben = ref<string | undefined>(undefined);
const bewertungenOffen = computed(() => mitReitern.value && reiter.value === "bewertungen");

// Ein anderer Gegenstand beginnt wieder bei „Überblick“; ein geteilter Link auf eine Bewertung dieses Orts bei „Bewertungen“, einmal.
watch(
    () => subjectKey(props.shown.ref),
    () => {
        const ref_ = props.shown.ref;
        const ziel = bewertungsZiel.value;
        if (ref_.kind === "place" && ziel !== undefined && ziel.ort === ref_.id.toLowerCase()) {
            reiter.value = "bewertungen";
            hervorheben.value = ziel.bewertung;
            bewertungsZiel.value = undefined;
            return;
        }
        reiter.value = "ueberblick";
        hervorheben.value = undefined;
    },
    { immediate: true },
);

const reiterListe = computed(() => [
    { id: "ueberblick" as const, name: t("bewertungen.reiter.ueberblick") },
    { id: "bewertungen" as const, name: t("bewertungen.reiter.bewertungen") },
]);
const bewertungenZahl = computed(() => bewertungen.section.value?.count ?? 0);
/** Der Name des Orts für Kopfzeile und Fenster: der Titel des Kopfes. */
const ortName = computed(() => model.value?.header.title ?? props.shown.title ?? "");

// Blendet der Inhalt dieses Subjects ein? Nur, wenn das Panel ihn vorher als „lädt“ gezeigt hat (`panel-arrival.ts`).
const arriving = useArrival(() => ({ key: props.shown.key, loading: props.shown.status === "loading" }));
</script>

<template>
    <!-- Der Eintrag eines Vorkommens (WI-0257 S3b) hat kein Modell aus einer Detailantwort: Er liest seine eigene Route. -->
    <InfoEintrag
        v-if="shown.ref.kind === 'loreEntry'"
        :id="shown.ref.id"
        :title="shown.title"
        @open="emit('open', $event)"
    />
    <div
        v-else-if="model !== undefined"
        class="info-content"
        :data-subject="shown.ref.kind"
        :data-status="shown.status"
        :data-mode="env.rules.mode"
    >
        <InfoHeader
            :model="model.header"
            :arriving="arriving"
            :standard="env.standardAnsicht?.() === true"
            @open="emit('open', $event)"
            @run="emit('run', $event)"
        >
            <!-- Die Bewertungszeile eines Orts (WI-0269): unter OFFIZIELL, die Zählung öffnet den Reiter. -->
            <template v-if="mitReitern" #nach-pillen>
                <InfoBewertungszeile :bewertungen="bewertungen" :ort="ortName" @oeffnen="reiter = 'bewertungen'" />
            </template>
            <!-- Eine Sprache (WI-0261 S5b): links vom Namen die Sprechblase in ihrer Farbe auf der Karte (Bauvorlage `sprechblase`). -->
            <template v-if="model.header.sprachfarbe !== undefined" #zeichen>
                <span
                    class="info-content__sprache"
                    :title="t('sprache.farbe')"
                    data-testid="info-sprachfarbe"
                    :data-farbe="model.header.sprachfarbe"
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path
                            d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5h-7.2L8.2 20.5V16.5H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z"
                            :fill="model.header.sprachfarbe"
                            class="info-content__sprache-blase"
                        />
                        <path d="M6.5 8.6h11M6.5 12h6.5" class="info-content__sprache-zeilen" />
                    </svg>
                </span>
            </template>
        </InfoHeader>

        <p v-if="shown.status === 'loading'" class="info-content__note" data-testid="info-loading">
            {{ t("infoPanel.loading") }}
        </p>
        <p v-else-if="shown.status === 'missing'" class="info-content__note" data-testid="info-missing">
            {{ t("infoPanel.missing") }}
        </p>
        <div v-else-if="shown.status === 'error'" class="info-content__note">
            <p class="info-content__error" data-testid="info-error">{{ t("infoPanel.error") }}</p>
            <button type="button" class="info-content__retry" data-testid="info-retry" @click="emit('retry')">
                {{ t("infoPanel.retry") }}
            </button>
        </div>

        <!-- Alles ab hier entsteht erst mit der Antwort: `is-arriving` blendet es ein, wenn vorher eine Wartezeile stand. -->
        <InfoActions
            v-if="model.actions.length > 0"
            :class="{ 'is-arriving': arriving }"
            :actions="model.actions"
            :note="model.actionsNote"
            @run="emit('run', $event)"
        />
        <slot name="bearbeiten" :shown="shown" />
        <!-- Die Reiter eines Orts (WI-0269): UNTER den Kacheln, die für den Ort gelten und nicht für einen Reiter. -->
        <div v-if="mitReitern" class="info-content__reiter" :class="{ 'is-arriving': arriving }">
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('bewertungen.reiter.gruppe')"
                kennung="infopanel"
                verteilt
            >
                <template #reiter="{ eintrag }">
                    <span class="avm-versalmitte">{{ eintrag.name }}</span>
                    <span
                        v-if="eintrag.id === 'bewertungen' && bewertungenZahl > 0"
                        class="info-content__zahl avm-versalmitte"
                        data-testid="info-bewertungen-reiterzahl"
                        >{{ formatNumber(bewertungenZahl, 0) }}</span
                    >
                </template>
            </FensterReiter>
        </div>
        <div
            v-if="bewertungenOffen"
            id="infopanel-inhalt-bewertungen"
            class="info-content__tafel"
            role="tabpanel"
            aria-labelledby="infopanel-reiter-bewertungen"
        >
            <InfoBewertungen
                :bewertungen="bewertungen"
                :ort-id="shown.ref.kind === 'place' ? shown.ref.id : ''"
                :ort-name="ortName"
                :seite="env.pageUrl"
                :hervorheben="hervorheben"
                @run="emit('run', $event)"
            />
        </div>
        <!-- Der Überblick: alles, was das Panel bisher zeigte. `v-show`, nicht `v-if`: Die Abschnitte behalten ihren Stand und laden nicht neu, wenn man zurückkommt. -->
        <div
            v-show="!bewertungenOffen"
            id="infopanel-inhalt-ueberblick"
            class="info-content__tafel"
            :role="mitReitern ? 'tabpanel' : undefined"
            :aria-labelledby="mitReitern ? 'infopanel-reiter-ueberblick' : undefined"
        >
            <InfoLiesIn
                v-if="model.liesIn !== undefined"
                :class="{ 'is-arriving': arriving }"
                :model="model.liesIn"
                @open="emit('open', $event)"
            />
            <InfoFields :class="{ 'is-arriving': arriving }" :rows="model.rows" @open="emit('open', $event)" />
            <!-- Sprache (WI-0261 S5b): die Herkunft des Texts mit Lizenz und die weiteren Wiki-Artikel, leise unter der Tafel (wie bei den Vorkommen). -->
            <div
                v-if="model.lizenz !== undefined"
                class="info-content__herkunft"
                :class="{ 'is-arriving': arriving }"
                data-testid="info-herkunft"
            >
                <p v-for="(zeile, nummer) in model.lizenz" :key="nummer" class="info-content__herkunft-zeile">
                    <template v-for="(teil, stelle) in zeile" :key="stelle"
                        ><a
                            v-if="teil.href !== undefined"
                            :href="teil.href"
                            target="_blank"
                            rel="noopener noreferrer"
                            >{{ teil.text }}</a
                        ><template v-else>{{ teil.text }}</template></template
                    >
                </p>
            </div>
            <!-- „In der Nähe (n)“ (P7, Legacy `avesmaps-near`): ein Abschnitt, offen, mit Zeilen in der Form der Feldliste. -->
            <InfoSection
                v-if="model.nearby !== undefined"
                :key="`nearby:${subjectKey(shown.ref)}`"
                :class="{ 'is-arriving': arriving }"
                :heading="model.nearby.heading"
                :count="model.nearby.count"
            >
                <InfoFields :rows="model.nearby.rows" embedded @open="emit('open', $event)" />
            </InfoSection>
            <!-- „Wo sie gesprochen wird“ (WI-0261 S5b, O4): die Treffer einer Sprache je Art als Deckel, in einem Abschnitt wie „In der Nähe“. -->
            <InfoSection
                v-if="model.gesprochen !== undefined"
                :key="`gesprochen:${subjectKey(shown.ref)}`"
                :class="{ 'is-arriving': arriving }"
                :heading="model.gesprochen.heading"
            >
                <!-- „Alle zeigen“ (S5c, Bauvorlage `ib-alle`): lässt die Flächen der Sprache leuchten und fliegt auf ihre Hauptteile. -->
                <SpracheAlleZeigen
                    v-if="model.gesprochen.alleZeigen !== undefined"
                    :model="model.gesprochen.alleZeigen"
                />
                <InfoFields :rows="model.gesprochen.rows" embedded @open="emit('open', $event)" />
            </InfoSection>
            <InfoSourceBox
                v-if="model.wiki !== undefined || model.sources !== undefined || model.quellen !== undefined"
                :key="subjectKey(shown.ref)"
                :class="{ 'is-arriving': arriving }"
                :wiki="model.wiki"
                :sources="model.sources"
                :entries="model.quellen"
            />
            <!-- Die Katalogabschnitte NACH dem Quellenkasten, in Legacys Reihenfolge (P8, WI-0063 27.7). -->
            <!-- Die Bewertungen sind kein Abschnitt am Ende mehr, sondern der Reiter oben (WI-0269). -->
            <InfoCatalog
                v-for="catalog in (model.catalogs ?? []).filter((eintrag) => eintrag.section !== 'reviews')"
                :key="`${catalog.section}:${subjectKey(shown.ref)}`"
                :class="{ 'is-arriving': arriving }"
                :model="catalog"
                @run="emit('run', $event)"
            />
        </div>
    </div>
</template>

<style scoped>
.info-content {
    display: flex;
    flex-direction: column;
    min-width: 0;
    padding-bottom: var(--space-16);
}

/* 🔴 Nur die Deckkraft, von 0 auf 1, und sie endet dort (Guide §30.2, §30.8; dieselbe Dauer wie das Kartenschild). */
.is-arriving {
    animation: info-arrive 140ms ease;
}

@keyframes info-arrive {
    from {
        opacity: 0;
    }
}

/* Die Tafel eines Reiters: eine Spalte wie das Panel selbst. */
.info-content__tafel {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

/* Die Reiterleiste eines Orts: die Breite des Panels, Luft seitlich wie bei den Kacheln. */
.info-content__reiter {
    padding: var(--space-6) var(--info-pad-x) 0;
}

.info-content__zahl {
    margin-left: var(--space-4);
    color: var(--color-accent-strong);
    font-variant-numeric: tabular-nums;
}

.info-content__note {
    margin: 0;
    padding: var(--space-6) var(--info-pad-x);
    color: var(--color-text-muted);
    line-height: var(--leading-normal);
}

.info-content__error {
    margin: 0;
}

/* Die Sprechblase einer Sprache im Rahmen des Zeichens eines Vorkommens (`info-eintrag.vue`): dieselbe Kachel links vom Namen. */
.info-content__sprache {
    display: inline-grid;
    flex: none;
    place-items: center;
    box-sizing: border-box;
    width: calc(var(--icon-xxl) - var(--space-4));
    height: calc(var(--icon-xxl) - var(--space-4));
    margin-right: var(--space-10);
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.info-content__sprache svg {
    width: var(--icon-lg);
    height: var(--icon-lg);
}

/* Die Farbe der Karte bleibt, wie sie ist (ein Inhalt, kein Bedienzeichen); Rand und Zeilen der Blase wie in der Bauvorlage. */
.info-content__sprache-blase {
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 1.2;
}

.info-content__sprache-zeilen {
    fill: none;
    stroke: rgba(0, 0, 0, 0.45);
    stroke-width: 1.5;
    stroke-linecap: round;
}

/* Die Herkunft des Texts: leise, aber sichtbar (die Lizenz verlangt die Nennung an jeder Kopie), wie `info-eintrag__lizenz`. */
.info-content__herkunft {
    padding: 0 var(--info-pad-x) var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-normal);
}

.info-content__herkunft-zeile {
    margin: var(--space-4) 0 0;
}

.info-content__herkunft a {
    color: var(--color-link);
    text-decoration: none;
    transition: color 120ms ease;
}

.info-content__herkunft a:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-content__herkunft a:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

.info-content__retry {
    margin-top: var(--space-4);
    padding: var(--space-4) var(--space-8);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.info-content__retry:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-content__retry:active {
    background: var(--color-button-soft-active);
}

.info-content__retry:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-content__retry,
    .info-content__herkunft a {
        transition: none;
    }

    /* Kein Übergang, nur der fertige Inhalt (Guide §30.6, WI-0088 A8). */
    .is-arriving {
        animation: none;
    }
}
</style>
