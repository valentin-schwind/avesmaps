<script setup lang="ts">
import { ref, watch } from "vue";
import type { EditorPlaceSites, EditorSite, SiteRelationWay } from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InnerortsHinzufuegen from "./innerorts-hinzufuegen-fenster.vue";
import type { OrtseditorDaten } from "./ortseditor-daten";
import StaetteVerlagern from "./staette-verlagern-fenster.vue";

/**
 * Der Reiter „Innerorts“ des Ortseditors (WI-0128 E18, WI-0134): die Stätten dieses Orts, nach dem Kennungsmodell aus
 * Migration 0099.
 *
 * 🔴 **Seit dem Betreiberentscheid vom 2026-10-13 gilt Lesart B**: Das Panel zeigt eine Stätte dort, wo eine Beziehung
 * gespeichert ist, sonst an dem Ort, den ihre Kette an ERSTER Stelle nennt. Der Reiter zeigt beide Wege getrennt, weil sie
 * verschieden belastbar sind:
 * 1. **Belegt** — eine gespeicherte Innerorts-Beziehung (Legacys Kennung oder der Entscheid eines Menschen). Sie überlebt ein
 *    Umbenennen und hält zwei gleichnamige Orte auseinander.
 * 2. **Über die Kette hier** — sichtbar, aber nicht gespeichert: Die Kette nennt diesen Ort zuerst. „Hierher binden“ macht
 *    daraus eine Entscheidung.
 *
 * 🪤 Die Zahl des Panels ist GRÖSSER als beide Listen zusammen: Die Wiki-Siedlungsregistry ist sichtbar, liefert aber keine
 * `site`-Objekte und ist darum nicht bindbar. Sie steht als eigene Zeile da, nicht als dritte Liste.
 *
 * 🪤 Keine Zahl dieser Seite wird von selbst zu einer Bindung. Gebunden wird nur, was ein Mensch bindet.
 *
 * 🪤 **B2:** Ein gespeichertes „keine Stadt“ aus einem Lauf (Herkunft `wiki` oder `gespeichert`) ist KEIN Entscheid. Solche
 * Stätten stehen unter „Über die Kette hier“ und sagen das auch; sie sind bindbar wie jede andere.
 *
 * 🪤 **B4:** Eine stillgelegte Stätte mit hängender Beziehung bleibt unter „Belegt“ sichtbar, mit Hinweis. Gibt es genau
 * einen Nachfolgesitz, lässt sich die Beziehung in einer Operation umhängen; sonst bleibt nur Lösen - geraten wird nie.
 *
 * **„✚ Innerorts hinzufügen …“** (WI-0196, EDIT-0003 T33 (3)): ein Fenster mit allem, was noch nirgends innerorts ist, samt
 * Vorauswahl im Umkreis von N Meilen; geschrieben wird erst mit „Fertig“, in EINER Operation (`innerorts-hinzufuegen-fenster.vue`).
 */
const props = defineProps<{
    publicId: string | undefined;
    daten: OrtseditorDaten;
    kennung: string;
    /** Zuordnen und Lösen gehen nur mit `edit_map_objects` und eingeschaltetem Bearbeiten (E10b). */
    aendern?: boolean | undefined;
    /** Der Name des Orts, für den Kopf des Fensters „Innerorts hinzufügen“. */
    ortName?: string | undefined;
}>();
const emit = defineEmits<{
    /** Eine Beziehung hat sich geändert: Liste, Infopanel und Reiterzahl lesen neu. */
    geaendert: [];
}>();

const sites = ref<EditorPlaceSites | null | undefined>(undefined);
watch(
    () => props.publicId,
    (id) => {
        sites.value = undefined;
        if (id === undefined) return;
        const signal = new AbortController().signal;
        void props.daten.sites(id, signal).then(
            (antwort) => {
                if (props.publicId === id) sites.value = antwort;
            },
            () => {
                if (props.publicId === id) sites.value = null;
            },
        );
    },
    { immediate: true },
);

const QUELLE: Readonly<Record<string, MessageKey>> = {
    punkt: "ortseditor.innerorts.quelle.punkt",
    gespeichert: "ortseditor.innerorts.quelle.gespeichert",
    weg: "ortseditor.innerorts.quelle.weg",
    sitz: "ortseditor.innerorts.quelle.sitz",
    stadtteil: "ortseditor.innerorts.quelle.stadtteil",
};
const HERKUNFT: Readonly<Record<string, MessageKey>> = {
    manual: "ortseditor.innerorts.herkunft.manual",
    wiki: "ortseditor.innerorts.herkunft.wiki",
    gespeichert: "ortseditor.innerorts.herkunft.gespeichert",
    editor: "ortseditor.innerorts.herkunft.editor",
};
const ROLLE: Readonly<Record<string, MessageKey>> = {
    hauptsitz: "ortseditor.innerorts.rolle.hauptsitz",
    zweigsitz: "ortseditor.innerorts.rolle.zweigsitz",
};

/** Die zweite Zeile einer Stätte: Art, Quelle, Sitzrolle, Herkunft der Beziehung - was es gibt, in dieser Folge. */
function merkmale(staette: EditorSite): string[] {
    const teile = [staette.type || t("infoPanel.staetten.fallbackType"), t(QUELLE[staette.sourceKind]!)];
    // Legacys Rolle wörtlich, wenn wir kein Wort dafür haben (Hausregel: die Art kommt wörtlich).
    if (staette.seat) teile.push(ROLLE[staette.seat.role] ? t(ROLLE[staette.seat.role]!) : staette.seat.role);
    // 🔴 B2: Ohne Ort ist die Zeile das Protokoll eines Laufs, nicht die Herkunft einer Bindung. Sie steht als eigener
    // Satz an der Zeile, damit sie nicht wie ein Entscheid aussieht.
    if (staette.relation?.placePublicId) teile.push(t(HERKUNFT[staette.relation.origin]!));
    return teile;
}

/** B2: eine gespeicherte Beziehung, die keinen Ort trifft - Legacys Lauf fand nichts, ein Mensch hat nichts entschieden. */
const ohneStadt = (staette: EditorSite): boolean =>
    staette.relation !== undefined && staette.relation.placePublicId === undefined;

/** B4: Wohin die Beziehung einer stillgelegten Stätte wandern würde - Name und, wenn es sie gibt, Legacys Ortsangabe. */
const nachfolgerSatz = (staette: EditorSite): string =>
    staette.successor === undefined
        ? ""
        : staette.successor.rawLocation
          ? `${staette.successor.name} (${staette.successor.rawLocation})`
          : staette.successor.name;

/**
 * Zuordnen, verlagern, lösen (E10b): EINE Operation je Klick, mit eigener Kennung (Idempotenz). Danach liest der Reiter neu,
 * und die Seite lädt Liste und Infopanel nach - die Zahl der Stätten steht auch dort.
 */
const laeuft = ref<string | undefined>(undefined);
const fehler = ref<string | undefined>(undefined);
async function binde(staette: EditorSite, weg: SiteRelationWay): Promise<void> {
    const id = props.publicId;
    if (id === undefined || laeuft.value !== undefined) return;
    laeuft.value = staette.id;
    fehler.value = undefined;
    const antwort = await props.daten.bindeStaette(id, {
        operationId: crypto.randomUUID(),
        siteId: staette.id,
        weg,
    });
    laeuft.value = undefined;
    if (!antwort.ok) {
        fehler.value = antwort.fehler.message;
        return;
    }
    const frisch = await props.daten.sites(id, new AbortController().signal);
    if (props.publicId === id) sites.value = frisch;
    emit("geaendert");
}

/**
 * „Verlagern …“ (E10b, G3): Die Stätte wandert an einen anderen Ort. Das ist EINE Operation AM ZIELORT (`hierher`); der Server
 * schreibt die eine Zeile der Stätte um und nennt das Verlagern im Verlauf beider Orte. Dieser Reiter liest danach neu, denn
 * hier fehlt die Stätte jetzt.
 */
const verlagert = ref<EditorSite | undefined>(undefined);
const verlagernOffen = ref(false);
function verlagernAb(staette: EditorSite): void {
    verlagert.value = staette;
    verlagernOffen.value = true;
}
async function verlagere(zielOrt: string): Promise<string | undefined> {
    const id = props.publicId;
    const staette = verlagert.value;
    if (id === undefined || staette === undefined) return undefined;
    const antwort = await props.daten.bindeStaette(zielOrt, {
        operationId: crypto.randomUUID(),
        siteId: staette.id,
        weg: "hierher",
    });
    if (!antwort.ok) return antwort.fehler.message;
    const frisch = await props.daten.sites(id, new AbortController().signal);
    if (props.publicId === id) sites.value = frisch;
    emit("geaendert");
    return undefined;
}

/** Nach „Fertig“ (WI-0196): der Reiter liest neu, Liste und Infopanel folgen. */
const hinzuOffen = ref(false);
async function hinzugefuegt(): Promise<void> {
    const id = props.publicId;
    if (id === undefined) return;
    const frisch = await props.daten.sites(id, new AbortController().signal);
    if (props.publicId === id) sites.value = frisch;
    emit("geaendert");
}

const zahl = (n: number): string => formatNumber(n, 0);
</script>

<template>
    <p v-if="sites === undefined" class="innerorts__hinweis">{{ t("editorListe.laedt") }}</p>
    <p v-else-if="sites === null" class="innerorts__hinweis">{{ t("ortseditor.fehler") }}</p>
    <template v-else>
        <p v-if="fehler" class="innerorts__fehler" :data-testid="`${kennung}-innerorts-fehler`">{{ fehler }}</p>
        <div v-if="aendern" class="innerorts__oben">
            <AvmKnopf groesse="zeile" :testid="`${kennung}-innerorts-hinzu-oeffnen`" @click="hinzuOffen = true">
                {{ t("ortseditor.innerorts.hinzu.knopf") }}
            </AvmKnopf>
        </div>
        <section class="innerorts__abschnitt" :data-testid="`${kennung}-innerorts-belegt`">
            <h4 class="innerorts__titel">{{ t("ortseditor.innerorts.belegt", { n: zahl(sites.bound.length) }) }}</h4>
            <p v-if="sites.bound.length === 0" class="innerorts__hinweis">
                {{ t("ortseditor.innerorts.belegtLeer") }}
            </p>
            <ul v-else class="innerorts__liste">
                <li v-for="staette in sites.bound" :key="staette.id" class="innerorts__zeile">
                    <a v-if="staette.wiki?.url" :href="staette.wiki.url" target="_blank" rel="noreferrer noopener">
                        {{ staette.name }}
                    </a>
                    <span v-else>{{ staette.name }}</span>
                    <span class="innerorts__merkmale">{{ merkmale(staette).join(" · ") }}</span>
                    <template v-if="staette.retired">
                        <span class="innerorts__warnung" :data-testid="`${kennung}-innerorts-stillgelegt`">
                            {{ t("ortseditor.innerorts.stillgelegt") }}
                        </span>
                        <span v-if="staette.successor" class="innerorts__merkmale">
                            {{ t("ortseditor.innerorts.nachfolger", { was: nachfolgerSatz(staette) }) }}
                        </span>
                        <span v-else class="innerorts__merkmale">
                            {{ t("ortseditor.innerorts.nachfolgerFehlt") }}
                        </span>
                    </template>
                    <span v-if="ohneStadt(staette)" class="innerorts__merkmale">
                        {{ t("ortseditor.innerorts.keineStadt") }}
                    </span>
                    <span v-if="aendern" class="innerorts__knoepfe">
                        <button
                            v-if="staette.retired && staette.successor"
                            type="button"
                            class="innerorts__knopf"
                            :disabled="laeuft !== undefined"
                            :data-testid="`${kennung}-innerorts-umhaengen`"
                            @click="binde(staette, 'nachfolger')"
                        >
                            {{ t("ortseditor.innerorts.umhaengen") }}
                        </button>
                        <button
                            v-if="!staette.retired"
                            type="button"
                            class="innerorts__knopf"
                            :disabled="laeuft !== undefined"
                            :data-testid="`${kennung}-innerorts-verlagern`"
                            @click="verlagernAb(staette)"
                        >
                            {{ t("ortseditor.innerorts.verlagern") }}
                        </button>
                        <button
                            type="button"
                            class="innerorts__knopf"
                            :disabled="laeuft !== undefined"
                            :data-testid="`${kennung}-innerorts-loesen`"
                            @click="binde(staette, 'loesen')"
                        >
                            {{ t("ortseditor.innerorts.loesen") }}
                        </button>
                    </span>
                </li>
            </ul>
        </section>

        <section class="innerorts__abschnitt" :data-testid="`${kennung}-innerorts-offen`">
            <h4 class="innerorts__titel">{{ t("ortseditor.innerorts.kette", { n: zahl(sites.open.length) }) }}</h4>
            <p class="innerorts__hinweis">{{ t("ortseditor.innerorts.ketteSatz") }}</p>
            <p v-if="sites.open.length === 0" class="innerorts__hinweis">{{ t("ortseditor.innerorts.ketteLeer") }}</p>
            <ul v-else class="innerorts__liste">
                <li v-for="staette in sites.open" :key="staette.id" class="innerorts__zeile">
                    <a v-if="staette.wiki?.url" :href="staette.wiki.url" target="_blank" rel="noreferrer noopener">
                        {{ staette.name }}
                    </a>
                    <span v-else>{{ staette.name }}</span>
                    <span class="innerorts__merkmale">{{ merkmale(staette).join(" · ") }}</span>
                    <span v-if="staette.rawLocation" class="innerorts__merkmale">
                        {{ t("ortseditor.innerorts.genannt", { was: staette.rawLocation }) }}
                    </span>
                    <span v-if="ohneStadt(staette)" class="innerorts__merkmale">
                        {{ t("ortseditor.innerorts.keineStadt") }}
                    </span>
                    <button
                        v-if="aendern"
                        type="button"
                        class="innerorts__knopf"
                        :disabled="laeuft !== undefined"
                        :data-testid="`${kennung}-innerorts-binden`"
                        @click="binde(staette, 'hierher')"
                    >
                        {{ t("ortseditor.innerorts.binden") }}
                    </button>
                </li>
            </ul>
        </section>

        <p class="innerorts__hinweis" :data-testid="`${kennung}-innerorts-sichtbar`">
            {{ t("ortseditor.innerorts.sichtbar", { n: zahl(sites.sichtbar.count) }) }}
        </p>
    </template>
    <InnerortsHinzufuegen
        v-if="publicId !== undefined && hinzuOffen"
        v-model:offen="hinzuOffen"
        :public-id="publicId"
        :ort-name="ortName ?? ''"
        :kennung="kennung"
        :daten="daten"
        @hinzugefuegt="hinzugefuegt"
    />
    <StaetteVerlagern
        v-if="publicId !== undefined"
        v-model:offen="verlagernOffen"
        :staette="verlagert"
        :von-ort="publicId"
        :kennung="kennung"
        :verlagere="verlagere"
    />
</template>

<style scoped>
.innerorts__oben {
    display: flex;
    margin-bottom: var(--space-6);
}

.innerorts__abschnitt {
    display: grid;
    gap: var(--space-4);
}

.innerorts__abschnitt + .innerorts__abschnitt {
    margin-top: var(--divider-gap);
    padding-top: var(--divider-gap);
    border-top: 1px solid var(--color-divider);
}

.innerorts__titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-small);
    font-weight: var(--font-weight-regular);
}

.innerorts__hinweis {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.innerorts__liste {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.innerorts__zeile {
    display: grid;
    gap: var(--space-2);
    font-size: var(--font-size-small);
}

.innerorts__merkmale {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.innerorts__warnung {
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
}

.innerorts__knoepfe {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
}

.innerorts__fehler {
    margin: 0;
    color: var(--color-danger-text, var(--color-text-strong));
    font-size: var(--font-size-small);
}

/* Ein flacher Knopf an der Zeile, mit der Mindestliste aus Guide §30.5; gesperrt in der eigenen Farbfassung, nie über Deckkraft. */
.innerorts__knopf {
    justify-self: start;
    padding: 0 var(--space-4);
    border: 1px solid var(--color-button-soft-border);
    border-radius: var(--radius-md);
    background: var(--color-button-soft);
    color: var(--color-button-soft-text);
    cursor: pointer;
    font: inherit;
    font-size: var(--font-size-caption);
    transition:
        background-color 120ms ease,
        border-color 120ms ease,
        box-shadow 120ms ease;
}

.innerorts__knopf:hover {
    border-color: var(--color-border-strong);
    background: var(--color-button-soft-hover);
}

.innerorts__knopf:active {
    background: var(--color-button-soft-active);
}

.innerorts__knopf:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.innerorts__knopf:disabled {
    border-color: var(--color-disabled-border);
    background: var(--color-disabled-bg);
    color: var(--color-disabled-text);
    cursor: not-allowed;
}

@media (prefers-reduced-motion: reduce) {
    .innerorts__knopf {
        transition: none;
    }
}
</style>
