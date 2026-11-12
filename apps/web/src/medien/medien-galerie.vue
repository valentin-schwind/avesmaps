<script setup lang="ts">
import { computed } from "vue";
import type { MediaGalleryDetail } from "@avesmaps3d/shared";
import { t } from "../i18n/i18n";
import { zahl } from "./medien-text";

/**
 * Eine Galerie im Inspector (WI-0068 §9: „eine Galerie ist ein eigenes Medienobjekt“): ihre Folge in `position`, das Cover markiert, das
 * gewählte Asset hervorgehoben, zurückgezogene Einträge an ihrer Stelle und als solche benannt. Ein Klick auf ein Bild wählt dieses
 * Asset. Ordnen, Cover setzen und Bearbeiten kommen mit P6; hier wird nur gelesen.
 */
const props = defineProps<{ galerie: MediaGalleryDetail; aktuell: string | undefined }>();
const emit = defineEmits<{ waehleAsset: [id: string] }>();

const cover = computed(() => props.galerie.coverAssetId ?? props.galerie.items.find((item) => !item.retired)?.asset.id);
const aktive = computed(() => props.galerie.items.filter((item) => !item.retired).length);
const bindungen = computed(() =>
    props.galerie.bindings
        .filter((bindung) => !bindung.retired)
        .map((bindung) => bindung.subject.name)
        .join(", "),
);
const unter = computed(() =>
    [
        t(aktive.value === 1 ? "medien.galerie.bild" : "medien.galerie.bilder", { n: zahl(aktive.value) }),
        t(`medien.galerie.stand.${props.galerie.publicationState}`),
        t(`medien.galerie.herkunft.${props.galerie.origin}`),
        bindungen.value === "" ? undefined : t("medien.galerie.an", { namen: bindungen.value }),
    ]
        .filter((teil) => teil !== undefined)
        .join(" · "),
);
</script>

<template>
    <div class="medien-galerie" data-testid="medien-galerie">
        <p class="medien-galerie__unter">{{ unter }}</p>
        <ol class="medien-galerie__folge">
            <li v-for="item in galerie.items" :key="item.asset.id">
                <button
                    type="button"
                    class="medien-galerie__bild"
                    :class="{ 'is-aktuell': item.asset.id === aktuell, 'is-zurueck': item.retired }"
                    :aria-current="item.asset.id === aktuell ? 'true' : undefined"
                    :aria-label="t('medien.galerie.position', { n: zahl(item.position) })"
                    data-testid="medien-galerie-bild"
                    @click="emit('waehleAsset', item.asset.id)"
                >
                    <img v-if="item.asset.preview !== null" :src="item.asset.preview.url" alt="" loading="lazy" />
                    <span class="medien-galerie__nr">{{ zahl(item.position) }}</span>
                    <span v-if="item.asset.id === cover" class="medien-galerie__marke">{{
                        t("medien.galerie.cover")
                    }}</span>
                    <span v-else-if="item.retired" class="medien-galerie__marke">{{
                        t("medien.galerie.zurueckgezogen")
                    }}</span>
                </button>
            </li>
        </ol>
    </div>
</template>

<style scoped>
.medien-galerie {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.medien-galerie__unter {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-galerie__folge {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--avm-fenster-kachel) * 0.75), 1fr));
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.medien-galerie__bild {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    aspect-ratio: 16 / 9;
    overflow: hidden;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    background: var(--color-panel);
    cursor: pointer;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-galerie__bild img {
    width: 100%;
    height: 100%;
    object-fit: cover;
}

.medien-galerie__bild:hover {
    border-color: var(--color-border-strong);
}

.medien-galerie__bild:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-galerie__bild.is-aktuell {
    border-color: var(--color-accent);
    box-shadow: 0 0 0 1px var(--color-accent);
}

/* Ein zurückgezogener Eintrag bleibt an seiner Stelle; gestrichelt heißt „nicht dauerhaft“ (§13.17), das Bild selbst wird nie gedimmt. */
.medien-galerie__bild.is-zurueck {
    border-style: dashed;
}

/* Was auf einem Bild liegt, bekommt einen eigenen Grund (Guide §16.1). */
.medien-galerie__nr,
.medien-galerie__marke {
    position: absolute;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--color-media-nav);
    color: var(--color-media-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.medien-galerie__nr {
    top: var(--space-2);
    left: var(--space-2);
}

.medien-galerie__marke {
    right: var(--space-2);
    bottom: var(--space-2);
}

@media (prefers-reduced-motion: reduce) {
    .medien-galerie__bild {
        transition: none;
    }
}
</style>
