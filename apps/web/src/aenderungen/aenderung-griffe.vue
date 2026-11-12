<script setup lang="ts">
import { computed } from "vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import { t } from "../i18n/i18n";

/**
 * Die Zeichenknöpfe der Griffleiste im Detail einer Änderung (WI-0265 B10; Hausregel „Backend-Knöpfe mit abstrakten Zeichen“, Vorlage `review/wi-0265/aenderungen-neu.html`): ⊕ Auf der Karte zeigen (B9),
 * ⚙ Im Objektverlauf zeigen (im Objektverlauf selbst: ⇄ In Änderungen zeigen), ⌕ Nur dieses Objekt zeigen. Reine Zeichen mit Namen als Tooltip und `aria-label`, rechtsbündig in der Zeile des ↺.
 * Ein Knopf, den es für diese Änderung nicht gibt, fehlt; ohne einen einzigen fehlt die ganze Gruppe.
 */
const props = defineProps<{
    /** Vorsilbe der Test-Kennungen. */
    kennung: string;
    /** ⊕: der Name (der Knopf sagt, ob er zeigt oder wegnimmt); `undefined`, wo die Änderung keinen Ort haben kann. */
    karte?: { readonly titel: string; readonly gedrueckt: boolean; readonly status: string | undefined } | undefined;
    /** ⚙ im Reiter, ⇄ im Objektverlauf; `undefined`, wo es keinen Sprung gibt. */
    sprung?: "objekt" | "aenderungen" | undefined;
    nurObjekt?: boolean | undefined;
}>();
const emit = defineEmits<{ karte: []; sprung: []; nurObjekt: [] }>();

const sprungName = computed(() =>
    props.sprung === "objekt" ? t("aenderungen.detail.zeigeObjektverlauf") : t("aenderungen.detail.zeigeAenderungen"),
);
const gibtEs = computed(() => props.karte !== undefined || props.sprung !== undefined || props.nurObjekt === true);
</script>

<template>
    <span v-if="gibtEs" class="griffe-zeichen">
        <span v-if="karte?.status" class="griffe-zeichen__status" role="status">{{ karte.status }}</span>
        <AvmKnopf
            v-if="karte"
            groesse="zeile"
            class="griffe-zeichen__knopf"
            :title="karte.titel"
            :aria-label="karte.titel"
            :aria-pressed="karte.gedrueckt"
            :testid="`${kennung}-karte`"
            @click="emit('karte')"
        >
            <span aria-hidden="true">⊕</span>
        </AvmKnopf>
        <AvmKnopf
            v-if="sprung"
            groesse="zeile"
            class="griffe-zeichen__knopf"
            :title="sprungName"
            :aria-label="sprungName"
            :testid="`${kennung}-sprung`"
            @click="emit('sprung')"
        >
            <span aria-hidden="true">{{ sprung === "objekt" ? "⚙" : "⇄" }}</span>
        </AvmKnopf>
        <AvmKnopf
            v-if="nurObjekt"
            groesse="zeile"
            class="griffe-zeichen__knopf"
            :title="t('aenderungen.detail.nurObjekt')"
            :aria-label="t('aenderungen.detail.nurObjekt')"
            :testid="`${kennung}-nur-objekt`"
            @click="emit('nurObjekt')"
        >
            <span aria-hidden="true">⌕</span>
        </AvmKnopf>
    </span>
</template>

<style scoped>
.griffe-zeichen {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-4);
    margin-left: auto;
}

.griffe-zeichen__status {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Ein Zeichen ist so breit wie hoch (Maß des Hauses für Knöpfe in einer Tafelzeile, 26 px). */
.griffe-zeichen__knopf :deep(.knopf) {
    min-width: var(--space-24);
    padding-inline: var(--space-4);
    font-size: 14px;
}

.griffe-zeichen__knopf :deep(.knopf[aria-pressed="true"]) {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
}
</style>
