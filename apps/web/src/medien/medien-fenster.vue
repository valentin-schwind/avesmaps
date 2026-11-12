<script setup lang="ts">
/**
 * Das Fenster „Medien“ (WI-0068 P3; Mockup `review/wi-0068-mockup/blatt.png`, Betreiber 2026-10-09 „Die drei Empfehlungen passen“):
 * die Medienverwaltung als Werkzeugfenster der Breite `medien` (1240), modal - die Karte ruht, solange es offen ist (P0, Frage 3). Aus dem
 * Ortseditor heraus steht es nicht modal neben ihm (`lage`, WI-0128 E6, Koordination 2026-10-10), gefiltert auf den Ort und die Rolle.
 *
 * - **Drei Spalten** (§3, Hülle `rumpf="spalten"`): Medienarten · Treffer · Inspector. Die Suche steht in der Leiste der Treffer, nicht
 *   im Kopf: Sie sucht nur in der gewählten Art (Betreiber 2026-10-11, Guide §13.45).
 * - **Telefon:** Drill-down in drei Ebenen im selben Fenster (§3.4) - Arten → Treffer → Inspector, „‹“ führt zurück. Ein Einstieg mit
 *   Asset beginnt auf Ebene 3.
 * - **Zustand und Adresse** hält `medien-oeffnen.ts` (ein tiefer Link öffnet genau dieses Asset); dieses Fenster liest und setzt ihn.
 * - **„Auf Karte zeigen“** schließt das Fenster und meldet das Fachobjekt nach außen; `app.vue` öffnet es dort über die eine
 *   Öffnungsnaht, und die Kamera fliegt (Kamera-Schnittstelle, sichtbare Fläche).
 * - **Schreibend** für Assets (P4b) und für Galerien (P6): Dieses Fenster führt die Operationen aus und lädt danach neu;
 *   die Spalten sagen nur, was gewollt ist. Was noch fehlt, steht als gesperrter Knopf mit Grund da.
 */
import { computed, defineAsyncComponent, ref, watch } from "vue";
import {
    HEADER_GRAPHICS,
    type HeaderGraphic,
    type MediaTypeImageVariant,
    type MediaUsageSubject,
} from "@avesmaps3d/shared";
import AvmKreis from "../controls/avm-kreis.vue";
import { phoneViewport } from "../controls/phone-viewport";
import AvmFenster from "../fenster/avm-fenster.vue";
import type { FensterBox, FensterHuellenLage } from "../fenster/fenster-lage";
import FensterSpalte from "../fenster/fenster-spalte.vue";
import { authState } from "../auth/session-state";
import { darfKartenvorschlaege } from "../community/kartenvorschlaege-modell";
import { isMessageKey, t } from "../i18n/i18n";
import MedienArten from "./medien-arten.vue";
import MedienAuswahlFenster from "./medien-auswahl-fenster.vue";
import type { BindbareRolle } from "./medien-formular-modell";
import MedienHochladenFenster from "./medien-hochladen-fenster.vue";
import MedienMergeAlleFenster from "./medien-merge-alle-fenster.vue";
import { createMedienClient, type MedienClient, alsApiFailure } from "./medien-client";
import { useMedienDaten } from "./medien-daten";
import MedienInspektor from "./medien-inspektor.vue";
import { KREIS_LEGENDE, kreisName } from "./medien-kreis";
import { medienNamen, medienZustand, merkeNamen, setzeMedien } from "./medien-oeffnen";
import { medienStelle, type KorrekturEntwurf } from "./medien-stelle";
import { Handlung, createMedienOperationen, operationsFehler, type OperationsFehler } from "./medien-operationen";
import MedienTreffer from "./medien-treffer.vue";
import MedienGalerieBilderFenster from "./medien-galerie-bilder-fenster.vue";
import MedienGalerieInspektor from "./medien-galerie-inspektor.vue";
import MedienGalerieOrtFenster from "./medien-galerie-ort-fenster.vue";
import MedienGalerien from "./medien-galerien.vue";
import MedienKarteInspektor from "./medien-karte-inspektor.vue";
import MedienKarteNeuFenster from "./medien-karte-neu-fenster.vue";
import MedienKarten from "./medien-karten.vue";
import { naechsteKarte } from "./medien-karten-modell";
import MedienPhotoboxGalerie from "./medien-photobox-galerie.vue";
import MedienPhotoboxGalerien from "./medien-photobox-galerien.vue";
import MedienTypbilder from "./medien-typbilder.vue";
import { useVorschlagsZahl } from "./medien-vorschlaege-zahl";
import { sternAsset, typbildSlot } from "./medien-typbilder-modell";
import { zahl } from "./medien-text";
import {
    istObjekt,
    startEbene,
    vonSchreiben,
    waehle,
    type MedienAuswahl,
    type MedienEbene,
    type MedienKartenziel,
    type MedienZustand,
} from "./medien-zustand";

const props = defineProps<{
    client?: MedienClient | undefined;
    /**
     * Die Lage (WI-0128 E6, Koordination 2026-10-10): `modal` wie bisher aus dem Hauptmenü und über den tiefen Link `?medien=`; aus dem
     * Ortseditor ein Werkzeugfenster, das neben ihm offen bleibt (gelöst, angedockt oder abgelegt).
     */
    lage?: FensterHuellenLage | undefined;
    box?: FensterBox | undefined;
    ablageZiel?: (() => DOMRect | undefined) | undefined;
}>();
const offen = defineModel<boolean>("offen", { required: true });
const emit = defineEmits<{
    aufKarte: [ziel: MedienKartenziel];
    /** „Quelle bearbeiten“ an einer Publikation der Kartensammlung (WI-0287): die Quelle im Fenster „Inhalte bearbeiten“ öffnen. */
    oeffneQuelle: [sourceId: string];
    "update:lage": [lage: Exclude<FensterHuellenLage, "modal">, box?: FensterBox];
    "update:box": [box: FensterBox];
    vorn: [];
}>();

/** Spalte 2 und 3 der Kartenvorschläge (OPS-000093) laden erst, wenn der Eingang gewählt ist: Sie tragen die ganze Redaktion eines Vorschlags. */
const MedienVorschlaege = defineAsyncComponent(() => import("./medien-vorschlaege.vue"));
const MedienVorschlag = defineAsyncComponent(() => import("./medien-vorschlag.vue"));

const daten = useMedienDaten(offen, medienZustand, props.client ?? createMedienClient());
/** Im Zusatz steht die Umgebung, wie in der Verwaltung: Medien von Stage sind nicht die von Avesmaps (T19). */
const umgebung = (() => {
    const key = `auth.environment.name.${authState.value.environment ?? ""}`;
    return isMessageKey(key) ? t(key) : undefined;
})();
const zustand = computed(() => medienZustand.value);
const telefon = computed(() => phoneViewport.value);

/** Die Ebene am Telefon; am Rechner stehen alle drei. */
const ebene = ref<MedienEbene>(startEbene(medienZustand.value));
watch(offen, (jetzt) => {
    if (jetzt) ebene.value = startEbene(medienZustand.value);
});

function setze(neu: MedienZustand): void {
    trefferHinweis.value = undefined;
    setzeMedien(neu);
}

function waehleFacette(auswahl: MedienAuswahl): void {
    setzeMedien(waehle(zustand.value, auswahl));
    ebene.value = 2;
}

function waehleAsset(id: string): void {
    trefferHinweis.value = undefined;
    setzeMedien({ ...zustand.value, asset: id });
    ebene.value = 3;
}

/** Der Name eines Fachobjekts reicht seine Medien in die Liste („verwendet von“). */
/** Ein Satz über der Trefferliste nach dem endgültigen Löschen (Entwurf „Eingänge“ Fassung 2); die nächste Wahl nimmt ihn weg. */
const trefferHinweis = ref<string | undefined>(undefined);
/** Ein Werk ist endgültig gelöscht (WI-0068 R4): abwählen, Liste und Zahlen (auch die der Schiene) neu lesen, kurz bestätigen. */
function geloescht(): void {
    setzeMedien({ ...zustand.value, asset: undefined });
    daten.erneutListe();
    daten.erneutNavigation();
    trefferHinweis.value = t("medien.loeschen.geloescht");
}

/** Aus einer Verwendung als Typbild (★) zur Kategorie und Variante in der Liste der Typbilder; das Asset bleibt gewählt. */
function zumTypbild(kategorie: string, variante: MediaTypeImageVariant = "ki"): void {
    const bekannt = (HEADER_GRAPHICS as readonly string[]).includes(kategorie)
        ? (kategorie as HeaderGraphic)
        : undefined;
    if (bekannt === undefined) return;
    setzeMedien({ ...zustand.value, auswahl: { objekt: "typbilder" }, kategorie: bekannt, variante });
}

function von(subjekt: MediaUsageSubject): void {
    const kennung = vonSchreiben(subjekt.kind, subjekt.id);
    merkeNamen(kennung, subjekt.name);
    setzeMedien({ ...zustand.value, von: kennung });
    ebene.value = 2;
}

function aufKarte(ziel: MedienKartenziel): void {
    offen.value = false;
    emit("aufKarte", ziel);
}

// --- Hochladen (WI-0068 P4b, Schritt 7): das Formular der Medienverwaltung ohne Bindung; danach ist das neue Asset gewählt und der
// Inspector zeigt „wird gerechnet …“, bis der Hintergrunddienst die Fassungen hat. Liste und Zahlen laden neu. ---
const darfHochladen = computed(() => authState.value.capabilities.includes("upload_media"));
/** Die Kartensammlung ändert auch, wer nur `edit_map_collection` hat (Kartograph, WI-0279). */
const darfKarten = computed(() => darfHochladen.value || authState.value.capabilities.includes("edit_map_collection"));
const darfAlleZusammenfuehren = computed(() => authState.value.capabilities.includes("merge_media_all"));
/** Eine neue Publikation im Quellenverzeichnis anlegen und „Quelle bearbeiten“ (WI-0287): `manage_sources`. */
const darfQuellen = computed(() => authState.value.capabilities.includes("manage_sources"));
/** Das Blatt „Alle bytegleichen Duplikate zusammenführen“ (WI-0068, Betreiber 2026-10-17). */
const mergeAlleOffen = ref(false);
function nachSammellauf(): void {
    daten.erneutListe();
    daten.erneutNavigation();
}
const hochladenRolle = ref<BindbareRolle | undefined>(undefined);
const hochladenOffen = computed({
    get: () => hochladenRolle.value !== undefined,
    set: (jetzt: boolean) => {
        if (!jetzt) hochladenRolle.value = undefined;
    },
});

function hochgeladen(ergebnis: { assetId: string }): void {
    hochladenRolle.value = undefined;
    daten.erneutListe();
    daten.erneutNavigation();
    waehleAsset(ergebnis.assetId);
}

// --- Typbilder (WI-0068, Betreiber 2026-10-11): Kategorie wählen, ★ setzen, eingebaute übernehmen ---
const objekt = computed(() => (istObjekt(zustand.value.auswahl) ? zustand.value.auswahl.objekt : undefined));
const typbilderOffen = computed(() => objekt.value === "typbilder");
const galerienOffen = computed(() => objekt.value === "galerien");
const kartenOffen = computed(() => objekt.value === "kartensammlung");
const photoboxOffen = computed(() => objekt.value === "photobox");
const vorschlaegeOffen = computed(() => objekt.value === "kartenvorschlaege");

// --- Die Kartenvorschläge der Redaktion (OPS-000093): derselbe Weg wie in Community › Meldungen, nur mit einem der beiden Rechte ---
const rechte = computed(() => authState.value.capabilities);
const darfVorschlaege = computed(() => darfKartenvorschlaege(rechte.value));
const vorschlagsZahl = useVorschlagsZahl(() => offen.value && darfVorschlaege.value);
const vorschlaegeSchiene = computed(() => (darfVorschlaege.value ? { zahl: vorschlagsZahl.value } : undefined));
function waehleVorschlag(id: string): void {
    setzeMedien({ ...zustand.value, vorschlag: id });
    ebene.value = 3;
}
/** „Vorschlag prüfen …“ im Inspector eines Vorschlagsbilds: Eingänge › Kartenvorschläge, dieser Vorschlag gewählt (das Bild bleibt gewählt, „‹“ führt zurück zur Liste). */
function oeffneVorschlag(id: string): void {
    setzeMedien({ ...waehle(zustand.value, { objekt: "kartenvorschlaege" }), vorschlag: id });
    ebene.value = 3;
}

/** Eine Galerie wählen: Sie steht in der Adresse, Spalte 3 zeigt sie. Das gewählte Asset bleibt davon unberührt. */
function waehleGalerie(id: string): void {
    setzeMedien({ ...zustand.value, galerie: id });
    ebene.value = 3;
}

// --- Die PhotoBox-Galerien (WI-0272), nur lesend ---
function waehlePhotobox(kennung: string): void {
    setzeMedien({ ...zustand.value, photoboxGalerie: kennung });
    ebene.value = 3;
}
/** Ein Reisebild bearbeiten: im Korb „PhotoBox-Uploads › Erledigt“ an diesem Bild, wie aus dem Panel des Ortseditors. */
function oeffneReisebild(id: string): void {
    setzeMedien({ ...waehle(zustand.value, { korb: "photobox_uploads" }), einreichung: "erledigt", asset: id });
    ebene.value = 3;
}

// --- Die Kartensammlung (WI-0068 R5), nur lesend ---
function waehleKarte(id: string): void {
    kartenHinweis.value = undefined;
    setzeMedien({ ...zustand.value, karte: id });
    ebene.value = 3;
}
/** Ein Satz über der Liste nach dem Entfernen oder Zurückholen (WI-0287); die nächste Wahl nimmt ihn weg. */
const kartenHinweis = ref<string | undefined>(undefined);
/**
 * Ein Eintrag ist entfernt: die nächste aktive Karte wird gewählt, Liste und Zahlen lesen neu, der Hinweis nennt das Kästchen. Gingen die Bilder an einen anderen Eintrag
 * (WI-0287 Stufe 2), ist dieser gewählt, und der Hinweis nennt ihn.
 */
function karteEntfernt(id: string, ziel: { id: string; title: string } | undefined): void {
    const naechste = ziel?.id ?? naechsteKarte(daten.kartenListe.value.wert?.items ?? [], id);
    setzeMedien({ ...zustand.value, karte: naechste });
    ebene.value = naechste === undefined ? 2 : 3;
    daten.erneutKarten();
    daten.erneutNavigation();
    kartenHinweis.value =
        ziel === undefined ? t("medien.karten.entfernt") : t("medien.karten.entferntAn", { titel: ziel.title });
}
/** Ein Eintrag ist zurückgeholt: er bleibt gewählt, Liste und Zahlen lesen neu. Übergebene Bilder bleiben am anderen Eintrag, der Hinweis sagt es. */
function karteZurueckgeholt(_id: string, uebergeben: boolean): void {
    daten.erneutKarten();
    daten.erneutNavigation();
    kartenHinweis.value = t(uebergeben ? "medien.karten.zurueckgeholtUebergeben" : "medien.karten.zurueckgeholt");
}
/** Das Blatt „Neuer Eintrag“ (WI-0287): Name, Orte, Angaben; danach ist der neue Eintrag gewählt und die Suche leer, damit er in der Liste steht. */
const neuerEintragOffen = ref(false);
function karteAngelegt(id: string): void {
    kartenHinweis.value = t("medien.karten.eintrag.angelegt");
    setzeMedien({ ...zustand.value, karte: id, q: "" });
    ebene.value = 3;
    daten.erneutKarten();
    daten.erneutNavigation();
}
/** Ein Bild des Eintrags ist zugewiesen, geändert oder gelöst: Eintrag, Liste und Zahlen lesen neu (der Kreis der Zeile und die Schiene zählen mit). */
function kartenBilderGeaendert(): void {
    daten.erneutKarten();
    daten.erneutNavigation();
}
/** Aus dem Platz „Liegt jetzt unter Karten als …“ in die Liste der Karten bzw. Kartenvorschauen, das Werk gewählt. */
function zurBilderListe(rolle: "map_full" | "map_preview", assetId: string): void {
    setzeMedien({ ...waehle(zustand.value, { typ: rolle === "map_full" ? "map" : "map_preview" }), asset: assetId });
    ebene.value = 3;
}
/** Aus einer Verwendung an einer Karte (Reverse Usage) zur Karte selbst. */
function oeffneKarte(id: string): void {
    setzeMedien({ ...waehle(zustand.value, { objekt: "kartensammlung" }), karte: id });
    ebene.value = 3;
}
/**
 * „Vorschau erzeugen“ im Inspector fand einen gleichen Namen (WI-0287 Punkt 5; Entwurf: „Aus dem Inspector heraus führt der Namenskonflikt in den Eintrag“): zum Eintrag, dessen
 * Platz „Die Vorschau“ den Konflikt zeigt und wählen lässt.
 */
const vorschauAnstoss = ref<string | undefined>(undefined);
function vorschauImEintrag(id: string): void {
    vorschauAnstoss.value = id;
    oeffneKarte(id);
}
/** Ein Bild der Karte im Inspector des Werks: zurück zu „Alle Medien“, das Werk gewählt. */
function oeffneBild(id: string): void {
    setzeMedien({ ...waehle(zustand.value, { typ: null }), asset: id });
    ebene.value = 3;
}

// --- Die Handlungen an einer Galerie (WI-0068 P6) ---
//
// 🔴 ALLE gegen die Revision der GALERIE, und danach wird neu geladen: Die Quittung nennt die frische Revision, aber nicht
// die neue Folge. Während eine Handlung läuft, stehen die anderen Knöpfe gesperrt — zwei Handlungen auf derselben gesehenen
// Revision endeten in einem Konflikt, den niemand verursacht hat.
const galerieLaeuft = ref(false);
const galerieFehler = ref<OperationsFehler | undefined>(undefined);
const galerieHandlung = new Handlung();
const gewaehlteGalerie = computed(() => daten.galerie.value.wert);

async function fuehreGalerie(
    lauf: (operationId: string, galleryId: string, baseRevision: number) => Promise<unknown>,
): Promise<void> {
    const g = gewaehlteGalerie.value;
    if (galerieLaeuft.value || g === undefined) return;
    galerieLaeuft.value = true;
    galerieFehler.value = undefined;
    try {
        await galerieHandlung.fuehreAus((operationId) => lauf(operationId, g.id, g.revision));
        daten.erneutGalerien();
    } catch (error) {
        galerieFehler.value = operationsFehler(error);
    } finally {
        galerieLaeuft.value = false;
    }
}

/** Die gewählte Galerie entfernen (WI-0068 R3): danach ist keine gewählt, Liste und Zahlen lesen neu. */
async function galerieEntfernen(): Promise<void> {
    const g = gewaehlteGalerie.value;
    if (galerieLaeuft.value || g === undefined) return;
    galerieLaeuft.value = true;
    galerieFehler.value = undefined;
    try {
        await galerieHandlung.fuehreAus((operationId) =>
            operationen.galerieEntfernen({ operationId, galleryId: g.id, baseRevision: g.revision }),
        );
        setzeMedien({ ...zustand.value, galerie: undefined });
        ebene.value = 2;
        daten.erneutGalerien();
        daten.erneutNavigation();
    } catch (error) {
        const fehler = operationsFehler(error);
        // Der allgemeine Satz zu `media_not_deletable` spricht vom Bild; hier sagt der Grund, warum die GALERIE bleibt.
        const grund = alsApiFailure(error).details?.["reason"];
        galerieFehler.value =
            fehler.code === "media_not_deletable" && (grund === "legacy" || grund === "bound" || grund === "foreign")
                ? { ...fehler, text: t(`medien.galerien.entfernenHindernis.${grund}`) }
                : fehler;
    } finally {
        galerieLaeuft.value = false;
    }
}

/** „Bilder hinzufügen“: die Auswahl der Medienverwaltung, gegen `gallery.add`. */
const bilderOffen = ref(false);
/** Mehrere neue Bilder auf einmal in die gewählte Galerie (Stapel, WI-0068 MAM-R3). */
const stapelOffen = ref(false);
const stapelGalerie = computed(() => {
    const g = gewaehlteGalerie.value;
    if (g === undefined) return undefined;
    const ort = g.bindings.find((bindung) => !bindung.retired)?.subject.name;
    return {
        id: g.id,
        revision: g.revision,
        anzahl: g.items.filter((eintrag) => !eintrag.retired).length,
        name: g.title ?? ort ?? t("medien.galerie.ohneTitel"),
    };
});
/** „an einen Ort binden“: die Ortsliste des Editors, gegen `gallery.bind`. */
const ortOffen = ref(false);

/** Eine neue Galerie: ohne Ort und ohne Titel, also ein Entwurf. Danach ist sie gewählt und Spalte 3 zeigt sie leer. */
async function neueGalerie(): Promise<void> {
    if (galerieLaeuft.value) return;
    galerieLaeuft.value = true;
    galerieFehler.value = undefined;
    try {
        const quittung = await galerieHandlung.fuehreAus((operationId) => operationen.galerieAnlegen({ operationId }));
        daten.erneutGalerien();
        const angelegt = quittung.affected.find((eintrag) => eintrag.kind === "gallery");
        if (angelegt !== undefined) waehleGalerie(angelegt.id);
    } catch (error) {
        galerieFehler.value = operationsFehler(error);
    } finally {
        galerieLaeuft.value = false;
    }
}
const operationen = createMedienOperationen();
const darfUebernehmen = computed(() => authState.value.capabilities.includes("publish_media"));
const uebernimmt = ref(false);
const typbildFehler = ref<OperationsFehler | undefined>(undefined);
const uebernehmen = new Handlung();

/**
 * Eine Kategorie wählen: Sie steht in der Adresse, und das ★-Asset der gezeigten Variante wird das gewählte Asset (Spalte 3 zeigt es). Eine Variante
 * OHNE ★ lässt das Asset fallen, damit der Inspector nicht das vorige Bild einer anderen Kategorie weiterzeigt. Die Variante bleibt (WI-0281).
 */
function waehleKategorie(kategorie: HeaderGraphic): void {
    setzeMedien({
        ...zustand.value,
        kategorie,
        asset: sternAsset(daten.typbilder.value.wert, kategorie, zustand.value.variante),
    });
    ebene.value = 3;
}

/**
 * Eine Variante lösen (WI-0281, Vali 2026-11-05: „im zweifel darf auch nix sein“): EINE Operation gegen den gesehenen Stand des ★; danach ist die Variante leer, das
 * Asset abgewählt (der Inspector zeigt den Kasten „Typbild wählen oder hochladen …“), Liste und Zahlen laden neu. Ein Fehler steht über der Liste wie beim Übernehmen.
 */
const loest = ref(false);
const loesen = new Handlung();
async function loeseTypbild(): Promise<void> {
    const eintrag = typbildEintrag.value;
    const aktuell = typbildAktuell.value;
    if (loest.value || eintrag === undefined || aktuell === null) return;
    const variante = zustand.value.variante;
    loest.value = true;
    typbildFehler.value = undefined;
    try {
        await loesen.fuehreAus((operationId) =>
            operationen.typbildLoesen({
                operationId,
                category: eintrag.category,
                variant: variante,
                baseRevision: aktuell.revision,
            }),
        );
        if (zustand.value.asset === aktuell.assetId) setzeMedien({ ...zustand.value, asset: undefined });
        daten.erneutTypbilder();
        daten.erneutNavigation();
    } catch (error) {
        typbildFehler.value = operationsFehler(error);
        daten.erneutTypbilder();
    } finally {
        loest.value = false;
    }
}

/** Der Umschalter „KI | Ohne KI“ (WI-0281): die andere Variante zeigen; ihr ★-Asset wird das gewählte, ohne ★ keines. */
function waehleTypbildVariante(variante: MediaTypeImageVariant): void {
    setzeMedien({
        ...zustand.value,
        variante,
        asset: sternAsset(daten.typbilder.value.wert, zustand.value.kategorie, variante),
    });
}

/**
 * Eine Kategorie ohne gewähltes Asset (das ⚙ am Typbild im Infopanel, ein tiefer Link mit `medien-kategorie`): Sobald die Liste da ist, wird ihr ★ das gewählte Asset, wie beim Klick auf die Kategorie
 * (`waehleKategorie`). Eine Kategorie ohne ★ lässt es, wie es ist: Der Inspector zeigt „noch kein Typbild“. Ein gelöschtes ★ kommt nicht wieder (die Liste nennt es nicht mehr).
 */
watch(
    [() => zustand.value.kategorie, () => daten.typbilder.value.wert],
    ([kategorie, liste]) => {
        if (zustand.value.asset !== undefined) return;
        const stern = sternAsset(liste, kategorie, zustand.value.variante);
        if (stern === undefined) return;
        setzeMedien({ ...zustand.value, asset: stern });
        ebene.value = 3;
    },
    { immediate: true },
);

/** „Eingebaute Typbilder übernehmen“: EIN Klick, idempotent; danach laden Liste, Navigation und das gewählte Asset neu. */
async function uebernehmeTypbilder(): Promise<void> {
    if (uebernimmt.value) return;
    uebernimmt.value = true;
    typbildFehler.value = undefined;
    try {
        await uebernehmen.fuehreAus((operationId) => operationen.typbilderUebernehmen({ operationId }));
        daten.erneutTypbilder();
        daten.erneutNavigation();
    } catch (error) {
        typbildFehler.value = operationsFehler(error);
    } finally {
        uebernimmt.value = false;
    }
}

/** Die gewählte Kategorie als Eintrag der geladenen Liste: Nur sie kennt ★, Objektzahl und Verlauf. */
const typbildEintrag = computed(() =>
    zustand.value.kategorie === undefined
        ? undefined
        : daten.typbilder.value.wert?.items.find((zeile) => zeile.category === zustand.value.kategorie),
);

/** „⇄ anderes Typbild wählen …“: dasselbe Auswahlfenster wie überall, mit der Kategorie und der Variante als Ziel (kein zweiter Editor). */
const typbildAuswahlOffen = ref(false);
/**
 * Jedes Wählen beginnt ein frisches Auswahlfenster (leere Suche, nichts gewählt); `offen` schaltet es nur.
 * 🔴 Das Fenster darf nicht an `offen` hängen: Es trägt das Formular „Neues Bild hochladen“ und schließt sich beim Wechsel dorthin (ein Editor 2026-11-05: „Hochladen macht da gar nichts“).
 */
const typbildAuswahlLauf = ref(0);
function typbildWaehlen(): void {
    typbildAuswahlLauf.value += 1;
    typbildAuswahlOffen.value = true;
}
/** Der ★ der gezeigten Variante: Stand und Kennung für das Auswahlfenster. */
const typbildAktuell = computed(() => {
    const eintrag = typbildEintrag.value;
    if (eintrag === undefined) return null;
    const aktuell = typbildSlot(eintrag, zustand.value.variante).current;
    return aktuell === null ? null : { assetId: aktuell.assetId, revision: aktuell.revision };
});

function typbildGesetzt(): void {
    typbildAuswahlOffen.value = false;
    daten.erneutTypbilder();
    daten.erneutNavigation();
    daten.erneutAsset();
}

/** Der Treffer zum gewählten Asset, solange der Inspector lädt (Name und Bild stehen dann schon). */
const zusammenfassung = computed(() => daten.liste.value.items.find((eintrag) => eintrag.id === zustand.value.asset));

/** Der Name hinter „verwendet von“: aus dem Einstieg, sonst aus einer Verwendung, die ihn nennt. */
const vonName = computed(() => {
    const kennung = zustand.value.von;
    if (kennung === undefined) return undefined;
    const bekannt = medienNamen.value[kennung];
    if (bekannt !== undefined) return bekannt;
    const aus = [
        ...daten.liste.value.items.map((eintrag) => eintrag.primaryUsage?.subject),
        ...(daten.verwendung.value.wert?.usages.map((usage) => usage.subject) ?? []),
    ].find(
        (subjekt) => subjekt !== null && subjekt !== undefined && vonSchreiben(subjekt.kind, subjekt.id) === kennung,
    );
    return aus?.name;
});

// --- „Stelle auf der Karte wählen“ in der Korrektur einer Einreichung (WI-0272 S3, `medien-stelle.ts`): Das Fenster geht zu, die Karte nimmt den Klick, danach kommt es zurück ---
const neueStelle = computed(() => {
    const gewaehlt = medienStelle.ergebnis.value;
    return gewaehlt !== undefined && gewaehlt.asset === zustand.value.asset ? gewaehlt.lage : undefined;
});
/** Was in der Korrektur stand, bevor die Wahl begann: kommt nach der Wahl und nach dem Abbruch zurück (Review S3 I2). */
const korrekturEntwurf = computed(() => {
    const gemerkt = medienStelle.entwurf.value;
    return gemerkt !== undefined && gemerkt.asset === zustand.value.asset ? gemerkt.entwurf : undefined;
});
function stelleWaehlen(entwurf: KorrekturEntwurf): void {
    if (zustand.value.asset === undefined) return;
    // Lage und Größe des Werkzeugfensters gehen mit: app.vue verwirft es beim Schließen und stellt es wieder hin (holeMedienFensterZurueck). Das modale Fenster hat keine.
    const lage = props.lage;
    medienStelle.starte(
        zustand.value.asset,
        entwurf,
        lage === "angedockt" || lage === "geloest" ? { lage, box: props.box } : undefined,
    );
}
// Stelle und Entwurf bleiben, bis die Korrektur zu ist (der Kasten sagt es: `korrekturZu`); denn beim Wiederöffnen baut der Inspektor sich mehrfach auf. Geht das Fenster zu (ohne dass eine Wahl läuft)
// oder wird ein anderes Asset gewählt, gelten sie nicht mehr: Sonst öffnete die Korrektur später aus heiterem Himmel.
watch(offen, (auf) => {
    if (!auf && !medienStelle.waehlen.value) medienStelle.verwerfe();
});
watch(
    () => zustand.value.asset,
    (asset) => {
        const gemerkt = medienStelle.entwurf.value;
        const gewaehlt = medienStelle.ergebnis.value;
        if (
            (gemerkt !== undefined && gemerkt.asset !== asset) ||
            (gewaehlt !== undefined && gewaehlt.asset !== asset)
        ) {
            medienStelle.verwerfe();
        }
    },
);

const fussHinweis = computed(() => {
    if (telefon.value) return t("medien.fuss.ebene", { n: ebene.value });
    const nav = daten.navigation.value.wert;
    if (nav === undefined) return t("medien.fuss.bedienung");
    return t("medien.fuss.stand", {
        n: zahl(nav.total),
        offen: zahl(nav.baskets.rights_open),
        bedienung: t("medien.fuss.bedienung"),
    });
});
</script>

<template>
    <AvmFenster
        v-model:offen="offen"
        bauart="werkzeug"
        breite="medien"
        rumpf="spalten"
        :titel="t('medien.titel')"
        :zusatz="umgebung"
        :lage="props.lage"
        :box="props.box"
        :ablage-ziel="props.ablageZiel"
        testid="medien-fenster"
        @update:lage="(neu, box) => emit('update:lage', neu, box)"
        @update:box="(box) => emit('update:box', box)"
        @vorn="emit('vorn')"
    >
        <FensterSpalte
            v-if="!telefon || ebene === 1"
            breite="schiene"
            :telefon="telefon"
            :titel="t('medien.arten.titel')"
            testid="medien-spalte-arten"
        >
            <MedienArten
                :navigation="daten.navigation.value"
                :auswahl="zustand.auswahl"
                :vorschlaege="vorschlaegeSchiene"
                @waehle="waehleFacette"
                @erneut="daten.erneutNavigation()"
            />
        </FensterSpalte>
        <MedienTypbilder
            v-if="typbilderOffen && (!telefon || ebene === 2)"
            :liste="daten.typbilder.value"
            :kategorie="zustand.kategorie"
            :telefon="telefon"
            :darf-uebernehmen="darfUebernehmen"
            :uebernimmt="uebernimmt"
            :op-fehler="typbildFehler"
            @waehle="waehleKategorie"
            @uebernehmen="uebernehmeTypbilder"
            @erneut="daten.erneutTypbilder()"
            @zurueck="ebene = 1"
        />
        <MedienGalerien
            v-if="galerienOffen && (!telefon || ebene === 2)"
            :liste="daten.galerienListe.value"
            :suche="zustand.q"
            :gewaehlt="zustand.galerie"
            :telefon="telefon"
            :darf-schreiben="darfHochladen"
            :laeuft="galerieLaeuft"
            @waehle="waehleGalerie"
            @suche="(wert: string) => setze({ ...zustand, q: wert })"
            @erneut="daten.erneutGalerien()"
            @neu="neueGalerie"
            @zurueck="ebene = 1"
        />
        <MedienKarten
            v-if="kartenOffen && (!telefon || ebene === 2)"
            :liste="daten.kartenListe.value"
            :suche="zustand.q"
            :gewaehlt="zustand.karte"
            :telefon="telefon"
            :stillgelegte="daten.kartenStillgelegte.value"
            :hinweis="kartenHinweis"
            :darf-anlegen="darfKarten"
            @neu="neuerEintragOffen = true"
            @stillgelegte="(an: boolean) => (daten.kartenStillgelegte.value = an)"
            @waehle="waehleKarte"
            @suche="(wert: string) => setze({ ...zustand, q: wert })"
            @erneut="daten.erneutKarten()"
            @zurueck="ebene = 1"
        />
        <MedienPhotoboxGalerien
            v-if="photoboxOffen && (!telefon || ebene === 2)"
            :liste="daten.photoboxListe.value"
            :suche="zustand.q"
            :gewaehlt="zustand.photoboxGalerie"
            :telefon="telefon"
            @waehle="waehlePhotobox"
            @suche="(wert: string) => setze({ ...zustand, q: wert })"
            @erneut="daten.erneutPhotobox()"
            @zurueck="ebene = 1"
        />
        <MedienVorschlaege
            v-if="vorschlaegeOffen && (!telefon || ebene === 2)"
            :gewaehlt="zustand.vorschlag"
            :telefon="telefon"
            @waehle="waehleVorschlag"
            @zurueck="ebene = 1"
        />
        <MedienTreffer
            v-if="
                !typbilderOffen &&
                !galerienOffen &&
                !kartenOffen &&
                !photoboxOffen &&
                !vorschlaegeOffen &&
                (!telefon || ebene === 2)
            "
            :zustand="zustand"
            :liste="daten.liste.value"
            :von-name="vonName"
            :navigation="daten.navigation.value.wert"
            :telefon="telefon"
            :darf-hochladen="darfHochladen"
            :darf-alle-zusammenfuehren="darfAlleZusammenfuehren"
            :hinweis="trefferHinweis"
            @setze="setze"
            @waehle-asset="waehleAsset"
            @auf-karte="aufKarte"
            @mehr="daten.mehrLaden()"
            @erneut="daten.erneutListe()"
            @zurueck="ebene = 1"
            @hochladen="(rolle) => (hochladenRolle = rolle)"
            @alle-zusammenfuehren="mergeAlleOffen = true"
        />
        <MedienGalerieInspektor
            v-if="galerienOffen && (!telefon || ebene === 3)"
            :galerie="daten.galerie.value"
            :telefon="telefon"
            :darf-schreiben="darfHochladen"
            :laeuft="galerieLaeuft"
            :fehler="galerieFehler?.text"
            @waehle-asset="waehleAsset"
            @erneut="daten.erneutGalerien()"
            @zurueck="ebene = 2"
            @titel="
                (text) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieTitel({ operationId, galleryId, baseRevision, title: text }),
                    )
            "
            @ordnen="
                (order) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieOrdnen({ operationId, galleryId, baseRevision, order }),
                    )
            "
            @titelbild="
                (assetId) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieTitelbild({ operationId, galleryId, baseRevision, assetId }),
                    )
            "
            @bildunterschrift="
                (assetId, text) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieBildunterschrift({
                            operationId,
                            galleryId,
                            baseRevision,
                            assetId,
                            caption: text,
                        }),
                    )
            "
            @entfernen="
                (assetId) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieBildEntfernen({ operationId, galleryId, baseRevision, assetId }),
                    )
            "
            @loesen="
                (placeId) =>
                    fuehreGalerie((operationId, galleryId, baseRevision) =>
                        operationen.galerieLoesen({ operationId, galleryId, baseRevision, placeId }),
                    )
            "
            @bilder="bilderOffen = true"
            @stapel="stapelOffen = true"
            @binden="ortOffen = true"
            @galerie-entfernen="galerieEntfernen"
        />
        <MedienKarteInspektor
            v-if="kartenOffen && (!telefon || ebene === 3)"
            :karte="daten.karte.value"
            :telefon="telefon"
            :bearbeitbar="darfKarten"
            :quellen-recht="darfQuellen"
            :operationen="operationen"
            :erzeugen-anstoss="vorschauAnstoss"
            @anstoss-erledigt="vorschauAnstoss = undefined"
            @oeffne-bild="oeffneBild"
            @oeffne-quelle="(sourceId: string) => emit('oeffneQuelle', sourceId)"
            @karte="waehleKarte"
            @auf-karte="aufKarte"
            @erneut="daten.erneutKarten()"
            @bilder-geaendert="kartenBilderGeaendert"
            @zur-liste="zurBilderListe"
            @entfernt="karteEntfernt"
            @zurueckgeholt="karteZurueckgeholt"
            @zurueck="ebene = 2"
        />
        <MedienPhotoboxGalerie
            v-if="photoboxOffen && (!telefon || ebene === 3)"
            :galerie="daten.photoboxGalerie.value"
            :liste="daten.photoboxListe.value.wert"
            :kennung="zustand.photoboxGalerie"
            :telefon="telefon"
            @bild="oeffneReisebild"
            @schliessen="offen = false"
            @erneut="daten.erneutPhotobox()"
            @zurueck="ebene = 2"
        />
        <MedienVorschlag
            v-if="vorschlaegeOffen && (!telefon || ebene === 3)"
            :vorschlag="zustand.vorschlag"
            :rechte="rechte"
            :telefon="telefon"
            @zurueck="ebene = 2"
        />
        <MedienInspektor
            v-if="!galerienOffen && !kartenOffen && !photoboxOffen && !vorschlaegeOffen && (!telefon || ebene === 3)"
            :daten="daten"
            :asset="zustand.asset"
            :zusammenfassung="zusammenfassung"
            :telefon="telefon"
            :treffer="daten.liste.value.total"
            :typbild="typbildEintrag"
            :typbild-variante="zustand.variante"
            :typbild-loest="loest"
            :neue-stelle="neueStelle"
            :entwurf="korrekturEntwurf"
            @stelle-waehlen="stelleWaehlen"
            @korrektur-zu="medienStelle.verwerfe()"
            @typbild-waehlen="typbildWaehlen"
            @typbild-variante="waehleTypbildVariante"
            @typbild-loesen="loeseTypbild"
            @auf-karte="aufKarte"
            @von="von"
            @typbild="zumTypbild"
            @karte="oeffneKarte"
            @vorschlag="oeffneVorschlag"
            @vorschau-konflikt="vorschauImEintrag"
            @geloescht="geloescht"
            @waehle-asset="waehleAsset"
            @erneut="daten.erneutAsset()"
            @zurueck="ebene = 2"
        />

        <MedienGalerieBilderFenster
            v-if="bilderOffen && gewaehlteGalerie"
            v-model:offen="bilderOffen"
            :galerie="gewaehlteGalerie"
            @fertig="daten.erneutGalerien()"
        />

        <MedienHochladenFenster
            v-if="stapelOffen && stapelGalerie"
            v-model:offen="stapelOffen"
            rolle="header"
            weg="medien"
            :galerie="stapelGalerie"
            :operationen="operationen"
            @stapel="daten.erneutGalerien()"
        />

        <MedienGalerieOrtFenster
            v-if="ortOffen && gewaehlteGalerie"
            v-model:offen="ortOffen"
            :galerie="gewaehlteGalerie"
            @fertig="daten.erneutGalerien()"
        />

        <MedienAuswahlFenster
            v-if="typbildAuswahlLauf > 0 && typbildEintrag !== undefined"
            :key="typbildAuswahlLauf"
            v-model:offen="typbildAuswahlOffen"
            :subjekt="{ kind: 'place', id: typbildEintrag.category, name: typbildEintrag.label }"
            rolle="header"
            :darf-hochladen="darfHochladen"
            :typbild="{
                kategorie: typbildEintrag.category,
                label: typbildEintrag.label,
                aktuell: typbildAktuell,
                variante: zustand.variante,
            }"
            weg="medien"
            :operationen="operationen"
            @gebunden="typbildGesetzt"
        />

        <MedienHochladenFenster
            v-if="hochladenRolle !== undefined"
            v-model:offen="hochladenOffen"
            :rolle="hochladenRolle"
            weg="medien"
            @fertig="hochgeladen"
        />

        <MedienKarteNeuFenster
            v-if="neuerEintragOffen"
            v-model:offen="neuerEintragOffen"
            :operationen="operationen"
            @fertig="karteAngelegt"
        />

        <MedienMergeAlleFenster
            v-if="mergeAlleOffen"
            v-model:offen="mergeAlleOffen"
            :operationen="operationen"
            @asset="(id) => ((mergeAlleOffen = false), waehleAsset(id))"
            @fertig="nachSammellauf"
        />

        <template #fuss-hinweis>
            <span class="medien-fenster__fuss" data-testid="medien-fuss">
                <span>{{ fussHinweis }}</span>
                <span v-if="!telefon" class="medien-fenster__legende" data-testid="medien-legende">
                    <span v-for="fuellung in KREIS_LEGENDE" :key="fuellung" class="medien-fenster__legende-teil">
                        <AvmKreis :fuellung="fuellung" :name="kreisName(fuellung)" />
                        {{ kreisName(fuellung) }}
                    </span>
                </span>
            </span>
        </template>
        <template #fuss-haupt>
            <button type="button" data-testid="medien-schliessen" @click="offen = false">
                {{ t("fenster.close") }}
            </button>
        </template>
    </AvmFenster>
</template>

<style scoped>
.medien-fenster__fuss {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-12);
}

.medien-fenster__legende {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-8);
}

.medien-fenster__legende-teil {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
}
</style>
