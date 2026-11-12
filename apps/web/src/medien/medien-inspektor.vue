<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
    istOhneKiEntstehung,
    type MamAssetSummary,
    type MamTypeImage,
    type MediaGalleryDetail,
    type MediaTypeImageVariant,
    type MediaUsage,
    type MediaUsageSubject,
} from "@avesmaps3d/shared";
import { authState } from "../auth/session-state";
import AvmBildansicht from "../controls/avm-bildansicht.vue";
import AvmHinweis from "../controls/avm-hinweis.vue";
import AvmKnopf from "../controls/avm-knopf.vue";
import AvmPille from "../controls/avm-pille.vue";
import AvmSegmente from "../controls/avm-segmente.vue";
import FensterKarte from "../fenster/fenster-karte.vue";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { t } from "../i18n/i18n";
import type { MedienDaten } from "./medien-daten";
import MedienFeldliste from "./medien-feldliste.vue";
import MedienGalerie from "./medien-galerie.vue";
import MedienKastenEigenschaften from "./medien-kasten-eigenschaften.vue";
import MedienKastenEinreichung from "./medien-kasten-einreichung.vue";
import MedienKastenTypbild from "./medien-kasten-typbild.vue";
import MedienLoeschenFenster from "./medien-loeschen-fenster.vue";
import { loeschHindernis, loeschHindernisSatz } from "./medien-loeschen-modell";
import MedienNotausFenster from "./medien-notaus-fenster.vue";
import MedienKastenEntstehung from "./medien-kasten-entstehung.vue";
import MedienKastenRechte from "./medien-kasten-rechte.vue";
import MedienAuswahlFenster from "./medien-auswahl-fenster.vue";
import type { BindbareRolle } from "./medien-formular-modell";
import type { BildbezugAnfrage } from "./medien-bildbezug-modell";
import { einreichungRechte, einreichungVon } from "./medien-einreichung-modell";
import { createMedienClient } from "./medien-client";
import { namensKonflikt, vorbelegterTitel } from "./medien-karte-neu-modell";
import { umSprung } from "./medien-karte-vorschau-modell";
import {
    Handlung,
    createMedienOperationen,
    operationsFehler,
    type MedienOperationen,
    type OperationsFehler,
} from "./medien-operationen";
import {
    aktiverNotaus,
    ansichtFolge,
    dateiZeilen,
    freigabeSatz,
    ingestZeilen,
    interneVorschau,
    legacyZeilen,
    oeffentlich,
    rechteZeilen,
    trefferBild,
    verlaufText,
    vorschau,
    vorschlagPruefen,
    wappenMaengel,
} from "./medien-inspektor-modell";
import type { KorrekturEntwurf } from "./medien-stelle";
import { anzeigeName, datumZeit, kurzKennung, pruefstandName, technikName, zahl } from "./medien-text";
import MedienMergeFenster from "./medien-merge-fenster.vue";
import MedienKastenZusammengefuehrt from "./medien-kasten-zusammengefuehrt.vue";
import MedienVerwendungen from "./medien-verwendungen.vue";

/**
 * Spalte 3 der Medienverwaltung: der Inspector (WI-0068 §3.3, in dieser Reihenfolge): Vorschau · Titel und Kennung · Status ·
 * Verwendungen (samt Galerie und „gleiche Datei“) · Eigenschaften · Entstehung · Rechte · Provenienz · Dateien · Notaus · Historie ·
 * Handlungen.
 *
 * - 🔴 **Gespeichert heißt nicht geprüft** (§7): Der Hinweis steht bei den Rechten, und die Pillen trennen „öffentlich“ (Entscheidung
 *   der Policy je Verwendung) vom Prüfstand der Rechte.
 * - 🔴 **Urheber ≠ Hochlader** (§2 Nr. 5): Der Urheber steht bei den Rechten, wer das Bild hereinbrachte bei der Provenienz
 *   (`media_ingest`); keine Angabe wird aus der anderen abgeleitet.
 * - **Private Felder** stehen nur, wenn die Route sie liefert, mit der Marke „intern“ (`medien-inspektor-modell.ts`).
 * - **Bearbeiten je Kasten** (P4b, Blatt 1, Betreiber 2026-10-10: „jeden Kasten einzeln (A)“): Eigenschaften, Entstehung und Rechte
 *   tragen „⊙ Bearbeiten“ (`medien-kasten*.vue`), mit `upload_media`; die Prüfung im Kasten Rechte mit `review_media_rights`. Nach dem
 *   Speichern lädt das Asset neu, die Liste und die Zählungen auch (Name, Körbe).
 * - **Handlungen** (Ersetzen, Notaus) stehen schon da, damit die Gestalt stimmt, und sind gesperrt: Sie kommen später (Guide §7: ein
 *   gesperrter Knopf trägt seinen Satz sichtbar).
 */
const props = defineProps<{
    daten: Pick<MedienDaten, "detail" | "verwendung" | "galerien" | "erneutAsset" | "erneutListe" | "erneutNavigation">;
    asset: string | undefined;
    /** Der Treffer aus der Liste, solange der Inspector noch lädt: Name und Bild stehen dann schon da. */
    zusammenfassung: MamAssetSummary | undefined;
    telefon: boolean;
    /** Wie viele Treffer die Liste hat (für „‹ Treffer (84)“ am Telefon). */
    treffer: number;
    /** Der Schreibpfad; in Tests ersetzbar. */
    operationen?: MedienOperationen | undefined;
    /**
     * Die gewählte Typbildkategorie (`medien-typbilder.vue`), wenn das Medienobjekt „Typbilder“ offen ist: Dann steht der Kasten
     * „Typbild“ vorn. Ohne sie ist der Inspector der gewöhnliche Asset-Inspector.
     */
    typbild?: MamTypeImage | undefined;
    /**
     * Die gezeigte Variante der Typbildkategorie (WI-0281): Der Umschalter „KI | Ohne KI“ steht über der Vorschau, und das gewählte Asset ist das dieser
     * Variante. Hat die Variante noch keines, steht nur der Kasten „Typbild“ mit „Typbild wählen oder hochladen …“.
     */
    typbildVariante?: MediaTypeImageVariant | undefined;
    /** Läuft das Lösen einer Variante gerade (WI-0281)? */
    typbildLoest?: boolean | undefined;
    /** Eine Stelle, die jemand für die Korrektur einer Einreichung auf der Karte gewählt hat (WI-0272 S3); gilt nur für das gewählte Asset. */
    neueStelle?: { x: number; y: number } | undefined;
    /** Der Entwurf der Korrektur von vor der Kartenwahl, auch nach einem Abbruch; gilt nur für das gewählte Asset. */
    entwurf?: KorrekturEntwurf | undefined;
}>();
const emit = defineEmits<{
    aufKarte: [subjekt: MediaUsageSubject];
    von: [subjekt: MediaUsageSubject];
    waehleAsset: [id: string];
    /** „⇄ anderes Typbild wählen …“: Das Fenster öffnet die Auswahl mit der Kategorie und der Variante als Ziel. */
    typbildWaehlen: [];
    /** Der Umschalter „KI | Ohne KI“ (WI-0281): Das Fenster zeigt die andere Variante und wählt ihr Asset. */
    typbildVariante: [variante: MediaTypeImageVariant];
    /** „Lösen“ bestätigt (WI-0281): Das Fenster löst den ★ der gezeigten Variante. */
    typbildLoesen: [];
    /** Das Werk ist endgültig gelöscht: Das Fenster wählt es ab und liest Liste und Zahlen neu. */
    geloescht: [];
    /** Eine Verwendung als Typbild (★): zur Kategorie und Variante in der Liste der Typbilder. */
    typbild: [kategorie: string, variante: MediaTypeImageVariant];
    /** Eine Verwendung an einer Karte der Kartensammlung: zur Karte (WI-0068 R5). */
    karte: [id: string];
    /** „Vorschlag prüfen …“ am Bild eines offenen Kartenvorschlags (OPS-000093): die Medienverwaltung wechselt auf Eingänge › Kartenvorschläge mit diesem Vorschlag. */
    vorschlag: [id: string];
    /** „Vorschau erzeugen“ fand einen gleichen Namen (WI-0287 Punkt 5): in den Eintrag, dessen Platz den Konflikt zeigt. */
    vorschauKonflikt: [id: string];
    /** „Stelle auf der Karte wählen“ in der Korrektur einer Einreichung: Das Fenster gibt die Karte frei und merkt sich den Entwurf (WI-0272 S3). */
    stelleWaehlen: [entwurf: KorrekturEntwurf];
    /** Die Kartenwahl samt Entwurf ist beim Kasten angekommen: Das Fenster vergisst sie. */
    korrekturZu: [];
    erneut: [];
    zurueck: [];
}>();

const detail = computed(() => props.daten.detail.value);
const verwendung = computed(() => props.daten.verwendung.value);
const d = computed(() => detail.value.wert);
const u = computed(() => verwendung.value.wert);
/** Die Einreichung eines Besuchers hinter dem Asset (WI-0272 S3); ohne sie bleibt der Inspector der gewöhnliche. */
const einreichung = computed(() => einreichungVon(d.value));
/** Das Bild gehört zu einem OFFENEN Kartenvorschlag, und die Sitzung darf ihn prüfen (OPS-000093). */
const vorschlagZumPruefen = computed(() => vorschlagPruefen(d.value, authState.value.capabilities));
const einreichungsRechte = computed(() => einreichungRechte(authState.value.capabilities));

const name = computed(() => {
    const ersteVerwendung = u.value?.usages[0];
    if (d.value !== undefined) {
        return anzeigeName(
            { ...d.value.asset, submission: einreichung.value },
            ersteVerwendung === undefined
                ? props.zusammenfassung?.primaryUsage
                : { subject: ersteVerwendung.subject, role: ersteVerwendung.role, gallery: ersteVerwendung.gallery },
        );
    }
    return props.zusammenfassung === undefined
        ? undefined
        : anzeigeName(props.zusammenfassung, props.zusammenfassung.primaryUsage);
});
// Erst die öffentliche Datei, sonst die private Vorschau (WI-0068 P4b); bis das Asset da ist, die des Treffers.
const bild = computed(() => {
    if (d.value !== undefined) {
        const datei = vorschau(d.value);
        if (datei?.url !== null && datei?.url !== undefined)
            return { url: datei.url, breite: datei.width, hoehe: datei.height, intern: false };
        const intern = interneVorschau(d.value);
        if (intern?.privateUrl !== null && intern?.privateUrl !== undefined)
            return { url: intern.privateUrl, breite: intern.width, hoehe: intern.height, intern: true };
    }
    const treffer = props.zusammenfassung === undefined ? null : trefferBild(props.zusammenfassung);
    return treffer === null
        ? undefined
        : { url: treffer.url, breite: treffer.width, hoehe: treffer.height, intern: treffer.intern };
});
const notaus = computed(() => (d.value === undefined ? undefined : aktiverNotaus(d.value)));

// --- Vorschau erzeugen (WI-0287 Punkt 5; OPS-000091: „Für Karten, deren Rechte wir haben, möchte ich eine Vorschau erzeugen“, Ort: Media Inspector) ---
const erzeugenLaeuft = ref(false);
const erzeugenHinweis = ref<string | undefined>(undefined);
const erzeugenFehler = ref<OperationsFehler | undefined>(undefined);
const erzeugenHandlung = new Handlung();
let medienClient: ReturnType<typeof createMedienClient> | undefined;
watch(
    () => props.asset,
    () => {
        erzeugenHinweis.value = undefined;
        erzeugenFehler.value = undefined;
    },
);

/**
 * An der Verwendung als Karte eines Eintrags: Gibt es `Vorschau von „<Eintrag>“` unter „Kartenvorschauen“ schon, führt der Weg in den Eintrag, dessen Platz den Konflikt zeigt
 * (Entwurf); sonst entsteht die Vorschau hier, und ein Satz nennt die Liste, in der sie liegt.
 */
async function vorschauErzeugen(usage: MediaUsage): Promise<void> {
    const detail = d.value;
    if (detail === undefined || usage.subject === null || usage.citymap === undefined || erzeugenLaeuft.value) return;
    const eintrag = usage.subject;
    const titel = vorbelegterTitel("map_preview", eintrag.name);
    erzeugenLaeuft.value = true;
    erzeugenHinweis.value = undefined;
    erzeugenFehler.value = undefined;
    try {
        medienClient ??= createMedienClient();
        const gleich = await medienClient
            .suche({ q: titel, type: "map_preview", ohneReisebilder: true, limit: 20 }, new AbortController().signal)
            .then((antwort) => namensKonflikt(titel, antwort.items))
            .catch(() => undefined);
        if (gleich !== undefined) {
            emit("vorschauKonflikt", eintrag.id);
            return;
        }
        const revision = usage.citymap.revision;
        await erzeugenHandlung.fuehreAus((operationId) =>
            operationen.karteVorschauErzeugen(eintrag.id, {
                operationId,
                baseRevision: revision,
                sourceAssetId: detail.asset.id,
                title: titel,
            }),
        );
        erzeugenHinweis.value = t("medien.karten.vorschau.liegtJetzt", {
            titel,
            liste: t("medien.typMehrzahl.map_preview"),
        });
        gespeichert();
    } catch (error) {
        erzeugenFehler.value = operationsFehler(error);
        // Der Eintrag ist anders als gesehen: neu lesen, damit der nächste Versuch die neue Revision trägt.
        props.daten.erneutAsset();
    } finally {
        erzeugenLaeuft.value = false;
    }
}

/** „Erzeugt aus <Karte>. …“ und „Ändern geht nur an der <Karte>.“ an einer erzeugten Vorschau; „Gilt auch für …“ an ihrer Karte. */
const werkAus = computed(() => umSprung("medien.karten.vorschau.werkAus", "karte"));
const nurAnKarte = computed(() => umSprung("medien.karten.vorschau.nurAnKarte", "karte"));
const giltAuch = computed(() => umSprung("medien.karten.vorschau.giltAuch", "vorschauen"));

// --- Bildbezug je Verwendung (Betreiber 2026-10-11, Operation `header.relation`) ---
// --- Einzelbild-Notaus (Betreiber 2026-10-10: „im mam kann man dann immernoch bilder etc gezielt offline nehmen“) ---
const darfNotaus = computed(() => authState.value.capabilities.includes("suspend_media_publication"));
const notausOffen = ref(false);
/** „Zusammenführen …“ aus den Verwendungen (WI-0068 D1): mehrere Werke mit denselben Bytes werden eines. */
const mergeOffen = ref(false);

/**
 * Nach dem Zusammenführen hat sich überall etwas geändert: Das bleibende Werk trägt neue Verwendungen, das aufgegangene keine
 * mehr, und die Körbe zählen anders. Gewählt wird danach das BLEIBENDE - das aufgegangene ist kein Gegenstand mehr.
 */
function mergeFertig(bleibt: string): void {
    mergeOffen.value = false;
    props.daten.erneutListe();
    props.daten.erneutNavigation();
    if (bleibt === props.asset) props.daten.erneutAsset();
    else emit("waehleAsset", bleibt);
}

/** Nach dem Aufheben einer Zusammenführung: Das zurückgekehrte Werk steht wieder in Liste und Zahlen, dieses hat Verwendungen abgegeben. */
function mergeAufgehoben(): void {
    props.daten.erneutAsset();
    props.daten.erneutListe();
    props.daten.erneutNavigation();
}

// --- Endgültig löschen (WI-0068 R4; Betreiber 2026-10-17, „A, nur eigene Uploads“; PhotoBox-Bilder WI-0272, Vali 2026-11-08) ---
const darfLoeschen = computed(() => authState.value.capabilities.includes("delete_media"));
const loeschenOffen = ref(false);
/** Warum der Knopf gesperrt steht: kein Recht, oder das Werk ist nicht löschbar (`loeschHindernis`). Dasselbe gilt im Kasten „Nach der Freigabe“. */
const loeschenGesperrt = computed(() => {
    if (!darfLoeschen.value) return t("medien.handlung.loeschenKeinRecht");
    const hindernis = d.value === undefined ? undefined : loeschHindernis(d.value);
    return hindernis === undefined ? undefined : loeschHindernisSatz(hindernis);
});

/** Nach einem Notaus oder seiner Aufhebung ändert sich die Freigabe überall: Asset, Liste und Zahlen neu lesen. */
function notausFertig(): void {
    props.daten.erneutAsset();
    props.daten.erneutListe();
    props.daten.erneutNavigation();
}

const bezugLaeuft = ref(false);
const bezugFehler = ref<OperationsFehler | undefined>(undefined);
const bezugHandlung = new Handlung();

/**
 * Übersteuert den Bildbezug EINER Verwendung oder gibt sie auf die Regel zurück. Danach lädt der Inspector dasselbe Asset neu
 * (`behalten`), damit der neue Stand und die neue Revision da sind, ohne dass der offene Kasten zuklappt.
 */
async function setzeBildbezug(anfrage: BildbezugAnfrage, wert: "place_view" | "type_image" | null): Promise<void> {
    if (bezugLaeuft.value) return;
    bezugLaeuft.value = true;
    bezugFehler.value = undefined;
    try {
        await bezugHandlung.fuehreAus((operationId) =>
            operationen.bildbezugSetzen({ operationId, ...anfrage, value: wert }),
        );
        props.daten.erneutAsset();
    } catch (error) {
        bezugFehler.value = operationsFehler(error);
        // Auch nach einem Konflikt neu lesen: die Revision, mit der der nächste Versuch sendet, kommt von dort.
        if (bezugFehler.value.konflikt !== undefined) props.daten.erneutAsset();
    } finally {
        bezugLaeuft.value = false;
    }
}

// --- Bearbeiten je Kasten ---
const operationen = props.operationen ?? createMedienOperationen();
// Die Rechte der Sitzung, wie in der Verwaltung; der Server prüft jede Operation selbst.
const bearbeitbar = computed(() => authState.value.capabilities.includes("upload_media"));
const kannPruefen = computed(() => authState.value.capabilities.includes("review_media_rights"));
const kannCommunityLizenz = computed(() => authState.value.capabilities.includes("edit_community_license"));
/** Der Name, den die Liste ohne eigenen zeigt: der aus dem Objekt (Platzhalter im Feld „Name in der Liste“). */
const ersatzName = computed(() => {
    if (d.value === undefined) return "";
    const erste = u.value?.usages[0];
    return anzeigeName(
        { id: d.value.asset.id, title: null, submission: einreichung.value },
        erste === undefined
            ? props.zusammenfassung?.primaryUsage
            : { subject: erste.subject, role: erste.role, gallery: erste.gallery },
    );
});

/** Die Auswahl für einen Platz aus den Verwendungen (WI-0068 P4b): anderes Wappen bzw. weiteres Titelbild. */
const auswahl = ref<
    { subjekt: { kind: "place" | "territory"; id: string; name: string }; rolle: BindbareRolle } | undefined
>();
const auswahlOffen = ref(false);
function waehlen(platz: NonNullable<typeof auswahl.value>): void {
    auswahl.value = platz;
    auswahlOffen.value = true;
}

// --- „wird gerechnet …“ (WI-0068 P4b, Schritt 6): Solange der Job die Fassungen rechnet (`pending`), lädt das Asset alle drei Sekunden
// nach, höchstens drei Minuten lang; danach sagt ein Satz, dass es länger dauert. Ist es fertig, lädt auch die Liste (Bild der Kachel).
const RECHNEN_TAKT = 3_000;
const RECHNEN_HOECHSTENS = 180_000;
const rechnet = computed(() => d.value?.asset.technicalState === "pending");
const rechnetLange = ref(false);
let rechnenSeit: { id: string; seit: number } | undefined;
let rechnenTimer: ReturnType<typeof setTimeout> | undefined;
watch(
    () => [d.value?.asset.id, d.value?.asset.technicalState, d.value?.asset.revision] as const,
    ([id, stand]) => {
        if (rechnenTimer !== undefined) clearTimeout(rechnenTimer);
        rechnenTimer = undefined;
        if (id === undefined) return;
        if (stand !== "pending") {
            // War es eben noch in Arbeit, zeigt jetzt auch die Kachel das Bild.
            if (rechnenSeit?.id === id) props.daten.erneutListe();
            rechnenSeit = undefined;
            rechnetLange.value = false;
            return;
        }
        if (rechnenSeit?.id !== id) rechnenSeit = { id, seit: Date.now() };
        if (Date.now() - rechnenSeit.seit > RECHNEN_HOECHSTENS) {
            rechnetLange.value = true;
            return;
        }
        rechnenTimer = setTimeout(() => props.daten.erneutAsset(), RECHNEN_TAKT);
    },
    { immediate: true },
);
onBeforeUnmount(() => {
    if (rechnenTimer !== undefined) clearTimeout(rechnenTimer);
});

/** Nach dem Speichern: das Asset neu, dazu Liste und Zählungen (Name, Körbe, Prüfstand). */
function gespeichert(): void {
    props.daten.erneutAsset();
    props.daten.erneutListe();
    props.daten.erneutNavigation();
}

/** Die Bildansicht (Guide §13.46): ein Klick auf die Vorschau zeigt sie groß, mit ‹ › durch ihre Galerie. */
const folge = computed(() =>
    props.asset === undefined || bild.value === undefined
        ? undefined
        : ansichtFolge(props.daten.galerien.value, props.asset, {
              url: bild.value.url,
              breite: bild.value.breite,
              hoehe: bild.value.hoehe,
              titel: name.value ?? null,
          }),
);
const ansicht = ref<number | null>(null);
const galerien = computed<MediaGalleryDetail[]>(() => props.daten.galerien.value);

/** Der Umschalter der Typbildvarianten (WI-0281, Mockup „KI-Version | No-KI-Version“): Segmente des Hauses (Guide §13.25), die Wahl gilt. */
const variante = computed<MediaTypeImageVariant>(() => props.typbildVariante ?? "ki");
const variantenOptionen = computed(() => [
    { value: "ki", label: t("medien.typbild.variante.ki") },
    { value: "ohne_ki", label: t("medien.typbild.variante.ohne_ki") },
]);
function waehleVariante(wert: string): void {
    const neu: MediaTypeImageVariant = wert === "ohne_ki" ? "ohne_ki" : "ki";
    if (neu !== variante.value) emit("typbildVariante", neu);
}
</script>

<template>
    <FensterSpalte
        breite="inspektor"
        :telefon="telefon"
        :titel="t('medien.inspektor.titel')"
        testid="medien-spalte-inspektor"
    >
        <template v-if="telefon" #zurueck>
            <AvmKnopf groesse="zeile" testid="medien-zurueck-treffer" @click="emit('zurueck')">{{
                t("medien.zurueck.treffer", { n: zahl(treffer) })
            }}</AvmKnopf>
        </template>

        <div class="medien-inspektor" data-testid="medien-inspektor">
            <AvmSegmente
                v-if="typbild !== undefined"
                :model-value="variante"
                :options="variantenOptionen"
                :label="t('medien.typbild.variante.label')"
                testid="medien-typbild-variante"
                @update:model-value="waehleVariante"
            />
            <!-- Eine Variante ohne Asset (WI-0281): nur der Kasten, dort wählen oder hochladen. -->
            <MedienKastenTypbild
                v-if="typbild !== undefined && asset === undefined"
                :eintrag="typbild"
                :variante="variante"
                :darf-setzen="bearbeitbar"
                :loest="typbildLoest"
                @waehlen="emit('typbildWaehlen')"
                @waehle-asset="emit('waehleAsset', $event)"
                @variante="waehleVariante"
                @loesen="emit('typbildLoesen')"
            />
            <p v-else-if="asset === undefined" class="medien-inspektor__satz" data-testid="medien-inspektor-leer">
                {{ t("medien.inspektor.leer") }}
            </p>
            <template v-else>
                <figure class="medien-inspektor__vorschau">
                    <button
                        v-if="bild"
                        type="button"
                        class="medien-inspektor__gross"
                        :aria-label="t('bildansicht.oeffnen')"
                        :title="t('bildansicht.oeffnen')"
                        data-testid="medien-vorschau-gross"
                        @click="ansicht = folge?.stelle ?? null"
                    >
                        <img
                            :src="bild.url"
                            :width="bild.breite ?? undefined"
                            :height="bild.hoehe ?? undefined"
                            alt=""
                            data-testid="medien-vorschau"
                        />
                    </button>
                    <figcaption v-else-if="rechnet" class="medien-inspektor__ohne" data-testid="medien-wird-gerechnet">
                        <span class="medien-inspektor__dreht" aria-hidden="true">↻</span>
                        <span class="medien-inspektor__rechnet">{{ t("medien.inspektor.wirdGerechnet") }}</span>
                        <span>{{
                            t(rechnetLange ? "medien.inspektor.rechnetLange" : "medien.inspektor.wirdGerechnetSatz")
                        }}</span>
                    </figcaption>
                    <figcaption v-else class="medien-inspektor__ohne">
                        {{ t("medien.inspektor.ohneVorschau") }}
                    </figcaption>
                </figure>
                <p v-if="bild?.intern" class="medien-inspektor__vorschausatz" data-testid="medien-vorschau-intern">
                    <span class="medien-inspektor__intern">{{ t("medien.intern") }}</span> ·
                    {{ t("medien.inspektor.internVorschau") }}
                </p>
                <AvmBildansicht v-model="ansicht" :bilder="folge?.bilder ?? []" testid="medien-bildansicht" />
                <MedienAuswahlFenster
                    v-if="auswahl"
                    v-model:offen="auswahlOffen"
                    :subjekt="auswahl.subjekt"
                    :rolle="auswahl.rolle"
                    :darf-hochladen="bearbeitbar"
                    weg="medien"
                    :operationen="operationen"
                    @gebunden="gespeichert"
                />
                <div class="medien-inspektor__kopf">
                    <h4 class="medien-inspektor__name" data-testid="medien-inspektor-name">{{ name ?? "" }}</h4>
                    <span class="medien-inspektor__kennung" :title="asset" data-testid="medien-inspektor-kennung">{{
                        t("medien.asset.kurz", { id: kurzKennung(asset) })
                    }}</span>
                </div>

                <AvmHinweis
                    v-if="detail.fehler"
                    :ton="detail.fehler.ton"
                    rolle="alert"
                    testid="medien-inspektor-fehler"
                    >{{ detail.fehler.text }}</AvmHinweis
                >
                <AvmKnopf
                    v-if="detail.fehler?.erneut"
                    groesse="zeile"
                    testid="medien-inspektor-erneut"
                    @click="emit('erneut')"
                    >{{ t("medien.erneut") }}</AvmKnopf
                >
                <p v-if="detail.laedt && !d" class="medien-inspektor__satz">{{ t("medien.inspektor.laedt") }}</p>

                <template v-if="d">
                    <div class="medien-inspektor__pillen" data-testid="medien-pillen">
                        <AvmPille
                            v-if="u"
                            :ton="oeffentlich(u) ? 'erfolg' : 'warnung'"
                            testid="medien-pille-oeffentlich"
                            >{{
                                t(oeffentlich(u) ? "medien.pille.oeffentlich" : "medien.pille.nichtOeffentlich")
                            }}</AvmPille
                        >
                        <AvmPille
                            v-if="d.rights"
                            :ton="
                                d.rights.clearance === 'cleared'
                                    ? 'erfolg'
                                    : d.rights.clearance === 'rejected'
                                      ? 'gefahr'
                                      : 'warnung'
                            "
                            testid="medien-pille-rechte"
                            >{{ t("medien.pille.rechte", { stand: pruefstandName(d.rights.clearance) }) }}</AvmPille
                        >
                        <AvmPille v-if="d.asset.creationMethod === 'ai_generated'">{{ t("medien.pille.ki") }}</AvmPille>
                        <!-- Die Entstehung ohne KI (WI-0281, Mockup „No-KI“): nur, wo sie eingetragen ist, nie aus fehlenden KI-Angaben. -->
                        <AvmPille
                            v-else-if="istOhneKiEntstehung(d.asset.creationMethod)"
                            testid="medien-pille-ohne-ki"
                            >{{ t("medien.pille.ohneKi") }}</AvmPille
                        >
                        <AvmPille v-if="notaus || d.erzeugtAus?.offline" ton="gefahr" testid="medien-pille-notaus">{{
                            t("medien.pille.notaus")
                        }}</AvmPille>
                        <AvmPille v-if="d.asset.technicalState !== 'ok'" ton="gefahr">{{
                            technikName(d.asset.technicalState)
                        }}</AvmPille>
                    </div>
                    <!-- Das Bild eines offenen Kartenvorschlags (OPS-000093): der Weg in die Redaktion, mit einem der beiden Rechte. -->
                    <div
                        v-if="vorschlagZumPruefen"
                        class="medien-inspektor__vorschlag"
                        data-testid="medien-vorschlag-hinweis"
                    >
                        <p class="medien-inspektor__satz">
                            {{ t("medien.vorschlag.hinweis", { nummer: vorschlagZumPruefen.nummer }) }}
                        </p>
                        <AvmKnopf
                            groesse="zeile"
                            testid="medien-vorschlag-pruefen"
                            @click="emit('vorschlag', vorschlagZumPruefen.id)"
                            >{{ t("medien.vorschlag.pruefen") }}</AvmKnopf
                        >
                    </div>
                    <!-- Bei einer Einreichung sagt der Kasten „Nach der Freigabe“ es für die Rolle photobox (auch „wartet auf die Freigaberegel“). -->
                    <p
                        v-if="freigabeSatz(u) && einreichung === undefined"
                        class="medien-inspektor__satz"
                        data-testid="medien-freigabe"
                    >
                        {{ freigabeSatz(u) }}
                    </p>
                    <AvmHinweis v-if="wappenMaengel(d)" ton="warnung" testid="medien-wappen-maengel">{{
                        wappenMaengel(d)
                    }}</AvmHinweis>

                    <!-- Die drei Kästen einer Reisebild-Einreichung (WI-0272 S3): nur, wo das Asset eine hat. -->
                    <MedienKastenEinreichung
                        v-if="einreichung !== undefined"
                        :key="`einreichung-${d.asset.id}`"
                        :detail="d"
                        :verwendung="u"
                        :rechte="einreichungsRechte"
                        :operationen="operationen"
                        :vorschau-url="bild?.url"
                        :neue-stelle="neueStelle"
                        :entwurf="entwurf"
                        :laedt="detail.laedt"
                        :darf-loeschen="darfLoeschen"
                        :loeschen-gesperrt="loeschenGesperrt"
                        @gespeichert="gespeichert"
                        @neu-laden="daten.erneutAsset()"
                        @stelle-waehlen="(neu) => emit('stelleWaehlen', neu)"
                        @korrektur-zu="emit('korrekturZu')"
                        @loeschen="loeschenOffen = true"
                    />

                    <MedienKastenTypbild
                        v-if="typbild !== undefined"
                        :eintrag="typbild"
                        :variante="variante"
                        :darf-setzen="bearbeitbar"
                        :loest="typbildLoest"
                        @waehlen="emit('typbildWaehlen')"
                        @waehle-asset="emit('waehleAsset', $event)"
                        @variante="waehleVariante"
                        @loesen="emit('typbildLoesen')"
                    />

                    <FensterKarte :titel="t('medien.abschnitt.verwendungen', { n: zahl(d.usageCount) })">
                        <AvmHinweis v-if="verwendung.fehler" :ton="verwendung.fehler.ton">{{
                            verwendung.fehler.text
                        }}</AvmHinweis>
                        <AvmHinweis
                            v-if="bezugFehler"
                            :ton="bezugFehler.ton"
                            rolle="alert"
                            testid="medien-bildbezug-fehler"
                            >{{ bezugFehler.text }}</AvmHinweis
                        >
                        <AvmHinweis
                            v-if="erzeugenFehler"
                            :ton="erzeugenFehler.ton"
                            rolle="alert"
                            testid="medien-vorschau-erzeugen-fehler"
                            >{{ erzeugenFehler.text }}</AvmHinweis
                        >
                        <AvmHinweis v-if="erzeugenHinweis" rolle="status" testid="medien-vorschau-erzeugt">{{
                            erzeugenHinweis
                        }}</AvmHinweis>
                        <MedienVerwendungen
                            v-if="u"
                            :verwendung="u"
                            :darf-binden="bearbeitbar"
                            :asset-id="d.asset.id"
                            :galerien="galerien"
                            :bezug-laeuft="bezugLaeuft"
                            :vorschau-sperre="d.vorschauSperre"
                            :erzeugen-laeuft="erzeugenLaeuft"
                            @vorschau-erzeugen="vorschauErzeugen"
                            @bezug="setzeBildbezug"
                            @waehlen="waehlen"
                            @auf-karte="emit('aufKarte', $event)"
                            @von="emit('von', $event)"
                            @typbild="(kategorie, art) => emit('typbild', kategorie, art)"
                            @karte="emit('karte', $event)"
                            @waehle-asset="emit('waehleAsset', $event)"
                            @zusammenfuehren="mergeOffen = true"
                        />
                    </FensterKarte>

                    <FensterKarte
                        v-for="galerie in galerien"
                        :key="galerie.id"
                        :titel="
                            t('medien.abschnitt.galerie', { titel: galerie.title ?? t('medien.galerie.ohneTitel') })
                        "
                    >
                        <MedienGalerie
                            :galerie="galerie"
                            :aktuell="asset"
                            @waehle-asset="emit('waehleAsset', $event)"
                        />
                    </FensterKarte>

                    <MedienKastenEigenschaften
                        :key="`eigenschaften-${d.asset.id}`"
                        :detail="d"
                        :bearbeitbar="bearbeitbar"
                        :operationen="operationen"
                        :ersatz-name="ersatzName"
                        @gespeichert="gespeichert"
                        @neu-laden="daten.erneutAsset()"
                    />
                    <!-- Die Entstehung einer erzeugten Vorschau samt KI-Zeichen kommt von ihrer Karte (WI-0287 Punkt 5): hier nur lesen. -->
                    <MedienKastenEntstehung
                        :key="`entstehung-${d.asset.id}`"
                        :detail="d"
                        :bearbeitbar="bearbeitbar && d.erzeugtAus === undefined"
                        :operationen="operationen"
                        @gespeichert="gespeichert"
                        @neu-laden="daten.erneutAsset()"
                    />
                    <!--
                        Eine erzeugte Vorschau (WI-0287 Punkt 5): Ihre Rechte folgen der Karte und ändern sich nur dort. Der Kasten liest nur und springt zur Karte;
                        hält der Notaus der Karte sie, sagt er es.
                    -->
                    <FensterKarte
                        v-if="d.erzeugtAus"
                        :titel="t('medien.abschnitt.rechte')"
                        data-testid="medien-kasten-rechte-folgt"
                    >
                        <MedienFeldliste :zeilen="rechteZeilen(d)" testid="medien-rechte" />
                        <p
                            v-if="d.erzeugtAus.offline"
                            class="medien-inspektor__satz"
                            data-testid="medien-rechte-karte-offline"
                        >
                            {{ t("medien.karten.vorschau.offline") }}
                        </p>
                        <p class="medien-inspektor__satz" data-testid="medien-rechte-erzeugt-aus">
                            {{ werkAus.davor
                            }}<button
                                type="button"
                                class="medien-inspektor__sprung"
                                @click="emit('waehleAsset', d.erzeugtAus.assetId)"
                            >
                                {{ d.erzeugtAus.title ?? t("medien.karten.vorschau.karte") }}</button
                            >{{ werkAus.danach }}
                        </p>
                        <p class="medien-inspektor__satz" data-testid="medien-rechte-nur-karte">
                            {{ nurAnKarte.davor
                            }}<button
                                type="button"
                                class="medien-inspektor__sprung"
                                data-testid="medien-rechte-zur-karte"
                                @click="emit('waehleAsset', d.erzeugtAus.assetId)"
                            >
                                {{ t("medien.karten.vorschau.karte") }}</button
                            >{{ nurAnKarte.danach }}
                        </p>
                    </FensterKarte>
                    <MedienKastenRechte
                        v-else
                        :key="`rechte-${d.asset.id}`"
                        :detail="d"
                        :bearbeitbar="bearbeitbar"
                        :kann-pruefen="kannPruefen"
                        :kann-community-lizenz="kannCommunityLizenz"
                        :operationen="operationen"
                        @gespeichert="gespeichert"
                        @neu-laden="daten.erneutAsset()"
                    >
                        <template v-if="d.erzeugte && d.erzeugte.length > 0" #zusatz>
                            <p class="medien-inspektor__satz" data-testid="medien-rechte-gilt-auch">
                                {{ giltAuch.davor
                                }}<template v-for="(erzeugt, i) in d.erzeugte" :key="erzeugt.assetId"
                                    >{{ i > 0 ? ", " : ""
                                    }}<button
                                        type="button"
                                        class="medien-inspektor__sprung"
                                        @click="emit('waehleAsset', erzeugt.assetId)"
                                    >
                                        {{ erzeugt.title ?? t("medien.karten.platz.kopfVorschau") }}
                                    </button></template
                                >{{ giltAuch.danach }}
                            </p>
                        </template>
                    </MedienKastenRechte>

                    <FensterKarte :titel="t('medien.abschnitt.provenienz')">
                        <MedienFeldliste
                            v-for="(eintrag, index) in d.ingest"
                            :key="index"
                            :zeilen="ingestZeilen(eintrag, index)"
                            testid="medien-provenienz"
                        />
                        <p v-if="d.ingest.length === 0" class="medien-inspektor__satz">
                            {{ t("medien.inspektor.keinIngest") }}
                        </p>
                        <MedienFeldliste :zeilen="legacyZeilen(d)" testid="medien-legacy" />
                        <p class="medien-inspektor__satz">{{ t("medien.inspektor.urheberNichtHochlader") }}</p>
                    </FensterKarte>

                    <FensterKarte :titel="t('medien.abschnitt.dateien', { n: zahl(d.representations.length) })">
                        <ul class="medien-inspektor__dateien" data-testid="medien-dateien">
                            <li v-for="datei in dateiZeilen(d)" :key="datei.id">
                                <a
                                    v-if="datei.url"
                                    class="medien-inspektor__link"
                                    :href="datei.url"
                                    target="_blank"
                                    rel="noopener"
                                    data-testid="medien-datei-link"
                                    >{{ datei.titel }}</a
                                >
                                <span v-else class="medien-inspektor__datei">{{ datei.titel }}</span>
                                <span class="medien-inspektor__unter">{{ datei.unter }}</span>
                                <span
                                    v-if="datei.geloescht"
                                    class="medien-inspektor__unter"
                                    data-testid="medien-datei-geloescht"
                                    >{{ datei.geloescht }}</span
                                >
                                <span v-if="datei.speicher" class="medien-inspektor__unter">
                                    <span class="medien-inspektor__intern">{{ t("medien.intern") }}</span>
                                    {{ datei.speicher }}
                                </span>
                            </li>
                        </ul>
                    </FensterKarte>

                    <FensterKarte v-if="d.suspensions.length > 0" :titel="t('medien.abschnitt.notaus')">
                        <ul class="medien-inspektor__dateien">
                            <li v-for="eintrag in d.suspensions" :key="eintrag.revision + eintrag.suspendedAt">
                                <span class="medien-inspektor__datei">{{
                                    t(eintrag.liftedAt === null ? "medien.notaus.aktiv" : "medien.notaus.aufgehoben", {
                                        am: datumZeit(eintrag.suspendedAt),
                                    })
                                }}</span>
                                <span class="medien-inspektor__unter">
                                    <span class="medien-inspektor__intern">{{ t("medien.intern") }}</span>
                                    {{ eintrag.reason }}
                                </span>
                            </li>
                        </ul>
                    </FensterKarte>

                    <MedienKastenZusammengefuehrt
                        v-if="d.mergedHere.length > 0"
                        :detail="d"
                        :bearbeitbar="bearbeitbar"
                        :operationen="operationen"
                        @aufgehoben="mergeAufgehoben"
                        @waehle-asset="emit('waehleAsset', $event)"
                    />

                    <FensterKarte :titel="t('medien.abschnitt.historie')">
                        <p v-if="d.history.length === 0" class="medien-inspektor__satz">
                            {{ t("medien.inspektor.keineHistorie") }}
                        </p>
                        <ul v-else class="medien-inspektor__dateien" data-testid="medien-historie">
                            <li v-for="eintrag in d.history" :key="eintrag.operationId">
                                <span class="medien-inspektor__datei">{{ verlaufText(eintrag) }}</span>
                                <span class="medien-inspektor__unter"
                                    >{{ datumZeit(eintrag.at) }}
                                    <template v-if="eintrag.actor || eintrag.actorLabel">
                                        · <span class="medien-inspektor__intern">{{ t("medien.intern") }}</span>
                                        {{ eintrag.actor?.displayName ?? eintrag.actorLabel }}
                                    </template></span
                                >
                            </li>
                        </ul>
                    </FensterKarte>

                    <FensterKarte :titel="t('medien.abschnitt.handlungen')">
                        <div class="medien-inspektor__handlungen" data-testid="medien-handlungen">
                            <AvmKnopf :gesperrt="t('medien.handlung.spaeter')" testid="medien-handlung-ersetzen">
                                <template #zeichen>⇄</template>
                                {{ t("medien.handlung.ersetzen") }}
                            </AvmKnopf>
                            <!--
                                Der Einzelbild-Notaus (Betreiber 2026-10-10). Gefahrknopf, der die Handlung benennt; gilt
                                schon einer, steht hier das Freigeben. Ohne das Recht gesperrt mit Grund (Guide §30.5).
                            -->
                            <AvmKnopf
                                :art="notaus ? undefined : 'gefahr'"
                                :gesperrt="darfNotaus ? undefined : t('medien.handlung.notausKeinRecht')"
                                testid="medien-handlung-notaus"
                                @click="notausOffen = true"
                            >
                                <template #zeichen>{{ notaus ? "↺" : "—" }}</template>
                                {{ t(notaus ? "medien.handlung.notausFrei" : "medien.handlung.notaus") }}
                            </AvmKnopf>
                            <!-- Endgültig löschen (WI-0068 R4): eigene Uploads ohne Verwendung, die Ausnahmen in `medien-loeschen-modell.ts`; gesperrt mit Grund (Guide §30.5). -->
                            <AvmKnopf
                                art="gefahr"
                                :gesperrt="loeschenGesperrt"
                                testid="medien-handlung-loeschen"
                                @click="loeschenOffen = true"
                            >
                                <template #zeichen>✕</template>
                                {{ t("medien.handlung.loeschen") }}
                            </AvmKnopf>
                        </div>
                    </FensterKarte>
                </template>
            </template>
        </div>

        <MedienNotausFenster
            v-if="notausOffen && d"
            v-model:offen="notausOffen"
            :asset-id="d.asset.id"
            :detail="d"
            :verwendung="u"
            :operationen="operationen"
            @fertig="notausFertig"
        />
        <MedienLoeschenFenster
            v-if="loeschenOffen && d"
            v-model:offen="loeschenOffen"
            :detail="d"
            :verwendung="u"
            :name="name"
            :operationen="operationen"
            @fertig="emit('geloescht')"
        />
        <MedienMergeFenster
            v-if="mergeOffen && u && d"
            v-model:offen="mergeOffen"
            :verwendung="u"
            :eigener-name="d.asset.title ?? t('medien.merge.ohneTitel')"
            :operationen="operationen"
            @fertig="mergeFertig"
        />
    </FensterSpalte>
</template>

<style scoped>
.medien-inspektor {
    display: flex;
    flex-direction: column;
    gap: var(--space-8);
}

/* Die Vorschau: nie hochskaliert, ganz zu sehen, auf der weichen Fläche (Guide §12.6). */
.medien-inspektor__vorschau {
    display: grid;
    place-items: center;
    min-height: var(--icon-hero);
    max-height: var(--icon-banner);
    margin: 0;
    padding: var(--space-6);
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-panel-soft);
}

/* Unter einer privaten Vorschau: wer sie sieht und woher sie kommt (WI-0068 P4b). */
.medien-inspektor__vorschausatz {
    margin: calc(-1 * var(--space-2)) 0 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: center;
}

/* Die Vorschau ist der Knopf zur Bildansicht: ohne eigene Gestalt, der Zeiger sagt „vergrößern“. */
.medien-inspektor__gross {
    display: grid;
    place-items: center;
    max-width: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    cursor: zoom-in;
    transition: box-shadow 120ms ease;
}

.medien-inspektor__gross:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-inspektor__vorschau img {
    display: block;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: calc(var(--icon-banner) - 2 * var(--space-6));
    object-fit: contain;
}

.medien-inspektor__ohne {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    text-align: center;
}

.medien-inspektor__rechnet {
    color: var(--color-text);
}

/* „↻“ dreht sich langsam, solange gerechnet wird; ohne Bewegung steht es still. */
.medien-inspektor__dreht {
    display: inline-block;
    font-size: var(--font-size-title);
    animation: medien-inspektor-dreht 1.6s linear infinite;
}

@keyframes medien-inspektor-dreht {
    to {
        transform: rotate(360deg);
    }
}

@media (prefers-reduced-motion: reduce) {
    .medien-inspektor__dreht {
        animation: none;
    }

    .medien-inspektor__sprung {
        transition: none;
    }
}

.medien-inspektor__kopf {
    display: flex;
    align-items: baseline;
    gap: var(--space-6);
}

.medien-inspektor__name {
    flex: 1 1 auto;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
    color: var(--color-text-strong);
    font-size: var(--font-size-reading);
    font-weight: var(--font-weight-regular);
}

.medien-inspektor__kennung {
    flex: none;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
    font-variant-numeric: tabular-nums;
}

.medien-inspektor__pillen {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
}

.medien-inspektor__vorschlag {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-4) var(--space-8);
}

.medien-inspektor__vorschlag .medien-inspektor__satz {
    flex: 1 1 12rem;
}

.medien-inspektor__satz {
    margin: 0;
    color: var(--color-text-muted);
    font-size: var(--font-size-small);
    line-height: var(--leading-snug);
}

/* Ein Sprung innerhalb des Fensters mitten im Satz (WI-0287: zur Karte, zur erzeugten Vorschau): goldbraun, ohne ↗. */
.medien-inspektor__sprung {
    padding: 0;
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--color-link);
    cursor: pointer;
    font: inherit;
    text-align: left;
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-inspektor__sprung:hover {
    color: var(--color-link-hover);
    text-decoration: underline;
}

.medien-inspektor__sprung:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-inspektor__dateien {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
}

.medien-inspektor__dateien li {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--font-size-small);
}

.medien-inspektor__datei {
    color: var(--color-text-strong);
}

/* Die veröffentlichte Datei im neuen Tab: ein Verweis mit ↗ aus der Hausregel, goldbraun wie jeder Verweis im Fenster. */
.medien-inspektor__link {
    align-self: flex-start;
    border-radius: var(--radius-sm);
    color: var(--color-link);
    transition:
        color 120ms ease,
        box-shadow 120ms ease;
}

.medien-inspektor__link:hover {
    color: var(--color-link-hover);
}

.medien-inspektor__link:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring);
}

.medien-inspektor__unter {
    overflow-wrap: anywhere;
    color: var(--color-text-muted);
    font-size: var(--font-size-caption);
}

.medien-inspektor__intern {
    color: var(--color-accent-strong);
    letter-spacing: var(--letter-spacing-caps);
    text-transform: uppercase;
}

.medien-inspektor__handlungen {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: var(--space-4);
}
</style>
