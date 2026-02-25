"""
Extrae speakers y agenda del Excel del programa y genera los JSON para la webapp.
"""
import openpyxl
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
EXCEL_PATH = BASE / "webapp" / "Programa" / "Estructura del programa Convencion RT.xlsx"
SPEAKERS_OUT = BASE / "webapp" / "data" / "speakers.json"
AGENDA_OUT = BASE / "webapp" / "data" / "agenda.json"

def main():
    wb = openpyxl.load_workbook(str(EXCEL_PATH), data_only=True)
    ws = wb["Sheet1"]

    grid = []
    for row in ws.iter_rows(min_row=1, max_row=80, max_col=8, values_only=True):
        grid.append([str(c).strip() if c else "" for c in row])

    # Parse speakers
    speakers = []
    speaker_id = 0
    seen_names = set()
    current_area = ""
    area_map = {"MAMA": "mama", "NEURO": "neuro", "PULMON": "pulmon", "PROSTATA": "prostata"}
    skip_names = {"n/a", "no corresponde", "invitado brainlab", "equipo diagnostico",
                  "equipo diagnóstico", "", "se elimina", "imagenologa hb",
                  "endoscopista hospital maciel"}
    moderators = {}
    case_types = {}

    for i, row in enumerate(grid):
        if row[1] in area_map:
            current_area = area_map[row[1]]
            mod_text = row[2]
            if "Moderador" in mod_text:
                mod_name = mod_text.split(")")[-1].strip()
                if " con apoyo de " in mod_name:
                    mod_name = mod_name.split(" con apoyo de ")[0].strip()
                moderators[current_area] = mod_name
            continue

        if row[3].strip().lower() == "tipo" and current_area:
            case_types[current_area] = [row[4], row[5], row[6], row[7] if len(row) > 7 else ""]

        if row[3].strip().lower() == "nombre" and current_area:
            specialty = row[2].strip()
            if not specialty:
                for j in range(i - 1, max(i - 3, 0), -1):
                    if grid[j][2].strip():
                        specialty = grid[j][2].strip()
                        break

            for col in range(4, min(8, len(row))):
                names_str = row[col]
                if not names_str:
                    continue
                for name in names_str.split("/"):
                    name = name.strip().replace("  ", " ")
                    if name.lower().strip() in skip_names or len(name) < 3:
                        continue
                    if "(opcion" in name.lower():
                        name = name.split("(")[0].strip()
                    key = name.lower().replace(" ", "")
                    if key in seen_names:
                        continue
                    seen_names.add(key)
                    speaker_id += 1
                    speakers.append({
                        "id": f"speaker-{speaker_id:03d}",
                        "name": name,
                        "specialty": specialty,
                        "institution": "",
                        "area": current_area,
                        "photo": "",
                        "bio": ""
                    })

    # Add moderators
    for area, name in moderators.items():
        key = name.lower().replace(" ", "")
        if key not in seen_names:
            seen_names.add(key)
            speaker_id += 1
            speakers.append({
                "id": f"speaker-{speaker_id:03d}",
                "name": name,
                "specialty": "Moderador",
                "institution": "RT International Institute",
                "area": area,
                "photo": "",
                "bio": ""
            })

    with open(str(SPEAKERS_OUT), "w", encoding="utf-8") as f:
        json.dump(speakers, f, ensure_ascii=False, indent=2)
    print(f"speakers.json: {len(speakers)} speakers")

    # Build agenda
    area_labels = {"mama": "Mama", "neuro": "Neuro", "pulmon": "Pulmón", "prostata": "Próstata"}

    def make_session(time, end, area, room, title, moderator=None, desc=None):
        s = {"time": time, "end": end, "area": area, "room": room, "title": title, "speakers": []}
        if moderator:
            s["moderator"] = moderator
        if desc:
            s["description"] = desc
        return s

    def case_title(area, num, cases):
        idx = num - 1
        desc = cases[idx] if len(cases) > idx and cases[idx] else ""
        if desc == "SE ELIMINA":
            desc = "Por confirmar"
        label = area_labels.get(area, area)
        if desc:
            return f"Caso {num} — {label}: {desc}"
        return f"Caso {num} — {label}"

    day1 = []
    day2 = []

    # Day 1
    day1.append(make_session("08:30", "09:00", "mama", "Salón Principal",
                             "Apertura y bienvenida",
                             desc="Palabras de bienvenida y presentación del formato."))

    for area in ["mama", "neuro"]:
        room = "Sala A" if area == "mama" else "Sala B"
        cases = case_types.get(area, [])
        day1.append(make_session("09:00", "10:15", area, room,
                                 case_title(area, 1, cases),
                                 moderator=moderators.get(area, "")))

    day1.append(make_session("10:15", "10:45", "mama", "Foyer", "Coffee break"))

    for area in ["pulmon", "prostata"]:
        room = "Sala A" if area == "pulmon" else "Sala B"
        cases = case_types.get(area, [])
        day1.append(make_session("10:45", "12:00", area, room,
                                 case_title(area, 1, cases),
                                 moderator=moderators.get(area, "")))

    day1.append(make_session("12:00", "13:30", "mama", "Restaurante", "Almuerzo"))

    for area in ["mama", "neuro"]:
        room = "Sala A" if area == "mama" else "Sala B"
        cases = case_types.get(area, [])
        day1.append(make_session("13:30", "14:45", area, room,
                                 case_title(area, 2, cases),
                                 moderator=moderators.get(area, "")))

    day1.append(make_session("14:45", "15:15", "mama", "Foyer", "Coffee break"))

    for area in ["pulmon", "prostata"]:
        room = "Sala A" if area == "pulmon" else "Sala B"
        cases = case_types.get(area, [])
        day1.append(make_session("15:15", "16:30", area, room,
                                 case_title(area, 2, cases),
                                 moderator=moderators.get(area, "")))

    day1.append(make_session("20:00", "23:00", "mama", "Por confirmar",
                             "Cena de la Convención",
                             desc="Cena formal de networking para todos los asistentes."))

    # Day 2
    for area in ["mama", "neuro"]:
        room = "Sala A" if area == "mama" else "Sala B"
        cases = case_types.get(area, [])
        day2.append(make_session("09:00", "10:15", area, room,
                                 case_title(area, 3, cases),
                                 moderator=moderators.get(area, "")))

    day2.append(make_session("10:15", "10:45", "mama", "Foyer", "Coffee break"))

    for area in ["pulmon", "prostata"]:
        room = "Sala A" if area == "pulmon" else "Sala B"
        cases = case_types.get(area, [])
        day2.append(make_session("10:45", "12:00", area, room,
                                 case_title(area, 3, cases),
                                 moderator=moderators.get(area, "")))

    day2.append(make_session("12:00", "13:30", "mama", "Restaurante", "Almuerzo"))

    for area in ["mama", "neuro"]:
        room = "Sala A" if area == "mama" else "Sala B"
        cases = case_types.get(area, [])
        day2.append(make_session("13:30", "14:45", area, room,
                                 case_title(area, 4, cases),
                                 moderator=moderators.get(area, "")))

    day2.append(make_session("14:45", "15:15", "mama", "Foyer", "Coffee break"))

    for area in ["pulmon", "prostata"]:
        room = "Sala A" if area == "pulmon" else "Sala B"
        cases = case_types.get(area, [])
        day2.append(make_session("15:15", "16:30", area, room,
                                 case_title(area, 4, cases),
                                 moderator=moderators.get(area, "")))

    day2.append(make_session("16:30", "17:00", "mama", "Salón Principal",
                             "Cierre y conclusiones",
                             desc="Síntesis de las discusiones y próximos pasos."))

    agenda = [
        {"day": 1, "date": "2026-03-13", "sessions": day1},
        {"day": 2, "date": "2026-03-14", "sessions": day2}
    ]

    with open(str(AGENDA_OUT), "w", encoding="utf-8") as f:
        json.dump(agenda, f, ensure_ascii=False, indent=2)
    print(f"agenda.json: {len(day1)} + {len(day2)} sessions")
    print(f"Moderadores: {moderators}")


if __name__ == "__main__":
    main()
