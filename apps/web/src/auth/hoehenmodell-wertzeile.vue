<script setup lang="ts">
/**
 * Eine Zeile der Werte von „19 (Test)“ (WI-0240) in der Hausform der Wegfindung (Design Guide §8): Name, Feld im Goldenen Schnitt,
 * Einheit, ↺ am Zeilenende; darunter der Satz mit seiner Folge und, wo es etwas zu sagen gibt, „statt …“, „noch nicht gespeichert“ und
 * „Datei: …“. Das Grundmuster eines Gebirgstyps steht als Segmentschalter im selben Raster. Am Telefon steht der Name über dem Feld.
 */
import { GEBIRGS_MUSTER } from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmStatus from "../controls/avm-status.vue";
import { t } from "../i18n/i18n";
import type { TestZeile } from "./hoehenmodell-test";
import HoehenmodellVorschau from "./hoehenmodell-vorschau.vue";
import type { VorschauModell } from "./hoehenmodell-vorschau";
import type { ReglerHinweis } from "./hoehenmodell-regler";

const props = defineProps<{
    zeile: TestZeile;
    /** Gesperrt ohne eigenen Satz (der steht einmal oben): kein Recht, abgenommen oder ein Schreibweg läuft. */
    gesperrt: string | undefined;
    abgenommen: boolean;
    telefon: boolean;
    /** Die Vorschau neben dem Wert (WI-0249, Entwurf): nur einige Werte tragen eine. */
    vorschau?: VorschauModell | null | undefined;
    /** Die Zeilen eines Reglers der Gebirgs-Presets: wo er wirkt, der Vorschlag, Einzelwerte, die anders stehen (`hoehenmodell-regler.ts`). */
    hinweise?: readonly ReglerHinweis[] | undefined;
    /** Die Vorschau kleiner gezeichnet (die lange Liste „Alle Werte“). */
    kompakt?: boolean | undefined;
}>();
const emit = defineEmits<{ tippe: [text: string]; zurueck: [] }>();

const MUSTER = GEBIRGS_MUSTER.map((art) => ({ value: art, label: t(`landschaftseditor.gebirge.muster.${art}`) }));
</script>

<template>
    <div
        class="wertzeile"
        :class="{
            'is-geaendert': zeile.geaendert,
            'wertzeile--muster': zeile.muster,
            'wertzeile--telefon': props.telefon,
        }"
        :data-testid="`hoehenmodell-test-${zeile.key}`"
    >
        <span class="wertzeile__name">{{ zeile.name }}</span>
        <span class="wertzeile__feld">
            <AvmSegmente
                v-if="zeile.muster"
                :model-value="zeile.feld"
                :options="MUSTER.map((m) => ({ ...m, gesperrt: props.gesperrt !== undefined }))"
                :label="zeile.lang"
                :testid="`hoehenmodell-test-feld-${zeile.key}`"
                @update:model-value="emit('tippe', $event)"
            />
            <AvmEingabe
                v-else
                :model-value="zeile.feld"
                :gesperrt="props.gesperrt"
                :ungueltig="zeile.problem !== undefined"
                :aria-label="zeile.lang"
                inputmode="decimal"
                autocomplete="off"
                :testid="`hoehenmodell-test-feld-${zeile.key}`"
                @update:model-value="emit('tippe', $event)"
            />
        </span>
        <span v-if="!zeile.muster" class="wertzeile__einheit">{{ zeile.einheit }}</span>
        <AvmKnopf
            art="weich"
            groesse="zeile"
            class="wertzeile__zurueck"
            :gesperrt="zeile.ruecksetzbar && props.gesperrt === undefined ? undefined : ''"
            :title="
                zeile.ruecksetzbar
                    ? t('admin.terrain.test.row.resetTo', { wert: zeile.dateiText })
                    : props.abgenommen
                      ? t('admin.terrain.test.row.locked')
                      : t('admin.terrain.test.row.resetResting')
            "
            :aria-label="t('admin.terrain.test.row.resetLabel', { name: zeile.lang })"
            :testid="`hoehenmodell-test-zurueck-${zeile.key}`"
            @click="emit('zurueck')"
        >
            <span aria-hidden="true">↺</span>
        </AvmKnopf>
        <p class="wertzeile__satz">
            {{ zeile.satz }} <span class="wertzeile__folge">{{ zeile.folge }}</span>
        </p>
        <p v-if="zeile.problem !== undefined || zeile.statt !== null || zeile.datei !== null" class="wertzeile__unten">
            <span v-if="zeile.problem !== undefined" class="wertzeile__problem">{{ zeile.problem }}</span>
            <template v-if="zeile.statt !== null">
                <span>{{ zeile.statt }}</span>
                <span class="wertzeile__offen" :data-testid="`hoehenmodell-test-offen-${zeile.key}`">{{
                    t("admin.terrain.test.row.unsaved")
                }}</span>
            </template>
            <span v-if="zeile.datei !== null">{{ zeile.datei }}</span>
            <AvmStatus
                v-if="zeile.datei !== null && zeile.statt === null"
                ton="warnung"
                :text="t('admin.wegfindung.deviating')"
            />
        </p>
        <p v-if="props.hinweise && props.hinweise.length > 0" class="wertzeile__hinweise">
            <span
                v-for="hinweis in props.hinweise"
                :key="hinweis.art"
                class="wertzeile__hinweis"
                :class="`wertzeile__hinweis--${hinweis.art}`"
                :data-testid="`hoehenmodell-test-hinweis-${hinweis.art}-${zeile.key}`"
                >{{ hinweis.text }}</span
            >
        </p>
        <HoehenmodellVorschau
            v-if="props.vorschau"
            :modell="props.vorschau"
            :gesperrt="props.gesperrt"
            :telefon="props.telefon"
            :kompakt="props.kompakt"
            @tippe="emit('tippe', $event)"
        />
    </div>
</template>

<style scoped>
/*
 * Das Feld beginnt in JEDER Zeile an derselben Stelle: im Goldenen Schnitt der Säule (Hausform der Wegfindung, Betreiber 2026-10-15).
 * Darum feste Spalten, auch für die Einheit.
 */
.wertzeile {
    display: grid;
    grid-template-columns: minmax(0, 61.8%) 96px minmax(92px, 1fr) var(--space-24);
    gap: var(--space-2) var(--space-6);
    align-items: center;
    min-width: 0;
}

/* Das Grundmuster nimmt Feld und Einheit zusammen: zwei Segmente brauchen mehr als ein Zahlenfeld. */
.wertzeile--muster .wertzeile__feld {
    grid-column: 2 / 4;
}

.wertzeile__name {
    min-width: 0;
}

.wertzeile.is-geaendert .wertzeile__name {
    color: var(--color-accent-strong);
}

.wertzeile__feld {
    display: flex;
    min-width: 0;
}

.wertzeile__feld :deep(.eingabe-huelle),
.wertzeile__feld :deep(.eingabe),
.wertzeile__feld :deep(.segmente) {
    width: 100%;
}

.wertzeile__einheit {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.wertzeile__satz {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Was eine Änderung nach sich zieht: Jede rechnet die Karte neu, das kostet einen Lauf und steht in der Akzentfarbe. */
.wertzeile__folge,
.wertzeile__offen {
    color: var(--color-accent-strong);
}

.wertzeile__unten {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wertzeile__unten :deep(.status) {
    font-size: var(--font-size-small);
}

.wertzeile__hinweise {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der Vorschlag soll auffallen: Er stellt zwei Werte gleich, die das Preset heute getrennt führt. */
.wertzeile__hinweis--vorschlag {
    color: var(--color-accent-strong);
}

.wertzeile__problem {
    color: var(--color-danger-soft-text);
}

/* Rücksetzen: quadratisch und so hoch wie das Feld; auf der Datei ist das Zeichen still, aber lesbar. */
.wertzeile__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.wertzeile__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

/* Telefon: der Name über dem Feld, sonst blieben ihm wenige Pixel; die Einheit fest breit, damit jedes Feld gleich lang ist. */
.wertzeile--telefon {
    grid-template-columns: minmax(0, 1fr) 7.5rem var(--space-24);
}

.wertzeile--telefon .wertzeile__einheit {
    white-space: normal;
}

.wertzeile--telefon .wertzeile__name {
    grid-column: 1 / -1;
}

.wertzeile--telefon.wertzeile--muster .wertzeile__feld {
    grid-column: 1 / 3;
}
</style>
