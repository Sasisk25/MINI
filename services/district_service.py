from config import DATA_FILES
from utils.io_utils import load_csv_safe


def get_rankings():
    df = load_csv_safe(DATA_FILES["district_summary"])
    if df.empty:
        return {"dangerous": [], "safe": []}
    return {
        "dangerous": df.sort_values("avg_risk_score", ascending=False).head(5).to_dict(orient="records"),
        "safe": df.sort_values("safety_score", ascending=False).head(5).to_dict(orient="records")
    }


def compare_districts(d1, d2):
    df = load_csv_safe(DATA_FILES["district_summary"])
    if df.empty:
        return {"district_1": {}, "district_2": {}}
    a = df[df["district"].str.lower() == d1.lower()]
    b = df[df["district"].str.lower() == d2.lower()]
    return {"district_1": (a.iloc[0].to_dict() if not a.empty else {}), "district_2": (b.iloc[0].to_dict() if not b.empty else {})}
