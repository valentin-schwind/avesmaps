<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from "vue";
import type { EditorPathWeiterer, WikiTreffer } from "@avesmaps3d/shared";
import { createWikiBoxDaten } from "../fenster/wiki-box-daten";
import { trefferZeile } from "../fenster/wiki-treffer";
import { formatNumber, t, tPlural } from "../i18n/i18n";
import {
    chipsDerWahl,
    naechsterWaehlbar,
    trefferGesperrt,
    trefferLage,
    weitereWechsel,
    type TrefferLage,
    type WeitereJeAbschnitt,
    type WeitererChip,
} from "./weg-weitere";

/**
 * Das Feld „Weitere Straßennamen“ der gewählten Abschnitte (WI-0302, OPS-000108; Bauvorlage Entwurf „Weitere Straßennamen“ Fassung 2, Vali
 * 2026-11-10: „Nur Wiki-Artikel“, „Ja, bauen“): neben Wegtyp und Tunnel in der Tafel (`weg-tafel.vue`). Es gilt den gewählten Abschnitten wie
 * der Wegtyp; jede Änderung ist ein Schritt im Entwurf der Straße, „Fertig“ schreibt (`weg-art.ts`, `sections[].weitere`).
 *
 * - **Chips mit ✕:** ✕ löst den Namen von allen gewählten Abschnitten. Tragen die gewählten verschiedene Namen, steht ein Teil-Chip „Goldfelser
 *   Stieg · 1 von 3“ mit dem Handgriff „allen geben“. Ein Name, der an keinem der gewählten gespeichert ist, trägt „•“ (ungespeichert).
 * - **Vervollständigung nur aus Wiki-Artikeln der Wege** über die Suche der Wiki-Box (`wikiBoxSucheUrl("weg", …)`); je Vorschlag der Name und
 *   darunter leise Art, Lage und „hängt an …“. Gesperrt sind der Hauptartikel der Straße und ein Name, den schon alle gewählten tragen. Kein
 *   „als neuen Namen anlegen“.
 * - **Tastatur** (Guide §17.5, keine Vorauswahl): ↓ ↑ wählen unter den freien Vorschlägen, Enter nimmt den markierten oder einen genau
 *   getroffenen Namen (sonst zeigt es auf den ersten, das zweite Enter nimmt ihn), Esc schließt die Liste, Rücktaste im leeren Feld markiert den
 *   letzten Chip und löst ihn beim zweiten Mal.
 * - Die Liste überlagert und verschiebt nichts (§17.5); passt sie unten nicht in die Spalte, geht sie nach oben auf. Zustände nach §30.5, 120 ms
 *   `ease`, ohne Übergang bei reduzierter Bewegung.
 */
const props = defineProps<{
    /** Die weiteren Straßennamen aller Abschnitte, im Entwurf. */
    weitere: WeitereJeAbschnitt;
    /** Dieselben, wie gelesen: Was dort fehlt, ist ungespeichert. */
    gelesen: WeitereJeAbschnitt;
    /** Die gewählten Abschnitte in ihrer Folge. */
    ids: readonly string[];
    /** Ihre Nummern in der Leiste (1-basiert). */
    nummern: readonly number[];
    /** (W): der ganze Weg. */
    alle: boolean;
    /** Wie viele Abschnitte die Straße hat. */
    gesamt: number;
    /** Der Schlüssel des Hauptartikels der Straße: In der Suche gesperrt. */
    hauptKey: string | undefined;
    /** Ein Abschnitt der Straße: Unter ihm fragt die Suche der Wiki-Box. */
    sucheId: string;
    schreibt: boolean;
    kennung: string;
    /** Die Artikelsuche; ohne Angabe die der Wiki-Box. Nur Tests geben sie vor. */
    suche?: ((q: string, signal: AbortSignal) => Promise<readonly WikiTreffer[]>) | undefined;
}>();
const emit = defineEmits<{
    /** Den Namen allen gewählten Abschnitten geben (aus der Suche oder „allen geben“). */
    dazu: [weiterer: EditorPathWeiterer];
    /** Den Namen von allen gewählten Abschnitten lösen (✕, zweite Rücktaste). */
    weg: [key: string];
}>();

const eingabeId = computed(() => `${props.kennung}-weitere-eingabe`);
const listeId = computed(() => `${props.kennung}-weitere-liste`);
const satzId = computed(() => `${props.kennung}-weitere-satz`);
const optionId = (i: number): string => `${props.kennung}-weitere-opt-${i}`;

const chips = computed(() => chipsDerWahl(props.weitere, props.ids));
/** Weicht der Entwurf irgendwo an der Straße vom Gelesenen ab? Dann trägt der Name des Felds „•“. */
const geaendert = computed(() => weitereWechsel(props.gelesen, props.weitere).length > 0);
const ungespeichert = (chip: WeitererChip): boolean =>
    !props.ids.some((id) => (props.gelesen[id] ?? []).some((w) => w.key === chip.key));

const giltText = computed(() => {
    if (props.gesamt <= 1) return t("wegeditor.weitere.gilt.ganz");
    if (props.alle) return t("wegeditor.weitere.gilt.alle", { n: formatNumber(props.gesamt, 0) });
    const [erste] = props.nummern;
    if (props.nummern.length === 1 && erste !== undefined)
        return t("wegeditor.weitere.gilt.einer", { nr: formatNumber(erste, 0) });
    return t("wegeditor.weitere.gilt.mehrere", {
        n: formatNumber(props.nummern.length, 0),
        nummern: props.nummern.map((nr) => formatNumber(nr, 0)).join(", "),
    });
});

// ── Eingabe und Suche ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const feld = useTemplateRef<HTMLInputElement>("feld");
const liste = useTemplateRef<HTMLUListElement>("liste");
const anker = useTemplateRef<HTMLDivElement>("anker");
const eingabe = ref("");
const offen = ref(false);
/** Der markierte Vorschlag (Pfeiltasten); `-1`: keiner (keine Vorauswahl, §17.5). */
const aktiv = ref(-1);
/** Der Chip, den die Rücktaste markiert hat (sein Schlüssel). */
const markiert = ref<string | undefined>(undefined);
const treffer = shallowRef<readonly WikiTreffer[]>([]);
const laedt = ref(false);
const fehler = ref(false);
/** Für welches Suchwort die Treffer gelten. */
const gefragt = ref<string | undefined>(undefined);
const nachOben = ref(false);
const ansage = ref("");

const daten = createWikiBoxDaten();
const sucheMit = (q: string, signal: AbortSignal): Promise<readonly WikiTreffer[]> =>
    props.suche !== undefined ? props.suche(q, signal) : daten.suche("weg", props.sucheId, q, signal);

let abbruch: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
async function frage(q: string): Promise<void> {
    clearTimeout(timer);
    abbruch?.abort();
    const steuer = new AbortController();
    abbruch = steuer;
    laedt.value = true;
    fehler.value = false;
    try {
        const gefunden = await sucheMit(q, steuer.signal);
        if (abbruch !== steuer) return;
        treffer.value = gefunden;
        gefragt.value = q;
        aktiv.value = -1;
    } catch {
        if (abbruch === steuer && !steuer.signal.aborted) fehler.value = true;
    } finally {
        if (abbruch === steuer) laedt.value = false;
    }
}
function planeSuche(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void frage(eingabe.value.trim()), 200);
}
onBeforeUnmount(() => {
    clearTimeout(timer);
    abbruch?.abort();
});

/** Ein Name, verglichen ohne Akzente, Groß- und Kleinschreibung („Bärenpfad“ trifft „barenpfad“, ß wie ss). */
const norm = (wert: string): string =>
    wert.normalize("NFD").replace(/[̀-ͯ]/gu, "").replace(/ß/gu, "ss").toLowerCase().replace(/\s+/gu, " ").trim();
const nameVon = (tr: WikiTreffer): string => tr.name || tr.key;
/** Wie gut ein Name das Suchwort trifft: am Anfang, am Anfang eines Worts, irgendwo. */
function rang(name: string, q: string): number {
    const n = norm(name);
    if (q === "" || n.startsWith(q)) return 0;
    return n.split(/[\s-]/u).some((wort) => wort.startsWith(q)) ? 1 : 2;
}

interface Vorschlag {
    readonly tr: WikiTreffer;
    readonly name: string;
    readonly lage: TrefferLage | undefined;
    readonly gesperrt: boolean;
    readonly meta: string;
}
function lageText(lage: TrefferLage | undefined): string | undefined {
    if (lage === undefined) return undefined;
    if (lage.art === "haupt") return t("wegeditor.weitere.sperre.haupt");
    if (lage.art === "schon")
        return lage.von === 1 ? t("wegeditor.weitere.sperre.einer") : t("wegeditor.weitere.sperre.alle");
    return t("wegeditor.weitere.teilSatz", { n: formatNumber(lage.anzahl, 0), m: formatNumber(lage.von, 0) });
}
const vorschlaege = computed((): Vorschlag[] => {
    const q = norm(eingabe.value);
    return treffer.value
        .map((tr, platz) => ({ tr, platz, name: nameVon(tr) }))
        .sort((a, b) => rang(a.name, q) - rang(b.name, q) || a.platz - b.platz)
        .map(({ tr, name }) => {
            const lage = trefferLage(chips.value, props.hauptKey, tr.key);
            const teile = [
                trefferZeile("weg", tr),
                tr.belegt === undefined ? "" : t("wikiZuordnung.belegt", { name: tr.belegt }),
                lageText(lage) ?? "",
            ].filter((teil) => teil !== "");
            return { tr, name, lage, gesperrt: trefferGesperrt(lage), meta: teile.join(" · ") };
        });
});
const gesperrtListe = computed(() => vorschlaege.value.map((v) => v.gesperrt));
const zeigen = computed(() => offen.value && (vorschlaege.value.length > 0 || eingabe.value.trim() !== ""));
/** Was die Liste sagt, wenn sie keinen Vorschlag hat: lädt, Fehler, kein Treffer. */
const leerText = computed(() => {
    if (fehler.value) return t("wikiZuordnung.fehler");
    if (laedt.value || gefragt.value !== eingabe.value.trim()) return t("wikiZuordnung.laedt");
    return t("wegeditor.weitere.leer");
});

// Die Zahl der wählbaren Vorschläge für Vorleser, sobald sie gelesen sind.
watch([zeigen, vorschlaege], () => {
    if (!zeigen.value || laedt.value) return;
    const n = vorschlaege.value.filter((v) => !v.gesperrt).length;
    ansage.value = tPlural("wegeditor.weitere.ansage.zahl", n, { n: formatNumber(n, 0) });
});

/** Der nächste Vorfahr, der rollt (die Spalte des Fensters): Passt die Liste dort unten nicht hin, geht sie nach oben auf. */
function rollenderVorfahr(element: HTMLElement): HTMLElement | undefined {
    for (let x = element.parentElement; x !== null; x = x.parentElement) {
        const rollen = getComputedStyle(x).overflowY;
        if (rollen === "auto" || rollen === "scroll") return x;
    }
    return undefined;
}
watch([zeigen, () => vorschlaege.value.length], async () => {
    nachOben.value = false;
    if (!zeigen.value) return;
    await nextTick();
    const box = liste.value;
    const halt = anker.value;
    if (!box || !halt) return;
    const vorfahr = rollenderVorfahr(halt);
    const grenze = vorfahr?.getBoundingClientRect() ?? { top: 0, bottom: window.innerHeight };
    const r = box.getBoundingClientRect();
    const f = halt.getBoundingClientRect();
    if (r.bottom > grenze.bottom && f.top - grenze.top > r.height + 12) nachOben.value = true;
});
// Der markierte Vorschlag bleibt im Bild der Liste.
watch(aktiv, async (i) => {
    if (i < 0) return;
    await nextTick();
    liste.value?.querySelector(`#${CSS.escape(optionId(i))}`)?.scrollIntoView({ block: "nearest" });
});
// Eine andere Wahl der Abschnitte: Markierung und Liste gelten ihr nicht mehr.
watch(
    () => props.ids,
    () => {
        markiert.value = undefined;
        aktiv.value = -1;
    },
);

function zumFeld(): void {
    void nextTick(() => feld.value?.focus());
}

function waehle(v: Vorschlag): void {
    if (v.gesperrt) return;
    emit("dazu", { key: v.tr.key, name: v.name, url: v.tr.url });
    eingabe.value = "";
    offen.value = false;
    aktiv.value = -1;
    markiert.value = undefined;
    ansage.value = t("wegeditor.weitere.ansage.dazu", { name: v.name });
    zumFeld();
}
function loese(chip: WeitererChip): void {
    markiert.value = undefined;
    emit("weg", chip.key);
    ansage.value = t("wegeditor.weitere.ansage.geloest", { name: chip.name });
    zumFeld();
}
function gibAllen(chip: WeitererChip): void {
    emit("dazu", { key: chip.key, name: chip.name, ...(chip.url === undefined ? {} : { url: chip.url }) });
    ansage.value = t("wegeditor.weitere.ansage.allen", { name: chip.name });
    zumFeld();
}

function getippt(event: Event): void {
    eingabe.value = (event.target as HTMLInputElement).value;
    offen.value = eingabe.value.trim() !== "";
    aktiv.value = -1;
    markiert.value = undefined;
    if (offen.value) planeSuche();
}

/** Die Liste aufmachen; gelten ihre Treffer einem anderen Suchwort, fragt sie gleich (ohne die Pause des Tippens). */
function oeffne(): void {
    offen.value = true;
    const q = eingabe.value.trim();
    if (gefragt.value !== q && !laedt.value) void frage(q);
}

function taste(event: KeyboardEvent): void {
    switch (event.key) {
        case "ArrowDown":
        case "ArrowUp": {
            event.preventDefault();
            if (!offen.value) oeffne();
            aktiv.value = naechsterWaehlbar(gesperrtListe.value, aktiv.value, event.key === "ArrowDown" ? 1 : -1);
            markiert.value = undefined;
            return;
        }
        case "Enter": {
            event.preventDefault();
            let i = offen.value ? aktiv.value : -1;
            if (i < 0) {
                // Keine Vorauswahl (§17.5): Enter nimmt nur einen genau getroffenen Namen; sonst zeigt es auf den ersten Vorschlag.
                const q = norm(eingabe.value);
                if (q === "") return;
                i = vorschlaege.value.findIndex((v) => !v.gesperrt && norm(v.name) === q);
                if (i < 0) {
                    oeffne();
                    aktiv.value = naechsterWaehlbar(gesperrtListe.value, -1, 1);
                    return;
                }
            }
            const v = vorschlaege.value[i];
            if (v !== undefined) waehle(v);
            return;
        }
        case "Escape":
            // Die Taste bleibt hier, wenn sie etwas schließt; sonst gilt sie dem Fenster (Frage „Speichern · Verwerfen“).
            if (offen.value) {
                event.preventDefault();
                event.stopPropagation();
                offen.value = false;
                aktiv.value = -1;
            } else if (markiert.value !== undefined) {
                event.preventDefault();
                event.stopPropagation();
                markiert.value = undefined;
            }
            return;
        case "Backspace": {
            const ziel = event.target as HTMLInputElement;
            if (ziel.value !== "" || ziel.selectionStart !== 0 || ziel.selectionEnd !== 0) return;
            const letzter = chips.value.at(-1);
            if (letzter === undefined) return;
            event.preventDefault();
            if (markiert.value === letzter.key) {
                loese(letzter);
            } else {
                markiert.value = letzter.key;
                ansage.value = t("wegeditor.weitere.ansage.markiert", { name: letzter.name });
            }
            return;
        }
        case "Tab":
            offen.value = false;
            aktiv.value = -1;
            return;
        default:
            if (markiert.value !== undefined && event.key.length === 1) markiert.value = undefined;
    }
}

/** Der Zeiger über einem freien Vorschlag markiert ihn, wie die Pfeiltasten. */
function zeigeAuf(i: number): void {
    if (vorschlaege.value[i]?.gesperrt === false && aktiv.value !== i) aktiv.value = i;
}

function verlassen(): void {
    setTimeout(() => {
        if (document.activeElement === feld.value) return;
        offen.value = false;
        aktiv.value = -1;
        markiert.value = undefined;
    }, 0);
}
</script>

<template>
    <div class="weitere" :data-testid="`${kennung}-weitere`">
        <label v-if="schreibt" class="weitere__name" :for="eingabeId"
            >{{ t("wegeditor.weitere.name")
            }}<span v-if="geaendert" class="weitere__punkt" :title="t('wegeditor.weitere.ungespeichert')">
                •</span
            ></label
        >
        <span v-else class="weitere__name">{{ t("wegeditor.weitere.name") }}</span>
        <div v-if="schreibt" class="weitere__feld">
            <div ref="anker" class="weitere__anker">
                <div class="weitere__rahmen" @click.self="feld?.focus()">
                    <ul class="weitere__chips" :aria-label="t('wegeditor.weitere.liste')">
                        <li
                            v-for="chip in chips"
                            :key="chip.key"
                            class="weitere__chip"
                            :class="{
                                'weitere__chip--teil': chip.anzahl < chip.von,
                                'weitere__chip--markiert': markiert === chip.key,
                            }"
                            :data-key="chip.key"
                            :data-testid="`${kennung}-weitere-chip`"
                        >
                            <span class="weitere__chiptext einzeilig"
                                >{{ chip.name
                                }}<span
                                    v-if="ungespeichert(chip)"
                                    class="weitere__punkt"
                                    :title="t('wegeditor.weitere.ungespeichert')"
                                >
                                    •</span
                                ></span
                            >
                            <template v-if="chip.anzahl < chip.von">
                                <span class="weitere__teil" :data-testid="`${kennung}-weitere-teil`">{{
                                    t("wegeditor.weitere.teil", {
                                        n: formatNumber(chip.anzahl, 0),
                                        m: formatNumber(chip.von, 0),
                                    })
                                }}</span>
                                <button
                                    type="button"
                                    class="weitere__allen"
                                    :title="t('wegeditor.weitere.allen.zettel', { name: chip.name })"
                                    :data-testid="`${kennung}-weitere-allen`"
                                    @click="gibAllen(chip)"
                                >
                                    {{ t("wegeditor.weitere.allen") }}
                                </button>
                            </template>
                            <button
                                type="button"
                                class="weitere__weg"
                                :aria-label="t('wegeditor.weitere.loesen.aria', { name: chip.name })"
                                :title="t('wegeditor.weitere.loesen.zettel')"
                                :data-testid="`${kennung}-weitere-loesen`"
                                @click="loese(chip)"
                            >
                                <span aria-hidden="true">✕</span>
                            </button>
                        </li>
                    </ul>
                    <input
                        :id="eingabeId"
                        ref="feld"
                        class="weitere__eingabe"
                        type="text"
                        role="combobox"
                        aria-autocomplete="list"
                        :aria-expanded="zeigen"
                        :aria-controls="listeId"
                        :aria-activedescendant="zeigen && aktiv >= 0 ? optionId(aktiv) : undefined"
                        :aria-describedby="satzId"
                        autocomplete="off"
                        spellcheck="false"
                        :value="eingabe"
                        :placeholder="chips.length === 0 ? t('wegeditor.weitere.platzhalter') : ''"
                        :data-testid="`${kennung}-weitere-eingabe`"
                        @input="getippt"
                        @keydown="taste"
                        @blur="verlassen"
                    />
                </div>
                <ul
                    v-if="zeigen"
                    :id="listeId"
                    ref="liste"
                    class="weitere__vorschlaege"
                    :class="{ 'weitere__vorschlaege--oben': nachOben }"
                    role="listbox"
                    :aria-label="t('wegeditor.weitere.vorschlaege')"
                    :data-testid="`${kennung}-weitere-vorschlaege`"
                    @mousedown.prevent
                >
                    <li
                        v-for="(v, i) in vorschlaege"
                        :id="optionId(i)"
                        :key="v.tr.key"
                        role="option"
                        class="weitere__vorschlag"
                        :class="{ 'weitere__vorschlag--aktiv': i === aktiv }"
                        :aria-selected="i === aktiv"
                        :aria-disabled="v.gesperrt || undefined"
                        :data-key="v.tr.key"
                        :data-testid="`${kennung}-weitere-vorschlag`"
                        @click="waehle(v)"
                        @mousemove="zeigeAuf(i)"
                    >
                        <span class="weitere__vorschlagname">{{ v.name }}</span>
                        <span v-if="v.meta !== ''" class="weitere__meta">{{ v.meta }}</span>
                    </li>
                    <li v-if="vorschlaege.length === 0" class="weitere__leer" role="presentation">{{ leerText }}</li>
                </ul>
            </div>
            <p :id="satzId" class="weitere__satz">
                {{ t("wegeditor.weitere.satz", { gilt: giltText }) }}
            </p>
            <span class="weitere__ansage" aria-live="polite">{{ ansage }}</span>
        </div>
        <span v-else class="weitere__wert" :data-testid="`${kennung}-weitere-wert`">
            <template v-if="chips.length === 0">–</template>
            <template v-for="(chip, i) in chips" v-else :key="chip.key"
                >{{ i > 0 ? ", " : "" }}{{ chip.name
                }}<template v-if="chip.anzahl < chip.von">
                    ({{
                        t("wegeditor.weitere.teil", { n: formatNumber(chip.anzahl, 0), m: formatNumber(chip.von, 0) })
                    }})</template
                ></template
            >
        </span>
    </div>
</template>

<style scoped>
.weitere {
    display: flex;
    flex: 1 1 100%;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: var(--space-4) var(--space-6);
    min-width: 0;
    font-size: var(--font-size-reading);
}

.weitere__name {
    flex: none;
    padding-top: 7px;
    color: var(--color-text-muted);
}

label.weitere__name {
    cursor: text;
}

.weitere__punkt {
    color: var(--color-warning-soft-text);
}

.weitere__wert {
    padding-top: 7px;
    color: var(--color-text-strong);
}

.weitere__feld {
    position: relative;
    display: grid;
    flex: 1 1 260px;
    gap: var(--space-2);
    min-width: 0;
}

/* Feld und Trefferliste: Die Liste hängt am Feld, auch wenn die Chips es auf mehrere Zeilen wachsen lassen. */
.weitere__anker {
    position: relative;
    min-width: 0;
}

/* Das Feld mit seinen Chips: Rahmen und Fokus wie das Eingabefeld des Hauses (§17.5). */
.weitere__rahmen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    min-height: var(--avm-control-h);
    padding: 3px var(--space-2);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    cursor: text;
    transition:
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.weitere__rahmen:hover {
    border-color: var(--color-border-strong);
}

.weitere__rahmen:focus-within {
    border-color: var(--color-accent-strong);
    box-shadow: var(--focus-ring);
}

.weitere__chips {
    display: contents;
    margin: 0;
    padding: 0;
    list-style: none;
}

.weitere__chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    max-width: 100%;
    height: 22px;
    padding: 0 2px 0 var(--space-6);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
    color: var(--color-text-strong);
    font-size: var(--font-size-small);
    line-height: 1;
    white-space: nowrap;
    cursor: default;
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.weitere__chip:hover {
    border-color: var(--color-border-strong);
}

/* Kürzen übernimmt `.einzeilig` aus app.vue (Platz für die Unterlängen). */
.weitere__chiptext {
    min-width: 0;
}

/* Ein Teil-Chip: Der Name steht nur an einem Teil der gewählten Abschnitte. */
.weitere__chip--teil {
    border-style: dashed;
    border-color: var(--color-text-muted);
    background: transparent;
}

.weitere__teil {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.weitere__chip--markiert {
    border-color: var(--color-accent-strong);
    background: var(--color-active-wash);
}

.weitere__allen,
.weitere__weg {
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition:
        background-color 120ms ease,
        color 120ms ease,
        box-shadow 120ms ease;
}

.weitere__allen {
    padding: 0 2px;
    color: var(--color-link);
}

.weitere__allen:hover {
    background: var(--color-hover-wash);
    color: var(--color-link-hover);
    text-decoration: underline;
}

.weitere__weg {
    display: grid;
    flex: none;
    place-items: center;
    width: 18px;
    height: 18px;
    padding: 0;
    color: var(--color-text-muted);
    line-height: 1;
}

.weitere__weg:hover {
    background: var(--color-hover-wash);
    color: var(--color-text-strong);
}

.weitere__allen:active,
.weitere__weg:active {
    background: var(--color-active-wash);
}

.weitere__allen:focus-visible,
.weitere__weg:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.weitere__eingabe {
    flex: 1 1 8em;
    min-width: 6em;
    height: 24px;
    margin: 0;
    padding: 0 var(--space-4);
    border: 0;
    outline: none;
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--font-size-body);
}

.weitere__eingabe::placeholder {
    color: var(--color-placeholder);
}

.weitere__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Die Trefferliste überlagert, sie verschiebt nichts (Guide §17.5): eigene Fläche, Radius 10, weicher Schatten, eigener schmaler Bildlauf. */
.weitere__vorschlaege {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    left: 0;
    z-index: var(--z-autocomplete);
    display: grid;
    gap: 1px;
    min-width: min(280px, 100%);
    max-height: 17rem;
    margin: 0;
    padding: var(--space-2);
    overflow: auto;
    overscroll-behavior: contain;
    border: 1px solid var(--color-border-strong);
    border-radius: var(--radius-lg);
    background: var(--color-panel);
    box-shadow: var(--shadow-panel);
    list-style: none;
    scrollbar-width: thin;
}

.weitere__vorschlaege--oben {
    top: auto;
    bottom: calc(100% + 6px);
}

.weitere__vorschlag {
    display: grid;
    gap: 2px;
    padding: var(--space-4) var(--space-6);
    border-radius: var(--radius-md);
    color: var(--color-text-strong);
    cursor: pointer;
    transition: background-color 120ms ease;
}

.weitere__vorschlagname {
    font-size: var(--font-size-body);
}

.weitere__meta {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.weitere__vorschlag:hover,
.weitere__vorschlag--aktiv {
    background: var(--color-hover-wash);
}

.weitere__vorschlag:active {
    background: var(--color-active-wash);
}

.weitere__vorschlag--aktiv {
    box-shadow: inset 0 0 0 1px var(--color-accent);
}

.weitere__vorschlag[aria-disabled="true"] {
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

.weitere__vorschlag[aria-disabled="true"]:hover {
    background: transparent;
}

.weitere__vorschlag[aria-disabled="true"] .weitere__meta {
    color: var(--color-disabled-text);
}

.weitere__leer {
    padding: var(--space-4) var(--space-6);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Nur für Vorleser: die Zahl der Vorschläge und was ein Griff getan hat. */
.weitere__ansage {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
}

@media (pointer: coarse) {
    .weitere__eingabe {
        font-size: var(--font-size-touch);
    }
}

@media (prefers-reduced-motion: reduce) {
    .weitere__rahmen,
    .weitere__chip,
    .weitere__allen,
    .weitere__weg,
    .weitere__vorschlag {
        transition: none;
    }
}
</style>
