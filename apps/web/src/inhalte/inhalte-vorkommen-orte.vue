<script setup lang="ts">
import { computed, ref } from "vue";
import {
    INHALTE_VORKOMMEN_BEZIEHUNGEN,
    type InhalteVorkommenBeziehung,
    type InhalteVorkommenZiel,
} from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import { aktiveOrte, trifftAufDerKarte, type EntwurfOrt } from "./inhalte-vorkommen-modell";
import InhalteVorkommenRegeln from "./inhalte-vorkommen-regeln.vue";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";
import { beziehungName, kindName, rolleName, zielArtName, zielKennung } from "./inhalte-vorkommen-texte";

/**
 * Spalte 3 des Reiters „Vorkommen“ (WI-0254, Runde 3; Mockup): „Verbreitung und Herkunft“, also die Orte, Gebiete, Landschaften und
 * Kontinente, an denen ein Eintrag vorkommt, dazu seine Regeln.
 *
 * - 🔴 **Das Ziel ist ein Wiki-Artikel ODER ein Name, nie ein Kartenobjekt an sich:** Gewählt wird ein Kartenobjekt, dem ein Wiki-Schlüssel
 *   zugewiesen ist, oder ein Kontinentbegriff („gilt überall“); der Server schreibt den Schlüssel. Ein Objekt ohne Schlüssel ist kein Ziel. Ein
 *   freier Name bleibt ausdrücklich ungeklärt („ungeklärt übernehmen“, Vali wählte B am Gate WI-0254, Migration 0235): ohne Schlüssel, ohne Treffer,
 *   später von Hand zu prüfen.
 * - **Die Rolle der Zeile** (Migration 0247, WI-0253 §23): Nur `ort` trifft Kartenobjekte. Eine Zeile mit anderer Rolle (Bezugspunkt, Landschaftsart, andere Welt …) bleibt als Link
 *   gespeichert, nennt ihre Rolle als Pille und sagt, dass sie auf der Karte nicht trifft – statt als „ungeklärt“ dazustehen. Die Rolle ist hier nur zu lesen.
 * - **Treffer-Vorschau:** Jede Zeile nennt die Kartenobjekte, die ihr Wiki-Artikel trifft (abgeleitet, nie von Hand gesetzt); bei einer neuen
 *   Zeile rechnet sie der Server erst beim Speichern.
 * - **Lösen** legt still: eine Zeile aus Legacy oder dem Wiki wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst; beide
 *   stehen unter „Unterdrückte und gelöste anzeigen“ und lassen sich wiederherstellen.
 * - **Regelvorkommen** stehen darunter (`inhalte-vorkommen-regeln.vue`, Regeleditor, WI-0254 `--weiter`): als Karten mit dem Satz der Regel, dazu die Vorschläge des Wikis und der Editor. Sie werden noch
 *   nicht ausgewertet (WI-0253): Eine Regel trifft hier kein Kartenobjekt, und ein direkter Bezug wird nie zu einer Regel.
 */
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: []; alsText: [] }>();

const s = props.steuerung;
const eintrag = computed(() => s.eintrag.value);
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

const neueBeziehung = ref<InhalteVorkommenBeziehung>("verbreitung");
const beziehungen = computed(() => INHALTE_VORKOMMEN_BEZIEHUNGEN.map((wert) => ({ wert, text: beziehungName(wert) })));
const alsBeziehung = (wert: string): InhalteVorkommenBeziehung =>
    (INHALTE_VORKOMMEN_BEZIEHUNGEN as readonly string[]).includes(wert)
        ? (wert as InhalteVorkommenBeziehung)
        : "verbreitung";

function haengeAn(ziel: InhalteVorkommenZiel): void {
    s.haengeZielAn(ziel, neueBeziehung.value);
    s.leereZiele();
}
function ersteAnhaengen(): void {
    const erstes = s.zielTreffer.value[0];
    if (erstes !== undefined) haengeAn(erstes);
}
function haengeNamenAn(): void {
    s.haengeNamenAn(s.zielText.value, neueBeziehung.value);
    s.leereZiele();
}

const nummer = (index: number): string => String(index + 1).padStart(2, "0");
/** Der Platz einer Zeile unter den aktiven (für die Nummer); eine stille hat keinen. */
const platz = (o: EntwurfOrt): number => aktive.value.findIndex((a) => a.schluessel === o.schluessel);

/** Nur die Rolle `ort` trifft; jede andere ist bewusst kein Ort der Karte (der Abgleich des WikiSync hat sie so bestimmt). */
const keinOrt = (o: EntwurfOrt): boolean => !trifftAufDerKarte(o);

/** Die erste Zeile unter dem Namen: die Art des Ziels (Mockup „→ Art · zugeordnet“). */
function zielSatz(o: EntwurfOrt): string {
    if (keinOrt(o)) return t("inhalte.vorkommen.ort.keinOrt");
    if (o.keyClass === "continent") return t("inhalte.vorkommen.ort.kontinent");
    if (o.neu && o.ziel !== undefined && "kind" in o.ziel)
        return t("inhalte.literatur.ort.zugeordnet", { art: kindName(o.ziel.kind) });
    const erster = o.treffer[0];
    if (o.targetState === "resolved" && erster !== undefined)
        return t("inhalte.literatur.ort.zugeordnet", { art: kindName(erster.kind) });
    if (o.targetState === "ambiguous")
        return t("inhalte.vorkommen.ort.mehrere", { n: formatNumber(o.trefferGesamt, 0) });
    return t("inhalte.vorkommen.ort.ungeklaert");
}

/**
 * Die zweite Zeile: was die Zeile ist, in einem Satz (Mockup „relationMeta“). Eine Zeile ohne Besonderheit hat keinen: Ihre Herkunft zeigt schon die Pille
 * (Betreiber, 27.10.).
 */
function metaSatz(o: EntwurfOrt): string | undefined {
    if (o.state === "suppressed") return t("inhalte.verwendung.unterdrueckt");
    if (o.state === "retired") return t("inhalte.verwendung.geloest");
    if (o.neu) return t("inhalte.verwendung.neu");
    if (keinOrt(o)) return t("inhalte.vorkommen.ort.meta.rolle");
    if (o.wikiKey === null) return t("inhalte.literatur.ort.meta.ungeklaert");
    if (o.targetState === "unmatched") return t("inhalte.vorkommen.ort.meta.keinTraeger");
    return undefined;
}

/** Die Treffer-Vorschau: die Kartenobjekte, die der Wiki-Artikel der Zeile trifft. */
function trefferSatz(o: EntwurfOrt): string {
    // Ein Name ist nie ein Schlüssel: Er trifft nie ein Kartenobjekt, auch nicht nach dem Speichern.
    if (o.wikiKey === null) return t("inhalte.vorkommen.ort.trefferName");
    if (keinOrt(o)) return t("inhalte.vorkommen.ort.trefferRolle");
    if (o.neu) return t("inhalte.vorkommen.ort.trefferNeu");
    if (o.keyClass === "continent") return t("inhalte.vorkommen.ort.trefferUeberall");
    if (o.treffer.length === 0) return t("inhalte.vorkommen.ort.trefferKeine");
    const namen = o.treffer.map((treffer) => treffer.name).join(" · ");
    const mehr = o.trefferGesamt - o.treffer.length;
    return mehr > 0
        ? t("inhalte.vorkommen.ort.trefferMehr", { namen, n: formatNumber(mehr, 0) })
        : t("inhalte.vorkommen.ort.treffer", { namen });
}

const ursprungName = (ursprung: "wiki" | "manual" | "legacy"): string =>
    t(`inhalte.ursprung.${ursprung}` as MessageKey);
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('inhalte.vorkommen.orte.titel') + (eintrag ? ` (${formatNumber(aktive.length, 0)})` : '')"
        :unterzeile="eintrag ? t('inhalte.vorkommen.orte.unterzeile') : undefined"
        testid="inhalte-spalte-verwendungen"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-stamm" @click="emit('zurueck')">{{
                t("inhalte.zurueck.stamm")
            }}</AvmKnopf>
        </template>

        <p v-if="!eintrag" class="orte__leise" data-testid="inhalte-verwendungen-leer">
            {{ t("inhalte.vorkommen.stamm.leer") }}
        </p>

        <template v-else>
            <p class="orte__leise">{{ t("inhalte.vorkommen.orte.hilfe") }}</p>

            <div v-if="darfSchreiben" class="orte__neu" data-testid="inhalte-verwendungen-neu">
                <div class="orte__zeile">
                    <AvmEingabe
                        v-model="s.zielText.value"
                        art="suche"
                        :placeholder="t('inhalte.vorkommen.orte.suche.platzhalter')"
                        :aria-label="t('inhalte.vorkommen.orte.suche.beschriftung')"
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
                        ＋ {{ t("inhalte.vorkommen.orte.knopf") }}
                    </AvmKnopf>
                </div>
                <label class="orte__art">
                    <span>{{ t("inhalte.verwendungen.zuordnung") }}</span>
                    <AvmAuswahl
                        :model-value="neueBeziehung"
                        groesse="zeile"
                        :optionen="beziehungen"
                        :gesperrt="gesperrt"
                        testid="inhalte-ziel-art"
                        @update:model-value="(wert: string) => (neueBeziehung = alsBeziehung(wert))"
                    />
                </label>
                <p v-if="s.zielLaedt.value" class="orte__leise">{{ t("inhalte.laedt") }}</p>
                <p
                    v-else-if="s.zielText.value.trim().length >= 2 && s.zielTreffer.value.length === 0"
                    class="orte__leise"
                    data-testid="inhalte-ziel-keiner"
                >
                    {{ t("inhalte.vorkommen.orte.keinTreffer") }}
                </p>
                <ul v-if="s.zielText.value.trim().length >= 2" class="orte__treffer" data-testid="inhalte-ziel-treffer">
                    <li v-for="ziel in s.zielTreffer.value" :key="zielKennung(ziel)">
                        <button
                            type="button"
                            class="orte__treffer-knopf"
                            data-testid="inhalte-ziel"
                            @click="haengeAn(ziel)"
                        >
                            <span class="orte__vorschlag">
                                <span class="orte__name">{{ ziel.name }}</span>
                                <span class="orte__schluessel">{{ ziel.wikiKey }}</span>
                            </span>
                            <AvmPille>{{ zielArtName(ziel) }}</AvmPille>
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
                                <span>＋ {{ t("inhalte.vorkommen.orte.roh", { name: s.zielText.value.trim() }) }}</span>
                                <span class="orte__leise">{{ t("inhalte.vorkommen.orte.roh.hinweis") }}</span>
                            </span>
                        </button>
                    </li>
                </ul>
                <p class="orte__leise">{{ t("inhalte.vorkommen.orte.zielHilfe") }}</p>
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
                    :data-relation="o.relation"
                >
                    <span class="karte__nr" aria-hidden="true">{{ o.state === "active" ? nummer(platz(o)) : "" }}</span>
                    <div class="karte__haupt">
                        <div class="karte__titel">{{ o.name === "" ? t("inhalte.verwendung.ohneName") : o.name }}</div>
                        <div class="karte__meta">{{ zielSatz(o) }}</div>
                        <div v-if="metaSatz(o)" class="karte__meta" data-testid="inhalte-ort-meta">
                            {{ metaSatz(o) }}
                        </div>
                        <div v-if="o.state === 'active'" class="karte__treffer" data-testid="inhalte-ort-treffer">
                            {{ trefferSatz(o) }}
                        </div>
                        <div class="karte__chips">
                            <AvmPille data-testid="inhalte-ort-beziehung">{{ beziehungName(o.relation) }}</AvmPille>
                            <AvmPille
                                v-if="keinOrt(o)"
                                :title="t('inhalte.vorkommen.ort.trefferRolle')"
                                testid="inhalte-ort-rolle"
                                >{{ rolleName(o.rolle) }}</AvmPille
                            >
                            <AvmPille :ton="o.ursprung === 'manual' ? 'warnung' : 'neutral'">{{
                                ursprungName(o.ursprung)
                            }}</AvmPille>
                            <AvmPille v-if="o.state === 'suppressed'" ton="gefahr">{{
                                t("inhalte.verwendung.chip.unterdrueckt")
                            }}</AvmPille>
                            <AvmPille v-else-if="o.state === 'retired'" ton="warnung">{{
                                t("inhalte.verwendung.chip.geloest")
                            }}</AvmPille>
                        </div>
                        <div v-if="o.state !== 'active' && darfSchreiben" class="karte__fuss">
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="gesperrt"
                                testid="inhalte-ort-wieder"
                                @click="s.stelleOrtHer(o.schluessel)"
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
                        @click="s.loeseOrt(o.schluessel)"
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

            <InhalteVorkommenRegeln
                :steuerung="steuerung"
                :darf-schreiben="darfSchreiben"
                :gesperrt="gesperrt"
                @als-text="emit('alsText')"
            />
            <AvmHinweis>{{ t("inhalte.vorkommen.orte.wirkung") }}</AvmHinweis>
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

.orte__vorschlag {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

.orte__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.orte__schluessel {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
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

.karte__nr {
    flex: none;
    width: var(--space-20);
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

/* Die Treffer-Vorschau: abgesetzt von den Angaben zur Zeile, damit „was die Zeile ist“ und „was sie trifft“ nicht verschwimmen. */
.karte__treffer {
    margin-top: var(--space-2);
    color: var(--color-text);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
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
    .orte__treffer-knopf {
        transition: none;
    }
}
</style>
