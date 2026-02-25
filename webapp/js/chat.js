/* ============================================
   RTCC 2026 - Room Chat Module
   Requires: supabaseClient, currentUser, currentProfile,
             speakersData (from auth.js / app.js)
             openModal/closeModal, openSpeakerDetail (from auth.js)
             showToast, BASE_PATH (from app.js)
   ============================================ */

// --- MODULE STATE ---
let activeChatRoom      = null;
let chatChannel         = null;
let chatMentionQuery    = null;
let mentionDropdownOpen = false;
const chatUnreadMentions = {};

// ============================================
// ENTRY POINT
// ============================================
async function openRoomChat(roomName) {
  activeChatRoom = roomName;

  document.getElementById('chatRoomName').textContent = roomName;

  const messagesEl = document.getElementById('chatMessages');
  messagesEl.innerHTML = '<div class="chat-loading">Cargando mensajes...</div>';

  // Show compose or auth wall
  const composeEl  = document.getElementById('chatCompose');
  const authWallEl = document.getElementById('chatAuthWall');
  if (currentUser && currentProfile) {
    composeEl.classList.remove('hidden');
    authWallEl.classList.add('hidden');
  } else {
    composeEl.classList.add('hidden');
    authWallEl.classList.remove('hidden');
  }

  // Reset input
  const input = document.getElementById('chatInput');
  if (input) { input.value = ''; chatAutoResize(input); }
  updateChatCharCount();

  openModal('modalChat');

  await loadChatHistory(roomName);
  subscribeToChatRoom(roomName);

  // Clear unread for this room
  chatUnreadMentions[roomName] = 0;
  updateSessionCardBadges(roomName);
}

// ============================================
// CLOSE / CLEANUP
// ============================================
function closeChat() {
  if (chatChannel) {
    supabaseClient.removeChannel(chatChannel);
    chatChannel = null;
  }
  hideMentionDropdown();
  closeModal('modalChat');
  activeChatRoom = null;
}

// ============================================
// LOAD HISTORY
// ============================================
async function loadChatHistory(roomName) {
  if (!supabaseClient) return;

  const { data, error } = await supabaseClient
    .from('chat_messages')
    .select('*')
    .eq('room', roomName)
    .order('created_at', { ascending: true })
    .limit(100);

  const messagesEl = document.getElementById('chatMessages');

  if (error) {
    messagesEl.innerHTML = '<div class="chat-empty">Error al cargar mensajes.</div>';
    return;
  }

  if (!data || !data.length) {
    messagesEl.innerHTML = '<div class="chat-empty">No hay mensajes a\u00fan. \u00a1S\u00e9 el primero!</div>';
    return;
  }

  messagesEl.innerHTML = '';
  data.forEach(msg => messagesEl.appendChild(renderChatMessage(msg)));
  scrollChatToBottom();
}

// ============================================
// REALTIME SUBSCRIPTION
// ============================================
function subscribeToChatRoom(roomName) {
  if (chatChannel) supabaseClient.removeChannel(chatChannel);

  chatChannel = supabaseClient
    .channel('chat-room-' + roomName)
    .on(
      'postgres_changes',
      {
        event:  'INSERT',
        schema: 'public',
        table:  'chat_messages',
        filter: 'room=eq.' + roomName
      },
      (payload) => {
        const msg = payload.new;
        const messagesEl = document.getElementById('chatMessages');

        // Remove placeholder
        const placeholder = messagesEl.querySelector('.chat-empty, .chat-loading');
        if (placeholder) placeholder.remove();

        messagesEl.appendChild(renderChatMessage(msg));

        // Auto-scroll if near bottom
        const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 120;
        if (isNearBottom) scrollChatToBottom();

        // Check @mention notification
        checkMentionNotification(msg);
      }
    )
    .subscribe();
}

// ============================================
// SEND MESSAGE
// ============================================
async function sendChatMessage() {
  if (!currentUser || !currentProfile) {
    showToast('Inici\u00e1 sesi\u00f3n para enviar mensajes');
    return;
  }
  if (!supabaseClient || !activeChatRoom) return;

  const input = document.getElementById('chatInput');
  const body  = input.value.trim();
  if (!body) return;

  const sendBtn = document.getElementById('chatSendBtn');
  sendBtn.disabled = true;

  const mentions = parseChatMentions(body);
  const displayName = buildFullName(currentProfile.name, currentProfile.lastname) || 'An\u00f3nimo';

  const { error } = await supabaseClient
    .from('chat_messages')
    .insert({
      room:         activeChatRoom,
      user_id:      currentUser.id,
      display_name: displayName,
      speaker_id:   currentProfile.speaker_id || null,
      body:         body,
      mentions:     mentions
    });

  sendBtn.disabled = false;

  if (error) {
    showToast('Error al enviar. Intent\u00e1 de nuevo.');
    return;
  }

  input.value = '';
  chatAutoResize(input);
  updateChatCharCount();
  hideMentionDropdown();

  // Request notification permission on first send
  if (typeof requestNotifPermission === 'function') requestNotifPermission();
}

// ============================================
// MENTION PARSING
// ============================================
function parseChatMentions(text) {
  const re = /@([\w\u00C0-\u024F]+(?:\s[\w\u00C0-\u024F]+)*)/g;
  const found = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    found.push(m[1]);
  }
  return [...new Set(found)];
}

// ============================================
// RENDER MESSAGE BUBBLE
// ============================================
function renderChatMessage(msg) {
  const isMine = currentUser && msg.user_id === currentUser.id;

  const wrapper = document.createElement('div');
  wrapper.className = 'chat-bubble-wrap ' + (isMine ? 'mine' : 'theirs');

  const time = new Date(msg.created_at).toLocaleTimeString('es-UY', {
    hour:   '2-digit',
    minute: '2-digit'
  });

  const nameHtml = buildChatUsername(msg.display_name, msg.speaker_id);

  const safeBody = chatEscapeHtml(msg.body);
  const bodyHtml = safeBody.replace(
    /@([\w\u00C0-\u024F]+(?:\s[\w\u00C0-\u024F]+)*)/g,
    '<span class="chat-mention-highlight">@$1</span>'
  );

  wrapper.innerHTML = `
    <div class="chat-bubble">
      <div class="chat-bubble-name">${nameHtml}</div>
      <div class="chat-bubble-body">${bodyHtml}</div>
      <div class="chat-bubble-time">${time}</div>
    </div>
  `;

  return wrapper;
}

function buildChatUsername(displayName, speakerId) {
  const safe = chatEscapeHtml(displayName);
  if (speakerId) {
    return `<button class="chat-username chat-username--speaker" onclick="openSpeakerDetail('${speakerId}'); event.stopPropagation();">${safe}</button>`;
  }
  return `<span class="chat-username">${safe}</span>`;
}

function chatEscapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================
// @MENTION AUTOCOMPLETE
// ============================================
function onChatInput(textarea) {
  chatAutoResize(textarea);
  updateChatCharCount();

  const val    = textarea.value;
  const cursor = textarea.selectionStart;
  const textBefore = val.substring(0, cursor);
  const match = textBefore.match(/@([\w\u00C0-\u024F]*)$/);

  if (match) {
    chatMentionQuery = match[1].toLowerCase();
    showMentionDropdown(chatMentionQuery);
  } else {
    hideMentionDropdown();
  }
}

function onChatKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    const dropdown = document.getElementById('chatMentionDropdown');
    if (!dropdown.classList.contains('hidden')) {
      const highlighted = dropdown.querySelector('.chat-mention-item--active');
      if (highlighted) { highlighted.click(); return; }
    }
    sendChatMessage();
  }
  if (event.key === 'Escape') {
    hideMentionDropdown();
  }
  if (mentionDropdownOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
    navigateMentionDropdown(event.key === 'ArrowDown' ? 1 : -1);
    event.preventDefault();
  }
}

function showMentionDropdown(query) {
  const candidates = speakersData
    .filter(s => s.name.toLowerCase().includes(query))
    .slice(0, 6);

  const dropdown = document.getElementById('chatMentionDropdown');

  if (!candidates.length) {
    hideMentionDropdown();
    return;
  }

  dropdown.innerHTML = candidates.map((s, i) =>
    `<button class="chat-mention-item ${i === 0 ? 'chat-mention-item--active' : ''}"
             onclick="insertChatMention('${chatEscapeHtml(s.name.replace(/'/g, "\\'"))}')">${chatEscapeHtml(s.name)}<span class="chat-mention-item-sub">${chatEscapeHtml(s.specialty || '')}</span></button>`
  ).join('');

  dropdown.classList.remove('hidden');
  mentionDropdownOpen = true;
}

function hideMentionDropdown() {
  const dropdown = document.getElementById('chatMentionDropdown');
  if (dropdown) dropdown.classList.add('hidden');
  mentionDropdownOpen = false;
  chatMentionQuery = null;
}

function navigateMentionDropdown(direction) {
  const dropdown = document.getElementById('chatMentionDropdown');
  if (dropdown.classList.contains('hidden')) return;
  const items = Array.from(dropdown.querySelectorAll('.chat-mention-item'));
  if (!items.length) return;
  const activeIdx = items.findIndex(i => i.classList.contains('chat-mention-item--active'));
  const newIdx = Math.max(0, Math.min(items.length - 1, activeIdx + direction));
  items.forEach((item, i) => item.classList.toggle('chat-mention-item--active', i === newIdx));
}

function insertChatMention(name) {
  const input = document.getElementById('chatInput');
  const val   = input.value;
  const cursor = input.selectionStart;
  const before = val.substring(0, cursor).replace(/@[\w\u00C0-\u024F]*$/, '@' + name + ' ');
  const after  = val.substring(cursor);
  input.value = before + after;
  const newPos = before.length;
  input.setSelectionRange(newPos, newPos);
  input.focus();
  hideMentionDropdown();
  chatAutoResize(input);
}

// ============================================
// MENTION NOTIFICATIONS
// ============================================
function checkMentionNotification(msg) {
  if (!currentProfile) return;
  // Don't notify yourself
  if (currentUser && msg.user_id === currentUser.id) return;

  const myName = buildFullName(currentProfile.name, currentProfile.lastname);
  if (!myName) return;

  const isMentioned = msg.mentions && msg.mentions.some(
    m => myName.toLowerCase().includes(m.toLowerCase())
  );
  if (!isMentioned) return;

  // Visual badge on session cards
  chatUnreadMentions[msg.room] = (chatUnreadMentions[msg.room] || 0) + 1;
  updateSessionCardBadges(msg.room);

  // Push notification
  if ('Notification' in window && Notification.permission === 'granted') {
    const notifDisabled = localStorage.getItem('rtcc_notif_disabled') === '1';
    if (!notifDisabled) {
      new Notification('RTCC 2026 \u2014 Te mencionaron en ' + msg.room, {
        body:  msg.display_name + ': ' + msg.body.substring(0, 80),
        icon:  (typeof BASE_PATH !== 'undefined' ? BASE_PATH : '') + 'img/logo-convention-gold.png',
        tag:   'mention-' + msg.room + '-' + msg.id
      });
    }
  }
}

function updateSessionCardBadges(roomName) {
  const count = chatUnreadMentions[roomName] || 0;
  document.querySelectorAll('.session-card').forEach(card => {
    const roomEl = card.querySelector('.session-detail');
    if (roomEl && roomEl.textContent.includes(roomName)) {
      let badge = card.querySelector('.chat-room-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'chat-room-badge';
          card.appendChild(badge);
        }
        badge.textContent = count > 9 ? '9+' : count;
      } else if (badge) {
        badge.remove();
      }
    }
  });
}

// ============================================
// INPUT UTILITIES
// ============================================
function chatAutoResize(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
}

function updateChatCharCount() {
  const input = document.getElementById('chatInput');
  const el = document.getElementById('chatCharCount');
  if (!input || !el) return;
  const remaining = 500 - input.value.length;
  el.textContent = remaining;
  el.classList.toggle('chat-char-warn', remaining < 60);
}

function scrollChatToBottom() {
  const el = document.getElementById('chatMessages');
  if (el) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
}
