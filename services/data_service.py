from config import DATA_FILES
from utils.io_utils import load_csv_safe


def get_state_data():
    acc  = load_csv_safe(DATA_FILES["accidents"])
    haz  = load_csv_safe(DATA_FILES["hazards"])
    pot  = load_csv_safe(DATA_FILES["potholes"])
    inter = load_csv_safe(DATA_FILES["intersections"])
    summ  = load_csv_safe(DATA_FILES["district_summary"])

    # Aggregate stats for the stats bar
    total_accidents  = int(acc["accident_count"].sum())  if not acc.empty  and "accident_count" in acc.columns  else 0
    total_potholes   = int(pot["pothole_count"].sum())   if not pot.empty  and "pothole_count" in pot.columns   else 0
    total_hazards    = len(haz)                          if not haz.empty  else 0
    black_spots      = int((acc["accident_count"] >= 12).sum()) if not acc.empty and "accident_count" in acc.columns else 0

    return {
        "accidents":        acc.to_dict(orient="records"),
        "potholes":         pot.to_dict(orient="records"),
        "intersections":    inter.to_dict(orient="records"),
        "hazards":          haz.to_dict(orient="records"),
        "district_summary": summ.to_dict(orient="records"),
        "total_accidents":  total_accidents,
        "total_potholes":   total_potholes,
        "total_hazards":    total_hazards,
        "black_spots":      black_spots,
        "heatmap": {
            "accidents": [[r.latitude, r.longitude, min(float(r.accident_count) / 20, 1)] for r in acc.itertuples()],
            "hazards":   [[r.latitude, r.longitude, 0.45] for r in haz.itertuples()],
        },
    }
