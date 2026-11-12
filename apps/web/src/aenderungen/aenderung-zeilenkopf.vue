<script setup lang="ts">
import { computed } from "vue";
import AenderungKreis from "./aenderung-kreis.vue";
import type { ZeilenAngaben } from "./aenderung-zeile-modell";

/**
 * Der Inhalt einer Zeile von „Änderungen“ (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): HÖCHSTENS ZWEI ZEILEN, alle gleich gebaut, in der Liste des Reiters und im Verlauf eines Objekts.
 *
 * - **Zeile 1:** der Kreis (der Zustand allein, ein Wortschatz im Tooltip), der Titel mit Auslassung, die Uhrzeit.
 * - **Zeile 2:** Person, Quelle (ein Etikett, nur wenn nicht der Editor), Felder in einer Zeile mit Auslassung, „n Objekte“ nur bei mehr als einem; am Ende ▸ (zu, offen gedreht).
 *   Keine Pille, keine Kennung, keine Silbentrennung: Die Kennung steht im Detail.
 * - Der Kopf zeichnet nur den Inhalt. Wer ihn trägt (der Knopf der Liste, das `summary` des Verlaufs), gibt ihm die Fläche; ⊕ und ↺ liegen über dem Zeilenende und brauchen darin Platz (`platzOrt`, `platzRueck`).
 * - **Einzeilig** (`einzeilig`) ist die gedämpfte Zeile eines Bündels: Zustand, Titel, ▸.
 */
const props = defineProps<{
    angaben: ZeilenAngaben;
    offen: boolean;
    /** Am Zeilenende liegt ⊕. */
    platzOrt?: boolean | undefined;
    /** Am Zeilenende liegt, beim Überfahren, ↺. */
    platzRueck?: boolean | undefined;
    /** Was ⊕ kurz sagt („Keine Lage bekannt“). */
    status?: string | undefined;
    einzeilig?: boolean | undefined;
}>();

interface Teil {
    readonly art: "person" | "fix" | "etikett" | "felder" | "status";
    readonly text: string;
}
const teile = computed<Teil[]>(() => {
    const a = props.angaben;
    const raus: Teil[] = [];
    if (a.person) raus.push({ art: "person", text: a.person });
    if (a.bereich) raus.push({ art: "fix", text: a.bereich });
    if (a.etikett) raus.push({ art: "etikett", text: a.etikett });
    if (a.felder) raus.push({ art: "felder", text: a.felder });
    if (a.hinweis) raus.push({ art: "fix", text: a.hinweis });
    if (a.objekte) raus.push({ art: "fix", text: a.objekte });
    if (props.status) raus.push({ art: "status", text: props.status });
    return raus;
});
</script>

<template>
    <span class="zk" :class="{ 'zk--einzeilig': einzeilig, 'is-offen': offen }">
        <span class="zk__kreis" data-testid="aenderung-status">
            <AenderungKreis v-if="angaben.kreis" :kreis="angaben.kreis" :name="angaben.kreisName" />
        </span>
        <span class="zk__titel einzeilig" :title="angaben.titel">{{ angaben.titel }}</span>
        <time v-if="angaben.zeit" class="zk__zeit">{{ angaben.zeit }}</time>
        <span v-if="!einzeilig" class="zk__meta">
            <template v-for="(teil, i) in teile" :key="`${teil.art}-${i}`">
                <span v-if="i > 0" class="zk__sep" aria-hidden="true">·</span>
                <span v-if="teil.art === 'person'" class="zk__person einzeilig" :title="teil.text">{{
                    teil.text
                }}</span>
                <span v-else-if="teil.art === 'status'" class="zk__fix" role="status">{{ teil.text }}</span>
                <span v-else-if="teil.art === 'etikett'" class="zk__etikett">{{ teil.text }}</span>
                <span v-else-if="teil.art === 'felder'" class="zk__felder einzeilig" :title="teil.text">{{
                    teil.text
                }}</span>
                <span v-else class="zk__fix">{{ teil.text }}</span>
            </template>
            <span v-if="platzRueck" class="zk__platz zk__platz--rueck" aria-hidden="true"></span>
            <span v-if="platzOrt" class="zk__platz zk__platz--ort" aria-hidden="true"></span>
            <span class="zk__pfeil" aria-hidden="true"></span>
        </span>
        <template v-else>
            <span v-if="platzOrt" class="zk__platz zk__platz--ort zk__platz--eins" aria-hidden="true"></span>
            <span class="zk__pfeil zk__pfeil--eins" aria-hidden="true"></span>
        </template>
    </span>
</template>

<style scoped>
.zk {
    display: grid;
    grid-template-columns: var(--avm-kreis) minmax(0, 1fr) auto;
    align-items: center;
    column-gap: var(--space-6);
    row-gap: 1px;
    width: 100%;
    min-width: 0;
}

.zk--einzeilig {
    grid-template-columns: var(--avm-kreis) minmax(0, 1fr) auto auto;
}

.zk__kreis {
    display: inline-flex;
    grid-column: 1;
    grid-row: 1;
}

.zk__titel {
    grid-column: 2;
    grid-row: 1;
    color: var(--color-text-strong);
    line-height: 1.4;
}

.zk--einzeilig .zk__titel {
    color: var(--color-text-muted);
}

.zk__zeit {
    grid-column: 3;
    grid-row: 1;
    justify-self: end;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
}

.zk__meta {
    display: flex;
    grid-column: 2 / 4;
    grid-row: 2;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: 1.4;
}

.zk__fix,
.zk__sep {
    flex: none;
    white-space: nowrap;
}

.zk__felder {
    flex: 0 1 auto;
    min-width: 0;
}

/* Die Person kürzt sich wie die Felder: Ein Agent steht mit seiner Freigabe da („claudio (Freigabe: …)“), und dieser Satz ist
   lang. Ohne Kürzung schob er die Zeile und mit ihr die ganze Liste über den Rand (Vali 2026-11-09, Production). Der volle Text
   steht im Tooltip. */
.zk__person {
    flex: 0 1 auto;
    min-width: 0;
}

/* Das Etikett der Quelle: keine Pille (die Pille ist ein Zustand), sondern die Pillenfläche im Maß der Zeile. */
.zk__etikett {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 16px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    line-height: 1;
    white-space: nowrap;
}

/* Platz für ⊕ und ↺, die über dem Zeilenende liegen: Der Text läuft nicht darunter. Das erste Platzhalterstück schiebt den Rest ans Ende. */
.zk__platz {
    flex: none;
}

.zk__platz--rueck {
    width: 24px;
    margin-left: auto;
}

.zk__platz--ort {
    width: 22px;
    margin-left: auto;
}

.zk__platz--rueck + .zk__platz--ort,
.zk__platz--rueck + .zk__pfeil,
.zk__platz--ort + .zk__pfeil {
    margin-left: 0;
}

.zk__platz--eins {
    grid-column: 3;
    grid-row: 1;
}

.zk__pfeil {
    flex: none;
    width: 0;
    height: 0;
    margin-left: auto;
    border-style: solid;
    border-width: 4px 0 4px 6px;
    border-color: transparent transparent transparent var(--color-text-muted);
    transition: transform 120ms ease;
}

.zk__pfeil--eins {
    grid-column: 4;
    grid-row: 1;
    margin-left: 0;
}

.zk.is-offen .zk__pfeil {
    transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
    .zk__pfeil {
        transition: none;
    }
}
</style>
