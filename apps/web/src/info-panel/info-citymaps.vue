<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { t } from "../i18n/i18n";
import type { CitymapCard } from "./catalog-model";
import InfoSpoiler from "./info-spoiler.vue";

/**
 * Der Streifen der Kartensammlung (Design Guide §16.4 „Kartensammlung - der waagerechte Streifen“, Legacy `cityMapCardMarkup`,
 * `css/features/place-extras.css`): waagerecht rollende Kacheln, je Kachel die Vorschau und darunter der volle Titel.
 *
 * 🔴 **Die ganze Kachel ist EIN Knopf, und er öffnet das Verzeichnis** (WI-0118, Betreiber 2026-10-09: „ein Klick auf eine Karte … soll immer
 * den jeweiligen Eintrag im Verzeichnis vergrößert darstellen“; Legacy tat dasselbe seit 2026-07-17: „nur der Klick führt zur vergrößerten
 * Kachel in der Kartensammlung“): `open` nennt die Kennung der Karte, das Fenster „Kartensammlung von …“ schlägt sie auf. Die Fundstellen
 * stehen dort, jede mit ↗ - die Kachel führt nicht mehr selbst nach draußen und trägt darum kein ↗.
 *
 * 🔴 Eine Karte mit ausdrücklichem `is_spoiler` steht unter demselben Deckel wie ein verdecktes Werk. Ein UNBEKANNTES `is_spoiler`
 * ist KEIN Spoiler (Legacy `cityMapIsSpoiler`): Die Eigenschaft ist dreiwertig, und nur ein echtes Ja verdeckt.
 *
 * 🔴 **Ein fehlendes Bild zeigt GAR NICHTS** (MEDIA-M12): kein Rahmen, keine Beschriftung, kein Alternativtext, kein Platzhalterzeichen.
 * Ein Teil der Karten trägt keine freigegebene Vorschau - gemessen 363 von 543 -, und das ist der Normalfall, nicht der Ausfall. Stehen
 * bleibt nur die FLÄCHE der Vorschau: Sie zeichnet nichts, hält aber die Titel des Streifens auf einer Höhe. Dasselbe gilt für ein Bild,
 * dessen Adresse nicht lädt (`@error`).
 */
const props = defineProps<{ cards: readonly CitymapCard[] }>();
const emit = defineEmits<{ open: [key: string] }>();

const revealed = ref(new Set<string>());
const reveal = (key: string): void => {
    revealed.value = new Set(revealed.value).add(key);
};
const isVeiled = (card: CitymapCard): boolean => card.spoiler && !revealed.value.has(card.key);

/** Die Adressen, die der Browser nicht laden konnte; sie gehören zu dieser Liste und werden mit ihr vergessen. */
const broken = ref<string[]>([]);
watch(
    () => props.cards.map((card) => card.key).join(","),
    () => {
        broken.value = [];
    },
);
const previewOf = (card: CitymapCard): CitymapCard["preview"] =>
    card.preview !== undefined && !broken.value.includes(card.preview.url) ? card.preview : undefined;
/**
 * Trägt der Streifen überhaupt ein Bild? Nur dann steht die Fläche der Vorschau: Im gemischten Streifen hält sie die Titel auf einer
 * Höhe (WI-0063 §27.15). Ohne ein einziges Bild hielte sie nichts und sähe wie ein Ladefehler aus (§27.17; Betreiber
 * 2026-10-08: „fix alles“). Ein verdeckter Eintrag nimmt dann die Höhe seiner Karte statt der des Bildes.
 */
const withImages = computed(() => props.cards.some((card) => previewOf(card) !== undefined));
const broke = (url: string): void => {
    if (!broken.value.includes(url)) broken.value = [...broken.value, url];
};
</script>

<template>
    <div class="info-maps" :class="{ 'is-textonly': !withImages }" data-testid="info-citymaps-strip">
        <div
            v-for="card in props.cards"
            :key="card.key"
            class="info-maps__card"
            :class="{ 'is-veiled': isVeiled(card) }"
            data-testid="info-citymaps-card"
        >
            <button
                type="button"
                class="info-maps__link"
                :title="card.hint"
                data-testid="info-citymaps-link"
                @click="emit('open', card.key)"
            >
                <span
                    v-if="withImages"
                    class="info-maps__thumb"
                    :class="{ 'is-empty': previewOf(card) === undefined }"
                    data-testid="info-citymaps-thumb"
                >
                    <img
                        v-if="previewOf(card) !== undefined"
                        class="info-maps__img"
                        :src="card.preview?.url"
                        :width="card.preview?.width"
                        :height="card.preview?.height"
                        alt=""
                        loading="lazy"
                        decoding="async"
                        data-testid="info-citymaps-image"
                        @error="broke(card.preview?.url ?? '')"
                    />
                </span>
                <span class="info-maps__label">{{ card.title }}</span>
            </button>
            <InfoSpoiler v-if="isVeiled(card)" :label="t('infoPanel.citymaps.spoiler')" @reveal="reveal(card.key)" />
        </div>
    </div>
</template>

<style scoped>
.info-maps {
    display: flex;
    gap: var(--space-8);
    padding-bottom: var(--space-2);
    overflow-x: auto;
    scrollbar-width: thin;
}

.info-maps__card {
    position: relative;
    flex: 0 0 auto;
    width: var(--avesmaps-infopanel-map-w);
    /* Der Deckel reicht nur über die Vorschau, nicht über den Titel darunter. */
    --spoiler-veil-height: var(--avesmaps-infopanel-map-h);
}

/* Ohne jede Vorschau gibt es keine Fläche: Der Deckel reicht dann über die ganze Karte. */
.info-maps.is-textonly .info-maps__card {
    --spoiler-veil-height: 100%;
}

/* Die Kachel ist ein Knopf im Gewand der Kachel von früher: kein Rahmen, keine Fläche, die Schrift des Hauses, links ausgerichtet. */
.info-maps__link {
    display: block;
    width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

/*
 * Die Vorschau füllt ihre Fläche formatunabhängig: Ortspläne sind quer, Grundrisse hoch (Legacy). 🔴 OHNE Bild bleibt nur die Fläche
 * stehen - ohne Rahmen, ohne Grund, ohne Zeichen: Sie zeigt nichts und hält doch die Titel des Streifens auf einer Höhe.
 */
.info-maps__thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: var(--avesmaps-infopanel-map-w);
    height: var(--avesmaps-infopanel-map-h);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    transition: border-color 120ms ease;
}

.info-maps__thumb.is-empty {
    border-color: transparent;
    background: none;
}

.info-maps__img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.info-maps__link:hover .info-maps__thumb:not(.is-empty) {
    border-color: var(--color-accent);
}

.info-maps__link:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Der Titel bricht frei um - eine Karte heißt, wie sie heißt, und wird nicht beschnitten. */
.info-maps__label {
    display: block;
    margin-top: var(--space-4);
    color: var(--color-link);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.info-maps__link:hover .info-maps__label {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.info-maps__card.is-veiled .info-maps__thumb {
    filter: blur(var(--avesmaps-infopanel-veil-blur));
    user-select: none;
}

.info-maps__card.is-veiled .info-maps__label {
    visibility: hidden;
}

@media (prefers-reduced-motion: reduce) {
    .info-maps__thumb {
        transition: none;
    }
}
</style>
