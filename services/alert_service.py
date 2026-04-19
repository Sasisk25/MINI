from datetime import datetime
from config import DATA_FILES
from utils.io_utils import load_csv_safe, append_row

COLS = ["timestamp", "lat", "lng", "city", "district", "alert_level", "reason"]

_SEVERITY_MAP = {"CRITICAL": "high", "WARNING": "medium", "NORMAL": "low"}


def evaluate_alert(lat, lng, stats):
    alert = None
    if stats["accident_count"] >= 18 and stats["traffic_density"] >= 75:
        alert = ("CRITICAL", "High accident density combined with heavy traffic congestion")
    elif stats["black_spot_nearby"]:
        alert = ("CRITICAL", "Active black spot — historically high accident cluster nearby")
    elif stats["reported_hazards"] >= 3 or (stats["pothole_count"] >= 8 and stats["reported_hazards"] >= 2):
        alert = ("WARNING", "Multiple community-reported hazards in this area")
    elif stats["pothole_count"] >= 6:
        alert = ("WARNING", "Significant pothole density — slow down and watch road surface")

    if alert:
        append_row(DATA_FILES["alerts"], {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "lat": lat, "lng": lng,
            "city": stats["city"], "district": stats["district"],
            "alert_level": alert[0], "reason": alert[1]
        }, COLS)
        return {"level": alert[0], "reason": alert[1], "severity": _SEVERITY_MAP.get(alert[0], "low")}
    return {"level": "NORMAL", "reason": "No active critical pattern", "severity": "low"}


def get_alerts(limit=20):
    df = load_csv_safe(DATA_FILES["alerts"], columns=COLS)
    if df.empty:
        return []
    records = df.tail(limit).iloc[::-1].to_dict(orient="records")
    # Add a formatted message field for the frontend
    for r in records:
        r["message"] = f"[{r.get('alert_level','?')}] {r.get('city','?')}, {r.get('district','?')}: {r.get('reason','')}"
        r["severity"] = _SEVERITY_MAP.get(r.get("alert_level",""), "low")
    return records
