from config import DATA_FILES
from utils.io_utils import load_csv_safe


def get_trends():
    df = load_csv_safe(DATA_FILES["accident_trends"])
    if df.empty:
        return {"monthly": [], "districts": {}}
    monthly = df.groupby("month", as_index=False)["accident_count"].sum().sort_values("month").to_dict(orient="records")
    districts = {d: g.sort_values("month")[["month", "accident_count"]].to_dict(orient="records") for d, g in df.groupby("district")}
    return {"monthly": monthly, "districts": districts}
