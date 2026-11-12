<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import {
    ORTSEDITOR,
    editorPlacePublicId,
    headerGraphicOfPlace,
    kinder,
    type EditorPlaceRow,
    type SubjectDetail,
    type SubjectFact,
    type SubjectStaettenSection,
} from "@avesmaps3d/shared";
import AvmKnopf from "../controls/avm-knopf.vue";
import EntwurfVerlauf from "../fenster/entwurf-verlauf.vue";
import type { Verlauf } from "../fenster/entwurf-verlauf";
import FensterReiter from "../fenster/fenster-reiter.vue";
import TraegerKarten from "../fenster/traeger-karten.vue";
import { useTraegerKarten } from "../fenster/traeger-karten";
import TraegerQuellen from "../fenster/traeger-quellen.vue";
import WikiBox from "../fenster/wiki-box.vue";
import { formatNumber, isMessageKey, t, type MessageKey } from "../i18n/i18n";
import type { OrtBearbeitung } from "./ort-bearbeitung";
import type { OrtseditorDaten } from "./ortseditor-daten";
import type { PruefStand } from "./befunde";
import OrtseditorBilder from "./ortseditor-bilder.vue";
import OrtseditorFelder from "./ortseditor-felder.vue";
import OrtseditorInnerorts from "./ortseditor-innerorts.vue";
import OrtseditorKonflikt from "./ortseditor-konflikt.vue";
import { createOrtVerlauf } from "./ort-verlauf";
import { verlaufFeldName, verlaufWert } from "./ortseditor-texte";
import { ortWikiBoxFelder } from "./ort-wiki-box";
import FensterFeldzeilen from "../fenster/fenster-feldzeilen.vue";
import type { LageSteuerung } from "./ort-verschieben";

/**
 * Die Spalte „Ortseigenschaften“ (bis 2026-10-11 „Eigenschaften & Overrides“, Betreiber) des Ortseditors (WI-0128 E6, E11; EDIT-0001 §4.3; Blatt Fassung 3). Mit einer Bearbeitung
 * (Schreibrecht, Bearbeiten eingeschaltet) steht im Reiter „Eigenschaften“ das Formular (`ortseditor-felder.vue`) und darüber ein
 * Konflikt, falls jemand schneller war; sonst die Eigenschaften lesend, in Legacys Abschnitten.
 *
 * - **Kopf:** Wappen, Name, Ortsgröße und Art.
 * - **Reiter** aus dem Register (`ORTSEDITOR`): Eigenschaften · Innerorts (n) · Quellen (n) · Bilder · Verlauf (später).
 * - **Eigenschaften:** Identität (Name, Ortsgröße, Art, Einwohner, Herrscher, Lage, Beschreibung), Merkmale (verborgen, Ruine,
 *   Nodix), Lage (Kartenkoordinaten), Wiki (Artikel). Je Wert steht seine Herkunft (Wiki oder Redaktion).
 * - **Innerorts** und **Quellen** holen ihre Listen erst, wenn man den Reiter öffnet (wie das Infopanel). Den Reiter „Innerorts“
 *   zeichnet `ortseditor-innerorts.vue` (E18): belegt, offen genannt, Legacys Anzeige heute. Die **Quellen** sind die Klappboxen von `fenster/traeger-quellen.vue` (WI-0254 §12),
 *   bearbeitet mit dem Recht `manage_sources` und dem Schreibrecht des Editors (`schreibt`), sofort gespeichert; die Zahl im Reitertitel kommt von dort, bis gelesen ist aus dem Detail.
 * - **Verlauf:** der gemeinsame Verlauf der Fenster (`fenster/entwurf-verlauf.vue`) mit dem Anschluss des Orts (`ort-verlauf.ts`, WI-0265 B6d): Serien, Zustand, das gemeinsame Detail mit
 *   Vorher und Nachher und der Karte, ↺ über den Server, „⇄ In Änderungen zeigen“, die Quellen des Orts (WI-0254 §12). Er entsteht mit dem Ort und liest erst, wenn der Reiter ihn zeigt; auch ein
 *   Ort ohne Schreibrecht hat ihn (lesend, ohne ↺).
 * - **Eine Stätte** (nur im Wiki) hat kein Detail: Sie zeigt, was die Liste weiß, und sagt es.
 */
const props = defineProps<{
    zeile: EditorPlaceRow | undefined;
    daten: OrtseditorDaten;
    rechte: readonly string[];
    kennung: string;
    /** Die Medienverwaltung öffnen dürfen (`view_media_private`, ab Reviewer). */
    medienErlaubt: boolean;
    /** Die Bearbeitung des Orts dieses Fensters (E11); ohne sie lesend. */
    bearbeitung?: OrtBearbeitung | undefined;
    /** Verschieben und Hinfliegen im Abschnitt „Lage“ (E12). */
    lage?: LageSteuerung | undefined;
    /** Was Prüfen braucht (E20). */
    pruefen?: PruefStand | undefined;
    /** Wappen und Titelbilder binden (E19, `upload_media`). */
    bilderAendern?: boolean | undefined;
    /** Stätten zuordnen und lösen (E10b, `edit_map_objects` und eingeschaltetes Bearbeiten). */
    staettenAendern?: boolean | undefined;
    /** Schreibt der Editor gerade (sein Schreibrecht und eingeschaltetes Bearbeiten)? Mit dem Recht `manage_sources` bearbeitet der Reiter „Quellen“ dann sofort. */
    schreibt?: boolean | undefined;
}>();
const konflikt = computed(() => {
    const stand = props.bearbeitung?.zustand.value;
    return stand?.art === "konflikt" ? stand : undefined;
});
const emit = defineEmits<{
    medien: [rolle: "coat" | "header"];
    /** ↺ im Verlauf ist gespeichert (E17): Der Verlauf hat den Ort schon neu lesen lassen; Liste und Kacheln folgen. */
    zurueckgenommen: [mapRevision: number | undefined];
    /** Eine Bindung im Reiter „Bilder“ hat sich geändert (E19): Liste und Infopanel lesen neu. */
    bilderGeaendert: [];
    /** Die Wiki-Box hat zugewiesen, entfernt oder gesynct (WI-0253): Der Ort wird neu gelesen, Liste und Kacheln folgen. */
    wikiGeaendert: [mapRevision: number | undefined];
    /** „Quelle öffnen“ in den Quellen: im Fenster „Inhalte bearbeiten“, Reiter Quellen, diese Quelle wählen. */
    oeffneQuelle: [sourceId: string];
}>();

type ReiterId = (typeof ORTSEDITOR)["eintraege"][number]["id"];
const REITER_NAMEN: Record<ReiterId, MessageKey> = {
    eigenschaften: "ortseditor.reiter.eigenschaften",
    innerorts: "ortseditor.reiter.innerorts",
    quellen: "ortseditor.reiter.quellen",
    bilder: "ortseditor.reiter.bilder",
    karten: "ortseditor.reiter.karten",
    verlauf: "ortseditor.reiter.verlauf",
};

const reiter = ref<ReiterId>("eigenschaften");
const detail = shallowRef<SubjectDetail | null | undefined>(undefined);
const staetten = shallowRef<SubjectStaettenSection | null | undefined>(undefined);
/** Die Zahl der aktiven Quellen, sobald der Reiter sie gelesen hat; bis dahin zählt das Detail. */
const quellenZahl = ref<number | undefined>(undefined);
const fehler = ref(false);
const publicId = computed(() => (props.zeile ? editorPlacePublicId(props.zeile) : undefined));
/** Die Karten der Kartensammlung, die diesen Ort abbilden: Der Reiter steht nur, wenn es welche gibt. */
const karten = useTraegerKarten(
    () =>
        publicId.value !== undefined && props.zeile?.origin === "karte"
            ? { kind: "place", id: publicId.value }
            : undefined,
    () => {
        if (reiter.value === "karten") reiter.value = "eigenschaften";
    },
);

let steuerung: AbortController | undefined;
function neueFrage(): AbortSignal {
    steuerung?.abort();
    steuerung = new AbortController();
    return steuerung.signal;
}
onBeforeUnmount(() => steuerung?.abort());

// Der Verlauf gehört zu EINEM Ort (er bleibt gelesen, solange der Reiter ihn zeigt); ein anderer Ort bekommt einen neuen.
const verlauf = shallowRef<Verlauf<never> | undefined>(undefined);
watch(
    publicId,
    (id) => {
        verlauf.value?.destroy();
        verlauf.value =
            id === undefined
                ? undefined
                : createOrtVerlauf(id, () => props.bearbeitung, {
                      zurueckgenommen: (mapRevision) => emit("zurueckgenommen", mapRevision),
                  });
    },
    { immediate: true },
);
onBeforeUnmount(() => verlauf.value?.destroy());

watch(
    publicId,
    (id) => {
        detail.value = undefined;
        staetten.value = undefined;
        quellenZahl.value = undefined;
        fehler.value = false;
        if (id === undefined) return;
        const signal = neueFrage();
        props.daten.detail(id, signal).then(
            (antwort) => {
                if (!signal.aborted) detail.value = antwort;
            },
            () => {
                if (!signal.aborted) fehler.value = true;
            },
        );
    },
    { immediate: true },
);

// Innerorts erst, wenn man den Reiter öffnet (die Quellen lesen sich selbst, `traeger-quellen.vue`).
watch([reiter, publicId], ([jetzt, id]) => {
    if (id === undefined) return;
    if (jetzt === "innerorts" && staetten.value === undefined) {
        const signal = new AbortController().signal;
        void props.daten.staetten(id, signal).then((x) => {
            if (publicId.value === id) staetten.value = x;
        });
    }
});

const reiterListe = computed(() =>
    kinder(ORTSEDITOR, null, props.rechte)
        .filter((eintrag) => eintrag.id !== "karten" || karten.value.length > 0)
        .map((eintrag) => {
            const id = eintrag.id as ReiterId;
            const zahl =
                id === "innerorts"
                    ? detail.value?.counts?.staetten
                    : id === "quellen"
                      ? (quellenZahl.value ?? detail.value?.counts?.sources)
                      : id === "karten"
                        ? karten.value.length
                        : undefined;
            const name = t(REITER_NAMEN[id]);
            return {
                id,
                name: zahl === undefined ? name : `${name} (${formatNumber(zahl, 0)})`,
                spaeter: eintrag.art === "spaeter" ? t("editorPanel.spaeter.satz") : undefined,
            };
        }),
);

const FELDER: readonly { feld: SubjectFact["field"]; name: MessageKey }[] = [
    { feld: "einwohner", name: "infoPanel.field.einwohner" },
    { feld: "oberhaupt", name: "ortseditor.feld.herrscher" },
    { feld: "lage", name: "infoPanel.field.lage" },
    { feld: "description", name: "infoPanel.field.description" },
];

const factText = (fact: SubjectFact): string => ("value" in fact ? fact.value : fact.values.join(", "));
const herkunft = (fact: SubjectFact): string =>
    t(fact.provenance.kind === "wiki" ? "ortseditor.herkunft.wiki" : "ortseditor.herkunft.redaktion");

const identitaet = computed(() =>
    FELDER.map(({ feld, name }) => {
        const fact = detail.value?.facts?.find((x) => x.field === feld);
        return {
            feld,
            name: t(name),
            wert: fact ? factText(fact) : undefined,
            herkunft: fact ? herkunft(fact) : undefined,
        };
    }),
);

// --- Die Wiki-Box (WI-0253): Artikel, Schlüssel, Zuweisen · Sync · Entfernen. Nur für einen Ort auf der Karte; eine Zeile nur aus dem Wiki hat keinen. ---
const wikiBoxMit = computed(() => props.zeile?.origin === "karte");
const wikiBoxRecht = computed(() => (props.bearbeitung !== undefined ? "schreiben" : "lesen"));
const wikiBoxFelder = computed(() => {
    const detail = props.bearbeitung?.detail.value;
    const entwurf = props.bearbeitung?.entwurf.value;
    if (detail === undefined || entwurf === undefined) return [];
    const groesseText = (wert: string): string =>
        isMessageKey(`place.${wert}`) ? t(`place.${wert}` as MessageKey) : wert;
    return ortWikiBoxFelder(
        detail,
        entwurf,
        {
            name: t("ortseditor.feld.name"),
            subtype: t("ortseditor.feld.groesse"),
            einwohner: t("infoPanel.field.einwohner"),
            oberhaupt: t("ortseditor.feld.herrscher"),
            lage: t("infoPanel.field.lage"),
            description: t("infoPanel.field.description"),
        },
        groesseText,
    );
});

const groesse = computed(() => {
    const sub = props.zeile?.subtype;
    return sub ? t(`place.${sub}` as MessageKey) : undefined;
});
const merkmale = computed(() =>
    [
        props.zeile?.hidden ? t("ortseditor.merkmal.verborgen") : undefined,
        props.zeile?.ruined ? t("ortseditor.merkmal.ruine") : undefined,
        props.zeile?.nodix ? t("ortseditor.merkmal.nodix") : undefined,
    ].filter((x): x is string => x !== undefined),
);
/** Das Wappen im Kopf: wie die Liste es dem Editor zeigt (E19, auch vor der Rechteprüfung), sonst das öffentliche des Infopanels. */
const wappen = computed(() => props.zeile?.coat ?? detail.value?.media?.coat?.url);
const koordinaten = computed(() =>
    props.zeile?.x === undefined || props.zeile.y === undefined
        ? undefined
        : `${formatNumber(props.zeile.x, 2)} · ${formatNumber(props.zeile.y, 2)}`,
);
</script>

<template>
    <div class="eigenschaften" :data-testid="`${kennung}-eigenschaften`">
        <p v-if="!zeile" class="eigenschaften__leer">{{ t("ortseditor.keinOrt") }}</p>
        <template v-else>
            <header class="eigenschaften__kopf">
                <img v-if="wappen" class="eigenschaften__wappen" :src="wappen" alt="" width="36" height="44" />
                <div class="eigenschaften__titel">
                    <h3 class="eigenschaften__name einzeilig">{{ zeile.name }}</h3>
                    <p class="eigenschaften__unter">
                        {{
                            [
                                groesse,
                                zeile.kind,
                                zeile.within ? t("editorListe.unter.in", { siedlung: zeile.within }) : undefined,
                            ]
                                .filter(Boolean)
                                .join(" · ")
                        }}
                    </p>
                </div>
            </header>
            <FensterReiter
                v-model="reiter"
                :reiter="reiterListe"
                :beschriftung="t('ortseditor.reiter')"
                :kennung="kennung"
            />
            <div :id="`${kennung}-inhalt-${reiter}`" class="eigenschaften__rumpf" role="tabpanel">
                <template v-if="reiter === 'eigenschaften' && bearbeitung?.detail.value">
                    <OrtseditorKonflikt
                        v-if="konflikt"
                        :bearbeitung="bearbeitung"
                        :konflikt="konflikt"
                        :kennung="kennung"
                    />
                    <OrtseditorFelder :bearbeitung="bearbeitung" :kennung="kennung" :lage="lage" :pruefen="pruefen" />
                    <section v-if="wikiBoxMit" class="eigenschaften__abschnitt">
                        <WikiBox
                            :id="zeile.key"
                            art="ort"
                            :recht="wikiBoxRecht"
                            :ungespeichert="bearbeitung.ungespeichert.value"
                            :felder="wikiBoxFelder"
                            :lesestand="bearbeitung.detail.value.revision"
                            :kennung="kennung"
                            @geaendert="(revision) => emit('wikiGeaendert', revision)"
                        />
                    </section>
                    <section v-else class="eigenschaften__abschnitt">
                        <h4 class="eigenschaften__abschnitt-titel">{{ t("ortseditor.abschnitt.wiki") }}</h4>
                        <p v-if="zeile.wiki" class="eigenschaften__wiki">
                            <a :href="zeile.wiki.url" target="_blank" rel="noopener">{{
                                zeile.wiki.title ?? zeile.wiki.url
                            }}</a>
                        </p>
                        <p v-else class="eigenschaften__hinweis">{{ t("editorListe.unter.keinArtikel") }}</p>
                    </section>
                </template>
                <template v-else-if="reiter === 'eigenschaften'">
                    <p v-if="zeile.origin === 'wiki'" class="eigenschaften__hinweis">{{ t("ortseditor.nurWiki") }}</p>
                    <div v-if="zeile.origin === 'wiki' && lage?.setzbar" class="eigenschaften__setzen">
                        <AvmKnopf
                            groesse="zeile"
                            :gesperrt="lage.setztGerade ? t('ortseditor.setzen.laeuft') : undefined"
                            :testid="`${kennung}-setzen`"
                            @click="lage.setze()"
                        >
                            {{ t("ortseditor.setzen") }}
                        </AvmKnopf>
                        <span class="eigenschaften__hinweis">{{ t("ortseditor.setzen.ziehen") }}</span>
                    </div>
                    <p
                        v-if="zeile.origin === 'wiki' && lage?.setzSatz"
                        class="eigenschaften__hinweis"
                        role="alert"
                        :data-testid="`${kennung}-setzen-meldung`"
                    >
                        {{ lage.setzSatz }}
                    </p>
                    <p v-else-if="fehler" class="eigenschaften__hinweis">{{ t("ortseditor.fehler") }}</p>
                    <section class="eigenschaften__abschnitt">
                        <h4 class="eigenschaften__abschnitt-titel">{{ t("ortseditor.abschnitt.identitaet") }}</h4>
                        <FensterFeldzeilen class="eigenschaften__felder">
                            <dt>{{ t("ortseditor.feld.name") }}</dt>
                            <dd>{{ zeile.name }}</dd>
                            <dt>{{ t("ortseditor.feld.groesse") }}</dt>
                            <dd>{{ groesse ?? "–" }}</dd>
                            <dt>{{ t("ortseditor.feld.art") }}</dt>
                            <dd>{{ zeile.kind ?? "–" }}</dd>
                            <template v-for="f in identitaet" :key="f.feld">
                                <dt>{{ f.name }}</dt>
                                <dd :data-feld="f.feld">
                                    <span>{{
                                        f.wert ?? (detail === undefined && zeile.origin !== "wiki" ? "…" : "–")
                                    }}</span>
                                    <span v-if="f.herkunft" class="eigenschaften__herkunft">{{ f.herkunft }}</span>
                                </dd>
                            </template>
                        </FensterFeldzeilen>
                    </section>
                    <section v-if="zeile.origin !== 'wiki'" class="eigenschaften__abschnitt">
                        <h4 class="eigenschaften__abschnitt-titel">{{ t("ortseditor.abschnitt.lage") }}</h4>
                        <FensterFeldzeilen class="eigenschaften__felder">
                            <dt>{{ t("ortseditor.feld.position") }}</dt>
                            <dd>{{ koordinaten ?? t("ortseditor.ohneLage") }}</dd>
                            <dt>{{ t("ortseditor.feld.merkmale") }}</dt>
                            <dd>{{ merkmale.length > 0 ? merkmale.join(", ") : "–" }}</dd>
                        </FensterFeldzeilen>
                    </section>
                    <section v-if="wikiBoxMit" class="eigenschaften__abschnitt">
                        <WikiBox
                            :id="zeile.key"
                            art="ort"
                            :recht="wikiBoxRecht"
                            :ungespeichert="false"
                            :felder="[]"
                            :kennung="kennung"
                        />
                    </section>
                    <section v-else class="eigenschaften__abschnitt">
                        <h4 class="eigenschaften__abschnitt-titel">{{ t("ortseditor.abschnitt.wiki") }}</h4>
                        <p v-if="zeile.wiki" class="eigenschaften__wiki">
                            <a :href="zeile.wiki.url" target="_blank" rel="noopener">{{
                                zeile.wiki.title ?? zeile.wiki.url
                            }}</a>
                        </p>
                        <p v-else class="eigenschaften__hinweis">{{ t("editorListe.unter.keinArtikel") }}</p>
                    </section>
                </template>
                <OrtseditorInnerorts
                    v-else-if="reiter === 'innerorts'"
                    :public-id="publicId"
                    :daten="daten"
                    :kennung="kennung"
                    :aendern="staettenAendern"
                    :ort-name="zeile?.name"
                    @geaendert="emit('bilderGeaendert')"
                />
                <TraegerKarten v-else-if="reiter === 'karten'" :karten="karten" :kennung="kennung" />
                <TraegerQuellen
                    v-else-if="reiter === 'quellen' && publicId"
                    :id="publicId"
                    kind="place"
                    :recht="rechte.includes('manage_sources')"
                    :schreibt="schreibt === true"
                    :kennung="kennung"
                    @zahl="(n: number) => (quellenZahl = n)"
                    @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
                />
                <p
                    v-else-if="reiter === 'quellen'"
                    class="eigenschaften__hinweis"
                    :data-testid="`${kennung}-quellen-leer`"
                >
                    {{ t("ortseditor.quellen.leer") }}
                </p>
                <EntwurfVerlauf
                    v-else-if="reiter === 'verlauf' && publicId && verlauf"
                    :key="publicId"
                    :verlauf="verlauf"
                    :kennung="kennung"
                    :feld-name="verlaufFeldName"
                    :wert="verlaufWert"
                    :quellen="{
                        ziel: { kind: 'place', id: publicId },
                        recht: rechte.includes('manage_sources'),
                        schreibt: schreibt === true,
                    }"
                />
                <OrtseditorBilder
                    v-else-if="reiter === 'bilder' && medienErlaubt && publicId && zeile.origin === 'karte'"
                    :public-id="publicId"
                    :name="zeile.name"
                    :kennung="kennung"
                    :darf-aendern="bilderAendern === true"
                    :typbild="headerGraphicOfPlace(zeile.subtype)"
                    @medien="(rolle) => emit('medien', rolle)"
                    @geaendert="emit('bilderGeaendert')"
                />
                <template v-else-if="reiter === 'bilder'">
                    <p class="eigenschaften__hinweis">{{ t("ortseditor.bilder.hinweis") }}</p>
                    <p v-if="medienErlaubt && publicId" class="eigenschaften__verweise">
                        <button
                            type="button"
                            class="eigenschaften__verweis"
                            :data-testid="`${kennung}-medien-wappen`"
                            @click="emit('medien', 'coat')"
                        >
                            {{ t("ortseditor.bilder.zuWappen") }}
                        </button>
                        <button
                            type="button"
                            class="eigenschaften__verweis"
                            :data-testid="`${kennung}-medien-titelbilder`"
                            @click="emit('medien', 'header')"
                        >
                            {{ t("ortseditor.bilder.zuTitelbildern") }}
                        </button>
                    </p>
                    <FensterFeldzeilen class="eigenschaften__felder">
                        <dt>{{ t("ortseditor.bilder.wappen") }}</dt>
                        <dd>
                            {{
                                detail?.media?.coat
                                    ? t("editorListe.ja")
                                    : zeile.hasCoat
                                      ? t("ortseditor.bilder.privat")
                                      : t("editorListe.nein")
                            }}
                        </dd>
                        <dt>{{ t("ortseditor.bilder.titelbilder") }}</dt>
                        <dd>{{ formatNumber(zeile.imageCount ?? 0, 0) }}</dd>
                    </FensterFeldzeilen>
                </template>
            </div>
        </template>
    </div>
</template>

<style scoped>
.eigenschaften {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
    min-height: 0;
}

.eigenschaften__leer,
.eigenschaften__hinweis {
    margin: 0;
    color: var(--color-text-muted);
}

/* „● Auf der Karte setzen“ an einem Wiki-Eintrag (E16): Knopf und Satz in einer Zeile, umbrechend. */
.eigenschaften__setzen {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.eigenschaften__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-8);
}

.eigenschaften__wappen {
    flex: none;
    width: var(--avm-fenster-daumen);
    height: auto;
}

.eigenschaften__titel {
    min-width: 0;
}

.eigenschaften__name {
    margin: 0;
    color: var(--color-text-strong);
    font-size: var(--font-size-subhead);
    font-weight: normal;
}

.eigenschaften__unter {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.eigenschaften__rumpf {
    display: flex;
    flex-direction: column;
    gap: var(--space-10);
}

.eigenschaften__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-6) var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
}

.eigenschaften__abschnitt-titel {
    margin: 0;
    color: var(--color-accent-strong);
    font-size: var(--font-size-caption);
    font-weight: normal;
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

/* Raster und Kante: `FensterFeldzeilen`. Mehrere Werte in einem Feld stehen nebeneinander und brechen um. */
.eigenschaften__felder dd {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-6);
}

.eigenschaften__herkunft {
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.eigenschaften__wiki {
    margin: 0;
}

.eigenschaften__verweise {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2) var(--space-12);
    margin: 0;
}

.eigenschaften__verweis {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-decoration: underline;
    transition: color 120ms ease;
}

.eigenschaften__verweis:hover {
    color: var(--color-link-hover);
}

.eigenschaften__verweis:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.eigenschaften__wiki a {
    color: var(--color-link);
}

.eigenschaften__wiki a:hover {
    color: var(--color-link-hover);
}
</style>
