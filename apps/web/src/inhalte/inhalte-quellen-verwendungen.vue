<script setup lang="ts">
import { computed, ref } from "vue";
import { SOURCE_REFERENCE_KINDS, type InhalteZiel, type SourceReferenceKind } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InfoCanonPill from "../info-panel/info-canon-pill.vue";
import { canonPillOf } from "../info-panel/panel-header";
import { aktiveVerwendungen, schluesselVon, type EntwurfVerwendung } from "./inhalte-quellen-modell";
import type { QuellenSteuerung } from "./inhalte-quellen-steuerung";
import { wikiAnzeige } from "./wiki-klartext";

/**
 * Spalte 3 des Reiters „Quellen“ (WI-0254; Mockup): die Verwendungen der Quelle, also die Träger, die sich auf sie berufen.
 *
 * - **Anhängen** nur über einen echten Treffer (Ort, Herrschaftsgebiet, Landschaft, Gipfel): Der Treffer trägt die öffentliche Kennung des
 *   Objekts, nie ein Name als Schlüssel. Ein freier Name wird nicht angehängt; im Datenmodell gibt es keinen „ungeklärten“ Träger.
 * - **Je Verwendung:** der Name, die Art des Trägers, die Herkunft, das Kanon-Etikett des Trägers (Rang 1 bis 4 der Regel, vom Server
 *   gerechnet), die Art des Belegs, die Fundstelle (Seiten) und eine Notiz. Fundstelle und Notiz gehören der Verknüpfung, nicht der Quelle.
 * - **Lösen** legt still: eine Verknüpfung aus Legacy wird unterdrückt (der Zug belebt sie nie wieder), eine eigene gelöst; beide stehen
 *   unter „Unterdrückte / gelöste anzeigen“ und lassen sich wiederherstellen.
 * - **Ein Weg ist immer die ganze Straße** (Betreiber 2026-10-28): Er steht als Zeile da wie jede andere und lässt sich genauso ändern, lösen und holen; die Suche findet Wege
 *   mit (`wege`), je Straße einmal. Abschnitte sind ein technisches Detail und kommen hier nie vor.
 */
const props = defineProps<{
    steuerung: QuellenSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: [] }>();

const s = props.steuerung;
const quelle = computed(() => s.quelle.value);
const stand = computed(() => s.stand.value);
const alle = computed(() => stand.value?.verwendungen ?? []);
const aktive = computed(() => (stand.value === undefined ? 0 : aktiveVerwendungen(stand.value)));
const stille = computed(() => alle.value.filter((v) => v.state !== "active"));
const zeigeStille = ref(false);
const sichtbar = computed(() => alle.value.filter((v) => v.state === "active" || zeigeStille.value));
const abgeschnitten = computed(() =>
    Math.max(0, (quelle.value?.verwendungenGesamt ?? 0) - alle.value.filter((v) => v.state === "active").length),
);

/** Warum nichts änderbar ist, steht in der Spalte Stammdaten EINMAL; hier bleibt es still gesperrt (leerer Satz). */
const gesperrt = computed<string | undefined>(() =>
    !props.darfSchreiben || stand.value?.felder.aktiv === false ? "" : undefined,
);

/**
 * Die Notiz an einer Verwendung kommt roh aus dem Wiki (Links und Vorlagen wie `{{R5}}` oder `{{Datum|1030|||}}`). Sie zeigt den Text, solange sie dem Stand des
 * Servers gleicht (`quelle`, nicht der Entwurf); wer tippt, speichert seinen Text (`wikiAnzeige`). Eine im Entwurf neu angehängte Verwendung hat keinen
 * Stand, ihre Notiz zeigt, was getippt wurde.
 */
const gespeicherteNotizen = computed(
    () => new Map((quelle.value?.verwendungen ?? []).map((v) => [schluesselVon(v), v.note ?? ""] as const)),
);
const notizText = (v: EntwurfVerwendung): string =>
    wikiAnzeige(v.note, gespeicherteNotizen.value.get(schluesselVon(v)));

const KIND_NAMEN: Readonly<Record<string, MessageKey>> = {
    place: "inhalte.kind.place",
    territory: "inhalte.kind.territory",
    area: "inhalte.kind.area",
    peak: "inhalte.kind.peak",
    path: "inhalte.kind.path",
};
const kindName = (kind: string): string => t(KIND_NAMEN[kind] ?? "inhalte.kind.place");

const BEZUG_NAMEN: Readonly<Record<SourceReferenceKind, MessageKey>> = {
    ausfuehrlich: "inhalte.bezug.ausfuehrlich",
    ergaenzend: "inhalte.bezug.ergaenzend",
    erwaehnung: "inhalte.bezug.erwaehnung",
};
const bezugOptionen = computed(() => [
    { wert: "quelle", text: t("inhalte.bezug.quelle") },
    ...SOURCE_REFERENCE_KINDS.map((art) => ({ wert: art, text: t(BEZUG_NAMEN[art]) })),
]);
const bezugWert = (art: SourceReferenceKind | null): string => art ?? "quelle";
const alsBezug = (wert: string): SourceReferenceKind | null =>
    (SOURCE_REFERENCE_KINDS as readonly string[]).includes(wert) ? (wert as SourceReferenceKind) : null;

const neueArt = ref("quelle");
function haengeAn(ziel: InhalteZiel): void {
    s.haengeZielAn(ziel, alsBezug(neueArt.value));
    s.leereZiele();
}
function ersteAnhaengen(): void {
    const erstes = s.zielTreffer.value[0];
    if (erstes !== undefined) haengeAn(erstes);
}

/**
 * Die Zeile unter dem Namen: der Zustand der Verknüpfung in einem Satz. Eine aktive, nicht neue Zeile hat keinen: Ihre Herkunft zeigt schon die Pille,
 * ein Satz, der nur die Herkunft nennt, fällt weg (Betreiber, 27.10.).
 */
function herkunftSatz(v: EntwurfVerwendung): string | undefined {
    if (v.state === "suppressed") return t("inhalte.verwendung.unterdrueckt");
    if (v.state === "retired") return t("inhalte.verwendung.geloest");
    if (v.neu) return t("inhalte.verwendung.neu");
    return undefined;
}
const nummer = (index: number): string => String(index + 1).padStart(2, "0");
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="t('inhalte.verwendungen.titel') + (quelle ? ` (${formatNumber(aktive, 0)})` : '')"
        :unterzeile="quelle ? t('inhalte.verwendungen.unterzeile') : undefined"
        testid="inhalte-spalte-verwendungen"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-stamm" @click="emit('zurueck')">{{
                t("inhalte.zurueck.stamm")
            }}</AvmKnopf>
        </template>

        <p v-if="!quelle" class="verw__leise" data-testid="inhalte-verwendungen-leer">{{ t("inhalte.stamm.leer") }}</p>

        <template v-else>
            <p class="verw__leise">{{ t("inhalte.verwendungen.hilfe") }}</p>

            <div v-if="darfSchreiben" class="verw__neu" data-testid="inhalte-verwendungen-neu">
                <div class="verw__zeile">
                    <AvmEingabe
                        v-model="s.zielText.value"
                        art="suche"
                        :placeholder="t('inhalte.verwendungen.suche.platzhalter')"
                        :aria-label="t('inhalte.verwendungen.suche.beschriftung')"
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
                        ＋ {{ t("inhalte.verwendungen.bezug") }}
                    </AvmKnopf>
                </div>
                <label class="verw__art">
                    <span>{{ t("inhalte.verwendungen.zuordnung") }}</span>
                    <AvmAuswahl
                        v-model="neueArt"
                        groesse="zeile"
                        :optionen="bezugOptionen"
                        :gesperrt="gesperrt"
                        testid="inhalte-ziel-art"
                    />
                </label>
                <ul v-if="s.zielTreffer.value.length > 0" class="verw__treffer" data-testid="inhalte-ziel-treffer">
                    <li v-for="ziel in s.zielTreffer.value" :key="schluesselVon(ziel)">
                        <button
                            type="button"
                            class="verw__treffer-knopf"
                            data-testid="inhalte-ziel"
                            @click="haengeAn(ziel)"
                        >
                            <span class="verw__name">{{ ziel.name }}</span>
                            <AvmPille>{{ kindName(ziel.kind) }}</AvmPille>
                        </button>
                    </li>
                </ul>
                <p v-else-if="s.zielLaedt.value" class="verw__leise">{{ t("inhalte.laedt") }}</p>
                <p
                    v-else-if="s.zielText.value.trim().length >= 2"
                    class="verw__leise"
                    data-testid="inhalte-ziel-keiner"
                >
                    {{ t("inhalte.verwendungen.keinTreffer") }}
                </p>
                <p class="verw__leise">{{ t("inhalte.verwendungen.zielHilfe") }}</p>
            </div>

            <ul v-if="sichtbar.length > 0" class="verw__karten" data-testid="inhalte-verwendungen-liste">
                <li
                    v-for="(v, index) in sichtbar"
                    :key="schluesselVon(v)"
                    class="karte"
                    :class="{ 'is-still': v.state !== 'active' }"
                    data-testid="inhalte-verwendung"
                    :data-traeger="schluesselVon(v)"
                    :data-state="v.state"
                >
                    <span class="karte__nr" aria-hidden="true">{{ nummer(index) }}</span>
                    <div class="karte__haupt">
                        <div class="karte__kopf">
                            <span class="karte__titel">{{
                                v.name === "" ? t("inhalte.verwendung.ohneName") : v.name
                            }}</span>
                        </div>
                        <div class="karte__meta">→ {{ kindName(v.kind) }}</div>
                        <div v-if="herkunftSatz(v)" class="karte__meta" data-testid="inhalte-verwendung-herkunft">
                            {{ herkunftSatz(v) }}
                        </div>
                        <div class="karte__chips">
                            <AvmPille v-if="v.referenceKind !== null">{{ t(BEZUG_NAMEN[v.referenceKind]) }}</AvmPille>
                            <AvmPille :ton="v.herkunft === 'editor' ? 'warnung' : 'neutral'">{{
                                v.herkunft === "editor" ? t("inhalte.herkunft.editor") : t("inhalte.herkunft.legacy")
                            }}</AvmPille>
                            <AvmPille v-if="v.state === 'suppressed'" ton="gefahr">{{
                                t("inhalte.verwendung.chip.unterdrueckt")
                            }}</AvmPille>
                            <AvmPille v-else-if="v.state === 'retired'" ton="warnung">{{
                                t("inhalte.verwendung.chip.geloest")
                            }}</AvmPille>
                            <AvmPille v-if="v.pages !== '' && v.state === 'active'">{{
                                t("infoPanel.sources.pages", { pages: v.pages })
                            }}</AvmPille>
                            <InfoCanonPill v-if="v.canon && canonPillOf(v.canon)" :pill="canonPillOf(v.canon)!" />
                        </div>
                        <div v-if="v.state === 'active' && v.aenderbar" class="karte__felder">
                            <label class="karte__feld">
                                <span>{{ t("inhalte.verwendung.fundstelle") }}</span>
                                <AvmEingabe
                                    :model-value="v.pages"
                                    :placeholder="t('inhalte.verwendung.fundstelle.platzhalter')"
                                    :gesperrt="gesperrt"
                                    testid="inhalte-verwendung-seiten"
                                    @update:model-value="
                                        (wert: string) => s.aendereAngaben(v.kind, v.carrierId, { pages: wert })
                                    "
                                    @change="s.feldSchluss()"
                                />
                            </label>
                            <label class="karte__feld">
                                <span>{{ t("inhalte.verwendung.art") }}</span>
                                <AvmAuswahl
                                    :model-value="bezugWert(v.referenceKind)"
                                    groesse="zeile"
                                    :optionen="bezugOptionen"
                                    :gesperrt="gesperrt"
                                    testid="inhalte-verwendung-art"
                                    @update:model-value="
                                        (wert: string) =>
                                            s.aendereAngaben(v.kind, v.carrierId, { referenceKind: alsBezug(wert) })
                                    "
                                />
                            </label>
                            <label class="karte__feld karte__feld--breit">
                                <span>{{ t("inhalte.verwendung.notiz") }}</span>
                                <AvmEingabe
                                    :model-value="notizText(v)"
                                    :gesperrt="gesperrt"
                                    testid="inhalte-verwendung-notiz"
                                    @update:model-value="
                                        (wert: string) => s.aendereAngaben(v.kind, v.carrierId, { note: wert })
                                    "
                                    @change="s.feldSchluss()"
                                />
                            </label>
                        </div>
                        <div v-else-if="v.state !== 'active' && v.aenderbar && darfSchreiben" class="karte__fuss">
                            <AvmKnopf
                                groesse="zeile"
                                :gesperrt="gesperrt"
                                testid="inhalte-verwendung-wieder"
                                @click="s.stelleHer(v.kind, v.carrierId)"
                            >
                                ↺ {{ t("inhalte.verwendung.wiederherstellen") }}
                            </AvmKnopf>
                        </div>
                    </div>
                    <AvmKnopf
                        v-if="v.state === 'active' && v.aenderbar && darfSchreiben"
                        groesse="zeile"
                        class="karte__weg"
                        :gesperrt="gesperrt"
                        :title="t('inhalte.verwendung.loesen')"
                        :aria-label="t('inhalte.verwendung.loesenName', { name: v.name })"
                        testid="inhalte-verwendung-loesen"
                        @click="s.loese(v.kind, v.carrierId)"
                    >
                        ✕
                    </AvmKnopf>
                </li>
            </ul>
            <p v-else class="verw__leise" data-testid="inhalte-verwendungen-keine">
                {{ t("inhalte.verwendungen.keine") }}
            </p>
            <p v-if="abgeschnitten > 0" class="verw__leise" data-testid="inhalte-verwendungen-mehr">
                {{ t("inhalte.verwendungen.abgeschnitten", { n: formatNumber(abgeschnitten, 0) }) }}
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
            <AvmHinweis>{{ t("inhalte.verwendungen.wirkung") }}</AvmHinweis>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.verw__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.verw__neu {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding-bottom: var(--space-8);
    border-bottom: 1px solid var(--color-divider);
}

.verw__zeile {
    display: flex;
    gap: var(--space-6);
}

.verw__zeile > :first-child {
    flex: 1 1 auto;
    min-width: 0;
}

.verw__art {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.verw__treffer {
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

.verw__treffer li + li {
    border-top: 1px solid var(--color-divider);
}

.verw__treffer-knopf {
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

.verw__treffer-knopf:hover {
    background: var(--color-hover-wash);
}

.verw__treffer-knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.verw__name {
    min-width: 0;
    overflow-wrap: anywhere;
}

.verw__karten {
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

.karte__chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin-top: var(--space-4);
}

.karte__felder {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
    margin-top: var(--space-6);
}

.karte__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.karte__feld--breit {
    grid-column: 1 / -1;
}

.karte__fuss {
    margin-top: var(--space-6);
}

.karte__weg {
    flex: none;
}
</style>
