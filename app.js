/* ═══════════════════════════════════════════════════════════════
   app.js — UrbanPolicy Backend Integration Layer
   Drop this file into the same folder as main.js and index.html.
   Add <script src="app.js"></script> after <script src="main.js">

   Routes all AI calls through http://localhost:3000/api/analyze
   when LOCAL backend mode is active, falling back to the existing
   Ollama / Anthropic paths when it is not.

   Context mapping:
     context.policies  ← policyData (all policies with status, budget, KPIs)
     context.enacted   ← enactedPolicies set (names + impacts)
     context.kpis      ← liveKPI (walkability, AQI, transit, affordability, carbon)
     context.budget    ← spent vs total budget
     context.eonet     ← live EONET disaster events (if fetched)
     context.center    ← Karachi: { lat: 24.8607, lng: 67.0011 }
     context.radius    ← policy-specific (default 15km citywide)
     context.schools   ← mapped from policies for backend compatibility
     context.stats     ← aggregate KPI and policy statistics
   ═══════════════════════════════════════════════════════════════ */

/* ── CONFIG ── */
const BACKEND_URL    = 'http://localhost:3000';
const BACKEND_ROUTE  = '/api/analyze';
const REQUEST_TIMEOUT_MS = 90000;

/* ── STATE ── */
let localBackendOnline = false;
let backendMetadata    = {};   // model, version etc. from last response

/* ═══════════════════════════════════════
   BOOT — runs after main.js is loaded
═══════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  injectLocalBackendButton();
  wireAnalyzeBtn();
  probBackend();          // silent health-check on load
});

/* ═══════════════════════════════════════
   UI — inject LOCAL button into AI config bar
═══════════════════════════════════════ */
function injectLocalBackendButton() {
  const bar = document.querySelector('.ai-config-bar');
  if (!bar) return;

  const btn = document.createElement('button');
  btn.id = 'btn-backend-local';
  btn.className = 'ai-backend-btn';
  btn.textContent = 'LOCAL';
  btn.title = 'Connect to local backend at ' + BACKEND_URL;
  btn.onclick = () => activateLocalBackend();

  /* Insert before the connection input */
  const input = document.getElementById('ai-conn-input');
  if (input) bar.insertBefore(btn, input);
  else        bar.appendChild(btn);
}

/* ── VISUAL STATUS HELPERS ── */
function markLocalActive() {
  document.querySelectorAll('.ai-backend-btn').forEach(b => {
    b.classList.remove('active', 'active-ollama');
  });
  const btn = document.getElementById('btn-backend-local');
  if (btn) {
    btn.classList.add('active');
    btn.style.background    = 'rgba(52,211,153,.12)';
    btn.style.borderColor   = 'rgba(52,211,153,.4)';
    btn.style.color         = '#34D399';
  }
}

function markLocalInactive() {
  const btn = document.getElementById('btn-backend-local');
  if (btn) {
    btn.classList.remove('active');
    btn.style.background  = '';
    btn.style.borderColor = '';
    btn.style.color       = '';
  }
}

/* ═══════════════════════════════════════
   HEALTH CHECK — silent on load
═══════════════════════════════════════ */
async function probBackend() {
  try {
    const r = await fetch(BACKEND_URL + '/health', {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    if (r.ok) {
      localBackendOnline = true;
      activateLocalBackend(/* silent= */ true);
    }
  } catch {
    /* backend not running — silent, user can still connect Ollama/Anthropic */
  }
}

/* ═══════════════════════════════════════
   ACTIVATE LOCAL BACKEND
═══════════════════════════════════════ */
async function activateLocalBackend(silent = false) {
  if (!silent) {
    const btn = document.getElementById('btn-backend-local');
    if (btn) { btn.textContent = 'CONNECTING…'; btn.disabled = true; }
  }

  try {
    /* Test /health or a minimal /api/analyze call */
    let reachable = false;
    try {
      const h = await fetch(BACKEND_URL + '/health', {
        signal: AbortSignal.timeout(4000),
      });
      reachable = h.ok;
    } catch {
      /* /health not exposed — try a lightweight analyze call */
      const probe = await fetch(BACKEND_URL + BACKEND_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'ping', context: minimalContext() }),
        signal: AbortSignal.timeout(5000),
      });
      reachable = probe.ok || probe.status === 400; /* 400 = server reached */
    }

    if (!reachable) throw new Error('Backend returned an error status');

    localBackendOnline = true;

    /* Override aiBackend so main.js doesn't try Ollama/Anthropic */
    if (typeof aiBackend !== 'undefined') window.aiBackend = 'local';
    if (typeof engineOnline !== 'undefined') window.engineOnline = true;

    markLocalActive();
    updateEngineUI('LOCAL · READY', 'badge-ollama');

    if (!silent) {
      showToast('✓ Local backend connected at ' + BACKEND_URL, 'ok');
      logAudit('Local Backend Connected', BACKEND_URL + BACKEND_ROUTE, '#34D399');
    }

    /* Patch callAI for local routing */
    patchCallAI();

  } catch (e) {
    localBackendOnline = false;
    markLocalInactive();
    if (!silent) {
      showToast('Cannot reach ' + BACKEND_URL + ' — is the server running?', 'err');
    }
  } finally {
    const btn = document.getElementById('btn-backend-local');
    if (btn) { btn.textContent = 'LOCAL'; btn.disabled = false; }
  }
}

/* ═══════════════════════════════════════
   CONTEXT BUILDER
   Maps UrbanPolicy state → backend schema
═══════════════════════════════════════ */
function buildContext(query, policyId = null) {
  /* ── Gather platform state ── */
  const pd      = (typeof policyData     !== 'undefined') ? policyData     : {};
  const enacted = (typeof enactedPolicies !== 'undefined') ? enactedPolicies : new Set();
  const kpi     = (typeof liveKPI        !== 'undefined') ? liveKPI        : {};
  const budget  = (typeof TOTAL_BUDGET   !== 'undefined') ? TOTAL_BUDGET   : 150;
  const costs   = (typeof POLICY_COSTS   !== 'undefined') ? POLICY_COSTS   : {};
  const eonet   = (typeof eonetEvents    !== 'undefined') ? eonetEvents     : [];

  /* Budget spent */
  let spent = 0;
  enacted.forEach(id => { spent += (costs[id] || pd[id]?.budgetB || 0); });

  /* All policies as a structured array */
  const policies = Object.entries(pd).map(([id, p]) => ({
    id:       parseInt(id),
    name:     p.name,
    category: p.category || 'Other',
    status:   enacted.has(parseInt(id)) ? 'enacted' : (p.status || 'draft'),
    budgetB:  p.budgetB || costs[id] || 0,
    zone:     p.zone    || '',
    todos_done:  (p.todos || []).filter(t => t.done).length,
    todos_total: (p.todos || []).length,
    llm_ctx: p.llmCtx  || p.name,
    factors: Object.fromEntries(
      Object.entries(p.factors || {}).map(([k, f]) => [k, f.val])
    ),
  }));

  /* Enacted policy summaries */
  const enactedList = policies.filter(p => p.status === 'enacted');

  /* EONET open events summary */
  const openDisasters = eonet
    .filter(e => !e.closed)
    .slice(0, 20)
    .map(e => ({
      id:       e.id,
      title:    e.title,
      category: e.categories?.[0]?.title || 'Event',
      date:     e.date,
      lat:      e.geometry?.type === 'Point' ? e.geometry.coordinates[1] : null,
      lng:      e.geometry?.type === 'Point' ? e.geometry.coordinates[0] : null,
    }));

  /* stats object — backend expects this shape */
  const stats = {
    totalPolicies:   policies.length,
    enactedPolicies: enacted.size,
    budgetUsed:      spent,
    budgetCap:       budget,
    budgetPct:       Math.round((spent / budget) * 100),
    walkability:     Math.round(kpi.walk    || 42),
    aqi:             Math.round(kpi.aqi     || 61),
    transitCoverage: Math.round(kpi.transit || 38),
    affordability:   Math.round(kpi.afford  || 29),
    carbonTrend:     kpi.carbon || -4,
    activeDisasters: openDisasters.length,
    /* schema alias so backend's context.stats.totalSchools works */
    totalSchools:    policies.length,
    totalEnrollment: enacted.size,    /* enacted = "active" policies */
    totalTeachers:   Object.keys(pd).length,
    avgStudentTeacherRatio: Math.round((enacted.size / Math.max(Object.keys(pd).length, 1)) * 100) / 100,
    understaffed:    policies.filter(p => p.status === 'draft').length,
    lowEnrollment:   policies.filter(p => p.todos_done === 0).length,
    byLevel: {
      'Land Use':    policies.filter(p => p.category === 'Land Use').length,
      'Transport':   policies.filter(p => p.category === 'Transport').length,
      'Housing':     policies.filter(p => p.category === 'Housing').length,
      'Environment': policies.filter(p => p.category === 'Environment').length,
    },
  };

  /* schools = backend compat alias, maps our policies */
  const schools = policies.map(p => ({
    id:           p.id,
    name:         p.name,
    level:        p.category,
    enrollment:   p.budgetB * 10,   /* proxied as budget × 10 for numeric compat */
    teachers:     p.todos_total,
    ratio:        p.todos_done / Math.max(p.todos_total, 1),
    lat:          24.8607,
    lng:          67.0011,
    status:       p.status,
  }));

  /* Selected policy detail (if running per-policy analysis) */
  const selectedPolicy = policyId && pd[policyId] ? {
    id:      policyId,
    name:    pd[policyId].name,
    context: pd[policyId].llmCtx,
    budget:  pd[policyId].budgetB,
    status:  enacted.has(parseInt(policyId)) ? 'enacted' : pd[policyId].status,
    todos:   pd[policyId].todos,
    factors: pd[policyId].factors,
  } : null;

  return {
    center:          { lat: 24.8607, lng: 67.0011 },
    radius:          15,
    city:            'Karachi',
    authority:       'Karachi Metropolitan Planning Authority',
    query,
    selectedPolicy,
    policies,
    enacted:         enactedList,
    kpis:            kpi,
    budget:          { spent, cap: budget, pct: Math.round((spent / budget) * 100) },
    disasters:       openDisasters,
    /* backend-compat aliases */
    schools,
    stats,
  };
}

function minimalContext() {
  return {
    center:  { lat: 24.8607, lng: 67.0011 },
    radius:  5,
    schools: [],
    stats: {
      totalSchools: 0, totalEnrollment: 0, totalTeachers: 0,
      avgStudentTeacherRatio: 0, understaffed: 0, lowEnrollment: 0, byLevel: {},
    },
  };
}

/* ═══════════════════════════════════════
   BACKEND CALL
═══════════════════════════════════════ */
async function callBackend(query, policyId = null) {
  const context  = buildContext(query, policyId);
  const payload  = { query, context };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const r = await fetch(BACKEND_URL + BACKEND_ROUTE, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });

    clearTimeout(timer);

    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error(`Backend HTTP ${r.status}${txt ? ': ' + txt.slice(0, 120) : ''}`);
    }

    const data = await r.json();

    if (data.success === false) {
      throw new Error('Backend returned success: false — ' + (data.error || 'unknown'));
    }

    /* Cache metadata for the status bar */
    if (data.metadata) backendMetadata = data.metadata;

    return data.analysis || data.result || data.message || JSON.stringify(data);

  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('Backend timed out after 90s');
    throw e;
  }
}

/* ═══════════════════════════════════════
   PATCH callAI — intercept local mode
═══════════════════════════════════════ */
function patchCallAI() {
  /* Save original (Ollama / Anthropic) */
  if (typeof window._originalCallAI === 'undefined' && typeof callAI === 'function') {
    window._originalCallAI = callAI;
  }

  window.callAI = async function patchedCallAI(messages) {
    if (!localBackendOnline) {
      /* Fall through to Ollama / Anthropic */
      if (typeof window._originalCallAI === 'function') {
        return window._originalCallAI(messages);
      }
      throw new Error('No AI engine connected.');
    }

    /* Build query from the last user message */
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const query    = lastUser?.content || messages.map(m => m.content).join('\n');

    /* Extract policyId hint if present in message (set by runPolicyAI) */
    const policyId = window._currentAnalysisPolicyId || null;
    window._currentAnalysisPolicyId = null;

    return callBackend(query, policyId);
  };
}

/* ═══════════════════════════════════════
   PATCH runPolicyAI — pass policyId
═══════════════════════════════════════ */
(function patchRunPolicyAI() {
  const original = window.runPolicyAI;
  if (typeof original !== 'function') return;

  window.runPolicyAI = async function(id) {
    if (localBackendOnline) {
      /* Tag the policyId so patchedCallAI picks it up */
      window._currentAnalysisPolicyId = id;

      const p   = (typeof policyData !== 'undefined') ? policyData[id] : null;
      const out = document.getElementById('llm-out');
      if (!out) return;

      out.textContent = '◈ Analysing via local backend…';

      const enacted = typeof enactedPolicies !== 'undefined'
        ? [...enactedPolicies].filter(e => e !== id)
            .map(e => policyData?.[e]?.name).filter(Boolean).join(', ') || 'none'
        : 'none';

      const query = p
        ? `Analyse this Karachi urban policy for the Karachi Metropolitan Planning Authority:\n\n${p.llmCtx}\n\nOther currently enacted policies: ${enacted}\n\nProvide:\n1. Projected KPI impacts with specific numbers for walkability, AQI, transit, affordability, carbon\n2. Karachi-specific implementation risks\n3. Equity considerations for informal communities\n\nBe concise — 3 sentences per section.`
        : `Analyse policy ID ${id}`;

      try {
        const txt = await callBackend(query, id);
        if (typeof typeText === 'function') typeText(out, txt);
        else out.textContent = txt;
        if (typeof logAudit === 'function') {
          logAudit(
            `AI Analysis: "${p?.name || 'Policy ' + id}"`,
            `Via local backend · model: ${backendMetadata.model || 'unknown'}`,
            '#34D399'
          );
        }
      } catch (e) {
        out.textContent = '⚠ Backend error: ' + e.message;
        if (typeof showToast === 'function') showToast(e.message, 'err');
      }
      return;
    }

    /* Fall back to original (Ollama / Anthropic) */
    if (typeof original === 'function') return original(id);
  };
})();

/* ═══════════════════════════════════════
   PATCH runScenarioAI — route to backend
═══════════════════════════════════════ */
(function patchRunScenarioAI() {
  const original = window.runScenarioAI;
  if (typeof original !== 'function') return;

  window.runScenarioAI = async function(id, outEl) {
    if (!localBackendOnline) {
      if (typeof original === 'function') return original(id, outEl);
      return;
    }

    const sc = (typeof scenarioCards !== 'undefined')
      ? scenarioCards.find(s => s.id === id)
      : null;
    if (!sc || !outEl) return;

    outEl.style.display = 'block';
    outEl.textContent   = '◈ Simulating via local backend…';

    const query = `Analyse this Karachi planning scenario for the Karachi Metropolitan Planning Authority:\n\n"${sc.name}" — ${sc.desc}\n\nPolicies involved: ${sc.tags.join(', ')}\nCurrent live KPIs: walkability ${liveKPI?.walk ?? 42}, AQI ${liveKPI?.aqi ?? 61}, transit ${liveKPI?.transit ?? 38}%\n\nProvide:\n1. Projected KPI outcomes with specific numbers\n2. Top Karachi-specific implementation risk\n3. Equity and community impact\n\nBe concise.`;

    try {
      const txt = await callBackend(query);
      if (typeof typeText === 'function') typeText(outEl, txt);
      else outEl.textContent = txt;
    } catch (e) {
      outEl.textContent = '⚠ Backend error: ' + e.message;
    }
  };
})();

/* ═══════════════════════════════════════
   WIRE analyzeBtn (from the spec)
   Handles both spec usage and existing
   platform buttons transparently.
═══════════════════════════════════════ */
function wireAnalyzeBtn() {
  const btn = document.getElementById('analyzeBtn');
  if (btn) btn.addEventListener('click', runAnalysis);

  /* Also wire the simulate button on the new frontend if it calls
     a backend route directly rather than callAI */
  const simBtn = document.getElementById('simulate-btn');
  if (simBtn && !simBtn.dataset.backendWired) {
    simBtn.dataset.backendWired = '1';
    const originalOnclick = simBtn.onclick;
    simBtn.onclick = async function(e) {
      if (localBackendOnline) {
        await runSimulationViaBackend();
      } else if (typeof originalOnclick === 'function') {
        originalOnclick.call(this, e);
      } else if (typeof runSimulation === 'function') {
        runSimulation();
      }
    };
  }
}

/* ─── Analysis run (spec-compatible handler) ─── */
async function runAnalysis() {
  const output = document.getElementById('analysis-output')
               || document.getElementById('recommendations')
               || document.getElementById('llm-out');

  if (!output) {
    console.warn('app.js: no output element found for runAnalysis');
    return;
  }

  output.innerHTML = 'Running analysis…';

  try {
    const query = 'Analyse the current state of Karachi urban infrastructure and policy performance across transport, housing, environment, and equity dimensions. Provide actionable recommendations for the planning authority.';

    const data = await callBackendRaw(query, null);

    output.innerHTML = `
      <h3 style="margin-bottom:8px;font-family:var(--font-head,sans-serif)">Urban Planning Analysis</h3>
      <p style="line-height:1.75;font-size:13px;color:var(--ink2,#374151)">${escapeHtml(data.analysis)}</p>
      <hr style="margin:12px 0;border-color:var(--border,#e5e7eb)">
      <small style="font-family:var(--font-mono,monospace);font-size:10px;color:var(--muted,#9ca3af)">
        Model: ${data.metadata?.model || 'backend'} ·
        Policies analysed: ${data.metadata?.schoolsAnalyzed ?? (typeof policyData !== 'undefined' ? Object.keys(policyData).length : '—')}
      </small>`;

    if (typeof logAudit === 'function') {
      logAudit('Analysis Run', 'Via analyzeBtn · backend response received', '#34D399');
    }

  } catch (error) {
    console.error('app.js runAnalysis:', error);
    output.innerHTML = `<p style="color:var(--red,#dc2626);font-family:var(--font-mono,monospace);font-size:12px">⚠ Error running analysis: ${escapeHtml(error.message)}</p>`;
  }
}

/* ─── Raw backend call that returns the full response object ─── */
async function callBackendRaw(query, policyId = null) {
  const context = buildContext(query, policyId);
  const r = await fetch(BACKEND_URL + BACKEND_ROUTE, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ query, context }),
    signal:  AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error('Backend HTTP ' + r.status);
  const data = await r.json();
  if (data.success === false) throw new Error(data.error || 'Backend error');
  return data;
}

/* ─── Full simulation via backend (new frontend simulate button) ─── */
async function runSimulationViaBackend() {
  const name    = document.getElementById('pol-name')?.value.trim()    || '';
  const type    = document.getElementById('pol-type')?.value           || '';
  const city    = document.getElementById('pol-city')?.value.trim()    || 'Karachi';
  const area    = document.getElementById('pol-area')?.value.trim()    || 'citywide';
  const horizon = document.getElementById('pol-horizon')?.value        || '10 Years';
  const budget  = document.getElementById('pol-budget')?.value         || 'unspecified';
  const desc    = document.getElementById('pol-desc')?.value.trim()    || '';
  const objs    = document.getElementById('pol-objectives')?.value.trim() || '';
  const risks   = document.getElementById('pol-risks')?.value.trim()   || '';
  const dims    = [...(document.querySelectorAll('.dim-chip.selected') || [])]
                    .map(d => d.textContent.trim()).join(', ');

  if (!name || !type) {
    if (typeof showToast === 'function') showToast('Enter a policy name and type first', 'warn');
    return;
  }

  const btn      = document.getElementById('simulate-btn');
  const streamEl = document.getElementById('sim-stream');
  const epDot    = document.getElementById('ep-dot');
  const epSub    = document.getElementById('ep-sub');

  if (btn)   { btn.classList.add('running'); btn.textContent = '◈ SIMULATING…'; btn.disabled = true; }
  if (epDot) epDot.className = 'ep-status-dot thinking';
  if (epSub) epSub.textContent = 'SIMULATION RUNNING VIA LOCAL BACKEND…';

  const scanOverlay = document.getElementById('scan-overlay');
  if (scanOverlay) scanOverlay.classList.add('active');

  /* Reset metric cards */
  ['walk','aqi','transit','afford','carbon','risk'].forEach(k => {
    const mv = document.getElementById('mv-' + k);
    const mt = document.getElementById('mt-' + k);
    if (mv) { mv.textContent = '…'; mv.className = 'mc-val neu'; }
    if (mt) mt.textContent = 'Simulating…';
  });

  const query = `Simulate the following urban policy for ${city}:

POLICY NAME: ${name}
POLICY TYPE: ${type}
TARGET AREA: ${area}
TIME HORIZON: ${horizon}
ESTIMATED BUDGET: PKR ${budget}B
DESCRIPTION: ${desc || name}
OBJECTIVES: ${objs || 'not specified'}
KNOWN RISKS: ${risks || 'none specified'}
IMPACT DIMENSIONS: ${dims || 'walkability, AQI, transit, affordability, carbon'}

Please output projected metric values using EXACTLY these formats so they can be parsed:
Walkability: [value]
AQI: [value]
Transit: [value]
Affordability: [value]
Carbon: [value]
Risk: [LOW | MEDIUM | HIGH | CRITICAL]

Then provide full analysis.`;

  try {
    const txt = await callBackend(query, null);

    if (streamEl) {
      streamEl.innerHTML = '<div class="stream-text" id="stream-text"></div>';
      const textEl = document.getElementById('stream-text');
      if (typeof typeStreamWithExtraction === 'function') {
        await typeStreamWithExtraction(textEl, txt);
      } else {
        textEl.textContent = txt;
      }
    }

    if (typeof extractMetrics === 'function') extractMetrics(txt);

    if (typeof logAudit === 'function') {
      logAudit(
        `Simulation Complete: "${name}"`,
        `Via local backend · model: ${backendMetadata.model || 'unknown'} · ${type}`,
        '#34D399'
      );
    }
    if (typeof showToast === 'function') showToast(`✓ Simulation complete: ${name}`, 'ok');

  } catch (e) {
    if (streamEl) {
      streamEl.innerHTML = `<span style="color:var(--red,#dc2626);font-family:monospace;font-size:11px">⚠ Backend error: ${escapeHtml(e.message)}</span>`;
    }
    if (typeof showToast === 'function') showToast('Backend error: ' + e.message, 'err');
  }

  if (scanOverlay) setTimeout(() => scanOverlay.classList.remove('active'), 500);
  if (btn)   { btn.classList.remove('running'); btn.textContent = '▶ RUN SIMULATION'; btn.disabled = false; }
  if (epDot) { epDot.className = 'ep-status-dot done'; }
  if (epSub) epSub.textContent = 'LOCAL BACKEND · ' + (backendMetadata.model || 'READY').toUpperCase();
}

/* ═══════════════════════════════════════
   DISCONNECT
═══════════════════════════════════════ */
function disconnectLocalBackend() {
  localBackendOnline = false;
  window.aiBackend   = 'ollama';

  /* Restore original callAI */
  if (typeof window._originalCallAI === 'function') {
    window.callAI = window._originalCallAI;
  }

  markLocalInactive();
  if (typeof updateEngineUI === 'function') updateEngineUI('OFFLINE', 'badge-offline');
  if (typeof showToast      === 'function') showToast('Local backend disconnected', 'warn');
}

/* ═══════════════════════════════════════
   UTILITY
═══════════════════════════════════════ */
function escapeHtml(str) {
  if (typeof str !== 'string') return String(str);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ═══════════════════════════════════════
   PUBLIC API
   Accessible from window for console/tests
═══════════════════════════════════════ */
window.appBackend = {
  activate:    activateLocalBackend,
  disconnect:  disconnectLocalBackend,
  callBackend,
  callBackendRaw,
  buildContext,
  runAnalysis,
  isOnline:    () => localBackendOnline,
  metadata:    () => backendMetadata,
};
