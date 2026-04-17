from datetime import datetime
from config import DATA_FILES
from utils.io_utils import load_csv_safe, append_row

COLS = ["timestamp", "lat", "lng", "city", "district", "alert_level", "reason"]


def evaluate_alert(lat, lng, stats):
    alert = None
    if stats["accident_count"] >= 18 and stats["traffic_density"] >= 75:
        alert = ("CRITICAL", "High accident density + high traffic")
    elif stats["reported_hazards"] >= 3 or (stats["pothole_count"] >= 8 and stats["reported_hazards"] >= 2):
        alert = ("WARNING", "Multiple nearby hazards")
    if alert:
        append_row(DATA_FILES["alerts"], {
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"), "lat": lat, "lng": lng,
            "city": stats["city"], "district": stats["district"], "alert_level": alert[0], "reason": alert[1]
        }, COLS)
        return {"level": alert[0], "reason": alert[1]}
    return {"level": "NORMAL", "reason": "No active critical pattern"}


def get_alerts(limit=20):
    df = load_csv_safe(DATA_FILES["alerts"], columns=COLS)
    return [] if df.empty else df.tail(limit).iloc[::-1].to_dict(orient="records")
