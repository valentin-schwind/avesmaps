<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import { SOURCE_REFERENCE_KINDS, SOURCE_TYPES, type SourceReferenceKind, type SourceType } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmFilterknopf from "../controls/avm-filterknopf.vue";
import type { FilterAbschnitt, FilterWahl } from "../controls/avm-filterknopf";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKaestchen from "../controls/avm-kaestchen.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmKreis from "../controls/avm-kreis.vue";
import AvmListenleiste from "../controls/avm-listenleiste.vue";
import AvmMenueknopf from "../controls/avm-menueknopf.vue";
import type { MenueOption } from "../controls/avm-menueknopf";
import AvmPille from "../controls/avm-pille.vue";
import AvmSortierzeichen from "../controls/avm-sortierzeichen.vue";
import type { Kreis } from "../editor-liste/liste-modell";
import { formatNumber, locale, t, type MessageKey } from "../i18n/i18n";
import { wikiKlartext } from "../inhalte/wiki-klartext";
import FensterVerweis from "./fenster-verweis.vue";
import {
    alleOffen,
    artWahl,
    filterZahlen,
    gruppenNachArt,
    istEingeschraenkt,
    istZeigbar,
    KLAPP_ARTEN,
    KLAPP_SORTIERUNGEN,
    schalteAlle,
    schalteZeile,
    sichtbare,
    type ArtWahl,
    type KlappAngaben,
    type KlappAnsicht,
    type KlappQuelle,
    type KlappSortierung,
} from "./quellen-klappbox-modell";

/**
 * Die Quellen eines Gegenstands als Klappboxen (WI-0254 `--weiter`; Betreiber 2026-10-27: „wir bräuchten glaub ein mockup für quellen, damit man diese besser erkennt (klappbox?)“, abgenommen
 * 2026-10-28: „Klappbox Quellen zum Aufklappen -> ja; wunderhübsch gelöst alles“). EIN Bauteil für jede Quellenliste; im Reiter „Vorkommen“ des Fensters „Inhalte bearbeiten“ und, über
 * `traeger-quellen.vue`, in den Reitern „Quellen“ der Karteneditoren (Orte, Herrschaftsgebiete).
 *
 * - **Zu** steht eine Zeile: Pfeil, Titel, darunter (oder in einer breiten Spalte rechts) der Quellentyp, die Seiten („S. 130“), die Art des Belegs als Pille (nur wo keine Gruppenköpfe stehen) und der
 *   Statuskreis. Typ und Seiten stehen in festen Spalten, damit sie über alle Zeilen fluchten; in einer schmalen Spalte (Telefon, Reiter Vorkommen) rutscht der Typ als zweite Zeile unter den Titel,
 *   gemessen an der Breite der Box, nicht des Fensters (Container-Abfrage).
 * - **Auf** stehen die Angaben DIESER Verwendung (Fundstelle, Art des Belegs, Notiz) und der Weg zur Quelle im Katalog, wo Titel, Typ und Rechte stehen. Sie gelten für jeden Gegenstand, der die Quelle
 *   nennt; darum ist der Titel hier nie änderbar. „Im Shop“ (nur mit Adresse), „Quelle öffnen“, „✕ Lösen“ (bei stillen „↺ Wiederherstellen“).
 * - **Die Leiste** ist die gemeinsame der Listen (`AvmListenleiste`: links die Suche, rechts Trichter, Sortierung und die Umschalter), keine nachgebaute: Filter nach Art des Belegs und Quellentyp, Sortierung
 *   nach Art (gruppiert, die Vorgabe), wie im Wiki oder nach Titel, „alle auf- und zuklappen“ und „＋ Quelle“, das den Slot `anhaengen` auf- und zuklappt (die Suche im Katalog gehört dem Aufrufer).
 * - **Die Box rechnet nichts und ändert nichts:** Sie zeigt, was der Aufrufer gibt (`quellen`, `KlappQuelle`), und meldet jede Handlung (`aendere`, `loese`, `stelleHer`, `oeffne`). Ob „Lösen“
 *   unterdrückt (aus Legacy oder dem Wiki) oder löst (eigene), entscheidet der Entwurf; ohne Schreibrecht oder bei gesperrtem Gegenstand (`sperre`) sind alle Felder gesperrt, der Grund steht beim Aufrufer EINMAL.
 * - Eine eben angehängte Quelle klappt von selbst auf: Dort trägt man die Fundstelle ein.
 * - **Herkunft = Vergleich mit dem Wiki** (WI-0254 §12; Editoren der Karte und Reiter „Vorkommen“): Eine Zeile kann das Zitat des Wikis tragen (`KlappQuelle.wiki`); weicht sie ab (Kreis ◐), nennt die offene Box
 *   „Im Wiki: …“, bearbeitbar mit „↺ Wiki-Wert“ (`aufWiki`). Wer sofort speichert, sperrt nur die Aktionsknöpfe der Zeile, die schreibt (`KlappQuelle.schreibt`; die Felder bleiben bedienbar), und nennt den Grund einer Abweisung an ihr (`KlappQuelle.fehler`);
 *   `oeffne(id)` klappt eine Zeile von außen auf (eben angehängt und schon gespeichert).
 */
const props = withDefaults(
    defineProps<{
        quellen: readonly KlappQuelle[];
        /** Darf der Nutzer die Angaben ändern? Sonst stehen sie nur da (Reviewer, Orts- und Gebietseditor ohne Schreibweg). */
        bearbeitbar: boolean;
        /** Der Satz, warum die Felder gesperrt sind (`""`: gesperrt, der Grund steht beim Aufrufer); `undefined` ist frei. */
        sperre?: string | undefined;
        /** Der Satz im Körper einer Zeile: wem die Angaben der Quelle gehören („… gelten für jeden Eintrag, der sie nennt“); leer steht keiner da. */
        katalogSatz: string;
        /** Die Kennung für die Testkennungen (`<kennung>-quelle`, …). */
        kennung: string;
        /**
         * WI-0287: die Publikationen eines Eintrags der Kartensammlung. Hier zählt die Folge (die erste aktive ist der Band, den Besucher zuerst sehen): keine Leiste, keine Gruppen, die
         * Folge des Aufrufers; je Zeile links das Umschlagbild (`KlappQuelle.bild`, sonst ein leerer Platz), als Feld nur die Fundstelle, und „↑ Zuerst zeigen“ an jeder aktiven außer der
         * ersten (`zuerst`). Ohne die Angabe bleibt die Box, wie die Editoren der Karte sie kennen.
         */
        publikationen?: boolean | undefined;
        /**
         * „Quelle bearbeiten“ zeigen (Vorgabe: ja, in `withDefaults`; ohne sie macht Vue eine fehlende Boolean-Prop zu `false`, und der Knopf fehlte in den Karteneditoren).
         * Die Publikationen zeigen es nur mit dem Recht, Quellen zu pflegen.
         */
        oeffnen?: boolean | undefined;
    }>(),
    { oeffnen: true },
);

const emit = defineEmits<{
    /** „↑ Zuerst zeigen“ (nur mit `publikationen`): diese Quelle an den Anfang. */
    zuerst: [id: string];
    aendere: [id: string, angaben: KlappAngaben];
    /** Ein Feld ist fertig bearbeitet (der Entwurf fasst die Eingaben eines Felds zu einem Schritt zusammen). */
    feldSchluss: [];
    loese: [id: string];
    stelleHer: [id: string];
    oeffne: [id: string];
    /** „↺ Wiki-Wert“: Art, Fundstelle und Notiz auf das setzen, was das Wiki zitiert (wo `KlappQuelle.wiki` gesetzt ist). */
    aufWiki: [id: string];
}>();

// --- Ansicht: Suche, Filter, Sortierung, offene Zeilen ---
const suche = ref("");
const arten = ref<ArtWahl[]>([]);
const typen = ref<SourceType[]>([]);
const sortierung = ref<KlappSortierung>("art");
const offen = ref<ReadonlySet<string>>(new Set());
const stilleZeigen = ref(false);
const anhaengenOffen = ref(false);

/** Die Publikationen einer Karte: Die Folge des Aufrufers gilt (`wiki` sortiert nicht), ohne Gruppen und ohne die Art des Belegs. */
const folge = computed(() => props.publikationen === true);
const ansicht = computed<KlappAnsicht>(() => ({
    suche: suche.value,
    arten: arten.value,
    typen: typen.value,
    sortierung: folge.value ? "wiki" : sortierung.value,
    stilleZeigen: stilleZeigen.value,
    sprache: locale.value,
}));
const sichtbareQuellen = computed(() => sichtbare(props.quellen, ansicht.value));
const gruppiert = computed(() => !folge.value && sortierung.value === "art");
/** Die Art des Belegs als Pille (wo keine Gruppenköpfe stehen); die Publikationen kennen keine. */
const artPille = computed(() => !gruppiert.value && !folge.value);
/** Die erste aktive Quelle: Sie trägt kein „↑ Zuerst zeigen“. */
const ersteAktive = computed(() => props.quellen.find((q) => q.state === "active")?.id);
/** Die Blöcke der Liste: je Art des Belegs einer mit Kopf, sonst ein einziger ohne. */
const bloecke = computed<readonly { art: ArtWahl | undefined; quellen: readonly KlappQuelle[]; zahl: number }[]>(() =>
    gruppiert.value
        ? gruppenNachArt(sichtbareQuellen.value)
        : [{ art: undefined, quellen: sichtbareQuellen.value, zahl: sichtbareQuellen.value.length }],
);
const zeigbareZahl = computed(() => props.quellen.filter((q) => istZeigbar(q, stilleZeigen.value)).length);
const stilleZahl = computed(() => props.quellen.filter((q) => q.state !== "active").length);
const eingeschraenkt = computed(() => istEingeschraenkt(ansicht.value));
const sichtbareIds = computed(() => sichtbareQuellen.value.map((q) => q.id));
const alleAuf = computed(() => alleOffen(sichtbareIds.value, offen.value));

const ART_NAMEN: Readonly<Record<ArtWahl, MessageKey>> = {
    ausfuehrlich: "inhalte.bezug.ausfuehrlich",
    ergaenzend: "inhalte.bezug.ergaenzend",
    erwaehnung: "inhalte.bezug.erwaehnung",
    ohne: "quellen.klappbox.ohneArt",
};
const artName = (art: ArtWahl): string => t(ART_NAMEN[art]);
const typName = (typ: SourceType): string => t(`infoPanel.sourceType.${typ}`);

/** „Regionalspielhilfe · offiziell“; ist nicht bekannt, ob die Quelle offiziell ist, steht nur der Typ. */
function typZeile(q: KlappQuelle): string {
    if (q.typ === null) return "";
    const offiziell =
        q.offiziell === null ? "" : t(q.offiziell ? "quellen.klappbox.offiziell" : "quellen.klappbox.inoffiziell");
    return [typName(q.typ), offiziell].filter((teil) => teil !== "").join(" · ");
}
const seitenText = (q: KlappQuelle): string =>
    q.seiten.trim() === "" ? "" : t("infoPanel.sources.pages", { pages: q.seiten });
/** Der Kreis heißt nach dem Vergleich mit dem Wiki („Wie im Wiki“, „Weicht vom Wiki ab …“, „Gelöst“), nicht nach der Herkunft (WI-0254 §12). */
const kreisName = (kreis: Kreis): string =>
    t(
        kreis === "leer"
            ? "fenster.traegerQuellen.kreis.leer"
            : kreis === "voll"
              ? "fenster.traegerQuellen.kreis.voll"
              : "fenster.traegerQuellen.kreis.halb",
    );

// --- Filter (der Trichter der Leiste) ---
const zahlen = computed(() => filterZahlen(props.quellen, stilleZeigen.value));
const filterAbschnitte = computed<readonly FilterAbschnitt[]>(() => [
    {
        id: "art",
        titel: t("quellen.klappbox.filter.art"),
        art: "mehrere",
        werte: KLAPP_ARTEN.filter((art) => zahlen.value.arten[art] > 0 || arten.value.includes(art)).map((art) => ({
            wert: art,
            text: artName(art),
            zahl: zahlen.value.arten[art],
        })),
    },
    {
        id: "typ",
        titel: t("quellen.klappbox.filter.typ"),
        art: "mehrere",
        werte: SOURCE_TYPES.filter((typ) => (zahlen.value.typen[typ] ?? 0) > 0 || typen.value.includes(typ)).map(
            (typ) => ({ wert: typ, text: typName(typ), zahl: zahlen.value.typen[typ] ?? 0 }),
        ),
    },
]);
const filterWahl = computed<FilterWahl>(() => ({ art: arten.value, typ: typen.value }));
function setzeFilter(abschnitt: string, werte: string[]): void {
    if (abschnitt === "art") arten.value = KLAPP_ARTEN.filter((art) => werte.includes(art));
    else typen.value = SOURCE_TYPES.filter((typ) => werte.includes(typ));
}
function loeseFilter(): void {
    arten.value = [];
    typen.value = [];
}

// --- Sortierung (das Zeichen der Leiste) ---
const SORT_NAMEN: Readonly<Record<KlappSortierung, MessageKey>> = {
    art: "quellen.klappbox.sort.art",
    wiki: "quellen.klappbox.sort.wiki",
    titel: "inhalte.sortierung.title",
};
const sortierOptionen = computed<readonly MenueOption[]>(() =>
    KLAPP_SORTIERUNGEN.map((wert) => ({ wert, text: t(SORT_NAMEN[wert]) })),
);
const sortierName = computed(() => t(SORT_NAMEN[sortierung.value]));
const alsSortierung = (wert: string): KlappSortierung => KLAPP_SORTIERUNGEN.find((eins) => eins === wert) ?? "art";
/** Das Zeichen einer Ordnung: Titel A–Z, die Art des Belegs (drei Formen) oder die Folge des Wikis (geschichtete Ebenen). */
const sortierZeichen = (wert: string): "name" | "art" | "edition" =>
    wert === "titel" ? "name" : wert === "art" ? "art" : "edition";

// --- Auf und zu ---
const umschalten = (id: string): void => {
    offen.value = schalteZeile(offen.value, id);
};
const alleUmschalten = (): void => {
    offen.value = schalteAlle(offen.value, sichtbareIds.value);
};
/** Eine eben angehängte Quelle klappt auf: Dort trägt man die Fundstelle ein. */
watch(
    // Ein Text statt einer Liste: Eine neue Liste wäre bei jeder Änderung der Quellen „geändert“.
    () =>
        props.quellen
            .filter((q) => q.neu)
            .map((q) => q.id)
            .join(" "),
    (jetzt, vorher) => {
        const bekannt = new Set(vorher.split(" "));
        const neue = jetzt.split(" ").filter((id) => id !== "" && !bekannt.has(id));
        if (neue.length > 0) offen.value = new Set([...offen.value, ...neue]);
    },
);

// --- Anhängen (der Slot gehört dem Aufrufer) ---
const anhaengen = useTemplateRef<HTMLDivElement>("anhaengen");
async function schalteAnhaengen(): Promise<void> {
    anhaengenOffen.value = !anhaengenOffen.value;
    if (!anhaengenOffen.value) return;
    await nextTick();
    anhaengen.value?.querySelector<HTMLInputElement>("input")?.focus();
}

// --- Felder ---
const bezugOptionen = computed(() => [
    { wert: "quelle", text: t("inhalte.bezug.quelle") },
    ...SOURCE_REFERENCE_KINDS.map((art) => ({ wert: art, text: artName(art) })),
]);
const bezugWert = (q: KlappQuelle): string => q.art ?? "quelle";
const alsBezug = (wert: string): SourceReferenceKind | null =>
    SOURCE_REFERENCE_KINDS.find((eins) => eins === wert) ?? null;
/** Eine Zeile ist bearbeitbar, solange sie aktiv ist: Eine stille Verknüpfung ändert sich erst, wenn man sie zurückholt. */
const bearbeitbarEin = (q: KlappQuelle): boolean => props.bearbeitbar && q.state === "active";
const kennungVon = (rest: string): string => `${props.kennung}-${rest}`;
/**
 * Die Sperre der Aktionsknöpfe einer Zeile (Lösen, Holen, ↺ Wiki-Wert): die der ganzen Box, sonst „wird gerade gespeichert“ (kurz, ohne eigenen Satz; der Aufrufer schreibt je Handlung). Die Felder (Fundstelle, Art, Notiz) sperrt
 * nur die Box als Ganzes: Wer sofort speichert, lässt sie bedienbar, weitere Handlungen reihen sich beim Aufrufer ein (der erste Klick auf die Art nach dem Tippen muss wirken).
 */
const zeilenSperre = (q: KlappQuelle): string | undefined => props.sperre ?? (q.schreibt === true ? "" : undefined);

// --- Im Wiki (Editoren der Karte): wo die Angaben vom Zitat des Wikis abweichen, steht es in der offenen Box ---
const wikiAbweichung = (q: KlappQuelle): boolean =>
    q.state === "active" && q.kreis === "halb" && q.wiki !== undefined && q.wiki !== null;
/** „Im Wiki: Ausführlich · S. 12 · Notiz“: nur, was das Wiki sagt, die Notiz als Text statt der Vorlagen. */
function wikiSatz(q: KlappQuelle): string {
    const w = q.wiki;
    if (w === undefined || w === null) return "";
    const teile = [
        artName(w.art ?? "ohne"),
        w.seiten.trim() === "" ? "" : t("infoPanel.sources.pages", { pages: w.seiten.trim() }),
        wikiKlartext(w.notiz),
    ].filter((teil) => teil !== "");
    return t("quellen.klappboxWiki.imWiki", { angaben: teile.join(" · ") });
}

/** Eine Zeile aufklappen, ohne dass jemand sie anklickt (eben angehängt: dort trägt man die Fundstelle ein). */
defineExpose({
    oeffne(id: string): void {
        offen.value = new Set([...offen.value, id]);
    },
});
</script>

<template>
    <div class="qk-box" :data-testid="kennungVon('quellen-box')">
        <AvmListenleiste
            v-if="!folge"
            v-model="suche"
            :platzhalter="t('quellen.klappbox.suche.platzhalter')"
            :beschriftung="t('quellen.klappbox.suche.beschriftung')"
            :testid="kennungVon('quellen-leiste')"
        >
            <AvmFilterknopf
                :abschnitte="filterAbschnitte"
                :wahl="filterWahl"
                :testid="kennungVon('quellen-filter')"
                @setze="setzeFilter"
                @loesen="loeseFilter"
            />
            <AvmMenueknopf
                :model-value="sortierung"
                :optionen="sortierOptionen"
                :bezeichnung="t('inhalte.sortierung.knopf', { wahl: sortierName })"
                :menue-bezeichnung="t('inhalte.sortierung')"
                im-fenster
                :testid="kennungVon('quellen-sortierung')"
                @update:model-value="(wert: string) => (sortierung = alsSortierung(wert))"
            >
                <template #zeichen="{ wert }">
                    <AvmSortierzeichen :art="sortierZeichen(wert)" />
                </template>
            </AvmMenueknopf>
            <AvmKnopf
                groesse="zeile"
                :title="alleAuf ? t('quellen.klappbox.alleZu') : t('quellen.klappbox.alleAuf')"
                :aria-label="alleAuf ? t('quellen.klappbox.alleZu') : t('quellen.klappbox.alleAuf')"
                :testid="kennungVon('quellen-alle')"
                @click="alleUmschalten"
            >
                {{ alleAuf ? "▸" : "▾" }}
            </AvmKnopf>
            <AvmKnopf
                v-if="bearbeitbar && $slots['anhaengen']"
                groesse="zeile"
                :gesperrt="sperre"
                :aria-expanded="anhaengenOffen"
                :testid="kennungVon('quelle-neu-knopf')"
                @click="schalteAnhaengen"
            >
                ＋ {{ t("quellen.klappbox.neu") }}
            </AvmKnopf>
        </AvmListenleiste>

        <div v-if="anhaengenOffen && bearbeitbar" ref="anhaengen" class="qk-box__anhaengen">
            <slot name="anhaengen" />
        </div>

        <p v-if="eingeschraenkt" class="qk-box__anzahl" :data-testid="kennungVon('quellen-anzahl')">
            {{
                t("quellen.klappbox.anzahl", {
                    n: formatNumber(sichtbareQuellen.length, 0),
                    m: formatNumber(zeigbareZahl, 0),
                })
            }}
        </p>

        <p
            v-if="sichtbareQuellen.length === 0"
            class="qk-box__leise"
            :data-testid="kennungVon(zeigbareZahl === 0 ? 'quellen-keine' : 'quellen-nichts')"
        >
            {{
                zeigbareZahl > 0
                    ? t("quellen.klappbox.keine")
                    : folge
                      ? t("quellen.klappbox.publikationen.keine")
                      : t("inhalte.vorkommen.quellen.keine")
            }}
        </p>

        <div v-else class="qk-box__liste" :data-testid="kennungVon('quellen-liste')">
            <template v-for="block in bloecke" :key="block.art ?? 'alle'">
                <h5 v-if="block.art !== undefined" class="qk-gruppe" :data-testid="kennungVon('quellen-gruppe')">
                    <span class="avm-versalmitte">{{ artName(block.art) }}</span>
                    <span class="qk-gruppe__zahl">{{ formatNumber(block.zahl, 0) }}</span>
                </h5>
                <ul class="qk-liste">
                    <li
                        v-for="q in block.quellen"
                        :key="q.id"
                        class="qk"
                        :class="{ 'is-offen': offen.has(q.id), 'is-still': q.state !== 'active' }"
                        :data-testid="kennungVon('quelle')"
                        :data-quelle="q.id"
                        :data-state="q.state"
                    >
                        <button
                            type="button"
                            class="qk__kopf"
                            :aria-expanded="offen.has(q.id)"
                            :title="q.titel === '' ? t('inhalte.verwendung.ohneName') : q.titel"
                            :data-testid="kennungVon('quelle-kopf')"
                            @click="umschalten(q.id)"
                        >
                            <span class="qk__pfeil" aria-hidden="true">{{ offen.has(q.id) ? "▾" : "▸" }}</span>
                            <span v-if="folge" class="qk__bild" :data-testid="kennungVon('quelle-bild')"
                                ><img v-if="q.bild" :src="q.bild" alt="" loading="lazy"
                            /></span>
                            <span class="qk__name">
                                <span class="qk__titel einzeilig">{{
                                    q.titel === "" ? t("inhalte.verwendung.ohneName") : q.titel
                                }}</span>
                                <span v-if="q.typ !== null || artPille" class="qk__typ-unter einzeilig">
                                    <template v-if="q.typ !== null">{{ typName(q.typ) }}</template>
                                    <span v-if="artPille" class="qk__art-unter"
                                        ><template v-if="q.typ !== null"> · </template>{{ artName(artWahl(q)) }}</span
                                    >
                                </span>
                            </span>
                            <span class="qk__rechts" :class="{ 'qk__rechts--art': artPille }">
                                <span class="qk__typ-kurz einzeilig">{{ q.typ === null ? "" : typName(q.typ) }}</span>
                                <span class="qk__seiten einzeilig" :data-testid="kennungVon('quelle-seiten-text')">{{
                                    seitenText(q)
                                }}</span>
                                <AvmPille v-if="artPille" class="qk__art">{{ artName(artWahl(q)) }}</AvmPille>
                                <AvmKreis
                                    v-if="q.kreis !== null"
                                    :fuellung="q.kreis"
                                    :name="kreisName(q.kreis)"
                                    :testid="kennungVon('quelle-kreis')"
                                />
                                <span v-else class="qk__kreis-leer" aria-hidden="true"></span>
                            </span>
                        </button>

                        <div v-if="offen.has(q.id)" class="qk__koerper" :data-testid="kennungVon('quelle-koerper')">
                            <p v-if="q.typ !== null || q.neu || q.state !== 'active'" class="qk__typ">
                                <span v-if="q.typ !== null">{{ typZeile(q) }}</span>
                                <AvmPille v-if="q.state === 'suppressed'" ton="gefahr">{{
                                    t("inhalte.verwendung.chip.unterdrueckt")
                                }}</AvmPille>
                                <AvmPille v-else-if="q.state === 'retired'" ton="warnung">{{
                                    t("inhalte.verwendung.chip.geloest")
                                }}</AvmPille>
                                <AvmPille v-if="q.neu" ton="warnung" :title="t('inhalte.verwendung.neu')">{{
                                    t("quellen.klappbox.neuPille")
                                }}</AvmPille>
                            </p>

                            <div v-if="bearbeitbarEin(q)" class="qk__felder">
                                <label class="qk__feld" :class="{ 'qk__feld--breit': folge }">
                                    <span>{{ t("inhalte.verwendung.fundstelle") }}</span>
                                    <AvmEingabe
                                        :model-value="q.seiten"
                                        :placeholder="t('inhalte.verwendung.fundstelle.platzhalter')"
                                        :gesperrt="sperre"
                                        :testid="kennungVon('quelle-seiten')"
                                        @update:model-value="(wert: string) => emit('aendere', q.id, { pages: wert })"
                                        @change="emit('feldSchluss')"
                                    />
                                </label>
                                <label v-if="!folge" class="qk__feld">
                                    <span>{{ t("inhalte.verwendung.art") }}</span>
                                    <AvmAuswahl
                                        :model-value="bezugWert(q)"
                                        groesse="zeile"
                                        :optionen="bezugOptionen"
                                        :gesperrt="sperre"
                                        :testid="kennungVon('quelle-art')"
                                        @update:model-value="
                                            (wert: string) => emit('aendere', q.id, { referenceKind: alsBezug(wert) })
                                        "
                                    />
                                </label>
                                <label v-if="!folge" class="qk__feld qk__feld--breit">
                                    <span>{{ t("inhalte.verwendung.notiz") }}</span>
                                    <AvmEingabe
                                        :model-value="q.notiz"
                                        :gesperrt="sperre"
                                        :testid="kennungVon('quelle-notiz')"
                                        @update:model-value="(wert: string) => emit('aendere', q.id, { note: wert })"
                                        @change="emit('feldSchluss')"
                                    />
                                </label>
                            </div>
                            <dl
                                v-else-if="q.seiten !== '' || (!folge && (q.art !== null || q.notiz !== ''))"
                                class="qk__angaben"
                            >
                                <template v-if="q.seiten !== ''">
                                    <dt>{{ t("inhalte.verwendung.fundstelle") }}</dt>
                                    <dd>{{ q.seiten }}</dd>
                                </template>
                                <template v-if="q.art !== null && !folge">
                                    <dt>{{ t("inhalte.verwendung.art") }}</dt>
                                    <dd>{{ artName(artWahl(q)) }}</dd>
                                </template>
                                <template v-if="q.notiz !== '' && !folge">
                                    <dt>{{ t("inhalte.verwendung.notiz") }}</dt>
                                    <dd>{{ q.notiz }}</dd>
                                </template>
                            </dl>

                            <div v-if="wikiAbweichung(q)" class="qk__wiki" :data-testid="kennungVon('quelle-wiki')">
                                <span class="qk__wiki-satz">{{ wikiSatz(q) }}</span>
                                <AvmKnopf
                                    v-if="bearbeitbarEin(q)"
                                    groesse="zeile"
                                    :gesperrt="zeilenSperre(q)"
                                    :title="t('quellen.klappboxWiki.wertTitel')"
                                    :testid="kennungVon('quelle-wiki-wert')"
                                    @click="emit('aufWiki', q.id)"
                                >
                                    ↺ {{ t("quellen.klappboxWiki.wert") }}
                                </AvmKnopf>
                            </div>

                            <AvmHinweis
                                v-if="q.fehler !== undefined"
                                ton="gefahr"
                                rolle="alert"
                                :testid="kennungVon('quelle-fehler')"
                            >
                                {{ q.fehler }}
                            </AvmHinweis>

                            <div class="qk__katalog">
                                <p v-if="katalogSatz !== ''" class="qk__hinweis">{{ katalogSatz }}</p>
                                <span class="qk__knoepfe">
                                    <AvmKnopf
                                        v-if="folge && bearbeitbar && q.state === 'active' && q.id !== ersteAktive"
                                        groesse="zeile"
                                        :gesperrt="zeilenSperre(q)"
                                        :testid="kennungVon('quelle-zuerst')"
                                        @click="emit('zuerst', q.id)"
                                    >
                                        <template #zeichen>↑</template>
                                        {{ t("quellen.klappbox.zuerst") }}
                                    </AvmKnopf>
                                    <FensterVerweis
                                        v-if="q.url !== null"
                                        :ziel="q.url"
                                        class="qk__shop"
                                        :testid="kennungVon('quelle-shop')"
                                        >{{ q.korpus ?? t("quellen.klappbox.shop") }}</FensterVerweis
                                    >
                                    <AvmKnopf
                                        v-if="!q.neu && oeffnen"
                                        groesse="zeile"
                                        :gesperrt="q.schreibt === true ? '' : undefined"
                                        :title="t('quellen.klappbox.oeffnenTitel')"
                                        :testid="kennungVon('quelle-oeffnen')"
                                        @click="emit('oeffne', q.id)"
                                    >
                                        {{ t("quellen.klappbox.oeffnen") }}
                                    </AvmKnopf>
                                    <AvmKnopf
                                        v-if="bearbeitbar && q.state === 'active'"
                                        groesse="zeile"
                                        :gesperrt="zeilenSperre(q)"
                                        :title="t('inhalte.vorkommen.quellen.loesen')"
                                        :aria-label="t('inhalte.vorkommen.quellen.loesenName', { name: q.titel })"
                                        :testid="kennungVon('quelle-loesen')"
                                        @click="emit('loese', q.id)"
                                    >
                                        ✕ {{ t("quellen.klappbox.loesen") }}
                                    </AvmKnopf>
                                    <AvmKnopf
                                        v-if="bearbeitbar && q.state !== 'active'"
                                        groesse="zeile"
                                        :gesperrt="zeilenSperre(q)"
                                        :testid="kennungVon('quelle-wieder')"
                                        @click="emit('stelleHer', q.id)"
                                    >
                                        ↺ {{ t("inhalte.verwendung.wiederherstellen") }}
                                    </AvmKnopf>
                                </span>
                            </div>
                        </div>
                    </li>
                </ul>
            </template>
        </div>

        <AvmKaestchen
            v-if="stilleZahl > 0"
            art="checkbox"
            :checked="stilleZeigen"
            :testid="kennungVon('quellen-stille-zeigen')"
            @change="(an: boolean) => (stilleZeigen = an)"
        >
            {{
                t(folge ? "quellen.klappbox.publikationen.stille" : "quellen.klappbox.stille", {
                    n: formatNumber(stilleZahl, 0),
                })
            }}
        </AvmKaestchen>
    </div>
</template>

<style scoped>
/* Die Box misst sich selbst: In einer schmalen Spalte (Telefon, Reiter Vorkommen) rutscht der Typ unter den Titel, gleich wie breit das Fenster ist. */
.qk-box {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    min-width: 0;
    container: qk / inline-size;
}

.qk-box__leise,
.qk-box__anzahl {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qk-box__anzahl {
    font-size: var(--font-size-caption);
}

.qk-box__anhaengen {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.qk-box__liste {
    display: flex;
    flex-direction: column;
    min-width: 0;
}

/* Der Kopf einer Gruppe: die Art des Belegs in Versalien, dahinter die Zahl. */
.qk-gruppe {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
    margin: var(--space-8) 0 var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.qk-box__liste > .qk-gruppe:first-child {
    margin-top: 0;
}

.qk-gruppe__zahl {
    letter-spacing: 0;
}

.qk-liste {
    margin: 0;
    padding: 0;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel);
    list-style: none;
}

.qk + .qk {
    border-top: 1px solid var(--color-divider);
}

.qk.is-still {
    color: var(--color-text-muted);
}

.qk.is-offen {
    background: var(--color-panel-soft);
}

.qk.is-offen .qk__titel {
    color: var(--color-text-strong);
}

.qk__kopf {
    display: flex;
    align-items: center;
    gap: var(--space-6);
    box-sizing: border-box;
    width: 100%;
    min-height: var(--avm-control-h);
    padding: var(--space-2) var(--space-8);
    border: 0;
    background: none;
    color: inherit;
    cursor: pointer;
    font: inherit;
    text-align: left;
}

.qk__kopf:hover {
    background: var(--color-hover-wash);
}

.qk__kopf:focus-visible {
    border-radius: var(--radius-sm);
    outline: none;
    box-shadow: var(--focus-ring);
}

.qk__pfeil {
    flex: none;
    width: 1em;
    color: var(--color-text-muted);
}

/* Das Umschlagbild einer Publikation (WI-0287): klein vor dem Titel, ohne Bild ein leerer Platz in derselben Größe. */
.qk__bild {
    flex: none;
    width: var(--avm-fenster-umschlag-w);
    height: var(--avm-fenster-umschlag-h);
    overflow: hidden;
    border-radius: var(--radius-sm);
    background: var(--color-panel-muted);
}

.qk__bild img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
}

/* Titel und, in einer schmalen Box, der Typ als zweite Zeile darunter. */
.qk__name {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
}

.qk__titel {
    min-width: 0;
}

.qk__typ-unter {
    display: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.qk__art-unter {
    display: none;
}

/* Typ und Seiten als feste Spalten, damit sie über alle Zeilen fluchten: Typ links, Seiten rechtsbündig, dann der Kreis. */
.qk__rechts {
    display: grid;
    flex: none;
    grid-template-columns: 9.5em 7.5em var(--avm-kreis);
    align-items: center;
    gap: var(--space-6);
    min-width: 0;
}

/* Wo keine Gruppenköpfe stehen, nennt die Pille die Art des Belegs: eine eigene Spalte vor dem Kreis. */
.qk__rechts--art {
    grid-template-columns: 9.5em 7.5em 7em var(--avm-kreis);
}

.qk__typ-kurz {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qk__seiten {
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: right;
}

.qk__art {
    justify-self: end;
}

/* Der Platz des Kreises bleibt, wo die Herkunft unbekannt ist: Die Spalten fluchten trotzdem. */
.qk__kreis-leer {
    width: var(--avm-kreis);
    height: var(--avm-kreis);
}

@container qk (max-width: 43em) {
    .qk__typ-unter {
        display: block;
    }

    .qk__typ-kurz {
        display: none;
    }

    .qk__rechts {
        grid-template-columns: minmax(0, 7.5em) var(--avm-kreis);
    }

    .qk__rechts--art {
        grid-template-columns: minmax(0, 7.5em) 7em var(--avm-kreis);
    }
}

/* Wo auch die Pille keinen Platz mehr hat, steht die Art des Belegs hinter dem Typ in der zweiten Zeile. */
@container qk (max-width: 35em) {
    .qk__art {
        display: none;
    }

    .qk__art-unter {
        display: inline;
    }

    .qk__rechts--art {
        grid-template-columns: minmax(0, 7.5em) var(--avm-kreis);
    }
}

@container qk (max-width: 29em) {
    .qk__rechts,
    .qk__rechts--art {
        grid-template-columns: minmax(0, 5.5em) var(--avm-kreis);
    }

    .qk__seiten {
        font-size: var(--font-size-caption);
    }

    .qk__koerper {
        padding-left: var(--space-8);
    }
}

/* Der Körper steht unter dem Titel (eingerückt um Pfeil und Lücke); oben so viel Luft wie unten. */
.qk__koerper {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    padding: var(--space-8) var(--space-8) var(--space-8) calc(var(--space-8) + 1em + var(--space-6));
}

.qk__typ {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qk__felder {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-6);
}

.qk__feld {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.qk__feld--breit {
    grid-column: 1 / -1;
}

.qk__angaben {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: var(--space-2) var(--space-8);
    margin: 0;
}

.qk__angaben dt {
    color: var(--color-text-muted);
}

.qk__angaben dd {
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
}

/* „Im Wiki: …“: der Satz mit dem Wiki-Wert daneben; bricht um, wo es eng wird. */
.qk__wiki {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.qk__wiki-satz {
    flex: 1 1 16em;
    min-width: 0;
    overflow-wrap: anywhere;
}

.qk__katalog {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4) var(--space-8);
}

.qk__hinweis {
    flex: 1 1 16em;
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.qk__knoepfe {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4);
}

.qk__shop {
    align-self: center;
    font-size: var(--font-size-small);
}

/* Am Finger ein Fingerziel, wie die Leiste darüber (zweimal die Pillenhöhe, die Fingerhöhe des Hauses). */
@media (pointer: coarse) {
    .qk__kopf {
        min-height: calc(var(--space-20) * 2);
    }
}
</style>
