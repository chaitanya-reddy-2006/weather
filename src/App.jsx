import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts';
import Papa from 'papaparse';
import {
  Activity, Cloud, CloudRain, CloudSun, Download, Upload, Search, RefreshCw,
  Thermometer, Droplets, Gauge, Wind, Sun, Menu, X, LayoutDashboard,
  ChartNoAxesCombined, Database, Settings, LogIn, LogOut, MapPin,
  CheckCircle2, AlertTriangle, CalendarDays, ChevronDown, FileSpreadsheet
} from 'lucide-react';
import { supabase, supabaseReady } from './supabase';

const DB_COLUMNS = 'id,timestamp,temperature_c,humidity_percent,pressure_hpa,wind_speed_kmh,rainfall_mm,air_quality,uv_index,weather_status,created_at';
const PAGE_SIZE = 1000;

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { id: 'data', label: 'Data management', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings }
];

const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—';
const timeLabel = value => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const mapReading = row => ({
  ...row,
  recorded_at: row.timestamp,
  temperature: Number(row.temperature_c),
  humidity: Number(row.humidity_percent),
  pressure: Number(row.pressure_hpa),
  wind_speed: Number(row.wind_speed_kmh),
  rainfall: Number(row.rainfall_mm),
  air_quality: Number(row.air_quality),
  uv_index: Number(row.uv_index)
});

function weatherCode(code) {
  if (code === 0) return ['Clear sky', Sun];
  if ([1, 2, 3].includes(code)) return ['Partly cloudy', CloudSun];
  if ([45, 48].includes(code)) return ['Fog', Cloud];
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return ['Rain', CloudRain];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Snow', Cloud];
  if ([95, 96, 99].includes(code)) return ['Thunderstorm', CloudRain];
  return ['Weather conditions', Cloud];
}

function forecastFrom(rows) {
  const clean = rows.filter(r => Number.isFinite(r.temperature));
  if (clean.length < 3) return [];
  const points = clean.slice(-24);
  const n = points.length;
  const xs = points.map((_, i) => i);
  const ys = points.map(r => r.temperature);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1;
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom;
  const last = points[points.length - 1];
  return Array.from({ length: 6 }, (_, i) => ({
    time: new Date(new Date(last.recorded_at).getTime() + (i + 1) * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    temperature: +(my + slope * (n + i)).toFixed(1),
    humidity: Math.max(0, Math.min(100, Math.round(last.humidity || 0)))
  }));
}

function StatCard({ title, value, unit, note, icon: Icon, tone }) {
  return <article className="stat-card">
    <div className="stat-top"><span>{title}</span><span className={`stat-icon ${tone}`}><Icon size={19} /></span></div>
    <div className="stat-value">{value}<small>{unit}</small></div>
    <div className="stat-note">{note}</div>
  </article>;
}

export default function App() {
  const [page, setPage] = useState('overview');
  const [rows, setRows] = useState([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [dbLoading, setDbLoading] = useState(true);
  const [dbError, setDbError] = useState('');
  const [city, setCity] = useState(() => localStorage.getItem('weathercast-city') || 'Hyderabad');
  const [searchCity, setSearchCity] = useState(() => localStorage.getItem('weathercast-city') || 'Hyderabad');
  const [weather, setWeather] = useState(null);
  const [daily, setDaily] = useState([]);
  const [loadingWeather, setLoadingWeather] = useState(false);
  const [weatherError, setWeatherError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [range, setRange] = useState('24h');
  const [mobileNav, setMobileNav] = useState(false);
  const [notice, setNotice] = useState('');
  const [session, setSession] = useState(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMessage, setAuthMessage] = useState('');
  const fileRef = useRef(null);

  const loadDatabase = useCallback(async () => {
    if (!supabaseReady) {
      setDbLoading(false);
      setDbError('Supabase is not configured. Check the .env file and restart the development server.');
      return;
    }
    setDbLoading(true);
    setDbError('');
    try {
      // Count all records, but download only the latest 1,000 for a responsive dashboard.
      const countResult = await supabase.from('weather_readings').select('*', { count: 'exact', head: true });
      if (countResult.error) throw countResult.error;
      const { data, error } = await supabase
        .from('weather_readings')
        .select(DB_COLUMNS)
        .order('timestamp', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      setRows((data || []).map(mapReading).reverse());
      setTotalRecords(countResult.count ?? data?.length ?? 0);
      setLastUpdated(new Date());
    } catch (error) {
      setDbError(error.message || 'Could not load weather readings from Supabase.');
    } finally {
      setDbLoading(false);
    }
  }, []);

  useEffect(() => { loadDatabase(); }, [loadDatabase]);

  useEffect(() => {
    if (!supabaseReady) return undefined;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => setSession(currentSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => { localStorage.setItem('weathercast-city', city); }, [city]);

  const loadWeather = useCallback(async (place = city) => {
    setLoadingWeather(true);
    setWeatherError('');
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`);
      if (!geoRes.ok) throw new Error('Could not reach the location service.');
      const geo = await geoRes.json();
      if (!geo.results?.length) throw new Error(`No location found for "${place}". Try another city.`);
      const loc = geo.results[0];
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,surface_pressure&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=5&timezone=auto`;
      const response = await fetch(url);
      if (!response.ok) throw new Error('Weather service returned an error.');
      const data = await response.json();
      setWeather({ ...data.current, place: `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}`, country: loc.country });
      setDaily((data.daily?.time || []).map((date, i) => ({
        date,
        max: data.daily.temperature_2m_max[i],
        min: data.daily.temperature_2m_min[i],
        rain: data.daily.precipitation_probability_max[i],
        code: data.daily.weather_code[i]
      })));
      setCity(place);
      setSearchCity(place);
      setLastUpdated(new Date());
    } catch (error) {
      setWeatherError(error.message || 'Unable to load current weather.');
    } finally {
      setLoadingWeather(false);
    }
  }, [city]);

  useEffect(() => { loadWeather(city); }, []); // Initial current-weather request.

  const latest = rows[rows.length - 1] || {};
  const forecast = useMemo(() => forecastFrom(rows), [rows]);
  const visibleRows = useMemo(() => {
    const count = range === '6h' ? 6 : range === '12h' ? 12 : range === '7d' ? 168 : 24;
    return rows.slice(-count);
  }, [rows, range]);
  const chartRows = visibleRows.map(row => ({ ...row, time: timeLabel(row.recorded_at) }));
  const avgTemp = rows.length ? rows.reduce((sum, row) => sum + row.temperature, 0) / rows.length : 0;
  const currentTemp = weather?.temperature_2m ?? latest.temperature;
  const currentHumidity = weather?.relative_humidity_2m ?? latest.humidity;
  const currentPressure = weather?.surface_pressure ?? latest.pressure;
  const currentWind = weather?.wind_speed_10m ?? latest.wind_speed;
  const [condition, ConditionIcon] = weatherCode(weather?.weather_code ?? -1);

  async function signIn(event) {
    event.preventDefault();
    setAuthMessage('');
    if (!supabaseReady) { setAuthMessage('Supabase is not configured.'); return; }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setAuthMessage(error ? error.message : 'Signed in successfully.');
  }

  async function signOut() {
    if (supabaseReady) await supabase.auth.signOut();
    setSession(null);
  }

  async function importCsv(file) {
    if (!file) return;
    if (!session) {
      setNotice('Please sign in as an authorized administrator before importing data.');
      return;
    }
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: async ({ data, errors }) => {
        const required = ['timestamp', 'temperature_c', 'humidity_percent', 'pressure_hpa', 'wind_speed_kmh', 'rainfall_mm', 'air_quality', 'uv_index', 'weather_status'];
        const missing = required.filter(column => !Object.prototype.hasOwnProperty.call(data[0] || {}, column));
        if (missing.length) { setNotice(`CSV is missing columns: ${missing.join(', ')}`); return; }
        const payload = data.map(row => ({
          timestamp: row.timestamp,
          temperature_c: Number(row.temperature_c),
          humidity_percent: Number(row.humidity_percent),
          pressure_hpa: Number(row.pressure_hpa),
          wind_speed_kmh: Number(row.wind_speed_kmh),
          rainfall_mm: Number(row.rainfall_mm),
          air_quality: Number(row.air_quality),
          uv_index: Number(row.uv_index),
          weather_status: String(row.weather_status ?? '')
        })).filter(row => row.timestamp && Object.entries(row).every(([key, value]) => key === 'weather_status' || key === 'timestamp' || Number.isFinite(value)));
        try {
          for (let i = 0; i < payload.length; i += 500) {
            const { error } = await supabase.from('weather_readings').insert(payload.slice(i, i + 500));
            if (error) throw error;
          }
          setNotice(`Uploaded ${payload.length} records to Supabase${errors.length ? ` (${errors.length} CSV parsing warnings)` : ''}.`);
          await loadDatabase();
        } catch (error) {
          setNotice(`CSV upload failed: ${error.message}`);
        }
      },
      error: error => setNotice(`CSV parsing failed: ${error.message}`)
    });
  }

  function exportCsv() {
    const exportRows = rows.map(row => ({
      timestamp: row.timestamp,
      temperature_c: row.temperature_c,
      humidity_percent: row.humidity_percent,
      pressure_hpa: row.pressure_hpa,
      wind_speed_kmh: row.wind_speed_kmh,
      rainfall_mm: row.rainfall_mm,
      air_quality: row.air_quality,
      uv_index: row.uv_index,
      weather_status: row.weather_status
    }));
    const blob = new Blob([Papa.unparse(exportRows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'weathercast-latest-1000-readings.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><CloudSun size={24} /></div><div><b>WeatherCast</b><small>WEATHER INTELLIGENCE</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X /></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navItems.map(item => <button key={item.id} className={`nav-link ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={18} />{item.label}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="connection"><span className="pulse-dot" /><div><b>{weather ? 'Weather API connected' : 'Weather API waiting'}</b><small>{supabaseReady ? (dbError ? 'Database error' : 'Supabase configured') : 'Supabase not configured'}</small></div></div>
        <div className="profile-row"><div className="avatar">WC</div><div><b>{session?.user?.email || 'Public dashboard'}</b><small>{session ? 'Administrator' : 'Read-only access'}</small></div><button title={session ? 'Sign out' : 'Admin sign in'} onClick={() => session ? signOut() : setLoginOpen(true)}>{session ? <LogOut size={17} /> : <LogIn size={17} />}</button></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="top-left"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu /></button><div><div className="eyebrow">WEATHER MONITORING PLATFORM</div><h1>{navItems.find(item => item.id === page)?.label || 'Overview'}</h1></div></div>
        <div className="top-actions"><div className="updated"><span className="pulse-dot" /> Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><button className="icon-button" onClick={() => { loadDatabase(); loadWeather(); }} title="Refresh data" disabled={dbLoading || loadingWeather}><RefreshCw size={17} className={dbLoading || loadingWeather ? 'spin' : ''} /></button><button className="primary-button small" onClick={() => setLoginOpen(true)}><LogIn size={16} /> Admin</button></div>
      </header>

      {notice && <div className="notice"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')}><X size={16} /></button></div>}
      {dbError && <div className="error-banner"><AlertTriangle size={17} />{dbError}<button onClick={() => setDbError('')}><X size={16} /></button></div>}
      {weatherError && <div className="error-banner"><AlertTriangle size={17} />{weatherError}<button onClick={() => setWeatherError('')}><X size={16} /></button></div>}

      {page === 'overview' && <>
        <section className="welcome-row"><div><h2>Weather overview</h2><p>Current conditions and historical observations from your WeatherCast database.</p></div><div className="location-search"><MapPin size={17} /><input value={searchCity} onChange={event => setSearchCity(event.target.value)} onKeyDown={event => event.key === 'Enter' && loadWeather(searchCity)} aria-label="Search city" placeholder="Search city" /><button onClick={() => loadWeather(searchCity)} disabled={loadingWeather}><Search size={17} /></button></div></section>
        <section className="hero-weather"><div className="hero-main"><div className="hero-label"><span className="live-pill"><span /> LIVE WEATHER</span><span>{weather?.place || city}{weather?.country ? `, ${weather.country}` : ''}</span></div><div className="hero-temp">{fmt(currentTemp)}<span>°C</span></div><div className="hero-condition"><ConditionIcon size={25} /><span>{weather ? condition : 'Waiting for current weather'}</span></div><div className="hero-sub">Feels like {fmt(weather?.apparent_temperature ?? currentTemp)}°C <span>•</span> {weather?.is_day ? 'Daytime' : 'Local conditions'}</div></div><div className="hero-side"><div className="sun-orbit"><Sun size={68} strokeWidth={1.2} /></div><div><b>{weather ? 'Live conditions' : 'Weather service'}</b><span>Powered by Open-Meteo</span></div></div></section>
        <section className="stats-grid">
          <StatCard title="Temperature" value={fmt(currentTemp)} unit="°C" note={`Dataset average ${fmt(avgTemp)}°C`} icon={Thermometer} tone="orange" />
          <StatCard title="Humidity" value={fmt(currentHumidity, 0)} unit="%" note="Relative humidity" icon={Droplets} tone="blue" />
          <StatCard title="Air pressure" value={fmt(currentPressure)} unit="hPa" note="Surface pressure" icon={Gauge} tone="purple" />
          <StatCard title="Wind speed" value={fmt(currentWind)} unit="km/h" note="10 m above ground" icon={Wind} tone="green" />
        </section>
        <section className="content-grid">
          <article className="panel chart-panel"><div className="panel-heading"><div><h3>Temperature trend</h3><p>Latest observations from Supabase</p></div><select value={range} onChange={event => setRange(event.target.value)}><option value="6h">Last 6 records</option><option value="12h">Last 12 records</option><option value="24h">Last 24 records</option><option value="7d">Last 168 records</option></select></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartRows}><defs><linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.25} /><stop offset="95%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#243147" /><XAxis dataKey="time" tick={{ fill: '#91a0b7', fontSize: 11 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: '#91a0b7', fontSize: 11 }} axisLine={false} tickLine={false} width={38} /><Tooltip contentStyle={{ background: '#111c2e', border: '1px solid #2b3b55', borderRadius: 10, color: '#fff' }} /><Area type="monotone" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" strokeWidth={2.5} fill="url(#tempFill)" /></AreaChart></ResponsiveContainer></div></article>
          <article className="panel"><div className="panel-heading"><div><h3>5-day outlook</h3><p>Forecast from Open-Meteo</p></div><CalendarDays size={19} className="muted-icon" /></div><div className="daily-list">{daily.length ? daily.map(day => { const [label, Icon] = weatherCode(day.code); return <div className="daily-row" key={day.date}><span className="day-name">{new Date(day.date + 'T12:00:00').toLocaleDateString([], { weekday: 'short' })}</span><Icon size={20} className="daily-icon" /><span className="day-condition">{label}</span><span className="day-rain"><Droplets size={13} />{day.rain ?? 0}%</span><b>{fmt(day.max, 0)}° <small>{fmt(day.min, 0)}°</small></b></div>; }) : <div className="empty-state">Loading forecast…</div>}</div></article>
        </section>
        <section className="content-grid lower-grid">
          <article className="panel"><div className="panel-heading"><div><h3>Recent database readings</h3><p>Latest rows returned from Supabase</p></div><button className="text-button" onClick={() => setPage('data')}>View data <ChevronDown size={14} /></button></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Temp</th><th>Humidity</th><th>Pressure</th><th>Rain</th></tr></thead><tbody>{rows.slice(-5).reverse().map(row => <tr key={row.id}><td>{timeLabel(row.recorded_at)}</td><td>{fmt(row.temperature)}°C</td><td>{fmt(row.humidity, 0)}%</td><td>{fmt(row.pressure)} hPa</td><td>{fmt(row.rainfall)} mm</td></tr>)}</tbody></table>{!dbLoading && !rows.length && <div className="empty-state">No database readings returned.</div>}</div></article>
          <article className="panel prediction-panel"><div className="panel-heading"><div><h3>Short-term estimate</h3><p>Trend baseline · not an LSTM model</p></div><span className="model-tag">BASELINE</span></div><div className="prediction-summary"><div><span>Next estimate</span><b>{forecast.length ? fmt(forecast[0].temperature) : '—'}°C</b></div><div><span>Forecast horizon</span><b>6 hours</b></div></div><div className="prediction-list">{forecast.slice(0, 4).map(item => <div key={item.time}><span>{item.time}</span><b>{fmt(item.temperature)}°C</b><span className="humidity-mini"><Droplets size={13} />{item.humidity}%</span></div>)}</div></article>
        </section>
      </>}

      {page === 'analytics' && <section className="page-section"><div className="section-intro"><h2>Weather analytics</h2><p>Analysis of the latest {rows.length.toLocaleString()} readings loaded from your database.</p></div><div className="stats-grid"><StatCard title="Average temperature" value={fmt(avgTemp)} unit="°C" note="Latest loaded observations" icon={Thermometer} tone="orange" /><StatCard title="Total database records" value={totalRecords.toLocaleString()} unit="" note="Exact Supabase row count" icon={Database} tone="blue" /><StatCard title="Latest rainfall" value={fmt(latest.rainfall)} unit="mm" note="Most recent database reading" icon={CloudRain} tone="purple" /><StatCard title="Latest wind" value={fmt(latest.wind_speed)} unit="km/h" note="Most recent database reading" icon={Wind} tone="green" /></div>
        <div className="analytics-grid"><article className="panel"><div className="panel-heading"><div><h3>Temperature & humidity</h3><p>Latest observations</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows}><CartesianGrid strokeDasharray="3 3" stroke="#243147" /><XAxis dataKey="time" tick={{ fill: '#91a0b7', fontSize: 11 }} /><YAxis yAxisId="left" tick={{ fill: '#91a0b7' }} /><YAxis yAxisId="right" orientation="right" tick={{ fill: '#91a0b7' }} /><Tooltip /><Legend /><Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" dot={false} strokeWidth={2} /><Line yAxisId="right" type="monotone" dataKey="humidity" name="Humidity %" stroke="#38bdf8" dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div></article>
          <article className="panel"><div className="panel-heading"><div><h3>Rainfall readings</h3><p>Precipitation by record</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows}><CartesianGrid strokeDasharray="3 3" stroke="#243147" /><XAxis dataKey="time" tick={{ fill: '#91a0b7', fontSize: 11 }} /><YAxis tick={{ fill: '#91a0b7' }} /><Tooltip /><Bar dataKey="rainfall" name="Rainfall mm" fill="#38bdf8" radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></article></div>
        <article className="panel"><div className="panel-heading"><div><h3>Temperature estimates</h3><p>Linear trend baseline, not an ML forecast</p></div></div><div className="table-scroll"><table><thead><tr><th>Forecast time</th><th>Estimated temperature</th><th>Estimated humidity</th><th>Method</th></tr></thead><tbody>{forecast.map(item => <tr key={item.time}><td>{item.time}</td><td>{fmt(item.temperature)}°C</td><td>{item.humidity}%</td><td><span className="model-tag">Linear trend</span></td></tr>)}</tbody></table></div></article>
      </section>}

      {page === 'data' && <section className="page-section"><div className="section-intro"><h2>Data management</h2><p>View the latest Supabase weather records and upload new CSV data as an administrator.</p></div><div className="data-actions"><div className="panel upload-panel"><div className="upload-icon"><Upload size={23} /></div><h3>Upload weather CSV</h3><p>CSV must use the nine exact database column names: timestamp, temperature_c, humidity_percent, pressure_hpa, wind_speed_kmh, rainfall_mm, air_quality, uv_index, weather_status.</p><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={event => importCsv(event.target.files?.[0])} /><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> Choose CSV file</button><small>Administrator sign-in required. Existing records are not overwritten.</small></div><div className="panel export-panel"><div className="upload-icon green-bg"><Download size={23} /></div><h3>Export loaded readings</h3><p>Download the latest {rows.length.toLocaleString()} readings currently loaded from Supabase.</p><div className="export-count"><FileSpreadsheet size={18} /><b>{rows.length.toLocaleString()} records ready</b></div><button className="secondary-button" onClick={exportCsv} disabled={!rows.length}><Download size={16} /> Download CSV</button></div></div>
        <article className="panel table-panel"><div className="panel-heading"><div><h3>Weather readings</h3><p>{totalRecords.toLocaleString()} total database records · showing latest {rows.length.toLocaleString()}</p></div><div className="table-actions"><button className="secondary-button small" onClick={loadDatabase} disabled={dbLoading}><RefreshCw size={15} /> Refresh</button></div></div><div className="table-scroll"><table><thead><tr><th>Date & time</th><th>Temperature</th><th>Humidity</th><th>Pressure</th><th>Rainfall</th><th>Wind speed</th><th>Status</th></tr></thead><tbody>{rows.slice().reverse().map(row => <tr key={row.id}><td>{timeLabel(row.recorded_at)}</td><td>{fmt(row.temperature)} °C</td><td>{fmt(row.humidity, 0)} %</td><td>{fmt(row.pressure)} hPa</td><td>{fmt(row.rainfall)} mm</td><td>{fmt(row.wind_speed)} km/h</td><td>{row.weather_status || '—'}</td></tr>)}</tbody></table>{dbLoading && <div className="empty-state">Loading database records…</div>}{!dbLoading && !rows.length && <div className="empty-state">No records available. Check the database connection and SELECT policy.</div>}</div></article>
      </section>}

      {page === 'settings' && <section className="page-section"><div className="section-intro"><h2>Settings</h2><p>Configure your WeatherCast workspace and connected services.</p></div><article className="panel settings-card"><div className="setting-row"><div className="setting-symbol"><Cloud size={20} /></div><div className="setting-copy"><b>Weather data provider</b><span>Open-Meteo public API · no API key required</span></div><span className="status-label"><span className="pulse-dot" />{weather ? 'Connected' : 'Waiting'}</span></div><div className="setting-row"><div className="setting-symbol"><Database size={20} /></div><div className="setting-copy"><b>Supabase database</b><span>{supabaseReady ? `Connected configuration · ${totalRecords.toLocaleString()} rows counted` : 'Add Supabase credentials to .env'}</span></div><span className={`status-label ${dbError ? 'neutral' : ''}`}>{dbLoading ? 'Loading' : dbError ? 'Check connection' : 'Configured'}</span></div><div className="setting-row"><div className="setting-symbol"><Activity size={20} /></div><div className="setting-copy"><b>Prediction engine</b><span>Current estimates use a simple linear trend. A trained LSTM has not been connected yet.</span></div><span className="status-label neutral">Baseline</span></div><div className="setting-row"><div className="setting-symbol"><MapPin size={20} /></div><div className="setting-copy"><b>Default location</b><span>Search a city for current weather conditions.</span></div><div className="setting-location"><input value={searchCity} onChange={event => setSearchCity(event.target.value)} /><button className="secondary-button small" onClick={() => loadWeather(searchCity)}>Save</button></div></div></article><article className="panel setup-panel"><h3>Database security</h3><p>The public dashboard uses the Supabase publishable key and reads data through Row Level Security. Administrator-only writes require an authenticated user whose ID is present in the admin_users table.</p><div className="warning-note"><AlertTriangle size={17} /> Never put a Supabase service-role or secret key in frontend code or a VITE_ environment variable.</div></article></section>}

      <footer className="footer"><span>© 2026 WeatherCast · Weather intelligence dashboard</span><span><span className="pulse-dot" /> {totalRecords.toLocaleString()} database records</span></footer>
    </main>

    {loginOpen && <div className="modal-backdrop" onClick={() => setLoginOpen(false)}><div className="login-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setLoginOpen(false)}><X size={18} /></button><div className="modal-logo"><CloudSun size={25} /></div><h2>Administrator sign in</h2><p>Sign in with your Supabase Auth account.</p><form onSubmit={signIn}><label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="admin@example.com" /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Your password" /></label><button className="primary-button full" type="submit">Sign in</button></form>{authMessage && <div className="auth-message">{authMessage}</div>}</div></div>}
  </div>;
}
