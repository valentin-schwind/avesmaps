<script setup lang="ts">
import { computed, ref } from "vue";
import type { MamAssetSummary } from "@avesmaps3d/shared";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import { zustandName } from "./medien-einreichung-modell";
import { trefferBild } from "./medien-inspektor-modell";
import { kreisDesAssets, kreisName } from "./medien-kreis";
import { anzeigeName, rechtsgrundName, rolleName, zahl } from "./medien-text";

/**
 * Ein Treffer in Spalte 2 (WI-0068 §3.2): als Kachel im Raster oder als Zeile in der Liste.
 *
 * - **Zeile wie Legacys `.avm-row`** (AGENTS „Legacys Listendesign wird übernommen“, `css/components/editor-row.css` an cfbbe69c8):
 *   schwebend, Radius 8, Polster 4 / 6, die durchsichtige Kante ist immer da und färbt sich nur bei der Wahl (sonst spränge die
 *   Zeile um zwei Pixel); Hover die Lasur, gewählt die Aktiv-Lasur mit goldener Kante. Erste Zeile: Name, Kreis, Rolle rechts in
 *   11 px gedämpft; zweite Zeile 11 px gedämpft, gefärbt nach dem Zustand (offene Rechte warnen). Links das Vorschaubild; die Texte
 *   stehen bündig, auch ohne Bild (Guide §11).
 * - **Kachel**: dasselbe in der Form des Mockups - Bild oben (nie hochskaliert, `contain` auf der weichen Fläche), darunter Name und
 *   Unterzeile.
 * - 🔴 Inhaltsbilder werden nie umgefärbt und nie gedimmt (Hausregel); der Kreis sagt den Stand (`medien-kreis.ts`).
 */
const props = defineProps<{
    eintrag: MamAssetSummary;
    ansicht: "raster" | "liste";
    /** Im Raster: Kachel füllen oder Bild ganz anzeigen (die Kachel bleibt quadratisch). */
    bild?: "fuellen" | "ganz" | undefined;
    gewaehlt: boolean;
}>();
const emit = defineEmits<{ waehle: []; doppelt: [] }>();

const name = computed(() => anzeigeName(props.eintrag, props.eintrag.primaryUsage));
const kreis = computed(() => kreisDesAssets(props.eintrag));
const rolle = computed(() => {
    const role = props.eintrag.primaryUsage?.role;
    return role === null || role === undefined ? "" : rolleName(role);
});
/** Rechte offen: kein Rechtsgrund, unbekannt oder nicht geprüft (wie der Korb `rights_open`). */
const rechteOffen = computed(
    () =>
        props.eintrag.rightsBasis === null ||
        props.eintrag.rightsBasis === "unknown" ||
        props.eintrag.clearance === null ||
        ["unreviewed", "needs_review", "legacy_assumed"].includes(props.eintrag.clearance),
);
/** Die Einreichung eines Besuchers hinter dem Treffer (WI-0272 S3): Dann sagt die zweite Zeile, wo, wie und in welchem Stand sie ist; offen warnt. */
const einreichung = computed(() => props.eintrag.submission ?? undefined);
const warnt = computed(() =>
    einreichung.value === undefined ? rechteOffen.value : einreichung.value.unterteilung === "offen",
);
const unterzeile = computed(() => {
    const s = einreichung.value;
    if (s !== undefined) {
        return t("medien.einreichung.zeile", {
            ort:
                s.ortName === null
                    ? t("medien.einreichung.ohneOrt")
                    : t("medien.einreichung.inOrt", { ort: s.ortName }),
            art: t(`photobox.entstehung.${s.entstehung}`),
            stand: zustandName(s.zustand),
        });
    }
    const rechte =
        props.eintrag.rightsBasis === null ? t("medien.wert.keineRechte") : rechtsgrundName(props.eintrag.rightsBasis);
    return t("medien.eintrag.unter", { rechte, n: zahl(props.eintrag.usageCount) });
});
/**
 * Die Adresse einer Vorschau, die nicht lud: Anders als im Infopanel (dort zeigt ein kaputtes Bild GAR NICHTS) bleibt hier der
 * gestrichelte Platz stehen - für die Redaktion ist eine fehlende Datei ein Befund, kein Schmuck, der wegfallen darf.
 */
const kaputt = ref<string | undefined>(undefined);
/** Öffentlich oder, ohne öffentliche Datei, die private Vorschau (WI-0068 P4b). */
const bildDatei = computed(() => trefferBild(props.eintrag));
</script>

<template>
    <button
        type="button"
        class="medien-eintrag"
        :class="[`medien-eintrag--${ansicht}`, { 'is-gewaehlt': gewaehlt, 'is-ganz': bild === 'ganz' }]"
        :aria-current="gewaehlt ? 'true' : undefined"
        :data-asset="eintrag.id"
        data-testid="medien-eintrag"
        @click="emit('waehle')"
        @dblclick="emit('doppelt')"
    >
        <span
            class="medien-eintrag__bild"
            :class="{ 'is-leer': bildDatei === null || kaputt === bildDatei.url }"
            :data-bild="
                bildDatei === null ? 'keins' : kaputt === bildDatei.url ? 'kaputt' : bildDatei.intern ? 'intern' : 'da'
            "
        >
            <img
                v-if="bildDatei !== null && kaputt !== bildDatei.url"
                :src="bildDatei.url"
                :width="bildDatei.width"
                :height="bildDatei.height"
                alt=""
                loading="lazy"
                decoding="async"
                @error="kaputt = bildDatei?.url"
            />
            <!-- Frisch hochgeladen: Der Job rechnet die Fassungen noch (WI-0068 P4b, Schritt 6). -->
            <span
                v-else-if="eintrag.technicalState === 'pending'"
                class="medien-eintrag__rechnet"
                :title="t('medien.inspektor.wirdGerechnet')"
                data-testid="medien-eintrag-rechnet"
                >↻</span
            >
        </span>
        <span class="medien-eintrag__text">
            <span class="medien-eintrag__l1">
                <span class="medien-eintrag__name einzeilig">{{ name }}</span>
                <AvmKreis :fuellung="kreis" :name="kreisName(kreis)" testid="medien-eintrag-kreis" />
                <span v-if="ansicht === 'liste' && rolle !== ''" class="medien-eintrag__art">{{ rolle }}</span>
            </span>
            <span class="medien-eintrag__l2 einzeilig" :class="{ 'is-warnung': warnt }">{{ unterzeile }}</span>
        </span>
    </button>
</template>

<style scoped>
.medien-eintrag__rechnet {
    color: var(--color-text-muted);
    font-size: var(--font-size-title);
}

.medien-eintrag {
    box-sizing: border-box;
    display: flex;
    min-width: 0;
    width: 100%;
    margin: 0;
    padding: var(--avm-row-pad);
    border: 1px solid transparent;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.medien-eintrag--liste {
    flex-direction: row;
    align-items: center;
    gap: var(--space-6);
}

.medien-eintrag--raster {
    flex-direction: column;
    gap: var(--space-4);
}

.medien-eintrag:hover {
    background: var(--color-hover-wash);
}

.medien-eintrag:active {
    background: var(--color-active-wash);
}

.medien-eintrag:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-eintrag.is-gewaehlt,
.medien-eintrag.is-gewaehlt:hover {
    border-color: var(--color-accent);
    background: var(--color-active-wash);
}

/* Das Bild in der Liste: nie hochskaliert, ganz zu sehen, auf der weichen Fläche (Guide §12.6 „Bilder werden nie hochskaliert“). */
.medien-eintrag__bild {
    display: grid;
    flex: none;
    place-items: center;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-soft);
}

.medien-eintrag--liste .medien-eintrag__bild {
    width: var(--avm-fenster-daumen);
    height: var(--avm-fenster-daumen);
}

/*
 * Im Raster ist die Kachel quadratisch und das Bild füllt sie, ohne verzerrt zu werden: Was übersteht, wird beschnitten (Betreiber
 * 2026-10-10: „thumbs in der rasteransicht quadratisch und füllen ohne dass das seitenverhältnis verletzt wird“). Nur die Kachel, die
 * Datei bleibt, wie sie ist; der Inspector zeigt das ganze Bild.
 */
.medien-eintrag--raster .medien-eintrag__bild {
    width: 100%;
    aspect-ratio: 1;
}

.medien-eintrag--raster .medien-eintrag__bild img {
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    object-fit: cover;
}

/* „Bild ganz anzeigen“: dieselbe quadratische Kachel, das Bild ganz darin, der Rand auf der weichen Fläche. */
.medien-eintrag--raster.is-ganz .medien-eintrag__bild img {
    object-fit: contain;
}

.medien-eintrag__bild img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
}

/* Ohne Bild bleibt der Platz leer und gestrichelt: die Texte stehen trotzdem bündig (§11). */
.medien-eintrag__bild.is-leer {
    border: 1px dashed var(--color-border-strong);
}

.medien-eintrag__text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    width: 100%;
}

.medien-eintrag__l1 {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
}

.medien-eintrag__name {
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.medien-eintrag--raster .medien-eintrag__name {
    font-size: var(--font-size-small);
}

.medien-eintrag__art {
    flex: none;
    margin-left: auto;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-eintrag__l2 {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-eintrag__l2.is-warnung {
    color: var(--color-warning-soft-text);
}

@media (prefers-reduced-motion: reduce) {
    .medien-eintrag {
        transition: none;
    }
}
</style>
