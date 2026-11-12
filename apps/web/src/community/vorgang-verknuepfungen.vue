<script setup lang="ts">
import { computed } from "vue";
import type { VorgangDetail } from "@avesmaps3d/shared";
import { springeZuAenderungen } from "../aenderungen/sprung";
import { openAuthWindow } from "../auth/auth-windows";
import AvmPille from "../controls/avm-pille.vue";
import { t } from "../i18n/i18n";
import { redaktion } from "./redaktion";
import { darfInAenderungen, darfInKanal, korrekturZeile } from "./verknuepfen-modell";

/**
 * Die Kästen „Korrektur“ und „Betreiber-Kanal“ im Rumpf eines Vorgangs (WI-0268 C7; Fachkonzept WI-0263 §6 und §7). Jeder steht nur, wenn es etwas zu zeigen gibt.
 *
 * - **Korrektur:** die Änderungen an der Karte, die zu diesem Vorgang gehören, neueste zuerst: was geschah, wann, durch wen, und ob der Editor den Vorgang als Herkunft mitschrieb („aus dem Editor“) oder
 *   jemand es von Hand verknüpfte. Der Name führt nach „Änderungen“ (`springeZuAenderungen`, der Weg des Objektverlaufs), wenn die Sitzung das Editorpanel hat; sonst ist er Text.
 * - **Betreiber-Kanal:** die OPS-Nummern, unter denen der Vorgang weitergereicht wurde. Die Nummer öffnet den Vorgang im Kanal (`openAuthWindow`, wie in der Glocke), wenn die Sitzung den Kanal benutzen darf;
 *   sonst ist sie Text. Zwei Umgebungen, keine Datenbankverbindung: Es steht nur die Nummer da.
 */
const props = defineProps<{
    detail: VorgangDetail;
    /** Die Rechte der Sitzung. */
    rechte: readonly string[];
}>();

const zeilen = computed(() => (props.detail.korrekturen ?? []).map((korrektur) => korrekturZeile(korrektur)));
const kanal = computed(() => props.detail.kanal ?? []);
const inAenderungen = computed(() => darfInAenderungen(props.rechte, redaktion.verbunden.value));
const imKanal = computed(() => darfInKanal(props.rechte));

const zeigeInAenderungen = (operationId: string): void => springeZuAenderungen({ operationId });
const oeffneKanal = (ops: string): void => openAuthWindow({ name: "systemsteuerung", eintrag: "claudio", ops });
</script>

<template>
    <section v-if="zeilen.length > 0" class="kasten" data-testid="community-vorgang-korrektur">
        <h3 class="kasten__kopf avm-versalmitte">{{ t("community.korrektur.kasten") }}</h3>
        <ul class="liste">
            <li
                v-for="zeile in zeilen"
                :key="zeile.operationId"
                class="zeile"
                :data-testid="`community-vorgang-korrektur-${zeile.operationId}`"
            >
                <button
                    v-if="inAenderungen"
                    type="button"
                    class="verweis"
                    :title="t('community.korrektur.zeigen')"
                    :data-testid="`community-vorgang-korrektur-zeigen-${zeile.operationId}`"
                    @click="zeigeInAenderungen(zeile.operationId)"
                >
                    {{ zeile.titel }}
                </button>
                <span v-else class="zeile__titel">{{ zeile.titel }}</span>
                <span v-if="zeile.satz !== undefined" class="leise">{{ zeile.satz }}</span>
                <span class="leise">{{ zeile.wann }}</span>
                <AvmPille v-if="zeile.weg !== undefined">{{ zeile.weg }}</AvmPille>
            </li>
        </ul>
    </section>

    <section v-if="kanal.length > 0" class="kasten" data-testid="community-vorgang-kanal">
        <h3 class="kasten__kopf avm-versalmitte">{{ t("community.kanal.kasten") }}</h3>
        <p v-for="eintrag in kanal" :key="eintrag.nummer" class="zeile">
            <span class="leise">{{ t("community.kanal.weitergereichtAls") }}</span>
            <button
                v-if="imKanal"
                type="button"
                class="verweis"
                :title="t('community.kanal.oeffnen', { ops: eintrag.nummer })"
                :data-testid="`community-vorgang-kanal-${eintrag.nummer}`"
                @click="oeffneKanal(eintrag.nummer)"
            >
                {{ eintrag.nummer }}
            </button>
            <span v-else :data-testid="`community-vorgang-kanal-${eintrag.nummer}`">{{ eintrag.nummer }}</span>
        </p>
    </section>
</template>

<style scoped>
.kasten {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.kasten p {
    margin: 0;
}

.kasten__kopf {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.zeile {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--space-2) var(--space-6);
    color: var(--color-text);
    overflow-wrap: anywhere;
}

.zeile__titel {
    color: var(--color-text-strong);
}

.leise {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Ein Name, der in „Änderungen“ oder in den Kanal führt: ein Verweis im Fließtext, kein Knopf (Zustände nach Guide §30.5). */
.verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    text-decoration: underline;
    transition: color 120ms ease;
}

.verweis:hover,
.verweis:active {
    color: var(--color-link-hover);
}

.verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

@media (prefers-reduced-motion: reduce) {
    .verweis {
        transition: none;
    }
}
</style>
