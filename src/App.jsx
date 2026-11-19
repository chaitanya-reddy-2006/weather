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

const mapRaspberryReading = row => ({
  ...row,
  recorded_at: row.timestamp,
  temperature: Number(row.temperature),
  humidity: Number(row.humidity),
  pressure: Number(row.pressure),
  wind_speed: Number(row.wind_speed),
  rainfall: Number(row.precipitation ?? row.rain_raw ?? 0),
  air_quality: Number(row.air_quality),
  uv_index: Number(row.uv_index),
  rain_state: row.rain_state
});

function buildTenDayForecast(rows, startDate) {
  const fields = ['temperature', 'humidity', 'pressure', 'wind_speed', 'rainfall', 'air_quality', 'uv_index'];
  const labels = {temperature:'Temperature °C',humidity:'Humidity %',pressure:'Pressure hPa',wind_speed:'Wind km/h',rainfall:'Rain mm',air_quality:'Air quality',uv_index:'UV index'};
  if (!startDate) return {predictions:[],metrics:{},enough:false,reason:'Choose a forecast start date.'};
  const dailyMap = new Map();
  rows.forEach(row => {
    if (!row.recorded_at) return;
    const parsed = new Date(row.recorded_at);
    if (Number.isNaN(parsed.getTime())) return;
    const key = typeof row.recorded_at === 'string' && /^\d{4}-\d{2}-\d{2}/.test(row.recorded_at) ? row.recorded_at.slice(0,10) : parsed.toISOString().slice(0,10);
    if (key >= startDate) return;
    if (!dailyMap.has(key)) dailyMap.set(key,{});
    const bucket = dailyMap.get(key);
    fields.forEach(field => {
      const n = Number(row[field]);
      if (row[field] !== null && row[field] !== undefined && row[field] !== '' && Number.isFinite(n)) {
        if (!bucket[field]) bucket[field]=[];
        bucket[field].push(n);
      }
    });
  });
  const daily = [...dailyMap.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([date,values])=>{
    const item={date};
    fields.forEach(field=>{const a=values[field]||[];item[field]=a.length?a.reduce((x,y)=>x+y,0)/a.length:null;});
    return item;
  }).filter(day=>fields.some(field=>Number.isFinite(day[field])));
  if (!daily.length) return {predictions:[],metrics:{},enough:false,reason:`No readings are available before ${startDate} in the selected data source.`};
  const history=daily.slice(-90);
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  const sd=a=>a.length<2?0:Math.sqrt(avg(a.map(v=>(v-avg(a))**2)));
  const fit=values=>{
    const n=values.length, level=avg(values);
    if(n<2)return {level,slope:0};
    const xm=(n-1)/2, denom=values.reduce((z,_,i)=>z+(i-xm)**2,0)||1;
    const slope=values.reduce((z,v,i)=>z+(i-xm)*(v-level),0)/denom;
    const recent=values.slice(-Math.min(5,n));
    const momentum=recent.length>1?(recent.at(-1)-recent[0])/(recent.length-1):0;
    const cap=Math.max(sd(values)*0.45,Math.abs(level)*0.005,0.05);
    return {level,slope:Math.max(-cap,Math.min(cap,slope*0.65+momentum*0.35))};
  };
  const weekday=d=>new Date(`${d}T12:00:00`).getDay();
  const models={}, metrics={};
  fields.forEach(field=>{
    const valid=history.filter(d=>Number.isFinite(d[field]));
    if(!valid.length)return;
    const values=valid.map(d=>d[field]), recent=values.slice(-Math.min(7,values.length)), fitted=fit(values);
    const effects=Array(7).fill(0);
    if(valid.length>=14){
      const raw=effects.map((_,w)=>{const group=valid.filter(d=>weekday(d.date)===w).map(d=>d[field]);return group.length>=2?avg(group)-avg(values):0;});
      const center=avg(raw);raw.forEach((v,i)=>effects[i]=v-center);
    }
    models[field]={recentLevel:avg(recent),slope:fitted.slope,effects};
    const errors=[], actuals=[], baselineErrors=[];
    if(values.length>=6){
      const first=Math.max(3,values.length-7);
      for(let i=first;i<values.length;i++){
        const pred=fit(values.slice(0,i));
        errors.push(values[i]-(pred.level+pred.slope));actuals.push(values[i]);baselineErrors.push(values[i]-values[i-1]);
      }
    }
    if(errors.length){
      const mae=avg(errors.map(Math.abs)),rmse=Math.sqrt(avg(errors.map(e=>e*e))),am=avg(actuals);
      const total=actuals.reduce((z,v)=>z+(v-am)**2,0),res=errors.reduce((z,e)=>z+e*e,0);
      metrics[field]={label:labels[field],mae,rmse,r2:total>0?1-res/total:null,testCount:errors.length,baselineMae:avg(baselineErrors.map(Math.abs))};
    } else metrics[field]={label:labels[field],mae:null,rmse:null,r2:null,testCount:0,baselineMae:null};
  });
  const validMetrics=Object.values(metrics).filter(m=>m.testCount>=5);
  const modelWins=validMetrics.length===7 && validMetrics.every(m=>Number.isFinite(m.baselineMae) && m.mae<=m.baselineMae);
  const confidence=modelWins?'Validation-backed':'Low — validation pending';
  const predictions=Array.from({length:10},(_,i)=>{
    const d=new Date(`${startDate}T12:00:00`);d.setDate(d.getDate()+i);
    const date=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const item={date};
    fields.forEach(field=>{
      const m=models[field];if(!m){item[field]=null;return;}
      const h=i+1, trendFactor=Math.min(h,5)*Math.pow(0.82,h-1);
      let v=m.recentLevel+m.slope*trendFactor+m.effects[weekday(date)]*Math.pow(0.75,h-1);
      if(field==='humidity')v=Math.max(0,Math.min(100,v));
      if(field==='uv_index')v=Math.max(0,Math.min(15,v));
      if(['rainfall','wind_speed','air_quality'].includes(field))v=Math.max(0,v);
      item[field]=Number(v.toFixed(2));
    });
    item.confidence=confidence==='Validation-backed'&&i<3?'Validation-backed':i>=7?'Low':confidence;
    return item;
  });
  return {predictions,metrics,enough:true,historyDays:history.length,sourceDays:daily.length,confidence,modelLevel:history.length===1?'single-day baseline':history.length<7?'early trend estimate':history.length<14?'trend estimate':history.length<30?'trend + weekday pattern':'trend + seasonal pattern'};
}
const languageLabels = {
  English: { overview:'Overview', analytics:'Analytics', data:'Data management', settings:'Settings' },
  తెలుగు: { overview:'అవలోకనం', analytics:'విశ్లేషణ', data:'డేటా నిర్వహణ', settings:'సెట్టింగ్‌లు' },
  हिन्दी: { overview:'अवलोकन', analytics:'विश्लेषण', data:'डेटा प्रबंधन', settings:'सेटिंग्स' },
  தமிழ்: { overview:'கண்ணோட்டம்', analytics:'பகுப்பாய்வு', data:'தரவு மேலாண்மை', settings:'அமைப்புகள்' },
  ಕನ್ನಡ: { overview:'ಅವಲೋಕನ', analytics:'ವಿಶ್ಲೇಷಣೆ', data:'ಡೇಟಾ ನಿರ್ವಹಣೆ', settings:'ಸೆಟ್ಟಿಂಗ್‌ಗಳು' },
  മലയാളം: { overview:'അവലോകനം', analytics:'വിശകലനം', data:'ഡാറ്റ മാനേജ്മെന്റ്', settings:'ക്രമീകരണങ്ങൾ' }
};

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
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminChecked, setAdminChecked] = useState(false);
  const [analyticsSource, setAnalyticsSource] = useState('weather_readings');
  const [analyticsRows, setAnalyticsRows] = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState('');
  const [forecastStartDate, setForecastStartDate] = useState(new Date().toISOString().slice(0,10));
  const [language, setLanguage] = useState('English');
  const [legalSection, setLegalSection] = useState('policy');

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


  const loadAnalytics = useCallback(async () => {
    if (!isAdmin || !supabaseReady) return;
    setAnalyticsLoading(true);
    setAnalyticsError('');
    try {
      const table = analyticsSource;
      // Supabase commonly returns at most 1,000 rows per request. Fetch pages
      // so older dates are not silently excluded by a latest-5,000-row limit.
      const pageSize = 1000;
      const allData = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from(table)
          .select('*')
          .order('timestamp', { ascending: true })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const batch = data || [];
        allData.push(...batch);
        if (batch.length < pageSize) break;
        from += pageSize;
        if (from >= 100000) {
          throw new Error('The selected dataset exceeds the 100,000-row analytics safety limit. Apply a date range or increase the limit.');
        }
      }

      const mapper = table === 'weather_readings' ? mapReading : mapRaspberryReading;
      setAnalyticsRows(allData
        .map(mapper)
        .filter(row => row.recorded_at && Number.isFinite(row.temperature)));
    } catch (error) {
      setAnalyticsError(error.message || 'Could not load selected dataset.');
      setAnalyticsRows([]);
    } finally {
      setAnalyticsLoading(false);
    }
  }, [isAdmin, analyticsSource]);

  useEffect(() => { if (page === 'analytics' && isAdmin) loadAnalytics(); }, [page, isAdmin, loadAnalytics]);

  useEffect(() => { loadDatabase(); }, [loadDatabase]);

  const verifyAdmin = useCallback(async currentSession => {
    if (!currentSession?.user?.id || !supabaseReady) {
      setIsAdmin(false); setAdminChecked(true); return;
    }
    try {
      const { data, error } = await supabase.from('admin_users')
        .select('user_id').eq('user_id', currentSession.user.id).maybeSingle();
      if (error) throw error;
      setIsAdmin(Boolean(data));
    } catch (error) {
      console.error('Admin verification failed:', error);
      setIsAdmin(false);
    } finally { setAdminChecked(true); }
  }, []);

  useEffect(() => {
    if (!supabaseReady) { setAdminChecked(true); return undefined; }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session); verifyAdmin(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession); verifyAdmin(currentSession);
    });
    return () => listener.subscription.unsubscribe();
  }, [verifyAdmin]);

  useEffect(() => { localStorage.setItem('weathercast-city', city); }, [city]);
  useEffect(() => { localStorage.setItem('weathercast-language', language); }, [language]);

  const translations = {
    English: {},
    తెలుగు: {
      Overview: 'అవలోకనం', Analytics: 'విశ్లేషణ', 'Data management': 'డేటా నిర్వహణ', Settings: 'సెట్టింగ్‌లు',
      'Weather overview': 'వాతావరణ అవలోకనం', 'Advanced weather analytics': 'అధునాతన వాతావరణ విశ్లేషణ',
      '10-day daily forecast': '10 రోజుల రోజువారీ అంచనా', 'Forecast start date': 'అంచనా ప్రారంభ తేదీ',
      Dataset: 'డేటాసెట్', 'Refresh analysis': 'విశ్లేషణను రిఫ్రెష్ చేయండి',
      'Selected dataset readings': 'ఎంచుకున్న డేటాసెట్ రీడింగ్‌లు',
      'Date': 'తేదీ', 'Temp °C': 'ఉష్ణోగ్రత °C', 'Humidity %': 'తేమ %', 'Pressure hPa': 'పీడనం hPa',
      'Wind km/h': 'గాలి km/h', 'Rain mm': 'వర్షం mm', 'Air quality': 'గాలి నాణ్యత', 'UV': 'UV',
      'Display language': 'ప్రదర్శన భాష', 'Choose a language for the navigation and translated interface labels.': 'మెనూ మరియు ఇంటర్‌ఫేస్ భాషను ఎంచుకోండి.',
      'Temperature & humidity': 'ఉష్ణోగ్రత & తేమ', 'Pressure & wind': 'పీడనం & గాలి',
      'Rain / precipitation': 'వర్షపాతం', 'Air quality & UV index': 'గాలి నాణ్యత & UV సూచిక'
    },
    हिन्दी: {
      Overview: 'अवलोकन', Analytics: 'विश्लेषण', 'Data management': 'डेटा प्रबंधन', Settings: 'सेटिंग्स',
      'Weather overview': 'मौसम अवलोकन', 'Advanced weather analytics': 'उन्नत मौसम विश्लेषण',
      '10-day daily forecast': '10-दिन का दैनिक पूर्वानुमान', 'Forecast start date': 'पूर्वानुमान प्रारंभ तिथि',
      Dataset: 'डेटासेट', 'Refresh analysis': 'विश्लेषण रीफ़्रेश करें',
      'Selected dataset readings': 'चयनित डेटासेट रीडिंग',
      Date: 'तिथि', 'Temp °C': 'तापमान °C', 'Humidity %': 'आर्द्रता %', 'Pressure hPa': 'दबाव hPa',
      'Wind km/h': 'हवा km/h', 'Rain mm': 'वर्षा mm', 'Air quality': 'वायु गुणवत्ता', UV: 'UV',
      'Display language': 'प्रदर्शन भाषा', 'Choose a language for the navigation and translated interface labels.': 'मेनू और इंटरफ़ेस की भाषा चुनें।',
      'Temperature & humidity': 'तापमान और आर्द्रता', 'Pressure & wind': 'दबाव और हवा',
      'Rain / precipitation': 'वर्षा', 'Air quality & UV index': 'वायु गुणवत्ता और UV सूचकांक'
    },
    தமிழ்: {
      Overview: 'கண்ணோட்டம்', Analytics: 'பகுப்பாய்வு', 'Data management': 'தரவு மேலாண்மை', Settings: 'அமைப்புகள்',
      'Weather overview': 'வானிலை கண்ணோட்டம்', 'Advanced weather analytics': 'மேம்பட்ட வானிலை பகுப்பாய்வு',
      '10-day daily forecast': '10 நாள் தினசரி முன்னறிவிப்பு', 'Forecast start date': 'முன்னறிவிப்பு தொடக்க தேதி',
      Dataset: 'தரவுத்தொகுப்பு', 'Refresh analysis': 'பகுப்பாய்வைப் புதுப்பிக்கவும்',
      'Selected dataset readings': 'தேர்ந்தெடுத்த தரவுத்தொகுப்பு அளவீடுகள்',
      Date: 'தேதி', 'Temp °C': 'வெப்பநிலை °C', 'Humidity %': 'ஈரப்பதம் %', 'Pressure hPa': 'அழுத்தம் hPa',
      'Wind km/h': 'காற்று km/h', 'Rain mm': 'மழை mm', 'Air quality': 'காற்றுத் தரம்', UV: 'UV',
      'Display language': 'காட்சி மொழி', 'Temperature & humidity': 'வெப்பநிலை & ஈரப்பதம்',
      'Pressure & wind': 'அழுத்தம் & காற்று', 'Rain / precipitation': 'மழைப்பொழிவு', 'Air quality & UV index': 'காற்றுத் தரம் & UV குறியீடு'
    },
    ಕನ್ನಡ: {
      Overview: 'ಅವಲೋಕನ', Analytics: 'ವಿಶ್ಲೇಷಣೆ', 'Data management': 'ಡೇಟಾ ನಿರ್ವಹಣೆ', Settings: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
      'Weather overview': 'ಹವಾಮಾನ ಅವಲೋಕನ', 'Advanced weather analytics': 'ಸುಧಾರಿತ ಹವಾಮಾನ ವಿಶ್ಲೇಷಣೆ',
      '10-day daily forecast': '10 ದಿನಗಳ ದೈನಂದಿನ ಮುನ್ಸೂಚನೆ', 'Forecast start date': 'ಮುನ್ಸೂಚನೆ ಪ್ರಾರಂಭ ದಿನಾಂಕ',
      Dataset: 'ಡೇಟಾಸೆಟ್', 'Refresh analysis': 'ವಿಶ್ಲೇಷಣೆ ರಿಫ್ರೆಶ್ ಮಾಡಿ',
      'Selected dataset readings': 'ಆಯ್ದ ಡೇಟಾಸೆಟ್ ಓದುಗಳು',
      Date: 'ದಿನಾಂಕ', 'Temp °C': 'ತಾಪಮಾನ °C', 'Humidity %': 'ಆರ್ದ್ರತೆ %', 'Pressure hPa': 'ಒತ್ತಡ hPa',
      'Wind km/h': 'ಗಾಳಿ km/h', 'Rain mm': 'ಮಳೆ mm', 'Air quality': 'ಗಾಳಿಯ ಗುಣಮಟ್ಟ', UV: 'UV',
      'Display language': 'ಪ್ರದರ್ಶನ ಭಾಷೆ', 'Temperature & humidity': 'ತಾಪಮಾನ & ಆರ್ದ್ರತೆ',
      'Pressure & wind': 'ಒತ್ತಡ & ಗಾಳಿ', 'Rain / precipitation': 'ಮಳೆ', 'Air quality & UV index': 'ಗಾಳಿಯ ಗುಣಮಟ್ಟ & UV ಸೂಚ್ಯಂಕ'
    },
    മലയാളം: {
      Overview: 'അവലോകനം', Analytics: 'വിശകലനം', 'Data management': 'ഡാറ്റ മാനേജ്മെന്റ്', Settings: 'ക്രമീകരണങ്ങൾ',
      'Weather overview': 'കാലാവസ്ഥ അവലോകനം', 'Advanced weather analytics': 'വിപുലമായ കാലാവസ്ഥ വിശകലനം',
      '10-day daily forecast': '10 ദിവസത്തെ ദൈനംദിന പ്രവചനം', 'Forecast start date': 'പ്രവചന ആരംഭ തീയതി',
      Dataset: 'ഡാറ്റാസെറ്റ്', 'Refresh analysis': 'വിശകലനം പുതുക്കുക',
      'Selected dataset readings': 'തിരഞ്ഞെടുത്ത ഡാറ്റാസെറ്റ് റീഡിംഗുകൾ',
      Date: 'തീയതി', 'Temp °C': 'താപനില °C', 'Humidity %': 'ഈർപ്പം %', 'Pressure hPa': 'മർദ്ദം hPa',
      'Wind km/h': 'കാറ്റ് km/h', 'Rain mm': 'മഴ mm', 'Air quality': 'വായു ഗുണനിലവാരം', UV: 'UV',
      'Display language': 'പ്രദർശന ഭാഷ', 'Temperature & humidity': 'താപനില & ഈർപ്പം',
      'Pressure & wind': 'മർദ്ദം & കാറ്റ്', 'Rain / precipitation': 'മഴ', 'Air quality & UV index': 'വായു ഗുണനിലവാരം & UV സൂചിക'
    }
  };
  const t = key => translations[language]?.[key] || key;

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
    setAuthMessage(error ? error.message : 'Signed in. Checking administrator authorization…');
  }

  async function signOut() {
    if (supabaseReady) await supabase.auth.signOut();
    setSession(null);
    setIsAdmin(false);
  }

  async function importCsv(file) {
    if (!file) return;
    if (!isAdmin) {
      setNotice('CSV upload is restricted to verified administrators.');
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
      <nav>{navItems.filter(item => item.id !== 'analytics' || isAdmin).map(item => <button key={item.id} className={`nav-link ${page === item.id ? 'active' : ''}`} onClick={() => { setPage(item.id); setMobileNav(false); }}><item.icon size={18} />{t(item.label)}</button>)}</nav>
      <div className="sidebar-bottom">
        <div className="connection"><span className="pulse-dot" /><div><b>{weather ? 'Weather API connected' : 'Weather API waiting'}</b><small>{supabaseReady ? (dbError ? 'Database error' : 'Supabase configured') : 'Supabase not configured'}</small></div></div>
        <div className="profile-row"><div className="avatar">WC</div><div><b>{session?.user?.email || 'Public dashboard'}</b><small>{isAdmin ? 'Administrator' : session ? 'Signed-in user' : 'Public access'}</small></div><button title={session ? 'Sign out' : 'Admin sign in'} onClick={() => session ? signOut() : setLoginOpen(true)}>{session ? <LogOut size={17} /> : <LogIn size={17} />}</button></div>
      </div>
    </aside>

    <main className="main-content">
      <header className="topbar">
        <div className="top-left"><button className="mobile-menu" onClick={() => setMobileNav(true)}><Menu /></button><div><div className="eyebrow">WEATHER MONITORING PLATFORM</div><h1>{t(navItems.find(item => item.id === page)?.label || 'Overview')}</h1></div></div>
        <div className="top-actions"><div className="updated"><span className="pulse-dot" /> Updated {lastUpdated.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div><button className="icon-button" onClick={() => { loadDatabase(); loadWeather(); }} title="Refresh data" disabled={dbLoading || loadingWeather}><RefreshCw size={17} className={dbLoading || loadingWeather ? 'spin' : ''} /></button><button className="primary-button small" onClick={() => session ? signOut() : setLoginOpen(true)}>{session ? <LogOut size={16} /> : <LogIn size={16} />} {session ? 'Sign out' : 'Admin'}</button></div>
      </header>

      {notice && <div className="notice"><CheckCircle2 size={17} />{notice}<button onClick={() => setNotice('')}><X size={16} /></button></div>}
      {dbError && <div className="error-banner"><AlertTriangle size={17} />{dbError}<button onClick={() => setDbError('')}><X size={16} /></button></div>}
      {weatherError && <div className="error-banner"><AlertTriangle size={17} />{weatherError}<button onClick={() => setWeatherError('')}><X size={16} /></button></div>}

      {page === 'overview' && <>
        <section className="welcome-row"><div><h2>{t('Weather overview')}</h2><p>Current conditions and historical observations from your WeatherCast database.</p></div><div className="location-search"><MapPin size={17} /><input value={searchCity} onChange={event => setSearchCity(event.target.value)} onKeyDown={event => event.key === 'Enter' && loadWeather(searchCity)} aria-label="Search city" placeholder="Search city" /><button onClick={() => loadWeather(searchCity)} disabled={loadingWeather}><Search size={17} /></button></div></section>
        <section className="hero-weather"><div className="hero-main"><div className="hero-label"><span className="live-pill"><span /> LIVE WEATHER</span><span>{weather?.place || city}{weather?.country ? `, ${weather.country}` : ''}</span></div><div className="hero-temp">{fmt(currentTemp)}<span>°C</span></div><div className="hero-condition"><ConditionIcon size={25} /><span>{weather ? condition : 'Waiting for current weather'}</span></div><div className="hero-sub">Feels like {fmt(weather?.apparent_temperature ?? currentTemp)}°C <span>•</span> {weather?.is_day ? 'Daytime' : 'Local conditions'}</div></div><div className="hero-side"><div className="sun-orbit"><Sun size={68} strokeWidth={1.2} /></div><div><b>{weather ? 'Live conditions' : 'Weather service'}</b><span>Powered by Open-Meteo</span></div></div></section>
        <section className="stats-grid">
          <StatCard title="Temperature" value={fmt(currentTemp)} unit="°C" note={`Dataset average ${fmt(avgTemp)}°C`} icon={Thermometer} tone="orange" />
          <StatCard title="Humidity" value={fmt(currentHumidity, 0)} unit="%" note="Relative humidity" icon={Droplets} tone="blue" />
          <StatCard title="Air pressure" value={fmt(currentPressure)} unit="hPa" note="Surface pressure" icon={Gauge} tone="purple" />
          <StatCard title="Wind speed" value={fmt(currentWind)} unit="km/h" note="10 m above ground" icon={Wind} tone="green" />
        </section>
        <section className="panel overview-note"><div className="panel-heading"><div><h3>WeatherCast monitoring</h3><p>Live conditions and key environmental indicators are shown above. Detailed historical analysis and forecasts are available in the administrator Analytics workspace.</p></div><Activity size={22} className="muted-icon" /></div></section>
      </>}

      {page === 'analytics' && isAdmin && <section className="page-section">
        <div className="section-intro"><h2>{t('Advanced weather analytics')}</h2><p>Explore both WeatherCast datasets, compare environmental parameters and generate a 10-day trend forecast.</p></div>
        <article className="panel analytics-controls">
          <div className="control-field"><label>{t('Dataset')}</label><select value={analyticsSource} onChange={e=>setAnalyticsSource(e.target.value)}><option value="weather_readings">Historical Weather Data</option><option value="raspberry_pi_readings">Raspberry Pi Sensor Data</option></select></div>
          <div className="control-field"><label>{t('Forecast start date')}</label><input type="date" value={forecastStartDate} onChange={e=>setForecastStartDate(e.target.value)} /></div>
          <button className="secondary-button" onClick={loadAnalytics} disabled={analyticsLoading}><RefreshCw size={15}/> Refresh analysis</button>
          <span className="model-tag">ADMIN WORKSPACE</span>
        </article>
        {analyticsError && <div className="error-banner"><AlertTriangle size={17}/>{analyticsError}</div>}
        {analyticsLoading ? <div className="panel empty-state">Loading selected dataset…</div> : <>
          <div className="stats-grid">
            <StatCard title="Records analysed" value={analyticsRows.length.toLocaleString()} unit="" note={analyticsSource==='weather_readings'?'Historical dataset':'Raspberry Pi dataset'} icon={Database} tone="blue"/>
            <StatCard title="Average temperature" value={fmt(analyticsRows.length?analyticsRows.reduce((s,r)=>s+(r.temperature||0),0)/analyticsRows.length:NaN)} unit="°C" note="Selected dataset" icon={Thermometer} tone="orange"/>
            <StatCard title="Latest humidity" value={fmt(analyticsRows.at(-1)?.humidity,0)} unit="%" note="Most recent record" icon={Droplets} tone="purple"/>
            <StatCard title="Latest pressure" value={fmt(analyticsRows.at(-1)?.pressure)} unit="hPa" note="Most recent record" icon={Gauge} tone="green"/>
          </div>
          <div className="analytics-grid">
            <article className="panel"><div className="panel-heading"><div><h3>{t('Temperature & humidity')}</h3><p>Selected source · chronological records</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={analyticsRows.slice(-300).map(r=>({...r,time:timeLabel(r.recorded_at)}))}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" hide/><YAxis yAxisId="t" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="h" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line yAxisId="t" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" dot={false}/><Line yAxisId="h" dataKey="humidity" name="Humidity %" stroke="#38bdf8" dot={false}/></LineChart></ResponsiveContainer></div></article>
            <article className="panel"><div className="panel-heading"><div><h3>{t('Pressure & wind')}</h3><p>Atmospheric and wind conditions</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={analyticsRows.slice(-300).map(r=>({...r,time:timeLabel(r.recorded_at)}))}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" hide/><YAxis yAxisId="p" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="w" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line yAxisId="p" dataKey="pressure" name="Pressure hPa" stroke="#a78bfa" dot={false}/><Line yAxisId="w" dataKey="wind_speed" name="Wind km/h" stroke="#34d399" dot={false}/></LineChart></ResponsiveContainer></div></article>
            <article className="panel"><div className="panel-heading"><div><h3>{t('Rain / precipitation')}</h3><p>Rainfall values by reading</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={analyticsRows.slice(-120).map(r=>({...r,time:timeLabel(r.recorded_at)}))}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" hide/><YAxis tick={{fill:'#91a0b7'}}/><Tooltip/><Bar dataKey="rainfall" name="Rain / precipitation" fill="#38bdf8" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></article>
            <article className="panel"><div className="panel-heading"><div><h3>{t('Air quality & UV index')}</h3><p>Environmental exposure indicators</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={analyticsRows.slice(-300).map(r=>({...r,time:timeLabel(r.recorded_at)}))}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="time" hide/><YAxis yAxisId="a" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="u" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line yAxisId="a" dataKey="air_quality" name="Air quality" stroke="#fb7185" dot={false}/><Line yAxisId="u" dataKey="uv_index" name="UV index" stroke="#fbbf24" dot={false}/></LineChart></ResponsiveContainer></div></article>
          </div>
          {(() => { const result=buildTenDayForecast(analyticsRows,forecastStartDate); return <article className="panel forecast-panel">
            <div className="panel-heading"><div><h3>{t('10-day daily forecast')}</h3><p>Adaptive estimate from the currently selected database table. It starts with one day of readings and updates as more daily data is collected.</p></div><span className="model-tag">EXPERIMENTAL BASELINE</span></div>
            {!result.enough && <div className="empty-state">{result.reason || 'No readings are available for the selected source and date.'} The ten-day date table is shown below.</div>}
              {result.enough && <>
              <div className="metrics-strip"><div><small>History days</small><b>{result.historyDays}</b></div><div><small>Model confidence</small><b>{result.confidence}</b></div><div><small>Validated parameters</small><b>{Object.values(result.metrics || {}).filter(metric => metric.testCount >= 5).length}/7</b></div><div><small>Validation method</small><b>Rolling holdout</b></div></div>
              <div className="warning-note"><AlertTriangle size={16}/>Experimental statistical estimates from the selected {analyticsSource === 'weather_readings' ? 'historical' : 'Raspberry Pi'} dataset. Each parameter has its own model. Confidence is increased only when enough rolling holdout validation data supports it; later forecast days are less certain.</div><div className="table-scroll"><table><thead><tr><th>Parameter</th><th>MAE</th><th>RMSE</th><th>R²</th><th>Test days</th></tr></thead><tbody>{Object.entries(result.metrics || {}).map(([key, metric])=><tr key={key}><td>{metric.label}</td><td>{metric.mae == null ? '—' : metric.mae.toFixed(2)}</td><td>{metric.rmse == null ? '—' : metric.rmse.toFixed(2)}</td><td>{metric.r2 == null ? '—' : metric.r2.toFixed(3)}</td><td>{metric.testCount}</td></tr>)}</tbody></table></div>
              <div className="analytics-grid">
                <article className="panel forecast-chart-card"><div className="panel-heading"><div><h3>Predicted temperature</h3><p>Daily temperature · °C</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.predictions}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="date" tick={{fill:'#91a0b7',fontSize:10}}/><YAxis tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line type="monotone" dataKey="temperature" name="Temperature °C" stroke="#f59e0b" strokeWidth={2} dot/></LineChart></ResponsiveContainer></div></article>
                <article className="panel forecast-chart-card"><div className="panel-heading"><div><h3>Predicted humidity</h3><p>Daily relative humidity · %</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.predictions}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="date" tick={{fill:'#91a0b7',fontSize:10}}/><YAxis domain={[0,100]} tick={{fill:'#91a0b7'}}/><Tooltip/><Line type="monotone" dataKey="humidity" name="Humidity %" stroke="#38bdf8" strokeWidth={2} dot/></LineChart></ResponsiveContainer></div></article>
                <article className="panel forecast-chart-card"><div className="panel-heading"><div><h3>Predicted pressure</h3><p>Atmospheric pressure · hPa</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.predictions}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="date" tick={{fill:'#91a0b7',fontSize:10}}/><YAxis tick={{fill:'#91a0b7'}}/><Tooltip/><Line type="monotone" dataKey="pressure" name="Pressure hPa" stroke="#a78bfa" strokeWidth={2} dot/></LineChart></ResponsiveContainer></div></article>
                <article className="panel forecast-chart-card"><div className="panel-heading"><div><h3>Wind and rainfall</h3><p>Daily wind · km/h and rainfall · mm</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.predictions}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="date" tick={{fill:'#91a0b7',fontSize:10}}/><YAxis yAxisId="wind" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="rain" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line yAxisId="wind" type="monotone" dataKey="wind_speed" name="Wind km/h" stroke="#34d399" strokeWidth={2} dot/><Line yAxisId="rain" type="monotone" dataKey="rainfall" name="Rain mm" stroke="#38bdf8" strokeWidth={2} dot/></LineChart></ResponsiveContainer></div></article>
                <article className="panel forecast-chart-card"><div className="panel-heading"><div><h3>Air quality and UV</h3><p>Daily sensor indicators</p></div></div><div className="chart-wrap tall"><ResponsiveContainer width="100%" height="100%"><LineChart data={result.predictions}><CartesianGrid strokeDasharray="3 3" stroke="#243147"/><XAxis dataKey="date" tick={{fill:'#91a0b7',fontSize:10}}/><YAxis yAxisId="aq" tick={{fill:'#91a0b7'}}/><YAxis yAxisId="uv" orientation="right" tick={{fill:'#91a0b7'}}/><Tooltip/><Legend/><Line yAxisId="aq" type="monotone" dataKey="air_quality" name="Air quality" stroke="#fb7185" strokeWidth={2} dot/><Line yAxisId="uv" type="monotone" dataKey="uv_index" name="UV index" stroke="#fbbf24" strokeWidth={2} dot/></LineChart></ResponsiveContainer></div></article>
              </div>
              </>}
              <div className="table-scroll"><table><thead><tr><th>{t('Date')}</th><th>{t('Temp °C')}</th><th>{t('Humidity %')}</th><th>{t('Pressure hPa')}</th><th>{t('Wind km/h')}</th><th>{t('Rain mm')}</th><th>{t('Air quality')}</th><th>{t('UV')}</th><th>Confidence</th></tr></thead><tbody>{(result.predictions.length ? result.predictions : Array.from({length:10}, (_,i) => { const d=new Date(`${forecastStartDate}T12:00:00`); d.setDate(d.getDate()+i); return {date:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}; })).map(p=><tr key={p.date}><td>{p.date}</td><td>{fmt(p.temperature)}</td><td>{fmt(p.humidity,0)}</td><td>{fmt(p.pressure)}</td><td>{fmt(p.wind_speed)}</td><td>{fmt(p.rainfall)}</td><td>{fmt(p.air_quality,0)}</td><td>{fmt(p.uv_index,1)}</td><td>{p.confidence || '—'}</td></tr>)}</tbody></table></div>
          </article>; })()}
          <article className="panel table-panel"><div className="panel-heading"><div><h3>{t('Selected dataset readings')}</h3><p>Showing the latest 100 rows from {analyticsSource}</p></div></div><div className="table-scroll"><table><thead><tr><th>Timestamp</th><th>Temp °C</th><th>Humidity %</th><th>Pressure hPa</th><th>Wind km/h</th><th>Rain / precipitation</th><th>Air quality</th><th>UV</th><th>Status</th></tr></thead><tbody>{analyticsRows.slice(-100).reverse().map((r,i)=><tr key={r.id??i}><td>{timeLabel(r.recorded_at)}</td><td>{fmt(r.temperature)}</td><td>{fmt(r.humidity,0)}</td><td>{fmt(r.pressure)}</td><td>{fmt(r.wind_speed)}</td><td>{fmt(r.rainfall)}</td><td>{fmt(r.air_quality,0)}</td><td>{fmt(r.uv_index)}</td><td>{r.weather_status||r.rain_state||'—'}</td></tr>)}</tbody></table></div></article>
        </>}
      </section>}


      {page === 'data' && <section className="page-section"><div className="section-intro"><h2>Data management</h2><p>View the latest Supabase weather records. CSV imports are available to verified administrators.</p></div><div className="data-actions">{isAdmin && <div className="panel upload-panel"><div className="upload-icon"><Upload size={23} /></div><h3>Upload weather CSV</h3><p>CSV must use the nine exact database column names: timestamp, temperature_c, humidity_percent, pressure_hpa, wind_speed_kmh, rainfall_mm, air_quality, uv_index, weather_status.</p><input ref={fileRef} type="file" accept=".csv,text/csv" onChange={event => importCsv(event.target.files?.[0])} /><button className="primary-button" onClick={() => fileRef.current?.click()}><Upload size={16} /> Choose CSV file</button><small>Administrator sign-in required. Existing records are not overwritten.</small></div>}<div className="panel export-panel"><div className="upload-icon green-bg"><Download size={23} /></div><h3>Export loaded readings</h3><p>Download the latest {rows.length.toLocaleString()} readings currently loaded from Supabase.</p><div className="export-count"><FileSpreadsheet size={18} /><b>{rows.length.toLocaleString()} records ready</b></div><button className="secondary-button" onClick={exportCsv} disabled={!rows.length}><Download size={16} /> Download CSV</button></div></div>
        <article className="panel table-panel"><div className="panel-heading"><div><h3>Weather readings</h3><p>{totalRecords.toLocaleString()} total database records · showing latest {rows.length.toLocaleString()}</p></div><div className="table-actions"><button className="secondary-button small" onClick={loadDatabase} disabled={dbLoading}><RefreshCw size={15} /> Refresh</button></div></div><div className="table-scroll"><table><thead><tr><th>Date & time</th><th>Temperature</th><th>Humidity</th><th>Pressure</th><th>Rainfall</th><th>Wind speed</th><th>Status</th></tr></thead><tbody>{rows.slice().reverse().map(row => <tr key={row.id}><td>{timeLabel(row.recorded_at)}</td><td>{fmt(row.temperature)} °C</td><td>{fmt(row.humidity, 0)} %</td><td>{fmt(row.pressure)} hPa</td><td>{fmt(row.rainfall)} mm</td><td>{fmt(row.wind_speed)} km/h</td><td>{row.weather_status || '—'}</td></tr>)}</tbody></table>{dbLoading && <div className="empty-state">Loading database records…</div>}{!dbLoading && !rows.length && <div className="empty-state">No records available. Check the database connection and SELECT policy.</div>}</div></article>
      </section>}

      {page === 'settings' && <section className="page-section">
        <div className="section-intro"><h2>Settings</h2><p>Configure your WeatherCast workspace, language and information policies.</p></div>
        <article className="panel settings-card">
          <div className="setting-row"><div className="setting-symbol"><Cloud size={20}/></div><div className="setting-copy"><b>Weather data provider</b><span>Open-Meteo public API · no API key required</span></div><span className="status-label"><span className="pulse-dot"/>{weather?'Connected':'Waiting'}</span></div>
          <div className="setting-row"><div className="setting-symbol"><Database size={20}/></div><div className="setting-copy"><b>Supabase database</b><span>{supabaseReady?`Connected configuration · ${totalRecords.toLocaleString()} historical rows counted`:'Add Supabase credentials to .env'}</span></div><span className={`status-label ${dbError?'neutral':''}`}>{dbLoading?'Loading':dbError?'Check connection':'Configured'}</span></div>
          <div className="setting-row"><div className="setting-symbol"><Activity size={20}/></div><div className="setting-copy"><b>Forecast engine</b><span>Analytics currently uses an experimental statistical baseline with holdout metrics.</span></div><span className="status-label neutral">Baseline</span></div>
          <div className="setting-row"><div className="setting-symbol"><MapPin size={20}/></div><div className="setting-copy"><b>Default location</b><span>Search a city for current weather conditions.</span></div><div className="setting-location"><input value={searchCity} onChange={e=>setSearchCity(e.target.value)}/><button className="secondary-button small" onClick={()=>loadWeather(searchCity)}>Save</button></div></div>
          <div className="setting-row"><div className="setting-symbol"><Settings size={20}/></div><div className="setting-copy"><b>{t('Display language')}</b><span>{t('Choose a language for the navigation and translated interface labels.')}</span></div><select className="language-select" value={language} onChange={e=>setLanguage(e.target.value)}><option>English</option><option>తెలుగు</option><option>हिन्दी</option><option>தமிழ்</option><option>ಕನ್ನಡ</option><option>മലയാളം</option></select></div>
        </article>
        <article className="panel setup-panel legal-panel"><div className="legal-tabs"><button className={legalSection==='policy'?'active':''} onClick={()=>setLegalSection('policy')}>User Policy</button><button className={legalSection==='terms'?'active':''} onClick={()=>setLegalSection('terms')}>Terms & Conditions</button></div>
          {legalSection==='policy'?<><h3>User Policy</h3><p>WeatherCast is an educational weather-monitoring dashboard. Visitors may view publicly available weather information and historical readings. Administrator-only features, including analytics and CSV imports, require an authenticated account explicitly authorized by the project administrators.</p><ul><li>Do not attempt to access restricted administrator functions or disrupt the service.</li><li>Use displayed environmental readings for learning and informational purposes.</li><li>Do not rely on experimental forecasts for emergency, safety-critical or operational decisions.</li><li>Respect the privacy of account credentials and never share administrator access.</li></ul></>:<><h3>Terms & Conditions</h3><p>By using WeatherCast, you agree to use the dashboard lawfully and responsibly. The project is provided for academic demonstration and educational use.</p><ul><li>Weather observations may be delayed, incomplete or affected by sensor and network errors.</li><li>Forecasts are estimates and are not guaranteed to be accurate.</li><li>The project team may update, modify or temporarily suspend features as part of development.</li><li>Open-Meteo and Supabase services are subject to their own terms and availability.</li><li>Unauthorized access, misuse or attempts to alter stored data are prohibited.</li></ul></>}
        </article>
      </section>}

      <footer className="footer"><span>© 2026 WeatherCast · This public dashboard is proudly developed by students of Godavari Institute of Engineering and Technology (A), ECE Department, Batch B7, as an academic IoT weather-monitoring and intelligent forecasting initiative.</span><span><span className="pulse-dot" /> {totalRecords.toLocaleString()} database records</span></footer>
    </main>

    {loginOpen && <div className="modal-backdrop" onClick={() => setLoginOpen(false)}><div className="login-modal" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setLoginOpen(false)}><X size={18} /></button><div className="modal-logo"><CloudSun size={25} /></div><h2>Administrator sign in</h2><p>Sign in with your Supabase Auth account.</p><form onSubmit={signIn}><label>Email address<input type="email" value={email} onChange={event => setEmail(event.target.value)} required placeholder="admin@example.com" /></label><label>Password<input type="password" value={password} onChange={event => setPassword(event.target.value)} required placeholder="Your password" /></label><button className="primary-button full" type="submit">Sign in</button></form>{authMessage && <div className="auth-message">{authMessage}</div>}</div></div>}
  </div>;
}
