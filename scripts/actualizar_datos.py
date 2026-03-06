"""
Extrae speakers y agenda del Excel del programa y genera los JSON para la webapp.
Nuevo Excel: "Oficial - Estructura del programa Convencion RT.xlsx"
"""
import openpyxl
import json
import re
import unicodedata
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
EXCEL_PATH = BASE / "nuevo excell" / "Oficial - Estructura del programa Convencion RT.xlsx"
SPEAKERS_OUT = BASE / "webapp" / "data" / "speakers.json"
AGENDA_OUT = BASE / "webapp" / "data" / "agenda.json"
EXISTING_SPEAKERS = BASE / "webapp" / "data" / "speakers.json"

SHEET_NAME = "Oficial Modifcado Marzo "  # Note trailing space

SKIP_NAMES = {
    "n/a", "no corresponde", "invitado brainlab", "equipo diagnostico",
    "equipo diagnóstico", "", "se elimina", "kol brainlab",
    "endoscopista hospital maciel", "tracking con exactrack dynamic surface",
    "dibh con exactrack dynamic surface",
}

AREA_MAP = {"MAMA": "mama", "NEURO": "neuro", "PULMON": "pulmon", "PROSTATA": "prostata"}

# Row ranges for each area in the Excel (1-based)
AREA_ROWS = {
    "mama":     (3, 21),   # Rows 3-21
    "neuro":    (22, 40),  # Rows 22-40
    "pulmon":   (41, 60),  # Rows 41-60
    "prostata": (62, 78),  # Rows 62-78
}


def normalize(name):
    """Normalize name for dedup."""
    s = unicodedata.normalize("NFD", str(name or ""))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return s.lower().strip()


def clean_name(raw):
    """Clean a speaker name, removing parenthetical notes and extras."""
    name = str(raw or "").strip()
    # Remove common suffixes like "(Neurinoma)", "(Meningioma)", "(Spine)", etc.
    name = re.sub(r"\s*\([^)]*\)\s*", " ", name)
    # Remove " - INSEMA SOUND" style suffixes
    name = re.sub(r"\s*-\s*INSEMA\s+SOUND", "", name, flags=re.IGNORECASE)
    # Remove "Paciente quirúrgico en H.Maciel" etc
    name = re.sub(r"\s*\(Paciente[^)]*\)", "", name, flags=re.IGNORECASE)
    name = name.strip().rstrip(",").strip()
    return name


def extract_names_from_cell(cell_value):
    """Extract individual names from a cell, splitting by / and ,."""
    text = str(cell_value or "").strip()
    if not text:
        return []

    # Handle special cases like "Neurólogos: Alejandro Scaramelli (HB) María Inés Nouzelles (PE), Ignacio Amorín (Cátedra)"
    if ":" in text and any(kw in text.lower() for kw in ["neurólogos", "neurologos"]):
        text = text.split(":", 1)[1].strip()

    # Split by / first, then by , if no /
    if "/" in text:
        parts = text.split("/")
    else:
        parts = text.split(",")

    names = []
    for part in parts:
        # Also split by space-separated names with parentheses (e.g. "Soledad Colombo (Meningioma) Pablo Castropeña (Schwanoma)")
        # Detect pattern: Name1 (note1) Name2 (note2)
        subparts = re.split(r"(?<=\))\s+(?=[A-ZÁÉÍÓÚÑ])", part.strip())
        if len(subparts) > 1:
            for sp in subparts:
                cleaned = clean_name(sp)
                if cleaned and len(cleaned) >= 3 and normalize(cleaned) not in SKIP_NAMES:
                    names.append(cleaned)
        else:
            cleaned = clean_name(part)
            if cleaned and len(cleaned) >= 3 and normalize(cleaned) not in SKIP_NAMES:
                names.append(cleaned)

    return names


def load_existing_speakers():
    """Load existing speakers.json for merging bio/photo/institution/nationality."""
    if not EXISTING_SPEAKERS.exists():
        return {}
    with open(EXISTING_SPEAKERS, "r", encoding="utf-8") as f:
        existing = json.load(f)
    lookup = {}
    for s in existing:
        key = normalize(s.get("name", ""))
        lookup[key] = s
    return lookup


def main():
    wb = openpyxl.load_workbook(str(EXCEL_PATH), data_only=True)
    ws = wb[SHEET_NAME]

    # Read grid with extra columns for neuro's case 5
    grid = []
    for row in ws.iter_rows(min_row=1, max_row=80, max_col=12, values_only=True):
        grid.append([str(c).strip() if c else "" for c in row])

    existing = load_existing_speakers()

    # Parse moderators
    moderators = {}
    for area_key, (start_row, _) in AREA_ROWS.items():
        row = grid[start_row - 1]  # 0-indexed
        mod_text = row[2]
        if "Moderador" in mod_text:
            mod_name = mod_text.split(")")[-1].strip()
            if " con apoyo de " in mod_name:
                parts = mod_name.split(" con apoyo de ")
                mod_name = parts[0].strip()
            moderators[area_key] = mod_name

    # Parse case types (Tipo row)
    case_types = {}
    for area_key, (start_row, _) in AREA_ROWS.items():
        # Find the "Tipo" row
        for i in range(start_row - 1, start_row + 3):
            if i < len(grid) and grid[i][3].strip().lower() == "tipo":
                cases = [grid[i][4], grid[i][5], grid[i][6], grid[i][7]]
                # Neuro has extra case in column 11 (index 10) - merged into case 2
                if area_key == "neuro" and len(grid[i]) > 10 and grid[i][10]:
                    # Append Glioblastoma G4 info to case 2 title
                    cases[1] = cases[1] + " / " + grid[i][10] if cases[1] else grid[i][10]
                # Clean case type text: remove speaker names embedded in tipo
                cleaned_cases = []
                for ct in cases:
                    # Remove patterns like "Gustavo Ferraris/Matías Jeldrés" from end
                    ct = re.sub(r"\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:/[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)*\s*$", "", ct)
                    # Remove "Verónica Vera. NSCLC..." type patterns
                    ct = re.sub(r"\b[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\.\s*", "", ct)
                    cleaned_cases.append(ct.strip().rstrip(".").strip())
                case_types[area_key] = cleaned_cases
                break

    # Parse speakers per area per case
    all_speakers = []
    seen_names = set()
    speaker_id_counter = 0

    def add_speaker(name, specialty, area, cases_list):
        nonlocal speaker_id_counter
        key = normalize(name)
        if key in seen_names:
            # Find existing and add to cases
            for sp in all_speakers:
                if normalize(sp["name"]) == key:
                    for c in cases_list:
                        if c not in sp["_cases"].get(area, []):
                            sp["_cases"].setdefault(area, []).append(c)
                    break
            return
        seen_names.add(key)
        speaker_id_counter += 1

        # Merge with existing data
        ex = existing.get(key, {})
        sp = {
            "id": f"speaker-{speaker_id_counter:03d}",
            "name": name,
            "specialty": specialty,
            "institution": ex.get("institution", ""),
            "area": area,
            "nationality": ex.get("nationality", ""),
            "photo": ex.get("photo", ""),
            "bio": ex.get("bio", ""),
            "_cases": {area: list(cases_list)},
        }
        all_speakers.append(sp)

    for area_key, (start_row, end_row) in AREA_ROWS.items():
        current_specialty = ""
        for i in range(start_row - 1, end_row):
            if i >= len(grid):
                break
            row = grid[i]

            # Detect specialty (column C, index 2)
            if row[2].strip() and row[2].strip().lower() not in ("", "moderador"):
                spec_text = row[2].strip()
                if not spec_text.startswith("Moderador"):
                    current_specialty = spec_text

            # Detect "Nombre" rows (column D, index 3)
            if row[3].strip().lower() == "nombre":
                if not current_specialty:
                    # Look back for specialty
                    for j in range(i - 1, max(i - 3, 0), -1):
                        if grid[j][2].strip():
                            current_specialty = grid[j][2].strip()
                            break

                # Columns E-H = Cases 1-4
                for case_num in range(1, 5):
                    col_idx = 3 + case_num  # case 1 = col 4, case 2 = col 5, etc.
                    if col_idx >= len(row):
                        continue
                    cell = row[col_idx]
                    names = extract_names_from_cell(cell)
                    for name in names:
                        add_speaker(name, current_specialty, area_key, [case_num])

                # Neuro extra column (index 10) → merge into Case 2
                if area_key == "neuro" and len(row) > 10 and row[10]:
                    names = extract_names_from_cell(row[10])
                    for name in names:
                        add_speaker(name, current_specialty, area_key, [2])

    # Special case: Prostata Patólogo has names in "Tema" row (Gabriela Walko, Adriana DellaValle)
    # Row 72: Tema | Gabriela Walko | Adriana DellaValle
    for i in range(61, 78):
        if i >= len(grid):
            break
        row = grid[i]
        if row[3].strip().lower() == "tema" and row[2].strip() == "":
            # Check if preceding row was "Patólogo Nombre" with "Equipo Diagnóstico"
            if i > 0 and "pat" in normalize(grid[i-1][2]) and "equipo" in normalize(grid[i-1][4]):
                for col in range(4, 8):
                    if col < len(row) and row[col]:
                        names = extract_names_from_cell(row[col])
                        case_num = col - 3
                        for name in names:
                            add_speaker(name, "Patólogo", "prostata", [case_num])

    # Add moderators as speakers
    for area, mod_name in moderators.items():
        key = normalize(mod_name)
        if key not in seen_names:
            add_speaker(mod_name, "Moderador", area, [1, 2, 3, 4])
        # Also add "apoyo" moderator for neuro (Federico Salles)
        if area == "neuro":
            add_speaker("Federico Salles", "Neurocirujano", area, [1, 2, 3, 4])

    # Add Heloisa Carvalho (mama Radiooncologo, in Excel rows)
    # She's already parsed from the Excel, but let's make sure she's mapped to mama
    for sp in all_speakers:
        if normalize(sp["name"]) == normalize("Heloisa Carvalho"):
            sp["area"] = "mama"  # Primary area
            break

    # Add special speakers not parsed (Verónica Vera, Mabel Sardi from tipo descriptions)
    # Pulmon Caso 4 mentions "Verónica Vera" and "Diego Touya" in the Tipo cell
    # These are already parsed from their specialty rows

    # Build speaker ID lookup for agenda
    speaker_lookup = {}
    for sp in all_speakers:
        speaker_lookup[normalize(sp["name"])] = sp["id"]

    # Clean up internal _cases field and write speakers.json
    speakers_output = []
    for sp in all_speakers:
        out = {k: v for k, v in sp.items() if not k.startswith("_")}
        speakers_output.append(out)

    with open(str(SPEAKERS_OUT), "w", encoding="utf-8") as f:
        json.dump(speakers_output, f, ensure_ascii=False, indent=2)
    print(f"speakers.json: {len(speakers_output)} speakers")

    # ============================================
    # BUILD AGENDA
    # ============================================
    area_labels = {"mama": "Mama", "neuro": "Neuro", "pulmon": "Pulmón", "prostata": "Próstata"}
    rooms = {"mama": "Sala A", "pulmon": "Sala B", "prostata": "Sala C", "neuro": "Sala D"}

    def get_case_speakers(area, case_num):
        """Get speaker IDs for a specific area+case."""
        ids = []
        for sp in all_speakers:
            cases_map = sp.get("_cases", {})
            if area in cases_map and case_num in cases_map[area]:
                ids.append(sp["id"])
            elif sp.get("area") == area and case_num in cases_map.get(area, []):
                ids.append(sp["id"])
        return ids

    def make_session(time, end, area, room, title, moderator=None, desc=None, speaker_ids=None):
        s = {
            "time": time, "end": end, "area": area, "room": room,
            "title": title, "speakers": speaker_ids or [],
        }
        if moderator:
            s["moderator"] = moderator
        if desc:
            s["description"] = desc
        return s

    def case_title(area, num, cases):
        idx = num - 1
        desc = cases[idx] if len(cases) > idx and cases[idx] else ""
        label = area_labels.get(area, area)
        if desc:
            return f"Caso {num} — {label}: {desc}"
        return f"Caso {num} — {label}"

    day1 = []
    day2 = []

    # Day 1 - Viernes 13
    day1.append(make_session("16:00", "16:30", "evento", "Salón Principal",
                             "Acreditación y bienvenida",
                             desc="Palabras de bienvenida y presentación del formato."))

    # Cases 1: 16:30-17:45 (all 4 areas)
    for area in ["mama", "pulmon", "prostata", "neuro"]:
        cases = case_types.get(area, [])
        day1.append(make_session(
            "16:30", "17:45", area, rooms[area],
            case_title(area, 1, cases),
            moderator=moderators.get(area, ""),
            speaker_ids=get_case_speakers(area, 1),
        ))

    day1.append(make_session("17:45", "18:15", "evento", "Foyer", "Coffee break"))

    # Cases 2: 18:15-19:30 (all 4 areas)
    for area in ["mama", "pulmon", "prostata", "neuro"]:
        cases = case_types.get(area, [])
        day1.append(make_session(
            "18:15", "19:30", area, rooms[area],
            case_title(area, 2, cases),
            moderator=moderators.get(area, ""),
            speaker_ids=get_case_speakers(area, 2),
        ))

    day1.append(make_session("20:30", "23:00", "evento", "I'marangatú Restaurant & Beach Club",
                             "Cena de la Convención",
                             desc="Cena formal de networking en I'marangatú (Rambla C. Williman, Parada 7, Playa Mansa). Traslado incluido desde el Gran Hotel."))

    # Day 2 - Sábado 14
    # Cases 3: 09:00-10:15
    for area in ["mama", "pulmon", "prostata", "neuro"]:
        cases = case_types.get(area, [])
        day2.append(make_session(
            "09:00", "10:15", area, rooms[area],
            case_title(area, 3, cases),
            moderator=moderators.get(area, ""),
            speaker_ids=get_case_speakers(area, 3),
        ))

    day2.append(make_session("10:15", "10:45", "evento", "Foyer", "Coffee break"))

    # Cases 4: 10:45-12:00
    for area in ["mama", "pulmon", "prostata", "neuro"]:
        cases = case_types.get(area, [])
        day2.append(make_session(
            "10:45", "12:00", area, rooms[area],
            case_title(area, 4, cases),
            moderator=moderators.get(area, ""),
            speaker_ids=get_case_speakers(area, 4),
        ))

    day2.append(make_session("12:00", "12:30", "evento", "Salón Principal",
                             "Cierre y conclusiones",
                             desc="Síntesis de las discusiones y próximos pasos."))

    agenda = [
        {"day": 1, "date": "2026-03-13", "sessions": day1},
        {"day": 2, "date": "2026-03-14", "sessions": day2},
    ]

    with open(str(AGENDA_OUT), "w", encoding="utf-8") as f:
        json.dump(agenda, f, ensure_ascii=False, indent=2)
    print(f"agenda.json: {len(day1)} + {len(day2)} sessions")
    print(f"Moderadores: {moderators}")
    print(f"Case types: {case_types}")

    # Print speakers per case for verification
    for area in ["mama", "neuro", "pulmon", "prostata"]:
        for c in range(1, 5):
            ids = get_case_speakers(area, c)
            names = [sp["name"] for sp in all_speakers if sp["id"] in ids]
            print(f"  {area} Caso {c}: {', '.join(names) or '(ninguno)'}")


if __name__ == "__main__":
    main()
