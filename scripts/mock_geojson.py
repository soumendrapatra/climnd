import json

geojson = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": "Coastal Odisha", "region": "coastal"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[85.0, 19.5], [87.0, 19.5], [87.5, 21.0], [86.0, 21.0], [85.0, 19.5]]]
            }
        },
        {
            "type": "Feature",
            "properties": {"name": "Western Odisha", "region": "western"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[82.5, 19.5], [85.0, 19.5], [86.0, 21.0], [84.0, 22.0], [82.5, 21.0], [82.5, 19.5]]]
            }
        },
        {
            "type": "Feature",
            "properties": {"name": "Northern Odisha", "region": "northern"},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[84.0, 22.0], [86.0, 21.0], [87.5, 21.0], [87.0, 22.5], [85.0, 22.5], [84.0, 22.0]]]
            }
        }
    ]
}

with open("data/odisha_districts.geojson", "w") as f:
    json.dump(geojson, f)

print("Mock GeoJSON created at data/odisha_districts.geojson")
