from config import DATA_FILES
from utils.io_utils import load_csv_safe
from utils.geo_utils import haversine_km


def _nearest(lat, lng, df):
    if df.empty:
        return {"name": "N/A", "distance_km": None, "eta_minutes": None}
    best = min(df.itertuples(), key=lambda r: haversine_km(lat, lng, float(r.latitude), float(r.longitude)))
    dist = haversine_km(lat, lng, float(best.latitude), float(best.longitude))
    return {"name": best.name, "distance_km": round(dist, 2), "eta_minutes": round((dist/35)*60+3)}


def nearest_emergency(lat, lng):
    return {
        "hospital": _nearest(lat, lng, load_csv_safe(DATA_FILES["hospitals"])),
        "police_station": _nearest(lat, lng, load_csv_safe(DATA_FILES["police_stations"]))
    }
