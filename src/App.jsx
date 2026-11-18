import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from 'recharts'
import Papa from 'papaparse'
import {
  Activity, Cloud, CloudRain, CloudSun, Download, Upload, Search, RefreshCw,
  Thermometer, Droplets, Gauge, Wind, Sun, Menu, X, LayoutDashboard,
  ChartNoAxesCombined, Database, Settings, LogIn, LogOut, MapPin, Clock3,
  CheckCircle2, AlertTriangle, Radio, CalendarDays, ChevronDown, FileSpreadsheet
} from 'lucide-react'
import { supabase, supabaseReady } from './supabase'

const initialRows = Array.from({ length: 24 }, (_, i) => {
  const d = new Date(Date.now() - (23 - i) * 3600_000)
  const hour = d.getHours()
  return {
    recorded_at: d.toISOString(),
    temperature: +(23 + Math.sin((hour - 7) / 24 * Math.PI * 2) * 5 + (i % 4) * .25).toFixed(1),
    humidity: Math.round(68 - Math.sin((hour - 7) / 24 * Math.PI * 2) * 16),
    pressure: +(1011 + Math.cos(i / 7) * 2).toFixed(1),
    rainfall: i % 9 === 0 ? 0.4 : 0,
    wind_speed: +(2.4 + Math.abs(Math.sin(i)) * 2.3).toFixed(1)
  }
})

const navItems = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'analytics', label: 'Analytics', icon: ChartNoAxesCombined },
  { id: 'data', label: 'Data management', icon: Database },
  { id: 'settings', label: 'Settings', icon: Settings }
]

const fmt = (v, digits = 1) => Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—'
const timeLabel = (value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
const weatherCode = (code) => {
  if ([0].includes(code)) return ['Clear sky', Sun]
  if ([1, 2, 3].includes(code)) return ['Partly cloudy', CloudSun]
  if ([45, 48].includes(code)) return ['Fog', Cloud]
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return ['Rain', CloudRain]
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['Snow', Cloud]
  if ([95, 96, 99].includes(code)) return ['Thunderstorm', CloudRain]
  return ['Weather conditions', Cloud]
}

function forecastFrom(rows) {
  const clean = rows.filter(r => Number.isFinite(Number(r.temperature)))
  if (clean.length < 3) return []
  const points = clean.slice(-24)
  const n = points.length
  const xs = points.map((_, i) => i)
  const ys = points.map(r => Number(r.temperature))
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0) || 1
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom
  const last = points[points.length - 1]
  return Array.from({ length: 6 }, (_, i) => {
    const date = new Date(new Date(last.recorded_at).getTime() + (i + 1) * 3_600_000)
    return { time: timeLabel(date), temperature: +(my + slope * (n - 1 + i + 1)).toFixed(1), humidity: Math.max(20, Math.min(100, Math.round(Number(last.humidity || 60) - slope * (i + 1) * 1.5))) }
  })
}

function StatCard({ title, value, unit, note, icon: Icon, tone }) {
  return <article className="stat-card">
    <div className="stat-top"><span>{title}</span><span className={`stat-icon ${tone}`}><Icon size={19}/></span></div>
    <div className="stat-value">{value}<small>{unit}</small></div>
    <div className="stat-note">{note}</div>
  </article>
}

function App() {
  const [page, setPage] = useState('overview')
  const [rows, setRows] = useState(() => {
    try { return JSON.parse(localStorage.getItem('weathercast-rows')) || initialRows } catch { return initialRows }
  })
  const [city, setCity] = useState(localStorage.getItem('weathercast-city') || 'Hyderabad')
  const [searchCity, setSearchCity] = useState(city)
  const [weather, setWeather] = useState(null)
  const [daily, setDaily] = useState([])
  const [loadingWeather, setLoadingWeather] = useState(false)
  const [weatherError, setWeatherError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const [range, setRange] = useState('24h')
  const [mobileNav, setMobileNav] = useState(false)
  const [notice, setNotice] = useState('')
  const [session, setSession] = useState(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { localStorage.setItem('weathercast-rows', JSON.stringify(rows)) }, [rows])
  useEffect(() => { localStorage.setItem('weathercast-city', city) }, [city])

  useEffect(() => {
    if (!supabaseReady) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => listener.subscription.unsubscribe()
  }, [])

  async function loadWeather(place = city) {
    setLoadingWeather(true); setWeatherError('')
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`)
      if (!geoRes.ok) throw new Error('Could not reach the location service.')
      const geo = await geoRes.json()
      if (!geo.results?.length) throw new Error(`No location found for "${place}". Try another city.`)
      const loc = geo.results[0]
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,surface_pressure&hourly=temperature_2m,relative_humidity_2m,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&forecast_days=5&timezone=auto`
      const res = await fetch(url)
      if (!res.ok) throw new Error('Weather service returned an error.')
      const data = await res.json()
      setWeather({ ...data.current, place: `${loc.name}${loc.admin1 ? ', ' + loc.admin1 : ''}`, country: loc.country, timezone: data.timezone })
      setDaily((data.daily?.time || []).map((date, i) => ({
        date, max: data.daily.temperature_2m_max[i], min: data.daily.temperature_2m_min[i],
        rain: data.daily.precipitation_probability_max[i], code: data.daily.weather_code[i]
      })))
      setCity(place); setSearchCity(place); setLastUpdated(new Date())
    } catch (e) { setWeatherError(e.message || 'Unable to load weather data.') }
    finally { setLoadingWeather(false) }
  }

  useEffect(() => { loadWeather(city) }, []) // initial live weather fetch

  const latest = rows[rows.length - 1] || {}
  const forecast = useMemo(() => forecastFrom(rows), [rows])
  const visibleRows = useMemo(() => {
    const count = range === '6h' ? 6 : range === '12h' ? 12 : range === '7d' ? 168 : 24
    return rows.slice(-count)
  }, [rows, range])
  const chartRows = visibleRows.map(r => ({ ...r, time: timeLabel(r.recorded_at) }))
  const avgTemp = rows.length ? rows.reduce((a, r) => a + Number(r.temperature || 0), 0) / rows.length : 0
  const currentTemp = weather?.temperature_2m ?? latest.temperature
  const currentHumidity = weather?.relative_humidity_2m ?? latest.humidity
  const currentPressure = weather?.surface_pressure ?? latest.pressure
  const currentWind = weather?.wind_speed_10m ?? latest.wind_speed
  const [condition, ConditionIcon] = weatherCode(weather?.weather_code ?? 2)

  function importCsv(file) {
    if (!file) return
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: true,
      complete: ({ data, errors, meta }) => {
        const normalized = data.map(r => ({
          recorded_at: r.recorded_at || r.timestamp || r.datetime || r.date || new Date().toISOString(),
          temperature: Number(r.temperature ?? r.temp),
          humidity: Number(r.humidity),
          pressure: Number(r.pressure ?? r.surface_pressure ?? 1013),
          rainfall: Number(r.rainfall ?? r.precipitation ?? 0),
          wind_speed: Number(r.wind_speed ?? r.wind ?? 0)
        })).filter(r => Number.isFinite(r.temperature) && Number.isFinite(r.humidity))
        if (!normalized.length) { setNotice('No valid rows found. CSV needs temperature and humidity columns.'); return }
        setRows(prev => [...prev, ...normalized].sort((a, b) => new Date(a.recorded_at) - new Date(b.recorded_at)))
        setNotice(`Imported ${normalized.length} readings${errors.length ? ` (${errors.length} parsing warnings)` : ''}.`)
        setPage('data')
      }, error: e => setNotice(`CSV import failed: ${e.message}`)
    })
  }

  function exportCsv() {
    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob); const a = document.createElement('a')
    a.href = url; a.download = 'weathercast-readings.csv'; a.click(); URL.revokeObjectURL(url)
  }

  async function signIn(e) {
    e.preventDefault(); setAuthMessage('')
    if (!supabaseReady) { setAuthMessage('Supabase is not configured. Demo mode is active; configure .env to enable admin sign-in.'); return }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setAuthMessage(error ? error.message : 'Signed in successfully.')
  }
  async function signOut() { if (supabaseReady) await supabase.auth.signOut(); setSession(null) }

  function addDemoReading() {
    const prev = rows[rows.length - 1] || { temperature: 24, humidity: 60, pressure: 1012, rainfall: 0, wind_speed: 2 }
    const next = {
      recorded_at: new Date().toISOString(),
      temperature: +(Number(prev.temperature) + (Math.random() - .48) * 1.8).toFixed(1),
      humidity: Math.max(20, Math.min(100, Math.round(Number(prev.humidity) + (Math.random() - .5) * 8))),
      pressure: +(Number(prev.pressure || 1012) + (Math.random() - .5) * 1.2).toFixed(1),
      rainfall: Math.random() > .8 ? +(Math.random() * 1.5).toFixed(1) : 0,
      wind_speed: +(Math.random() * 5).toFixed(1)
    }
    setRows(prevRows => [...prevRows, next]); setNotice('A demo sensor reading was added.')
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><CloudSun size={24}/></div><div><b>WeatherCast</b><small>WEATHER INTELLIGENCE</small></div><button className="mobile-close" onClick={() => setMobileNav(false)}><X/></button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav>{navItems.map(item => <button key={item.id} className={`nav-link ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false) }}><item.icon size={18}/>{item.label}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="connection"><span className="pulse-dot"/><div><b>{weather ? 'Weather API connected' : 'Demo data available'}</b><small>{supabaseReady ? 'Supabase configured' : 'Local storage mode'}</small></div></div>
        <div className="profile-row"><div className="avatar">WC</div><div><b>{session?.user?.email || 'Local workspace'}</b><small>{session ? 'Administrator' : 'Demo access'}</small></div><button title={session ? 'Sign out' : 'Admin sign in'} onClick={() => session ? signOut() : setLoginOpen(true)}>{session ? <LogOut size={17}/> : <LogIn size={17}/>}</button></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="top-left"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu/></button><div><div className="eyebrow">WEATHER MONITORING PLATFORM</div><h1>{navItems.find(n => n.id === page)?.label || 'Overview'}</h1></div></div>
        <div className="top-actions"><div className="updated"><span className="pulse-dot"/> Updated {lastUpdated.toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div><button className="icon-button" onClick={() => loadWeather()} title="Refresh weather" disabled={loadingWeather}><RefreshCw size={17} className={loadingWeather ? 'spin' : ''}/></button><button className="primary-button small" onClick={() => setLoginOpen(true)}><LogIn size={16}/> Admin</button></div>
      </header>

      {notice && <div className="notice"><CheckCircle2 size={17}/>{notice}<button onClick={() => setNotice('')}><X size={16}/></button></div>}
      {weatherError && <div className="error-banner"><AlertTriangle size={17}/>{weatherError}<button onClick={() => setWeatherError('')}><X size={16}/></button></div>}

      {page === 'overview' && <>
        <section className="welcome-row"><div><h2>Weather overview</h2><p>Monitor current conditions and understand what is happening around your location.</p></div><div className="location-search"><MapPin size={17}/><input value={searchCity} onChange={e => setSearchCity(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadWeather(searchCity)} aria-label="Search city" placeholder="Search city"/><button onClick={() => loadWeather(searchCity)} disabled={loadingWeather}><Search size={17}/></button></div></section>
        <section className="hero-weather">
          <div className="hero-main"><div className="hero-label"><span className="live-pill"><span/> LIVE WEATHER</span><span>{weather?.place || city}{weather?.country ? `, ${weather.country}` : ''}</span></div><div className="hero-temp">{fmt(currentTemp, 1)}<span>°C</span></div><div className="hero-condition"><ConditionIcon size={25}/><span>{weather ? condition : 'Sample weather conditions'}</span></div><div className="hero-sub">Feels like {fmt(weather?.apparent_temperature ?? currentTemp, 1)}°C <span>•</span> {weather?.is_day ? 'Daytime' : 'Local conditions'}</div></div>
          <div className="hero-side"><div className="sun-orbit"><Sun size={68} strokeWidth={1.2}/></div><div><b>{weather ? 'Live conditions' : 'Demo mode'}</b><span>{weather ? 'Powered by Open-Meteo' : 'Live data loads when connected'}</span></div></div>
        </section>
        <section className="stats-grid">
          <StatCard title="Temperature" value={fmt(currentTemp)} unit="°C" note={`Dataset average ${fmt(avgTemp)}°C`} icon={Thermometer} tone="orange"/>
          <StatCard title="Humidity" value={fmt(currentHumidity, 0)} unit="%" note="Relative humidity" icon={Droplets} tone="blue"/>
          <StatCard title="Air pressure" value={fmt(currentPressure, 1)} unit="hPa" note="Surface pressure" icon={Gauge} tone="purple"/>
          <StatCard title="Wind speed" value={fmt(currentWind)} unit="km/h" note="10 m above ground" icon={Wind} tone="green"/>
        </section>
        <section className="content-grid">
          <article className="panel chart-panel"><div className="panel-heading"><div><h3>Temperature trend</h3><p>Historical readings from your dataset</p></div><select value={range} onChange={e => setRange(e.target.value)}><option value="6h">Last 6 hours</option><option value="12h">Last 12 hours</option><option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></select></div>
            <div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartRows}><defs><linearGradient id="tempFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={.25}/><stop offset="95%" stopColor="#f59e0b" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" tick={{fill:'#91a0b7',fontSize:11}} axisLine={false} tickLine={false}/><YAxis tick={{fill:'#91a0b7',fontSize:11}} axisLine={false} tickLine={false} width={38}/><Tooltip contentStyle={{background:'#111c2e',border:'1px solid #2b3b55',borderRadius:10,color:'#fff'}}/><Area type="monotone" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" strokeWidth={2.5} fill="url(#tempFill)" activeDot={{r:5}}/></AreaChart></ResponsiveContainer></div>
          </article>
          <article className="panel"><div className="panel-heading"><div><h3>5-day outlook</h3><p>Forecast from Open-Meteo</p></div><CalendarDays size={19} className="muted-icon"/></div><div className="daily-list">{daily.length ? daily.map(d => { const [label, Icon] = weatherCode(d.code); return <div className="daily-row" key={d.date}><span className="day-name">{new Date(d.date+'T12:00:00').toLocaleDateString([], {weekday:'short'})}</span><Icon size={20} className="daily-icon"/><span className="day-condition">{label}</span><span className="day-rain"><Droplets size={13}/>{d.rain ?? 0}%</span><b>{fmt(d.max,0)}° <small>{fmt(d.min,0)}°</small></b></div> }) : <div className="empty-state">Loading forecast…</div>}</div></article>
        </section>
        <section className="content-grid lower-grid">
          <article className="panel"><div className="panel-heading"><div><h3>Recent sensor readings</h3><p>Latest records stored in this browser</p></div><button className="text-button" onClick={() => setPage('data')}>View all <ChevronDown size={14}/></button></div><div className="table-scroll"><table><thead><tr><th>Time</th><th>Temp</th><th>Humidity</th><th>Pressure</th><th>Rain</th></tr></thead><tbody>{rows.slice(-5).reverse().map((r,i)=><tr key={`${r.recorded_at}-${i}`}><td>{new Date(r.recorded_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</td><td>{fmt(r.temperature)}°C</td><td>{fmt(r.humidity,0)}%</td><td>{fmt(r.pressure)} hPa</td><td>{fmt(r.rainfall)} mm</td></tr>)}</tbody></table></div></article>
          <article className="panel prediction-panel"><div className="panel-heading"><div><h3>Short-term prediction</h3><p>Trend-based baseline · not an LSTM model</p></div><span className="model-tag">BASELINE</span></div><div className="prediction-summary"><div><span>Next estimate</span><b>{forecast.length ? fmt(forecast[0].temperature) : '—'}°C</b></div><div><span>Forecast horizon</span><b>6 hours</b></div></div><div className="prediction-list">{forecast.slice(0,4).map(f=><div key={f.time}><span>{f.time}</span><b>{fmt(f.temperature)}°C</b><span className="humidity-mini"><Droplets size={13}/>{f.humidity}%</span></div>)}</div></article>
        </section>
      </>}

      {page === 'analytics' && <section className="page-section"><div className="section-intro"><h2>Weather analytics</h2><p>Explore trends and relationships across the available sensor dataset.</p></div><div className="stats-grid"><StatCard title="Average temperature" value={fmt(avgTemp)} unit="°C" note="All imported readings" icon={Thermometer} tone="orange"/><StatCard title="Records available" value={rows.length} unit="" note="Stored locally in this browser" icon={Database} tone="blue"/><StatCard title="Latest rainfall" value={fmt(latest.rainfall)} unit="mm" note="Most recent sensor reading" icon={CloudRain} tone="purple"/><StatCard title="Latest wind" value={fmt(latest.wind_speed)} unit="km/h" note="Most recent sensor reading" icon={Wind} tone="green"/></div>
        <div className="analytics-grid"><article className="panel"><div className="panel-heading"><div><h3>Temperature & humidity</h3><p>Compare two weather indicators</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={chartRows}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" tick={{fill:'#91a0b7',fontSize:11}}/><YAxis yAxisId="left" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="right" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip contentStyle={{background:'#111c2e',border:'1px solid #2b3b55',borderRadius:10}}/><Legend/><Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" dot={false} strokeWidth={2}/><Line yAxisId="right" type="monotone" dataKey="humidity" name="Humidity %" stroke="#38bdf8" dot={false} strokeWidth={2}/></LineChart></ResponsiveContainer></div></article>
        <article className="panel"><div className="panel-heading"><div><h3>Rainfall readings</h3><p>Precipitation by record</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartRows}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" tick={{fill:'#91a0b7',fontSize:11}}/><YAxis tick={{fill:'#91a0b7'}}/><Tooltip contentStyle={{background:'#111c2e',border:'1px solid #2b3b55',borderRadius:10}}/><Bar dataKey="rainfall" name="Rainfall mm" fill="#38bdf8" radius={[5,5,0,0]}/></BarChart></ResponsiveContainer></div></article></div>
        <article className="panel"><div className="panel-heading"><div><h3>Prediction estimates</h3><p>Linear trend baseline from recent temperature readings</p></div></div><div className="table-scroll"><table><thead><tr><th>Forecast time</th><th>Estimated temperature</th><th>Estimated humidity</th><th>Method</th></tr></thead><tbody>{forecast.map(f=><tr key={f.time}><td>{f.time}</td><td>{fmt(f.temperature)}°C</td><td>{f.humidity}%</td><td><span className="model-tag">Linear trend</span></td></tr>)}</tbody></table></div></article>
      </section>}

      {page === 'data' && <section className="page-section"><div className="section-intro"><h2>Data management</h2><p>Import, inspect, and export weather sensor readings.</p></div><div className="data-actions"><div className="panel upload-panel"><div className="upload-icon"><Upload size={23}/></div><h3>Import weather CSV</h3><p>Upload a CSV containing temperature and humidity. Optional columns: pressure, rainfall, wind_speed and recorded_at.</p><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={e => importCsv(e.target.files?.[0])}/><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={16}/> Choose CSV file</button><small>CSV data is saved in this browser's local storage.</small></div><div className="panel export-panel"><div className="upload-icon green-bg"><Download size={23}/></div><h3>Export dataset</h3><p>Download all current readings as a CSV file for analysis in Excel, Python, or other tools.</p><div className="export-count"><FileSpreadsheet size={18}/><b>{rows.length} records ready</b></div><button className="secondary-button" onClick={exportCsv}><Download size={16}/> Download CSV</button></div></div>
        <article className="panel table-panel"><div className="panel-heading"><div><h3>Weather readings</h3><p>{rows.length} total records · newest first</p></div><div className="table-actions"><button className="secondary-button small" onClick={addDemoReading}><Radio size={15}/> Add demo sensor reading</button><button className="danger-button small" onClick={() => { if (confirm('Clear all locally stored readings?')) { setRows([]); setNotice('Local readings cleared.') } }}>Clear data</button></div></div><div className="table-scroll"><table><thead><tr><th>Date & time</th><th>Temperature</th><th>Humidity</th><th>Pressure</th><th>Rainfall</th><th>Wind speed</th></tr></thead><tbody>{rows.slice().reverse().map((r,i)=><tr key={`${r.recorded_at}-${i}`}><td>{new Date(r.recorded_at).toLocaleString()}</td><td>{fmt(r.temperature)} °C</td><td>{fmt(r.humidity,0)} %</td><td>{fmt(r.pressure)} hPa</td><td>{fmt(r.rainfall)} mm</td><td>{fmt(r.wind_speed)} km/h</td></tr>)}</tbody></table>{!rows.length && <div className="empty-state">No readings yet. Import a CSV file to get started.</div>}</div></article>
      </section>}

      {page === 'settings' && <section className="page-section"><div className="section-intro"><h2>Settings</h2><p>Configure your workspace and connected services.</p></div><article className="panel settings-card"><div className="setting-row"><div className="setting-symbol"><Cloud size={20}/></div><div className="setting-copy"><b>Weather data provider</b><span>Open-Meteo public API · no API key required</span></div><span className="status-label"><span className="pulse-dot"/> {weather ? 'Connected' : 'Waiting'}</span></div><div className="setting-row"><div className="setting-symbol"><Database size={20}/></div><div className="setting-copy"><b>Database connection</b><span>{supabaseReady ? 'Supabase environment variables detected' : 'Local browser storage · Supabase optional'}</span></div><span className={`status-label ${supabaseReady ? '' : 'neutral'}`}>{supabaseReady ? 'Configured' : 'Not configured'}</span></div><div className="setting-row"><div className="setting-symbol"><Activity size={20}/></div><div className="setting-copy"><b>Prediction engine</b><span>Linear regression baseline using recent sensor readings. Not a trained LSTM.</span></div><span className="status-label neutral">Baseline</span></div><div className="setting-row"><div className="setting-symbol"><MapPin size={20}/></div><div className="setting-copy"><b>Default location</b><span>Search and save a city for live weather conditions.</span></div><div className="setting-location"><input value={searchCity} onChange={e => setSearchCity(e.target.value)}/><button className="secondary-button small" onClick={() => loadWeather(searchCity)}>Save</button></div></div></article><article className="panel setup-panel"><h3>Supabase setup (optional)</h3><p>To enable administrator sign-in and cloud database integration:</p><ol><li>Create a free project at <a href="https://supabase.com" target="_blank" rel="noreferrer">Supabase</a>.</li><li>Copy the Project URL and publishable/anon key from Project Settings → API.</li><li>Create a <code>.env</code> file in the project root using <code>.env.example</code> as a template.</li><li>Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>, then restart Vite.</li></ol><div className="warning-note"><AlertTriangle size={17}/> Never put a Supabase service-role or secret key in a frontend environment variable.</div></article></section>}

      <footer className="footer"><span>© 2026 WeatherCast · Weather intelligence dashboard</span><span><span className="pulse-dot"/> {rows.length} local readings</span></footer>
    </main>

    {loginOpen && <div className="modal-backdrop" onClick={() => setLoginOpen(false)}><div className="login-modal" onClick={e => e.stopPropagation()}><button className="modal-close" onClick={() => setLoginOpen(false)}><X size={18}/></button><div className="modal-logo"><CloudSun size={25}/></div><h2>Administrator sign in</h2><p>Sign in with your Supabase Auth account.</p><form onSubmit={signIn}><label>Email address<input type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="admin@example.com"/></label><label>Password<input type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="Your password"/></label><button className="primary-button full" type="submit">Sign in</button></form>{authMessage && <div className="auth-message">{authMessage}</div>}{!supabaseReady && <div className="auth-hint">Demo mode is available without login. Add Supabase credentials in .env to activate authentication.</div>}</div></div>}
  </div>
}

export default App
