<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { t } from "../i18n/i18n";
import type { LiteratureCard } from "./catalog-model";
import InfoSpoiler from "./info-spoiler.vue";

/**
 * Der Literaturstreifen eines Abschnitts (Design Guide §16.4, Legacy `buildGameLiteratureCardMarkup`,
 * `css/features/place-extras.css`): ein EINZEILIGER, waagerecht rollender Streifen aus Hochkant-Karten. Je Karte von oben nach
 * unten: Umschlag - Titel - „Edition · Jahr“ - Werkart - „enthalten in: …“.
 *
 * 🔴 **Umschlag und Titel sind EIN Ziel: das Verzeichnis** (WI-0118, Betreiber 2026-10-09: ein Klick auf eine Literatur soll „immer den
 * jeweiligen Eintrag im Verzeichnis vergrößert darstellen“). Legacy schickte den Umschlag in den Laden und den Titel auf den Wiki-Artikel -
 * zwei Fragen („wo bekomme ich es“, „was ist es“); beide Antworten stehen jetzt im vergrößerten Eintrag, jede mit ↗. Die Karte führt nicht
 * mehr selbst nach draußen.
 *
 * 🔴 **Ein Eintrag mit der Rolle `play` steht unter einem Deckel** („spielt hier“ IST der Spoiler): Das Bild wird unkenntlich, alles
 * andere unsichtbar, aber nicht entfernt - die Karte behält ihre Höhe. „Ein geblurrter Titel liest sich als Schmutz, ein fehlender
 * als Absicht“ (Legacy).
 *
 * 🔴 **Ein fehlendes Bild zeigt GAR NICHTS** (MEDIA-M12): kein Rahmen, keine Beschriftung, kein Alternativtext, kein Platzhalterzeichen.
 * Ein Teil der Werke trägt keinen freigegebenen Umschlag - gemessen 1.534 von 2.003 -, und das ist der Normalfall, nicht der Ausfall.
 * Stehen bleibt nur die FLÄCHE des Umschlags: Sie zeichnet nichts, hält aber die Titel des Streifens auf einer Höhe. Dasselbe gilt für
 * ein Bild, dessen Adresse nicht lädt (`@error`) - es fällt weg, und niemand erfährt, dass es eines gäbe.
 */
const props = defineProps<{ cards: readonly LiteratureCard[]; note: string }>();
const emit = defineEmits<{ open: [key: string] }>();

/** Welche Karten aufgedeckt sind - je Eintrag, nie als Sammelschalter; ein neues Panel beginnt wieder zu. */
const revealed = ref(new Set<string>());
const reveal = (key: string): void => {
    revealed.value = new Set(revealed.value).add(key);
};
const isVeiled = (card: LiteratureCard): boolean => card.spoiler && !revealed.value.has(card.key);

/** Die Adressen, die der Browser nicht laden konnte; sie gehören zu dieser Liste und werden mit ihr vergessen. */
const broken = ref<string[]>([]);
watch(
    () => props.cards.map((card) => card.key).join(","),
    () => {
        broken.value = [];
    },
);
const coverOf = (card: LiteratureCard): LiteratureCard["cover"] =>
    card.cover !== undefined && !broken.value.includes(card.cover.url) ? card.cover : undefined;
/**
 * Trägt der Streifen überhaupt ein Bild? Nur dann steht die Fläche des Umschlags: Im gemischten Streifen hält sie die Titel auf
 * einer Höhe (WI-0063 §27.15). Ohne einen einzigen Umschlag hielte sie nichts und sähe wie ein Ladefehler aus (§27.17; Betreiber
 * 2026-10-08: „fix alles“). Ein verdeckter Eintrag nimmt dann die Höhe seiner Karte statt der des Umschlags.
 */
const withImages = computed(() => props.cards.some((card) => coverOf(card) !== undefined));
const broke = (url: string): void => {
    if (!broken.value.includes(url)) broken.value = [...broken.value, url];
};
</script>

<template>
    <div class="info-lit">
        <p v-if="note !== ''" class="info-lit__note" data-testid="info-literature-note">{{ note }}</p>
        <div class="info-lit__strip" :class="{ 'is-textonly': !withImages }" data-testid="info-literature-strip">
            <div
                v-for="card in props.cards"
                :key="card.key"
                class="info-lit__card"
                :class="{ 'is-veiled': isVeiled(card) }"
                :data-role="card.spoiler ? 'play' : 'open'"
                data-testid="info-literature-card"
            >
                <component
                    :is="coverOf(card) === undefined ? 'span' : 'button'"
                    v-if="withImages"
                    class="info-lit__cover"
                    :class="{ 'is-empty': coverOf(card) === undefined }"
                    :type="coverOf(card) === undefined ? undefined : 'button'"
                    :title="coverOf(card) === undefined ? undefined : card.hint"
                    data-testid="info-literature-cover"
                    @click="coverOf(card) === undefined ? undefined : emit('open', card.key)"
                >
                    <img
                        v-if="coverOf(card) !== undefined"
                        class="info-lit__img"
                        :src="card.cover?.url"
                        :width="card.cover?.width"
                        :height="card.cover?.height"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        data-testid="info-literature-image"
                        @error="broke(card.cover?.url ?? '')"
                    />
                </component>
                <button
                    type="button"
                    class="info-lit__title"
                    :title="card.hint"
                    data-testid="info-literature-title"
                    @click="emit('open', card.key)"
                >
                    {{ card.title }}
                </button>
                <span v-if="card.meta !== ''" class="info-lit__meta">{{ card.meta }}</span>
                <span v-if="card.type !== ''" class="info-lit__type">{{ card.type }}</span>
                <span v-if="card.containedIn !== ''" class="info-lit__contained">{{ card.containedIn }}</span>
                <InfoSpoiler
                    v-if="isVeiled(card)"
                    :label="t('infoPanel.literature.spoiler')"
                    @reveal="reveal(card.key)"
                />
            </div>
        </div>
    </div>
</template>

<style scoped>
.info-lit__note {
    margin: 0 0 var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Legacys Streifen: eine Zeile, waagerecht rollend, schmale Leiste. Keine Blätterpfeile, keine Seiten (Legacy hat keine). */
.info-lit__strip {
    display: flex;
    gap: var(--space-10);
    padding-bottom: var(--space-4);
    overflow-x: auto;
    scrollbar-width: thin;
}

.info-lit__card {
    position: relative;
    flex: 0 0 auto;
    width: var(--avesmaps-infopanel-cover-w);
    line-height: var(--leading-snug);
    text-align: center;
    /* Der Deckel reicht nur über den Umschlag, nicht über den Text darunter. */
    --spoiler-veil-height: var(--avesmaps-infopanel-cover-h);
}

/* Ohne jeden Umschlag gibt es keine Fläche: Der Deckel reicht dann über die ganze Karte. */
.info-lit__strip.is-textonly .info-lit__card {
    --spoiler-veil-height: 100%;
}

/*
 * Der Umschlag im Hochformat eines gedruckten Bandes (210:297). 🔴 OHNE Bild bleibt nur die Fläche stehen - ohne Rahmen, ohne Grund,
 * ohne Zeichen: Sie zeigt nichts und hält doch die Titel des Streifens auf einer Höhe.
 */
.info-lit__cover {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avesmaps-infopanel-cover-w);
    height: var(--avesmaps-infopanel-cover-h);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    padding: 0;
    text-decoration: none;
    transition: border-color 120ms ease;
}

/* Der Umschlag ist ein Knopf (WI-0118), aber nur, wo er ein Bild trägt: ohne Bild bleibt die Fläche ein stilles `span`. */
button.info-lit__cover {
    cursor: pointer;
    font: inherit;
}

.info-lit__cover.is-empty {
    border-color: transparent;
    background: none;
}

.info-lit__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.info-lit__card:hover .info-lit__cover:not(.is-empty) {
    border-color: var(--color-accent);
}

button.info-lit__cover:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Der Titel: Linkfarbe, höchstens zwei Zeilen, Unterstreichung erst beim Überfahren - der Streifen bleibt ruhig. Ein Knopf im Gewand des Titels. */
.info-lit__title {
    display: -webkit-box;
    width: 100%;
    margin: var(--space-4) 0 0;
    padding: 0;
    overflow: hidden;
    border: 0;
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    text-align: inherit;
    text-decoration: none;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
}

.info-lit__title:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-lit__title:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * Die drei Zeilen unter dem Titel stehen in einer Größe: Die Leiter des Kanons endet bei 11 px (Betreiberregel), und Legacys
 * 10,5 / 9,5 px liegen darunter. Unterschieden werden sie wie überall im Haus über FARBE und Schnitt, nicht über Gewicht.
 *
 * 🪤 Ein langes Wort muss BRECHEN: Die Karte ist 78 px breit, „Gruppenabenteuer“ ist breiter, und ohne `overflow-wrap` lief es in die
 * Nachbarkarte hinein (gemessen am Blatt für MEDIA-M14). Mit Bildern daneben fällt das sofort auf.
 */
.info-lit__meta,
.info-lit__type,
.info-lit__contained {
    display: block;
    margin-top: var(--space-2);
    overflow-wrap: anywhere;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.info-lit__contained {
    font-style: italic;
}

/* Verschleiert: das Bild unkenntlich, der Text unsichtbar - aber nichts entfernt, die Karte behält ihre Höhe. */
.info-lit__card.is-veiled .info-lit__cover {
    filter: blur(var(--avesmaps-infopanel-veil-blur));
    user-select: none;
}

.info-lit__card.is-veiled .info-lit__title,
.info-lit__card.is-veiled .info-lit__meta,
.info-lit__card.is-veiled .info-lit__type,
.info-lit__card.is-veiled .info-lit__contained {
    visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
    .info-lit__cover {
        transition: none;
    }
}
</style>
