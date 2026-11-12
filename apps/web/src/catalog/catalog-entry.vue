<script setup lang="ts">
import { computed } from "vue";
import { formatNumber, t } from "../i18n/i18n";
import type { CardImage } from "../info-panel/catalog-model";
import InfoFields from "../info-panel/info-fields.vue";
import type { RowModel } from "../info-panel/panel-types";
import type { LinkLine } from "./catalog-link-model";
import CatalogLinks from "./catalog-links.vue";

/**
 * Der VERGRÖSSERTE Eintrag des Verzeichnisses (WI-0118, Betreiber 2026-10-09: ein Klick auf eine Karte oder eine Literatur soll „immer
 * den jeweiligen Eintrag im Verzeichnis vergrößert darstellen. Größer als das aktuell bei legacy stattfindet. … Hier sollten die
 * Informationen stehen, die wir haben, inkl. [Links] zu woanders“). Links: ein Bild, rechts daneben ALLE Angaben als Feldliste - dieselbe
 * Feldzeile wie im Infopanel (`info-fields.vue`: Beschriftung links, Wert füllt), keine zweite Rezeptur.
 *
 * 🔴 **Das Bild wird nie hochskaliert.** Vorschauen sind höchstens 400 px breit, Umschläge 600 px hoch - das sind die Maße der Dateien
 * (Media Core), und sie stehen hier in ihrer eigenen Größe; ein schmales Fenster verkleinert sie (`max-width: 100%`), kein breites
 * vergrößert sie über ihre Pixel hinaus. Legacy zeigte 248 × 174: Das ist jetzt gut ein Drittel mehr Fläche je Seite.
 *
 * 🔴 **Wo es ein Vollbild gibt, steht das Vollbild da** (heute nur Rhôndur, 1240 × 896): groß, die ganze Breite des Fensters, und ein Klick
 * darauf öffnet die Datei in voller Größe im neuen Tab. Darunter sagt eine Zeile mit ↗ dasselbe in Worten und nennt die Maße - ein Bild
 * ohne Text ist ein Link ohne Pfeil (Hausregel `a[target="_blank"]::after`, WI-0107, gilt nur für Anker mit Text). Ohne Vollbild führt das Bild
 * zur ersten Fundstelle, wenn es eine gibt (Legacy: „das große Bild öffnet die Karte“); sonst tut es nichts und ist auch kein Link.
 *
 * 🔴 **Fehlt das Bild, steht nichts da** (MEDIA-M12): kein Rahmen, kein Platzhalter. Die Angaben rücken auf die ganze Breite.
 *
 * 🔴 **Die Fundstellen stehen BEI den Angaben**, nicht unter dem Bild: im Eintrag mit Aufschrift, jede mit ↗. Wo die Angabenspalte breit
 * ist (ein Vollbild lässt ihr das ganze Fenster), stehen Angaben und Fundstellen nebeneinander, sonst untereinander.
 */
const props = defineProps<{
    /** Die Vorschau beziehungsweise der Umschlag. */
    image: CardImage | undefined;
    /** Das Vollbild, wo es eins gibt; es steht anstelle der Vorschau. */
    full: CardImage | undefined;
    /** Wohin das Bild führt, wenn es kein Vollbild gibt. */
    fallbackHref: string | undefined;
    facts: RowModel[];
    links: readonly LinkLine[];
    /** Der leise Satz, wenn es keine Fundstelle gibt; ohne Satz entfällt der Block (die Literatur hat immer eine). */
    linksEmpty?: string | undefined;
    /** Das Bild war nicht ladbar (`@error`): Der Aufrufer nimmt es aus der Liste, es fällt hier weg. */
    broken: readonly string[];
}>();
const emit = defineEmits<{ broke: [url: string] }>();

const shown = computed(() => {
    const own = props.full ?? props.image;
    return own === undefined || props.broken.includes(own.url) ? undefined : own;
});
const target = computed(() => (props.full === undefined ? props.fallbackHref : props.full.url));
const size = computed(() =>
    props.full === undefined ? "" : `${formatNumber(props.full.width, 0)} × ${formatNumber(props.full.height, 0)} px`,
);
</script>

<template>
    <div class="eintrag" data-testid="catalog-entry">
        <figure v-if="shown !== undefined" class="eintrag__bild" :class="{ 'is-voll': full !== undefined }">
            <component
                :is="target === undefined ? 'span' : 'a'"
                class="eintrag__rahmen"
                :href="target"
                :target="target === undefined ? undefined : '_blank'"
                :rel="target === undefined ? undefined : 'noopener noreferrer'"
                :title="target === undefined ? undefined : t('catalog.image.open')"
                data-testid="catalog-entry-image-link"
            >
                <img
                    class="eintrag__img"
                    :src="shown.url"
                    :width="shown.width"
                    :height="shown.height"
                    alt=""
                    decoding="async"
                    data-testid="catalog-entry-image"
                    :data-kind="full === undefined ? 'preview' : 'full'"
                    @error="emit('broke', shown.url)"
                />
            </component>
            <figcaption v-if="full !== undefined" class="eintrag__unterschrift">
                <a
                    class="eintrag__voll"
                    :href="full.url"
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="catalog-entry-full-link"
                    >{{ t("catalog.citymaps.fullOpen") }}</a
                >
                <span class="eintrag__masse">({{ size }})</span>
            </figcaption>
        </figure>
        <div class="eintrag__angaben">
            <InfoFields v-if="facts.length > 0" class="eintrag__fakten" :rows="facts" embedded />
            <div v-if="links.length > 0 || linksEmpty !== undefined" class="eintrag__links">
                <p class="eintrag__etikett">{{ t("catalog.links") }}</p>
                <CatalogLinks :links="links" :empty="linksEmpty" />
                <div v-if="$slots.default" class="eintrag__mehr"><slot /></div>
            </div>
        </div>
    </div>
</template>

<style scoped>
/*
 * Das Bild und die Angaben nebeneinander, wo der Platz reicht - sonst übereinander (umbrechender Flex, wie die Kacheln in „Hinweise“,
 * Guide §12.6 „Nebeneinander“): Die Angabenspalte nimmt, was übrig ist, mindestens aber eine Lesespalte. Ein Vollbild ist so breit wie das
 * Fenster und lässt keinen Platz daneben: die Angaben stehen darunter.
 */
.eintrag {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-10);
    min-width: 0;
    padding-top: var(--space-6);
}

.eintrag__bild {
    display: block;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 100%;
    margin: 0;
}

/* Ein Vollbild ist die ganze Breite des Eintrags: Es soll groß sein, nicht neben den Angaben klemmen. */
.eintrag__bild.is-voll {
    flex-basis: 100%;
}

.eintrag__rahmen {
    display: block;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
    line-height: 0;
    transition: border-color 120ms ease;
}

a.eintrag__rahmen:hover {
    border-color: var(--color-accent);
}

a.eintrag__rahmen:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/*
 * 🪤 DAS BILD IST EIN LINK OHNE TEXT und nimmt sich von der Hausregel „externe Links tragen ein ↗“ aus (`a[target="_blank"]::after`,
 * `styles/canon.css`, WI-0107) - Legacys eigene, enge Ausnahme: „ein Icon-Knopf hat keinen Text, an den sich der Pfeil hängen könnte“.
 * Den Pfeil trägt die Unterschrift darunter, am selben Ziel.
 */
.eintrag__rahmen::after {
    content: none;
}

.eintrag__img {
    display: block;
    /*
     * Nie größer als die eigene Datei (`width: auto` nimmt ihre Pixel), nie breiter als der Platz und nie höher als der Schirm: Ein
     * Umschlag von 600 px Höhe soll im Fenster Platz neben seinen Angaben haben, nicht eine Seite für sich. Das Seitenverhältnis bleibt.
     */
    width: auto;
    max-width: 100%;
    height: auto;
    max-height: 65dvh;
}

.eintrag__unterschrift {
    margin-top: var(--space-4);
    font-size: var(--font-size-caption);
}

.eintrag__voll {
    color: var(--color-link);
    text-decoration: none;
}

.eintrag__voll:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.eintrag__voll:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring, 0 0 0 3px var(--color-focus));
}

/* Der Pfeil der Hausregel hängt am Anker; die Maße dahinter stehen mit einem Atemzug Abstand. */
.eintrag__masse {
    margin-left: var(--space-2);
    color: var(--color-text-muted);
}

/* Angaben und Fundstellen: nebeneinander, wo die Spalte breit ist (ein Vollbild), sonst übereinander. */
.eintrag__angaben {
    display: flex;
    flex: 1 1 var(--avm-fenster-spalte);
    flex-wrap: wrap;
    gap: var(--space-10);
    min-width: 0;
}

.eintrag__fakten {
    flex: 1 1 var(--avm-fenster-spalte);
}

.eintrag__links {
    flex: 1 1 var(--avm-fenster-spalte);
    min-width: 0;
}

.eintrag__etikett {
    margin: 0 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.eintrag__mehr {
    margin-top: var(--space-6);
}

@media (prefers-reduced-motion: reduce) {
    .eintrag__rahmen {
        transition: none;
    }
}
</style>
