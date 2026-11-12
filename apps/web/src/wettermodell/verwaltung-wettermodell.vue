<script setup lang="ts">
/**
 * Der Eintrag „Wettermodell“ der Systemsteuerung (WI-0288 Stufe 4; Probierseite `review/wetter-editor/`, Abschnitt Systemsteuerung,
 * Betreiber 2026-11-07: „passt glaub“; Design Guide §8 „Seiten mit vielen Einstellungen“). Was die Oberfläche rechnet, steht in
 * `wettermodell.ts`; hier steht nur, wie es aussieht. Die Form ist die der Wegfindung (`auth/verwaltung-wegfindung.vue`):
 *
 * - **Vier Reiter, zwölf Panele** wie in der Probierseite; unter jeder Überschrift EINE ruhige Zeile, wo die Werte greifen. Der Reiter
 *   zählt seine Abweichungen im Namen.
 * - **Zwei Säulen je Panel**, je Zeile Name, Feld, Einheit und ↺ in einer Reihe, darunter der Satz mit der Folge einer Änderung
 *   („Wirkt sofort.“ oder, in der Akzentfarbe, „Greift nach dem Neuladen der Karte.“) und die leise Zeile mit Vorgabe und Spanne.
 * - 🔴 **Das Feld beginnt in jeder Zeile an derselben Stelle: im Goldenen Schnitt der Säule (61,8 %)**, bei festen Spaltenbreiten.
 * - **EIN Auslöser oben** in der Leiste, links der Zustand: „Alle zurücksetzen“ (Probierseite). Am Fuß steht keiner.
 * - Kein Kreis vor dem Namen; der verstellte Name steht in der Akzentfarbe, ↺ ist wach.
 * - Ein Feld, dessen Zahl nicht angenommen ist (von der Oberfläche oder mit 400 vom Server), trägt die Kante im Gefahrton und den Satz
 *   darunter; die getippte Zahl bleibt stehen.
 */
import { computed, onMounted, ref } from "vue";
import type { WettermodellReiter } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterReiter from "../fenster/fenster-reiter.vue";
import { t } from "../i18n/i18n";
import { authState } from "../auth/session-state";
import VerwaltungLadeproblem from "../auth/verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "../auth/verwaltung-meldung.vue";
import {
    leistenSatz,
    panele,
    reiterListe,
    abweichendeZahl,
    type Wettermodell,
    type WettermodellZeile,
} from "./wettermodell";

const props = defineProps<{
    wettermodell: Wettermodell;
    telefon: boolean;
}>();

const darf = authState.value.capabilities.includes("manage_weather_model");
const h = props.wettermodell;
onMounted(() => void h.load());

const reiter = ref<WettermodellReiter>("wind");
const stand = computed(() => h.stand.value);
const alleReiter = computed(() => reiterListe(stand.value));
const sicht = computed(() => panele(stand.value).filter((panel) => panel.reiter === reiter.value));
const abweichend = computed(() => abweichendeZahl(stand.value));
/** Gesperrt ohne eigenen Satz (der steht einmal oben): kein Recht, keine Tafel, oder ein Schreibweg läuft. */
const gesperrt = computed(() =>
    !darf || h.busy.value !== null || stand.value?.revision === null || stand.value === null ? "" : undefined,
);
/** Warum der Knopf oben ruht, als Satz im `title`; `undefined`, wenn er wach ist. */
const knopfRuht = computed(() => {
    if (!darf) return t("admin.wettermodell.alle.recht");
    if (stand.value?.revision === null) return t("admin.wettermodell.alle.keineTafel");
    if (h.busy.value !== null) return t("admin.wettermodell.alle.laeuft");
    if (abweichend.value === 0) return t("admin.wettermodell.alle.ruht");
    return undefined;
});
const feld = (zeile: WettermodellZeile): string => h.felder.value[zeile.wert.id] ?? zeile.text;
const problem = (zeile: WettermodellZeile) => h.probleme.value[zeile.wert.id];
</script>

<template>
    <div class="wettermodell" :class="{ 'wettermodell--telefon': props.telefon }" data-testid="wettermodell">
        <VerwaltungLadeproblem :problems="h.loadProblems.value" :fehlt="null" testid="wettermodell-ladefehler"
            ><span>{{ t("admin.wettermodell.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && h.loading.value" class="wettermodell__leise">{{ t("admin.loading") }}</p>
        <template v-if="stand !== null">
            <AvmHinweis>
                <strong class="wettermodell__erst">{{ t("admin.wettermodell.leadFirst") }}</strong>
                {{ " " }}{{ t("admin.wettermodell.lead") }}
            </AvmHinweis>
            <p v-if="stand.revision === null" class="wettermodell__warnung" data-testid="wettermodell-quelle">
                {{ t("admin.wettermodell.keineTafel") }}
            </p>
            <p v-if="!darf" class="wettermodell__leise" data-testid="wettermodell-nur-lesen">
                {{ t("admin.wegfindung.readOnly", { recht: t("auth.capability.manage_weather_model") }) }}
            </p>

            <!-- Die Leiste ganz oben: links der Zustand, rechts der EINE Auslöser. -->
            <div class="wettermodell__leiste" data-testid="wettermodell-leiste">
                <div class="wettermodell__stand">
                    <span :class="{ wettermodell__offen: abweichend > 0 }" data-testid="wettermodell-abweichend">{{
                        leistenSatz(stand)
                    }}</span>
                    <span>{{ t("admin.wettermodell.leiste.herkunft") }}</span>
                </div>
                <AvmKnopf
                    :gesperrt="knopfRuht"
                    :title="knopfRuht === undefined ? t('admin.wettermodell.alle.titel') : undefined"
                    testid="wettermodell-alle"
                    @click="void h.alleZuruecksetzen()"
                >
                    <span aria-hidden="true">↺ </span>{{ t("admin.wettermodell.alle.knopf") }}
                </AvmKnopf>
            </div>
            <VerwaltungMeldung :ergebnis="h.alle.value ?? undefined" testid="wettermodell-meldung-alle" />

            <FensterReiter
                v-model="reiter"
                :reiter="alleReiter"
                :beschriftung="t('admin.wettermodell.reiter.leiste')"
                kennung="wettermodell"
            />
            <div
                :id="`wettermodell-inhalt-${reiter}`"
                class="wettermodell__panele"
                role="tabpanel"
                :aria-labelledby="`wettermodell-reiter-${reiter}`"
            >
                <FensterKarte
                    v-for="panel in sicht"
                    :key="panel.id"
                    :titel="panel.titel"
                    :data-testid="`wettermodell-panel-${panel.id}`"
                >
                    <p class="wettermodell__wirkung">{{ panel.wirkung }}</p>
                    <div class="wettermodell__werte">
                        <div
                            v-for="zeile in panel.zeilen"
                            :key="zeile.wert.id"
                            class="wettermodell__wert"
                            :class="{
                                'is-geaendert': zeile.abweichend,
                                'wettermodell__wert--auswahl': zeile.art === 'auswahl',
                            }"
                            :data-testid="`wettermodell-${zeile.wert.id}`"
                        >
                            <span class="wettermodell__name">{{ zeile.name }}</span>
                            <span class="wettermodell__feld">
                                <AvmAuswahl
                                    v-if="zeile.art === 'auswahl'"
                                    :model-value="String(zeile.eingestellt)"
                                    :optionen="zeile.optionen"
                                    :gesperrt="gesperrt"
                                    :aria-label="zeile.name"
                                    :testid="`wettermodell-feld-${zeile.wert.id}`"
                                    @update:model-value="void h.waehle(zeile.wert.id, Number($event))"
                                />
                                <AvmEingabe
                                    v-else
                                    :model-value="feld(zeile)"
                                    :gesperrt="gesperrt"
                                    :ungueltig="problem(zeile) !== undefined"
                                    :aria-label="zeile.name"
                                    inputmode="decimal"
                                    autocomplete="off"
                                    :testid="`wettermodell-feld-${zeile.wert.id}`"
                                    @update:model-value="h.tippe(zeile.wert.id, $event)"
                                    @blur="void h.uebernimm(zeile.wert.id)"
                                    @keyup.enter="void h.uebernimm(zeile.wert.id)"
                                />
                            </span>
                            <span v-if="zeile.art !== 'auswahl'" class="wettermodell__einheit">{{
                                zeile.einheit
                            }}</span>
                            <AvmKnopf
                                art="weich"
                                groesse="zeile"
                                class="wettermodell__zurueck"
                                :gesperrt="!zeile.abweichend || gesperrt === '' ? '' : undefined"
                                :title="
                                    zeile.abweichend
                                        ? t('admin.wettermodell.zurueck.zu', { wert: zeile.vorgabeText })
                                        : t('admin.wettermodell.zurueck.ruht')
                                "
                                :aria-label="t('admin.wettermodell.zurueck.label', { name: zeile.name })"
                                :testid="`wettermodell-zurueck-${zeile.wert.id}`"
                                @click="void h.zuruecksetzen(zeile.wert.id)"
                            >
                                <span aria-hidden="true">↺</span>
                            </AvmKnopf>
                            <p class="wettermodell__satz">
                                {{ zeile.satz }}
                                <span
                                    :class="`wettermodell__folge wettermodell__folge--${zeile.folge}`"
                                    :data-testid="`wettermodell-folge-${zeile.wert.id}`"
                                    >{{ zeile.folgeSatz }}</span
                                >
                            </p>
                            <p class="wettermodell__unten">
                                <span
                                    v-if="problem(zeile) !== undefined"
                                    class="wettermodell__problem"
                                    :data-testid="`wettermodell-problem-${zeile.wert.id}`"
                                    >{{ t(problem(zeile)!.key, problem(zeile)!.params) }}</span
                                >
                                <span
                                    v-if="zeile.vorgabeSatz !== null"
                                    :data-testid="`wettermodell-vorgabe-${zeile.wert.id}`"
                                    >{{ zeile.vorgabeSatz }}</span
                                >
                                <span v-if="zeile.abstand !== null">{{ zeile.abstand }}</span>
                                <span v-if="zeile.spanne !== null">{{ zeile.spanne }}</span>
                            </p>
                        </div>
                    </div>
                </FensterKarte>
            </div>
        </template>
    </div>
</template>

<style scoped>
.wettermodell {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    min-width: 0;
}

.wettermodell__erst {
    color: var(--color-accent-strong);
    font-weight: var(--font-weight-regular);
}

.wettermodell__leise,
.wettermodell__wirkung {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wettermodell__wirkung {
    margin-bottom: var(--space-6);
}

.wettermodell__warnung {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
}

/* Die Leiste ganz oben: der Zustand des Wettermodells und der EINE Auslöser (wie die Wegfindung). */
.wettermodell__leiste {
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

.wettermodell__stand {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wettermodell__stand > :first-child {
    color: var(--color-text);
}

.wettermodell__stand > .wettermodell__offen {
    color: var(--color-accent-strong);
}

.wettermodell__panele {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
    min-width: 0;
}

.wettermodell__werte {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-8) var(--space-24);
    margin: 0;
    align-items: start;
}

/*
 * Das Feld beginnt in JEDER Zeile an derselben Stelle: im Goldenen Schnitt der Säule (Hausform der Wegfindung, Betreiber 2026-10-15).
 * Darum feste Spalten, auch für die Einheit.
 */
.wettermodell__wert {
    display: grid;
    grid-template-columns: minmax(0, 61.8%) 96px minmax(92px, 1fr) var(--space-24);
    gap: var(--space-2) var(--space-6);
    align-items: center;
    min-width: 0;
}

/* Die Wahl der Wolkenauflösung nimmt Feld und Einheit zusammen: Ihre Namen sind länger als eine Zahl. */
.wettermodell__wert--auswahl .wettermodell__feld {
    grid-column: 2 / 4;
}

.wettermodell__name {
    min-width: 0;
}

.wettermodell__wert.is-geaendert .wettermodell__name {
    color: var(--color-accent-strong);
}

.wettermodell__feld {
    display: flex;
    min-width: 0;
}

.wettermodell__feld :deep(.eingabe-huelle),
.wettermodell__feld :deep(.eingabe),
.wettermodell__feld :deep(.auswahl-huelle),
.wettermodell__feld :deep(.auswahl) {
    width: 100%;
}

.wettermodell__einheit {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

.wettermodell__satz {
    grid-column: 1 / -1;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Was eine Änderung nach sich zieht: am Ende des Satzes, in Akzentfarbe, wo sie das Neuladen der Karte braucht. */
.wettermodell__folge--neustart {
    color: var(--color-accent-strong);
}

.wettermodell__unten {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-8);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.wettermodell__problem {
    color: var(--color-danger-soft-text);
}

/*
 * Rücksetzen: quadratisch und so hoch wie das Feld. Steht der Wert auf seiner Vorgabe, ist das Zeichen still: ohne Rand und Fläche, aber
 * lesbar (⚠️ `--color-disabled-text` verschwindet auf der Panelfläche).
 */
.wettermodell__zurueck :deep(.knopf) {
    width: var(--space-24);
    min-width: var(--space-24);
    padding-inline: 0;
}

.wettermodell__zurueck :deep(.knopf:disabled) {
    border-color: transparent;
    background: transparent;
    color: var(--color-text-muted);
    opacity: 0.7;
    cursor: default;
}

@media (max-width: 900px) {
    .wettermodell__werte {
        grid-template-columns: minmax(0, 1fr);
    }
}

.wettermodell--telefon .wettermodell__werte {
    grid-template-columns: minmax(0, 1fr);
}
</style>
