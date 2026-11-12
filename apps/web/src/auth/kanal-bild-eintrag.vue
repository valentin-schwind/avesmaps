<script setup lang="ts">
import { computed, ref } from "vue";
import type { KanalBild } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t } from "../i18n/i18n";
import { zielMasse } from "./kanal-bild";
import { bildUrl, type Kanal } from "./kanal";

/**
 * Ein Bild im Verlauf eines Vorgangs (KANAL-0001 §6, Blatt WI-0124 Nachtrag A1 bis A4): die Vorschau öffnet die Ansicht in voller Größe,
 * darunter Maße und „ohne Ortsangabe“; „Bild entfernen“ fragt an der Stelle und geht jederzeit, auch in offenen Vorgängen. Solange der
 * Worker rendert, steht „wird vorbereitet“; was er abweist, sagt warum. Ist das Bild entfernt, bleibt nur der Satz.
 */
const props = defineProps<{ kanal: Kanal; id: string; bild: KanalBild | undefined }>();
const frage = ref(false);

/** Die Maße der Vorschau (lange Kante 480), damit nichts springt, wenn sie lädt. */
const vorschau = computed(() =>
    props.bild === undefined ? null : zielMasse(props.bild.breite, props.bild.hoehe, 480),
);

async function entfernen(): Promise<void> {
    if (await props.kanal.bildEntfernen(props.id)) frage.value = false;
}
</script>

<template>
    <p v-if="props.bild === undefined" class="bild__leise" :data-testid="`kanal-bild-${props.id}`">
        <span aria-hidden="true">⊘ </span>{{ t("kanal.image.gone") }}
    </p>
    <p
        v-else-if="props.bild.zustand === 'wird_vorbereitet'"
        class="bild__leise"
        :data-testid="`kanal-bild-${props.id}`"
    >
        {{ t("kanal.image.pending") }}
    </p>
    <p v-else-if="props.bild.zustand === 'abgewiesen'" class="bild__problem" :data-testid="`kanal-bild-${props.id}`">
        {{ t("kanal.image.failed", { reason: props.bild.abgewiesenGrund ?? "—" }) }}
    </p>
    <figure v-else class="bild" :data-testid="`kanal-bild-${props.id}`">
        <a
            class="bild__link"
            :href="bildUrl(props.id, 'ansicht')"
            target="_blank"
            rel="noopener"
            :aria-label="t('kanal.image.open')"
        >
            <img
                class="bild__vorschau"
                :src="bildUrl(props.id, 'vorschau')"
                :width="vorschau?.breite"
                :height="vorschau?.hoehe"
                :alt="t('kanal.image.alt')"
                loading="lazy"
            />
        </a>
        <figcaption class="bild__unter">
            <span>{{
                t("kanal.image.caption", {
                    w: formatNumber(props.bild.breite, 0),
                    h: formatNumber(props.bild.hoehe, 0),
                })
            }}</span>
            <AvmKnopf
                art="gefahr"
                groesse="zeile"
                :gesperrt="frage ? '' : undefined"
                :testid="`kanal-bild-entfernen-${props.id}`"
                @click="frage = true"
                ><span aria-hidden="true">✕ </span>{{ t("kanal.image.remove") }}</AvmKnopf
            >
        </figcaption>
    </figure>
    <AvmBestaetigung
        v-if="frage && props.bild !== undefined"
        :frage="t('kanal.image.removeAsk')"
        :folge="t('kanal.image.removeFollows')"
        :bestaetigen="t('kanal.image.removeNow')"
        :gesperrt="props.kanal.busy.value === 'bild' ? '' : undefined"
        :testid="`kanal-bild-frage-${props.id}`"
        @bestaetigen="entfernen()"
        @abbrechen="frage = false"
    />
</template>

<style scoped>
.bild {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
}

.bild__link {
    align-self: flex-start;
    max-width: 100%;
    border-radius: var(--radius-md);
    line-height: 0;
}

.bild__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.bild__vorschau {
    max-width: 100%;
    height: auto;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.bild__unter {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.bild__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.bild__problem {
    margin: 0;
    color: var(--color-danger-soft-text);
    font-size: var(--font-size-small);
}
</style>
