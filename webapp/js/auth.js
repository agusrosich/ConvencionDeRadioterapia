/* ============================================
   RTCC 2026 - Auth + Profile Module
   Requires: @supabase/supabase-js v2 (CDN)
   Loaded after app.js — uses globals:
     speakersData, renderSpeakers(), showToast()
   ============================================ */

// --- CONFIGURATION ---
// TODO: Replace with your Supabase project values
const SUPABASE_URL  = 'https://csknrwrqyrmblzqfnzju.supabase.co';
const SUPABASE_ANON = 'sb_publishable_JKEUYfYuxUPD8ohiA2QtVw_1gfeUEx8';
const AUTH_REDIRECT_URL = 'https://rtconvention.lat';

// --- MODULE STATE ---
let supabaseClient   = null;
let currentUser      = null;
let currentProfile   = null;   // Row from public.profiles
let pendingPhotoBlob = null;   // Compressed JPEG before upload
let claimedSpeakerIds = new Set(); // Already claimed speaker_ids
let lastAuthEmail = '';

// Latin American + common countries for radiotherapy convention
const COUNTRIES = [
  { code: 'UY', name: 'Uruguay', prefix: '+598', flag: '🇺🇾' },
  { code: 'AR', name: 'Argentina', prefix: '+54', flag: '🇦🇷' },
  { code: 'BR', name: 'Brasil', prefix: '+55', flag: '🇧🇷' },
  { code: 'CL', name: 'Chile', prefix: '+56', flag: '🇨🇱' },
  { code: 'CO', name: 'Colombia', prefix: '+57', flag: '🇨🇴' },
  { code: 'MX', name: 'México', prefix: '+52', flag: '🇲🇽' },
  { code: 'PY', name: 'Paraguay', prefix: '+595', flag: '🇵🇾' },
  { code: 'PE', name: 'Perú', prefix: '+51', flag: '🇵🇪' },
  { code: 'BO', name: 'Bolivia', prefix: '+591', flag: '🇧🇴' },
  { code: 'EC', name: 'Ecuador', prefix: '+593', flag: '🇪🇨' },
  { code: 'VE', name: 'Venezuela', prefix: '+58', flag: '🇻🇪' },
  { code: 'PA', name: 'Panamá', prefix: '+507', flag: '🇵🇦' },
  { code: 'CR', name: 'Costa Rica', prefix: '+506', flag: '🇨🇷' },
  { code: 'CU', name: 'Cuba', prefix: '+53', flag: '🇨🇺' },
  { code: 'DO', name: 'Rep. Dominicana', prefix: '+1', flag: '🇩🇴' },
  { code: 'GT', name: 'Guatemala', prefix: '+502', flag: '🇬🇹' },
  { code: 'HN', name: 'Honduras', prefix: '+504', flag: '🇭🇳' },
  { code: 'SV', name: 'El Salvador', prefix: '+503', flag: '🇸🇻' },
  { code: 'NI', name: 'Nicaragua', prefix: '+505', flag: '🇳🇮' },
  { code: 'PR', name: 'Puerto Rico', prefix: '+1', flag: '🇵🇷' },
  { code: 'ES', name: 'España', prefix: '+34', flag: '🇪🇸' },
  { code: 'US', name: 'Estados Unidos', prefix: '+1', flag: '🇺🇸' },
  { code: 'PT', name: 'Portugal', prefix: '+351', flag: '🇵🇹' },
  { code: 'IT', name: 'Italia', prefix: '+39', flag: '🇮🇹' },
  { code: 'FR', name: 'Francia', prefix: '+33', flag: '🇫🇷' },
  { code: 'DE', name: 'Alemania', prefix: '+49', flag: '🇩🇪' },
];

// Crop state
const cropState = {
  naturalW: 0,
  naturalH: 0,
  scale: 1,
  fitScale: 1,
  offsetX: 0,
  offsetY: 0,
  viewportSize: 0,
  isDragging: false,
  lastX: 0,
  lastY: 0,
  lastDist: 0,
};

// ============================================
// BOOT
// ============================================
// Show auth wall or app depending on auth state, coordinating with splash
function authRevealAfterSplash(isLoggedIn) {
  const doReveal = () => {
    if (isLoggedIn) {
      revealApp();
    } else {
      showAuthWall();
    }
  };
  if (window.splashDone) {
    doReveal();
  } else {
    window._pendingAuthReveal = doReveal;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Guard: if Supabase SDK didn't load, skip gracefully
  if (typeof supabase === 'undefined') {
    console.warn('Auth: Supabase SDK not loaded. Auth features disabled.');
    authRevealAfterSplash(false);
    return;
  }

  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

  // Check existing session
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    currentUser = session.user;
    await loadCurrentProfile();
  }
  updateAuthButton();

  // Admin nav + push notifications on initial load
  if (typeof showAdminNavIfAllowed === 'function') showAdminNavIfAllowed();
  if (typeof loadPushNotifications === 'function') loadPushNotifications();
  if (typeof setupAdminPreview === 'function') setupAdminPreview();

  // Reveal app or auth wall based on session
  authRevealAfterSplash(!!session);

  // Listen for future auth changes
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    if (event === 'SIGNED_IN') {
      await loadCurrentProfile();
      await loadAllEnrollments();
      refreshEnrollmentUI();
      updateAuthButton();
      // Reveal app on login
      revealApp();
      if (!currentProfile) {
        closeModal('modalAuth');
        openClaimModal();
      } else {
        closeModal('modalAuth');
        showToast('Bienvenido/a de nuevo');
      }
      // Admin panel
      if (typeof showAdminNavIfAllowed === 'function') showAdminNavIfAllowed();
      if (typeof loadPushNotifications === 'function') loadPushNotifications();
    } else if (event === 'SIGNED_OUT') {
      currentProfile = null;
      updateAuthButton();
      if (typeof renderSpeakers === 'function') renderSpeakers();
      if (typeof showAdminNavIfAllowed === 'function') showAdminNavIfAllowed();
      // Show auth wall on logout
      const wall = document.getElementById('authWall');
      wall.classList.remove('hidden', 'fade-out');
      document.getElementById('app').classList.add('hidden');
    }
  });

  // Load all Supabase profiles and merge over JSON data
  await loadAndMergeSupabaseProfiles();
  await loadAttendees();
  await loadAllEnrollments();
  refreshEnrollmentUI();

  // Auto-activate reminders for speakers
  autoActivateSpeakerReminders();
});

// ============================================
// SUPABASE PROFILE MERGE
// ============================================
function normalizePersonKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/dr\.?\s*|dra\.?\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function getSpeakerNameIndex() {
  const map = new Map();
  if (!Array.isArray(speakersData)) return map;

  speakersData.forEach(speaker => {
    if (!speaker || !speaker.id) return;
    const key = normalizePersonKey(speaker.name);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(speaker.id);
  });

  return map;
}

function findSpeakerIdByProfileName(profile, speakerNameIndex = null) {
  if (!profile) return null;
  const index = speakerNameIndex || getSpeakerNameIndex();
  const fullName = buildFullName(profile.name, profile.lastname);
  const key = normalizePersonKey(fullName);
  if (!key) return null;
  const matches = index.get(key) || [];
  if (matches.length !== 1) return null;
  return matches[0];
}

function findSpeakerIdByAlias(profileNameKey) {
  if (!profileNameKey) return null;
  const aliases = {
    'mathias jeldres': 'speaker-046',
    'mathias jeldrez': 'speaker-046',
    'matias jeldres': 'speaker-046',
    'matias jeldrez': 'speaker-046',
    'ester sanchez': 'speaker-076',
    'esther sanchez': 'speaker-076',
    'ester sanchez valdez': 'speaker-076',
    'esther sanchez valdez': 'speaker-076',
    'federico salle': 'speaker-074',
    'federico salles': 'speaker-074',
    'osmar telles': 'speaker-023',
    'osmar tellis': 'speaker-023',
    'pablo castropena': 'speaker-030',
    'pablo castro pena': 'speaker-030',
    'virginia rodriguez': 'speaker-011',
  };
  return aliases[profileNameKey] || null;
}

function resolveProfileSpeakerId(profile, speakerNameIndex = null) {
  if (!profile) return null;
  const index = speakerNameIndex || getSpeakerNameIndex();
  const profileNameKey = normalizePersonKey(buildFullName(profile.name, profile.lastname));
  const aliasMatch = findSpeakerIdByAlias(profileNameKey);
  if (aliasMatch) return aliasMatch;

  const rawSpeakerId = String(profile.speaker_id || '').trim();
  if (rawSpeakerId && Array.isArray(speakersData)) {
    const speakerById = speakersData.find(s => s.id === rawSpeakerId);
    if (speakerById) {
      if (!profileNameKey) return rawSpeakerId;

      const idNameKey = normalizePersonKey(speakerById.name);
      if (profileNameKey === idNameKey) return rawSpeakerId;

      const nameMatchedId = findSpeakerIdByProfileName(profile, index);
      if (nameMatchedId) return nameMatchedId;
      return null;
    }
  }
  return findSpeakerIdByProfileName(profile, index);
}

function withResolvedSpeakerId(profile, speakerNameIndex = null) {
  if (!profile) return profile;
  return {
    ...profile,
    _resolvedSpeakerId: resolveProfileSpeakerId(profile, speakerNameIndex) || null,
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

function profileCompletenessScore(profile) {
  if (!profile) return 0;
  let score = 0;
  if (hasValue(profile.user_id)) score += 5;
  if (hasValue(profile._resolvedSpeakerId)) score += 4;
  if (hasValue(profile.photo_url)) score += 2;
  if (hasValue(profile.bio)) score += 2;
  if (profile.visibility && Object.keys(profile.visibility).length) score += 1;

  const fields = ['name', 'lastname', 'country', 'institution', 'specialty', 'phone', 'email', 'room_number'];
  fields.forEach(field => {
    if (hasValue(profile[field])) score += 1;
  });

  return score;
}

function mergeProfileRows(preferred, other) {
  if (!preferred) return other;
  if (!other) return preferred;

  const merged = {
    ...other,
    ...preferred,
  };

  const fields = ['name', 'lastname', 'country', 'institution', 'specialty', 'phone', 'email', 'bio', 'photo_url', 'room_number'];
  fields.forEach(field => {
    merged[field] = hasValue(preferred[field]) ? preferred[field] : (other[field] || '');
  });

  merged.user_id = hasValue(preferred.user_id) ? preferred.user_id : (other.user_id || '');
  merged.speaker_id = hasValue(preferred.speaker_id) ? preferred.speaker_id : (other.speaker_id || '');
  merged.hotel_stay = preferred.hotel_stay;
  if (merged.hotel_stay === null || merged.hotel_stay === undefined) {
    merged.hotel_stay = other.hotel_stay;
  }

  merged.visibility = {
    ...(other.visibility || {}),
    ...(preferred.visibility || {}),
  };
  merged._resolvedSpeakerId = preferred._resolvedSpeakerId || other._resolvedSpeakerId || null;

  return merged;
}

function mergeProfilesByResolvedSpeakerId(profiles) {
  const bySpeaker = new Map();
  const passthrough = [];

  (profiles || []).forEach((profile, index) => {
    if (!profile) return;

    const resolvedId = profile._resolvedSpeakerId || null;
    if (!resolvedId) {
      passthrough.push({
        ...profile,
        _mergeKey: profile.user_id || `standalone-${index}`,
      });
      return;
    }

    const existing = bySpeaker.get(resolvedId);
    if (!existing) {
      bySpeaker.set(resolvedId, {
        ...profile,
        _mergeKey: profile.user_id || `speaker-${resolvedId}`,
      });
      return;
    }

    const existingScore = profileCompletenessScore(existing);
    const currentScore = profileCompletenessScore(profile);
    const preferred = currentScore >= existingScore ? profile : existing;
    const other = preferred === profile ? existing : profile;
    const merged = mergeProfileRows(preferred, other);
    merged._resolvedSpeakerId = resolvedId;
    merged._mergeKey = merged.user_id || existing._mergeKey || `speaker-${resolvedId}`;
    bySpeaker.set(resolvedId, merged);
  });

  return [...bySpeaker.values(), ...passthrough];
}

function getCurrentProfileSpeakerId() {
  if (!currentProfile) return null;
  if (currentProfile._resolvedSpeakerId) return currentProfile._resolvedSpeakerId;
  currentProfile = withResolvedSpeakerId(currentProfile, getSpeakerNameIndex());
  return currentProfile._resolvedSpeakerId;
}

async function loadAndMergeSupabaseProfiles() {
  if (!supabaseClient) return;

  try {
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('user_id, speaker_id, name, lastname, country, institution, specialty, phone, email, bio, photo_url, visibility, hotel_stay, room_number');

    if (error) throw error;
    claimedSpeakerIds.clear();
    if (!profiles || !profiles.length) return;

    const speakerNameIndex = getSpeakerNameIndex();
    const normalizedProfiles = profiles.map(profile => withResolvedSpeakerId(profile, speakerNameIndex));
    const mergedProfiles = mergeProfilesByResolvedSpeakerId(normalizedProfiles);

    mergedProfiles.forEach(prof => {
      const speakerId = prof._resolvedSpeakerId;
      if (!speakerId) return;
      claimedSpeakerIds.add(speakerId);

      const idx = speakersData.findIndex(s => s.id === speakerId);
      if (idx === -1) return;

      const base = speakersData[idx];
      const fullName = buildFullName(prof.name, prof.lastname);
      speakersData[idx] = {
        ...base,
        name:        fullName || base.name,
        country:     prof.country     || base.country,
        institution: prof.institution || base.institution,
        specialty:   prof.specialty   || base.specialty,
        phone:       prof.phone       || base.phone,
        email:       prof.email       || base.email,
        bio:         prof.bio         || base.bio,
        photo:       prof.photo_url   || base.photo,
        visibility:  prof.visibility  || base.visibility || {},
        _claimed:    true,
      };
    });

    if (currentProfile) {
      currentProfile = withResolvedSpeakerId(currentProfile, speakerNameIndex);
    }

    if (typeof renderSpeakers === 'function') renderSpeakers();
  } catch (e) {
    console.warn('Auth: Could not load profiles:', e.message);
  }
}

async function loadCurrentProfile() {
  if (!supabaseClient || !currentUser) return;

  const { data } = await supabaseClient
    .from('profiles')
    .select('*')
    .eq('user_id', currentUser.id)
    .single();

  currentProfile = withResolvedSpeakerId(data, getSpeakerNameIndex());
}

function buildFullName(name, lastname) {
  return [name, lastname].filter(Boolean).join(' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// AUTH BUTTON
// ============================================
function updateAuthButton() {
  const btn   = document.getElementById('authBtn');
  const label = document.getElementById('authBtnLabel');
  if (!btn) return;

  if (currentUser && currentProfile) {
    btn.classList.add('logged-in');
    const displayName = currentProfile.name || currentUser.email.split('@')[0];
    label.textContent = displayName.length > 12
      ? displayName.substring(0, 11) + '\u2026'
      : displayName;
  } else if (currentUser && !currentProfile) {
    btn.classList.add('logged-in');
    label.textContent = 'Vincular';
  } else {
    btn.classList.remove('logged-in');
    label.textContent = 'Acceder';
  }
}

// ============================================
// AUTH MODAL (Login / Register)
// ============================================
function openAuthModal() {
  if (currentUser && currentProfile) {
    openProfileModal();
    return;
  }
  if (currentUser && !currentProfile) {
    openClaimModal();
    return;
  }
  openModal('modalAuth');
  switchAuthTab('login');
}

function togglePasswordVisibility(btn) {
  const input = btn.parentElement.querySelector('input');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.querySelector('.eye-icon').classList.toggle('hidden', isPassword);
  btn.querySelector('.eye-off-icon').classList.toggle('hidden', !isPassword);
}

function switchAuthTab(tab) {
  document.getElementById('formLogin').classList.toggle('hidden', tab !== 'login');
  document.getElementById('formRegister').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tabLogin').classList.toggle('active', tab === 'login');
  document.getElementById('tabRegister').classList.toggle('active', tab !== 'login');
  clearFormErrors();
}

async function handleLogin(event) {
  event.preventDefault();
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const btn      = document.getElementById('loginSubmit');
  const safeEmail = escapeHtml(email);

  if (email) lastAuthEmail = email;
  setButtonLoading(btn, true, 'Ingresando...');
  clearFormErrors();

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  setButtonLoading(btn, false, 'Ingresar');
  if (error) {
    showFormError('loginError', translateAuthError(error.message));
    if (error.message.includes('Email not confirmed')) {
      showFormInfo(
        'loginInfo',
        `Si no recibiste el correo de confirmacion para <strong>${safeEmail}</strong>, usa el boton "Reenviar confirmacion".`
      );
    }
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const rawName         = document.getElementById('registerName').value.trim();
  const rawLastname     = document.getElementById('registerLastname').value.trim();
  const email           = document.getElementById('registerEmail').value.trim();
  const password        = document.getElementById('registerPassword').value;
  const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
  const btn             = document.getElementById('registerSubmit');
  const safeEmail = escapeHtml(email);

  if (email) lastAuthEmail = email;
  clearFormErrors();

  if (!rawName || !rawLastname) {
    showFormError('registerError', 'Complet\u00e1 tu nombre y apellido.');
    return;
  }

  if (password !== passwordConfirm) {
    showFormError('registerError', 'Las contrase\u00f1as no coinciden');
    return;
  }

  const registerName     = toTitleCase(rawName);
  const registerLastname = toTitleCase(rawLastname);

  setButtonLoading(btn, true, 'Creando cuenta...');

  // Check email uniqueness against existing profiles
  const { data: existingProfiles } = await supabaseClient
    .from('profiles')
    .select('email')
    .eq('email', email);

  if (existingProfiles && existingProfiles.length > 0) {
    setButtonLoading(btn, false, 'Crear cuenta');
    showFormError('registerError', 'Este email ya est\u00e1 registrado por otro usuario.');
    return;
  }

  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: AUTH_REDIRECT_URL,
      data: { name: registerName, lastname: registerLastname }
    }
  });

  setButtonLoading(btn, false, 'Crear cuenta');
  if (error) {
    const translated = translateAuthError(error.message);
    if (translated === 'already_registered') {
      showAlreadyRegisteredError(email);
    } else {
      showFormError('registerError', translated);
    }
  } else {
    // Store name temporarily so claim modal can use it
    window._registerNameData = { name: registerName, lastname: registerLastname };
    showFormInfo(
      'registerInfo',
      `Te enviamos un email a <strong>${safeEmail}</strong> con el enlace para confirmar tu cuenta.<br>` +
      'Si no llega en 1-2 minutos, revisa spam o usa "Reenviar confirmacion".'
    );
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  currentUser    = null;
  currentProfile = null;
  closeModal('modalProfile');
  updateAuthButton();
  if (typeof renderSpeakers === 'function') renderSpeakers();
  showToast('Sesi\u00f3n cerrada');
}

function translateAuthError(msg) {
  if (msg.includes('Invalid login'))      return 'Email o contrase\u00f1a incorrectos.';
  if (msg.includes('Email not confirmed'))return 'Confirma tu email antes de ingresar.';
  if (msg.includes('already registered')) return 'already_registered';
  if (msg.includes('Password should be')) return 'La contrase\u00f1a debe tener al menos 6 caracteres.';
  if (msg.includes('rate limit'))         return 'Esper\u00e1 un momento antes de volver a intentar.';
  return msg;
}

async function handleForgotPassword() {
  const email = document.getElementById('loginEmail').value.trim();
  const safeEmail = escapeHtml(email);
  if (!email) {
    showFormError('loginError', 'Ingres\u00e1 tu email primero para recuperar la contrase\u00f1a.');
    return;
  }
  lastAuthEmail = email;

  const btn = document.getElementById('forgotPasswordBtn');
  setButtonLoading(btn, true, 'Enviando...');
  clearFormErrors();

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: AUTH_REDIRECT_URL,
  });

  setButtonLoading(btn, false, '\u00bfOlvidaste tu contrase\u00f1a?');

  if (error) {
    showFormError('loginError', error.message.includes('rate limit')
      ? 'Demasiados intentos. Esper\u00e1 un momento.'
      : 'Error al enviar el email. Intent\u00e1 de nuevo.');
    return;
  }

  showFormInfo(
    'loginInfo',
    `Te enviamos un enlace de recuperacion a <strong>${safeEmail}</strong>.<br>` +
    'Si no aparece, revisa spam o promociones.'
  );
}

async function handleResendConfirmation(source = 'login') {
  const isRegister = source === 'register';
  const emailInput = document.getElementById(isRegister ? 'registerEmail' : 'loginEmail');
  const errorId = isRegister ? 'registerError' : 'loginError';
  const infoId = isRegister ? 'registerInfo' : 'loginInfo';
  const btnId = isRegister ? 'resendRegisterConfirmBtn' : 'resendLoginConfirmBtn';
  const email = (emailInput?.value || lastAuthEmail || '').trim();

  if (!email) {
    showFormError(errorId, 'Ingresa tu email para reenviar la confirmacion.');
    return;
  }

  lastAuthEmail = email;
  clearFormErrors();

  const btn = document.getElementById(btnId);
  if (btn) setButtonLoading(btn, true, 'Enviando...');

  const { error } = await supabaseClient.auth.resend({
    type: 'signup',
    email,
    options: { emailRedirectTo: AUTH_REDIRECT_URL },
  });

  if (btn) setButtonLoading(btn, false, 'Reenviar confirmaci\u00f3n');

  if (error) {
    showFormError(
      errorId,
      error.message.includes('rate limit')
        ? 'Demasiados intentos. Espera un momento antes de reenviar.'
        : 'No se pudo reenviar el email de confirmacion. Intenta de nuevo.'
    );
    return;
  }

  showFormInfo(
    infoId,
    `Reenviamos el correo de confirmacion a <strong>${escapeHtml(email)}</strong>.<br>` +
    'Revisa tambien spam o promociones.'
  );
}

function showAlreadyRegisteredError(email) {
  const errorEl = document.getElementById('registerError');
  if (!errorEl) return;
  errorEl.innerHTML = `
    Ya existe una cuenta con <strong>${email}</strong>.<br>
    <a href="#" class="auth-feedback-link" onclick="switchAuthTab('login'); document.getElementById('loginEmail').value='${email}'; return false;">Inici\u00e1 sesi\u00f3n</a>
    o
    <a href="#" class="auth-feedback-link" onclick="switchAuthTab('login'); document.getElementById('loginEmail').value='${email}'; handleForgotPassword(); return false;">recuper\u00e1 tu contrase\u00f1a</a>.
  `;
  errorEl.classList.remove('hidden');
}

// ============================================
// CLAIM MODAL
// ============================================
function openClaimModal() {
  const select = document.getElementById('claimSelect');
  const claimBtn = document.getElementById('claimSubmit');
  const createBtn = document.getElementById('claimCreateSubmit');
  select.innerHTML = '<option value="">-- Seleccionar --</option>';
  if (claimBtn) setButtonLoading(claimBtn, false, 'Vincular perfil');
  if (createBtn) setButtonLoading(createBtn, false, 'No encuentro mi perfil');

  const unclaimed = speakersData
    .filter(s => !claimedSpeakerIds.has(s.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  unclaimed.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.name + (s.specialty ? ' \u2014 ' + s.specialty : '');
    select.appendChild(opt);
  });

  clearFormErrors();
  openModal('modalClaim');
}

async function handleClaim() {
  const speakerId = document.getElementById('claimSelect').value;
  if (!speakerId) {
    showFormError('claimError', 'Por favor seleccion\u00e1 tu nombre.');
    return;
  }

  await createProfileFromClaimChoice(speakerId);
}

async function handleCreateOwnProfile() {
  await createProfileFromClaimChoice('');
}

async function createProfileFromClaimChoice(speakerId) {
  if (!supabaseClient || !currentUser) {
    showFormError('claimError', 'No se pudo crear el perfil. Inici\u00e1 sesi\u00f3n de nuevo.');
    return;
  }

  const claimBtn = document.getElementById('claimSubmit');
  const createBtn = document.getElementById('claimCreateSubmit');
  const isClaiming = !!speakerId;
  const activeBtn = isClaiming ? claimBtn : createBtn;
  const idleLabel = isClaiming ? 'Vincular perfil' : 'No encuentro mi perfil';
  const loadingLabel = isClaiming ? 'Vinculando...' : 'Creando...';

  if (activeBtn) setButtonLoading(activeBtn, true, loadingLabel);
  if (isClaiming && createBtn) createBtn.disabled = true;
  if (!isClaiming && claimBtn) claimBtn.disabled = true;
  clearFormErrors();

  const baseSpeaker = speakerId ? speakersData.find(s => s.id === speakerId) : null;
  const regData = window._registerNameData || {};
  const metaName = currentUser.user_metadata?.name || '';
  const metaLastname = currentUser.user_metadata?.lastname || '';
  const fallbackName = (currentUser.user_metadata?.full_name || metaName || '').trim();
  const fallbackFromEmail = (currentUser.email || '').split('@')[0].replace(/[._-]+/g, ' ').trim();
  const nameParts = splitName(baseSpeaker?.name || fallbackName || fallbackFromEmail || 'Participante');

  const finalName = regData.name || (baseSpeaker ? nameParts.name : toTitleCase(nameParts.name)) || 'Participante';
  const finalLastname = regData.lastname || metaLastname || (baseSpeaker ? nameParts.lastname : toTitleCase(nameParts.lastname));

  const payload = {
    user_id: currentUser.id,
    speaker_id: speakerId || null,
    name: finalName,
    lastname: finalLastname,
    institution: baseSpeaker?.institution || '',
    specialty: baseSpeaker?.specialty || '',
    email: currentUser.email,
    bio: baseSpeaker?.bio || '',
    photo_url: baseSpeaker?.photo || '',
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .insert(payload)
    .select()
    .single();

  if (activeBtn) setButtonLoading(activeBtn, false, idleLabel);
  if (claimBtn) claimBtn.disabled = false;
  if (createBtn) createBtn.disabled = false;

  if (error) {
    if (error.code === '23505') {
      showFormError('claimError', isClaiming
        ? 'Este perfil ya fue vinculado por otra cuenta.'
        : 'Tu cuenta ya tiene un perfil creado.');
    } else {
      showFormError('claimError', 'Error al crear el perfil: ' + error.message);
    }
    return;
  }

  currentProfile = withResolvedSpeakerId(data, getSpeakerNameIndex());
  closeModal('modalClaim');
  await loadAndMergeSupabaseProfiles();
  updateAuthButton();
  showToast(isClaiming ? 'Perfil vinculado. Ya pod\u00e9s editarlo.' : 'Perfil creado. Complet\u00e1 tus datos.');
  openProfileModal();
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { name: parts[0] || '', lastname: '' };
  return { name: parts[0], lastname: parts.slice(1).join(' ') };
}

function toTitleCase(str) {
  return str.trim().replace(/\s+/g, ' ')
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

// ============================================
// PROFILE EDIT MODAL
// ============================================
function openProfileModal() {
  if (!currentProfile) return;

  populateCountrySelect();

  document.getElementById('profileName').value        = currentProfile.name        || '';
  document.getElementById('profileLastname').value    = currentProfile.lastname     || '';
  document.getElementById('profileCountry').value     = currentProfile.country      || '';
  document.getElementById('profileInstitution').value = currentProfile.institution  || '';
  document.getElementById('profileSpecialty').value   = currentProfile.specialty    || '';

  // Strip country prefix from stored phone for display
  let phoneDisplay = currentProfile.phone || '';
  if (currentProfile.country) {
    const c = COUNTRIES.find(cc => cc.code === currentProfile.country);
    if (c && phoneDisplay.startsWith(c.prefix)) {
      phoneDisplay = phoneDisplay.slice(c.prefix.length).trim();
    }
  }
  document.getElementById('profilePhone').value       = phoneDisplay;
  document.getElementById('profileEmail').value       = currentProfile.email        || '';
  document.getElementById('profileBio').value         = currentProfile.bio          || '';

  // Hotel fields
  const hotelStay = currentProfile.hotel_stay !== false && currentProfile.hotel_stay !== null;
  setHotelStay(currentProfile.hotel_stay === true);
  document.getElementById('profileRoomNumber').value = currentProfile.room_number || '';

  updatePhonePrefix();
  setVisibilitySettings(currentProfile.visibility);
  renderProfilePhotoPreview(currentProfile.photo_url);
  pendingPhotoBlob = null;
  clearFormErrors();
  if (typeof renderProfileEvents === 'function') renderProfileEvents();
  updateCertificateSection();
  openModal('modalProfile');
}

// ============================================
// CERTIFICATE SECTION
// ============================================
function updateCertificateSection() {
  const btn = document.getElementById('certificateDownloadBtn');
  const instructions = document.getElementById('certificateInstructions');
  if (!btn || !instructions) return;

  const arrivalDone = typeof isArrivalValidated === 'function' && isArrivalValidated();

  // Convention end date: update this to actual convention end date
  const conventionEnd = new Date('2026-03-28T23:59:59');
  const now = new Date();
  const conventionFinished = now >= conventionEnd;

  if (!arrivalDone) {
    instructions.textContent = 'Para obtener tu certificado, primero deb\u00e9s escanear el c\u00f3digo QR de arribo al llegar a la convenci\u00f3n. Una vez finalizado el congreso, este bot\u00f3n se habilitar\u00e1 para que puedas descargarlo.';
    btn.disabled = true;
    btn.className = 'btn-certificate btn-certificate--disabled';
  } else if (!conventionFinished) {
    instructions.textContent = 'Tu arribo fue registrado. El certificado estar\u00e1 disponible para descarga una vez que finalice el congreso.';
    btn.disabled = true;
    btn.className = 'btn-certificate btn-certificate--disabled';
  } else {
    instructions.textContent = 'Tu arribo fue validado y el congreso ha finalizado. Ya pod\u00e9s descargar tu certificado de asistencia.';
    btn.disabled = false;
    btn.className = 'btn-certificate btn-certificate--enabled';
  }
}

function handleDownloadCertificate() {
  if (!currentProfile) return;
  showToast('Preparando certificado...');
  // Placeholder: replace with actual certificate generation/download URL
  // Example: window.open('https://rtconvention.lat/api/certificate/' + currentUser.id);
}

function renderProfilePhotoPreview(photoUrl) {
  const wrap = document.getElementById('profilePhotoPreview');
  const editIcon = wrap.querySelector('.profile-photo-edit-icon');

  // Update ring color based on arrival state
  const arrivalValidated = typeof isArrivalValidated === 'function' && isArrivalValidated();
  wrap.classList.toggle('profile-ring--arrival', arrivalValidated);

  // Remove existing content (img or initials)
  const existingImg = wrap.querySelector('img');
  if (existingImg) existingImg.remove();
  const existingInit = wrap.querySelector('.speaker-initials');
  if (existingInit) existingInit.remove();

  if (photoUrl) {
    const img = document.createElement('img');
    img.src = photoUrl;
    img.alt = 'Foto de perfil';
    wrap.insertBefore(img, editIcon);
  } else {
    const name  = document.getElementById('profileName')?.value || '';
    const lname = document.getElementById('profileLastname')?.value || '';
    const initDiv = document.createElement('div');
    initDiv.className = 'speaker-initials';
    initDiv.textContent = ((name[0] || '') + (lname[0] || '')).toUpperCase() || '?';
    wrap.insertBefore(initDiv, editIcon);
  }
}

async function handleSaveProfile(event) {
  event.preventDefault();
  const btn = document.getElementById('profileSubmit');
  setButtonLoading(btn, true, 'Guardando...');
  clearFormErrors();

  let photoUrl = currentProfile.photo_url || '';

  // Upload photo if new one was cropped
  if (pendingPhotoBlob) {
    const uploadResult = await uploadPhoto(pendingPhotoBlob);
    if (uploadResult.error) {
      showFormError('profileError', 'Error al subir la foto. Intent\u00e1 de nuevo.');
      setButtonLoading(btn, false, 'Guardar cambios');
      return;
    }
    photoUrl = uploadResult.url;
  }

  const countryCode = document.getElementById('profileCountry').value;
  const country = COUNTRIES.find(c => c.code === countryCode);
  const phoneRaw = document.getElementById('profilePhone').value.trim();
  const phone = country && phoneRaw ? country.prefix + ' ' + phoneRaw : phoneRaw;

  const hotelStay = document.getElementById('hotelYes').classList.contains('active');
  const roomNumber = hotelStay ? document.getElementById('profileRoomNumber').value.trim() : '';

  const rawName     = document.getElementById('profileName').value.trim();
  const rawLastname = document.getElementById('profileLastname').value.trim();

  if (!rawName || !rawLastname) {
    showFormError('profileError', 'Complet\u00e1 tu nombre y apellido.');
    setButtonLoading(btn, false, 'Guardar cambios');
    return;
  }

  const updates = {
    name:        toTitleCase(rawName),
    lastname:    toTitleCase(rawLastname),
    country:     countryCode,
    institution: document.getElementById('profileInstitution').value.trim(),
    specialty:   document.getElementById('profileSpecialty').value.trim(),
    phone:       phone,
    email:       document.getElementById('profileEmail').value.trim(),
    bio:         document.getElementById('profileBio').value.trim(),
    photo_url:   photoUrl,
    visibility:  getVisibilitySettings(),
    hotel_stay:  hotelStay,
    room_number: roomNumber,
  };

  const { data, error } = await supabaseClient
    .from('profiles')
    .update(updates)
    .eq('user_id', currentUser.id)
    .select()
    .single();

  setButtonLoading(btn, false, 'Guardar cambios');

  if (error) {
    showFormError('profileError', 'No se pudo guardar: ' + error.message);
    return;
  }

  currentProfile = withResolvedSpeakerId(data, getSpeakerNameIndex());
  pendingPhotoBlob = null;
  closeModal('modalProfile');
  await loadAndMergeSupabaseProfiles();
  await loadAttendees();
  updateAuthButton();
  showToast('Perfil actualizado');
}

// ============================================
// PHOTO UPLOAD TO SUPABASE STORAGE
// ============================================
async function uploadPhoto(blob) {
  const photoKey = getCurrentProfileSpeakerId() || currentProfile.speaker_id || 'profile';
  const filePath = currentUser.id + '/' + photoKey + '.jpg';

  const { error } = await supabaseClient.storage
    .from('speaker-photos')
    .upload(filePath, blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });

  if (error) return { error };

  const { data } = supabaseClient.storage
    .from('speaker-photos')
    .getPublicUrl(filePath);

  return { url: data.publicUrl + '?t=' + Date.now() };
}

// ============================================
// PHOTO CROP SYSTEM
// ============================================
function triggerPhotoPick() {
  document.getElementById('photoFileInput').click();
}

function handlePhotoSelected(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Seleccion\u00e1 un archivo de imagen');
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => openCropModal(e.target.result);
  reader.readAsDataURL(file);

  event.target.value = '';
}

function openCropModal(dataUrl) {
  const img = document.getElementById('cropSourceImg');
  img.onload = () => {
    cropState.naturalW = img.naturalWidth;
    cropState.naturalH = img.naturalHeight;
    // Wait for modal to render so viewport has dimensions
    requestAnimationFrame(() => {
      initCropLayout();
      setupCropEvents();
    });
  };
  img.src = dataUrl;
  openModal('modalCrop');
}

function initCropLayout() {
  const viewport = document.querySelector('.crop-viewport');
  const viewSize = viewport.offsetWidth;
  cropState.viewportSize = viewSize;

  // Fit shortest side to viewport
  const fitScale = viewSize / Math.min(cropState.naturalW, cropState.naturalH);
  cropState.fitScale = fitScale;
  cropState.scale    = fitScale;
  cropState.offsetX  = 0;
  cropState.offsetY  = 0;

  applyCropTransform();
  document.getElementById('cropZoom').value = 1;
}

function applyCropTransform() {
  const wrap  = document.getElementById('cropImageWrap');
  const imgEl = document.getElementById('cropSourceImg');
  const { scale, naturalW, naturalH, viewportSize, offsetX, offsetY } = cropState;

  const scaledW = naturalW * scale;
  const scaledH = naturalH * scale;

  // Clamp offsets so image covers the viewport
  const maxOffX = Math.max(0, (scaledW - viewportSize) / 2);
  const maxOffY = Math.max(0, (scaledH - viewportSize) / 2);
  cropState.offsetX = Math.max(-maxOffX, Math.min(maxOffX, offsetX));
  cropState.offsetY = Math.max(-maxOffY, Math.min(maxOffY, offsetY));

  imgEl.style.width  = scaledW + 'px';
  imgEl.style.height = scaledH + 'px';

  wrap.style.width  = scaledW + 'px';
  wrap.style.height = scaledH + 'px';
  wrap.style.left   = ((viewportSize - scaledW) / 2 + cropState.offsetX) + 'px';
  wrap.style.top    = ((viewportSize - scaledH) / 2 + cropState.offsetY) + 'px';
}

function setupCropEvents() {
  const wrap     = document.getElementById('cropImageWrap');
  const zoom     = document.getElementById('cropZoom');
  const viewport = document.querySelector('.crop-viewport');

  // Zoom slider
  zoom.oninput = () => {
    const ratio = parseFloat(zoom.value);
    cropState.scale = cropState.fitScale * ratio;
    applyCropTransform();
  };

  // Mouse drag
  wrap.onmousedown = (e) => {
    cropState.isDragging = true;
    cropState.lastX = e.clientX;
    cropState.lastY = e.clientY;
    e.preventDefault();
  };

  document.addEventListener('mousemove', onCropMouseMove);
  document.addEventListener('mouseup', onCropMouseUp);

  // Touch events
  viewport.addEventListener('touchstart', onCropTouchStart, { passive: false });
  viewport.addEventListener('touchmove',  onCropTouchMove,  { passive: false });
  viewport.addEventListener('touchend',   onCropTouchEnd,   { passive: false });
}

function onCropMouseMove(e) {
  if (!cropState.isDragging) return;
  cropState.offsetX += e.clientX - cropState.lastX;
  cropState.offsetY += e.clientY - cropState.lastY;
  cropState.lastX = e.clientX;
  cropState.lastY = e.clientY;
  applyCropTransform();
}

function onCropMouseUp() {
  cropState.isDragging = false;
}

function onCropTouchStart(e) {
  e.preventDefault();
  if (e.touches.length === 1) {
    cropState.isDragging = true;
    cropState.lastX = e.touches[0].clientX;
    cropState.lastY = e.touches[0].clientY;
  } else if (e.touches.length === 2) {
    cropState.isDragging = false;
    cropState.lastDist = getTouchDist(e.touches);
  }
}

function onCropTouchMove(e) {
  e.preventDefault();
  if (e.touches.length === 1 && cropState.isDragging) {
    cropState.offsetX += e.touches[0].clientX - cropState.lastX;
    cropState.offsetY += e.touches[0].clientY - cropState.lastY;
    cropState.lastX = e.touches[0].clientX;
    cropState.lastY = e.touches[0].clientY;
    applyCropTransform();
  } else if (e.touches.length === 2) {
    const newDist = getTouchDist(e.touches);
    const ratio   = newDist / cropState.lastDist;
    cropState.scale = Math.max(cropState.fitScale, Math.min(cropState.fitScale * 3, cropState.scale * ratio));
    cropState.lastDist = newDist;
    applyCropTransform();
    // Sync slider
    document.getElementById('cropZoom').value = cropState.scale / cropState.fitScale;
  }
}

function onCropTouchEnd(e) {
  if (e.touches.length === 0) cropState.isDragging = false;
}

function getTouchDist(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function confirmCrop() {
  const { scale, naturalW, naturalH, viewportSize, offsetX, offsetY } = cropState;
  const OUTPUT_SIZE = 400;

  const canvas  = document.createElement('canvas');
  canvas.width  = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx     = canvas.getContext('2d');

  // Clip to circle
  ctx.beginPath();
  ctx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  // Compute source rectangle
  const scaledW = naturalW * scale;
  const scaledH = naturalH * scale;
  const imgLeft = (viewportSize - scaledW) / 2 + offsetX;
  const imgTop  = (viewportSize - scaledH) / 2 + offsetY;

  const srcX = (0 - imgLeft) / scale;
  const srcY = (0 - imgTop)  / scale;
  const srcW = viewportSize / scale;
  const srcH = viewportSize / scale;

  ctx.drawImage(
    document.getElementById('cropSourceImg'),
    srcX, srcY, srcW, srcH,
    0, 0, OUTPUT_SIZE, OUTPUT_SIZE
  );

  canvas.toBlob(
    (blob) => {
      pendingPhotoBlob = blob;
      renderProfilePhotoPreview(URL.createObjectURL(blob));
      closeModal('modalCrop');
      showToast('Foto lista. Guard\u00e1 el perfil para subirla.');
    },
    'image/jpeg',
    0.8
  );
}

function cancelCrop() {
  closeModal('modalCrop');
}

// ============================================
// SPEAKER CARD EDIT BUTTON
// ============================================
// Called from app.js renderSpeakers() template
function authEditBtn(speaker) {
  if (!currentProfile || getCurrentProfileSpeakerId() !== speaker.id) return '';
  return '<button class="speaker-edit-btn" onclick="openProfileModal(); event.stopPropagation();" title="Editar mi perfil">' +
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>' +
    '<path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>' +
    '</svg></button>';
}

// ============================================
// MODAL UTILITIES
// ============================================
function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  // Keep a deterministic stack so nested sheets open above the current one.
  // Must be above auth-wall (z-index: 999) so modals open on top.
  const baseZ = 1000;
  const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'))
    .filter(el => el.id !== id)
    .sort((a, b) => (parseInt(a.style.zIndex || baseZ, 10) || baseZ) - (parseInt(b.style.zIndex || baseZ, 10) || baseZ));

  openModals.forEach((el, idx) => {
    el.style.zIndex = String(baseZ + idx + 1);
  });

  modal.style.zIndex = String(baseZ + openModals.length + 1);
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;

  modal.classList.add('hidden');
  modal.style.removeProperty('z-index');

  // Re-pack remaining modals so z-index keeps increasing from base.
  const baseZ = 1000;
  const openModals = Array.from(document.querySelectorAll('.modal-backdrop:not(.hidden)'))
    .sort((a, b) => (parseInt(a.style.zIndex || baseZ, 10) || baseZ) - (parseInt(b.style.zIndex || baseZ, 10) || baseZ));
  openModals.forEach((el, idx) => {
    el.style.zIndex = String(baseZ + idx + 1);
  });

  // Only restore scroll if no other modal is open
  if (!openModals.length) document.body.style.overflow = '';
}

function closeModalOnBackdrop(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

function setButtonLoading(btn, loading, label) {
  btn.disabled    = loading;
  btn.textContent = label;
}

function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => {
    el.textContent = '';
    el.classList.add('hidden');
  });
  document.querySelectorAll('.auth-feedback').forEach(el => {
    el.innerHTML = '';
    el.classList.add('hidden');
  });
}

function showFormError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
    el.classList.remove('hidden');
  }
}

function showFormInfo(elementId, htmlMessage) {
  const el = document.getElementById(elementId);
  if (el) {
    el.innerHTML = htmlMessage;
    el.classList.remove('hidden');
  }
}

// ============================================
// COUNTRY SELECTOR + PHONE PREFIX
// ============================================
function populateCountrySelect() {
  const sel = document.getElementById('profileCountry');
  if (!sel || sel.options.length > 1) return;
  COUNTRIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.flag + ' ' + c.name;
    sel.appendChild(opt);
  });
}

function updatePhonePrefix() {
  const sel = document.getElementById('profileCountry');
  const prefixEl = document.getElementById('phonePrefix');
  if (!sel || !prefixEl) return;
  const country = COUNTRIES.find(c => c.code === sel.value);
  prefixEl.textContent = country ? country.prefix : '+__';
}

// ============================================
// VISIBILITY TOGGLES
// ============================================
const VISIBILITY_FIELDS = ['institution', 'specialty', 'country', 'phone', 'email', 'bio'];
const VISIBILITY_IDS = {
  institution: 'visInstitution',
  specialty: 'visSpecialty',
  country: 'visCountry',
  phone: 'visPhone',
  email: 'visEmail',
  bio: 'visBio',
};

function getVisibilitySettings() {
  const result = {};
  for (const field of VISIBILITY_FIELDS) {
    const el = document.getElementById(VISIBILITY_IDS[field]);
    result[field] = el ? el.checked : true;
  }
  return result;
}

function setVisibilitySettings(vis) {
  if (!vis) return;
  for (const field of VISIBILITY_FIELDS) {
    const el = document.getElementById(VISIBILITY_IDS[field]);
    if (el) el.checked = vis[field] !== false;
  }
}

// ============================================
// HOTEL STAY TOGGLE
// ============================================
function setHotelStay(yes) {
  const btnYes = document.getElementById('hotelYes');
  const btnNo = document.getElementById('hotelNo');
  const roomGroup = document.getElementById('roomNumberGroup');
  if (yes) {
    btnYes.classList.add('active');
    btnNo.classList.remove('active');
    roomGroup.style.display = '';
  } else {
    btnYes.classList.remove('active');
    btnNo.classList.add('active');
    roomGroup.style.display = 'none';
    document.getElementById('profileRoomNumber').value = '';
  }
}

// ============================================
// ATTENDEES LIST
// ============================================
let allAttendees = [];
let attendeesSearchTerm = '';

function getAllAttendees() {
  return allAttendees;
}

async function loadAttendees() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('profiles')
      .select('user_id, speaker_id, name, lastname, country, institution, specialty, phone, email, bio, photo_url, visibility, hotel_stay, room_number');
    if (error) throw error;
    const speakerNameIndex = getSpeakerNameIndex();
    const normalized = (data || []).map(profile => withResolvedSpeakerId(profile, speakerNameIndex));
    allAttendees = mergeProfilesByResolvedSpeakerId(normalized);
    renderAttendees();
    if (typeof renderSpeakers === 'function') renderSpeakers();
  } catch (e) {
    console.warn('Could not load attendees:', e.message);
  }
}

function renderAttendees() {
  const container = document.getElementById('attendeesList');
  if (!container) return;

  let list = allAttendees;
  if (attendeesSearchTerm) {
    const term = attendeesSearchTerm.toLowerCase();
    list = list.filter(a => {
      const full = (a.name || '') + ' ' + (a.lastname || '');
      return full.toLowerCase().includes(term);
    });
  }

  if (!list.length) {
    container.innerHTML = attendeesSearchTerm
      ? '<p class="muted">No se encontraron asistentes.</p>'
      : '<p class="muted">No hay asistentes registrados a\u00fan.</p>';
    return;
  }

  list.sort((a, b) => {
    const nameA = ((a.name || '') + ' ' + (a.lastname || '')).trim();
    const nameB = ((b.name || '') + ' ' + (b.lastname || '')).trim();
    return nameA.localeCompare(nameB, 'es');
  });

  container.innerHTML = list.map(att => {
    const fullName = buildFullName(att.name, att.lastname);
    const initials = getInitials(fullName);
    const attendeeKey = String(att._mergeKey || att.user_id || '').replace(/'/g, "\\'");
    const countryObj = COUNTRIES.find(c => c.code === att.country);
    const flag = countryObj ? countryObj.flag : '';
    const photoHtml = att.photo_url
      ? `<img src="${att.photo_url}" alt="${fullName}" class="attendee-photo" onerror="this.outerHTML='<div class=\\'attendee-initials\\'>${initials}</div>'">`
      : `<div class="attendee-initials">${initials}</div>`;

    return `
      <div class="attendee-card" onclick="openPublicProfile('${attendeeKey}')">
        <div class="attendee-photo-wrap">
          ${photoHtml}
          ${flag ? `<span class="speaker-flag-badge">${flag}</span>` : ''}
        </div>
        <div class="attendee-name">${fullName}</div>
        ${att.specialty ? `<div class="attendee-specialty">${att.specialty}</div>` : ''}
        ${att.institution ? `<div class="attendee-institution">${att.institution}</div>` : ''}
      </div>`;
  }).join('');
}

function filterAttendees(term) {
  attendeesSearchTerm = term;
  renderAttendees();
}

function getInitials(name) {
  const parts = name.replace(/Dr\.\s?|Dra\.\s?/i, '').trim().split(' ');
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return parts[0] ? parts[0].substring(0, 2).toUpperCase() : '?';
}

// ============================================
// PUBLIC PROFILE MODAL
// ============================================
function openPublicProfile(userId) {
  const att = allAttendees.find(a => (a._mergeKey || a.user_id || '') === userId || a.user_id === userId);
  if (!att) return;
  const attendeeSpeakerId = resolveProfileSpeakerId(att, getSpeakerNameIndex());

  const vis = att.visibility || {};
  const showField = (field) => vis[field] !== false;
  const fullName = buildFullName(att.name, att.lastname);
  const initials = getInitials(fullName);

  const photoHtml = att.photo_url
    ? `<img src="${att.photo_url}" alt="${fullName}" class="speaker-detail-photo" onerror="this.outerHTML='<div class=\\'speaker-detail-initials\\'>${initials}</div>'">`
    : `<div class="speaker-detail-initials">${initials}</div>`;

  const countryObj = att.country ? COUNTRIES.find(c => c.code === att.country) : null;
  const flagBadge = countryObj ? `<span class="speaker-flag-badge detail">${countryObj.flag}</span>` : '';

  let fields = '';
  if (showField('institution') && att.institution)
    fields += detailField('\u{1F3E5}', 'Instituci\u00f3n', att.institution);
  if (showField('specialty') && att.specialty)
    fields += detailField('\u2695\uFE0F', 'Especialidad', att.specialty);
  if (showField('country') && countryObj)
    fields += detailField('\u{1F4CD}', 'Pa\u00eds', countryObj.flag + ' ' + countryObj.name);
  if (showField('phone') && att.phone)
    fields += detailField('\u{1F4DE}', 'Tel\u00e9fono', att.phone);
  if (showField('email') && att.email)
    fields += detailField('\u2709\uFE0F', 'Email', `<a href="mailto:${att.email}" style="color: var(--gold);">${att.email}</a>`);

  let bioHtml = '';
  if (showField('bio') && att.bio)
    bioHtml = `<div class="speaker-detail-bio">${att.bio}</div>`;

  // Hotel info
  let hotelHtml = '';
  if (att.hotel_stay) {
    hotelHtml = `<div class="public-profile-hotel">
      <div class="public-profile-hotel-badge">\u{1F3E8} Se hospeda en el hotel</div>
      ${att.room_number ? `<div class="public-profile-hotel-room">Habitaci\u00f3n: <strong>${att.room_number}</strong></div>` : ''}
    </div>`;
  }

  // Mesas where this person participates + role in each one
  let eventsHtml = '';
  const participantIds = [att.user_id, att._mergeKey].filter(Boolean);
  const attendeeSpeaker = attendeeSpeakerId && Array.isArray(speakersData)
    ? speakersData.find(s => s.id === attendeeSpeakerId)
    : null;
  const normalizedSpeakerName = attendeeSpeaker ? normalizePersonKey(attendeeSpeaker.name) : '';
  const personEvents = [];

  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      if (!session || session.area === 'evento') continue;

      const roles = [];
      const isSpeaker = attendeeSpeakerId && Array.isArray(session.speakers) && session.speakers.includes(attendeeSpeakerId);
      if (isSpeaker) roles.push('Expositor');

      let isModerator = false;
      if (attendeeSpeakerId && normalizedSpeakerName && session.moderator) {
        const moderatorNames = String(session.moderator)
          .split(/\s+y\s+|,|;/i)
          .map(name => normalizePersonKey(name))
          .filter(Boolean);
        isModerator = moderatorNames.includes(normalizedSpeakerName);
      }
      if (isModerator) roles.push('Moderador');

      const key = typeof sessionKey === 'function'
        ? sessionKey(session, day.date)
        : (day.date + '|' + session.time + '|' + session.title);
      const enrolledUsers = enrollmentsCache[key] || [];
      const isParticipant = participantIds.some(uid => enrolledUsers.includes(uid));
      if (isParticipant && !isSpeaker && !isModerator) roles.push('Participante');

      if (roles.length) {
        personEvents.push({ session, dayLabel: 'D\u00eda ' + day.day, date: day.date, roles });
      }
    }
  }

  if (personEvents.length) {
    const roleOrder = { Moderador: 0, Expositor: 1, Participante: 2 };
    personEvents.sort((a, b) => (a.date + a.session.time).localeCompare(b.date + b.session.time));
    const evItems = personEvents.map(ev => {
      const areaTag = typeof areaLabel === 'function' ? areaLabel(ev.session.area) : ev.session.area;
      const roleBadges = ev.roles
        .slice()
        .sort((a, b) => (roleOrder[a] ?? 99) - (roleOrder[b] ?? 99))
        .map(role => `<span class="public-profile-role-badge ${role.toLowerCase()}">${role}</span>`)
        .join('');
      return `<div class="public-profile-event-item">
        <div class="public-profile-event-title">${ev.session.title}</div>
        <div class="public-profile-event-meta">${ev.dayLabel} \u00b7 ${ev.session.time} - ${ev.session.end} \u00b7 <span class="session-area-tag" data-area="${ev.session.area}" style="font-size:11px;">${areaTag}</span></div>
        <div class="public-profile-event-meta">\u{1F4CD} ${ev.session.room}</div>
        <div class="public-profile-event-roles">${roleBadges}</div>
      </div>`;
    }).join('');
    eventsHtml = `<div class="public-profile-events">
      <h3 class="public-profile-events-title">Mesas y rol en el congreso</h3>
      ${evItems}
    </div>`;
  }

  const pubHalo = attendeeSpeakerId && typeof getSpeakerHaloState === 'function' ? getSpeakerHaloState(attendeeSpeakerId) : null;
  const pubWrapClass = pubHalo ? `speaker-photo-wrap detail speaker-photo-wrap--${pubHalo}` : 'speaker-photo-wrap detail';

  document.getElementById('publicProfileContent').innerHTML = `
    <div class="speaker-detail-header">
      <div class="${pubWrapClass}">${photoHtml}${flagBadge}</div>
      <h2 class="speaker-detail-name">${fullName}</h2>
    </div>
    <div class="speaker-detail-fields">${fields}</div>
    ${bioHtml}
    ${hotelHtml}
    ${eventsHtml}
  `;

  openModal('modalPublicProfile');
}

// ============================================
// SPEAKER DETAIL MODAL
// ============================================
function openSpeakerDetail(speakerId) {
  const speaker = speakersData.find(s => s.id === speakerId);
  if (!speaker) return;

  const vis = speaker.visibility || {};
  const showField = (field) => vis[field] !== false;

  const photoHtml = speaker.photo
    ? `<img src="${BASE_PATH}${speaker.photo}" alt="${speaker.name}" class="speaker-detail-photo" onerror="this.outerHTML='<div class=\\'speaker-detail-initials\\'>${speakerInitials(speaker.name)}</div>'">`
    : `<div class="speaker-detail-initials">${speakerInitials(speaker.name)}</div>`;

  const areaColors = { mama: '#e91e8c', pulmon: '#00bcd4', prostata: '#4caf50', neuro: '#ff9800' };
  const areaNames = { mama: 'Mama', pulmon: 'Pulmón', prostata: 'Próstata', neuro: 'Neuro' };
  const areaColor = areaColors[speaker.area] || '#888';

  let fields = '';
  if (showField('institution') && speaker.institution)
    fields += detailField('🏥', 'Institución', speaker.institution);
  if (showField('specialty') && speaker.specialty)
    fields += detailField('⚕️', 'Especialidad', speaker.specialty);
  if (showField('country') && speaker.country) {
    const c = COUNTRIES.find(cc => cc.code === speaker.country);
    fields += detailField('📍', 'País', c ? c.flag + ' ' + c.name : speaker.country);
  }
  if (showField('phone') && speaker.phone)
    fields += detailField('📞', 'Teléfono', speaker.phone);
  if (showField('email') && speaker.email)
    fields += detailField('✉️', 'Email', `<a href="mailto:${speaker.email}" style="color: var(--gold);">${speaker.email}</a>`);

  let bioHtml = '';
  if (showField('bio') && speaker.bio)
    bioHtml = `<div class="speaker-detail-bio">${speaker.bio}</div>`;

  const flagBadge = speaker.country ? (() => { const c = COUNTRIES.find(cc => cc.code === speaker.country); return c ? `<span class="speaker-flag-badge detail">${c.flag}</span>` : ''; })() : '';

  const detailHalo = typeof getSpeakerHaloState === 'function' ? getSpeakerHaloState(speakerId) : null;
  const detailWrapClass = detailHalo ? `speaker-photo-wrap detail speaker-photo-wrap--${detailHalo}` : 'speaker-photo-wrap detail';

  document.getElementById('speakerDetailContent').innerHTML = `
    <div class="speaker-detail-header">
      <div class="${detailWrapClass}">${photoHtml}${flagBadge}</div>
      <h2 class="speaker-detail-name">${speaker.name}</h2>
      <span class="speaker-detail-area" style="background: ${areaColor}22; color: ${areaColor};">${areaNames[speaker.area] || speaker.area}</span>
    </div>
    <div class="speaker-detail-fields">${fields}</div>
    ${bioHtml}
  `;

  openModal('modalSpeakerDetail');
}

function detailField(icon, label, value) {
  return `<div class="speaker-detail-field">
    <span class="speaker-detail-icon">${icon}</span>
    <div>
      <div class="speaker-detail-label">${label}</div>
      <div class="speaker-detail-value">${value}</div>
    </div>
  </div>`;
}

function speakerInitials(name) {
  const parts = name.replace(/Dr\.\s?|Dra\.\s?/i, '').trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : parts[0].substring(0, 2).toUpperCase();
}

// ============================================
// SESSION ENROLLMENTS (Participar en mesa)
// ============================================
const ENROLLMENT_MAX = 40;
let enrollmentsCache = {};  // { sessionKey: [{ user_id, profile }] }
let myEnrollments = [];     // [ sessionKey, ... ]

function refreshEnrollmentUI() {
  if (typeof renderAgenda === 'function') renderAgenda();
  if (typeof renderMySessions === 'function') renderMySessions();
  if (typeof renderProfileEvents === 'function') renderProfileEvents();
}

async function loadAllEnrollments() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('session_enrollments')
      .select('session_key, user_id');
    if (error) throw error;

    enrollmentsCache = {};
    myEnrollments = [];
    const uid = currentUser ? currentUser.id : null;

    (data || []).forEach(row => {
      if (!enrollmentsCache[row.session_key]) enrollmentsCache[row.session_key] = [];
      enrollmentsCache[row.session_key].push(row.user_id);
      if (uid && row.user_id === uid) myEnrollments.push(row.session_key);
    });
  } catch (e) {
    console.warn('Could not load enrollments:', e.message);
  }
}

function getEnrollmentCount(sessionKey) {
  return (enrollmentsCache[sessionKey] || []).length;
}

function isEnrolled(sessionKey) {
  return myEnrollments.includes(sessionKey);
}

function getSessionTimeSlot(sessionKey) {
  // sessionKey = "date|time|title" — extract date+time for conflict check
  const parts = sessionKey.split('|');
  return parts[0] + '|' + parts[1];  // "2026-03-13|16:30"
}

function hasConflictingEnrollment(sessionKey) {
  const slot = getSessionTimeSlot(sessionKey);
  return myEnrollments.some(k => k !== sessionKey && getSessionTimeSlot(k) === slot);
}

function getConflictingSessionTitle(sessionKey) {
  const slot = getSessionTimeSlot(sessionKey);
  const conflicting = myEnrollments.find(k => k !== sessionKey && getSessionTimeSlot(k) === slot);
  if (!conflicting) return '';
  return conflicting.split('|').slice(2).join('|');
}

async function enrollInSession(sessionKey, event) {
  if (event) { event.stopPropagation(); event.preventDefault(); }

  if (!currentUser) {
    showToast('Tenés que iniciar sesión para inscribirte');
    return;
  }

  // Check if already enrolled
  if (isEnrolled(sessionKey)) {
    await unenrollFromSession(sessionKey);
    return;
  }

  // Check seat limit
  if (getEnrollmentCount(sessionKey) >= ENROLLMENT_MAX) {
    showToast('Mesa llena (máximo ' + ENROLLMENT_MAX + ' participantes)');
    return;
  }

  // Check time conflict
  if (hasConflictingEnrollment(sessionKey)) {
    const conflictTitle = getConflictingSessionTitle(sessionKey);
    showToast('Ya estás inscrito en otra charla en este horario' + (conflictTitle ? ': ' + conflictTitle : ''));
    return;
  }

  try {
    const { error } = await supabaseClient
      .from('session_enrollments')
      .insert({ session_key: sessionKey, user_id: currentUser.id });
    if (error) throw error;

    // Update local cache
    if (!enrollmentsCache[sessionKey]) enrollmentsCache[sessionKey] = [];
    enrollmentsCache[sessionKey].push(currentUser.id);
    myEnrollments.push(sessionKey);

    showToast('Te inscribiste a la mesa');
    renderAgenda();
    renderMySessions();
  } catch (e) {
    console.error('Enrollment error:', e);
    showToast('Error al inscribirse: ' + e.message);
  }
}

async function unenrollFromSession(sessionKey) {
  if (!currentUser) return;

  try {
    const { error } = await supabaseClient
      .from('session_enrollments')
      .delete()
      .eq('session_key', sessionKey)
      .eq('user_id', currentUser.id);
    if (error) throw error;

    // Update local cache
    if (enrollmentsCache[sessionKey]) {
      enrollmentsCache[sessionKey] = enrollmentsCache[sessionKey].filter(id => id !== currentUser.id);
    }
    myEnrollments = myEnrollments.filter(k => k !== sessionKey);

    showToast('Te desinscribiste de la mesa');
    renderAgenda();
    renderMySessions();
  } catch (e) {
    console.error('Unenrollment error:', e);
    showToast('Error al desinscribirse: ' + e.message);
  }
}

async function getEnrolledProfiles(sessionKey) {
  if (!supabaseClient) return [];
  const userIds = enrollmentsCache[sessionKey] || [];
  if (!userIds.length) return [];

  // Get profiles for enrolled users
  const profiles = [];
  for (const uid of userIds) {
    const att = allAttendees.find(a => a.user_id === uid);
    if (att) {
      profiles.push(att);
    }
  }
  return profiles;
}

function isUserSpeakerInSession(session) {
  const speakerId = getCurrentProfileSpeakerId();
  if (!speakerId) return false;
  // Check if user's speaker_id is in session speakers
  if (Array.isArray(session.speakers) && session.speakers.includes(speakerId)) return true;
  // Check if user is moderator
  if (session.moderator) {
    const sp = speakersData.find(s => s.id === speakerId);
    if (sp && session.moderator.includes(sp.name)) return true;
  }
  return false;
}

function autoActivateSpeakerReminders() {
  const speakerId = getCurrentProfileSpeakerId();
  if (!speakerId) return;
  const reminders = typeof getReminders === 'function' ? getReminders() : [];
  let changed = false;

  for (const day of agendaData) {
    if (!day.sessions || !day.date) continue;
    for (const session of day.sessions) {
      const isSpeaker = Array.isArray(session.speakers) && session.speakers.includes(speakerId);
      let isModerator = false;
      if (session.moderator) {
        const sp = speakersData.find(s => s.id === speakerId);
        if (sp && session.moderator.includes(sp.name)) isModerator = true;
      }
      if (isSpeaker || isModerator) {
        const key = typeof sessionKey === 'function' ? sessionKey(session, day.date) : (day.date + '|' + session.time + '|' + session.title);
        if (!reminders.includes(key)) {
          reminders.push(key);
          changed = true;
        }
      }
    }
  }

  if (changed && typeof setReminders === 'function') {
    setReminders(reminders);
  }
}
