# WeatherCast Complete

A fresh React + Vite weather monitoring dashboard. Designed to run immediately in local demo mode without Supabase credentials.

## Features

- Responsive weather dashboard and live city search using Open-Meteo (no API key)
- Current temperature, humidity, pressure, wind and weather condition
- Five-day forecast
- Historical sensor readings and interactive Recharts visualizations
- CSV import (Papa Parse) and CSV export
- Browser-local persistence for imported readings
- Add sample sensor reading for testing
- Trend-based six-hour baseline prediction
- Optional Supabase Auth client setup and database schema
- Desktop and mobile layouts

> Prediction note: the included prediction is a linear-regression baseline, not a trained LSTM. For an actual LSTM, train/export a model and connect a server-side inference API. Do not present this baseline as LSTM output.

## Requirements

- Node.js LTS (18.18+ recommended; Node 20 LTS recommended)
- npm
- Internet connection for live weather API and initial package install

## Run on Windows 10/11

1. Extract `WeatherCast_Complete.zip`.
2. Open the extracted **WeatherCast_Complete** folder in Cursor.
3. Open Terminal → New Terminal.
4. Run:

```powershell
node -v
npm -v
npm install
npm run dev
```

5. Open the localhost URL Vite prints (usually `http://localhost:5173`).

Keep the terminal open while using the site. Stop with `Ctrl + C`.

## If dependencies get corrupted

In PowerShell, from the project root:

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm cache verify
npm install
npm run dev
```

To verify production compilation:

```powershell
npm run build
```

## Live weather

The dashboard uses Open-Meteo geocoding and forecast APIs. Search for a city in the dashboard. The public API does not require an API key. If live weather is unavailable, the local sample dataset remains available.

## CSV format

Required headers: `temperature`, `humidity`

Optional headers: `recorded_at` (or `timestamp`, `datetime`, `date`), `pressure`, `rainfall` (or `precipitation`), `wind_speed`.

Example:

```csv
recorded_at,temperature,humidity,pressure,rainfall,wind_speed
2026-11-17T06:00:00Z,23.4,78,1008.2,0,2.1
2026-11-17T09:00:00Z,27.1,68,1008.8,0,3.0
```

Imported rows are stored in the browser's localStorage on that device/browser. Export regularly if you need a backup.

## Optional Supabase setup

1. Create a free Supabase project.
2. Copy the Project URL and publishable/anon key.
3. Copy `.env.example` to `.env`.
4. Fill in:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_OR_PUBLISHABLE_KEY
```

5. In Supabase SQL Editor, run `supabase/schema.sql`.
6. Create an administrator account in Supabase Authentication → Users.
7. Add that account's UUID to `public.admin_users`:

```sql
insert into public.admin_users (user_id)
values ('YOUR-AUTH-USER-UUID');
```

8. Restart the dev server.

Never use a Supabase service-role or secret key in the frontend. The current app enables Supabase email/password sign-in; CSV rows are currently stored locally in the browser. Database persistence/upload is a separate integration step.

## Notes / limitations

- Sensor readings in the demo are sample values, not physical IoT device telemetry.
- “Add demo sensor reading” generates a synthetic sample record for UI testing.
- Real IoT hardware needs a secured server-side ingestion endpoint or Supabase Edge Function.
- The dashboard's six-hour prediction is a simple linear trend baseline. A real LSTM requires a separately trained model and inference service.
