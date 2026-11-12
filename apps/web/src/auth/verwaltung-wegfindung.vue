<script setup lang="ts">
/**
 * Der Eintrag „Wegfindung“ der Systemsteuerung (WI-0153, Blatt `review/wi-0153/blatt.png`, abgenommen 2026-10-15;
 * Design Guide §8 „Seiten mit vielen Einstellungen“). Was die Oberfläche rechnet, steht in `wegfindung.ts`; hier steht nur,
 * wie es aussieht.
 *
 * Die Form, Zug um Zug abgenommen:
 *
 * - **Drei Panele** mit festen Namen, unter jeder Überschrift EINE ruhige Zeile, wann die Werte greifen.
 * - **Zwei Säulen je Panel**, je Zeile Name, Feld, Einheit und das Rücksetzzeichen ↺ in einer Reihe, der Satz darunter.
 *   Unter 900 px fallen die Säulen untereinander.
 * - 🔴 **Das Feld beginnt in jeder Zeile an derselben Stelle: im Goldenen Schnitt der Säule (61,8 %)**, bei festen
 *   Spaltenbreiten. 🪤 Eine Einheitenspalte auf `auto` wäre je Zeile anders breit, und weil jede Zeile ihr eigenes Raster
 *   ist, wanderte das Feld mit.
 * - **Kein Kreis vor dem Namen** (Betreiber: „die grünen punkte kannst du weglassen“): In dieser Liste trägt er keine
 *   Auskunft. Was sich unterscheidet, steht da — die Zeile „statt 0,02“ und das wache Rücksetzzeichen.
 * - **An JEDER Zeile steht, was eine Änderung nach sich zieht**, und was einen Lauf kostet, steht in der Akzentfarbe.
 * - **Ein Auslöser, und er steht oben** (Schnitt 6). Er speichert nichts, er GIBT FREI: Der gespeicherte Stand wird der
 *   gerechnete, `routing_reload` kommt in die Warteschlange, und die Leiste zeigt dessen Zustand mit dem Wort der
 *   Warteschlange (`status.state.*`) und dem Kreis des Hauses. Wach ist er, solange sich gespeichert und gerechnet
 *   unterscheiden; sind sie gleich, ruht er mit seinem Grund.
 * - 🔴 **Wer speichert und nie freigibt, ändert nichts an der Wegfindung**: Sie rechnet mit dem freigegebenen Stand
 *   weiter. Das steht in der Leiste UND in der Zeile selbst („noch nicht gerechnet, es gilt 0,02“), nicht nur im Bauplan.
 */
import { computed, onMounted, ref } from "vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmStatus from "../controls/avm-status.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import { t } from "../i18n/i18n";
import { authState } from "./session-state";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";
import { leiste, panele, type Wegfindung, type WegfindungZeile } from "./wegfindung";

const props = defineProps<{
    wegfindung: Wegfindung;
    telefon: boolean;
}>();

const darf =
    authState.value.capabilities.includes("manage_system_settings") ||
    authState.value.capabilities.includes("manage_routing");
const h = props.wegfindung;
const jetzt = ref(new Date());
onMounted(() => {
    jetzt.value = new Date();
    void h.load();
});

const stand = computed(() => h.stand.value);
const sicht = computed(() => panele(stand.value, jetzt.value));
/**
 * Alles, was die Leiste oben sagt: die Zahl der offenen Werte (gespeichert ≠ gerechnet), die Sätze dazu und der
 * Zustand des eingereihten Auftrags. Gerechnet wird das in `wegfindung.ts`, damit es ohne Browser prüfbar bleibt.
 */
const oben = computed(() => leiste(stand.value, jetzt.value));
/** Gesperrt ohne eigenen Satz (der steht einmal oben), während ein Schreibweg läuft oder solange die Tafel fehlt. */
const gesperrt = computed(() =>
    !darf || h.busy.value !== null || h.freigebend.value || stand.value?.source !== "database" ? "" : undefined,
);
/**
 * Warum der Knopf oben ruht, als Satz im `title` — oder `undefined`, wenn er wach ist. 🪜 Der Grund gehört NICHT in
 * `gesperrt`: Dort würde er als sichtbarer Text im Knopf landen (`AvmKnopf`).
 */
const knopfRuht = computed(() => {
    // 🔴 Kurze Gründe: Der lange Satz zum Recht und zur fehlenden Tafel steht schon als eigene Zeile oben.
    if (!darf) return t("admin.wegfindung.bar.needsRight");
    if (stand.value?.source !== "database") return t("admin.wegfindung.bar.noTable");
    if (h.busy.value !== null || h.freigebend.value) return t("admin.wegfindung.bar.running");
    if (!oben.value.wach) return t("admin.wegfindung.bar.nothing");
    return undefined;
});
const feld = (zeile: WegfindungZeile): string => h.felder.value[zeile.wert.id] ?? zeile.text;
const problem = (zeile: WegfindungZeile) => h.probleme.value[zeile.wert.id];
const meldung = (zeilen: readonly WegfindungZeile[]) => {
    const letzte = h.ergebnis.value;
    return letzte !== null && zeilen.some((zeile) => zeile.wert.id === letzte.id) ? letzte.result : undefined;
};
</script>

<template>
    <div class="wegfindung" :class="{ 'wegfindung--telefon': props.telefon }" data-testid="wegfindung">
        <VerwaltungLadeproblem
            :problems="h.loadProblems.value"
            :fehlt="h.unconfirmed.value"
            testid="wegfindung-ladefehler"
            @bestaetigen="h.confirmAgain()"
            ><span>{{ t("admin.wegfindung.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="wegfindung__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null">
            <AvmHinweis>
                <strong class="wegfindung__erst">{{ t("admin.wegfindung.leadFirst") }}</strong>
                {{ " " }}{{ t("admin.wegfindung.lead") }}
            </AvmHinweis>
            <p v-if="stand.source !== 'database'" class="wegfindung__warnung" data-testid="wegfindung-quelle">
                {{ t("admin.wegfindung.source.unprovisioned") }}
            </p>
            <p v-if="!darf" class="wegfindung__leise" data-testid="wegfindung-nur-lesen">
                {{ t("admin.wegfindung.readOnly", { recht: t("auth.capability.manage_system_settings") }) }}
            </p>
            <p v-if="stand.unknownKeys.length > 0" class="wegfindung__warnung" data-testid="wegfindung-unbekannt">
                {{ t("admin.wegfindung.unknownKeys", { keys: stand.unknownKeys.join(", ") }) }}
            </p>

            <!-- Die Leiste ganz oben: links der Zustand, rechts der EINE Auslöser. -->
            <div class="wegfindung__netz" data-testid="wegfindung-netz">
                <div class="wegfindung__stand">
                    <span :class="{ wegfindung__offen: oben.offen > 0 }" data-testid="wegfindung-offen">{{
                        oben.satz
                    }}</span>
                    <!-- Wer speichert und nie freigibt: Die Wegfindung rechnet mit dem freigegebenen Stand weiter. -->
                    <span v-if="oben.bleibt !== null" data-testid="wegfindung-bleibt">{{ oben.bleibt }}</span>
                    <span v-if="oben.kosten !== null">{{ oben.kosten }}</span>
                    <!--
                        Der Seegraph (WI-0153 7b; Betreiber 2026-10-18: über den einen Knopf): veraltet weckt er den Knopf, und was die
                        Ableitung kostet, steht dabei; wartet oder läuft sie schon, steht sie mit Wort und Kreis da.
                    -->
                    <span v-if="oben.seeSatz !== null" class="wegfindung__offen" data-testid="wegfindung-seegraph">{{
                        oben.seeSatz
                    }}</span>
                    <span v-if="oben.seeKosten !== null" data-testid="wegfindung-seegraph-kosten">{{
                        oben.seeKosten
                    }}</span>
                    <span
                        v-if="oben.seeAuftrag !== null"
                        class="wegfindung__auftrag"
                        data-testid="wegfindung-seegraph-auftrag"
                    >
                        <AvmKreis :fuellung="oben.seeAuftrag.fuellung" :name="oben.seeAuftrag.text" />
                        <span>{{ t("admin.wegfindung.bar.seaJob", { state: oben.seeAuftrag.text }) }}</span>
                    </span>
                    <span v-if="oben.freigabe !== null" data-testid="wegfindung-zuletzt">{{ oben.freigabe }}</span>
                    <!-- Der eingereihte `routing_reload`: dasselbe Wort wie in der Warteschlange, dazu der Kreis des Hauses. -->
                    <span v-if="oben.auftrag !== null" class="wegfindung__auftrag" data-testid="wegfindung-auftrag">
                        <AvmKreis :fuellung="oben.auftrag.fuellung" :name="oben.auftrag.text" />
                        <span :class="{ wegfindung__offen: oben.auftrag.gescheitert }">{{
                            t("admin.wegfindung.bar.job", { state: oben.auftrag.text })
                        }}</span>
                    </span>
                </div>
                <AvmKnopf art="gefuellt" :gesperrt="knopfRuht" testid="wegfindung-rechnen" @click="void h.freigeben()">
                    <span aria-hidden="true">↺ </span>{{ t("admin.wegfindung.bar.action") }}
                </AvmKnopf>
            </div>
            <VerwaltungMeldung :ergebnis="h.freigabe.value ?? undefined" testid="wegfindung-meldung-freigabe" />
            <FensterKarte
                v-for="panel in sicht"
                :key="panel.titel"
                :titel="panel.titel"
                :data-testid="`wegfindung-panel-${panel.titel}`"
            >
                <p class="wegfindung__wirkung">{{ panel.wirkung }}</p>
                <div class="wegfindung__werte">
                    <template v-for="zeile in panel.zeilen" :key="zeile.wert.id">
                        <h4 v-if="zeile.wert.abschnitt" class="wegfindung__abschnitt avm-versalmitte">
                            {{ zeile.wert.abschnitt }}
                        </h4>
                        <div class="wegfindung__wert" :data-testid="`wegfindung-${zeile.wert.id}`">
                            <span class="wegfindung__name">{{ zeile.wert.name }}</span>
                            <span class="wegfindung__feld">
                                <AvmEingabe
                                    :model-value="feld(zeile)"
                                    :gesperrt="gesperrt"
                                    :ungueltig="problem(zeile) !== undefined"
                                    :aria-label="zeile.wert.name"
                                    inputmode="decimal"
                                    :testid="`wegfindung-feld-${zeile.wert.id}`"
                                    @update:model-value="h.tippe(zeile.wert.id, $event)"
                                    @blur="void h.uebernimm(zeile.wert.id)"
                                    @keyup.enter="void h.uebernimm(zeile.wert.id)"
                                />
                            </span>
                            <span class="wegfindung__einheit">{{ zeile.neben }}</span>
                            <AvmKnopf
                                art="weich"
                                groesse="zeile"
                                class="wegfindung__zurueck"
                                :gesperrt="!zeile.abweichend || gesperrt === '' ? '' : undefined"
                                :title="
                                    zeile.abweichend
                                        ? t('admin.wegfindung.reset.to', { wert: zeile.vorgabeText })
                                        : t('admin.wegfindung.reset.resting')
                                "
                                :aria-label="t('admin.wegfindung.reset.label', { name: zeile.wert.name })"
                                :testid="`wegfindung-zurueck-${zeile.wert.id}`"
                                @click="void h.zuruecksetzen(zeile.wert.id)"
                            >
                                <span aria-hidden="true">↺</span>
                            </AvmKnopf>
                            <p class="wegfindung__satz">
                                {{ zeile.wert.satz }}
                                <span :class="`wegfindung__wirkt wegfindung__wirkt--${zeile.folge}`">{{
                                    zeile.folgeSatz
                                }}</span>
                            </p>
                            <p
                                v-if="
                                    zeile.statt !== null ||
                                    zeile.nochNicht !== null ||
                                    zeile.herkunft !== null ||
                                    problem(zeile) !== undefined
                                "
                                class="wegfindung__unten"
                            >
                                <span v-if="problem(zeile) !== undefined" class="wegfindung__problem">{{
                                    t(problem(zeile)!.key, problem(zeile)!.params)
                                }}</span>
                                <span v-if="zeile.statt !== null">{{ zeile.statt }}</span>
                                <!-- Gespeichert ≠ gerechnet: Hier steht die Zahl, mit der weitergerechnet wird. -->
                                <span
                                    v-if="zeile.nochNicht !== null"
                                    class="wegfindung__offen"
                                    :data-testid="`wegfindung-offen-${zeile.wert.id}`"
                                    >{{ zeile.nochNicht }}</span
                                >
                                <span v-if="zeile.stand !== null">{{ zeile.stand }}</span>
                                <span v-if="zeile.herkunft !== null">{{ zeile.herkunft }}</span>
                                <AvmStatus
                                    v-if="zeile.herkunft !== null && zeile.abweichend"
                                    ton="warnung"
                                    :text="t('admin.wegfindung.deviating')"
                                />
                            </p>
                        </div>
                    </template>
                </div>
                <VerwaltungMeldung :ergebnis="meldung(panel.zeilen)" :testid="`wegfindung-meldung-${panel.titel}`" />
            </FensterKarte>
        </template>
    </div>
</template>

<style scoped>
.wegfindung {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    min-width: 0;
}

.wegfindung__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}

.wegfindung__leise,
.wegfindung__wirkung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegfindung__wirkung {
    margin-bottom: var(--space-6);
}

.wegfindung__warnung {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

/* Die Leiste ganz oben: der Zustand der Einstellungen und der EINE Auslöser. */
.wegfindung__netz {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-6) var(--space-10);
    padding: var(--space-8) var(--space-12);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-muted);
}

/* Die Sätze der Leiste stehen untereinander, der Zustand zuerst: in einer Reihe würden sie zu einem langen Band. */
.wegfindung__stand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegfindung__stand > :first-child {
    color: var(--color-text);
}

.wegfindung__auftrag {
    display: flex;
    align-items: center;
    gap: var(--space-4);
}

.wegfindung__offen {
    color: var(--color-accent-strong);
}

.wegfindung__werte {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    margin: 0;
    align-items: start;
}

/*
 * Das Feld beginnt in JEDER Zeile an derselben Stelle: im Goldenen Schnitt der Säule (Betreiber 2026-10-15, mit einem
 * Strich je Säule ins Bild gezeichnet). Darum feste Spalten, auch für die Einheit.
 */
.wegfindung__wert {
    display: grid;
    grid-template-columns: minmax(0, 61.8%) 96px minmax(92px, 1fr) var(--space-24);
    gap: var(--space-2) var(--space-6);
    align-items: center;
    min-width: 0;
}

.wegfindung__name {
    min-width: 0;
}

.wegfindung__feld {
    display: flex;
    min-width: 0;
}

.wegfindung__feld :deep(.eingabe-huelle),
.wegfindung__feld :deep(.eingabe) {
    width: 100%;
}

.wegfindung__einheit {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.wegfindung__satz {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Was eine Änderung nach sich zieht: am Ende des Satzes, in Akzentfarbe, wo sie einen Lauf kostet. */
.wegfindung__wirkt--netz,
.wegfindung__wirkt--seegraph {
    color: var(--color-accent-strong);
}

.wegfindung__unten {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wegfindung__unten :deep(.status) {
    font-size: var(--font-size-small);
}

.wegfindung__problem {
    color: var(--color-danger-soft-text);
}

/*
 * Rücksetzen: quadratisch und so hoch wie das Feld. Steht der Wert auf seiner Vorgabe, ist das Zeichen still — ohne Rand
 * und Fläche, aber lesbar (⚠️ `--color-disabled-text` verschwindet auf der Panelfläche).
 */
.wegfindung__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.wegfindung__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

/* Die Zwischenüberschriften stehen über beide Säulen, nicht in einer. */
.wegfindung__abschnitt {
    grid-column: 1 / -1;
    margin: var(--space-6) 0 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

.wegfindung__abschnitt:first-child {
    margin-top: 0;
}

@media (max-width: 900px) {
    .wegfindung__werte {
        grid-template-columns: minmax(0, 1fr);
    }
}

.wegfindung--telefon .wegfindung__werte {
    grid-template-columns: minmax(0, 1fr);
}
</style>
