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

// Base path for data files (adjust for GitHub Pages subdirectory)
const BASE_PATH = (() => {
  const path = window.location.pathname;
  if (path.includes('/webapp/')) {
    return path.substring(0, path.indexOf('/webapp/') + '/webapp/'.length);
  }
  if (path.endsWith('/')) return path;
  return path.substring(0, path.lastIndexOf('/') + 1);
})();

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
  updateNotifBadge();
  showLatestNotifBanner();
  startCountdown();
  checkReminders();
  setInterval(checkReminders, 60000);

  // Check for hash navigation
  const hash = window.location.hash.replace('#', '');
  if (hash && document.getElementById('page-' + hash)) {
    navigateTo(hash, false);
  }
}

// ============================================
// NAVIGATION
// ============================================
function navigateTo(page, updateHash = true) {
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

  // Mark notifications as read
  if (page === 'notifications') {
    markNotificationsRead();
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
  const bellSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;
  const bellFillSvg = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0" fill="none" stroke-width="2"/></svg>`;

  container.innerHTML = sessions.map(session => {
    const isNow = isSessionNow(session, dayData.date, now);
    const key = sessionKey(session, dayData.date);
    const reminded = isReminded(session, dayData.date);
    const escapedKey = key.replace(/'/g, "\\'");
    return `
      <div class="session-card ${isNow ? 'now' : ''}" data-area="${session.area}">
        <button class="reminder-btn ${reminded ? 'active' : ''}" onclick="toggleReminder('${escapedKey}', '${session.title.replace(/'/g, "\\'")}', event)" title="Notificarme">
          ${reminded ? bellFillSvg : bellSvg}
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

function renderSpeakers() {
  const container = document.getElementById('speakersList');
  let speakers = speakersData;

  if (currentSpeakerFilter !== 'all') {
    speakers = speakers.filter(s => s.area === currentSpeakerFilter);
  }

  if (!speakers.length) {
    container.innerHTML = '<div class="session-empty">No hay speakers en esta &aacute;rea.</div>';
    return;
  }

  const followed = getFollowedSpeakers();
  const bellSmall = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`;

  container.innerHTML = speakers.map(speaker => {
    const isFollowed = followed.includes(speaker.id);
    const escapedName = speaker.name.replace(/'/g, "\\'");
    return `
    <div class="speaker-card" onclick="toggleSpeakerBio(this)">
      ${speaker.photo
        ? `<img src="${BASE_PATH}${speaker.photo}" alt="${speaker.name}" class="speaker-photo" onerror="this.outerHTML=makeInitials('${escapedName}')">`
        : makeInitials(speaker.name)
      }
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

function makeInitials(name) {
  const parts = name.replace(/Dr\.\s?|Dra\.\s?/i, '').trim().split(' ');
  const initials = parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].substring(0, 2).toUpperCase();
  return `<div class="speaker-initials">${initials}</div>`;
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
