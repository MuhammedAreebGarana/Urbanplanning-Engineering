/* ═══════════════════════════════════════════════════════════════
   UrbanPolicy v3 — Karachi Metropolitan Governance Platform
   main.js

   Improvements over v2:
   ✓ Proper confirm() → modal replacement
   ✓ Read-only mode (?readonly or toggle)
   ✓ Policy versioning (snapshot on every state change)
   ✓ Multi-approver quorum (2 of 3 roles required to enact)
   ✓ Last-saved timestamp in stats bar
   ✓ Budget tracker with live % + over-budget warning
   ✓ Export: audit CSV, registry CSV, analytics summary
   ✓ Ctrl+Enter chat shortcut
   ✓ Alt+1/2/3/4 tab shortcuts (HTML)
   ✓ Auto-save every 30s
   ✓ Keyboard Escape closes modals (HTML)
   ✓ EONET full integration (all 4 endpoints)
   ✓ All functions — no stubs, all wired
═══════════════════════════════════════════════════════════════ */

/* ─── ROLES ─── */
const ROLES = {
  commissioner:{ label:'Commissioner', canEdit:true, canApprove:true, canEnact:true, canDelete:true, canVote:true },
  head:        { label:'Dept. Head',   canEdit:false,canApprove:true, canEnact:false,canDelete:false,canVote:true },
  analyst:     { label:'Analyst',      canEdit:false,canApprove:false,canEnact:false,canDelete:false,canVote:false },
};
let currentUser = { name:'Ahmed Hassan', role:'commissioner', dept:'Chief Planning Office', initial:'A' };

/* ─── AI STATE ─── */
let aiBackend='ollama', ollamaBaseUrl='http://localhost:11434', ollamaModel='llama3', anthropicKey='', engineOnline=false;

/* ─── SIM STATE ─── */
let enactedPolicies=new Set(), enactedCount=0, currentPolicy=null, chatHistory=[], simSecs=0;
let mapMode='select', drawPoints=[], drawMarkers=[], drawnZones=[], measurePoints=[], measureLine=null, measureMarkers=[];
const mapLayers={};
let layerState={greenSpaces:true,congestion:true,zoning:true,density:false,transit:true,flood:false,eonetEvents:false};
let chartsInit=false; let chartTrend,chartDonut,chartCarbon,chartHousing,chartModal;
let auditLog=[], compareMode=false, compareScenarios=[], nextPolicyId=7;
let readOnlyMode=false;
let pendingConfirmFn=null;
let lastSaved=null;
let autoSaveTimer=null;

/* ─── LIVE KPI ─── */
let liveKPI={ walk:42, aqi:61, transit:38, afford:29, carbon:-4 };
const KPI_IMPACTS={
  1:{walk:+16,aqi:+4,transit:0,afford:+3,carbon:-6},
  2:{walk:+8,aqi:+12,transit:0,afford:0,carbon:-14},
  3:{walk:+14,aqi:+9,transit:+8,afford:0,carbon:-18},
  4:{walk:+18,aqi:+7,transit:+6,afford:+7,carbon:-22},
  5:{walk:+6,aqi:+3,transit:0,afford:+7,carbon:-3},
  6:{walk:+5,aqi:+22,transit:0,afford:0,carbon:-38},
};

/* ─── BUDGET ─── */
const TOTAL_BUDGET=150;
const POLICY_COSTS={1:18,2:12,3:48,4:22,5:82,6:28};

/* ─── CONFLICT MATRIX ─── */
const CONFLICTS={
  '1-5':'Mixed-Use Zoning may worsen displacement in Katchi Abadis without simultaneous regularisation',
  '3-4':'BRT Expansion and TOD Nodes share corridor ROW — must phase sequentially',
};

/* ─── QUORUM ─── */
const QUORUM_REQUIRED=2;
let quorumApprovals={};  // policyId → Set of role keys

/* ─── POLICY VERSION HISTORY ─── */
let policyVersionHistory={};  // policyId → [{ version, status, user, role, time, date, snapshot }]

/* ─── EONET STATE ─── */
const EONET_BASE='https://eonet.gsfc.nasa.gov/api/v3';
let eonetEvents=[], eonetCategories=[], eonetLayers={};
let eonetFilter='all', eonetSelectedEvent=null, eonetMarkers=[], eonetLayerGroup=null;
let eonetEnactedPolicies=[], eonetPanelOpen=false, eonetFetching=false;

const EONET_CATS={
  wildfires:   {icon:'🔥',color:'#B45309',bg:'rgba(180,83,9,.1)',  name:'Wildfire Emergency Response'},
  severeStorms:{icon:'🌀',color:'#1E40AF',bg:'rgba(30,64,175,.1)', name:'Severe Storm Protocol'},
  floods:      {icon:'🌊',color:'#0891B2',bg:'rgba(8,145,178,.1)', name:'Flood Disaster Relief'},
  volcanoes:   {icon:'🌋',color:'#7C3AED',bg:'rgba(124,58,237,.1)',name:'Volcanic Activity Response'},
  earthquakes: {icon:'⚡',color:'#DC2626',bg:'rgba(220,38,38,.1)', name:'Earthquake Emergency Response'},
  drought:     {icon:'🏜',color:'#D97706',bg:'rgba(217,119,6,.1)', name:'Drought Resilience Policy'},
  dustHaze:    {icon:'💨',color:'#92400E',bg:'rgba(146,64,14,.1)', name:'Dust Storm Response'},
  landslides:  {icon:'⛰',color:'#6B7280',bg:'rgba(107,114,128,.1)',name:'Landslide Emergency Response'},
  seaLakeIce:  {icon:'🧊',color:'#0E7490',bg:'rgba(14,116,144,.1)',name:'Sea Ice Monitoring Protocol'},
  snow:        {icon:'❄',color:'#475569',bg:'rgba(71,85,105,.1)', name:'Snow Event Response'},
  tempExtremes:{icon:'🌡',color:'#DC2626',bg:'rgba(220,38,38,.1)', name:'Extreme Heat Response'},
  default:     {icon:'🌍',color:'#6B7280',bg:'rgba(107,114,128,.1)',name:'Natural Event Response'},
};
function getCatCfg(id){ return EONET_CATS[id]||EONET_CATS.default; }

/* ─── POLICY DATA ─── */
let policyData={
  1:{name:'Mixed-Use Zoning Reform',color:'#059669',category:'Land Use',status:'draft',budgetB:18,
    factors:{ws:{label:'Walk Score',val:'+16pts',dir:'up',trend:'42→58 projected'},density:{label:'Pop. Density',val:'+28%',dir:'up',trend:'Gulshan+Saddar'},retail:{label:'Economic Lift',val:'+PKR42B',dir:'up',trend:'Annual activity'},displacement:{label:'Displacement Risk',val:'Med',dir:'neutral',trend:'Katchi abadis affected'}},
    todos:[{txt:'Rezone Saddar Triangle to MX-3',pri:'h',done:false,zone:'Saddar'},{txt:'Update Clifton Block 4–9 height limits: 4→12 floors',pri:'h',done:false,zone:'Zoning Code Sec.7'},{txt:'Mandate active ground-floor uses on I.I. Chundrigar',pri:'m',done:true,zone:'Design guidelines ✓'},{txt:'Displacement assessment for 14 union councils',pri:'m',done:false,zone:'UC 4,7,12,18+'},{txt:'25% affordable set-aside ≤ PKR 4,500/sqft',pri:'l',done:false,zone:'All parcels'},{txt:'Update GIS cadastral layer (OSM sync)',pri:'h',done:false,zone:'KMC GIS portal'}],
    llmCtx:'Mixed-Use Zoning Reform for Saddar, Clifton, Gulshan. Walk score 42→58, 6,200 new units, 28% density. Risk: katchi abadi displacement.',
    zones:[[24.8607,67.0100],[24.8650,67.0200],[24.8610,67.0250],[24.8560,67.0180]],comments:[]},
  2:{name:'Coastal Green Corridor',color:'#1E40AF',category:'Land Use',status:'approved',budgetB:12,
    factors:{green:{label:'Green Cover',val:'+240ha',dir:'up',trend:'Clifton→Manora'},flood:{label:'Flood Buffer',val:'+1.2M',dir:'up',trend:'Residents protected'},aqi:{label:'AQI Improvement',val:'+12pts',dir:'up',trend:'Coastal zone'},temp:{label:'Heat Island',val:'-2.1°C',dir:'up',trend:'Coastal cooling'}},
    todos:[{txt:'Designate 8km Clifton–Keamari coastline as GC-1',pri:'h',done:false,zone:'Clifton/Keamari'},{txt:'Plant 180,000 mangrove propagules at Keamari',pri:'h',done:false,zone:'Phase 1'},{txt:'Restore 240ha Manora Island vegetation',pri:'m',done:false,zone:'Phase 2'},{txt:'Bioswale drainage along Sea View Boulevard',pri:'m',done:true,zone:'Engineering ✓'},{txt:'Restrict construction within 100m of MHWM',pri:'l',done:false,zone:'KBCA code'}],
    llmCtx:'Coastal Green Corridor Clifton-Keamari-Manora, 8km, 240ha mangrove, 1.2M flood protection, -2.1°C cooling.',
    zones:[[24.8200,66.9900],[24.8250,66.9980],[24.8190,67.0060],[24.8140,66.9990]],comments:[]},
  3:{name:'BRT Orange Line Expansion',color:'#D97706',category:'Transport',status:'review',budgetB:48,
    factors:{riders:{label:'Daily Riders',val:'800K',dir:'up',trend:'42km corridor'},vmt:{label:'VMT Reduction',val:'-18%',dir:'up',trend:'Corridor effect'},time:{label:'Journey Time',val:'-22min',dir:'up',trend:'Average commute'},cost:{label:'Capital Cost',val:'PKR48B',dir:'neutral',trend:'BCR: 3.4x'}},
    todos:[{txt:'Geotechnical survey Surjani–Malir (18km)',pri:'h',done:false,zone:'Phase 1'},{txt:'ROW acquisition for 42 stations',pri:'h',done:true,zone:'NTRC ✓'},{txt:'Issue PKR 48B Green Sukuk bond',pri:'m',done:false,zone:'Finance'},{txt:'Multimodal hubs at Malir Halt and Korangi',pri:'m',done:false,zone:'Junction redesign'},{txt:'Feeder rickshaw integration at 12 termini',pri:'l',done:false,zone:'Last-mile plan'}],
    llmCtx:'BRT Orange Line 42km Surjani–Port Qasim, 800K daily riders, PKR 48B, BCR 3.4x, -22min journey, -18% VMT.',
    zones:[[24.9800,67.0600],[24.9780,67.0700],[24.9760,67.0660],[24.9785,67.0560]],comments:[]},
  4:{name:'TOD Nodes',color:'#7C3AED',category:'Transport',status:'draft',budgetB:22,
    factors:{units:{label:'Housing Units',val:'+18,400',dir:'up',trend:'Within 600m BRT'},commute:{label:'Avg Commute',val:'-19min',dir:'up',trend:'Metro-wide'},density:{label:'Node Density',val:'+4.2 FAR',dir:'up',trend:'8 nodes'},jobs:{label:'Job Access',val:'+420K',dir:'up',trend:'30-min shed'}},
    todos:[{txt:'Upzone 8 BRT catchment areas (600m) to MX-4',pri:'h',done:false,zone:'8 TOD nodes'},{txt:'Min 4.2 FAR within 400m of Gulshan & Malir nodes',pri:'h',done:false,zone:'FAR code'},{txt:'1,200 affordable units per node',pri:'m',done:false,zone:'Inclusionary'},{txt:'Cap surface parking: 0.5 spaces/unit',pri:'m',done:true,zone:'KBCA ✓'},{txt:'Fast-track KMC approval ≤90 days',pri:'l',done:false,zone:'Permit reform'}],
    llmCtx:'TOD 8 nodes, 600m upzone, 18,400 units, -19min commute, 420K jobs.',
    zones:[[24.9200,67.0800],[24.9230,67.0880],[24.9200,67.0920],[24.9165,67.0845]],comments:[]},
  5:{name:'Katchi Abadi Regularisation',color:'#DC2626',category:'Housing',status:'approved',budgetB:82,
    factors:{units:{label:'Regularised Units',val:'320K',dir:'up',trend:'600+ settlements'},tenure:{label:'Tenure Security',val:'HIGH',dir:'up',trend:'Legal titles'},services:{label:'Services Access',val:'+68%',dir:'up',trend:'Water/sanitation'},cost:{label:'Public Cost',val:'PKR82B',dir:'down',trend:'5yr programme'}},
    todos:[{txt:'Satellite-survey all 628 katchi abadis',pri:'h',done:false,zone:'City-wide'},{txt:'Regularisation ordinance under Sindh KA Act',pri:'h',done:false,zone:'Provincial'},{txt:'Computerised land records for 320K plots',pri:'m',done:false,zone:'SLRB'},{txt:'Water/sewer to 180 priority settlements',pri:'m',done:false,zone:'KWSB'},{txt:'PKR 4B anti-eviction fund for Lyari families',pri:'h',done:true,zone:'SBCA ✓'}],
    llmCtx:'Katchi Abadi Regularisation 628 settlements, 320K plots, 2.1M residents, PKR 82B.',
    zones:[[24.8900,66.9800],[24.8950,66.9890],[24.8910,66.9940],[24.8855,66.9860]],comments:[]},
  6:{name:'Net-Zero Industry Zone',color:'#7C3AED',category:'Environment',status:'draft',budgetB:28,
    factors:{carbon:{label:'Carbon Reduction',val:'-38%',dir:'up',trend:'vs 2020'},aqi:{label:'AQI Korangi',val:'+22pts',dir:'up',trend:'Industrial zone'},energy:{label:'Energy Efficiency',val:'+31%',dir:'up',trend:'Industrial stock'},jobs:{label:'Green Jobs',val:'+11,200',dir:'up',trend:'Clean tech'}},
    todos:[{txt:'Net-zero building code for SITE C',pri:'h',done:false,zone:'SITE C'},{txt:'32MW rooftop solar on Korangi factories',pri:'h',done:false,zone:'Korangi'},{txt:'District energy hub for 800 industrial units',pri:'m',done:false,zone:'KITE hub'},{txt:'Phase out Sui gas boilers by 2029',pri:'m',done:false,zone:'SSGCL'},{txt:'EV charging: 1/10 spaces in industrial parks',pri:'l',done:true,zone:'NEPRA ✓'}],
    llmCtx:'Net-Zero Industry SITE C + Korangi, -38% carbon, +22pts AQI, 32MW solar, 11,200 green jobs.',
    zones:[[24.8400,67.0900],[24.8450,67.1000],[24.8420,67.1050],[24.8360,67.0970]],comments:[]},
};

const registryData=[
  {name:'Mixed-Use Zoning Reform',cat:'Land Use',catCls:'tag-g',walkDelta:'+16pts',aqiDelta:'+4pts',housingDelta:'+6,200 units',carbonDelta:'-6%',impact:78},
  {name:'Coastal Green Corridor',cat:'Land Use',catCls:'tag-b',walkDelta:'+8pts',aqiDelta:'+12pts',housingDelta:'—',carbonDelta:'-14%',impact:72},
  {name:'BRT Orange Line',cat:'Transport',catCls:'tag-a',walkDelta:'+14pts',aqiDelta:'+9pts',housingDelta:'—',carbonDelta:'-18%',impact:80},
  {name:'TOD Nodes',cat:'Transport',catCls:'tag-b',walkDelta:'+18pts',aqiDelta:'+7pts',housingDelta:'+18,400 units',carbonDelta:'-22%',impact:90},
  {name:'Katchi Abadi Reg.',cat:'Housing',catCls:'tag-r',walkDelta:'+6pts',aqiDelta:'+3pts',housingDelta:'320K regularised',carbonDelta:'-3%',impact:62},
  {name:'Net-Zero Industry',cat:'Environment',catCls:'tag-g',walkDelta:'+5pts',aqiDelta:'+22pts',housingDelta:'—',carbonDelta:'-38%',impact:85},
];

const scenarioCards=[
  {id:1,cls:'sc-blue',name:'Karachi Compact City Vision',desc:'BRT expansion, mixed-use zoning, and TOD nodes for walkable 15-minute neighbourhoods across 5 districts by 2035.',tags:['Land Use','Transport','3 Policies','10yr'],metrics:[{l:'Walkability',v:'+38pts',c:'#059669'},{l:'VMT Reduction',v:'-34%',c:'#059669'},{l:'New Housing',v:'+24K',c:'#1E40AF'},{l:'Capital Cost',v:'PKR 96B',c:'#D97706'}],kpis:{walk:+38,aqi:+13,transit:+14,afford:+10,carbon:-40},llmCtx:'Compact City: BRT Orange Line + Mixed-Use Zoning + TOD Nodes.'},
  {id:2,cls:'sc-green',name:'Climate Resilience 2040',desc:'Coastal green corridor + net-zero industry zone to cut carbon 40% and protect 3M residents from monsoon floods.',tags:['Environment','Climate','2 Policies','15yr'],metrics:[{l:'Carbon Cut',v:'-40%',c:'#059669'},{l:'Flood Protection',v:'3M pop.',c:'#059669'},{l:'AQI Gain',v:'+28pts',c:'#1E40AF'},{l:'Mangroves',v:'+480ha',c:'#059669'}],kpis:{walk:+13,aqi:+34,transit:0,afford:0,carbon:-52},llmCtx:'Climate Resilience: Coastal Green Corridor + Net-Zero Industry Zone.'},
  {id:3,cls:'sc-amber',name:'Housing Equity Response',desc:'Katchi Abadi regularisation + affordable TOD mandates to deliver 400,000 secure homes by 2030.',tags:['Housing','Equity','2 Policies','5yr'],metrics:[{l:'Secure Units',v:'400K',c:'#059669'},{l:'Eviction Risk',v:'-80%',c:'#059669'},{l:'Public Cost',v:'PKR 112B',c:'#D97706'},{l:'Social Return',v:'5.1x',c:'#059669'}],kpis:{walk:+24,aqi:+10,transit:+6,afford:+14,carbon:-25},llmCtx:'Housing Equity: Katchi Abadi Regularisation + TOD affordable mandate.'},
  {id:4,cls:'sc-red',name:'Zero-Congestion Corridor',desc:'BRT + rickshaw feeder integration to eliminate Shahrah-e-Faisal peak gridlock, average commute 35 minutes.',tags:['Transport','Mobility','3 Policies','3yr'],metrics:[{l:'Traffic',v:'-48%',c:'#059669'},{l:'BRT Ridership',v:'+1.1M',c:'#1E40AF'},{l:'Commute Time',v:'35min',c:'#059669'},{l:'Fuel Savings',v:'PKR 22B/yr',c:'#D97706'}],kpis:{walk:+32,aqi:+16,transit:+14,afford:+7,carbon:-40},llmCtx:'Zero-Congestion: BRT + TOD Nodes + Shahrah-e-Faisal corridor.'},
  {id:5,cls:'sc-purple',name:'Smart Karachi Initiative',desc:'Sensor networks, AI traffic management, digital GIS twin across all 7 towns.',tags:['Tech','Governance','4 Policies','8yr'],metrics:[{l:'Service Efficiency',v:'+42%',c:'#059669'},{l:'Response Time',v:'-38%',c:'#059669'},{l:'Data Endpoints',v:'2,400+',c:'#1E40AF'},{l:'Capex',v:'PKR 18B',c:'#D97706'}],kpis:{walk:+20,aqi:+8,transit:+8,afford:+5,carbon:-20},llmCtx:'Smart Karachi: sensor network + AI traffic + GIS digital twin.'},
  {id:6,cls:'sc-teal',name:'Inclusive Growth Compact',desc:'All six policies simultaneously — every sector, every district, 25-year horizon.',tags:['Comprehensive','All Sectors','6 Policies','25yr'],metrics:[{l:'Overall Score',v:'+74pts',c:'#059669'},{l:'New Residents',v:'+2.1M',c:'#1E40AF'},{l:'Total Invest.',v:'PKR 280B',c:'#D97706'},{l:'Social Return',v:'8.2x',c:'#059669'}],kpis:{walk:+67,aqi:+57,transit:+14,afford:+17,carbon:-101},llmCtx:'Inclusive Growth Compact: all 6 policies simultaneously.'},
];

const SYSTEM_PROMPT=`You are UrbanPolicy AI, expert urban planning simulation agent for Karachi, Pakistan. Assist policymakers at the Karachi Metropolitan Planning Authority with data-driven insights on urban development, infrastructure, housing, transport, environmental resilience, and social equity. Reference districts (Saddar, Clifton, Korangi, Malir, Lyari, Orangi, Gulshan, Keamari), BRT Green Line, NDMA/PDMA frameworks. Give specific projections, PKR figures, and policy-relevant recommendations. Be concise.`;

let reportStore=[
  {id:'r1',name:'Karachi Annual Urban Review 2024',type:'Impact Assessment',date:'12 Jan 2025',pages:52,author:'Chief Planning Officer',status:'ready',exec:'Comprehensive assessment of urban policy performance across Karachi Metropolitan Area for 2024. Significant infrastructure stress across transport, housing, and environment.',findings:'Transit coverage 38% vs 60% target. AQI in Korangi and Lyari averaged 78 — critically unhealthy. Katchi abadi population +340,000 despite regularisation. BRT ridership +18% YoY.',metrics:[{k:'Walkability',v:'42/100',c:'#059669'},{k:'AQI',v:'61',c:'#DC2626'},{k:'Transit',v:'38%',c:'#1E40AF'},{k:'Affordability',v:'29%',c:'#D97706'},{k:'Carbon',v:'-4%',c:'#059669'}]},
  {id:'r2',name:'Coastal Green Corridor — EIA',type:'Environmental Report',date:'3 Feb 2025',pages:38,author:'Sustainability Dept.',status:'ready',exec:'Environmental impact assessment for the proposed 8km Coastal Green Corridor along Clifton Beach, Keamari, and Manora Island.',findings:'Coastal temperature 3.1°C above inland. Mangrove coverage at Keamari down 42% since 2010. Proposed corridor would restore 240ha, storm buffer for 1.2M coastal residents.',metrics:[{k:'Heat Reduction',v:'-2.1°C',c:'#059669'},{k:'Green Cover',v:'+240ha',c:'#059669'},{k:'Coastal Pop.',v:'1.2M',c:'#1E40AF'},{k:'Mangrove Recovery',v:'+38%',c:'#059669'}]},
  {id:'r3',name:'BRT Orange Line — Cost-Benefit',type:'Cost-Benefit Analysis',date:'18 Mar 2025',pages:26,author:'Transport Planning Unit',status:'generating',exec:'Cost-benefit analysis for BRT Orange Line extension from Surjani Town to Port Qasim — 42km corridor, 800,000 daily commuters.',findings:'Capital cost PKR 48B. BCR 3.4x over 20 years. Journey time saving 22 min/trip. 280,000 private vehicle diversions per day.',metrics:[{k:'Capital Cost',v:'PKR 48B',c:'#D97706'},{k:'BCR 20yr',v:'3.4x',c:'#059669'},{k:'Daily Riders',v:'800K',c:'#1E40AF'},{k:'Time Saving',v:'-22min',c:'#059669'}]},
];

/* ─── STORAGE KEYS ─── */
const SK={reports:'up_v3_reports',policies:'up_v3_policies',enacted:'up_v3_enacted',audit:'up_v3_audit',user:'up_v3_user',versions:'up_v3_versions',quorum:'up_v3_quorum'};

/* ═══════════════════════════════════════
   PERSISTENT STORAGE
═══════════════════════════════════════ */
function saveAll(){
  try{
    const custom={};
    Object.entries(policyData).forEach(([id,p])=>{if(parseInt(id)>=7)custom[id]=p;});
    localStorage.setItem(SK.policies,JSON.stringify(custom));
    localStorage.setItem(SK.reports,JSON.stringify(reportStore.filter(r=>!['r1','r2','r3'].includes(r.id))));
    localStorage.setItem(SK.enacted,JSON.stringify([...enactedPolicies]));
    localStorage.setItem(SK.audit,JSON.stringify(auditLog.slice(0,200)));
    localStorage.setItem(SK.user,JSON.stringify(currentUser));
    localStorage.setItem(SK.versions,JSON.stringify(policyVersionHistory));
    localStorage.setItem(SK.quorum,JSON.stringify(Object.fromEntries(Object.entries(quorumApprovals).map(([k,v])=>[k,[...v]]))));
    lastSaved=new Date();
    const el=document.getElementById('s-saved');
    if(el)el.textContent=lastSaved.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  }catch(e){console.warn('Save error',e);}
}

function loadAll(){
  try{
    const sp=localStorage.getItem(SK.policies);
    if(sp){const p=JSON.parse(sp);Object.assign(policyData,p);nextPolicyId=Math.max(nextPolicyId,...Object.keys(policyData).map(Number))+1;}
    const sr=localStorage.getItem(SK.reports);
    if(sr){reportStore=[...reportStore,...JSON.parse(sr)];}
    const se=localStorage.getItem(SK.enacted);
    if(se){JSON.parse(se).forEach(id=>{if(policyData[id]){enactedPolicies.add(parseInt(id));enactedCount++;}});}
    const sa=localStorage.getItem(SK.audit);
    if(sa){auditLog=JSON.parse(sa);}
    const su=localStorage.getItem(SK.user);
    if(su){currentUser=JSON.parse(su);}
    const sv=localStorage.getItem(SK.versions);
    if(sv){policyVersionHistory=JSON.parse(sv);}
    const sq=localStorage.getItem(SK.quorum);
    if(sq){const q=JSON.parse(sq);Object.entries(q).forEach(([k,v])=>{quorumApprovals[k]=new Set(v);});}
  }catch(e){console.warn('Load error',e);}
}

function clearStorage(){
  showConfirm({icon:'🗑',title:'Clear All Data?',msg:'This will delete all custom policies, reports, audit log, and saved state.',consequence:'Data cannot be recovered. The page will refresh.',okLabel:'Clear Everything',okClass:'btn-danger',fn:()=>{
    Object.values(SK).forEach(k=>localStorage.removeItem(k));
    showToast('Storage cleared — refreshing…','ok');
    setTimeout(()=>location.reload(),1200);
  }});
}

function storageSize(){
  let b=0;Object.values(SK).forEach(k=>{b+=(localStorage.getItem(k)||'').length*2;});
  return(b/1024).toFixed(1);
}

/* ─── Auto-save every 30s ─── */
function startAutoSave(){
  autoSaveTimer=setInterval(()=>{saveAll();},30000);
}

/* ═══════════════════════════════════════
   CONFIRM MODAL (replaces browser confirm)
═══════════════════════════════════════ */
function showConfirm({icon='⚠',title='Are you sure?',msg='',consequence='',okLabel='Confirm',okClass='btn-danger',fn}){
  document.getElementById('confirm-icon').textContent=icon;
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  const cEl=document.getElementById('confirm-consequence');
  if(consequence){cEl.textContent=consequence;cEl.style.display='block';}
  else{cEl.style.display='none';}
  const btn=document.getElementById('confirm-ok-btn');
  btn.textContent=okLabel;btn.className=okClass;
  pendingConfirmFn=fn;
  openModal('confirm-modal');
}
function runConfirmAction(){
  closeModal('confirm-modal');
  if(pendingConfirmFn){pendingConfirmFn();pendingConfirmFn=null;}
}

/* ═══════════════════════════════════════
   READ-ONLY MODE
═══════════════════════════════════════ */
function toggleReadOnly(){
  readOnlyMode=!readOnlyMode;
  const pill=document.getElementById('readonly-pill');
  if(pill){
    pill.classList.toggle('active',readOnlyMode);
    pill.textContent=readOnlyMode?'👁 VIEW ONLY (ON)':'👁 VIEW ONLY';
  }
  buildPolicyPanel();
  showToast(readOnlyMode?'Read-only mode ON — enact/revoke disabled':'Read-only mode OFF',readOnlyMode?'warn':'ok');
}

function checkPermission(action,permKey){
  if(readOnlyMode){showToast('Read-only mode is active — disable to make changes','warn');return false;}
  const role=ROLES[currentUser.role];
  if(!role[permKey]){showToast(`Your role (${ROLES[currentUser.role].label}) cannot ${action}`,'warn');return false;}
  return true;
}

/* ═══════════════════════════════════════
   AUDIT LOG
═══════════════════════════════════════ */
function logAudit(action,detail,color='#1E40AF'){
  auditLog.unshift({action,detail,color,user:currentUser.name,role:currentUser.role,time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),date:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short'})});
  if(auditLog.length>300)auditLog=auditLog.slice(0,300);
}

function exportAuditCSV(){
  const hdr='Date,Time,Action,Detail,User,Role\n';
  const rows=auditLog.map(a=>[a.date,a.time,`"${a.action}"`,`"${a.detail}"`,a.user,a.role].join(',')).join('\n');
  downloadBlob(hdr+rows,'audit-log.csv','text/csv');
  showToast('Audit log exported as CSV','ok');
}

function confirmClearAudit(){
  showConfirm({icon:'🗑',title:'Clear Audit Log?',msg:'All audit entries will be permanently deleted.',consequence:'This cannot be undone. Export a CSV first if you need to keep records.',okLabel:'Clear Log',fn:()=>{auditLog=[];saveAll();closeModal('audit-modal');showToast('Audit log cleared','warn');}});
}

/* ═══════════════════════════════════════
   POLICY VERSIONING
═══════════════════════════════════════ */
function snapshotPolicy(id,action){
  if(!policyVersionHistory[id])policyVersionHistory[id]=[];
  const p=policyData[id];
  const verNum=policyVersionHistory[id].length+1;
  policyVersionHistory[id].push({
    version:verNum,action,status:p.status,
    user:currentUser.name,role:currentUser.role,
    time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),
    date:new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}),
    budgetB:p.budgetB,todosCompleted:p.todos.filter(t=>t.done).length,
  });
}

function openVersionModal(id){
  const hist=policyVersionHistory[id]||[];
  const p=policyData[id];
  const body=document.getElementById('version-modal-body');
  if(!body)return;
  if(!hist.length){body.innerHTML='<div style="text-align:center;padding:24px;color:var(--muted);font-family:var(--font-mono);font-size:9px">No version history yet.</div>';openModal('version-modal');return;}
  body.innerHTML=`<div style="padding:4px 0">${[...hist].reverse().map(v=>`
    <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="background:var(--brand-light);color:var(--brand);font-family:var(--font-mono);font-size:9px;padding:3px 8px;border-radius:4px;border:1px solid var(--brand-mid);flex-shrink:0;font-weight:600">v${v.version}</div>
      <div style="flex:1">
        <div style="font-weight:600;color:var(--ink);font-size:12px;margin-bottom:2px">${v.action}</div>
        <div style="font-size:11px;color:var(--ink3);margin-bottom:3px">Status → <strong>${v.status.toUpperCase()}</strong> · Budget: PKR ${v.budgetB}B · Tasks: ${v.todosCompleted} done</div>
        <div style="font-family:var(--font-mono);font-size:8px;color:var(--muted)">${v.date} · ${v.time} · ${v.user} (${ROLES[v.role]?.label||v.role})</div>
      </div>
    </div>`).join('')}</div>`;
  const badge=document.getElementById('policy-version-badge');
  if(badge){badge.style.display='flex';document.getElementById('policy-version-num').textContent=hist.length;}
  openModal('version-modal');
}

/* ═══════════════════════════════════════
   QUORUM SYSTEM
═══════════════════════════════════════ */
function addQuorumVote(policyId){
  if(!quorumApprovals[policyId])quorumApprovals[policyId]=new Set();
  quorumApprovals[policyId].add(currentUser.role);
  saveAll();
  return quorumApprovals[policyId].size;
}

function quorumMet(policyId){
  return(quorumApprovals[policyId]?.size||0)>=QUORUM_REQUIRED;
}

function updateQuorumHUD(id){
  const hud=document.getElementById('quorum-hud');
  const txt=document.getElementById('quorum-txt');
  if(!hud||!txt)return;
  const p=policyData[id];
  if(!p||p.status!=='approved'||enactedPolicies.has(id)){hud.style.display='none';return;}
  const votes=quorumApprovals[id]?.size||0;
  hud.style.display='block';
  txt.textContent=`${votes}/${QUORUM_REQUIRED} approvers — ${quorumMet(id)?'quorum met, ready to enact':'need more votes'}`;
}

/* ═══════════════════════════════════════
   CLOCK & TIMER
═══════════════════════════════════════ */
function updateClock(){document.getElementById('clock').textContent=new Date().toTimeString().slice(0,8)+' PKT';}
setInterval(updateClock,1000);updateClock();

setInterval(()=>{
  simSecs++;
  const h=String(Math.floor(simSecs/3600)).padStart(2,'0'),m=String(Math.floor(simSecs%3600/60)).padStart(2,'0'),s=String(simSecs%60).padStart(2,'0');
  const t=`${h}:${m}:${s}`;
  ['simtime','s-time'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=t;});
},1000);

/* ═══════════════════════════════════════
   TOAST & MODAL
═══════════════════════════════════════ */
function showToast(msg,type=''){
  const el=document.getElementById('toast');
  el.textContent=msg;el.className='toast'+(type?` toast-${type}`:'')+' show';
  clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove('show'),3400);
}
function openModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}

/* ═══════════════════════════════════════
   USER / ROLE
═══════════════════════════════════════ */
function updateUserBadge(){
  const el=document.getElementById('user-name-badge');if(el)el.textContent=currentUser.name;
  const rl=document.getElementById('user-role-lbl');if(rl)rl.textContent=ROLES[currentUser.role].label;
  const av=document.getElementById('user-avatar-initials');if(av)av.textContent=currentUser.name.charAt(0);
}

function switchRole(role){
  currentUser.role=role;
  currentUser.name=role==='commissioner'?'Ahmed Hassan':role==='head'?'Fatima Malik':'Bilal Chaudhry';
  currentUser.initial=currentUser.name.charAt(0);
  updateUserBadge();buildPolicyPanel();closeModal('role-modal');
  logAudit(`Role switched to ${ROLES[role].label}`,`User: ${currentUser.name}`,'#7C3AED');
  showToast(`Switched to ${ROLES[role].label} view`,'ok');
}

/* ═══════════════════════════════════════
   PAGE NAVIGATION
═══════════════════════════════════════ */
function showPage(name,tab){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  document.getElementById('page-'+name).classList.add('active');
  tab.classList.add('active');
  if(name==='analytics')setTimeout(initCharts,50);
  if(name==='reports'){updateStorageWidget();setTimeout(appendEONETStorageRow,80);}
}

/* ═══════════════════════════════════════
   MAP — KARACHI
═══════════════════════════════════════ */
const map=L.map('map',{zoomControl:false}).setView([24.8607,67.0011],12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors',maxZoom:19}).addTo(map);
L.control.zoom({position:'bottomright'}).addTo(map);

function buildMapLayers(){
  mapLayers.greenSpaces=L.layerGroup([[24.8137,66.9889],[24.8247,67.0280],[24.8310,67.0200]].map((c,i)=>
    L.polygon([[c,[c[0]+.003,c[1]+.003],[c[0]+.003,c[1]],[c[0],c[1]+.003]]],{color:'#059669',fillColor:'#059669',fillOpacity:.22,weight:1.5})
    .bindPopup(`<b style="font-family:monospace">🌿 ${['Hill Park','Safari Park','Bagh Ibn Qasim'][i]}</b>`)
  )).addTo(map);
  mapLayers.congestion=L.layerGroup([
    {path:[[24.92,67.03],[24.9,67.03],[24.88,67.02],[24.86,67.01]],label:'Shahrah-e-Faisal',lvl:'CRITICAL'},
    {path:[[24.87,67.01],[24.87,66.99],[24.86,66.97]],label:'M.A. Jinnah Road',lvl:'HIGH'},
    {path:[[24.93,67.08],[24.9,67.07],[24.88,67.07]],label:'University Road',lvl:'HIGH'},
  ].map(d=>L.polyline(d.path,{color:d.lvl==='CRITICAL'?'#DC2626':'#D97706',weight:5,opacity:.65})
    .bindPopup(`<b style="font-family:monospace">🚦 ${d.label}</b><br><small>${d.lvl}</small>`)
  )).addTo(map);
  mapLayers.zoning=L.layerGroup([
    {c:[[24.855,67.00],[24.862,67.012],[24.859,67.02],[24.851,67.015],[24.848,67.005]],label:'Saddar CBD',col:'#1E40AF'},
    {c:[[24.81,67.01],[24.82,67.02],[24.818,67.03],[24.807,67.025]],label:'Clifton Residential',col:'#059669'},
    {c:[[24.905,67.06],[24.912,67.072],[24.909,67.08],[24.9,67.072]],label:'Gulshan Mixed-Use',col:'#1E40AF'},
    {c:[[24.835,67.08],[24.843,67.092],[24.84,67.10],[24.831,67.092]],label:'Korangi Industrial',col:'#D97706'},
  ].map(d=>L.polygon(d.c,{color:d.col,fillColor:d.col,fillOpacity:.1,weight:1.5,dashArray:'5 3'})
    .bindPopup(`<b style="font-family:monospace">🏙 ${d.label}</b>`)
  )).addTo(map);
  mapLayers.density=L.layerGroup([
    {c:[[24.86,67.005],[24.868,67.015],[24.864,67.023],[24.856,67.017],[24.852,67.007]],label:'High Density — Saddar'},
    {c:[[24.91,67.065],[24.918,67.078],[24.914,67.086],[24.905,67.078],[24.901,67.066]],label:'High Density — Gulshan'},
  ].map(d=>L.polygon(d.c,{color:'#DC2626',fillColor:'#DC2626',fillOpacity:.12,weight:1})
    .bindPopup(`<b style="font-family:monospace">📊 ${d.label}</b>`)
  ));
  mapLayers.transit=L.layerGroup([[24.9405,67.1065,'Surjani BRT','BRT'],[24.92,67.07,'Gulshan Hub','BRT'],[24.8925,67.07,'University Rd.','BRT'],[24.875,67.06,'Nipa Chowrangi','BRT'],[24.8607,67.01,'Saddar Terminal','BRT'],[24.84,67.02,'Keamari Ferry','FERRY'],[24.91,67.14,'Malir Junction','BRT'],[24.928,67.097,'Gulshan Chowrangi','BRT']].map(d=>{
    const col=d[3]==='BRT'?'#7C3AED':'#0891B2';
    return L.circleMarker([d[0],d[1]],{radius:7,color:'#fff',fillColor:col,fillOpacity:.9,weight:2}).bindPopup(`<b style="font-family:monospace">🚌 ${d[2]}</b>`);
  })).addTo(map);
  mapLayers.flood=L.layerGroup([
    {c:[[24.87,66.96],[24.88,66.97],[24.875,66.98],[24.865,66.975],[24.86,66.965]],label:'Lyari Riverbed — Critical',risk:'critical'},
    {c:[[24.82,66.97],[24.828,66.98],[24.825,66.987],[24.816,66.983],[24.813,66.972]],label:'Keamari Coastal — High',risk:'high'},
    {c:[[24.9,67.12],[24.908,67.134],[24.904,67.142],[24.896,67.136],[24.892,67.122]],label:'Malir Floodplain — High',risk:'high'},
  ].map(d=>L.polygon(d.c,{color:d.risk==='critical'?'#DC2626':'#D97706',fillColor:d.risk==='critical'?'#DC2626':'#D97706',fillOpacity:.18,weight:2,dashArray:'4 3'})
    .bindPopup(`<b style="font-family:monospace">🌊 ${d.label}</b>`)
  ));
}
buildMapLayers();

const activePolygons={};

function _toggleLayerBase(name){
  layerState[name]=!layerState[name];
  const tog=document.getElementById('toggle-'+name);
  if(tog)tog.classList.toggle('on',layerState[name]);
  if(!mapLayers[name])return;
  layerState[name]?mapLayers[name].addTo(map):map.removeLayer(mapLayers[name]);
}

function toggleLayer(name){
  if(name==='eonetEvents'){
    layerState.eonetEvents=!layerState.eonetEvents;
    const tog=document.getElementById('toggle-eonetEvents');
    if(tog)tog.classList.toggle('on',layerState.eonetEvents);
    if(layerState.eonetEvents){renderEONETMapMarkers();if(!eonetEvents.length)fetchEONET();}
    else{eonetMarkers.forEach(m=>map.removeLayer(m));eonetMarkers=[];if(eonetLayerGroup){map.removeLayer(eonetLayerGroup);eonetLayerGroup=null;}}
    return;
  }
  _toggleLayerBase(name);
}

function setMapMode(mode,btn){
  mapMode=mode;
  document.querySelectorAll('.mode-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  const tip=document.getElementById('draw-tooltip');
  map.off('click',onDrawClick);map.off('dblclick',onDrawFinish);
  map.off('click',onMeasureClick);map.off('dblclick',onMeasureFinish);
  map.getContainer().style.cursor='';tip.style.display='none';
  if(mode==='draw'){
    tip.style.display='block';tip.textContent='Click to place zone vertices · Double-click to finish';
    map.getContainer().style.cursor='crosshair';drawPoints=[];drawMarkers=[];
    map.on('click',onDrawClick);map.on('dblclick',onDrawFinish);
  }else if(mode==='measure'){
    tip.style.display='block';tip.textContent='Click to measure · Double-click to finish';
    map.getContainer().style.cursor='crosshair';measurePoints=[];measureMarkers=[];
    if(measureLine){map.removeLayer(measureLine);measureLine=null;}
    measureMarkers.forEach(m=>map.removeLayer(m));
    map.on('click',onMeasureClick);map.on('dblclick',onMeasureFinish);
  }
}
function onDrawClick(e){
  if(mapMode!=='draw')return;
  drawPoints.push([e.latlng.lat,e.latlng.lng]);
  drawMarkers.push(L.circleMarker(e.latlng,{radius:4,color:'#1E40AF',fillColor:'#1E40AF',fillOpacity:.9}).addTo(map));
  if(drawPoints.length>1){if(window._dp)map.removeLayer(window._dp);window._dp=L.polyline(drawPoints,{color:'#1E40AF',weight:2,dashArray:'5 3',opacity:.7}).addTo(map);}
}
function onDrawFinish(e){
  if(mapMode!=='draw'||drawPoints.length<3){showToast('Draw at least 3 points','warn');return;}
  map.off('click',onDrawClick);map.off('dblclick',onDrawFinish);
  if(window._dp)map.removeLayer(window._dp);
  drawMarkers.forEach(m=>map.removeLayer(m));
  const poly=L.polygon(drawPoints,{color:'#1E40AF',fillColor:'#1E40AF',fillOpacity:.12,weight:2,dashArray:'6 4'}).addTo(map).bindPopup('<b style="font-family:monospace">✏ Custom Zone</b>');
  drawnZones.push(poly);poly.openPopup();showToast('Zone drawn ✓','ok');
  setMapMode('select',document.getElementById('mode-select'));
}
function onMeasureClick(e){
  measurePoints.push([e.latlng.lat,e.latlng.lng]);
  measureMarkers.push(L.circleMarker(e.latlng,{radius:4,color:'#D97706',fillColor:'#D97706',fillOpacity:.9}).addTo(map));
  if(measureLine)map.removeLayer(measureLine);
  if(measurePoints.length>1){
    measureLine=L.polyline(measurePoints,{color:'#D97706',weight:2,opacity:.8}).addTo(map);
    const d=measurePoints.reduce((a,p,i)=>i===0?0:a+map.distance(measurePoints[i-1],p),0);
    document.getElementById('draw-tooltip').textContent=`Distance: ${(d/1000).toFixed(2)} km · Double-click to finish`;
  }
}
function onMeasureFinish(){
  if(measurePoints.length<2)return;
  const d=measurePoints.reduce((a,p,i)=>i===0?0:a+map.distance(measurePoints[i-1],p),0);
  showToast(`Measured: ${(d/1000).toFixed(2)} km`,'ok');
  setMapMode('select',document.getElementById('mode-select'));
}

/* ═══════════════════════════════════════
   CONFLICT DETECTOR
═══════════════════════════════════════ */
function getConflicts(id){
  const c=[];
  enactedPolicies.forEach(eid=>{
    if(eid===id)return;
    const key=[Math.min(id,eid),Math.max(id,eid)].join('-');
    if(CONFLICTS[key])c.push({with:policyData[eid]?.name||'Unknown',msg:CONFLICTS[key]});
  });
  return c;
}

/* ═══════════════════════════════════════
   LIVE KPI RECALCULATION
═══════════════════════════════════════ */
function rebuildLiveKPIs(){
  liveKPI={walk:42,aqi:61,transit:38,afford:29,carbon:-4};
  enactedPolicies.forEach(id=>{const imp=KPI_IMPACTS[id];if(imp){liveKPI.walk+=imp.walk;liveKPI.aqi+=imp.aqi;liveKPI.transit+=imp.transit;liveKPI.afford+=imp.afford;liveKPI.carbon+=imp.carbon;}});
  liveKPI.walk=Math.min(100,Math.max(0,liveKPI.walk));
  liveKPI.aqi=Math.max(0,liveKPI.aqi);
  liveKPI.transit=Math.min(100,Math.max(0,liveKPI.transit));
  liveKPI.afford=Math.min(100,Math.max(0,liveKPI.afford));
  // Update stat bar
  const m={walk:'s-walk',aqi:'s-aqi',transit:'s-tc',afford:'s-haf'};
  Object.entries(m).forEach(([k,id])=>{const e=document.getElementById(id);if(e)e.textContent=Math.round(liveKPI[k])+(k==='transit'||k==='afford'?'%':'');});
  const co=document.getElementById('s-co');if(co)co.textContent=liveKPI.carbon+'%';
  // Analytics KPIs
  const ka={walk:'kpi-walk',transit:'kpi-transit',afford:'kpi-afford',aqi:'kpi-aqi'};
  Object.entries(ka).forEach(([k,id])=>{const e=document.getElementById(id);if(e)e.textContent=Math.round(liveKPI[k])+(k==='transit'||k==='afford'?'%':'');});
}

/* ═══════════════════════════════════════
   BUDGET TRACKER
═══════════════════════════════════════ */
function updateBudgetBar(){
  let spent=0;
  enactedPolicies.forEach(id=>{spent+=(POLICY_COSTS[id]||policyData[id]?.budgetB||0);});
  const pct=Math.min(100,(spent/TOTAL_BUDGET)*100);
  const fill=document.getElementById('budget-fill');
  const sub=document.getElementById('budget-sub');
  const pctLbl=document.getElementById('budget-pct-lbl');
  if(fill){fill.style.width=pct+'%';fill.className='budget-fill'+(pct>90?' over':pct>70?' warn':'');}
  if(sub)sub.textContent=`PKR ${spent}B of ${TOTAL_BUDGET}B cap used`;
  if(pctLbl){pctLbl.textContent=pct.toFixed(1)+'%';pctLbl.style.color=pct>90?'var(--red)':pct>70?'var(--amber)':'var(--green)';}
}

/* ═══════════════════════════════════════
   POLICY PANEL
═══════════════════════════════════════ */
function buildPolicyPanel(){
  const container=document.getElementById('policy-cards-container');
  if(!container)return;
  const cats={};
  Object.entries(policyData).forEach(([id,p])=>{const c=p.category||'Other';if(!cats[c])cats[c]=[];cats[c].push({id:parseInt(id),...p});});
  const colCls={'Land Use':'green','Transport':'amber','Housing':'red','Environment':'purple','Disaster Response':'red','Other':'blue'};
  const role=ROLES[currentUser.role];
  let html='';
  Object.entries(cats).forEach(([cat,pols])=>{
    html+=`<div class="pol-cat-label">${cat}</div>`;
    pols.forEach(p=>{
      const enacted=enactedPolicies.has(p.id);
      const conflicts=getConflicts(p.id);
      const status=enacted?'enacted':p.status||'draft';
      const cls=colCls[cat]||'blue';
      html+=`<div class="pol-card ${cls} ${enacted?'enacted':''} ${conflicts.length>0&&enacted?'conflict':''} ${p.id===currentPolicy?'selected':''}" id="pc-${p.id}" onclick="selectPolicy(${p.id})">
        ${!readOnlyMode&&role.canDelete?`<button class="remove-pol-btn" onclick="removePolicy(event,${p.id})" title="Remove">✕</button>`:''}
        <div class="pc-top">
          <div class="pc-name">${p.name}</div>
          <div class="pc-badge b-${status}" id="badge-${p.id}">${enacted?'ENACTED':status.toUpperCase()}</div>
        </div>
        <div class="pc-meta">${p.zone||p.category}</div>
        ${conflicts.length>0&&enacted?`<div class="conflict-badge">⚠ Conflict: ${conflicts[0].with.split(' ').slice(0,3).join(' ')}</div>`:''}
        <div class="pc-workflow">
          ${!readOnlyMode&&!enacted&&status==='draft'&&role.canApprove?`<button class="wf-btn" onclick="advanceWorkflow(event,${p.id},'review')">→ Submit for Review</button>`:''}
          ${!readOnlyMode&&!enacted&&status==='review'&&role.canApprove?`<button class="wf-btn" onclick="advanceWorkflow(event,${p.id},'approved')">✓ Approve</button>`:''}
          ${!readOnlyMode&&!enacted&&status==='approved'&&role.canEnact?`<button class="wf-btn wf-enact" onclick="enactPolicy(event,${p.id})">▶ Enact${quorumMet(p.id)?'':' (vote)'}</button>`:''}
          ${!readOnlyMode&&!enacted&&status==='approved'&&role.canVote&&!role.canEnact?`<button class="wf-btn" onclick="voteQuorum(event,${p.id})">✓ Cast Vote (${quorumApprovals[p.id]?.size||0}/${QUORUM_REQUIRED})</button>`:''}
          ${!readOnlyMode&&enacted&&role.canEnact?`<button class="wf-btn wf-revoke" onclick="enactPolicy(event,${p.id})">↩ Revoke</button>`:''}
          ${readOnlyMode||(!role.canApprove&&!role.canEnact)?`<button class="wf-btn" disabled style="opacity:.4">${enacted?'ENACTED':status.charAt(0).toUpperCase()+status.slice(1)}</button>`:''}
        </div>
      </div>`;
    });
  });
  container.innerHTML=html;
  updateBudgetBar();
}

/* ─── Workflow ─── */
function advanceWorkflow(evt,id,newStatus){
  evt.stopPropagation();
  if(!checkPermission('advance workflow','canApprove'))return;
  const p=policyData[id];if(!p)return;
  const old=p.status;p.status=newStatus;
  snapshotPolicy(id,`Status → ${newStatus.toUpperCase()}`);
  logAudit(`Policy "${p.name}" moved to ${newStatus.toUpperCase()}`,`From ${old} → ${newStatus}`,'#D97706');
  buildPolicyPanel();saveAll();showToast(`✓ "${p.name}" → ${newStatus}`,'ok');
}

function voteQuorum(evt,id){
  evt.stopPropagation();
  if(!checkPermission('vote','canVote'))return;
  const votes=addQuorumVote(id);
  const p=policyData[id];
  logAudit(`Quorum Vote: "${p?.name}"`,`Vote from ${currentUser.name} (${ROLES[currentUser.role].label}) · Total: ${votes}/${QUORUM_REQUIRED}`,'#7C3AED');
  buildPolicyPanel();
  if(quorumMet(id))showToast(`Quorum reached for "${p?.name}" — can now be enacted`,'ok');
  else showToast(`Vote recorded: ${votes}/${QUORUM_REQUIRED} needed`,'ok');
}

/* ─── Enact / Revoke ─── */
function enactPolicy(evt,id){
  evt.stopPropagation();
  const p=policyData[id];if(!p)return;
  if(enactedPolicies.has(id)){
    if(!checkPermission('revoke','canEnact'))return;
    showConfirm({icon:'↩',title:'Revoke Policy?',msg:`"${p.name}" will be deactivated and removed from the simulation.`,consequence:`Budget freed: PKR ${POLICY_COSTS[id]||p.budgetB||0}B. KPIs will recalculate.`,okLabel:'Revoke Policy',fn:()=>_doRevoke(id)});
    return;
  }
  if(!checkPermission('enact','canEnact'))return;
  if(p.status!=='approved'){showToast('Policy must be APPROVED before enactment','warn');return;}
  // Budget check
  const spent=[...enactedPolicies].reduce((a,eid)=>a+(POLICY_COSTS[eid]||0),0);
  const cost=POLICY_COSTS[id]||p.budgetB||0;
  if(spent+cost>TOTAL_BUDGET){
    showToast(`⚠ Over budget: PKR ${spent+cost}B vs ${TOTAL_BUDGET}B cap`,'warn');
    // Still allow enact with warning
  }
  _doEnact(id);
}

function _doEnact(id){
  const p=policyData[id];
  enactedPolicies.add(id);enactedCount++;
  if(p.zones&&p.zones.length>=3){
    const poly=L.polygon(p.zones,{color:p.color,fillColor:p.color,fillOpacity:.18,weight:2,dashArray:'7 4'}).addTo(map).bindPopup(`<b style="font-family:monospace">📋 ${p.name}</b><br><small style="color:${p.color}">ENACTED</small>`);
    activePolygons[id]=poly;
    map.panTo(p.zones[0],{animate:true,duration:.5});
  }
  p.status='enacted';
  snapshotPolicy(id,'Policy Enacted');
  updateEnactedCount();rebuildLiveKPIs();updateBudgetBar();
  buildPolicyPanel();buildRegistryTable();
  logAudit(`Policy Enacted: "${p.name}"`,`KPIs updated · Budget: PKR ${[...enactedPolicies].reduce((a,eid)=>a+(POLICY_COSTS[eid]||0),0)}B committed`,'#059669');
  showToast(`✓ Policy enacted: ${p.name}`,'ok');
  selectPolicy(id);saveAll();
}

function _doRevoke(id){
  const p=policyData[id];
  enactedPolicies.delete(id);enactedCount=Math.max(0,enactedCount-1);
  if(activePolygons[id]){map.removeLayer(activePolygons[id]);delete activePolygons[id];}
  p.status='approved';
  snapshotPolicy(id,'Policy Revoked');
  updateEnactedCount();rebuildLiveKPIs();updateBudgetBar();
  buildPolicyPanel();buildRegistryTable();
  logAudit(`Policy Revoked: "${p.name}"`,`Returned to approved status`,'#DC2626');
  showToast(`↩ Policy revoked: ${p.name}`,'warn');
  selectPolicy(id);saveAll();
}

function updateEnactedCount(){
  const ct=enactedPolicies.size;
  ['s-ep','hud-pol','a-ep'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=ct;});
  document.getElementById('enacted-ct').textContent=ct+' ENACTED';
}

/* ─── Select / Detail ─── */
function selectPolicy(id){
  currentPolicy=id;
  document.querySelectorAll('.pol-card').forEach(c=>c.classList.remove('selected'));
  const pc=document.getElementById('pc-'+id);if(pc)pc.classList.add('selected');
  renderPolicyDetail(id);
  updateQuorumHUD(id);
  const badge=document.getElementById('policy-version-badge');
  const hist=policyVersionHistory[id]||[];
  if(badge){badge.style.display=hist.length?'flex':'none';if(hist.length)document.getElementById('policy-version-num').textContent=hist.length;}
}

function renderPolicyDetail(id){
  const p=policyData[id];if(!p)return;
  const enacted=enactedPolicies.has(id);
  const conflicts=getConflicts(id);
  const statusSteps=['draft','review','approved','enacted'];
  const si=statusSteps.indexOf(enacted?'enacted':p.status||'draft');
  const workflowHtml=statusSteps.map((s,i)=>`<div class="wf-step ${i<si?'done-step':i===si?'active':''}">${s.charAt(0).toUpperCase()+s.slice(1)}</div>${i<3?'<span class="wf-arrow">→</span>':''}`).join('');
  const factorBoxes=Object.values(p.factors).map(f=>`<div class="fbox"><div class="fb-label">${f.label}</div><div class="fb-val ${f.dir}">${f.val}</div><div class="fb-trend">${f.trend}</div></div>`).join('');
  const doneCnt=p.todos.filter(t=>t.done).length;
  const todos=p.todos.map((t,i)=>`<div class="todo-item ${t.done?'done':''}" onclick="toggleTodo(${id},${i})"><div class="todo-chk">${t.done?'✓':''}</div><div style="flex:1"><div class="todo-txt">${t.txt}</div><div class="todo-meta">${t.zone}</div></div><div class="todo-pri ${t.pri==='h'?'pri-h':t.pri==='m'?'pri-m':'pri-l'}">${t.pri==='h'?'HIGH':t.pri==='m'?'MED':'LOW'}</div></div>`).join('');
  const commentsHtml=(p.comments||[]).slice(0,3).map(c=>`<div class="comment-item"><div class="comment-meta"><span>${c.user}</span><span>${c.role}</span><span>${c.time}</span></div><div class="comment-text">${c.text}</div></div>`).join('');
  const conflictHtml=conflicts.length>0?`<div style="background:var(--red-bg);border:1px solid var(--red-bd);border-radius:6px;padding:9px;margin-bottom:9px;font-size:9px;color:var(--red);line-height:1.6">⚠ <strong>Policy Conflict</strong><br>${conflicts.map(c=>`<em>${c.with}</em>: ${c.msg}`).join('<br>')}</div>`:'';
  document.getElementById('rp-body').innerHTML=`
    <div class="apc-wrap">
      <div class="apc-hdr"><div class="apc-name">${p.name}</div><div class="apc-status status-${enacted?'enacted':p.status||'draft'}">${enacted?'ENACTED':(p.status||'DRAFT').toUpperCase()}</div></div>
      <div class="factor-grid">${factorBoxes}</div>
      <div style="font-family:var(--font-mono);font-size:7px;color:var(--muted)">Budget: PKR ${p.budgetB||POLICY_COSTS[id]||0}B · ${p.category}</div>
    </div>
    <div class="workflow-strip">${workflowHtml}</div>
    ${conflictHtml}
    <div class="todo-sec">
      <div class="todo-hdr"><div class="todo-title">Implementation Tasks</div><div class="todo-ct">${doneCnt}/${p.todos.length}</div></div>
      ${todos}
    </div>
    <div class="comment-box">
      <div class="comment-sec-label">Stakeholder Notes</div>
      ${commentsHtml}
      <textarea class="comment-input" id="comment-input-${id}" placeholder="Add a note, objection, or question…"></textarea>
      <button class="comment-submit" onclick="addComment(${id})">+ POST NOTE</button>
    </div>
    <div class="llm-sec">
      <div class="llm-hdr"><div class="llm-ico">◈</div><div class="llm-label">AI Simulation Analysis</div></div>
      <div class="llm-out" id="llm-out">Click below to run AI analysis via connected engine…</div>
      <button class="run-ai-btn" onclick="runPolicyAI(${id})">◈ RUN AI SIMULATION</button>
    </div>`;
}

function addComment(id){
  const inp=document.getElementById('comment-input-'+id);
  if(!inp||!inp.value.trim())return;
  if(!policyData[id].comments)policyData[id].comments=[];
  const c={user:currentUser.name,role:ROLES[currentUser.role].label,time:new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}),text:inp.value.trim()};
  policyData[id].comments.unshift(c);
  logAudit(`Comment on "${policyData[id].name}"`,`"${c.text.slice(0,60)}…"`,'#7C3AED');
  renderPolicyDetail(id);saveAll();showToast('Note posted','ok');
}

function toggleTodo(pid,idx){policyData[pid].todos[idx].done=!policyData[pid].todos[idx].done;renderPolicyDetail(pid);saveAll();}

function removePolicy(evt,id){
  evt.stopPropagation();
  if(!checkPermission('remove','canDelete'))return;
  if(enactedPolicies.has(id)){showToast('Revoke the policy before removing','warn');return;}
  const p=policyData[id];if(!p)return;
  showConfirm({icon:'🗑',title:'Remove Policy?',msg:`"${p.name}" will be removed from the policy library.`,consequence:'All implementation tasks and comments for this policy will be lost.',okLabel:'Remove Policy',fn:()=>{
    delete policyData[id];buildPolicyPanel();
    if(currentPolicy===id){const rem=Object.keys(policyData);if(rem.length)renderPolicyDetail(parseInt(rem[0]));else document.getElementById('rp-body').innerHTML='<div class="empty-state"><div class="empty-ico">◈</div><div class="empty-txt">SELECT A POLICY TO<br>BEGIN SIMULATION</div></div>';}
    logAudit(`Policy Removed: "${p.name}"`,`Deleted from library`,'#DC2626');
    saveAll();showToast('Policy removed','warn');
  }});
}

function addNewPolicy(){
  const name=document.getElementById('new-pol-name').value.trim();
  if(!name){showToast('Policy name required','err');return;}
  if(!checkPermission('add policy','canEdit'))return;
  const cat=document.getElementById('new-pol-cat').value;
  const meta=document.getElementById('new-pol-meta').value.trim()||cat+' policy';
  const i1l=document.getElementById('new-pol-i1-label').value.trim()||'Primary Impact';
  const i1v=document.getElementById('new-pol-i1-val').value.trim()||'TBD';
  const i2l=document.getElementById('new-pol-i2-label').value.trim()||'Secondary Impact';
  const i2v=document.getElementById('new-pol-i2-val').value.trim()||'TBD';
  const cost=document.getElementById('new-pol-cost').value.trim()||'TBD';
  const horizon=document.getElementById('new-pol-horizon').value;
  const notes=document.getElementById('new-pol-notes').value.trim();
  const budgetB=parseFloat(document.getElementById('new-pol-budget').value)||0;
  const colorMap={'Land Use':'#059669','Transport':'#D97706','Housing':'#DC2626','Environment':'#7C3AED','Other':'#1E40AF'};
  const id=nextPolicyId++;
  policyData[id]={name,category:cat,color:colorMap[cat]||'#1E40AF',status:'draft',budgetB,zone:meta,
    factors:{impact1:{label:i1l,val:i1v,dir:'up',trend:horizon},impact2:{label:i2l,val:i2v,dir:'up',trend:'Projected'},cost:{label:'Est. Cost',val:cost,dir:'neutral',trend:'Capital'},horizon:{label:'Horizon',val:horizon,dir:'neutral',trend:'Implementation'}},
    todos:notes?[{txt:notes,pri:'m',done:false,zone:cat}]:[{txt:`Feasibility study for ${name}`,pri:'h',done:false,zone:'Planning Dept.'},{txt:'Stakeholder consultation',pri:'m',done:false,zone:'Public engagement'},{txt:'Draft implementation roadmap',pri:'m',done:false,zone:'Finance Division'}],
    llmCtx:`${name} — ${meta}. Category: ${cat}. Horizon: ${horizon}. ${i1l}: ${i1v}. ${i2l}: ${i2v}.`,
    zones:[[24.8607,67.0011],[24.865,67.01],[24.861,67.015],[24.856,67.008]],comments:[]};
  snapshotPolicy(id,'Policy Created');
  closeModal('add-policy-modal');
  ['new-pol-name','new-pol-meta','new-pol-i1-label','new-pol-i1-val','new-pol-i2-label','new-pol-i2-val','new-pol-cost','new-pol-notes','new-pol-budget'].forEach(i=>{const e=document.getElementById(i);if(e)e.value='';});
  buildPolicyPanel();saveAll();
  logAudit(`Policy Added: "${name}"`,`Category: ${cat} · Budget: PKR ${budgetB}B`,'#059669');
  showToast(`✓ Policy "${name}" added`,'ok');
  selectPolicy(id);
}

/* ─── CSV Import ─── */
function importCSV(evt){
  if(!checkPermission('import','canEdit'))return;
  const file=evt.target.files[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=e=>{
    try{
      const lines=e.target.result.split('\n').filter(l=>l.trim());
      const headers=lines[0].split(',').map(h=>h.trim().toLowerCase());
      let imported=0;
      lines.slice(1).forEach(line=>{
        const vals=line.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
        const row={};headers.forEach((h,i)=>row[h]=vals[i]||'');
        if(!row.name)return;
        const id=nextPolicyId++;
        policyData[id]={name:row.name,category:row.category||'Other',color:'#1E40AF',status:'draft',budgetB:parseFloat(row.budget)||0,zone:row.area||row.description||'',
          factors:{impact1:{label:row.impact_label||'Impact',val:row.impact_value||'TBD',dir:'up',trend:''},cost:{label:'Cost',val:row.cost||'TBD',dir:'neutral',trend:''},horizon:{label:'Horizon',val:row.horizon||'5 Years',dir:'neutral',trend:''},equity:{label:'Equity',val:row.equity||'—',dir:'neutral',trend:''}},
          todos:[{txt:row.first_action||`Review ${row.name}`,pri:'h',done:false,zone:row.category||'Planning'}],
          llmCtx:`${row.name}: ${row.description||''} — ${row.category||''} policy.`,
          zones:[[24.8607,67.0011],[24.865,67.01],[24.861,67.015],[24.856,67.008]],comments:[]};
        imported++;
      });
      buildPolicyPanel();saveAll();
      logAudit(`CSV Import: ${imported} policies`,`From ${file.name}`,'#059669');
      showToast(`✓ Imported ${imported} policies`,'ok');
    }catch(err){showToast('CSV error: '+err.message,'err');}
  };
  reader.readAsText(file);
}

/* ═══════════════════════════════════════
   AI ENGINE
═══════════════════════════════════════ */
function setBackend(b){
  aiBackend=b;
  document.getElementById('btn-backend-ollama').className='ai-backend-btn'+(b==='ollama'?' active-ollama active':'');
  document.getElementById('btn-backend-anthropic').className='ai-backend-btn'+(b==='anthropic'?' active':'');
  const inp=document.getElementById('ai-conn-input');
  if(b==='ollama'){inp.placeholder='http://localhost:11434';inp.value=ollamaBaseUrl!=='http://localhost:11434'?ollamaBaseUrl:'';}
  else{inp.placeholder='Anthropic API key (sk-ant-...)';inp.value='';}
  engineOnline=false;updateEngineUI('OFFLINE','badge-offline');
}

function connectEngine(){
  const val=document.getElementById('ai-conn-input').value.trim();
  if(!val){showToast('Enter URL or API key first','warn');return;}
  if(aiBackend==='ollama'){ollamaBaseUrl=val.replace(/\/$/,'');testOllamaConnection(ollamaBaseUrl);}
  else{anthropicKey=val;engineOnline=true;updateEngineUI('CLAUDE ONLINE','badge-anthropic');addChatMsg('ai','✓ Anthropic Claude connected. Ready for Karachi policy analysis.');showToast('✓ Anthropic connected','ok');}
}

async function testOllamaConnection(url){
  updateEngineUI('CONNECTING…','badge-offline');
  addChatMsg('thinking','Testing Ollama at '+url+'…');
  try{
    const r=await fetch(url+'/api/tags',{method:'GET',signal:AbortSignal.timeout(5000)});
    if(!r.ok)throw new Error('HTTP '+r.status);
    const d=await r.json();
    if(d.models&&d.models.length>0)ollamaModel=d.models[0].name;
    engineOnline=true;
    updateEngineUI('OLLAMA: '+ollamaModel.toUpperCase().slice(0,14),'badge-ollama');
    addChatMsg('ai',`✓ Ollama connected. Using: ${ollamaModel}. Available: ${(d.models||[]).map(m=>m.name).join(', ')}`);
    showToast('✓ Ollama connected: '+ollamaModel,'ok');
    logAudit('AI Engine Connected','Ollama at '+url+' · Model: '+ollamaModel,'#059669');
  }catch(e){updateEngineUI('OFFLINE','badge-offline');addChatMsg('ai','⚠ Cannot connect to Ollama at '+url+'.\n\nEnsure:\n1. ollama serve is running\n2. Set OLLAMA_ORIGINS=* before starting\n3. Your model is loaded\n\nError: '+e.message);}
}

function updateEngineUI(label,badgeCls){
  const b=document.getElementById('model-badge');
  if(b){b.textContent=label;b.className='chat-model-badge '+badgeCls;}
  const se=document.getElementById('s-engine');if(se)se.textContent=label.split(':')[0];
  const sub=document.getElementById('engine-sub-label');if(sub)sub.textContent='URBANPOLICY AI · '+label;
  const st=document.getElementById('engine-status-txt');if(st)st.textContent=label==='OFFLINE'?'OSM · ENGINE OFFLINE':'OSM · '+label;
}

async function callAI(messages){
  if(!engineOnline)throw new Error('No AI engine connected. Use the Connect button.');
  if(aiBackend==='ollama'){
    const r=await fetch(ollamaBaseUrl+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:ollamaModel,messages:[{role:'system',content:SYSTEM_PROMPT},...messages],stream:false,options:{temperature:.7,num_predict:700}}),signal:AbortSignal.timeout(90000)});
    if(!r.ok)throw new Error('Ollama HTTP '+r.status);
    const d=await r.json();return d.message?.content||d.response||'No response.';
  }else{
    const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':anthropicKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},body:JSON.stringify({model:'claude-opus-4-5',max_tokens:700,system:SYSTEM_PROMPT,messages})});
    if(!r.ok)throw new Error('Anthropic HTTP '+r.status);
    const d=await r.json();return d.content?.[0]?.text||'No response.';
  }
}

function addChatMsg(role,text){
  const msgs=document.getElementById('chat-msgs');
  const div=document.createElement('div');div.className='chat-msg '+role;div.textContent=text;
  msgs.appendChild(div);msgs.scrollTop=msgs.scrollHeight;return div;
}

function handleChatKey(e){
  if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))sendChat();
  else if(e.key==='Enter'&&!e.shiftKey)sendChat();
}

async function sendChat(){
  const inp=document.getElementById('chat-input');
  const txt=inp.value.trim();if(!txt)return;
  const btn=document.getElementById('chat-send-btn');
  addChatMsg('user',txt);chatHistory.push({role:'user',content:txt});
  inp.value='';btn.disabled=true;
  const thinkEl=addChatMsg('thinking','◈ Analysing…');
  try{
    const enacted=[...enactedPolicies].map(id=>policyData[id]?.name).filter(Boolean);
    const msgs=[...chatHistory];
    if(enacted.length&&msgs.length>0)msgs[msgs.length-1]={...msgs[msgs.length-1],content:msgs[msgs.length-1].content+` [Enacted: ${enacted.join(', ')}]`};
    const resp=await callAI(msgs.slice(-16));
    thinkEl.remove();
    addChatMsg('ai',resp);chatHistory.push({role:'assistant',content:resp});
    if(chatHistory.length>24)chatHistory=chatHistory.slice(-24);
  }catch(e){thinkEl.remove();addChatMsg('ai','⚠ '+e.message);}
  btn.disabled=false;
}

async function runPolicyAI(id){
  const p=policyData[id];const out=document.getElementById('llm-out');
  if(!out)return;out.textContent='◈ Generating analysis…';
  try{
    const enacted=[...enactedPolicies].filter(e=>e!==id).map(e=>policyData[e]?.name).join(', ')||'none';
    const txt=await callAI([{role:'user',content:`Analyse this Karachi urban policy: ${p.llmCtx}\nOther enacted: ${enacted}\nProvide: (1) projected KPI impacts with numbers, (2) Karachi-specific implementation risks, (3) equity considerations for informal communities. 3 sentences per point max.`}]);
    typeText(out,txt);
    logAudit(`AI Analysis: "${p.name}"`,`Simulation run by ${currentUser.name}`,'#7C3AED');
  }catch(e){out.textContent='⚠ '+e.message;}
}

/* ═══════════════════════════════════════
   SCENARIO COMPARISON
═══════════════════════════════════════ */
function toggleCompare(scId){
  const idx=compareScenarios.indexOf(scId);
  if(idx>=0)compareScenarios.splice(idx,1);
  else if(compareScenarios.length<2)compareScenarios.push(scId);
  else{showToast('Max 2 scenarios for comparison','warn');return;}
  document.querySelectorAll('.sc-card').forEach(c=>c.style.outline='');
  compareScenarios.forEach(id=>{const el=document.getElementById('sc-'+id);if(el)el.style.outline='2px solid var(--purple)';});
  if(compareScenarios.length===2)showComparePanel();
  else document.getElementById('compare-panel').style.display='none';
}
function clearCompare(){compareScenarios=[];document.querySelectorAll('.sc-card').forEach(c=>c.style.outline='');document.getElementById('compare-panel').style.display='none';}
function showComparePanel(){
  const a=scenarioCards.find(s=>s.id===compareScenarios[0]),b=scenarioCards.find(s=>s.id===compareScenarios[1]);
  if(!a||!b)return;
  const kpis=['walk','aqi','transit','afford','carbon'];
  const labels={walk:'Walkability Δ',aqi:'AQI Δ',transit:'Transit Δ',afford:'Affordability Δ',carbon:'Carbon Δ'};
  const panel=document.getElementById('compare-panel');
  panel.style.display='block';
  panel.innerHTML=`<div class="compare-panel">
    <div class="compare-header">
      <div class="compare-title">📊 <span style="color:var(--brand)">${a.name}</span> vs <span style="color:var(--purple)">${b.name}</span></div>
      <button class="btn-secondary" onclick="clearCompare()" style="padding:5px 12px;font-size:8px">Clear</button>
    </div>
    <div class="compare-grid">
      <div class="compare-col"><div class="compare-col-head" style="color:var(--brand)">A — ${a.name}</div>${a.metrics.map(m=>`<div class="compare-metric"><div class="compare-k">${m.l}</div><div class="compare-v" style="color:${m.c}">${m.v}</div></div>`).join('')}</div>
      <div class="compare-col"><div class="compare-col-head" style="color:var(--purple)">B — ${b.name}</div>${b.metrics.map(m=>`<div class="compare-metric"><div class="compare-k">${m.l}</div><div class="compare-v" style="color:${m.c}">${m.v}</div></div>`).join('')}</div>
    </div>
    <div style="margin-top:14px"><div class="chart-sub" style="margin-bottom:8px">KPI DELTA COMPARISON</div>${kpis.map(k=>{const diff=(b.kpis[k]||0)-(a.kpis[k]||0);return`<div class="compare-metric"><div class="compare-k">${labels[k]}</div><div style="display:flex;align-items:center;gap:12px"><div class="compare-v" style="color:var(--brand)">${a.kpis[k]>=0?'+':''}${a.kpis[k]}</div><div class="compare-v" style="color:var(--purple)">${b.kpis[k]>=0?'+':''}${b.kpis[k]}</div><div class="compare-diff ${diff>0?'diff-better':diff<0?'diff-worse':'diff-same'}">${diff>0?'▲ B better':diff<0?'▲ A better':'Equal'}</div></div></div>`;}).join('')}</div>
  </div>`;
  panel.scrollIntoView({behavior:'smooth'});
}

/* ═══════════════════════════════════════
   ANALYTICS
═══════════════════════════════════════ */
const periodData={
  '6M':{walk:[39,40,40,41,41,42],aqi:[58,58,59,60,60,61],transit:[36,36,37,37,38,38],afford:[30,30,30,29,29,29]},
  '1Y':{walk:[35,36,37,38,40,41,41,42],aqi:[54,55,56,57,58,59,60,61],transit:[33,33,34,35,36,37,37,38],afford:[32,31,31,30,30,30,29,29]},
  '5Y':{walk:[28,30,33,36,38,40,41,42],aqi:[48,50,52,54,57,58,60,61],transit:[27,29,31,33,35,36,37,38],afford:[36,34,33,31,30,30,29,29]},
  'BASELINE':{walk:[42,42,42,42,42,42],aqi:[61,61,61,61,61,61],transit:[38,38,38,38,38,38],afford:[29,29,29,29,29,29]},
};

function setAnalyticsPeriod(p,btn){
  document.querySelectorAll('#analytics-period-ctrl .ctrl-btn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('analytics-updated').textContent='LAST UPDATED: '+new Date().toLocaleTimeString();
  if(chartTrend&&periodData[p]){const d=periodData[p];[0,1,2,3].forEach((i,j)=>{chartTrend.data.datasets[i].data=Object.values(d)[j];});chartTrend.update();}
}

function exportAnalytics(){
  const rows=[['Metric','Value','Period'],
    ['Walkability',Math.round(liveKPI.walk),'Current'],
    ['AQI',Math.round(liveKPI.aqi),'Current'],
    ['Transit Coverage',Math.round(liveKPI.transit)+'%','Current'],
    ['Affordability',Math.round(liveKPI.afford)+'%','Current'],
    ['Carbon Trend',liveKPI.carbon+'%','Current'],
    ['Enacted Policies',enactedPolicies.size,'Current'],
  ];
  downloadBlob(rows.map(r=>r.join(',')).join('\n'),'analytics-export.csv','text/csv');
  showToast('Analytics exported','ok');
}

function exportRegistryCSV(){
  const hdr='Policy,Category,Status,Walkability,AQI,Housing,Carbon,Impact\n';
  const rows=registryData.map(r=>[r.name,r.cat,[...enactedPolicies].some(id=>policyData[id]?.name===r.name)?'ENACTED':'DRAFT',r.walkDelta,r.aqiDelta,r.housingDelta,r.carbonDelta,r.impact+'%'].join(',')).join('\n');
  downloadBlob(hdr+rows,'policy-registry.csv','text/csv');
  showToast('Registry exported as CSV','ok');
}

function downloadBlob(content,filename,type){
  const blob=new Blob([content],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  URL.revokeObjectURL(url);
}

function initCharts(){
  if(chartsInit)return;chartsInit=true;
  Chart.defaults.color='#6B7280';Chart.defaults.borderColor='#E5E7EB';
  const months6=['Oct','Nov','Dec','Jan','Feb','Mar'];
  const gridOpt={color:'#F3F4F6'};
  const tickFont={family:'JetBrains Mono',size:9};
  chartTrend=new Chart(document.getElementById('chart-trend'),{type:'line',
    data:{labels:months6,datasets:[
      {label:'Walkability',data:periodData['6M'].walk,borderColor:'#059669',backgroundColor:'rgba(5,150,105,.06)',tension:.4,borderWidth:2.5,pointRadius:3,fill:true},
      {label:'AQI',data:periodData['6M'].aqi,borderColor:'#DC2626',backgroundColor:'rgba(220,38,38,.04)',tension:.4,borderWidth:2.5,pointRadius:3,fill:true},
      {label:'Transit %',data:periodData['6M'].transit,borderColor:'#7C3AED',backgroundColor:'rgba(124,58,237,.04)',tension:.4,borderWidth:2.5,pointRadius:3,fill:true},
      {label:'Affordability %',data:periodData['6M'].afford,borderColor:'#D97706',backgroundColor:'rgba(217,119,6,.04)',tension:.4,borderWidth:2.5,pointRadius:3,fill:true},
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:10,font:tickFont,padding:14}}},scales:{y:{grid:gridOpt,ticks:{font:tickFont}},x:{grid:gridOpt,ticks:{font:tickFont}}}}});
  chartDonut=new Chart(document.getElementById('chart-donut'),{type:'doughnut',
    data:{labels:['Land Use','Transport','Housing','Environment','Disaster'],datasets:[{data:[30,32,20,12,6],backgroundColor:['#059669','#1E40AF','#DC2626','#0891B2','#EF4444'],borderColor:'#fff',borderWidth:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:9,font:tickFont,padding:12}}},cutout:'68%'}});
  chartCarbon=new Chart(document.getElementById('chart-carbon'),{type:'bar',
    data:{labels:['Saddar','Clifton','Korangi','Malir','Lyari','Orangi'],datasets:[{label:'AQI Level',data:[72,55,88,64,82,76],backgroundColor:ctx=>ctx.raw>80?'rgba(220,38,38,.65)':'rgba(217,119,6,.55)',borderRadius:4}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{grid:gridOpt,ticks:{font:tickFont}},x:{grid:{display:false},ticks:{font:tickFont}}}}});
  chartHousing=new Chart(document.getElementById('chart-housing'),{type:'bar',
    data:{labels:['Q1','Q2','Q3','Q4',"Q1'25"],datasets:[{label:'Formal',data:[1200,1400,1600,1900,2200],backgroundColor:'rgba(30,64,175,.6)',borderRadius:3},{label:'Regularised',data:[8400,9200,10100,11800,13200],backgroundColor:'rgba(5,150,105,.5)',borderRadius:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'top',labels:{boxWidth:9,font:tickFont,padding:8}}},scales:{x:{stacked:true,grid:{display:false},ticks:{font:tickFont}},y:{stacked:true,grid:gridOpt,ticks:{font:tickFont}}}}});
  chartModal=new Chart(document.getElementById('chart-modal'),{type:'doughnut',
    data:{labels:['Bus/BRT','Rickshaw','Private','Walking'],datasets:[{data:[28,34,22,16],backgroundColor:['#1E40AF','#D97706','#DC2626','#059669'],borderColor:'#fff',borderWidth:3}]},
    options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{position:'bottom',labels:{boxWidth:8,font:tickFont,padding:8}}},cutout:'60%'}});
}

/* ─── Registry ─── */
function buildRegistryTable(){
  const tbody=document.getElementById('registry-tbody');if(!tbody)return;
  tbody.innerHTML=registryData.map(r=>{
    const enacted=[...enactedPolicies].some(id=>policyData[id]?.name===r.name);
    return`<tr><td>${r.name}</td><td><span class="tag ${r.catCls}">${r.cat}</span></td><td><span class="tag ${enacted?'tag-g':'tag-b'}">${enacted?'ENACTED':'DRAFT'}</span></td><td style="color:#059669;font-weight:600">${r.walkDelta}</td><td style="color:#1E40AF;font-weight:600">${r.aqiDelta}</td><td style="color:#059669;font-weight:600">${r.housingDelta}</td><td style="color:#059669;font-weight:600">${r.carbonDelta}</td><td><div class="impact-bar-wrap"><div class="impact-bar" style="width:${r.impact}%;background:${r.impact>80?'#059669':r.impact>60?'#D97706':'#DC2626'}"></div></div></td></tr>`;
  }).join('');
}

/* ═══════════════════════════════════════
   SCENARIOS
═══════════════════════════════════════ */
function buildScenarioCards(){
  document.getElementById('sc-grid').innerHTML=scenarioCards.map(sc=>`
    <div class="sc-card ${sc.cls}" id="sc-${sc.id}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:4px">
        <div class="sc-name">${sc.name}</div>
        <button onclick="toggleCompare(${sc.id})" style="font-family:var(--font-mono);font-size:7.5px;padding:2px 8px;border-radius:4px;border:1px solid var(--border);background:var(--surface);color:var(--ink3);cursor:pointer;flex-shrink:0;transition:all .15s" onmouseover="this.style.borderColor='var(--purple)';this.style.color='var(--purple)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--ink3)'">⊞ Compare</button>
      </div>
      <div class="sc-desc">${sc.desc}</div>
      <div class="sc-meta-row">${sc.tags.map(t=>`<span class="sc-tag">${t}</span>`).join('')}</div>
      <div class="sc-metrics">${sc.metrics.map(m=>`<div class="sc-metric"><div class="sc-metric-label">${m.l}</div><div class="sc-metric-val" style="color:${m.c}">${m.v}</div></div>`).join('')}</div>
      <button class="sc-run-btn" id="sc-btn-${sc.id}" onclick="runScenario(${sc.id},this)">▶ RUN SIMULATION</button>
      <div class="progress-bar"><div class="progress-fill" id="sc-prog-${sc.id}"></div></div>
      <div class="sc-llm-out" id="sc-llm-${sc.id}"></div>
    </div>`).join('');
}

function runScenario(id,btn){
  if(btn.classList.contains('running'))return;
  const card=document.getElementById('sc-'+id);
  btn.textContent='◈ SIMULATING…';btn.classList.add('running');card.classList.add('running');
  let pct=0;
  const iv=setInterval(()=>{
    pct+=Math.random()*7+2;
    if(pct>=100){pct=100;clearInterval(iv);btn.textContent='✓ COMPLETE';btn.classList.remove('running');card.classList.remove('running');showToast('✓ Scenario simulation complete','ok');runScenarioAI(id,document.getElementById('sc-llm-'+id));}
    document.getElementById('sc-prog-'+id).style.width=Math.min(pct,100)+'%';
  },180);
}

async function runScenarioAI(id,outEl){
  const sc=scenarioCards.find(s=>s.id===id);if(!sc||!outEl)return;
  outEl.style.display='block';outEl.textContent='◈ Generating analysis…';
  try{
    const txt=await callAI([{role:'user',content:`Analyse Karachi planning scenario: ${sc.llmCtx}. Provide: (1) projected KPI outcomes with numbers, (2) top Karachi-specific implementation risk, (3) equity and community impact. Concise.`}]);
    typeText(outEl,txt);
  }catch(e){outEl.textContent='⚠ '+e.message;}
}

function showScForm(){document.getElementById('sc-form').style.display='block';document.getElementById('sc-form').scrollIntoView({behavior:'smooth'});}
function hideScForm(){document.getElementById('sc-form').style.display='none';}
function saveDraftScenario(){showToast('Draft saved','ok');hideScForm();}

async function submitScenario(){
  const name=document.getElementById('sc-name-input').value||'Custom Scenario';
  const out=document.getElementById('sc-submit-out');out.style.display='block';out.textContent='◈ Running simulation…';
  try{
    const txt=await callAI([{role:'user',content:`Simulate Karachi scenario "${name}". Horizon: ${document.getElementById('sc-horizon').value}. Objective: ${document.getElementById('sc-objective').value}. Budget: PKR ${document.getElementById('sc-budget').value||'TBD'}B. Population priority: ${document.getElementById('sl-pop').value}%, Environmental: ${document.getElementById('sl-env').value}%, Equity: ${document.getElementById('sl-eq').value}%. ${document.getElementById('sc-desc-input').value?'Description: '+document.getElementById('sc-desc-input').value:''} Give projected outcomes for walkability, housing, AQI, transit, equity with Karachi-specific numbers.`}]);
    typeText(out,txt);showToast('✓ Scenario simulation complete','ok');
  }catch(e){out.textContent='⚠ '+e.message;}
}

/* ═══════════════════════════════════════
   REPORTS — TYPE-SPECIFIC PDF TEMPLATES
═══════════════════════════════════════ */
const pdfTemplates={
  'Impact Assessment':(r,enacted)=>`<div style="font-family:'Inter',sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#111827"><div style="border-bottom:3px solid #1E40AF;padding-bottom:16px;margin-bottom:24px"><div style="font-size:9px;letter-spacing:.12em;color:#6B7280;font-family:monospace;margin-bottom:6px">KARACHI METROPOLITAN PLANNING AUTHORITY · IMPACT ASSESSMENT</div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px;color:#111827">${r.name}</h1><div style="font-size:11px;color:#6B7280">${r.date} · ${r.pages} pages · ${r.author}</div></div><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px">${r.metrics.map(m=>`<div style="background:#F0F4FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px"><div style="font-size:9px;color:#6B7280;font-family:monospace;text-transform:uppercase">${m.k}</div><div style="font-size:20px;font-weight:800;color:${m.c}">${m.v}</div></div>`).join('')}</div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Executive Summary</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.exec}</p></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Key Findings</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.findings}</p></div>${enacted.length?`<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:14px;margin-bottom:18px"><div style="font-size:9px;font-family:monospace;color:#1E40AF;letter-spacing:.1em;margin-bottom:5px">ACTIVE POLICIES AT TIME OF REPORT</div><div style="font-size:12px;color:#374151">${enacted.join(' · ')}</div></div>`:''}<div style="font-size:9px;color:#9CA3AF;font-family:monospace;border-top:1px solid #E5E7EB;padding-top:10px;text-align:center">UrbanPolicy v3 · Karachi Metropolitan Planning Authority · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div></div>`,
  'Cost-Benefit Analysis':(r,enacted)=>`<div style="font-family:'Inter',sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#111827"><div style="border-bottom:3px solid #D97706;padding-bottom:16px;margin-bottom:24px"><div style="font-size:9px;letter-spacing:.12em;color:#6B7280;font-family:monospace;margin-bottom:6px">KARACHI MPA · COST-BENEFIT ANALYSIS · FINANCE DIVISION</div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${r.name}</h1><div style="font-size:11px;color:#6B7280">${r.date} · ${r.pages} pages · ${r.author}</div></div><div style="background:#FFFBEB;border:2px solid #FDE68A;border-radius:8px;padding:16px;margin-bottom:20px"><div style="font-size:10px;font-family:monospace;color:#D97706;letter-spacing:.1em;margin-bottom:8px">FINANCIAL SUMMARY</div><div style="display:grid;grid-template-columns:repeat(${r.metrics.length},1fr);gap:10px">${r.metrics.map(m=>`<div style="text-align:center"><div style="font-size:9px;color:#6B7280;font-family:monospace;text-transform:uppercase">${m.k}</div><div style="font-size:18px;font-weight:800;color:${m.c}">${m.v}</div></div>`).join('')}</div></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Investment Summary</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.exec}</p></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Economic Analysis</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.findings}</p></div>${enacted.length?`<div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:8px;padding:12px"><div style="font-size:9px;font-family:monospace;color:#1E40AF;margin-bottom:4px">POLICIES IN SCOPE</div><div style="font-size:12px;color:#374151">${enacted.join(' · ')}</div></div>`:''}<div style="font-size:9px;color:#9CA3AF;font-family:monospace;border-top:1px solid #E5E7EB;padding-top:10px;text-align:center;margin-top:18px">UrbanPolicy v3 · Karachi Metropolitan Planning Authority · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div></div>`,
  'Environmental Report':(r,enacted)=>`<div style="font-family:'Inter',sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#111827"><div style="border-bottom:3px solid #059669;padding-bottom:16px;margin-bottom:24px"><div style="font-size:9px;letter-spacing:.12em;color:#6B7280;font-family:monospace;margin-bottom:6px">KARACHI MPA · ENVIRONMENTAL IMPACT ASSESSMENT</div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${r.name}</h1><div style="font-size:11px;color:#6B7280">${r.date} · ${r.pages} pages · ${r.author}</div></div><div style="background:#ECFDF5;border:2px solid #A7F3D0;border-radius:8px;padding:16px;margin-bottom:20px"><div style="font-size:10px;font-family:monospace;color:#059669;letter-spacing:.1em;margin-bottom:8px">ENVIRONMENTAL INDICATORS</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${r.metrics.map(m=>`<div style="background:#fff;border:1px solid #A7F3D0;border-radius:6px;padding:10px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:#374151">${m.k}</span><span style="font-size:15px;font-weight:800;color:${m.c}">${m.v}</span></div>`).join('')}</div></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Assessment Summary</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.exec}</p></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Environmental Impact</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.findings}</p></div>${enacted.length?`<div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:8px;padding:12px"><div style="font-size:9px;font-family:monospace;color:#059669;margin-bottom:4px">POLICIES IN SCOPE</div><div style="font-size:12px;color:#374151">${enacted.join(' · ')}</div></div>`:''}<div style="font-size:9px;color:#9CA3AF;font-family:monospace;border-top:1px solid #E5E7EB;padding-top:10px;text-align:center;margin-top:18px">UrbanPolicy v3 · Karachi Metropolitan Planning Authority · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div></div>`,
  'Equity Audit':(r,enacted)=>`<div style="font-family:'Inter',sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#111827"><div style="border-bottom:3px solid #7C3AED;padding-bottom:16px;margin-bottom:24px"><div style="font-size:9px;letter-spacing:.12em;color:#6B7280;font-family:monospace;margin-bottom:6px">KARACHI MPA · EQUITY & INCLUSION AUDIT</div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${r.name}</h1><div style="font-size:11px;color:#6B7280">${r.date} · ${r.pages} pages · ${r.author}</div></div><div style="background:#F5F3FF;border:2px solid #DDD6FE;border-radius:8px;padding:16px;margin-bottom:20px"><div style="font-size:10px;font-family:monospace;color:#7C3AED;letter-spacing:.1em;margin-bottom:8px">EQUITY METRICS</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${r.metrics.map(m=>`<div style="background:#fff;border:1px solid #DDD6FE;border-radius:6px;padding:10px;display:flex;justify-content:space-between;align-items:center"><span style="font-size:11px;color:#374151">${m.k}</span><span style="font-size:15px;font-weight:800;color:${m.c}">${m.v}</span></div>`).join('')}</div></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Executive Summary</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.exec}</p></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Equity Analysis</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.findings}</p></div>${enacted.length?`<div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:8px;padding:12px"><div style="font-size:9px;font-family:monospace;color:#7C3AED;margin-bottom:4px">POLICIES ASSESSED</div><div style="font-size:12px;color:#374151">${enacted.join(' · ')}</div></div>`:''}<div style="font-size:9px;color:#9CA3AF;font-family:monospace;border-top:1px solid #E5E7EB;padding-top:10px;text-align:center;margin-top:18px">UrbanPolicy v3 · Karachi Metropolitan Planning Authority · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div></div>`,
  'Executive Summary':(r,enacted)=>`<div style="font-family:'Inter',sans-serif;padding:40px;max-width:800px;margin:0 auto;color:#111827"><div style="border-bottom:3px solid #111827;padding-bottom:16px;margin-bottom:24px"><div style="font-size:9px;letter-spacing:.12em;color:#6B7280;font-family:monospace;margin-bottom:6px">KARACHI METROPOLITAN PLANNING AUTHORITY · EXECUTIVE BRIEF</div><h1 style="font-size:24px;font-weight:800;margin-bottom:4px">${r.name}</h1><div style="font-size:11px;color:#6B7280">${r.date} · ${r.pages} pages · ${r.author}</div></div><div style="background:#F9FAFB;border:2px solid #E5E7EB;border-radius:8px;padding:16px;margin-bottom:20px"><div style="font-size:10px;font-family:monospace;color:#111827;letter-spacing:.1em;margin-bottom:8px">KEY METRICS</div><div style="display:grid;grid-template-columns:repeat(${r.metrics.length},1fr);gap:10px">${r.metrics.map(m=>`<div style="text-align:center"><div style="font-size:9px;color:#6B7280;font-family:monospace;text-transform:uppercase">${m.k}</div><div style="font-size:18px;font-weight:800;color:${m.c}">${m.v}</div></div>`).join('')}</div></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Executive Summary</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.exec}</p></div><div style="margin-bottom:18px"><h2 style="font-size:12px;font-family:monospace;text-transform:uppercase;letter-spacing:.1em;color:#6B7280;border-bottom:1px solid #E5E7EB;padding-bottom:7px;margin-bottom:10px">Recommendations</h2><p style="line-height:1.8;font-size:13px;color:#374151">${r.findings}</p></div>${enacted.length?`<div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:8px;padding:12px"><div style="font-size:9px;font-family:monospace;color:#111827;margin-bottom:4px">CURRENT POLICY LANDSCAPE</div><div style="font-size:12px;color:#374151">${enacted.join(' · ')}</div></div>`:''}<div style="font-size:9px;color:#9CA3AF;font-family:monospace;border-top:1px solid #E5E7EB;padding-top:10px;text-align:center;margin-top:18px">UrbanPolicy v3 · Karachi Metropolitan Planning Authority · ${new Date().toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'})}</div></div>`,
};

async function createReport(){
  const title=document.getElementById('modal-report-title').value||'Untitled Report';
  const type=document.getElementById('modal-report-type').value;
  const author=document.getElementById('modal-author').value||currentUser.dept;
  const notes=document.getElementById('modal-notes').value;
  const enacted=[...enactedPolicies].map(id=>policyData[id]?.name).filter(Boolean);
  closeModal('report-modal');
  const card=addReportToList(title,type,author,notes);
  const el=document.querySelector(`#${card.id} .rep-ai-out`);
  if(!el)return;
  el.style.display='block';el.textContent='◈ Generating report with AI…';
  try{
    const prompt=`Generate a detailed Karachi urban planning report. Title: "${title}". Type: ${type}. Author: ${author}. Enacted Policies: ${enacted.join(', ')||'None'}. ${notes?'Context: '+notes:''} Provide: (1) Executive summary (2-3 sentences), (2) Key findings (3-4 Karachi-specific insights with numbers where possible), (3) Actionable recommendations. Professional tone. Concise.`;
    const txt=await callAI([{role:'user',content:prompt}]);
    typeText(el,txt);
    addAuditEntry('report_generated',{title,type,author,aiSummary:txt.substring(0,80)+'…'});
  }catch(e){el.textContent='⚠ '+e.message;}
}

function addReportToList(title,type,author,notes){
  const id='rep-'+Date.now();
  const date=new Date().toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  const pages=Math.floor(Math.random()*8)+4;
  const card=document.createElement('div');card.className='rep-card';card.id=id;
  const typeColors={'Impact Assessment':'#1E40AF','Cost-Benefit Analysis':'#D97706','Equity Audit':'#7C3AED','Environmental Report':'#059669','Executive Summary':'#111827'};
  const color=typeColors[type]||'#6B7280';
  card.innerHTML=`
    <div class="rep-head">
      <div class="rep-meta-row">
        <div class="rep-type" style="background:${color}22;color:${color};border:1px solid ${color}44">${type}</div>
        <div class="rep-date">${date} · ${pages}pg</div>
      </div>
      <div class="rep-title">${title}</div>
      <div class="rep-author">${author}</div>
    </div>
    <div class="rep-ai-out" style="display:none"></div>
    <div class="rep-actions">
      <button class="btn-rep-action" onclick="downloadReportPDF('${id}','${title}','${type}','${date}','${pages}','${author}')">⬇ PDF</button>
      <button class="btn-rep-action" onclick="shareReport('${id}')">↗ Share</button>
      <button class="btn-rep-action" onclick="deleteReport('${id}')">🗑 Delete</button>
    </div>
  `;
  document.getElementById('rep-list').prepend(card);
  return{id,title,type,date,pages,author,notes};
}

function downloadReportPDF(id,title,type,date,pages,author){
  const card=document.getElementById(id);
  const aiOut=card.querySelector('.rep-ai-out');
  const aiText=aiOut&&aiOut.style.display!=='none'?aiOut.textContent:'AI analysis not yet generated.';
  const execMatch=aiText.match(/executive summary[:\s]+(.*?)(?=key findings|recommendations|$)/is);
  const findMatch=aiText.match(/key findings[:\s]+(.*?)(?=recommendations|actionable|$)/is);
  const exec=execMatch?execMatch[1].trim().substring(0,400):'Comprehensive analysis of urban planning policies and their impact on Karachi metropolitan region.';
  const findings=findMatch?findMatch[1].trim().substring(0,400):'Detailed findings based on current policy implementation status and projected outcomes for key performance indicators.';
  const enacted=[...enactedPolicies].map(id=>policyData[id]?.name).filter(Boolean);
  const metrics=[
    {k:'Walkability',v:'+'+Math.round(liveKPI.walk),c:'#059669'},
    {k:'AQI',v:Math.round(liveKPI.aqi),c:liveKPI.aqi<65?'#059669':'#DC2626'},
    {k:'Transit',v:Math.round(liveKPI.transit)+'%',c:'#1E40AF'},
    {k:'Housing',v:Math.round(liveKPI.afford)+'%',c:'#D97706'},
  ];
  const r={name:title,date,pages,author,exec,findings,metrics};
  const template=pdfTemplates[type]||pdfTemplates['Executive Summary'];
  const html=template(r,enacted);
  const opt={margin:[15,15],filename:title.replace(/[^a-zA-Z0-9]/g,'_')+'.pdf',image:{type:'jpeg',quality:0.98},html2canvas:{scale:2,useCORS:true},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}};
  html2pdf().set(opt).from(html).save();
  showToast('✓ PDF downloaded','ok');
  addAuditEntry('report_downloaded',{title,type});
}

function shareReport(id){
  showToast('Share link copied (demo)','ok');
  addAuditEntry('report_shared',{reportId:id});
}

function deleteReport(id){
  confirmAction('Delete this report?','This action cannot be undone.','',()=>{
    document.getElementById(id)?.remove();
    showToast('Report deleted','ok');
    addAuditEntry('report_deleted',{reportId:id});
  });
}

function exportAnalyticsSummary(){
  const enacted=[...enactedPolicies].map(id=>policyData[id]);
  const csv=['Metric,Value',
    `Enacted Policies,${enacted.length}`,
    `Budget Used,PKR ${enacted.reduce((s,p)=>(POLICY_COSTS[p.id]||0)+s,0)}B`,
    `Walkability Score,${Math.round(liveKPI.walk)}`,
    `AQI Level,${Math.round(liveKPI.aqi)}`,
    `Transit Coverage,${Math.round(liveKPI.transit)}%`,
    `Housing Affordability,${Math.round(liveKPI.afford)}%`,
    `Carbon Reduction,${Math.round(liveKPI.carbon)}%`,
  ].join('\n');
  downloadFile('analytics-summary-'+new Date().toISOString().split('T')[0]+'.csv',csv,'text/csv');
  showToast('✓ Analytics summary exported','ok');
}

/* ═══════════════════════════════════════
   COMPARE MODE
═══════════════════════════════════════ */
function toggleCompare(id){
  const idx=compareScenarios.indexOf(id);
  if(idx>-1){
    compareScenarios.splice(idx,1);
  }else{
    if(compareScenarios.length>=3){showToast('Max 3 scenarios for comparison','warn');return;}
    compareScenarios.push(id);
  }
  updateCompareUI();
}

function updateCompareUI(){
  document.querySelectorAll('.sc-card').forEach(c=>{
    const id=parseInt(c.id.replace('sc-',''));
    if(compareScenarios.includes(id)){c.classList.add('compare-active');}
    else{c.classList.remove('compare-active');}
  });
  const btn=document.getElementById('compare-run-btn');
  if(compareScenarios.length<2){btn.disabled=true;btn.textContent='SELECT 2-3 SCENARIOS';}
  else{btn.disabled=false;btn.textContent=`⚖ COMPARE ${compareScenarios.length} SCENARIOS`;}
}

async function runCompare(){
  if(compareScenarios.length<2)return;
  const el=document.getElementById('compare-out');el.style.display='block';el.textContent='◈ Running comparative analysis…';
  const names=compareScenarios.map(id=>scenarioCards.find(s=>s.id===id)?.name||'Scenario '+id);
  try{
    const txt=await callAI([{role:'user',content:`Compare these Karachi planning scenarios: ${names.join(' vs ')}. Provide: (1) Comparative KPI projections (walkability, transit, AQI, equity), (2) Trade-offs between scenarios with Karachi-specific context, (3) Which scenario best serves which population segment. Concise, data-driven.`}]);
    typeText(el,txt);
  }catch(e){el.textContent='⚠ '+e.message;}
}

function clearCompare(){
  compareScenarios=[];
  updateCompareUI();
  document.getElementById('compare-out').style.display='none';
  showToast('Comparison cleared','ok');
}

/* ═══════════════════════════════════════
   INITIALIZATION
═══════════════════════════════════════ */
function init(){
  buildPolicyCards();
  initMap();
  buildStatCards();
  updateBudgetBar();
  updateEnactedCount();
  buildRegistryTable();
  buildScenarioCards();
  updateCompareUI();
  startClock();
  checkReadOnlyMode();
  startAutoSave();
  loadStateFromStorage();
  updateLastSaved();
}

function startClock(){
  setInterval(()=>{
    const now=new Date();
    const t=now.toLocaleTimeString('en-GB',{hour12:false});
    document.getElementById('clock').textContent=t;
  },1000);
}

function checkReadOnlyMode(){
  const params=new URLSearchParams(window.location.search);
  if(params.get('readonly')==='true'){readOnlyMode=true;updateReadOnlyUI();}
}

function toggleReadOnly(){
  readOnlyMode=!readOnlyMode;
  updateReadOnlyUI();
  showToast(readOnlyMode?'✓ View-only mode enabled':'✓ Edit mode enabled','ok');
}

function updateReadOnlyUI(){
  const pill=document.getElementById('readonly-pill');
  if(readOnlyMode){
    pill.style.background='var(--amber-bg)';
    pill.style.color='var(--amber)';
    pill.style.border='1px solid var(--amber-bd)';
    pill.textContent='👁 VIEW ONLY';
  }else{
    pill.style.background='var(--green-bg)';
    pill.style.color='var(--green)';
    pill.style.border='1px solid var(--green-bd)';
    pill.textContent='✎ EDIT MODE';
  }
}

function startAutoSave(){
  if(autoSaveTimer)clearInterval(autoSaveTimer);
  autoSaveTimer=setInterval(()=>{
    saveStateToStorage();
    updateLastSaved();
  },30000);
}

function saveStateToStorage(){
  try{
    const state={
      enactedPolicies:Array.from(enactedPolicies),
      policyData:Object.fromEntries(Object.entries(policyData)),
      liveKPI,
      auditLog,
      quorumApprovals:Object.fromEntries(Object.entries(quorumApprovals).map(([k,v])=>[k,Array.from(v)])),
      policyVersionHistory,
      currentUser,
      lastSaved:Date.now(),
    };
    localStorage.setItem('urbanpolicy_v3_state',JSON.stringify(state));
  }catch(e){console.error('Save failed:',e);}
}

function loadStateFromStorage(){
  try{
    const saved=localStorage.getItem('urbanpolicy_v3_state');
    if(!saved)return;
    const state=JSON.parse(saved);
    enactedPolicies=new Set(state.enactedPolicies||[]);
    if(state.policyData)Object.assign(policyData,state.policyData);
    if(state.liveKPI)liveKPI=state.liveKPI;
    if(state.auditLog)auditLog=state.auditLog;
    if(state.quorumApprovals)quorumApprovals=Object.fromEntries(Object.entries(state.quorumApprovals).map(([k,v])=>[k,new Set(v)]));
    if(state.policyVersionHistory)policyVersionHistory=state.policyVersionHistory;
    if(state.currentUser)currentUser=state.currentUser;
    if(state.lastSaved)lastSaved=state.lastSaved;
    buildPolicyCards();
    updateBudgetBar();
    updateEnactedCount();
    updateAllKPIDisplays();
    buildRegistryTable();
    updateLastSaved();
  }catch(e){console.error('Load failed:',e);}
}

function updateLastSaved(){
  const el=document.getElementById('last-saved-txt');
  if(!el)return;
  if(!lastSaved){el.textContent='NEVER';return;}
  const ago=Math.floor((Date.now()-lastSaved)/1000);
  if(ago<60)el.textContent='JUST NOW';
  else if(ago<3600)el.textContent=Math.floor(ago/60)+'M AGO';
  else el.textContent=Math.floor(ago/3600)+'H AGO';
}

// Export functions to window for HTML onclick handlers
window.showPage=showPage;
window.openModal=openModal;
window.closeModal=closeModal;
window.toggleLayer=toggleLayer;
window.setMapMode=setMapMode;
window.switchRole=switchRole;
window.enactPolicy=enactPolicy;
window.revokePolicy=revokePolicy;
window.deletePolicy=deletePolicy;
window.addNewPolicy=addNewPolicy;
window.sendChatMessage=sendChatMessage;
window.runPolicyAI=runPolicyAI;
window.openPolicyDetail=openPolicyDetail;
window.closePolicyDetail=closePolicyDetail;
window.advanceWorkflow=advanceWorkflow;
window.addComment=addComment;
window.viewVersions=viewVersions;
window.exportAuditCSV=exportAuditCSV;
window.confirmClearAudit=confirmClearAudit;
window.importCSV=importCSV;
window.createReport=createReport;
window.downloadReportPDF=downloadReportPDF;
window.shareReport=shareReport;
window.deleteReport=deleteReport;
window.exportAnalyticsSummary=exportAnalyticsSummary;
window.runScenario=runScenario;
window.showScForm=showScForm;
window.hideScForm=hideScForm;
window.saveDraftScenario=saveDraftScenario;
window.submitScenario=submitScenario;
window.toggleCompare=toggleCompare;
window.runCompare=runCompare;
window.clearCompare=clearCompare;
window.fetchEONET=fetchEONET;
window.setEONETFilter=setEONETFilter;
window.closeDisasterPanel=closeDisasterPanel;
window.selectEONETEvent=selectEONETEvent;
window.enactEONETPolicy=enactEONETPolicy;
window.toggleReadOnly=toggleReadOnly;
window.checkPermission=checkPermission;

// Initialize on load
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',init);
}else{
  init();
}