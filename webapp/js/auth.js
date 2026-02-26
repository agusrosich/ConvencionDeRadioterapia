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

// --- MODULE STATE ---
let supabaseClient   = null;
let currentUser      = null;
let currentProfile   = null;   // Row from public.profiles
let pendingPhotoBlob = null;   // Compressed JPEG before upload
let claimedSpeakerIds = new Set(); // Already claimed speaker_ids

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
document.addEventListener('DOMContentLoaded', async () => {
  // Guard: if Supabase SDK didn't load, skip gracefully
  if (typeof supabase === 'undefined') {
    console.warn('Auth: Supabase SDK not loaded. Auth features disabled.');
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

  // Listen for future auth changes
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    currentUser = session?.user ?? null;
    if (event === 'SIGNED_IN') {
      await loadCurrentProfile();
      updateAuthButton();
      if (!currentProfile) {
        closeModal('modalAuth');
        openClaimModal();
      } else {
        closeModal('modalAuth');
        showToast('Bienvenido/a de nuevo');
      }
    } else if (event === 'SIGNED_OUT') {
      currentProfile = null;
      updateAuthButton();
      if (typeof renderSpeakers === 'function') renderSpeakers();
    }
  });

  // Load all Supabase profiles and merge over JSON data
  await loadAndMergeSupabaseProfiles();
});

// ============================================
// SUPABASE PROFILE MERGE
// ============================================
async function loadAndMergeSupabaseProfiles() {
  if (!supabaseClient) return;

  try {
    const { data: profiles, error } = await supabaseClient
      .from('profiles')
      .select('speaker_id, name, lastname, country, institution, specialty, phone, email, bio, photo_url, visibility');

    if (error) throw error;
    if (!profiles || !profiles.length) return;

    claimedSpeakerIds.clear();

    profiles.forEach(prof => {
      claimedSpeakerIds.add(prof.speaker_id);

      const idx = speakersData.findIndex(s => s.id === prof.speaker_id);
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
        visibility:  prof.visibility  || {},
        _claimed:    true,
      };
    });

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

  currentProfile = data;
}

function buildFullName(name, lastname) {
  return [name, lastname].filter(Boolean).join(' ').trim();
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

  setButtonLoading(btn, true, 'Ingresando...');
  clearFormErrors();

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  setButtonLoading(btn, false, 'Ingresar');
  if (error) {
    showFormError('loginError', translateAuthError(error.message));
  }
}

async function handleRegister(event) {
  event.preventDefault();
  const email           = document.getElementById('registerEmail').value.trim();
  const password        = document.getElementById('registerPassword').value;
  const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
  const btn             = document.getElementById('registerSubmit');

  clearFormErrors();

  if (password !== passwordConfirm) {
    showFormError('registerError', 'Las contraseñas no coinciden');
    return;
  }

  setButtonLoading(btn, true, 'Creando cuenta...');

  const siteUrl = window.location.origin + window.location.pathname;
  const { error } = await supabaseClient.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: siteUrl }
  });

  setButtonLoading(btn, false, 'Crear cuenta');
  if (error) {
    showFormError('registerError', translateAuthError(error.message));
  } else {
    document.getElementById('formRegister').innerHTML = `
      <div style="text-align:center; padding: 1.5rem 0;">
        <div style="font-size: 2.5rem; margin-bottom: 0.75rem;">📧</div>
        <h3 style="margin: 0 0 0.5rem; color: #fff;">¡Revisá tu correo!</h3>
        <p style="color: #aab; margin: 0; line-height: 1.5;">
          Te enviamos un email a <strong style="color: #fff;">${email}</strong> con un enlace para confirmar tu cuenta.
        </p>
        <p style="color: #889; margin: 0.75rem 0 0; font-size: 0.85rem;">
          Si no lo ves, revisá la carpeta de spam.
        </p>
      </div>`;
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
  if (msg.includes('Email not confirmed'))return 'Confirm\u00e1 tu email antes de ingresar.';
  if (msg.includes('already registered')) return 'Ya existe una cuenta con ese email.';
  if (msg.includes('Password should be')) return 'La contrase\u00f1a debe tener al menos 6 caracteres.';
  if (msg.includes('rate limit'))         return 'Demasiados intentos. Esper\u00e1 un momento.';
  return msg;
}

// ============================================
// CLAIM MODAL
// ============================================
function openClaimModal() {
  const select = document.getElementById('claimSelect');
  select.innerHTML = '<option value="">-- Seleccionar --</option>';

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

  const btn = document.getElementById('claimSubmit');
  setButtonLoading(btn, true, 'Vinculando...');
  clearFormErrors();

  const baseSpeaker = speakersData.find(s => s.id === speakerId);
  const nameParts   = splitName(baseSpeaker?.name || '');

  const { data, error } = await supabaseClient
    .from('profiles')
    .insert({
      user_id:     currentUser.id,
      speaker_id:  speakerId,
      name:        nameParts.name,
      lastname:    nameParts.lastname,
      institution: baseSpeaker?.institution || '',
      specialty:   baseSpeaker?.specialty   || '',
      email:       currentUser.email,
      bio:         baseSpeaker?.bio         || '',
      photo_url:   baseSpeaker?.photo       || '',
    })
    .select()
    .single();

  setButtonLoading(btn, false, 'Vincular perfil');

  if (error) {
    if (error.code === '23505') {
      showFormError('claimError', 'Este perfil ya fue vinculado por otra cuenta.');
    } else {
      showFormError('claimError', 'Error al vincular: ' + error.message);
    }
    return;
  }

  currentProfile = data;
  closeModal('modalClaim');
  await loadAndMergeSupabaseProfiles();
  updateAuthButton();
  showToast('Perfil vinculado. Ya pod\u00e9s editarlo.');
  openProfileModal();
}

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length <= 1) return { name: parts[0] || '', lastname: '' };
  return { name: parts[0], lastname: parts.slice(1).join(' ') };
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

  updatePhonePrefix();
  setVisibilitySettings(currentProfile.visibility);
  renderProfilePhotoPreview(currentProfile.photo_url);
  pendingPhotoBlob = null;
  clearFormErrors();
  if (typeof renderProfileEvents === 'function') renderProfileEvents();
  openModal('modalProfile');
}

function renderProfilePhotoPreview(photoUrl) {
  const wrap = document.getElementById('profilePhotoPreview');
  const editIcon = wrap.querySelector('.profile-photo-edit-icon');

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

  const updates = {
    name:        document.getElementById('profileName').value.trim(),
    lastname:    document.getElementById('profileLastname').value.trim(),
    country:     countryCode,
    institution: document.getElementById('profileInstitution').value.trim(),
    specialty:   document.getElementById('profileSpecialty').value.trim(),
    phone:       phone,
    email:       document.getElementById('profileEmail').value.trim(),
    bio:         document.getElementById('profileBio').value.trim(),
    photo_url:   photoUrl,
    visibility:  getVisibilitySettings(),
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

  currentProfile = data;
  pendingPhotoBlob = null;
  closeModal('modalProfile');
  await loadAndMergeSupabaseProfiles();
  updateAuthButton();
  showToast('Perfil actualizado');
}

// ============================================
// PHOTO UPLOAD TO SUPABASE STORAGE
// ============================================
async function uploadPhoto(blob) {
  const filePath = currentUser.id + '/' + currentProfile.speaker_id + '.jpg';

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
  if (!currentProfile || currentProfile.speaker_id !== speaker.id) return '';
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
  document.getElementById(id).classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Only restore scroll if no other modal is open
  const anyOpen = document.querySelector('.modal-backdrop:not(.hidden)');
  if (!anyOpen) document.body.style.overflow = '';
}

function closeModalOnBackdrop(event, id) {
  if (event.target === event.currentTarget) closeModal(id);
}

function setButtonLoading(btn, loading, label) {
  btn.disabled    = loading;
  btn.textContent = label;
}

function clearFormErrors() {
  document.querySelectorAll('.form-error').forEach(el => el.classList.add('hidden'));
}

function showFormError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) {
    el.textContent = message;
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

  document.getElementById('speakerDetailContent').innerHTML = `
    <div class="speaker-detail-header">
      <div class="speaker-photo-wrap detail">${photoHtml}${flagBadge}</div>
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
