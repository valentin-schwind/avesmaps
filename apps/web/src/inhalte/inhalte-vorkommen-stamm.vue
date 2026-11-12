<script setup lang="ts">
import { computed } from "vue";
import { INHALTE_VORKOMMEN_ARTEN, type InhalteVorkommenArt, type SourceType } from "@avesmaps3d/shared";
import AvmAuswahl from "../controls/avm-auswahl.vue";
import AvmEingabe from "../controls/avm-eingabe.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmTextbereich from "../controls/avm-textbereich.vue";
import EntwurfKonflikt from "../fenster/entwurf-konflikt.vue";
import FensterFeldzeile from "../fenster/fenster-feldzeile.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import FensterVerweis from "../fenster/fenster-verweis.vue";
import QuellenAnhaengen from "../fenster/quellen-anhaengen.vue";
import QuellenKlappbox from "../fenster/quellen-klappbox.vue";
import type { KlappAngaben, KlappQuelle } from "../fenster/quellen-klappbox-modell";
import { formatNumber, t, type MessageKey } from "../i18n/i18n";
import InfoCanonPill from "../info-panel/info-canon-pill.vue";
import { canonPillOf } from "../info-panel/panel-header";
import { KEIN_WIKI, quelleAlsKlapp, quellenNotiz, quellenWikiAus, wikiAngaben } from "./inhalte-vorkommen-klapp";
import { standAusVorkommen, type EntwurfQuelle } from "./inhalte-vorkommen-modell";
import type { VorkommenSteuerung } from "./inhalte-vorkommen-steuerung";
import { artName } from "./inhalte-vorkommen-texte";
import { wikiKlartext } from "./wiki-klartext";

/**
 * Spalte 2 des Reiters „Vorkommen“ (WI-0254, Runde 3; Mockup): die Stammdaten des gewählten Eintrags und seine Quellen.
 *
 * - **Identität:** Name, Kategorie, Art / Gruppe, Lebensraum, weitere Namen. **Beschreibung und Herkunft:** die Anmerkung der Redaktion und der
 *   Wiki-Schlüssel, nur lesbar: Er ist die Identität des Eintrags, es wird nie einer erfunden. Ein Eintrag ohne Wiki-Artikel (Vali wählte B am Gate
 *   WI-0254, Migration 0235) hat keinen: Seine Identität ist die eigene Avesmaps-Kennung, und die Pille folgt der Kanon-Regel (INOFFIZIELL | Avesmaps).
 * - **Quellen des Eintrags** sind Katalogreferenzen, keine zweite Quellenliste, und stehen als Klappboxen da (`fenster/quellen-klappbox.vue`, WI-0254 `--weiter`): zu eine Zeile
 *   mit Titel, Typ, Seiten und Kreis, auf die Angaben dieser Verwendung (Fundstelle, Art des Belegs, Notiz); ✕ löst (Legacy-Herkunft: unterdrückt, eigene: gelöst), „Quelle öffnen“
 *   springt in den Reiter Quellen. Anhängen über die Suche im Katalog (Slot `anhaengen` der Box, geöffnet mit „＋ Quelle“). Die Box ändert nichts selbst; dieser Spalte gehören
 *   der Entwurf, der Kreis, die Notiz zur Anzeige und die Sperre.
 * - 🔴 **Der Kreis ist der Vergleich mit dem Wiki** (WI-0254 §12, wie in den Karteneditoren; `inhalte-vorkommen-klapp.ts`): ○ nicht aktiv, ● der Wiki-Artikel des Eintrags zitiert die Quelle mit derselben Art, denselben
 *   Seiten und derselben Notiz, sonst ◐; gerechnet mit den Werten des Entwurfs. Weicht eine Quelle ab, steht in der offenen Box „Im Wiki: …“ mit „↺ Wiki-Wert“ – das setzt die Werte in den ENTWURF, geschrieben wird
 *   erst mit „Speichern“. Gibt es keinen Lauf des WikiSync mit Zitaten der Vorkommen, fehlt der Kreis, und ein Satz sagt es einmal.
 * - **Herkunft je Feld:** Ein Feld, das die Redaktion geändert hat, trägt „manuell“, eines aus dem Wiki „Wiki“; was nichts sagt, ist nicht
 *   bekannt (nie „Wiki“ geraten).
 * - Ein Konflikt (409) steht als Kasten oben, im Wortlaut der Karteneditoren (`EntwurfKonflikt`); der Entwurf bleibt sichtbar.
 * - Ohne Schreibrecht (Reviewer) und für einen unterdrückten Eintrag sind alle Felder gesperrt; der Grund steht EINMAL oben.
 */
const props = defineProps<{
    steuerung: VorkommenSteuerung;
    darfSchreiben: boolean;
    telefon: boolean;
}>();
const emit = defineEmits<{ zurueck: []; weiter: []; oeffneQuelle: [sourceId: string] }>();

const s = props.steuerung;
const eintrag = computed(() => s.eintrag.value);
const stand = computed(() => s.stand.value);
const felder = computed(() => stand.value?.felder);
const start = computed(() => (eintrag.value === undefined ? undefined : standAusVorkommen(eintrag.value)));

const sperrSatz = computed<string | undefined>(() => {
    if (!props.darfSchreiben) return t("inhalte.nurLesen");
    if (felder.value?.aktiv === false) return t("inhalte.vorkommen.stamm.stillgelegt");
    return undefined;
});
const sperre = computed<string | undefined>(() => (sperrSatz.value === undefined ? undefined : ""));

const artOptionen = computed(() => INHALTE_VORKOMMEN_ARTEN.map((wert) => ({ wert, text: artName(wert) })));

const name = computed({
    get: () => felder.value?.name ?? "",
    set: (wert: string) => s.setzeFeldWert("name", wert),
});
const art = computed({
    get: () => felder.value?.art ?? "fauna",
    set: (wert: string) =>
        s.setzeFeldWert(
            "art",
            (INHALTE_VORKOMMEN_ARTEN as readonly string[]).includes(wert) ? (wert as InhalteVorkommenArt) : "fauna",
        ),
});
const synonyme = computed({
    get: () => felder.value?.synonyme ?? "",
    set: (wert: string) => s.setzeFeldWert("synonyme", wert),
});
const notiz = computed({
    get: () => felder.value?.editorNote ?? "",
    set: (wert: string) => s.setzeFeldWert("editorNote", wert),
});

/** Woher ein Feld stammt: geändert im Entwurf (oder von der Redaktion gesetzt) heißt „manuell“, sonst gilt der Vermerk des Eintrags. */
type FeldName = "name" | "art" | "gruppe" | "lebensraum" | "synonyme";
const geaendert = (feld: FeldName): boolean => {
    const jetzt = felder.value;
    const vorher = start.value?.felder;
    return jetzt !== undefined && vorher !== undefined && jetzt[feld] !== vorher[feld];
};
function herkunftText(feld: FeldName): string | undefined {
    const ursprung = geaendert(feld) ? "manual" : eintrag.value?.feldUrsprung[feld];
    if (ursprung === undefined) return undefined;
    return t(ursprung === "wiki" ? "inhalte.literatur.feld.herkunft.wiki" : "inhalte.literatur.feld.herkunft.manuell");
}

/**
 * Art / Gruppe und Lebensraum kommen roh aus der Infobox des Wiki (`[[Pilz]]`, `[[Graslandschaft|Grasland]]`, auch Vorlagen wie `{{R5}}`). Das Feld zeigt den Text (`wikiKlartext`);
 * der gespeicherte Rohwert bleibt unberührt, solange niemand das Feld ändert. Wer es ändert, speichert den Text, den er tippt. Ab der ersten Änderung zeigt
 * das Feld genau diesen Wert und rechnet ihn nicht mehr um, damit sich nichts unter den Fingern verschiebt (Leerzeichen, ein getippter Link).
 */
function wikiFeld(feld: "gruppe" | "lebensraum") {
    return computed({
        get: () => {
            const roh = felder.value?.[feld] ?? "";
            return geaendert(feld) ? roh : wikiKlartext(roh);
        },
        set: (wert: string) => s.setzeFeldWert(feld, wert),
    });
}
const gruppe = wikiFeld("gruppe");
const lebensraum = wikiFeld("lebensraum");

/**
 * Die Notiz an einer Quelle kommt ebenfalls roh aus dem Wiki (Links und Vorlagen wie `{{R5}}` oder `{{Datum|1030|||}}`). Sie zeigt den Text, solange sie dem
 * gespeicherten Stand der Verknüpfung gleicht; wer tippt, speichert seinen Text (`wikiAnzeige`). Der Stand ist der des Servers (`start`), nicht der Entwurf: Eine im
 * Entwurf neu angehängte Verknüpfung hat keinen, ihre Notiz zeigt, was getippt wurde.
 */
const gespeicherteNotizen = computed(
    () => new Map((start.value?.quellen ?? []).map((q) => [q.sourceId, q.note] as const)),
);
/** Was das Wiki an den Quellen dieses Eintrags zitiert (Stand des Servers, nicht der Entwurf). */
const wiki = computed(() => (eintrag.value === undefined ? KEIN_WIKI : quellenWikiAus(eintrag.value)));
const notizDerQuelle = (q: EntwurfQuelle): string =>
    quellenNotiz(q, gespeicherteNotizen.value.get(q.sourceId), wiki.value.zitate.get(q.sourceId));

const stillgelegt = computed(() => felder.value?.aktiv === false);
/** Die Pille nach der Kanon-Regel (Namensraum der Adresse, Quellen, bei einem Eintrag ohne Artikel Avesmaps); sie folgt dem gespeicherten Stand. */
const kanonPille = computed(() => canonPillOf(eintrag.value?.kanon));
const ursprungName = computed(() => {
    const e = eintrag.value;
    return e === undefined ? "" : t(`inhalte.ursprung.${e.ursprung}` as MessageKey);
});
const unterzeile = computed(() =>
    eintrag.value === undefined
        ? undefined
        : t("inhalte.vorkommen.stamm.unterzeile", { art: artName(felder.value?.art ?? eintrag.value.art) }),
);

// --- Quellen des Eintrags ---
const alleQuellen = computed<readonly EntwurfQuelle[]>(() => stand.value?.quellen ?? []);
const aktiveQuellen = computed(() => alleQuellen.value.filter((q) => q.state === "active"));
/** Die Quellen in der Form der Klappbox; der Kreis vergleicht den Entwurf mit dem Wiki, die Notiz zeigt den Text statt der Vorlagen. */
const klappQuellen = computed<readonly KlappQuelle[]>(() =>
    alleQuellen.value.map((q) => quelleAlsKlapp(q, notizDerQuelle(q), wiki.value)),
);
/** „↺ Wiki-Wert“: Art, Fundstelle und Notiz auf das Zitat des Wikis, im Entwurf. */
function setzeAufWiki(sourceId: string): void {
    const zitat = wiki.value.zitate.get(sourceId);
    if (zitat !== undefined) s.stelleQuelleWikiHer(sourceId, wikiAngaben(zitat));
}
const schonDa = (sourceId: string): boolean => aktiveQuellen.value.some((q) => q.sourceId === sourceId);

function haengeQuelleAn(quelle: {
    id: string;
    title: string;
    sourceType: SourceType;
    url?: string | undefined;
    korpus?: string | null | undefined;
}): void {
    s.haengeQuelleAn({
        sourceId: quelle.id,
        title: quelle.title,
        sourceType: quelle.sourceType,
        url: quelle.url ?? null,
        korpus: quelle.korpus ?? null,
    });
    s.leereQuellen();
}

const FELD_NAMEN: Readonly<Record<string, MessageKey>> = {
    name: "inhalte.vorkommen.feld.name",
    art: "inhalte.vorkommen.feld.kategorie",
    gruppe: "inhalte.vorkommen.feld.gruppe",
    lebensraum: "inhalte.vorkommen.feld.lebensraum",
    synonyme: "inhalte.vorkommen.feld.synonyme",
    editorNote: "inhalte.vorkommen.feld.anmerkung",
    aktiv: "inhalte.feld.aktiv",
};
const feldName = (schluessel: string): string => {
    if (schluessel.startsWith("quelle:")) return t("inhalte.vorkommen.abschnitt.quellen");
    if (schluessel.startsWith("regel:")) return t("inhalte.vorkommen.regeln.titel");
    if (schluessel.startsWith("zeile:") || schluessel.startsWith("neu:")) return t("inhalte.vorkommen.orte.titel");
    const bekannt = FELD_NAMEN[schluessel];
    return bekannt === undefined ? schluessel : t(bekannt);
};

const speicherSatz = computed(() => {
    const z = s.zustand.value;
    if (z.art !== "abgelehnt") return undefined;
    // Die Regel, die es schon gibt, nennt der Abschnitt „Regelvorkommen“ selbst (er steht in der Spalte, in der man sie angelegt hat).
    if (z.code === "regel_besteht") return undefined;
    return z.code === "titel_leer" ? t("inhalte.vorkommen.fehler.nameLeer") : z.satz;
});
</script>

<template>
    <FensterSpalte
        breite="fuellen"
        :telefon="telefon"
        :titel="
            eintrag
                ? felder?.name === ''
                    ? t('inhalte.ohneTitel')
                    : (felder?.name ?? eintrag.name)
                : t('inhalte.stamm.titel')
        "
        :unterzeile="unterzeile"
        testid="inhalte-spalte-stamm"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="inhalte-zurueck-liste" @click="emit('zurueck')">{{
                t("inhalte.vorkommen.zurueck.liste")
            }}</AvmKnopf>
        </template>
        <template v-if="eintrag && darfSchreiben" #kopf>
            <AvmKnopf
                groesse="zeile"
                :title="
                    stillgelegt ? t('inhalte.vorkommen.stamm.zurueckholen') : t('inhalte.vorkommen.stamm.unterdruecken')
                "
                :aria-label="
                    stillgelegt ? t('inhalte.vorkommen.stamm.zurueckholen') : t('inhalte.vorkommen.stamm.unterdruecken')
                "
                testid="inhalte-eintrag-unterdruecken"
                @click="s.setzeFeldWert('aktiv', stillgelegt)"
            >
                {{ stillgelegt ? "↺" : "✕" }}
            </AvmKnopf>
        </template>

        <p v-if="s.eintragLaedt.value && !eintrag" class="stamm__leise">{{ t("inhalte.laedt") }}</p>
        <AvmHinweis v-else-if="s.eintragFehler.value" ton="warnung" rolle="alert" testid="inhalte-eintrag-fehler">
            {{ s.eintragFehler.value.status === 404 ? t("inhalte.vorkommen.fehlt") : t("inhalte.vorkommen.fehler") }}
        </AvmHinweis>
        <p v-else-if="!eintrag" class="stamm__leise" data-testid="inhalte-stamm-leer">
            {{ t("inhalte.vorkommen.stamm.leer") }}
        </p>

        <template v-else-if="felder">
            <EntwurfKonflikt
                v-if="s.zustand.value.art === 'konflikt'"
                :bearbeitung="{
                    eigeneAnwenden: (trotzdem?: boolean) => s.eigeneAnwenden(trotzdem),
                    fremdenUebernehmen: () => s.fremdenUebernehmen(),
                }"
                :konflikt="s.zustand.value"
                :feld-name="feldName"
                kennung="inhalte"
            />
            <AvmHinweis v-if="sperrSatz" ton="warnung" testid="inhalte-stamm-sperre">{{ sperrSatz }}</AvmHinweis>
            <AvmHinweis v-if="speicherSatz" ton="gefahr" rolle="alert" testid="inhalte-speichern-fehler">{{
                speicherSatz
            }}</AvmHinweis>

            <div class="stamm__chips" data-testid="inhalte-eintrag-chips">
                <AvmPille :ton="eintrag.ursprung === 'manual' ? 'warnung' : 'neutral'">{{ ursprungName }}</AvmPille>
                <AvmPille v-if="eintrag.wikiKey !== null">{{
                    t("inhalte.stamm.wikiKey", { key: eintrag.wikiKey })
                }}</AvmPille>
                <AvmPille v-else data-testid="inhalte-eintrag-ohne-wiki">{{
                    t("inhalte.vorkommen.stamm.ohneWiki")
                }}</AvmPille>
                <InfoCanonPill v-if="kanonPille" :pill="kanonPille" />
                <AvmPille v-if="stillgelegt" ton="gefahr">{{ t("inhalte.vorkommen.stamm.unterdrueckt") }}</AvmPille>
            </div>

            <AvmHinweis testid="inhalte-stamm-wissen">{{ t("inhalte.vorkommen.stamm.wissen") }}</AvmHinweis>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.abschnitt.identitaet") }}</h4>
                <FensterFeldzeile fuer="inhalte-feld-name">
                    <template #beschriftung>
                        <span>{{ t("inhalte.vorkommen.feld.name") }} *</span>
                        <span
                            v-if="herkunftText('name')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('name') }"
                            >{{ herkunftText("name") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-name"
                        v-model="name"
                        required
                        :gesperrt="sperre"
                        :ungueltig="name.trim() === ''"
                        testid="inhalte-feld-name"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-kategorie">
                    <template #beschriftung>
                        <span>{{ t("inhalte.vorkommen.feld.kategorie") }}</span>
                        <span
                            v-if="herkunftText('art')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('art') }"
                            >{{ herkunftText("art") }}</span
                        >
                    </template>
                    <AvmAuswahl
                        id="inhalte-feld-kategorie"
                        v-model="art"
                        :optionen="artOptionen"
                        :gesperrt="sperre"
                        testid="inhalte-feld-kategorie"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-gruppe">
                    <template #beschriftung>
                        <span>{{ t("inhalte.vorkommen.feld.gruppe") }}</span>
                        <span
                            v-if="herkunftText('gruppe')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('gruppe') }"
                            >{{ herkunftText("gruppe") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-gruppe"
                        v-model="gruppe"
                        :gesperrt="sperre"
                        testid="inhalte-feld-gruppe"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-lebensraum">
                    <template #beschriftung>
                        <span>{{ t("inhalte.vorkommen.feld.lebensraum") }}</span>
                        <span
                            v-if="herkunftText('lebensraum')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('lebensraum') }"
                            >{{ herkunftText("lebensraum") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-lebensraum"
                        v-model="lebensraum"
                        :gesperrt="sperre"
                        testid="inhalte-feld-lebensraum"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile fuer="inhalte-feld-synonyme">
                    <template #beschriftung>
                        <span>{{ t("inhalte.vorkommen.feld.synonyme") }}</span>
                        <span
                            v-if="herkunftText('synonyme')"
                            class="stamm__herkunft"
                            :class="{ 'is-neu': geaendert('synonyme') }"
                            >{{ herkunftText("synonyme") }}</span
                        >
                    </template>
                    <AvmEingabe
                        id="inhalte-feld-synonyme"
                        v-model="synonyme"
                        :gesperrt="sperre"
                        testid="inhalte-feld-synonyme"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
            </section>

            <AvmKnopf v-if="telefon" groesse="zeile" testid="inhalte-weiter-orte" @click="emit('weiter')">
                {{ t("inhalte.vorkommen.weiter.orte") }} ›
            </AvmKnopf>

            <section class="stamm__abschnitt">
                <h4 class="stamm__kopf avm-versalmitte">{{ t("inhalte.vorkommen.abschnitt.beschreibung") }}</h4>
                <FensterFeldzeile :name="t('inhalte.vorkommen.feld.anmerkung')" fuer="inhalte-feld-anmerkung" oben>
                    <AvmTextbereich
                        id="inhalte-feld-anmerkung"
                        v-model="notiz"
                        :zeilen="3"
                        :gesperrt="sperre"
                        testid="inhalte-feld-anmerkung"
                        @change="s.feldSchluss()"
                    />
                </FensterFeldzeile>
                <FensterFeldzeile :name="t('inhalte.feld.wikiKey')">
                    <span class="stamm__lesen einzeilig" data-testid="inhalte-feld-wikikey">
                        <FensterVerweis
                            v-if="eintrag.wikiKey !== null && eintrag.wikiUrl !== undefined"
                            :ziel="eintrag.wikiUrl"
                            >{{ eintrag.wikiKey }}</FensterVerweis
                        >
                        <template v-else>{{ eintrag.wikiKey ?? "—" }}</template>
                    </span>
                </FensterFeldzeile>
                <FensterFeldzeile v-if="eintrag.wikiKey === null" :name="t('inhalte.vorkommen.feld.kennung')">
                    <span class="stamm__lesen" data-testid="inhalte-feld-kennung">{{ eintrag.id }}</span>
                </FensterFeldzeile>
                <p class="stamm__notiz" data-testid="inhalte-stamm-identitaet">
                    {{
                        eintrag.wikiKey === null
                            ? t("inhalte.vorkommen.stamm.identitaetOhne")
                            : t("inhalte.vorkommen.stamm.identitaet")
                    }}
                </p>
            </section>

            <section class="stamm__abschnitt" data-testid="inhalte-eintrag-quellen">
                <h4 class="stamm__kopf avm-versalmitte">
                    {{ t("inhalte.vorkommen.abschnitt.quellen") }} ({{ formatNumber(aktiveQuellen.length, 0) }})
                </h4>
                <p class="stamm__leise">{{ t("inhalte.vorkommen.quellen.hilfe") }}</p>
                <AvmHinweis v-if="!wiki.lauf" testid="inhalte-quellen-kein-lauf">{{
                    t("fenster.traegerQuellen.keinLauf")
                }}</AvmHinweis>

                <QuellenKlappbox
                    :quellen="klappQuellen"
                    :bearbeitbar="darfSchreiben"
                    :sperre="sperre"
                    :katalog-satz="t('quellen.klappbox.katalog')"
                    kennung="inhalte"
                    @aendere="(id: string, angaben: KlappAngaben) => s.aendereQuelleAngaben(id, angaben)"
                    @feld-schluss="s.feldSchluss()"
                    @loese="(id: string) => s.loeseQuelle(id)"
                    @stelle-her="(id: string) => s.stelleQuelleHer(id)"
                    @auf-wiki="setzeAufWiki"
                    @oeffne="(id: string) => emit('oeffneQuelle', id)"
                >
                    <template #anhaengen>
                        <QuellenAnhaengen
                            v-model:text="s.quelleText.value"
                            :treffer="s.quelleTreffer.value"
                            :laedt="s.quelleLaedt.value"
                            :schon-da="schonDa"
                            :gesperrt="sperre"
                            :platzhalter="t('inhalte.vorkommen.quellen.suche.platzhalter')"
                            :beschriftung="t('inhalte.vorkommen.quellen.suche.beschriftung')"
                            :knopf="t('inhalte.vorkommen.quellen.knopf')"
                            kennung="inhalte"
                            @waehle="haengeQuelleAn"
                        />
                    </template>
                </QuellenKlappbox>
            </section>
        </template>
    </FensterSpalte>
</template>

<style scoped>
.stamm__leise {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
}

.stamm__chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.stamm__abschnitt {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
}

.stamm__kopf {
    margin: var(--space-6) 0 0;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--color-divider);
    color: var(--color-accent-brown);
    font-size: var(--font-size-caption);
    font-weight: var(--font-weight-regular);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.stamm__lesen {
    display: block;
    min-width: 0;
    color: var(--color-text-muted);
}

.stamm__notiz {
    margin: 0 0 0 calc(var(--avm-field-label-w) + var(--space-8));
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

/* Die Herkunft eines Felds, klein hinter der Beschriftung (Mockup „Wiki“ / „manuell“). */
.stamm__herkunft {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.stamm__herkunft.is-neu {
    color: var(--color-accent-brown);
}
</style>
