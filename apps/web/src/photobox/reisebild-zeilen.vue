<script setup lang="ts">
import { ref, watch } from "vue";
import type { PhotoboxOrtReisebilder } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t, type MessageKey } from "../i18n/i18n";
import ReisebildKiZeichen from "./reisebild-ki-zeichen.vue";

type Reisebild = PhotoboxOrtReisebilder["reisebilder"][number];

/**
 * Die freigegebenen Reisebilder als Zeilen (WI-0272): Vorschau, Beschreibung, Name und Entstehung, „Zur Stelle“ und der Weg zum Bild. Dieselbe Liste steht im Panel des Ortseditors und im Medienobjekt
 * „PhotoBox-Galerien“; was die Knöpfe tun, entscheidet, wer sie einbindet.
 */
const props = defineProps<{ bilder: readonly Reisebild[]; kennung: string; medienText: string }>();
const emit = defineEmits<{ stelle: [bild: Reisebild]; medien: [bild: Reisebild] }>();

const kaputt = ref<readonly string[]>([]);
watch(
    () => props.bilder,
    () => {
        kaputt.value = [];
    },
);

function vonWem(bild: Reisebild): string {
    const name = t("photobox.karte.bildVon", { name: bild.name ?? t("photobox.karte.anonym") });
    return bild.entstehung === "ai_generated"
        ? name
        : `${name} · ${t(`photobox.entstehung.${bild.entstehung}` as MessageKey)}`;
}
</script>

<template>
    <ul class="reisebilder__liste">
        <li
            v-for="bild in bilder"
            :key="bild.publicId"
            class="reisebilder__zeile"
            :data-testid="`${kennung}-reisebild`"
        >
            <img
                v-if="bild.url !== null && !kaputt.includes(bild.publicId)"
                class="reisebilder__daumen"
                :src="bild.url"
                alt=""
                loading="lazy"
                @error="kaputt = [...kaputt, bild.publicId]"
            />
            <span v-else class="reisebilder__daumen reisebilder__daumen--leer" aria-hidden="true"></span>
            <span class="reisebilder__text">
                <span class="reisebilder__beschreibung">{{
                    bild.beschreibung ?? t("ortseditor.bilder.reisebildOhneText")
                }}</span>
                <span class="reisebilder__leise"
                    >{{ vonWem(bild)
                    }}<template v-if="bild.entstehung === 'ai_generated'"> · <ReisebildKiZeichen /></template
                ></span>
                <span class="reisebilder__knoepfe">
                    <AvmKnopf groesse="zeile" :testid="`${kennung}-reisebild-stelle`" @click="emit('stelle', bild)">
                        {{ t("photobox.karte.zurStelle") }}
                    </AvmKnopf>
                    <AvmKnopf groesse="zeile" :testid="`${kennung}-reisebild-medien`" @click="emit('medien', bild)">
                        {{ medienText }}
                    </AvmKnopf>
                </span>
            </span>
        </li>
    </ul>
</template>

<style scoped>
.reisebilder__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.reisebilder__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.reisebilder__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4) var(--space-8);
}

/* Im Seitenverhältnis des Kopfs im Infopanel, wie das Titelbild im Kasten darüber. */
.reisebilder__daumen {
    flex: none;
    width: calc(var(--avm-fenster-daumen) * 2);
    aspect-ratio: 16 / 9;
    border-radius: var(--radius-sm);
    object-fit: cover;
}

.reisebilder__daumen--leer {
    border: 1px dashed var(--color-border);
}

.reisebilder__text {
    display: flex;
    flex: 1 1 12em;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.reisebilder__beschreibung {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.reisebilder__knoepfe {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
    margin-top: var(--space-2);
}
</style>
