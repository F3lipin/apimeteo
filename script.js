/* ==========================================================================
   API Meteo — Lógica da aplicação
   Sumário:
   1. Configuração
   2. Dados de demonstração
   3. Utilitários
   4. Serviços (adaptador de demonstração e gateway)
   5. Estado da aplicação
   6. Renderização (previsão, gráfico, clima atual, resultados)
   7. Histórico de consultas
   8. Navegação entre abas
   9. Eventos (busca, atualização, comparação)
   10. Inicialização
   ========================================================================== */


/* 1. Configuração
   -------------------------------------------------------------------------- */
// Configure uma URL HTTPS de gateway para substituir o adaptador local de demonstração.
const GATEWAY_BASE_URL = '';

const MAX_HISTORY_RECORDS = 999;
const HISTORY_VISIBLE = 5;
const HISTORY_LOAD_TIMEOUT_MS = 8000;


/* 2. Dados de demonstração
   -------------------------------------------------------------------------- */
const places = [
  { id: 'salvador-ba', name: 'Salvador',       state: 'Bahia',          country: 'Brasil',      lat: -12.9777, lon: -38.5016, zone: 'America/Bahia',       temp: 27, code: 51, offset: 0 },
  { id: 'rio-rj',      name: 'Rio de Janeiro', state: 'Rio de Janeiro', country: 'Brasil',      lat: -22.9068, lon: -43.1729, zone: 'America/Sao_Paulo',   temp: 30, code: 1,  offset: 3 },
  { id: 'sao-paulo-sp',name: 'São Paulo',      state: 'São Paulo',      country: 'Brasil',      lat: -23.5505, lon: -46.6333, zone: 'America/Sao_Paulo',   temp: 23, code: 3,  offset: -3 },
  { id: 'recife-pe',   name: 'Recife',         state: 'Pernambuco',     country: 'Brasil',      lat: -8.0476,  lon: -34.8770, zone: 'America/Recife',      temp: 28, code: 2,  offset: 1 },
  { id: 'salvador-sv', name: 'Salvador',       state: 'San Salvador',   country: 'El Salvador', lat: 13.6929,  lon: -89.2182, zone: 'America/El_Salvador', temp: 29, code: 0,  offset: 2 },
  { id: 'lisboa-pt',   name: 'Lisboa',         state: 'Lisboa',         country: 'Portugal',    lat: 38.7223,  lon: -9.1393,  zone: 'Europe/Lisbon',       temp: 18, code: 2,  offset: -6 }
];


/* 3. Utilitários
   -------------------------------------------------------------------------- */
const $ = id => document.getElementById(id);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Remove acentos e converte para minúsculas (busca tolerante a acentuação)
const normalizeText = text =>
  text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Converte um código WMO em [ícone, descrição]
const wmo = code => {
  if (code === 0) return ['☀️', 'Céu limpo'];
  if (code <= 3) return ['⛅', 'Parcialmente nublado'];
  if (code === 45 || code === 48) return ['🌫️', 'Nevoeiro'];
  if (code >= 51 && code <= 67) return ['🌦️', 'Garoa ou chuva'];
  if (code >= 71 && code <= 77) return ['🌨️', 'Neve'];
  if (code >= 80 && code <= 82) return ['🌧️', 'Pancadas de chuva'];
  if (code >= 95) return ['⛈️', 'Tempestade'];
  return ['☁️', 'Nublado'];
};

const placeLabel = p => `${p.name}, ${p.state}, ${p.country}`;

const fmtDate = (iso, zone) =>
  new Intl.DateTimeFormat('pt-BR', {
    timeZone: zone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso));

const dayLabel = iso =>
  new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    timeZone: 'UTC'
  }).format(new Date(`${iso}T12:00:00Z`));

const setStatus = (id, message, error = false) => {
  const el = $(id);
  el.textContent = message;
  el.style.color = error ? '#b63e39' : '#698394';
};

const buttonPending = (button, pending) => {
  button.disabled = pending;
  button.setAttribute('aria-busy', String(pending));
};

// Cria um elemento com classe e texto (evita innerHTML)
const make = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
};


/* 4. Serviços
   -------------------------------------------------------------------------- */

// Adaptador local de demonstração (dados simulados)
const demoService = {
  async geocode(query) {
    await sleep(300);
    const q = normalizeText(query);
    return places.filter(p =>
      normalizeText(`${p.name} ${p.state} ${p.country}`).includes(q)
    );
  },

  async weather(place) {
    await sleep(420);
    const now = new Date();
    const codes = [place.code, 2, 51, 3, 1];
    const maxOffsets = [0, 1, 2, 1, 2];
    const minOffsets = [3, 4, 3, 4, 3];

    return {
      observedAt: now.toISOString(),
      temperature: place.temp,
      feels: place.temp + 2,
      humidity: 80 - place.offset * 2,
      windSpeed: 21 + place.offset,
      windDirection: (162 + place.offset * 11 + 360) % 360,
      precipitation: place.code === 51 ? 0.1 : 0,
      uv: Math.max(1, 2.75 + place.offset * 0.7),
      code: place.code,
      days: codes.map((code, i) => {
        const d = new Date(now);
        d.setUTCDate(d.getUTCDate() + i);
        return {
          date: d.toISOString().slice(0, 10),
          max: place.temp + maxOffsets[i] + (place.offset % 2),
          min: place.temp - minOffsets[i],
          code
        };
      })
    };
  }
};

// Gateway: usa o backend real quando GATEWAY_BASE_URL está configurada
const gateway = {
  async geocode(query) {
    if (!GATEWAY_BASE_URL) return demoService.geocode(query);
    const r = await fetch(`${GATEWAY_BASE_URL}/geocoding/search?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw Error('A busca de localidades não está disponível.');
    return r.json();
  },

  async weather(place) {
    if (!GATEWAY_BASE_URL) return demoService.weather(place);
    const r = await fetch(
      `${GATEWAY_BASE_URL}/meteorologia/forecast?lat=${encodeURIComponent(place.lat)}&lon=${encodeURIComponent(place.lon)}`
    );
    if (!r.ok) throw Error('A consulta meteorológica não está disponível.');
    return r.json();
  }
};


/* 5. Estado da aplicação
   -------------------------------------------------------------------------- */
let activePlace = null;
let chart = null;
let backendRecords = [];
let sdkReady = false;
let loadTimer;


/* 6. Renderização
   -------------------------------------------------------------------------- */
function renderForecast(target, days) {
  target.replaceChildren();
  days.forEach(day => {
    const card = make('div', 'soft p-3 min-w-0', '');
    card.append(
      make('p', 'font-semibold text-xs mb-3', dayLabel(day.date)),
      make('div', 'text-2xl mb-2', wmo(day.code)[0]),
      make('p', 'font-bold text-sm', `${day.min}° / ${day.max}°`),
      make('p', 'text-xs mt-2 text-[#698394]', wmo(day.code)[1])
    );
    target.append(card);
  });
}

function drawChart(days) {
  if (chart) chart.destroy();

  if (!window.Chart) {
    setStatus('search-status', 'Gráfico indisponível: não foi possível carregar a biblioteca.', true);
    return;
  }

  chart = new Chart($('temperature-chart'), {
    type: 'line',
    data: {
      labels: days.map(d => dayLabel(d.date)),
      datasets: [
        { label: 'Máxima °C', data: days.map(d => d.max), borderColor: '#f2853b', backgroundColor: '#f2853b', tension: 0.35, pointRadius: 3 },
        { label: 'Mínima °C', data: days.map(d => d.min), borderColor: '#16739b', backgroundColor: '#16739b', tension: 0.35, pointRadius: 3 }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: {
        y: { grid: { color: '#eaf0f2' } },
        x: { grid: { display: false } }
      }
    }
  });
}

function showWeather(place, data) {
  activePlace = place;
  const zone = place.zone || 'UTC';

  $('weather-content').hidden = false;
  $('current-place').textContent = placeLabel(place);
  $('coordinates').textContent = `Latitude: ${place.lat.toFixed(4)}° · Longitude: ${place.lon.toFixed(4)}°`;
  $('observed').textContent = `Observação simulada: ${fmtDate(data.observedAt, zone)} · ${zone}`;
  $('current-icon').textContent = wmo(data.code)[0];
  $('current-temp').textContent = `${data.temperature}°`;
  $('current-description').textContent = `${wmo(data.code)[1]} · WMO ${data.code}`;
  $('humidity-value').textContent = `${data.humidity}%`;
  $('wind-value').textContent = `${data.windSpeed} km/h · ${data.windDirection}°`;
  $('feels-value').textContent = `${data.feels} °C`;
  $('rain-value').textContent = `${data.precipitation} mm`;
  $('uv-value').textContent = Number(data.uv).toFixed(2);

  renderForecast($('forecast-cards'), data.days);
  drawChart(data.days);
  $('search-results').replaceChildren();
}

function renderResults(results) {
  const box = $('search-results');
  box.replaceChildren();
  results.forEach(place => {
    const button = make(
      'button',
      'result-button text-left border border-[#dce9ee] rounded-xl p-3 transition-colors',
      placeLabel(place)
    );
    button.type = 'button';
    button.addEventListener('click', () => consult(place, button));
    box.append(button);
  });
}

function renderComparison(pairs) {
  const box = $('compare-content');
  box.replaceChildren();
  pairs.forEach(([place, data]) => {
    const card = make('article', 'soft p-5', '');
    card.append(
      make('h3', 'font-bold text-xl mb-2', placeLabel(place)),
      make('p', 'text-3xl font-semibold mb-4', `${wmo(data.code)[0]} ${data.temperature} °C`)
    );
    const days = make('div', 'grid grid-cols-2 gap-2', '');
    data.days.forEach(day =>
      days.append(make('p', 'text-sm bg-white rounded-lg p-2', `${dayLabel(day.date)} · ${day.min}° / ${day.max}°`))
    );
    card.append(days);
    box.append(card);
  });
  box.hidden = false;
}


/* 7. Histórico de consultas
   -------------------------------------------------------------------------- */
async function recordVisit(place) {
  if (!sdkReady) {
    setStatus('history-status', 'Histórico indisponível nesta sessão.', true);
    return;
  }
  if (backendRecords.length >= MAX_HISTORY_RECORDS) {
    setStatus('history-status', 'Limite de 999 consultas atingido. A consulta meteorológica continua disponível.', true);
    return;
  }

  const result = await window.dataSdk.create({
    city_name: place.name,
    state: place.state,
    country: place.country,
    latitude: place.lat,
    longitude: place.lon,
    consulted_at: new Date().toISOString()
  });

  if (!result.isOk) {
    setStatus('history-status', 'Não foi possível confirmar o registro da consulta. Atualize a página antes de tentar novamente.', true);
  }
}

function renderHistory() {
  const box = $('history-list');
  box.replaceChildren();

  const latest = [...backendRecords]
    .sort((a, b) => Date.parse(b.consulted_at) - Date.parse(a.consulted_at))
    .slice(0, HISTORY_VISIBLE);

  if (!latest.length) {
    setStatus('history-status', 'Nenhuma cidade consultada ainda.');
    return;
  }

  setStatus('history-status', 'Últimas cinco consultas registradas na Canva Sheet.');

  latest.forEach(row => {
    const button = make(
      'button',
      'history-button border border-[#dce9ee] rounded-xl px-3 py-2 text-sm transition-colors',
      `${row.city_name}, ${row.state} · ${new Date(row.consulted_at).toLocaleDateString('pt-BR')}`
    );
    button.type = 'button';
    button.addEventListener('click', () => {
      const place =
        places.find(p => p.name === row.city_name && p.state === row.state && p.country === row.country) ||
        { name: row.city_name, state: row.state, country: row.country, lat: row.latitude, lon: row.longitude, zone: 'UTC' };
      showView('consulta');
      consult(place, button);
    });
    box.append(button);
  });
}

async function initSheet() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(
    () => setStatus('history-status', 'Não foi possível carregar o histórico. Tente novamente pelo botão abaixo.', true),
    HISTORY_LOAD_TIMEOUT_MS
  );

  try {
    const result = await window.dataSdk.init({
      onDataChanged(data) {
        clearTimeout(loadTimer);
        sdkReady = true;
        backendRecords = data;
        renderHistory();
      }
    });
    if (!result.isOk) {
      clearTimeout(loadTimer);
      setStatus('history-status', 'Não foi possível iniciar o histórico de consultas.', true);
    }
  } catch (e) {
    clearTimeout(loadTimer);
    setStatus('history-status', 'Não foi possível iniciar o histórico de consultas.', true);
  }
}


/* 8. Navegação entre abas
   -------------------------------------------------------------------------- */
function showView(id) {
  document.querySelectorAll('.view').forEach(el => (el.hidden = el.id !== id));
  document.querySelectorAll('.nav-button').forEach(el =>
    el.setAttribute('aria-selected', String(el.dataset.view === id))
  );
}


/* 9. Consulta e eventos
   -------------------------------------------------------------------------- */
async function consult(place, button, record = true) {
  buttonPending(button, true);
  setStatus('search-status', `Consultando ${placeLabel(place)}…`);
  try {
    const weather = await gateway.weather(place);
    showWeather(place, weather);
    setStatus(
      'search-status',
      GATEWAY_BASE_URL ? 'Consulta atualizada.' : 'Dados de demonstração — não são medições meteorológicas reais.'
    );
    if (record) await recordVisit(place);
  } catch (e) {
    setStatus('search-status', e.message || 'Não foi possível consultar o clima.', true);
  } finally {
    buttonPending(button, false);
  }
}

function bindNavigation() {
  document.querySelectorAll('.nav-button').forEach(button =>
    button.addEventListener('click', () => showView(button.dataset.view))
  );
}

function bindSearch() {
  $('search-form').addEventListener('submit', async event => {
    event.preventDefault();
    const query = $('city-input').value.trim();
    $('search-results').replaceChildren();

    if (!query) {
      setStatus('search-status', 'Digite uma cidade para iniciar a busca.', true);
      $('city-input').focus();
      return;
    }

    const button = event.submitter || $('search-button');
    buttonPending(button, true);
    setStatus('search-status', 'Buscando cidades…');

    try {
      const results = await gateway.geocode(query);
      if (!results.length) {
        setStatus('search-status', 'Cidade não encontrada. Confira a grafia e tente novamente.', true);
        return;
      }
      renderResults(results);
      setStatus('search-status', `${results.length} localidade(s) encontrada(s). Selecione o estado e o país desejados.`);
    } catch (e) {
      setStatus('search-status', e.message || 'Falha ao buscar cidades.', true);
    } finally {
      buttonPending(button, false);
    }
  });

  $('refresh-button').addEventListener('click', event => {
    if (activePlace) consult(activePlace, event.currentTarget, false);
  });
}

function bindComparison() {
  const select = $('compare-select');

  places.forEach(p => {
    const option = document.createElement('option');
    option.value = p.id;
    option.textContent = placeLabel(p);
    select.append(option);
  });
  select.value = 'rio-rj';

  $('compare-button').addEventListener('click', async event => {
    const button = event.currentTarget;

    if (!activePlace) {
      setStatus('compare-status', 'Consulte uma primeira cidade na aba Consulta.', true);
      return;
    }

    const second = places.find(p => p.id === select.value);
    if (second.id === activePlace.id) {
      setStatus('compare-status', 'Escolha uma cidade diferente da cidade consultada.', true);
      return;
    }

    buttonPending(button, true);
    setStatus('compare-status', 'Preparando comparação…');

    try {
      const [firstData, secondData] = await Promise.all([
        gateway.weather(activePlace),
        gateway.weather(second)
      ]);
      renderComparison([[activePlace, firstData], [second, secondData]]);
      setStatus('compare-status', GATEWAY_BASE_URL ? 'Previsões comparadas.' : 'Comparação com dados de demonstração.');
    } catch (e) {
      setStatus('compare-status', e.message || 'Não foi possível comparar as cidades.', true);
    } finally {
      buttonPending(button, false);
    }
  });
}


/* 10. Inicialização
   -------------------------------------------------------------------------- */
bindNavigation();
bindSearch();
bindComparison();

setStatus('history-status', 'Carregando histórico…');
initSheet();

if (window.lucide) lucide.createIcons();