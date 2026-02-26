/* ============================================
   RTCC 2026 - App Logic
   ============================================ */

// State
let agendaData = [];
let speakersData = [];
let locationsData = [];
let notificationsData = [];
let currentPage = 'home';
let currentDay = 1;
let currentAreaFilter = 'all';
let currentSpeakerFilter = 'all';
let currentSpeakerSearch = '';

// Base path for data files (adjust for GitHub Pages subdirectory)
const BASE_PATH = (() => {
  const path = window.location.pathname;
  if (path.includes('/webapp/')) {
    return path.substring(0, path.indexOf('/webapp/') + '/webapp/'.length);
  }
  if (path.endsWith('/')) return path;
  return path.substring(0, path.lastIndexOf('/') + 1);
})();

const BELL_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
const BELL_FILL_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke-width="2"/></svg>`;
const ARRIVAL_QR_EXPECTED = 'RTCC2026|ARRIBO|HANDSHAKE|R-9F2A-7C61-58D4';
const ARRIVAL_HANDSHAKE_KEY = 'rtcc_arrival_handshake';

let arrivalScannerStream = null;
let arrivalScanLoopId = null;
let arrivalDetector = null;
let arrivalScanActive = false;
let arrivalLastInvalidAt = 0;

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initApp();
});

async function loadAllData() {
  try {
    const [agenda, speakers, locations, notifications] = await Promise.all([
      fetchJSON('data/agenda.json'),
      fetchJSON('data/speakers.json'),
      fetchJSON('data/locations.json'),
      fetchJSON('data/notifications.json')
    ]);
    agendaData = agenda || [];
    speakersData = speakers || [];
    locationsData = locations || [];
    notificationsData = notifications || [];
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

async function fetchJSON(path) {
  try {
    const res = await fetch(BASE_PATH + path + '?t=' + Date.now());
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`Could not load ${path}:`, e.message);
    return [];
  }
}

function initApp() {
  // Hide splash
  setTimeout(() => {
    const splash = document.getElementById('splash');
    splash.classList.add('fade-out');
    document.getElementById('app').classList.remove('hidden');
    setTimeout(() => splash.remove(), 500);
  }, 1200);

  // Render
  renderDayTabs();
  renderAgenda();
  renderSpeakers();
  renderLocations();
  renderNotifications();
  renderNextSession();
  renderMySessions();
  updateNotifBadge();
  showLatestNotifBanner();
  startCountdown();
  updateArrivalFabState();
  checkReminders();
  setInterval(checkReminders, 60000);

  // Check for hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById('page-' + hash)) {
    navigateTo(hash, false);
  }

  // PWA install prompt
  initInstallBanner();
}

// ============================================
// PWA INSTALL
// ============================================
let deferredInstallPrompt = null;

// Android/Chrome: capture and immediately trigger native install prompt
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  // Trigger install prompt automatically after a brief delay
  setTimeout(() => triggerAutoInstall(), 1500);
});

async function triggerAutoInstall() {
  if (!deferredInstallPrompt) return;
  // Don't prompt if already installed
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  // Don't prompt if user declined recently (12h)
  const declined = localStorage.getItem('rtcc_install_declined');
  if (declined && Date.now() - parseInt(declined) < 12 * 60 * 60 * 1000) return;

  try {
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    if (outcome === 'accepted') {
      requestAllPermissions();
    } else {
      localStorage.setItem('rtcc_install_declined', Date.now().toString());
    }
  } catch (_) {}
  deferredInstallPrompt = null;
}

function initInstallBanner() {
  // Don't show if already installed as PWA
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  if (window.navigator.standalone === true) return; // iOS standalone

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

  // On Android/Chrome the native prompt fires automatically, no banner needed
  if (!isIOS) return;

  // iOS: show fullscreen modal with clear instructions
  // Don't show if dismissed recently (12h)
  const dismissed = localStorage.getItem('rtcc_install_dismissed');
  if (dismissed && Date.now() - parseInt(dismissed) < 12 * 60 * 60 * 1000) return;

  setTimeout(() => {
    const modal = document.getElementById('iosInstallModal');
    if (modal) modal.classList.remove('hidden');
  }, 1500);
}

function dismissInstallBanner() {
  const modal = document.getElementById('iosInstallModal');
  if (modal) modal.classList.add('hidden');
  localStorage.setItem('rtcc_install_dismissed', Date.now().toString());
}

function requestAllPermissions() {
  // Notifications
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Geolocation (triggers permission dialog)
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(() => {}, () => {}, { timeout: 1 });
  }

  // Camera — can only be requested when actually needed (getUserMedia requires active use)
  // We'll request it when the user opens photo crop instead
}

// Re-request permissions when app opens as installed PWA
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
  requestAllPermissions();
}

// ============================================
// NAVIGATION
// ============================================
function navigateTo(page, updateHash = true) {
  // "Asistentes" no se muestra en navegacion; redirigir enlaces viejos.
  if (page === 'attendees') page = 'locations';

  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

  // Show target page
  const target = document.getElementById('page-' + page);
  if (target) {
    target.classList.add('active');
    // Re-trigger animation
    target.style.animation = 'none';
    target.offsetHeight; // reflow
    target.style.animation = '';
  }

  // Update nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  // Re-render dynamic home sections
  if (page === 'home') {
    renderMySessions();
    renderNextSession();
  }

  // Mark notifications as read
  if (page === 'notifications') {
    markNotificationsRead();
  }

  // Load attendees
  if (page === 'attendees' && typeof loadAttendees === 'function') {
    loadAttendees();
  }

  currentPage = page;
  if (updateHash) window.location.hash = page === 'home' ? '' : page;

  // Scroll to top
  window.scrollTo(0, 0);
}

// ============================================
// AGENDA
// ============================================
function renderDayTabs() {
  const container = document.getElementById('dayTabs');
  if (!agendaData.length) return;

  container.innerHTML = agendaData.map((day, i) => `
    <button class="tab ${i === 0 ? 'active' : ''}" data-day="${day.day}" onclick="selectDay(${day.day})">
      D&iacute;a ${day.day}${day.date ? ' &middot; ' + formatShortDate(day.date) : ''}
    </button>
  `).join('');
}

function selectDay(day) {
  currentDay = day;
  document.querySelectorAll('#dayTabs .tab').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.day) === day);
  });
  renderAgenda();
}

function filterAgenda(area) {
  currentAreaFilter = area;
  document.querySelectorAll('#areaFilters .filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.area === area);
  });
  renderAgenda();
}

function renderAgenda() {
  const container = document.getElementById('agendaList');
  const dayData = agendaData.find(d => d.day === currentDay);

  if (!dayData || !dayData.sessions || !dayData.sessions.length) {
    container.innerHTML = '<div class="session-empty">No hay sesiones programadas para este d&iacute;a.</div>';
    return;
  }

  let sessions = dayData.sessions;
  if (currentAreaFilter !== 'all') {
    sessions = sessions.filter(s => s.area === currentAreaFilter);
  }

  if (!sessions.length) {
    container.innerHTML = '<div class="session-empty">No hay sesiones en esta &aacute;rea para este d&iacute;a.</div>';
    return;
  }

  const now = new Date();

  container.innerHTML = sessions.map((session) => {
    const isNow = isSessionNow(session, dayData.date, now);
    const key = sessionKey(session, dayData.date);
    const reminded = isReminded(session, dayData.date);
    const escapedKey = key.replace(/'/g, "\\'");
    const sessionIndex = dayData.sessions.indexOf(session);
    return `
      <div class="session-card ${isNow ? 'now' : ''}" data-area="${session.area}" onclick="openSessionDetail(${dayData.day}, ${sessionIndex})">
        <button class="reminder-btn ${reminded ? 'active' : ''}" onclick="toggleReminder('${escapedKey}', '${session.title.replace(/'/g, "\\'")}', event)" title="Notificarme">
          ${reminded ? BELL_FILL_SVG : BELL_SVG}
        </button>
        <div class="session-time-block">
          <span class="session-time-text">${session.time} - ${session.end}</span>
          <span class="session-area-tag" data-area="${session.area}">${areaLabel(session.area)}</span>
          ${isNow ? '<span class="now-badge"><span class="now-dot"></span> EN VIVO</span>' : ''}
        </div>
        <div class="session-title-text">${session.title}</div>
        <div class="session-detail">&#128205; ${session.room}</div>
        ${session.moderator ? `<div class="session-detail">&#128100; Moderador: ${session.moderator}</div>` : ''}
        ${session.description ? `<div class="session-detail" style="margin-top:6px; color: var(--gray-600);">${session.description}</div>` : ''}
      </div>
    `;
  }).join('');
}

function openSessionDetail(day, sessionIndex) {
  const dayData = agendaData.find(d => d.day === day);
  const session = dayData && dayData.sessions ? dayData.sessions[sessionIndex] : null;
  const container = document.getElementById('sessionDetailContent');
  if (!dayData || !session || !container) return;

  const moderator = session.moderator ? escapeHTML(session.moderator) : 'Sin moderador asignado';
  const speakerEntries = getSessionSpeakerEntries(session);
  const participantEntries = getSessionParticipantEntries(session, speakerEntries);
  const areaTag = areaLabel(session.area);

  container.innerHTML = `
    <div class="session-detail-header">
      <h2 class="session-detail-title">${escapeHTML(session.title)}</h2>
      <div class="session-detail-meta">${formatDate(dayData.date)} · ${escapeHTML(session.time)} - ${escapeHTML(session.end)}</div>
      <div class="session-detail-meta">📍 ${escapeHTML(session.room)} · <span class="session-area-tag" data-area="${escapeHTML(session.area)}">${escapeHTML(areaTag)}</span></div>
      ${session.description ? `<p class="session-detail-description">${escapeHTML(session.description)}</p>` : ''}
    </div>

    <div class="session-detail-section">
      <h3 class="session-detail-section-title">Moderador</h3>
      <div class="session-detail-list">
        <span class="session-person-chip moderator">${moderator}</span>
      </div>
    </div>

    <div class="session-detail-section">
      <h3 class="session-detail-section-title">Expositores</h3>
      <div class="session-detail-list">
        ${speakerEntries.length ? speakerEntries.map(renderSessionPersonChip).join('') : '<p class="session-detail-empty">No hay expositores asignados para esta sesi&oacute;n.</p>'}
      </div>
    </div>

    <div class="session-detail-section">
      <h3 class="session-detail-section-title">Anotados</h3>
      <div class="session-detail-list">
        ${participantEntries.length ? participantEntries.map(renderSessionPersonChip).join('') : '<p class="session-detail-empty">No hay participantes cargados para esta sesi&oacute;n.</p>'}
      </div>
    </div>
  `;

  if (typeof openModal === 'function') {
    openModal('modalSessionDetail');
  } else {
    document.getElementById('modalSessionDetail')?.classList.remove('hidden');
  }
}

function getSessionSpeakerEntries(session) {
  if (!Array.isArray(session.speakers) || !session.speakers.length) {
    if (!session.area || session.area === 'evento') return [];

    const moderatorName = normalizeText(session.moderator || '');
    const inferred = speakersData
      .filter(s => s.area === session.area)
      .filter(s => (s.institution || '').toLowerCase().includes('rt international institute') || /moderador/i.test(s.specialty || ''))
      .map(s => ({ id: s.id, name: s.name }))
      .filter(p => normalizeText(p.name) !== moderatorName);

    return dedupePersonEntries(inferred);
  }

  const items = session.speakers.map(value => {
    const raw = String(value || '').trim();
    if (!raw) return null;

    const byId = speakersData.find(s => s.id === raw);
    if (byId) return { id: byId.id, name: byId.name };

    const byName = speakersData.find(s => normalizeText(s.name) === normalizeText(raw));
    if (byName) return { id: byName.id, name: byName.name };

    return { id: '', name: raw };
  }).filter(Boolean);

  return dedupePersonEntries(items);
}

function getSessionParticipantEntries(session, speakerEntries) {
  if (Array.isArray(session.participants) && session.participants.length) {
    const manual = session.participants
      .map(name => String(name || '').trim())
      .filter(Boolean)
      .map(name => {
        const match = speakersData.find(s => normalizeText(s.name) === normalizeText(name));
        return match ? { id: match.id, name: match.name } : { id: '', name };
      });
    return dedupePersonEntries(manual);
  }

  if (!session.area || session.area === 'evento') return [];

  const speakerNameSet = new Set(speakerEntries.map(p => normalizeText(p.name)));
  const moderatorName = normalizeText(session.moderator || '');

  const areaPeople = speakersData
    .filter(s => s.area === session.area)
    .map(s => ({ id: s.id, name: s.name }))
    .filter(p => normalizeText(p.name) !== moderatorName)
    .filter(p => !speakerNameSet.has(normalizeText(p.name)));

  return dedupePersonEntries(areaPeople);
}

function renderSessionPersonChip(person) {
  const safeName = escapeHTML(person.name);
  if (person.id && typeof openSpeakerDetail === 'function') {
    return `<button class="session-person-chip speaker" onclick="openSpeakerDetail('${person.id}'); event.stopPropagation();">${safeName}</button>`;
  }
  return `<span class="session-person-chip">${safeName}</span>`;
}

function dedupePersonEntries(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = normalizeText(item.name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function escapeHTML(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isSessionNow(session, dateStr, now) {
  if (!dateStr) return false;
  try {
    const start = new Date(dateStr + 'T' + session.time + ':00');
    const end = new Date(dateStr + 'T' + session.end + ':00');
    return now >= start && now <= end;
  } catch {
    return false;
  }
}

function areaLabel(area) {
  const labels = {
    mama: 'Mama',
    pulmon: 'Pulm\u00f3n',
    prostata: 'Pr\u00f3stata',
    neuro: 'Neuro'
  };
  return labels[area] || area;
}

// ============================================
// SPEAKERS
// ============================================
function filterSpeakers(area) {
  currentSpeakerFilter = area;
  document.querySelectorAll('#speakerFilters .filter-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.area === area);
  });
  renderSpeakers();
}

function filterSpeakersSearch(term) {
  currentSpeakerSearch = (term || '').trim();
  renderSpeakers();
}

function isSpeakerArrivalValidated(speakerId) {
  if (!isArrivalValidated()) return false;
  if (typeof currentProfile === 'undefined' || !currentProfile) return false;
  return currentProfile.speaker_id === speakerId;
}

function renderSpeakers() {
  const container = document.getElementById('speakersList');
  let speakers = speakersData;

  if (currentSpeakerFilter !== 'all') {
    speakers = speakers.filter(s => s.area === currentSpeakerFilter);
  }

  if (currentSpeakerSearch) {
    const term = normalizeText(currentSpeakerSearch);
    speakers = speakers.filter(speaker => {
      const name = normalizeText(speaker.name);
      const specialty = normalizeText(speaker.specialty);
      const institution = normalizeText(speaker.institution);
      return name.includes(term) || specialty.includes(term) || institution.includes(term);
    });
  }

  if (!speakers.length) {
    container.innerHTML = currentSpeakerSearch
      ? '<div class="session-empty">No se encontraron speakers con ese criterio.</div>'
      : '<div class="session-empty">No hay speakers en esta &aacute;rea.</div>';
    return;
  }

  const followed = getFollowedSpeakers();
  const bellSmall = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

  container.innerHTML = speakers.map(speaker => {
    const isFollowed = followed.includes(speaker.id);
    const escapedName = speaker.name.replace(/'/g, "\\'");
    const hasArrivalValidation = isSpeakerArrivalValidated(speaker.id);
    const photoWrapClass = hasArrivalValidation ? 'speaker-photo-wrap speaker-photo-wrap--arrival' : 'speaker-photo-wrap';
    const photoClass = hasArrivalValidation ? 'speaker-photo speaker-photo--arrival' : 'speaker-photo';
    return `
    <div class="speaker-card" onclick="typeof openSpeakerDetail==='function'?openSpeakerDetail('${speaker.id}'):toggleSpeakerBio(this)">
      <div class="${photoWrapClass}">
        ${speaker.photo
          ? `<img src="${BASE_PATH}${speaker.photo}" alt="${speaker.name}" class="${photoClass}" onerror="this.outerHTML=makeInitials('${escapedName}', ${hasArrivalValidation})">`
          : makeInitials(speaker.name, hasArrivalValidation)
        }
        ${speaker.country && typeof COUNTRIES !== 'undefined' ? (() => { const c = COUNTRIES.find(cc => cc.code === speaker.country); return c ? `<span class="speaker-flag-badge">${c.flag}</span>` : ''; })() : ''}
      </div>
      <div class="speaker-name">${speaker.name}</div>
      <div class="speaker-specialty">
        <span class="speaker-area-dot" data-area="${speaker.area}"></span>
        ${speaker.specialty}
      </div>
      <div class="speaker-institution">${speaker.institution}</div>
      <button class="speaker-follow-btn ${isFollowed ? 'active' : ''}" onclick="toggleSpeakerFollow('${speaker.id}', '${escapedName}', event)">
        ${bellSmall} ${isFollowed ? 'Siguiendo' : 'Notificarme'}
      </button>
      ${typeof authEditBtn === 'function' ? authEditBtn(speaker) : ''}
      ${speaker.bio ? `<div class="speaker-bio">${speaker.bio}</div>` : ''}
    </div>
  `}).join('');
}

function makeInitials(name, hasArrivalValidation = false) {
  const parts = name.replace(/Dr\.\s?|Dra\.\s?/i, '').trim().split(' ');
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].substring(0, 2).toUpperCase();
  const cls = hasArrivalValidation ? 'speaker-initials speaker-initials--arrival' : 'speaker-initials';
  return `<div class="${cls}">${initials}</div>`;
}

function toggleSpeakerBio(card) {
  card.classList.toggle('expanded');
}

// ============================================
// LOCATIONS
// ============================================
function renderLocations() {
  const container = document.getElementById('locationsList');

  if (!locationsData.length) {
    container.innerHTML = '<div class="session-empty">No hay ubicaciones cargadas a&uacute;n.</div>';
    return;
  }

  container.innerHTML = locationsData.map(loc => `
    <div class="location-card">
      <div class="location-map">
        ${loc.mapEmbed
          ? `<iframe src="${loc.mapEmbed}" loading="lazy" allowfullscreen referrerpolicy="no-referrer-when-downgrade"></iframe>`
          : loc.mapImage
            ? `<img src="${BASE_PATH}${loc.mapImage}" alt="${loc.name}" style="width:100%;height:100%;object-fit:cover;">`
            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--gray-400);font-size:13px;">Mapa no disponible</div>`
        }
      </div>
      <div class="location-info">
        <div class="location-type">${loc.type}</div>
        <div class="location-name">${loc.name}</div>
        <div class="location-address">${loc.address}</div>
        ${loc.details ? `<p style="font-size:13px;color:var(--gray-600);margin-bottom:12px;">${loc.details}</p>` : ''}
        ${loc.mapsUrl
          ? `<a href="${loc.mapsUrl}" target="_blank" rel="noopener" class="location-link">
              &#128204; Abrir en Google Maps
            </a>`
          : ''
        }
      </div>
    </div>
  `).join('');
}

// ============================================
// NOTIFICATIONS
// ============================================
function renderNotifications() {
  const container = document.getElementById('notificationsList');

  if (!notificationsData.length) {
    container.innerHTML = `
      <div class="notifications-empty">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <p>No hay notificaciones por el momento.</p>
      </div>
    `;
    return;
  }

  // Sort by date/time descending
  const sorted = [...notificationsData].sort((a, b) => {
    const dateA = new Date((a.date || '2026-01-01') + 'T' + (a.time || '00:00'));
    const dateB = new Date((b.date || '2026-01-01') + 'T' + (b.time || '00:00'));
    return dateB - dateA;
  });

  container.innerHTML = sorted.map(notif => `
    <div class="notification-card priority-${notif.priority || 'normal'}">
      <div class="notification-meta">
        ${notif.date ? formatDate(notif.date) : ''}${notif.time ? ' &middot; ' + notif.time : ''}
      </div>
      <div class="notification-title">${notif.title}</div>
      <div class="notification-message">${notif.message}</div>
    </div>
  `).join('');
}

function updateNotifBadge() {
  const badge = document.getElementById('notifBadge');
  const lastRead = parseInt(localStorage.getItem('rtcc_notif_read') || '0');
  const unread = notificationsData.filter(n => n.id > lastRead).length;

  if (unread > 0) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

function markNotificationsRead() {
  if (notificationsData.length) {
    const maxId = Math.max(...notificationsData.map(n => n.id));
    localStorage.setItem('rtcc_notif_read', maxId.toString());
    updateNotifBadge();
  }
}

function showLatestNotifBanner() {
  if (!notificationsData.length) return;

  const lastDismissed = parseInt(localStorage.getItem('rtcc_banner_dismissed') || '0');
  const highPriority = notificationsData
    .filter(n => n.priority === 'high' && n.id > lastDismissed)
    .sort((a, b) => b.id - a.id);

  if (highPriority.length > 0) {
    const latest = highPriority[0];
    document.getElementById('notifBannerText').textContent = latest.title + ': ' + latest.message;
    document.getElementById('notifBanner').classList.remove('hidden');
  }
}

function closeBanner() {
  const banner = document.getElementById('notifBanner');
  banner.classList.add('hidden');
  if (notificationsData.length) {
    const maxId = Math.max(...notificationsData.map(n => n.id));
    localStorage.setItem('rtcc_banner_dismissed', maxId.toString());
  }
}

// ============================================
// NEXT SESSION (Home)
// ============================================
function renderNextSession() {
  const container = document.getElementById('nextSessionContent');
  const now = new Date();

  // Find current or next session across all days
  let nextSession = null;
  let sessionDate = null;

  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      try {
        const start = new Date(day.date + 'T' + session.time + ':00');
        const end = new Date(day.date + 'T' + session.end + ':00');

        // Currently happening
        if (now >= start && now <= end) {
          nextSession = session;
          sessionDate = day.date;
          break;
        }

        // Next upcoming
        if (start > now && (!nextSession || start < new Date(sessionDate + 'T' + nextSession.time + ':00'))) {
          nextSession = session;
          sessionDate = day.date;
        }
      } catch { /* skip invalid */ }
    }
    if (nextSession && isSessionNow(nextSession, sessionDate, now)) break;
  }

  if (!nextSession) {
    container.innerHTML = '<p class="muted">No hay sesiones pr&oacute;ximas programadas.</p>';
    return;
  }

  const isNow = isSessionNow(nextSession, sessionDate, now);
  container.innerHTML = `
    ${isNow ? '<span class="now-badge" style="margin-bottom:8px;"><span class="now-dot"></span> EN VIVO</span>' : ''}
    <div class="session-time">${nextSession.time} - ${nextSession.end}</div>
    <div class="session-title-text">${nextSession.title}</div>
    <div class="session-meta">&#128205; ${nextSession.room} &middot; <span class="session-area-tag" data-area="${nextSession.area}" style="font-size:11px;">${areaLabel(nextSession.area)}</span></div>
  `;
}

// ============================================
// MY SESSIONS (Home)
// ============================================
function renderMySessions() {
  const container = document.getElementById('mySessionsContent');
  if (!container) return;

  const reminders = getReminders();
  const mySpeakerId = (typeof currentProfile !== 'undefined' && currentProfile) ? currentProfile.speaker_id : null;

  // Collect sessions where user has reminder OR is a speaker/moderator
  const mySessions = [];
  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      const key = sessionKey(session, day.date);
      const hasReminder = reminders.includes(key);
      const isSpeaker = mySpeakerId && session.speakers && session.speakers.includes(mySpeakerId);
      if (hasReminder || isSpeaker) {
        mySessions.push({ session, date: day.date, dayLabel: day.label || ('Día ' + day.day), hasReminder, isSpeaker });
      }
    }
  }

  if (!mySessions.length) {
    container.innerHTML = '<p class="muted">Activá la campana en las sesiones que te interesen para verlas acá.</p>';
    return;
  }

  // Sort by date+time
  mySessions.sort((a, b) => (a.date + a.session.time).localeCompare(b.date + b.session.time));

  const now = new Date();
  container.innerHTML = mySessions.map(ev => {
    const isNow = isSessionNow(ev.session, ev.date, now);
    const areaTag = areaLabel(ev.session.area);
    const badges = [];
    const escapedKey = sessionKey(ev.session, ev.date).replace(/'/g, "\\'");
    const escapedTitle = String(ev.session.title || '').replace(/'/g, "\\'");
    if (isNow) badges.push('<span class="now-badge small"><span class="now-dot"></span> EN VIVO</span>');
    if (ev.isSpeaker) badges.push('<span class="my-session-badge speaker">Expositor</span>');
    if (ev.hasReminder) {
      badges.push(`<button class="my-session-reminder-btn" onclick="confirmRemoveMySessionReminder('${escapedKey}', '${escapedTitle}', event)" title="Quitar recordatorio">${BELL_FILL_SVG}</button>`);
    }

    return `
      <div class="my-session-item${isNow ? ' now' : ''}">
        <div class="my-session-time">${ev.session.time} - ${ev.session.end}</div>
        <div class="my-session-info">
          <div class="my-session-title">${ev.session.title}</div>
          <div class="my-session-meta">${ev.dayLabel} · <span class="session-area-tag" data-area="${ev.session.area}" style="font-size:11px;">${areaTag}</span> · 📍 ${ev.session.room}</div>
        </div>
        <div class="my-session-badges">${badges.join('')}</div>
      </div>`;
  }).join('');
}

// ============================================
// COUNTDOWN
// ============================================
function startCountdown() {
  const el = document.getElementById('countdown');
  if (!agendaData.length || !agendaData[0].date) {
    el.textContent = '';
    return;
  }

  const eventDate = new Date(agendaData[0].date + 'T08:00:00');

  function update() {
    const now = new Date();
    const diff = eventDate - now;

    if (diff <= 0) {
      el.textContent = 'El evento est\u00e1 en curso';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) {
      el.textContent = `Faltan ${days} d\u00edas, ${hours}h ${mins}m`;
    } else {
      el.textContent = `Comienza en ${hours}h ${mins}m`;
    }
  }

  update();
  setInterval(update, 60000);
}

// ============================================
// REMINDERS & FOLLOWS
// ============================================
function getReminders() {
  try { return JSON.parse(localStorage.getItem('rtcc_reminders') || '[]'); }
  catch { return []; }
}

function setReminders(arr) {
  localStorage.setItem('rtcc_reminders', JSON.stringify(arr));
}

function getFollowedSpeakers() {
  try { return JSON.parse(localStorage.getItem('rtcc_followed_speakers') || '[]'); }
  catch { return []; }
}

function setFollowedSpeakers(arr) {
  localStorage.setItem('rtcc_followed_speakers', JSON.stringify(arr));
}

function sessionKey(session, dateStr) {
  return dateStr + '|' + session.time + '|' + session.title;
}

function isReminded(session, dateStr) {
  return getReminders().includes(sessionKey(session, dateStr));
}

function toggleReminder(key, sessionTitle, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }

  requestNotifPermission();

  const reminders = getReminders();
  const idx = reminders.indexOf(key);
  if (idx >= 0) {
    reminders.splice(idx, 1);
    showToast('Recordatorio desactivado');
  } else {
    reminders.push(key);
    showToast('Te notificaremos 10 min antes');
  }
  setReminders(reminders);
  renderAgenda();
  renderMySessions();
  if (typeof renderProfileEvents === 'function') renderProfileEvents();
}

function confirmRemoveMySessionReminder(key, sessionTitle, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }

  const title = String(sessionTitle || '').trim();
  const message = title
    ? `¿Querés borrarte de este evento?\n\n${title}`
    : '¿Querés borrarte de este evento?';
  if (!window.confirm(message)) return;

  const reminders = getReminders();
  if (!reminders.includes(key)) return;

  setReminders(reminders.filter(r => r !== key));
  renderAgenda();
  renderMySessions();
  if (typeof renderProfileEvents === 'function') renderProfileEvents();
  showToast('Recordatorio desactivado');
}

function toggleSpeakerFollow(speakerId, speakerName, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }

  requestNotifPermission();

  const followed = getFollowedSpeakers();
  const idx = followed.indexOf(speakerId);
  if (idx >= 0) {
    followed.splice(idx, 1);
    removeSpeakerReminders(speakerId);
    showToast('Dejaste de seguir');
  } else {
    followed.push(speakerId);
    addSpeakerReminders(speakerId);
    showToast('Siguiendo a ' + speakerName);
  }
  setFollowedSpeakers(followed);
  renderSpeakers();
  renderAgenda();
}

function addSpeakerReminders(speakerId) {
  const reminders = getReminders();
  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      if (session.speakers && session.speakers.includes(speakerId)) {
        const key = sessionKey(session, day.date);
        if (!reminders.includes(key)) reminders.push(key);
      }
    }
  }
  setReminders(reminders);
}

function removeSpeakerReminders(speakerId) {
  let reminders = getReminders();
  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      if (session.speakers && session.speakers.includes(speakerId)) {
        const key = sessionKey(session, day.date);
        reminders = reminders.filter(r => r !== key);
      }
    }
  }
  setReminders(reminders);
}

function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function checkReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (localStorage.getItem('rtcc_notif_disabled') === '1') return;

  const now = new Date();
  const reminders = getReminders();
  const notified = JSON.parse(localStorage.getItem('rtcc_notified') || '[]');

  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      const key = sessionKey(session, day.date);
      if (!reminders.includes(key) || notified.includes(key)) continue;

      try {
        const start = new Date(day.date + 'T' + session.time + ':00');
        const diff = start - now;
        // Notify between 10 and 11 minutes before
        if (diff > 0 && diff <= 10 * 60 * 1000 && diff > 9 * 60 * 1000) {
          new Notification('RTCC 2026 - Pr\u00f3xima sesi\u00f3n', {
            body: session.title + '\n' + session.time + ' - ' + session.room,
            icon: BASE_PATH + 'img/logo-convention-gold.png',
            tag: key
          });
          notified.push(key);
          localStorage.setItem('rtcc_notified', JSON.stringify(notified));
        }
      } catch { /* skip */ }
    }
  }
}

// ============================================
// PROFILE: MY EVENTS & NOTIFICATION TOGGLE
// ============================================
function renderProfileEvents() {
  const container = document.getElementById('profileEventsList');
  const toggle = document.getElementById('notifGlobalToggle');
  if (!container) return;

  // Set toggle state
  const notifDisabled = localStorage.getItem('rtcc_notif_disabled') === '1';
  if (toggle) toggle.checked = !notifDisabled;

  const reminders = getReminders();
  if (!reminders.length) {
    container.innerHTML = '<p class="profile-events-empty">No tenés eventos con recordatorio activado.</p>';
    return;
  }

  // Match reminder keys to session data
  const events = [];
  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      const key = sessionKey(session, day.date);
      if (reminders.includes(key)) {
        events.push({ key, session, date: day.date, dayLabel: day.label || day.day });
      }
    }
  }

  if (!events.length) {
    container.innerHTML = '<p class="profile-events-empty">No tenés eventos con recordatorio activado.</p>';
    return;
  }

  // Sort by date+time
  events.sort((a, b) => (a.date + a.session.time).localeCompare(b.date + b.session.time));

  container.innerHTML = events.map(ev => {
    const escapedKey = ev.key.replace(/'/g, "\\'");
    const areaTag = typeof areaLabel === 'function' ? areaLabel(ev.session.area) : ev.session.area;
    return `
      <div class="profile-event-item">
        <div class="profile-event-info">
          <div class="profile-event-title">${ev.session.title}</div>
          <div class="profile-event-meta">${ev.dayLabel} · ${ev.session.time} · ${areaTag}</div>
          <div class="profile-event-meta">📍 ${ev.session.room}${ev.session.moderator ? ` · 👤 ${ev.session.moderator}` : ''}</div>
        </div>
        <button class="profile-event-remove" onclick="removeProfileReminder('${escapedKey}', event)" title="Quitar recordatorio">✕</button>
      </div>`;
  }).join('');
}

function removeProfileReminder(key, event) {
  if (event) event.stopPropagation();
  const reminders = getReminders().filter(r => r !== key);
  setReminders(reminders);
  renderProfileEvents();
  renderAgenda();
  renderMySessions();
  showToast('Recordatorio desactivado');
}

function toggleGlobalNotifications(enabled) {
  if (enabled) {
    localStorage.removeItem('rtcc_notif_disabled');
    requestNotifPermission();
    showToast('Notificaciones activadas');
  } else {
    localStorage.setItem('rtcc_notif_disabled', '1');
    showToast('Notificaciones desactivadas');
  }
}

// ============================================
// ARRIVAL REGISTRATION (QR HANDSHAKE)
// ============================================
function getArrivalHandshake() {
  try {
    return JSON.parse(localStorage.getItem(ARRIVAL_HANDSHAKE_KEY) || 'null');
  } catch {
    return null;
  }
}

function isArrivalValidated() {
  const handshake = getArrivalHandshake();
  return !!(handshake && handshake.code === ARRIVAL_QR_EXPECTED);
}

function formatArrivalTimestamp(value) {
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return value || '';
  }
}

function setArrivalStatus(message, tone = 'info') {
  const status = document.getElementById('arrivalStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.remove('info', 'success', 'error');
  status.classList.add(tone);
}

function updateArrivalFabState() {
  const fab = document.getElementById('arrivalFab');
  if (!fab) return;

  const validated = isArrivalValidated();
  fab.classList.toggle('hidden', validated);
  fab.classList.toggle('verified', validated);
  fab.title = validated ? 'Arribo validado' : 'Registro de arribo';
  fab.setAttribute(
    'aria-label',
    validated
      ? 'Arribo validado. Certificado habilitado para descarga al finalizar el congreso.'
      : 'Registro de arribo al congreso'
  );
}

function updateArrivalStatusUI() {
  const handshake = getArrivalHandshake();
  if (handshake && handshake.code === ARRIVAL_QR_EXPECTED) {
    const when = formatArrivalTimestamp(handshake.verifiedAt);
    const suffix = when ? ` (${when})` : '';
    setArrivalStatus(
      `Arribo validado${suffix}. Tu certificado quedara habilitado para descarga al finalizar el congreso.`,
      'success'
    );
    return;
  }
  setArrivalStatus('Estado: pendiente de validacion. Escanea el QR unico de arribo para habilitar tu certificado.', 'info');
}

function setArrivalScanControls(isScanning) {
  const scanBtn = document.getElementById('arrivalScanBtn');
  const stopBtn = document.getElementById('arrivalStopBtn');

  if (scanBtn) {
    scanBtn.disabled = isScanning;
    scanBtn.textContent = isScanning ? 'Escaneando...' : 'Escanear QR de arribo';
  }
  if (stopBtn) stopBtn.classList.toggle('hidden', !isScanning);
}

function openArrivalModal() {
  updateArrivalStatusUI();
  setArrivalScanControls(false);

  if (typeof openModal === 'function') {
    openModal('modalArrival');
  } else {
    document.getElementById('modalArrival')?.classList.remove('hidden');
  }
}

function closeArrivalModal() {
  stopArrivalScanner(false);
  if (typeof closeModal === 'function') {
    closeModal('modalArrival');
  } else {
    document.getElementById('modalArrival')?.classList.add('hidden');
  }
}

function closeArrivalModalOnBackdrop(event) {
  if (event.target === event.currentTarget) closeArrivalModal();
}

function registerArrivalHandshake(code, method = 'qr_scan') {
  const payload = {
    code,
    method,
    verifiedAt: new Date().toISOString(),
    certificateEnabled: true
  };

  localStorage.setItem(ARRIVAL_HANDSHAKE_KEY, JSON.stringify(payload));
  updateArrivalFabState();
  updateArrivalStatusUI();
  renderSpeakers();
  showToast('Arribo validado. Certificado habilitado al finalizar el congreso.');
}

function handleArrivalScanResult(scannedValue) {
  const value = String(scannedValue || '').trim();
  if (!value) {
    arrivalScanLoopId = requestAnimationFrame(() => scanArrivalLoop());
    return;
  }

  if (value === ARRIVAL_QR_EXPECTED) {
    registerArrivalHandshake(value, 'qr_scan');
    stopArrivalScanner(false);
    return;
  }

  const now = Date.now();
  if (now - arrivalLastInvalidAt > 1500) {
    setArrivalStatus('QR invalido. Escanea el codigo unico oficial de arribo.', 'error');
    arrivalLastInvalidAt = now;
  }

  arrivalScanLoopId = requestAnimationFrame(() => scanArrivalLoop());
}

async function scanArrivalLoop() {
  if (!arrivalScanActive) return;

  const video = document.getElementById('arrivalScannerVideo');
  if (!video || !arrivalDetector) {
    stopArrivalScanner(false);
    return;
  }

  try {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const codes = await arrivalDetector.detect(video);
      if (codes && codes.length) {
        handleArrivalScanResult(codes[0].rawValue);
        return;
      }
    }
  } catch {
    // Ignore transient detector errors and continue scanning.
  }

  arrivalScanLoopId = requestAnimationFrame(() => scanArrivalLoop());
}

async function startArrivalScanner() {
  if (arrivalScanActive) return;

  if (isArrivalValidated()) {
    updateArrivalStatusUI();
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setArrivalStatus('Tu dispositivo no permite abrir la camara desde el navegador.', 'error');
    return;
  }

  if (!('BarcodeDetector' in window)) {
    setArrivalStatus('Tu navegador no soporta lectura QR en tiempo real. Usa Chrome o Edge actualizado.', 'error');
    return;
  }

  try {
    const supportedFormats = await BarcodeDetector.getSupportedFormats();
    if (Array.isArray(supportedFormats) && !supportedFormats.includes('qr_code')) {
      setArrivalStatus('Este navegador no tiene soporte para QR. Usa otro navegador actualizado.', 'error');
      return;
    }
  } catch {
    // If the format check fails, proceed and rely on detector runtime.
  }

  const video = document.getElementById('arrivalScannerVideo');
  const wrap = document.getElementById('arrivalScannerWrap');
  if (!video || !wrap) return;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' }
      },
      audio: false
    });

    arrivalScannerStream = stream;
    video.srcObject = stream;
    await video.play();

    arrivalDetector = new BarcodeDetector({ formats: ['qr_code'] });
    arrivalScanActive = true;
    arrivalLastInvalidAt = 0;

    wrap.classList.remove('hidden');
    setArrivalScanControls(true);
    setArrivalStatus('Escaneando QR de arribo. Enfoca el codigo dentro del recuadro.', 'info');

    scanArrivalLoop();
  } catch (error) {
    stopArrivalScanner(false);
    const denied = String(error && error.name || '').toLowerCase().includes('notallowed');
    setArrivalStatus(
      denied
        ? 'No se otorgo permiso para la camara. Habilitalo para validar tu arribo.'
        : 'No se pudo iniciar la camara. Intenta nuevamente.',
      'error'
    );
  }
}

function stopArrivalScanner(stoppedByUser = false) {
  arrivalScanActive = false;

  if (arrivalScanLoopId) {
    cancelAnimationFrame(arrivalScanLoopId);
    arrivalScanLoopId = null;
  }

  if (arrivalScannerStream) {
    arrivalScannerStream.getTracks().forEach(track => track.stop());
    arrivalScannerStream = null;
  }

  const video = document.getElementById('arrivalScannerVideo');
  if (video) {
    try { video.pause(); } catch {}
    video.srcObject = null;
  }

  const wrap = document.getElementById('arrivalScannerWrap');
  if (wrap) wrap.classList.add('hidden');

  setArrivalScanControls(false);
  if (stoppedByUser && !isArrivalValidated()) {
    setArrivalStatus('Camara detenida. Cuando quieras, escanea el QR de arribo.', 'info');
  }
}

window.addEventListener('pagehide', () => stopArrivalScanner(false));

// TOAST
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  toast.classList.add('show');
  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 2500);
}

// ============================================
// UTILITIES
// ============================================
function formatDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'long' });
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr) {
  try {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-UY', { day: 'numeric', month: 'short' });
  } catch {
    return dateStr;
  }
}

// ============================================
// SERVICE WORKER REGISTRATION
// ============================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(BASE_PATH + 'sw.js').catch(() => {});
  });
}

// ============================================
// PULL TO REFRESH
// ============================================
(function() {
  let startY = 0;
  let pulling = false;
  let currentPull = 0;
  const threshold = 90;
  const maxPull = 120;
  const defaultText = '\u21bb Solt\u00e1 para actualizar';
  const prePullText = '\u21bb Desliz\u00e1 para actualizar';
  const triggerText = '\u21bb Solt\u00e1 para actualizar';
  const refreshingText = 'Actualizando...';
  let indicator = null;

  function getIndicator() {
    if (!indicator) {
      indicator = document.getElementById('pullToRefreshIndicator');
      if (indicator) indicator.textContent = defaultText;
    }
    return indicator;
  }

  function isAtTop() {
    const scrollTop = Math.max(
      window.scrollY || 0,
      document.documentElement.scrollTop || 0,
      document.body.scrollTop || 0
    );
    return scrollTop <= 2;
  }

  function hasOpenModal() {
    return !!document.querySelector('.modal-backdrop:not(.hidden)');
  }

  function hideIndicator(delay = 200) {
    const el = getIndicator();
    if (!el) return;
    el.style.transform = 'translateY(0)';
    el.style.opacity = '0';
    el.textContent = defaultText;
    setTimeout(() => el.classList.add('hidden'), delay);
  }

  function showIndicator(pullDistance) {
    const el = getIndicator();
    if (!el) return;
    const progress = Math.min(pullDistance / threshold, 1);
    el.style.transform = `translateY(${Math.min(pullDistance * 0.45, 56)}px)`;
    el.style.opacity = String(Math.max(0.12, progress));
    el.textContent = pullDistance >= threshold ? triggerText : prePullText;
    el.classList.remove('hidden');
  }

  function triggerRefresh() {
    const el = getIndicator();
    if (!el) {
      window.location.reload();
      return;
    }
    el.textContent = refreshingText;
    el.style.transform = 'translateY(40px)';
    el.style.opacity = '1';
    setTimeout(() => window.location.reload(), 250);
  }

  function endPull() {
    if (!pulling) return;
    const shouldRefresh = currentPull >= threshold;
    pulling = false;
    if (shouldRefresh) {
      triggerRefresh();
    } else {
      hideIndicator();
    }
    currentPull = 0;
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (!isAtTop() || hasOpenModal()) return;
    startY = e.touches[0].clientY;
    currentPull = 0;
    pulling = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!pulling) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || !isAtTop()) {
      pulling = false;
      hideIndicator(0);
      currentPull = 0;
      return;
    }
    currentPull = Math.min(dy, maxPull);
    e.preventDefault();
    showIndicator(currentPull);
  }, { passive: false });

  document.addEventListener('touchend', endPull, { passive: true });
  document.addEventListener('touchcancel', endPull, { passive: true });
})();
