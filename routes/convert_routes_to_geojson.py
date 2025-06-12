import xml.etree.ElementTree as ET
import json

def svg_to_geojson(svg_file, geojson_file):
    """Konvertiere SVG-Daten mit Punkten und Pfaden in GeoJSON."""
    try:
        tree = ET.parse(svg_file)
        root = tree.getroot()
    except Exception as e:
        print(f"Fehler beim Laden der SVG-Datei: {e}")
        return

    namespaces = {"svg": "http://www.w3.org/2000/svg", "inkscape": "http://www.inkscape.org/namespaces/inkscape"}  # Namespace-Definition
    features = []
    circle_names = set()  # Set zum Überprüfen auf doppelte Namen

    # Punkte aus <circle> extrahieren
    for circle in root.findall(".//svg:circle", namespaces):
        try:
            cx = float(circle.attrib.get("cx", 0))
            cy = float(circle.attrib.get("cy", 0))
            label = circle.attrib.get("{http://www.inkscape.org/namespaces/inkscape}label", "Unknown")

            if "Kreuzung" not in label and label in circle_names:
                raise ValueError(f"Doppelte Namen gefunden: Der Name '{label}' wird für zwei Kreise verwendet.")

            circle_names.add(label)

            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [cx, 1024 - cy]
                },
                "properties": {
                    "name": label,
                    "type": "circle"
                }
            })
        except ValueError as ve:
            print(ve)
            return  # Abbrechen, wenn ein doppelter Name gefunden wird
        except Exception as e:
            print(f"Fehler beim Verarbeiten eines <circle>: {e}")

    # Pfade aus <path> extrahieren
    for path in root.findall(".//svg:path", namespaces):
        try:
            d = path.attrib.get("d", "").strip()
            label = path.attrib.get("{http://www.inkscape.org/namespaces/inkscape}label", "Unknown")
            path_id = path.attrib.get("id", "unknown")

            if not d:
                print(f"Pfad {path_id} hat kein 'd'-Attribut und wird übersprungen.")
                continue

            # Parsen des Pfads
            coordinates = parse_path_commands(d)

            if coordinates:
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": coordinates
                    },
                    "properties": {
                        "name": label,
                        "id": path_id,
                        "type": "path"
                    }
                })
            else:
                print(f"Pfad {path_id} enthält keine gültigen Koordinaten: {d}")
        except Exception as e:
            print(f"Fehler beim Verarbeiten eines <path>: {e}")

    # GeoJSON erstellen
    geojson = {
        "type": "FeatureCollection",
        "features": features
    }

    # GeoJSON in Datei speichern
    try:
        with open(geojson_file, "w") as f:
            json.dump(geojson, f, indent=2)
        print(f"GeoJSON wurde erfolgreich in {geojson_file} gespeichert.")
    except Exception as e:
        print(f"Fehler beim Speichern der GeoJSON-Datei: {e}")

def parse_path_commands(d):
    """Parses the 'd'-attribute of an SVG path and returns a list of coordinates."""
    commands = d.split()
    coordinates = []
    x, y = 0, 0  # Starting point for relative coordinates
    start_x, start_y = None, None  # For closed paths (Z)

    i = 0
    while i < len(commands):
        command = commands[i]
        try:
            if command.lower() in {"m", "l"}:
                is_relative = command.islower()
                i += 1
                # Process all coordinate pairs that include a comma
                while i < len(commands) and "," in commands[i]:
                    dx, dy = map(float, commands[i].split(","))
                    if is_relative:
                        x += dx
                        y += dy
                    else:
                        x, y = dx, dy
                    coordinates.append([x, 1024 - y])
                    i += 1
                if command.lower() == "m":
                    start_x, start_y = x, y
            elif command.lower() == "h":  # Horizontal lineto
                is_relative = command.islower()
                i += 1
                # Process all numbers until the next alphabetic command
                while i < len(commands) and not commands[i].isalpha():
                    dx = float(commands[i])
                    if is_relative:
                        x += dx
                    else:
                        x = dx
                    coordinates.append([x, 1024 - y])
                    i += 1
            elif command.lower() == "v":  # Vertical lineto (optional)
                is_relative = command.islower()
                i += 1
                while i < len(commands) and not commands[i].isalpha():
                    dy = float(commands[i])
                    if is_relative:
                        y += dy
                    else:
                        y = dy
                    coordinates.append([x, 1024 - y])
                    i += 1
            elif command.lower() == "z":
                if start_x is not None and start_y is not None:
                    coordinates.append([start_x, 1024 - start_y])
                i += 1
            else:
                # Skip unknown or unsupported commands
                i += 1
        except Exception as e:
            print(f"Fehler beim Parsen des Befehls '{command}': {e}")
            i += 1
    return coordinates

# Aufruf der Funktion
svg_to_geojson("routes.svg", "output.geojson")

import paramiko

def upload_to_sftp(server, username, password, local_file, remote_path):
    """Uploads a file to an SFTP server."""
    try:
        # Connect to the server
        transport = paramiko.Transport((server, 22))
        transport.connect(username=username, password=password)
        # Initialize SFTP client
        sftp = paramiko.SFTPClient.from_transport(transport)

        # Upload file
        sftp.put(local_file, remote_path)
        print(f"File {local_file} successfully uploaded to {remote_path}")

        # Close connection
        sftp.close()
        transport.close()

    except Exception as e:
        print(f"Error during SFTP upload: {e}")

# Define your server details and file paths
server = "<ENTER HOST>"
username = "<ENTER USERNAME>"
password = "<ENTER PASSWORD>"  # Replace with your password
local_file = "output.geojson"    # Replace with your local file path
remote_path = "<ENTER PATH>"  # Replace with desired remote path

# Upload the file
upload_to_sftp(server, username, password, local_file, remote_path)

