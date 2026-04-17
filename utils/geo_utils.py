import math
from config import CITIES, CITY_TO_DISTRICT


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return r * (2 * math.atan2(math.sqrt(a), math.sqrt(1 - a)))


def nearest_city(lat, lng):
    name = min(CITIES.keys(), key=lambda c: haversine_km(lat, lng, CITIES[c][0], CITIES[c][1]))
    return name.title()


def district_for_city(city):
    return CITY_TO_DISTRICT.get(city, city)


def resolve_location(query):
    q = (query or "").strip().lower()
    if not q:
        return None
    if q in CITIES:
        return {"name": q.title(), "coords": CITIES[q], "matches": [q.title()]}

    starts = [name for name in CITIES.keys() if name.startswith(q)]
    contains = [name for name in CITIES.keys() if q in name and name not in starts]
    matches = starts + contains
    if not matches:
        return None
    best = matches[0]
    return {"name": best.title(), "coords": CITIES[best], "matches": [m.title() for m in matches[:7]]}
