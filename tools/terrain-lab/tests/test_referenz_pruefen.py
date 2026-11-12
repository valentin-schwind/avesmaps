"""Manifest, Schema und `referenz pruefen`: jede Abweichung muss den Exit-Code ≠ 0 liefern. Ohne Netz."""

from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np
import pytest

from terrainlab.referenz import manifest as mf
from terrainlab.referenz import pruefen as pr
from terrainlab.referenz.jsonschreiber import formatiere, zu_text
from terrainlab.raster import schreibe, Hoehenraster

from test_referenz_hilfen import Werkstatt, ebene, eintrag_dict, manifest_dict, rezept_dict, schreibe_geotiff

X0, Y_OBEN = 500000.0, 5200000.0
FENSTER = [X0 + 1500.0, Y_OBEN - 1500.0 - 2250.0, X0 + 1500.0 + 3000.0, Y_OBEN - 1500.0]
REPO = Path(__file__).resolve().parents[3]


def _fertig(tmp_path) -> Werkstatt:
    """Eine Werkstatt mit einem bezogenen und aufbereiteten Ausschnitt (grüner Ausgangszustand)."""
    w = Werkstatt(tmp_path)
    quelle = schreibe_geotiff(w.quellen / "quelle.tif", ebene(1200, 900, 10.0), X0, Y_OBEN, 10.0, 10.0, 32632)
    w.lege_an([eintrag_dict("test-ebene")], {"test-ebene": rezept_dict("test-ebene", [str(quelle)], "EPSG:32632", FENSTER)})
    assert w.befehl("holen", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("aufbereiten", "test-ebene", "--manifest-aktualisieren") == 0
    assert w.befehl("pruefen") == 0
    return w


def _raster_pfad(w: Werkstatt, stufe: str) -> Path:
    return w.pfade().absolut(w.lade_manifest()["ausschnitte"][0]["raster"][stufe]["pfad"])


def test_gruener_ausgangszustand_auch_ohne_daten_und_tief(tmp_path, capsys):
    w = _fertig(tmp_path)
    assert w.befehl("pruefen", "--nur-manifest") == 0
    assert w.befehl("pruefen", "--tief") == 0
    assert "0 Fehler" in capsys.readouterr().out


def test_veraenderte_rohdatei_ist_ein_fehler(tmp_path):
    w = _fertig(tmp_path)
    roh = w.pfade().absolut(w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]["pfad"])
    roh.write_bytes(roh.read_bytes()[:-1] + b"\x00")
    assert w.befehl("pruefen") == 1
    assert w.befehl("pruefen", "--nur-manifest") == 0  # ohne Datenzugriff fällt es nicht auf


def test_ohne_roh_uebergeht_nur_die_rohdateien(tmp_path):
    w = _fertig(tmp_path)
    roh = w.pfade().absolut(w.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]["pfad"])
    roh.unlink()
    assert w.befehl("pruefen") == 1
    assert w.befehl("pruefen", "--ohne-roh") == 0
    _raster_pfad(w, "30m").with_suffix(".f32").unlink()
    assert w.befehl("pruefen", "--ohne-roh") == 1  # Raster fehlen weiterhin als Fehler


def test_fehlende_rohdatei_und_fehlendes_raster_sind_fehler(tmp_path):
    w = _fertig(tmp_path)
    _raster_pfad(w, "750m").with_suffix(".f32").unlink()
    assert w.befehl("pruefen") == 1
    w2 = _fertig(tmp_path / "zwei")
    roh = w2.pfade().absolut(w2.lade_manifest()["ausschnitte"][0]["quelle"]["dateien"][0]["pfad"])
    roh.unlink()
    assert w2.befehl("pruefen") == 1


def test_veraendertes_raster_ist_ein_fehler(tmp_path):
    w = _fertig(tmp_path)
    f32 = _raster_pfad(w, "375m").with_suffix(".f32")
    daten = bytearray(f32.read_bytes())
    daten[0] ^= 0xFF
    f32.write_bytes(bytes(daten))
    assert w.befehl("pruefen") == 1


def test_ausgetauschtes_raster_mit_stimmiger_eigenpruefsumme_faellt_am_manifest_auf(tmp_path):
    w = _fertig(tmp_path)
    r = _raster_pfad(w, "750m")
    schreibe(Hoehenraster(np.full((3, 4), 123.0, np.float32), 750.0, {"ausschnitt": "test-ebene"}), r.with_suffix(""))
    befunde = pr.pruefe(w.lade_manifest(), w.pfade())
    assert any("Prüfsumme weicht vom Manifest ab" in b.text for b in befunde)
    assert w.befehl("pruefen") == 1


def test_falsche_einheit_im_rasterkopf_ist_ein_fehler(tmp_path):
    w = _fertig(tmp_path)
    kopf = _raster_pfad(w, "750m").with_suffix(".json")
    daten = json.loads(kopf.read_text(encoding="utf-8"))
    daten["hoehe_einheit"] = "ft"
    kopf.write_text(json.dumps(daten), encoding="utf-8")
    assert w.befehl("pruefen") == 1


def test_unplausible_hoehen_zeigen_falsche_einheit_an(tmp_path):
    # Höhen in Fuß statt Metern wären hier 3,28-mal größer; ein Wert über 9000 m fällt auf.
    w = _fertig(tmp_path)
    r = _raster_pfad(w, "750m")
    raster = np.full((3, 4), 12000.0, np.float32)
    schreibe(Hoehenraster(raster, 750.0, {"ausschnitt": "test-ebene"}), r.with_suffix(""))
    eintrag = w.lade_manifest()
    kopf = json.loads(r.with_suffix(".json").read_text(encoding="utf-8"))
    eintrag["ausschnitte"][0]["raster"]["750m"].update(sha256=kopf["sha256"], hoehe_min=12000.0, hoehe_max=12000.0, nodata_anteil=0.0)
    w.manifest.write_text(zu_text(eintrag), encoding="utf-8")
    befunde = pr.pruefe(w.lade_manifest(), w.pfade())
    assert any("plausiblen Bereichs" in b.text for b in befunde)


def test_geaendertes_rezept_faellt_auf(tmp_path):
    w = _fertig(tmp_path)
    rezept = w.rezepte / "test-ebene.json"
    daten = json.loads(rezept.read_text(encoding="utf-8"))
    daten["nodata"]["mindestanteil_gueltig"] = 0.9
    rezept.write_text(zu_text(daten), encoding="utf-8")
    befunde = pr.pruefe(w.lade_manifest(), w.pfade(), nur_manifest=True)
    assert any("Rezept wurde seit dem Eintrag" in b.text for b in befunde)
    assert w.befehl("pruefen", "--nur-manifest") == 1


def test_veraenderte_schritte_im_manifest_fallen_auf(tmp_path):
    w = _fertig(tmp_path)
    manifest = w.lade_manifest()
    manifest["ausschnitte"][0]["aufbereitung"]["schritte"][1] = "NoData wird ignoriert"
    w.manifest.write_text(zu_text(manifest), encoding="utf-8")
    assert w.befehl("pruefen", "--nur-manifest") == 1


def test_ungeprueftes_manifest_ohne_bezug_ist_ein_fehler(tmp_path):
    w = Werkstatt(tmp_path)
    w.lege_an([eintrag_dict("leer")], {"leer": rezept_dict("leer", ["x.tif"], "EPSG:32632", FENSTER)})
    assert w.befehl("pruefen") == 1


def test_schema_verlangt_dtm_typ_rolle_und_lizenz():
    gut = manifest_dict([eintrag_dict("a"), eintrag_dict("b", typ="karst", rolle="validierung")])
    assert mf.pruefe_schema(gut) == []

    def veraendert(aendere):
        m = json.loads(json.dumps(gut))
        aendere(m["ausschnitte"][0])
        return mf.pruefe_schema(m)

    assert any("DTM" in t for t in veraendert(lambda e: e["quelle"].update(modell="DSM")))
    assert any("elf Gebirgstypen" in t for t in veraendert(lambda e: e.update(typ="vulkan")))
    assert any("rolle" in t for t in veraendert(lambda e: e.update(rolle="training")))
    assert any("lizenz.quellenangabe" in t for t in veraendert(lambda e: e["quelle"]["lizenz"].pop("quellenangabe")))
    assert any("vertikale Einheit" in t for t in veraendert(lambda e: e["quelle"]["vertikal"].update(einheit="ft")))
    assert any("doppelt" in t for t in veraendert(lambda e: e.update(id="b")))
    assert any("paarung" in t for t in veraendert(lambda e: e.update(paarung="gibt-es-nicht")))
    assert any("typ_weitere" in t for t in veraendert(lambda e: e.update(typ_weitere=["vulkan"])))


def test_abdeckung_weist_fehlende_validierung_aus(tmp_path):
    m = manifest_dict([eintrag_dict("a"), eintrag_dict("b", typ="karst")])
    zeilen = [b.text for b in pr.abdeckung_hinweise(m)]
    assert any("validierung" in z for z in zeilen)
    assert mf.abdeckung(m) == {
        "kettengebirge": {"optimierung": 1, "validierung": 0, "kontrolle": 0},
        "karst": {"optimierung": 1, "validierung": 0, "kontrolle": 0},
    }


def test_typenliste_gleicht_dem_typscript():
    quelle = REPO / "packages" / "shared" / "src" / "gebirge" / "regler.ts"
    if not quelle.is_file():
        pytest.skip("regler.ts nicht im Checkout")
    text = quelle.read_text(encoding="utf-8")
    block = re.search(r"GEBIRGSTYPEN\s*=\s*\[(.*?)\]", text, re.S)
    assert block is not None, "GEBIRGSTYPEN in regler.ts nicht gefunden"
    assert tuple(re.findall(r'"([a-z]+)"', block.group(1))) == mf.GEBIRGSTYPEN


def test_json_schreiber_ist_verlustfrei_und_haelt_die_breite():
    muster = {
        "a": [1, 2, 3],
        "b": {"c": "text mit äöü", "d": None, "e": True, "f": 1.5, "leer": {}, "liste": []},
        "g": [{"x": 1}, {"x": 2}],
        "lang": ["wort" * 10] * 6,
        "zahlen": [123456.789] * 30,
    }
    text = zu_text(muster)
    assert json.loads(text) == muster
    assert all(len(zeile) <= 120 for zeile in text.splitlines())
    assert "[1, 2, 3]" in text
    assert formatiere([]) == "[]" and formatiere({}) == "{}"
    # Prettier schreibt Exponenten ohne Plus und ohne führende Nullen
    assert formatiere([3.4e38, 9.259259e-05, 1e-10, 2.5]) == "[3.4e38, 9.259259e-5, 1e-10, 2.5]"


def test_das_echte_manifest_ist_ohne_daten_stimmig():
    """Hält Manifest, Rezepte, Schritte und Maße im Repository gegeneinander (braucht keine Rohdaten)."""
    pfade = mf.Pfade.standard()
    if not pfade.manifest.is_file():
        pytest.skip("kein Manifest im Checkout")
    manifest = mf.lade(pfade.manifest)
    fehler = [str(b) for b in pr.pruefe(manifest, pfade, nur_manifest=True) if b.stufe == pr.FEHLER]
    assert fehler == []
