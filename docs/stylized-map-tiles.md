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
