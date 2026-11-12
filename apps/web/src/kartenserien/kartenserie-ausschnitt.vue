<script setup lang="ts">
/**
 * Die Wahl des Bildes im Fächermenü (WI-0220, Vorlage Fassung 4, Idee A „Ausschnitt der Karte“): die ganze Karte der Serie aus
 * ihren 16 Kacheln der Stufe 2, darüber ein Raster von 32 × 32 Zellen der Stufe 5. Ein Tipp wählt die Zelle; die Vorschau zeigt die
 * echte Kachel 5/x/y. Übernehmen meldet die Wahl, der Reiter schreibt sie.
 */
import { computed, onMounted, ref } from "vue";
import { KARTENSERIE_THUMB_VORGABE, type MapSeriesThumb } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";
import { kachelUrl, kachelVorlage } from "./kartenserie-kacheln";

const props = defineProps<{
    seriesId: string;
    name: string;
    thumb: MapSeriesThumb;
    gesperrt?: string | undefined;
}>();
const emit = defineEmits<{ uebernehmen: [thumb: MapSeriesThumb]; abbrechen: [] }>();

const vorlage = ref<string | null>(null);
const wahl = ref<MapSeriesThumb>({ ...props.thumb });
onMounted(async () => {
    vorlage.value = await kachelVorlage(props.seriesId);
});

const STUFE2 = Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4) }));
const karte = computed(() =>
    vorlage.value === null ? [] : STUFE2.map((k) => ({ ...k, url: kachelUrl(vorlage.value!, 2, k.x, k.y) })),
);
const vorschau = computed(() =>
    vorlage.value === null ? null : kachelUrl(vorlage.value, 5, wahl.value.x, wahl.value.y),
);
const istGareth = computed(
    () => wahl.value.x === KARTENSERIE_THUMB_VORGABE.x && wahl.value.y === KARTENSERIE_THUMB_VORGABE.y,
);
const rahmen = computed(() => ({
    left: `${(wahl.value.x / 32) * 100}%`,
    top: `${(wahl.value.y / 32) * 100}%`,
    width: `${100 / 32}%`,
    height: `${100 / 32}%`,
}));

function tippen(ereignis: MouseEvent): void {
    const flaeche = (ereignis.currentTarget as HTMLElement).getBoundingClientRect();
    const x = Math.min(31, Math.max(0, Math.floor(((ereignis.clientX - flaeche.left) / flaeche.width) * 32)));
    const y = Math.min(31, Math.max(0, Math.floor(((ereignis.clientY - flaeche.top) / flaeche.height) * 32)));
    wahl.value = { x, y };
}
function taste(ereignis: KeyboardEvent): void {
    const schritt: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
    };
    const d = schritt[ereignis.key];
    if (d === undefined) return;
    ereignis.preventDefault();
    wahl.value = {
        x: Math.min(31, Math.max(0, wahl.value.x + d[0])),
        y: Math.min(31, Math.max(0, wahl.value.y + d[1])),
    };
}
</script>

<template>
    <div class="ausschnitt" data-testid="kartenserien-ausschnitt">
        <p class="ausschnitt__satz">{{ t("admin.kartenserien.thumb.picker.satz") }}</p>
        <div
            class="ausschnitt__karte"
            role="slider"
            tabindex="0"
            :aria-label="t('admin.kartenserien.thumb.picker.titel', { name: props.name })"
            :aria-valuetext="t('admin.kartenserien.thumb.kachel', { x: wahl.x, y: wahl.y })"
            data-testid="kartenserien-ausschnitt-karte"
            @click="tippen"
            @keydown="taste"
        >
            <img
                v-for="k in karte"
                :key="`${k.x}-${k.y}`"
                class="ausschnitt__kachel"
                :src="k.url"
                alt=""
                draggable="false"
            />
            <span class="ausschnitt__rahmen" :style="rahmen" aria-hidden="true"></span>
        </div>
        <div class="ausschnitt__fuss">
            <img v-if="vorschau !== null" class="ausschnitt__vorschau" :src="vorschau" alt="" />
            <span class="ausschnitt__wert">
                {{ t("admin.kartenserien.thumb.kachel", { x: wahl.x, y: wahl.y }) }}
                <template v-if="istGareth"> {{ t("admin.kartenserien.thumb.gareth") }}</template>
            </span>
        </div>
        <div class="ausschnitt__knoepfe">
            <AvmKnopf testid="kartenserien-ausschnitt-gareth" @click="wahl = { ...KARTENSERIE_THUMB_VORGABE }">
                <span aria-hidden="true">↺ </span>{{ t("admin.kartenserien.thumb.zurueck") }}
            </AvmKnopf>
            <AvmKnopf testid="kartenserien-ausschnitt-abbrechen" @click="emit('abbrechen')">
                {{ t("admin.kartenserien.thumb.abbrechen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefuellt"
                :gesperrt="props.gesperrt"
                testid="kartenserien-ausschnitt-uebernehmen"
                @click="emit('uebernehmen', wahl)"
            >
                {{ t("admin.kartenserien.thumb.uebernehmen") }}
            </AvmKnopf>
        </div>
    </div>
</template>

<style scoped>
.ausschnitt {
    display: grid;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.ausschnitt__satz {
    margin: 0;
    color: var(--color-text-muted);
}

.ausschnitt__karte {
    position: relative;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    width: min(100%, 26rem);
    aspect-ratio: 1;
    overflow: hidden;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-sm);
    cursor: crosshair;
    touch-action: manipulation;
}

.ausschnitt__karte:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.ausschnitt__kachel {
    width: 100%;
    height: 100%;
    display: block;
    user-select: none;
}

.ausschnitt__rahmen {
    position: absolute;
    border: 2px solid var(--color-accent);
    box-shadow: 0 0 0 9999px var(--color-media-nav);
    pointer-events: none;
    transition:
        left 120ms ease,
        top 120ms ease;
}

.ausschnitt__fuss {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.ausschnitt__vorschau {
    width: 5.25rem;
    height: 5.25rem;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
}

.ausschnitt__wert {
    color: var(--color-text-muted);
    font-variant-numeric: tabular-nums;
}

.ausschnitt__knoepfe {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .ausschnitt__rahmen {
        transition: none;
    }
}
</style>
