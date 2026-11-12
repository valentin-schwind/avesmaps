<script setup lang="ts">
/**
 * Der Eintrag „Abgleiche“ unter „Redaktion & Integrationen“ (WI-0127 SYS-14, SYS-0001 §9b). Was die Oberfläche rechnet, steht in
 * `abgleiche.ts`; hier steht nur, wie es aussieht.
 *
 * - **Legacys Listenform** (AGENTS.md „Editor: abstrakte Zeichen, der Kreis und Legacys Listen“): je Quelle eine Zeile, Name mit Kreis,
 *   darunter die Unterzeile im Ton der Lage und ein leiser Satz, was abgeglichen wird; rechts der Knopf mit dem abstrakten Zeichen ⇄
 *   (Knöpfe nur für Backend-Nutzer tragen keine Bildsymbole). Unten die Legende der Kreise, kein Tooltip.
 * - **Der Knopf** fragt an der Stelle nach (`AvmBestaetigung`); erst „Jetzt abgleichen“ reiht einen Auftrag ein. Ohne das Recht der
 *   Zeile (`run_legacy_sync`, bei einer Kategorie `run_legacy_zug`), auf einer Umgebung ohne Ausführung oder während ein Auftrag
 *   wartet oder läuft, steht er gesperrt mit Satz da.
 * - **Je Kategorie eine Zeile** (WI-0141, Betreiber 2026-10-13): „Legacy-Zug: Landschaften / Wege / Orte“ stehen wie jede andere
 *   Quelle in derselben Liste — kein Sammelknopf, keine eigene Gruppe. In Production ist die Gesamtzeile gesperrt
 *   (`ABGLEICHE=legacy:kategorien`).
 * - **Nur die Zeilen, die es hier gibt** (WI-0144): Welche Quellen dastehen, entscheidet der Server (`ABGLEICHE`, Wert
 *   `verborgen`). Auf der Stage steht darum genau eine Zeile, „Production-Zug“, und ihr Knopf trägt ihren eigenen Satz
 *   („Production-Zug holen“, Betreiberwort 2026-10-14).
 * - **Telefon:** der Knopf rutscht unter die Zeile und nimmt die ganze Breite.
 */
import { computed, onMounted, onUnmounted, ref, useId } from "vue";
import type { AbgleichQuelle } from "@avesmaps3d/shared";
import AvmBestaetigung from "../controls/avm-bestaetigung.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import { t } from "../i18n/i18n";
import {
    bestaetigenName,
    fortschritt,
    KREIS_LEGENDE,
    kreisName,
    quelleName,
    sperrSatz,
    startName,
    unterzeile,
    type Abgleiche,
} from "./abgleiche";
import type { Abzug } from "./abzug";
import { authState } from "./session-state";
import VerwaltungAbzug from "./verwaltung-abzug.vue";
import VerwaltungLadeproblem from "./verwaltung-ladeproblem.vue";
import VerwaltungMeldung from "./verwaltung-meldung.vue";

const props = defineProps<{
    abgleiche: Abgleiche;
    /** Der Abzug für lokal (WI-0251): steht über den Zeilen, wo diese Umgebung eine Rolle dabei hat. */
    abzug: Abzug;
    telefon: boolean;
}>();

/**
 * Drei Rechte: der ganze Zug und die Medien brauchen `run_legacy_sync`, eine Kategorie `run_legacy_zug` (WI-0141), der
 * Production-Zug `run_production_pull` (WI-0144).
 */
const darf = {
    sync: authState.value.capabilities.includes("run_legacy_sync"),
    zug: authState.value.capabilities.includes("run_legacy_zug"),
    production: authState.value.capabilities.includes("run_production_pull"),
};
const basisId = useId();

/** Die Uhr für „heute, 14:05“ und die Unterzeile; tickt nur, solange der Eintrag zu sehen ist. */
const jetzt = ref(new Date());
let uhr: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
    uhr = setInterval(() => (jetzt.value = new Date()), 15_000);
    props.abgleiche.follow(true);
    void props.abgleiche.load();
});
onUnmounted(() => {
    if (uhr !== undefined) clearInterval(uhr);
    props.abgleiche.follow(false);
    props.abgleiche.cancel();
});

const stand = computed(() => props.abgleiche.stand.value);
const zeilen = computed(() => {
    const s = stand.value;
    if (s === null) return [];
    return s.zeilen.map((zeile) => ({
        zeile,
        name: quelleName(zeile.quelle),
        knopf: startName(zeile.quelle),
        bestaetigen: bestaetigenName(zeile.quelle),
        unter: unterzeile(zeile, jetzt.value),
        sperre: sperrSatz(s, zeile, darf),
        prozent: fortschritt(zeile),
    }));
});

function ergebnisFuer(quelle: AbgleichQuelle) {
    const letzte = props.abgleiche.ergebnis.value;
    return letzte !== null && letzte.quelle === quelle ? letzte.result : undefined;
}
</script>

<template>
    <div class="abgleiche" :class="{ 'abgleiche--telefon': props.telefon }" data-testid="abgleiche">
        <VerwaltungAbzug :abzug="props.abzug" :telefon="props.telefon" />
        <VerwaltungLadeproblem
            :problems="props.abgleiche.loadProblems.value"
            :fehlt="props.abgleiche.unconfirmed.value"
            testid="abgleiche-ladefehler"
            @bestaetigen="props.abgleiche.confirmAgain()"
            ><span class="abgleiche__block">{{ t("admin.sync.loadFailed") }}</span></VerwaltungLadeproblem
        >
        <p v-if="stand === null && props.abgleiche.loading.value" class="abgleiche__leise">{{ t("admin.loading") }}</p>

        <ul v-if="stand !== null && zeilen.length > 0" class="abgleiche__liste" :aria-label="t('admin.tab.abgleiche')">
            <li
                v-for="{ zeile, name, knopf, bestaetigen, unter, sperre, prozent } in zeilen"
                :key="zeile.quelle"
                class="abgleiche__eintrag"
                :data-quelle="zeile.quelle"
                :data-testid="`abgleich-${zeile.quelle}`"
            >
                <div class="abgleiche__zeile">
                    <span class="abgleiche__name">
                        <span class="abgleiche__text">{{ name }}</span>
                        <AvmKreis
                            :fuellung="zeile.kreis"
                            :name="kreisName(zeile.kreis)"
                            :testid="`abgleich-${zeile.quelle}-kreis`"
                        />
                    </span>
                    <span
                        class="abgleiche__unter"
                        :class="`abgleiche__unter--${unter.ton}`"
                        :data-testid="`abgleich-${zeile.quelle}-unter`"
                        >{{ unter.text }}</span
                    >
                    <span class="abgleiche__was">{{ t(`admin.sync.what.${zeile.quelle}`) }}</span>
                    <AvmKnopf
                        :id="`${basisId}-${zeile.quelle}`"
                        class="abgleiche__knopf"
                        art="weich"
                        groesse="zeile"
                        :gesperrt="props.abgleiche.frage.value === zeile.quelle ? undefined : sperre"
                        :breit="props.telefon"
                        :aria-expanded="props.abgleiche.frage.value === zeile.quelle"
                        :testid="`abgleich-${zeile.quelle}-knopf`"
                        @click="props.abgleiche.ask(zeile.quelle)"
                        ><span aria-hidden="true">⇄ </span>{{ knopf }}</AvmKnopf
                    >
                </div>
                <div
                    v-if="prozent !== null"
                    class="abgleiche__balken"
                    role="progressbar"
                    :aria-valuenow="prozent"
                    aria-valuemin="0"
                    aria-valuemax="100"
                    :aria-label="t('admin.sync.progress', { name })"
                    :data-testid="`abgleich-${zeile.quelle}-balken`"
                >
                    <span class="abgleiche__balken-fuellung" :style="{ width: `${String(prozent)}%` }"></span>
                </div>
                <AvmBestaetigung
                    v-if="props.abgleiche.frage.value === zeile.quelle"
                    :frage="t(`admin.sync.ask.${zeile.quelle}`)"
                    :folge="t(`admin.sync.ask.${zeile.quelle}Follows`)"
                    :bestaetigen="bestaetigen"
                    :gesperrt="props.abgleiche.busy.value ? '' : undefined"
                    :testid="`abgleich-${zeile.quelle}-frage`"
                    @bestaetigen="props.abgleiche.confirm()"
                    @abbrechen="props.abgleiche.cancel()"
                />
                <VerwaltungMeldung
                    :ergebnis="ergebnisFuer(zeile.quelle)"
                    :testid="`abgleich-${zeile.quelle}-meldung`"
                />
                <AvmHinweis
                    v-if="ergebnisFuer(zeile.quelle)?.ok && (ergebnisFuer(zeile.quelle)?.problems.length ?? 0) > 0"
                    ton="warnung"
                    rolle="status"
                    :testid="`abgleich-${zeile.quelle}-hinweis`"
                    >{{ t("admin.sync.waitNoPlanner") }}</AvmHinweis
                >
            </li>
        </ul>

        <p
            v-if="stand !== null && zeilen.length === 0 && !props.abzug.verfuegbar.value"
            class="abgleiche__leise"
            data-testid="abgleiche-leer"
        >
            {{ t("admin.sync.leer") }}
        </p>
        <p v-if="stand !== null && zeilen.length > 0" class="abgleiche__legende" data-testid="abgleiche-legende">
            <span v-for="kreis in KREIS_LEGENDE" :key="kreis" class="abgleiche__legende-teil">
                <AvmKreis :fuellung="kreis" :name="kreisName(kreis)" />{{ kreisName(kreis) }}
            </span>
        </p>
    </div>
</template>

<style scoped>
.abgleiche {
    display: flex;
    flex-direction: column;
    gap: var(--divider-gap);
    min-width: 0;
}

.abgleiche__block {
    display: block;
}

.abgleiche__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.abgleiche__liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.abgleiche__eintrag {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-10);
}

.abgleiche__eintrag + .abgleiche__eintrag {
    border-top: 1px solid var(--color-divider);
}

/* Legacys Zeile: Name mit Kreis oben, Unterzeile darunter, rechts die Handlung über beide Zeilen. */
.abgleiche__zeile {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    column-gap: var(--space-12);
    row-gap: var(--space-2);
    align-items: center;
}

.abgleiche__name {
    grid-row: 1;
    grid-column: 1;
    display: flex;
    align-items: center;
    gap: var(--space-4);
    min-width: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-body);
}

.abgleiche__unter {
    grid-row: 2;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.abgleiche__unter--gut {
    color: var(--color-success-soft-text);
}

.abgleiche__unter--warnung {
    color: var(--color-warning-soft-text);
}

.abgleiche__unter--fehler {
    color: var(--color-danger-soft-text);
}

.abgleiche__was {
    grid-row: 3;
    grid-column: 1;
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.abgleiche__knopf {
    grid-row: 1 / span 3;
    grid-column: 2;
    justify-self: end;
}

/* Der Balken wie auf der Statusseite (`job-row.vue`): grob, aus dem Schritt; er zeigt, dass etwas passiert und wie weit. */
.abgleiche__balken {
    height: 4px;
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-active);
}

.abgleiche__balken-fuellung {
    display: block;
    height: 100%;
    background: var(--color-accent);
    transition: width 120ms ease;
}

@media (prefers-reduced-motion: reduce) {
    .abgleiche__balken-fuellung {
        transition: none;
    }
}

.abgleiche--telefon .abgleiche__zeile {
    grid-template-columns: minmax(0, 1fr);
}

.abgleiche--telefon .abgleiche__knopf {
    grid-row: 4;
    grid-column: 1;
    justify-self: stretch;
    margin-top: var(--space-4);
}

/* Die Legende wie unter Legacys Listen: 11 px leise, jedes Zeichen neben seinem Wort (Guide §13.17). */
.abgleiche__legende {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.abgleiche__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-4);
}
</style>
