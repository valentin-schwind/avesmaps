<script setup lang="ts">
import { computed } from "vue";
import type { InhalteKorpusWirkung, InhalteLizenz } from "@avesmaps3d/shared";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { vorgabeName, vorgabeWertText } from "./inhalte-korpora-texte";

/**
 * Die Wirkung einer Änderung am Korpus (WI-0254, Runde 4; Mockup „Wirkung auf alle Korpusquellen“): je Feld der Vorgabe, wie viele Quellen der Domain sich
 * ändern und wie viele davon heute eine andere Angabe tragen, die überschrieben wird. Sie steht unter „Wirkung prüfen“ in der Mitte und, als Teil der
 * Frage, wenn die Änderung ab zehn Quellen trifft. Der Block liest nur; gerechnet hat sie der Server (`korpusWirkung`, schreibt nichts).
 *
 * - Bei Werk und unentschiedener Form schreibt nichts durch: Der Block sagt es und zählt nichts.
 * - „Nichts ändert sich“ heißt: Jede Quelle trägt die Vorgabe schon.
 */
const props = defineProps<{
    wirkung: InhalteKorpusWirkung;
    lizenzen: readonly InhalteLizenz[];
    testid?: string | undefined;
}>();

const zeilen = computed(() =>
    props.wirkung.felder.map((feld) => ({
        feld: feld.feld,
        name: vorgabeName(feld.feld),
        wert: vorgabeWertText(feld.feld, feld.wert, props.lizenzen),
        aendern: feld.aendern,
        ueberschreibt: feld.ueberschreibt,
    })),
);
const zahl = (n: number): string => formatNumber(n, 0);
const satz = (schluessel: MessageKey, n: number): string => t(schluessel, { n: zahl(n) });
</script>

<template>
    <div class="wirkung" :data-testid="testid ?? 'inhalte-korpora-wirkung'">
        <p class="wirkung__titel">{{ t("inhalte.korpora.wirkung.titel") }}</p>
        <p v-if="!wirkung.schreibtDurch" class="wirkung__satz" data-testid="inhalte-korpora-wirkung-keine">
            {{ t("inhalte.korpora.wirkung.keineDurchschrift") }}
        </p>
        <dl class="wirkung__raster">
            <dt>{{ t("inhalte.korpora.wirkung.quellen") }}</dt>
            <dd data-testid="inhalte-korpora-wirkung-quellen">{{ zahl(wirkung.quellenGesamt) }}</dd>
            <dt>{{ t("inhalte.korpora.wirkung.traeger") }}</dt>
            <dd data-testid="inhalte-korpora-wirkung-traeger">{{ zahl(wirkung.traegerGesamt) }}</dd>
            <template v-if="wirkung.schreibtDurch">
                <dt>{{ t("inhalte.korpora.wirkung.aendern") }}</dt>
                <dd data-testid="inhalte-korpora-wirkung-aendern">{{ zahl(wirkung.aendernGesamt) }}</dd>
            </template>
        </dl>
        <ul v-if="zeilen.length > 0" class="wirkung__felder">
            <li v-for="zeile in zeilen" :key="zeile.feld" :data-feld="zeile.feld">
                <span class="wirkung__feld">{{ zeile.name }} → {{ zeile.wert }}</span>
                <span class="wirkung__zahlen">
                    {{ satz("inhalte.korpora.wirkung.feld.aendern", zeile.aendern) }}
                    <template v-if="zeile.ueberschreibt > 0">
                        · {{ satz("inhalte.korpora.wirkung.feld.ueberschreibt", zeile.ueberschreibt) }}
                    </template>
                </span>
            </li>
        </ul>
        <p
            v-else-if="wirkung.schreibtDurch && wirkung.aendernGesamt === 0"
            class="wirkung__satz"
            data-testid="inhalte-korpora-wirkung-nichts"
        >
            {{ t("inhalte.korpora.wirkung.nichts") }}
        </p>
    </div>
</template>

<style scoped>
.wirkung {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.wirkung__titel {
    margin: 0;
    color: var(--color-accent-brown);
    font-size: var(--font-size-small);
}

.wirkung__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wirkung__raster {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: var(--space-4) var(--space-12);
    margin: 0;
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-divider);
    font-size: var(--font-size-small);
}

.wirkung__raster dt {
    color: var(--color-text-muted);
}

.wirkung__raster dd {
    margin: 0;
    color: var(--color-text-strong);
    font-variant-numeric: tabular-nums;
    text-align: right;
}

.wirkung__felder {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: var(--space-6) 0 0;
    border-top: 1px solid var(--color-divider);
    list-style: none;
}

.wirkung__felder li {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.wirkung__feld {
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    overflow-wrap: anywhere;
}

.wirkung__zahlen {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}
</style>
