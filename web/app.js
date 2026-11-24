/**
 * GrowthPilot Customer Application
 * Zero-Build Vanilla ES6+ JavaScript
 * Strict Security: Zero unsafe HTML setters (DOM nodes constructed via createElement & textContent)
 */

(function () {
  'use strict';

  // Pipeline stages in strict order
  const STAGES = ['new', 'contacted', 'replied', 'meeting', 'won', 'lost'];

  // Global state
  let currentUser = null; // { name, email, user_id }
  let activeThreadId = null;
  let isSending = false;
  let mockPipelineData = null;
  let mockDraftsData = null;

  // DOM Elements
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const navUserSlot = document.getElementById('navUserSlot');
  const systemBanner = document.getElementById('systemBanner');
  const systemBannerText = document.getElementById('systemBannerText');

  const signinView = document.getElementById('signinView');
  const workspaceView = document.getElementById('workspaceView');
  const signinForm = document.getElementById('signinForm');
  const signinName = document.getElementById('signinName');
  const signinEmail = document.getElementById('signinEmail');
  const demoAccountBtn = document.getElementById('demoAccountBtn');
  const workspaceSignoutBtn = document.getElementById('workspaceSignoutBtn');
  const activeUserEmailDisplay = document.getElementById('activeUserEmailDisplay');

  const newThreadBtn = document.getElementById('newThreadBtn');
  const threadList = document.getElementById('threadList');
  const chatFeed = document.getElementById('chatFeed');
  const chatForm = document.getElementById('chatForm');
  const chatInput = document.getElementById('chatInput');
  const chatSubmitBtn = document.getElementById('chatSubmitBtn');
  const promptChipsRow = document.getElementById('promptChipsRow');

  const kanbanBoard = document.getElementById('kanbanBoard');
  const draftsList = document.getElementById('draftsList');
  const refreshPipelineBtn = document.getElementById('refreshPipelineBtn');
  const refreshDraftsBtn = document.getElementById('refreshDraftsBtn');

  const mobileNavBtns = document.querySelectorAll('.mobile-nav-btn');
  const colThreads = document.getElementById('colThreads');
  const colChat = document.getElementById('colChat');
  const colSidebarRight = document.getElementById('colSidebarRight');

  /* ==========================================================================
     RESILIENT API CLIENT
     ========================================================================== */

  /**
   * Universal resilient API helper
   */
  async function api(path, opts = {}) {
    if (window.USE_MOCK === true) {
      return handleMockRequest(path, opts);
    }

    const url = (window.API_BASE || '') + path;
    const method = (opts.method || 'GET').toUpperCase();
    const fetchOptions = {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {})
      }
    };
    // Only GETs are retried: a timed-out POST /chat may still be running on the server,
    // and resending it would make the agent process the message twice.
    const attempts = method === 'GET' ? 2 : 1;

    for (let attempt = 1; ; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // Render cold start can take ~50s
      const slowId = setTimeout(() => showSystemBanner('Waking up the server… (free hosting sleeps when idle)'), 20000);
      try {
        const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
        if (!response.ok) {
          const httpErr = new Error(`API error: ${response.status} ${response.statusText}`);
          httpErr.status = response.status;
          throw httpErr;
        }
        return await response.json();
      } catch (err) {
        if (err.status || attempt >= attempts) throw err; // never retry HTTP errors
      } finally {
        clearTimeout(timeoutId);
        clearTimeout(slowId);
        hideSystemBanner();
      }
    }
  }

  function showSystemBanner(text) {
    if (systemBanner) {
      systemBannerText.textContent = text;
      systemBanner.classList.add('visible');
    }
  }

  function hideSystemBanner() {
    if (systemBanner) {
      systemBanner.classList.remove('visible');
    }
  }

  /* ==========================================================================
     STATEFUL MOCK ENGINE (Offline & Interactive)
     ========================================================================== */

  async function loadInitialMockData() {
    if (!mockPipelineData) {
      const stored = localStorage.getItem('gp_mock_pipeline');
      if (stored) {
        try { mockPipelineData = JSON.parse(stored); } catch (e) {}
      }
      if (!mockPipelineData) {
        try {
          const res = await fetch('mock/pipeline.json');
          mockPipelineData = await res.json();
          localStorage.setItem('gp_mock_pipeline', JSON.stringify(mockPipelineData));
        } catch (e) {
          mockPipelineData = [];
        }
      }
    }

    if (!mockDraftsData) {
      const stored = localStorage.getItem('gp_mock_drafts');
      if (stored) {
        try { mockDraftsData = JSON.parse(stored); } catch (e) {}
      }
      if (!mockDraftsData) {
        try {
          const res = await fetch('mock/drafts.json');
          mockDraftsData = await res.json();
          localStorage.setItem('gp_mock_drafts', JSON.stringify(mockDraftsData));
        } catch (e) {
          mockDraftsData = [];
        }
      }
    }
  }

  async function handleMockRequest(path, opts) {
    await loadInitialMockData();
    const method = (opts.method || 'GET').toUpperCase();

    // GET /me/pipeline?user_id=...
    if (path.startsWith('/me/pipeline')) {
      const urlParams = new URLSearchParams(path.split('?')[1] || '');
      const uid = urlParams.get('user_id') || (currentUser ? currentUser.user_id : '');
      const filtered = (mockPipelineData || []).filter(item => item.user_id === uid);
      return filtered;
    }

    // GET /me/drafts?user_id=...
    if (path.startsWith('/me/drafts')) {
      const urlParams = new URLSearchParams(path.split('?')[1] || '');
      const uid = urlParams.get('user_id') || (currentUser ? currentUser.user_id : '');
      const filtered = (mockDraftsData || []).filter(item => item.user_id === uid);
      return filtered;
    }

    // POST /chat
    if (path === '/chat' && method === 'POST') {
      const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {});
      const msg = (body.message || '').trim().toLowerCase();
      const uid = body.user_id || (currentUser ? currentUser.user_id : 'demo_user');

      // Simulate network latency (250-450ms)
      await new Promise(r => setTimeout(r, 350));

      // Intelligent mock scenario matching
      if (msg.includes('gym') || msg.includes('dubai')) {
        // Add lead to pipeline if not present
        if (!mockPipelineData.some(p => p.user_id === uid && p.lead_id === 4)) {
          mockPipelineData.push({
            user_id: uid,
            lead_id: 4,
            company: 'Quartz Palm Gym',
            contact_name: 'Omar Al-Fassi',
            stage: 'new',
            note: 'High-end fitness club in Downtown Dubai; interested in automated trial class bookings.',
            updated_at: new Date().toISOString()
          });
          localStorage.setItem('gp_mock_pipeline', JSON.stringify(mockPipelineData));
        }

        return {
          reply: 'Found 3 verified fitness clubs in Dubai matching your criteria:\n\n1. Quartz Palm Gym (Downtown Dubai, 45 staff, contact: Omar Al-Fassi)\n2. Marina Iron Athletics (Dubai Marina, 32 staff, contact: Marcus Vance)\n3. Al-Wasl Crossfit (Al Wasl, 15 staff, contact: Hassan Darwish)\n\nI have added Quartz Palm Gym to your pipeline in stage "new". Would you like me to draft an introductory cold outreach email to Omar?',
          tool_calls: [
            {
              name: 'find_leads',
              args: { city: 'Dubai', query: 'gyms', limit: 5 }
            },
            {
              name: 'update_pipeline',
              args: { lead_id: 4, stage: 'new' }
            }
          ],
          tokens: { in: 1240, out: 185 }
        };
      }

      if (msg.includes('email') || msg.includes('draft') || msg.includes('lead #3') || msg.includes('lead 3') || msg.includes('write')) {
        const newDraft = {
          id: Date.now(),
          user_id: uid,
          lead_id: 3,
          company: 'Apex Pulse Physiotherapy',
          subject: 'Eliminating clinic scheduling bottlenecks for Apex Pulse',
          body: 'Hi Zainab,\n\nSaw that Apex Pulse is expanding its physiotherapy practice in Gulberg. With multiple clinic branches, coordinating therapist calendars and eliminating patient no-shows can get hectic.\n\nOur automated booking software synchronizes appointments across locations with automated SMS confirmations.\n\nOpen to a brief 5-minute demo this Thursday?\n\nBest,\n' + (currentUser ? currentUser.name : 'Sara'),
          status: 'pending_send',
          created_at: new Date().toISOString(),
          sent_at: null
        };
        mockDraftsData.unshift(newDraft);
        localStorage.setItem('gp_mock_drafts', JSON.stringify(mockDraftsData));

        return {
          reply: 'I reviewed Apex Pulse Physiotherapy (Lead #3, Zainab Raza). Based on their multi-clinic expansion in Gulberg, I drafted a personalized outreach email emphasizing location calendar sync and SMS reminders.\n\nThe draft is saved as "pending_send". Would you like me to send it to zainab@apexpulse.example.com?',
          tool_calls: [
            {
              name: 'get_lead',
              args: { lead_id: 3 }
            },
            {
              name: 'save_draft',
              args: { lead_id: 3, subject: newDraft.subject }
            }
          ],
          tokens: { in: 1810, out: 260 }
        };
      }

      if (msg.includes('send') || msg.includes('confirm') || msg.includes('yes') || msg.includes('proceed')) {
        // Mark pending drafts as sent
        let sentCount = 0;
        let lastCompany = 'the lead';
        mockDraftsData.forEach(d => {
          if (d.user_id === uid && d.status === 'pending_send') {
            d.status = 'sent';
            d.sent_at = new Date().toISOString();
            sentCount++;
            lastCompany = d.company;
            // update pipeline stage to contacted
            const p = mockPipelineData.find(item => item.user_id === uid && item.lead_id === d.lead_id);
            if (p) {
              p.stage = 'contacted';
              p.updated_at = new Date().toISOString();
            } else {
              mockPipelineData.push({
                user_id: uid,
                lead_id: d.lead_id,
                company: d.company,
                contact_name: 'Lead Contact',
                stage: 'contacted',
                note: 'Outreach email dispatched.',
                updated_at: new Date().toISOString()
              });
            }
          }
        });
        localStorage.setItem('gp_mock_drafts', JSON.stringify(mockDraftsData));
        localStorage.setItem('gp_mock_pipeline', JSON.stringify(mockPipelineData));

        return {
          reply: `Outreach email successfully sent to ${lastCompany}! The deal stage has been moved to "contacted" on your pipeline board.`,
          tool_calls: [
            {
              name: 'send_email',
              args: { draft_id: 101 }
            },
            {
              name: 'update_pipeline',
              args: { stage: 'contacted' }
            }
          ],
          tokens: { in: 950, out: 140 }
        };
      }

      if (msg.includes('pipeline') || msg.includes('show') || msg.includes('board')) {
        return {
          reply: 'Here is your active sales pipeline. You currently have deals across new, contacted, replied, meeting, and won stages. Your live pipeline board on the right has also been refreshed.',
          tool_calls: [
            {
              name: 'view_pipeline',
              args: { user_id: uid }
            }
          ],
          tokens: { in: 820, out: 95 }
        };
      }

      if (msg.includes('sell') || msg.includes('booking') || msg.includes('software') || msg.includes('remember')) {
        return {
          reply: 'Got it! I have permanently remembered this key context: you sell online booking software tailored for healthcare clinics and fitness studios. I will customize all future outreach angles and value propositions around this offering.',
          tool_calls: [
            {
              name: 'remember',
              args: { fact: 'User sells online booking software for clinics and fitness clubs.' }
            }
          ],
          tokens: { in: 1120, out: 130 }
        };
      }

      // Default sales response
      return {
        reply: `Understood. I'm ready to find targeted leads, generate personalized outreach drafts, or advance contacts through your pipeline stages. Try asking: "Find 5 gyms in Dubai" or "Write an email to lead #3".`,
        tool_calls: [],
        tokens: { in: 480, out: 65 }
      };
    }

    return {};
  }

  /* ==========================================================================
     USER IDENTITY & AUTHENTICATION
     ========================================================================== */

  function initUserSession() {
    const stored = localStorage.getItem('gp_user');
    if (stored) {
      try {
        currentUser = JSON.parse(stored);
      } catch (e) {
        currentUser = null;
      }
    }

    renderUserHeader();
    if (currentUser) {
      showWorkspace();
    } else {
      showSignin();
    }
  }

  function renderUserHeader() {
    while (navUserSlot.firstChild) {
      navUserSlot.removeChild(navUserSlot.firstChild);
    }

    if (currentUser) {
      const badge = document.createElement('div');
      badge.className = 'user-badge-header';

      const userText = document.createElement('span');
      userText.textContent = currentUser.name || currentUser.email;
      badge.appendChild(userText);

      const signoutBtn = document.createElement('button');
      signoutBtn.type = 'button';
      signoutBtn.className = 'btn-header-signout';
      signoutBtn.textContent = 'Sign out';
      signoutBtn.addEventListener('click', handleSignout);
      badge.appendChild(signoutBtn);

      navUserSlot.appendChild(badge);
      if (activeUserEmailDisplay) {
        activeUserEmailDisplay.textContent = currentUser.email;
      }
    } else {
      const signinBtn = document.createElement('a');
      signinBtn.href = '#workspace';
      signinBtn.className = 'btn btn-secondary btn-sm';
      signinBtn.textContent = 'Sign In';
      signinBtn.addEventListener('click', () => {
        signinName.focus();
      });
      navUserSlot.appendChild(signinBtn);
      if (activeUserEmailDisplay) {
        activeUserEmailDisplay.textContent = '';
      }
    }
  }

  function showSignin() {
    signinView.style.display = 'block';
    workspaceView.style.display = 'none';
  }

  function showWorkspace() {
    signinView.style.display = 'none';
    workspaceView.style.display = 'flex';
    initThreads();
    refreshLivePipeline();
    refreshOutreachDrafts();
  }

  function handleSignout() {
    localStorage.removeItem('gp_user');
    currentUser = null;
    activeThreadId = null;
    renderUserHeader();
    showSignin();
  }

  /* ==========================================================================
     CONVERSATIONS / THREADS
     ========================================================================== */

  function getThreadsStorageKey() {
    return 'gp_threads_' + (currentUser ? currentUser.user_id : 'guest');
  }

  function getMessagesStorageKey(threadId) {
    return 'gp_msgs_' + threadId;
  }

  function loadSavedThreads() {
    const raw = localStorage.getItem(getThreadsStorageKey());
    if (raw) {
      try { return JSON.parse(raw); } catch (e) { return []; }
    }
    return [];
  }

  function saveThreads(threads) {
    localStorage.setItem(getThreadsStorageKey(), JSON.stringify(threads));
  }

  function initThreads() {
    const threads = loadSavedThreads();
    if (threads.length === 0) {
      createNewThread(false);
    } else {
      activeThreadId = threads[0].id;
      renderThreadList();
      loadMessagesForActiveThread();
    }
  }

  function createNewThread(shouldFocus = true) {
    const newThread = {
      id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 't_' + Date.now(),
      title: 'New conversation',
      created: Date.now()
    };

    const threads = loadSavedThreads();
    threads.unshift(newThread);
    saveThreads(threads);

    activeThreadId = newThread.id;
    renderThreadList();
    loadMessagesForActiveThread();

    if (shouldFocus && chatInput) {
      chatInput.focus();
    }
  }

  function renderThreadList() {
    while (threadList.firstChild) {
      threadList.removeChild(threadList.firstChild);
    }

    const threads = loadSavedThreads();
    threads.forEach(t => {
      const item = document.createElement('div');
      item.className = 'thread-item' + (t.id === activeThreadId ? ' active' : '');
      item.setAttribute('role', 'button');
      item.setAttribute('tabindex', '0');

      const titleEl = document.createElement('div');
      titleEl.className = 'thread-item-title';
      titleEl.textContent = t.title || 'New conversation';

      const dateEl = document.createElement('div');
      dateEl.className = 'thread-item-date';
      const d = new Date(t.created);
      dateEl.textContent = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

      item.appendChild(titleEl);
      item.appendChild(dateEl);

      item.addEventListener('click', () => {
        if (activeThreadId !== t.id) {
          activeThreadId = t.id;
          renderThreadList();
          loadMessagesForActiveThread();
        }
      });

      threadList.appendChild(item);
    });
  }

  function updateActiveThreadTitle(firstMsgText) {
    if (!activeThreadId) return;
    const threads = loadSavedThreads();
    const thread = threads.find(t => t.id === activeThreadId);
    if (thread && thread.title === 'New conversation') {
      thread.title = firstMsgText.slice(0, 40) + (firstMsgText.length > 40 ? '…' : '');
      saveThreads(threads);
      renderThreadList();
    }
  }

  /* ==========================================================================
     CHAT MESSAGES & COMPOSER
     Strict Security: Zero unsafe HTML setters (DOM nodes constructed via createElement & textContent)
     ========================================================================== */

  function loadMessagesForActiveThread() {
    while (chatFeed.firstChild) {
      chatFeed.removeChild(chatFeed.firstChild);
    }

    if (!activeThreadId) return;
    const raw = localStorage.getItem(getMessagesStorageKey(activeThreadId));
    let msgs = [];
    if (raw) {
      try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    }

    if (msgs.length === 0) {
      renderChatEmptyState();
    } else {
      msgs.forEach(m => renderMessageBubble(m));
      scrollChatToBottom();
    }
  }

  function saveMessage(msgObj) {
    if (!activeThreadId) return;
    const raw = localStorage.getItem(getMessagesStorageKey(activeThreadId));
    let msgs = [];
    if (raw) {
      try { msgs = JSON.parse(raw); } catch (e) { msgs = []; }
    }
    msgs.push(msgObj);
    localStorage.setItem(getMessagesStorageKey(activeThreadId), JSON.stringify(msgs));
  }

  function renderChatEmptyState() {
    const emptyWrapper = document.createElement('div');
    emptyWrapper.className = 'chat-empty-state';

    const title = document.createElement('div');
    title.className = 'chat-empty-title';
    title.textContent = 'GrowthPilot Outbound Engine';

    const desc = document.createElement('div');
    desc.className = 'chat-empty-desc';
    desc.textContent = 'Ask to find targeted leads, draft tailored cold outreach emails, or advance deals through your pipeline stages.';

    emptyWrapper.appendChild(title);
    emptyWrapper.appendChild(desc);
    chatFeed.appendChild(emptyWrapper);
  }

  function renderMessageBubble(msg) {
    // Remove empty state if present
    const emptyState = chatFeed.querySelector('.chat-empty-state');
    if (emptyState) {
      chatFeed.removeChild(emptyState);
    }

    const row = document.createElement('div');
    row.className = 'chat-msg ' + (msg.role === 'user' ? 'user' : 'assistant');

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    bubble.textContent = msg.text || '';
    row.appendChild(bubble);

    // Assistant metadata: tool_calls pills and token metrics
    if (msg.role === 'assistant') {
      const metaRow = document.createElement('div');
      metaRow.className = 'msg-meta-row';

      // Tool calls pills
      if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
        const toolsRow = document.createElement('div');
        toolsRow.className = 'tools-row';

        msg.tool_calls.forEach(tc => {
          const pill = document.createElement('span');
          pill.className = 'tool-pill';

          // Tool pill icon symbol
          const iconSpan = document.createElement('span');
          iconSpan.className = 'mono';
          iconSpan.textContent = getToolSymbol(tc.name);
          pill.appendChild(iconSpan);

          const nameSpan = document.createElement('span');
          nameSpan.textContent = tc.name;
          pill.appendChild(nameSpan);

          toolsRow.appendChild(pill);
        });

        metaRow.appendChild(toolsRow);
      }

      // Token count metric line
      if (msg.tokens) {
        const tokenMeta = document.createElement('span');
        tokenMeta.className = 'token-meta';
        const inTok = msg.tokens.in || 0;
        const outTok = msg.tokens.out || 0;
        tokenMeta.textContent = `tokens: ${inTok} in / ${outTok} out`;
        metaRow.appendChild(tokenMeta);
      }

      if (metaRow.hasChildNodes()) {
        row.appendChild(metaRow);
      }
    }

    chatFeed.appendChild(row);
  }

  function getToolSymbol(name) {
    switch (name) {
      case 'find_leads': return '⌕ ';
      case 'get_lead': return '📄 ';
      case 'save_draft': return '✎ ';
      case 'send_email': return '↗ ';
      case 'update_pipeline': return '⊞ ';
      case 'view_pipeline': return '☰ ';
      case 'remember': return '✦ ';
      default: return '⚙ ';
    }
  }

  function showTypingIndicator() {
    const indicator = document.createElement('div');
    indicator.className = 'typing-indicator';
    indicator.id = 'typingIndicator';

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      indicator.appendChild(dot);
    }

    chatFeed.appendChild(indicator);
    scrollChatToBottom();
  }

  function hideTypingIndicator() {
    const el = document.getElementById('typingIndicator');
    if (el && el.parentNode) {
      el.parentNode.removeChild(el);
    }
  }

  function scrollChatToBottom() {
    chatFeed.scrollTop = chatFeed.scrollHeight;
  }

  async function handleSendMessage(text) {
    if (!text || isSending) return;
    if (!currentUser) {
      showSignin();
      return;
    }

    isSending = true;
    chatSubmitBtn.disabled = true;

    // User message
    const userMsg = {
      role: 'user',
      text: text,
      timestamp: Date.now()
    };
    saveMessage(userMsg);
    renderMessageBubble(userMsg);
    scrollChatToBottom();

    // Update thread title if first message
    updateActiveThreadTitle(text);

    // Show typing indicator
    showTypingIndicator();

    try {
      const payload = {
        user_id: currentUser.user_id,
        thread_id: activeThreadId,
        message: text
      };

      const res = await api('/chat', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      hideTypingIndicator();

      const assistantMsg = {
        role: 'assistant',
        text: res.reply || 'No response returned.',
        tool_calls: res.tool_calls || [],
        tokens: res.tokens || { in: 0, out: 0 },
        timestamp: Date.now()
      };

      saveMessage(assistantMsg);
      renderMessageBubble(assistantMsg);
      scrollChatToBottom();

      // Automatically refresh both live pipeline and drafts after reply
      refreshLivePipeline();
      refreshOutreachDrafts();
    } catch (err) {
      hideTypingIndicator();

      const errorMsg = {
        role: 'assistant',
        text: `Error connecting to backend: ${err.message}. Please retry.`,
        tool_calls: [],
        tokens: { in: 0, out: 0 },
        timestamp: Date.now()
      };
      saveMessage(errorMsg);
      renderMessageBubble(errorMsg);
      scrollChatToBottom();
    } finally {
      isSending = false;
      chatSubmitBtn.disabled = false;
      chatInput.focus();
    }
  }

  /* ==========================================================================
     LIVE PIPELINE KANBAN (Strict Stage Order)
     new · contacted · replied · meeting · won · lost
     ========================================================================== */

  async function refreshLivePipeline() {
    if (!currentUser) return;
    try {
      const data = await api(`/me/pipeline?user_id=${encodeURIComponent(currentUser.user_id)}`);
      renderKanban(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load live pipeline:', err);
    }
  }

  function renderKanban(pipelineDeals) {
    while (kanbanBoard.firstChild) {
      kanbanBoard.removeChild(kanbanBoard.firstChild);
    }

    // Group deals by stage
    const grouped = {};
    STAGES.forEach(s => { grouped[s] = []; });
    pipelineDeals.forEach(deal => {
      const st = (deal.stage || 'new').toLowerCase();
      if (grouped[st]) {
        grouped[st].push(deal);
      } else {
        grouped['new'].push(deal);
      }
    });

    // Render columns in strict order
    STAGES.forEach(stage => {
      const deals = grouped[stage];

      const col = document.createElement('div');
      col.className = 'kanban-col';

      // Header
      const colHead = document.createElement('div');
      colHead.className = 'kanban-col-head';

      const label = document.createElement('span');
      label.className = 'kanban-col-label';
      label.textContent = stage;

      const count = document.createElement('span');
      count.className = 'kanban-col-count';
      count.textContent = deals.length;

      colHead.appendChild(label);
      colHead.appendChild(count);
      col.appendChild(colHead);

      // Card List
      const cardList = document.createElement('div');
      cardList.className = 'kanban-card-list';

      if (deals.length === 0) {
        const emptyLabel = document.createElement('div');
        emptyLabel.style.color = 'var(--text-muted)';
        emptyLabel.style.fontSize = '12px';
        emptyLabel.style.textAlign = 'center';
        emptyLabel.style.padding = '8px 0';
        emptyLabel.textContent = 'Empty';
        cardList.appendChild(emptyLabel);
      } else {
        deals.forEach(deal => {
          const card = document.createElement('div');
          card.className = 'kanban-card';

          const comp = document.createElement('div');
          comp.className = 'kanban-card-company';
          comp.textContent = deal.company || `Lead #${deal.lead_id}`;
          card.appendChild(comp);

          if (deal.contact_name) {
            const contact = document.createElement('div');
            contact.className = 'kanban-card-contact';
            contact.textContent = deal.contact_name;
            card.appendChild(contact);
          }

          if (deal.note) {
            const note = document.createElement('div');
            note.className = 'kanban-card-note';
            note.textContent = deal.note;
            card.appendChild(note);
          }

          cardList.appendChild(card);
        });
      }

      col.appendChild(cardList);
      kanbanBoard.appendChild(col);
    });
  }

  /* ==========================================================================
     OUTREACH DRAFTS ACCORDION
     Status Pills: draft (slate) | pending_send (amber) | sent (emerald)
     ========================================================================== */

  async function refreshOutreachDrafts() {
    if (!currentUser) return;
    try {
      const data = await api(`/me/drafts?user_id=${encodeURIComponent(currentUser.user_id)}`);
      renderDrafts(Array.isArray(data) ? data : []);
    } catch (err) {
      console.warn('Failed to load drafts:', err);
    }
  }

  function renderDrafts(drafts) {
    while (draftsList.firstChild) {
      draftsList.removeChild(draftsList.firstChild);
    }

    if (drafts.length === 0) {
      const emptyBox = document.createElement('div');
      emptyBox.style.color = 'var(--text-muted)';
      emptyBox.style.fontSize = '12px';
      emptyBox.style.textAlign = 'center';
      emptyBox.style.padding = '16px';
      emptyBox.textContent = 'No outreach drafts yet. Ask GrowthPilot to draft an email!';
      draftsList.appendChild(emptyBox);
      return;
    }

    drafts.forEach(draft => {
      const card = document.createElement('article');
      card.className = 'draft-card';

      // Summary Header (clickable accordion toggle)
      const summary = document.createElement('div');
      summary.className = 'draft-card-summary';
      summary.setAttribute('role', 'button');
      summary.setAttribute('tabindex', '0');

      const headerRow = document.createElement('div');
      headerRow.className = 'draft-card-header';

      const comp = document.createElement('span');
      comp.className = 'draft-card-company';
      comp.textContent = draft.company || `Lead #${draft.lead_id}`;

      // Status pill
      const pill = document.createElement('span');
      const st = (draft.status || 'draft').toLowerCase();
      pill.className = `badge badge-${st}`;
      pill.textContent = st.replace('_', ' ');

      headerRow.appendChild(comp);
      headerRow.appendChild(pill);
      summary.appendChild(headerRow);

      const subj = document.createElement('div');
      subj.className = 'draft-card-subject';
      subj.textContent = draft.subject || '(No subject)';
      summary.appendChild(subj);

      card.appendChild(summary);

      // Accordion Content Body
      const bodyAccordion = document.createElement('div');
      bodyAccordion.className = 'draft-card-body-accordion';

      const bodyText = document.createElement('div');
      bodyText.className = 'draft-body-text';
      bodyText.textContent = draft.body || '';
      bodyAccordion.appendChild(bodyText);

      // Timestamps
      const timeRow = document.createElement('div');
      timeRow.className = 'draft-timestamps';

      if (draft.created_at) {
        const createdSpan = document.createElement('span');
        const d = new Date(draft.created_at);
        createdSpan.textContent = 'Created: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeRow.appendChild(createdSpan);
      }

      if (draft.sent_at) {
        const sentSpan = document.createElement('span');
        const d = new Date(draft.sent_at);
        sentSpan.textContent = 'Sent: ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        timeRow.appendChild(sentSpan);
      }

      bodyAccordion.appendChild(timeRow);
      card.appendChild(bodyAccordion);

      // Accordion toggle
      summary.addEventListener('click', () => {
        card.classList.toggle('open');
      });

      draftsList.appendChild(card);
    });
  }

  /* ==========================================================================
     EVENT LISTENERS & LIFECYCLE
     ========================================================================== */

  // Sign In Form Submission
  signinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = signinName.value.trim();
    const email = signinEmail.value.trim();

    if (!name || !email) return;

    currentUser = {
      name: name,
      email: email,
      user_id: email.toLowerCase()
    };
    localStorage.setItem('gp_user', JSON.stringify(currentUser));
    renderUserHeader();
    showWorkspace();
  });

  // Demo Account 1-Click
  demoAccountBtn.addEventListener('click', () => {
    currentUser = {
      name: 'Sara Jenkins',
      email: 'sara@clinicflow.io',
      user_id: 'sara@clinicflow.io'
    };
    localStorage.setItem('gp_user', JSON.stringify(currentUser));
    renderUserHeader();
    showWorkspace();
  });

  // Workspace Signout Button
  workspaceSignoutBtn.addEventListener('click', handleSignout);

  // New Thread
  newThreadBtn.addEventListener('click', () => createNewThread(true));

  // Chat Form Submission
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = '';
    chatInput.style.height = 'auto';
    handleSendMessage(text);
  });

  // Auto-expand textarea & Enter to send
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      chatForm.dispatchEvent(new Event('submit'));
    }
  });

  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
  });

  // Prompt Chips
  promptChipsRow.addEventListener('click', (e) => {
    const chip = e.target.closest('.prompt-chip');
    if (!chip) return;
    const text = chip.getAttribute('data-prompt');
    if (text) {
      chatInput.value = text;
      handleSendMessage(text);
    }
  });

  // Pricing CTAs scroll to workspace
  document.querySelectorAll('.pricing-cta-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const workspaceEl = document.getElementById('workspace');
      if (workspaceEl) {
        workspaceEl.scrollIntoView({ behavior: 'smooth' });
        if (!currentUser) {
          signinName.focus();
        } else {
          chatInput.focus();
        }
      }
    });
  });

  const heroStartFreeBtn = document.getElementById('heroStartFreeBtn');
  if (heroStartFreeBtn) {
    heroStartFreeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const workspaceEl = document.getElementById('workspace');
      if (workspaceEl) {
        workspaceEl.scrollIntoView({ behavior: 'smooth' });
        if (!currentUser) {
          signinName.focus();
        } else {
          chatInput.focus();
        }
      }
    });
  }

  // Refresh Buttons
  refreshPipelineBtn.addEventListener('click', refreshLivePipeline);
  refreshDraftsBtn.addEventListener('click', refreshOutreachDrafts);

  // Mobile navigation tabs (< 900px)
  mobileNavBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      mobileNavBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      colThreads.classList.remove('mobile-active');
      colChat.classList.remove('mobile-active');
      colSidebarRight.classList.remove('mobile-active');

      const target = btn.getAttribute('data-tab');
      if (target === 'threads') {
        colThreads.classList.add('mobile-active');
      } else if (target === 'pipeline') {
        colSidebarRight.classList.add('mobile-active');
      } else {
        colChat.classList.add('mobile-active');
      }
    });
  });

  // Status indicator
  function updateStatusDisplay() {
    if (window.USE_MOCK) {
      statusIndicator.classList.add('mock');
      statusText.textContent = 'Mock Mode';
      return;
    }
    statusIndicator.classList.remove('mock');
    statusText.textContent = 'Checking API…';
    fetch((window.API_BASE || '') + '/health')
      .then(r => r.text())
      .then(t => { statusText.textContent = t.trim() === 'ok' ? 'API Ready' : 'API Error'; })
      .catch(() => { statusText.textContent = 'API Offline'; });
  }

  // Initialize
  updateStatusDisplay();
  initUserSession();

})();
