<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { t } from "../i18n/i18n";
import BearbeitungenSchliessenFenster from "./bearbeitungen-schliessen-fenster.vue";
import type { SchliessFrage } from "./fenster-verwaltung";
import type { Werkzeugfenster } from "./werkzeugfenster";

/**
 * „Offene Bearbeitungen“ im Editorpanel (WI-0128 E6; D15, D19; Betreiber 2026-10-10: „Die Buttons in ‚Offene Bearbeitungen‘ sollen
 * insgesamt anklickbar sein (wie items in einer taskleiste) um sie zu öffnen und mit einem X rechts, um sie zu schließen“).
 *
 * - Je abgelegtem Fenster eine Zeile: Titel, „ungespeichert“; die ganze Zeile holt es hervor (in seine letzte Lage), ✕ rechts
 *   schließt es. 🔴 ✕ verwirft nie ohne Frage: An einer Bearbeitung mit Änderungen fragt es „Trotzdem schließen?“, und erst „OK“
 *   verwirft (Betreiber 2026-10-19, WI-0231; `bearbeitungen-schliessen-fenster.vue`). Bis dahin tat es dort nichts, ohne ein Wort.
 * - Darunter „Alle schließen“ (schließt, was ohne Änderungen ist, und fragt EINMAL für alle Entwürfe) und „Alle speichern und
 *   schließen“ (mit dem Schreibweg, E11).
 * - 🔴 Die Fläche ist das Ablageziel (`data-fenster-ablage`): Ein gelöstes Fenster, das hier losgelassen wird, wird abgelegt. Seit
 *   2026-10-11 ist sie das EINZIGE im Editorpanel: Wer ein Fenster nach rechts zieht, will es andocken (Betreiber), das tut der
 *   rechte Rand. Liegt ein gezogenes Fenster über ihr, leuchtet sie (`data-fenster-ziel`, setzt die Hülle).
 */
const props = defineProps<{ fenster: Werkzeugfenster }>();

const zeilen = computed(() => props.fenster.abgelegt.value);
const offen = computed(() => props.fenster.stand.value.fenster.length);
/** Was gerade „Trotzdem schließen?“ fragt; ohne Frage `undefined`. */
const frage = shallowRef<SchliessFrage | undefined>(undefined);

function verwirf(ids: readonly string[]): void {
    for (const id of ids) props.fenster.verwirf(id);
}
</script>

<template>
    <section class="bearbeitungen" data-fenster-ablage data-testid="editor-panel-bearbeitungen">
        <h3 class="bearbeitungen__titel avm-versalmitte">
            {{ t("editorPanel.bearbeitungen") }}<span v-if="zeilen.length > 0"> ({{ zeilen.length }})</span>
        </h3>
        <p v-if="zeilen.length === 0" class="bearbeitungen__leer">{{ t("editorPanel.bearbeitungen.leer") }}</p>
        <ul v-else class="bearbeitungen__liste">
            <li v-for="eintrag in zeilen" :key="eintrag.id" class="bearbeitungen__zeile">
                <button
                    type="button"
                    class="bearbeitungen__knopf"
                    :title="t('editorPanel.bearbeitungen.hervorholen')"
                    :data-testid="`bearbeitung-${eintrag.id}`"
                    @click="fenster.hervorholen(eintrag.id)"
                >
                    <span class="bearbeitungen__name einzeilig">{{ eintrag.titel }}</span>
                    <span v-if="eintrag.ungespeichert" class="bearbeitungen__marke">
                        {{ t("editorPanel.bearbeitungen.ungespeichert") }}
                    </span>
                </button>
                <button
                    type="button"
                    class="bearbeitungen__zu"
                    :aria-label="t('editorPanel.bearbeitungen.schliessen')"
                    :title="t('editorPanel.bearbeitungen.schliessen')"
                    :data-testid="`bearbeitung-zu-${eintrag.id}`"
                    @click="frage = fenster.schliesseZeile(eintrag.id)"
                >
                    <span aria-hidden="true">✕</span>
                </button>
            </li>
        </ul>
        <div v-if="offen > 0" class="bearbeitungen__alle">
            <button
                type="button"
                class="bearbeitungen__link"
                data-testid="bearbeitungen-alle-zu"
                @click="frage = fenster.alleSchliessen()"
            >
                {{ t("editorPanel.bearbeitungen.alleSchliessen") }}
            </button>
            <button
                type="button"
                class="bearbeitungen__link"
                disabled
                :title="t('editorPanel.bearbeitungen.alleSpeichernSpaeter')"
                data-testid="bearbeitungen-alle-speichern"
            >
                {{ t("editorPanel.bearbeitungen.alleSpeichern") }}
            </button>
        </div>
        <BearbeitungenSchliessenFenster v-model:frage="frage" @verwirf="verwirf" />
    </section>
</template>

<style scoped>
.bearbeitungen {
    transition:
        border-color 120ms ease,
        background-color 120ms ease;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    /* Ein langer Titel kürzt sich in der Zeile, statt den Kasten und mit ihm das Panel zu verbreitern. */
    min-width: 0;
    padding: var(--space-6) var(--space-8);
    border: 1px dashed var(--color-border-strong);
    border-radius: var(--radius-md);
}

.bearbeitungen[data-fenster-ziel] {
    border-style: solid;
    border-color: var(--color-accent);
    background: var(--color-hover-wash);
}

.bearbeitungen__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.bearbeitungen__leer {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.bearbeitungen__liste {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Eine Zeile wie ein Eintrag einer Taskleiste: die ganze Fläche holt hervor, ✕ rechts schließt. */
.bearbeitungen__zeile {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
}

.bearbeitungen__knopf {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
    padding: var(--space-4) var(--space-8);
    border: 0;
    border-radius: var(--radius-md) 0 0 var(--radius-md);
    background: transparent;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.bearbeitungen__name {
    min-width: 0;
}

.bearbeitungen__marke {
    flex: none;
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-caption);
}

.bearbeitungen__zu {
    display: grid;
    flex: none;
    place-items: center;
    width: var(--avm-control-h);
    border: 0;
    border-left: 1px solid var(--color-divider);
    border-radius: 0 var(--radius-md) var(--radius-md) 0;
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    transition: background-color 120ms ease;
}

.bearbeitungen__knopf:hover,
.bearbeitungen__zu:hover {
    background: var(--color-hover-wash);
}

.bearbeitungen__knopf:active,
.bearbeitungen__zu:active {
    background: var(--color-active-wash);
}

.bearbeitungen__knopf:focus-visible,
.bearbeitungen__zu:focus-visible,
.bearbeitungen__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.bearbeitungen__alle {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
}

.bearbeitungen__link {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-small);
}

.bearbeitungen__link:hover {
    color: var(--color-link-hover);
}

.bearbeitungen__link:disabled {
    color: var(--color-disabled-text);
    cursor: default;
}

@media (prefers-reduced-motion: reduce) {
    .bearbeitungen,
    .bearbeitungen__knopf,
    .bearbeitungen__zu {
        transition: none;
    }
}
</style>
