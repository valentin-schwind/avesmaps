import json

import pytest

from terrainlab.deskriptoren import Metrikvektor
from terrainlab.deskriptoren.synthetisch import fbm
from terrainlab.lauf.adapter import Unsauber
from terrainlab.lauf.cache import Zwischenspeicher
from terrainlab.lauf.konfig import parse_konfig
from terrainlab.lauf.qualitaet import laufe_qualitaet, tabelle
from terrainlab.lauf.vergleich import URTEILE, tabelle as vergleich_tabelle, vergleiche_ergebnisse, vergleiche_fall
from terrainlab.raster import schreibe

from test_lauf_attrappe import COMMIT_A, COMMIT_B, Attrappe

KLEIN = {"gruppen": ["hoehe", "hang"], "ohne_teuer": True}


def _konfig(**extra):
    return parse_konfig(
        {
            "name": "q",
            "qualitaet": KLEIN,
            "faelle": [
                {"name": "eins", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "vorschau": {"aufloesung": 1}},
                {"name": "zwei", "gebirge": {"fixture": "trollzacken"}, "stufe": "vorschau", "vorschau": {"aufloesung": 1}},
            ],
            **extra,
        }
    )


def test_metrikvektor_je_fall_und_zwischenspeicher(tmp_path):
    cache = Zwischenspeicher(tmp_path / "cache")
    a = Attrappe()
    e1 = laufe_qualitaet(_konfig(), a, tmp_path / "l1", cache=cache)
    assert [f["name"] for f in e1["faelle"]] == ["eins", "zwei"] and a.rechnungen == 2
    f = e1["faelle"][0]
    assert not f["raster_aus_cache"] and not f["metrik_aus_cache"]
    assert f["metriken"]["hoehe_mittel"] is not None and f["metriken"]["hang_neigung_mittel"] > 0
    assert not any(k.startswith("frequenz_") for k in f["metriken"]), "nur die gewählten Gruppen"
    v = Metrikvektor.lies(tmp_path / "l1" / f["vektor"])
    assert v["hoehe_mittel"] == pytest.approx(f["metriken"]["hoehe_mittel"])
    # Zweiter Lauf: identische Berechnungen nie doppelt, weder Raster noch Metriken.
    e2 = laufe_qualitaet(_konfig(), a, tmp_path / "l2", cache=cache)
    assert a.rechnungen == 2, "der Adapter rechnet nicht noch einmal"
    assert all(x["raster_aus_cache"] and x["metrik_aus_cache"] for x in e2["faelle"])
    assert e2["faelle"][0]["metriken"] == e1["faelle"][0]["metriken"]
    # Anderer Commit, derselbe Auftrag: neue Rechnung.
    b = Attrappe(commit=COMMIT_B)
    laufe_qualitaet(_konfig(), b, tmp_path / "l3", cache=cache)
    assert b.rechnungen == 2
    # --cache-neu übergeht ihn.
    laufe_qualitaet(_konfig(), a, tmp_path / "l4", cache=cache, cache_neu=True)
    assert a.rechnungen == 4


def test_anderer_auftrag_anderer_schluessel(tmp_path):
    cache = Zwischenspeicher(tmp_path / "cache")
    a = Attrappe()
    laufe_qualitaet(_konfig(), a, tmp_path / "l1", cache=cache)
    k = parse_konfig({"name": "q", "qualitaet": KLEIN, "faelle": [{"name": "eins", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "regler": {"erosion": 9}}]})
    e = laufe_qualitaet(k, a, tmp_path / "l2", cache=cache)
    assert a.rechnungen == 3 and not e["faelle"][0]["raster_aus_cache"]


def test_andere_deskriptoren_einstellungen_rechnen_metriken_neu_nicht_das_raster(tmp_path):
    cache = Zwischenspeicher(tmp_path / "cache")
    a = Attrappe()
    laufe_qualitaet(_konfig(), a, tmp_path / "l1", cache=cache)
    k = _konfig()
    k.qualitaet = {"gruppen": ["hoehe"], "ohne_teuer": True}
    e = laufe_qualitaet(k, a, tmp_path / "l2", cache=cache)
    assert a.rechnungen == 2 and e["faelle"][0]["raster_aus_cache"] and not e["faelle"][0]["metrik_aus_cache"]


def test_unsauberer_baum_wird_verweigert_und_nicht_zwischengespeichert(tmp_path):
    cache = Zwischenspeicher(tmp_path / "cache")
    a = Attrappe(sauber=False)
    with pytest.raises(Unsauber, match="weichen"):
        laufe_qualitaet(_konfig(), a, tmp_path / "l1", cache=cache)
    e = laufe_qualitaet(_konfig(), a, tmp_path / "l2", cache=cache, schmutzig_erlauben=True)
    assert a.rechnungen == 2 and not list((tmp_path / "cache").glob("raster/*/*")), "nichts im Zwischenspeicher"
    assert (tmp_path / "l2" / "raster" / "eins" / "meta.json").exists()
    assert e["faelle"][0]["metriken"]


def test_tabelle_und_ergebnisdatei(tmp_path):
    e = laufe_qualitaet(_konfig(), Attrappe(), tmp_path, cache=Zwischenspeicher(tmp_path / "c"))
    gelesen = json.loads((tmp_path / "ergebnis.json").read_text(encoding="utf-8"))
    assert gelesen["format"] == "avesmaps-terrainlab-qualitaet" and gelesen["commit"] == COMMIT_A
    assert gelesen["deskriptoren"]["gruppen"] == ["hoehe", "hang"] and len(gelesen["deskriptoren"]["quellhash"]) == 64
    assert "eins" in tabelle(e) and "Metriken" in tabelle(e)


def test_referenz_im_ergebnis(tmp_path):
    ref = tmp_path / "ref"
    schreibe(fbm((48, 56), 750.0, relief_m=1800.0, seed=5), ref)
    k = parse_konfig({"name": "q", "qualitaet": KLEIN, "faelle": [{"name": "eins", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "referenz": str(ref)}]})
    e = laufe_qualitaet(k, Attrappe(), tmp_path / "l", cache=Zwischenspeicher(tmp_path / "c"))
    r = e["faelle"][0]["referenz"]
    assert r["gruppenabstand"]["hoehe"] >= 0 and (tmp_path / "l" / r["vektor"]).exists()
    # Falsche Zellgröße der Referenz: der Fall bleibt, die Referenz meldet den Fehler.
    schreibe(fbm((48, 56), 375.0, seed=5), tmp_path / "ref2")
    k2 = parse_konfig({"name": "q", "qualitaet": KLEIN, "faelle": [{"name": "eins", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau", "referenz": str(tmp_path / "ref2")}]})
    e2 = laufe_qualitaet(k2, Attrappe(), tmp_path / "l2", cache=Zwischenspeicher(tmp_path / "c"))
    assert "Zellgrößen verschieden" in e2["faelle"][0]["referenz"]["fehler"]


# --- Vergleich -----------------------------------------------------------------------------------------------------------


def _vektoren(relief_a=1500.0, relief_b=2200.0):
    from terrainlab.deskriptoren import berechne

    return (
        berechne(fbm((64, 64), 750.0, relief_m=relief_a, seed=2), gruppen=("hoehe", "hang"), teuer=False),
        berechne(fbm((64, 64), 750.0, relief_m=relief_b, seed=2), gruppen=("hoehe", "hang"), teuer=False),
    )


def _urteil(ergebnis, name):
    return next(s for s in ergebnis["skalare"] if s["name"] == name)


def test_ohne_massstab_ist_nichts_besser_oder_schlechter():
    a, b = _vektoren()
    e = vergleiche_fall(a, b, None, {})
    assert e["urteile"]["besser"] == 0 and e["urteile"]["schlechter"] == 0
    s = _urteil(e, "hoehe_relief")
    assert s["urteil"] == "unbewertet" and s["differenz"] > 0 and s["relativ"] > 0.3, "die Änderung wird trotzdem gemeldet"


def test_ziele_richtung_und_sollwert():
    a, b = _vektoren()
    e = vergleiche_fall(a, b, None, {"hoehe_relief": {"richtung": "hoeher"}, "hang_neigung_mittel": {"richtung": "niedriger"}})
    assert _urteil(e, "hoehe_relief")["urteil"] == "besser"
    assert _urteil(e, "hang_neigung_mittel")["urteil"] == "schlechter", "mit mehr Relief wird der Hang steiler"
    # Sollwert: näher an 2200 ist besser, Referenzwert wie ein Sollwert.
    e2 = vergleiche_fall(a, b, None, {"hoehe_relief": {"ziel": 2200.0}})
    assert _urteil(e2, "hoehe_relief")["urteil"] == "besser"
    e3 = vergleiche_fall(a, b, None, {"hoehe_relief": {"ziel": 1500.0}})
    assert _urteil(e3, "hoehe_relief")["urteil"] == "schlechter"
    # Gleich innerhalb der Toleranz.
    e4 = vergleiche_fall(a, a, None, {"hoehe_relief": {"richtung": "hoeher"}})
    assert _urteil(e4, "hoehe_relief")["urteil"] == "gleich"


def test_ziel_ueber_die_familie_des_namens():
    a, b = _vektoren()
    e = vergleiche_fall(a, b, None, {"hang_neigung_mittel_f{F}": {"richtung": "niedriger"}})
    assert _urteil(e, "hang_neigung_mittel_f2")["urteil"] == "schlechter"


def test_referenz_bestimmt_die_richtung():
    a, b = _vektoren(1500.0, 2200.0)
    nah_an_b, _ = _vektoren(2300.0, 2300.0)
    e = vergleiche_fall(a, b, nah_an_b, {})
    assert _urteil(e, "hoehe_relief")["urteil"] == "besser"
    assert any(v["urteil"] == "besser" for v in e["verteilungen"]), "auch die Verteilungen werden an der Referenz gemessen"
    fern, _ = _vektoren(1500.0, 1500.0)
    e2 = vergleiche_fall(b, a, nah_an_b, {})
    assert _urteil(e2, "hoehe_relief")["urteil"] == "schlechter"
    assert fern is not None


def test_commits_vergleichen_ende_zu_ende(tmp_path):
    cache = Zwischenspeicher(tmp_path / "c")
    qa = laufe_qualitaet(_konfig(), Attrappe(commit=COMMIT_A, relief_m=1500.0), tmp_path / "a", cache=cache, commit=COMMIT_A)
    qb = laufe_qualitaet(_konfig(), Attrappe(commit=COMMIT_B, relief_m=2200.0), tmp_path / "b", cache=cache, commit=COMMIT_B)
    v = vergleiche_ergebnisse(qa, tmp_path / "a", qb, tmp_path / "b", {"hoehe_relief": {"richtung": "hoeher"}})
    assert v["commit_a"] == COMMIT_A and v["commit_b"] == COMMIT_B
    assert [f["name"] for f in v["faelle"]] == ["eins", "zwei"]
    assert all(not f["raster_gleich"] and f["auftrag_gleich"] for f in v["faelle"])
    assert v["urteile"]["besser"] >= 2
    text = vergleich_tabelle(v)
    assert "Verbesserungen" in text and "hoehe_relief" in text
    assert set(v["urteile"]) == set(URTEILE)


def test_gleicher_stand_ist_gleich(tmp_path):
    cache = Zwischenspeicher(tmp_path / "c")
    q = laufe_qualitaet(_konfig(), Attrappe(), tmp_path / "a", cache=cache)
    v = vergleiche_ergebnisse(q, tmp_path / "a", q, tmp_path / "a", {"hoehe_relief": {"richtung": "hoeher"}})
    assert all(f["raster_gleich"] for f in v["faelle"])
    assert v["urteile"]["besser"] == 0 and v["urteile"]["schlechter"] == 0


def test_unterschiedliche_deskriptoreinstellungen_werden_abgelehnt(tmp_path):
    from terrainlab.deskriptoren import MassstabFehler

    cache = Zwischenspeicher(tmp_path / "c")
    qa = laufe_qualitaet(_konfig(), Attrappe(), tmp_path / "a", cache=cache)
    k = _konfig()
    k.qualitaet = {**KLEIN, "parameter": {"min_prominenz_m": 50.0}}
    qb = laufe_qualitaet(k, Attrappe(), tmp_path / "b", cache=cache)
    with pytest.raises(MassstabFehler):
        vergleiche_ergebnisse(qa, tmp_path / "a", qb, tmp_path / "b", {})


def test_ohne_massstab_zeigt_die_tabelle_die_groessten_aenderungen(tmp_path):
    cache = Zwischenspeicher(tmp_path / "c")
    qa = laufe_qualitaet(_konfig(), Attrappe(commit=COMMIT_A, relief_m=1500.0), tmp_path / "a", cache=cache, commit=COMMIT_A)
    qb = laufe_qualitaet(_konfig(), Attrappe(commit=COMMIT_B, relief_m=2200.0), tmp_path / "b", cache=cache, commit=COMMIT_B)
    v = vergleiche_ergebnisse(qa, tmp_path / "a", qb, tmp_path / "b", {})
    assert v["urteile"]["besser"] == 0 and v["urteile"]["schlechter"] == 0 and all(f["geaendert"] > 5 for f in v["faelle"])
    text = vergleich_tabelle(v)
    assert "Größte Änderungen" in text and "geändert" in text and "Raster verschieden" in text
    # Mit einem Maßstab entfällt dieser Abschnitt: dann urteilen Regressionen und Verbesserungen.
    mit = vergleiche_ergebnisse(qa, tmp_path / "a", qb, tmp_path / "b", {"hoehe_relief": {"richtung": "hoeher"}})
    assert "Größte Änderungen" not in vergleich_tabelle(mit)
