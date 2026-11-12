<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { COMMUNITY_PRIORITAETEN, type VorgangListe } from "@avesmaps3d/shared";
import { authState } from "../auth/session-state";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmKreisLegende from "../controls/avm-kreis-legende.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import type { MessageKey } from "../i18n/de";
import { formatNumber, t } from "../i18n/i18n";
import { entprellt } from "../system/entprellt";
import PhotoboxStapel from "../photobox/photobox-stapel.vue";
import { ladeStand } from "./api";
import { darfKartenvorschlaege } from "./kartenvorschlaege-modell";
import {
    KARTEN_KATEGORIE,
    istKarte,
    kartenFensterTitel,
    kartenHinweise,
    kartenQuelle,
    kartenRechts,
    kartenTitel,
    kartenUnterzeile,
    kartenZustandName,
    ladeKartenTeil,
    wartendeZahl,
    zahlAmSegment,
    type KartenTeil,
    type MeldungenEintrag,
} from "./meldungen-karten";
import {
    FILTER_KATEGORIEN,
    LISTEN_REITER,
    LISTEN_SEGMENTE,
    OFFENE_ZUSTAENDE,
    ORDNUNGEN,
    ZUSTAENDIG_WERTE,
    ZUSTAND_NAME,
    filtere,
    hinweise,
    istMeine,
    kategorieName,
    rolleName,
    kreisVon,
    legendeNamen,
    legendeZahlen,
    papierkorbAn,
    prioritaetName,
    prioritaetPille,
    rechtsText,
    sonderrollenImTrichter,
    sortiere,
    titelVon,
    trefferZahl,
    unterzeileTeile,
    type FilterAbschnittId,
    type ListenFilter,
    type ListenReiter,
    type ListenSegment,
    type Ordnung,
} from "./meldungen-modell";
import { REDAKTION_FEHLER_SATZ, ladeListe, redaktionFehler } from "./redaktion-api";
import { KARTENVORSCHLAG_WERKZEUG, VORGANG_WERKZEUG, redaktion } from "./redaktion";

/**
 * Die Liste „Community › Meldungen“ (WI-0268 C3; Bedienkonzept WI-0263 §1.1, §2.2, §4): oben die Segmente Offen · Erledigt · Archiv mit Zahl, darunter die Leiste des Hauses (Suche links, Trichter und
 * Sortierung rechtsbündig, Guide §13.45), dann die Zeilen, unten EINE Zeile Legende mit Zählung.
 *
 * - **Gesucht wird auf dem Server** (`q`: Nummer, Bezug, Quelle und die Texte, die nicht in der Liste stehen); Zustand, Zuständig, Priorität und Kategorie filtert die Liste hier, die Zahlen im Trichter
 *   zählen unter allen anderen Filtern. Der Papierkorb (nur mit `moderate_community`) ist ein Wert im Trichter und lädt das Segment `papierkorb`.
 * - **Meine | Alle** in der Leiste (WI-0279, wie die Liste „Änderungen“), Start auf „Meine“: mir als Person oder einer meiner Sonderrollen zugewiesen (`istMeine`). Der Trichter hat dazu den
 *   Abschnitt „Sonderrolle“ (nur Rollen, die in der Liste vorkommen). Kartenvorschläge haben keine Zuständigkeit und stehen in beiden Reitern.
 * - **Eine Zeile:** Kreis (neu ○, in Arbeit ◐, Rückfrage ◑, abgeschlossen ●), Titel „Lage falsch: Wehrheim“, Unterzeile „COM-000123 · Wehrheim · niemand zuständig“ (sonst Person und Rollen, der
 *   eigene Teil in Gold), rechts die Zeit und, nur bei hoch und
 *   dringend, die Pille. Hinweise: „mögliche Dublette von COM-…“ und „ohne Quelle“. Ein Klick öffnet das Vorgangsfenster, und die Karte fliegt zum Bezug (`redaktion.ts`).
 * - **Kartenvorschläge stehen mit darin** (WI-0305, `meldungen-karten.ts`): Kategorie „Karte“, ihre eigene Route, dieselbe Suche; ein Klick öffnet das Fenster des Vorschlags. Wer nur Kartenvorschläge prüft
 *   (`moderate_map_suggestions` ohne `moderate_submissions`: Kurator, Kartograph), sieht nur sie.
 * - **Ohne eingerichtetes Modul** (`GET /api/community/stand` ist falsch) steht ein ruhiger Hinweis statt der Liste, ebenso ohne Kartenvorschläge für den, der nur sie prüft.
 * - Mehrfachauswahl gibt es hier noch nicht (Bedienkonzept §4: „wie in jeder Editorliste“); sie folgt mit dem Paket der Handgriffe für die Auswahl.
 */
const props = defineProps<{
    rechte: readonly string[];
    /** Das Panel ist zu sehen: Ein Wechsel auf „sichtbar“ lädt neu, damit die Liste nicht von gestern ist. */
    sichtbar?: boolean | undefined;
}>();
const emit = defineEmits<{ zaehler: [meine: number | undefined] }>();

const ich = computed(() => authState.value.person?.id);
const moderiert = computed(() => props.rechte.includes("moderate_community"));
/** Vorgänge liest nur, wer Meldungen bearbeitet; Kartenvorschläge auch Kurator und Kartograph (dieselben Rechte wie ihre Route). */
const darfMeldungen = computed(() => props.rechte.includes("moderate_submissions"));
const darfKarten = computed(() => darfKartenvorschlaege(props.rechte));

// --- Zustand der Leiste ----------------------------------------------------------------------------------------------------

const segment = ref<ListenSegment>("offen");
/** Meine | Alle (WI-0279): Start auf „Meine“. */
const reiter = ref<ListenReiter>("meine");
const reiterWahl = computed({
    get: (): string => reiter.value,
    set: (wert: string) => {
        reiter.value = wert === "alle" ? "alle" : "meine";
    },
});
const reiterOptionen = computed(() =>
    LISTEN_REITER.map((wert) => ({ value: wert, label: t(`community.redaktion.reiter.${wert}`) })),
);
const suche = ref("");
const gesucht = entprellt(suche);
const filter = ref<ListenFilter>({});
const ordnung = ref<Ordnung>("neu");
const imPapierkorb = computed(() => moderiert.value && papierkorbAn(filter.value));
const aktivesSegment = computed(() => (imPapierkorb.value ? "papierkorb" : segment.value));

/** Ein Segment zu wählen nimmt den Papierkorb aus dem Trichter; sonst bliebe es auf „Papierkorb“ stehen. */
const segmentWahl = computed({
    get: () => (imPapierkorb.value ? "" : segment.value),
    set: (wert: string) => {
        segment.value = wert as ListenSegment;
        if (papierkorbAn(filter.value)) filter.value = { ...filter.value, papierkorb: [] };
    },
});

// --- Laden -----------------------------------------------------------------------------------------------------------------

type Stand =
    | { readonly art: "laedt" }
    | { readonly art: "nicht-eingerichtet" }
    | { readonly art: "fehler"; readonly key: MessageKey }
    /** `liste` fehlt, wer keine Meldungen bearbeitet oder wo das Modul fehlt; `karten` fehlt ohne das Recht oder ohne Kartenvorschläge auf der Instanz. Eins von beiden ist da. */
    | { readonly art: "da"; readonly liste: VorgangListe | undefined; readonly karten: KartenTeil | undefined };

const stand = shallowRef<Stand>({ art: "laedt" });
let lauf = 0;
/** Ist das Modul der Meldungen eingerichtet? Gefragt wird, bis es das ist. */
let modulBereit = false;

async function lade(): Promise<void> {
    const mein = ++lauf;
    try {
        if (darfMeldungen.value && !modulBereit) {
            modulBereit = await ladeStand();
            if (mein !== lauf) return;
        }
        const segment = aktivesSegment.value;
        const q = gesucht.value;
        const [liste, karten] = await Promise.all([
            darfMeldungen.value && modulBereit ? ladeListe({ segment, q }) : Promise.resolve(undefined),
            darfKarten.value ? ladeKartenTeil(segment, q) : Promise.resolve(undefined),
        ]);
        if (mein !== lauf) return;
        if (liste === undefined && karten === undefined) {
            stand.value = { art: "nicht-eingerichtet" };
            emit("zaehler", undefined);
            return;
        }
        stand.value = { art: "da", liste, karten };
        emit("zaehler", wartendeZahl(liste, karten));
    } catch (fehler) {
        if (mein !== lauf) return;
        const art = redaktionFehler(fehler);
        // Ein Stand, der schon da ist, bleibt stehen, solange das Neuladen scheitert; ein Satz sagt es.
        stand.value = { art: "fehler", key: REDAKTION_FEHLER_SATZ[art] };
    }
}

watch([aktivesSegment, gesucht], () => void lade(), { immediate: true });
watch(
    () => redaktion.listeVersion.value,
    () => void lade(),
);
watch(
    () => props.sichtbar,
    (an) => {
        if (an === true) void lade();
    },
);

const da = computed(() => (stand.value.art === "da" ? stand.value : undefined));
/** Beide Quellen in einer Liste: die Vorgänge, dann die Kartenvorschläge; Trichter und Sortierung ordnen sie. */
const alle = computed((): MeldungenEintrag[] => [
    ...(da.value?.liste?.zeilen ?? []),
    ...(da.value?.karten?.eintraege ?? []),
]);
/** Was der Reiter zeigt: unter „Meine“ nur meine Vorgänge, dazu die Kartenvorschläge (sie haben keine Zuständigkeit). */
const basis = computed((): MeldungenEintrag[] =>
    reiter.value === "alle" || !darfMeldungen.value
        ? alle.value
        : alle.value.filter((eintrag) => istKarte(eintrag) || istMeine(eintrag, ich.value)),
);
const zeilen = computed((): MeldungenEintrag[] =>
    sortiere(filtere(basis.value, filter.value, ich.value), ordnung.value),
);

// --- Segmente, Trichter, Sortierung ----------------------------------------------------------------------------------------

const segmente = computed(() =>
    LISTEN_SEGMENTE.map((wert) => ({
        value: wert,
        label:
            da.value === undefined
                ? t(`community.redaktion.segment.${wert}`)
                : `${t(`community.redaktion.segment.${wert}`)} (${formatNumber(zahlAmSegment(da.value.liste, da.value.karten, wert), 0)})`,
    })),
);

const gesetzteWahl = computed((): FilterWahl => filter.value);

/** Die Abschnitte des Trichters; die Zahl rechts zählt unter allen anderen Filtern (wie die Ortsliste). */
const kategorien = computed((): string[] => [
    ...(darfMeldungen.value ? FILTER_KATEGORIEN : []),
    ...(darfKarten.value ? [KARTEN_KATEGORIE] : []),
]);

const abschnitte = computed((): FilterAbschnitt[] => {
    const zahl = (abschnitt: FilterAbschnittId, wert: string): number =>
        trefferZahl(basis.value, filter.value, ich.value, abschnitt, wert);
    return [
        ...(aktivesSegment.value === "offen"
            ? [
                  {
                      id: "zustand",
                      titel: t("community.redaktion.filter.zustand"),
                      art: "mehrere" as const,
                      werte: OFFENE_ZUSTAENDE.map((wert) => ({
                          wert,
                          text: t(ZUSTAND_NAME[wert]),
                          zahl: zahl("zustand", wert),
                      })),
                  },
              ]
            : []),
        {
            id: "zustaendig",
            titel: t("community.redaktion.filter.zustaendig"),
            art: "mehrere",
            werte: ZUSTAENDIG_WERTE.map((wert) => ({
                wert,
                text: t(`community.redaktion.filter.zustaendig.${wert}`),
                zahl: zahl("zustaendig", wert),
            })),
        },
        // Sonderrolle (WI-0279): nur Rollen, die in der Liste vorkommen, mit Anzahl.
        ...(sonderrollenWerte.value.length > 0
            ? [
                  {
                      id: "sonderrolle",
                      titel: t("community.redaktion.filter.sonderrolle"),
                      art: "mehrere" as const,
                      werte: sonderrollenWerte.value.map((wert) => ({
                          wert,
                          text: rolleName(wert),
                          zahl: zahl("sonderrolle", wert),
                      })),
                  },
              ]
            : []),
        {
            id: "prioritaet",
            titel: t("community.redaktion.filter.prioritaet"),
            art: "mehrere",
            werte: [...COMMUNITY_PRIORITAETEN].reverse().map((wert) => ({
                wert,
                text: prioritaetName(wert),
                zahl: zahl("prioritaet", wert),
            })),
        },
        {
            id: "kategorie",
            titel: t("community.redaktion.filter.kategorie"),
            art: "mehrere",
            werte: kategorien.value.map((wert) => ({
                wert,
                text: kategorieName(wert),
                zahl: zahl("kategorie", wert),
            })),
        },
        // Der Papierkorb ist Sache der Moderation (Server: `moderate_community`): Ohne das Recht steht der Wert nicht da.
        ...(moderiert.value
            ? [
                  {
                      id: "papierkorb",
                      titel: t("community.redaktion.papierkorb"),
                      art: "mehrere" as const,
                      werte: [{ wert: "zeigen", text: t("community.redaktion.filter.papierkorbZeigen") }],
                  },
              ]
            : []),
    ];
});

const sonderrollenWerte = computed(() =>
    sonderrollenImTrichter(
        basis.value.filter((eintrag) => !istKarte(eintrag)),
        filter.value.sonderrolle ?? [],
    ),
);

function setzeFilter(abschnitt: string, werte: string[]): void {
    filter.value = { ...filter.value, [abschnitt]: werte };
}

const sortierungen = computed(() => ORDNUNGEN.map((wert) => ({ wert, text: t(`community.redaktion.sort.${wert}`) })));
const sortName = computed(() => t(`community.redaktion.sort.${ordnung.value}`));
const sortArt = (wert: string): "zeit" | "menge" => (wert === "prioritaet" ? "menge" : "zeit");

// --- Zeilen ----------------------------------------------------------------------------------------------------------------

/** Das vorderste sichtbare Fenster eines Vorgangs oder Kartenvorschlags: seine Zeile steht gewählt da. */
const vorn = computed(
    () =>
        [...redaktion.vorgangFenster.value, ...redaktion.kartenvorschlagFenster.value]
            .filter((fenster) => fenster.lage !== "versenkt")
            .sort((a, b) => b.vorn - a.vorn)[0],
);
const gewaehlt = (eintrag: MeldungenEintrag): boolean =>
    istKarte(eintrag)
        ? vorn.value?.werkzeug === KARTENVORSCHLAG_WERKZEUG && vorn.value.gegenstand === eintrag.vorschlag.id
        : vorn.value?.werkzeug === VORGANG_WERKZEUG && vorn.value.gegenstand === eintrag.nummer;

const oeffne = (eintrag: MeldungenEintrag): void => {
    if (istKarte(eintrag)) redaktion.oeffneKartenvorschlag(eintrag.vorschlag.id, kartenFensterTitel(eintrag));
    else redaktion.oeffne(eintrag.nummer, `${eintrag.nummer} · ${kategorieName(eintrag.kategorie)}`);
};
/** Wer nur Kartenvorschläge prüft, liest bei fehlenden Kartenvorschlägen deren Satz, nicht den der Community. */
const nichtEingerichtetSatz = computed(() =>
    t(darfMeldungen.value ? "community.redaktion.nichtEingerichtet" : "kartenvorschlag.redaktion.nichtEingerichtet"),
);

const leer = computed(() => {
    if (suche.value.trim() !== "" || filterGesetzt.value) return t("community.redaktion.leer.treffer");
    // Unter „Meine“ im Offenen: nichts zugewiesen (WI-0279; ohne Anrede, Guide §24).
    if (reiter.value === "meine" && darfMeldungen.value && aktivesSegment.value === "offen")
        return t("community.redaktion.leer.meine");
    return t(`community.redaktion.leer.${aktivesSegment.value}`);
});
const filterGesetzt = computed(() =>
    Object.entries(filter.value).some(([abschnitt, werte]) => abschnitt !== "papierkorb" && (werte?.length ?? 0) > 0),
);
const legendeBeschriftung = computed(() => t("community.redaktion.legende"));
</script>

<template>
    <div class="meldungen" data-testid="community-meldungen">
        <PhotoboxStapel :sichtbar="props.sichtbar" />
        <AvmHinweis
            v-if="stand.art === 'nicht-eingerichtet'"
            ton="neutral"
            rolle="status"
            testid="community-nicht-eingerichtet"
        >
            {{ nichtEingerichtetSatz }}
        </AvmHinweis>

        <template v-else>
            <AvmSegmente
                v-model="segmentWahl"
                :options="segmente"
                :label="t('community.redaktion.segmente')"
                testid="community-segmente"
            />
            <AvmListenleiste
                v-model="suche"
                :platzhalter="t('community.redaktion.suche.platzhalter')"
                :beschriftung="t('community.redaktion.suche')"
                testid="community-leiste"
            >
                <AvmSegmente
                    v-if="darfMeldungen"
                    v-model="reiterWahl"
                    :options="reiterOptionen"
                    :label="t('community.redaktion.reiter.beschriftung')"
                    testid="community-wer-reiter"
                />
                <AvmFilterknopf
                    :abschnitte="abschnitte"
                    :wahl="gesetzteWahl"
                    testid="community-filter"
                    @setze="setzeFilter"
                    @loesen="filter = {}"
                />
                <AvmMenueknopf
                    v-model="ordnung"
                    :optionen="sortierungen"
                    :bezeichnung="t('community.redaktion.sort.knopf', { wahl: sortName })"
                    :menue-bezeichnung="t('community.redaktion.sort.menue')"
                    testid="community-sortierung"
                >
                    <template #zeichen="{ wert }"
                        ><AvmSortierzeichen :art="sortArt(wert)" :umgekehrt="wert === 'alt'"
                    /></template>
                </AvmMenueknopf>
            </AvmListenleiste>

            <p v-if="stand.art === 'laedt'" class="meldungen__leise" role="status" data-testid="community-laedt">
                {{ t("community.redaktion.laedt") }}
            </p>
            <template v-if="stand.art === 'fehler'">
                <AvmHinweis ton="gefahr" rolle="alert" testid="community-liste-fehler">{{ t(stand.key) }}</AvmHinweis>
                <AvmKnopf testid="community-liste-erneut" @click="lade()">{{
                    t("community.redaktion.neuLaden")
                }}</AvmKnopf>
            </template>

            <template v-if="da !== undefined">
                <AvmHinweis v-if="imPapierkorb" ton="neutral" rolle="status" testid="community-papierkorb-hinweis">
                    {{ t("community.redaktion.papierkorbHinweis") }}
                </AvmHinweis>
                <p v-if="zeilen.length === 0" class="meldungen__leise" data-testid="community-leer">{{ leer }}</p>
                <ol v-else class="liste" :aria-label="t('community.redaktion.liste')" data-testid="community-liste">
                    <li v-for="zeile in zeilen" :key="istKarte(zeile) ? `karte-${zeile.vorschlag.id}` : zeile.nummer">
                        <!-- Ein Kartenvorschlag (WI-0305): dieselbe Zeile, sein Titel, Ort und Quelle, rechts Zeit oder Entscheidung. -->
                        <button
                            v-if="istKarte(zeile)"
                            type="button"
                            class="zeile"
                            :class="{ 'is-gewaehlt': gewaehlt(zeile) }"
                            :aria-current="gewaehlt(zeile) ? 'true' : undefined"
                            :data-testid="`community-karte-zeile-${zeile.vorschlag.id}`"
                            @click="oeffne(zeile)"
                        >
                            <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="kartenZustandName(zeile)" />
                            <span class="zeile__text">
                                <span class="zeile__titel einzeilig">{{ kartenTitel(zeile) }}</span>
                                <span class="zeile__unter einzeilig"
                                    >{{ kartenUnterzeile(zeile)
                                    }}<template v-if="kartenQuelle(zeile) !== ''">
                                        · <span v-if="zeile.vorschlag.weg === 'datei'" aria-hidden="true">🖼️ </span
                                        >{{ kartenQuelle(zeile) }}</template
                                    ></span
                                >
                                <span v-for="hinweis in kartenHinweise(zeile)" :key="hinweis" class="zeile__hinweis">{{
                                    hinweis
                                }}</span>
                            </span>
                            <span class="zeile__rechts">
                                <span>{{ kartenRechts(zeile) }}</span>
                            </span>
                        </button>
                        <button
                            v-else
                            type="button"
                            class="zeile"
                            :class="{ 'is-gewaehlt': gewaehlt(zeile) }"
                            :aria-current="gewaehlt(zeile) ? 'true' : undefined"
                            :data-testid="`community-zeile-${zeile.nummer}`"
                            @click="oeffne(zeile)"
                        >
                            <AvmKreis :fuellung="kreisVon(zeile.zustand)" :name="t(ZUSTAND_NAME[zeile.zustand])" />
                            <span class="zeile__text">
                                <span class="zeile__titel einzeilig">{{ titelVon(zeile) }}</span>
                                <span class="zeile__unter einzeilig"
                                    ><span
                                        v-for="(teil, i) in unterzeileTeile(zeile, ich)"
                                        :key="i"
                                        :class="{ zeile__mein: teil.mein }"
                                        >{{ teil.text }}</span
                                    ></span
                                >
                                <span v-for="hinweis in hinweise(zeile)" :key="hinweis" class="zeile__hinweis">{{
                                    hinweis
                                }}</span>
                            </span>
                            <span class="zeile__rechts">
                                <span>{{ rechtsText(zeile) }}</span>
                                <AvmPille
                                    v-if="prioritaetPille(zeile.prioritaet) !== undefined"
                                    :ton="prioritaetPille(zeile.prioritaet)"
                                    >{{ prioritaetName(zeile.prioritaet) }}</AvmPille
                                >
                            </span>
                        </button>
                    </li>
                </ol>
                <p v-if="da.karten?.weitere === true" class="meldungen__leise" data-testid="community-karten-weitere">
                    {{ t("community.redaktion.kartenWeitere") }}
                </p>
                <AvmKreisLegende
                    :namen="legendeNamen(aktivesSegment)"
                    :zahlen="legendeZahlen(zeilen)"
                    :beschriftung="legendeBeschriftung"
                    testid="community-legende"
                />
            </template>
        </template>
    </div>
</template>

<style scoped>
.meldungen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
}

.meldungen__leise {
    margin: 0;
    padding: var(--space-8) var(--space-2);
    color: var(--color-text-muted);
}

.liste {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
}

/* Die Zeile der Probierseite (`review/wi-0263/community.html`, `.zeile`): Kreis, Text, rechts Zeit und Pille; Zustände nach Guide §30.5. */
.zeile {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: var(--space-2) var(--space-8);
    align-items: start;
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-8) var(--space-6);
    border: 0;
    border-bottom: 1px solid var(--color-divider);
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition: background-color 120ms ease;
}

.zeile:hover {
    background: var(--color-hover-wash);
}

.zeile:active {
    background: var(--color-active-wash);
}

.zeile:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.zeile.is-gewaehlt {
    background: var(--color-panel-active);
}

.zeile :deep(.avm-kreis) {
    margin-top: var(--space-2);
}

.zeile__text {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
}

.zeile__titel {
    color: var(--color-text-strong);
}

.zeile__unter {
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

/* Der eigene Teil der Unterzeile (WI-0279): die eigene Person, eine eigene Sonderrolle, in Gold. */
.zeile__mein {
    color: var(--color-accent-strong);
}

.zeile__hinweis {
    color: var(--color-warning-soft-text);
    font-size: var(--font-size-small);
}

.zeile__rechts {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-4);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
    .zeile {
        transition: none;
    }
}
</style>
