<script setup lang="ts">
import { computed, nextTick, ref, useId, useTemplateRef } from "vue";
import {
    AVENTURIA_CARTOGRAPHY,
    WIKISYNC_KLIMAZONEN,
    type InhalteVorkommenFlaeche,
    type InhalteVorkommenLageOrt,
    type InhalteVorkommenUmriss,
    type WikisyncRegelBedingung,
} from "@avesmaps3d/shared";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPillenknopf from "../controls/avm-pillenknopf.vue";
import { t } from "../i18n/i18n";
import WikisyncPillenWahl from "../wikisync/wikisync-pillen-wahl.vue";
import { alleVonPillen, bedingungKurz, ebeneName, landschaftName, zoneName } from "../wikisync/wikisync-regeln-text";
import InhalteRegelLage from "./inhalte-regel-lage.vue";
import { lageStand, setzeLage, type EditorBedingung, type LageEntwurf } from "./inhalte-regel-lage";
import { bedingungLeer } from "./inhalte-vorkommen-regeln-modell";

/**
 * Eine Bedingung im Regeleditor (WI-0254 `--weiter`; Entwurf `d-editor.js`): vier weglassbare Felder in der Folge des Satzes, jedes mit „leer = keine Einschränkung“.
 *
 * - **Landschaftsart** (mehrere = ODER): die Auswahl der Begriffstafel (`wikisync-pillen-wahl.vue`) ohne die Klimazonen; die hat der Streifen.
 * - **innerhalb von:** eine Fläche, gesucht auf dem Server (aktive Landschaften außerhalb der Klima-Ebene). Eine Fläche, die es noch nicht gibt (`!`, der Artikel wartet auf sie),
 *   bleibt stehen, bis eine vorhandene gewählt wird; nichts wird geraten.
 * - **Lage zu einer Linie** (`inhalte-regel-lage.vue`): eine Richtung und ein oder zwei Orte, dazu der Satz und eine Skizze; erst fertig gilt sie, ein halber Stand bleibt in der Bedingung (`lageEntwurf`) und sperrt
 *   „Regel übernehmen“.
 * - **innerhalb der Klimazone:** acht Bänder von Norden nach Süden in den Farben der Karte; zwei Klicks ziehen die Spanne auf („egal“ löscht sie).
 * - Die Bedingung ändert nichts selbst: Sie meldet die geänderte Fassung (`update:bedingung`); der Editor trägt sie ein.
 * - Zugeklappt steht sie als Zeile da, die Fläche und die Klimazone gehören in den Satz.
 */
const props = defineProps<{
    bedingung: EditorBedingung;
    /** Die Nummer in der Kette, ab 1. */
    nummer: number;
    zu: boolean;
    /** Eine Kette hat mindestens eine Bedingung: die letzte lässt sich nicht entfernen. */
    darfWeg: boolean;
    flaechenTreffer: readonly InhalteVorkommenFlaeche[];
    flaechenLaedt: boolean;
    /** Wie viele Treffer die Suche höchstens liefert: Ist die Liste so lang, gibt es vermutlich weitere. */
    flaechenMax: number;
    /** Die Orte, die die Suche der Lage fand, und wie viele sie höchstens liefert. */
    orteTreffer: readonly InhalteVorkommenLageOrt[];
    orteLaedt: boolean;
    orteMax: number;
    /** Der Umriss Aventuriens für die Skizze der Lage; `undefined`, solange er fehlt. */
    umriss: InhalteVorkommenUmriss | undefined;
}>();
const emit = defineEmits<{
    "update:bedingung": [bedingung: EditorBedingung];
    umschalten: [];
    entfernen: [];
    suche: [text: string];
    orteSuche: [text: string];
    umrissLaden: [];
}>();

const name = computed(() => t("inhalte.vorkommen.regeleditor.bedingung", { n: props.nummer }));
const leer = computed(() => bedingungLeer(props.bedingung));
const aendere = (teil: Partial<WikisyncRegelBedingung>): void =>
    emit("update:bedingung", { ...props.bedingung, ...teil });
const aendereLage = (stand: LageEntwurf): void => emit("update:bedingung", setzeLage(props.bedingung, stand));

// --- Landschaftsarten ---
const artenOptionen = computed(() => alleVonPillen().filter((option) => option.ebene !== "klima"));
const artenVergeben = computed(() => props.bedingung.arten.map((a) => `${a.ebene}|${a.art}`));
function waehleArt(pille: string): void {
    const trenner = pille.indexOf("|");
    const ebene = pille.slice(0, trenner);
    const art = pille.slice(trenner + 1);
    if (props.bedingung.arten.some((a) => a.ebene === ebene && a.art === art)) return;
    aendere({ arten: [...props.bedingung.arten, { ebene, art }] });
}
const nimmArtWeg = (ebene: string, art: string): void =>
    aendere({ arten: props.bedingung.arten.filter((a) => !(a.ebene === ebene && a.art === art)) });

// --- Fläche ---
const flaeche = computed(() => props.bedingung.flaeche);
const flaecheOffen = computed(() => flaeche.value?.offen === true);
const flaecheTitel = computed(() => flaeche.value?.titel ?? flaeche.value?.name ?? "");
const flaecheHinweis = computed(() => {
    const f = flaeche.value;
    if (f === null || !f.offen) return undefined;
    return f.kandidat === null
        ? t("admin.wikisync.regeln.flaecheFehlt", { name: flaecheTitel.value })
        : t("admin.wikisync.regeln.flaecheKandidat", { name: flaecheTitel.value, kandidat: f.kandidat });
});
/** Was die Suche zu den gewählten Flächen weiß (für den Hinweis am Zeichen): Ebene, Art und Wiki-Artikel. */
const bekannt = ref(new Map<string, InhalteVorkommenFlaeche>());
function flaechenMeta(f: InhalteVorkommenFlaeche): string {
    return [ebeneName(f.ebene), f.art === undefined ? "" : landschaftName(f.art)].filter((x) => x !== "").join(" · ");
}
const flaecheHinweisZeichen = computed(() => {
    const f = flaeche.value;
    if (f === null) return undefined;
    if (f.offen) return t("inhalte.vorkommen.regeleditor.wartetErst");
    const k = f.kennung === null ? undefined : bekannt.value.get(f.kennung);
    if (k === undefined)
        return f.titel === null ? undefined : t("inhalte.vorkommen.regeleditor.flaecheMitWiki", { titel: f.titel });
    return [
        flaechenMeta(k),
        k.wikiTitel === undefined
            ? t("inhalte.vorkommen.regeleditor.flaecheOhneWiki")
            : t("inhalte.vorkommen.regeleditor.flaecheMitWiki", { titel: k.wikiTitel }),
    ].join(" · ");
});

const flaecheText = ref("");
const flaecheMenue = ref(false);
const flaecheAktiv = ref(0);
const flaecheListeId = useId();
const flaecheHuelle = useTemplateRef<HTMLElement>("flaecheHuelle");
const flaecheListe = useTemplateRef<HTMLElement>("flaecheListe");
const flaecheOben = ref(false);
const flaechePlatz = ref<number | null>(null);
const flaecheOptionId = (i: number): string => `${flaecheListeId}-${String(i)}`;
const zeigeMenue = computed(() => flaecheMenue.value && flaecheText.value.trim().length >= 2);
const keineTreffer = computed(() => zeigeMenue.value && !props.flaechenLaedt && props.flaechenTreffer.length === 0);

/** Wie hoch die Liste höchstens wird (in der Schrift der Liste) und der Abstand zum Rand des Rollbereichs, den sie nicht unterschreitet (px). */
const MAX_HOEHE_EM = 22;
const RAND = 8;
/** Wohin sich die Liste öffnet: unter das Feld, wenn sie in den Rollbereich passt, sonst darüber; reicht es nirgends, auf den größeren Platz gekürzt (wie `wikisync-pillen-wahl.vue`). */
function platziere(): void {
    flaecheOben.value = false;
    flaechePlatz.value = null;
    void nextTick(() => {
        const wurzel = flaecheHuelle.value;
        const box = flaecheListe.value;
        if (wurzel === null || box === null) return;
        const feld = wurzel.getBoundingClientRect();
        let oberkante = 0;
        let unterkante = globalThis.innerHeight;
        for (let el = wurzel.parentElement; el !== null; el = el.parentElement) {
            if (!/auto|scroll|hidden|clip/u.test(getComputedStyle(el).overflowY)) continue;
            const rand = el.getBoundingClientRect();
            oberkante = Math.max(oberkante, rand.top);
            unterkante = Math.min(unterkante, rand.bottom);
        }
        const schrift = Number.parseFloat(getComputedStyle(box).fontSize) || 14;
        const abstand = Math.max(box.offsetTop - wurzel.offsetHeight, 0);
        const unten = unterkante - feld.bottom - abstand - RAND;
        const drueber = feld.top - oberkante - abstand - RAND;
        const wunsch = Math.min(box.scrollHeight, MAX_HOEHE_EM * schrift, globalThis.innerHeight * 0.6);
        const mindest = 6 * schrift;
        if (unten >= wunsch) return;
        if (drueber > unten) {
            flaecheOben.value = true;
            flaechePlatz.value = drueber >= wunsch ? null : Math.max(drueber, mindest);
        } else flaechePlatz.value = Math.max(unten, mindest);
    });
}

function oeffneMenue(): void {
    const warZu = !flaecheMenue.value;
    flaecheMenue.value = true;
    flaecheAktiv.value = 0;
    if (warZu) platziere();
}
function tippe(event: Event): void {
    oeffneMenue();
    emit("suche", (event.target as HTMLInputElement).value);
}
function schliesseMenue(): void {
    flaecheMenue.value = false;
}
function waehleFlaeche(f: InhalteVorkommenFlaeche | undefined): void {
    if (f === undefined) return;
    bekannt.value = new Map(bekannt.value).set(f.kennung, f);
    aendere({
        flaeche: { name: f.name, kennung: f.kennung, offen: false, titel: f.wikiTitel ?? null, kandidat: null },
    });
    flaecheText.value = "";
    flaecheMenue.value = false;
    emit("suche", "");
}
function zeigeAktiv(): void {
    void nextTick(() =>
        document.getElementById(flaecheOptionId(flaecheAktiv.value))?.scrollIntoView({ block: "nearest" }),
    );
}
function flaechenTaste(event: KeyboardEvent): void {
    if (event.isComposing) return;
    if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!flaecheMenue.value) oeffneMenue();
        else flaecheAktiv.value = Math.min(flaecheAktiv.value + 1, Math.max(props.flaechenTreffer.length - 1, 0));
        zeigeAktiv();
    } else if (event.key === "ArrowUp") {
        event.preventDefault();
        flaecheAktiv.value = Math.max(flaecheAktiv.value - 1, 0);
        zeigeAktiv();
    } else if (event.key === "Enter") {
        if (zeigeMenue.value && props.flaechenTreffer.length > 0) {
            event.preventDefault();
            waehleFlaeche(props.flaechenTreffer[flaecheAktiv.value]);
        }
    } else if (event.key === "Escape" && flaecheMenue.value) {
        // Escape gilt dem Feld, nicht dem Fenster.
        event.preventDefault();
        event.stopPropagation();
        schliesseMenue();
    }
}

// --- Klima ---
/** Der erste Klick eines Paars hat die Spanne begonnen; der zweite zieht sie auf. */
const klimaBegonnen = ref(false);
const zonenIndex = (zone: string): number => WIKISYNC_KLIMAZONEN.indexOf(zone as (typeof WIKISYNC_KLIMAZONEN)[number]);
const klimaVon = computed(() => {
    const k = props.bedingung.klima;
    return k === null ? -1 : Math.min(zonenIndex(k.von), zonenIndex(k.bis));
});
const klimaBis = computed(() => {
    const k = props.bedingung.klima;
    return k === null ? -1 : Math.max(zonenIndex(k.von), zonenIndex(k.bis));
});
const zonen = computed(() =>
    WIKISYNC_KLIMAZONEN.map((zone, index) => ({
        zone,
        name: zoneName(zone),
        farbe: AVENTURIA_CARTOGRAPHY.climateZones[zone],
        innen: klimaVon.value >= 0 && index >= klimaVon.value && index <= klimaBis.value,
        ende: klimaVon.value >= 0 && (index === klimaVon.value || index === klimaBis.value),
    })),
);
function klimaKlick(zone: string): void {
    if (!klimaBegonnen.value || props.bedingung.klima === null) {
        klimaBegonnen.value = true;
        aendere({ klima: { von: zone, bis: zone } });
        return;
    }
    klimaBegonnen.value = false;
    const a = zonenIndex(props.bedingung.klima.von);
    const b = zonenIndex(zone);
    const [von, bis] = a <= b ? [a, b] : [b, a];
    aendere({ klima: { von: WIKISYNC_KLIMAZONEN[von] ?? zone, bis: WIKISYNC_KLIMAZONEN[bis] ?? zone } });
}
function klimaEgal(): void {
    klimaBegonnen.value = false;
    aendere({ klima: null });
}
const klimaText = computed(() => {
    const k = props.bedingung.klima;
    if (k === null) return t("inhalte.vorkommen.regeleditor.klimaEgal");
    return k.von === k.bis ? zoneName(k.von) : `${zoneName(k.von)} — ${zoneName(k.bis)}`;
});
</script>

<template>
    <section
        class="rb"
        :class="{ 'is-zu': zu, 'is-leer': leer }"
        :data-term="nummer - 1"
        data-testid="inhalte-regel-bedingung"
    >
        <header class="rb__kopf">
            <button
                type="button"
                class="rb__titel"
                :aria-expanded="!zu"
                :title="
                    zu
                        ? t('inhalte.vorkommen.regeleditor.bedingungAuf')
                        : t('inhalte.vorkommen.regeleditor.bedingungZu')
                "
                data-testid="inhalte-regel-bedingung-umschalten"
                @click="emit('umschalten')"
            >
                <span class="rb__pfeil" aria-hidden="true">{{ zu ? "▸" : "▾" }}</span>
                <span class="rb__name">{{ name }}</span>
                <span v-if="zu" class="rb__kurz einzeilig">{{ bedingungKurz(bedingung) }}</span>
            </button>
            <AvmKnopf
                groesse="zeile"
                :gesperrt="darfWeg ? undefined : ''"
                :title="t('inhalte.vorkommen.regeleditor.bedingungWeg')"
                :aria-label="`${name}: ${t('inhalte.vorkommen.regeleditor.bedingungWeg')}`"
                testid="inhalte-regel-bedingung-weg"
                @click="emit('entfernen')"
                >✕</AvmKnopf
            >
        </header>

        <div v-if="!zu" class="rb__koerper">
            <div class="rb__paar">
                <div class="rb__feld">
                    <div class="rb__feldkopf">
                        <span class="rb__feldname">{{ t("inhalte.vorkommen.regeleditor.feldArt") }}</span>
                        <span class="rb__hinweis">{{ t("inhalte.vorkommen.regeleditor.feldArtHinweis") }}</span>
                    </div>
                    <WikisyncPillenWahl
                        class="rb__wahl"
                        :vergeben="artenVergeben"
                        :optionen="artenOptionen"
                        :platzhalter="t('inhalte.vorkommen.regeleditor.artSuche')"
                        :beschriftung="`${t('inhalte.vorkommen.regeleditor.feldArt')} ${String(nummer)}`"
                        testid="inhalte-regel-art"
                        @waehle="waehleArt"
                    />
                    <span v-if="bedingung.arten.length > 0" class="rb__zeichen">
                        <AvmPillenknopf
                            v-for="a in bedingung.arten"
                            :key="`${a.ebene}|${a.art}`"
                            :title="ebeneName(a.ebene)"
                            testid="inhalte-regel-art-weg"
                            @click="nimmArtWeg(a.ebene, a.art)"
                            >{{ landschaftName(a.art) }}<template #zeichen>✕</template></AvmPillenknopf
                        >
                    </span>
                </div>

                <div class="rb__feld">
                    <div class="rb__feldkopf">
                        <span class="rb__feldname">{{ t("inhalte.vorkommen.regeleditor.feldFlaeche") }}</span>
                        <span class="rb__hinweis">{{ t("inhalte.vorkommen.regeleditor.feldFlaecheHinweis") }}</span>
                    </div>
                    <span ref="flaecheHuelle" class="rb__wahl rb__flaeche">
                        <AvmEingabe
                            v-model="flaecheText"
                            role="combobox"
                            aria-autocomplete="list"
                            :aria-expanded="zeigeMenue"
                            :aria-controls="flaecheListeId"
                            :aria-activedescendant="
                                zeigeMenue && flaechenTreffer.length > 0 ? flaecheOptionId(flaecheAktiv) : undefined
                            "
                            :aria-label="`${t('inhalte.vorkommen.regeleditor.feldFlaeche')} ${String(nummer)}`"
                            :placeholder="
                                flaecheOffen
                                    ? t('inhalte.vorkommen.regeleditor.wartetWaehlen')
                                    : t('inhalte.vorkommen.regeleditor.flaecheSuche')
                            "
                            autocomplete="off"
                            testid="inhalte-regel-flaeche"
                            @focus="oeffneMenue"
                            @input="tippe"
                            @blur="schliesseMenue"
                            @keydown="flaechenTaste"
                        />
                        <ul
                            v-if="zeigeMenue"
                            :id="flaecheListeId"
                            ref="flaecheListe"
                            class="rb__liste"
                            :class="{ 'is-oben': flaecheOben }"
                            :style="flaechePlatz === null ? undefined : { '--rb-platz': `${flaechePlatz}px` }"
                            role="listbox"
                            :aria-label="t('inhalte.vorkommen.regeleditor.feldFlaeche')"
                            data-testid="inhalte-regel-flaechen"
                        >
                            <li
                                v-for="(f, index) in flaechenTreffer"
                                :id="flaecheOptionId(index)"
                                :key="f.kennung"
                                role="option"
                                class="rb__eintrag"
                                :class="{ 'is-aktiv': index === flaecheAktiv }"
                                :aria-selected="index === flaecheAktiv"
                                :data-kennung="f.kennung"
                                @mousedown.prevent="waehleFlaeche(f)"
                                @mousemove="flaecheAktiv = index"
                            >
                                <span class="rb__eintrag-name">{{ f.name }}</span>
                                <span class="rb__eintrag-meta">{{
                                    [flaechenMeta(f), f.wikiTitel === undefined ? "" : "Wiki"]
                                        .filter((x) => x !== "")
                                        .join(" · ")
                                }}</span>
                            </li>
                            <li
                                v-if="flaechenLaedt && flaechenTreffer.length === 0"
                                class="rb__leise"
                                role="presentation"
                            >
                                {{ t("inhalte.laedt") }}
                            </li>
                            <li v-else-if="keineTreffer" class="rb__leise" role="presentation">
                                {{ t("inhalte.vorkommen.regeleditor.menueKeine") }}
                            </li>
                            <li v-else-if="flaechenTreffer.length >= flaechenMax" class="rb__leise" role="presentation">
                                {{ t("inhalte.vorkommen.regeleditor.menueWeitere") }}
                            </li>
                        </ul>
                    </span>
                    <span v-if="flaeche !== null" class="rb__zeichen">
                        <AvmPillenknopf
                            :ton="flaecheOffen ? 'warnung' : 'neutral'"
                            :title="flaecheHinweisZeichen"
                            testid="inhalte-regel-flaeche-weg"
                            @click="aendere({ flaeche: null })"
                            >{{ flaecheOffen ? "! " : "" }}{{ flaeche.name
                            }}<template #zeichen>✕</template></AvmPillenknopf
                        >
                    </span>
                    <p
                        v-if="flaecheHinweis !== undefined"
                        class="rb__hinweis rb__hinweis--warn"
                        data-testid="inhalte-regel-wartet"
                    >
                        <span class="rb__bang" aria-hidden="true">!</span> {{ flaecheHinweis }}
                        {{ t("inhalte.vorkommen.regeleditor.wartetErst") }}
                    </p>
                </div>
            </div>

            <div class="rb__feld">
                <div class="rb__feldkopf">
                    <span class="rb__feldname">{{ t("inhalte.vorkommen.regeleditor.feldLage") }}</span>
                    <span class="rb__hinweis">{{ t("inhalte.vorkommen.regeleditor.feldLageHinweis") }}</span>
                </div>
                <InhalteRegelLage
                    :stand="lageStand(bedingung)"
                    :nummer="nummer"
                    :treffer="orteTreffer"
                    :laedt="orteLaedt"
                    :max="orteMax"
                    :umriss="umriss"
                    @update:stand="aendereLage"
                    @suche="(text: string) => emit('orteSuche', text)"
                    @umriss-laden="emit('umrissLaden')"
                />
            </div>

            <div class="rb__feld">
                <div class="rb__feldkopf">
                    <span class="rb__feldname">{{ t("inhalte.vorkommen.regeleditor.feldKlima") }}</span>
                    <span class="rb__hinweis">{{ t("inhalte.vorkommen.regeleditor.feldKlimaHinweis") }}</span>
                </div>
                <div class="rb__klima">
                    <div class="rb__klima-zeile">
                        <div
                            class="rb__streifen"
                            role="group"
                            :aria-label="`${t('inhalte.vorkommen.regeleditor.feldKlima')} ${String(nummer)}`"
                        >
                            <button
                                v-for="z in zonen"
                                :key="z.zone"
                                type="button"
                                class="rb__band"
                                :class="{ 'is-in': z.innen, 'is-end': z.ende }"
                                :style="{ '--zone': z.farbe }"
                                :title="z.name"
                                :aria-label="z.name"
                                :aria-pressed="z.innen"
                                :data-zone="z.zone"
                                @click="klimaKlick(z.zone)"
                            ></button>
                        </div>
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="bedingung.klima === null ? '' : undefined"
                            testid="inhalte-regel-klima-egal"
                            @click="klimaEgal"
                            >{{ t("inhalte.vorkommen.regeleditor.egal") }}</AvmKnopf
                        >
                    </div>
                    <div class="rb__enden">
                        <span>{{ t("inhalte.vorkommen.regeleditor.norden") }}</span>
                        <span class="rb__klima-text" data-testid="inhalte-regel-klima-text">{{ klimaText }}</span>
                        <span>{{ t("inhalte.vorkommen.regeleditor.sueden") }}</span>
                    </div>
                </div>
            </div>
        </div>
    </section>
</template>

<style scoped>
.rb {
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

.rb.is-leer {
    border-color: var(--color-warning-soft-border);
}

.rb__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    padding: var(--space-4) var(--space-6) var(--space-4) var(--space-8);
}

.rb__titel {
    display: flex;
    flex: 1 1 auto;
    align-items: baseline;
    gap: var(--space-6);
    min-width: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--color-text-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.rb__titel:focus-visible {
    outline: none;
    border-radius: var(--radius-sm);
    box-shadow: var(--focus-ring);
}

.rb__pfeil {
    flex: none;
    width: 1em;
    color: var(--color-text-muted);
}

.rb__name {
    flex: none;
}

.rb__kurz {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.rb__koerper {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    padding: var(--space-2) var(--space-8) var(--space-8);
}

.rb__paar {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16em, 1fr));
    gap: var(--space-8);
}

.rb__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.rb__feldkopf {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 var(--space-6);
}

.rb__feldname {
    color: var(--color-text-muted);
    font-size: var(--font-size-body);
}

.rb__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    line-height: var(--leading-snug);
    overflow-wrap: anywhere;
}

.rb__hinweis--warn {
    color: var(--color-warning-soft-text);
}

.rb__bang {
    font-weight: var(--font-weight-bold);
}

/* Die Auswahl der Art ist ein Bauteil der Begriffstafel (inline-block); hier füllt sie die Breite des Feldes. */
.rb__wahl {
    display: block;
    width: 100%;
}

.rb__wahl :deep(.eingabe-huelle) {
    display: flex;
    width: 100%;
}

.rb__zeichen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

/* Die Auswahl der Fläche: dieselbe Liste wie die der Pillenwahl (Rand, Schatten, Hover), mit zwei Zeilen je Eintrag. */
.rb__flaeche {
    position: relative;
    min-width: 0;
}

.rb__liste {
    position: absolute;
    z-index: 30;
    inset-block-start: calc(100% + var(--space-2));
    inset-inline-start: 0;
    box-sizing: border-box;
    min-width: 100%;
    width: max-content;
    max-width: min(24em, 80vw);
    max-height: min(22em, 60vh, var(--rb-platz, 100vh));
    margin: 0;
    padding: var(--space-2);
    overflow-y: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    list-style: none;
}

.rb__liste.is-oben {
    inset-block-start: auto;
    inset-block-end: calc(100% + var(--space-2));
}

.rb__eintrag {
    display: flex;
    flex-direction: column;
    padding: var(--space-2) var(--space-6);
    border-radius: var(--radius-sm);
    color: var(--color-text);
    cursor: pointer;
    font-size: var(--font-size-small);
}

.rb__eintrag.is-aktiv {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.rb__eintrag-meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.rb__leise {
    padding: var(--space-4) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Der Klimastreifen: acht Bänder von Norden nach Süden, die Spanne bleibt sichtbar (eine Spanne braucht ihre Nachbarn). */
.rb__klima {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
}

.rb__klima-zeile {
    display: flex;
    align-items: center;
    gap: var(--space-6);
}

.rb__streifen {
    display: flex;
    flex: 1 1 auto;
    gap: var(--space-2);
    min-width: 0;
}

.rb__band {
    flex: 1 1 0;
    min-width: 0;
    height: var(--space-24);
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: var(--zone);
    cursor: pointer;
    opacity: 0.35;
    transition: opacity 120ms ease;
}

.rb__band:hover {
    opacity: 0.72;
}

.rb__band.is-in {
    opacity: 1;
}

.rb__band.is-end {
    border-color: var(--color-text);
}

.rb__band:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
    opacity: 1;
}

.rb__enden {
    display: flex;
    justify-content: space-between;
    gap: var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.rb__klima-text {
    min-width: 0;
    color: var(--color-text);
    font-size: var(--font-size-small);
    text-align: center;
}

@media (prefers-reduced-motion: reduce) {
    .rb__band {
        transition: none;
    }
}
</style>
