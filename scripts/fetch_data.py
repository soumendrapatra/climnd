import os
import time
import sys
import requests
import pandas as pd

# Set output encoding to UTF-8
try:
    sys.stdout.reconfigure(encoding='utf-8')
except AttributeError:
    pass

# Lat/Lon for center of Odisha
LATITUDE = 20.8
LONGITUDE = 85.8
START_YEAR = 1994
END_YEAR = 2025

os.makedirs("data", exist_ok=True)

def fetch_chunk(start_date, end_date):
    """Fetch a chunk of daily weather data from Open-Meteo Archive API."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,relative_humidity_2m_mean",
        "timezone": "Asia/Kolkata"
    }
    
    max_retries = 5
    backoff = 2
    for attempt in range(max_retries):
        try:
            print(f"  Requesting daily data from {start_date} to {end_date}...")
            response = requests.get(url, params=params, timeout=45)
            if response.status_code == 200:
                return response.json()
            elif response.status_code == 429:
                print(f"  [429 Rate Limit] Attempt {attempt+1}/{max_retries}. Backing off for {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
            else:
                print(f"  [HTTP Error {response.status_code}] Attempt {attempt+1}/{max_retries}. Retrying in {backoff}s...")
                time.sleep(backoff)
                backoff *= 2
        except Exception as e:
            print(f"  [Connection/Timeout Error {e}] Attempt {attempt+1}/{max_retries}. Retrying in {backoff}s...")
            time.sleep(backoff)
            backoff *= 2
            
    raise RuntimeError(f"Failed to fetch data for range {start_date} to {end_date} after {max_retries} attempts.")

def process_chunk(data_json):
    """Process JSON response and return a DataFrame."""
    daily_data = data_json["daily"]
    df_daily = pd.DataFrame({
        "date": pd.to_datetime(daily_data["time"]),
        "temp_max": daily_data["temperature_2m_max"],
        "temp_min": daily_data["temperature_2m_min"],
        "precip_sum": daily_data["precipitation_sum"],
        "wind_speed_max": daily_data["wind_speed_10m_max"],
        "humidity": daily_data["relative_humidity_2m_mean"]
    })
    return df_daily

def main():
    print(f"Starting Optimized Historical Baseline Data Fetch for Odisha ({LATITUDE}N, {LONGITUDE}E)")
    print(f"Date Range: {START_YEAR}-01-01 to {END_YEAR}-12-31")
    
    all_chunks = []
    
    # Process in 8-year chunks (which is fast and light since it's daily data)
    for year in range(START_YEAR, END_YEAR + 1, 8):
        chunk_start = f"{year}-01-01"
        chunk_end = f"{min(year + 7, END_YEAR)}-12-31"
        
        try:
            raw_json = fetch_chunk(chunk_start, chunk_end)
            df_chunk = process_chunk(raw_json)
            all_chunks.append(df_chunk)
            print(f"  [OK] Successfully fetched and processed chunk {chunk_start} to {chunk_end} ({len(df_chunk)} days)")
            time.sleep(1.0)
        except Exception as e:
            print(f"[ERROR] Failed fetching chunk {chunk_start} to {chunk_end}: {e}")
            return
            
    if all_chunks:
        df_final = pd.concat(all_chunks, ignore_index=True)
        df_final = df_final.sort_values("date")
        
        output_path = os.path.join("data", "odisha_historical_30yr.csv")
        df_final.to_csv(output_path, index=False)
        print(f"\n[FINISHED] Baseline data construction completed!")
        print(f"Total days retrieved: {len(df_final)}")
        print(f"Dataset stored at: {output_path}")
        print(df_final.head())
        print(df_final.tail())
    else:
        print("[ERROR] No data chunks were collected.")

if __name__ == "__main__":
    main()
