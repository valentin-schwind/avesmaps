<script setup lang="ts">
import { computed } from "vue";
import { phoneViewport } from "../controls/phone-viewport";
import { t } from "../i18n/i18n";
import { abgelehntSatz } from "../map/geometrie/form-ungueltig";
import type { Bearbeitung } from "./bearbeitung";
import { folgeArbeit, folgeSatz, type FolgeArbeit } from "./folge-arbeit";

/**
 * Der Fuß eines Werkzeugfensters mit Entwurf (O3; EDIT-0003 T27 (4): „der Fuß zeigt nur „n ungespeichert““): links der Zustand
 * (speichert, gespeichert als Revision N, der Satz einer Ablehnung, wer gerade bearbeitet), rechts „n ungespeichert“. Kein
 * Speichern-Knopf: „Fertig“ steht in der Leiste des Modus (`entwurf-leiste.vue`). Gehört in die Slots `fuss-hinweis` und `fuss-haupt`
 * von `avm-fenster.vue`; `teil` sagt, welche Hälfte.
 *
 * Hat das Speichern Folgearbeit eingereiht (Gelände im Umkreis, WI-0223, EDIT-0003 G7; Gebiete), steht neben dem Zustand das Band, wie
 * weit sie ist („Gelände wird im Umkreis neu gerechnet · noch 1:16“), bis der Auftrag endet; danach dass sie fertig ist oder nicht ging
 * (`folge-arbeit.ts`).
 */

const props = defineProps<{
    bearbeitung: Pick<Bearbeitung<unknown, unknown, unknown>, "zustand" | "lage">;
    teil: "hinweis" | "haupt";
    testid?: string | undefined;
    /** Die Folgearbeit; ohne Angabe die eine der Seite. */
    folge?: Pick<FolgeArbeit, "stand"> | undefined;
}>();

const folge = computed(() => {
    const zustand = props.bearbeitung.zustand.value;
    if (zustand.art !== "gespeichert" || zustand.folge === undefined) return undefined;
    const stand = (props.folge ?? folgeArbeit).stand(zustand.folge);
    if (stand === undefined) return undefined;
    return { art: zustand.folge.art, stand: stand.stand, satz: folgeSatz(zustand.folge.art, stand) };
});

const satz = computed(() => {
    const zustand = props.bearbeitung.zustand.value;
    switch (zustand.art) {
        case "speichert":
            return t("entwurf.speichert");
        case "gespeichert":
            return [
                zustand.revision === undefined
                    ? t("entwurf.gespeichertKurz")
                    : t("entwurf.gespeichert", { revision: String(zustand.revision) }),
                ...zustand.befunde,
            ].join(" ");
        case "gesperrt":
            return t("entwurf.gesperrt", { wer: zustand.wer });
        case "sperrfehler":
            return t("entwurf.sperrfehler");
        case "abgelehnt":
            return abgelehntSatz(zustand, phoneViewport.value);
        case "fehlt":
            return t("entwurf.fehlt");
        case "lesefehler":
            return t("entwurf.lesefehler");
        case "konflikt":
            return zustand.grund === "sperre" ? t("entwurf.konflikt.sperreTitel") : t("entwurf.konflikt.titel");
        default:
            return undefined;
    }
});
const zahl = computed(() => {
    const lage = props.bearbeitung.lage.value;
    return lage.aktiv && lage.ungespeichert > 0
        ? t("entwurf.ungespeichert", { n: String(lage.ungespeichert) })
        : undefined;
});
</script>

<template>
    <span v-if="teil === 'hinweis' && satz" :data-testid="testid && `${testid}-zustand`">{{ satz }}</span>
    <span
        v-if="teil === 'hinweis' && folge"
        class="entwurf-fuss__folge"
        :data-art="folge.art"
        :data-stand="folge.stand"
        role="status"
        :data-testid="testid && `${testid}-folge`"
        >{{ folge.satz }}</span
    >
    <span
        v-else-if="teil === 'haupt' && zahl"
        class="entwurf-fuss__zahl"
        :data-testid="testid && `${testid}-ungespeichert`"
        >{{ zahl }}</span
    >
</template>

<style scoped>
.entwurf-fuss__folge {
    margin-left: var(--space-6);
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-sm);
    color: var(--color-pill-text);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.entwurf-fuss__folge[data-stand="fertig"] {
    border-color: var(--color-border);
    color: var(--color-text-muted);
}

.entwurf-fuss__zahl {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}
</style>
