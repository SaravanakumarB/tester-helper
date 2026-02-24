import { useState, useEffect } from "react";

// --- localStorage helpers
const LS_SAVED = "apiprobe_saved_apis";
const LS_HISTORY = "apiprobe_history";
const LS_AUTH = "apiprobe_global_auth";

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(LS_SAVED) || "[]"); } catch { return []; }
}
function saveSaved(list) { localStorage.setItem(LS_SAVED, JSON.stringify(list)); }

function loadGlobalAuth() {
  try { return JSON.parse(localStorage.getItem(LS_AUTH) || '{"type":"Bearer","token":"","enabled":true}'); } catch { return { type: "Bearer", token: "", enabled: true }; }
}
function saveGlobalAuth(auth) { localStorage.setItem(LS_AUTH, JSON.stringify(auth)); }

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(LS_HISTORY) || "[]"); } catch { return []; }
}
function saveHistory(list) { localStorage.setItem(LS_HISTORY, JSON.stringify(list)); }

function addToHistory(run) {
  const h = loadHistory();
  h.unshift(run);
  saveHistory(h.slice(0, 50)); // keep latest 50
}

// --- Utilities
function generateScenarios(body, mandatoryKeys) {
  const scenarios = [];
  let parsed = {};
  try { parsed = JSON.parse(body || "{}"); } catch { parsed = {}; }

  scenarios.push({ label: "[OK] Positive - all mandatory fields present", type: "positive", body: { ...parsed } });

  mandatoryKeys.forEach((key) => {
    if (!key.trim()) return;
    scenarios.push({ label: `[X] Negative - "${key.trim()}" is null`, type: "negative", missingKey: key.trim(), body: { ...parsed, [key.trim()]: null } });
  });

  mandatoryKeys.forEach((key) => {
    if (!key.trim()) return;
    scenarios.push({ label: `[X] Negative - "${key.trim()}" is empty string`, type: "negative", missingKey: key.trim(), body: { ...parsed, [key.trim()]: "" } });
  });

  return scenarios;
}

// Extract operationName from a GraphQL query/mutation string
function extractOperationName(queryStr) {
  const match = queryStr && queryStr.match(/(?:query|mutation|subscription)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  return match ? match[1] : undefined;
}

async function hitApi(url, method, headers, bodyObj, isGraphQL, graphqlQuery, operationName, globalAuth, useGlobalAuth) {
  const start = performance.now();
  try {
    const headersObj = {};
    headers.forEach(({ key, value }) => { if (key) headersObj[key] = value; });
    // Inject global auth header if enabled and api opts in
    if (globalAuth && globalAuth.enabled && globalAuth.token && useGlobalAuth !== false) {
      headersObj["Authorization"] = `${globalAuth.type} ${globalAuth.token}`;
    }
    if (!headersObj["Content-Type"] && !headersObj["content-type"]) headersObj["Content-Type"] = "application/json";

    let body;
    if (isGraphQL && graphqlQuery && graphqlQuery.trim()) {
      // bodyObj here is the variables object (e.g. { email: "...", deliveryMedium: "..." })
      // We must wrap it in the input key if the query uses $input pattern
      const opName = operationName || extractOperationName(graphqlQuery);
      // Detect if query uses a single $input variable wrapper
      const usesInputWrapper = /\$input\s*:/.test(graphqlQuery);
      const variables = usesInputWrapper ? { input: bodyObj } : bodyObj;
      const payload = { query: graphqlQuery, variables };
      if (opName) payload.operationName = opName;
      body = JSON.stringify(payload);
    } else {
      body = ["GET", "HEAD"].includes(method) ? undefined : JSON.stringify(bodyObj);
    }

    const res = await fetch(url, { method, headers: headersObj, body });
    const elapsed = Math.round(performance.now() - start);
    let data;
    try { data = await res.json(); } catch { data = await res.text(); }
    return { status: res.status, ok: res.ok, data, elapsed, error: null };
  } catch (err) {
    return { status: null, ok: false, data: null, elapsed: Math.round(performance.now() - start), error: err.message };
  }
}

function formatDate(ts) {
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function shortUrl(url) {
  try { const u = new URL(url); return u.hostname + u.pathname; } catch { return url; }
}

// --- Global Auth Panel
function GlobalAuthPanel() {
  const [auth, setAuth] = useState(loadGlobalAuth());
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    saveGlobalAuth(auth);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="global-auth-panel">
      <div className="global-auth-panel-header">
        <div>
          <span className="global-auth-panel-title">🔑 Global Authorization</span>
          <span className="global-auth-panel-sub">Applied to all APIs (unless disabled per-API)</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {saved && <span className="save-toast">v Saved!</span>}
          <label className="toggle-label">
            <input type="checkbox" checked={auth.enabled} onChange={e => setAuth({...auth, enabled: e.target.checked})} className="toggle-input"/>
            <span className="toggle-track"><span className="toggle-thumb"/></span>
            <span style={{fontSize:13,color:auth.enabled?"var(--accent)":"var(--muted)",fontWeight:600}}>{auth.enabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      </div>
      <div className="global-auth-fields">
        <select className="method-select" value={auth.type} onChange={e => setAuth({...auth, type: e.target.value})} style={{minWidth:120}}>
          {["Bearer","Basic","ApiKey","Token","Custom"].map(t => <option key={t}>{t}</option>)}
        </select>
        <input
          className="url-input"
          type="text"
          placeholder="Paste your token or key here..."
          value={auth.token}
          onChange={e => setAuth({...auth, token: e.target.value})}
          style={{flex:1}}
        />
        <button className="btn-primary btn-sm" onClick={handleSave} style={{borderRadius:100,whiteSpace:"nowrap"}}>Save Auth</button>
        {auth.token && <button className="btn-danger btn-sm" onClick={() => { const a={...auth,token:""}; setAuth(a); saveGlobalAuth(a); }}>Clear</button>}
      </div>
    </div>
  );
}

// --- Save API Modal
function SaveModal({ onSave, onClose, existing }) {
  const [name, setName] = useState(existing ? existing.name : "");
  const [desc, setDesc] = useState(existing ? existing.desc : "");
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">{existing ? "Update Saved API" : "Save API"}</div>
        <label className="field-label">Name <span style={{color:"var(--fail)"}}>*</span></label>
        <input className="modal-input" placeholder="e.g. Login API" value={name} onChange={e => setName(e.target.value)} autoFocus />
        <label className="field-label" style={{marginTop:14}}>Description</label>
        <input className="modal-input" placeholder="e.g. Auth endpoint for user login" value={desc} onChange={e => setDesc(e.target.value)} />
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={() => name.trim() && onSave(name.trim(), desc.trim())} disabled={!name.trim()}>
            {existing ? "Update" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Page: Welcome
function WelcomePage({ onStart, savedCount, historyCount }) {
  return (
    <div className="welcome-page">
      <div className="welcome-grid-bg" />
      <div className="welcome-content">

        {/* Hero illustration */}
        <div className="hero-img-wrap">
          <svg viewBox="0 0 440 260" xmlns="http://www.w3.org/2000/svg" className="hero-left-svg">

            {/* App background */}
            <rect width="440" height="260" fill="#f4f4f4"/>

            {/* Top nav bar */}
            <rect width="440" height="38" fill="#231212"/>
            <circle cx="18" cy="19" r="5" fill="#c62828" opacity="0.7"/>
            <circle cx="34" cy="19" r="5" fill="#f59e0b" opacity="0.8"/>
            <circle cx="50" cy="19" r="5" fill="#2e7d32" opacity="0.7"/>
            <rect x="72" y="12" width="60" height="14" rx="7" fill="white" opacity="0.1"/>
            <text x="102" y="23" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="600" opacity="0.9">Tester Helper</text>
            <rect x="144" y="14" width="42" height="10" rx="5" fill="white" opacity="0.07"/>
            <text x="165" y="23" textAnchor="middle" fontSize="8" fill="white" opacity="0.6" fontFamily="sans-serif">Explorer</text>
            <rect x="192" y="14" width="36" height="10" rx="5" fill="white" opacity="0.07"/>
            <text x="210" y="23" textAnchor="middle" fontSize="8" fill="white" opacity="0.6" fontFamily="sans-serif">Saved</text>
            <rect x="234" y="14" width="36" height="10" rx="5" fill="white" opacity="0.07"/>
            <text x="252" y="23" textAnchor="middle" fontSize="8" fill="white" opacity="0.6" fontFamily="sans-serif">History</text>

            {/* URL bar */}
            <rect x="12" y="48" width="416" height="28" rx="8" fill="white" stroke="#e2e0ed" strokeWidth="1"/>
            <rect x="18" y="55" width="36" height="14" rx="7" fill="#6c5ce7" opacity="0.15"/>
            <text x="36" y="66" textAnchor="middle" fontSize="9" fill="#6c5ce7" fontFamily="monospace" fontWeight="700">POST</text>
            <rect x="60" y="59" width="280" height="6" rx="3" fill="#e2e0ed"/>
            <text x="62" y="65" fontSize="8" fill="#8a8490" fontFamily="monospace">https://api.example.com/v1/auth/login</text>
            <rect x="354" y="54" width="66" height="20" rx="10" fill="#231212"/>
            <text x="387" y="68" textAnchor="middle" fontSize="9" fill="white" fontFamily="sans-serif" fontWeight="700">Run Tests</text>

            {/* Two columns */}
            {/* Left col - Request config */}
            <rect x="12" y="86" width="210" height="164" rx="10" fill="white" stroke="#e2e0ed" strokeWidth="1"/>
            {/* Tab bar */}
            <rect x="12" y="86" width="210" height="24" rx="10" fill="#f0eff6"/>
            <rect x="12" y="96" width="210" height="14" fill="#f0eff6"/>
            <rect x="18" y="90" width="40" height="14" rx="7" fill="#231212"/>
            <text x="38" y="101" textAnchor="middle" fontSize="8" fill="white" fontFamily="sans-serif" fontWeight="600">Body</text>
            <text x="80" y="101" textAnchor="middle" fontSize="8" fill="#8a8490" fontFamily="sans-serif">Headers</text>
            <text x="120" y="101" textAnchor="middle" fontSize="8" fill="#8a8490" fontFamily="sans-serif">GraphQL</text>
            {/* JSON body */}
            <text x="22" y="126" fontSize="8" fill="#8a8490" fontFamily="monospace">{"{"}</text>
            <text x="30" y="140" fontSize="8" fill="#6c5ce7" fontFamily="monospace">"email":</text>
            <text x="74" y="140" fontSize="8" fill="#2e7d32" fontFamily="monospace">"user@test.com"</text>
            <text x="30" y="154" fontSize="8" fill="#6c5ce7" fontFamily="monospace">"password":</text>
            <text x="82" y="154" fontSize="8" fill="#c62828" fontFamily="monospace">"secret123"</text>
            <text x="30" y="168" fontSize="8" fill="#6c5ce7" fontFamily="monospace">"remember":</text>
            <text x="84" y="168" fontSize="8" fill="#f59e0b" fontFamily="monospace">true</text>
            <text x="22" y="182" fontSize="8" fill="#8a8490" fontFamily="monospace">{"}"}</text>
            {/* Mandatory keys */}
            <rect x="18" y="192" width="50" height="12" rx="6" fill="#e3e2f7"/>
            <text x="43" y="202" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace" fontWeight="600">email x</text>
            <rect x="74" y="192" width="60" height="12" rx="6" fill="#e3e2f7"/>
            <text x="104" y="202" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace" fontWeight="600">password x</text>
            <rect x="140" y="192" width="72" height="12" rx="6" fill="#f0eff6" stroke="#e2e0ed" strokeWidth="1"/>
            <text x="176" y="202" textAnchor="middle" fontSize="7" fill="#8a8490" fontFamily="sans-serif">+ add key</text>

            {/* Right col - Results */}
            <rect x="230" y="86" width="198" height="164" rx="10" fill="white" stroke="#e2e0ed" strokeWidth="1"/>
            <text x="242" y="102" fontSize="8" fill="#8a8490" fontFamily="sans-serif" fontWeight="600" textDecoration="uppercase" letterSpacing="0.5">TEST RESULTS</text>

            {/* Result row 1 - pass */}
            <rect x="238" y="108" width="182" height="30" rx="7" fill="#f0fdf4" stroke="#bbf7d0" strokeWidth="1"/>
            <rect x="244" y="116" width="30" height="12" rx="6" fill="#2e7d32" opacity="0.15"/>
            <text x="259" y="126" textAnchor="middle" fontSize="8" fill="#2e7d32" fontFamily="monospace" fontWeight="700">200</text>
            <text x="280" y="121" fontSize="7" fill="#231212" fontFamily="sans-serif" fontWeight="600">Positive - all fields</text>
            <text x="280" y="131" fontSize="7" fill="#8a8490" fontFamily="sans-serif">All mandatory fields present</text>
            <rect x="370" y="116" width="42" height="12" rx="6" fill="#e3e2f7"/>
            <text x="391" y="126" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace">118ms</text>

            {/* Result row 2 - fail */}
            <rect x="238" y="144" width="182" height="30" rx="7" fill="#fff1f2" stroke="#fecdd3" strokeWidth="1"/>
            <rect x="244" y="152" width="30" height="12" rx="6" fill="#c62828" opacity="0.12"/>
            <text x="259" y="162" textAnchor="middle" fontSize="8" fill="#c62828" fontFamily="monospace" fontWeight="700">422</text>
            <text x="280" y="157" fontSize="7" fill="#231212" fontFamily="sans-serif" fontWeight="600">Negative - email null</text>
            <text x="280" y="167" fontSize="7" fill="#8a8490" fontFamily="sans-serif">Validation failed as expected</text>
            <rect x="370" y="152" width="42" height="12" rx="6" fill="#e3e2f7"/>
            <text x="391" y="162" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace">95ms</text>

            {/* Result row 3 - fail */}
            <rect x="238" y="180" width="182" height="30" rx="7" fill="#fff1f2" stroke="#fecdd3" strokeWidth="1"/>
            <rect x="244" y="188" width="30" height="12" rx="6" fill="#c62828" opacity="0.12"/>
            <text x="259" y="198" textAnchor="middle" fontSize="8" fill="#c62828" fontFamily="monospace" fontWeight="700">400</text>
            <text x="280" y="193" fontSize="7" fill="#231212" fontFamily="sans-serif" fontWeight="600">Negative - password null</text>
            <text x="280" y="203" fontSize="7" fill="#8a8490" fontFamily="sans-serif">Bad request - required field</text>
            <rect x="370" y="188" width="42" height="12" rx="6" fill="#e3e2f7"/>
            <text x="391" y="198" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace">102ms</text>

            {/* Summary bar */}
            <rect x="230" y="220" width="198" height="22" rx="8" fill="#f0eff6" stroke="#e2e0ed" strokeWidth="1"/>
            <rect x="238" y="226" width="28" height="10" rx="5" fill="#2e7d32" opacity="0.15"/>
            <text x="252" y="235" textAnchor="middle" fontSize="7" fill="#2e7d32" fontFamily="sans-serif" fontWeight="700">1 pass</text>
            <rect x="272" y="226" width="28" height="10" rx="5" fill="#c62828" opacity="0.1"/>
            <text x="286" y="235" textAnchor="middle" fontSize="7" fill="#c62828" fontFamily="sans-serif" fontWeight="700">2 fail</text>
            <text x="330" y="235" fontSize="7" fill="#8a8490" fontFamily="sans-serif">avg response</text>
            <rect x="378" y="226" width="42" height="10" rx="5" fill="#e3e2f7"/>
            <text x="399" y="235" textAnchor="middle" fontSize="7" fill="#6c5ce7" fontFamily="monospace" fontWeight="600">105ms</text>

          </svg>
        </div>

        <div className="welcome-badge">* API Testing Suite</div>
        <button className="btn-primary btn-lg" onClick={onStart} style={{alignSelf:"flex-start",marginBottom:20}}>Open Explorer</button>
        <h1 className="welcome-title">
          <span className="title-line1">Test</span>
          <span className="title-line2">Smarter.</span>
          <span className="title-line3">Ship Confident.</span>
        </h1>
        <p className="welcome-sub">
          Auto-generate positive &amp; negative test scenarios for any API.
          Save configs, track history, and get full reports - locally.
        </p>
        <div className="welcome-features">
          {["REST & GraphQL", "Auto test cases", "Save APIs", "History"].map(f => (
            <div className="feature-chip" key={f}>{f}</div>
          ))}
        </div>
        <div className="welcome-stats-row">
          <div className="mini-stat"><span className="mini-num">{savedCount}</span><span className="mini-label">Saved APIs</span></div>
          <div className="mini-stat"><span className="mini-num">{historyCount}</span><span className="mini-label">Test Runs</span></div>
        </div>
      </div>
      <div className="welcome-visual">
        <div className="how-to-use">
          <div className="how-to-header">
            <span className="how-to-badge">How it works</span>
            <h3 className="how-to-title">Get started in 4 steps</h3>
          </div>

          <div className="steps-list">

            <div className="step-item">
              <div className="step-num">1</div>
              <div className="step-content">
                <div className="step-title">Set Global Authorization <span className="step-tag">Optional</span></div>
                <div className="step-desc">
                  Go to <strong>Explorer</strong>  -  the top panel shows <em>Global Authorization</em>. Paste your Bearer token or API key once. It will be automatically injected into every API request.
                </div>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">2</div>
              <div className="step-content">
                <div className="step-title">Configure Your API</div>
                <div className="step-desc">
                  Enter your API URL and select method (GET, POST...). Use the <em>Body</em> tab for JSON payload, <em>Headers</em> tab for custom headers, or <em>GraphQL</em> tab for mutations and queries.
                </div>
                <div className="step-chips">
                  <span className="step-chip">REST</span>
                  <span className="step-chip">GraphQL</span>
                  <span className="step-chip">Headers</span>
                  <span className="step-chip">Auth</span>
                </div>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">3</div>
              <div className="step-content">
                <div className="step-title">Add Mandatory Keys</div>
                <div className="step-desc">
                  Add required fields of your API (e.g. <code>email</code>, <code>password</code>). The app auto-generates <strong>positive</strong> and <strong>negative</strong> test cases  -  setting each key to <code>null</code> and <code>""</code> one by one.
                </div>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">4</div>
              <div className="step-content">
                <div className="step-title">Run Tests &amp; View Report</div>
                <div className="step-desc">
                  Click <strong>Run Tests</strong>. Every scenario is hit live and the <em>Report</em> shows status code, response time, and full request/response side by side. All runs are saved in <strong>History</strong>.
                </div>
                <div className="step-chips">
                  <span className="step-chip green">200 OK</span>
                  <span className="step-chip red">400 Error</span>
                  <span className="step-chip purple">Response time</span>
                </div>
              </div>
            </div>

            <div className="step-item">
              <div className="step-num">5</div>
              <div className="step-content">
                <div className="step-title">Save, Export &amp; Import</div>
                <div className="step-desc">
                  Save any API config via <strong>Save API</strong>. Revisit from the <em>Saved APIs</em> page  -  load into Explorer, run directly, or <strong>export</strong> as JSON to share with teammates. Import configs in one click.
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// --- Page: Explorer
function ExplorerPage({ onRunTests, initialConfig, globalAuth: globalAuthProp }) {
  // Always read fresh from localStorage so it updates after Save Auth is clicked
  const [localAuth, setLocalAuth] = useState(loadGlobalAuth());
  const globalAuth = localAuth;

  // Re-read auth from localStorage every 500ms while on this page
  useEffect(() => {
    const interval = setInterval(() => {
      const fresh = loadGlobalAuth();
      setLocalAuth(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(fresh)) return fresh;
        return prev;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);
  const [url, setUrl] = useState(initialConfig ? initialConfig.url : "https://jsonplaceholder.typicode.com/posts");
  const [method, setMethod] = useState(initialConfig ? initialConfig.method : "POST");
  const [body, setBody] = useState(initialConfig ? initialConfig.body : `{\n  "title": "Hello",\n  "body": "World",\n  "userId": 1\n}`);
  const [headers, setHeaders] = useState(initialConfig ? initialConfig.headers : [{ key: "Content-Type", value: "application/json" }]);
  const [mandatoryKeys, setMandatoryKeys] = useState(initialConfig ? initialConfig.mandatoryKeys : ["title", "userId"]);
  const [newKey, setNewKey] = useState("");
  const [isGraphQL, setIsGraphQL] = useState(initialConfig ? initialConfig.isGraphQL : false);
  const [graphqlQuery, setGraphqlQuery] = useState(initialConfig ? initialConfig.graphqlQuery : `query {\n  users {\n    id\n    name\n  }\n}`);
  const [operationName, setOperationName] = useState(initialConfig ? initialConfig.operationName : "");
  const [tab, setTab] = useState("body");
  const [loading, setLoading] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isSaved, setIsSaved] = useState(initialConfig && initialConfig._fromSaved ? true : false);
  const [isDirty, setIsDirty] = useState(false);
  const [editingId] = useState(initialConfig && initialConfig._fromSaved ? initialConfig.id : null);
  const [useGlobalAuth, setUseGlobalAuth] = useState(initialConfig ? initialConfig.useGlobalAuth !== false : true);

  // sync if initialConfig changes (load from saved)
  useEffect(() => {
    if (initialConfig) {
      setUrl(initialConfig.url || "");
      setMethod(initialConfig.method || "POST");
      setBody(initialConfig.body || "{}");
      setHeaders(initialConfig.headers || []);
      setMandatoryKeys(initialConfig.mandatoryKeys || []);
      const gql = initialConfig.isGraphQL || false;
      setIsGraphQL(gql);
      setGraphqlQuery(initialConfig.graphqlQuery || "");
      setOperationName(initialConfig.operationName || "");
      if (gql) setTab("graphql");
      setUseGlobalAuth(initialConfig.useGlobalAuth !== false);
    }
  }, [initialConfig]);

  const currentConfig = () => ({ url, method, body, headers, mandatoryKeys, isGraphQL, graphqlQuery, operationName, useGlobalAuth });
  const markDirty = () => { if (isSaved) setIsDirty(true); };

  const handleSave = (name, desc) => {
    const list = loadSaved();
    if (editingId) {
      const idx = list.findIndex(a => a.id === editingId);
      if (idx !== -1) {
        list[idx] = { ...list[idx], ...currentConfig(), name, desc, updatedAt: Date.now() };
      } else {
        list.unshift({ id: Date.now().toString(), name, desc, ...currentConfig(), createdAt: Date.now() });
      }
    } else {
      list.unshift({ id: Date.now().toString(), name, desc, ...currentConfig(), createdAt: Date.now() });
    }
    saveSaved(list);
    setShowSaveModal(false);
    setIsSaved(true);
    setIsDirty(false);
  };

  const handleSubmit = async () => {
    setLoading(true);
    const scenarios = generateScenarios(body, mandatoryKeys);
    const results = [];
    for (const s of scenarios) {
      const res = await hitApi(url, method, headers, s.body, isGraphQL, graphqlQuery, operationName, globalAuth, useGlobalAuth);
      results.push({ ...s, ...res });
    }
    const runData = { id: Date.now().toString(), timestamp: Date.now(), url, method, headers, body, mandatoryKeys, isGraphQL, graphqlQuery, operationName, useGlobalAuth, results };
    addToHistory(runData);
    setLoading(false);
    onRunTests(runData);
  };

  const addHeader = () => { setHeaders([...headers, { key: "", value: "" }]); markDirty(); };
  const removeHeader = (i) => { setHeaders(headers.filter((_, idx) => idx !== i)); markDirty(); };
  const updateHeader = (i, field, val) => { const h = [...headers]; h[i][field] = val; setHeaders(h); };
  const addMandatoryKey = () => { if (newKey.trim()) { setMandatoryKeys([...mandatoryKeys, newKey.trim()]); setNewKey(""); markDirty(); } };
  const removeMandatoryKey = (i) => { setMandatoryKeys(mandatoryKeys.filter((_, idx) => idx !== i)); markDirty(); };

  return (
    <div className="explorer-page">
      <div className="explorer-header">
        <div>
          <h2 className="explorer-title">API Explorer {initialConfig && initialConfig.name && <span className="loaded-name">&#8212; {initialConfig.name}</span>}</h2>
          <p className="explorer-sub">Configure your API and define mandatory fields to auto-generate test scenarios.</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {isSaved && !isDirty
            ? <span className="save-badge-saved">Saved</span>
            : isSaved && isDirty
              ? <button className="btn-secondary" onClick={() => setShowSaveModal(true)}>Update Changes</button>
              : <button className="btn-secondary" onClick={() => setShowSaveModal(true)}>+ Save API</button>
          }
        </div>
      </div>

      {/* Global Auth Banner */}
      {globalAuth && globalAuth.token && (
        <div className="global-auth-banner">
          <div className="global-auth-left">
            <span className="global-auth-icon">🔑</span>
            <div>
              <span className="global-auth-label">Global Authorization</span>
              <span className="global-auth-value">{globalAuth.type} {globalAuth.token.slice(0,12)}•••</span>
            </div>
          </div>
          <label className="auth-checkbox-label">
            <input type="checkbox" checked={useGlobalAuth} onChange={e => setUseGlobalAuth(e.target.checked)} className="auth-checkbox"/>
            <span>Use for this API</span>
          </label>
        </div>
      )}
      {globalAuth && !globalAuth.token && (
        <div className="global-auth-banner empty">
          <div className="global-auth-left">
            <span className="global-auth-icon">🔑</span>
            <span style={{color:"var(--muted)",fontSize:13}}>No global auth token set. Configure it in the <strong>Auth panel</strong> above.</span>
          </div>
        </div>
      )}

      <div className="explorer-body">
        <div className="config-panel">
          <div className="panel-section">
            <label className="field-label">Request URL</label>
            <div className="url-row">
              <select className="method-select" value={method} onChange={e => { setMethod(e.target.value); markDirty(); }}>
                {["GET","POST","PUT","PATCH","DELETE"].map(m => <option key={m}>{m}</option>)}
              </select>
              <input className="url-input" value={url} onChange={e => { setUrl(e.target.value); markDirty(); }} placeholder="https://api.example.com/endpoint" />
            </div>
          </div>

          <div className="panel-section">
            {isGraphQL && <div style={{marginBottom:8,fontSize:12,color:"var(--accent2)",fontFamily:"'JetBrains Mono',monospace",background:"rgba(78,204,163,0.08)",border:"1px solid rgba(78,204,163,0.2)",borderRadius:6,padding:"6px 12px"}}>GQL GraphQL mode active  -  body will be sent as <strong>variables</strong></div>}
            <div className="tabs">
              {["body","headers","graphql"].map(t => (
                <button key={t} className={`tab-btn ${tab === t ? "active" : ""}`} onClick={() => {
                  setTab(t);
                  if (t === "graphql") setIsGraphQL(true);
                  else setIsGraphQL(false);
                }}>
                  {t === "graphql" ? "GQL GraphQL" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {tab === "body" && <textarea className="code-textarea" value={body} onChange={e => { setBody(e.target.value); markDirty(); }} placeholder='{ "key": "value" }' rows={10} />}
            {tab === "headers" && (
              <div className="headers-editor">
                {headers.map((h, i) => (
                  <div className="header-row" key={i}>
                    <input className="header-input" placeholder="Key" value={h.key} onChange={e => updateHeader(i, "key", e.target.value)} />
                    <span className="header-sep">:</span>
                    <input className="header-input" placeholder="Value" value={h.value} onChange={e => updateHeader(i, "value", e.target.value)} />
                    <button className="btn-icon remove" onClick={() => removeHeader(i)}>x</button>
                  </div>
                ))}
                <button className="btn-secondary" onClick={addHeader}>+ Add Header</button>
              </div>
            )}
            {tab === "graphql" && (
              <div style={{display:"flex",flexDirection:"column",gap:10}}>
                <div>
                  <label className="field-label" style={{marginBottom:6}}>Operation Name</label>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    <input
                      className="url-input"
                      placeholder="e.g. VerifyEmailUser (auto-detected from query)"
                      value={operationName || extractOperationName(graphqlQuery) || ""}
                      onChange={e => { setOperationName(e.target.value); markDirty(); }}
                    />
                    {extractOperationName(graphqlQuery) && !operationName && (
                      <span style={{fontSize:12,color:"var(--accent2)",whiteSpace:"nowrap",fontFamily:"'JetBrains Mono',monospace"}}>
                        v auto
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <label className="field-label" style={{marginBottom:6}}>Query / Mutation</label>
                  <textarea
                    className="code-textarea graphql"
                    value={graphqlQuery}
                    onChange={e => { setGraphqlQuery(e.target.value); if (!operationName) setOperationName(""); markDirty(); }}
                    placeholder="mutation MyOp($input: MyInput!) { ... }"
                    rows={12}
                  />
                </div>
                <div style={{fontSize:12,color:"var(--muted)",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:6,padding:"10px 14px",fontFamily:"'JetBrains Mono',monospace"}}>
                  <span style={{color:"var(--accent)"}}>Variables</span> come from the <span style={{color:"var(--accent2)"}}>Body tab</span> &mdash; paste your variables JSON there.
                  {/\$input\s*:/.test(graphqlQuery) && <span style={{display:"block",marginTop:4,color:"var(--accent2)"}}> v <strong>$input</strong> wrapper detected  -  your body will be sent as <code>{"{ input: { ...body } }"}</code></span>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="mandatory-panel">
          <div className="panel-section">
            <label className="field-label">Mandatory Keys</label>
            <p className="field-hint">These keys will be individually nullified/emptied to generate negative test cases.</p>
            <div className="key-tags">
              {mandatoryKeys.map((k, i) => (
                <div className="key-tag" key={i}><span>{k}</span><button onClick={() => removeMandatoryKey(i)}>x</button></div>
              ))}
            </div>
            <div className="add-key-row">
              <input className="key-input" placeholder="e.g. email" value={newKey} onChange={e => setNewKey(e.target.value)} onKeyDown={e => e.key === "Enter" && addMandatoryKey()} />
              <button className="btn-secondary" onClick={addMandatoryKey}>Add</button>
            </div>
          </div>

          <div className="panel-section scenario-preview">
            <label className="field-label">Scenarios to be run</label>
            {generateScenarios(body, mandatoryKeys).map((s, i) => (
              <div className={`scenario-item ${s.type}`} key={i}>{s.label}</div>
            ))}
          </div>

          <button className="btn-primary btn-run" onClick={handleSubmit} disabled={loading}>
            {loading ? <span className="spinner" /> : null}
            {loading ? "Running Tests..." : ">  Run Tests"}
          </button>
        </div>
      </div>

      {showSaveModal && <SaveModal onSave={handleSave} onClose={() => setShowSaveModal(false)} existing={editingId ? { name: initialConfig && initialConfig.name, desc: (initialConfig && initialConfig.desc) } : null} />}
    </div>
  );
}

// --- Page: Saved APIs
function SavedPage({ onLoad, onRunDirect }) {
  const [saved, setSaved] = useState(loadSaved());
  const [search, setSearch] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");

  const refresh = () => setSaved(loadSaved());

  const handleDelete = (id) => {
    const list = loadSaved().filter(a => a.id !== id);
    saveSaved(list);
    setDeleteConfirm(null);
    refresh();
  };

  // Export single API as JSON file
  const exportOne = (api) => {
    const data = JSON.stringify([api], null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${api.name.replace(/\s+/g, "_")}_api.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Export all APIs as JSON file
  const exportAll = () => {
    const data = JSON.stringify(loadSaved(), null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tester_helper_all_apis_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import APIs from JSON file
  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportError("");
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        const apis = Array.isArray(parsed) ? parsed : [parsed];
        // Validate basic shape
        if (!apis.every(a => a.url && a.method)) throw new Error("Invalid format - each API needs url and method");
        const existing = loadSaved();
        // Merge: skip duplicates by id, add new ones
        const existingIds = new Set(existing.map(a => a.id));
        const newApis = apis.filter(a => !existingIds.has(a.id));
        const merged = [...newApis, ...existing];
        saveSaved(merged);
        refresh();
        setImportSuccess(`v Imported ${newApis.length} API${newApis.length !== 1 ? "s" : ""} (${apis.length - newApis.length} skipped as duplicates)`);
        setTimeout(() => setImportSuccess(""), 4000);
      } catch (err) {
        setImportError("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-imported
  };

  const filtered = saved.filter(a =>
    a.name.toLowerCase().includes(search.toLowerCase()) ||
    (a.url || "").toLowerCase().includes(search.toLowerCase())
  );

  const methodColor = { GET: "#2e7d32", POST: "#6c5ce7", PUT: "#f59e0b", PATCH: "#ea580c", DELETE: "#c62828" };

  return (
    <div className="saved-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Saved APIs</h2>
          <p className="page-sub">{saved.length} saved &mdash; load into Explorer or run directly</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input className="search-input" placeholder="🔍  Search by name or URL..." value={search} onChange={e => setSearch(e.target.value)} />
          {/* Import */}
          <label className="btn-secondary" style={{cursor:"pointer",display:"inline-flex",alignItems:"center",gap:6,padding:"10px 18px",borderRadius:100,fontSize:13,fontWeight:500,border:"1px solid var(--border)",background:"var(--bg2)"}}>
            Import
            <input type="file" accept=".json" onChange={handleImport} style={{display:"none"}}/>
          </label>
          {/* Export All */}
          {saved.length > 0 && (
            <button className="btn-secondary" style={{borderRadius:100,fontSize:13,fontWeight:500}} onClick={exportAll}>
              Export All
            </button>
          )}
        </div>
      </div>

      {/* Import feedback */}
      {importSuccess && <div className="import-toast success">{importSuccess}</div>}
      {importError && <div className="import-toast error">{importError}</div>}

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📁</div>
          <div className="empty-title">{search ? "No results found" : "No saved APIs yet"}</div>
          <div className="empty-sub">{search ? "Try a different search term" : "Go to Explorer, configure an API, and click \"Save API\""}</div>
        </div>
      )}

      <div className="saved-grid">
        {filtered.map(api => (
          <div className="saved-card" key={api.id}>
            <div className="saved-card-top">
              <div className="saved-card-info">
                <span className="method-badge" style={{ background: `${methodColor[api.method] || "#888"}18`, color: methodColor[api.method] || "#888", border: `1px solid ${methodColor[api.method] || "#888"}33` }}>{api.method}</span>
                <span className="saved-name">{api.name}</span>
              </div>
              <div style={{display:"flex",gap:4}}>
                <button className="btn-icon" onClick={() => exportOne(api)} title="Export this API" style={{color:"var(--accent2)"}}>v</button>
                <button className="btn-icon remove" onClick={() => setDeleteConfirm(api.id)} title="Delete">x</button>
              </div>
            </div>
            <div className="saved-url">{shortUrl(api.url)}</div>
            {api.desc && <div className="saved-desc">{api.desc}</div>}
            <div className="saved-meta">
              <span>{api.mandatoryKeys ? api.mandatoryKeys.length : 0} mandatory keys</span>
              <span>·</span>
              <span>{api.isGraphQL ? "GraphQL" : "REST"}</span>
              {api.useGlobalAuth !== false && <><span>·</span><span style={{color:"var(--accent2)"}}>🔑 Auth</span></>}
              <span>·</span>
              <span>{formatDate(api.createdAt)}</span>
            </div>
            <div className="saved-actions">
              <button className="btn-secondary btn-sm" onClick={() => onLoad(api)}>Edit Load in Explorer</button>
              <button className="btn-primary btn-sm" onClick={() => onRunDirect(api)}>> Run Tests</button>
            </div>
            {deleteConfirm === api.id && (
              <div className="delete-confirm">
                <span>Delete this API?</span>
                <button className="btn-danger btn-sm" onClick={() => handleDelete(api.id)}>Delete</button>
                <button className="btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Page: History
function HistoryPage({ onViewReport, onOpenExplorer }) {
  const [history, setHistory] = useState(loadHistory());
  const [search, setSearch] = useState("");
  const [filterResult, setFilterResult] = useState("all");

  const filtered = history.filter(run => {
    const matchSearch = run.url.toLowerCase().includes(search.toLowerCase());
    const passed = run.results.filter(r => r.ok).length;
    const failed = run.results.length - passed;
    if (filterResult === "passed" && failed > 0) return false;
    if (filterResult === "failed" && failed === 0) return false;
    return matchSearch;
  });

  const clearHistory = () => { saveHistory([]); setHistory([]); };
  const removeRun = (id) => { const h = loadHistory().filter(r => r.id !== id); saveHistory(h); setHistory(h); };

  const methodColor = { GET: "#4ecca3", POST: "#7c6af7", PUT: "#f7c96a", PATCH: "#f7a06a", DELETE: "#f7546a" };

  return (
    <div className="history-page">
      <div className="page-header">
        <div>
          <h2 className="page-title">Test History</h2>
          <p className="page-sub">{history.length} test runs recorded locally (last 50 kept)</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <input className="search-input" placeholder="🔍  Filter by URL..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="filter-tabs">
            {["all","passed","failed"].map(f => (
              <button key={f} className={`filter-btn ${filterResult === f ? "active" : ""}`} onClick={() => setFilterResult(f)}>
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {history.length > 0 && <button className="btn-danger btn-sm" onClick={clearHistory}>Clear All</button>}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">🕐</div>
          <div className="empty-title">{search || filterResult !== "all" ? "No matching runs" : "No history yet"}</div>
          <div className="empty-sub">Run tests from Explorer or Saved APIs to see history here</div>
        </div>
      )}

      <div className="history-list">
        {filtered.map(run => {
          const passed = run.results.filter(r => r.ok).length;
          const failed = run.results.length - passed;
          const avgTime = Math.round(run.results.reduce((a, r) => a + r.elapsed, 0) / run.results.length);
          const allPassed = failed === 0;
          return (
            <div className="history-card" key={run.id}>
              <div className="history-left">
                <div className="history-status-dot" style={{ background: allPassed ? "var(--pass)" : "var(--fail)" }} />
                <div>
                  <div className="history-url-row">
                    <span className="method-badge sm" style={{ background: `${methodColor[run.method] || "#888"}22`, color: methodColor[run.method] || "#888" }}>{run.method}</span>
                    <span className="history-url">{run.url}</span>
                  </div>
                  <div className="history-meta">
                    <span>{formatDate(run.timestamp)}</span>
                    <span>·</span>
                    <span>{run.results.length} scenarios</span>
                    <span>·</span>
                    <span>{run.mandatoryKeys ? run.mandatoryKeys.length : 0} mandatory keys</span>
                    <span>·</span>
                    <span>avg {avgTime}ms</span>
                  </div>
                </div>
              </div>
              <div className="history-right">
                <span className="pass-badge">[OK] {passed}</span>
                <span className="fail-badge">[X] {failed}</span>
                <button className="btn-secondary btn-sm" onClick={() => onOpenExplorer(run)}>Open in Explorer</button>
                <button className="btn-secondary btn-sm" onClick={() => onViewReport(run)}>View Report</button>
                <button className="btn-icon remove" onClick={() => removeRun(run.id)}>x</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Page: Report
function ReportPage({ data, onBack }) {
  const [expanded, setExpanded] = useState(null);
  const { url, method, results, timestamp } = data;
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const avgTime = Math.round(results.reduce((a, r) => a + r.elapsed, 0) / results.length);

  return (
    <div className="report-page">
      <div className="report-header">
        <div>
          <h2 className="report-title">Test Report</h2>
          <div className="report-meta">{method} {url}</div>
          {timestamp && <div className="report-time">{formatDate(timestamp)}</div>}
        </div>
        <button className="btn-secondary" onClick={onBack}>&lt;- Back</button>
      </div>

      <div className="report-stats">
        {[
          { num: results.length, cls: "total", label: "Total Scenarios" },
          { num: passed, cls: "pass", label: "Passed" },
          { num: failed, cls: "fail", label: "Failed" },
          { num: avgTime + "ms", cls: "time", label: "Avg Response" },
        ].map(s => (
          <div className="stat-card" key={s.label}>
            <div className={`stat-num ${s.cls}`}>{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="report-table">
        <div className="table-header">
          <span>#</span><span>Scenario</span><span>Request Body</span><span>Status</span><span>Time</span><span>Details</span>
        </div>
        {results.map((r, i) => (
          <div key={i}>
            <div className={`table-row ${r.ok ? "row-pass" : "row-fail"}`}>
              <span className="row-num">{i + 1}</span>
              <span className="row-label">{r.label}</span>
              <span className="row-body">{JSON.stringify(r.body).slice(0, 60)}{JSON.stringify(r.body).length > 60 ? "..." : ""}</span>
              <span className={`badge ${r.ok ? "badge-pass" : "badge-fail"}`}>{r.status !== undefined && r.status !== null ? r.status : "ERR"}</span>
              <span className="row-time">{r.elapsed}ms</span>
              <button className="btn-expand" onClick={() => setExpanded(expanded === i ? null : i)}>{expanded === i ? "^" : "v"}</button>
            </div>
            {expanded === i && (
              <div className="row-detail">
                <div className="detail-col">
                  <div className="detail-label">Request Body</div>
                  <pre className="detail-pre">{JSON.stringify(r.body, null, 2)}</pre>
                </div>
                <div className="detail-col">
                  <div className="detail-label">Response</div>
                  <pre className="detail-pre">{r.error ? r.error : JSON.stringify(r.data, null, 2)}</pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// --- App Shell
export default function App() {
  const [page, setPage] = useState("welcome");
  const [reportData, setReportData] = useState(null);
  const [explorerConfig, setExplorerConfig] = useState(null);
  const [globalAuth, setGlobalAuth] = useState(loadGlobalAuth());

  // Re-read auth whenever page changes to explorer (in case it was updated)
  useEffect(() => {
    if (page === "explorer") setGlobalAuth(loadGlobalAuth());
  }, [page]);

  const savedCount = loadSaved().length;
  const historyCount = loadHistory().length;

  const handleRunTests = (data) => { setReportData(data); setPage("report"); };

  const handleLoadSaved = (api) => { setExplorerConfig({ ...api, _fromSaved: true }); setPage("explorer"); };

  const handleRunDirect = async (api) => {
    const auth = loadGlobalAuth();
    const scenarios = generateScenarios(api.body, api.mandatoryKeys);
    const results = [];
    for (const s of scenarios) {
      const res = await hitApi(api.url, api.method, api.headers, s.body, api.isGraphQL, api.graphqlQuery, api.operationName, auth, api.useGlobalAuth);
      results.push({ ...s, ...res });
    }
    const runData = { id: Date.now().toString(), timestamp: Date.now(), ...api, results };
    addToHistory(runData);
    setReportData(runData);
    setPage("report");
  };

  const navItems = [
    { id: "welcome", label: "Home" },
    { id: "explorer", label: "Explorer" },
    { id: "saved", label: `Saved (${savedCount})` },
    { id: "history", label: `History (${historyCount})` },
    ...(reportData ? [{ id: "report", label: "Report" }] : []),
  ];

  return (
    <>
      <style>{`
        @import url('https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700,900&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
          --bg: #f4f4f4; --bg2: #ffffff; --bg3: #f0eff6; --border: #e2e0ed;
          --accent: #231212; --accent2: #6c5ce7; --danger: #e53935;
          --text: #231212; --muted: #8a8490; --pass: #2e7d32; --fail: #c62828;
          --lavender: #e3e2f7; --radius: 12px;
        }
        body { background: var(--bg); color: var(--text); font-family: 'Satoshi', sans-serif; min-height: 100vh; }

        /* NAV */
        .nav { display: flex; align-items: center; justify-content: space-between; padding: 16px 48px; border-bottom: 1px solid var(--border); background: rgba(255,255,255,0.92); position: sticky; top: 0; z-index: 100; backdrop-filter: blur(16px); }
        .nav-logo { font-weight: 900; font-size: 17px; letter-spacing: -0.3px; color: var(--accent); }
        .nav-logo span { color: var(--accent2); }
        .nav-links { display: flex; gap: 4px; }
        .nav-btn { background: none; border: 1px solid transparent; color: var(--muted); padding: 7px 18px; border-radius: 100px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.2s; white-space: nowrap; }
        .nav-btn:hover { color: var(--text); background: var(--bg3); }
        .nav-btn.active { color: var(--bg2); background: var(--accent); border-color: var(--accent); }

        /* WELCOME */
        .welcome-page { display: grid; grid-template-columns: 1fr 1fr; min-height: calc(100vh - 65px); background: var(--bg); }
        .welcome-grid-bg { position: fixed; inset: 0; background-image: radial-gradient(circle at 20% 80%, rgba(227,226,247,0.6) 0%, transparent 50%), radial-gradient(circle at 80% 20%, rgba(227,226,247,0.4) 0%, transparent 50%); pointer-events: none; }
        .welcome-content { padding: 80px 64px; display: flex; flex-direction: column; justify-content: center; position: relative; }
        .hero-img-wrap { margin-bottom: 28px; border-radius: 20px; overflow: hidden; box-shadow: 0 12px 40px rgba(35,18,18,0.12), 0 2px 8px rgba(35,18,18,0.06); border: 1px solid var(--border); background: #fff; }
        .hero-left-svg { width: 100%; height: auto; display: block; }
        .welcome-badge { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--accent2); background: var(--lavender); padding: 5px 14px; border-radius: 100px; margin-bottom: 28px; font-weight: 500; letter-spacing: 0.5px; }
        .welcome-title { font-size: clamp(22px, 2.4vw, 34px); font-weight: 900; line-height: 1.12; margin-bottom: 18px; letter-spacing: -1px; color: var(--accent); }
        .title-line1 { display: block; }
        .title-line2 { display: block; font-style: italic; color: var(--accent2); }
        .title-line3 { display: block; }
        .welcome-sub { font-size: 16px; color: var(--muted); line-height: 1.75; max-width: 420px; margin-bottom: 28px; font-weight: 400; }
        .welcome-features { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 28px; }
        .feature-chip { font-size: 13px; padding: 7px 16px; border-radius: 100px; background: var(--bg2); border: 1px solid var(--border); color: var(--muted); font-weight: 500; }
        .welcome-stats-row { display: flex; gap: 16px; margin-bottom: 36px; }
        .mini-stat { display: flex; flex-direction: column; align-items: center; background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 16px 32px; box-shadow: 0 2px 12px rgba(35,18,18,0.06); }
        .mini-num { font-size: 36px; font-weight: 900; color: var(--accent); letter-spacing: -2px; }
        .mini-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px; font-weight: 500; }
        .welcome-visual { background: var(--lavender); display: flex; flex-direction: column; overflow-y: auto; }
        .how-to-use { padding: 48px 44px; height: 100%; }
        .how-to-header { margin-bottom: 28px; }
        .how-to-badge { display: inline-block; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--accent2); background: rgba(108,92,231,0.12); border: 1px solid rgba(108,92,231,0.25); padding: 4px 12px; border-radius: 100px; margin-bottom: 10px; }
        .how-to-title { font-size: 22px; font-weight: 900; color: var(--accent); letter-spacing: -0.5px; }
        /* steps */
        .steps-list { display: flex; flex-direction: column; gap: 0; }
        .step-item { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid rgba(35,18,18,0.07); position: relative; }
        .step-item:last-child { border-bottom: none; }
        .step-num { width: 32px; height: 32px; border-radius: 50%; background: var(--accent); color: #fff; font-size: 13px; font-weight: 800; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px; box-shadow: 0 2px 8px rgba(35,18,18,0.18); }
        .step-content { flex: 1; min-width: 0; }
        .step-title { font-size: 14px; font-weight: 700; color: var(--accent); margin-bottom: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .step-tag { font-size: 10px; font-weight: 600; background: rgba(108,92,231,0.12); color: var(--accent2); padding: 2px 8px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.5px; }
        .step-desc { font-size: 13px; color: #5a4f4f; line-height: 1.65; }
        .step-desc strong { color: var(--accent); font-weight: 700; }
        .step-desc em { color: var(--accent2); font-style: normal; font-weight: 600; }
        .step-desc code { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: rgba(35,18,18,0.07); padding: 1px 6px; border-radius: 4px; color: var(--accent); }
        .step-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
        .step-chip { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 100px; background: rgba(35,18,18,0.07); color: var(--muted); border: 1px solid rgba(35,18,18,0.1); font-family: 'JetBrains Mono', monospace; }
        .step-chip.green { background: rgba(46,125,50,0.1); color: #2e7d32; border-color: rgba(46,125,50,0.2); }
        .step-chip.red { background: rgba(198,40,40,0.1); color: #c62828; border-color: rgba(198,40,40,0.2); }
        .step-chip.purple { background: rgba(108,92,231,0.1); color: var(--accent2); border-color: rgba(108,92,231,0.2); }
        .code-line { padding: 4px 0; }
        .c-key { color: var(--accent); font-weight: 500; } .c-op { color: var(--muted); margin: 0 6px; } .c-str { color: var(--accent2); }
        .code-divider { border-top: 1px solid var(--border); margin: 16px 0; }
        .scenario { font-size: 13px; padding: 6px 0; color: var(--muted); }
        .c-status.ok { color: var(--pass); } .c-status.fail { color: var(--fail); } .c-time { color: var(--muted); margin-left: 8px; }

        /* BUTTONS */
        .btn-primary { background: var(--accent); color: #fff; border: none; border-radius: 100px; padding: 14px 28px; font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer; transition: all 0.2s; display: inline-flex; align-items: center; gap: 8px; box-shadow: 0 2px 8px rgba(35,18,18,0.2); }
        .btn-primary:hover { background: #3d2828; transform: translateY(-1px); box-shadow: 0 6px 20px rgba(35,18,18,0.25); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
        .btn-lg { padding: 16px 40px; font-size: 17px; }
        .btn-secondary { background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 100px; padding: 10px 20px; font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-secondary:hover { border-color: var(--accent); background: var(--bg3); }
        .btn-danger { background: rgba(198,40,40,0.08); color: var(--fail); border: 1px solid rgba(198,40,40,0.2); border-radius: 100px; padding: 10px 20px; font-family: inherit; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-danger:hover { background: rgba(198,40,40,0.15); }
        .btn-sm { padding: 7px 16px; font-size: 13px; }
        .btn-icon { background: none; border: none; color: var(--muted); cursor: pointer; padding: 4px 8px; border-radius: 6px; transition: all 0.15s; font-size: 12px; }
        .btn-icon.remove:hover { color: var(--fail); background: rgba(198,40,40,0.08); }

        /* MODAL */
        .modal-overlay { position: fixed; inset: 0; background: rgba(35,18,18,0.4); display: flex; align-items: center; justify-content: center; z-index: 200; backdrop-filter: blur(8px); }
        .modal { background: var(--bg2); border: 1px solid var(--border); border-radius: 20px; padding: 32px; min-width: 400px; box-shadow: 0 24px 60px rgba(35,18,18,0.15); }
        .modal-title { font-size: 20px; font-weight: 700; margin-bottom: 20px; color: var(--accent); }
        .modal-input { width: 100%; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 12px 16px; font-family: inherit; font-size: 14px; outline: none; margin-top: 6px; transition: border-color 0.2s; }
        .modal-input:focus { border-color: var(--accent); background: var(--bg2); }
        .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 28px; }

        /* EXPLORER */
        .explorer-page { padding: 44px 48px; max-width: 1280px; margin: 0 auto; }
        .explorer-header { margin-bottom: 32px; display: flex; justify-content: space-between; align-items: flex-start; }
        .explorer-title { font-size: 30px; font-weight: 900; letter-spacing: -1px; color: var(--accent); }
        .loaded-name { font-size: 22px; color: var(--accent2); font-weight: 700; }
        .explorer-sub { color: var(--muted); margin-top: 6px; font-size: 14px; }
        .explorer-body { display: grid; grid-template-columns: 1fr 380px; gap: 20px; }
        .config-panel, .mandatory-panel { display: flex; flex-direction: column; gap: 20px; }
        .panel-section { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 22px; box-shadow: 0 2px 12px rgba(35,18,18,0.05); }
        .field-label { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: var(--muted); margin-bottom: 10px; display: block; }
        .field-hint { font-size: 13px; color: var(--muted); margin-bottom: 12px; line-height: 1.6; }
        .url-row { display: flex; gap: 8px; }
        .method-select { background: var(--lavender); color: var(--accent); border: 1px solid var(--border); border-radius: 10px; padding: 11px 14px; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 700; cursor: pointer; }
        .url-input { flex: 1; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 11px 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .url-input:focus { border-color: var(--accent); background: var(--bg2); }
        .tabs { display: flex; gap: 4px; margin-bottom: 14px; background: var(--bg3); border-radius: 10px; padding: 4px; }
        .tab-btn { background: none; border: none; color: var(--muted); padding: 8px 18px; border-radius: 7px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.18s; flex: 1; }
        .tab-btn.active { background: var(--bg2); color: var(--accent); font-weight: 700; box-shadow: 0 1px 4px rgba(35,18,18,0.1); }
        .code-textarea { width: 100%; background: var(--bg3); color: #3d2828; border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; font-family: 'JetBrains Mono', monospace; font-size: 13px; resize: vertical; outline: none; line-height: 1.7; transition: border-color 0.2s; }
        .code-textarea:focus { border-color: var(--accent); background: var(--bg2); }
        .code-textarea.graphql { min-height: 260px; }
        .headers-editor { display: flex; flex-direction: column; gap: 8px; }
        .header-row { display: flex; align-items: center; gap: 8px; }
        .header-input { flex: 1; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; transition: border-color 0.2s; }
        .header-input:focus { border-color: var(--accent); }
        .header-sep { color: var(--muted); font-weight: 700; }
        .key-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; min-height: 36px; }
        .key-tag { display: flex; align-items: center; gap: 6px; background: var(--lavender); border: 1px solid rgba(108,92,231,0.3); color: var(--accent2); border-radius: 100px; padding: 5px 12px; font-family: 'JetBrains Mono', monospace; font-size: 13px; font-weight: 500; }
        .key-tag button { background: none; border: none; color: rgba(108,92,231,0.5); cursor: pointer; font-size: 11px; padding: 0; }
        .key-tag button:hover { color: var(--fail); }
        .add-key-row { display: flex; gap: 8px; }
        .key-input { flex: 1; background: var(--bg3); color: var(--text); border: 1px solid var(--border); border-radius: 10px; padding: 10px 14px; font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; }
        .key-input:focus { border-color: var(--accent); }
        .scenario-preview { display: flex; flex-direction: column; gap: 6px; }
        .scenario-item { font-size: 13px; padding: 9px 14px; border-radius: 8px; font-family: 'JetBrains Mono', monospace; font-weight: 500; }
        .scenario-item.positive { background: rgba(46,125,50,0.08); color: var(--pass); border: 1px solid rgba(46,125,50,0.2); }
        .scenario-item.negative { background: rgba(198,40,40,0.07); color: var(--fail); border: 1px solid rgba(198,40,40,0.18); }
        .btn-run { width: 100%; justify-content: center; padding: 16px; font-size: 16px; border-radius: 100px; }
        .spinner { width: 16px; height: 16px; border: 2px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .save-toast { font-size: 13px; color: var(--pass); font-family: 'JetBrains Mono', monospace; padding: 8px 16px; background: rgba(46,125,50,0.08); border: 1px solid rgba(46,125,50,0.2); border-radius: 100px; }
        .save-badge-saved { font-size: 13px; font-weight: 700; color: var(--pass); font-family: 'JetBrains Mono', monospace; padding: 10px 22px; background: rgba(46,125,50,0.08); border: 1px solid rgba(46,125,50,0.2); border-radius: 100px; display: inline-flex; align-items: center; gap: 6px; }
        .save-badge-saved::before { content: "v"; font-size: 11px; }

        /* SAVED & HISTORY SHARED */
        .saved-page, .history-page { padding: 44px 48px; max-width: 1280px; margin: 0 auto; }
        .page-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; flex-wrap: wrap; gap: 16px; }
        .page-title { font-size: 30px; font-weight: 900; letter-spacing: -1px; color: var(--accent); }
        .page-sub { color: var(--muted); margin-top: 6px; font-size: 14px; }
        .search-input { background: var(--bg2); color: var(--text); border: 1px solid var(--border); border-radius: 100px; padding: 10px 20px; font-family: inherit; font-size: 14px; outline: none; min-width: 260px; transition: border-color 0.2s; box-shadow: 0 1px 4px rgba(35,18,18,0.06); }
        .search-input:focus { border-color: var(--accent); }
        .empty-state { text-align: center; padding: 100px 20px; }
        .empty-icon { font-size: 52px; margin-bottom: 16px; }
        .empty-title { font-size: 22px; font-weight: 700; margin-bottom: 8px; color: var(--accent); }
        .empty-sub { color: var(--muted); font-size: 14px; }

        /* SAVED GRID */
        .saved-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 16px; }
        .saved-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 22px; display: flex; flex-direction: column; gap: 10px; transition: all 0.2s; box-shadow: 0 2px 10px rgba(35,18,18,0.05); }
        .saved-card:hover { border-color: var(--accent2); box-shadow: 0 8px 28px rgba(35,18,18,0.1); transform: translateY(-2px); }
        .saved-card-top { display: flex; justify-content: space-between; align-items: flex-start; }
        .saved-card-info { display: flex; align-items: center; gap: 10px; }
        .saved-name { font-weight: 700; font-size: 16px; color: var(--accent); }
        .saved-url { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .saved-desc { font-size: 13px; color: var(--muted); line-height: 1.5; }
        .saved-meta { font-size: 12px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; }
        .saved-actions { display: flex; gap: 8px; margin-top: 4px; }
        .delete-confirm { background: rgba(198,40,40,0.06); border: 1px solid rgba(198,40,40,0.2); border-radius: 10px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 13px; }
        .method-badge { font-family: 'JetBrains Mono', monospace; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 100px; }
        .method-badge.sm { font-size: 11px; padding: 3px 9px; }

        /* HISTORY */
        .filter-tabs { display: flex; gap: 4px; background: var(--bg3); border-radius: 100px; padding: 4px; }
        .filter-btn { background: none; border: none; color: var(--muted); padding: 6px 16px; border-radius: 100px; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 500; transition: all 0.2s; }
        .filter-btn.active { background: var(--bg2); color: var(--accent); font-weight: 700; box-shadow: 0 1px 4px rgba(35,18,18,0.1); }
        .history-list { display: flex; flex-direction: column; gap: 10px; }
        .history-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 14px; padding: 16px 22px; display: flex; justify-content: space-between; align-items: center; gap: 16px; transition: all 0.2s; box-shadow: 0 1px 6px rgba(35,18,18,0.04); }
        .history-card:hover { border-color: var(--accent); box-shadow: 0 4px 16px rgba(35,18,18,0.08); }
        .history-left { display: flex; align-items: center; gap: 14px; flex: 1; min-width: 0; }
        .history-status-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
        .history-url-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .history-url { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .history-meta { font-size: 12px; color: var(--muted); display: flex; gap: 6px; flex-wrap: wrap; }
        .history-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
        .pass-badge { font-size: 13px; font-weight: 700; color: var(--pass); background: rgba(46,125,50,0.1); padding: 4px 10px; border-radius: 100px; }
        .fail-badge { font-size: 13px; font-weight: 700; color: var(--fail); background: rgba(198,40,40,0.1); padding: 4px 10px; border-radius: 100px; }

        /* REPORT */
        .report-page { padding: 44px 48px; max-width: 1280px; margin: 0 auto; }
        .report-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
        .report-title { font-size: 30px; font-weight: 900; letter-spacing: -1px; color: var(--accent); }
        .report-meta { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--muted); margin-top: 6px; }
        .report-time { font-size: 12px; color: var(--muted); margin-top: 4px; }
        .report-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 28px; }
        .stat-card { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 24px; text-align: center; box-shadow: 0 2px 10px rgba(35,18,18,0.05); }
        .stat-num { font-size: 40px; font-weight: 900; letter-spacing: -2px; }
        .stat-num.total { color: var(--accent); } .stat-num.pass { color: var(--pass); } .stat-num.fail { color: var(--fail); } .stat-num.time { color: var(--accent2); }
        .stat-label { font-size: 11px; color: var(--muted); margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; }
        .report-table { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(35,18,18,0.05); }
        .table-header { display: grid; grid-template-columns: 40px 1fr 200px 80px 80px 60px; gap: 12px; padding: 14px 22px; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); border-bottom: 1px solid var(--border); background: var(--bg3); font-weight: 700; }
        .table-row { display: grid; grid-template-columns: 40px 1fr 200px 80px 80px 60px; gap: 12px; padding: 14px 22px; border-bottom: 1px solid var(--border); align-items: center; font-size: 14px; transition: background 0.15s; }
        .table-row:last-child { border-bottom: none; }
        .table-row:hover { background: var(--bg3); }
        .row-pass { border-left: 3px solid var(--pass); } .row-fail { border-left: 3px solid var(--fail); }
        .row-num { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 13px; }
        .row-label { font-size: 13px; font-weight: 500; }
        .row-body { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .badge { display: inline-block; padding: 5px 12px; border-radius: 100px; font-family: 'JetBrains Mono', monospace; font-size: 12px; font-weight: 700; text-align: center; }
        .badge-pass { background: rgba(46,125,50,0.1); color: var(--pass); } .badge-fail { background: rgba(198,40,40,0.1); color: var(--fail); }
        .row-time { font-family: 'JetBrains Mono', monospace; font-size: 13px; color: var(--accent2); font-weight: 500; }
        .btn-expand { background: none; border: 1px solid var(--border); color: var(--muted); padding: 5px 12px; border-radius: 100px; cursor: pointer; font-size: 11px; transition: all 0.2s; }
        .btn-expand:hover { border-color: var(--accent); color: var(--accent); }
        .row-detail { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 18px 22px; background: var(--bg3); border-bottom: 1px solid var(--border); }
        .detail-label { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); margin-bottom: 8px; font-weight: 700; }
        .detail-pre { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent); background: var(--bg2); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow: auto; max-height: 200px; line-height: 1.7; white-space: pre-wrap; word-break: break-all; }

        /* GLOBAL AUTH PANEL */
        .global-auth-panel { background: var(--bg2); border: 1px solid var(--border); border-radius: 16px; padding: 18px 22px; box-shadow: 0 2px 10px rgba(35,18,18,0.05); display: flex; flex-direction: column; gap: 14px; }
        .global-auth-panel-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; }
        .global-auth-panel-title { font-size: 15px; font-weight: 700; color: var(--accent); display: block; }
        .global-auth-panel-sub { font-size: 12px; color: var(--muted); margin-top: 2px; display: block; }
        .global-auth-fields { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }

        /* Toggle switch */
        .toggle-label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .toggle-input { display: none; }
        .toggle-track { width: 40px; height: 22px; background: var(--border); border-radius: 11px; position: relative; transition: background 0.2s; display: inline-block; flex-shrink: 0; }
        .toggle-input:checked + .toggle-track { background: var(--accent); }
        .toggle-thumb { width: 16px; height: 16px; background: white; border-radius: 50%; position: absolute; top: 3px; left: 3px; transition: left 0.2s; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .toggle-input:checked + .toggle-track .toggle-thumb { left: 21px; }

        /* Auth banner in Explorer */
        .global-auth-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; background: var(--lavender); border: 1px solid rgba(108,92,231,0.25); border-radius: 12px; padding: 14px 20px; margin-bottom: 20px; flex-wrap: wrap; }
        .global-auth-banner.empty { background: var(--bg3); border-color: var(--border); justify-content: flex-start; }
        .global-auth-left { display: flex; align-items: center; gap: 12px; }
        .global-auth-icon { font-size: 18px; }
        .global-auth-label { font-size: 12px; font-weight: 700; color: var(--accent); text-transform: uppercase; letter-spacing: 0.8px; display: block; }
        .global-auth-value { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--accent2); display: block; margin-top: 2px; }
        .auth-checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px; font-weight: 600; color: var(--accent); }
        .auth-checkbox { width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; }

        /* Import/Export toasts */
        .import-toast { padding: 10px 18px; border-radius: 10px; font-size: 13px; font-weight: 500; margin-bottom: 16px; }
        .import-toast.success { background: rgba(46,125,50,0.08); border: 1px solid rgba(46,125,50,0.25); color: var(--pass); }
        .import-toast.error { background: rgba(198,40,40,0.08); border: 1px solid rgba(198,40,40,0.25); color: var(--fail); }
      `}</style>

      <nav className="nav">
        <div className="nav-logo">Tester<span> Helper</span></div>
        <div className="nav-links">
          {navItems.map(n => (
            <button key={n.id} className={`nav-btn ${page === n.id ? "active" : ""}`} onClick={() => {
              if (n.id === "explorer") setExplorerConfig(null); // always open fresh from nav
              setPage(n.id);
            }}>{n.label}</button>
          ))}
        </div>
      </nav>

      {page === "welcome" && <WelcomePage onStart={() => setPage("explorer")} savedCount={savedCount} historyCount={historyCount} />}
      {page === "explorer" && (
        <>
          <div style={{maxWidth:1280,margin:"0 auto",padding:"24px 48px 0"}}>
            <GlobalAuthPanel />
          </div>
          <ExplorerPage onRunTests={handleRunTests} initialConfig={explorerConfig} globalAuth={globalAuth} />
        </>
      )}
      {page === "saved" && <SavedPage onLoad={handleLoadSaved} onRunDirect={handleRunDirect} />}
      {page === "history" && <HistoryPage
          onViewReport={(run) => { setReportData(run); setPage("report"); }}
          onOpenExplorer={(run) => { setExplorerConfig(run); setPage("explorer"); }}
        />}
      {page === "report" && reportData && <ReportPage data={reportData} onBack={() => setPage(page === "report" ? "history" : "explorer")} />}
    </>
  );
}
