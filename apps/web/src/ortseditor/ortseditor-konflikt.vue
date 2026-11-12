<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { locale, t } from "../i18n/i18n";
import { relativeTime } from "../i18n/relative-time";
import type { EntwurfFeld } from "./entwurf";
import type { BearbeitungsZustand, OrtBearbeitung } from "./ort-bearbeitung";
import { feldNamen } from "./ortseditor-texte";

/**
 * „Jemand war schneller“ (WI-0128 E11; EDIT-0001 §4.3 Zustand Konflikt; Gesamtmockup Version 7): Wer, wann, welche Revision und welche
 * Felder er geändert hat, dazu die eigenen. Drei Wege:
 * - „Eigene Änderung auf Revision N anwenden“ nur ohne Überschneidung: Die eigenen Felder gehen auf den neuen Stand, seine bleiben.
 * - „Fremden Stand übernehmen“: Der eigene Entwurf ist weg, der neue Stand gilt.
 * - „Trotzdem überschreiben“ als Gefahr: Die eigenen Felder gehen auf den neuen Stand, auch wo beide geändert haben.
 *
 * Ein Kasten im Fenster, kein zweites Fenster darüber: Der Entwurf bleibt sichtbar, während man entscheidet.
 */
const props = defineProps<{
    bearbeitung: OrtBearbeitung;
    konflikt: Extract<BearbeitungsZustand, { art: "konflikt" }>;
    kennung: string;
}>();

const liste = (felder: readonly EntwurfFeld[]): string => feldNamen(felder).join(", ");
const wann = computed(() =>
    props.konflikt.wann === undefined
        ? t("ortseditor.konflikt.gerade")
        : relativeTime(new Date(props.konflikt.wann), new Date(), locale.value),
);
const wer = computed(() =>
    t(props.konflikt.wer === undefined ? "ortseditor.konflikt.jemand" : "ortseditor.konflikt.wer", {
        wer: props.konflikt.wer ?? "",
        ort: props.konflikt.jetzt.name,
        wann: wann.value,
        revision: String(props.konflikt.jetzt.revision),
        felder: liste(props.konflikt.fremde),
    }),
);
</script>

<template>
    <section class="konflikt" role="alert" :data-testid="`${kennung}-konflikt`">
        <h4 class="konflikt__titel">{{ t("ortseditor.konflikt.titel") }}</h4>
        <p class="konflikt__satz">{{ wer }}</p>
        <p class="konflikt__satz konflikt__satz--leise">
            {{ t("ortseditor.konflikt.eigene", { felder: liste(konflikt.eigene) }) }}
            {{
                konflikt.beide.length > 0
                    ? t("ortseditor.konflikt.beide", { felder: liste(konflikt.beide) })
                    : t("ortseditor.konflikt.frei")
            }}
        </p>
        <div class="konflikt__wege">
            <AvmKnopf
                art="gefuellt"
                :gesperrt="konflikt.beide.length > 0 ? t('ortseditor.konflikt.anwendenGesperrt') : undefined"
                :testid="`${kennung}-konflikt-anwenden`"
                @click="bearbeitung.eigeneAnwenden()"
            >
                {{ t("ortseditor.konflikt.anwenden", { revision: String(konflikt.jetzt.revision) }) }}
            </AvmKnopf>
            <AvmKnopf :testid="`${kennung}-konflikt-uebernehmen`" @click="bearbeitung.fremdenUebernehmen()">
                {{ t("ortseditor.konflikt.uebernehmen") }}
            </AvmKnopf>
            <AvmKnopf
                art="gefahr"
                :testid="`${kennung}-konflikt-ueberschreiben`"
                @click="bearbeitung.eigeneAnwenden(true)"
            >
                {{ t("ortseditor.konflikt.ueberschreiben") }}
            </AvmKnopf>
        </div>
    </section>
</template>

<style scoped>
.konflikt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-warning-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-warning-soft);
}

.konflikt__titel {
    margin: 0;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-body);
}

.konflikt__satz {
    margin: 0;
    color: var(--color-text-strong);
}

.konflikt__satz--leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.konflikt__wege {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4) var(--space-8);
}
</style>
