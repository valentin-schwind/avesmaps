<script setup lang="ts">
import { computed, ref } from "vue";
import type { InhalteWerkRolle, InhalteZiel } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { aktiveOrte, ROLLEN_FOLGE, type EntwurfOrt } from "./inhalte-literatur-modell";
import type { LiteraturSteuerung } from "./inhalte-literatur-steuerung";
import { rolleName, zielartName } from "./inhalte-literatur-texte";

/**
 * Spalte 3 des Reiters „Literatur“ (WI-0254, Runde 2; Mockup): die geordnete Ortsliste des Werks, also die Orte, Gebiete und Landschaften,
 * an denen es beginnt, spielt oder die es beschreibt.
 *
 * - **Die Reihenfolge ist Aussage** (der kleinste Eintrag ist der Startort): Sie wird von Hand geordnet (▲ ▼), nie still sortiert. Mehrere
 *   Startorte sind möglich; ★ macht eine Zeile zum Startort, nochmal ★ gibt ihr die Rolle davor zurück. Eine Zeile hat EINE Rolle.
 * - **Anhängen** nur über einen echten Treffer (Ort, Herrschaftsgebiet, Landschaft, Gipfel): Er trägt die öffentliche Kennung des Objekts,
 *   nie ein Name als Schlüssel. Ein freier Name bleibt ausdrücklich ungeklärt („ungeklärt übernehmen“): ohne Kartenbezug, später von Hand zu
 *   prüfen.
 * - **Lösen** legt still: eine Zeile aus Legacy wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst; beide stehen unter
 *   „Unterdrückte und gelöste anzeigen“ und lassen sich wiederherstellen.
 */
const props = defineProps<{
    steuerung: LiteraturSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: [] }>();

const s = props.steuerung;
const werk = computed(() => s.werk.value);
const stand = computed(() => s.stand.value);
const alle = computed<readonly EntwurfOrt[]>(() => stand.value?.orte ?? []);
const aktive = computed(() => (stand.value === undefined ? [] : aktiveOrte(stand.value)));
const stille = computed(() => alle.value.filter((o) => o.state !== "active"));
const zeigeStille = ref(false);
const sichtbar = computed(() => alle.value.filter((o) => o.state === "active" || zeigeStille.value));

/** Warum nichts änderbar ist, steht in der Spalte Stammdaten EINMAL; hier bleibt es still gesperrt (leerer Satz). */
const gesperrt = computed<string | undefined>(() =>
    !props.darfSchreiben || stand.value?.felder.aktiv === false ? "" : undefined,
);

const neueRolle = ref<InhalteWerkRolle>("play");
const rollenOptionen = computed(() =>
    ROLLEN_FOLGE.map((rolle) => ({
        wert: rolle,
        text: rolle === "covers" ? t("inhalte.rolle.coversOption") : rolleName(rolle),
    })),
);
const alsRolle = (wert: string): InhalteWerkRolle =>
    (ROLLEN_FOLGE as readonly string[]).includes(wert) ? (wert as InhalteWerkRolle) : "play";

function haengeAn(ziel: InhalteZiel): void {
    s.haengeZielAn(ziel, neueRolle.value);
    s.leereZiele();
}
function ersteAnhaengen(): void {
    const erstes = s.zielTreffer.value[0];
    if (erstes !== undefined) haengeAn(erstes);
}
function haengeNamenAn(): void {
    s.haengeNamenAn(s.zielText.value, neueRolle.value);
    s.leereZiele();
}

const ZIEL_KENNUNG = (ziel: InhalteZiel): string => `${ziel.kind}:${ziel.carrierId}`;

/** Der Platz einer Zeile unter den aktiven (für die Pfeile); eine stille hat keinen. */
const platz = (o: EntwurfOrt): number => aktive.value.findIndex((a) => a.schluessel === o.schluessel);

/**
 * Die zweite Zeile der Karte: was die Zeile ist, in einem Satz (Mockup „relationMeta“). Eine Zeile ohne Besonderheit hat keinen: Ihre Herkunft zeigt schon
 * die Pille (Betreiber, 27.10.).
 */
function metaSatz(o: EntwurfOrt): string | undefined {
    if (o.state === "suppressed") return t("inhalte.verwendung.unterdrueckt");
    if (o.state === "retired") return t("inhalte.verwendung.geloest");
    if (o.neu) return t("inhalte.verwendung.neu");
    if (o.targetState === "unresolved") return t("inhalte.literatur.ort.meta.ungeklaert");
    if (o.targetState === "unmatched") return t("inhalte.literatur.ort.meta.nichtGefunden");
    return undefined;
}
const zielSatz = (o: EntwurfOrt): string =>
    o.kind === undefined
        ? t("inhalte.literatur.ort.ungeklaert")
        : t("inhalte.literatur.ort.zugeordnet", { art: zielartName(o.kind) });
const ursprungName = (o: EntwurfOrt): string => t(`inhalte.ursprung.${o.ursprung}` as MessageKey);
const nummer = (index: number): string => String(index + 1).padStart(2, "0");
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('inhalte.literatur.orte.titel') + (werk ? ` (${formatNumber(aktive.length, 0)})` : '')"
        :unterzeile="werk ? t('inhalte.literatur.orte.unterzeile') : undefined"
        testid="inhalte-spalte-verwendungen"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-stamm" @click="emit('zurueck')">{{
                t("inhalte.zurueck.stamm")
            }}</AvmKnopf>
        </template>

        <p v-if="!werk" class="orte__leise" data-testid="inhalte-verwendungen-leer">
            {{ t("inhalte.literatur.stamm.leer") }}
        </p>

        <template v-else>
            <p class="orte__leise">{{ t("inhalte.literatur.orte.hilfe") }}</p>

            <div v-if="darfSchreiben" class="orte__neu" data-testid="inhalte-verwendungen-neu">
                <div class="orte__zeile">
                    <AvmEingabe
                        v-model="s.zielText.value"
                        art="suche"
                        :placeholder="t('inhalte.literatur.orte.suche.platzhalter')"
                        :aria-label="t('inhalte.literatur.orte.suche.beschriftung')"
                        :gesperrt="gesperrt"
                        testid="inhalte-ziel-suche"
                        @keydown.enter.prevent="ersteAnhaengen"
                    />
                    <AvmKnopf
                        groesse="zeile"
                        :gesperrt="s.zielTreffer.value.length > 0 && gesperrt === undefined ? undefined : ''"
                        testid="inhalte-ziel-anhaengen"
                        @click="ersteAnhaengen"
                    >
                        ＋ {{ t("inhalte.literatur.orte.knopf") }}
                    </AvmKnopf>
                </div>
                <label class="orte__art">
                    <span>{{ t("inhalte.verwendungen.zuordnung") }}</span>
                    <AvmAuswahl
                        :model-value="neueRolle"
                        groesse="zeile"
                        :optionen="rollenOptionen"
                        :gesperrt="gesperrt"
                        testid="inhalte-ziel-art"
                        @update:model-value="(wert: string) => (neueRolle = alsRolle(wert))"
                    />
                </label>
                <ul v-if="s.zielText.value.trim().length >= 2" class="orte__treffer" data-testid="inhalte-ziel-treffer">
                    <li v-for="ziel in s.zielTreffer.value" :key="ZIEL_KENNUNG(ziel)">
                        <button
                            type="button"
                            class="orte__treffer-knopf"
                            data-testid="inhalte-ziel"
                            @click="haengeAn(ziel)"
                        >
                            <span class="orte__name">{{ ziel.name }}</span>
                            <AvmPille>{{ zielartName(ziel.kind) }}</AvmPille>
                        </button>
                    </li>
                    <li>
                        <button
                            type="button"
                            class="orte__treffer-knopf orte__treffer-knopf--roh"
                            data-testid="inhalte-ziel-roh"
                            @click="haengeNamenAn()"
                        >
                            <span class="orte__roh">
                                <span>＋ {{ t("inhalte.literatur.orte.roh", { name: s.zielText.value.trim() }) }}</span>
                                <span class="orte__leise">{{ t("inhalte.literatur.orte.roh.hinweis") }}</span>
                            </span>
                        </button>
                    </li>
                </ul>
                <p v-if="s.zielLaedt.value" class="orte__leise">{{ t("inhalte.laedt") }}</p>
                <p class="orte__leise">{{ t("inhalte.literatur.orte.zielHilfe") }}</p>
            </div>

            <ul v-if="sichtbar.length > 0" class="orte__karten" data-testid="inhalte-verwendungen-liste">
                <li
                    v-for="o in sichtbar"
                    :key="o.schluessel"
                    class="karte"
                    :class="{ 'is-still': o.state !== 'active' }"
                    data-testid="inhalte-ort"
                    :data-ort="o.schluessel"
                    :data-state="o.state"
                    :data-role="o.role"
                >
                    <div class="karte__pfeile">
                        <template v-if="o.state === 'active' && darfSchreiben">
                            <button
                                type="button"
                                class="karte__pfeil"
                                :disabled="gesperrt !== undefined || platz(o) <= 0"
                                :aria-label="t('inhalte.literatur.ort.hoch', { name: o.name })"
                                :title="t('inhalte.literatur.ort.hoch', { name: o.name })"
                                data-testid="inhalte-ort-hoch"
                                @click="s.verschiebe(o.schluessel, -1)"
                            >
                                ▲
                            </button>
                            <button
                                type="button"
                                class="karte__pfeil"
                                :disabled="gesperrt !== undefined || platz(o) >= aktive.length - 1"
                                :aria-label="t('inhalte.literatur.ort.runter', { name: o.name })"
                                :title="t('inhalte.literatur.ort.runter', { name: o.name })"
                                data-testid="inhalte-ort-runter"
                                @click="s.verschiebe(o.schluessel, 1)"
                            >
                                ▼
                            </button>
                        </template>
                        <span v-else-if="o.state === 'active'" class="karte__nr" aria-hidden="true">{{
                            nummer(platz(o))
                        }}</span>
                    </div>
                    <div class="karte__haupt">
                        <div class="karte__titel">{{ o.name === "" ? t("inhalte.verwendung.ohneName") : o.name }}</div>
                        <div class="karte__meta">{{ zielSatz(o) }}</div>
                        <div v-if="metaSatz(o)" class="karte__meta" data-testid="inhalte-ort-meta">
                            {{ metaSatz(o) }}
                        </div>
                        <div class="karte__chips">
                            <AvmPille data-testid="inhalte-ort-rolle">{{ rolleName(o.role) }}</AvmPille>
                            <AvmPille :ton="o.ursprung === 'manual' ? 'warnung' : 'neutral'">{{
                                ursprungName(o)
                            }}</AvmPille>
                            <AvmPille v-if="o.state === 'suppressed'" ton="gefahr">{{
                                t("inhalte.verwendung.chip.unterdrueckt")
                            }}</AvmPille>
                            <AvmPille v-else-if="o.state === 'retired'" ton="warnung">{{
                                t("inhalte.verwendung.chip.geloest")
                            }}</AvmPille>
                        </div>
                        <div v-if="o.state === 'active' && darfSchreiben" class="karte__fuss">
                            <AvmKnopf
                                groesse="zeile"
                                :art="o.role === 'start' ? 'gefuellt' : 'weich'"
                                :gesperrt="gesperrt"
                                :aria-label="
                                    o.role === 'start'
                                        ? t('inhalte.literatur.ort.startAufheben', { name: o.name })
                                        : t('inhalte.literatur.ort.startSetzen', { name: o.name })
                                "
                                testid="inhalte-ort-start"
                                @click="s.schalteStart(o.schluessel)"
                            >
                                {{
                                    o.role === "start"
                                        ? t("inhalte.literatur.ort.start")
                                        : t("inhalte.literatur.ort.keinStart")
                                }}
                            </AvmKnopf>
                        </div>
                        <div v-else-if="o.state !== 'active' && darfSchreiben" class="karte__fuss">
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="gesperrt"
                                testid="inhalte-ort-wieder"
                                @click="s.stelleHer(o.schluessel)"
                            >
                                ↺ {{ t("inhalte.verwendung.wiederherstellen") }}
                            </AvmKnopf>
                        </div>
                    </div>
                    <AvmKnopf
                        v-if="o.state === 'active' && darfSchreiben"
                        groesse="zeile"
                        class="karte__weg"
                        :gesperrt="gesperrt"
                        :title="t('inhalte.literatur.ort.loesen', { name: o.name })"
                        :aria-label="t('inhalte.literatur.ort.loesen', { name: o.name })"
                        testid="inhalte-ort-loesen"
                        @click="s.loese(o.schluessel)"
                    >
                        ✕
                    </AvmKnopf>
                </li>
            </ul>
            <p v-else class="orte__leise" data-testid="inhalte-verwendungen-keine">
                {{ t("inhalte.literatur.orte.keine") }}
            </p>

            <AvmKaestchen
                v-if="stille.length > 0"
                art="checkbox"
                :checked="zeigeStille"
                testid="inhalte-stille-zeigen"
                @change="(an: boolean) => (zeigeStille = an)"
            >
                {{ t("inhalte.verwendungen.stille", { n: formatNumber(stille.length, 0) }) }}
            </AvmKaestchen>
            <AvmHinweis>{{ t("inhalte.literatur.orte.spoiler") }}</AvmHinweis>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.orte__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.orte__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-bottom: var(--space-8);
    border-bottom: 1px solid var(--color-divider);
}

.orte__zeile {
    display: flex;
    gap: var(--space-6);
}

.orte__zeile > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

.orte__art {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
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
    justify-content: space-between;
    gap: var(--space-6);
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

.orte__treffer-knopf:hover {
    background: var(--color-hover-wash);
}

.orte__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.orte__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.orte__roh {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    color: var(--color-warning-soft-text);
}

.orte__karten {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    margin: 0;
    padding: 0;
    list-style: none;
}

.karte {
    display: flex;
    align-items: flex-start;
    gap: var(--space-8);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.karte.is-still {
    opacity: 0.72;
}

.karte__pfeile {
    display: flex;
    flex: none;
    flex-direction: column;
    align-items: center;
    width: var(--space-20);
    min-height: var(--space-20);
    gap: var(--space-2);
}

.karte__pfeil {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--space-20);
    height: var(--space-20);
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--color-text-muted);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition:
        background-color 120ms ease,
        color 120ms ease;
}

.karte__pfeil:hover:not(:disabled) {
    background: var(--color-hover-wash);
    color: var(--color-text);
}

.karte__pfeil:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.karte__pfeil:disabled {
    color: var(--color-border-strong);
    cursor: default;
}

.karte__nr {
    padding-top: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.karte__haupt {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.karte__titel {
    color: var(--color-text-strong);
    overflow-wrap: anywhere;
}

.karte__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
}

.karte__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
}

.karte__fuss {
    margin-top: var(--space-6);
}

.karte__weg {
    flex: none;
}

@media (prefers-reduced-motion: reduce) {
    .orte__treffer-knopf,
    .karte__pfeil {
        transition: none;
    }
}
</style>
