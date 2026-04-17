import random
from datetime import datetime

import pandas as pd

from config import CITIES, DATA_FILES
from utils.io_utils import load_csv_safe
from utils.geo_utils import district_for_city


def _clamp(v, low, high):
    return max(low, min(high, v))


def simulate_live_updates():
    """
    Local synthetic real-time updater.
    It gently perturbs traffic/accident/pothole signals and occasionally adds a hazard.
    """
    accidents = load_csv_safe(DATA_FILES["accidents"])
    potholes = load_csv_safe(DATA_FILES["potholes"])
    intersections = load_csv_safe(DATA_FILES["intersections"])
    hazards = load_csv_safe(
        DATA_FILES["hazards"],
        columns=["id", "hazard_type", "city", "district", "latitude", "longitude", "description", "timestamp"],
    )

    changed_acc = 0
    changed_int = 0
    changed_pot = 0

    if not intersections.empty:
        sample_idx = intersections.sample(min(4, len(intersections))).index
        for idx in sample_idx:
            td = int(intersections.at[idx, "traffic_density"])
            intersections.at[idx, "traffic_density"] = _clamp(td + random.randint(-5, 8), 25, 98)
            changed_int += 1
        intersections.to_csv(DATA_FILES["intersections"], index=False)

    if not accidents.empty:
        sample_idx = accidents.sample(min(4, len(accidents))).index
        for idx in sample_idx:
            cnt = int(accidents.at[idx, "accident_count"])
            accidents.at[idx, "accident_count"] = _clamp(cnt + random.randint(-1, 2), 1, 25)
            changed_acc += 1
        accidents.to_csv(DATA_FILES["accidents"], index=False)

    if not potholes.empty:
        sample_idx = potholes.sample(min(3, len(potholes))).index
        for idx in sample_idx:
            cnt = int(potholes.at[idx, "pothole_count"])
            potholes.at[idx, "pothole_count"] = _clamp(cnt + random.randint(-1, 2), 1, 16)
            changed_pot += 1
        potholes.to_csv(DATA_FILES["potholes"], index=False)

    added_hazard = False
    if random.random() < 0.28:  # occasional live community hazard
        city_name = random.choice(list(CITIES.keys()))
        base_lat, base_lng = CITIES[city_name]
        lat = round(base_lat + random.uniform(-0.01, 0.01), 6)
        lng = round(base_lng + random.uniform(-0.01, 0.01), 6)
        hazard_type = random.choice(["waterlogging", "roadblock", "accident", "pothole"])

        next_id = 1 if hazards.empty else int(hazards["id"].max()) + 1
        row = pd.DataFrame(
            [
                {
                    "id": next_id,
                    "hazard_type": hazard_type,
                    "city": city_name.title(),
                    "district": district_for_city(city_name.title()),
                    "latitude": lat,
                    "longitude": lng,
                    "description": f"Auto synthetic live update: {hazard_type}",
                    "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
            ]
        )
        hazards = pd.concat([hazards, row], ignore_index=True)
        hazards.to_csv(DATA_FILES["hazards"], index=False)
        added_hazard = True

    return {
        "changed_accidents": changed_acc,
        "changed_intersections": changed_int,
        "changed_potholes": changed_pot,
        "added_hazard": added_hazard,
    }

