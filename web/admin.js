/**
 * GrowthPilot Admin Dashboard & Executive Telemetry
 * Zero-Build Vanilla ES6+ JavaScript
 * Strict Security: Zero unsafe HTML setters (DOM nodes constructed via createElement & textContent)
 */

(function () {
  'use strict';

  // Strict pipeline stages
  const STAGES = ['new', 'contacted', 'replied', 'meeting', 'won', 'lost'];

  // Global state
  let adminToken = null;
  let activeTab = 'pipeline';
  let pollIntervalId = null;

  // Local state for mock mode
  let mockStats = null;
  let mockPipeline = null;
  let mockOutbox = null;
  let mockChats = null;
  let mockLeads = null;

  // DOM Elements
  const adminGateView = document.getElementById('adminGateView');
  const adminContentView = document.getElementById('adminContentView');
  const adminTokenForm = document.getElementById('adminTokenForm');
  const adminTokenInput = document.getElementById('adminTokenInput');
  const gateErrorText = document.getElementById('gateErrorText');
  const adminAuthControls = document.getElementById('adminAuthControls');
  const tokenPreviewDisplay = document.getElementById('tokenPreviewDisplay');
  const lockTokenBtn = document.getElementById('lockTokenBtn');
  const manualRefreshBtn = document.getElementById('manualRefreshBtn');
  const systemBanner = document.getElementById('systemBanner');
  const systemBannerText = document.getElementById('systemBannerText');

  const statsTilesGrid = document.getElementById('statsTilesGrid');
  const pipelineProgressBar = document.getElementById('pipelineProgressBar');
  const pipelineLegend = document.getElementById('pipelineLegend');
  const pipelineTotalLeadsCount = document.getElementById('pipelineTotalLeadsCount');

  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabActionSlot = document.getElementById('tabActionSlot');
  const addLeadBox = document.getElementById('addLeadBox');
  const addLeadForm = document.getElementById('addLeadForm');
  const cancelAddLeadBtn = document.getElementById('cancelAddLeadBtn');
  const addLeadSubmitBtn = document.getElementById('addLeadSubmitBtn');

  const adminTableHead = document.getElementById('adminTableHead');
  const adminTableBody = document.getElementById('adminTableBody');

  /* ==========================================================================
     RESILIENT API CLIENT WITH 401 TOKEN EXPIRATION HANDLING
     ========================================================================== */

  async function api(path, opts = {}) {
    if (window.USE_MOCK === true) {
      return handleMockAdminRequest(path, opts);
    }

    const url = (window.API_BASE || '') + path;
    const fetchOptions = {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': adminToken || '',
        ...(opts.headers || {})
      }
    };

    let controller = new AbortController();
    let timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.status === 401) {
        handleUnauthorizedToken('Invalid or expired admin token');
        throw new Error('Unauthorized: Invalid or expired admin token');
      }

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message && err.message.includes('Unauthorized')) {
        throw err;
      }

      // Cold-start auto-retry ONCE
      showSystemBanner('Waking up the server… (free hosting sleeps when idle)');
      try {
        controller = new AbortController();
        timeoutId = setTimeout(() => controller.abort(), 60000);
        const retryRes = await fetch(url, { ...fetchOptions, signal: controller.signal });
        clearTimeout(timeoutId);
        hideSystemBanner();

        if (retryRes.status === 401) {
          handleUnauthorizedToken('Invalid or expired admin token');
          throw new Error('Unauthorized');
        }

        if (!retryRes.ok) {
          throw new Error(`API error after retry: ${retryRes.status}`);
        }
        return await retryRes.json();
      } catch (retryErr) {
        clearTimeout(timeoutId);
        hideSystemBanner();
        throw retryErr;
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

  function handleUnauthorizedToken(errorMsg) {
    localStorage.removeItem('gp_admin_token');
    adminToken = null;
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    showGateView(errorMsg);
  }

  /* ==========================================================================
     MOCK ADMIN REQUEST HANDLER
     ========================================================================== */

  async function loadInitialMockAdminData() {
    if (!mockStats) {
      try {
        const res = await fetch('mock/admin_stats.json');
        mockStats = await res.json();
      } catch (e) {
        mockStats = { users: 0, leads: 0, sent: 0, drafts: 0, chats: 0, tokens_in: 0, tokens_out: 0, avg_ms: 0, pipeline: {} };
      }
    }

    if (!mockPipeline) {
      try {
        const res = await fetch('mock/admin_pipeline.json');
        mockPipeline = await res.json();
      } catch (e) {
        mockPipeline = [];
      }
    }

    if (!mockOutbox) {
      try {
        const res = await fetch('mock/admin_outbox.json');
        mockOutbox = await res.json();
      } catch (e) {
        mockOutbox = [];
      }
    }

    if (!mockChats) {
      try {
        const res = await fetch('mock/admin_chats.json');
        mockChats = await res.json();
      } catch (e) {
        mockChats = [];
      }
    }

    if (!mockLeads) {
      const stored = localStorage.getItem('gp_mock_leads');
      if (stored) {
        try { mockLeads = JSON.parse(stored); } catch (e) {}
      }
      if (!mockLeads) {
        try {
          const res = await fetch('mock/admin_leads.json');
          mockLeads = await res.json();
          localStorage.setItem('gp_mock_leads', JSON.stringify(mockLeads));
        } catch (e) {
          mockLeads = [];
        }
      }
    }
  }

  async function handleMockAdminRequest(path, opts) {
    await loadInitialMockAdminData();
    const method = (opts.method || 'GET').toUpperCase();

    // Check token mock gate
    if (!adminToken) {
      handleUnauthorizedToken('Invalid or expired admin token');
      throw new Error('Unauthorized');
    }

    if (path === '/admin/stats') {
      return mockStats;
    }

    if (path === '/admin/pipeline') {
      return mockPipeline;
    }

    if (path === '/admin/outbox') {
      return mockOutbox;
    }

    if (path.startsWith('/admin/chats')) {
      return mockChats;
    }

    if (path === '/admin/leads') {
      if (method === 'GET') {
        return mockLeads;
      }
      if (method === 'POST') {
        const newLead = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body || {});
        newLead.id = mockLeads.length > 0 ? Math.max(...mockLeads.map(l => l.id || 0)) + 1 : 1;
        mockLeads.unshift(newLead);
        localStorage.setItem('gp_mock_leads', JSON.stringify(mockLeads));

        // Update stats
        if (mockStats) {
          mockStats.leads = (mockStats.leads || 0) + 1;
        }
        return newLead;
      }
    }

    return [];
  }

  /* ==========================================================================
     AUTHENTICATION GATE
     ========================================================================== */

  function initAdminAuth() {
    adminToken = localStorage.getItem('gp_admin_token');
    if (adminToken) {
      showContentView();
    } else {
      showGateView();
    }
  }

  function showGateView(errorText = '') {
    adminGateView.style.display = 'block';
    adminContentView.style.display = 'none';
    adminAuthControls.style.display = 'none';

    if (errorText) {
      gateErrorText.textContent = errorText;
      gateErrorText.style.display = 'block';
    } else {
      gateErrorText.textContent = '';
      gateErrorText.style.display = 'none';
    }

    adminTokenInput.value = '';
    adminTokenInput.focus();
  }

  function showContentView() {
    adminGateView.style.display = 'none';
    adminContentView.style.display = 'flex';
    adminAuthControls.style.display = 'flex';

    // Show masked token preview
    const preview = adminToken.length > 6 ? adminToken.slice(0, 3) + '…' + adminToken.slice(-3) : adminToken;
    tokenPreviewDisplay.textContent = 'Token: ' + preview;

    // Load initial data
    refreshAllAdminData();

    // Start 15s polling
    if (!pollIntervalId) {
      pollIntervalId = setInterval(refreshAllAdminData, 15000);
    }
  }

  function lockAdminToken() {
    localStorage.removeItem('gp_admin_token');
    adminToken = null;
    if (pollIntervalId) {
      clearInterval(pollIntervalId);
      pollIntervalId = null;
    }
    showGateView();
  }

  /* ==========================================================================
     EXECUTIVE KPI STAT TILES
     Tokens, Est Spend ($0.0000), Latency (ms)
     ========================================================================== */

  async function loadStats() {
    try {
      const stats = await api('/admin/stats');
      renderStatTiles(stats || {});
      renderPipelineBreakdown(stats.pipeline || {});
    } catch (err) {
      console.warn('Failed to load admin stats:', err);
    }
  }

  function renderStatTiles(stats) {
    while (statsTilesGrid.firstChild) {
      statsTilesGrid.removeChild(statsTilesGrid.firstChild);
    }

    const tokensIn = Number(stats.tokens_in) || 0;
    const tokensOut = Number(stats.tokens_out) || 0;

    // Est. Spend exact formula: (tokens_in * 0.10 / 1e6) + (tokens_out * 0.50 / 1e6)
    const spend = (tokensIn * 0.10 / 1e6) + (tokensOut * 0.50 / 1e6);
    const formattedSpend = '$' + spend.toFixed(4);

    const tiles = [
      {
        label: 'Users',
        value: String(stats.users || 0),
        subtext: 'Active accounts'
      },
      {
        label: 'Leads',
        value: String(stats.leads || 0),
        subtext: 'Prospects in database'
      },
      {
        label: 'Emails Sent',
        value: String(stats.sent || 0),
        subtext: `${stats.drafts || 0} drafts in queue`
      },
      {
        label: 'Chats',
        value: String(stats.chats || 0),
        subtext: 'Completed turns'
      },
      {
        label: 'Tokens (In / Out)',
        value: `${tokensIn.toLocaleString()} / ${tokensOut.toLocaleString()}`,
        subtext: 'Prompt / Completion tokens'
      },
      {
        label: 'Est. Spend',
        value: formattedSpend,
        subtext: '$0.10 / $0.50 per 1M tokens'
      },
      {
        label: 'Avg Latency',
        value: `${stats.avg_ms || 0} ms`,
        subtext: 'Turn-around response'
      }
    ];

    tiles.forEach(tile => {
      const card = document.createElement('div');
      card.className = 'stat-tile';

      const label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = tile.label;

      const num = document.createElement('span');
      num.className = 'stat-number mono';
      num.textContent = tile.value;

      const sub = document.createElement('span');
      sub.className = 'stat-subtext';
      sub.textContent = tile.subtext;

      card.appendChild(label);
      card.appendChild(num);
      card.appendChild(sub);
      statsTilesGrid.appendChild(card);
    });
  }

  /* ==========================================================================
     PIPELINE BY STAGE BREAKDOWN
     Pure CSS horizontal progress/distribution bar row across 6 stages
     ========================================================================== */

  function renderPipelineBreakdown(pipelineCounts) {
    while (pipelineProgressBar.firstChild) {
      pipelineProgressBar.removeChild(pipelineProgressBar.firstChild);
    }
    while (pipelineLegend.firstChild) {
      pipelineLegend.removeChild(pipelineLegend.firstChild);
    }

    let total = 0;
    STAGES.forEach(s => {
      total += Number(pipelineCounts[s]) || 0;
    });

    pipelineTotalLeadsCount.textContent = `${total} leads in pipeline`;

    if (total === 0) {
      const emptySegment = document.createElement('div');
      emptySegment.className = 'breakdown-segment';
      emptySegment.style.width = '100%';
      emptySegment.style.backgroundColor = 'var(--border)';
      pipelineProgressBar.appendChild(emptySegment);
      return;
    }

    STAGES.forEach(stage => {
      const count = Number(pipelineCounts[stage]) || 0;
      const pct = (count / total) * 100;

      // Progress bar segment
      if (pct > 0) {
        const seg = document.createElement('div');
        seg.className = `breakdown-segment bg-stage-${stage}`;
        seg.style.width = pct + '%';
        seg.title = `${stage}: ${count} (${pct.toFixed(1)}%)`;
        pipelineProgressBar.appendChild(seg);
      }

      // Legend item
      const legendItem = document.createElement('div');
      legendItem.className = 'legend-item';

      const dot = document.createElement('span');
      dot.className = `legend-dot bg-stage-${stage}`;

      const text = document.createElement('span');
      text.textContent = `${stage}: ${count}`;

      legendItem.appendChild(dot);
      legendItem.appendChild(text);
      pipelineLegend.appendChild(legendItem);
    });
  }

  /* ==========================================================================
     TABBED DATA EXPLORER & TABLES
     Strict Security: Zero unsafe HTML setters (DOM nodes constructed via createElement & textContent)
     ========================================================================== */

  async function loadActiveTabData() {
    // Clear action slot & table
    while (tabActionSlot.firstChild) {
      tabActionSlot.removeChild(tabActionSlot.firstChild);
    }
    while (adminTableHead.firstChild) {
      adminTableHead.removeChild(adminTableHead.firstChild);
    }
    while (adminTableBody.firstChild) {
      adminTableBody.removeChild(adminTableBody.firstChild);
    }

    if (activeTab === 'pipeline') {
      addLeadBox.style.display = 'none';
      await loadPipelineTable();
    } else if (activeTab === 'outbox') {
      addLeadBox.style.display = 'none';
      await loadOutboxTable();
    } else if (activeTab === 'chats') {
      addLeadBox.style.display = 'none';
      await loadChatsTable();
    } else if (activeTab === 'leads') {
      setupLeadsTabActions();
      await loadLeadsTable();
    }
  }

  function setupLeadsTabActions() {
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'btn btn-primary btn-sm';
    toggleBtn.textContent = '+ Add Lead';
    toggleBtn.addEventListener('click', () => {
      addLeadBox.style.display = addLeadBox.style.display === 'none' ? 'block' : 'none';
      if (addLeadBox.style.display === 'block') {
        document.getElementById('leadCompany').focus();
      }
    });
    tabActionSlot.appendChild(toggleBtn);
  }

  // 1. Pipeline Table
  async function loadPipelineTable() {
    setTableHeader(['User ID', 'Lead ID', 'Company', 'Stage', 'Note', 'Updated At']);
    try {
      const data = await api('/admin/pipeline');
      if (!Array.isArray(data) || data.length === 0) {
        setTableEmpty('No active pipeline records found.');
        return;
      }
      data.forEach(row => {
        const tr = document.createElement('tr');

        tr.appendChild(createTd(row.user_id, 'mono'));
        tr.appendChild(createTd(String(row.lead_id), 'mono'));
        tr.appendChild(createTd(row.company || '—'));

        // Stage badge
        const tdStage = document.createElement('td');
        const badge = document.createElement('span');
        const st = (row.stage || 'new').toLowerCase();
        badge.className = `badge badge-stage badge-stage-${st}`;
        badge.textContent = st;
        tdStage.appendChild(badge);
        tr.appendChild(tdStage);

        tr.appendChild(createTd(row.note || '—'));

        const tdTime = createTd(formatTimestamp(row.updated_at), 'mono');
        tr.appendChild(tdTime);

        adminTableBody.appendChild(tr);
      });
    } catch (err) {
      setTableEmpty('Error loading pipeline records: ' + err.message);
    }
  }

  // 2. Outbox Table
  async function loadOutboxTable() {
    setTableHeader(['User ID', 'Company', 'Contact Email', 'Subject', 'Email Body Preview', 'Sent At']);
    try {
      const data = await api('/admin/outbox');
      if (!Array.isArray(data) || data.length === 0) {
        setTableEmpty('No sent messages in outbox.');
        return;
      }
      data.forEach(row => {
        const tr = document.createElement('tr');

        tr.appendChild(createTd(row.user_id, 'mono'));
        tr.appendChild(createTd(row.company || '—'));
        tr.appendChild(createTd(row.contact_email || '—', 'mono'));
        tr.appendChild(createTd(row.subject || '—'));

        // Truncated / Expandable body
        const tdBody = document.createElement('td');
        tdBody.style.maxWidth = '300px';
        const bodySnippet = document.createElement('div');
        bodySnippet.style.whiteSpace = 'pre-wrap';
        bodySnippet.style.wordBreak = 'break-word';
        bodySnippet.style.maxHeight = '60px';
        bodySnippet.style.overflowY = 'auto';
        bodySnippet.textContent = row.body || '';
        tdBody.appendChild(bodySnippet);
        tr.appendChild(tdBody);

        tr.appendChild(createTd(formatTimestamp(row.sent_at), 'mono'));

        adminTableBody.appendChild(tr);
      });
    } catch (err) {
      setTableEmpty('Error loading outbox records: ' + err.message);
    }
  }

  // 3. Recent Chats Table
  async function loadChatsTable() {
    setTableHeader(['User ID', 'Thread ID', 'Message', 'Reply', 'Tool Calls', 'Tokens (In/Out)', 'Latency', 'Created At']);
    try {
      const data = await api('/admin/chats');
      if (!Array.isArray(data) || data.length === 0) {
        setTableEmpty('No recorded chat interactions yet.');
        return;
      }
      data.forEach(row => {
        const tr = document.createElement('tr');

        tr.appendChild(createTd(row.user_id, 'mono'));
        tr.appendChild(createTd((row.thread_id || '').slice(0, 8) + '…', 'mono'));

        // Message truncated to 80 chars
        const msgTrunc = (row.message || '').slice(0, 80) + ((row.message || '').length > 80 ? '…' : '');
        tr.appendChild(createTd(msgTrunc));

        // Reply truncated to 80 chars
        const replyTrunc = (row.reply || '').slice(0, 80) + ((row.reply || '').length > 80 ? '…' : '');
        tr.appendChild(createTd(replyTrunc));

        // Tool calls badges
        const tdTools = document.createElement('td');
        if (Array.isArray(row.tool_calls) && row.tool_calls.length > 0) {
          const toolWrap = document.createElement('div');
          toolWrap.style.display = 'flex';
          toolWrap.style.flexWrap = 'wrap';
          toolWrap.style.gap = '4px';

          row.tool_calls.forEach(tc => {
            const pill = document.createElement('span');
            pill.className = 'tool-pill';
            pill.textContent = tc.name;
            toolWrap.appendChild(pill);
          });
          tdTools.appendChild(toolWrap);
        } else {
          tdTools.textContent = '—';
        }
        tr.appendChild(tdTools);

        // Tokens In / Out
        tr.appendChild(createTd(`${row.tokens_in || 0} / ${row.tokens_out || 0}`, 'mono tabular'));

        // Latency ms
        tr.appendChild(createTd(`${row.ms || 0} ms`, 'mono tabular'));

        tr.appendChild(createTd(formatTimestamp(row.created_at), 'mono'));

        adminTableBody.appendChild(tr);
      });
    } catch (err) {
      setTableEmpty('Error loading chat records: ' + err.message);
    }
  }

  // 4. Leads Table
  async function loadLeadsTable() {
    setTableHeader(['ID', 'Company', 'Industry', 'City', 'Employees', 'Website', 'Contact Name', 'Contact Title', 'Contact Email', 'Notes']);
    try {
      const data = await api('/admin/leads');
      if (!Array.isArray(data) || data.length === 0) {
        setTableEmpty('No leads in database.');
        return;
      }
      data.forEach(row => {
        const tr = document.createElement('tr');

        tr.appendChild(createTd(String(row.id || ''), 'mono'));
        tr.appendChild(createTd(row.company || '—'));
        tr.appendChild(createTd(row.industry || '—'));
        tr.appendChild(createTd(row.city || '—'));
        tr.appendChild(createTd(row.employees ? String(row.employees) : '—', 'tabular'));

        // Website link or text
        const tdWeb = document.createElement('td');
        if (row.website) {
          const a = document.createElement('a');
          a.href = row.website;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          a.textContent = row.website.replace(/^https?:\/\//, '');
          a.style.textDecoration = 'underline';
          tdWeb.appendChild(a);
        } else {
          tdWeb.textContent = '—';
        }
        tr.appendChild(tdWeb);

        tr.appendChild(createTd(row.contact_name || '—'));
        tr.appendChild(createTd(row.contact_title || '—'));
        tr.appendChild(createTd(row.contact_email || '—', 'mono'));
        tr.appendChild(createTd(row.notes || '—'));

        adminTableBody.appendChild(tr);
      });
    } catch (err) {
      setTableEmpty('Error loading leads: ' + err.message);
    }
  }

  /* ==========================================================================
     TABLE UTILITIES
     Strict Security: Zero unsafe HTML setters (DOM nodes constructed via createElement & textContent)
     ========================================================================== */

  function setTableHeader(cols) {
    const tr = document.createElement('tr');
    cols.forEach(colName => {
      const th = document.createElement('th');
      th.textContent = colName;
      tr.appendChild(th);
    });
    adminTableHead.appendChild(tr);
  }

  function setTableEmpty(message) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.setAttribute('colspan', '10');
    td.style.textAlign = 'center';
    td.style.padding = '24px';
    td.style.color = 'var(--text-muted)';
    td.textContent = message;
    tr.appendChild(td);
    adminTableBody.appendChild(tr);
  }

  function createTd(text, className = '') {
    const td = document.createElement('td');
    if (className) td.className = className;
    td.textContent = text !== null && text !== undefined ? text : '—';
    return td;
  }

  function formatTimestamp(isoStr) {
    if (!isoStr) return '—';
    try {
      const d = new Date(isoStr);
      return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return isoStr;
    }
  }

  /* ==========================================================================
     ADD LEAD FORM (POST /admin/leads)
     ========================================================================== */

  addLeadForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const company = document.getElementById('leadCompany').value.trim();
    const industry = document.getElementById('leadIndustry').value.trim();
    const city = document.getElementById('leadCity').value.trim();
    const employees = parseInt(document.getElementById('leadEmployees').value.trim(), 10) || null;
    const website = document.getElementById('leadWebsite').value.trim() || null;
    const contactName = document.getElementById('leadContactName').value.trim() || null;
    const contactTitle = document.getElementById('leadContactTitle').value.trim() || null;
    const contactEmail = document.getElementById('leadContactEmail').value.trim() || null;
    const notes = document.getElementById('leadNotes').value.trim() || null;

    if (!company || !industry || !city) {
      alert('Please fill out Company, Industry, and City.');
      return;
    }

    const payload = {
      company,
      industry,
      city,
      employees,
      website,
      contact_name: contactName,
      contact_title: contactTitle,
      contact_email: contactEmail,
      notes
    };

    addLeadSubmitBtn.disabled = true;

    try {
      await api('/admin/leads', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      addLeadForm.reset();
      addLeadBox.style.display = 'none';

      // Refresh table & stats
      await loadLeadsTable();
      await loadStats();
    } catch (err) {
      alert('Failed to save lead: ' + err.message);
    } finally {
      addLeadSubmitBtn.disabled = false;
    }
  });

  cancelAddLeadBtn.addEventListener('click', () => {
    addLeadBox.style.display = 'none';
  });

  /* ==========================================================================
     DATA REFRESH & EVENT HANDLERS
     ========================================================================== */

  async function refreshAllAdminData() {
    if (!adminToken) return;
    await Promise.all([
      loadStats(),
      loadActiveTabData()
    ]);
  }

  // Token Gate Submission
  adminTokenForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const token = adminTokenInput.value.trim();
    if (!token) return;

    adminToken = token;
    localStorage.setItem('gp_admin_token', adminToken);
    showContentView();
  });

  // Lock / Clear Token
  lockTokenBtn.addEventListener('click', lockAdminToken);

  // Manual Refresh
  manualRefreshBtn.addEventListener('click', refreshAllAdminData);

  // Tab Navigation
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeTab = btn.getAttribute('data-tab');
      loadActiveTabData();
    });
  });

  // Initialize
  initAdminAuth();

})();
