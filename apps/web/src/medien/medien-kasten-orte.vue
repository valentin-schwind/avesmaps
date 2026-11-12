<script setup lang="ts">
import { computed, nextTick, useTemplateRef, watch } from "vue";
import type { MamKarteDetail } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { formatNumber, t } from "../i18n/i18n";
import { ORTE_MIN_ZEICHEN, ortZeilen, type MamKarteOrt, type OrtTreffer } from "./medien-karte-orte-modell";
import { createOrteSteuerung, type OrteOptionen } from "./medien-karte-orte-steuerung";
import MedienKastenKnopf from "./medien-kasten-knopf.vue";
import type { MedienOperationen } from "./medien-operationen";

/**
 * Der Kasten „Orte und Regionen (n)“ einer Karte der Kartensammlung (WI-0287 Stufe 3; Entwurf Fassung 6: `kastenOrte`, `zeichneOrtTreffer`). Vorher stand hier ein lesender Kasten „Orte“.
 * Dieselbe Tafel (`citymap_place`) steht in der Infobox jedes Orts und jeder Region und im Reiter „Karten“ ihres Editors.
 *
 * - **Sofort speichern:** „✚ Ort oder Region“ im Kopf öffnet oben im Kasten die Suche (Orte und Regionen in einer Liste, dieselbe Suche wie die Karte); ein Treffer hängt an. „✕ Lösen“ legt die Zeile
 *   still, „⌕ Zuordnen“ öffnet die Suche für eine Zeile, die zu nichts passt (vorbelegt mit ihrem Namen); die Wahl ersetzt die Zeile (`medien-karte-orte-steuerung.ts`).
 * - **Zeilen:** Name (des Ziels, sonst der Rohname), darunter Art und Gruppe. Eine nicht aufgelöste Zeile steht kursiv da, mit dem Satz, warum die Karte in keiner Infobox steht.
 * - **„Auf Karte zeigen“** für Orte, Herrschaftsgebiete und Regionen, die nicht stillgelegt sind: Das Fenster geht zu, die Kamera fliegt hin, das Infopanel öffnet.
 * - **Ohne Recht oder an einem stillgelegten Eintrag** (`bearbeitbar` aus): dieselbe Liste nur lesend.
 */
const props = defineProps<{
    karte: MamKarteDetail;
    bearbeitbar: boolean;
    operationen: MedienOperationen;
    /** Nur Tests: eine eigene Suche. */
    optionen?: OrteOptionen | undefined;
}>();
const emit = defineEmits<{
    /** Eine Zeile hat sich geändert: Eintrag (Revision, Liste) neu lesen. */
    geaendert: [];
    aufKarte: [ziel: NonNullable<MamKarteOrt["target"]>];
}>();

const s = createOrteSteuerung(
    () => props.karte,
    props.operationen,
    () => emit("geaendert"),
    props.optionen,
);
const zeilen = computed(() => ortZeilen(props.karte.places));
const titel = computed(() =>
    zeilen.value.length > 0
        ? t("medien.karten.orteRegionen.titel", { n: formatNumber(zeilen.value.length, 0) })
        : t("medien.karten.abschnitt.orteRegionen"),
);
const anhaengenOffen = computed(() => s.modus.value?.art === "anhaengen");
const zuordnenKopf = computed(() => {
    const modus = s.modus.value;
    return modus?.art === "zuordnen"
        ? t("medien.karten.orteRegionen.zuordnenKopf", { name: modus.rohname })
        : undefined;
});
const zuKurz = computed(() => s.text.value.trim().length < ORTE_MIN_ZEICHEN);
const gesperrt = computed(() => (s.schreibt.value ? "" : undefined));
const schluessel = (treffer: OrtTreffer): string => `${treffer.kind}:${treffer.id}`;

// Öffnet „✚ Ort oder Region“ oder „⌕ Zuordnen“ die Suche, steht der Cursor gleich darin (wie im Entwurf); beim Zuordnen hinter dem vorbelegten Namen.
const suchfeld = useTemplateRef<InstanceType<typeof AvmEingabe>>("suchfeld");
watch(
    () => s.modus.value,
    async (modus, vorher) => {
        if (modus === undefined || modus === vorher) return;
        await nextTick();
        suchfeld.value?.focus();
    },
);
</script>

<template>
    <FensterKarte :titel="titel" data-testid="medien-kasten-orte">
        <template #etikett>
            <MedienKastenKnopf
                v-if="bearbeitbar"
                zeichen="✚"
                testid="medien-orte-neu"
                :aria-expanded="anhaengenOffen"
                @click="s.schalteAnhaengen()"
                >{{ t("medien.karten.orteRegionen.neu") }}</MedienKastenKnopf
            >
        </template>
        <div v-if="bearbeitbar && s.modus.value" class="orte__suche" data-testid="medien-orte-suche-box">
            <p v-if="zuordnenKopf" class="orte__kopf" data-testid="medien-orte-zuordnen-kopf">{{ zuordnenKopf }}</p>
            <AvmEingabe
                ref="suchfeld"
                v-model="s.text.value"
                art="suche"
                :placeholder="t('medien.karten.orteRegionen.suche')"
                :aria-label="t('medien.karten.orteRegionen.sucheBeschriftung')"
                :gesperrt="gesperrt"
                testid="medien-orte-suche"
            />
            <ul v-if="s.treffer.value.length > 0" class="orte__treffer" data-testid="medien-orte-treffer">
                <li v-for="treffer in s.treffer.value" :key="schluessel(treffer)">
                    <button
                        type="button"
                        class="orte__treffer-knopf"
                        :disabled="treffer.schon || s.schreibt.value"
                        data-testid="medien-orte-treffer-eins"
                        @click="void s.waehle(treffer)"
                    >
                        <span class="orte__text">
                            <span class="orte__name">{{ treffer.name }}</span>
                            <span class="orte__l2">{{
                                treffer.schon ? t("medien.karten.orteRegionen.schonAngehaengt") : treffer.zeile2
                            }}</span>
                        </span>
                    </button>
                </li>
            </ul>
            <p v-else-if="zuKurz" class="orte__l2" data-testid="medien-orte-zu-kurz">
                {{ t("medien.karten.orteRegionen.zweiBuchstaben") }}
            </p>
            <p v-else-if="s.laedt.value" class="orte__l2">{{ t("medien.treffer.laedt") }}</p>
            <p v-else class="orte__l2" data-testid="medien-orte-keiner">
                {{ t("medien.karten.orteRegionen.keinTreffer") }}
            </p>
            <AvmKnopf groesse="zeile" testid="medien-orte-abbrechen" class="orte__abbrechen" @click="s.schliesse()">{{
                t("medien.bearbeiten.abbrechen")
            }}</AvmKnopf>
        </div>

        <p v-if="zeilen.length === 0" class="orte__satz" data-testid="medien-orte-leer">
            {{ t("medien.karten.orteRegionen.leer") }}
        </p>
        <ul v-else class="orte__liste" data-testid="medien-karte-orte">
            <li
                v-for="zeile in zeilen"
                :key="zeile.index"
                class="orte__zeile"
                :class="{ 'orte__zeile--offen': !zeile.aufgeloest }"
                data-testid="medien-orte-zeile"
            >
                <span class="orte__text">
                    <span class="orte__name" data-testid="medien-orte-name">{{ zeile.name }}</span>
                    <span class="orte__l2" data-testid="medien-orte-l2">{{
                        zeile.zeile2 ?? t("medien.karten.ort.offen")
                    }}</span>
                    <span v-if="!zeile.aufgeloest" class="orte__warnung" data-testid="medien-orte-warnung">{{
                        t("medien.karten.orteRegionen.offenSatz")
                    }}</span>
                </span>
                <span class="orte__knoepfe">
                    <AvmKnopf
                        v-if="bearbeitbar && !zeile.aufgeloest"
                        art="gefuellt"
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :aria-label="t('medien.karten.orteRegionen.zuordnenFuer', { name: zeile.name })"
                        testid="medien-orte-zuordnen"
                        @click="s.ordneZuOeffnen(zeile.index)"
                    >
                        <template #zeichen>⌕</template>
                        {{ t("medien.karten.orteRegionen.zuordnen") }}
                    </AvmKnopf>
                    <AvmKnopf
                        v-if="zeile.aufKarte"
                        groesse="zeile"
                        testid="medien-karte-auf-karte"
                        @click="emit('aufKarte', zeile.aufKarte)"
                        >{{ t("medien.verwendung.aufKarte") }}</AvmKnopf
                    >
                    <AvmKnopf
                        v-if="bearbeitbar"
                        groesse="zeile"
                        :gesperrt="gesperrt"
                        :aria-label="t('medien.karten.orteRegionen.loesenFuer', { name: zeile.name })"
                        testid="medien-orte-loesen"
                        @click="void s.loese(zeile.index)"
                    >
                        <template #zeichen>✕</template>
                        {{ t("medien.karten.orteRegionen.loesen") }}
                    </AvmKnopf>
                </span>
            </li>
        </ul>
        <AvmHinweis v-if="s.fehler.value" ton="gefahr" rolle="alert" testid="medien-orte-fehler">{{
            s.fehler.value
        }}</AvmHinweis>
        <AvmHinweis v-if="s.hinweis.value" rolle="status" testid="medien-orte-hinweis">{{
            s.hinweis.value
        }}</AvmHinweis>
        <p class="orte__satz" data-testid="medien-orte-satz">{{ t("medien.karten.orteRegionen.satz") }}</p>
    </FensterKarte>
</template>

<style scoped>
.orte__suche {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.orte__abbrechen {
    align-self: flex-start;
}

.orte__kopf {
    margin: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
}

.orte__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.orte__treffer {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    list-style: none;
}

.orte__treffer li + li {
    border-top: 1px solid var(--color-divider);
}

.orte__treffer-knopf {
    display: flex;
    align-items: center;
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-4) var(--space-8);
    border: 0;
    background: transparent;
    color: var(--color-text);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.orte__treffer-knopf:hover:not(:disabled) {
    background: var(--color-hover-wash);
}

.orte__treffer-knopf:active:not(:disabled) {
    background: var(--color-active-wash);
}

.orte__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.orte__treffer-knopf:disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.orte__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

.orte__zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-6);
    min-width: 0;
}

.orte__zeile + .orte__zeile {
    margin-top: var(--space-6);
    padding-top: var(--space-6);
    border-top: 1px dashed var(--color-divider);
}

.orte__text {
    display: flex;
    flex: 1 1 160px;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.orte__name {
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
    overflow-wrap: anywhere;
}

.orte__zeile--offen .orte__name {
    font-style: italic;
}

.orte__l2 {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.orte__warnung {
    color: var(--color-warning);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.orte__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

@media (prefers-reduced-motion: reduce) {
    .orte__treffer-knopf {
        transition: none;
    }
}
</style>
