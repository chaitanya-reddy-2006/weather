# WeatherCast

React + Vite weather monitoring dashboard connected to Supabase.

## Included features

- Overview dashboard with current weather and database readings
- Analytics for both `weather_readings` and `raspberry_pi_readings`
- Admin-only analytics and CSV import, backed by Supabase Auth and RLS
- Ten-day forecast from the selected table and selected start date
- Separate statistical model for each of seven parameters: temperature, humidity, pressure, wind speed, rainfall, air quality and UV index
- Recent trend and weekday pattern when at least 14 daily observations are available
- Rolling holdout MAE, RMSE and R² reporting
- Confidence stays low until every parameter has at least five holdout tests and beats its own persistence baseline
- English, Telugu, Hindi, Tamil, Kannada and Malayalam navigation labels
- User Policy and Terms & Conditions

The ten-day forecast is an experimental statistical estimate, not a trained LSTM or a guarantee of future weather. A single historical day produces a low-confidence baseline. Weekday effects are only estimated when sufficient daily history exists; this is not an annual seasonal model.

## Run locally (Windows PowerShell)

Use Node.js 20 LTS (18.18+ minimum).

```powershell
npm install
Copy-Item .env.example .env
```

Edit `.env` and set the Supabase project URL and **publishable/anon key**. Never put a service-role or secret key in a frontend `.env` file.

Then run:

```powershell
npm run dev
```

To create a production build:

```powershell
npm run build
```

## Supabase

1. Confirm `public.weather_readings` uses the columns in `supabase/schema.sql`.
2. Run `supabase/schema.sql` only if you need the base WeatherCast table and admin allowlist policies. It uses `CREATE TABLE IF NOT EXISTS` and does not replace existing data.
3. Add the Auth user's UUID to `public.admin_users`:

```sql
insert into public.admin_users (user_id)
values ('YOUR-AUTH-USER-UUID');
```

4. Confirm the Raspberry Pi table `public.raspberry_pi_readings` already exists with its project columns.
5. Run `supabase/analytics_access.sql` to allow authenticated admins to read the Pi table. Its RLS policy checks `public.admin_users`; do not create a public/anon read policy for Pi telemetry.

The frontend reads these existing table names:
- `weather_readings`: `timestamp`, `temperature_c`, `humidity_percent`, `pressure_hpa`, `wind_speed_kmh`, `rainfall_mm`, `air_quality`, `uv_index`, `weather_status`
- `raspberry_pi_readings`: `timestamp`, `temperature`, `humidity`, `pressure`, `air_quality`, `wind_speed`, `rain_raw`, `rain_state`, `precipitation`, `uv_index`, `weather_status`

## CSV upload

CSV upload is available to verified administrators. It expects these exact headers:

```csv
timestamp,temperature_c,humidity_percent,pressure_hpa,wind_speed_kmh,rainfall_mm,air_quality,uv_index,weather_status
```

## Security and packaging

- Keep `.env` local and out of Git.
- Use only the Supabase publishable/anon key in the browser.
- Database RLS is the security boundary; hiding admin controls in React is not sufficient.
- `node_modules`, `dist`, `.git` and `.env` are intentionally excluded from the clean project ZIP.
