import json

from terrainlab.lauf.konfig import parse_konfig
from terrainlab.lauf.perf import FREMDLAST_UNRUHIG_ANTEIL, laufe_perf, mindest_ram_mib, tabelle

from test_lauf_attrappe import Attrappe, COMMIT_A


def _konfig(**kopf):
    return parse_konfig(
        {
            "name": "t",
            "vorgabe": {"rezept": {"fassung": 19}},
            "faelle": [
                {"name": "klein", "gebirge": {"fixture": "blutzinnen"}, "stufe": "vorschau"},
                {"name": "gross", "gebirge": {"fixture": "trollzacken"}, "stufe": "vorschau", "vorschau": {"aufloesung": 2}, "wiederholungen": 2},
            ],
            **kopf,
        }
    )


def test_frische_prozesse_kalt_und_warm_getrennt(tmp_path):
    a = Attrappe(zeiten_ms=(1000.0, 1100.0, 1050.0))
    e = laufe_perf(_konfig(wiederholungen=3, warm=2, phasen="erster"), a, tmp_path)
    klein = e["faelle"][0]
    # drei Prozesse mit je einem kalten und zwei warmen Läufen
    assert klein["prozesse"] == 3 and len(a.aufrufe) == 3 + 2
    assert klein["kalt"]["wall_ms"]["n"] == 3 and klein["warm"]["wall_ms"]["n"] == 6
    assert klein["kalt"]["wall_ms"]["median"] == 1050.0
    assert klein["warm"]["wall_ms"]["median"] == 945.0, "warm ist hier 90 % der Zeit des Prozesses"
    assert e["faelle"][1]["prozesse"] == 2, "Messoptionen je Fall überschreiben die Konfiguration"
    # Rasterausgabe ist für Zeitmessungen aus
    assert all(x["ohne_raster"] for x in a.aufrufe)


def test_phasen_nur_im_ersten_prozess_oder_in_allen(tmp_path):
    a = Attrappe()
    laufe_perf(_konfig(wiederholungen=3, phasen="erster"), a, tmp_path / "e")
    assert [x["phasen"] for x in a.aufrufe[:3]] == [True, False, False]
    b = Attrappe()
    laufe_perf(_konfig(wiederholungen=3, phasen="alle"), b, tmp_path / "a")
    assert all(x["phasen"] for x in b.aufrufe[:3])
    c = Attrappe()
    e = laufe_perf(_konfig(wiederholungen=2, phasen="aus"), c, tmp_path / "n")
    assert not any(x["phasen"] for x in c.aufrufe) and e["faelle"][0]["phasen"] is None


def test_phasenanteile(tmp_path):
    e = laufe_perf(_konfig(wiederholungen=1, warm=0, phasen="erster"), Attrappe(), tmp_path)
    p = e["faelle"][0]["phasen"]
    assert p["methode"] == "differenz" and p["ergebnis_gleich"]
    assert p["anteile_prozent"] == {"landschaft": 90.0, "netz_hebung": 10.0}
    assert "Phasen: landschaft 90 %, netz_hebung 10 %" in tabelle(e)


def test_ergebnis_datei_und_kopf(tmp_path):
    e = laufe_perf(_konfig(wiederholungen=1, warm=0, arbeiter=1), Attrappe(), tmp_path)
    gelesen = json.loads((tmp_path / "ergebnis.json").read_text(encoding="utf-8"))
    assert gelesen["format"] == "avesmaps-terrainlab-perf"
    assert gelesen["stand"]["commit"] == COMMIT_A and gelesen["stand"]["reproduzierbar"]
    assert gelesen["umgebung"]["erosion_arbeiter"] == 1 and gelesen["umgebung"]["python"] and gelesen["umgebung"]["kerne"]
    assert e["faelle"][0]["meta"] == ["klein/p1/meta.json"]
    assert (tmp_path / "klein" / "p1" / "meta.json").exists()


def test_arbeiter_wird_durchgereicht(tmp_path):
    a = Attrappe()
    laufe_perf(_konfig(wiederholungen=1, warm=0, arbeiter=3), a, tmp_path)
    assert {x["arbeiter"] for x in a.aufrufe} == {3}


def test_fingerprint_stabil_und_deterministisch(tmp_path):
    e = laufe_perf(_konfig(wiederholungen=3, warm=0), Attrappe(), tmp_path)
    f = e["faelle"][0]
    assert f["fingerprint_stabil"] and f["deterministisch"] and len(f["ergebnis_fingerprint"]) == 64


def test_unruhe_wird_gemeldet(tmp_path):
    ruhig = laufe_perf(_konfig(wiederholungen=3, warm=0), Attrappe(zeiten_ms=(1000.0, 1010.0, 1005.0)), tmp_path / "r")
    assert not ruhig["faelle"][0]["unruhig"]
    # Die Streuung (MAD / Median) der kalten Zeiten über der Schwelle macht die Reihe unruhig.
    laut = laufe_perf(_konfig(wiederholungen=5, warm=0), Attrappe(zeiten_ms=(1000.0, 1300.0, 700.0, 1600.0, 1000.0)), tmp_path / "l")
    assert laut["faelle"][0]["unruhig"]
    assert "unruhig" in tabelle(laut)
    # Auch eine gleichmäßige Reihe auf einer überfüllten Maschine ist unruhig: 12 von 24 logischen Prozessoren durch andere belegt.
    voll = laufe_perf(_konfig(wiederholungen=3, warm=0), Attrappe(zeiten_ms=(1000.0, 1010.0, 1005.0), fremdlast=12.0), tmp_path / "v")
    assert voll["faelle"][0]["unruhig"]
    # Mäßige Fremdlast (wie bei mehreren Sitzungen am Rechner) allein macht noch keine unruhige Reihe.
    maessig = laufe_perf(_konfig(wiederholungen=3, warm=0), Attrappe(zeiten_ms=(1000.0, 1010.0, 1005.0), fremdlast=5.0), tmp_path / "m")
    assert not maessig["faelle"][0]["unruhig"] and maessig["faelle"][0]["fremdlast_kerne"]["median"] == 5.0
    assert 0 < FREMDLAST_UNRUHIG_ANTEIL < 1


def test_endgelaende_gruppen_und_speicherbedarf(tmp_path):
    k = parse_konfig({"name": "t", "faelle": [{"name": "e", "gebirge": {"fixture": "blutzinnen"}, "stufe": "endgelaende-lokal"}], "wiederholungen": 1, "warm": 0})
    e = laufe_perf(k, Attrappe(), tmp_path)
    d = e["faelle"][0]["domain"]
    assert d["gruppen_ms"]["grob"]["median"] == 500.0 and d["erosion"]["iterationen"] == 20
    assert "Endgelände: saat 10 ms, grob 500 ms" in tabelle(e)
    assert mindest_ram_mib(k) >= 4000, "das Endgelände rechnet die ganze grobe Stufe"
    assert mindest_ram_mib(_konfig()) < 4000
    assert mindest_ram_mib(parse_konfig({**k.roh, "mindest_frei_ram_mib": 123})) == 123
