<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
    PANEL_SECTION_SWITCH,
    subjectKey,
    type SubjectCitymapsSection,
    type SubjectLiteratureSection,
} from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import CatalogCredit from "../catalog/catalog-credit.vue";
import { ausgeblendet } from "../system/inhaltsstand";
import { editorSektionen } from "./panel-section-load";
import { pausiertSatz } from "../system/inhaltsstand-text";
import {
    cachedCatalog,
    catalogCredit,
    citymapsModelOf,
    literatureModelOf,
    loadCatalog,
    type CatalogAnswer,
    type CatalogModel,
} from "./catalog-model";
import InfoActions from "./info-actions.vue";
import InfoCitymaps from "./info-citymaps.vue";
import InfoLiterature from "./info-literature.vue";
import InfoSection from "./info-section.vue";
import { useArrival } from "./panel-arrival";
import { catalogActions } from "./panel-action-model";
import type { ActionRun } from "./panel-types";

/**
 * Ein Katalogabschnitt des Infopanels (WI-0063 P8, Design Guide §16.4): Kartensammlung, Literatur oder Bewertungen. Der Abschnitt
 * selbst ist das gemeinsame Bauteil (`info-section.vue`); diese Hülle holt die Liste und wählt den Rumpf.
 *
 * 🔴 **Keine leeren Abschnitte** (WI-0063 5.3): Es gibt diesen Abschnitt nur, weil die Detailantwort ihn gezählt hat - das Panel
 * baut ihn also nur mit Inhalt. Die Liste kommt in EINER abbrechbaren Frage, die bei Last von selbst wiederholt (`fetchUnderLoad`,
 * dieselbe Regel wie die Quellen und das Detail). Scheitert sie, steht hier eine kleine Zeile samt „Noch einmal versuchen“, und der
 * Rest des Panels bleibt benutzbar.
 *
 * 🔴 Der Abschnitt gehört zu SEINEM Subject: Wechselt es, bricht er die Frage ab, und die verspätete Antwort eines anderen gilt nie.
 *
 * 🔴 Die Liste blendet für sich ein und hält das Panel nicht auf (WI-0088 P1, A9): Dieser Abschnitt hat seinen eigenen Ladezustand und
 * seinen eigenen Beobachter (`panel-arrival.ts`). Eine Liste aus dem Cache steht sofort da und blendet nicht ein.
 *
 * Ein Inhaltsschalter der Systemsteuerung (WI-0127 SYS-10) setzt an die Stelle der Liste seinen Satz („Die Literatur ist gerade
 * ausgeblendet.“): aus dem Stand der Seite, ohne zu fragen, oder aus der Antwort (`paused`). Ohne Buchumschläge steht unter dem Streifen
 * „Buchumschläge zeigen wir gerade nicht.“
 */
const props = defineProps<{ model: CatalogModel }>();
const emit = defineEmits<{ run: [run: ActionRun] }>();

type Status = "loading" | "ready" | "error";
const status = ref<Status>("loading");
const answer = shallowRef<CatalogAnswer | undefined>(undefined);

let controller: AbortController | undefined;

/**
 * Der Schalter dieses Abschnitts und ob er gerade aus ist (Stand der Seite oder Antwort des Servers). Ein Editor sieht den Abschnitt echt,
 * mit dem Vermerk „öffentlich ausgeblendet“ (WI-0127 SYS-11); der Server entscheidet das selbst (`publicHidden`).
 */
const schalter = computed(() => PANEL_SECTION_SWITCH[props.model.section]);
const editorSicht = editorSektionen();
const ausgeblendetHier = (): boolean => !editorSicht && schalter.value !== undefined && ausgeblendet(schalter.value);
const pausiert = computed(() => ausgeblendetHier() || (answer.value as { paused?: true } | undefined)?.paused === true);
const oeffentlichAusgeblendet = computed(
    () => (answer.value as { publicHidden?: true } | undefined)?.publicHidden === true,
);
const pausiertText = computed(() => (schalter.value === undefined ? null : pausiertSatz(schalter.value)));
const ohneUmschlaege = computed(
    () => props.model.section === "literature" && ausgeblendet("media.role.literature_cover"),
);

async function load(): Promise<void> {
    controller?.abort();
    const { section, ref: subject } = props.model;
    // Ein Ort ohne Karte (die Einladung) hat keine Liste: nichts fragen.
    if (props.model.leer === true) {
        answer.value = undefined;
        status.value = "ready";
        return;
    }
    // Ausgeblendet: nichts fragen, der Satz steht an der Stelle.
    if (ausgeblendetHier()) {
        answer.value = undefined;
        status.value = "ready";
        return;
    }
    // Eine frische Liste aus dem Cache zeichnet ohne Wartezeile.
    const hit = cachedCatalog(section, subject);
    if (hit !== undefined) {
        answer.value = hit;
        status.value = "ready";
        return;
    }
    const own = new AbortController();
    controller = own;
    status.value = "loading";
    answer.value = undefined;
    try {
        const loaded = await loadCatalog(section, subject, own.signal);
        if (own.signal.aborted) return;
        answer.value = loaded ?? undefined;
        status.value = "ready";
    } catch (error) {
        if (own.signal.aborted) return;
        console.error(`Infopanel: Abschnitt ${section} nicht geladen`, error);
        status.value = "error";
    }
}

const sectionKey = computed(() => `${props.model.section}:${subjectKey(props.model.ref)}`);
watch([sectionKey, ausgeblendetHier], () => void load(), {
    immediate: true,
});
onBeforeUnmount(() => controller?.abort());

// Die eingetroffene Liste blendet ein, wenn hier vorher die Wartezeile stand (`panel-arrival.ts`).
const arriving = useArrival(() => ({ key: sectionKey.value, loading: status.value === "loading" }));

const literature = computed(() =>
    props.model.section === "literature" && answer.value !== undefined
        ? literatureModelOf(answer.value as SubjectLiteratureSection)
        : undefined,
);
const citymaps = computed(() =>
    props.model.section === "citymaps" && answer.value !== undefined
        ? citymapsModelOf(answer.value as SubjectCitymapsSection)
        : undefined,
);

/**
 * Die Urheberzeile unter dem Streifen (`catalogCredit`): die Pflichtangabe aus den Ulisses-Fanrichtlinien, nur als Satz.
 *
 * 🔴 Sie hängt an den BILDERN, nicht am Abschnitt: Beide Streifen fragen dieselbe Regel, und ein Streifen ohne ein einziges Bild
 * zeigt keine Zeile. Darum steht sie hier und nicht in `info-literature.vue` - sonst wäre „nur Literatur“ fest verdrahtet, und die
 * Kartensammlung bekäme ihre Zeile nie zurück, wenn dort je wieder Vorschauen stehen. Bewertungen tragen keine Bilder.
 */
/**
 * Die Kacheln UNTER dem Streifen (WI-0118, Legacy `buildCityMapsSectionMarkup`, `buildGameLiteratureSectionMarkup`): „Kartensammlung anzeigen“ und
 * „Karte vorschlagen“, „Literatur anzeigen“. Dieselbe Kachel wie das Aktionsband des Panels, nur flach (`embedded`). Sie stehen erst, wenn die
 * Liste da ist - vorher gäbe es nichts anzuzeigen. 🔴 „Karte vorschlagen“ ist gesperrt, wie „Änderungen vorschlagen“; warum, steht darunter.
 */
const actions = computed(() => (status.value === "ready" && !pausiert.value ? catalogActions(props.model) : []));

/** Ein Klick auf eine Kachel oder einen Umschlag im Streifen schlägt das Verzeichnis bei diesem Eintrag auf (`panel-actions.ts`). */
function open(focus: string): void {
    if (props.model.section === "reviews") return;
    emit("run", {
        type: "openCatalog",
        section: props.model.section,
        ref: props.model.ref,
        name: props.model.name,
        focus,
    });
}

const credit = computed(() =>
    catalogCredit(
        literature.value !== undefined
            ? literature.value.cards.map((card) => card.cover)
            : citymaps.value !== undefined
              ? citymaps.value.map((card) => card.preview)
              : [],
    ),
);
</script>

<template>
    <!-- Die Einladung ohne Karten zeigt sich nie als „ausgeblendet“: Ist die Kartensammlung abgeschaltet, fehlt sie ganz. -->
    <InfoSection
        v-if="!(model.leer === true && pausiert)"
        :heading="model.heading"
        :count="pausiert ? undefined : model.count"
        :data-section="model.section"
        :aria-busy="status === 'loading'"
    >
        <p v-if="pausiert" class="info-catalog__note" data-testid="info-catalog-paused">{{ pausiertText }}</p>
        <div v-else-if="model.leer === true" class="info-catalog__einladung" data-testid="info-catalog-leer">
            <img
                class="info-catalog__einladung-bild"
                src="/icons/menu/kartensammlung.webp"
                alt=""
                width="80"
                height="80"
                decoding="async"
            />
            <p class="info-catalog__note">{{ t("kartenvorschlag.leer.text") }}</p>
        </div>
        <p
            v-else-if="oeffentlichAusgeblendet && status === 'ready'"
            class="info-catalog__note"
            data-testid="info-catalog-public-hidden"
        >
            {{ t("inhalt.oeffentlichAusgeblendet") }}
        </p>
        <p v-else-if="status === 'loading'" class="info-catalog__note" data-testid="info-catalog-loading">
            {{ t("infoPanel.catalog.loading") }}
        </p>
        <template v-else-if="status === 'error'">
            <p class="info-catalog__note" data-testid="info-catalog-error">{{ t("infoPanel.catalog.error") }}</p>
            <button type="button" class="info-catalog__retry" data-testid="info-catalog-retry" @click="load">
                {{ t("infoPanel.retry") }}
            </button>
        </template>
        <InfoLiterature
            v-else-if="literature !== undefined"
            :class="{ 'is-arriving': arriving }"
            :cards="literature.cards"
            :note="literature.note"
            @open="open"
        />
        <InfoCitymaps
            v-else-if="citymaps !== undefined"
            :class="{ 'is-arriving': arriving }"
            :cards="citymaps"
            @open="open"
        />
        <p
            v-if="!pausiert && literature !== undefined && ohneUmschlaege"
            class="info-catalog__note"
            data-testid="info-catalog-covers-paused"
        >
            {{ pausiertSatz("media.role.literature_cover") }}
        </p>
        <InfoActions
            v-if="actions.length > 0"
            class="info-catalog__actions"
            embedded
            :actions="actions"
            :label="model.heading"
            @run="emit('run', $event)"
        />
        <!--
            Die Zeile kommt mit ihrer Liste und geht mit ihr; allein stünde sie nie. 🪤 Sie trägt die Marke `is-arriving` NICHT:
            Je Abschnitt bleibt es bei genau EINER markierten Fläche (WI-0088 A9, `info-panel-arrival.spec.ts`), und die ist die
            Liste. Die Fußnote steht im selben Augenblick da, nur ohne die 140 ms Einblendung.
        -->
        <CatalogCredit v-if="credit !== undefined && !pausiert" class="info-catalog__credit" :text="credit" />
    </InfoSection>
</template>

<style scoped>
/* 🔴 Nur die Deckkraft, von 0 auf 1, und sie endet dort (Guide §30.2, §30.8; dieselbe Dauer wie das Kartenschild).
   🪤 Dieselbe Klasse trägt auch der Abschnitt selbst, wenn `info-content.vue` ihn einblendet - gleiche Bewegung, andere Stelle. */
.is-arriving {
    animation: info-catalog-arrive 140ms ease;
}

@keyframes info-catalog-arrive {
    from {
        opacity: 0;
    }
}

.info-catalog__note {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Die Urheberzeile (`catalog/catalog-credit.vue`) steht unter dem Streifen, mit dem Abstand einer Fußnote. */
.info-catalog__credit {
    margin-top: var(--space-6);
}

/* Die Kacheln unter dem Streifen: der Abstand eines Absatzes zum Streifen. */
.info-catalog__actions {
    margin-top: var(--space-6);
}

/* Die Einladung bei einem Ort ohne Karte: das gemalte Kartenzeichen links, der Satz daneben. */
.info-catalog__einladung {
    display: flex;
    align-items: center;
    gap: var(--space-10);
}

.info-catalog__einladung-bild {
    flex: none;
    width: var(--icon-xl);
    height: var(--icon-xl);
    object-fit: contain;
}

.info-catalog__retry {
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

.info-catalog__retry:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.info-catalog__retry:active {
    background: var(--color-button-soft-active);
}

.info-catalog__retry:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

@media (prefers-reduced-motion: reduce) {
    .info-catalog__retry {
        transition: none;
    }

    /* Kein Übergang, nur die fertige Liste (Guide §30.6, WI-0088 A8). */
    .is-arriving {
        animation: none;
    }
}
</style>
