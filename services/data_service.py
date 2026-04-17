from config import DATA_FILES
from utils.io_utils import load_csv_safe


def get_state_data():
    acc = load_csv_safe(DATA_FILES["accidents"])
    haz = load_csv_safe(DATA_FILES["hazards"])
    return {
        "accidents": acc.to_dict(orient="records"),
        "potholes": load_csv_safe(DATA_FILES["potholes"]).to_dict(orient="records"),
        "intersections": load_csv_safe(DATA_FILES["intersections"]).to_dict(orient="records"),
        "hazards": haz.to_dict(orient="records"),
        "district_summary": load_csv_safe(DATA_FILES["district_summary"]).to_dict(orient="records"),
        "heatmap": {
            "accidents": [[r.latitude, r.longitude, min(float(r.accident_count)/20, 1)] for r in acc.itertuples()],
            "hazards": [[r.latitude, r.longitude, 0.45] for r in haz.itertuples()]
        }
    }
