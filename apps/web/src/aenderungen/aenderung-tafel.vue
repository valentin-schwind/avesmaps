<script setup lang="ts">
import { formatNumber, t } from "../i18n/i18n";
import type { TafelGegenstand } from "./aenderung-tafel";
import AenderungWechsel from "./aenderung-wechsel.vue";

/**
 * Die Tafel eines Details (WI-0265 B10; Vorlage `review/wi-0265/aenderungen-neu.html`): je Gegenstand eine Kopfzeile (Art als Etikett, Name) und darunter jedes Feld als „Feld · − vorher · + nachher“
 * (`aenderung-wechsel.vue`). Gegenstände trennt eine feine Linie, keine Kästen. Bei vielen Gegenständen die ersten fünf, dann „n weitere ▸“.
 * Die Liste der Felder heißt `verlauf__felder` auch hier: Die Browsertests der Editoren lesen sie unter diesem Namen.
 */
defineProps<{
    /** Die Gegenstände, die zu sehen sind (der Aufrufer schneidet: `sichtbareGegenstaende`). */
    gegenstaende: readonly TafelGegenstand[];
    /** Wie viele weitere es gäbe. */
    weitere: number;
}>();
defineEmits<{ mehr: [] }>();
</script>

<template>
    <div class="tafel">
        <section v-for="gegenstand in gegenstaende" :key="gegenstand.schluessel" class="tafel__gegenstand">
            <p v-if="gegenstand.art || gegenstand.name" class="tafel__kopf">
                <span v-if="gegenstand.art" class="tafel__art">{{ gegenstand.art }}</span>
                <span class="tafel__name einzeilig">{{ gegenstand.name ?? "–" }}</span>
                <span v-if="gegenstand.revision" class="tafel__revision">{{ gegenstand.revision }}</span>
            </p>
            <dl v-if="gegenstand.zeilen.length > 0" class="tafel__felder verlauf__felder">
                <div v-for="zeile in gegenstand.zeilen" :key="zeile.feld" class="tafel__zeile">
                    <dt :title="zeile.schluessel">{{ zeile.bezeichnung }}</dt>
                    <dd>
                        <AenderungWechsel
                            :vorher="zeile.vorher"
                            :nachher="zeile.nachher"
                            :form-fehlt="zeile.formFehlt"
                            :laedt="zeile.laedt"
                            :hinweis="zeile.hinweis"
                        />
                    </dd>
                </div>
            </dl>
        </section>
        <button
            v-if="weitere > 0"
            type="button"
            class="tafel__weitere"
            data-testid="aenderung-tafel-weitere"
            @click="$emit('mehr')"
        >
            {{ t("aenderungen.detail.weitere", { n: formatNumber(weitere, 0) }) }}
            <span aria-hidden="true">▸</span>
        </button>
    </div>
</template>

<style scoped>
.tafel {
    display: grid;
    gap: var(--space-4);
    min-width: 0;
}

.tafel__gegenstand {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
}

.tafel__gegenstand + .tafel__gegenstand {
    padding-top: var(--space-4);
    border-top: 1px solid var(--color-divider);
}

.tafel__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    margin: 0;
}

.tafel__art {
    display: inline-flex;
    flex: none;
    align-items: center;
    height: 18px;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-pill-border);
    border-radius: var(--radius-md);
    background: var(--color-pill);
    color: var(--color-pill-text);
    font-size: var(--font-size-caption);
    line-height: 1;
}

.tafel__name {
    min-width: 0;
    color: var(--color-text-strong);
}

.tafel__revision {
    flex: none;
    color: var(--color-text-muted);
}

.tafel__felder {
    display: grid;
    margin: 0;
}

.tafel__zeile {
    display: grid;
    grid-template-columns: minmax(4.2rem, 7.2rem) minmax(0, 1fr);
    gap: var(--space-4) var(--space-8);
    padding: var(--space-2) 0;
    border-top: 1px dashed var(--color-divider);
}

.tafel__zeile:first-child {
    border-top: 0;
}

.tafel__zeile dt {
    color: var(--color-text-muted);
}

.tafel__zeile dd {
    min-width: 0;
    margin: 0;
}

.tafel__weitere {
    justify-self: start;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
}

.tafel__weitere:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.tafel__weitere:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}
</style>
