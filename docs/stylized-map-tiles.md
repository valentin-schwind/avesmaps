# Stylized Map Tiles

Build the new raster map locally and upload the generated `tiles/stylized` folder by SFTP.

## Build

Install Pillow once:

```powershell
py -m pip install pillow
```

Generate WebP tiles:

```powershell
py tools/build_tiles.py `
    --input "C:\GIT\avesmaps-map-processing\gpt-image2\merged_water_and_land_edited.png" `
    --output "C:\GIT\avesmaps\tiles\stylized" `
    --format webp `
    --quality 82 `
    --clean
```

For the current `32768 x 32768` map this creates zoom levels `0` to `5` with `21840` tiles total. The filename scheme stays compatible with the current Leaflet setup:

```text
tiles/stylized/{z}/map_{x}_{negativeY}.webp
```

For `L.CRS.Simple`, the top row has the most negative `y` value. At zoom `0`, the first row is named `map_0_-4.webp` to `map_3_-4.webp`; the bottom row is `map_0_-1.webp` to `map_3_-1.webp`.

## Deriving landscape areas from the tiles

🔴 **The tiles are not only display — they are the data source of the Landschaften layer.**
`tools/ecosystem/` reads `tiles/stylized/3/` and derives the lake and island areas of
`ecosystem_region` / `ecosystem_area` from their colours (plan V5). Whoever rebuilds the tiles
makes those derived areas wrong by exactly their change: the outlines still describe the old
coastline, and nothing in the app notices.

If the tiles are rebuilt, re-run the derivation and compare the report before importing again:

```powershell
cd tools\ecosystem
python verify_orientation.py --payload map-features.json --zoom 2
python derive_areas.py --payload map-features.json --out manifest.json --report report.md
```

The colour threshold lives in `tools/ecosystem/ecosystem_raster.py` and is the production water
mask of this very pipeline (`13_make_landmass_rgba.py`) with one measured correction, because
the shallow-water shelf of the finished tiles is green-dominant turquoise. Details and the
remaining thresholds: `tools/ecosystem/README.md`.

## Upload

Upload the complete local folder:

```text
C:\GIT\avesmaps\tiles\stylized
```

to the Strato folder:

```text
/avesmaps/tiles/stylized
```

Keep the GitHub deploy workflow's `upload_tiles` option off. Tiles are intentionally ignored by Git.
